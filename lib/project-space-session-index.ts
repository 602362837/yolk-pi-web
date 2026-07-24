/**
 * Project-space local session candidate index store (schema v1).
 *
 * Each Project Registry space owns:
 *   <space-root>/.ypi/sessions/index.v1.json
 *
 * JSONL under getAgentDir()/sessions/** remains the content/link truth.
 * This file is only a candidate + summary accelerator with strict identity,
 * path, ignore, and atomic write guards.
 *
 * PSI-01 scope: schema, path resolution, gitignore, cross-process lock,
 * process queue, lock-time merge, temp+rename, last-good retention.
 * Query/recovery/route wiring belongs to later subtasks.
 */

import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { PiWebProjectSpaceRecord } from "./project-registry-types";

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

export const PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION = 1 as const;
export const PROJECT_SPACE_SESSION_INDEX_KIND = "ypi-project-space-session-index" as const;
export const PROJECT_SPACE_SESSION_INDEX_FILE_NAME = "index.v1.json";
export const PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR = join(".ypi", "sessions");
export const PROJECT_SPACE_SESSION_INDEX_DIR_GITIGNORE = "*\n";
export const PROJECT_SPACE_SESSION_INDEX_EXCLUDE_MARKER =
  "# yolk-pi-web: project-space session candidate index";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_DIR_NAME = ".index.lock";
const LOCK_OWNER_PREFIX = "owner.";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

/** Hard bounds so a malicious/corrupt index cannot dominate the event loop. */
export const PROJECT_SPACE_SESSION_INDEX_MAX_BYTES = 4 * 1024 * 1024;
export const PROJECT_SPACE_SESSION_INDEX_MAX_ENTRIES = 2_000;
export const PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN = 128;
export const PROJECT_SPACE_SESSION_INDEX_MAX_PATH_LEN = 1_024;
export const PROJECT_SPACE_SESSION_INDEX_MAX_CWD_LEN = 1_024;
export const PROJECT_SPACE_SESSION_INDEX_MAX_NAME_LEN = 200;
export const PROJECT_SPACE_SESSION_INDEX_MAX_FIRST_MESSAGE_LEN = 100;
export const PROJECT_SPACE_SESSION_INDEX_MAX_STUDIO_FIELD_LEN = 200;

const ACTIVE_SESSION_FILE_RE =
  /^sessions\/(?:[^/\\]+\/)?[^/\\]+\.jsonl$/i;

// ── Types ────────────────────────────────────────────────────────────────────

export type ProjectSpaceSessionIndexCoverage = "complete" | "partial";

export interface ProjectSpaceSessionIndexStudioChildPointer {
  kind: "ypi-studio-child-session";
  taskId: string;
  runId: string;
  member: string;
  subtaskId?: string;
  parentSessionId?: string;
  status?: string;
}

export interface ProjectSpaceSessionIndexEntry {
  sessionId: string;
  /** Agent-dir relative path: sessions/<encoded-cwd>/<file>.jsonl */
  sessionFile: string;
  projectId: string;
  spaceId: string;
  cwd: string;
  cwdPathKey: string;
  fileMtimeMs: number;
  fileSize: number;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  name?: string;
  parentSessionId?: string;
  /** Agent-dir relative parent JSONL path when known. */
  parentSessionFile?: string;
  studioChild?: ProjectSpaceSessionIndexStudioChildPointer;
  updatedAt: string;
}

export interface ProjectSpaceSessionIndexFile {
  schemaVersion: typeof PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION;
  kind: typeof PROJECT_SPACE_SESSION_INDEX_KIND;
  projectId: string;
  spaceId: string;
  spacePathKey: string;
  coverage: ProjectSpaceSessionIndexCoverage;
  lastFullReconciledAt?: string;
  updatedAt: string;
  sessions: Record<string, ProjectSpaceSessionIndexEntry>;
}

export type ProjectSpaceSessionIndexSpaceLike = Pick<
  PiWebProjectSpaceRecord,
  "id" | "projectId" | "path" | "realPath" | "pathKey"
>;

export type ProjectSpaceSessionIndexErrorCode =
  | "identity_mismatch"
  | "path_unsafe"
  | "symlink_rejected"
  | "not_directory"
  | "unwritable"
  | "parse_error"
  | "schema_invalid"
  | "coverage_partial"
  | "entry_invalid"
  | "session_file_invalid"
  | "ignore_unverified"
  | "lock_timeout"
  | "write_failed"
  | "not_found";

export class ProjectSpaceSessionIndexError extends Error {
  readonly code: ProjectSpaceSessionIndexErrorCode;

  constructor(code: ProjectSpaceSessionIndexErrorCode, message: string) {
    super(message);
    this.name = "ProjectSpaceSessionIndexError";
    this.code = code;
  }
}

export interface ResolvedProjectSpaceSessionIndexPath {
  projectId: string;
  spaceId: string;
  spacePathKey: string;
  /** Canonical physical root used for the index (realPath preferred). */
  spaceRoot: string;
  indexDir: string;
  indexPath: string;
  lockDir: string;
  writable: boolean;
  missingSpaceRoot: boolean;
  /** Content-safe reason when not writable. */
  unwritableReason?: ProjectSpaceSessionIndexErrorCode;
}

export type ProjectSpaceSessionIndexParseResult =
  | { ok: true; index: ProjectSpaceSessionIndexFile }
  | { ok: false; code: ProjectSpaceSessionIndexErrorCode; reason: string };

