/**
 * Grok saved-account access-token resolver.
 *
 * Managed refreshes share the Grok provider critical section and the same
 * slot-first transaction as ModelRuntime's coordinated Active credential store.
 * The managed slot is authoritative; auth.json is only mirrored after its
 * durable commit and only while the slot remains Active.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function epochNow(): number {
  return Date.now();
}

async function readCredential(storageId: string): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(credentialFilePath(storageId), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error(`Grok saved account not found: ${storageId}`);
    }
    throw new Error(`Grok saved account credential is invalid: ${storageId}`);
  }
  if (!isRecord(raw)) throw new Error(`Grok saved account credential is invalid: ${storageId}`);
  return raw;
}

async function refreshGrokCredentialUnderLock(
  storageId: string,
  currentCredential: Record<string, unknown>,
  rawStore: Awaited<ReturnType<typeof getWebCredentialStore>>,
): Promise<GrokAccessToken> {
  if (!isSupportedOAuthAccountProvider(GROK_CLI_PROVIDER_ID)) {
    throw new Error("grok-cli OAuth account management is not available");
  }

  const refresh = typeof currentCredential.refresh === "string" ? currentCredential.refresh.trim() : "";
  if (!refresh) {
    throw new Error("Grok OAuth access token expired and no refresh token is available. Please re-authenticate.");
  }

  const { getOAuthProvider } = await import("./pi-ai-oauth-compat");
  if (!getOAuthProvider(GROK_CLI_PROVIDER_ID)) {
    const { ensureWebProvidersBootstrapped } = await import("./pi-provider-extensions");
    await ensureWebProvidersBootstrapped();
  }
  const result = await getOAuthApiKey(
    GROK_CLI_PROVIDER_ID,
    { [GROK_CLI_PROVIDER_ID]: currentCredential as import("@earendil-works/pi-ai").OAuthCredentials },
    // The caller already performed the lock-time expiry/force decision. This
    // compatibility path must therefore perform the actual remote refresh,
    // including for the min-validity window before local expiry.
    { forceRefresh: true },
  );
  if (!result?.apiKey) throw new Error("Grok OAuth token refresh returned no API key");

  const nextCredential = result.newCredentials ?? currentCredential;
  const credential = {
    ...nextCredential,
    type: "oauth" as const,
  } as Credential;

  // The transaction writes the slot first, then only mirrors auth.json if this
  // storage id is still Active. It deliberately leaves the new slot durable if
  // the mirror fails rather than restoring a consumed rotating refresh token.
  await commitGrokCredentialUnderLock({ rawStore, storageId, credential });

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
      await reconcileGrokActiveMirrorUnderLock({ rawStore, storageId });
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
  if (!normalizedStorageId) throw new Error("grokAccountStorageId is required");

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
