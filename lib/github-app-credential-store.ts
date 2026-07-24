/**
 * github-app-credential-store — server-only local GitHub App credential bundle.
 *
 * Storage root: `<getAgentDir()>/github-automation/` (never accepts a caller path).
 *
 * Disk layout:
 * - credentials.v1.json          — 0600 metadata + secrets (App ID, webhook secret, optional slug,
 *                                  key basename + SHA-256 fingerprint, timestamps)
 * - private-key.<generation>.pem — 0600 RSA private key; metadata is the atomic active pointer
 * - .locks/credentials.lock/     — 0700 mkdir lock + 0600 owner.json
 * - .tmp-*                       — staging only; never participates in reads
 *
 * Write transaction (under process queue + mkdir lock):
 * 1. Re-read metadata; refuse ordinary upsert over unknown/future schema.
 * 2. Merge only existing local + submitted fields (never copy env).
 * 3. Validate complete local bundle (first save / missing requires all three).
 * 4. If key changed: write new generation PEM (tmp → fsync → chmod → rename).
 * 5. Atomically switch credentials.v1.json to the new generation pointer.
 * 6. Best-effort clean unreferenced generations / tmp files.
 *
 * Isolation:
 * - Does not import links-store, web-credential-store, oauth-accounts, or api-key-accounts.
 * - Does not touch config.json, deliveries, jobs, repositories, events.
 * - Safe exports never include App ID value, secret, PEM, path, basename, or fingerprint.
 */

