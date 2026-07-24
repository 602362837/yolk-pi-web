/**
 * Project-space directed session list + safe recovery (PSI-02).
 *
 * Hot path:
 *   registry space → local index → directed encoded-cwd dirs only
 *   → stat + bounded header validate → rescan changed candidates only
 *
 * Recovery (missing/corrupt/partial/identity mismatch):
 *   legacy global seed + directed scan + global header-only discovery
 *   under keyed single-flight with a 10s hard budget.
 *
 * JSONL under getAgentDir()/sessions/** remains the content/link truth.
 * This module never moves JSONL and never calls listAllSessions /
 * scanSessionInventory on the hot path.
 */

import { createReadStream, existsSync } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { canonicalizeCwd, expandCwd } from "./cwd";
import type { PiWebProjectSpaceRecord } from "./project-registry-types";
import { listLegacyIndexedSessionsForSpace } from "./project-session-index";
// NOTE: do not statically import `project-registry` — its parameter properties
// break the focused strip-loader tests. Production callers either inject `space`
// or we dynamically import getProjectSpace only when needed.
import {
  createEmptyProjectSpaceSessionIndex,
  isAgentDirRelativeSessionFile,
  normalizeProjectSpaceSessionIndexEntry,
  readProjectSpaceSessionIndex,
  resolveAgentDirRelativeSessionFile,
  toAgentDirRelativeSessionFile,
  writeProjectSpaceSessionIndex,
  type ProjectSpaceSessionIndexEntry,
  type ProjectSpaceSessionIndexFile,
  type ProjectSpaceSessionIndexSpaceLike,
  type ProjectSpaceSessionIndexStudioChildPointer,
  PROJECT_SPACE_SESSION_INDEX_MAX_FIRST_MESSAGE_LEN,
} from "./project-space-session-index";
import { parseSessionHeaderMetadata } from "./session-header-metadata";
import {
  scanSessionMetadata,
  type LightweightSessionMetadata,
} from "./session-metadata-scanner";
import type { SessionListTimingCollector } from "./session-list-timing";
import {
  attachStudioChildDisplays,
  type StudioChildDisplayProjectionCounters,
} from "./studio-child-display-projection";
import type { SessionInfo, StudioChildSessionInfo } from "./types";

export {
  attachStudioChildDisplays,
  projectStudioChildDisplaysBatch,
  projectStudioChildDisplay,
  invalidateStudioChildDisplayProjection,
} from "./studio-child-display-projection";

// ── Constants ────────────────────────────────────────────────────────────────

const HEADER_READ_MAX_BYTES = 64 * 1024;
const DEFAULT_RECOVERY_BUDGET_MS = 10_000;
const FULL_RECONCILE_STALE_MS = 5 * 60 * 1000;
const HEADER_DISCOVERY_CONCURRENCY = 16;
const METADATA_SCAN_CONCURRENCY = 8;

export const PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING = "session_index_rebuilding" as const;

/** Env flag: set to `0` / `false` / `off` / `legacy` to roll the space route back to listAllSessions(). */
export const PROJECT_SPACE_SESSION_LIST_FLAG_ENV = "PI_WEB_PROJECT_SPACE_SESSION_LIST" as const;

const SPACE_LIST_SNAPSHOT_TTL_MS = 5_000;
const SPACE_LIST_SNAPSHOT_LIMIT = 32;

// ── Public types ─────────────────────────────────────────────────────────────

export type ProjectSpaceSessionListRecoveryReason =
  | "missing"
  | "corrupt"
  | "partial"
  | "identity_mismatch"
  | "forced"
  | "none";

export interface ListSessionsForProjectSpaceOptions {
  includeLegacy?: boolean;
  /** Bypass response snapshot when added; still validates candidates. */
  forceValidate?: boolean;
  /** Force a full header-only recovery even when a complete index exists. */
  forceFullReconcile?: boolean;
  /** Hard budget for recovery before 503 / last-good fallback. Default 10s. */
  recoveryBudgetMs?: number;
  /** Injected clock for tests. */
  now?: () => number;
  /** Injected agent dir (tests). Defaults to getAgentDir(). */
  agentDir?: string;
  /**
   * Injected registry space (tests / callers that already resolved the space).
   * When set, getProjectSpace is not called.
   */
  space?: ProjectSpaceSessionIndexSpaceLike & Partial<PiWebProjectSpaceRecord>;
  timing?: SessionListTimingCollector;
  /**
   * Optional I/O counters for focused tests / benchmarks.
   * Never populated with paths or content.
   */
  counters?: ProjectSpaceSessionListCounters;
}

export interface ProjectSpaceSessionListCounters {
  inventoryGlobalCalls: number;
  directedDirEnumerations: number;
  directedFilesSeen: number;
  headerReads: number;
  metadataScans: number;
  headerOnlyDiscoveryFiles: number;
  headerOnlyDiscoveryMatches: number;
  legacySeedCandidates: number;
  recoveryRuns: number;
  indexWrites: number;
  backgroundReconciles: number;
  /** Unique task detail loads after parent-visible Studio child filter. */
  studioProjectionCalls: number;
  /** listYpiStudioTasks(scope:all) fallback invocations. */
  studioListTasksCalls: number;
  /** Unique (cwdPathKey, taskId) groups among filtered children. */
  uniqueLinkedTasks: number;
  /** Children that received a display projection (including header-only). */
  studioChildrenProjected: number;
}

export interface ListSessionsForProjectSpaceResult {
  sessions: SessionInfo[];
  legacyUnassigned: SessionInfo[];
  studioChildrenByParentSessionId: Record<string, SessionInfo[]>;
  /** Content-safe diagnostics for tests/logs — never paths or titles. */
  diagnostics: {
    recoveryReason: ProjectSpaceSessionListRecoveryReason;
    usedLastGood: boolean;
    candidateCount: number;
    matchedCount: number;
    legacyCount: number;
    studioChildCount: number;
    metadataScans: number;
    headerReads: number;
    inventoryGlobalCalls: number;
    studioProjectionCalls: number;
    studioListTasksCalls: number;
    uniqueLinkedTasks: number;
    elapsedMs: number;
  };
}

export class ProjectSpaceSessionListError extends Error {
  readonly code: typeof PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING | "space_not_found" | "list_failed";
  readonly status: number;
  readonly retryAfterSec?: number;

