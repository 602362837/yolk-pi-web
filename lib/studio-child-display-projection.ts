/**
 * Studio child UI display projection with task-level batching (PSI-04).
 *
 * Rules:
 * - Task detail is shared per (cwdPathKey + taskId); run/subtask fields are
 *   derived per child so different runs never cross-contaminate.
 * - Cache key includes task.json mtimeMs+size when present; TTL 30s; LRU-bounded.
 * - listYpiStudioTasks(scope:all) fallback runs at most once per cwd per batch
 *   (and is also memoized in the task-detail loader for single-child calls).
 * - Display is never persisted into the project-space session index.
 * - Task I/O failures degrade to header-only subtaskId; they never throw.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { canonicalizeCwd } from "./cwd";
import type { YpiStudioTaskDetail } from "./ypi-studio-types";
import { getYpiStudioTaskDetail, listYpiStudioTasks } from "./ypi-studio-tasks";
import type { SessionInfo, StudioChildSessionDisplay, StudioChildSessionInfo } from "./types";

export const STUDIO_CHILD_DISPLAY_CACHE_TTL_MS = 30_000;
export const STUDIO_CHILD_DISPLAY_TASK_CACHE_LIMIT = 256;
/** Backward-compatible display TTL used only for the per-child result memo. */
export const STUDIO_CHILD_DISPLAY_RESULT_TTL_MS = 30_000;

type TaskFingerprint = string;

type TaskDetailCacheEntry = {
  fingerprint: TaskFingerprint;
  expiresAt: number;
  detail: YpiStudioTaskDetail | null;
  /** True when detail was resolved via listYpiStudioTasks fallback. */
  usedListFallback: boolean;
  lookupFailed: boolean;
};

type DisplayResultCacheEntry = {
  expiresAt: number;
  value?: StudioChildSessionDisplay;
};

type CwdListTasksMemo = {
  expiresAt: number;
  byId: Map<string, string>; // taskId -> task.key
  failed: boolean;
};

declare global {
  var __piStudioChildDisplayTaskCache:
    | Map<string, TaskDetailCacheEntry>
    | undefined;
  var __piStudioChildDisplayResultCache:
    | Map<string, DisplayResultCacheEntry>
    | undefined;
  var __piStudioChildDisplayListTasksMemo:
    | Map<string, CwdListTasksMemo>
    | undefined;
  var __piStudioChildDisplayTaskFlights:
    | Map<string, Promise<TaskDetailCacheEntry>>
    | undefined;
}

export interface StudioChildDisplayProjectionCounters {
  /** Unique task detail loads (cache misses that invoked getYpiStudioTaskDetail). */
  studioProjectionCalls: number;
  /** listYpiStudioTasks(scope:all) invocations. */
  studioListTasksCalls: number;
  /** Children that received a projected display (including header-only). */
  studioChildrenProjected: number;
  /** Unique (cwdPathKey, taskId) groups considered. */
  uniqueLinkedTasks: number;
  /** Task lookups that threw or returned null after fallback. */
  taskLookupFailures: number;
  /** Cache hits on task-detail fingerprint cache. */
  taskDetailCacheHits: number;
}

export interface StudioChildDisplayProjectionInput {
  sessionId: string;
  cwd?: string;
  studioChild?: StudioChildSessionInfo;
}

export interface ProjectStudioChildDisplaysBatchOptions {
  now?: () => number;
  counters?: StudioChildDisplayProjectionCounters;
  /**
   * Optional injected loaders for focused tests. Production uses
   * getYpiStudioTaskDetail / listYpiStudioTasks.
   */
  loaders?: {
    getDetail?: (cwd: string, taskIdOrKey: string) => YpiStudioTaskDetail | null;
    listTasks?: (cwd: string) => { id: string; key: string }[];
    statTaskJson?: (cwd: string, taskId: string) => { mtimeMs: number; size: number } | null;
  };
}

export interface ProjectStudioChildDisplaysBatchResult {
  displaysBySessionId: Map<string, StudioChildSessionDisplay | undefined>;
  counters: StudioChildDisplayProjectionCounters;
}