import {
  createHash,
  createPrivateKey,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import { getGithubAutomationRootDir } from "./github-automation-config";
import { GithubAutomationError } from "./github-automation-errors";
import type {
  GithubAppLocalCredentialReadiness,
  GithubAppLocalCredentialSafeSummary,
} from "./github-automation-types";
import {
  GITHUB_APP_LOCAL_CREDENTIALS_KIND,
  GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION,
} from "./github-automation-types";

// ─── Constants ───────────────────────────────────────────────────────────────

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_DIR_MODE = 0o700;

const CREDENTIALS_FILE = "credentials.v1.json";
const LOCKS_SUBDIR = ".locks";
const CREDENTIALS_LOCK_DIR = "credentials.lock";
const LOCK_OWNER_FILE = "owner.json";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

/** credentials.v1.json max size (bytes). */
const METADATA_MAX_BYTES = 16 * 1024;
/** Private key PEM max size (bytes). */
const PRIVATE_KEY_MAX_BYTES = 64 * 1024;
/** Webhook secret max length (UTF-8 bytes after trim). */
const WEBHOOK_SECRET_MAX_BYTES = 4096;
/** App slug max length (characters). */
const APP_SLUG_MAX_CHARS = 100;
/** App ID: 1–32 decimal digits. */
const APP_ID_PATTERN = /^[1-9][0-9]{0,31}$/;
/** Active key basename pattern written by this store only. */
const KEY_BASENAME_PATTERN = /^private-key\.[A-Za-z0-9_-]{8,64}\.pem$/;
const KEY_BASENAME_PREFIX = "private-key.";
const KEY_BASENAME_SUFFIX = ".pem";

const PROCESS_QUEUE_KEY = "github-app-local-credentials";

// ─── Types (server-only; never wire) ─────────────────────────────────────────

export interface GithubAppLocalCredentialBundle {
  schemaVersion: typeof GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION;
  kind: typeof GITHUB_APP_LOCAL_CREDENTIALS_KIND;
  appId: string;
  webhookSecret: string;
  appSlug: string | null;
  /** Basename only (private-key.<generation>.pem); never an absolute path. */
  keyFile: string;
  /** `sha256:<hex>` of PEM bytes as stored. */
  keySha256: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields for first save or partial rotation.
 * Omitted / null / blank strings mean "preserve existing local value".
 * Never supply env values here — callers must not import env into local storage.
 */
export interface GithubAppLocalCredentialUpsertInput {
  appId?: string | null;
  webhookSecret?: string | null;
  /** Non-empty sets slug; explicit null clears; undefined preserves. */
  appSlug?: string | null;
  /**
   * PEM text. When omitted/blank on rotation, keep the current generation key.
   * Required (with appId + webhookSecret) for first save / incomplete local bundle.
   */
  privateKeyPem?: string | null;
}

export interface GithubAppLocalCredentialLoadResult {
  bundle: GithubAppLocalCredentialBundle;
  /** Loaded KeyObject (server memory only). */
  privateKey: KeyObject;
  /** Absolute path to the active generation PEM (server-only; never wire). */
  privateKeyPath: string;
  /** PEM text as stored (server-only; never wire). */
  privateKeyPem: string;
}

type LockOwner = {
  pid: number;
  createdAt: number;
};

type ParsedMetadataResult =
  | { status: "missing" }
  | { status: "ready"; bundle: GithubAppLocalCredentialBundle }
  | { status: "invalid"; reason: string }
  | { status: "unsupported"; reason: string };

// ─── Process queue ───────────────────────────────────────────────────────────

const processQueues = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function jitteredRetryMs(): number {
  return (
    LOCK_RETRY_MIN_MS +
    Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isoNow(): string {
  return new Date().toISOString();
}

function storeError(
  code:
    | "invalid_app_id"
    | "invalid_webhook_secret"
    | "invalid_private_key"
    | "private_key_too_large"
    | "local_credentials_invalid"
    | "local_credentials_unsupported"
    | "credentials_lock_timeout"
    | "credentials_store_error",
  message?: string,
  status?: 400 | 409 | 500 | 504,
): GithubAutomationError {
  // Wire codes match GithubAutomationErrorCode (GHCRED-03). Messages are fixed and secret-free.
  return new GithubAutomationError(code, message, {
    status,
  });
}

function sanitizeFsError(err: unknown, context: string): GithubAutomationError {
  if (err instanceof GithubAutomationError) return err;
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  return storeError(
    "credentials_store_error",
    code ? `${context} failed (${code})` : `${context} failed`,
    500,
  );
}

// ─── Paths (rooted only at getAgentDir()/github-automation) ──────────────────

export function getGithubAppCredentialsMetadataPath(): string {
  return join(getGithubAutomationRootDir(), CREDENTIALS_FILE);
}

function credentialsLockDir(): string {
  return join(getGithubAutomationRootDir(), LOCKS_SUBDIR, CREDENTIALS_LOCK_DIR);
}

function locksParentDir(): string {
  return join(getGithubAutomationRootDir(), LOCKS_SUBDIR);
}

/**
 * Resolve a metadata key basename to an absolute path inside the automation root.
 * Rejects absolute names, traversal, separators, and non-matching patterns.
 */
export function resolveGithubAppCredentialKeyPath(keyBasename: string): string {
  if (typeof keyBasename !== "string" || !KEY_BASENAME_PATTERN.test(keyBasename)) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App key basename is invalid",
    );
  }
  if (
    keyBasename.includes("/") ||
    keyBasename.includes("\\") ||
    keyBasename.includes("\0") ||
    keyBasename === "." ||
    keyBasename === ".." ||
    keyBasename.includes("..")
  ) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App key basename is invalid",
    );
  }

  const root = resolve(getGithubAutomationRootDir());
  const candidate = resolve(root, keyBasename);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App key path escapes store root",
    );
  }
  if (basename(candidate) !== keyBasename) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App key basename is invalid",
    );
  }
  return candidate;
}