  constructor(
    code: ProjectSpaceSessionListError["code"],
    message: string,
    options: { status?: number; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "ProjectSpaceSessionListError";
    this.code = code;
    this.status = options.status ?? (code === PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING ? 503 : 500);
    this.retryAfterSec = options.retryAfterSec;
  }
}

// ── Process state (globalThis for Next dev reload) ───────────────────────────

type RebuildFlight = {
  promise: Promise<ValidatedSpaceSessions>;
  startedAt: number;
};

type LastGoodCacheEntry = {
  key: string;
  projectId: string;
  spaceId: string;
  spacePathKey: string;
  savedAt: number;
  sessions: ValidatedSession[];
};

type ListState = {
  rebuilds: Map<string, RebuildFlight>;
  lastGood: Map<string, LastGoodCacheEntry>;
  backgroundReconciles: Map<string, Promise<void>>;
  /** Test hook: when true, next recovery sleeps past budget before completing. */
  testSlowRecoveryMs: number;
};

type SpaceListSnapshotEntry = {
  expiresAt: number;
  projectId: string;
  spaceId: string;
  spacePathKey: string;
  includeLegacy: boolean;
  value?: ListSessionsForProjectSpaceResult;
  pending?: Promise<ListSessionsForProjectSpaceResult>;
};

function listState(): ListState {
  const g = globalThis as typeof globalThis & {
    __piProjectSpaceSessionListState?: ListState;
  };
  if (!g.__piProjectSpaceSessionListState) {
    g.__piProjectSpaceSessionListState = {
      rebuilds: new Map(),
      lastGood: new Map(),
      backgroundReconciles: new Map(),
      testSlowRecoveryMs: 0,
    };
  }
  return g.__piProjectSpaceSessionListState;
}

/**
 * Bounded 5s response snapshot for project-space session lists.
 * Stored on globalThis so lifecycle invalidation (PSI-03) can clear without
 * importing this module. Schema is process-local only.
 */
function getSpaceListSnapshots(): Map<string, SpaceListSnapshotEntry> {
  const g = globalThis as typeof globalThis & {
    __piProjectSpaceSessionListSnapshots?: Map<string, SpaceListSnapshotEntry>;
  };
  if (!g.__piProjectSpaceSessionListSnapshots) {
    g.__piProjectSpaceSessionListSnapshots = new Map();
  }
  return g.__piProjectSpaceSessionListSnapshots;
}

function spaceListSnapshotKey(
  projectId: string,
  spaceId: string,
  spacePathKey: string,
  includeLegacy: boolean,
): string {
  return `${projectId}\0${spaceId}\0${spacePathKey}\0${includeLegacy ? "1" : "0"}`;
}

function cloneListResult(
  result: ListSessionsForProjectSpaceResult,
): ListSessionsForProjectSpaceResult {
  return {
    sessions: result.sessions.slice(),
    legacyUnassigned: result.legacyUnassigned.slice(),
    studioChildrenByParentSessionId: Object.fromEntries(
      Object.entries(result.studioChildrenByParentSessionId).map(([parentId, rows]) => [
        parentId,
        rows.slice(),
      ]),
    ),
    diagnostics: { ...result.diagnostics },
  };
}

function trimSpaceListSnapshots(cache: Map<string, SpaceListSnapshotEntry>): void {
  while (cache.size > SPACE_LIST_SNAPSHOT_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Single reader switch for PSI-05 code rollback. Default ON.
 * Disable with PI_WEB_PROJECT_SPACE_SESSION_LIST=0|false|off|legacy.
 */
export function isProjectSpaceSessionListEnabled(): boolean {
  const raw = process.env[PROJECT_SPACE_SESSION_LIST_FLAG_ENV];
  if (raw === undefined || raw === "") return true;
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "legacy" ||
    normalized === "listall"
  ) {
    return false;
  }
  return true;
}

/** Clear 5s space-list response snapshots (all or filtered by space identity). */
export function invalidateProjectSpaceSessionListSnapshots(filter?: {
  projectId?: string;
  spaceId?: string;
  spacePathKey?: string;
}): void {
  const cache = getSpaceListSnapshots();
  if (!filter?.projectId && !filter?.spaceId && !filter?.spacePathKey) {
    cache.clear();
    return;
  }
  for (const [key, entry] of cache) {
    if (filter.projectId && entry.projectId !== filter.projectId) continue;
    if (filter.spaceId && entry.spaceId !== filter.spaceId) continue;
    if (filter.spacePathKey && entry.spacePathKey !== filter.spacePathKey) continue;
    cache.delete(key);
  }
}

export function __resetProjectSpaceSessionListForTests(): void {
  const state = listState();
  state.rebuilds.clear();
  state.lastGood.clear();
  state.backgroundReconciles.clear();
  state.testSlowRecoveryMs = 0;
  invalidateProjectSpaceSessionListSnapshots();
}

/** Test-only: force the next recovery body to sleep before finishing. */
export function __setProjectSpaceSessionListTestSlowRecoveryMs(ms: number): void {
  listState().testSlowRecoveryMs = Math.max(0, ms);
}

export function createProjectSpaceSessionListCounters(): ProjectSpaceSessionListCounters {
  return {
    inventoryGlobalCalls: 0,
    directedDirEnumerations: 0,
    directedFilesSeen: 0,
    headerReads: 0,
    metadataScans: 0,
    headerOnlyDiscoveryFiles: 0,
    headerOnlyDiscoveryMatches: 0,
    legacySeedCandidates: 0,
    recoveryRuns: 0,
    indexWrites: 0,
    backgroundReconciles: 0,
    studioProjectionCalls: 0,
    studioListTasksCalls: 0,
    uniqueLinkedTasks: 0,
    studioChildrenProjected: 0,
  };
}

// ── Path / encode helpers (mirror Pi SDK layout) ─────────────────────────────

/**
 * Mirror `getDefaultSessionDirPath` from `@earendil-works/pi-coding-agent`
 * session-manager: `--${resolvedCwd with / and : → -}--`.
 */
export function encodeSessionCwdDirName(cwd: string): string {
  const expanded = expandCwd(cwd);
  const resolvedCwd = isAbsolute(expanded) ? resolve(expanded) : resolve(expanded);
  return `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function getEncodedSessionDirForCwd(
  cwd: string,
  agentDir: string = getAgentDir(),
): string {
  return join(resolve(agentDir), "sessions", encodeSessionCwdDirName(cwd));
}

function activeSessionsRoot(agentDir: string): string {
  return join(resolve(agentDir), "sessions");
}

function flightKey(projectId: string, spaceId: string, spacePathKey: string): string {
  return `${projectId}\0${spaceId}\0${spacePathKey}`;
}

function nowMs(now?: () => number): number {
  return now ? now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function bump(counters: ProjectSpaceSessionListCounters | undefined, key: keyof ProjectSpaceSessionListCounters, n = 1): void {
  if (!counters) return;
  counters[key] += n;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

// ── Bounded header read ──────────────────────────────────────────────────────

export interface BoundedSessionHeader {
  id: string;
  cwd: string;
  timestamp?: string;
  parentSession?: string;
  projectId?: string;
  spaceId?: string;
  studioChild?: StudioChildSessionInfo;
}

/**
 * Read only the first JSONL line (bounded). Never streams the whole file.
 */
export async function readBoundedSessionHeader(
  filePath: string,
  options: { counters?: ProjectSpaceSessionListCounters; maxBytes?: number } = {},
): Promise<BoundedSessionHeader | null> {
  bump(options.counters, "headerReads");
  const maxBytes = options.maxBytes ?? HEADER_READ_MAX_BYTES;
  try {
    const st = await lstat(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;

    const firstLine = await new Promise<string | null>((resolveLine, reject) => {
      const stream = createReadStream(filePath, {
        encoding: "utf8",
        start: 0,
        end: Math.max(0, maxBytes - 1),
        highWaterMark: 4 * 1024,
      });
      let buf = "";
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        resolveLine(value);
      };
      stream.on("data", (chunk: string | Buffer) => {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          finish(buf.slice(0, nl));
          return;
        }
        if (buf.length >= maxBytes) {
          finish(buf.slice(0, maxBytes));
        }
      });
      stream.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      stream.on("end", () => {
        if (!settled) finish(buf.length > 0 ? buf : null);
      });
    });

    if (!firstLine) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(firstLine);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.type !== "session" || typeof rec.id !== "string" || !rec.id.trim()) return null;
    const cwd = typeof rec.cwd === "string" ? rec.cwd : "";
    const meta = parseSessionHeaderMetadata(firstLine);
    const studioChild = meta.studioChild;
    return {
      id: rec.id.trim(),
      cwd,
      timestamp: typeof rec.timestamp === "string" ? rec.timestamp : undefined,
      parentSession: typeof rec.parentSession === "string" ? rec.parentSession : undefined,
      projectId: meta.projectLink.projectId,
      spaceId: meta.projectLink.spaceId,
      studioChild,
    };
  } catch {
    return null;
  }
}

// ── Candidate discovery ──────────────────────────────────────────────────────

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const st = await lstat(filePath);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function isUnderActiveSessionsRoot(absolutePath: string, agentDir: string): boolean {
  const root = resolve(activeSessionsRoot(agentDir));
  const abs = resolve(absolutePath);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  if (rel.split(sep).some((part) => part === ".." || part === "")) return false;
  return abs.endsWith(".jsonl");
}

/**
 * Enumerate `*.jsonl` directly under an encoded-cwd session directory.
 * Does not recurse into other project dirs.
 */
export async function enumerateJsonlInSessionDir(
  dirPath: string,
  options: { counters?: ProjectSpaceSessionListCounters } = {},
): Promise<string[]> {
  bump(options.counters, "directedDirEnumerations");
  try {
    const names = await readdir(dirPath);
    const files: string[] = [];
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      files.push(join(dirPath, name));
    }
    bump(options.counters, "directedFilesSeen", files.length);
    return files;
  } catch {
    return [];
  }
}

/**
 * Registry-known cwd aliases for a space → unique encoded session directories.
 */
export function resolveDirectedSessionDirs(
  space: ProjectSpaceSessionIndexSpaceLike,
  agentDir: string = getAgentDir(),
): string[] {
  const aliases = new Set<string>();
  for (const candidate of [space.path, space.realPath, space.pathKey]) {
    if (typeof candidate === "string" && candidate.trim()) aliases.add(candidate.trim());
  }
  const dirs = new Set<string>();
  for (const alias of aliases) {
    dirs.add(getEncodedSessionDirForCwd(alias, agentDir));
    // Also try canonicalizeCwd form when the path exists (symlink alias).
    try {
      const canon = canonicalizeCwd(alias);
      if (canon && canon !== alias) dirs.add(getEncodedSessionDirForCwd(canon, agentDir));
    } catch {
      // ignore
    }
  }
  return [...dirs];
}

async function enumerateDirectedCandidates(
  space: ProjectSpaceSessionIndexSpaceLike,
  agentDir: string,
  counters?: ProjectSpaceSessionListCounters,
): Promise<string[]> {
  const dirs = resolveDirectedSessionDirs(space, agentDir);
  const files = new Set<string>();
  for (const dir of dirs) {
    const listed = await enumerateJsonlInSessionDir(dir, { counters });
    for (const file of listed) {
      if (await isRegularFile(file) && isUnderActiveSessionsRoot(file, agentDir)) {
        files.add(resolve(file));
      }
    }
  }
  return [...files];
}

/**
 * Global active-root header-only discovery: list every active JSONL and read
 * only the first line. Does **not** stream message bodies (not scanSessionInventory).
 */
export async function discoverSessionsByHeaderLink(
  projectId: string,
  spaceId: string,
  options: {
    agentDir?: string;
    counters?: ProjectSpaceSessionListCounters;
    concurrency?: number;
  } = {},
): Promise<string[]> {
  const agentDir = options.agentDir ?? getAgentDir();
  const root = activeSessionsRoot(agentDir);
  if (!existsSync(root)) return [];

  const allFiles: string[] = [];
  let topEntries;
  try {
    topEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of topEntries) {
    if (entry.isDirectory()) {
      const dir = join(root, entry.name);
      try {
        const nested = await readdir(dir);
        for (const name of nested) {
          if (name.endsWith(".jsonl")) allFiles.push(join(dir, name));
        }
      } catch {
        // ignore unreadable cwd dir
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      allFiles.push(join(root, entry.name));
    }
  }

  bump(options.counters, "headerOnlyDiscoveryFiles", allFiles.length);

  const matches = await mapWithConcurrency(
    allFiles,
    options.concurrency ?? HEADER_DISCOVERY_CONCURRENCY,
    async (file) => {
      if (!(await isRegularFile(file))) return null;
      if (!isUnderActiveSessionsRoot(file, agentDir)) return null;
      const header = await readBoundedSessionHeader(file, { counters: options.counters });
      if (!header) return null;
      if (header.projectId === projectId && header.spaceId === spaceId) {
        bump(options.counters, "headerOnlyDiscoveryMatches");
        return resolve(file);
      }
      return null;
    },
  );

  return matches.filter((item): item is string => Boolean(item));
}

// ── Validation + summary ─────────────────────────────────────────────────────

interface CandidateSource {
  absolutePath: string;
  fromIndex?: ProjectSpaceSessionIndexEntry;
  fromLegacySeed?: boolean;
}

interface ValidatedSession {
  session: SessionInfo;
  entry: ProjectSpaceSessionIndexEntry;
  absolutePath: string;
}

interface ValidatedSpaceSessions {
  linked: ValidatedSession[];
  legacy: ValidatedSession[];
  index: ProjectSpaceSessionIndexFile;
  recoveryReason: ProjectSpaceSessionListRecoveryReason;
  metadataScans: number;
  headerReads: number;
}

function studioPointerFromHeader(
  studioChild: StudioChildSessionInfo | undefined,
): ProjectSpaceSessionIndexStudioChildPointer | undefined {
  if (!studioChild || studioChild.kind !== "ypi-studio-child-session") return undefined;
  if (!studioChild.taskId || !studioChild.runId || !studioChild.member) return undefined;
  const pointer: ProjectSpaceSessionIndexStudioChildPointer = {
    kind: "ypi-studio-child-session",
    taskId: studioChild.taskId,
    runId: studioChild.runId,
    member: studioChild.member,
  };
  if (studioChild.subtaskId) pointer.subtaskId = studioChild.subtaskId;
  if (studioChild.parentSessionId) pointer.parentSessionId = studioChild.parentSessionId;
  if (studioChild.status) pointer.status = String(studioChild.status);
  return pointer;
}

function studioInfoFromPointer(
  pointer: ProjectSpaceSessionIndexStudioChildPointer | undefined,
): StudioChildSessionInfo | undefined {
  if (!pointer) return undefined;
  return {
    schemaVersion: 1,
    kind: "ypi-studio-child-session",
    runner: "sdk",
    visibility: "child",
    taskId: pointer.taskId,
    runId: pointer.runId,
    member: pointer.member,
    subtaskId: pointer.subtaskId,
    parentSessionId: pointer.parentSessionId,
    status: pointer.status as StudioChildSessionInfo["status"],
  };
}

async function pathKeyForCwd(cwd: string | undefined): Promise<string | null> {
  if (!cwd) return null;
  try {
    const expanded = expandCwd(cwd);
    const stripped = expanded.replace(/[\\/]+$/, "") || expanded;
    const displayPath = normalize(isAbsolute(stripped) ? stripped : resolve(stripped));
    try {
      const { realpath } = await import("node:fs/promises");
      const resolved = normalize(await realpath(displayPath)).replace(/[\\/]+$/, "") || displayPath;
      return resolved;
    } catch {
      return displayPath;
    }
  } catch {
    return null;
  }
}

function fingerprintMatches(
  entry: ProjectSpaceSessionIndexEntry | undefined,
  fileMtimeMs: number,
  fileSize: number,
): boolean {
  if (!entry) return false;
  return entry.fileMtimeMs === fileMtimeMs && entry.fileSize === fileSize;
}

async function validateCandidate(
  candidate: CandidateSource,
  space: ProjectSpaceSessionIndexSpaceLike,
  agentDir: string,
  options: {
    includeLegacy: boolean;
    counters?: ProjectSpaceSessionListCounters;
    pathToId: Map<string, string>;
  },
): Promise<
  | { kind: "linked"; value: ValidatedSession }
  | { kind: "legacy"; value: ValidatedSession }
  | { kind: "drop"; reason: string }
> {
  const absolutePath = resolve(candidate.absolutePath);
  if (!isUnderActiveSessionsRoot(absolutePath, agentDir)) {
    return { kind: "drop", reason: "outside_active_root" };
  }
  if (!(await isRegularFile(absolutePath))) {
    return { kind: "drop", reason: "not_regular_file" };
  }

  let st;
  try {
    st = await stat(absolutePath);
  } catch {
    return { kind: "drop", reason: "stat_failed" };
  }

  const header = await readBoundedSessionHeader(absolutePath, { counters: options.counters });
  if (!header) return { kind: "drop", reason: "header_invalid" };

  if (candidate.fromIndex && candidate.fromIndex.sessionId !== header.id) {
    return { kind: "drop", reason: "id_mismatch" };
  }

  const sessionFile = toAgentDirRelativeSessionFile(absolutePath, agentDir);
  if (!sessionFile || !isAgentDirRelativeSessionFile(sessionFile)) {
    return { kind: "drop", reason: "session_file_invalid" };
  }

  const linkedHere =
    header.projectId === space.projectId && header.spaceId === space.id;
  const linkedElsewhere = Boolean(
    header.projectId &&
      header.spaceId &&
      (header.projectId !== space.projectId || header.spaceId !== space.id),
  );
  const unlinked = !header.projectId || !header.spaceId;

  if (linkedElsewhere) {
    return { kind: "drop", reason: "relinked_elsewhere" };
  }

  const cwdPathKey = (await pathKeyForCwd(header.cwd)) ?? canonicalizeCwd(header.cwd || space.path);
  const cwdMatchesSpace = cwdPathKey === space.pathKey;

  if (unlinked) {
    if (!options.includeLegacy || !cwdMatchesSpace) {
      return { kind: "drop", reason: "legacy_excluded" };
    }
  } else if (!linkedHere) {
    return { kind: "drop", reason: "not_linked" };
  }

  const reuse = fingerprintMatches(candidate.fromIndex, st.mtimeMs, st.size);
  let meta: LightweightSessionMetadata | null = null;
  let name = candidate.fromIndex?.name;
  let messageCount = candidate.fromIndex?.messageCount ?? 0;
  let firstMessage = candidate.fromIndex?.firstMessage ?? "";
  let created = candidate.fromIndex?.created;
  let modified = candidate.fromIndex?.modified;
  let parentSessionPath = candidate.fromIndex?.parentSessionFile
    ? resolveAgentDirRelativeSessionFile(candidate.fromIndex.parentSessionFile, agentDir) ?? undefined
    : header.parentSession
      ? resolve(header.parentSession)
      : undefined;

  if (!reuse) {
    bump(options.counters, "metadataScans");
    meta = await scanSessionMetadata(absolutePath);
    if (!meta) {
      // Header-valid but body scan failed: still emit a minimal list row from header.
      created = header.timestamp ?? new Date(st.mtimeMs).toISOString();
      modified = new Date(st.mtimeMs).toISOString();
      messageCount = 0;
      firstMessage = "";
    } else {
      if (meta.id !== header.id) return { kind: "drop", reason: "scan_id_mismatch" };
      name = meta.name;
      messageCount = meta.messageCount;
      firstMessage = (meta.firstMessage || "").slice(0, PROJECT_SPACE_SESSION_INDEX_MAX_FIRST_MESSAGE_LEN);
      created = meta.created instanceof Date ? meta.created.toISOString() : String(meta.created);
      modified = meta.modified instanceof Date ? meta.modified.toISOString() : String(meta.modified);
      parentSessionPath = meta.parentSessionPath ?? parentSessionPath;
    }
  } else {
    created = created ?? header.timestamp ?? new Date(st.mtimeMs).toISOString();
    modified = modified ?? new Date(st.mtimeMs).toISOString();
  }

  options.pathToId.set(absolutePath, header.id);
  if (parentSessionPath) {
    // path→id filled later in batch for siblings; keep absolute path for map.
  }

  const studioPointer =
    studioPointerFromHeader(header.studioChild) ??
    (reuse ? candidate.fromIndex?.studioChild : undefined);

  const entryInput: ProjectSpaceSessionIndexEntry = {
    sessionId: header.id,
    sessionFile,
    projectId: linkedHere ? space.projectId : header.projectId ?? space.projectId,
    spaceId: linkedHere ? space.id : header.spaceId ?? space.id,
    cwd: header.cwd || space.path,
    cwdPathKey,
    fileMtimeMs: st.mtimeMs,
    fileSize: st.size,
    created: created!,
    modified: modified!,
    messageCount,
    firstMessage,
    updatedAt: new Date().toISOString(),
  };
  if (name) entryInput.name = name;
  if (parentSessionPath) {
    const relParent = toAgentDirRelativeSessionFile(parentSessionPath, agentDir);
    if (relParent) entryInput.parentSessionFile = relParent;
  }
  if (studioPointer) entryInput.studioChild = studioPointer;
  // parentSessionId filled after path→id map is complete.

  // For legacy unlinked rows, store space identity only in the in-memory SessionInfo
  // projection helpers; do not claim a header link on the index entry used for recovery.
  if (unlinked) {
    // Keep entry project/space as the space we discovered it under for local index
    // only when linked; legacy rows are not written as complete linked entries.
  }

  const normalized = normalizeProjectSpaceSessionIndexEntry(entryInput);
  if (!normalized) return { kind: "drop", reason: "entry_normalize_failed" };

  // parentSessionId resolved later.
  const session: SessionInfo = {
    path: absolutePath,
    id: header.id,
    cwd: canonicalizeCwd(header.cwd || space.path),
    name,
    created: normalized.created,
    modified: normalized.modified,
    messageCount: normalized.messageCount,
    firstMessage: normalized.firstMessage || "(no messages)",
    projectId: linkedHere ? space.projectId : undefined,
    spaceId: linkedHere ? space.id : undefined,
    legacyUnassigned: unlinked,
    studioChild: studioInfoFromPointer(studioPointer),
  };

  const value: ValidatedSession = {
    session,
    entry: normalized,
    absolutePath,
  };

  if (unlinked) return { kind: "legacy", value };
  return { kind: "linked", value };
}

function finalizeParentIds(
  rows: ValidatedSession[],
  pathToId: Map<string, string>,
  agentDir: string,
): void {
  for (const row of rows) {
    const parentFile = row.entry.parentSessionFile;
    let parentId: string | undefined = row.entry.parentSessionId;
    if (!parentId && parentFile) {
      const abs = resolveAgentDirRelativeSessionFile(parentFile, agentDir);
      if (abs) parentId = pathToId.get(abs);
    }
    // Also try raw absolute parent from session path map via entry file.
    if (!parentId && row.session.studioChild?.parentSessionId) {
      parentId = row.session.studioChild.parentSessionId;
    }
    if (parentId) {
      row.entry = { ...row.entry, parentSessionId: parentId };
      row.session = {
        ...row.session,
        parentSessionId: parentId,
      };
      if (row.session.studioChild && !row.session.studioChild.parentSessionId) {
        row.session = {
          ...row.session,
          studioChild: { ...row.session.studioChild, parentSessionId: parentId },
        };
      }
    }
  }
}

function buildIndexFromValidated(
  space: ProjectSpaceSessionIndexSpaceLike,
  linked: ValidatedSession[],
  options: { coverage?: "complete" | "partial"; lastFullReconciledAt?: string } = {},
): ProjectSpaceSessionIndexFile {
  const sessions: Record<string, ProjectSpaceSessionIndexEntry> = {};
  for (const row of linked) {
    // Only persist linked (header project/space match) entries in the active index.
    if (row.session.legacyUnassigned) continue;
    if (row.session.projectId !== space.projectId || row.session.spaceId !== space.id) continue;
    sessions[row.entry.sessionId] = row.entry;
  }
  const base = createEmptyProjectSpaceSessionIndex({
    projectId: space.projectId,
    spaceId: space.id,
    spacePathKey: space.pathKey,
    coverage: options.coverage ?? "complete",
  });
  return {
    ...base,
    lastFullReconciledAt: options.lastFullReconciledAt ?? new Date().toISOString(),
    sessions,
  };
}

function toApiShape(
  linked: ValidatedSession[],
  legacy: ValidatedSession[],
  options: {
    projectStudioDisplays?: boolean;
    counters?: ProjectSpaceSessionListCounters;
    timing?: SessionListTimingCollector;
  } = {},
): Pick<
  ListSessionsForProjectSpaceResult,
  "sessions" | "legacyUnassigned" | "studioChildrenByParentSessionId"
> {
  const roots = linked.filter((row) => !row.session.studioChild);
  const rootIds = new Set(roots.map((row) => row.session.id));
  // Parent-visible gate: only children whose high-confidence parent is a root
  // in the current space. Global/orphan children are never projected here.
  const children = linked.filter((row) => {
    if (!row.session.studioChild) return false;
    const parentId =
      row.session.studioChild.parentSessionId ?? row.session.parentSessionId;
    return Boolean(parentId && rootIds.has(parentId));
  });

  let childSessions: SessionInfo[] = children.map((row) => ({
    ...row.session,
    parentSessionId:
      row.session.parentSessionId ?? row.session.studioChild?.parentSessionId,
  }));

  if (options.projectStudioDisplays !== false && childSessions.length > 0) {
    const projectionCounters: StudioChildDisplayProjectionCounters = {
      studioProjectionCalls: 0,
      studioListTasksCalls: 0,
      studioChildrenProjected: 0,
      uniqueLinkedTasks: 0,
      taskLookupFailures: 0,
      taskDetailCacheHits: 0,
    };
    const project = () =>
      attachStudioChildDisplays(childSessions, { counters: projectionCounters });
    const attached = options.timing
      ? options.timing.measureSync("studioProjection", project)
      : project();
    childSessions = attached.sessions;

    if (options.counters) {
      options.counters.studioProjectionCalls += projectionCounters.studioProjectionCalls;
      options.counters.studioListTasksCalls += projectionCounters.studioListTasksCalls;
      options.counters.uniqueLinkedTasks += projectionCounters.uniqueLinkedTasks;
      options.counters.studioChildrenProjected += projectionCounters.studioChildrenProjected;
    }
    if (options.timing) {
      options.timing.addCount("studioProjectionCalls", projectionCounters.studioProjectionCalls);
      options.timing.addCount("studioListTasksCalls", projectionCounters.studioListTasksCalls);
      options.timing.addCount("uniqueLinkedTasks", projectionCounters.uniqueLinkedTasks);
      options.timing.addCount("studioChildrenProjected", projectionCounters.studioChildrenProjected);
    }
  }

  const childById = new Map(childSessions.map((session) => [session.id, session]));

  const sessions: SessionInfo[] = [
    ...roots.map((row) => row.session),
    ...childSessions,
  ];

  const studioChildrenByParentSessionId: Record<string, SessionInfo[]> = {};
  for (const row of children) {
    const parentId = row.session.studioChild?.parentSessionId;
    if (!parentId) continue;
    const projected = childById.get(row.session.id) ?? {
      ...row.session,
      parentSessionId: row.session.parentSessionId ?? parentId,
    };
    (studioChildrenByParentSessionId[parentId] ??= []).push(projected);
  }

  return {
    sessions,
    legacyUnassigned: legacy.map((row) => row.session),
    studioChildrenByParentSessionId,
  };
}

// ── Core validation pipeline ─────────────────────────────────────────────────

async function collectCandidates(args: {
  space: ProjectSpaceSessionIndexSpaceLike;
  agentDir: string;
  localIndex: ProjectSpaceSessionIndexFile | null;
  includeLegacySeed: boolean;
  includeHeaderDiscovery: boolean;
  counters?: ProjectSpaceSessionListCounters;
}): Promise<CandidateSource[]> {
  const byPath = new Map<string, CandidateSource>();

  if (args.localIndex) {
    for (const entry of Object.values(args.localIndex.sessions)) {
      const abs = resolveAgentDirRelativeSessionFile(entry.sessionFile, args.agentDir);
      if (!abs) continue;
      byPath.set(resolve(abs), { absolutePath: resolve(abs), fromIndex: entry });
    }
  }

  if (args.includeLegacySeed) {
    try {
      const seeds = await listLegacyIndexedSessionsForSpace(args.space.projectId, args.space.id);
      bump(args.counters, "legacySeedCandidates", seeds.length);
      for (const seed of seeds) {
        // Legacy sidecar may store absolute or relative paths; accept only active agentDir-relative.
        let abs: string | null = null;
        if (isAgentDirRelativeSessionFile(seed.sessionFile)) {
          abs = resolveAgentDirRelativeSessionFile(seed.sessionFile, args.agentDir);
        } else if (isAbsolute(seed.sessionFile) && isUnderActiveSessionsRoot(seed.sessionFile, args.agentDir)) {
          abs = resolve(seed.sessionFile);
        }
        if (!abs) continue;
        const key = resolve(abs);
        const existing = byPath.get(key);
        if (existing) {
          existing.fromLegacySeed = true;
        } else {
          byPath.set(key, { absolutePath: key, fromLegacySeed: true });
        }
      }
    } catch {
      // migration seed is best-effort
    }
  }

  const directed = await enumerateDirectedCandidates(args.space, args.agentDir, args.counters);
  for (const file of directed) {
    const key = resolve(file);
    if (!byPath.has(key)) byPath.set(key, { absolutePath: key });
  }

  if (args.includeHeaderDiscovery) {
    const discovered = await discoverSessionsByHeaderLink(args.space.projectId, args.space.id, {
      agentDir: args.agentDir,
      counters: args.counters,
    });
    for (const file of discovered) {
      const key = resolve(file);
      if (!byPath.has(key)) byPath.set(key, { absolutePath: key });
    }
  }

  return [...byPath.values()];
}

async function validateCandidateSet(args: {
  space: ProjectSpaceSessionIndexSpaceLike;
  agentDir: string;
  candidates: CandidateSource[];
  includeLegacy: boolean;
  counters?: ProjectSpaceSessionListCounters;
  recoveryReason: ProjectSpaceSessionListRecoveryReason;
  markFullReconcile: boolean;
}): Promise<ValidatedSpaceSessions> {
  const pathToId = new Map<string, string>();
  const headerReadsBefore = args.counters?.headerReads ?? 0;
  const metadataBefore = args.counters?.metadataScans ?? 0;

  const results = await mapWithConcurrency(
    args.candidates,
    METADATA_SCAN_CONCURRENCY,
    (candidate) =>
      validateCandidate(candidate, args.space, args.agentDir, {
        includeLegacy: args.includeLegacy,
        counters: args.counters,
        pathToId,
      }),
  );

  const linked: ValidatedSession[] = [];
  const legacy: ValidatedSession[] = [];
  for (const result of results) {
    if (result.kind === "linked") linked.push(result.value);
    else if (result.kind === "legacy") legacy.push(result.value);
  }

  // Ensure pathToId includes every validated path (already set in validateCandidate).
  finalizeParentIds(linked, pathToId, args.agentDir);
  finalizeParentIds(legacy, pathToId, args.agentDir);

  // Stable sort: modified desc (same general expectation as inventory list).
  const byModifiedDesc = (a: ValidatedSession, b: ValidatedSession) =>
    Date.parse(b.session.modified) - Date.parse(a.session.modified);
  linked.sort(byModifiedDesc);
  legacy.sort(byModifiedDesc);

  const index = buildIndexFromValidated(args.space, linked, {
    coverage: "complete",
    lastFullReconciledAt: args.markFullReconcile ? new Date().toISOString() : undefined,
  });
  if (!args.markFullReconcile) {
    // Preserve prior reconcile stamp when only hot-path directed validation ran.
    // Caller may overwrite.
    delete index.lastFullReconciledAt;
  }

  return {
    linked,
    legacy,
    index,
    recoveryReason: args.recoveryReason,
    metadataScans: (args.counters?.metadataScans ?? 0) - metadataBefore,
    headerReads: (args.counters?.headerReads ?? 0) - headerReadsBefore,
  };
}

async function persistIndexBestEffort(
  space: ProjectSpaceSessionIndexSpaceLike,
  index: ProjectSpaceSessionIndexFile,
  counters?: ProjectSpaceSessionListCounters,
): Promise<void> {
  try {
    const result = await writeProjectSpaceSessionIndex(space, {
      ...index,
      coverage: "complete",
      updatedAt: new Date().toISOString(),
    });
    if (result.ok && result.written) bump(counters, "indexWrites");
  } catch {
    // Index write failure must not hide already-validated JSONL results.
  }
}

// ── Recovery single-flight ───────────────────────────────────────────────────

async function runFullRecovery(args: {
  space: ProjectSpaceSessionIndexSpaceLike;
  agentDir: string;
  includeLegacy: boolean;
  counters?: ProjectSpaceSessionListCounters;
  recoveryReason: ProjectSpaceSessionListRecoveryReason;
  localIndex: ProjectSpaceSessionIndexFile | null;
}): Promise<ValidatedSpaceSessions> {
  bump(args.counters, "recoveryRuns");
  const state = listState();
  if (state.testSlowRecoveryMs > 0) {
    const delay = state.testSlowRecoveryMs;
    state.testSlowRecoveryMs = 0;
    await sleep(delay);
  }

  const candidates = await collectCandidates({
    space: args.space,
    agentDir: args.agentDir,
    localIndex: args.localIndex,
    includeLegacySeed: true,
    includeHeaderDiscovery: true,
    counters: args.counters,
  });

  const validated = await validateCandidateSet({
    space: args.space,
    agentDir: args.agentDir,
    candidates,
    includeLegacy: args.includeLegacy,
    counters: args.counters,
    recoveryReason: args.recoveryReason,
    markFullReconcile: true,
  });

  await persistIndexBestEffort(args.space, validated.index, args.counters);
  rememberLastGood(args.space, validated.linked);
  return validated;
}

function rememberLastGood(
  space: ProjectSpaceSessionIndexSpaceLike,
  sessions: ValidatedSession[],
): void {
  const key = flightKey(space.projectId, space.id, space.pathKey);
  listState().lastGood.set(key, {
    key,
    projectId: space.projectId,
    spaceId: space.id,
    spacePathKey: space.pathKey,
    savedAt: Date.now(),
    sessions: sessions.map((row) => ({
      ...row,
      session: { ...row.session },
      entry: { ...row.entry },
    })),
  });
}

async function revalidateLastGood(
  space: ProjectSpaceSessionIndexSpaceLike,
  agentDir: string,
  includeLegacy: boolean,
  counters?: ProjectSpaceSessionListCounters,
): Promise<ValidatedSpaceSessions | null> {
  const key = flightKey(space.projectId, space.id, space.pathKey);
  const cached = listState().lastGood.get(key);
  if (!cached) return null;
  if (
    cached.projectId !== space.projectId ||
    cached.spaceId !== space.id ||
    cached.spacePathKey !== space.pathKey
  ) {
    return null;
  }

  const candidates: CandidateSource[] = cached.sessions.map((row) => ({
    absolutePath: row.absolutePath,
    fromIndex: row.entry,
  }));

  // Also merge directed dirs so last-good is not the only source of truth for files that still exist.
  const directed = await enumerateDirectedCandidates(space, agentDir, counters);
  const seen = new Set(candidates.map((c) => resolve(c.absolutePath)));
  for (const file of directed) {
    const abs = resolve(file);
    if (!seen.has(abs)) {
      candidates.push({ absolutePath: abs });
      seen.add(abs);
    }
  }

  return validateCandidateSet({
    space,
    agentDir,
    candidates,
    includeLegacy,
    counters,
    recoveryReason: "none",
    markFullReconcile: false,
  });
}

function beginRebuildFlight(args: {
  space: ProjectSpaceSessionIndexSpaceLike;
  agentDir: string;
  includeLegacy: boolean;
  counters?: ProjectSpaceSessionListCounters;
  recoveryReason: ProjectSpaceSessionListRecoveryReason;
  localIndex: ProjectSpaceSessionIndexFile | null;
}): Promise<ValidatedSpaceSessions> {
  const key = flightKey(args.space.projectId, args.space.id, args.space.pathKey);
  const state = listState();
  const existing = state.rebuilds.get(key);
  if (existing) return existing.promise;

  const promise = runFullRecovery(args)
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      const current = state.rebuilds.get(key);
      if (current?.promise === promise) state.rebuilds.delete(key);
    });

  state.rebuilds.set(key, { promise, startedAt: Date.now() });
  return promise;
}

function scheduleBackgroundReconcile(args: {
  space: ProjectSpaceSessionIndexSpaceLike;
  agentDir: string;
  includeLegacy: boolean;
  counters?: ProjectSpaceSessionListCounters;
  localIndex: ProjectSpaceSessionIndexFile | null;
}): void {
  const key = flightKey(args.space.projectId, args.space.id, args.space.pathKey);
  const state = listState();
  if (state.backgroundReconciles.has(key) || state.rebuilds.has(key)) return;

  bump(args.counters, "backgroundReconciles");
  const promise = runFullRecovery({
    space: args.space,
    agentDir: args.agentDir,
    includeLegacy: args.includeLegacy,
    counters: args.counters,
    recoveryReason: "forced",
    localIndex: args.localIndex,
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      if (state.backgroundReconciles.get(key) === promise) {
        state.backgroundReconciles.delete(key);
      }
    });
  state.backgroundReconciles.set(key, promise);
}

// ── Hot path ─────────────────────────────────────────────────────────────────

async function runHotPath(args: {
  space: ProjectSpaceSessionIndexSpaceLike;
  agentDir: string;
  includeLegacy: boolean;
  counters?: ProjectSpaceSessionListCounters;
  localIndex: ProjectSpaceSessionIndexFile;
}): Promise<ValidatedSpaceSessions> {
  const candidates = await collectCandidates({
    space: args.space,
    agentDir: args.agentDir,
    localIndex: args.localIndex,
    includeLegacySeed: false,
    includeHeaderDiscovery: false,
    counters: args.counters,
  });

  const validated = await validateCandidateSet({
    space: args.space,
    agentDir: args.agentDir,
    candidates,
    includeLegacy: args.includeLegacy,
    counters: args.counters,
    recoveryReason: "none",
    markFullReconcile: false,
  });

  // Preserve lastFullReconciledAt from the previous complete index when still fresh.
  if (args.localIndex.lastFullReconciledAt) {
    validated.index = {
      ...validated.index,
      lastFullReconciledAt: args.localIndex.lastFullReconciledAt,
    };
  }

  // Persist repaired candidate set (stale removals / new directed files).
  await persistIndexBestEffort(args.space, validated.index, args.counters);
  rememberLastGood(args.space, validated.linked);
  return validated;
}

function classifyIndexRead(
  read: Awaited<ReturnType<typeof readProjectSpaceSessionIndex>>,
): {
  recoveryReason: ProjectSpaceSessionListRecoveryReason;
  localIndex: ProjectSpaceSessionIndexFile | null;
} {
  if (read.status === "ok") {
    if (read.index.coverage !== "complete") {
      return { recoveryReason: "partial", localIndex: read.index };
    }
    return { recoveryReason: "none", localIndex: read.index };
  }
  if (read.status === "missing") {
    return { recoveryReason: "missing", localIndex: null };
  }
  if (read.code === "identity_mismatch") {
    return { recoveryReason: "identity_mismatch", localIndex: null };
  }
  if (read.code === "coverage_partial") {
    return { recoveryReason: "partial", localIndex: null };
  }
  return { recoveryReason: "corrupt", localIndex: null };
}

function needsBackgroundReconcile(
  index: ProjectSpaceSessionIndexFile,
  now: number,
): boolean {
  if (!index.lastFullReconciledAt) return true;
  const ts = Date.parse(index.lastFullReconciledAt);
  if (!Number.isFinite(ts)) return true;
  return now - ts > FULL_RECONCILE_STALE_MS;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * List sessions for one Project Registry space using the space-local index and
 * directed cwd validation. Does not call scanSessionInventory / listAllSessions.
 */
export async function listSessionsForProjectSpace(
  projectId: string,
  spaceId: string,
  options: ListSessionsForProjectSpaceOptions = {},
): Promise<ListSessionsForProjectSpaceResult> {
  const started = nowMs(options.now);
  const counters = options.counters ?? createProjectSpaceSessionListCounters();
  // Hot path must never touch the global inventory helper.
  counters.inventoryGlobalCalls = 0;

  const timing = options.timing;
  const agentDir = options.agentDir ?? getAgentDir();
  const includeLegacy = Boolean(options.includeLegacy);
  const recoveryBudgetMs = options.recoveryBudgetMs ?? DEFAULT_RECOVERY_BUDGET_MS;
  const forceValidate = Boolean(options.forceValidate);

  const space: ProjectSpaceSessionIndexSpaceLike = options.space
    ? {
        id: options.space.id,
        projectId: options.space.projectId,
        path: options.space.path,
        realPath: options.space.realPath,
        pathKey: options.space.pathKey,
      }
    : await (async () => {
        const { getProjectSpace } = await import("./project-registry");
        return timing
          ? timing.measureAsync("registry", () => getProjectSpace(projectId, spaceId))
          : getProjectSpace(projectId, spaceId);
      })();

  if (space.projectId !== projectId || space.id !== spaceId) {
    throw new ProjectSpaceSessionListError("space_not_found", "Space identity mismatch", {
      status: 404,
    });
  }

  const snapshotKey = spaceListSnapshotKey(projectId, spaceId, space.pathKey, includeLegacy);
  const snapshots = getSpaceListSnapshots();
  const nowWall = Date.now();

  // 5s response snapshot: skipped on forceValidate / forceFullReconcile / custom counters.
  // Custom counters always recompute so focused tests can observe I/O.
  const allowSnapshot =
    !forceValidate &&
    !options.forceFullReconcile &&
    !options.counters &&
    options.recoveryBudgetMs === undefined;

  if (allowSnapshot) {
    const cached = snapshots.get(snapshotKey);
    if (cached?.value && cached.expiresAt > nowWall) {
      if (timing) {
        timing.addCount("snapshotHit", 1);
        timing.addCount("inventoryGlobalCalls", 0);
        timing.addCount("linkedRoots", cached.value.sessions.filter((s) => !s.studioChild).length);
        timing.addCount(
          "linkedStudioChildren",
          Object.values(cached.value.studioChildrenByParentSessionId).reduce(
            (n, rows) => n + rows.length,
            0,
          ),
        );
        timing.addCount("legacyUnassigned", cached.value.legacyUnassigned.length);
      }
      return cloneListResult(cached.value);
    }
    if (cached?.pending) {
      if (timing) timing.addCount("snapshotPending", 1);
      return cloneListResult(await cached.pending);
    }
  }

  const pending = listSessionsForProjectSpaceUncached(projectId, spaceId, {
    ...options,
    space,
    agentDir,
    includeLegacy,
    recoveryBudgetMs,
    counters,
    timing,
    started,
  });

  if (allowSnapshot) {
    snapshots.set(snapshotKey, {
      expiresAt: nowWall + SPACE_LIST_SNAPSHOT_TTL_MS,
      projectId,
      spaceId,
      spacePathKey: space.pathKey,
      includeLegacy,
      pending,
    });
    trimSpaceListSnapshots(snapshots);
  }

  try {
    const value = await pending;
    if (allowSnapshot) {
      snapshots.set(snapshotKey, {
        expiresAt: Date.now() + SPACE_LIST_SNAPSHOT_TTL_MS,
        projectId,
        spaceId,
        spacePathKey: space.pathKey,
        includeLegacy,
        value,
      });
      trimSpaceListSnapshots(snapshots);
    }
    return cloneListResult(value);
  } catch (error) {
    if (allowSnapshot) {
      const current = snapshots.get(snapshotKey);
      if (current?.pending === pending) snapshots.delete(snapshotKey);
    }
    throw error;
  }
}

async function listSessionsForProjectSpaceUncached(
  projectId: string,
  spaceId: string,
  options: ListSessionsForProjectSpaceOptions & {
    space: ProjectSpaceSessionIndexSpaceLike;
    agentDir: string;
    includeLegacy: boolean;
    recoveryBudgetMs: number;
    counters: ProjectSpaceSessionListCounters;
    started: number;
  },
): Promise<ListSessionsForProjectSpaceResult> {
  const {
    space,
    agentDir,
    includeLegacy,
    recoveryBudgetMs,
    counters,
    timing,
    started,
  } = options;

  const indexRead = await (timing
    ? timing.measureAsync("indexRead", () =>
        readProjectSpaceSessionIndex(space, { requireComplete: false }),
      )
    : readProjectSpaceSessionIndex(space, { requireComplete: false }));

  const classified = classifyIndexRead(indexRead);
  let recoveryReason = classified.recoveryReason;
  const localIndex = classified.localIndex;
  if (options.forceFullReconcile && recoveryReason === "none") {
    recoveryReason = "forced";
  }

  let validated: ValidatedSpaceSessions;
  let usedLastGood = false;

  if (recoveryReason === "none" && localIndex) {
    validated = await (timing
      ? timing.measureAsync("validate", () =>
          runHotPath({
            space,
            agentDir,
            includeLegacy,
            counters,
            localIndex,
          }),
        )
      : runHotPath({
          space,
          agentDir,
          includeLegacy,
          counters,
          localIndex,
        }));

    if (needsBackgroundReconcile(localIndex, nowMs(options.now))) {
      scheduleBackgroundReconcile({
        space,
        agentDir,
        includeLegacy,
        counters,
        localIndex,
      });
    }
  } else {
    // Recovery path with single-flight + hard budget.
    const rebuildPromise = beginRebuildFlight({
      space,
      agentDir,
      includeLegacy,
      counters,
      recoveryReason,
      localIndex,
    });

    const budgetPromise = sleep(recoveryBudgetMs).then(() => "timeout" as const);
    const raced = await (timing
      ? timing.measureAsync("recovery", () =>
          Promise.race([
            rebuildPromise.then((value) => ({ tag: "ok" as const, value })),
            budgetPromise.then((tag) => ({ tag })),
          ]),
        )
      : Promise.race([
          rebuildPromise.then((value) => ({ tag: "ok" as const, value })),
          budgetPromise.then((tag) => ({ tag })),
        ]));

    if (raced.tag === "ok") {
      validated = raced.value;
    } else {
      // Timeout: try last-good (revalidated). Never return unchecked partial.
      const lastGood = await revalidateLastGood(space, agentDir, includeLegacy, counters);
      if (lastGood) {
        usedLastGood = true;
        validated = {
          ...lastGood,
          recoveryReason,
        };
        // rebuild continues in background via existing flight map entry.
      } else {
        throw new ProjectSpaceSessionListError(
          PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING,
          "Session index is rebuilding",
          { status: 503, retryAfterSec: 1 },
        );
      }
    }
  }

  const shape = toApiShape(validated.linked, includeLegacy ? validated.legacy : [], {
    projectStudioDisplays: true,
    counters,
    timing,
  });
  const elapsedMs = nowMs(options.now) - started;

  if (timing) {
    timing.addCount("candidateCount", validated.linked.length + validated.legacy.length);
    timing.addCount("linkedRoots", shape.sessions.filter((s) => !s.studioChild).length);
    timing.addCount(
      "linkedStudioChildren",
      Object.values(shape.studioChildrenByParentSessionId).reduce((n, rows) => n + rows.length, 0),
    );
    timing.addCount("legacyUnassigned", shape.legacyUnassigned.length);
    timing.addCount("metadataScans", counters.metadataScans);
    timing.addCount("headerReads", counters.headerReads);
    timing.addCount("inventoryGlobalCalls", counters.inventoryGlobalCalls);
    timing.addCount("studioProjectionCalls", counters.studioProjectionCalls);
    timing.addCount("uniqueLinkedTasks", counters.uniqueLinkedTasks);
    timing.addCount("recoveryReason", recoveryReason === "none" ? 0 : 1);
  }

  return {
    ...shape,
    diagnostics: {
      recoveryReason: validated.recoveryReason,
      usedLastGood,
      candidateCount: validated.linked.length + validated.legacy.length,
      matchedCount: validated.linked.length,
      legacyCount: shape.legacyUnassigned.length,
      studioChildCount: Object.values(shape.studioChildrenByParentSessionId).reduce(
        (n, rows) => n + rows.length,
        0,
      ),
      metadataScans: counters.metadataScans,
      headerReads: counters.headerReads,
      inventoryGlobalCalls: counters.inventoryGlobalCalls,
      studioProjectionCalls: counters.studioProjectionCalls,
      studioListTasksCalls: counters.studioListTasksCalls,
      uniqueLinkedTasks: counters.uniqueLinkedTasks,
      elapsedMs,
    },
  };
}

/**
 * Invalidate process last-good + response snapshots for a space (or all).
 * Does not delete on-disk indexes. PSI-03 mutation hooks should call this
 * (or write-through upsert) after known session changes.
 */
export function invalidateProjectSpaceSessionListState(filter?: {
  projectId?: string;
  spaceId?: string;
  spacePathKey?: string;
}): void {
  invalidateProjectSpaceSessionListSnapshots(filter);
  const state = listState();
  if (!filter?.projectId && !filter?.spaceId && !filter?.spacePathKey) {
    state.lastGood.clear();
    return;
  }
  for (const [key, entry] of state.lastGood) {
    if (filter.projectId && entry.projectId !== filter.projectId) continue;
    if (filter.spaceId && entry.spaceId !== filter.spaceId) continue;
    if (filter.spacePathKey && entry.spacePathKey !== filter.spacePathKey) continue;
    state.lastGood.delete(key);
  }
}
