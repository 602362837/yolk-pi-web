/**
 * antigravity-account-token — per-account access token resolver with refresh isolation
 *
 * Managed refreshes share the Antigravity provider critical section and the same
 * slot-first transaction as ModelRuntime's coordinated Active credential store.
 * The managed slot is authoritative; auth.json is only mirrored after its durable
 * commit and only while the slot remains Active.
 *
 * ## Invariants
 *
 * - One in-flight refresh per storageId at a time (single-flight), with
 *   force-aware sharing so a forced caller is never satisfied by an ordinary
 *   flight that only returned a still-valid token.
 * - Refresh holds the Antigravity provider lock shared with Activate coordination.
 * - Secret writes use tmp + rename for atomicity (0600 file / 0700 dir).
 * - auth.json mirror is only updated when the refreshed account IS the
 *   current active account at the time of completion (lock-held re-read CAS).
 * - Mirror failure never rolls back a durable slot; ordinary valid-token reads
 *   reconcile still-Active mirrors without consuming another refresh token.
 * - Refresh results are merged with the existing credential so a missing
 *   projectId in the refresh response never drops the server-side projectId.
 * - getOAuthApiKey returns a JSON string `{ token, projectId }`; this resolver
 *   only exposes the parsed access token to callers (projectId stays server-side).
 * - No credential material is ever logged or returned to callers other
 *   than the resolved access token.
 * - Never statically resolve `@earendil-works/pi-coding-agent/package.json`
 *   (Turbopack rejects that export subpath and breaks cold Auth routes).
 */

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Credential, OAuthCredentials } from "@earendil-works/pi-ai";
import { getOAuthApiKey } from "@/lib/pi-ai-oauth-compat";
import { getWebCredentialStore } from "@/lib/web-credential-store";
import { ANTIGRAVITY_PROVIDER_ID, isSupportedOAuthAccountProvider } from "./oauth-account-providers";
import { withAntigravityProviderLock } from "./antigravity-account-lock";
import {
  commitAntigravityCredentialUnderLock,
  reconcileAntigravityActiveMirrorUnderLock,
} from "./antigravity-credential-transaction";

// ─── Fixed safe error codes / messages ───────────────────────────────────────

export type AntigravityTokenErrorCode =
  | "missing_storage_id"
  | "account_not_found"
  | "invalid_credential"
  | "missing_refresh"
  | "missing_project"
  | "refresh_failed"
  | "unauthorized"
  | "network"
  | "unavailable"
  | "provider_unavailable";

const SAFE_ERROR_MESSAGES: Record<AntigravityTokenErrorCode, string> = {
  missing_storage_id: "Antigravity account storage id is required",
  account_not_found: "Antigravity saved account not found",
  invalid_credential: "Antigravity saved account credential is invalid",
  missing_refresh: "Antigravity OAuth access token expired and no refresh token is available. Please re-authenticate.",
  missing_project: "Antigravity credential is missing project binding. Please re-authenticate.",
  // refresh_failed is infrastructure/upstream failure, not confirmed credential revocation.
  refresh_failed: "Antigravity OAuth token refresh failed. Please try again.",
  unauthorized: "Antigravity OAuth authorization expired. Please re-authenticate.",
  network: "Antigravity OAuth network error. Please try again.",
  unavailable: "Antigravity OAuth is temporarily unavailable. Please try again.",
  provider_unavailable:
    "Antigravity OAuth provider is not available. Please try again after the provider finishes loading.",
};

export class AntigravityTokenError extends Error {
  readonly code: AntigravityTokenErrorCode;
  constructor(code: AntigravityTokenErrorCode, message?: string) {
    super(message ?? SAFE_ERROR_MESSAGES[code]);
    this.name = "AntigravityTokenError";
    this.code = code;
  }
}

/**
 * Map an unknown refresh/login error to a fixed safe message.
 * Never returns raw upstream response text, tokens, projectId, or paths.
 */