function nowMs(now?: () => number): number {
  return now ? now() : Date.now();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function taskCacheStore(): Map<string, TaskDetailCacheEntry> {
  if (!globalThis.__piStudioChildDisplayTaskCache) {
    globalThis.__piStudioChildDisplayTaskCache = new Map();
  }
  return globalThis.__piStudioChildDisplayTaskCache;
}

function resultCacheStore(): Map<string, DisplayResultCacheEntry> {
  if (!globalThis.__piStudioChildDisplayResultCache) {
    globalThis.__piStudioChildDisplayResultCache = new Map();
  }
  return globalThis.__piStudioChildDisplayResultCache;
}

function listTasksMemoStore(): Map<string, CwdListTasksMemo> {
  if (!globalThis.__piStudioChildDisplayListTasksMemo) {
    globalThis.__piStudioChildDisplayListTasksMemo = new Map();
  }
  return globalThis.__piStudioChildDisplayListTasksMemo;
}

function flightStore(): Map<string, Promise<TaskDetailCacheEntry>> {
  if (!globalThis.__piStudioChildDisplayTaskFlights) {
    globalThis.__piStudioChildDisplayTaskFlights = new Map();
  }
  return globalThis.__piStudioChildDisplayTaskFlights;
}

function trimMap<V>(map: Map<string, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest == null) break;
    map.delete(oldest);
  }
}

export function studioTaskCacheKey(cwdPathKey: string, taskId: string): string {
  return `${cwdPathKey}\0${taskId}`;
}

function displayResultCacheKey(
  cwdPathKey: string,
  studioChild: StudioChildSessionInfo,
): string {
  return `${cwdPathKey}\0${studioChild.taskId}\0${studioChild.subtaskId ?? ""}\0${studioChild.runId ?? ""}`;
}

function defaultStatTaskJson(cwd: string, taskId: string): { mtimeMs: number; size: number } | null {
  try {
    const path = join(cwd, ".ypi", "tasks", taskId, "task.json");
    if (!existsSync(path)) return null;
    const st = statSync(path);
    if (!st.isFile()) return null;
    return { mtimeMs: Math.trunc(st.mtimeMs), size: st.size };
  } catch {
    return null;
  }
}

function fingerprintFromStat(stat: { mtimeMs: number; size: number } | null): TaskFingerprint {
  if (!stat) return "absent";
  return `${stat.mtimeMs}:${stat.size}`;
}

function emptyCounters(): StudioChildDisplayProjectionCounters {
  return {
    studioProjectionCalls: 0,
    studioListTasksCalls: 0,
    studioChildrenProjected: 0,
    uniqueLinkedTasks: 0,
    taskLookupFailures: 0,
    taskDetailCacheHits: 0,
  };
}

function bump(
  counters: StudioChildDisplayProjectionCounters | undefined,
  key: keyof StudioChildDisplayProjectionCounters,
  n = 1,
): void {
  if (!counters) return;
  counters[key] += n;
}

function deriveDisplayFromDetail(
  studioChild: StudioChildSessionInfo,
  detail: YpiStudioTaskDetail | null,
): StudioChildSessionDisplay | undefined {
  const headerSubtaskId = firstNonEmpty(studioChild.subtaskId);
  if (!detail) {
    return headerSubtaskId ? { subtaskId: headerSubtaskId } : undefined;
  }
  const run = detail.subagents?.find((item) => item.id === studioChild.runId);
  const subtaskTitle = studioChild.subtaskId
    ? detail.implementationProjection?.subtasksWithStatus.find((item) => item.id === studioChild.subtaskId)?.title
      ?? detail.implementationPlan?.subtasks.find((item) => item.id === studioChild.subtaskId)?.title
    : undefined;
  const runSummary = firstNonEmpty(run?.summary, run?.progress?.lastTextPreview);
  return {
    taskTitle: firstNonEmpty(detail.title),
    subtaskId: headerSubtaskId,
    subtaskTitle,
    runSummary,
  };
}

function resolveListTasksMemo(
  cwdPathKey: string,
  cwd: string,
  now: number,
  counters: StudioChildDisplayProjectionCounters | undefined,
  loaders: ProjectStudioChildDisplaysBatchOptions["loaders"],
): CwdListTasksMemo {
  const store = listTasksMemoStore();
  const cached = store.get(cwdPathKey);
  if (cached && cached.expiresAt > now) return cached;

  bump(counters, "studioListTasksCalls");
  const byId = new Map<string, string>();
  let failed = false;
  try {
    const tasks = loaders?.listTasks
      ? loaders.listTasks(cwd)
      : listYpiStudioTasks(cwd, { scope: "all" }).tasks.map((task) => ({ id: task.id, key: task.key }));
    for (const task of tasks) {
      if (task?.id && task?.key) byId.set(task.id, task.key);
    }
  } catch {
    failed = true;
  }

  const entry: CwdListTasksMemo = {
    expiresAt: now + STUDIO_CHILD_DISPLAY_CACHE_TTL_MS,
    byId,
    failed,
  };
  store.set(cwdPathKey, entry);
  trimMap(store, STUDIO_CHILD_DISPLAY_TASK_CACHE_LIMIT);
  return entry;
}

