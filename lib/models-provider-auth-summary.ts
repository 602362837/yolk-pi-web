import { createHash, randomBytes } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  isSupportedOAuthAccountProvider,
  listOAuthAccounts,
} from "@/lib/oauth-accounts";

const VERIFY_CACHE_TTL_MS = 15_000;
const VERIFY_DEADLINE_MS = 8_000;
const VERIFY_RETENTION_MS = 30_000;
let processSalt = randomBytes(32).toString("base64url");
const providerEpochs = new Map<string, number>();

type ProviderStatus = { configured?: boolean; source?: string };
type SummaryRuntime = {
  getProviderAuthStatus(providerId: string): ProviderStatus;
  checkAuth(providerId: string): Promise<unknown>;
};
type ProviderInput = {
  id: string;
  name?: string;
  auth?: { oauth?: unknown };
};

export type ProviderVerificationState = "valid" | "invalid" | "timeout" | "error" | "superseded";

export interface LocalOAuthProviderSummary {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  localConfigured: boolean;
  localStateRevision: string;
  statusBasis: "local";
  authMode?: "managed_accounts";
  accountCount?: number;
  activeAccountDisplayName?: string | null;
}

export interface ProviderVerification {
  state: ProviderVerificationState;
  basedOnRevision: string;
  checkedAt: string;
}

const cache = new Map<string, { value: ProviderVerification; expiresAt: number }>();
type Flight = {
  providerId: string;
  finish: (value: ProviderVerification) => void;
  publishable: boolean;
  publicResult: Promise<ProviderVerification>;
};
const flights = new Map<string, Flight>();

const AUTHORITY_FINGERPRINT_MAX_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function addAuthorityFileFingerprint(hash: ReturnType<typeof createHash>, label: string, path: string): Promise<void> {
  try {
    const info = await lstat(path);
    hash.update(`\u0000${label}\u0000${info.size}\u0000${info.mtimeMs}\u0000${info.ctimeMs}\u0000${info.ino}`);
    // Account-store authority files are small JSON documents. Bound the local
    // content read so malformed external files cannot turn a summary request
    // into unbounded I/O; stat data still invalidates the revision in that case.
    if (!info.isFile() || info.size > AUTHORITY_FINGERPRINT_MAX_BYTES) return;
    hash.update("\u0000").update(createHash("sha256").update(await readFile(path)).digest());
  } catch {
    hash.update(`\u0000${label}\u0000missing-or-unreadable`);
  }
}

/**
 * Server-only local authority fingerprint. It combines stat and content
 * digests for the canonical provider entry and managed-account metadata/slots.
 * The digest is never sent to the client; it is mixed into a process-salted
 * revision token below.
 */
export async function getOAuthProviderAuthorityFingerprint(
  providerId: string,
  agentDir = getAgentDir(),
): Promise<string> {
  const hash = createHash("sha256").update("models-provider-authority-v1\u0000").update(providerId);
  const authPath = join(agentDir, "auth.json");
  try {
    const raw = await readFile(authPath);
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    hash.update("\u0000auth-provider\u0000").update(createHash("sha256").update(
      JSON.stringify(isRecord(parsed) ? parsed[providerId] ?? null : null),
    ).digest());
  } catch {
    // Include file stat as a non-sensitive change signal even when JSON is
    // concurrently being atomically replaced or is malformed.
    await addAuthorityFileFingerprint(hash, "auth-provider-fallback", authPath);
  }

  const accountDir = join(agentDir, "auth-accounts", providerId);
  try {
    const entries = await readdir(accountDir, { withFileTypes: true });
    for (const entry of entries
      .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await addAuthorityFileFingerprint(hash, `account:${entry.name}`, join(accountDir, entry.name));
    }
  } catch {
    hash.update("\u0000account-directory-missing-or-unreadable");
  }
  return hash.digest("base64url");
}

function revisionFor(providerId: string, state: unknown): string {
  const epoch = providerEpochs.get(providerId) ?? 0;
  // The hash is process-salted so the browser cannot correlate this value to
  // account metadata or filesystem state across process lifetimes.
  return createHash("sha256")
    .update(processSalt)
    .update("\0")
    .update(providerId)
    .update("\0")
    .update(String(epoch))
    .update("\0")
    .update(JSON.stringify(state))
    .digest("base64url");
}

