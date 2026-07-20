/**
 * links-store — secure OAuth connection metadata and secret storage
 *
 * ## Storage layout
 *
 *   ~/.pi/agent/links/
 *     registry.json              — metadata for all connections (connected + disconnected)
 *     .locks/
 *       registry.lock/           — cross-process mkdir lock for the registry
 *     github/
 *       <connection-id>.json     — OAuth secret (GitHubOAuthSecretV1)
 *       .quarantine-<random>.json — quarantined secret during disconnect rollback
 *
 * ## Security
 *
 * - Directories 0700, files 0600.
 * - Atomic writes: tmp file → fsync → rename (same-directory).
 * - Provider-keyed process queue + cross-process mkdir lock.
 * - Registry is metadata-only — no device_code, access token, or raw upstream data.
 * - device_code never reaches disk.
 * - Duplicate detection by provider + providerUserId under lock.
 * - Disconnect: quarantine → registry update → final unlink (restore on failure).
 *
 * ## Isolation
 *
 * This module does NOT import:
 * - auth.json / auth-accounts / auth-api-key-accounts
 * - CredentialStore / ModelRuntime / RPC auth reload
 * - oauth-accounts.ts / oauth-account-providers.ts
 * - pi-web.json settings
 */

import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  LinkProviderId,
  LinkConnectionMetadata,
  LinkConnectionStatus,
  GitHubOAuthSecretV1,
  OAuthCredentialResult,
  ValidatedLinkIdentity,
  LinkAuthorizationErrorCode,
} from "./links-types";
import {
  ALLOWLISTED_LINK_PROVIDERS,
  LINKS_P0_REQUESTED_SCOPES,
  isValidOpaqueId,
} from "./links-types";

// ─── Constants ────────────────────────────────────────────────────────────────

const LINKS_DIR_MODE = 0o700;
const LINKS_FILE_MODE = 0o600;
const LOCK_DIR_MODE = 0o700;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

const LINKS_SUBDIR = "links";
const REGISTRY_FILE = "registry.json";
const LOCKS_SUBDIR = ".locks";
const REGISTRY_LOCK_DIR = "registry.lock";
const QUARANTINE_PREFIX = ".quarantine-";

// ─── Registry types ───────────────────────────────────────────────────────────

interface LinksRegistryV1 {
  schemaVersion: 1;
  /** Map of connection id → metadata. */
  connections: Record<string, LinkConnectionMetadata>;
}

// ─── In-memory coordination ───────────────────────────────────────────────────

/** Process-local serialization queue keyed by canonical registry path. */
const processQueues = new Map<string, Promise<unknown>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function jitteredRetryMs(): number {
  return (
    LOCK_RETRY_MIN_MS +
    Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1))
  );
}

function epochNow(): number {
  return Date.now();
}

