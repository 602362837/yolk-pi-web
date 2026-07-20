/**
 * Shared models.json storage coordination.
 *
 * Single writer boundary for ModelsConfig PUT, model-price PATCH, and future
 * OpenAI-compatible /models sync apply. Provides:
 * - JSONC-safe raw read + opaque SHA-256 revision
 * - same-dir temp + rename atomic write (best-effort 0600)
 * - pre-write backup
 * - in-process queue + cross-process mkdir lock
 *
 * Security contract:
 * - Never logs raw models.json, secrets, or mutate payloads.
 * - Parse errors fail closed (callers must not treat parseError as empty config).
 * - Lock metadata contains only pid/createdAt — no credential material.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS_FILE_MODE = 0o600;
const MODELS_DIR_MODE = 0o700;
/** Lock directory sibling of models.json (not a plain file). */
const LOCK_DIR_SUFFIX = ".lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

// ── JSON comment stripping ────────────────────────────────────────────────────

/**
 * Strip `//` line comments and trailing commas from JSON-like text,
 * leaving string literals untouched.
 *
 * Replicates the Pi SDK internal `stripJsonComments` utility since it is not
 * exported from the package.
 */
export function stripJsonComments(input: string): string {
  return input
    // Remove // line comments (preserve string content)
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    // Remove trailing commas before ] or }
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) =>
      tail ?? (m[0] === '"' ? m : ""),
    );
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getModelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}

/**
 * Pre-write backup path used by price patch and other models.json writers.
 * Kept as `.pi-price-backup` for compatibility with existing tests/tooling.
 */
export function getModelsJsonBackupPath(path?: string): string {
  const target = path ?? getModelsJsonPath();
  return `${target}.pi-price-backup`;
}

function modelsJsonLockDir(path?: string): string {
  const target = path ?? getModelsJsonPath();
  return `${target}${LOCK_DIR_SUFFIX}`;
}

// ── Revision ──────────────────────────────────────────────────────────────────

/**
 * Compute an opaque revision token for optimistic concurrency control.
 * Uses SHA-256 of the raw file content (or a deterministic empty token).
 */
export function computeRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Deterministic revision for the empty / non-existent models.json state. */
export const EMPTY_MODELS_JSON_REVISION = computeRevision("{}");

// ── Read ──────────────────────────────────────────────────────────────────────

export interface ModelsJsonReadResult {
  /** Raw file text (empty object JSON if file does not exist). */
  raw: string;
  /** Parsed JSON object. Empty object when missing or when parse failed. */
  parsed: Record<string, unknown>;
  /** Whether the file exists. */
  exists: boolean;
  /** Parse error message, if any. Callers must fail closed on this. */
  parseError?: string;
  /** Opaque revision token of the raw bytes (or empty-state revision). */
  revision: string;
}

/** @deprecated Prefer ModelsJsonReadResult; kept for model-price-config re-exports. */
export type ReadRawResult = ModelsJsonReadResult;

/**
 * Read models.json, returning the raw text, parsed object, and revision.
 * JSONC comments are stripped before parsing.
 *
 * Fail-closed: on parse error, `parseError` is set and `parsed` is `{}`.
 * Callers must not treat that empty object as a valid writable config.
 */
export function readModelsJsonRaw(): ModelsJsonReadResult {
  const path = getModelsJsonPath();
  if (!existsSync(path)) {
    return {
      raw: "{}",
      parsed: {},
      exists: false,
      revision: EMPTY_MODELS_JSON_REVISION,
    };
  }

  const raw = readFileSync(path, "utf8");
  const revision = computeRevision(raw);

  try {
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        raw,
        parsed: {},
        exists: true,
        parseError: "models.json root must be a JSON object",
        revision,
      };
    }
    return { raw, parsed, exists: true, revision };
  } catch (error) {
    return {
      raw,
      parsed: {},
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
      revision,
    };
  }
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Backup the current models.json before a write operation.
 * Returns the backup path or undefined if backup was not needed.
 */
export function backupModelsJson(): string | undefined {
  const path = getModelsJsonPath();
  if (!existsSync(path)) return undefined;

  const backupPath = getModelsJsonBackupPath();
  const content = readFileSync(path, "utf8");
  mkdirSync(dirname(backupPath), { recursive: true, mode: MODELS_DIR_MODE });
  writeFileSync(backupPath, content, { encoding: "utf8", mode: MODELS_FILE_MODE });
  try {
    chmodSync(backupPath, MODELS_FILE_MODE);
  } catch {
    // best-effort
  }
  return backupPath;
}

/**
 * Write content atomically to the models.json path.
 *
 * Uses temp file + rename for atomicity. Sets best-effort 0600 permissions.
 * Removes temp file on failure.
 */
export function writeModelsJsonAtomic(content: string): void {
  const targetPath = getModelsJsonPath();
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true, mode: MODELS_DIR_MODE });

  // Use a temp file in the same directory for atomic rename
  const tmpPath = join(dir, `.models.json.${randomBytes(6).toString("hex")}.tmp`);

  try {
    writeFileSync(tmpPath, content, { encoding: "utf8", mode: MODELS_FILE_MODE });
    try {
      chmodSync(tmpPath, MODELS_FILE_MODE);
    } catch {
      // chmod may not be needed on all platforms
    }
    renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

/**
 * Serialize a models.json object as clean pretty JSON with trailing newline.
 */
export function serializeModelsJson(data: Record<string, unknown>): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Restore models.json from a pre-write backup path (best-effort atomic).
 * Used when post-write verification fails.
 */
export function restoreModelsJsonFromBackup(backupPath: string): void {
  const content = readFileSync(backupPath, "utf8");
  writeModelsJsonAtomic(content);
}

// ── Cross-process mkdir lock + process queue ──────────────────────────────────

type LockOwner = {
  pid: number;
  createdAt: number;
};

/** In-process queue keyed by absolute models.json path. */
const processQueues = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredRetryMs(): number {
  return (
    LOCK_RETRY_MIN_MS +
    Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1))
  );
}

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