export function mapAntigravityOAuthError(error: unknown): { code: AntigravityTokenErrorCode; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();

  // Confirmed credential revocation / authorization loss only.
  // Generic "refresh failed" / temporary upstream text must NOT become reauth.
  if (
    /invalid.?grant|invalid.?token|token.?revoked|access.?denied|unauthorized|\b401\b|revoked|reauth|re-?authenticate/.test(
      lower,
    )
  ) {
    return { code: "unauthorized", message: SAFE_ERROR_MESSAGES.unauthorized };
  }
  if (/missing projectid|missing project|projectid/.test(lower) && /missing|required|invalid/.test(lower)) {
    return { code: "missing_project", message: SAFE_ERROR_MESSAGES.missing_project };
  }
  if (/network|fetch failed|econn|enotfound|socket|dns|timeout|aborted|abort/.test(lower)) {
    return { code: "network", message: SAFE_ERROR_MESSAGES.network };
  }
  // Storage / lock / Active-mirror failures are local infrastructure, not reauth.
  if (
    /mirror|reconciliation failed|credential write|atomic write|eacces|eperm|enospc|erofs|lock timed? ?out|lock timeout|provider lock/.test(
      lower,
    )
  ) {
    return { code: "unavailable", message: SAFE_ERROR_MESSAGES.unavailable };
  }
  if (
    /provider.?unavailable|provider is not available|oauth provider is not available|oauth provider not registered|missing oauth provider/.test(
      lower,
    )
  ) {
    return { code: "provider_unavailable", message: SAFE_ERROR_MESSAGES.provider_unavailable };
  }
  if (/refresh|token exchange|oauth|antigravity token/.test(lower)) {
    return { code: "refresh_failed", message: SAFE_ERROR_MESSAGES.refresh_failed };
  }
  return { code: "unavailable", message: SAFE_ERROR_MESSAGES.unavailable };
}

/** Project safe login/SSE error text for Antigravity (no raw upstream body). */
export function sanitizeAntigravityLoginError(error: unknown): string {
  if (error instanceof AntigravityTokenError) return error.message;
  return mapAntigravityOAuthError(error).message;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AntigravityAccessToken {
  accessToken: string;
  /** true when the token was refreshed during this call. */
  refreshed: boolean;
  /** epoch millis when the token expires. */
  expiresAt: number;
}

export interface AntigravityAccessTokenOptions {
  /** Minimum remaining validity in ms before a refresh is triggered. Default 120_000 (2 min). */
  minValidityMs?: number;
  /** When true, always refresh even if the token is still within minValidityMs. */
  forceRefresh?: boolean;
  /** AbortSignal to cancel a long-running refresh. */
  signal?: AbortSignal;
}

// ─── File path helpers ───────────────────────────────────────────────────────

const ACCOUNT_STORE_DIR = "auth-accounts";

function antigravityAccountDir(): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, ANTIGRAVITY_PROVIDER_ID);
}

function credentialFilePath(storageId: string): string {
  return join(antigravityAccountDir(), `${encodeURIComponent(storageId)}.json`);
}

// ─── In-flight registry (force-aware single-flight) ──────────────────────────

type FlightEntry = {
  promise: Promise<AntigravityAccessToken>;
  forceRefresh: boolean;
  storageId: string;
};

const inflightRefreshes = new Map<string, FlightEntry>();