function isoNow(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sanitizeStoreError(err: unknown, context: string): Error {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  if (code) {
    return new Error(`${context} failed (${code})`);
  }
  return new Error(`${context} failed`);
}

// ─── Store error (with stable error code) ─────────────────────────────────────

export class LinksStoreError extends Error {
  public readonly code: LinkAuthorizationErrorCode;
  public readonly status: number;

  constructor(
    code: LinkAuthorizationErrorCode,
    message: string,
    status = 500,
  ) {
    super(message);
    this.name = "LinksStoreError";
    this.code = code;
    this.status = status;
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function linksDir(): string {
  return join(getAgentDir(), LINKS_SUBDIR);
}

function registryPath(): string {
  return join(linksDir(), REGISTRY_FILE);
}

function lockDirPath(): string {
  return join(linksDir(), LOCKS_SUBDIR, REGISTRY_LOCK_DIR);
}

function providerSecretDir(provider: LinkProviderId): string {
  return join(linksDir(), provider);
}

function secretPath(provider: LinkProviderId, connectionId: string): string {
  return join(providerSecretDir(provider), `${connectionId}.json`);
}

function quarantinePath(
  provider: LinkProviderId,
  connectionId: string,
): string {
  const suffix = randomUUID().slice(0, 8);
  return join(
    providerSecretDir(provider),
    `${QUARANTINE_PREFIX}${connectionId}-${suffix}.json`,
  );
}

// ─── Directory / file initialization ──────────────────────────────────────────

async function ensureLinksDir(): Promise<void> {
  const dir = linksDir();
  await mkdir(dir, { recursive: true, mode: LINKS_DIR_MODE });
  try {
    await chmod(dir, LINKS_DIR_MODE);
  } catch {
    // Best-effort on platforms that don't support chmod.
  }
}

async function ensureLocksDir(): Promise<void> {
  const dir = join(linksDir(), LOCKS_SUBDIR);
  await mkdir(dir, { recursive: true, mode: LINKS_DIR_MODE });
  try {
    await chmod(dir, LINKS_DIR_MODE);
  } catch {
    // Best-effort.
  }
}

async function ensureProviderSecretDir(
  provider: LinkProviderId,
): Promise<void> {
  const dir = providerSecretDir(provider);
  await mkdir(dir, { recursive: true, mode: LINKS_DIR_MODE });
  try {
    await chmod(dir, LINKS_DIR_MODE);
  } catch {
    // Best-effort.
  }
}

// ─── Cross-process lock (mkdir-based, web-credential-store pattern) ────────────

async function tryRemoveStaleLock(lockDir: string): Promise<boolean> {
  try {
    const st = await access(lockDir).then(
      () => true,
      () => false,
    );
    if (!st) return false;
    // Check age via mtime
    let ageMs: number;
    try {
      const s = await stat(lockDir);
      ageMs = Date.now() - s.mtimeMs;
    } catch {
      ageMs = LOCK_STALE_MS + 1; // Treat stat failure as stale
    }
    if (ageMs < LOCK_STALE_MS) return false;
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function acquireRegistryLock(): Promise<() => Promise<void>> {
  await ensureLinksDir();
  await ensureLocksDir();
  const lockDir = lockDirPath();
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: LOCK_DIR_MODE });
      // Lock acquired; return release function.
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await rm(lockDir, { recursive: true, force: true });
        } catch {
          // Best-effort unlock.
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") {
        throw sanitizeStoreError(err, "links lock acquire");
      }
      await tryRemoveStaleLock(lockDir);
      if (Date.now() - startedAt > LOCK_MAX_WAIT_MS) {
        throw new LinksStoreError(
          "links_store_error",
          "Links store lock acquisition timed out",
          500,
        );
      }
      await sleep(jitteredRetryMs());
    }
  }
}

// ─── Process queue ────────────────────────────────────────────────────────────

async function withProcessQueue<T>(fn: () => Promise<T>): Promise<T> {
  const key = registryPath();
  const previous = processQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const chain = previous.catch(() => {}).then(() => gate);
  processQueues.set(key, chain);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (processQueues.get(key) === chain) {
      processQueues.delete(key);
    }
  }
}

/**
 * Execute fn under both the process queue and the cross-process lock.
 */
async function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  return withProcessQueue(async () => {
    const release = await acquireRegistryLock();
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

// ─── Atomic file helpers ──────────────────────────────────────────────────────

async function atomicWriteFile(
  filePath: string,
  content: string,
  ensureDir: () => Promise<void>,
): Promise<void> {
  await ensureDir();
  const parentDir = join(filePath, "..");
  const tmpPath = join(
    parentDir,
    `.tmp.${process.pid}.${randomUUID().slice(0, 12)}.tmp`,
  );
  try {
    const handle = await open(tmpPath, "w", LINKS_FILE_MODE);
    try {
      await handle.writeFile(content, "utf8");
      try {
        await handle.sync();
      } catch {
        // fsync is best-effort on platforms that disallow it.
      }
    } finally {
      await handle.close();
    }
    try {
      await chmod(tmpPath, LINKS_FILE_MODE);
    } catch {
      // Best-effort.
    }
    await rename(tmpPath, filePath);
    try {
      await chmod(filePath, LINKS_FILE_MODE);
    } catch {
      // Best-effort.
    }
  } catch (err) {
    // Clean up temp file on failure
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // ignore cleanup
    }
    throw sanitizeStoreError(err, "links atomic write");
  }
}

async function readJsonFileSafe<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length === 0) return fallback;
    return JSON.parse(trimmed) as unknown as T;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return fallback;
    throw sanitizeStoreError(err, "links read");
  }
}