/** Metadata-only projection: never bootstraps, refreshes, or calls checkAuth. */
export async function projectLocalOAuthProviderSummary(
  runtime: SummaryRuntime,
  provider: ProviderInput,
  options?: { agentDir?: string },
): Promise<LocalOAuthProviderSummary> {
  const status = runtime.getProviderAuthStatus(provider.id);
  let accountCount = 0;
  let activeAccountDisplayName: string | null = null;
  const managed = isSupportedOAuthAccountProvider(provider.id);
  if (managed) {
    try {
      const accounts = await listOAuthAccounts(provider.id);
      accountCount = accounts.accounts.length;
      activeAccountDisplayName = accounts.accounts.find((account) => account.active)?.displayName ?? null;
    } catch {
      // A missing/corrupt optional account store must not make the catalog leak
      // internals or fail every unrelated provider.
    }
  }
  // Only the persistent CredentialStore or managed account metadata proves a
  // locally configured OAuth provider. A models.json API key must remain in
  // the raw provider editor rather than creating a duplicate OAuth row.
  const localConfigured = (status.configured === true && status.source === "stored") || accountCount > 0;
  const safeState = {
    configured: localConfigured,
    statusSource: status.source === "stored" ? "stored" : "other",
    accountCount,
    activeAccountDisplayName,
    // Reading local authority files does not validate/refresh credentials and
    // is intentionally part of summary state: direct external token rotation
    // must make an old verify result unmergeable even if safe metadata matches.
    authorityFingerprint: await getOAuthProviderAuthorityFingerprint(provider.id, options?.agentDir),
  };
  return {
    id: provider.id,
    name: provider.name ?? provider.id,
    usesCallbackServer: (provider.auth?.oauth as { usesCallbackServer?: boolean } | undefined)?.usesCallbackServer ?? false,
    loggedIn: localConfigured,
    localConfigured,
    localStateRevision: revisionFor(provider.id, safeState),
    statusBasis: "local",
    ...(managed ? { authMode: "managed_accounts" as const, accountCount, activeAccountDisplayName } : {}),
  };
}

function verificationKey(runtimeKey: string, providerId: string, revision: string): string {
  return `${runtimeKey}\u0000${providerId}\u0000${revision}`;
}

function verification(state: ProviderVerificationState, revision: string): ProviderVerification {
  return { state, basedOnRevision: revision, checkedAt: new Date().toISOString() };
}

/**
 * Check one provider at most once per runtime/provider/local revision. A caller
 * disconnect never owns this flight. Deadline resolves the public result but
 * intentionally cannot cancel third-party credential refresh work.
 */
export function verifyProviderAuth(
  runtimeKey: string,
  runtime: SummaryRuntime,
  providerId: string,
  localStateRevision: string,
): Promise<ProviderVerification> {
  const key = verificationKey(runtimeKey, providerId, localStateRevision);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (cached) cache.delete(key);
  const existing = flights.get(key);
  if (existing) return existing.publicResult;

  let resolvePublic!: (value: ProviderVerification) => void;
  const publicResult = new Promise<ProviderVerification>((resolve) => { resolvePublic = resolve; });
  let done = false;
  const flight: Flight = {
    providerId,
    publishable: true,
    publicResult,
    finish(value) {
      if (done) return;
      done = true;
      resolvePublic(value);
    },
  };
  flights.set(key, flight);

  const deadline = setTimeout(() => {
    flight.publishable = false;
    flight.finish(verification("timeout", localStateRevision));
  }, VERIFY_DEADLINE_MS);
  let authCheck: Promise<unknown>;
  try {
    authCheck = runtime.checkAuth(providerId);
  } catch {
    authCheck = Promise.reject(new Error("checkAuth failed"));
  }
  void authCheck.then(
    (result) => {
      if (flight.publishable) {
        const value = verification(result ? "valid" : "invalid", localStateRevision);
        cache.set(key, { value, expiresAt: Date.now() + VERIFY_CACHE_TTL_MS });
        flight.finish(value);
      }
    },
    () => {
      if (flight.publishable) flight.finish(verification("error", localStateRevision));
    },
  ).finally(() => {
    clearTimeout(deadline);
    // A timed-out owner remains as a non-publishable tombstone until the
    // retention timer fires. Otherwise a late settlement just after the
    // deadline would delete the flight and allow a second real checkAuth.
    if (flight.publishable && flights.get(key) === flight) flights.delete(key);
  });
  // A permanently hung third-party check must not retain the dedupe tombstone
  // forever. Its late completion remains non-publishable after this cleanup.
  setTimeout(() => {
    if (flights.get(key) === flight) flights.delete(key);
  }, VERIFY_RETENTION_MS).unref?.();
  return publicResult;
}

/** Call only after a successful OAuth/account mutation has been persisted. */
export function invalidateProviderVerification(providerId: string): void {
  providerEpochs.set(providerId, (providerEpochs.get(providerId) ?? 0) + 1);
  for (const key of cache.keys()) {
    if (key.split("\u0000", 3)[1] === providerId) cache.delete(key);
  }
  for (const [key, flight] of flights) {
    if (flight.providerId !== providerId) continue;
    flight.publishable = false;
    flight.finish(verification("superseded", key.split("\u0000", 3)[2] ?? ""));
  }
}

export function __resetModelsProviderAuthSummaryForTests(): void {
  cache.clear();
  for (const [key, flight] of flights) {
    flight.publishable = false;
    flight.finish(verification("superseded", key.split("\u0000", 3)[2] ?? ""));
  }
  flights.clear();
  providerEpochs.clear();
  processSalt = randomBytes(32).toString("base64url");
}

export const modelsProviderAuthSummaryConstants = {
  verifyCacheTtlMs: VERIFY_CACHE_TTL_MS,
  verifyDeadlineMs: VERIFY_DEADLINE_MS,
  verifyRetentionMs: VERIFY_RETENTION_MS,
  authorityFingerprintMaxBytes: AUTHORITY_FINGERPRINT_MAX_BYTES,
};
