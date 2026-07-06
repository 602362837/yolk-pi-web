import { createHash } from "crypto";
import type { SessionEntry, AgentMessage, ToolResultMessage, AssistantMessage, ToolCallContent } from "./types";
import { getYpiStudioTaskDetail, getYpiStudioTaskIdForContext, listYpiStudioTasks } from "./ypi-studio-tasks";
import { readYpiStudioSubagentTranscriptPreview } from "./ypi-studio-transcripts";
import { orderYpiStudioWorkflowStates } from "./ypi-studio-workflow-flow";
import { readYpiStudioWorkflow } from "./ypi-studio-workflows";
import type {
  YpiStudioSessionTaskLinkResult,
  YpiStudioSessionTaskLinkSource,
  YpiStudioTaskDetail,
  YpiStudioTaskSummary,
  YpiStudioTaskWidgetProjection,
  YpiStudioWorkflowState,
  YpiStudioTaskWidgetSubagentRun,
  YpiStudioSubagentRunStatus,
  YpiStudioSubagentTranscriptItem,
} from "./ypi-studio-types";

interface ResolveOptions {
  cwd: string;
  sessionId: string;
  sessionFilePath: string;
  entries: SessionEntry[];
  leafId?: string | null;
}

interface CandidateEvidence {
  candidate: string;
  source: YpiStudioSessionTaskLinkSource;
  order: number;
  structured: boolean;
  cwd?: string;
}

type ResolvedSummary = { task: YpiStudioTaskSummary; source: YpiStudioSessionTaskLinkSource };
type UnresolvedLink = Extract<YpiStudioSessionTaskLinkResult, { task: null }>;

interface TaskIndex {
  tasks: YpiStudioTaskSummary[];
  byKey: Map<string, YpiStudioTaskSummary>;
  byId: Map<string, YpiStudioTaskSummary | "ambiguous">;
  byPathLabel: Map<string, YpiStudioTaskSummary>;
}

const TEXT_TASK_RE = /(?:Created|Transitioned|Archived) YPI Studio task\s+([A-Za-z0-9._-]+)/gi;
const TASK_PATH_RE = /\.ypi\/tasks\/(?:archive\/(\d{4}-\d{2})\/)?([A-Za-z0-9._-]+)/g;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function sanitizePiSessionId(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "_");
  return safe || hash(value);
}