function loadTaskDetailEntry(
  cwdPathKey: string,
  cwd: string,
  taskId: string,
  now: number,
  counters: StudioChildDisplayProjectionCounters | undefined,
  loaders: ProjectStudioChildDisplaysBatchOptions["loaders"],
  allowListFallback: boolean,
): TaskDetailCacheEntry {
  const stat = loaders?.statTaskJson
    ? loaders.statTaskJson(cwd, taskId)
    : defaultStatTaskJson(cwd, taskId);
  const fingerprint = fingerprintFromStat(stat);
  const key = studioTaskCacheKey(cwdPathKey, taskId);
  const store = taskCacheStore();
  const cached = store.get(key);
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > now) {
    // Move to end for crude LRU.
    store.delete(key);
    store.set(key, cached);
    bump(counters, "taskDetailCacheHits");
    return cached;
  }

  bump(counters, "studioProjectionCalls");
  let detail: YpiStudioTaskDetail | null = null;
  let usedListFallback = false;
  let lookupFailed = false;

  try {
    const getDetail = loaders?.getDetail ?? getYpiStudioTaskDetail;
    detail = getDetail(cwd, taskId);
    if (!detail && allowListFallback) {
      const memo = resolveListTasksMemo(cwdPathKey, cwd, now, counters, loaders);
      usedListFallback = true;
      const matchKey = memo.byId.get(taskId);
      if (matchKey && matchKey !== taskId) {
        detail = getDetail(cwd, matchKey);
      }
      if (!detail && memo.failed) lookupFailed = true;
    }
    if (!detail) lookupFailed = true;
  } catch {
    detail = null;
    lookupFailed = true;
  }

  if (lookupFailed) bump(counters, "taskLookupFailures");

  const entry: TaskDetailCacheEntry = {
    fingerprint,
    expiresAt: now + STUDIO_CHILD_DISPLAY_CACHE_TTL_MS,
    detail,
    usedListFallback,
    lookupFailed,
  };
  store.set(key, entry);
  trimMap(store, STUDIO_CHILD_DISPLAY_TASK_CACHE_LIMIT);
  return entry;
}

/**
 * Project one Studio child display. Safe for existing single-child callers
 * (session detail, listAllSessions). Uses task-level fingerprint cache so
 * many children on the same task only load task.json once within TTL.
 */
export function projectStudioChildDisplay(
  cwd: string,
  studioChild?: StudioChildSessionInfo,
  options: ProjectStudioChildDisplaysBatchOptions = {},
): StudioChildSessionDisplay | undefined {
  if (!studioChild?.taskId) return undefined;
  const cwdPathKey = canonicalizeCwd(cwd || "") || "";
  const now = nowMs(options.now);
  const resultKey = displayResultCacheKey(cwdPathKey, studioChild);
  const results = resultCacheStore();
  const cachedResult = results.get(resultKey);
  if (cachedResult && cachedResult.expiresAt > now) {
    return cachedResult.value;
  }

  try {
    const taskEntry = loadTaskDetailEntry(
      cwdPathKey,
      cwd || "",
      studioChild.taskId,
      now,
      options.counters,
      options.loaders,
      true,
    );
    const value = deriveDisplayFromDetail(studioChild, taskEntry.detail);
    results.set(resultKey, {
      expiresAt: now + STUDIO_CHILD_DISPLAY_RESULT_TTL_MS,
      value,
    });
    trimMap(results, STUDIO_CHILD_DISPLAY_TASK_CACHE_LIMIT * 4);
    return value;
  } catch {
    const headerSubtaskId = firstNonEmpty(studioChild.subtaskId);
    const value = headerSubtaskId ? { subtaskId: headerSubtaskId } : undefined;
    results.set(resultKey, {
      expiresAt: now + STUDIO_CHILD_DISPLAY_RESULT_TTL_MS,
      value,
    });
    return value;
  }
}

/**
 * Batch-project displays for already-filtered, parent-visible Studio children.
 * Groups by cwdPathKey + taskId so uniqueLinkedTasks bounds task I/O.
 */
