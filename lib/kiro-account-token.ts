/**
 * kiro-account-token — per-account access token resolver with refresh isolation
 *
 * Provides process-level single-flight refresh keyed by opaque storage id,
 * provider-level locking shared with Activate, atomic credential updates, and
 * active-mirror compare-and-set so a refresh of a non-active account never
 * overwrites the auth.json mirror of the current active account.
 *
 * ## Invariants
 *
 * - One in-flight refresh per storageId at a time (single-flight).
 * - Refresh holds the Kiro provider lock shared with Activate coordination.
 * - Secret writes use tmp + rename for atomicity (0600 file / 0700 dir).
 * - auth.json mirror is only updated when the refreshed account IS the
 *   current active account at the time of completion (lock-held re-read CAS).
 * - No credential material is ever logged or returned to callers other
 *   than the resolved access token.
 * - Builder ID fields (clientId/clientSecret/region) and social fields
 *   (profileArn/authMethod/provider/request) are preserved on disk only.
 * - Never statically resolve `@earendil-works/pi-coding-agent/package.json`
 *   (Turbopack rejects that export subpath and breaks cold Auth routes).
 */

import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Credential, OAuthCredentials } from "@earendil-works/pi-ai";
import { getOAuthApiKey } from "@/lib/pi-ai-oauth-compat";
import { getWebCredentialStore } from "@/lib/web-credential-store";
import { isSupportedOAuthAccountProvider, KIRO_PROVIDER_ID } from "./oauth-account-providers";
import { readOAuthActiveAccountId } from "./oauth-accounts";
import { withKiroProviderLock } from "./kiro-account-lock";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KiroAccessToken {
  accessToken: string;
  /** true when the token was refreshed during this call. */
  refreshed: boolean;
  /** epoch millis when the token expires. */
  expiresAt: number;
}

export interface KiroAccessTokenOptions {
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

function kiroAccountDir(): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, KIRO_PROVIDER_ID);
}

function credentialFilePath(storageId: string): string {
  return join(kiroAccountDir(), `${encodeURIComponent(storageId)}.json`);
}

// ─── In-flight registry (single-flight) ──────────────────────────────────────

type FlightEntry = {
  promise: Promise<KiroAccessToken>;
  storageId: string;
};

const inflightRefreshes = new Map<string, FlightEntry>();