export type ProjectSpaceSessionIndexReadResult =
  | {
      status: "ok";
      index: ProjectSpaceSessionIndexFile;
      resolved: ResolvedProjectSpaceSessionIndexPath;
      mtimeMs: number;
      size: number;
    }
  | {
      status: "missing";
      resolved: ResolvedProjectSpaceSessionIndexPath;
    }
  | {
      status: "invalid";
      resolved: ResolvedProjectSpaceSessionIndexPath;
      code: ProjectSpaceSessionIndexErrorCode;
      reason: string;
    };

export type ProjectSpaceSessionIndexWriteResult =
  | {
      ok: true;
      index: ProjectSpaceSessionIndexFile;
      resolved: ResolvedProjectSpaceSessionIndexPath;
      written: boolean;
    }
  | {
      ok: false;
      code: ProjectSpaceSessionIndexErrorCode;
      reason: string;
      resolved?: ResolvedProjectSpaceSessionIndexPath;
      /** Last-good on disk was preserved when possible. */
      lastGoodPreserved: boolean;
    };

export interface ProjectSpaceSessionIndexIgnoreResult {
  ok: boolean;
  strategy: "dir_gitignore" | "git_exclude" | "non_git" | "failed";
  warning?: string;
}

export interface ProjectSpaceSessionIndexMutateInput {
  current: ProjectSpaceSessionIndexFile | null;
  resolved: ResolvedProjectSpaceSessionIndexPath;
}

export type ProjectSpaceSessionIndexMutateDecision =
  | { action: "write"; index: ProjectSpaceSessionIndexFile }
  | { action: "skip"; index: ProjectSpaceSessionIndexFile | null }
  | { action: "clear" };

// ── Process queue (globalThis for Next dev reload) ───────────────────────────

type QueueState = {
  queues: Map<string, Promise<unknown>>;
};

function queueState(): QueueState {
  const g = globalThis as typeof globalThis & {
    __piProjectSpaceSessionIndexQueues?: QueueState;
  };
  if (!g.__piProjectSpaceSessionIndexQueues) {
    g.__piProjectSpaceSessionIndexQueues = { queues: new Map() };
  }
  return g.__piProjectSpaceSessionIndexQueues;
}

async function withProcessQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const state = queueState();
  const previous = state.queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const chain = previous.catch(() => {}).then(() => gate);
  state.queues.set(key, chain);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (state.queues.get(key) === chain) state.queues.delete(key);
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonNegFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function boundedString(
  value: unknown,
  maxLen: number,
  opts: { allowEmpty?: boolean } = {},
): string | null {
  if (typeof value !== "string") return null;
  if (value.length > maxLen) return null;
  if (!opts.allowEmpty && value.length === 0) return null;
  if (value.includes("\0")) return null;
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function jitteredRetryMs(): number {
  return LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1));
}

function isLivePid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function posixify(rel: string): string {
  return rel.split(/[\\/]+/).join("/");
}

/**
 * Validate an agentDir-relative active session path.
 * Only `sessions/.../*.jsonl` is allowed; archive/absolute/URL/`..` fail closed.
 */
export function isAgentDirRelativeSessionFile(sessionFile: string): boolean {
  if (typeof sessionFile !== "string" || !sessionFile) return false;
  if (sessionFile.length > PROJECT_SPACE_SESSION_INDEX_MAX_PATH_LEN) return false;
  if (isAbsolute(sessionFile)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(sessionFile)) return false;
  const normalized = posixify(normalize(sessionFile));
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../") || normalized.includes("\\")) {
    return false;
  }
  if (normalized.includes("\0")) return false;
  if (normalized.startsWith("sessions-archive/") || normalized.includes("/sessions-archive/")) {
    return false;
  }
  return ACTIVE_SESSION_FILE_RE.test(normalized);
}

/**
 * Resolve a validated agentDir-relative session path to an absolute path under
 * the active agent dir. Returns null on any containment failure.
 */
export function resolveAgentDirRelativeSessionFile(
  sessionFile: string,
  agentDir: string = getAgentDir(),
): string | null {
  if (!isAgentDirRelativeSessionFile(sessionFile)) return null;
  const root = resolve(agentDir);
  const absolute = resolve(root, posixify(sessionFile));
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (!posixify(rel).startsWith("sessions/")) return null;
  return absolute;
}

export function toAgentDirRelativeSessionFile(
  absoluteSessionPath: string,
  agentDir: string = getAgentDir(),
): string | null {
  if (typeof absoluteSessionPath !== "string" || !absoluteSessionPath) return null;
  const root = resolve(agentDir);
  const absolute = resolve(absoluteSessionPath);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const posix = posixify(rel);
  return isAgentDirRelativeSessionFile(posix) ? posix : null;
}

function emptyIndex(identity: {
  projectId: string;
  spaceId: string;
  spacePathKey: string;
  coverage?: ProjectSpaceSessionIndexCoverage;
}): ProjectSpaceSessionIndexFile {
  return {
    schemaVersion: PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION,
    kind: PROJECT_SPACE_SESSION_INDEX_KIND,
    projectId: identity.projectId,
    spaceId: identity.spaceId,
    spacePathKey: identity.spacePathKey,
    coverage: identity.coverage ?? "complete",
    updatedAt: nowIso(),
    sessions: {},
  };
}

export function createEmptyProjectSpaceSessionIndex(identity: {
  projectId: string;
  spaceId: string;
  spacePathKey: string;
  coverage?: ProjectSpaceSessionIndexCoverage;
}): ProjectSpaceSessionIndexFile {
  return emptyIndex(identity);
}