// ─── Registry operations ──────────────────────────────────────────────────────

function normalizeRegistry(raw: unknown): LinksRegistryV1 {
  if (!isRecord(raw)) {
    return { schemaVersion: 1, connections: {} };
  }

  const schemaVersion = raw.schemaVersion;
  // Fail closed for missing, invalid, or future schema versions.
  if (typeof schemaVersion !== "number" || schemaVersion !== 1) {
    return { schemaVersion: 1, connections: {} };
  }

  const connectionsRaw = raw.connections;
  if (!isRecord(connectionsRaw)) {
    return { schemaVersion: 1, connections: {} };
  }

  const connections: Record<string, LinkConnectionMetadata> = {};
  for (const [id, conn] of Object.entries(connectionsRaw)) {
    if (!isValidOpaqueId(id)) continue;
    if (!isRecord(conn)) continue;
    // Validate required fields
    if (typeof conn.provider !== "string") continue;
    if (typeof conn.login !== "string") continue;
    if (typeof conn.providerUserId !== "string") continue;
    if (conn.status !== "connected" && conn.status !== "disconnected") continue;
    if (!Array.isArray(conn.requestedScopes)) continue;
    if (!Array.isArray(conn.grantedScopes)) continue;
    if (typeof conn.createdAt !== "string") continue;
    if (typeof conn.updatedAt !== "string") continue;
    if (typeof conn.lastValidatedAt !== "string") continue;

    connections[id] = {
      id: String(conn.id ?? id),
      provider: conn.provider as LinkProviderId,
      label: String(conn.label ?? ""),
      login: String(conn.login),
      providerUserId: String(conn.providerUserId),
      status: conn.status as LinkConnectionStatus,
      requestedScopes: conn.requestedScopes.map(String),
      grantedScopes: conn.grantedScopes.map(String),
      createdAt: String(conn.createdAt),
      updatedAt: String(conn.updatedAt),
      lastValidatedAt: String(conn.lastValidatedAt),
      deletedAt: typeof conn.deletedAt === "string" ? conn.deletedAt : undefined,
      isDefault:
        typeof conn.isDefault === "boolean" ? conn.isDefault : undefined,
    };
  }

  return { schemaVersion: 1, connections };
}

async function readRegistry(): Promise<LinksRegistryV1> {
  const raw = await readJsonFileSafe<unknown>(registryPath(), null);
  if (raw === null) {
    return { schemaVersion: 1, connections: {} };
  }
  const normalized = normalizeRegistry(raw);
  // If the on-disk version was a higher/unknown schema, we must not overwrite it.
  // We return empty to fail-safe but don't rewrite the file.
  if (isRecord(raw) && typeof raw.schemaVersion === "number" && raw.schemaVersion > 1) {
    return { schemaVersion: 1, connections: {} };
  }
  return normalized;
}

async function writeRegistry(registry: LinksRegistryV1): Promise<void> {
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  await atomicWriteFile(registryPath(), payload, ensureLinksDir);
}

// ─── Secret operations ────────────────────────────────────────────────────────

