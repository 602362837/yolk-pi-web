/**
 * Session-scoped YPI Studio child inventory projection for the Chat top-bar panel.
 *
 * Identity is high-confidence only:
 *   studioChild.kind === "ypi-studio-child-session"
 *   && studioChild.parentSessionId === requestedParentSessionId
 *
 * Status authority: task.json run when present; otherwise header fallback with
 * statusMayBeStale. Wire projection never includes path/cwd/sessionFile/content.
 *
 * Heavy session-reader / task-reader deps are loaded lazily so pure projection
 * helpers stay unit-testable without booting the full inventory stack.
 */

import { studioChildSessionTitle } from "./session-title";
import type { YpiStudioTaskDetail, YpiStudioTaskSubagentRun } from "./ypi-studio-types";
import type {
  SessionInfo,
  StudioChildPanelStatus,
  StudioChildSessionListItem,
  StudioChildSessionListResponse,
} from "./types";

export const STUDIO_CHILD_TERMINAL_LIMIT = 20;
/** Defensive hard cap so a corrupted inventory cannot return unbounded active rows. */
export const STUDIO_CHILD_DEFENSIVE_ACTIVE_CAP = 200;
export const STUDIO_CHILD_STRING_BUDGET = 200;

const ACTIVE_STATUSES = new Set<StudioChildPanelStatus>([
  "queued",
  "running",
  "waiting_for_user",
]);

const TERMINAL_STATUSES = new Set<StudioChildPanelStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "runtime_lost",
]);

const PANEL_STATUS_SET = new Set<StudioChildPanelStatus>([
  "queued",
  "running",
  "waiting_for_user",
  "succeeded",
  "failed",
  "cancelled",
  "runtime_lost",
  "unknown",
]);

export class StudioChildSessionListError extends Error {
  readonly status: number;
  readonly code: "invalid_parent" | "not_found" | "is_studio_child";

  constructor(code: StudioChildSessionListError["code"], message: string, status: number) {
    super(message);
    this.name = "StudioChildSessionListError";
    this.code = code;
    this.status = status;
  }
}