// ── Schema parse (strict / fail closed) ──────────────────────────────────────

function parseStudioChild(value: unknown): ProjectSpaceSessionIndexStudioChildPointer | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "ypi-studio-child-session") return null;
  const taskId = boundedString(value.taskId, PROJECT_SPACE_SESSION_INDEX_MAX_STUDIO_FIELD_LEN);
  const runId = boundedString(value.runId, PROJECT_SPACE_SESSION_INDEX_MAX_STUDIO_FIELD_LEN);
  const member = boundedString(value.member, PROJECT_SPACE_SESSION_INDEX_MAX_STUDIO_FIELD_LEN);
  if (!taskId || !runId || !member) return null;

  // Explicitly drop non-allowlisted fields (contextId/prompt/output/etc.).
  const pointer: ProjectSpaceSessionIndexStudioChildPointer = {
    kind: "ypi-studio-child-session",
    taskId,
    runId,
    member,
  };

  if (value.subtaskId !== undefined) {
    const subtaskId = boundedString(value.subtaskId, PROJECT_SPACE_SESSION_INDEX_MAX_STUDIO_FIELD_LEN);
    if (!subtaskId) return null;
    pointer.subtaskId = subtaskId;
  }
  if (value.parentSessionId !== undefined) {
    const parentSessionId = boundedString(value.parentSessionId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
    if (!parentSessionId) return null;
    pointer.parentSessionId = parentSessionId;
  }
  if (value.status !== undefined) {
    const status = boundedString(value.status, PROJECT_SPACE_SESSION_INDEX_MAX_STUDIO_FIELD_LEN);
    if (!status) return null;
    pointer.status = status;
  }
  return pointer;
}

