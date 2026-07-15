import { SessionManager } from "@earendil-works/pi-coding-agent";
import { listAllArchivedSessionMetadata, listAllSessions } from "@/lib/session-reader";
import type { SessionEntry, SessionInfo, SessionMessageEntry, AssistantMessage, StudioChildSessionInfo } from "@/lib/types";
import {
  projectYpiStudioChildContextUsageBySessionIds,
  unavailableYpiStudioChildContextUsage,
  type YpiStudioChildContextUsageSnapshot,
} from "@/lib/ypi-studio-subagent-runtime";

/** Additive child context occupancy snapshot (API alias of runtime projection type). */
export type SessionContextUsageSnapshot = YpiStudioChildContextUsageSnapshot;

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  calls: number;
}

export type UsageSessionKind = "root" | "studio_child";

export interface UsageStudioChildSummary {
  taskId: string;
  runId: string;
  member: string;
  subtaskId?: string;
  status?: string;
}

export interface UsageSessionSummary {
  sessionId: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  totals: UsageTotals;
  kind?: UsageSessionKind;
  parentSessionId?: string;
  studioChild?: UsageStudioChildSummary;
  /**
   * Additive context-window occupancy for this child session.
   * Only populated on session_rollup `childSessions[]`.
   * Never derived from lifetime usage; missing/unavailable ≠ 0%.
   */
  contextUsage?: SessionContextUsageSnapshot;
}

export interface UsageParentSessionSummary {
  parentSessionId: string;
  parentFound: boolean;
  cwd: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  totals: UsageTotals;
  ownTotals: UsageTotals;
  studioChildTotals: UsageTotals;
  studioChildSessionCount: number;
  sessionIds: string[];
  studioChildSessionIds: string[];
}

export interface UsageSessionRollupOptions {
  sessionId: string;
  from?: Date;
  to?: Date;
  includeArchived?: boolean;
}

/**
 * "session_rollup" 顶栏费用展示口径（由主会话确认）：
 *
 * - `parent`：选中父 session。compact 显示 parent rollup totals（`parentRollupTotals` =
 *   父自身 + 所有 Studio child），当存在真实 child usage 时追加 `incl. Studio`；
 *   tooltip 拆分 own / Studio children cost。`selectedSessionTotals` 此时等于父自身 totals。
 * - `standalone`：选中普通 session（无 Studio child）。compact 显示该 session 自身 totals；
 *   `selectedSessionTotals` === `parentRollupTotals` === `totals` === `ownTotals`。
 * - `studio_child`：选中 Studio child audit session。compact 只显示该 child 自身 totals
 *   （`selectedSessionTotals`），不再显示 parent rollup 占位语义；tooltip 可附带 parent rollup
 *   totals（`parentRollupTotals`）与 parent id 说明。
 *
 * 新增字段均为 additive：`totals` / `ownTotals` / `studioChildTotals` / `childSessions` 等旧字段
 * 语义不变，旧调用方继续可用。不改变 JSONL header，不读取 child transcript sidecar。
 */
export interface UsageSessionRollupResult {
  kind: "session_rollup";
  sessionId: string;
  parentSessionId: string;
  selectedSessionKind: "parent" | "studio_child" | "standalone";
  parentFound: boolean;
  scope: {
    timezone: string;
    includeArchived: boolean;
    includeStudioChildren: true;
    relation: "self-and-studio-children";
  };
  /** Parent rollup totals = parent own + all Studio children. 旧字段，语义不变。compact 用于 parent/standalone。 */
  totals: UsageTotals;
  /** 父 session 自身 totals（不含 Studio child）。旧字段，语义不变。 */
  ownTotals: UsageTotals;
  /** 所有 Studio child totals 之和。旧字段，语义不变。 */
  studioChildTotals: UsageTotals;
  /**
   * 选中 session 自身的 totals（additive）。
   * - parent → 父自身 totals；
   * - standalone → 该 session 自身 totals；
   * - studio_child → 该 child 自身 totals，作为 child compact 展示值。
   * 不含其他 session 的 usage，不等于 `totals`（除非 standalone）。
   */
  selectedSessionTotals: UsageTotals;
  /**
   * Parent rollup totals（additive），恒等于 `totals`，命名上明确 parent rollup 语义，
   * 供 studio_child tooltip 与 parent compact 共用，避免调用方凭 `totals` 字段名猜测口径。
   */
  parentRollupTotals: UsageTotals;
  studioChildSessionCount: number;
  childSessions: UsageSessionSummary[];
  scannedSessions: number;
  matchedSessions: number;
  skippedEntries: number;
}

interface UsageRecord {
  entry: SessionMessageEntry;
  message: AssistantMessage;
  session: SessionInfo;
}

/**
 * 创建一个空的费用统计汇总对象。
 *
 * @returns 初始化为 0 的 token、费用和调用次数汇总。
 */
function createTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };
}

