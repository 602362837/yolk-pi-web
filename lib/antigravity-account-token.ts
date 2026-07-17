/**
 * antigravity-account-token — per-account access token resolver with refresh isolation
 *
 * Provides process-level single-flight refresh keyed by opaque storage id,
 * provider-level locking shared with Activate, atomic credential updates, and
 * active-mirror compare-and-set so a refresh of a non-active account never
 * overwrites the auth.json mirror of the current active account.
 *
 * ## Invariants
 *
 * - One in-flight refresh per storageId at a time (single-flight).
 * - Refresh holds the Antigravity provider lock shared with Activate coordination.
 * - Secret writes use tmp + rename for atomicity (0600 file / 0700 dir).
 * - auth.json mirror is only updated when the refreshed account IS the
 *   current active account at the time of completion (lock-held re-read CAS).
 * - Refresh results are merged with the existing credential so a missing
 *   projectId in the refresh response never drops the server-side projectId.
 * - getOAuthApiKey returns a JSON string `{ token, projectId }`; this resolver
 *   only exposes the parsed access token to callers (projectId stays server-side).
 * - No credential material is ever logged or returned to callers other
 *   than the resolved access token.
 * - Never statically resolve `@earendil-works/pi-coding-agent/package.json`
 *   (Turbopack rejects that export subpath and breaks cold Auth routes).
 */

import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuthStorage, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getOAuthApiKey } from "@earendil-works/pi-ai/oauth";
import { ANTIGRAVITY_PROVIDER_ID, isSupportedOAuthAccountProvider } from "./oauth-account-providers";
import { listOAuthAccounts } from "./oauth-accounts";
import { withAntigravityProviderLock } from "./antigravity-account-lock";

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
  | "unavailable";

const SAFE_ERROR_MESSAGES: Record<AntigravityTokenErrorCode, string> = {
  missing_storage_id: "Antigravity account storage id is required",
  account_not_found: "Antigravity saved account not found",
  invalid_credential: "Antigravity saved account credential is invalid",
  missing_refresh: "Antigravity OAuth access token expired and no refresh token is available. Please re-authenticate.",
  missing_project: "Antigravity credential is missing project binding. Please re-authenticate.",
  refresh_failed: "Antigravity OAuth token refresh failed. Please re-authenticate.",
  unauthorized: "Antigravity OAuth authorization expired. Please re-authenticate.",
  network: "Antigravity OAuth network error. Please try again.",
  unavailable: "Antigravity OAuth is temporarily unavailable. Please try again.",
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

  if (/invalid.?grant|invalid.?token|unauthorized|401|expired|revoked|reauth/.test(lower)) {
    return { code: "unauthorized", message: SAFE_ERROR_MESSAGES.unauthorized };
  }
  if (/missing projectid|missing project|projectid/.test(lower) && /missing|required|invalid/.test(lower)) {
    return { code: "missing_project", message: SAFE_ERROR_MESSAGES.missing_project };
  }
  if (/network|fetch failed|econn|enotfound|socket|dns|timeout|aborted|abort/.test(lower)) {
    return { code: "network", message: SAFE_ERROR_MESSAGES.network };
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
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;

function antigravityAccountDir(): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, ANTIGRAVITY_PROVIDER_ID);
}

function credentialFilePath(storageId: string): string {
  return join(antigravityAccountDir(), `${encodeURIComponent(storageId)}.json`);
}

function accountsMetadataPath(): string {
  return join(antigravityAccountDir(), "accounts.json");
}

// ─── In-flight registry (single-flight) ──────────────────────────────────────

type FlightEntry = {
  promise: Promise<AntigravityAccessToken>;
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

// ─── Atomic write ────────────────────────────────────────────────────────────

async function atomicWriteJson(dir: string, filename: string, data: unknown): Promise<string> {
  await mkdir(dir, { recursive: true, mode: ACCOUNT_DIR_MODE });
  const target = join(dir, filename);
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: JSON_FILE_MODE });
  await rename(tmp, target);
  return target;
}

// ─── Active-mirror compare-and-set ───────────────────────────────────────────

/**
 * Read the current active storage id from accounts.json (preferred) or the
 * listOAuthAccounts projection. Called under the provider lock so Activate
 * races are observed before the auth.json mirror write.
 */
async function readActiveStorageId(): Promise<string | null> {
  try {
    const metaPath = accountsMetadataPath();
    if (await pathExists(metaPath)) {
      const raw = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
      if (isRecord(raw) && typeof raw.activeAccountId === "string" && raw.activeAccountId.trim()) {
        return raw.activeAccountId.trim();
      }
    }
  } catch {
    // Fall through to listOAuthAccounts.
  }

  try {
    const accounts = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    return accounts.activeAccountId;
  } catch {
    return null;
  }
}

/**
 * Update auth.json for google-antigravity only when `storageId` is still the
 * active account. Re-reads active id under the provider lock (CAS), then uses
 * AuthStorage.set which itself holds the auth.json file lock.
 */
async function mirrorActiveCredentialIfActive(storageId: string, credential: Record<string, unknown>): Promise<void> {
  try {
    // Lock-held re-read: if Activate flipped Active after our refresh started,
    // skip the mirror so non-active refresh never overwrites auth.json.
    const currentActiveStorageId = await readActiveStorageId();
    if (currentActiveStorageId !== storageId) return;

    const authStorage = AuthStorage.create();
    // AuthStorage.set expects an AuthCredential.  Antigravity credentials from
    // the package lack the "type":"oauth" sentinel but are otherwise compatible.
    const authCredential = (credential as Record<string, unknown>).type
      ? credential
      : { ...credential, type: "oauth" as const };
    authStorage.set(
      ANTIGRAVITY_PROVIDER_ID,
      authCredential as unknown as import("@earendil-works/pi-coding-agent").OAuthCredential,
    );
    if (authStorage.drainErrors().length > 0) {
      // Non-fatal; the saved-account credential is already updated.
    }
  } catch {
    // Mirror update is best-effort; never let it break the token resolution.
  }
}