function flightKey(storageId: string): string {
  return `antigravity:${storageId}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function epochNow(): number {
  return Date.now();
}

/**
 * Parse the Antigravity getApiKey JSON payload `{ token, projectId }`.
 * Falls back to treating the raw string as a bare access token for fixtures.
 * Never returns projectId to callers.
 */
export function parseAntigravityApiKeyPayload(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed) && isNonEmptyString(parsed.token)) {
        return parsed.token.trim();
      }
    } catch {
      // Fall through — fixture providers may return plain tokens.
    }
  }
  return trimmed;
}

/**
 * Merge refresh result with the previous credential so projectId (and other
 * unknown secret fields) are preserved when the refresh response omits them.
 */
export function mergeAntigravityCredential(
  previous: Record<string, unknown>,
  refreshed: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...previous, ...refreshed };

  // Prefer non-empty refreshed fields; restore previous projectId if missing.
  if (!isNonEmptyString(merged.projectId) && isNonEmptyString(previous.projectId)) {
    merged.projectId = previous.projectId;
  }
  if (!isNonEmptyString(merged.refresh) && isNonEmptyString(previous.refresh)) {
    merged.refresh = previous.refresh;
  }
  if (!isNonEmptyString(merged.access) && isNonEmptyString(previous.access)) {
    merged.access = previous.access;
  }
  if (typeof merged.expires !== "number" || !Number.isFinite(merged.expires)) {
    if (typeof previous.expires === "number" && Number.isFinite(previous.expires)) {
      merged.expires = previous.expires;
    }
  }
  // Preserve optional email when refresh omits it.
  if (!isNonEmptyString(merged.email) && isNonEmptyString(previous.email)) {
    merged.email = previous.email;
  }

  return merged;
}

// ─── Refresh logic ───────────────────────────────────────────────────────────

async function refreshAntigravityCredentialUnderLock(
  storageId: string,
  currentCredential: Record<string, unknown>,
  rawStore: Awaited<ReturnType<typeof getWebCredentialStore>>,
): Promise<AntigravityAccessToken> {
  // Validate adapter support
  if (!isSupportedOAuthAccountProvider(ANTIGRAVITY_PROVIDER_ID)) {
    throw new AntigravityTokenError("unavailable", "google-antigravity OAuth account management is not available");
  }

  // Ensure the credential has a refresh token
  const refresh = typeof currentCredential.refresh === "string" ? currentCredential.refresh.trim() : "";
  if (!refresh) {
    throw new AntigravityTokenError("missing_refresh");
  }

  // projectId is required for getApiKey / refreshToken in the package.
  const projectId = typeof currentCredential.projectId === "string" ? currentCredential.projectId.trim() : "";
  if (!projectId) {
    throw new AntigravityTokenError("missing_project");
  }

  let result: { apiKey?: string; newCredentials?: Record<string, unknown> } | null;
  try {
    // Use the public OAuth compatibility helper. It calls the registered
    // google-antigravity OAuth provider's refreshToken(), which requires projectId.
    // The real package only registers on ModelRuntime; Web bridges that public
    // oauth config into pi-ai-oauth-compat during fixed-provider bootstrap.
    const { getOAuthProvider } = await import("./pi-ai-oauth-compat");
    if (!getOAuthProvider(ANTIGRAVITY_PROVIDER_ID)) {
      const { ensureWebProvidersBootstrapped } = await import("./pi-provider-extensions");
      await ensureWebProvidersBootstrapped();
    }
    if (!getOAuthProvider(ANTIGRAVITY_PROVIDER_ID)) {
      // Missing bridge/provider is infrastructure failure, not revoked auth.
      throw new AntigravityTokenError("provider_unavailable");
    }
    // Caller already decided refresh is required. forceRefresh ensures the
    // compatibility helper does not skip remote RT→AT based on local expires.
    result = await getOAuthApiKey(
      ANTIGRAVITY_PROVIDER_ID,
      {
        [ANTIGRAVITY_PROVIDER_ID]: currentCredential as OAuthCredentials,
      },
      { forceRefresh: true },
    );
  } catch (error) {
    if (error instanceof AntigravityTokenError) throw error;
    const mapped = mapAntigravityOAuthError(error);
    throw new AntigravityTokenError(mapped.code, mapped.message);
  }

  if (!result?.apiKey) {
    // getOAuthApiKey returns null for missing provider/refresh adapter as well
    // as empty keys. After the explicit provider check above, treat this as a
    // refresh infrastructure failure rather than a confirmed invalid_grant.
    throw new AntigravityTokenError("refresh_failed", "Antigravity OAuth token refresh returned no API key");
  }

  // Merge so projectId / email / unknown secret fields survive a partial refresh.
  const refreshedRaw = (result.newCredentials ?? {}) as Record<string, unknown>;
  const newCredentialRecord = mergeAntigravityCredential(currentCredential, refreshedRaw);

  // Final projectId guard after merge.
  if (!isNonEmptyString(newCredentialRecord.projectId)) {
    throw new AntigravityTokenError("missing_project");
  }

  const credential = {
    ...newCredentialRecord,
    type: "oauth" as const,
  } as Credential;

  // Slot-first commit: durable managed slot before Active CAS mirror. Mirror
  // failure deliberately leaves the new slot in place for later reconciliation.
  // Map storage/mirror failures to structured unavailable, never reauth.
  try {
    await commitAntigravityCredentialUnderLock({
      rawStore,
      storageId,
      credential,
    });
  } catch (error) {
    if (error instanceof AntigravityTokenError) throw error;
    const mapped = mapAntigravityOAuthError(error);
    throw new AntigravityTokenError(
      mapped.code === "unauthorized" ? "unavailable" : mapped.code,
      mapped.code === "unauthorized" ? SAFE_ERROR_MESSAGES.unavailable : mapped.message,
    );
  }

  const accessToken = parseAntigravityApiKeyPayload(result.apiKey)
    || (typeof newCredentialRecord.access === "string" ? newCredentialRecord.access : "");
  if (!accessToken) {
    throw new AntigravityTokenError("refresh_failed", "Antigravity OAuth token refresh returned no access token");
  }

  const expires = typeof newCredentialRecord.expires === "number"
    ? newCredentialRecord.expires
    : epochNow() + 3600_000;
  return {
    accessToken,
    refreshed: true,
    expiresAt: expires,
  };
}

async function createFlight(
  storageId: string,
  opts: Required<Pick<AntigravityAccessTokenOptions, "minValidityMs" | "forceRefresh">> & Pick<AntigravityAccessTokenOptions, "signal">,
): Promise<AntigravityAccessToken> {
  // Read saved credential outside the lock for the fast path existence check.
  const credPath = credentialFilePath(storageId);
  if (!(await pathExists(credPath))) {
    throw new AntigravityTokenError("account_not_found", `Antigravity saved account not found: ${storageId}`);
  }

  opts.signal?.throwIfAborted();

  return withAntigravityProviderLock(async () => {
    // Re-read under lock so we refresh the latest on-disk credential.
    let lockedRaw: unknown;
    try {
      lockedRaw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        throw new AntigravityTokenError("account_not_found", `Antigravity saved account not found: ${storageId}`);
      }
      throw new AntigravityTokenError("invalid_credential", `Antigravity saved account credential is invalid: ${storageId}`);
    }
    if (!isRecord(lockedRaw)) {
      throw new AntigravityTokenError("invalid_credential", `Antigravity saved account credential is invalid: ${storageId}`);
    }

    const lockedAccess = typeof lockedRaw.access === "string" ? lockedRaw.access.trim() : "";
    const lockedExpires = typeof lockedRaw.expires === "number" ? lockedRaw.expires : 0;
    // forceRefresh must refresh even when the token is still far from expiry.
    // Do not fake this with minValidityMs:0 alone — that only refreshes expired tokens.
    const stillNeedsRefresh =
      opts.forceRefresh || !lockedAccess || epochNow() >= lockedExpires - opts.minValidityMs;

    const rawStore = await getWebCredentialStore();
    if (!stillNeedsRefresh) {
      // A prior mirror write may have failed after the slot-first commit. A
      // normal valid-token read is the safe recovery point: it only repairs
      // this still-Active slot and never consumes another refresh token.
      try {
        await reconcileAntigravityActiveMirrorUnderLock({ rawStore, storageId });
      } catch (error) {
        // Valid AT is still usable even if mirror repair fails. Do not convert
        // local storage/mirror issues into reauth for this request.
        void error;
      }
      return { accessToken: lockedAccess, refreshed: false, expiresAt: lockedExpires };
    }

    opts.signal?.throwIfAborted();
    return refreshAntigravityCredentialUnderLock(storageId, lockedRaw, rawStore);
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve an access token for a specific Antigravity saved account.
 *
 * - Reads the credential file for `storageId`.
 * - If the token is still valid (expires > now + minValidityMs), returns it immediately
 *   after optional Active-mirror reconciliation.
 * - Otherwise, triggers a force-aware single-flight refresh through the registered
 *   Antigravity OAuth provider under the provider-level lock shared with Activate,
 *   atomically persists the updated credential via the shared slot-first transaction,
 *   and mirrors the active credential to auth.json only if this account is still
 *   active at completion (CAS).
 *
 * A forced caller cannot be satisfied by an ordinary flight that merely returned
 * an unexpired token; concurrent forced callers share one forced flight.
 *
 * @throws if the saved account does not exist or refresh fails irrecoverably.
 */
export async function getAntigravityAccessToken(
  storageId: string,
  opts: AntigravityAccessTokenOptions = {},
): Promise<AntigravityAccessToken> {
  const normalizedStorageId = storageId.trim();
  if (!normalizedStorageId) {
    throw new AntigravityTokenError("missing_storage_id");
  }

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
    return existing.promise.then((result) =>
      result.refreshed ? result : getAntigravityAccessToken(normalizedStorageId, options),
    );
  }

  const entry: FlightEntry = {
    forceRefresh: options.forceRefresh,
    storageId: normalizedStorageId,
    promise: Promise.resolve({ accessToken: "", refreshed: false, expiresAt: 0 }),
  };
  entry.promise = createFlight(normalizedStorageId, options).finally(() => {
    // Do not let an older flight erase a newer forced replacement.
    if (inflightRefreshes.get(key) === entry) inflightRefreshes.delete(key);
  });
  inflightRefreshes.set(key, entry);
  return entry.promise;
}

/**
 * Remove a cached in-flight promise for `storageId` without cancelling it.
 * Used after a session is destroyed to prevent stale lookups.
 */
export function invalidateAntigravityTokenFlight(storageId: string): void {
  inflightRefreshes.delete(flightKey(storageId));
}

/**
 * Force the next `getAntigravityAccessToken()` call to refresh, bypassing the
 * cached validity window.  Does not cancel an in-flight refresh.
 */
export function invalidateAntigravityTokenCache(storageId: string): void {
  // No persistent cache outside the credential file itself; the next call
  // will re-read the file and evaluate expiry.  Still prune any leftover
  // flight entry to be safe.
  invalidateAntigravityTokenFlight(storageId);
}