function cloneTotals(totals: UsageTotals): UsageTotals {
  return { ...totals };
}

function addTotals(target: UsageTotals, source: UsageTotals): void {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  // cacheWrite: no longer aggregated (per cw-removal decision).
  // Field stays at 0 for backward compatibility.
  target.cost += source.cost;
  target.calls += source.calls;
}

/**
 * 将单条 assistant usage 累加到指定汇总对象。
 *
 * @param totals 需要被累加的目标汇总对象。
 * @param usage assistant 消息中持久化的 usage 信息。
 */
function addUsage(totals: UsageTotals, usage: AssistantMessage["usage"]): void {
  if (!usage) return;
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  // cacheWrite: no longer aggregated (per cw-removal decision).
  // Field stays at 0 for backward compatibility.
  totals.cost += usage.cost?.total ?? 0;
  totals.calls += 1;
}

/**
 * 判断 session entry 是否为带 usage 的 assistant 消息。
 *
 * @param entry 从 Pi session 文件读取的原始 entry。
 * @returns 若 entry 可参与费用统计则返回 true。
 */
function isUsageMessageEntry(entry: SessionEntry): entry is SessionMessageEntry & { message: AssistantMessage } {
  return entry.type === "message" && entry.message.role === "assistant" && Boolean(entry.message.usage);
}

function studioChildSummary(studioChild: StudioChildSessionInfo): UsageStudioChildSummary {
  return {
    taskId: studioChild.taskId,
    runId: studioChild.runId,
    member: studioChild.member,
    subtaskId: studioChild.subtaskId,
    status: studioChild.status,
  };
}

function sessionSummary(session: SessionInfo, totals: UsageTotals = createTotals()): UsageSessionSummary {
  const parentSessionId = session.studioChild?.parentSessionId;
  return {
    sessionId: session.id,
    cwd: session.cwd,
    name: session.name,
    firstMessage: session.firstMessage,
    created: session.created,
    modified: session.modified,
    totals,
    kind: session.studioChild ? "studio_child" : "root",
    parentSessionId,
    studioChild: session.studioChild ? studioChildSummary(session.studioChild) : undefined,
  };
}

function isWithinRange(timestamp: string, from?: Date, to?: Date): boolean | null {
  const at = new Date(timestamp).getTime();
  if (!Number.isFinite(at)) return null;
  if (from && at < from.getTime()) return false;
  if (to && at > to.getTime()) return false;
  return true;
}

function addRecordToSessionMap(bySession: Map<string, UsageSessionSummary>, record: UsageRecord): void {
  if (!bySession.has(record.session.id)) {
    bySession.set(record.session.id, sessionSummary(record.session, createTotals()));
  }
  addUsage(bySession.get(record.session.id)!.totals, record.message.usage);
}

function buildParentRollups(sessions: SessionInfo[], bySession: Map<string, UsageSessionSummary>): UsageParentSessionSummary[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const rollups = new Map<string, UsageParentSessionSummary>();

  const ensureRollup = (parentSessionId: string, fallbackSession: SessionInfo): UsageParentSessionSummary => {
    const existing = rollups.get(parentSessionId);
    if (existing) return existing;

    const parentSession = sessionsById.get(parentSessionId);
    const displaySession = parentSession ?? fallbackSession;
    const rollup: UsageParentSessionSummary = {
      parentSessionId,
      parentFound: Boolean(parentSession),
      cwd: displaySession.cwd,
      name: displaySession.name,
      firstMessage: displaySession.firstMessage,
      created: displaySession.created,
      modified: displaySession.modified,
      totals: createTotals(),
      ownTotals: createTotals(),
      studioChildTotals: createTotals(),
      studioChildSessionCount: 0,
      sessionIds: parentSession ? [parentSession.id] : [],
      studioChildSessionIds: [],
    };
    rollups.set(parentSessionId, rollup);
    return rollup;
  };

  for (const session of sessions) {
    if (session.studioChild) {
      const parentSessionId = session.studioChild.parentSessionId || session.id;
      const rollup = ensureRollup(parentSessionId, session);
      if (!rollup.studioChildSessionIds.includes(session.id)) {
        rollup.studioChildSessionIds.push(session.id);
        rollup.studioChildSessionCount += 1;
      }
      if (!rollup.sessionIds.includes(session.id)) rollup.sessionIds.push(session.id);
      const childTotals = bySession.get(session.id)?.totals ?? createTotals();
      addTotals(rollup.studioChildTotals, childTotals);
      addTotals(rollup.totals, childTotals);
      continue;
    }

    const rollup = ensureRollup(session.id, session);
    const ownTotals = bySession.get(session.id)?.totals ?? createTotals();
    addTotals(rollup.ownTotals, ownTotals);
    addTotals(rollup.totals, ownTotals);
  }

  return [...rollups.values()]
    .filter((rollup) => rollup.totals.calls > 0)
    .map((rollup) => ({
      ...rollup,
      totals: cloneTotals(rollup.totals),
      ownTotals: cloneTotals(rollup.ownTotals),
      studioChildTotals: cloneTotals(rollup.studioChildTotals),
      sessionIds: [...rollup.sessionIds],
      studioChildSessionIds: [...rollup.studioChildSessionIds],
    }))
    .sort((a, b) => b.totals.cost - a.totals.cost);
}