function exactRuntimeKeys(sessionId: string, sessionFilePath: string): string[] {
  return [`pi_${sanitizePiSessionId(sessionId)}`, `pi_transcript_${hash(sessionFilePath)}`];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePathLabel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function canonicalCwd(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function branchEntries(entries: SessionEntry[], leafId?: string | null): SessionEntry[] {
  if (!leafId) return entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let current = byId.get(leafId) ?? null;
  while (current && !seen.has(current.id)) {
    path.push(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) ?? null : null;
  }
  return path.reverse();
}

function buildTaskIndex(tasks: YpiStudioTaskSummary[]): TaskIndex {
  const byKey = new Map<string, YpiStudioTaskSummary>();
  const byIdBuckets = new Map<string, YpiStudioTaskSummary[]>();
  const byPathLabel = new Map<string, YpiStudioTaskSummary>();
  for (const task of tasks) {
    byKey.set(task.key, task);
    byPathLabel.set(normalizePathLabel(task.pathLabel), task);
    const bucket = byIdBuckets.get(task.id) ?? [];
    bucket.push(task);
    byIdBuckets.set(task.id, bucket);
  }
  const byId = new Map<string, YpiStudioTaskSummary | "ambiguous">();
  for (const [id, bucket] of byIdBuckets) {
    const active = bucket.filter((task) => !task.archived);
    byId.set(id, active.length === 1 ? active[0] : active.length > 1 ? "ambiguous" : bucket.length === 1 ? bucket[0] : "ambiguous");
  }
  return { tasks, byKey, byId, byPathLabel };
}

function matchCandidate(candidate: string, index: TaskIndex): YpiStudioTaskSummary | null | "ambiguous" {
  const value = normalizePathLabel(candidate);
  const byKey = index.byKey.get(value);
  if (byKey) return byKey;
  const pathMatch = value.match(/\.ypi\/tasks\/(?:archive\/(\d{4}-\d{2})\/)?([^/]+)$/);
  if (pathMatch) {
    const key = pathMatch[1] ? `archived:${pathMatch[1]}:${pathMatch[2]}` : `active:${pathMatch[2]}`;
    return index.byKey.get(key) ?? index.byPathLabel.get(value) ?? null;
  }
  return index.byId.get(value) ?? null;
}

function resolveUnique(evidence: CandidateEvidence[], index: TaskIndex): ResolvedSummary | UnresolvedLink | null {
  if (evidence.length === 0) return null;
  const matches: Array<{ task: YpiStudioTaskSummary; source: YpiStudioSessionTaskLinkSource; order: number }> = [];
  for (const item of evidence) {
    const matched = matchCandidate(item.candidate, index);
    if (matched === "ambiguous") return { task: null, reason: "ambiguous" };
    if (matched) matches.push({ task: matched, source: item.source, order: item.order });
  }
  if (matches.length === 0) return { task: null, reason: "task-not-found" };
  const keys = new Set(matches.map((match) => match.task.key));
  if (keys.size > 1) return { task: null, reason: "ambiguous" };
  return matches.sort((a, b) => b.order - a.order)[0];
}

function collectRuntimeEvidence(cwd: string, sessionId: string, sessionFilePath: string): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  exactRuntimeKeys(sessionId, sessionFilePath).forEach((key, index) => {
    const candidate = getYpiStudioTaskIdForContext(cwd, key);
    if (candidate) evidence.push({ candidate, source: "session-runtime", order: index, structured: true });
  });
  return evidence;
}

function collectContextEvidence(tasks: YpiStudioTaskSummary[], sessionId: string, sessionFilePath: string): CandidateEvidence[] {
  const exact = new Set(exactRuntimeKeys(sessionId, sessionFilePath));
  const evidence: CandidateEvidence[] = [];
  tasks.forEach((task, index) => {
    if (task.contextIds.some((contextId) => exact.has(contextId) && !contextId.startsWith("pi_process_"))) {
      evidence.push({ candidate: task.key, source: "task-context", order: index, structured: true });
    }
  });
  return evidence;
}

function messageTexts(message: AgentMessage): string[] {
  if (message.role === "user" || message.role === "custom") {
    if (typeof message.content === "string") return [message.content];
    return message.content.filter((item) => item.type === "text").map((item) => item.text);
  }
  if (message.role === "assistant") {
    return message.content.filter((item) => item.type === "text" || item.type === "thinking").map((item) => item.type === "text" ? item.text : item.thinking);
  }
  return message.content.filter((item) => item.type === "text").map((item) => item.text);
}

function addDetailsEvidence(details: unknown, output: CandidateEvidence[], order: number, toolName?: string, cwd?: string): void {
  if (!isRecord(details)) return;
  const task = isRecord(details.task) ? details.task : null;
  const run = isRecord(details.run) ? details.run : null;
  const candidates = [
    optionalString(task?.key),
    optionalString(task?.id),
    optionalString(run?.taskKey),
    optionalString(run?.taskId),
  ].filter((item): item is string => !!item);
  const detailCwd = optionalString(task?.cwd);
  for (const candidate of candidates) output.push({ candidate, source: "session-transcript", order, structured: true, cwd: detailCwd ?? cwd });
  if (toolName === "ypi_studio_task" || toolName === "ypi_studio_subagent") return;
}

function collectTranscriptEvidence(entries: SessionEntry[], cwd: string): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  entries.forEach((entry, order) => {
    if (entry.type !== "message") return;
    const message = entry.message;
    if (message.role === "toolResult") {
      if (message.toolName === "ypi_studio_task" || message.toolName === "ypi_studio_subagent") {
        addDetailsEvidence((message as ToolResultMessage).details, evidence, order, message.toolName, cwd);
      }
      for (const text of messageTexts(message)) {
        for (const match of text.matchAll(TEXT_TASK_RE)) evidence.push({ candidate: match[1], source: "session-transcript", order, structured: false });
        for (const match of text.matchAll(TASK_PATH_RE)) evidence.push({ candidate: match[1] ? `archived:${match[1]}:${match[2]}` : `active:${match[2]}`, source: "session-transcript", order, structured: false });
      }
      return;
    }
    if (message.role === "assistant") {
      for (const block of (message as AssistantMessage).content) {
        if (block.type !== "toolCall") continue;
        const tool = block as ToolCallContent;
        if (tool.toolName === "ypi_studio_subagent") {
          const taskId = optionalString(tool.input.taskId);
          if (taskId) evidence.push({ candidate: taskId, source: "session-transcript", order, structured: true });
        } else if (tool.toolName === "ypi_studio_task") {
          const action = optionalString(tool.input.action);
          const taskId = optionalString(tool.input.taskId);
          if (taskId && action !== "create") evidence.push({ candidate: taskId, source: "session-transcript", order, structured: true });
        }
      }
    }
  });
  return evidence.filter((item) => !item.cwd || canonicalCwd(item.cwd) === canonicalCwd(cwd));
}