export function projectStudioChildDisplaysBatch(
  children: StudioChildDisplayProjectionInput[],
  options: ProjectStudioChildDisplaysBatchOptions = {},
): ProjectStudioChildDisplaysBatchResult {
  const counters = options.counters ?? emptyCounters();
  const now = nowMs(options.now);
  const displaysBySessionId = new Map<string, StudioChildSessionDisplay | undefined>();

  type Group = {
    cwdPathKey: string;
    cwd: string;
    taskId: string;
    members: StudioChildDisplayProjectionInput[];
  };

  const groups = new Map<string, Group>();
  for (const child of children) {
    const studioChild = child.studioChild;
    if (!studioChild?.taskId || !child.sessionId) {
      displaysBySessionId.set(child.sessionId, undefined);
      continue;
    }
    const cwd = child.cwd ?? "";
    const cwdPathKey = canonicalizeCwd(cwd) || cwd;
    const key = studioTaskCacheKey(cwdPathKey, studioChild.taskId);
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(child);
    } else {
      groups.set(key, {
        cwdPathKey,
        cwd,
        taskId: studioChild.taskId,
        members: [child],
      });
    }
  }

  counters.uniqueLinkedTasks += groups.size;

  for (const group of groups.values()) {
    let taskEntry: TaskDetailCacheEntry;
    try {
      taskEntry = loadTaskDetailEntry(
        group.cwdPathKey,
        group.cwd,
        group.taskId,
        now,
        counters,
        options.loaders,
        true,
      );
    } catch {
      taskEntry = {
        fingerprint: "error",
        expiresAt: now + STUDIO_CHILD_DISPLAY_CACHE_TTL_MS,
        detail: null,
        usedListFallback: false,
        lookupFailed: true,
      };
      bump(counters, "taskLookupFailures");
    }

    for (const member of group.members) {
      const studioChild = member.studioChild!;
      try {
        const value = deriveDisplayFromDetail(studioChild, taskEntry.detail);
        displaysBySessionId.set(member.sessionId, value);
        bump(counters, "studioChildrenProjected");
        const resultKey = displayResultCacheKey(group.cwdPathKey, studioChild);
        resultCacheStore().set(resultKey, {
          expiresAt: now + STUDIO_CHILD_DISPLAY_RESULT_TTL_MS,
          value,
        });
      } catch {
        const headerSubtaskId = firstNonEmpty(studioChild.subtaskId);
        const value = headerSubtaskId ? { subtaskId: headerSubtaskId } : undefined;
        displaysBySessionId.set(member.sessionId, value);
        bump(counters, "studioChildrenProjected");
      }
    }
  }

  trimMap(resultCacheStore(), STUDIO_CHILD_DISPLAY_TASK_CACHE_LIMIT * 4);
  return { displaysBySessionId, counters };
}

/**
 * Attach batch-projected displays onto SessionInfo rows (mutates shallow copies).
 * Safe when task I/O fails: rows keep studioChild header and optional header-only display.
 */
export function attachStudioChildDisplays(
  sessions: SessionInfo[],
  options: ProjectStudioChildDisplaysBatchOptions = {},
): {
  sessions: SessionInfo[];
  counters: StudioChildDisplayProjectionCounters;
} {
  const children: StudioChildDisplayProjectionInput[] = [];
  for (const session of sessions) {
    if (session.studioChild?.kind === "ypi-studio-child-session") {
      children.push({
        sessionId: session.id,
        cwd: session.cwd,
        studioChild: session.studioChild,
      });
    }
  }
  if (children.length === 0) {
    return { sessions, counters: options.counters ?? emptyCounters() };
  }

  const { displaysBySessionId, counters } = projectStudioChildDisplaysBatch(children, options);
  const next = sessions.map((session) => {
    if (!session.studioChild) return session;
    if (!displaysBySessionId.has(session.id)) return session;
    return {
      ...session,
      studioChildDisplay: displaysBySessionId.get(session.id),
    };
  });
  return { sessions: next, counters };
}

/**
 * Invalidate task/result caches. Used by mutation hooks and list snapshot reset.
 * Optional filter by cwdPathKey and/or taskId (opaque ids only).
 */
export function invalidateStudioChildDisplayProjection(filter?: {
  cwdPathKey?: string;
  taskId?: string;
}): void {
  const tasks = taskCacheStore();
  const results = resultCacheStore();
  const listMemo = listTasksMemoStore();
  const flights = flightStore();

  if (!filter?.cwdPathKey && !filter?.taskId) {
    tasks.clear();
    results.clear();
    listMemo.clear();
    flights.clear();
    return;
  }

  const cwdKey = filter.cwdPathKey;
  const taskId = filter.taskId;

  for (const key of [...tasks.keys()]) {
    const [cwd, id] = key.split("\0");
    if (cwdKey && cwd !== cwdKey) continue;
    if (taskId && id !== taskId) continue;
    tasks.delete(key);
    flights.delete(key);
  }
  for (const key of [...results.keys()]) {
    const parts = key.split("\0");
    const cwd = parts[0];
    const id = parts[1];
    if (cwdKey && cwd !== cwdKey) continue;
    if (taskId && id !== taskId) continue;
    results.delete(key);
  }
  if (cwdKey) {
    listMemo.delete(cwdKey);
  } else if (!taskId) {
    listMemo.clear();
  }
}

/** Test-only full reset. */
export function __resetStudioChildDisplayProjectionForTests(): void {
  invalidateStudioChildDisplayProjection();
}