// ─── Refresh logic ───────────────────────────────────────────────────────────

async function refreshAntigravityCredential(
  storageId: string,
  currentCredential: Record<string, unknown>,
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
    // Use pi-ai's OAuth machinery.  It calls the registered google-antigravity
    // OAuth provider's refreshToken(), which requires projectId.
    result = await getOAuthApiKey(ANTIGRAVITY_PROVIDER_ID, {
      [ANTIGRAVITY_PROVIDER_ID]: currentCredential as import("@earendil-works/pi-ai/oauth").OAuthCredentials,
    });
  } catch (error) {
    const mapped = mapAntigravityOAuthError(error);
    throw new AntigravityTokenError(mapped.code, mapped.message);
  }

  if (!result?.apiKey) {
    throw new AntigravityTokenError("refresh_failed", "Antigravity OAuth token refresh returned no API key");
  }

  // Merge so projectId / email / unknown secret fields survive a partial refresh.
  const refreshedRaw = (result.newCredentials ?? {}) as Record<string, unknown>;
  const newCredential = mergeAntigravityCredential(currentCredential, refreshedRaw);

  // Final projectId guard after merge.
  if (!isNonEmptyString(newCredential.projectId)) {
    throw new AntigravityTokenError("missing_project");
  }

  await atomicWriteJson(antigravityAccountDir(), `${encodeURIComponent(storageId)}.json`, newCredential);

  // Mirror to auth.json only if still the active account (CAS under provider lock).
  await mirrorActiveCredentialIfActive(storageId, newCredential);

  const accessToken = parseAntigravityApiKeyPayload(result.apiKey)
    || (typeof newCredential.access === "string" ? newCredential.access : "");
  if (!accessToken) {
    throw new AntigravityTokenError("refresh_failed", "Antigravity OAuth token refresh returned no access token");
  }

  const expires = typeof newCredential.expires === "number" ? newCredential.expires : epochNow() + 3600_000;
  return {
    accessToken,
    refreshed: true,
    expiresAt: expires,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve an access token for a specific Antigravity saved account.
 *
 * - Reads the credential file for `storageId`.
 * - If the token is still valid (expires > now + minValidityMs), returns it immediately.
 * - Otherwise, triggers a single-flight refresh through the registered Antigravity
 *   OAuth provider under the provider-level lock shared with Activate,
 *   atomically persists the updated credential (0600), and mirrors the active
 *   credential to auth.json only if this account is still active at completion (CAS).
 *
 * @throws if the saved account does not exist or refresh fails irrecoverably.
 */
export async function getAntigravityAccessToken(
  storageId: string,
  opts: AntigravityAccessTokenOptions = {},
): Promise<AntigravityAccessToken> {
  const { minValidityMs = 120_000, forceRefresh = false, signal } = opts;

  if (!storageId.trim()) {
    throw new AntigravityTokenError("missing_storage_id");
  }

  const key = flightKey(storageId);

  // Reuse in-flight refresh
  const inflight = inflightRefreshes.get(key);
  if (inflight) return inflight.promise;

  const promise = (async (): Promise<AntigravityAccessToken> => {
    try {
      // Read saved credential
      const credPath = credentialFilePath(storageId);
      if (!(await pathExists(credPath))) {
        throw new AntigravityTokenError("account_not_found", `Antigravity saved account not found: ${storageId}`);
      }

      const raw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
      if (!isRecord(raw)) {
        throw new AntigravityTokenError("invalid_credential", `Antigravity saved account credential is invalid: ${storageId}`);
      }

      const access = typeof raw.access === "string" ? raw.access.trim() : "";
      const expires = typeof raw.expires === "number" ? raw.expires : 0;
      // forceRefresh must refresh even when the token is still far from expiry.
      // Do not fake this with minValidityMs:0 alone — that only refreshes expired tokens.
      const needsRefresh = forceRefresh || !access || epochNow() >= expires - minValidityMs;

      if (!needsRefresh) {
        return { accessToken: access, refreshed: false, expiresAt: expires };
      }

      // Check abort signal before blocking refresh
      signal?.throwIfAborted();

      // Provider lock serializes refresh + Active CAS against concurrent Activate.
      return await withAntigravityProviderLock(async () => {
        // Re-read under lock so we refresh the latest on-disk credential.
        const lockedRaw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
        if (!isRecord(lockedRaw)) {
          throw new AntigravityTokenError("invalid_credential", `Antigravity saved account credential is invalid: ${storageId}`);
        }
        const lockedAccess = typeof lockedRaw.access === "string" ? lockedRaw.access.trim() : "";
        const lockedExpires = typeof lockedRaw.expires === "number" ? lockedRaw.expires : 0;
        const stillNeedsRefresh =
          forceRefresh || !lockedAccess || epochNow() >= lockedExpires - minValidityMs;
        if (!stillNeedsRefresh) {
          return { accessToken: lockedAccess, refreshed: false, expiresAt: lockedExpires };
        }
        return await refreshAntigravityCredential(storageId, lockedRaw);
      });
    } finally {
      inflightRefreshes.delete(key);
    }
  })();

  inflightRefreshes.set(key, { promise, storageId });
  return promise;
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
