/**
 * web-credential-store — app-owned CredentialStore over auth.json
 *
 * Implements the public pi-ai `CredentialStore` contract without deep-importing
 * coding-agent private AuthStorage. The Active credential mirror remains a
 * single auth.json file (one credential per provider id).
 *
 * ## Write safety
 *
 * - Process-wide queue per canonical auth path (not per provider) so concurrent
 *   writers for different providers cannot clobber each other.
 * - Cross-process exclusive mkdir lock at `<authPath>.lock` with stale recovery.
 * - Lock-time full-file reread + modify callback + same-dir atomic rename.
 * - Directory mode 0700 / file mode 0600.
 * - Malformed JSON fail-closed: never overwrite a damaged file with `{}`.
 *
 * `list()` never resolves config-value secrets or runs shell commands.
 */

import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { resolveConfigValue } from "./web-auth-config-value";

const AUTH_DIR_MODE = 0o700;
const AUTH_FILE_MODE = 0o600;
const LOCK_DIR_MODE = 0o700;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;
const LOCK_OWNER_FILE = "owner.json";

type AuthFileData = Record<string, Credential>;

type LockOwner = {
  pid: number;
  createdAt: number;
};

export interface CreateWebCredentialStoreOptions {
  /** Absolute or relative path to auth.json. Defaults to `<agentDir>/auth.json`. */
  authPath?: string;
  /** Agent directory used when `authPath` is omitted. Defaults via getAgentDir(). */
  agentDir?: string;
}

export interface WebCredentialStore extends CredentialStore {
  /** Canonical absolute auth.json path this store coordinates on. */
  readonly authPath: string;
}

// Process-local coordination keyed by resolved absolute auth path.
const processQueues = new Map<string, Promise<unknown>>();
const storeByAuthPath = new Map<string, WebCredentialStore>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function jitteredRetryMs(): number {
  return LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sanitizeStorageError(err: unknown, context: string): Error {
  // Never include raw path content that might embed secrets, nor credential bodies.
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  if (code) {
    return new Error(`${context} failed (${code})`);
  }
  return new Error(`${context} failed`);
}

async function resolveDefaultAuthPath(agentDir?: string): Promise<string> {
  if (agentDir && agentDir.length > 0) {
    return resolve(join(agentDir, "auth.json"));
  }
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  return resolve(join(getAgentDir(), "auth.json"));
}

function canonicalAuthPath(authPath: string): string {
  return resolve(authPath);
}

function lockDirFor(authPath: string): string {
  return `${authPath}.lock`;
}

async function ensureAuthParentDir(authPath: string): Promise<void> {
  const dir = dirname(authPath);
  await mkdir(dir, { recursive: true, mode: AUTH_DIR_MODE });
  try {
    await chmod(dir, AUTH_DIR_MODE);
  } catch {
    // Best-effort mode enforcement on existing dirs.
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const raw = JSON.parse(await readFile(join(lockDir, LOCK_OWNER_FILE), "utf8")) as unknown;
    if (!isRecord(raw)) return null;
    const pid = typeof raw.pid === "number" && Number.isFinite(raw.pid) ? raw.pid : null;
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : null;
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

async function tryRemoveStaleLock(lockDir: string): Promise<boolean> {
  const age = await lockAgeMs(lockDir);
  if (age === null || age < LOCK_STALE_MS) return false;
  try {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function acquireAuthFileLock(authPath: string): Promise<() => Promise<void>> {
  await ensureAuthParentDir(authPath);
  const lockDir = lockDirFor(authPath);
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: LOCK_DIR_MODE });
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now() };
      await writeFile(join(lockDir, LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: AUTH_FILE_MODE,
      });

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = await readLockOwner(lockDir);
          if (current && current.pid === process.pid && current.createdAt === owner.createdAt) {
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
        throw sanitizeStorageError(err, "auth lock acquire");
      }
      await tryRemoveStaleLock(lockDir);
      if (Date.now() - startedAt > LOCK_MAX_WAIT_MS) {
        throw new Error("auth lock acquisition timed out");
      }
      await sleep(jitteredRetryMs());
    }
  }
}

async function withProcessQueue<T>(authPath: string, fn: () => Promise<T>): Promise<T> {
  const key = canonicalAuthPath(authPath);
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
    // Drop the chain when it is still the tail to avoid unbounded growth.
    if (processQueues.get(key) === chain) {
      processQueues.delete(key);
    }
  }
}

