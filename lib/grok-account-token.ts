/**
 * Grok saved-account access-token resolver.
 *
 * Managed refreshes share the Grok provider critical section and the same
 * slot-first transaction as ModelRuntime's coordinated Active credential store.
 * The managed slot is authoritative; auth.json is only mirrored after its
 * durable commit and only while the slot remains Active.
 *
 * Token errors are credential-evidence-only: only missing refresh, explicit
 * upstream reauth, or confirmed revoked/unauthorized evidence map to
 * unauthorized. Provider/load/network/lock/store/mirror/generic refresh and
 * unknown failures stay non-reauth infrastructure codes.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Credential } from "@earendil-works/pi-ai";
import { getOAuthApiKey } from "@/lib/pi-ai-oauth-compat";
import { withGrokProviderLock } from "./grok-account-lock";
import {
  commitGrokCredentialUnderLock,
  reconcileGrokActiveMirrorUnderLock,
} from "./grok-credential-transaction";
import { GROK_CLI_PROVIDER_ID, isSupportedOAuthAccountProvider } from "./oauth-account-providers";
import { getWebCredentialStore } from "./web-credential-store";

// ─── Fixed safe error codes / messages ───────────────────────────────────────

export type GrokTokenErrorCode =
  | "missing_storage_id"
  | "account_not_found"
  | "invalid_credential"
  | "missing_refresh"
  | "provider_unavailable"
  | "refresh_failed"
  | "unauthorized"
  | "network"
  | "unavailable";

const GROK_TOKEN_SAFE_MESSAGES: Record<GrokTokenErrorCode, string> = {
  missing_storage_id: "Grok account storage id is required",
  account_not_found: "Grok saved account not found",
  invalid_credential: "Grok saved account credential is invalid",
  missing_refresh:
    "Grok OAuth access token expired and no refresh token is available. Please re-authenticate.",
  // refresh_failed is infrastructure/upstream failure, not confirmed credential revocation.
  refresh_failed: "Grok OAuth token refresh failed. Please try again.",
  unauthorized: "Grok OAuth authorization expired. Please re-authenticate.",
  network: "Grok OAuth network error. Please try again.",
  unavailable: "Grok OAuth is temporarily unavailable. Please try again.",
  provider_unavailable:
    "Grok OAuth provider is not available. Please try again after the provider finishes loading.",
};

export class GrokTokenError extends Error {
  readonly code: GrokTokenErrorCode;
  constructor(code: GrokTokenErrorCode, message?: string) {
    super(message ?? GROK_TOKEN_SAFE_MESSAGES[code]);
    this.name = "GrokTokenError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Prefer structured third-party evidence (`code` / `reloginRequired`) when
 * present. Never project upstream bodies, tokens, paths, or storage ids.
 */
export function mapGrokOAuthError(error: unknown): { code: GrokTokenErrorCode; message: string } {
  if (error instanceof GrokTokenError) {
    return { code: error.code, message: error.message };
  }

  const record = isRecord(error) ? error : null;
  const code =
    typeof (error as { code?: unknown } | null | undefined)?.code === "string"
      ? String((error as { code: string }).code).trim().toLowerCase()
      : typeof record?.code === "string"
        ? record.code.trim().toLowerCase()
        : "";
  const reloginRequired =
    (error as { reloginRequired?: unknown } | null | undefined)?.reloginRequired === true
    || record?.reloginRequired === true;
  const name =
    error instanceof Error
      ? error.name
      : typeof record?.name === "string"
        ? record.name
        : "";
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();

  // 1) Explicit third-party credential evidence first.
  if (code === "refresh_missing" || code === "auth_missing") {
    return { code: "missing_refresh", message: GROK_TOKEN_SAFE_MESSAGES.missing_refresh };
  }
  if (reloginRequired) {
    return { code: "unauthorized", message: GROK_TOKEN_SAFE_MESSAGES.unauthorized };
  }
  if (
    code === "authorization_failed"
    || code === "state_mismatch"
    || code === "code_missing"
  ) {
    // Login-flow failures are not refresh infrastructure; treat as unauthorized
    // only when the upstream marked them as requiring re-login above.
    // Without reloginRequired they stay non-reauth refresh failures.
    return { code: "refresh_failed", message: GROK_TOKEN_SAFE_MESSAGES.refresh_failed };
  }
  if (
    code === "discovery_failed"
    || code === "discovery_invalid_origin"
    || code === "device_authorization_unavailable"
    || code === "callback_bind_failed"
    || code === "callback_timeout"
  ) {
    return { code: "network", message: GROK_TOKEN_SAFE_MESSAGES.network };
  }
  if (
    code === "token_exchange_failed"
    || code === "token_exchange_invalid"
    || code === "device_authorization_failed"
    || code === "device_authorization_invalid"
    || code === "refresh_failed"
  ) {
    // Generic refresh_failed without reloginRequired is non-reauth.
    return { code: "refresh_failed", message: GROK_TOKEN_SAFE_MESSAGES.refresh_failed };
  }

  // 2) Message-level confirmed revocation only (no generic "refresh failed").
  if (
    /invalid.?grant|invalid.?token|token.?revoked|access.?denied|unauthorized|\b401\b|revoked|reauth|re-?authenticate/.test(
      lower,
    )
  ) {
    return { code: "unauthorized", message: GROK_TOKEN_SAFE_MESSAGES.unauthorized };
  }
  if (/network|fetch failed|econn|enotfound|socket|dns|timeout|aborted|abort/.test(lower)) {
    return { code: "network", message: GROK_TOKEN_SAFE_MESSAGES.network };
  }
  // Storage / lock / Active-mirror failures are local infrastructure, not reauth.
  if (
    /mirror|reconciliation failed|credential write|atomic write|eacces|eperm|enospc|erofs|lock timed? ?out|lock timeout|provider lock/.test(
      lower,
    )
  ) {
    return { code: "unavailable", message: GROK_TOKEN_SAFE_MESSAGES.unavailable };
  }
  if (
    /provider.?unavailable|provider is not available|oauth provider is not available|oauth provider not registered|missing oauth provider/.test(
      lower,
    )
  ) {
    return { code: "provider_unavailable", message: GROK_TOKEN_SAFE_MESSAGES.provider_unavailable };
  }
  if (
    name === "XaiOAuthError"
    || /refresh|token exchange|oauth|xai token|grok oauth|grok token/.test(lower)
  ) {
    return { code: "refresh_failed", message: GROK_TOKEN_SAFE_MESSAGES.refresh_failed };
  }
  return { code: "unavailable", message: GROK_TOKEN_SAFE_MESSAGES.unavailable };
}