function parseEntry(
  key: string,
  value: unknown,
  expected?: { projectId: string; spaceId: string },
): ProjectSpaceSessionIndexEntry | null {
  if (!isRecord(value)) return null;
  const sessionId = boundedString(value.sessionId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
  if (!sessionId || sessionId !== key) return null;

  const sessionFileRaw = boundedString(value.sessionFile, PROJECT_SPACE_SESSION_INDEX_MAX_PATH_LEN);
  if (!sessionFileRaw || !isAgentDirRelativeSessionFile(sessionFileRaw)) return null;
  const sessionFile = posixify(normalize(sessionFileRaw));

  const projectId = boundedString(value.projectId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
  const spaceId = boundedString(value.spaceId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
  if (!projectId || !spaceId) return null;
  if (expected && (projectId !== expected.projectId || spaceId !== expected.spaceId)) return null;

  const cwd = boundedString(value.cwd, PROJECT_SPACE_SESSION_INDEX_MAX_CWD_LEN);
  const cwdPathKey = boundedString(value.cwdPathKey, PROJECT_SPACE_SESSION_INDEX_MAX_CWD_LEN);
  if (!cwd || !cwdPathKey) return null;

  if (!isNonNegFinite(value.fileMtimeMs) || !isNonNegFinite(value.fileSize)) return null;
  if (!isIsoDate(value.created) || !isIsoDate(value.modified) || !isIsoDate(value.updatedAt)) return null;
  if (!isNonNegInt(value.messageCount)) return null;

  const firstMessage = boundedString(value.firstMessage, PROJECT_SPACE_SESSION_INDEX_MAX_FIRST_MESSAGE_LEN, {
    allowEmpty: true,
  });
  if (firstMessage === null) return null;

  const entry: ProjectSpaceSessionIndexEntry = {
    sessionId,
    sessionFile,
    projectId,
    spaceId,
    cwd,
    cwdPathKey,
    fileMtimeMs: value.fileMtimeMs,
    fileSize: value.fileSize,
    created: value.created,
    modified: value.modified,
    messageCount: value.messageCount,
    firstMessage,
    updatedAt: value.updatedAt,
  };

  if (value.name !== undefined) {
    const name = boundedString(value.name, PROJECT_SPACE_SESSION_INDEX_MAX_NAME_LEN);
    if (!name) return null;
    entry.name = name;
  }
  if (value.parentSessionId !== undefined) {
    const parentSessionId = boundedString(value.parentSessionId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
    if (!parentSessionId) return null;
    entry.parentSessionId = parentSessionId;
  }
  if (value.parentSessionFile !== undefined) {
    const parentSessionFileRaw = boundedString(value.parentSessionFile, PROJECT_SPACE_SESSION_INDEX_MAX_PATH_LEN);
    if (!parentSessionFileRaw || !isAgentDirRelativeSessionFile(parentSessionFileRaw)) return null;
    entry.parentSessionFile = posixify(normalize(parentSessionFileRaw));
  }
  if (value.studioChild !== undefined) {
    const studioChild = parseStudioChild(value.studioChild);
    if (!studioChild) return null;
    entry.studioChild = studioChild;
  }

  return entry;
}

/**
 * Strict schema-v1 parse. Future schema / wrong kind / identity mismatch /
 * oversize maps fail closed.
 */
export function parseProjectSpaceSessionIndex(
  raw: unknown,
  expectedIdentity?: {
    projectId: string;
    spaceId: string;
    spacePathKey?: string;
    /** When true (default for hot path), reject coverage:"partial". */
    requireComplete?: boolean;
  },
): ProjectSpaceSessionIndexParseResult {
  if (!isRecord(raw)) {
    return { ok: false, code: "schema_invalid", reason: "root_not_object" };
  }
  if (raw.schemaVersion !== PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION) {
    return { ok: false, code: "schema_invalid", reason: "schema_version" };
  }
  if (raw.kind !== PROJECT_SPACE_SESSION_INDEX_KIND) {
    return { ok: false, code: "schema_invalid", reason: "kind" };
  }

  const projectId = boundedString(raw.projectId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
  const spaceId = boundedString(raw.spaceId, PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN);
  const spacePathKey = boundedString(raw.spacePathKey, PROJECT_SPACE_SESSION_INDEX_MAX_CWD_LEN);
  if (!projectId || !spaceId || !spacePathKey) {
    return { ok: false, code: "schema_invalid", reason: "identity_fields" };
  }
  if (!isIsoDate(raw.updatedAt)) {
    return { ok: false, code: "schema_invalid", reason: "updatedAt" };
  }
  if (raw.coverage !== "complete" && raw.coverage !== "partial") {
    return { ok: false, code: "schema_invalid", reason: "coverage" };
  }

  if (expectedIdentity) {
    if (projectId !== expectedIdentity.projectId || spaceId !== expectedIdentity.spaceId) {
      return { ok: false, code: "identity_mismatch", reason: "project_or_space" };
    }
    if (
      expectedIdentity.spacePathKey !== undefined &&
      spacePathKey !== expectedIdentity.spacePathKey
    ) {
      return { ok: false, code: "identity_mismatch", reason: "spacePathKey" };
    }
    if (expectedIdentity.requireComplete !== false && raw.coverage === "partial") {
      return { ok: false, code: "coverage_partial", reason: "partial" };
    }
  }

  if (!isRecord(raw.sessions)) {
    return { ok: false, code: "schema_invalid", reason: "sessions" };
  }

  const keys = Object.keys(raw.sessions);
  if (keys.length > PROJECT_SPACE_SESSION_INDEX_MAX_ENTRIES) {
    return { ok: false, code: "schema_invalid", reason: "entry_count" };
  }

  const sessions: Record<string, ProjectSpaceSessionIndexEntry> = {};
  for (const key of keys) {
    if (key.length > PROJECT_SPACE_SESSION_INDEX_MAX_ID_LEN) {
      return { ok: false, code: "entry_invalid", reason: "session_key_len" };
    }
    const entry = parseEntry(key, raw.sessions[key], { projectId, spaceId });
    if (!entry) {
      return { ok: false, code: "entry_invalid", reason: "entry" };
    }
    sessions[key] = entry;
  }

  let lastFullReconciledAt: string | undefined;
  if (raw.lastFullReconciledAt !== undefined) {
    if (!isIsoDate(raw.lastFullReconciledAt)) {
      return { ok: false, code: "schema_invalid", reason: "lastFullReconciledAt" };
    }
    lastFullReconciledAt = raw.lastFullReconciledAt;
  }

  return {
    ok: true,
    index: {
      schemaVersion: PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION,
      kind: PROJECT_SPACE_SESSION_INDEX_KIND,
      projectId,
      spaceId,
      spacePathKey,
      coverage: raw.coverage,
      ...(lastFullReconciledAt ? { lastFullReconciledAt } : {}),
      updatedAt: raw.updatedAt,
      sessions,
    },
  };
}

export function normalizeProjectSpaceSessionIndexEntry(
  input: ProjectSpaceSessionIndexEntry,
): ProjectSpaceSessionIndexEntry | null {
  return parseEntry(input.sessionId, input, {
    projectId: input.projectId,
    spaceId: input.spaceId,
  });
}

// ── Path resolution ──────────────────────────────────────────────────────────

/**
 * Local path canonicalization matching Project Registry pathKey rules
 * (`lib/project-registry.ts` canonicalizeProjectPath) without importing that
 * module (keeps this store loadable under the focused strip-loader tests).
 */
async function canonicalizeSpacePath(inputPath: string): Promise<{
  displayPath: string;
  realPath?: string;
  pathKey: string;
  missing: boolean;
}> {
  const trimmed = inputPath.trim();
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? resolve(homedir(), trimmed.slice(2))
        : trimmed;
  const stripped = expanded.replace(/[\\/]+$/, "") || expanded;
  const displayPath = normalize(isAbsolute(stripped) ? stripped : resolve(stripped));
  try {
    const resolvedRealPath = normalize(await realpath(displayPath)).replace(/[\\/]+$/, "") || displayPath;
    return { displayPath, realPath: resolvedRealPath, pathKey: resolvedRealPath, missing: false };
  } catch {
    return { displayPath, pathKey: displayPath, missing: true };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function lstatKind(
  path: string,
): Promise<"missing" | "symlink" | "directory" | "file" | "other"> {
  try {
    const st = await lstat(path);
    if (st.isSymbolicLink()) return "symlink";
    if (st.isDirectory()) return "directory";
    if (st.isFile()) return "file";
    return "other";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "other";
  }
}

/**
 * Resolve `<space-root>/.ypi/sessions/index.v1.json` for a registry space.
 * Rejects identity drift and symlink index containers.
 */
export async function resolveProjectSpaceSessionIndexPath(
  space: ProjectSpaceSessionIndexSpaceLike,
): Promise<ResolvedProjectSpaceSessionIndexPath> {
  const projectId = String(space.projectId ?? "").trim();
  const spaceId = String(space.id ?? "").trim();
  const registryPathKey = String(space.pathKey ?? "").trim();
  if (!projectId || !spaceId || !registryPathKey) {
    throw new ProjectSpaceSessionIndexError("identity_mismatch", "Space identity is incomplete");
  }

  const pathInfo = await canonicalizeSpacePath(space.path);
  if (pathInfo.pathKey !== registryPathKey) {
    // Try realPath alias when registry stores a display path that still maps to pathKey.
    if (space.realPath) {
      const realInfo = await canonicalizeSpacePath(space.realPath);
      if (realInfo.pathKey !== registryPathKey) {
        throw new ProjectSpaceSessionIndexError(
          "identity_mismatch",
          "Resolved space pathKey does not match registry",
        );
      }
    } else {
      throw new ProjectSpaceSessionIndexError(
        "identity_mismatch",
        "Resolved space pathKey does not match registry",
      );
    }
  }

  // Prefer physical root when available and still matching pathKey.
  let spaceRoot = pathInfo.realPath ?? pathInfo.displayPath;
  if (space.realPath) {
    const realInfo = await canonicalizeSpacePath(space.realPath);
    if (realInfo.pathKey === registryPathKey && realInfo.realPath) {
      spaceRoot = realInfo.realPath;
    } else if (realInfo.pathKey === registryPathKey) {
      spaceRoot = realInfo.displayPath;
    }
  }

  const missingSpaceRoot = pathInfo.missing && !(await pathExists(spaceRoot));
  const indexDir = join(spaceRoot, PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR);
  const indexPath = join(indexDir, PROJECT_SPACE_SESSION_INDEX_FILE_NAME);

  let writable = !missingSpaceRoot;
  let unwritableReason: ProjectSpaceSessionIndexErrorCode | undefined;

  if (missingSpaceRoot) {
    writable = false;
    unwritableReason = "not_found";
  } else {
    // Space root must be a real directory (not a symlink leaf we refuse to follow for index layout).
    const rootKind = await lstatKind(spaceRoot);
    if (rootKind === "symlink") {
      // Following a space-root symlink is allowed only after re-canonicalizing to pathKey;
      // the index container itself must not be a symlink.
      try {
        spaceRoot = await realpath(spaceRoot);
      } catch {
        writable = false;
        unwritableReason = "symlink_rejected";
      }
    } else if (rootKind !== "directory") {
      writable = false;
      unwritableReason = "not_directory";
    }

    for (const part of [
      join(spaceRoot, ".ypi"),
      join(spaceRoot, ".ypi", "sessions"),
    ]) {
      const kind = await lstatKind(part);
      if (kind === "symlink") {
        writable = false;
        unwritableReason = "symlink_rejected";
        break;
      }
      if (kind === "file" || kind === "other") {
        writable = false;
        unwritableReason = "not_directory";
        break;
      }
    }

    const indexKind = await lstatKind(indexPath);
    if (indexKind === "symlink") {
      writable = false;
      unwritableReason = "symlink_rejected";
    } else if (indexKind === "directory" || indexKind === "other") {
      writable = false;
      unwritableReason = "path_unsafe";
    }
  }

  return {
    projectId,
    spaceId,
    spacePathKey: registryPathKey,
    spaceRoot,
    indexDir: join(spaceRoot, PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR),
    indexPath: join(spaceRoot, PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR, PROJECT_SPACE_SESSION_INDEX_FILE_NAME),
    lockDir: join(spaceRoot, PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR, LOCK_DIR_NAME),
    writable,
    missingSpaceRoot,
    unwritableReason,
  };
}

// ── Git ignore guards ────────────────────────────────────────────────────────

async function isGitWorkTree(spaceRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", spaceRoot, "rev-parse", "--is-inside-work-tree"],
      { timeout: 3_000, windowsHide: true, maxBuffer: 64 * 1024 },
    );
    return String(stdout).trim() === "true";
  } catch {
    return false;
  }
}

async function gitCheckIgnored(spaceRoot: string, relativePath: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", spaceRoot, "check-ignore", "-q", "--", relativePath],
      { timeout: 3_000, windowsHide: true, maxBuffer: 64 * 1024 },
    );
    return true;
  } catch (err) {
    const code = (err as { code?: number | string } | undefined)?.code;
    // git check-ignore exits 1 when not ignored.
    if (code === 1) return false;
    return false;
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function ensureDirGitignore(indexDir: string): Promise<"created" | "ok" | "conflict"> {
  const gitignorePath = join(indexDir, ".gitignore");
  const existing = await readTextIfExists(gitignorePath);
  if (existing === null) {
    await writeFile(gitignorePath, PROJECT_SPACE_SESSION_INDEX_DIR_GITIGNORE, {
      encoding: "utf8",
      mode: FILE_MODE,
    });
    await chmodBestEffort(gitignorePath, FILE_MODE);
    return "created";
  }
  const trimmed = existing.trim();
  // Accept exact `*` or files that already ignore everything in this directory.
  if (trimmed === "*" || /(^|\n)\*(#|\s|$)/.test(`\n${trimmed}\n`)) {
    return "ok";
  }
  // Do not overwrite user-authored rules.
  return "conflict";
}

async function ensureGitExclude(spaceRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", spaceRoot, "rev-parse", "--git-dir"],
      { timeout: 3_000, windowsHide: true, maxBuffer: 64 * 1024 },
    );
    const gitDirRaw = String(stdout).trim();
    if (!gitDirRaw) return false;
    const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolve(spaceRoot, gitDirRaw);
    const infoDir = join(gitDir, "info");
    await mkdir(infoDir, { recursive: true, mode: DIR_MODE });
    const excludePath = join(infoDir, "exclude");
    const existing = (await readTextIfExists(excludePath)) ?? "";
    const rule = ".ypi/sessions/";
    if (existing.includes(PROJECT_SPACE_SESSION_INDEX_EXCLUDE_MARKER) && existing.includes(rule)) {
      return true;
    }
    const block = `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${PROJECT_SPACE_SESSION_INDEX_EXCLUDE_MARKER}\n${rule}\n`;
    await writeFile(excludePath, `${existing}${block}`, { encoding: "utf8", mode: FILE_MODE });
    await chmodBestEffort(excludePath, FILE_MODE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the index directory is Git-ignored without hiding the rest of `.ypi/`.
 * Non-git spaces only need the directory-local `*` gitignore.
 */
export async function ensureProjectSpaceSessionIndexIgnore(
  spaceRoot: string,
): Promise<ProjectSpaceSessionIndexIgnoreResult> {
  const indexDir = join(spaceRoot, PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR);
  await mkdir(indexDir, { recursive: true, mode: DIR_MODE });
  await chmodBestEffort(indexDir, DIR_MODE);

  // Refuse if sessions dir became a symlink after mkdir (TOCTOU soft check).
  if ((await lstatKind(indexDir)) === "symlink") {
    return { ok: false, strategy: "failed", warning: "sessions_dir_symlink" };
  }

  const dirState = await ensureDirGitignore(indexDir);
  if (dirState === "conflict") {
    // Fall through to exclude / verification without overwriting.
  }

  const inGit = await isGitWorkTree(spaceRoot);
  if (!inGit) {
    return { ok: true, strategy: "non_git" };
  }

  const relativeIndex = `${PROJECT_SPACE_SESSION_INDEX_RELATIVE_DIR.split(sep).join("/")}/${PROJECT_SPACE_SESSION_INDEX_FILE_NAME}`;
  if (await gitCheckIgnored(spaceRoot, relativeIndex)) {
    return {
      ok: true,
      strategy: dirState === "conflict" ? "git_exclude" : "dir_gitignore",
    };
  }

  const excludeOk = await ensureGitExclude(spaceRoot);
  if (excludeOk && (await gitCheckIgnored(spaceRoot, relativeIndex))) {
    return { ok: true, strategy: "git_exclude" };
  }

  return {
    ok: false,
    strategy: "failed",
    warning: "check_ignore_failed",
  };
}

// ── Cross-process lock ───────────────────────────────────────────────────────

type LockOwner = {
  pid: number;
  createdAt: number;
  id: string;
};

async function chmodBestEffort(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch {
    // platform dependent
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const names = await readdir(lockDir);
    const uniqueOwner = names.find(
      (name) => name.startsWith(LOCK_OWNER_PREFIX) && name.endsWith(".json"),
    );
    if (!uniqueOwner) return null;
    const raw = JSON.parse(await readFile(join(lockDir, uniqueOwner), "utf8")) as unknown;
    if (!isRecord(raw)) return null;
    const pid = typeof raw.pid === "number" && Number.isFinite(raw.pid) ? raw.pid : null;
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : null;
    const id = typeof raw.id === "string" ? raw.id : null;
    if (pid === null || createdAt === null || !id) return null;
    return { pid, createdAt, id };
  } catch {
    return null;
  }
}

async function tryRemoveStaleLock(lockDir: string): Promise<boolean> {
  const owner = await readLockOwner(lockDir);
  const age = owner
    ? Date.now() - owner.createdAt
    : await (async () => {
        try {
          const st = await stat(lockDir);
          return Date.now() - st.mtimeMs;
        } catch {
          return null;
        }
      })();
  if (age === null || age < LOCK_STALE_MS) return false;
  // Never steal from a live owner.
  if (owner && isLivePid(owner.pid)) return false;

  const quarantineDir = `${lockDir}.stale-${randomUUID()}`;
  try {
    await rename(lockDir, quarantineDir);
    await rm(quarantineDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function acquireIndexFsLock(
  resolved: ResolvedProjectSpaceSessionIndexPath,
): Promise<() => Promise<void>> {
  await mkdir(resolved.indexDir, { recursive: true, mode: DIR_MODE });
  await chmodBestEffort(resolved.indexDir, DIR_MODE);

  const lockDir = resolved.lockDir;
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: DIR_MODE });
      const id = randomUUID();
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now(), id };
      const ownerPath = join(lockDir, `${LOCK_OWNER_PREFIX}${id}.json`);
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: FILE_MODE,
      });

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await unlink(ownerPath);
          await rmdir(lockDir);
        } catch {
          // Stale recovery may have replaced the directory; never rm -rf on release.
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") throw err;
      await tryRemoveStaleLock(lockDir);
      if (Date.now() - startedAt > LOCK_MAX_WAIT_MS) {
        throw new ProjectSpaceSessionIndexError("lock_timeout", "Session index lock timed out");
      }
      await sleep(jitteredRetryMs());
    }
  }
}

// ── Read / write ─────────────────────────────────────────────────────────────

async function readIndexFileRaw(
  resolved: ResolvedProjectSpaceSessionIndexPath,
  options: { requireComplete?: boolean } = {},
): Promise<ProjectSpaceSessionIndexReadResult> {
  try {
    const st = await lstat(resolved.indexPath);
    if (st.isSymbolicLink()) {
      return {
        status: "invalid",
        resolved,
        code: "symlink_rejected",
        reason: "index_symlink",
      };
    }
    if (!st.isFile()) {
      return {
        status: "invalid",
        resolved,
        code: "path_unsafe",
        reason: "index_not_file",
      };
    }
    if (st.size > PROJECT_SPACE_SESSION_INDEX_MAX_BYTES) {
      return {
        status: "invalid",
        resolved,
        code: "schema_invalid",
        reason: "index_too_large",
      };
    }

    const rawText = await readFile(resolved.indexPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return {
        status: "invalid",
        resolved,
        code: "parse_error",
        reason: "json",
      };
    }

    const result = parseProjectSpaceSessionIndex(parsed, {
      projectId: resolved.projectId,
      spaceId: resolved.spaceId,
      spacePathKey: resolved.spacePathKey,
      requireComplete: options.requireComplete,
    });
    if (!result.ok) {
      return {
        status: "invalid",
        resolved,
        code: result.code,
        reason: result.reason,
      };
    }

    return {
      status: "ok",
      index: result.index,
      resolved,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", resolved };
    }
    return {
      status: "invalid",
      resolved,
      code: "parse_error",
      reason: "read_failed",
    };
  }
}

export async function readProjectSpaceSessionIndex(
  space: ProjectSpaceSessionIndexSpaceLike,
  options: { requireComplete?: boolean } = {},
): Promise<ProjectSpaceSessionIndexReadResult> {
  const resolved = await resolveProjectSpaceSessionIndexPath(space);
  return readIndexFileRaw(resolved, options);
}

async function writeIndexAtomic(
  resolved: ResolvedProjectSpaceSessionIndexPath,
  index: ProjectSpaceSessionIndexFile,
): Promise<void> {
  const payload = `${JSON.stringify(index, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > PROJECT_SPACE_SESSION_INDEX_MAX_BYTES) {
    throw new ProjectSpaceSessionIndexError("write_failed", "Index payload exceeds size limit");
  }

  await mkdir(resolved.indexDir, { recursive: true, mode: DIR_MODE });
  await chmodBestEffort(resolved.indexDir, DIR_MODE);

  if ((await lstatKind(resolved.indexDir)) === "symlink") {
    throw new ProjectSpaceSessionIndexError("symlink_rejected", "Index directory is a symlink");
  }

  const tmpPath = join(
    resolved.indexDir,
    `.${PROJECT_SPACE_SESSION_INDEX_FILE_NAME}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );

  try {
    await writeFile(tmpPath, payload, { encoding: "utf8", mode: FILE_MODE });
    await chmodBestEffort(tmpPath, FILE_MODE);
    await rename(tmpPath, resolved.indexPath);
    await chmodBestEffort(resolved.indexPath, FILE_MODE);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // best-effort
    }
    if (err instanceof ProjectSpaceSessionIndexError) throw err;
    throw new ProjectSpaceSessionIndexError(
      "write_failed",
      err instanceof Error ? err.message : "write_failed",
    );
  }
}

function assertIndexIdentity(
  index: ProjectSpaceSessionIndexFile,
  resolved: ResolvedProjectSpaceSessionIndexPath,
): void {
  if (
    index.projectId !== resolved.projectId ||
    index.spaceId !== resolved.spaceId ||
    index.spacePathKey !== resolved.spacePathKey
  ) {
    throw new ProjectSpaceSessionIndexError("identity_mismatch", "Index identity does not match space");
  }
  if (index.schemaVersion !== PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION) {
    throw new ProjectSpaceSessionIndexError("schema_invalid", "Unsupported schemaVersion");
  }
  if (index.kind !== PROJECT_SPACE_SESSION_INDEX_KIND) {
    throw new ProjectSpaceSessionIndexError("schema_invalid", "Unsupported kind");
  }
  const entryCount = Object.keys(index.sessions).length;
  if (entryCount > PROJECT_SPACE_SESSION_INDEX_MAX_ENTRIES) {
    throw new ProjectSpaceSessionIndexError("entry_invalid", "Too many entries");
  }
  for (const [key, entry] of Object.entries(index.sessions)) {
    const normalized = parseEntry(key, entry, {
      projectId: resolved.projectId,
      spaceId: resolved.spaceId,
    });
    if (!normalized) {
      throw new ProjectSpaceSessionIndexError("entry_invalid", "Invalid entry");
    }
    index.sessions[key] = normalized;
  }
}

/**
 * Lock-protected mutation with lock-time reread/merge and last-good retention.
 * Does not write when ignore guards cannot be established.
 */
export async function mutateProjectSpaceSessionIndex(
  space: ProjectSpaceSessionIndexSpaceLike,
  mutator: (
    input: ProjectSpaceSessionIndexMutateInput,
  ) => ProjectSpaceSessionIndexMutateDecision | Promise<ProjectSpaceSessionIndexMutateDecision>,
): Promise<ProjectSpaceSessionIndexWriteResult> {
  let resolved: ResolvedProjectSpaceSessionIndexPath;
  try {
    resolved = await resolveProjectSpaceSessionIndexPath(space);
  } catch (err) {
    const code =
      err instanceof ProjectSpaceSessionIndexError ? err.code : ("path_unsafe" as const);
    return {
      ok: false,
      code,
      reason: err instanceof Error ? err.message : "resolve_failed",
      lastGoodPreserved: true,
    };
  }

  if (!resolved.writable) {
    return {
      ok: false,
      code: resolved.unwritableReason ?? "unwritable",
      reason: "space_index_not_writable",
      resolved,
      lastGoodPreserved: true,
    };
  }

  return withProcessQueue(resolved.indexPath, async () => {
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireIndexFsLock(resolved);

      const ignore = await ensureProjectSpaceSessionIndexIgnore(resolved.spaceRoot);
      if (!ignore.ok) {
        return {
          ok: false,
          code: "ignore_unverified",
          reason: ignore.warning ?? "ignore_unverified",
          resolved,
          lastGoodPreserved: true,
        };
      }

      // Lock-time reread: merge against the freshest on-disk state.
      const currentRead = await readIndexFileRaw(resolved, { requireComplete: false });
      const current =
        currentRead.status === "ok"
          ? currentRead.index
          : null;

      const decision = await mutator({ current, resolved });
      if (decision.action === "skip") {
        return {
          ok: true,
          index:
            decision.index ??
            current ??
            emptyIndex({
              projectId: resolved.projectId,
              spaceId: resolved.spaceId,
              spacePathKey: resolved.spacePathKey,
            }),
          resolved,
          written: false,
        };
      }

      if (decision.action === "clear") {
        try {
          await unlink(resolved.indexPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            return {
              ok: false,
              code: "write_failed",
              reason: "clear_failed",
              resolved,
              lastGoodPreserved: true,
            };
          }
        }
        return {
          ok: true,
          index: emptyIndex({
            projectId: resolved.projectId,
            spaceId: resolved.spaceId,
            spacePathKey: resolved.spacePathKey,
          }),
          resolved,
          written: true,
        };
      }

      const next: ProjectSpaceSessionIndexFile = {
        ...decision.index,
        schemaVersion: PROJECT_SPACE_SESSION_INDEX_SCHEMA_VERSION,
        kind: PROJECT_SPACE_SESSION_INDEX_KIND,
        projectId: resolved.projectId,
        spaceId: resolved.spaceId,
        spacePathKey: resolved.spacePathKey,
        updatedAt: nowIso(),
      };
      assertIndexIdentity(next, resolved);

      try {
        await writeIndexAtomic(resolved, next);
      } catch (err) {
        return {
          ok: false,
          code:
            err instanceof ProjectSpaceSessionIndexError ? err.code : "write_failed",
          reason: err instanceof Error ? err.message : "write_failed",
          resolved,
          lastGoodPreserved: true,
        };
      }

      return { ok: true, index: next, resolved, written: true };
    } catch (err) {
      const code =
        err instanceof ProjectSpaceSessionIndexError ? err.code : ("write_failed" as const);
      return {
        ok: false,
        code,
        reason: err instanceof Error ? err.message : "mutate_failed",
        resolved,
        lastGoodPreserved: true,
      };
    } finally {
      if (release) await release();
    }
  });
}

