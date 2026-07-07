import { SessionManager } from "@earendil-works/pi-coding-agent";
import { listAllArchivedSessionMetadata, listAllArchivedSessions, listAllSessions } from "@/lib/session-reader";
import { canonicalizeCwd, expandCwd } from "@/lib/cwd";
import type { SessionEntry, SessionInfo, SessionMessageEntry, AssistantMessage, StudioChildSessionInfo } from "@/lib/types";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  calls: number;
}

export interface UsageDaySummary {
  date: string;
  totals: UsageTotals;
}

export interface UsageModelSummary {
  provider: string;
  model: string;
  totals: UsageTotals;
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

export interface UsageStatsResult {
  from: string;
  to: string;
  scope: {
    cwd?: string;
    timezone: string;
    includeArchived: boolean;
    includeStudioChildren: true;
  };
  totals: UsageTotals;
  byDay: UsageDaySummary[];
  byModel: UsageModelSummary[];
  byProvider: UsageModelSummary[];
  bySession: UsageSessionSummary[];
  byParentSession: UsageParentSessionSummary[];
  scannedSessions: number;
  matchedSessions: number;
  scannedActiveSessions: number;
  scannedArchivedSessions: number;
  matchedActiveSessions: number;
  matchedArchivedSessions: number;
  scannedStudioChildSessions: number;
  matchedStudioChildSessions: number;
  skippedEntries: number;
}

export interface UsageStatsOptions {
  from: Date;
  to: Date;
  cwd?: string;
  includeArchived?: boolean;
}

export interface UsageSessionRollupOptions {
  sessionId: string;
  from?: Date;
  to?: Date;
  includeArchived?: boolean;
}

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
  totals: UsageTotals;
  ownTotals: UsageTotals;
  studioChildTotals: UsageTotals;
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

function cwdKeys(cwd: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!cwd) return keys;
  for (const candidate of [cwd, expandCwd(cwd), canonicalizeCwd(cwd)]) {
    if (candidate) keys.add(candidate.replace(/[\\/]+$/, ""));
  }
  return keys;
}

function cwdMatches(sessionCwd: string | undefined, filterCwd: string | undefined): boolean {
  if (!filterCwd) return true;
  const targets = cwdKeys(filterCwd);
  for (const key of cwdKeys(sessionCwd)) {
    if (targets.has(key)) return true;
  }
  return false;
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
  target.cacheWrite += source.cacheWrite;
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
  totals.cacheWrite += usage.cacheWrite ?? 0;
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

/**
 * 将日期格式化为本地日粒度字符串。
 *
 * @param date 需要格式化的日期对象。
 * @returns `YYYY-MM-DD` 格式的本地日期。
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 解析 `YYYY-MM-DD` 日期字符串为本地日期范围边界。
 *
 * @param value 查询参数中的日期字符串。
 * @param endOfDay 为 true 时返回当天 23:59:59.999，否则返回当天 00:00:00.000。
 * @returns 解析后的 Date；格式非法时返回 null。
 */
export function parseLocalDateParam(value: string | null, endOfDay: boolean): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * 按日期范围聚合所有 Pi session 的 assistant usage 费用信息。
 *
 * @param options 日期范围和可选 cwd 过滤条件。
 * @returns 费用统计总览以及按日、模型、供应商、会话拆分的汇总。
 */
export async function getUsageStats(options: UsageStatsOptions): Promise<UsageStatsResult> {
  const activeSessions = await listAllSessions({ includeStudioChildren: true });
  const archivedSessions = options.includeArchived === false ? [] : await listAllArchivedSessions({ includeStudioChildren: true });
  const sessions = [...activeSessions, ...archivedSessions];
  const matchedSessions = sessions.filter((session) => cwdMatches(session.cwd, options.cwd));
  const matchedActiveSessions = matchedSessions.filter((session) => !session.archived);
  const matchedArchivedSessions = matchedSessions.filter((session) => session.archived);
  const scannedStudioChildSessions = sessions.filter((session) => Boolean(session.studioChild)).length;
  const matchedStudioChildSessions = matchedSessions.filter((session) => Boolean(session.studioChild)).length;
  const { records, skippedEntries } = await collectUsageRecords(matchedSessions, options.from, options.to);

  const totals = createTotals();
  const byDay = new Map<string, UsageTotals>();
  const byModel = new Map<string, UsageModelSummary>();
  const byProvider = new Map<string, UsageModelSummary>();
  const bySession = new Map<string, UsageSessionSummary>();

  for (const record of records) {
    const usage = record.message.usage;
    addUsage(totals, usage);

    const dayKey = formatLocalDate(new Date(record.entry.timestamp));
    if (!byDay.has(dayKey)) byDay.set(dayKey, createTotals());
    addUsage(byDay.get(dayKey)!, usage);

    const provider = record.message.provider || "unknown";
    const model = record.message.model || "unknown";
    const modelKey = `${provider}/${model}`;
    if (!byModel.has(modelKey)) byModel.set(modelKey, { provider, model, totals: createTotals() });
    addUsage(byModel.get(modelKey)!.totals, usage);

    if (!byProvider.has(provider)) byProvider.set(provider, { provider, model: "all", totals: createTotals() });
    addUsage(byProvider.get(provider)!.totals, usage);

    addRecordToSessionMap(bySession, record);
  }

  return {
    from: formatLocalDate(options.from),
    to: formatLocalDate(options.to),
    scope: {
      cwd: options.cwd,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      includeArchived: options.includeArchived !== false,
      includeStudioChildren: true,
    },
    totals,
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayTotals]) => ({ date, totals: dayTotals })),
    byModel: [...byModel.values()].sort((a, b) => b.totals.cost - a.totals.cost),
    byProvider: [...byProvider.values()].sort((a, b) => b.totals.cost - a.totals.cost),
    bySession: [...bySession.values()].sort((a, b) => b.totals.cost - a.totals.cost),
    byParentSession: buildParentRollups(matchedSessions, bySession),
    scannedSessions: sessions.length,
    matchedSessions: matchedSessions.length,
    scannedActiveSessions: activeSessions.length,
    scannedArchivedSessions: archivedSessions.length,
    matchedActiveSessions: matchedActiveSessions.length,
    matchedArchivedSessions: matchedArchivedSessions.length,
    scannedStudioChildSessions,
    matchedStudioChildSessions,
    skippedEntries,
  };
}

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
  const childSessions = relatedSessions
    .filter((session) => session.studioChild?.parentSessionId === parentSessionId)
    .map((session) => sessionSummary(session, cloneTotals(bySession.get(session.id)?.totals ?? createTotals())))
    .sort((a, b) => b.totals.cost - a.totals.cost);

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
    studioChildSessionCount: childSessions.length,
    childSessions,
    scannedSessions: sessions.length,
    matchedSessions: relatedSessions.length,
    skippedEntries,
  };
}