function normalizeSecret(raw: unknown): GitHubOAuthSecretV1 | null {
  if (!isRecord(raw)) return null;

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== 1) return null; // Unknown schema — fail closed

  const kind = raw.kind;
  if (kind !== "github_oauth") return null;

  const accessToken = raw.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;

  const tokenType = raw.tokenType;
  if (tokenType !== "bearer") return null;

  const issuedAt = raw.issuedAt;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt) || issuedAt <= 0) {
    return null;
  }

  const expiresAt = raw.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return null;
  }

  const grantedScopes = Array.isArray(raw.grantedScopes)
    ? raw.grantedScopes.filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      )
    : [];

  return {
    schemaVersion: 1,
    kind: "github_oauth",
    accessToken,
    tokenType: "bearer",
    issuedAt,
    expiresAt,
    grantedScopes,
  };
}

async function readSecret(
  provider: LinkProviderId,
  connectionId: string,
): Promise<GitHubOAuthSecretV1 | null> {
  const raw = await readJsonFileSafe<unknown>(
    secretPath(provider, connectionId),
    null,
  );
  if (raw === null) return null;
  return normalizeSecret(raw);
}

async function writeSecret(
  provider: LinkProviderId,
  connectionId: string,
  secret: GitHubOAuthSecretV1,
): Promise<void> {
  const payload = `${JSON.stringify(secret, null, 2)}\n`;
  await atomicWriteFile(
    secretPath(provider, connectionId),
    payload,
    () => ensureProviderSecretDir(provider),
  );
}

async function deleteSecretFile(
  provider: LinkProviderId,
  connectionId: string,
): Promise<void> {
  const sp = secretPath(provider, connectionId);
  try {
    await rm(sp, { force: true });
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      throw sanitizeStoreError(err, "links secret delete");
    }
  }
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

/**
 * Find an active (connected) connection by provider and providerUserId.
 * Only scans the in-memory registry — call under lock.
 */
function findActiveConnectionByProviderUserId(
  registry: LinksRegistryV1,
  provider: LinkProviderId,
  providerUserId: string,
): LinkConnectionMetadata | null {
  for (const conn of Object.values(registry.connections)) {
    if (
      conn.provider === provider &&
      conn.providerUserId === providerUserId &&
      conn.status === "connected"
    ) {
      return conn;
    }
  }
  return null;
}

// ─── Label generation ─────────────────────────────────────────────────────────

function deriveLabel(login: string): string {
  return `@${login}`;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new OAuth connection after successful authorization and identity
 * validation.
 *
 * Called by the API layer after `getPersistingCredential()` returns a
 * credential + identity from the authorization manager.
 *
 * - Generates a random opaque connection id.
 * - Checks for duplicate identity (same provider + providerUserId) under lock.
 * - Writes the OAuth secret file.
 * - Updates the registry.
 * - Cleans orphan secret if registry write fails.
 *
 * @throws {LinksStoreError} with code `duplicate_identity` (409) if the
 *   providerUserId already has a connected identity.
 * @throws {LinksStoreError} with code `links_store_error` on I/O failure.
 */
export async function createLinkConnection(input: {
  provider: LinkProviderId;
  identity: ValidatedLinkIdentity;
  credential: OAuthCredentialResult;
  requestedScopes?: readonly string[];
}): Promise<LinkConnectionMetadata> {
  const { provider, identity, credential } = input;
  const requestedScopes = [...(input.requestedScopes ?? LINKS_P0_REQUESTED_SCOPES)];

  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) {
    throw new LinksStoreError(
      "provider_not_found",
      `Links provider "${provider}" is not supported`,
      404,
    );
  }

  return withRegistryLock(async () => {
    const registry = await readRegistry();

    // Duplicate check
    const existing = findActiveConnectionByProviderUserId(
      registry,
      provider,
      identity.providerUserId,
    );
    if (existing) {
      throw new LinksStoreError(
        "duplicate_identity",
        `GitHub identity "${identity.login}" is already connected. ` +
          "Disconnect it first before connecting again.",
        409,
      );
    }

    const now = isoNow();
    const connectionId = randomUUID();

    const metadata: LinkConnectionMetadata = {
      id: connectionId,
      provider,
      label: deriveLabel(identity.login),
      login: identity.login,
      providerUserId: identity.providerUserId,
      status: "connected",
      requestedScopes,
      grantedScopes: credential.grantedScopes,
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: now,
    };

    // Write secret first
    const secret: GitHubOAuthSecretV1 = {
      schemaVersion: 1,
      kind: "github_oauth",
      accessToken: credential.accessToken,
      tokenType: credential.tokenType,
      issuedAt: epochNow(),
      expiresAt: credential.expiresAt,
      grantedScopes: credential.grantedScopes,
    };

    await writeSecret(provider, connectionId, secret);

    // Update registry
    const nextRegistry: LinksRegistryV1 = {
      schemaVersion: 1,
      connections: { ...registry.connections, [connectionId]: metadata },
    };

    try {
      await writeRegistry(nextRegistry);
    } catch (err) {
      // Registry write failed — clean up orphan secret
      await deleteSecretFile(provider, connectionId).catch(() => {});
      throw err;
    }

    return metadata;
  });
}