export function isStudioChildPanelActiveStatus(status: StudioChildPanelStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isStudioChildPanelTerminalStatus(status: StudioChildPanelStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function truncateStudioChildWireString(
  value: string | undefined,
  maxLength = STUDIO_CHILD_STRING_BUDGET,
): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function normalizeStudioChildPanelStatus(raw: unknown): {
  status: StudioChildPanelStatus;
  rawStatus?: string;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { status: "unknown" };
  }
  const rawStatus = raw.trim();
  if (PANEL_STATUS_SET.has(rawStatus as StudioChildPanelStatus)) {
    return { status: rawStatus as StudioChildPanelStatus, rawStatus };
  }
  return { status: "unknown", rawStatus };
}

function timeMs(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function activeSortKey(item: StudioChildSessionListItem): number {
  return timeMs(item.startedAt ?? item.createdAt);
}

function terminalSortKey(item: StudioChildSessionListItem): number {
  return timeMs(item.finishedAt ?? item.modifiedAt);
}

function activeRank(status: StudioChildPanelStatus): number {
  if (status === "waiting_for_user") return 0;
  if (status === "running") return 1;
  if (status === "queued") return 2;
  return 3; // unknown-without-finishedAt and other non-terminal
}

/**
 * Stable server-side ordering used by the panel. Clients must not re-author status authority.
 * Order: waiting_for_user → running → queued → other non-terminal → recent terminal (newest first).
 */
export function sortStudioChildSessionListItems(
  items: StudioChildSessionListItem[],
): StudioChildSessionListItem[] {
  return items.slice().sort((a, b) => {
    const aTerminal = isStudioChildPanelTerminalStatus(a.status)
      || (a.status === "unknown" && Boolean(a.finishedAt));
    const bTerminal = isStudioChildPanelTerminalStatus(b.status)
      || (b.status === "unknown" && Boolean(b.finishedAt));

    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1;

    if (!aTerminal && !bTerminal) {
      const rankDiff = activeRank(a.status) - activeRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      const timeDiff = activeSortKey(b) - activeSortKey(a);
      if (timeDiff !== 0) return timeDiff;
      return a.sessionId.localeCompare(b.sessionId);
    }

    const timeDiff = terminalSortKey(b) - terminalSortKey(a);
    if (timeDiff !== 0) return timeDiff;
    return a.sessionId.localeCompare(b.sessionId);
  });
}

/**
 * Apply terminal limit + defensive active cap after stable sort.
 * Active rows keep semantic priority order; terminal keeps newest-first order.
 */
export function applyStudioChildSessionListLimits(
  sorted: StudioChildSessionListItem[],
  options: {
    terminalLimit?: number;
    defensiveActiveCap?: number;
  } = {},
): {
  children: StudioChildSessionListItem[];
  activeCount: number;
  waitingForUser: number;
  terminalAvailable: number;
  terminalReturned: number;
  terminalTruncated: boolean;
  activeTruncated: boolean;
  defensiveActiveCap: number;
} {
  const terminalLimit = options.terminalLimit ?? STUDIO_CHILD_TERMINAL_LIMIT;
  const defensiveActiveCap = options.defensiveActiveCap ?? STUDIO_CHILD_DEFENSIVE_ACTIVE_CAP;

  const active: StudioChildSessionListItem[] = [];
  const terminal: StudioChildSessionListItem[] = [];
  for (const item of sorted) {
    const isTerminal = isStudioChildPanelTerminalStatus(item.status)
      || (item.status === "unknown" && Boolean(item.finishedAt));
    if (isTerminal) terminal.push(item);
    else active.push(item);
  }

  const activeTruncated = active.length > defensiveActiveCap;
  const activeReturned = activeTruncated ? active.slice(0, defensiveActiveCap) : active;
  const terminalTruncated = terminal.length > terminalLimit;
  const terminalReturnedItems = terminalTruncated ? terminal.slice(0, terminalLimit) : terminal;

  return {
    children: [...activeReturned, ...terminalReturnedItems],
    activeCount: activeReturned.length,
    waitingForUser: activeReturned.filter((item) => item.status === "waiting_for_user").length,
    terminalAvailable: terminal.length,
    terminalReturned: terminalReturnedItems.length,
    terminalTruncated,
    activeTruncated,
    defensiveActiveCap,
  };
}

export function isHighConfidenceStudioChildOfParent(
  session: Pick<SessionInfo, "id" | "studioChild">,
  parentSessionId: string,
): boolean {
  const studioChild = session.studioChild;
  if (!studioChild) return false;
  if (studioChild.kind !== "ypi-studio-child-session") return false;
  if (!studioChild.parentSessionId) return false;
  return studioChild.parentSessionId === parentSessionId;
}

type TaskLookup = {
  getDetail: (cwd: string, taskId: string) => YpiStudioTaskDetail | null;
};

type TaskCacheEntry =
  | { ok: true; detail: YpiStudioTaskDetail }
  | { ok: false; reason: string };

function taskCacheKey(cwd: string, taskId: string): string {
  return `${cwd}\0${taskId}`;
}

function resolveTaskDetail(
  cwd: string,
  taskId: string,
  cache: Map<string, TaskCacheEntry>,
  lookup: TaskLookup,
  warnings: string[],
): YpiStudioTaskDetail | null {
  const key = taskCacheKey(cwd, taskId);
  const cached = cache.get(key);
  if (cached) return cached.ok ? cached.detail : null;

  try {
    const detail = lookup.getDetail(cwd, taskId);
    if (!detail) {
      cache.set(key, { ok: false, reason: "missing" });
      return null;
    }
    cache.set(key, { ok: true, detail });
    return detail;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cache.set(key, { ok: false, reason: message });
    if (warnings.length < 8) {
      warnings.push(`task_lookup_failed:${truncateStudioChildWireString(taskId, 64) ?? "unknown"}`);
    }
    return null;
  }
}

function findTaskRun(
  detail: YpiStudioTaskDetail | null,
  runId: string,
): YpiStudioTaskSubagentRun | undefined {
  if (!detail?.subagents?.length) return undefined;
  return detail.subagents.find((run) => run.id === runId);
}

function resolveDisplay(session: SessionInfo): SessionInfo["studioChildDisplay"] {
  if (session.studioChildDisplay) return session.studioChildDisplay;
  // Inventory path normally pre-projects display; fallback is best-effort only.
  return undefined;
}

export function projectStudioChildSessionListItem(
  session: SessionInfo,
  options: {
    taskDetail?: YpiStudioTaskDetail | null;
    taskLookupFailed?: boolean;
  } = {},
): StudioChildSessionListItem | null {
  const studioChild = session.studioChild;
  if (!studioChild || studioChild.kind !== "ypi-studio-child-session") return null;
  if (!studioChild.taskId || !studioChild.runId || !studioChild.member) return null;

  const display = resolveDisplay(session);
  const run = findTaskRun(options.taskDetail ?? null, studioChild.runId);
  const statusSource: "task" | "header" = run ? "task" : "header";
  const raw = run?.status ?? studioChild.status;
  const { status, rawStatus } = normalizeStudioChildPanelStatus(raw);
  const statusMayBeStale = statusSource === "header" || Boolean(options.taskLookupFailed);

  const subtaskId = truncateStudioChildWireString(studioChild.subtaskId ?? display?.subtaskId);
  const taskTitle = truncateStudioChildWireString(display?.taskTitle);
  const subtaskTitle = truncateStudioChildWireString(display?.subtaskTitle);
  const member = truncateStudioChildWireString(studioChild.member) ?? "member";
  const taskId = truncateStudioChildWireString(studioChild.taskId, STUDIO_CHILD_STRING_BUDGET) ?? studioChild.taskId;
  const runId = truncateStudioChildWireString(studioChild.runId, STUDIO_CHILD_STRING_BUDGET) ?? studioChild.runId;

  const title = truncateStudioChildWireString(
    studioChildSessionTitle({
      subtaskId,
      subtaskTitle,
      member,
      taskTitle,
      runSummary: display?.runSummary,
      taskId,
    }),
  ) ?? (subtaskId || member);

  const createdAt = studioChild.createdAt || session.created;
  const startedAt = run?.startedAt || studioChild.createdAt || undefined;
  const finishedAt = run?.finishedAt || studioChild.finishedAt || undefined;

  return {
    sessionId: session.id,
    taskId,
    runId,
    member,
    ...(subtaskId ? { subtaskId } : {}),
    title,
    ...(taskTitle ? { taskTitle } : {}),
    ...(subtaskTitle ? { subtaskTitle } : {}),
    status,
    ...(rawStatus ? { rawStatus } : {}),
    statusSource,
    statusMayBeStale,
    createdAt,
    modifiedAt: session.modified,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    messageCount: session.messageCount,
  };
}

/**
 * Pure projection from an already-loaded active inventory snapshot.
 * Exported for focused unit tests (no filesystem / inventory I/O).
 */
export function buildStudioChildSessionListFromSessions(
  parentSessionId: string,
  sessions: SessionInfo[],
  options: {
    taskLookup?: TaskLookup;
    generatedAt?: string;
    terminalLimit?: number;
    defensiveActiveCap?: number;
  } = {},
): StudioChildSessionListResponse {
  if (!options.taskLookup) {
    throw new Error("taskLookup is required for pure projection; production path injects the default reader");
  }
  const lookup = options.taskLookup;
  const warnings: string[] = [];
  const taskCache = new Map<string, TaskCacheEntry>();

  const projected: StudioChildSessionListItem[] = [];
  for (const session of sessions) {
    if (!isHighConfidenceStudioChildOfParent(session, parentSessionId)) continue;
    const studioChild = session.studioChild!;
    const cwd = session.cwd ?? "";
    const detail = resolveTaskDetail(cwd, studioChild.taskId, taskCache, lookup, warnings);
    const cacheEntry = taskCache.get(taskCacheKey(cwd, studioChild.taskId));
    const taskLookupFailed = Boolean(cacheEntry && !cacheEntry.ok && cacheEntry.reason !== "missing");
    const item = projectStudioChildSessionListItem(session, {
      taskDetail: detail,
      taskLookupFailed,
    });
    if (item) projected.push(item);
  }

  const sorted = sortStudioChildSessionListItems(projected);
  const limited = applyStudioChildSessionListLimits(sorted, {
    terminalLimit: options.terminalLimit,
    defensiveActiveCap: options.defensiveActiveCap,
  });

  return {
    kind: "ypi_studio_child_sessions",
    parentSessionId,
    children: limited.children,
    counts: {
      active: limited.activeCount,
      waitingForUser: limited.waitingForUser,
      terminalAvailable: limited.terminalAvailable,
      terminalReturned: limited.terminalReturned,
    },
    limits: {
      terminal: STUDIO_CHILD_TERMINAL_LIMIT,
      terminalTruncated: limited.terminalTruncated,
      defensiveActiveCap: limited.defensiveActiveCap,
      activeTruncated: limited.activeTruncated,
    },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(warnings.length ? { warnings } : {}),
  };
}

async function defaultTaskLookup(): Promise<TaskLookup> {
  const { getYpiStudioTaskDetail, listYpiStudioTasks } = await import("./ypi-studio-tasks");
  return {
    getDetail(cwd, taskId) {
      try {
        let detail = getYpiStudioTaskDetail(cwd, taskId);
        if (!detail) {
          const match = listYpiStudioTasks(cwd, { scope: "all" }).tasks.find((task) => task.id === taskId);
          if (match) detail = getYpiStudioTaskDetail(cwd, match.key);
        }
        return detail;
      } catch {
        return null;
      }
    },
  };
}

async function defaultListSessions(): Promise<SessionInfo[]> {
  const { listAllSessions } = await import("./session-reader");
  return listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true });
}

/**
 * Resolve parent session from the active inventory and return the panel projection.
 * Throws StudioChildSessionListError for invalid/missing/child ids (no path leakage).
 */
export async function getStudioChildSessionListForParent(
  parentSessionId: string,
  options: {
    listSessions?: () => Promise<SessionInfo[]>;
    taskLookup?: TaskLookup;
    generatedAt?: string;
  } = {},
): Promise<StudioChildSessionListResponse> {
  const id = parentSessionId?.trim();
  if (!id) {
    throw new StudioChildSessionListError("invalid_parent", "Session id is required", 400);
  }

  const listSessions = options.listSessions ?? defaultListSessions;
  const sessions = await listSessions();
  const parent = sessions.find((session) => session.id === id);

  if (!parent) {
    throw new StudioChildSessionListError("not_found", "Session not found", 404);
  }
  if (parent.studioChild?.kind === "ypi-studio-child-session") {
    throw new StudioChildSessionListError(
      "is_studio_child",
      "Studio child sessions do not have child inventories",
      400,
    );
  }

  const taskLookup = options.taskLookup ?? await defaultTaskLookup();
  return buildStudioChildSessionListFromSessions(id, sessions, {
    taskLookup,
    generatedAt: options.generatedAt,
  });
}