export async function writeProjectSpaceSessionIndex(
  space: ProjectSpaceSessionIndexSpaceLike,
  index: ProjectSpaceSessionIndexFile,
): Promise<ProjectSpaceSessionIndexWriteResult> {
  return mutateProjectSpaceSessionIndex(space, () => ({ action: "write", index }));
}

export async function upsertProjectSpaceSessionIndexEntry(
  space: ProjectSpaceSessionIndexSpaceLike,
  entryInput: ProjectSpaceSessionIndexEntry,
): Promise<ProjectSpaceSessionIndexWriteResult> {
  const entry = normalizeProjectSpaceSessionIndexEntry({
    ...entryInput,
    projectId: String(space.projectId),
    spaceId: String(space.id),
    updatedAt: entryInput.updatedAt || nowIso(),
  });
  if (!entry) {
    return {
      ok: false,
      code: "entry_invalid",
      reason: "entry_invalid",
      lastGoodPreserved: true,
    };
  }

  return mutateProjectSpaceSessionIndex(space, ({ current, resolved }) => {
    const base =
      current &&
      current.projectId === resolved.projectId &&
      current.spaceId === resolved.spaceId &&
      current.spacePathKey === resolved.spacePathKey
        ? current
        : emptyIndex({
            projectId: resolved.projectId,
            spaceId: resolved.spaceId,
            spacePathKey: resolved.spacePathKey,
            coverage: "complete",
          });

    const sessions = { ...base.sessions, [entry.sessionId]: entry };
    return {
      action: "write",
      index: {
        ...base,
        coverage: base.coverage === "partial" ? "partial" : "complete",
        sessions,
      },
    };
  });
}

export async function removeProjectSpaceSessionIndexEntry(
  space: ProjectSpaceSessionIndexSpaceLike,
  sessionId: string,
): Promise<ProjectSpaceSessionIndexWriteResult> {
  const id = String(sessionId ?? "").trim();
  if (!id) {
    return {
      ok: false,
      code: "entry_invalid",
      reason: "sessionId",
      lastGoodPreserved: true,
    };
  }

  return mutateProjectSpaceSessionIndex(space, ({ current, resolved }) => {
    if (!current || !current.sessions[id]) {
      return {
        action: "skip",
        index:
          current ??
          emptyIndex({
            projectId: resolved.projectId,
            spaceId: resolved.spaceId,
            spacePathKey: resolved.spacePathKey,
          }),
      };
    }
    const sessions = { ...current.sessions };
    delete sessions[id];
    return {
      action: "write",
      index: {
        ...current,
        sessions,
      },
    };
  });
}

/** Test helper: clear in-process queues. */
export function __resetProjectSpaceSessionIndexForTests(): void {
  queueState().queues.clear();
}