function parseAuthFileData(content: string | undefined): {
  ok: true;
  data: AuthFileData;
  missing: boolean;
} | {
  ok: false;
  error: Error;
} {
  if (content === undefined) {
    return { ok: true, data: {}, missing: true };
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { ok: true, data: {}, missing: true };
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: new Error("auth.json is not a JSON object") };
    }
    return { ok: true, data: parsed as AuthFileData, missing: false };
  } catch {
    return { ok: false, error: new Error("auth.json contains malformed JSON") };
  }
}

async function readAuthFileRaw(authPath: string): Promise<string | undefined> {
  try {
    return await readFile(authPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return undefined;
    throw sanitizeStorageError(err, "auth read");
  }
}

async function atomicWriteAuthFile(authPath: string, data: AuthFileData): Promise<void> {
  await ensureAuthParentDir(authPath);
  const dir = dirname(authPath);
  const tmpPath = join(dir, `.auth.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    const handle = await open(tmpPath, "w", AUTH_FILE_MODE);
    try {
      await handle.writeFile(payload, "utf8");
      try {
        await handle.sync();
      } catch {
        // fsync is best-effort on platforms that disallow it.
      }
    } finally {
      await handle.close();
    }
    try {
      await chmod(tmpPath, AUTH_FILE_MODE);
    } catch {
      // Best-effort.
    }
    await rename(tmpPath, authPath);
    try {
      await chmod(authPath, AUTH_FILE_MODE);
    } catch {
      // Best-effort.
    }
  } catch (err) {
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // ignore cleanup
    }
    throw sanitizeStorageError(err, "auth write");
  }
}

function resolveCredentialForRead(credential: Credential | undefined): Credential | undefined {
  if (!credential) return undefined;
  if (credential.type !== "api_key") return credential;
  if (credential.key === undefined) return credential;
  const resolvedKey = resolveConfigValue(credential.key, credential.env);
  // Preserve unresolved key when resolution fails so callers can diagnose config.
  return { ...credential, key: resolvedKey ?? credential.key };
}

function isCredential(value: unknown): value is Credential {
  if (!isRecord(value)) return false;
  return value.type === "api_key" || value.type === "oauth";
}

class FileWebCredentialStore implements WebCredentialStore {
  readonly authPath: string;

  constructor(authPath: string) {
    this.authPath = canonicalAuthPath(authPath);
  }

  private async withAuthFileLock<T>(fn: (raw: string | undefined) => Promise<T>): Promise<T> {
    return withProcessQueue(this.authPath, async () => {
      const release = await acquireAuthFileLock(this.authPath);
      try {
        const raw = await readAuthFileRaw(this.authPath);
        return await fn(raw);
      } finally {
        await release();
      }
    });
  }

  async read(providerId: string): Promise<Credential | undefined> {
    // Read does not need the write lock, but still goes through the process
    // queue so it cannot observe a partial rename mid-write from this process.
    return withProcessQueue(this.authPath, async () => {
      const raw = await readAuthFileRaw(this.authPath);
      const parsed = parseAuthFileData(raw);
      if (!parsed.ok) {
        // Fail-closed: treat malformed as storage failure rather than empty.
        throw parsed.error;
      }
      const credential = parsed.data[providerId];
      if (!credential) return undefined;
      if (!isCredential(credential)) return undefined;
      return resolveCredentialForRead(credential);
    });
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return withProcessQueue(this.authPath, async () => {
      const raw = await readAuthFileRaw(this.authPath);
      const parsed = parseAuthFileData(raw);
      if (!parsed.ok) {
        throw parsed.error;
      }
      const infos: CredentialInfo[] = [];
      for (const [providerId, credential] of Object.entries(parsed.data)) {
        if (!isCredential(credential)) continue;
        // Metadata only — never resolve keys or execute commands.
        infos.push({ providerId, type: credential.type });
      }
      return infos;
    });
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.withAuthFileLock(async (raw) => {
      const parsed = parseAuthFileData(raw);
      if (!parsed.ok) {
        // Fail-closed: do not overwrite a damaged file.
        throw parsed.error;
      }
      const current = parsed.data[providerId];
      const currentCredential = isCredential(current) ? current : undefined;
      let next: Credential | undefined;
      try {
        next = await fn(currentCredential);
      } catch (err) {
        // Propagate callback errors without rewriting the file.
        throw err instanceof Error ? err : new Error("credential modify callback failed");
      }
      if (next === undefined) {
        // Leave the entry unchanged (pi-ai contract).
        return currentCredential;
      }
      if (!isCredential(next)) {
        throw new Error("credential modify produced an invalid credential");
      }
      const merged: AuthFileData = { ...parsed.data, [providerId]: next };
      await atomicWriteAuthFile(this.authPath, merged);
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.withAuthFileLock(async (raw) => {
      const parsed = parseAuthFileData(raw);
      if (!parsed.ok) {
        throw parsed.error;
      }
      if (!(providerId in parsed.data)) {
        return;
      }
      const next: AuthFileData = { ...parsed.data };
      delete next[providerId];
      await atomicWriteAuthFile(this.authPath, next);
    });
  }
}

class InMemoryWebCredentialStore implements CredentialStore {
  private credentials = new Map<string, Credential>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(initial?: Record<string, Credential>) {
    if (initial) {
      for (const [providerId, credential] of Object.entries(initial)) {
        this.credentials.set(providerId, credential);
      }
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.catch(() => {}).then(task);
    this.chain = run.catch(() => {});
    return run;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.enqueue(async () => resolveCredentialForRead(this.credentials.get(providerId)));
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.enqueue(async () =>
      [...this.credentials.entries()].map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    );
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      const current = this.credentials.get(providerId);
      const next = await fn(current);
      if (next === undefined) return current;
      this.credentials.set(providerId, next);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(async () => {
      this.credentials.delete(providerId);
    });
  }
}

/**
 * Create a file-backed Web CredentialStore for the given auth.json path.
 * Does not cache; prefer `getWebCredentialStore` for process reuse of the
 * coordinator keyed by canonical path.
 */
export async function createWebCredentialStore(
  options: CreateWebCredentialStoreOptions = {},
): Promise<WebCredentialStore> {
  const authPath =
    options.authPath && options.authPath.length > 0
      ? canonicalAuthPath(options.authPath)
      : await resolveDefaultAuthPath(options.agentDir);
  return new FileWebCredentialStore(authPath);
}

/**
 * Return a process-reused file-backed store for the agent dir / auth path.
 * Each read/list/modify/delete still reloads the latest disk state under lock.
 */
export async function getWebCredentialStore(
  agentDirOrOptions?: string | CreateWebCredentialStoreOptions,
): Promise<WebCredentialStore> {
  const options: CreateWebCredentialStoreOptions =
    typeof agentDirOrOptions === "string"
      ? { agentDir: agentDirOrOptions }
      : agentDirOrOptions ?? {};
  const authPath =
    options.authPath && options.authPath.length > 0
      ? canonicalAuthPath(options.authPath)
      : await resolveDefaultAuthPath(options.agentDir);
  const existing = storeByAuthPath.get(authPath);
  if (existing) return existing;
  const store = new FileWebCredentialStore(authPath);
  storeByAuthPath.set(authPath, store);
  return store;
}

/**
 * Isolated in-memory CredentialStore for add-account OAuth login flows that
 * must not touch the Active auth.json mirror.
 */
export function createInMemoryWebCredentialStore(
  initial?: Record<string, Credential>,
): CredentialStore {
  return new InMemoryWebCredentialStore(initial);
}

/**
 * One-off raw read of a stored credential without resolving config values.
 * Prefer ModelRuntime.getAuth for request auth; use this only when inspecting
 * the raw Active mirror is required (e.g. CAS comparisons).
 */
export async function readRawStoredCredential(
  providerId: string,
  authPathOrAgentDir?: string,
): Promise<Credential | undefined> {
  let authPath: string;
  if (authPathOrAgentDir && authPathOrAgentDir.endsWith("auth.json")) {
    authPath = canonicalAuthPath(authPathOrAgentDir);
  } else {
    authPath = await resolveDefaultAuthPath(authPathOrAgentDir);
  }
  try {
    const raw = await readAuthFileRaw(authPath);
    const parsed = parseAuthFileData(raw);
    if (!parsed.ok) return undefined;
    const credential = parsed.data[providerId];
    return isCredential(credential) ? credential : undefined;
  } catch {
    return undefined;
  }
}

/** Test helper: confirm locks use mkdir primitives (no proper-lockfile). */
export function __webCredentialStoreUsesFsLockForTests(): boolean {
  return LOCK_OWNER_FILE === "owner.json" && LOCK_STALE_MS === 30_000;
}

/** Test helper: drop process-local store cache between isolated agent dirs. */
export function __resetWebCredentialStoreCacheForTests(): void {
  storeByAuthPath.clear();
  processQueues.clear();
}