/**
 * List connections for a provider (metadata only; secret files are not opened).
 *
 * Returns only active (connected) connections by default.
 * Pass `includeDisconnected: true` to also include soft-deleted records.
 */
export async function listLinkConnections(
  provider: LinkProviderId,
  options: { includeDisconnected?: boolean } = {},
): Promise<LinkConnectionMetadata[]> {
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) {
    throw new LinksStoreError(
      "provider_not_found",
      `Links provider "${provider}" is not supported`,
      404,
    );
  }

  const registry = await readRegistry();
  const results: LinkConnectionMetadata[] = [];

  for (const conn of Object.values(registry.connections)) {
    if (conn.provider !== provider) continue;
    if (conn.status === "disconnected" && !options.includeDisconnected) continue;
    results.push(conn);
  }

  // Sort by createdAt descending (newest first)
  results.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return results;
}

/**
 * Get a single connection by id (metadata only; secret file is not opened).
 */
export async function getLinkConnection(
  provider: LinkProviderId,
  connectionId: string,
): Promise<LinkConnectionMetadata | null> {
  if (!isValidOpaqueId(connectionId)) return null;
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) return null;

  const registry = await readRegistry();
  const conn = registry.connections[connectionId];
  if (!conn || conn.provider !== provider) return null;
  return conn;
}

/**
 * Find an active connection by provider + providerUserId (under lock).
 *
 * Returns null if no active connection exists for that identity.
 * Used by the authorization flow to check for duplicates before persisting.
 */
export async function findConnectionByProviderUserId(
  provider: LinkProviderId,
  providerUserId: string,
): Promise<LinkConnectionMetadata | null> {
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) return null;
  if (!providerUserId) return null;

  const registry = await readRegistry();
  return findActiveConnectionByProviderUserId(registry, provider, providerUserId);
}

/**
 * Disconnect (soft-delete) a connection.
 *
 * Under lock:
 * 1. Quarantine the secret file (rename to .quarantine-<random>.json).
 * 2. Update registry: status → "disconnected", set deletedAt, updatedAt.
 * 3. Write registry.
 * 4. If registry write fails: restore secret from quarantine.
 * 5. If success: unlink quarantine.
 *
 * Idempotent: disconnecting an already-disconnected connection returns
 * `{ disconnected: false }` without error.
 *
 * Does NOT revoke the GitHub remote OAuth grant.
 *
 * @throws {LinksStoreError} on I/O failure.
 */