async function acquireModelsJsonFsLock(): Promise<() => Promise<void>> {
  const targetPath = getModelsJsonPath();
  const dir = dirname(targetPath);
  const lockDir = modelsJsonLockDir(targetPath);
  await mkdir(dir, { recursive: true, mode: MODELS_DIR_MODE });

  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: MODELS_DIR_MODE });
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now() };
      await writeFile(join(lockDir, LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: MODELS_FILE_MODE,
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
      if (code !== "EEXIST") throw err;

      await tryRemoveStaleLock(lockDir);

      if (Date.now() - startedAt > LOCK_MAX_WAIT_MS) {
        throw new Error("models.json write lock acquisition timed out");
      }
      await sleep(jitteredRetryMs());
    }
  }
}

async function withProcessQueue<T>(fn: () => Promise<T>): Promise<T> {
  const key = getModelsJsonPath();
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
 * Run `fn` under the shared models.json critical section.
 *
 * Always applies the in-process queue; on-disk mkdir lock adds cross-process
 * safety without third-party lock packages.
 *
 * Do not nest: callers that already hold this lock must not re-enter.
 */
export async function withModelsJsonWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
  return withProcessQueue(async () => {
    const release = await acquireModelsJsonFsLock();
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

export type ModelsJsonMutateOutcome<T> =
  | {
      ok: true;
      revision: string;
      /** True when a write occurred. */
      written: boolean;
      result: T;
    }
  | {
      ok: false;
      status: "stale_revision" | "parse_error" | "write_failed";
      revision: string;
      parseError?: string;
      error?: string;
    };

export interface MutateModelsJsonOptions<T> {
  /**
   * When set, the current revision must match or the mutation returns
   * `stale_revision` without writing.
   */
  expectedRevision?: string;
  /**
   * When true (default), refuse to mutate if the current file fails to parse.
   */
  failClosedOnParseError?: boolean;
  /**
   * When true (default), create a pre-write backup if the file exists.
   */
  backup?: boolean;
  /**
   * Pure-ish mutator. Receives a deep-ish snapshot of the current parsed object.
   * Return `{ data, result }` to write `data`, or `{ skip: true, result }` to
   * leave the file unchanged (still returns current revision).
   */
  mutate: (current: {
    parsed: Record<string, unknown>;
    revision: string;
    exists: boolean;
    raw: string;
  }) =>
    | { data: Record<string, unknown>; result: T }
    | { skip: true; result: T };
}

/**
 * Shared lock-protected read → optional revision check → mutate → atomic write.
 *
 * Used by model-price PATCH, ModelsConfig PUT, and future sync apply.
 */
export async function mutateModelsJsonUnderLock<T>(
  options: MutateModelsJsonOptions<T>,
): Promise<ModelsJsonMutateOutcome<T>> {
  const failClosedOnParseError = options.failClosedOnParseError !== false;
  const doBackup = options.backup !== false;

  return withModelsJsonWriteLock(async () => {
    const current = readModelsJsonRaw();

    if (current.parseError && failClosedOnParseError) {
      return {
        ok: false as const,
        status: "parse_error" as const,
        revision: current.revision,
        parseError: current.parseError,
      };
    }

    if (
      typeof options.expectedRevision === "string" &&
      options.expectedRevision.length > 0 &&
      options.expectedRevision !== current.revision
    ) {
      return {
        ok: false as const,
        status: "stale_revision" as const,
        revision: current.revision,
      };
    }

    // Clone so mutators cannot accidentally alias into a shared object graph
    // that might be held by callers outside the lock.
    const parsedClone = current.parseError
      ? {}
      : (JSON.parse(JSON.stringify(current.parsed)) as Record<string, unknown>);

    let mutation:
      | { data: Record<string, unknown>; result: T }
      | { skip: true; result: T };
    try {
      mutation = options.mutate({
        parsed: parsedClone,
        revision: current.revision,
        exists: current.exists,
        raw: current.raw,
      });
    } catch (error) {
      return {
        ok: false as const,
        status: "write_failed" as const,
        revision: current.revision,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if ("skip" in mutation && mutation.skip) {
      return {
        ok: true as const,
        revision: current.revision,
        written: false,
        result: mutation.result,
      };
    }

    const data = (mutation as { data: Record<string, unknown>; result: T }).data;
    const result = (mutation as { data: Record<string, unknown>; result: T }).result;
    const content = serializeModelsJson(data);

    if (doBackup) {
      try {
        backupModelsJson();
      } catch (error) {
        return {
          ok: false as const,
          status: "write_failed" as const,
          revision: current.revision,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    try {
      writeModelsJsonAtomic(content);
    } catch (error) {
      return {
        ok: false as const,
        status: "write_failed" as const,
        revision: current.revision,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      ok: true as const,
      revision: computeRevision(content),
      written: true,
      result,
    };
  });
}

/** Test helper: confirms locks use fs mkdir primitives (no proper-lockfile). */
export function __modelsJsonLockUsesFsPrimitivesForTests(): boolean {
  return LOCK_DIR_SUFFIX === ".lock" && LOCK_OWNER_FILE === "owner.json";
}