/** Project safe login/SSE error text for Grok (no raw upstream body). */
export function sanitizeGrokLoginError(error: unknown): string {
  if (error instanceof GrokTokenError) return error.message;
  return mapGrokOAuthError(error).message;
}

export interface GrokAccessToken {
  accessToken: string;
  /** true when the token was refreshed during this call. */
  refreshed: boolean;
  /** epoch millis when the token expires. */
  expiresAt: number;
}

export interface GrokAccessTokenOptions {
  /** Minimum remaining validity in ms before a refresh is triggered. Default 120_000 (2 min). */
  minValidityMs?: number;
  /** When true, always perform a provider refresh, even while locally valid. */
  forceRefresh?: boolean;
  /** AbortSignal to cancel a long-running refresh. */
  signal?: AbortSignal;
}

type FlightEntry = {
  promise: Promise<GrokAccessToken>;
  forceRefresh: boolean;
};

const inflightRefreshes = new Map<string, FlightEntry>();

function grokAccountDir(): string {
  return join(getAgentDir(), "auth-accounts", GROK_CLI_PROVIDER_ID);
}

function credentialFilePath(storageId: string): string {
  return join(grokAccountDir(), `${encodeURIComponent(storageId)}.json`);
}

function flightKey(storageId: string): string {
  return `grok-cli:${storageId}`;
}

function epochNow(): number {
  return Date.now();
}

function throwMappedStoreError(error: unknown): never {
  if (error instanceof GrokTokenError) throw error;
  const mapped = mapGrokOAuthError(error);
  // Local store/mirror/lock never upgrades to unauthorized.
  const code = mapped.code === "unauthorized" ? "unavailable" : mapped.code;
  throw new GrokTokenError(
    code,
    code === mapped.code ? mapped.message : GROK_TOKEN_SAFE_MESSAGES.unavailable,
  );
}

async function readCredential(storageId: string): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(credentialFilePath(storageId), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new GrokTokenError("account_not_found");
    }
    throw new GrokTokenError("invalid_credential");
  }
  if (!isRecord(raw)) throw new GrokTokenError("invalid_credential");
  return raw;
}