async function collectUsageRecords(sessions: SessionInfo[], from?: Date, to?: Date): Promise<{ records: UsageRecord[]; skippedEntries: number }> {
  const records: UsageRecord[] = [];
  let skippedEntries = 0;

  for (const session of sessions) {
    let entries: SessionEntry[];
    try {
      entries = SessionManager.open(session.path).getEntries() as unknown as SessionEntry[];
    } catch {
      skippedEntries += 1;
      continue;
    }

    for (const entry of entries) {
      if (!isUsageMessageEntry(entry)) continue;
      const inRange = isWithinRange(entry.timestamp, from, to);
      if (inRange === null) {
        skippedEntries += 1;
        continue;
      }
      if (!inRange) continue;
      records.push({ entry, message: entry.message, session });
    }
  }

  return { records, skippedEntries };
}

/** Re-export pure local-date helpers so existing rollup callers keep working. */
export { formatLocalDate, parseLocalDateParam } from "@/lib/local-date-range";

/**
 * Aggregate usage for a selected session and its related Studio children.
 * Powers Chat top-bar SessionStatsChips; does not scan the global session inventory for date ranges.
 */
export async function getUsageStatsForSessionRollup(options: UsageSessionRollupOptions): Promise<UsageSessionRollupResult | null> {
  const activeSessions = await listAllSessions({ includeStudioChildren: true });
  const archivedSessions = options.includeArchived === false ? [] : await listAllArchivedSessionMetadata({ includeStudioChildren: true });
  const sessions = [...activeSessions, ...archivedSessions];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const selectedSession = sessionById.get(options.sessionId);
  if (!selectedSession) return null;

  const selectedSessionKind = selectedSession.studioChild
    ? "studio_child"
    : sessions.some((session) => session.studioChild?.parentSessionId === selectedSession.id)
      ? "parent"
      : "standalone";
  const parentSessionId = selectedSession.studioChild?.parentSessionId || selectedSession.id;
  const relatedSessions = sessions.filter((session) => session.id === parentSessionId || session.studioChild?.parentSessionId === parentSessionId);
  const { records, skippedEntries } = await collectUsageRecords(relatedSessions, options.from, options.to);

  const bySession = new Map<string, UsageSessionSummary>();
  for (const record of records) addRecordToSessionMap(bySession, record);

  const rollup = buildParentRollups(relatedSessions, bySession).find((summary) => summary.parentSessionId === parentSessionId);
  const ownTotals = rollup ? cloneTotals(rollup.ownTotals) : createTotals();
  const studioChildTotals = rollup ? cloneTotals(rollup.studioChildTotals) : createTotals();
  const totals = rollup ? cloneTotals(rollup.totals) : createTotals();
  // selectedSessionTotals = 选中 session 自身 usage（不含其他 session）。
  // parent → 父自身；standalone → 自身；studio_child → 该 child 自身（用于 child compact 展示）。
  const selectedSessionTotals = cloneTotals(bySession.get(options.sessionId)?.totals ?? createTotals());
  // parentRollupTotals = parent rollup（父自身 + 所有 Studio child），恒等于 totals，命名上明确口径。
  const parentRollupTotals = cloneTotals(totals);
  const childSessionsBase = relatedSessions
    .filter((session) => session.studioChild?.parentSessionId === parentSessionId)
    .map((session) => sessionSummary(session, cloneTotals(bySession.get(session.id)?.totals ?? createTotals())))
    .sort((a, b) => b.totals.cost - a.totals.cost);

  // Merge process-local live/lastKnown context snapshots only (Path A). No lifetime-usage math.
  const contextByChildId = projectYpiStudioChildContextUsageBySessionIds(
    childSessionsBase.map((child) => child.sessionId),
  );
  const childSessions = childSessionsBase.map((child) => ({
    ...child,
    contextUsage: contextByChildId.get(child.sessionId) ?? unavailableYpiStudioChildContextUsage(),
  }));

  return {
    kind: "session_rollup",
    sessionId: options.sessionId,
    parentSessionId,
    selectedSessionKind,
    parentFound: sessionById.has(parentSessionId),
    scope: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      includeArchived: options.includeArchived !== false,
      includeStudioChildren: true,
      relation: "self-and-studio-children",
    },
    totals,
    ownTotals,
    studioChildTotals,
    selectedSessionTotals,
    parentRollupTotals,
    studioChildSessionCount: childSessions.length,
    childSessions,
    scannedSessions: sessions.length,
    matchedSessions: relatedSessions.length,
    skippedEntries,
  };
}