function flightKey(storageId: string): string {
  return `kiro:${storageId}`;
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

function epochNow(): number {
  return Date.now();
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
 * Read the current Active pointer under the provider lock before writing the
 * mirror. The reader is metadata-only and has no reconciliation side effects.
 */
async function readActiveStorageId(): Promise<string | null> {
  try {
    return await readOAuthActiveAccountId(KIRO_PROVIDER_ID);
  } catch {
    return null;
  }
}

/**
 * Update auth.json for kiro only when `storageId` is still the active
 * account. Re-reads active id under the provider lock (CAS), then uses
 * CredentialStore.modify which holds the auth.json file lock.
 */
async function mirrorActiveCredentialIfActive(storageId: string, credential: Record<string, unknown>): Promise<void> {
  try {
    // Lock-held re-read: if Activate flipped Active after our refresh started,
    // skip the mirror so non-active refresh never overwrites auth.json.
    const currentActiveStorageId = await readActiveStorageId();
    if (currentActiveStorageId !== storageId) return;

    // CredentialStore expects type:"oauth". kiro credentials from
    // pi-kiro-provider lack the sentinel but are otherwise compatible.
    const authCredential = (credential as Record<string, unknown>).type
      ? credential
      : { ...credential, type: "oauth" as const };
    const store = await getWebCredentialStore();
    await store.modify(KIRO_PROVIDER_ID, async () => authCredential as Credential);
  } catch {
    // Mirror update is best-effort; never let it break the token resolution.
  }
}

// ─── Refresh logic ───────────────────────────────────────────────────────────

async function refreshKiroCredential(
  storageId: string,
  currentCredential: Record<string, unknown>,
): Promise<KiroAccessToken> {
  // Validate adapter support
  if (!isSupportedOAuthAccountProvider(KIRO_PROVIDER_ID)) {
    throw new Error(`kiro OAuth account management is not available`);
  }

  // Ensure the credential has a refresh token
  const refresh = typeof currentCredential.refresh === "string" ? currentCredential.refresh.trim() : "";
  if (!refresh) {
    throw new Error("Kiro OAuth access token expired and no refresh token is available. Please re-authenticate.");
  }

  // Use the public OAuth compatibility helper. It calls the registered kiro
  // OAuth provider's refreshToken(), which preserves Builder ID / social metadata.
  const { getOAuthProvider } = await import("./pi-ai-oauth-compat");
  if (!getOAuthProvider(KIRO_PROVIDER_ID)) {
    const { ensureWebProvidersBootstrapped } = await import("./pi-provider-extensions");
    await ensureWebProvidersBootstrapped();
  }
  const result = await getOAuthApiKey(KIRO_PROVIDER_ID, {
    [KIRO_PROVIDER_ID]: currentCredential as OAuthCredentials,
  });

  if (!result?.apiKey) {
    throw new Error("Kiro OAuth token refresh returned no API key");
  }

  // Persist the refreshed credential atomically, preserving any upstream fields
  // that the refresh response re-emitted (clientSecret, profileArn, etc.).
  const newCredential = result.newCredentials ?? currentCredential;
  await atomicWriteJson(kiroAccountDir(), `${encodeURIComponent(storageId)}.json`, newCredential);

  // Mirror to auth.json only if still the active account (CAS under provider lock).
  await mirrorActiveCredentialIfActive(storageId, newCredential as Record<string, unknown>);

  const expires = typeof newCredential.expires === "number" ? newCredential.expires : epochNow() + 3600_000;
  return {
    accessToken: result.apiKey,
    refreshed: true,
    expiresAt: expires,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve an access token for a specific Kiro saved account.
 *
 * - Reads the credential file for `storageId`.
 * - If the token is still valid (expires > now + minValidityMs), returns it immediately.
 * - Otherwise, triggers a single-flight refresh through the registered Kiro
 *   OAuth provider under the provider-level lock shared with Activate,
 *   atomically persists the updated credential (0600), and mirrors the active
 *   credential to auth.json only if this account is still active at completion (CAS).
 *
 * @throws if the saved account does not exist or refresh fails irrecoverably.
 */
export async function getKiroAccessToken(
  storageId: string,
  opts: KiroAccessTokenOptions = {},
): Promise<KiroAccessToken> {
  const { minValidityMs = 120_000, forceRefresh = false, signal } = opts;

  if (!storageId.trim()) {
    throw new Error("kiroAccountStorageId is required");
  }

  const key = flightKey(storageId);

  // Reuse in-flight refresh
  const inflight = inflightRefreshes.get(key);
  if (inflight) return inflight.promise;

  const promise = (async (): Promise<KiroAccessToken> => {
    try {
      // Read saved credential
      const credPath = credentialFilePath(storageId);
      if (!(await pathExists(credPath))) {
        throw new Error(`Kiro saved account not found: ${storageId}`);
      }

      const raw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
      if (!isRecord(raw)) {
        throw new Error(`Kiro saved account credential is invalid: ${storageId}`);
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
      return await withKiroProviderLock(async () => {
        // Re-read under lock so we refresh the latest on-disk credential.
        const lockedRaw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
        if (!isRecord(lockedRaw)) {
          throw new Error(`Kiro saved account credential is invalid: ${storageId}`);
        }
        const lockedAccess = typeof lockedRaw.access === "string" ? lockedRaw.access.trim() : "";
        const lockedExpires = typeof lockedRaw.expires === "number" ? lockedRaw.expires : 0;
        const stillNeedsRefresh =
          forceRefresh || !lockedAccess || epochNow() >= lockedExpires - minValidityMs;
        if (!stillNeedsRefresh) {
          return { accessToken: lockedAccess, refreshed: false, expiresAt: lockedExpires };
        }
        return await refreshKiroCredential(storageId, lockedRaw);
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
export function invalidateKiroTokenFlight(storageId: string): void {
  inflightRefreshes.delete(flightKey(storageId));
}

/**
 * Force the next `getKiroAccessToken()` call to refresh, bypassing the
 * cached validity window.  Does not cancel an in-flight refresh.
 */
export function invalidateKiroTokenCache(storageId: string): void {
  // No persistent cache outside the credential file itself; the next call
  // will re-read the file and evaluate expiry.  Still prune any leftover
  // flight entry to be safe.
  invalidateKiroTokenFlight(storageId);
}