function resolveTranscript(evidence: CandidateEvidence[], index: TaskIndex): ResolvedSummary | UnresolvedLink | null {
  const structured = evidence.filter((item) => item.structured).sort((a, b) => b.order - a.order);
  if (structured.length > 0) {
    const latest = structured[0];
    const matched = matchCandidate(latest.candidate, index);
    if (matched === "ambiguous") return { task: null, reason: "ambiguous" };
    if (!matched) return { task: null, reason: "task-not-found" };
    return { task: matched, source: latest.source };
  }
  return resolveUnique(evidence.filter((item) => !item.structured), index);
}

function sameResolved(a: ResolvedSummary, b: ResolvedSummary): boolean {
  return a.task.key === b.task.key;
}

function clip(value: string | undefined, max = 500): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function normalizeRunStatus(status: string): YpiStudioSubagentRunStatus {
  return status === "queued" || status === "succeeded" || status === "failed" || status === "cancelled" || status === "waiting_for_user" ? status : "running";
}

function buildSubagents(cwd: string, detail: YpiStudioTaskDetail): YpiStudioTaskWidgetSubagentRun[] {
  const activeRuns = detail.subagents.filter((run) => run.status === "running" || run.status === "queued");
  const recentRuns = detail.subagents
    .filter((run) => run.status !== "running" && run.status !== "queued")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, Math.max(0, 5 - activeRuns.length));
  const runs = [...activeRuns.sort((a, b) => b.startedAt.localeCompare(a.startedAt)), ...recentRuns];
  return runs.map((run) => {
    let lastItemsPreview: YpiStudioSubagentTranscriptItem[] = [];
    const warnings: string[] = [];
    if (run.transcript) {
      try {
        const preview = readYpiStudioSubagentTranscriptPreview(cwd, detail.id, run, { limit: 5, maxItemBytes: 300 });
        lastItemsPreview = preview.items;
        if (preview.warnings?.length) warnings.push(...preview.warnings);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    return {
      id: run.id,
      member: run.member,
      subtaskId: run.subtaskId,
      status: normalizeRunStatus(run.status),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: clip(run.summary),
      error: clip(run.error),
      model: run.model,
      thinking: run.thinking,
      modelSource: run.modelSource,
      thinkingSource: run.thinkingSource,
      phase: run.progress?.phase,
      tokens: run.progress?.tokens,
      tps: run.progress?.tps,
      currentTool: run.progress?.currentTool,
      policy: run.policy,
      transcriptMeta: run.transcript,
      lastItemsPreview,
      warnings: warnings.length ? warnings : undefined,
    };
  });
}

function buildWidgetImplementationProjection(detail: YpiStudioTaskDetail): YpiStudioTaskWidgetProjection["implementationProjection"] {
  const projection = detail.implementationProjection;
  if (!projection) return undefined;
  return {
    maxConcurrency: projection.maxConcurrency,
    statusCounts: projection.statusCounts,
    activeSubtaskIds: projection.activeSubtaskIds,
    queuedSubtaskIds: projection.queuedSubtaskIds,
    nextSubtaskIds: projection.nextSubtaskIds,
    nonTerminalSubtasks: projection.nonTerminalSubtasks.map((subtask) => ({
      ...subtask,
      description: clip(subtask.description, 240),
      files: subtask.files?.slice(0, 8),
      instructions: undefined,
      acceptance: undefined,
      validation: undefined,
      risks: undefined,
      summary: clip(subtask.summary, 300),
      blockedReason: clip(subtask.blockedReason, 300),
      runs: subtask.runs.slice(0, 3).map((run) => ({ ...run, summary: clip(run.summary, 240), error: clip(run.error, 240) })),
    })),
    compactTimeline: projection.compactTimeline.map((item) => ({
      ...item,
      reason: clip(item.reason, 180),
      summary: clip(item.summary, 180),
    })),
    sessionRuntime: projection.sessionRuntime ? {
      ...projection.sessionRuntime,
      timeline: projection.sessionRuntime.timeline.map((item) => ({ ...item, reason: clip(item.reason, 180), summary: clip(item.summary, 180) })),
    } : undefined,
  };
}

function stepStatus(stateIndex: number, currentIndex: number, state: YpiStudioWorkflowState, detail: YpiStudioTaskDetail): "done" | "active" | "pending" {
  if (currentIndex >= 0) return stateIndex < currentIndex ? "done" : stateIndex === currentIndex ? "active" : "pending";
  return state.id === detail.status ? "active" : state.progress < detail.progress.percent ? "done" : "pending";
}

function buildProjection(cwd: string, summary: YpiStudioTaskSummary): YpiStudioTaskWidgetProjection | null {
  const detail = getYpiStudioTaskDetail(cwd, summary.key);
  if (!detail) return null;
  const workflow = readYpiStudioWorkflow(cwd, detail.workflowId);
  const states = orderYpiStudioWorkflowStates(workflow, detail.status);
  const currentIndex = states.findIndex((state) => state.id === detail.status);
  const steps = states.length > 0 ? states.map((state, index) => ({
    id: state.id,
    label: state.label,
    owner: state.owner,
    progress: state.progress,
    requiresSubagent: state.requiresSubagent,
    requiresUserApproval: state.requiresUserApproval,
    requiredArtifacts: state.requiredArtifacts,
    optionalArtifacts: state.optionalArtifacts ?? [],
    status: stepStatus(index, currentIndex, state, detail),
  })) : [{
    id: detail.status,
    label: detail.progress.label,
    owner: detail.progress.owner,
    progress: detail.progress.percent,
    requiredArtifacts: detail.progress.requiredArtifacts,
    optionalArtifacts: detail.progress.optionalArtifacts,
    status: "active" as const,
  }];
  return {
    key: detail.key,
    id: detail.id,
    title: detail.title,
    workflowId: detail.workflowId,
    workflowName: detail.workflowName,
    status: detail.status,
    statusLabel: detail.progress.label,
    progress: detail.progress.percent,
    currentMember: detail.currentMember ?? detail.progress.owner,
    updatedAt: detail.updatedAt,
    archived: detail.archived,
    archiveMonth: detail.archiveMonth,
    archivedAt: detail.archivedAt,
    pathLabel: detail.pathLabel,
    artifacts: {
      required: detail.progress.requiredArtifacts,
      optional: detail.progress.optionalArtifacts,
      completed: detail.progress.completedArtifacts,
      missing: detail.progress.missingArtifacts,
    },
    steps,
    subagents: buildSubagents(cwd, detail),
    events: detail.events.slice(-5).reverse().map((event) => ({ type: event.type, at: event.at, message: event.message, from: event.from, to: event.to, member: event.member, artifact: event.artifact })),
    implementation: detail.implementation,
    implementationProjection: buildWidgetImplementationProjection(detail),
  };
}

function finishResolved(cwd: string, resolved: ResolvedSummary): YpiStudioSessionTaskLinkResult {
  const projection = buildProjection(cwd, resolved.task);
  return projection ? { task: projection, source: resolved.source, confidence: "high" } : { task: null, reason: "task-not-found" };
}

export function resolveYpiStudioTaskForSession(options: ResolveOptions): YpiStudioSessionTaskLinkResult {
  const tasksResponse = listYpiStudioTasks(options.cwd, { scope: "all" });
  const index = buildTaskIndex(tasksResponse.tasks);
  const scopedEntries = branchEntries(options.entries, options.leafId);

  const runtimeResolved = resolveUnique(collectRuntimeEvidence(options.cwd, options.sessionId, options.sessionFilePath), index);
  const contextResolved = resolveUnique(collectContextEvidence(index.tasks, options.sessionId, options.sessionFilePath), index);
  const exactTaskNotFound = runtimeResolved?.task === null && runtimeResolved.reason === "task-not-found"
    ? runtimeResolved
    : contextResolved?.task === null && contextResolved.reason === "task-not-found"
      ? contextResolved
      : null;
  const exactResolved = runtimeResolved?.task && contextResolved?.task
    ? sameResolved(runtimeResolved, contextResolved) ? runtimeResolved : { task: null, reason: "ambiguous" as const }
    : runtimeResolved?.task ? runtimeResolved : contextResolved;

  if (exactResolved?.task === null) return exactResolved;

  const transcriptResolved = resolveTranscript(collectTranscriptEvidence(scopedEntries, options.cwd), index);
  if (transcriptResolved?.task === null) return transcriptResolved;
  if (exactResolved?.task && transcriptResolved?.task && !sameResolved(exactResolved, transcriptResolved)) return { task: null, reason: "ambiguous" };

  const resolved = exactResolved?.task ? exactResolved : transcriptResolved;
  if (resolved?.task) return finishResolved(options.cwd, resolved);
  if (exactTaskNotFound) return exactTaskNotFound;
  if (!tasksResponse.exists) return { task: null, reason: "no-evidence" };
  return { task: null, reason: "no-evidence" };
}