export async function disconnectLinkConnection(
  provider: LinkProviderId,
  connectionId: string,
): Promise<{ disconnected: boolean }> {
  if (!isValidOpaqueId(connectionId)) {
    throw new LinksStoreError(
      "connection_not_found",
      `Connection "${connectionId}" not found`,
      404,
    );
  }
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) {
    throw new LinksStoreError(
      "provider_not_found",
      `Links provider "${provider}" is not supported`,
      404,
    );
  }

  return withRegistryLock(async () => {
    const registry = await readRegistry();
    const conn = registry.connections[connectionId];

    if (!conn || conn.provider !== provider) {
      throw new LinksStoreError(
        "connection_not_found",
        `Connection "${connectionId}" not found`,
        404,
      );
    }

    if (conn.status === "disconnected") {
      // Already disconnected — idempotent.
      return { disconnected: false };
    }

    const qp = quarantinePath(provider, connectionId);
    const sp = secretPath(provider, connectionId);
    let quarantined = false;

    // Step 1: quarantine the secret
    try {
      await ensureProviderSecretDir(provider);
      await rename(sp, qp);
      quarantined = true;
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        // Secret file doesn't exist — treat as already cleaned.
        // Continue with metadata update.
      } else {
        throw sanitizeStoreError(err, "links disconnect quarantine");
      }
    }

    // Step 2: update registry
    const now = isoNow();
    const disconnectedConn: LinkConnectionMetadata = {
      ...conn,
      status: "disconnected",
      updatedAt: now,
      deletedAt: now,
    };

    const nextRegistry: LinksRegistryV1 = {
      schemaVersion: 1,
      connections: { ...registry.connections, [connectionId]: disconnectedConn },
    };

    try {
      await writeRegistry(nextRegistry);
    } catch (err) {
      // Registry write failed — attempt to restore secret from quarantine
      if (quarantined) {
        try {
          await rename(qp, sp);
        } catch {
          // Cannot restore — secret may be lost. This is a split-brain risk.
          // The quarantine file still exists on disk; operator can recover manually.
        }
      }
      throw sanitizeStoreError(err, "links disconnect registry write");
    }

    // Step 3: remove quarantine
    if (quarantined) {
      try {
        await rm(qp, { force: true });
      } catch {
        // Best-effort — the secret is already removed from the active path.
        // The quarantine file may linger until the next cleanup sweep.
      }
    } else {
      // Secret file didn't exist — ensure it's cleaned up anyway
      await deleteSecretFile(provider, connectionId).catch(() => {});
    }

    return { disconnected: true };
  });
}

/**
 * Get the count of active (connected) connections for a provider.
 *
 * Reads only the registry; does not open secret files or call GitHub.
 */
export async function getConnectionCount(
  provider: LinkProviderId,
): Promise<number> {
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) return 0;
  const registry = await readRegistry();
  let count = 0;
  for (const conn of Object.values(registry.connections)) {
    if (conn.provider === provider && conn.status === "connected") {
      count += 1;
    }
  }
  return count;
}

/**
 * Read the OAuth secret for a connected connection.
 *
 * @returns The secret, or null if the connection doesn't exist, is
 *   disconnected, or the secret file is missing/malformed.
 *
 * Internal use only — never expose this to the browser or API responses.
 */
export async function readConnectionSecret(
  provider: LinkProviderId,
  connectionId: string,
): Promise<GitHubOAuthSecretV1 | null> {
  if (!isValidOpaqueId(connectionId)) return null;
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(provider)) return null;

  const conn = await getLinkConnection(provider, connectionId);
  if (!conn || conn.status !== "connected") return null;

  return readSecret(provider, connectionId);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Reset the in-memory process queue (for tests that use temporary agent dirs).
 */
export function __resetLinksStoreCacheForTests(): void {
  processQueues.clear();
}

/**
 * Confirm the store uses mkdir-based locks (for test assertions).
 */
export function __linksStoreUsesFsLockForTests(): boolean {
  return LOCK_STALE_MS === 30_000 && REGISTRY_LOCK_DIR === "registry.lock";
}