async function refreshGrokCredentialUnderLock(
  storageId: string,
  currentCredential: Record<string, unknown>,
  rawStore: Awaited<ReturnType<typeof getWebCredentialStore>>,
): Promise<GrokAccessToken> {
  if (!isSupportedOAuthAccountProvider(GROK_CLI_PROVIDER_ID)) {
    throw new GrokTokenError("unavailable", "grok-cli OAuth account management is not available");
  }

  const refresh = typeof currentCredential.refresh === "string" ? currentCredential.refresh.trim() : "";
  if (!refresh) {
    throw new GrokTokenError("missing_refresh");
  }

  let result: { apiKey?: string; newCredentials?: Record<string, unknown> } | null;
  try {
    const { getOAuthProvider } = await import("./pi-ai-oauth-compat");
    if (!getOAuthProvider(GROK_CLI_PROVIDER_ID)) {
      const { ensureWebProvidersBootstrapped } = await import("./pi-provider-extensions");
      await ensureWebProvidersBootstrapped();
    }
    // Cold saved-account refresh depends on the public OAuth bridge. Missing
    // provider after bootstrap is infrastructure, not revoked credentials.
    if (!getOAuthProvider(GROK_CLI_PROVIDER_ID)) {
      throw new GrokTokenError("provider_unavailable");
    }
    result = await getOAuthApiKey(
      GROK_CLI_PROVIDER_ID,
      { [GROK_CLI_PROVIDER_ID]: currentCredential as import("@earendil-works/pi-ai").OAuthCredentials },
      // The caller already performed the lock-time expiry/force decision. This
      // compatibility path must therefore perform the actual remote refresh,
      // including for the min-validity window before local expiry.
      { forceRefresh: true },
    );
  } catch (error) {
    if (error instanceof GrokTokenError) throw error;
    const mapped = mapGrokOAuthError(error);
    throw new GrokTokenError(mapped.code, mapped.message);
  }

  if (!result?.apiKey) {
    // After the explicit provider check, empty keys are refresh infrastructure
    // failures rather than confirmed invalid_grant.
    throw new GrokTokenError("refresh_failed", "Grok OAuth token refresh returned no API key");
  }

  const nextCredential = result.newCredentials ?? currentCredential;
  const credential = {
    ...nextCredential,
    type: "oauth" as const,
  } as Credential;

  // The transaction writes the slot first, then only mirrors auth.json if this
  // storage id is still Active. It deliberately leaves the new slot durable if
  // the mirror fails rather than restoring a consumed rotating refresh token.
  // Map storage/mirror failures to structured unavailable, never reauth.
  try {
    await commitGrokCredentialUnderLock({ rawStore, storageId, credential });
  } catch (error) {
    throwMappedStoreError(error);
  }

  const expires = typeof nextCredential.expires === "number" ? nextCredential.expires : epochNow() + 3_600_000;
  return { accessToken: result.apiKey, refreshed: true, expiresAt: expires };
}

async function createFlight(
  storageId: string,
  opts: Required<Pick<GrokAccessTokenOptions, "minValidityMs" | "forceRefresh">> & Pick<GrokAccessTokenOptions, "signal">,
): Promise<GrokAccessToken> {
  opts.signal?.throwIfAborted();
  return withGrokProviderLock(async () => {
    const raw = await readCredential(storageId);
    const access = typeof raw.access === "string" ? raw.access.trim() : "";
    const expires = typeof raw.expires === "number" ? raw.expires : 0;
    const needsRefresh = opts.forceRefresh || !access || epochNow() >= expires - opts.minValidityMs;
    const rawStore = await getWebCredentialStore();
    if (!needsRefresh) {
      // A prior mirror write may have failed after the slot-first commit. A
      // normal valid-token read is the safe recovery point: it only repairs
      // this still-Active slot and never consumes another refresh token.
      // Mirror repair is best-effort: a still-valid AT must remain usable even
      // when local reconciliation fails for this request.
      try {
        await reconcileGrokActiveMirrorUnderLock({ rawStore, storageId });
      } catch (error) {
        void error;
      }
      return { accessToken: access, refreshed: false, expiresAt: expires };
    }

    opts.signal?.throwIfAborted();
    return refreshGrokCredentialUnderLock(storageId, raw, rawStore);
  });
}

/**
 * Resolve an access token for one saved Grok account. A forced caller cannot be
 * satisfied by an ordinary flight that merely returned an unexpired token;
 * concurrent forced callers share one forced flight.
 */
export async function getGrokAccessToken(
  storageId: string,
  opts: GrokAccessTokenOptions = {},
): Promise<GrokAccessToken> {
  const normalizedStorageId = storageId.trim();
  if (!normalizedStorageId) throw new GrokTokenError("missing_storage_id");

  const options = {
    minValidityMs: opts.minValidityMs ?? 120_000,
    forceRefresh: opts.forceRefresh === true,
    signal: opts.signal,
  };
  const key = flightKey(normalizedStorageId);
  const existing = inflightRefreshes.get(key);
  if (existing) {
    if (!options.forceRefresh || existing.forceRefresh) return existing.promise;
    // An ordinary flight may have only read a valid credential. Wait for it so
    // it can finish its lock scope, then force a real refresh if it did not.
    return existing.promise.then((result) => result.refreshed ? result : getGrokAccessToken(normalizedStorageId, options));
  }

  const entry: FlightEntry = {
    forceRefresh: options.forceRefresh,
    promise: Promise.resolve({ accessToken: "", refreshed: false, expiresAt: 0 }),
  };
  entry.promise = createFlight(normalizedStorageId, options).finally(() => {
    // Do not let an older flight erase a newer forced replacement.
    if (inflightRefreshes.get(key) === entry) inflightRefreshes.delete(key);
  });
  inflightRefreshes.set(key, entry);
  return entry.promise;
}

export function invalidateGrokTokenFlight(storageId: string): void {
  inflightRefreshes.delete(flightKey(storageId));
}

export function invalidateGrokTokenCache(storageId: string): void {
  invalidateGrokTokenFlight(storageId);
}
