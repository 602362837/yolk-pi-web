/**
 * grok-account-token — per-account access token resolver with refresh isolation
 *
 * Provides process-level single-flight refresh keyed by opaque storage id,
 * file-level locking for cross-process safety, atomic credential updates,
 * and active-mirror compare-and-set so a refresh of a non-active account
 * never overwrites the auth.json mirror of the current active account.
 *
 * ## Invariants
 *
 * - One in-flight refresh per storageId at a time (single-flight).
 * - Secret writes use tmp + rename for atomicity.
 * - auth.json mirror is only updated when the refreshed account IS the
 *   current active account at the time of completion.
 * - No credential material is ever logged or returned to callers other
 *   than the resolved access token.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Credential } from "@earendil-works/pi-ai";
import { getOAuthApiKey } from "@/lib/pi-ai-oauth-compat";
import { GROK_CLI_PROVIDER_ID, isSupportedOAuthAccountProvider } from "./oauth-account-providers";
import { listOAuthAccounts } from "./oauth-accounts";
import { getWebCredentialStore } from "./web-credential-store";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  /** When true, always refresh even if the token is still within minValidityMs. */
  forceRefresh?: boolean;
  /** AbortSignal to cancel a long-running refresh. */
  signal?: AbortSignal;
}

// ─── File path helpers ───────────────────────────────────────────────────────

const ACCOUNT_STORE_DIR = "auth-accounts";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;

function grokAccountDir(): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, GROK_CLI_PROVIDER_ID);
}

function credentialFilePath(storageId: string): string {
  return join(grokAccountDir(), `${encodeURIComponent(storageId)}.json`);
}

// ─── In-flight registry (single-flight) ──────────────────────────────────────

type FlightEntry = {
  promise: Promise<GrokAccessToken>;
  storageId: string;
};

const inflightRefreshes = new Map<string, FlightEntry>();

function flightKey(storageId: string): string {
  return `grok-cli:${storageId}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
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
 * Update auth.json for grok-cli only when `storageId` is still the active
 * account, using a compare-and-set re-read before CredentialStore.modify.
 */
async function mirrorActiveCredentialIfActive(storageId: string, credential: Record<string, unknown>): Promise<void> {
  try {
    // Determine the current active storage id from the accounts list
    let currentActiveStorageId: string | null = null;
    try {
      const accounts = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
      currentActiveStorageId = accounts.activeAccountId;
    } catch {
      // If we can't read the account list, skip the mirror update.
      return;
    }

    // Only mirror if the refreshed account is still the active one.
    if (currentActiveStorageId !== storageId) return;

    // CredentialStore expects type:"oauth". grok-cli credentials from
    // pi-grok-cli lack the sentinel but are otherwise compatible.
    const authCredential = (credential as Record<string, unknown>).type
      ? credential
      : { ...credential, type: "oauth" as const };
    const store = await getWebCredentialStore();
    await store.modify(GROK_CLI_PROVIDER_ID, async () => authCredential as Credential);
  } catch {
    // Mirror update is best-effort; never let it break the token resolution.
  }
}

// ─── Refresh logic ───────────────────────────────────────────────────────────

async function refreshGrokCredential(
  storageId: string,
  currentCredential: Record<string, unknown>,
): Promise<GrokAccessToken> {
  // Validate adapter support
  if (!isSupportedOAuthAccountProvider(GROK_CLI_PROVIDER_ID)) {
    throw new Error(`grok-cli OAuth account management is not available`);
  }

  // Ensure the credential has a refresh token
  const refresh = typeof currentCredential.refresh === "string" ? currentCredential.refresh.trim() : "";
  if (!refresh) {
    throw new Error("Grok OAuth access token expired and no refresh token is available. Please re-authenticate.");
  }

  // Use the public OAuth compatibility helper. It calls the registered grok-cli
  // OAuth provider's refreshToken(), which performs the actual xAI token refresh.
  // ensureWebProvidersBootstrapped must have run so the provider table is populated.
  // Only cold-load fixed providers when the process-global OAuth table lacks this
  // provider — tests may register a mock first and must not be overwritten.
  const { getOAuthProvider } = await import("./pi-ai-oauth-compat");
  if (!getOAuthProvider(GROK_CLI_PROVIDER_ID)) {
    const { ensureWebProvidersBootstrapped } = await import("./pi-provider-extensions");
    await ensureWebProvidersBootstrapped();
  }
  const result = await getOAuthApiKey(GROK_CLI_PROVIDER_ID, {
    [GROK_CLI_PROVIDER_ID]: currentCredential as import("@earendil-works/pi-ai").OAuthCredentials,
  });

  if (!result?.apiKey) {
    throw new Error("Grok OAuth token refresh returned no API key");
  }

  // Persist the refreshed credential atomically
  const newCredential = result.newCredentials ?? currentCredential;
  await atomicWriteJson(grokAccountDir(), `${encodeURIComponent(storageId)}.json`, newCredential);

  // Mirror to auth.json if still the active account
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
 * Resolve an access token for a specific Grok saved account.
 *
 * - Reads the credential file for `storageId`.
 * - If the token is still valid (expires > now + minValidityMs), returns it immediately.
 * - Otherwise, triggers a single-flight refresh through the registered Grok
 *   OAuth provider, atomically persists the updated credential, and mirrors
 *   the active credential to auth.json only if this account is still active.
 *
 * @throws if the saved account does not exist or refresh fails irrecoverably.
 */
export async function getGrokAccessToken(
  storageId: string,
  opts: GrokAccessTokenOptions = {},
): Promise<GrokAccessToken> {
  const { minValidityMs = 120_000, forceRefresh = false, signal } = opts;

  if (!storageId.trim()) {
    throw new Error("grokAccountStorageId is required");
  }

  const key = flightKey(storageId);

  // Reuse in-flight refresh
  const inflight = inflightRefreshes.get(key);
  if (inflight) return inflight.promise;

  const promise = (async (): Promise<GrokAccessToken> => {
    try {
      // Read saved credential
      const credPath = credentialFilePath(storageId);
      if (!(await pathExists(credPath))) {
        throw new Error(`Grok saved account not found: ${storageId}`);
      }

      const raw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
      if (!isRecord(raw)) {
        throw new Error(`Grok saved account credential is invalid: ${storageId}`);
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

      return await refreshGrokCredential(storageId, raw);
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
export function invalidateGrokTokenFlight(storageId: string): void {
  inflightRefreshes.delete(flightKey(storageId));
}

/**
 * Force the next `getGrokAccessToken()` call to refresh, bypassing the
 * cached validity window.  Does not cancel an in-flight refresh.
 */
export function invalidateGrokTokenCache(storageId: string): void {
  // No persistent cache outside the credential file itself; the next call
  // will re-read the file and evaluate expiry.  Still prune any leftover
  // flight entry to be safe.
  invalidateGrokTokenFlight(storageId);
}