function newKeyBasename(): string {
  // generation id: time prefix + entropy (fits KEY_BASENAME_PATTERN length bounds)
  const generation = `${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
  return `${KEY_BASENAME_PREFIX}${generation}${KEY_BASENAME_SUFFIX}`;
}

function newTmpPath(root: string, label: string): string {
  const token = randomBytes(8).toString("hex");
  return join(root, `.tmp-${label}.${process.pid}.${token}`);
}

// ─── Directory helpers ───────────────────────────────────────────────────────

async function ensureModeDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  try {
    await chmod(dir, DIR_MODE);
  } catch {
    // Best-effort on platforms without POSIX mode semantics.
  }
}

async function ensureAutomationRoot(): Promise<void> {
  await ensureModeDir(getGithubAutomationRootDir());
}

async function ensureLocksDir(): Promise<void> {
  await ensureAutomationRoot();
  await ensureModeDir(locksParentDir());
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return false;
    throw err;
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function normalizeGithubAppId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw storeError("invalid_app_id", "GitHub App ID must be a string");
  }
  const trimmed = raw.trim();
  if (!APP_ID_PATTERN.test(trimmed)) {
    throw storeError(
      "invalid_app_id",
      "GitHub App ID must be a positive integer string",
    );
  }
  return trimmed;
}

export function normalizeGithubAppWebhookSecret(raw: unknown): string {
  if (typeof raw !== "string") {
    throw storeError("invalid_webhook_secret", "Webhook secret must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw storeError("invalid_webhook_secret", "Webhook secret must not be empty");
  }
  const byteLength = Buffer.byteLength(trimmed, "utf8");
  if (byteLength > WEBHOOK_SECRET_MAX_BYTES) {
    throw storeError(
      "invalid_webhook_secret",
      "Webhook secret exceeds size limit",
    );
  }
  return trimmed;
}

export function normalizeGithubAppSlug(
  raw: unknown,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw storeError(
      "local_credentials_invalid",
      "App slug must be a string or null",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > APP_SLUG_MAX_CHARS) {
    throw storeError(
      "local_credentials_invalid",
      "App slug exceeds size limit",
    );
  }
  // GitHub slugs are lowercase alphanumerics and hyphens; stay permissive but bounded.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(trimmed)) {
    throw storeError(
      "local_credentials_invalid",
      "App slug format is invalid",
    );
  }
  return trimmed;
}

function fingerprintPem(pem: string): string {
  return `sha256:${createHash("sha256").update(pem, "utf8").digest("hex")}`;
}

/**
 * Validate PEM as a GitHub App RSA private key.
 * Rejects public keys, certificates, EC keys, and oversized payloads.
 */
export function parseGithubAppPrivateKeyPem(pemRaw: unknown): {
  pem: string;
  privateKey: KeyObject;
  keySha256: string;
} {
  if (typeof pemRaw !== "string") {
    throw storeError("invalid_private_key", "Private key must be PEM text");
  }
  const pem = pemRaw.replace(/\r\n/g, "\n").trim();
  if (pem.length === 0) {
    throw storeError("invalid_private_key", "Private key must not be empty");
  }
  const byteLength = Buffer.byteLength(pem, "utf8");
  if (byteLength > PRIVATE_KEY_MAX_BYTES) {
    throw storeError("private_key_too_large");
  }
  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(pem)) {
    throw storeError("invalid_private_key", "Private key PEM marker is missing");
  }
  if (/-----BEGIN CERTIFICATE-----/.test(pem) || /-----BEGIN PUBLIC KEY-----/.test(pem)) {
    throw storeError("invalid_private_key", "Private key PEM is not a private key");
  }

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw storeError("invalid_private_key", "Private key PEM could not be parsed");
  }

  const keyType = privateKey.asymmetricKeyType;
  if (keyType !== "rsa") {
    throw storeError(
      "invalid_private_key",
      "GitHub App private key must be RSA",
    );
  }

  return {
    pem,
    privateKey,
    keySha256: fingerprintPem(pem),
  };
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ─── Atomic writes ───────────────────────────────────────────────────────────

async function atomicWriteTextFile(filePath: string, contents: string): Promise<void> {
  const root = dirname(filePath);
  await ensureModeDir(root);
  const tmpPath = newTmpPath(root, "file");
  try {
    const handle = await open(tmpPath, "w", FILE_MODE);
    try {
      await handle.writeFile(contents, "utf8");
      try {
        await handle.sync();
      } catch {
        // fsync is best-effort.
      }
    } finally {
      await handle.close();
    }
    try {
      await chmod(tmpPath, FILE_MODE);
    } catch {
      // best-effort
    }
    await rename(tmpPath, filePath);
    try {
      await chmod(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
    // Best-effort fsync parent directory so the rename is durable.
    try {
      const dirHandle = await open(root, "r");
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    } catch {
      // best-effort
    }
  } catch (err) {
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // ignore
    }
    throw sanitizeFsError(err, "credentials atomic write");
  }
}

// ─── Cross-process lock ──────────────────────────────────────────────────────

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const raw = JSON.parse(
      await readFile(join(lockDir, LOCK_OWNER_FILE), "utf8"),
    ) as unknown;
    if (!isRecord(raw)) return null;
    const pid =
      typeof raw.pid === "number" && Number.isFinite(raw.pid) ? raw.pid : null;
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : null;
    if (pid === null || createdAt === null) return null;
    return { pid, createdAt };
  } catch {
    return null;
  }
}

async function lockAgeMs(lockDir: string): Promise<number | null> {
  const owner = await readLockOwner(lockDir);
  if (owner) return Date.now() - owner.createdAt;
  try {
    const st = await stat(lockDir);
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Only remove locks that look abandoned. Prefer owner age; never steal a young lock.
 * When owner pid still appears live and age is under 2× stale window, keep waiting.
 */
async function tryRemoveStaleLock(lockDir: string): Promise<boolean> {
  const age = await lockAgeMs(lockDir);
  if (age === null || age < LOCK_STALE_MS) return false;

  const owner = await readLockOwner(lockDir);
  if (owner) {
    try {
      // signal 0: throws if process does not exist (or no permission).
      process.kill(owner.pid, 0);
      // Owner still alive: only reclaim after a longer grace to avoid stealing.
      if (age < LOCK_STALE_MS * 2) return false;
    } catch {
      // Process not found / not killable → treat as dead owner.
    }
  }

  try {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function acquireCredentialsLock(): Promise<() => Promise<void>> {
  await ensureLocksDir();
  const lockDir = credentialsLockDir();
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: LOCK_DIR_MODE });
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now() };
      await writeFile(
        join(lockDir, LOCK_OWNER_FILE),
        `${JSON.stringify(owner)}\n`,
        { encoding: "utf8", mode: FILE_MODE },
      );
      try {
        await chmod(join(lockDir, LOCK_OWNER_FILE), FILE_MODE);
      } catch {
        // best-effort
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = await readLockOwner(lockDir);
          if (
            current &&
            current.pid === process.pid &&
            current.createdAt === owner.createdAt
          ) {
            await rm(lockDir, { recursive: true, force: true });
            return;
          }
          if (!(await pathExists(lockDir))) return;
          if (!current) {
            await rm(lockDir, { recursive: true, force: true });
          }
        } catch {
          // Best-effort unlock.
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") {
        throw sanitizeFsError(err, "credentials lock acquire");
      }
      await tryRemoveStaleLock(lockDir);
      if (Date.now() - startedAt > LOCK_MAX_WAIT_MS) {
        throw storeError("credentials_lock_timeout");
      }
      await sleep(jitteredRetryMs());
    }
  }
}

async function withProcessQueue<T>(fn: () => Promise<T>): Promise<T> {
  const previous = processQueues.get(PROCESS_QUEUE_KEY) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const chain = previous.catch(() => {}).then(() => gate);
  processQueues.set(PROCESS_QUEUE_KEY, chain);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (processQueues.get(PROCESS_QUEUE_KEY) === chain) {
      processQueues.delete(PROCESS_QUEUE_KEY);
    }
  }
}

/**
 * Run under process queue + cross-process credentials lock.
 * Used for all mutations and for consistent load-with-key paths.
 */
async function withCredentialsLock<T>(fn: () => Promise<T>): Promise<T> {
  return withProcessQueue(async () => {
    const release = await acquireCredentialsLock();
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

// ─── Metadata parse / key load ───────────────────────────────────────────────

function parseMetadataObject(raw: unknown): ParsedMetadataResult {
  if (!isRecord(raw)) {
    return { status: "invalid", reason: "metadata_not_object" };
  }

  const schemaVersion = raw.schemaVersion;
  const kind = raw.kind;

  if (schemaVersion !== GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION) {
    if (typeof schemaVersion === "number" && schemaVersion > GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION) {
      return { status: "unsupported", reason: "future_schema" };
    }
    return { status: "invalid", reason: "schema_version" };
  }
  if (kind !== GITHUB_APP_LOCAL_CREDENTIALS_KIND) {
    // Unknown kind on known schema version → unsupported (do not overwrite).
    return { status: "unsupported", reason: "kind" };
  }

  let appId: string;
  let webhookSecret: string;
  let keyFile: string;
  let keySha256: string;
  let createdAt: string;
  let updatedAt: string;
  let appSlug: string | null;

  try {
    appId = normalizeGithubAppId(raw.appId);
    webhookSecret = normalizeGithubAppWebhookSecret(raw.webhookSecret);
    if (typeof raw.keyFile !== "string" || !KEY_BASENAME_PATTERN.test(raw.keyFile)) {
      return { status: "invalid", reason: "key_file" };
    }
    keyFile = raw.keyFile;
    if (
      typeof raw.keySha256 !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(raw.keySha256)
    ) {
      return { status: "invalid", reason: "key_sha256" };
    }
    keySha256 = raw.keySha256;
    if (typeof raw.createdAt !== "string" || raw.createdAt.trim().length === 0) {
      return { status: "invalid", reason: "created_at" };
    }
    if (typeof raw.updatedAt !== "string" || raw.updatedAt.trim().length === 0) {
      return { status: "invalid", reason: "updated_at" };
    }
    createdAt = raw.createdAt.trim();
    updatedAt = raw.updatedAt.trim();
    appSlug =
      raw.appSlug === undefined || raw.appSlug === null
        ? null
        : normalizeGithubAppSlug(raw.appSlug);
  } catch {
    return { status: "invalid", reason: "field_validation" };
  }

  return {
    status: "ready",
    bundle: {
      schemaVersion: GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION,
      kind: GITHUB_APP_LOCAL_CREDENTIALS_KIND,
      appId,
      webhookSecret,
      appSlug,
      keyFile,
      keySha256,
      createdAt,
      updatedAt,
    },
  };
}

async function parseMetadataUnlocked(): Promise<ParsedMetadataResult> {
  let rawText: string | null;
  try {
    const path = getGithubAppCredentialsMetadataPath();
    try {
      const st = await lstat(path);
      if (st.isSymbolicLink()) {
        return { status: "invalid", reason: "metadata_symlink" };
      }
      if (!st.isFile()) {
        return { status: "invalid", reason: "metadata_not_file" };
      }
      if (st.size > METADATA_MAX_BYTES) {
        return { status: "invalid", reason: "metadata_too_large" };
      }
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return { status: "missing" };
      }
      throw err;
    }
    rawText = await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof GithubAutomationError) throw err;
    throw sanitizeFsError(err, "credentials metadata read");
  }

  if (rawText === null) return { status: "missing" };
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return { status: "invalid", reason: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return { status: "invalid", reason: "json" };
  }
  return parseMetadataObject(parsed);
}

async function readRegularFilePem(
  absolutePath: string,
  expectedSha256: string,
): Promise<{ pem: string; privateKey: KeyObject }> {
  let st;
  try {
    st = await lstat(absolutePath);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw storeError(
        "local_credentials_invalid",
        "Local GitHub App private key is missing",
      );
    }
    throw sanitizeFsError(err, "credentials key lstat");
  }
  if (st.isSymbolicLink()) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App private key must not be a symlink",
    );
  }
  if (!st.isFile()) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App private key is not a regular file",
    );
  }
  if (st.size > PRIVATE_KEY_MAX_BYTES) {
    throw storeError("private_key_too_large");
  }

  let pem: string;
  try {
    pem = await readFile(absolutePath, "utf8");
  } catch (err) {
    throw sanitizeFsError(err, "credentials key read");
  }

  const parsed = parseGithubAppPrivateKeyPem(pem);
  if (parsed.keySha256 !== expectedSha256) {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App private key fingerprint mismatch",
    );
  }
  return { pem: parsed.pem, privateKey: parsed.privateKey };
}

async function loadBundleUnlocked(): Promise<GithubAppLocalCredentialLoadResult | null> {
  const meta = await parseMetadataUnlocked();
  if (meta.status === "missing") return null;
  if (meta.status === "unsupported") {
    throw storeError(
      "local_credentials_unsupported",
      "Local GitHub App credentials use an unsupported schema",
    );
  }
  if (meta.status === "invalid") {
    throw storeError(
      "local_credentials_invalid",
      "Local GitHub App credentials are invalid",
    );
  }

  const keyPath = resolveGithubAppCredentialKeyPath(meta.bundle.keyFile);
  const key = await readRegularFilePem(keyPath, meta.bundle.keySha256);
  return {
    bundle: meta.bundle,
    privateKey: key.privateKey,
    privateKeyPath: keyPath,
    privateKeyPem: key.pem,
  };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Best-effort: remove unreferenced generation PEMs and leftover tmp files.
 * Never deletes the active key basename, config.json, deliveries, jobs, etc.
 */
async function cleanupUnreferencedFilesUnlocked(
  activeKeyBasename: string | null,
): Promise<void> {
  const root = getGithubAutomationRootDir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === CREDENTIALS_FILE) continue;
    if (name === "config.json") continue;
    if (name === LOCKS_SUBDIR) continue;
    if (
      name === "deliveries" ||
      name === "jobs" ||
      name === "repositories" ||
      name === "events" ||
      name === "runner" ||
      name === "issues"
    ) {
      continue;
    }

    const shouldConsider =
      KEY_BASENAME_PATTERN.test(name) ||
      name.startsWith(".tmp-") ||
      /^\.tmp\./.test(name);
    if (!shouldConsider) continue;
    if (activeKeyBasename && name === activeKeyBasename) continue;

    const full = join(root, name);
    try {
      const st = await lstat(full);
      if (st.isSymbolicLink()) {
        // Do not follow; best-effort unlink of the symlink itself only if it matches pattern.
        await rm(full, { force: true });
        continue;
      }
      if (!st.isFile()) continue;
      await rm(full, { force: true });
    } catch {
      // best-effort
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Safe local-only summary for status/UI. Never throws for missing/invalid —
 * reports readiness instead. Unsupported/invalid still fail closed for loaders.
 */
export async function getGithubAppLocalCredentialSafeSummary(
  checkedAt: string = isoNow(),
): Promise<GithubAppLocalCredentialSafeSummary> {
  void checkedAt;
  try {
    // Read without lock for status; metadata is single-file atomic.
    // Key presence/fingerprint checked best-effort.
    const meta = await parseMetadataUnlocked();
    if (meta.status === "missing") {
      return {
        configured: false,
        readiness: "missing",
        hasAppId: false,
        hasKey: false,
        hasWebhook: false,
        updatedAt: null,
      };
    }
    if (meta.status === "unsupported") {
      return {
        configured: false,
        readiness: "unsupported",
        hasAppId: false,
        hasKey: false,
        hasWebhook: false,
        updatedAt: null,
      };
    }
    if (meta.status === "invalid") {
      return {
        configured: false,
        readiness: "invalid",
        hasAppId: false,
        hasKey: false,
        hasWebhook: false,
        updatedAt: null,
      };
    }

    let hasKey = false;
    try {
      const keyPath = resolveGithubAppCredentialKeyPath(meta.bundle.keyFile);
      await readRegularFilePem(keyPath, meta.bundle.keySha256);
      hasKey = true;
    } catch {
      hasKey = false;
    }

    const hasAppId = meta.bundle.appId.length > 0;
    const hasWebhook = meta.bundle.webhookSecret.length > 0;
    const configured = hasAppId && hasKey && hasWebhook;

    return {
      configured,
      readiness: configured ? "ready" : "invalid",
      hasAppId,
      hasKey,
      hasWebhook,
      updatedAt: meta.bundle.updatedAt,
    };
  } catch {
    return {
      configured: false,
      readiness: "invalid",
      hasAppId: false,
      hasKey: false,
      hasWebhook: false,
      updatedAt: null,
    };
  }
}

/**
 * Load the full local credential bundle + KeyObject, or null when missing.
 * Throws GithubAutomationError on invalid/unsupported (fail closed).
 */
export async function loadGithubAppLocalCredentials(): Promise<GithubAppLocalCredentialLoadResult | null> {
  // Process queue only (no cross-process lock) so concurrent readers are fine;
  // writers hold both queue + lock and rewrite via atomic rename.
  return withProcessQueue(async () => loadBundleUnlocked());
}

/**
 * Upsert local credentials.
 * - First save / incomplete local: requires appId + webhookSecret + privateKeyPem.
 * - Partial rotation: blank/omitted fields preserve existing local values only (never env).
 * - Ordinary upsert refuses unknown/future schema (fail closed).
 * - Does not read process.env.
 */
export async function upsertGithubAppLocalCredentials(
  input: GithubAppLocalCredentialUpsertInput,
): Promise<GithubAppLocalCredentialSafeSummary> {
  return withCredentialsLock(async () => {
    await ensureAutomationRoot();
    const existing = await parseMetadataUnlocked();

    if (existing.status === "unsupported") {
      throw storeError(
        "local_credentials_unsupported",
        "Local GitHub App credentials use an unsupported schema; remove local credentials before rewriting",
      );
    }
    if (existing.status === "invalid") {
      // Ordinary upsert must not silently overwrite damaged metadata.
      // Operator must DELETE first, then save a complete bundle.
      throw storeError(
        "local_credentials_invalid",
        "Local GitHub App credentials are invalid; remove local credentials before rewriting",
      );
    }

    const current = existing.status === "ready" ? existing.bundle : null;

    const submittedAppId = optionalTrimmedString(input.appId);
    const submittedSecret = optionalTrimmedString(input.webhookSecret);
    const submittedPem = optionalTrimmedString(input.privateKeyPem);

    // appSlug: undefined → preserve; null → clear; string → set (after normalize)
    let nextSlug: string | null;
    if (input.appSlug === undefined) {
      nextSlug = current?.appSlug ?? null;
    } else if (input.appSlug === null) {
      nextSlug = null;
    } else {
      nextSlug = normalizeGithubAppSlug(input.appSlug);
    }

    const nextAppId = submittedAppId
      ? normalizeGithubAppId(submittedAppId)
      : current?.appId ?? null;
    const nextSecret = submittedSecret
      ? normalizeGithubAppWebhookSecret(submittedSecret)
      : current?.webhookSecret ?? null;

    let nextKeyFile = current?.keyFile ?? null;
    let nextKeySha256 = current?.keySha256 ?? null;
    let newKeyWritten: string | null = null;

    if (submittedPem) {
      const parsed = parseGithubAppPrivateKeyPem(submittedPem);
      // If identical to current key content, keep the same generation file.
      if (current && current.keySha256 === parsed.keySha256) {
        nextKeyFile = current.keyFile;
        nextKeySha256 = current.keySha256;
      } else {
        const keyBasename = newKeyBasename();
        const keyPath = resolveGithubAppCredentialKeyPath(keyBasename);
        // Ensure PEM ends with a trailing newline for conventional PEM files.
        const pemBody = parsed.pem.endsWith("\n") ? parsed.pem : `${parsed.pem}\n`;
        await atomicWriteTextFile(keyPath, pemBody);
        newKeyWritten = keyBasename;
        nextKeyFile = keyBasename;
        nextKeySha256 = parsed.keySha256;
      }
    }

    // First save / incomplete: require full bundle after merge.
    if (!nextAppId || !nextSecret || !nextKeyFile || !nextKeySha256) {
      // If we wrote a new key but cannot complete the bundle, best-effort remove it.
      if (newKeyWritten) {
        try {
          await rm(resolveGithubAppCredentialKeyPath(newKeyWritten), { force: true });
        } catch {
          // ignore
        }
      }
      throw storeError(
        "local_credentials_invalid",
        "Local GitHub App credentials require App ID, webhook secret, and private key",
      );
    }

    // Verify the referenced key is loadable before switching metadata.
    const keyPath = resolveGithubAppCredentialKeyPath(nextKeyFile);
    try {
      await readRegularFilePem(keyPath, nextKeySha256);
    } catch (err) {
      if (newKeyWritten) {
        try {
          await rm(resolveGithubAppCredentialKeyPath(newKeyWritten), { force: true });
        } catch {
          // ignore
        }
      }
      throw err instanceof GithubAutomationError
        ? err
        : storeError(
            "local_credentials_invalid",
            "Local GitHub App private key could not be verified",
          );
    }

    const now = isoNow();
    const nextBundle: GithubAppLocalCredentialBundle = {
      schemaVersion: GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION,
      kind: GITHUB_APP_LOCAL_CREDENTIALS_KIND,
      appId: nextAppId,
      webhookSecret: nextSecret,
      appSlug: nextSlug,
      keyFile: nextKeyFile,
      keySha256: nextKeySha256,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };

    const metadataPath = getGithubAppCredentialsMetadataPath();
    try {
      await atomicWriteTextFile(
        metadataPath,
        `${JSON.stringify(nextBundle, null, 2)}\n`,
      );
    } catch (err) {
      // Metadata switch failed: leave new orphan key for later cleanup; do not report success.
      throw err instanceof GithubAutomationError
        ? err
        : sanitizeFsError(err, "credentials metadata write");
    }

    await cleanupUnreferencedFilesUnlocked(nextBundle.keyFile);

    return {
      configured: true,
      readiness: "ready" satisfies GithubAppLocalCredentialReadiness,
      hasAppId: true,
      hasKey: true,
      hasWebhook: true,
      updatedAt: nextBundle.updatedAt,
    };
  });
}

/**
 * Delete only the local credential bundle (metadata + matching generation keys).
 * Does not modify env, config.json, deliveries, jobs, repositories, events, or locks outside credentials.lock.
 * Unknown/damaged metadata is still cleared so operators can recover.
 */
export async function deleteGithubAppLocalCredentials(): Promise<GithubAppLocalCredentialSafeSummary> {
  return withCredentialsLock(async () => {
    await ensureAutomationRoot();
    const root = getGithubAutomationRootDir();
    const metadataPath = getGithubAppCredentialsMetadataPath();

    let activeKey: string | null = null;
    const meta = await parseMetadataUnlocked();
    if (meta.status === "ready") {
      activeKey = meta.bundle.keyFile;
    }

    // Quarantine metadata first so readers fail closed immediately.
    const quarantineMeta = join(
      root,
      `.tmp-credentials-quarantine.${process.pid}.${randomBytes(6).toString("hex")}`,
    );
    let metadataQuarantined = false;
    if (await pathExists(metadataPath)) {
      try {
        // Refuse to follow a symlink: lstat + rename of the link itself.
        const st = await lstat(metadataPath);
        if (st.isSymbolicLink() || st.isFile()) {
          await rename(metadataPath, quarantineMeta);
          metadataQuarantined = true;
        } else {
          // Unexpected type: try direct rm without touching other dirs.
          await rm(metadataPath, { force: true });
        }
      } catch (err) {
        if (!(isNodeError(err) && err.code === "ENOENT")) {
          throw sanitizeFsError(err, "credentials metadata quarantine");
        }
      }
    }

    // Remove active key if known.
    if (activeKey) {
      try {
        const keyPath = resolveGithubAppCredentialKeyPath(activeKey);
        await rm(keyPath, { force: true });
      } catch {
        // best-effort; continue to pattern cleanup
      }
    }

    // Clear any fixed-pattern generation keys and leftover tmp credential files.
    await cleanupUnreferencedFilesUnlocked(null);

    // Drop quarantined metadata last.
    if (metadataQuarantined) {
      try {
        await rm(quarantineMeta, { force: true });
      } catch {
        // If quarantine delete fails, try restore so we don't leave a half state claiming success incorrectly.
        try {
          if (!(await pathExists(metadataPath))) {
            await rename(quarantineMeta, metadataPath);
          }
        } catch {
          // ignore
        }
        throw storeError(
          "credentials_store_error",
          "Failed to remove local credentials metadata",
          500,
        );
      }
    }

    // Final assertion: metadata must be gone.
    if (await pathExists(metadataPath)) {
      throw storeError(
        "credentials_store_error",
        "Local credentials metadata still present after delete",
        500,
      );
    }

    return {
      configured: false,
      readiness: "missing",
      hasAppId: false,
      hasKey: false,
      hasWebhook: false,
      updatedAt: null,
    };
  });
}

/**
 * Test helper: confirm lock constants (mirrors links-store pattern).
 * Not for production control flow.
 */
export function _testGithubAppCredentialStoreLockConfig(): {
  lockDirName: string;
  lockStaleMs: number;
  metadataFile: string;
  keyBasenamePattern: string;
} {
  return {
    lockDirName: CREDENTIALS_LOCK_DIR,
    lockStaleMs: LOCK_STALE_MS,
    metadataFile: CREDENTIALS_FILE,
    keyBasenamePattern: KEY_BASENAME_PATTERN.source,
  };
}

/**
 * Test helper: clear in-process queue (does not delete disk state).
 */
export function _testResetGithubAppCredentialStoreQueue(): void {
  processQueues.clear();
}
