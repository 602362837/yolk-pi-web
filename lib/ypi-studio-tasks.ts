import { createHash } from "crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import type { Stats } from "fs";
import path from "path";
import { canonicalizeCwd } from "./cwd";
import {
  findYpiStudioTransition,
  getYpiStudioWorkflowOrDefault,
  readYpiStudioWorkflow,
} from "./ypi-studio-workflows";
import type {
  YpiStudioKnowledgeEntry,
  YpiStudioKnowledgeIndex,
  YpiStudioTaskArchiveBody,
  YpiStudioTaskArchiveResult,
  YpiStudioImplementationDependencyStatus,
  YpiStudioImplementationExecution,
  YpiStudioImplementationExecutionGroup,
  YpiStudioImplementationPlan,
  YpiStudioImplementationProgress,
  YpiStudioImplementationSubtaskPlan,
  YpiStudioImplementationSubtaskProgress,
  YpiStudioImplementationSubtaskProjection,
  YpiStudioImplementationSubtaskRelation,
  YpiStudioImplementationSubtaskStatus,
  YpiStudioImplementationLocalReviewStatus,
  YpiStudioImplementationCompactTimelineItem,
  YpiStudioImplementationProjection,
  YpiStudioImplementationRunProjection,
  YpiStudioImplementationSummary,
  YpiStudioTaskImplementationPlanUpdateBody,
  YpiStudioTaskImplementationSubtaskClaimBody,
  YpiStudioTaskImplementationSubtaskUpdateBody,
  YpiStudioTaskArtifactUpdateBody,
  YpiStudioApprovalGate,
  YpiStudioApprovalGrant,
  YpiStudioTaskCreateBody,
  YpiStudioTaskDetail,
  YpiStudioTaskDocument,
  YpiStudioTaskEvent,
  YpiStudioTaskProgress,
  YpiStudioTaskRecord,
  YpiStudioTaskSubagentRun,
  YpiStudioSubagentPolicyDiagnostics,
  YpiStudioSubagentRunProgress,
  YpiStudioSubagentTranscriptRef,
  YpiStudioPolicySource,
  YpiStudioTaskSummary,
  YpiStudioTasksResponse,
  YpiStudioTaskScope,
  YpiStudioTaskTransitionBody,
  YpiStudioWorkflowFile,
  YpiStudioImprovement,
  YpiStudioImprovementInstance,
  YpiStudioImprovementStatus,
  YpiStudioImprovementDisposition,
  YpiStudioImprovementApprovalMode,
  YpiStudioImprovementCreateBody,
  YpiStudioImprovementTransitionBody,
  YpiStudioImprovementDispositionBody,
  YpiStudioImprovementArtifactUpdateBody,
  YpiStudioImprovementPlanUpdateBody,
  YpiStudioImprovementSubtaskClaimBody,
} from "./ypi-studio-types";
import { getYpiStudioChildRun } from "./ypi-studio-subagent-runtime";

const TASKS_DIR = path.join(".ypi", "tasks");
const TASKS_ARCHIVE_DIR = path.join(TASKS_DIR, "archive");
const IMPROVEMENTS_DIR_NAME = "improvements";
const KNOWLEDGE_DIR = path.join(".ypi", "knowledge");
const KNOWLEDGE_INDEX = "index.json";
const RUNTIME_SESSIONS_DIR = path.join(".ypi", ".runtime", "sessions");
const TASK_JSON = "task.json";
const EVENTS_JSONL = "events.jsonl";
const DOC_MAX_BYTES = 256 * 1024;
const EVENTS_MAX_BYTES = 512 * 1024;
const taskMutationLocks = new Set<string>();

const DEFAULT_ARTIFACTS: Record<string, string> = {
  "plan-review": "plan-review.md",
  brief: "brief.md",
  prd: "prd.md",
  ui: "ui.md",
  design: "design.md",
  implement: "implement.md",
  checks: "checks.md",
  handoff: "handoff.md",
  review: "review.md",
  summary: "summary.md",
};

interface TaskContext {
  cwd: string;
  workspaceRoot: string;
  tasksRoot: string;
  archiveRoot: string;
  knowledgeRoot: string;
  knowledgeIndexPath: string;
  runtimeSessionsRoot: string;
}

interface TaskRecordOnDisk {
  key: string;
  id: string;
  dirPath: string;
  pathLabel: string;
  raw: YpiStudioTaskRecord | null;
  readError?: string;
  modifiedMs: number;
  archived: boolean;
  archiveMonth?: string;
}

function withTaskMutationLock<T>(ctx: TaskContext, taskIdOrKey: string, action: () => T): T {
  const lockKey = `${ctx.workspaceRoot}:${parseTaskKey(taskIdOrKey).id}`;
  if (taskMutationLocks.has(lockKey)) throw new Error("YPI Studio task is already being updated. Please retry shortly.");
  taskMutationLocks.add(lockKey);
  try {
    return action();
  } finally {
    taskMutationLocks.delete(lockKey);
  }
}

export class YpiStudioTaskSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YpiStudioTaskSecurityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizePolicyDiagnostics(value: unknown): YpiStudioSubagentPolicyDiagnostics | undefined {
  return isRecord(value) && value.schemaVersion === 1 ? value as unknown as YpiStudioSubagentPolicyDiagnostics : undefined;
}

function normalizeSubagentRunner(value: unknown): YpiStudioTaskSubagentRun["runner"] | undefined {
  return value === "sdk" || value === "cli" ? value : undefined;
}

function normalizePolicySource(value: unknown): YpiStudioPolicySource | undefined {
  return value === "toolInput" || value === "memberConfig" || value === "defaultPolicy" || value === "followMain" || value === "piDefault" || value === "unset" ? value : undefined;
}

function normalizeRequestAffinity(value: unknown): YpiStudioTaskSubagentRun["requestAffinity"] | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.providerSessionIdSource !== "childSessionId") return undefined;
  return {
    schemaVersion: 1,
    providerSessionIdSource: "childSessionId",
    parentSessionId: optionalString(value.parentSessionId),
    childSessionId: optionalString(value.childSessionId),
    model: optionalString(value.model),
    modelSource: normalizePolicySource(value.modelSource),
    thinking: optionalString(value.thinking),
    thinkingSource: normalizePolicySource(value.thinkingSource),
    note: optionalString(value.note),
  };
}

function normalizeRunProgress(value: unknown): YpiStudioSubagentRunProgress | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  const progress = value as unknown as YpiStudioSubagentRunProgress;
  if (isRecord(value.display)) {
    progress.display = {
      recentLimit: numberOr(value.display.recentLimit, progress.itemsPreview?.length ?? 0),
      previewTruncated: value.display.previewTruncated === true,
      finalOutputTruncated: value.display.finalOutputTruncated === true,
      transcriptItemTruncated: value.display.transcriptItemTruncated === true,
      transcriptCaptureLimited: value.display.transcriptCaptureLimited === true,
      apiProjectionLimited: value.display.apiProjectionLimited === true,
    };
  }
  progress.terminationReason = optionalString(value.terminationReason);
  return progress;
}


const IMPLEMENTATION_STATUSES: YpiStudioImplementationSubtaskStatus[] = ["pending", "waiting", "ready", "queued", "running", "blocked", "failed", "done", "skipped"];

function isImplementationStatus(value: unknown): value is YpiStudioImplementationSubtaskStatus {
  return typeof value === "string" && IMPLEMENTATION_STATUSES.includes(value as YpiStudioImplementationSubtaskStatus);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeStringList(value: unknown, max = 80): string[] | undefined {
  const arr = stringArray(value).map((item) => item.trim()).filter(Boolean).slice(0, max);
  return arr.length ? arr : undefined;
}

function isImplementationRelation(value: unknown): value is YpiStudioImplementationSubtaskRelation {
  return value === "serial" || value === "parallel" || value === "barrier";
}

function normalizeSubtaskPlan(value: unknown, index: number): YpiStudioImplementationSubtaskPlan | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id)?.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const title = optionalString(value.title);
  if (!id || !title) return null;
  const localReview = isRecord(value.localReview) ? {
    required: value.localReview.required === true,
    reviewer: optionalString(value.localReview.reviewer),
  } : undefined;
  const dependsOn = Array.from(new Set([...stringArray(value.dependsOn), ...stringArray(value.dependencies)]));
  const relation = isImplementationRelation(value.relation) ? value.relation : value.parallelizable === true ? "parallel" : "serial";
  return {
    id,
    title,
    phase: optionalString(value.phase),
    description: optionalString(value.description),
    order: numberOr(value.order, (index + 1) * 10),
    dependsOn,
    dependencies: dependsOn,
    relation,
    files: normalizeStringList(value.files),
    instructions: normalizeStringList(value.instructions),
    acceptance: normalizeStringList(value.acceptance),
    validation: normalizeStringList(value.validation),
    risks: normalizeStringList(value.risks),
    parallelGroup: optionalString(value.parallelGroup),
    parallelizable: value.parallelizable === true || relation === "parallel",
    member: optionalString(value.member),
    priority: typeof value.priority === "number" && Number.isFinite(value.priority) ? value.priority : undefined,
    failurePolicy: value.failurePolicy === "block_dependents" || value.failurePolicy === "manual" || value.failurePolicy === "allow_dependents_when_skipped" ? value.failurePolicy : undefined,
    retry: isRecord(value.retry) ? { maxAttempts: typeof value.retry.maxAttempts === "number" && Number.isFinite(value.retry.maxAttempts) ? Math.max(0, Math.floor(value.retry.maxAttempts)) : undefined } : undefined,
    localReview,
  };
}

function normalizeExecution(value: unknown, subtasks: YpiStudioImplementationSubtaskPlan[], maxConcurrency: number): YpiStudioImplementationExecution | undefined {
  const ids = new Set(subtasks.map((subtask) => subtask.id));
  const raw = isRecord(value) ? value : undefined;
  const mode = raw?.mode === "serial" || raw?.mode === "parallel" || raw?.mode === "mixed"
    ? raw.mode
    : maxConcurrency > 1 || subtasks.some((subtask) => subtask.relation === "parallel") ? "mixed" : "serial";
  const groups: YpiStudioImplementationExecutionGroup[] = Array.isArray(raw?.groups)
    ? raw.groups.filter(isRecord).reduce<YpiStudioImplementationExecutionGroup[]>((acc, group) => {
      const subtaskIds = stringArray(group.subtaskIds).filter((id) => ids.has(id));
      if (!subtaskIds.length) return acc;
      const dependencies = stringArray(group.dependencies).filter((id) => ids.has(id) || subtaskIds.includes(id));
      acc.push({
        id: optionalString(group.id) ?? subtaskIds.join("-"),
        title: optionalString(group.title) ?? optionalString(group.id) ?? subtaskIds.join(", "),
        relation: isImplementationRelation(group.relation) ? group.relation : subtaskIds.length > 1 ? "parallel" : "serial",
        dependencies,
        subtaskIds,
      });
      return acc;
    }, [])
    : [];
  if (!groups.length) {
    const grouped = new Map<string, YpiStudioImplementationExecutionGroup>();
    for (const subtask of subtasks) {
      const groupId = subtask.parallelGroup ?? subtask.id;
      const existing = grouped.get(groupId);
      if (existing) {
        existing.subtaskIds.push(subtask.id);
        existing.dependencies = Array.from(new Set([...(existing.dependencies ?? []), ...subtask.dependsOn]));
        if (subtask.relation === "parallel") existing.relation = "parallel";
        continue;
      }
      grouped.set(groupId, {
        id: groupId,
        title: subtask.parallelGroup ?? subtask.phase ?? subtask.title,
        relation: subtask.relation,
        dependencies: subtask.dependsOn,
        subtaskIds: [subtask.id],
      });
    }
    groups.push(...grouped.values());
  }
  return { mode, maxParallel: Math.max(1, Math.min(8, Math.floor(numberOr(raw?.maxParallel, maxConcurrency)))), groups };
}

function assertValidImplementationDAG(subtasks: YpiStudioImplementationSubtaskPlan[]): void {
  const ids = new Set<string>();
  for (const subtask of subtasks) {
    if (ids.has(subtask.id)) throw new Error(`Duplicate implementation subtask id: ${subtask.id}`);
    ids.add(subtask.id);
  }
  for (const subtask of subtasks) {
    for (const dep of subtask.dependsOn) {
      if (dep === subtask.id) throw new Error(`Implementation subtask ${subtask.id} cannot depend on itself`);
      if (!ids.has(dep)) throw new Error(`Implementation subtask ${subtask.id} depends on missing subtask ${dep}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(subtasks.map((subtask) => [subtask.id, subtask]));
  const visit = (id: string, stack: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(Math.max(0, start)), id].join(" -> ");
      throw new Error(`Implementation subtask dependency cycle detected: ${cycle}`);
    }
    visiting.add(id);
    const subtask = byId.get(id);
    for (const dep of subtask?.dependsOn ?? []) visit(dep, [...stack, dep]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const subtask of subtasks) visit(subtask.id, [subtask.id]);
}

export function normalizeImplementationPlan(value: unknown): YpiStudioImplementationPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.subtasks)) return undefined;
  const normalizedSubtasks = value.subtasks.map(normalizeSubtaskPlan).filter((item): item is YpiStudioImplementationSubtaskPlan => !!item);
  if (normalizedSubtasks.length === 0) return undefined;
  const schemaVersion = value.schemaVersion === 2 ? 2 : 1;
  if (schemaVersion === 2) assertValidImplementationDAG(normalizedSubtasks);
  const seen = new Set<string>();
  const subtasks = normalizedSubtasks.filter((item) => !seen.has(item.id) && !!seen.add(item.id));
  const ids = new Set(subtasks.map((subtask) => subtask.id));
  const sortedSubtasks = subtasks
    .map((subtask) => {
      const dependsOn = schemaVersion === 2 ? subtask.dependsOn : subtask.dependsOn.filter((dep) => ids.has(dep) && dep !== subtask.id);
      return { ...subtask, dependsOn, dependencies: dependsOn };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const maxConcurrency = Math.max(1, Math.min(8, Math.floor(numberOr(value.maxConcurrency, numberOr(isRecord(value.execution) ? value.execution.maxParallel : undefined, 1)))));
  return {
    schemaVersion,
    updatedAt: optionalString(value.updatedAt) ?? nowIso(),
    sourceArtifact: optionalString(value.sourceArtifact),
    summary: optionalString(value.summary),
    strategy: optionalString(value.strategy),
    maxConcurrency,
    scheduler: isRecord(value.scheduler) && value.scheduler.mode === "dag" ? {
      mode: "dag",
      strategy: value.scheduler.strategy === "priority" ? "priority" : value.scheduler.strategy === "ready_fifo" ? "ready_fifo" : undefined,
      failFast: value.scheduler.failFast === true,
      defaultFailurePolicy: value.scheduler.defaultFailurePolicy === "manual" ? "manual" : value.scheduler.defaultFailurePolicy === "block_dependents" ? "block_dependents" : undefined,
    } : undefined,
    execution: normalizeExecution(value.execution, sortedSubtasks, maxConcurrency),
    subtasks: sortedSubtasks,
  };
}

function emptyImplementationCounts(): Record<YpiStudioImplementationSubtaskStatus, number> {
  return { pending: 0, waiting: 0, ready: 0, queued: 0, running: 0, blocked: 0, failed: 0, done: 0, skipped: 0 };
}

export function implementationCounts(progress: YpiStudioImplementationProgress | undefined): Record<YpiStudioImplementationSubtaskStatus, number> {
  const counts = emptyImplementationCounts();
  if (!progress) return counts;
  for (const subtask of Object.values(progress.subtasks)) counts[subtask.status] += 1;
  return counts;
}

function dependencySatisfiedForPlan(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress, id: string): boolean {
  const item = progress.subtasks[id];
  if (item?.status === "done") return true;
  if (item?.status !== "skipped") return false;
  if (plan.schemaVersion !== 2) return true;
  const dependencyPlan = plan.subtasks.find((subtask) => subtask.id === id);
  return dependencyPlan?.failurePolicy === "allow_dependents_when_skipped";
}

function dependencyBlocks(progress: YpiStudioImplementationProgress, id: string): boolean {
  const status = progress.subtasks[id]?.status;
  return status === "failed" || status === "blocked";
}

function waitingDependencies(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress, subtask: YpiStudioImplementationSubtaskPlan): YpiStudioImplementationDependencyStatus[] {
  const byId = new Map(plan.subtasks.map((item) => [item.id, item]));
  return subtask.dependsOn
    .filter((dep) => !dependencySatisfiedForPlan(plan, progress, dep))
    .map((dep) => ({ id: dep, title: byId.get(dep)?.title, status: progress.subtasks[dep]?.status ?? "pending" }));
}

function concurrencySlotsAvailable(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress): number {
  const maxConcurrency = Math.max(1, plan.maxConcurrency ?? plan.execution?.maxParallel ?? 1);
  const occupied = Object.values(progress.subtasks).filter((item) => item.status === "queued" || item.status === "running").length;
  return Math.max(0, maxConcurrency - occupied);
}

export function selectReadyYpiStudioImplementationSubtasks(plan: YpiStudioImplementationPlan | undefined, progress: YpiStudioImplementationProgress | undefined, limit?: number): YpiStudioImplementationSubtaskPlan[] {
  if (!plan || !progress) return [];
  const slots = concurrencySlotsAvailable(plan, progress);
  const cappedLimit = Math.max(0, Math.floor(limit ?? slots));
  if (slots <= 0 || cappedLimit <= 0) return [];
  return plan.subtasks
    .filter((subtask) => progress.subtasks[subtask.id]?.status === "ready" && subtask.dependsOn.every((dep) => dependencySatisfiedForPlan(plan, progress, dep)))
    .sort((a, b) => {
      if (plan.scheduler?.strategy === "priority") return (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order || a.id.localeCompare(b.id);
      return a.order - b.order || a.id.localeCompare(b.id);
    })
    .slice(0, Math.min(slots, cappedLimit));
}

export function selectNextYpiStudioImplementationSubtask(plan: YpiStudioImplementationPlan | undefined, progress: YpiStudioImplementationProgress | undefined): YpiStudioImplementationSubtaskPlan | null {
  return selectReadyYpiStudioImplementationSubtasks(plan, progress, 1)[0] ?? null;
}

function summarizeImplementation(plan: YpiStudioImplementationPlan | undefined, progress: YpiStudioImplementationProgress | undefined): YpiStudioImplementationSummary | undefined {
  if (!plan || !progress) return undefined;
  const counts = implementationCounts(progress);
  const byId = new Map(plan.subtasks.map((subtask) => [subtask.id, subtask]));
  const active = progress.activeSubtaskId ? byId.get(progress.activeSubtaskId) : undefined;
  const next = progress.nextSubtaskId ? byId.get(progress.nextSubtaskId) : selectNextYpiStudioImplementationSubtask(plan, progress) ?? undefined;
  const blockedTitles = plan.subtasks.filter((subtask) => progress.subtasks[subtask.id]?.status === "blocked").map((subtask) => subtask.title).slice(0, 5);
  return {
    total: plan.subtasks.length,
    done: counts.done,
    skipped: counts.skipped,
    blocked: counts.blocked,
    failed: counts.failed,
    running: counts.running,
    queued: counts.queued,
    ready: counts.ready,
    waiting: counts.waiting,
    pending: counts.pending,
    activeSubtaskId: progress.activeSubtaskId,
    activeSubtaskIds: progress.activeSubtaskIds,
    activeTitle: active?.title,
    nextSubtaskId: next?.id,
    nextSubtaskIds: progress.nextSubtaskIds,
    nextTitle: next?.title,
    blockedTitles,
  };
}

function projectImplementationRun(run: YpiStudioTaskSubagentRun): YpiStudioImplementationRunProjection {
  const handle = getYpiStudioChildRun(run.id);
  return {
    id: run.id,
    member: run.member,
    subtaskId: run.subtaskId,
    status: handle?.status === "runtime_lost" ? run.status : handle?.status ?? run.status,
    registryStatus: handle?.status,
    registryActive: !!handle,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    error: run.error,
    terminationReason: run.terminationReason,
    phase: (handle?.progress ?? run.progress)?.phase,
    tokens: (handle?.progress ?? run.progress)?.tokens,
    tps: (handle?.progress ?? run.progress)?.tps,
    currentTool: (handle?.progress ?? run.progress)?.currentTool,
    transcriptMeta: run.transcript,
  };
}

function isTerminalImplementationStatus(status: YpiStudioImplementationSubtaskStatus): boolean {
  return status === "done" || status === "skipped";
}

function timelineReason(subtask: YpiStudioImplementationSubtaskProjection): string | undefined {
  const waiting = subtask.waitingOn?.map((dependency) => dependency.title ?? dependency.id).join("、");
  if (waiting) return `等待 ${waiting}`;
  if (subtask.blockedReason) return subtask.blockedReason;
  if (subtask.blockedBy?.length) return `受阻于 ${subtask.blockedBy.join("、")}`;
  if (subtask.terminationReason) return subtask.terminationReason;
  const runError = subtask.runs.find((run) => run.error)?.error;
  return runError ?? subtask.summary;
}

function buildCompactTimeline(subtasks: YpiStudioImplementationSubtaskProjection[]): YpiStudioImplementationCompactTimelineItem[] {
  const severity = (status: YpiStudioImplementationSubtaskStatus): number => {
    if (status === "failed" || status === "blocked") return 0;
    if (status === "running" || status === "queued") return 1;
    if (status === "ready") return 2;
    if (status === "waiting" || status === "pending") return 3;
    if (status === "done" || status === "skipped") return 4;
    return 5;
  };
  return [...subtasks]
    .sort((a, b) => severity(a.status) - severity(b.status) || a.order - b.order || a.id.localeCompare(b.id))
    .map((subtask) => {
      const currentRun = subtask.currentRunId ? subtask.runs.find((run) => run.id === subtask.currentRunId) : undefined;
      const latestRun = currentRun ?? subtask.runs[0];
      return {
        id: subtask.id,
        title: subtask.title,
        status: subtask.status,
        displayStatus: subtask.displayStatus,
        member: subtask.member ?? latestRun?.member,
        runId: latestRun?.id ?? subtask.currentRunId ?? subtask.lastRunId,
        runStatus: latestRun?.registryStatus ?? latestRun?.status,
        reason: timelineReason(subtask),
        summary: subtask.summary ?? latestRun?.summary,
        updatedAt: subtask.updatedAt,
      };
    })
    .slice(0, 12);
}

function buildSessionRuntimeProjection(
  taskStatus: string,
  projection: Omit<YpiStudioImplementationProjection, "sessionRuntime">,
): YpiStudioImplementationProjection["sessionRuntime"] {
  const running = projection.statusCounts.running;
  const queued = projection.statusCounts.queued;
  const ready = projection.statusCounts.ready;
  const blocked = projection.statusCounts.blocked;
  const failed = projection.statusCounts.failed;
  const waiting = projection.statusCounts.waiting + projection.statusCounts.pending;
  const total = projection.subtasksWithStatus.length;
  const done = projection.statusCounts.done + projection.statusCounts.skipped;
  const activeRunCount = running;
  const queuedRunCount = queued;
  const status = failed > 0 || blocked > 0
    ? "needs_user"
    : taskStatus === "completed" || (total > 0 && done === total)
      ? "completed"
      : running + queued > 0
        ? "waiting_for_studio_children"
        : "idle";
  const message = status === "waiting_for_studio_children"
    ? `正在等待并行子任务完成：运行中 ${running}、队列 ${queued}、就绪 ${ready}、等待 ${waiting}、阻塞 ${blocked}。`
    : status === "needs_user"
      ? `Studio 需要你处理：失败 ${failed}、阻塞 ${blocked}。`
      : status === "completed"
        ? "实现子任务已完成。"
        : ready > 0
          ? `有 ${ready} 个子任务已就绪，等待主 Chat 派发。`
          : "Studio 当前没有正在等待的并行子任务。";
  return {
    status,
    message,
    activeRunCount,
    queuedRunCount,
    readySubtaskCount: ready,
    blockedSubtaskCount: blocked,
    failedSubtaskCount: failed,
    timeline: projection.compactTimeline,
    updatedAt: new Date().toISOString(),
  };
}

function buildImplementationProjection(
  plan: YpiStudioImplementationPlan | undefined,
  progress: YpiStudioImplementationProgress | undefined,
  runs: YpiStudioTaskSubagentRun[],
  taskStatus = "",
): YpiStudioImplementationProjection | undefined {
  if (!plan || !progress) return undefined;
  const projectedRuns = runs.map(projectImplementationRun);
  const runsBySubtask: Record<string, YpiStudioImplementationRunProjection[]> = {};
  for (const run of projectedRuns) {
    if (!run.subtaskId) continue;
    (runsBySubtask[run.subtaskId] ??= []).push(run);
  }
  for (const list of Object.values(runsBySubtask)) {
    list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  const statusCounts = implementationCounts(progress);
  const subtasksWithStatus = plan.subtasks.map((subtask) => {
    const item = progress.subtasks[subtask.id] ?? normalizeSubtaskProgress(undefined, subtask.id, progress.updatedAt);
    const taskRuns = runsBySubtask[subtask.id] ?? [];
    return {
      ...subtask,
      status: item.status,
      displayStatus: item.status === "pending" ? "waiting" as const : item.status,
      updatedAt: item.updatedAt,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      attempts: item.attempts,
      runIds: item.runIds,
      lastRunId: item.lastRunId,
      currentRunId: item.currentRunId,
      queuedAt: item.queuedAt,
      claimedAt: item.claimedAt,
      claimedByContextId: item.claimedByContextId,
      member: item.member,
      waitingOn: item.waitingOn,
      blockedBy: item.blockedBy,
      blockedReason: item.blockedReason,
      skippedReason: item.skippedReason,
      terminationReason: item.terminationReason,
      summary: item.summary,
      validation: item.validation,
      runs: taskRuns,
    };
  });
  const compactTimeline = buildCompactTimeline(subtasksWithStatus);
  const baseProjection: Omit<YpiStudioImplementationProjection, "sessionRuntime"> = {
    schemaVersion: plan.schemaVersion,
    maxConcurrency: Math.max(1, plan.maxConcurrency ?? plan.execution?.maxParallel ?? 1),
    statusCounts,
    activeSubtaskIds: progress.activeSubtaskIds ?? (progress.activeSubtaskId ? [progress.activeSubtaskId] : []),
    queuedSubtaskIds: progress.queuedSubtaskIds ?? [],
    nextSubtaskIds: progress.nextSubtaskIds ?? (progress.nextSubtaskId ? [progress.nextSubtaskId] : []),
    subtasksWithStatus,
    runsBySubtask,
    nonTerminalSubtasks: subtasksWithStatus.filter((subtask) => !isTerminalImplementationStatus(subtask.status) || subtask.status === "failed" || subtask.status === "blocked"),
    compactTimeline,
  };
  return {
    ...baseProjection,
    sessionRuntime: buildSessionRuntimeProjection(taskStatus, baseProjection),
  };
}


function isLocalReviewStatus(value: unknown): value is YpiStudioImplementationLocalReviewStatus {
  return value === "not_requested" || value === "requested" || value === "running" || value === "passed" || value === "failed" || value === "skipped";
}

function normalizeSubtaskProgress(value: unknown, id: string, now: string): YpiStudioImplementationSubtaskProgress {
  const raw = isRecord(value) ? value : {};
  const localReview = isRecord(raw.localReview) ? {
    status: isLocalReviewStatus(raw.localReview.status) ? raw.localReview.status : undefined,
    runIds: stringArray(raw.localReview.runIds),
    summary: optionalString(raw.localReview.summary),
    updatedAt: optionalString(raw.localReview.updatedAt),
  } : undefined;
  return {
    id,
    status: isImplementationStatus(raw.status) ? raw.status : "pending",
    updatedAt: optionalString(raw.updatedAt) ?? now,
    startedAt: optionalString(raw.startedAt),
    finishedAt: optionalString(raw.finishedAt),
    attempts: Math.max(0, Math.floor(numberOr(raw.attempts, 0))),
    runIds: stringArray(raw.runIds),
    lastRunId: optionalString(raw.lastRunId),
    currentRunId: optionalString(raw.currentRunId),
    queuedAt: optionalString(raw.queuedAt),
    claimedAt: optionalString(raw.claimedAt),
    claimedByContextId: optionalString(raw.claimedByContextId),
    member: optionalString(raw.member),
    waitingOn: Array.isArray(raw.waitingOn) ? raw.waitingOn.filter(isRecord).map((item) => ({ id: optionalString(item.id) ?? "", title: optionalString(item.title), status: isImplementationStatus(item.status) ? item.status : "pending" })).filter((item) => item.id) : undefined,
    blockedBy: normalizeStringList(raw.blockedBy),
    blockedReason: optionalString(raw.blockedReason),
    skippedReason: optionalString(raw.skippedReason),
    terminationReason: optionalString(raw.terminationReason),
    summary: optionalString(raw.summary),
    validation: normalizeStringList(raw.validation),
    localReview,
  };
}

function rebuildImplementationProgress(plan: YpiStudioImplementationPlan, existing?: YpiStudioImplementationProgress): YpiStudioImplementationProgress {
  const now = nowIso();
  const subtasks: Record<string, YpiStudioImplementationSubtaskProgress> = {};
  const planIds = new Set(plan.subtasks.map((subtask) => subtask.id));
  for (const subtask of plan.subtasks) {
    const current = normalizeSubtaskProgress(existing?.subtasks?.[subtask.id], subtask.id, now);
    if (current.status === "pending" && subtask.dependsOn.length === 0) current.status = "ready";
    if (current.status === "ready" && subtask.dependsOn.some((dep) => !planIds.has(dep))) current.status = "blocked";
    subtasks[subtask.id] = { ...current, updatedAt: current.updatedAt || now };
  }
  const progress: YpiStudioImplementationProgress = {
    schemaVersion: plan.schemaVersion === 2 || existing?.schemaVersion === 2 ? 2 : 1,
    updatedAt: now,
    activeSubtaskId: existing?.activeSubtaskId && subtasks[existing.activeSubtaskId] ? existing.activeSubtaskId : undefined,
    activeSubtaskIds: existing?.activeSubtaskIds?.filter((id) => subtasks[id]),
    queuedSubtaskIds: existing?.queuedSubtaskIds?.filter((id) => subtasks[id]),
    counts: emptyImplementationCounts(),
    subtasks,
    history: existing?.history?.filter((item) => planIds.has(item.subtaskId)).slice(-200),
  };
  return refreshDerivedImplementationDAG(plan, progress);
}

function normalizeImplementationProgress(value: unknown, plan: YpiStudioImplementationPlan | undefined): YpiStudioImplementationProgress | undefined {
  if (!plan) return undefined;
  if (!isRecord(value) || !isRecord(value.subtasks)) return rebuildImplementationProgress(plan);
  const existing: YpiStudioImplementationProgress = {
    schemaVersion: value.schemaVersion === 2 ? 2 : 1,
    updatedAt: optionalString(value.updatedAt) ?? nowIso(),
    activeSubtaskId: optionalString(value.activeSubtaskId),
    activeSubtaskIds: stringArray(value.activeSubtaskIds),
    queuedSubtaskIds: stringArray(value.queuedSubtaskIds),
    nextSubtaskId: optionalString(value.nextSubtaskId),
    nextSubtaskIds: stringArray(value.nextSubtaskIds),
    counts: emptyImplementationCounts(),
    subtasks: Object.fromEntries(Object.keys(value.subtasks).map((id) => [id, normalizeSubtaskProgress((value.subtasks as Record<string, unknown>)[id], id, nowIso())])),
    history: Array.isArray(value.history) ? value.history.filter(isRecord).map((item) => ({ at: optionalString(item.at) ?? nowIso(), subtaskId: optionalString(item.subtaskId) ?? "", from: isImplementationStatus(item.from) ? item.from : undefined, to: isImplementationStatus(item.to) ? item.to : "pending", runId: optionalString(item.runId), message: optionalString(item.message) })).filter((item) => item.subtaskId).slice(-200) : undefined,
  };
  return rebuildImplementationProgress(plan, existing);
}

function assertImplementationMutable(record: TaskRecordOnDisk | null): asserts record is TaskRecordOnDisk & { raw: YpiStudioTaskRecord } {
  if (!record?.raw) throw new Error("Task not found");
  if (record.archived) throw new Error("Archived tasks cannot update implementation progress");
}

function assertTaskStatusForImplementationMutation(task: YpiStudioTaskRecord, status: YpiStudioImplementationSubtaskStatus): void {
  if (status === "queued" || status === "running" || status === "done" || status === "failed" || status === "blocked" || status === "skipped") {
    if (task.status !== "implementing") throw new Error("Implementation subtask queued/running/done/failed/blocked/skipped updates require the main task to be in implementing after user approval.");
    return;
  }
  if ((status === "ready" || status === "waiting" || status === "pending") && task.status !== "implementing" && task.status !== "changes_requested") {
    throw new Error("Implementation subtask ready/waiting/pending updates are only allowed while the main task is implementing or changes_requested.");
  }
}

/** Resolve an improvement instance for execution and assert that the main task is in
 *  `waiting_for_improvements` and the instance is in an executable `implementing | checking`
 *  state with a plan/progress. Returns the instance; never touches the main task plan/progress. */
function resolveImprovementInstanceForExecution(record: TaskRecordOnDisk, improvementId: string): YpiStudioImprovementInstance {
  if (!record?.raw) throw new Error("Task not found");
  if (record.archived) throw new Error("Archived tasks cannot execute improvement subtasks");
  if (record.raw.status !== "waiting_for_improvements") throw new Error(`Improvement subtasks can only be claimed while the main task is waiting_for_improvements. Current status: ${record.raw.status}`);
  const improvements = record.raw.improvements;
  if (!improvements?.instances?.length) throw new Error("Task has no improvements");
  const instance = improvements.instances.find((inst) => inst.id === improvementId);
  if (!instance) throw new Error(`Improvement not found: ${improvementId}`);
  if (instance.status !== "implementing" && instance.status !== "checking") throw new Error(`Improvement ${instance.displayId} is not executable (status: ${instance.status}). It must be implementing or checking to claim subtasks.`);
  if (!instance.implementationPlan || !instance.implementationProgress) throw new Error(`Improvement ${instance.displayId} has no implementation plan/progress to claim from.`);
  return instance;
}

const DERIVED_DEPENDENCY_BLOCK_PREFIX = "Blocked by failed/blocked dependency:";

function isDerivedDependencyBlock(subtask: YpiStudioImplementationSubtaskPlan, item: YpiStudioImplementationSubtaskProgress): boolean {
  if (item.status !== "blocked") return false;
  if (!item.blockedReason?.startsWith(DERIVED_DEPENDENCY_BLOCK_PREFIX)) return false;
  const dependencyIds = new Set(subtask.dependsOn);
  return (item.blockedBy ?? []).every((id) => dependencyIds.has(id));
}

function clearRecoveredDependencyBlocks(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress): void {
  const now = nowIso();
  let changed = true;
  while (changed) {
    changed = false;
    for (const subtask of plan.subtasks) {
      const item = progress.subtasks[subtask.id];
      if (!item || !isDerivedDependencyBlock(subtask, item)) continue;
      const blockedBy = subtask.dependsOn.filter((dep) => dependencyBlocks(progress, dep));
      if (blockedBy.length) {
        item.blockedBy = blockedBy;
        item.waitingOn = waitingDependencies(plan, progress, subtask);
        item.blockedReason = `${DERIVED_DEPENDENCY_BLOCK_PREFIX} ${blockedBy.join(", ")}`;
        continue;
      }
      item.status = plan.schemaVersion === 2 ? "waiting" : "pending";
      item.blockedBy = undefined;
      item.blockedReason = undefined;
      item.waitingOn = waitingDependencies(plan, progress, subtask);
      item.updatedAt = now;
      changed = true;
    }
  }
}

export function propagateBlockedDependents(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress): void {
  const now = nowIso();
  let changed = true;
  while (changed) {
    changed = false;
    for (const subtask of plan.subtasks) {
      const item = progress.subtasks[subtask.id];
      if (!item || item.status === "done" || item.status === "skipped" || item.status === "failed") continue;
      const blockedBy = subtask.dependsOn.filter((dep) => dependencyBlocks(progress, dep));
      if (!blockedBy.length) continue;
      const previous = item.status;
      item.status = "blocked";
      item.blockedBy = blockedBy;
      item.waitingOn = waitingDependencies(plan, progress, subtask);
      item.blockedReason = `${DERIVED_DEPENDENCY_BLOCK_PREFIX} ${blockedBy.join(", ")}`;
      item.updatedAt = now;
      if (previous !== "blocked") changed = true;
    }
  }
}

export function refreshDerivedImplementationDAG(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress): YpiStudioImplementationProgress {
  clearRecoveredDependencyBlocks(plan, progress);
  propagateBlockedDependents(plan, progress);
  const now = nowIso();
  for (const subtask of plan.subtasks) {
    const p = progress.subtasks[subtask.id];
    if (!p || p.status === "done" || p.status === "skipped" || p.status === "failed" || p.status === "blocked" || p.status === "queued" || p.status === "running") continue;
    const waitingOn = waitingDependencies(plan, progress, subtask);
    p.waitingOn = waitingOn.length ? waitingOn : undefined;
    if (waitingOn.length === 0) {
      if (p.status === "pending" || p.status === "waiting") {
        p.status = "ready";
        p.updatedAt = now;
      }
    } else if (p.status === "ready") {
      p.status = plan.schemaVersion === 2 ? "waiting" : "pending";
      p.updatedAt = now;
    }
  }
  const active = progress.activeSubtaskId ? progress.subtasks[progress.activeSubtaskId] : undefined;
  if (active && active.status !== "running") progress.activeSubtaskId = undefined;
  const readySubtasks = selectReadyYpiStudioImplementationSubtasks(plan, progress);
  progress.nextSubtaskId = readySubtasks[0]?.id;
  progress.nextSubtaskIds = readySubtasks.length ? readySubtasks.map((subtask) => subtask.id) : undefined;
  progress.activeSubtaskIds = Object.values(progress.subtasks).filter((item) => item.status === "running").map((item) => item.id);
  progress.queuedSubtaskIds = Object.values(progress.subtasks).filter((item) => item.status === "queued").map((item) => item.id);
  progress.counts = implementationCounts(progress);
  progress.updatedAt = now;
  return progress;
}

function refreshDerivedImplementation(plan: YpiStudioImplementationPlan, progress: YpiStudioImplementationProgress): void {
  refreshDerivedImplementationDAG(plan, progress);
}

function normalizeTranscriptRef(value: unknown): YpiStudioSubagentTranscriptRef | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 1 || value.format !== "ypi-studio-subagent-transcript") return undefined;
  const runId = optionalString(value.runId);
  const taskId = optionalString(value.taskId);
  const member = optionalString(value.member);
  const pathLabel = optionalString(value.pathLabel);
  const status = value.status === "running" || value.status === "succeeded" || value.status === "failed" || value.status === "cancelled" || value.status === "waiting_for_user" ? value.status : undefined;
  const startedAt = optionalString(value.startedAt);
  const updatedAt = optionalString(value.updatedAt);
  if (!runId || !taskId || !member || !pathLabel || !status || !startedAt || !updatedAt) return undefined;
  return {
    schemaVersion: 1,
    format: "ypi-studio-subagent-transcript",
    runId,
    taskId,
    member,
    pathLabel,
    status,
    startedAt,
    finishedAt: optionalString(value.finishedAt),
    updatedAt,
    itemCount: typeof value.itemCount === "number" ? value.itemCount : 0,
    messageCount: typeof value.messageCount === "number" ? value.messageCount : 0,
    toolCallCount: typeof value.toolCallCount === "number" ? value.toolCallCount : 0,
    stderrBytes: typeof value.stderrBytes === "number" ? value.stderrBytes : 0,
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
    truncated: value.truncated === true,
    runner: normalizeSubagentRunner(value.runner),
    childSessionId: optionalString(value.childSessionId),
    childSessionFile: optionalString(value.childSessionFile),
    truncation: isRecord(value.truncation) ? {
      itemTruncated: value.truncation.itemTruncated === true,
      captureLimited: value.truncation.captureLimited === true,
      bytesLimit: typeof value.truncation.bytesLimit === "number" ? value.truncation.bytesLimit : undefined,
      itemBytesLimit: typeof value.truncation.itemBytesLimit === "number" ? value.truncation.itemBytesLimit : undefined,
    } : undefined,
  };
}

function relativeLabel(root: string, target: string): string {
  const rel = path.relative(root, target) || ".";
  return rel.split(path.sep).join("/");
}

function pathIsInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSep);
}

function safeRealPath(target: string, workspaceRoot: string): string {
  const real = realpathSync.native(target);
  if (!pathIsInside(workspaceRoot, real)) {
    throw new YpiStudioTaskSecurityError(`Path escapes workspace: ${relativeLabel(workspaceRoot, target)}`);
  }
  return real;
}

function assertDirectoryWithinWorkspace(target: string, workspaceRoot: string): void {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    const real = safeRealPath(target, workspaceRoot);
    if (!statSync(real).isDirectory()) throw new Error(`Not a directory: ${target}`);
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${target}`);
  safeRealPath(target, workspaceRoot);
}

function safeStatFile(filePath: string, workspaceRoot: string) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    const real = safeRealPath(filePath, workspaceRoot);
    const realStat = statSync(real);
    return realStat.isFile() ? realStat : null;
  }
  if (!stat.isFile()) return null;
  safeRealPath(filePath, workspaceRoot);
  return stat;
}

function safeFileExists(filePath: string, workspaceRoot: string): boolean {
  try {
    return !!safeStatFile(filePath, workspaceRoot);
  } catch {
    return false;
  }
}

const WINDOWS_RELATIVE_FILE_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export interface YpiStudioTaskRelativeFileResolution {
  taskDir: string;
  taskDirRealPath: string;
  filePath: string;
  realPath: string;
  relativePath: string;
  stat: Stats;
}

function stripRelativeFileUrlParts(value: string): string {
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const cutIndexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  const cutIndex = cutIndexes.length ? Math.min(...cutIndexes) : -1;
  return cutIndex >= 0 ? value.slice(0, cutIndex) : value;
}

function pathInsideDirectory(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedTarget !== normalizedRoot && normalizedTarget.startsWith(rootWithSep);
}

function normalizeTaskRelativeFilePath(inputPath: string): string {
  const rawPath = stripRelativeFileUrlParts(inputPath).trim();
  if (!rawPath) throw new YpiStudioTaskSecurityError("Missing file path");
  if (rawPath.includes("\0")) throw new YpiStudioTaskSecurityError("Invalid file path");
  if (rawPath.includes("\\")) throw new YpiStudioTaskSecurityError("Backslash paths are not allowed");
  if (URL_SCHEME_RE.test(rawPath)) throw new YpiStudioTaskSecurityError("URL schemes are not allowed");
  if (path.posix.isAbsolute(rawPath) || WINDOWS_RELATIVE_FILE_ABSOLUTE_RE.test(rawPath) || rawPath.startsWith("//")) {
    throw new YpiStudioTaskSecurityError("Absolute paths are not allowed");
  }
  const segments = rawPath.split("/");
  if (segments.some((segment) => segment === "..")) throw new YpiStudioTaskSecurityError('Path segment ".." is not allowed');
  const normalized = path.posix.normalize(rawPath);
  if (!normalized || normalized === "." || normalized.endsWith("/")) throw new YpiStudioTaskSecurityError("File path must point to a file");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new YpiStudioTaskSecurityError("Path escapes task directory");
  return normalized.replace(/^\.\//, "");
}

export function resolveYpiStudioTaskRelativeFile(cwd: string, taskIdOrKey: string, inputPath: string): YpiStudioTaskRelativeFileResolution {
  const ctx = createContext(cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw || record.readError) throw new Error("Task not found");
  const relativePath = normalizeTaskRelativeFilePath(inputPath);
  const taskDirRealPath = safeRealPath(record.dirPath, ctx.workspaceRoot);
  const filePath = path.resolve(record.dirPath, ...relativePath.split("/"));
  if (!pathInsideDirectory(record.dirPath, filePath)) throw new YpiStudioTaskSecurityError("Path escapes task directory");
  let stat = safeStatFile(filePath, ctx.workspaceRoot);
  if (!stat) throw new Error("Not a file");
  const realPath = safeRealPath(filePath, ctx.workspaceRoot);
  if (!pathInsideDirectory(taskDirRealPath, realPath)) {
    throw new YpiStudioTaskSecurityError("Symlink target escapes task directory");
  }
  stat = statSync(realPath);
  if (!stat.isFile()) throw new Error("Not a file");
  return { taskDir: record.dirPath, taskDirRealPath, filePath, realPath, relativePath, stat };
}

/**
 * Resolve a file path relative to an improvement instance directory.
 * Validation mirrors resolveYpiStudioTaskRelativeFile:
 * - Verifies task ownership and improvement existence
 * - Rejects absolute paths, URL schemes, backslashes, and ".." traversal
 * - Rejects symlink targets that escape the improvement instance directory
 */
export function resolveYpiStudioImprovementRelativeFile(
  cwd: string,
  taskIdOrKey: string,
  improvementId: string,
  inputPath: string,
): YpiStudioTaskRelativeFileResolution {
  const ctx = createContext(cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw || record.readError) throw new Error("Task not found");

  const improvements = record.raw.improvements;
  if (!improvements?.instances?.length) throw new Error("Task has no improvements");

  const instance = improvements.instances.find((inst) => inst.id === improvementId);
  if (!instance) throw new Error(`Improvement not found: ${improvementId}`);

  const relativePath = normalizeTaskRelativeFilePath(inputPath);
  const instanceDir = improvementInstanceDir(record.dirPath, improvementId);
  const instanceDirRealPath = safeRealPath(instanceDir, ctx.workspaceRoot);

  const filePath = path.resolve(instanceDir, ...relativePath.split("/"));
  if (!pathInsideDirectory(instanceDir, filePath)) {
    throw new YpiStudioTaskSecurityError("Path escapes improvement instance directory");
  }

  let stat = safeStatFile(filePath, ctx.workspaceRoot);
  if (!stat) throw new Error("Not a file");

  const realPath = safeRealPath(filePath, ctx.workspaceRoot);
  if (!pathInsideDirectory(instanceDirRealPath, realPath)) {
    throw new YpiStudioTaskSecurityError("Symlink target escapes improvement instance directory");
  }

  stat = statSync(realPath);
  if (!stat.isFile()) throw new Error("Not a file");
  return { taskDir: instanceDir, taskDirRealPath: instanceDirRealPath, filePath, realPath, relativePath, stat };
}

function readFileWithLimit(filePath: string, maxBytes: number): { content: string; truncated: boolean } {
  const stat = statSync(filePath);
  if (stat.size <= maxBytes) return { content: readFileSync(filePath, "utf8"), truncated: false };

  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return { content: buffer.subarray(0, bytesRead).toString("utf8"), truncated: true };
  } finally {
    closeSync(fd);
  }
}

function createContext(cwd: string): TaskContext {
  const workspaceRoot = canonicalizeCwd(cwd);
  const stat = statSync(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${cwd}`);
  return {
    cwd: workspaceRoot,
    workspaceRoot,
    tasksRoot: path.join(workspaceRoot, TASKS_DIR),
    archiveRoot: path.join(workspaceRoot, TASKS_ARCHIVE_DIR),
    knowledgeRoot: path.join(workspaceRoot, KNOWLEDGE_DIR),
    knowledgeIndexPath: path.join(workspaceRoot, KNOWLEDGE_DIR, KNOWLEDGE_INDEX),
    runtimeSessionsRoot: path.join(workspaceRoot, RUNTIME_SESSIONS_DIR),
  };
}

function ensureTaskRoots(ctx: TaskContext): void {
  const ypiRoot = path.join(ctx.workspaceRoot, ".ypi");
  if (existsSync(ypiRoot)) assertDirectoryWithinWorkspace(ypiRoot, ctx.workspaceRoot);
  else mkdirSync(ypiRoot);

  if (existsSync(ctx.tasksRoot)) assertDirectoryWithinWorkspace(ctx.tasksRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.tasksRoot);

  const runtimeRoot = path.join(ctx.workspaceRoot, ".ypi", ".runtime");
  if (existsSync(runtimeRoot)) assertDirectoryWithinWorkspace(runtimeRoot, ctx.workspaceRoot);
  else mkdirSync(runtimeRoot);

  if (existsSync(ctx.runtimeSessionsRoot)) assertDirectoryWithinWorkspace(ctx.runtimeSessionsRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.runtimeSessionsRoot);
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function isApprovalGate(value: unknown): value is YpiStudioApprovalGate {
  return isRecord(value)
    && optionalString(value.enteredAt) !== undefined
    && optionalString(value.from) !== undefined
    && value.to === "awaiting_approval"
    && (value.contextId === undefined || typeof value.contextId === "string");
}

function isApprovalGrant(value: unknown): value is YpiStudioApprovalGrant {
  return isRecord(value)
    && optionalString(value.approvedAt) !== undefined
    && optionalString(value.contextId) !== undefined
    && optionalString(value.inputHash) !== undefined
    && value.source === "user-input";
}

function isAfterIso(candidate: string, baseline: string): boolean {
  const candidateMs = Date.parse(candidate);
  const baselineMs = Date.parse(baseline);
  return Number.isFinite(candidateMs) && Number.isFinite(baselineMs) && candidateMs > baselineMs;
}

function isoAfter(baseline: string): string {
  const baselineMs = Date.parse(baseline);
  const currentMs = Date.now();
  if (!Number.isFinite(baselineMs) || currentMs > baselineMs) return new Date(currentMs).toISOString();
  return new Date(baselineMs + 1).toISOString();
}

const APPROVAL_TEXT_RE = /确认|批准|同意|可以实现|开始实现|按方案做|继续制作|approve|approved|go ahead|start implementation|proceed/i;
const APPROVAL_REJECTION_RE = /不批准|不同意|先别|不要|不能|暂缓|修改|改一下|调整|change|changes|revise|revision|not approve|not approved|don't approve|do not approve|don't go ahead|do not go ahead|don't proceed|do not proceed|don't start implementation|do not start implementation|hold on|wait|not yet|not now/i;

export function isExplicitYpiStudioApprovalText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (APPROVAL_REJECTION_RE.test(normalized)) return false;
  return APPROVAL_TEXT_RE.test(normalized);
}

function isApprovalImplementationEdge(from: string, to: string): boolean {
  return from === "awaiting_approval" && to === "implementing";
}

export function assertYpiStudioImplementationApproved(task: YpiStudioTaskRecord, contextId: string | undefined): void {
  const grant = isApprovalGrant(task.meta.approvalGrant) ? task.meta.approvalGrant : null;
  const gate = isApprovalGate(task.meta.approvalGate) ? task.meta.approvalGate : null;
  if (!contextId) {
    throw new Error("Transition awaiting_approval -> implementing requires this chat to be bound to the Studio task context before approval can be recorded. Bind/resume the task, then ask the user to reply 确认/批准.");
  }
  if (!task.contextIds.includes(contextId)) {
    throw new Error("Transition awaiting_approval -> implementing requires approval from a bound Studio context. This chat is not bound to the task; bind/resume it, then ask the user to approve.");
  }
  if (!grant) {
    throw new Error("Transition awaiting_approval -> implementing is blocked because no approvalGrant is recorded for this task. Ask the user for a later explicit confirmation such as 确认，开始实现; override cannot bypass this approval gate.");
  }
  if (grant.contextId !== contextId) {
    throw new Error("Transition awaiting_approval -> implementing approvalGrant belongs to a different Studio session context. Ask the user to approve in this chat session.");
  }
  if (gate && !isAfterIso(grant.approvedAt, gate.enteredAt)) {
    throw new Error("Transition awaiting_approval -> implementing requires approval after the task entered awaiting_approval.");
  }
}

function approvalGate(enteredAt: string, from: string, contextId?: string): YpiStudioApprovalGate {
  return { enteredAt, contextId, from, to: "awaiting_approval" };
}

function approvalGrant(approvedAt: string, contextId: string, inputText: string): YpiStudioApprovalGrant {
  return { approvedAt, contextId, inputHash: hashText(inputText), source: "user-input" };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "studio-task";
}

function createTaskId(title: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${slugify(title)}`;
}

function taskKey(id: string): string {
  return `active:${id}`;
}

function archivedTaskKey(month: string, id: string): string {
  return `archived:${month}:${id}`;
}

interface ParsedTaskKey {
  id: string;
  archived: boolean;
  archiveMonth?: string;
}

function isSafeArchiveMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month);
}

function isSafeTaskId(id: string): boolean {
  return /^[^/\\:]+$/.test(id) && id !== "." && id !== ".." && id !== "archive";
}

function parseTaskKey(taskKeyOrId: string): ParsedTaskKey {
  if (taskKeyOrId.startsWith("active:")) {
    const id = taskKeyOrId.slice("active:".length);
    if (!isSafeTaskId(id)) throw new YpiStudioTaskSecurityError("Invalid task id");
    return { id, archived: false };
  }
  if (taskKeyOrId.startsWith("archived:")) {
    const parts = taskKeyOrId.split(":");
    if (parts.length !== 3 || !isSafeArchiveMonth(parts[1]) || !isSafeTaskId(parts[2])) {
      throw new YpiStudioTaskSecurityError("Invalid archived task key");
    }
    return { id: parts[2], archived: true, archiveMonth: parts[1] };
  }
  if (!isSafeTaskId(taskKeyOrId)) throw new YpiStudioTaskSecurityError("Invalid task id");
  return { id: taskKeyOrId, archived: false };
}

function taskDir(ctx: TaskContext, taskIdOrKey: string): string {
  const parsed = parseTaskKey(taskIdOrKey);
  return parsed.archived
    ? path.join(ctx.archiveRoot, parsed.archiveMonth ?? "", parsed.id)
    : path.join(ctx.tasksRoot, parsed.id);
}

const IMPROVEMENT_DEFAULT_ARTIFACTS: Record<string, string> = {
  "plan-review": "plan-review.md",
  brief: "brief.md",
  prd: "prd.md",
  ui: "ui.md",
  design: "design.md",
  implement: "implement.md",
  checks: "checks.md",
  review: "review.md",
  summary: "summary.md",
};

const IMPROVEMENT_UNRESOLVED: ReadonlySet<YpiStudioImprovementStatus> = new Set([
  "analysis",
  "waiting_clarification",
  "waiting_prototype",
  "waiting_plan_approval",
  "implementing",
  "checking",
  "waiting_user_acceptance",
  "cancelled",
  "failed",
]);

function isImprovementUnresolved(status: YpiStudioImprovementStatus): boolean {
  return IMPROVEMENT_UNRESOLVED.has(status);
}

function isImprovementStatus(value: unknown): value is YpiStudioImprovementStatus {
  return typeof value === "string"
    && (IMPROVEMENT_UNRESOLVED.has(value as YpiStudioImprovementStatus) || value === "accepted" || value === "accepted_not_doing");
}

function isImprovementDisposition(value: unknown): value is YpiStudioImprovementDisposition {
  return value === "accepted" || value === "cancelled" || value === "failed" || value === "accepted_not_doing";
}

function improvementInstanceDir(taskDir: string, instanceId: string): string {
  return path.join(taskDir, IMPROVEMENTS_DIR_NAME, instanceId);
}

function normalizeImprovementInstance(value: unknown, displayId: string, now: string): YpiStudioImprovementInstance | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id);
  const title = optionalString(value.title);
  const feedback = optionalString(value.feedback);
  if (!id || !title) return null;
  const status = isImprovementStatus(value.status) ? value.status : "analysis";
  const artifacts = {
    ...IMPROVEMENT_DEFAULT_ARTIFACTS,
    ...(isRecord(value.artifacts)
      ? Object.fromEntries(Object.entries(value.artifacts).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {}),
  };
  const approvalMode: YpiStudioImprovementApprovalMode | undefined = value.approvalMode === "standalone" || value.approvalMode === "inherit" ? value.approvalMode : undefined;
  const approval = isRecord(value.approval) ? {
    revision: typeof value.approval.revision === "number" && Number.isFinite(value.approval.revision) ? Math.max(1, Math.floor(value.approval.revision)) : undefined,
    approvedAt: optionalString(value.approval.approvedAt),
    contextId: optionalString(value.approval.contextId),
    inputHash: optionalString(value.approval.inputHash),
  } : undefined;
  const acceptance = isRecord(value.acceptance) ? {
    acceptedAt: optionalString(value.acceptance.acceptedAt),
    contextId: optionalString(value.acceptance.contextId),
    disposition: optionalString(value.acceptance.disposition),
    reason: optionalString(value.acceptance.reason),
  } : undefined;
  return {
    id,
    displayId,
    title,
    feedback: feedback ?? "",
    status,
    phase: optionalString(value.phase),
    owner: optionalString(value.owner) ?? "improver",
    createdAt: optionalString(value.createdAt) ?? now,
    updatedAt: optionalString(value.updatedAt) ?? now,
    completedAt: value.completedAt === null ? null : optionalString(value.completedAt),
    approvalMode,
    approval,
    acceptance,
    disposition: isImprovementDisposition(value.disposition) ? value.disposition : undefined,
    disposedAt: optionalString(value.disposedAt),
    disposedBy: optionalString(value.disposedBy),
    disposedReason: optionalString(value.disposedReason),
    artifacts,
    implementationPlan: normalizeImplementationPlan(value.implementationPlan),
    implementationProgress: normalizeImplementationProgress(value.implementationProgress, normalizeImplementationPlan(value.implementationPlan)),
    runIds: stringArray(value.runIds),
    attempts: typeof value.attempts === "number" && Number.isFinite(value.attempts) ? Math.max(0, Math.floor(value.attempts)) : undefined,
  };
}

function normalizeImprovements(value: unknown): YpiStudioImprovement | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.instances)) return undefined;
  const now = nowIso();
  const instances = value.instances.map((item, index) => {
    const expectedDisplayId = `IMP-${String(index + 1).padStart(3, "0")}`;
    const displayId = typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).displayId === "string"
      ? (item as Record<string, unknown>).displayId as string
      : expectedDisplayId;
    return normalizeImprovementInstance(item, displayId, now);
  }).filter((item): item is YpiStudioImprovementInstance => !!item);
  if (instances.length === 0 && (!isRecord(value) || !value.instances || !(value.instances as Array<unknown>).length)) return undefined;
  const parentStatus = value.parentStatus === "waiting_for_improvements" || value.parentStatus === "review_ready" ? value.parentStatus : "none";
  return { schemaVersion: 1, parentStatus, instances };
}

function normalizeTaskRecord(value: unknown, fallbackId: string, ctx: TaskContext): YpiStudioTaskRecord {
  if (!isRecord(value)) throw new Error("task.json root must be an object");
  const id = optionalString(value.id) ?? fallbackId;
  const title = optionalString(value.title) ?? id;
  const workflowId = optionalString(value.workflowId) ?? "feature-dev";
  const status = optionalString(value.status) ?? "intake";
  const artifacts = {
    ...DEFAULT_ARTIFACTS,
    ...(isRecord(value.artifacts)
      ? Object.fromEntries(Object.entries(value.artifacts).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {}),
  };
  const subagents = Array.isArray(value.subagents)
    ? value.subagents.filter(isRecord).map((run): YpiStudioTaskSubagentRun => ({
        id: optionalString(run.id) ?? `run-${Date.now()}`,
        subtaskId: optionalString(run.subtaskId),
        improvementId: optionalString(run.improvementId),
        member: optionalString(run.member) ?? "unknown",
        status: run.status === "queued" || run.status === "running" || run.status === "succeeded" || run.status === "failed" || run.status === "cancelled" || run.status === "waiting_for_user" ? run.status : "failed",
        startedAt: optionalString(run.startedAt) ?? nowIso(),
        finishedAt: optionalString(run.finishedAt),
        runner: normalizeSubagentRunner(run.runner),
        childSessionId: optionalString(run.childSessionId),
        childSessionFile: optionalString(run.childSessionFile),
        requestAffinity: normalizeRequestAffinity(run.requestAffinity),
        prompt: optionalString(run.prompt),
        summary: optionalString(run.summary),
        model: optionalString(run.model),
        thinking: optionalString(run.thinking),
        modelSource: optionalString(run.modelSource),
        thinkingSource: optionalString(run.thinkingSource),
        policy: normalizePolicyDiagnostics(run.policy),
        progress: normalizeRunProgress(run.progress),
        terminationReason: optionalString(run.terminationReason),
        error: optionalString(run.error),
        transcript: normalizeTranscriptRef(run.transcript),
      }))
    : [];
  const implementationPlan = normalizeImplementationPlan(value.implementationPlan);
  const implementationProgress = normalizeImplementationProgress(value.implementationProgress, implementationPlan);
  const improvements = normalizeImprovements(value.improvements);
  return {
    schemaVersion: 1,
    id,
    title,
    workflowId,
    status,
    cwd: optionalString(value.cwd) ?? ctx.cwd,
    createdAt: optionalString(value.createdAt) ?? nowIso(),
    updatedAt: optionalString(value.updatedAt) ?? nowIso(),
    completedAt: value.completedAt === null ? null : optionalString(value.completedAt),
    contextIds: stringArray(value.contextIds),
    currentMember: optionalString(value.currentMember),
    artifacts,
    subagents,
    meta: isRecord(value.meta)
      ? {
          ...value.meta,
          planRevision: typeof value.meta.planRevision === "number" && Number.isFinite(value.meta.planRevision) ? Math.max(1, Math.floor(value.meta.planRevision)) : undefined,
        }
      : {},
    implementationPlan,
    implementationProgress,
    improvements,
  };
}

function readTaskJson(ctx: TaskContext, dirPath: string): YpiStudioTaskRecord {
  const taskJsonPath = path.join(dirPath, TASK_JSON);
  safeStatFile(taskJsonPath, ctx.workspaceRoot);
  const parsed = JSON.parse(readFileSync(taskJsonPath, "utf8")) as unknown;
  return normalizeTaskRecord(parsed, path.basename(dirPath), ctx);
}

function writeTaskJson(dirPath: string, task: YpiStudioTaskRecord): void {
  writeFileSync(path.join(dirPath, TASK_JSON), `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

function appendTaskEvent(dirPath: string, event: YpiStudioTaskEvent): void {
  appendFileSync(path.join(dirPath, EVENTS_JSONL), `${JSON.stringify(event)}\n`, "utf8");
}

function scanTaskDirectory(ctx: TaskContext, dirPath: string, archiveMonth?: string): TaskRecordOnDisk {
  const id = path.basename(dirPath);
  const archived = !!archiveMonth;
  const key = archived ? archivedTaskKey(archiveMonth, id) : taskKey(id);
  const pathLabel = relativeLabel(ctx.workspaceRoot, dirPath);
  let modifiedMs = 0;
  try {
    const stat = lstatSync(dirPath);
    modifiedMs = stat.mtimeMs;
    assertDirectoryWithinWorkspace(dirPath, ctx.workspaceRoot);
    return {
      key,
      id,
      dirPath,
      pathLabel,
      raw: readTaskJson(ctx, dirPath),
      modifiedMs,
      archived,
      archiveMonth,
    };
  } catch (error) {
    if (error instanceof YpiStudioTaskSecurityError) throw error;
    return {
      key,
      id,
      dirPath,
      pathLabel,
      raw: null,
      modifiedMs,
      readError: error instanceof Error ? error.message : String(error),
      archived,
      archiveMonth,
    };
  }
}

function scanTaskRecords(ctx: TaskContext): { exists: boolean; records: TaskRecordOnDisk[]; errors: YpiStudioTasksResponse["errors"] } {
  if (!existsSync(ctx.tasksRoot)) return { exists: false, records: [], errors: [] };
  assertDirectoryWithinWorkspace(ctx.tasksRoot, ctx.workspaceRoot);
  const records: TaskRecordOnDisk[] = [];
  const errors: YpiStudioTasksResponse["errors"] = [];
  for (const entry of readdirSync(ctx.tasksRoot, { withFileTypes: true })) {
    if (entry.name === "archive") continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const record = scanTaskDirectory(ctx, path.join(ctx.tasksRoot, entry.name));
    records.push(record);
    if (record.readError) errors.push({ key: record.key, pathLabel: record.pathLabel, message: record.readError });
  }
  return { exists: true, records, errors };
}

function scanArchivedTaskRecords(ctx: TaskContext): { exists: boolean; records: TaskRecordOnDisk[]; errors: YpiStudioTasksResponse["errors"] } {
  if (!existsSync(ctx.archiveRoot)) return { exists: false, records: [], errors: [] };
  assertDirectoryWithinWorkspace(ctx.archiveRoot, ctx.workspaceRoot);
  const records: TaskRecordOnDisk[] = [];
  const errors: YpiStudioTasksResponse["errors"] = [];
  for (const monthEntry of readdirSync(ctx.archiveRoot, { withFileTypes: true })) {
    if (!monthEntry.isDirectory() && !monthEntry.isSymbolicLink()) continue;
    if (!isSafeArchiveMonth(monthEntry.name)) continue;
    const monthDir = path.join(ctx.archiveRoot, monthEntry.name);
    assertDirectoryWithinWorkspace(monthDir, ctx.workspaceRoot);
    for (const taskEntry of readdirSync(monthDir, { withFileTypes: true })) {
      if (!taskEntry.isDirectory() && !taskEntry.isSymbolicLink()) continue;
      if (!isSafeTaskId(taskEntry.name)) continue;
      const record = scanTaskDirectory(ctx, path.join(monthDir, taskEntry.name), monthEntry.name);
      records.push(record);
      if (record.readError) errors.push({ key: record.key, pathLabel: record.pathLabel, message: record.readError });
    }
  }
  return { exists: true, records, errors };
}

function artifactFileName(task: YpiStudioTaskRecord, artifact: string): string | null {
  if (task.artifacts[artifact]) return task.artifacts[artifact];
  const match = Object.values(task.artifacts).find((fileName) => fileName === artifact);
  return match ?? null;
}

function isSafeArtifactFileName(fileName: string): boolean {
  return /^[A-Za-z0-9._-]+\.md$/.test(fileName);
}

function artifactPath(dirPath: string, task: YpiStudioTaskRecord, artifact: string): string {
  const fileName = artifactFileName(task, artifact);
  if (!fileName || !isSafeArtifactFileName(fileName)) throw new YpiStudioTaskSecurityError("Invalid artifact");
  return path.join(dirPath, fileName);
}

function artifactIsMeaningful(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && !/\bTBD\b|待填写|YPI Studio workflow/i.test(trimmed);
}

function artifactCompleted(dirPath: string, task: YpiStudioTaskRecord, artifactFile: string, workspaceRoot: string): boolean {
  const fileName = artifactFileName(task, artifactFile) ?? artifactFile;
  if (!isSafeArtifactFileName(fileName)) return false;
  const filePath = path.join(dirPath, fileName);
  if (!safeFileExists(filePath, workspaceRoot)) return false;
  const content = readFileSync(filePath, "utf8");
  return artifactIsMeaningful(content);
}

function assertPlanReviewReadyForApproval(record: TaskRecordOnDisk, workspaceRoot: string): void {
  if (!record.raw) throw new Error("Task not found");
  const fileName = artifactFileName(record.raw, "plan-review") ?? "plan-review.md";
  if (fileName !== "plan-review.md" || !isSafeArtifactFileName(fileName)) {
    throw new Error("Transition to awaiting_approval requires a valid plan-review artifact mapped to plan-review.md.");
  }
  const filePath = path.join(record.dirPath, fileName);
  if (!safeFileExists(filePath, workspaceRoot)) {
    throw new Error("Transition to awaiting_approval requires plan-review.md to exist. Write a meaningful approval plan before requesting user approval.");
  }
  const content = readFileSync(filePath, "utf8");
  if (!artifactIsMeaningful(content)) {
    throw new Error("Transition to awaiting_approval requires plan-review.md to contain meaningful content, not an empty/TBD placeholder.");
  }
}

function progressForTask(record: TaskRecordOnDisk, workflow: YpiStudioWorkflowFile | null, workspaceRoot: string): YpiStudioTaskProgress {
  const task = record.raw;
  const status = task?.status ?? "unknown";
  const state = workflow?.states[status];
  const requiredArtifacts = state?.requiredArtifacts ?? [];
  const optionalArtifacts = state?.optionalArtifacts ?? [];
  const completedArtifacts = task
    ? [...requiredArtifacts, ...optionalArtifacts].filter((artifact) => artifactCompleted(record.dirPath, task, artifact, workspaceRoot))
    : [];
  const missingArtifacts = requiredArtifacts.filter((artifact) => !completedArtifacts.includes(artifact));
  return {
    status,
    label: state?.label ?? status,
    percent: state?.progress ?? (status === "completed" || status === "archived" ? 100 : 0),
    owner: state?.owner ?? "main",
    requiredArtifacts,
    optionalArtifacts,
    completedArtifacts,
    missingArtifacts,
  };
}

function workflowForTask(cwd: string, task: YpiStudioTaskRecord | null): YpiStudioWorkflowFile | null {
  if (!task) return null;
  return readYpiStudioWorkflow(cwd, task.workflowId) ?? null;
}

function recordToSummary(ctx: TaskContext, record: TaskRecordOnDisk): YpiStudioTaskSummary {
  const workflow = workflowForTask(ctx.cwd, record.raw);
  const progress = progressForTask(record, workflow, ctx.workspaceRoot);
  const task = record.raw;
  return {
    key: record.key,
    id: task?.id ?? record.id,
    title: task?.title ?? record.id,
    workflowId: task?.workflowId ?? "unknown",
    workflowName: workflow?.name,
    status: task?.status ?? "unknown",
    cwd: task?.cwd ?? ctx.cwd,
    pathLabel: record.pathLabel,
    createdAt: task?.createdAt ?? "",
    updatedAt: task?.updatedAt ?? new Date(record.modifiedMs).toISOString(),
    completedAt: task?.completedAt,
    currentMember: task?.currentMember ?? progress.owner,
    contextIds: task?.contextIds ?? [],
    progress,
    archived: record.archived,
    archiveMonth: record.archiveMonth,
    archivedAt: optionalString(task?.meta.archivedAt),
    archiveReason: optionalString(task?.meta.archiveReason),
    knowledgePath: optionalString(task?.meta.knowledgePath),
    readError: record.readError,
    implementation: summarizeImplementation(task?.implementationPlan, task?.implementationProgress),
  };
}

function sortTasks(a: YpiStudioTaskSummary, b: YpiStudioTaskSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title);
}

function isTaskEventType(value: string): value is YpiStudioTaskEvent["type"] {
  return value === "created" || value === "transition" || value === "artifact" || value === "subagent" || value === "note" || value === "archive";
}

function readEvents(dirPath: string): YpiStudioTaskEvent[] {
  const filePath = path.join(dirPath, EVENTS_JSONL);
  if (!existsSync(filePath)) return [];
  const { content } = readFileWithLimit(filePath, EVENTS_MAX_BYTES);
  const events: YpiStudioTaskEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isRecord(parsed)) continue;
      const type = optionalString(parsed.type);
      const at = optionalString(parsed.at);
      const taskId = optionalString(parsed.taskId);
      if (!type || !isTaskEventType(type) || !at || !taskId) continue;
      events.push({
        type,
        at,
        taskId,
        message: optionalString(parsed.message),
        from: optionalString(parsed.from),
        to: optionalString(parsed.to),
        member: optionalString(parsed.member),
        artifact: optionalString(parsed.artifact),
        data: isRecord(parsed.data) ? parsed.data : undefined,
      });
    } catch {
      // Ignore malformed event rows in the compact detail projection.
    }
  }
  return events;
}

function readTaskDocument(ctx: TaskContext, record: TaskRecordOnDisk, task: YpiStudioTaskRecord, artifact: string): YpiStudioTaskDocument | undefined {
  const fileName = artifactFileName(task, artifact);
  if (!fileName || !isSafeArtifactFileName(fileName)) return undefined;
  const filePath = path.join(record.dirPath, fileName);
  if (!existsSync(filePath)) return undefined;
  const stat = safeStatFile(filePath, ctx.workspaceRoot);
  if (!stat) return undefined;
  const { content, truncated } = readFileWithLimit(filePath, DOC_MAX_BYTES);
  return { artifact, fileName, content, truncated };
}

function recordToDetail(ctx: TaskContext, record: TaskRecordOnDisk): YpiStudioTaskDetail | null {
  if (!record.raw) return null;
  const summary = recordToSummary(ctx, record);
  const documents: Record<string, YpiStudioTaskDocument> = {};
  for (const artifact of Object.keys(record.raw.artifacts)) {
    const document = readTaskDocument(ctx, record, record.raw, artifact);
    if (document) documents[artifact] = document;
  }
  return {
    ...summary,
    artifacts: record.raw.artifacts,
    documents,
    subagents: record.raw.subagents,
    meta: record.raw.meta,
    events: readEvents(record.dirPath),
    implementationPlan: record.raw.implementationPlan,
    implementationProgress: record.raw.implementationProgress,
    implementationProjection: buildImplementationProjection(record.raw.implementationPlan, record.raw.implementationProgress, record.raw.subagents, record.raw.status),
    improvements: record.raw.improvements,
  };
}

function loadTaskRecord(ctx: TaskContext, taskIdOrKey: string): TaskRecordOnDisk | null {
  const parsed = parseTaskKey(taskIdOrKey);
  const dirPath = taskDir(ctx, taskIdOrKey);
  if (!existsSync(dirPath)) return null;
  return scanTaskDirectory(ctx, dirPath, parsed.archived ? parsed.archiveMonth : undefined);
}

/**
 * Known session-class Studio context ids.
 * Exact forms only: raw `pi_<sessionId>`, `pi_transcript_<hash>`, `pi_process_<hash>`.
 * Unknown / non-session contexts (including non-`pi_*` metadata) are not classified as session owners.
 */
export function isYpiStudioSessionContextId(id: string): boolean {
  if (typeof id !== "string" || !id) return false;
  if (id.startsWith("pi_transcript_")) return id.length > "pi_transcript_".length;
  if (id.startsWith("pi_process_")) return id.length > "pi_process_".length;
  // Raw session id form: pi_<sessionId>, excluding the transcript/process prefixes above.
  if (id.startsWith("pi_")) return id.length > "pi_".length;
  return false;
}

/**
 * Replace all known session-class context ids with a single next owner while preserving non-session metadata.
 * Used by exclusive bind/transfer; pure helper safe to call inside withTaskMutationLock.
 */
export function replaceTaskSessionContext(contextIds: string[], next: string): string[] {
  const nextId = typeof next === "string" ? next.trim() : "";
  const result: string[] = [];
  for (const id of contextIds) {
    if (typeof id !== "string" || !id) continue;
    if (isYpiStudioSessionContextId(id)) continue;
    if (!result.includes(id)) result.push(id);
  }
  if (nextId && !result.includes(nextId)) result.push(nextId);
  return result;
}

/**
 * Guard for ordinary active-task mutations: the request context must already be bound.
 * Does not append or transfer ownership; exclusive rebind belongs to bindYpiStudioTaskToContext.
 */
export function assertTaskBoundToContext(record: Pick<YpiStudioTaskRecord, "contextIds">, contextId: string | undefined): void {
  if (!contextId || !contextId.trim()) {
    throw new Error("This Studio task mutation requires a bound session context. Bind/resume the task in this chat first.");
  }
  if (!record.contextIds.includes(contextId)) {
    throw new Error("Studio task is not bound to this session context. Bind/resume the task before mutating it from this chat.");
  }
}

function safeRuntimeContextFileName(contextId: string): string | null {
  if (!contextId.trim()) return null;
  const safeContext = contextId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  return safeContext || null;
}

function runtimePointerMatchesTaskId(currentTask: string, taskId: string): boolean {
  if (currentTask === taskId) return true;
  try {
    return parseTaskKey(currentTask).id === parseTaskKey(taskId).id;
  } catch {
    return false;
  }
}

function writeRuntimePointer(ctx: TaskContext, contextId: string, taskId: string): void {
  const safeContext = safeRuntimeContextFileName(contextId);
  if (!safeContext) return;
  ensureTaskRoots(ctx);
  writeFileSync(path.join(ctx.runtimeSessionsRoot, `${safeContext}.json`), `${JSON.stringify({ currentTask: taskId, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

function readRuntimePointer(ctx: TaskContext, contextId: string): string | null {
  const safeContext = safeRuntimeContextFileName(contextId);
  if (!safeContext) return null;
  const filePath = path.join(ctx.runtimeSessionsRoot, `${safeContext}.json`);
  if (!existsSync(filePath)) return null;
  safeStatFile(filePath, ctx.workspaceRoot);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? optionalString(parsed.currentTask) ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Compare-before-unlink helper for exclusive session transfer.
 * Removes a context runtime pointer only when it still points at the given task id/key.
 * Safe to call inside withTaskMutationLock; returns true when a file was removed.
 */
function removeRuntimePointerIfMatches(ctx: TaskContext, contextId: string, taskId: string): boolean {
  const safeContext = safeRuntimeContextFileName(contextId);
  if (!safeContext || !taskId) return false;
  if (!existsSync(ctx.runtimeSessionsRoot)) return false;
  const filePath = path.join(ctx.runtimeSessionsRoot, `${safeContext}.json`);
  if (!existsSync(filePath)) return false;
  try {
    safeStatFile(filePath, ctx.workspaceRoot);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const currentTask = isRecord(parsed) ? optionalString(parsed.currentTask) : undefined;
    if (!currentTask || !runtimePointerMatchesTaskId(currentTask, taskId)) return false;
    unlinkSync(filePath);
    return true;
  } catch {
    // Ignore malformed/racy pointer files; transfer still treats task.json contextIds as authority.
    return false;
  }
}

/** Public wrapper for focused tests and callers that only have cwd (OWN-2 uses the ctx form in-file). */
export function removeYpiStudioRuntimePointerIfMatches(cwd: string, contextId: string, taskId: string): boolean {
  return removeRuntimePointerIfMatches(createContext(cwd), contextId, taskId);
}

function placeholderContent(fileName: string): string {
  const title = fileName.replace(/\.md$/i, "").replace(/-/g, " ");
  return `# ${title}\n\n_TBD by YPI Studio workflow._\n`;
}

function createArtifactFiles(dirPath: string, artifacts: Record<string, string>): void {
  for (const fileName of Object.values(artifacts)) {
    if (!isSafeArtifactFileName(fileName)) continue;
    const filePath = path.join(dirPath, fileName);
    if (!existsSync(filePath)) writeFileSync(filePath, placeholderContent(fileName), { encoding: "utf8", flag: "wx" });
  }
}

function ensureArchiveKnowledgeRoots(ctx: TaskContext): void {
  ensureTaskRoots(ctx);
  if (existsSync(ctx.archiveRoot)) assertDirectoryWithinWorkspace(ctx.archiveRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.archiveRoot);
  if (existsSync(ctx.knowledgeRoot)) assertDirectoryWithinWorkspace(ctx.knowledgeRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.knowledgeRoot);
}

function compactTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safeTags(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean).map((tag) => tag.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-").replace(/^-+|-+$/g, "")).filter(Boolean))].slice(0, 12);
}

function readKnowledgeIndex(ctx: TaskContext): YpiStudioKnowledgeIndex {
  if (!existsSync(ctx.knowledgeIndexPath)) return { schemaVersion: 1, updatedAt: nowIso(), entries: [] };
  safeStatFile(ctx.knowledgeIndexPath, ctx.workspaceRoot);
  const parsed = JSON.parse(readFileSync(ctx.knowledgeIndexPath, "utf8")) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("Invalid .ypi/knowledge/index.json");
  }
  const entries = parsed.entries.filter(isRecord).map((entry): YpiStudioKnowledgeEntry | null => {
    const id = optionalString(entry.id);
    const title = optionalString(entry.title);
    const taskId = optionalString(entry.taskId);
    const taskKeyValue = optionalString(entry.taskKey);
    const workflowId = optionalString(entry.workflowId);
    const summary = optionalString(entry.summary);
    const sourceTaskPath = optionalString(entry.sourceTaskPath);
    const knowledgePath = optionalString(entry.knowledgePath);
    const createdAt = optionalString(entry.createdAt);
    const archivedAt = optionalString(entry.archivedAt);
    if (!id || !title || !taskId || !taskKeyValue || !workflowId || !summary || !sourceTaskPath || !knowledgePath || !createdAt || !archivedAt) return null;
    return { id, title, taskId, taskKey: taskKeyValue, workflowId, summary, tags: stringArray(entry.tags), sourceTaskPath, knowledgePath, createdAt, archivedAt, sourceArtifacts: stringArray(entry.sourceArtifacts) };
  }).filter((entry): entry is YpiStudioKnowledgeEntry => !!entry);
  return { schemaVersion: 1, updatedAt: optionalString(parsed.updatedAt) ?? nowIso(), entries };
}

function writeKnowledgeIndex(ctx: TaskContext, index: YpiStudioKnowledgeIndex): void {
  writeFileSync(ctx.knowledgeIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function collectArchiveArtifacts(ctx: TaskContext, record: TaskRecordOnDisk, task: YpiStudioTaskRecord): Array<{ artifact: string; fileName: string; content: string }> {
  const priority = ["summary", "handoff", "review", "checks", "design", "implement", "prd", "brief", "ui"];
  const names = [...priority, ...Object.keys(task.artifacts).filter((artifact) => !priority.includes(artifact))];
  const docs: Array<{ artifact: string; fileName: string; content: string }> = [];
  for (const artifact of names) {
    const fileName = artifactFileName(task, artifact);
    if (!fileName || !isSafeArtifactFileName(fileName)) continue;
    const filePath = path.join(record.dirPath, fileName);
    if (!existsSync(filePath) || !safeStatFile(filePath, ctx.workspaceRoot)) continue;
    const { content } = readFileWithLimit(filePath, 48 * 1024);
    if (artifactIsMeaningful(content)) docs.push({ artifact, fileName, content: content.trim() });
  }
  return docs;
}

function clampText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function buildFallbackKnowledge(task: YpiStudioTaskRecord, docs: Array<{ artifact: string; fileName: string; content: string }>, archivePath: string, archivedAt: string, tags: string[]): { summary: string; markdown: string } {
  const summaryDoc = docs.find((doc) => doc.artifact === "summary") ?? docs[0];
  const summary = summaryDoc ? clampText(summaryDoc.content.replace(/^#.*$/m, ""), 900) : `Archived YPI Studio task ${task.id}: ${task.title}.`;
  const reusable = docs.slice(0, 5).map((doc) => `### ${doc.fileName}\n\n${doc.content.slice(0, 1800).trim()}`).join("\n\n");
  const markdown = [
    `# ${task.title}`,
    "",
    `- Task: ${task.id}`,
    `- Workflow: ${task.workflowId}`,
    `- Archived task: ${archivePath}`,
    `- Archived at: ${archivedAt}`,
    `- Tags: ${tags.join(", ") || "studio"}`,
    "",
    "## Summary",
    summary,
    "",
    "## Reusable knowledge",
    reusable || summary,
    "",
    "## Source artifacts",
    ...docs.map((doc) => `- ${doc.fileName}`),
  ].join("\n");
  return { summary, markdown };
}

function uniqueKnowledgeFilePath(ctx: TaskContext, baseId: string): { id: string; fullPath: string; pathLabel: string } {
  for (let i = 0; i < 20; i += 1) {
    const id = i === 0 ? baseId : `${baseId}-${i + 1}`;
    const fullPath = path.join(ctx.knowledgeRoot, `${id}.md`);
    if (!existsSync(fullPath)) return { id, fullPath, pathLabel: relativeLabel(ctx.workspaceRoot, fullPath) };
  }
  throw new Error("Could not allocate a unique knowledge file name");
}

function cleanupRuntimePointers(ctx: TaskContext, taskId: string): number {
  if (!existsSync(ctx.runtimeSessionsRoot)) return 0;
  assertDirectoryWithinWorkspace(ctx.runtimeSessionsRoot, ctx.workspaceRoot);
  let removed = 0;
  for (const entry of readdirSync(ctx.runtimeSessionsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(ctx.runtimeSessionsRoot, entry.name);
    try {
      safeStatFile(filePath, ctx.workspaceRoot);
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (isRecord(parsed) && optionalString(parsed.currentTask) === taskId) {
        unlinkSync(filePath);
        removed += 1;
      }
    } catch {
      // Ignore malformed runtime pointers while archiving a valid task.
    }
  }
  return removed;
}

export function archiveYpiStudioTask(taskIdOrKey: string, body: YpiStudioTaskArchiveBody): YpiStudioTaskArchiveResult {
  const ctx = createContext(body.cwd);
  ensureArchiveKnowledgeRoots(ctx);
  const parsed = parseTaskKey(taskIdOrKey);
  if (parsed.archived) throw new Error("Task is already archived");
  const record = loadTaskRecord(ctx, parsed.id);
  if (!record?.raw) throw new Error("Task not found");
  if (record.archived) throw new Error("Task is already archived");
  if (record.raw.status !== "completed") throw new Error("Only completed YPI Studio tasks can be archived. Transition unfinished work to cancelled instead.");
  assertNoUnresolvedImprovementsForComplete(record.raw, "archive");
  const running = record.raw.subagents.filter((run) => run.status === "running");
  if (running.length > 0) throw new Error(`Cannot archive task while ${running.length} Studio member run(s) are still running.`);

  const archivedAt = nowIso();
  const archiveMonth = archivedAt.slice(0, 7);
  const archiveDir = path.join(ctx.archiveRoot, archiveMonth, record.raw.id);
  if (existsSync(archiveDir)) throw new Error(`Archive target already exists: ${relativeLabel(ctx.workspaceRoot, archiveDir)}`);
  mkdirSync(path.dirname(archiveDir), { recursive: true });
  assertDirectoryWithinWorkspace(path.dirname(archiveDir), ctx.workspaceRoot);
  const sourceTaskPath = relativeLabel(ctx.workspaceRoot, archiveDir);
  const docs = collectArchiveArtifacts(ctx, record, record.raw);
  const tags = safeTags([...(body.tags ?? []), "studio", record.raw.workflowId]);
  const warnings: string[] = [];
  const fallback = buildFallbackKnowledge(record.raw, docs, sourceTaskPath, archivedAt, tags);
  let summary = body.knowledgeSummary?.trim() || "";
  let markdown = body.knowledgeMarkdown?.trim() || "";
  if (!summary || !markdown) {
    if (!body.allowFallbackKnowledge) {
      throw new Error("Archive knowledge summary is required. Use /studio-archive so the current session model can summarize reusable knowledge, or pass knowledgeSummary and knowledgeMarkdown explicitly.");
    }
    warnings.push("Used deterministic artifact fallback because model-generated archive knowledge was not provided.");
    summary ||= fallback.summary;
    markdown ||= fallback.markdown;
  }
  summary = clampText(summary, 1000);

  const allocated = uniqueKnowledgeFilePath(ctx, `${compactTimestamp()}-${slugify(record.raw.title)}`);
  const knowledgeMarkdown = markdown.includes("## Summary") ? markdown : [
    `# ${record.raw.title}`,
    "",
    `- Task: ${record.raw.id}`,
    `- Workflow: ${record.raw.workflowId}`,
    `- Archived task: ${sourceTaskPath}`,
    `- Archived at: ${archivedAt}`,
    `- Tags: ${tags.join(", ") || "studio"}`,
    "",
    "## Summary",
    summary,
    "",
    "## Reusable knowledge",
    markdown,
    "",
    "## Source artifacts",
    ...docs.map((doc) => `- ${doc.fileName}`),
  ].join("\n");
  writeFileSync(allocated.fullPath, `${knowledgeMarkdown.trim()}\n`, { encoding: "utf8", flag: "wx" });
  const taskKeyValue = archivedTaskKey(archiveMonth, record.raw.id);
  const entry: YpiStudioKnowledgeEntry = {
    id: allocated.id,
    title: record.raw.title,
    taskId: record.raw.id,
    taskKey: taskKeyValue,
    workflowId: record.raw.workflowId,
    summary,
    tags,
    sourceTaskPath,
    knowledgePath: allocated.pathLabel,
    createdAt: archivedAt,
    archivedAt,
    sourceArtifacts: docs.map((doc) => doc.fileName),
  };
  const index = readKnowledgeIndex(ctx);
  index.entries = [entry, ...index.entries.filter((existing) => existing.id !== entry.id)];
  index.updatedAt = archivedAt;
  writeKnowledgeIndex(ctx, index);

  const previousTask = { ...record.raw, contextIds: [...record.raw.contextIds], artifacts: { ...record.raw.artifacts }, subagents: [...record.raw.subagents], meta: { ...record.raw.meta } };
  record.raw.status = "archived";
  record.raw.updatedAt = archivedAt;
  record.raw.currentMember = "main";
  record.raw.meta = { ...record.raw.meta, archivedAt, archiveReason: body.reason, knowledgeEntryId: entry.id, knowledgePath: entry.knowledgePath };
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "archive", at: archivedAt, taskId: record.raw.id, message: body.reason, data: { archiveMonth, sourceTaskPath, knowledgeEntryId: entry.id, knowledgePath: entry.knowledgePath, runtimePointersRemoved: cleanupRuntimePointers(ctx, record.raw.id), warnings } });
  try {
    renameSync(record.dirPath, archiveDir);
  } catch (error) {
    writeTaskJson(record.dirPath, previousTask);
    throw error;
  }
  const task = getYpiStudioTaskDetail(ctx.cwd, taskKeyValue);
  if (!task) throw new Error("Archived task could not be read");
  return { task, knowledge: entry, warnings: warnings.length ? warnings : undefined };
}

function assertNoUnresolvedImprovementsForComplete(task: YpiStudioTaskRecord, action: "complete" | "archive"): void {
  if (!task.improvements?.instances?.length) return;
  const unresolved = task.improvements.instances.filter((inst) => isImprovementUnresolved(inst.status));
  if (unresolved.length > 0) {
    const ids = unresolved.map((inst) => inst.displayId).join(", ");
    throw new Error(`Cannot ${action} task while ${unresolved.length} improvement(s) remain unresolved: ${ids}. Resolve all improvements or accept-not-doing them before ${action === "complete" ? "completing" : "archiving"} the main task.`);
  }
}

export function createYpiStudioImprovement(taskIdOrKey: string, body: YpiStudioImprovementCreateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot create improvements");

    const allowedStatuses = ["review", "user_acceptance", "waiting_for_improvements"];
    if (!allowedStatuses.includes(record.raw.status)) {
      throw new Error("Improvements can only be created while the main task is in review, user_acceptance, or waiting_for_improvements. Current status: " + record.raw.status);
    }

    const now = nowIso();
    const instanceId = `imp_${Math.random().toString(36).slice(2, 10)}`;
    const existingInstances = record.raw.improvements?.instances ?? [];
    const displayId = `IMP-${String(existingInstances.length + 1).padStart(3, "0")}`;

    const instance: YpiStudioImprovementInstance = {
      id: instanceId,
      displayId,
      title: body.title,
      feedback: body.feedback,
      status: "analysis",
      owner: body.owner ?? "improver",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      artifacts: { ...IMPROVEMENT_DEFAULT_ARTIFACTS },
      runIds: [],
      attempts: 0,
    };

    // Create instance directory and placeholder artifacts
    const instanceDir = improvementInstanceDir(record.dirPath, instanceId);
    mkdirSync(instanceDir, { recursive: true });
    assertDirectoryWithinWorkspace(instanceDir, ctx.workspaceRoot);
    for (const fileName of Object.values(IMPROVEMENT_DEFAULT_ARTIFACTS)) {
      if (!isSafeArtifactFileName(fileName)) continue;
      const filePath = path.join(instanceDir, fileName);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, placeholderContent(fileName), { encoding: "utf8", flag: "wx" });
      }
    }

    // Add to improvements
    const improvements = record.raw.improvements ?? { schemaVersion: 1, parentStatus: "none", instances: [] };
    improvements.instances = [...improvements.instances, instance];
    improvements.parentStatus = "waiting_for_improvements";
    record.raw.improvements = improvements;

    const previousStatus = record.raw.status;
    if (record.raw.status === "user_acceptance" || record.raw.status === "review") {
      record.raw.status = "waiting_for_improvements";
      record.raw.currentMember = "main";
    }

    record.raw.updatedAt = now;
    if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);

    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: `Created improvement ${displayId}: ${body.title}`,
      data: { improvementId: instanceId, displayId, title: body.title, feedback: body.feedback },
    });
    if (previousStatus !== "waiting_for_improvements") {
      appendTaskEvent(record.dirPath, {
        type: "transition",
        at: now,
        taskId: record.raw.id,
        from: previousStatus,
        to: "waiting_for_improvements",
        message: `Main task entered waiting_for_improvements due to ${displayId}`,
        data: { improvementId: instanceId, displayId },
      });
    }

    if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after creating improvement");
    return detail;
  });
}

export function reconcileYpiStudioImprovements(cwd: string, taskIdOrKey: string): YpiStudioTaskDetail {
  const ctx = createContext(cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot reconcile improvements");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) return getYpiStudioTaskDetail(ctx.cwd, record.raw.id)!;

    const unresolvedCount = improvements.instances.filter((inst) => isImprovementUnresolved(inst.status)).length;
    const now = nowIso();
    let changed = false;

    if (unresolvedCount > 0) {
      if (improvements.parentStatus !== "waiting_for_improvements") {
        improvements.parentStatus = "waiting_for_improvements";
        changed = true;
      }
    } else {
      // All improvements are resolved (accepted or accepted_not_doing)
      if (improvements.parentStatus !== "review_ready") {
        improvements.parentStatus = "review_ready";
        changed = true;
      }
      // If parent is waiting_for_improvements, transition to review
      if (record.raw.status === "waiting_for_improvements") {
        record.raw.status = "review";
        record.raw.currentMember = "main";
        changed = true;
        appendTaskEvent(record.dirPath, {
          type: "transition",
          at: now,
          taskId: record.raw.id,
          from: "waiting_for_improvements",
          to: "review",
          message: "All improvements resolved; main task returned to review for re-acceptance.",
          data: { improvementsResolved: improvements.instances.length },
        });
      }
    }

    if (changed) {
      record.raw.updatedAt = now;
      writeTaskJson(record.dirPath, record.raw);
    }

    return getYpiStudioTaskDetail(ctx.cwd, record.raw.id)!;
  });
}

/** Legal improvement transition map. The key is the from status; the value is the set of allowed target statuses. */
const IMPROVEMENT_TRANSITIONS: ReadonlyMap<YpiStudioImprovementStatus, ReadonlySet<YpiStudioImprovementStatus>> = new Map([
  ["analysis", new Set(["waiting_clarification", "waiting_prototype", "waiting_plan_approval", "cancelled", "failed"])],
  ["waiting_clarification", new Set(["analysis", "cancelled", "failed"])],
  ["waiting_prototype", new Set(["waiting_plan_approval", "cancelled", "failed"])],
  ["waiting_plan_approval", new Set(["implementing", "cancelled", "failed"])],
  ["implementing", new Set(["checking", "cancelled", "failed"])],
  ["checking", new Set(["implementing", "waiting_user_acceptance", "cancelled", "failed"])],
  ["waiting_user_acceptance", new Set(["accepted", "cancelled", "failed"])],
  ["accepted", new Set()],
  ["cancelled", new Set(["analysis", "accepted_not_doing"])],
  ["failed", new Set(["analysis", "accepted_not_doing"])],
  ["accepted_not_doing", new Set()],
]);

/** Internal reconciler that does not take its own lock; caller must hold the task mutation lock. */
function reconcileImprovementsInLock(record: TaskRecordOnDisk & { raw: YpiStudioTaskRecord }): boolean {
  const improvements = record.raw.improvements;
  if (!improvements?.instances?.length) return false;

  const unresolvedCount = improvements.instances.filter((inst) => isImprovementUnresolved(inst.status)).length;
  const now = nowIso();
  let changed = false;

  if (unresolvedCount > 0) {
    if (improvements.parentStatus !== "waiting_for_improvements") {
      improvements.parentStatus = "waiting_for_improvements";
      changed = true;
    }
  } else {
    // All improvements are resolved (accepted or accepted_not_doing)
    if (improvements.parentStatus !== "review_ready") {
      improvements.parentStatus = "review_ready";
      changed = true;
    }
    // If parent is waiting_for_improvements, transition to review
    if (record.raw.status === "waiting_for_improvements") {
      record.raw.status = "review";
      record.raw.currentMember = "main";
      changed = true;
      appendTaskEvent(record.dirPath, {
        type: "transition",
        at: now,
        taskId: record.raw.id,
        from: "waiting_for_improvements",
        to: "review",
        message: "All improvements resolved; main task returned to review for re-acceptance.",
        data: { improvementsResolved: improvements.instances.length },
      });
    }
  }

  if (changed) {
    record.raw.updatedAt = now;
    writeTaskJson(record.dirPath, record.raw);
  }
  return changed;
}

export function transitionYpiStudioImprovement(taskIdOrKey: string, body: YpiStudioImprovementTransitionBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot transition improvements");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) {
      throw new Error("Task has no improvements");
    }

    const index = improvements.instances.findIndex((inst) => inst.id === body.improvementId);
    if (index === -1) throw new Error(`Improvement not found: ${body.improvementId}`);

    const instance = improvements.instances[index];
    if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);
    const allowedTargets = IMPROVEMENT_TRANSITIONS.get(instance.status);
    if (!allowedTargets) throw new Error(`Unknown improvement status: ${instance.status}`);
    if (!allowedTargets.has(body.to)) {
      throw new Error(`Invalid improvement transition from ${instance.status} to ${body.to}`);
    }

    // Approval gate: waiting_plan_approval -> implementing requires recorded approval
    if (instance.status === "waiting_plan_approval" && body.to === "implementing") {
      if (!instance.approval?.approvedAt) {
        throw new Error(`Improvement ${instance.displayId}: transition to implementing requires recorded user approval. Call recordYpiStudioImprovementApproval first after the user explicitly approves the plan.`);
      }
      if (instance.approval.contextId && body.contextId && instance.approval.contextId !== body.contextId) {
        throw new Error(`Improvement ${instance.displayId}: approval was recorded in a different session context. Ask the user to approve in this chat session.`);
      }
      // Verify that plan-review and UI evidence gates were satisfied at the time of recording.
      // We re-check them here as a safety net in case artifacts were removed after approval.
      const instanceDir = improvementInstanceDir(record.dirPath, instance.id);
      assertImprovementPlanReviewReady(instance, instanceDir, ctx.workspaceRoot);
      assertImprovementUIEvidence(instance, instanceDir, ctx.workspaceRoot);
    }

    // For transitions into accepted/accepted_not_doing, require explicit acceptance or disposition
    if (body.to === "accepted" && instance.status !== "waiting_user_acceptance") {
      throw new Error("Improvement can only be accepted from waiting_user_acceptance");
    }
    if (body.to === "accepted_not_doing" && instance.status !== "cancelled" && instance.status !== "failed") {
      throw new Error("Improvement can only be accepted_not_doing from cancelled or failed");
    }

    const now = nowIso();
    const previousStatus = instance.status;
    instance.status = body.to;
    instance.updatedAt = now;
    if (body.to === "accepted" || body.to === "accepted_not_doing") {
      instance.completedAt = now;
      if (body.to === "accepted") {
        instance.acceptance = {
          acceptedAt: now,
          contextId: body.contextId,
          disposition: "accepted",
        };
      }
    }

    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: body.reason
        ? `Improvement ${instance.displayId}: ${previousStatus} -> ${body.to} (${body.reason})`
        : `Improvement ${instance.displayId}: ${previousStatus} -> ${body.to}`,
      data: { improvementId: instance.id, displayId: instance.displayId, from: previousStatus, to: body.to, reason: body.reason },
    });

    // Reconcile: if this transition made the instance terminal, check whether parent can move back to review
    reconcileImprovementsInLock(record as TaskRecordOnDisk & { raw: YpiStudioTaskRecord });

    writeTaskJson(record.dirPath, record.raw);

    if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after transitioning improvement");
    return detail;
  });
}

export function resolveYpiStudioImprovementDisposition(taskIdOrKey: string, body: YpiStudioImprovementDispositionBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot resolve improvement disposition");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) {
      throw new Error("Task has no improvements");
    }

    const index = improvements.instances.findIndex((inst) => inst.id === body.improvementId);
    if (index === -1) throw new Error(`Improvement not found: ${body.improvementId}`);

    const instance = improvements.instances[index];
    if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);

    // Disposition is only meaningful on terminal unresolved statuses (cancelled, failed)
    if (!isImprovementUnresolved(instance.status)) {
      throw new Error(`Improvement ${instance.displayId} is already resolved (${instance.status}). Disposition only applies to unresolved statuses.`);
    }
    if (instance.status !== "cancelled" && instance.status !== "failed" && body.disposition === "accepted_not_doing") {
      throw new Error(`accepted_not_doing disposition is only valid for cancelled or failed improvements, not ${instance.status}`);
    }
    if (body.disposition === "accepted" && instance.status !== "waiting_user_acceptance") {
      throw new Error("Accepted disposition requires the improvement to be in waiting_user_acceptance. Use transitionYpiStudioImprovement instead.");
    }

    const now = nowIso();
    const previousStatus = instance.status;

    // Setting accepted_not_doing: mark as resolved, record disposition
    if (body.disposition === "accepted_not_doing") {
      instance.status = "accepted_not_doing";
      instance.completedAt = now;
      instance.disposition = body.disposition;
      instance.disposedAt = now;
      instance.disposedBy = body.contextId;
      instance.disposedReason = body.reason ?? "User explicitly accepted not doing this improvement.";
    } else if (body.disposition === "accepted") {
      instance.status = "accepted";
      instance.completedAt = now;
      instance.acceptance = {
        acceptedAt: now,
        contextId: body.contextId,
        disposition: "accepted",
        reason: body.reason,
      };
    } else if (body.disposition === "cancelled") {
      instance.status = "cancelled";
      instance.disposition = body.disposition;
      instance.disposedAt = now;
      instance.disposedBy = body.contextId;
      instance.disposedReason = body.reason;
    } else if (body.disposition === "failed") {
      instance.status = "failed";
      instance.disposition = body.disposition;
      instance.disposedAt = now;
      instance.disposedBy = body.contextId;
      instance.disposedReason = body.reason;
    }

    instance.updatedAt = now;

    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: body.reason
        ? `Improvement ${instance.displayId} disposition: ${previousStatus} -> ${instance.status} (${body.reason})`
        : `Improvement ${instance.displayId} disposition: ${previousStatus} -> ${instance.status}`,
      data: { improvementId: instance.id, displayId: instance.displayId, from: previousStatus, to: instance.status, disposition: body.disposition, reason: body.reason },
    });

    // Reconcile parent task status
    reconcileImprovementsInLock(record as TaskRecordOnDisk & { raw: YpiStudioTaskRecord });

    writeTaskJson(record.dirPath, record.raw);

    if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after resolving improvement disposition");
    return detail;
  });
}

/**
 * Update an artifact file within an improvement instance.
 * If the improvement is in waiting_plan_approval, any artifact change invalidates
 * the recorded approval and bumps the plan revision.
 */
export function updateYpiStudioImprovementArtifact(taskIdOrKey: string, body: YpiStudioImprovementArtifactUpdateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot update improvement artifacts");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) throw new Error("Task has no improvements");

    const index = improvements.instances.findIndex((inst) => inst.id === body.improvementId);
    if (index === -1) throw new Error(`Improvement not found: ${body.improvementId}`);

    const instance = improvements.instances[index];
    const instanceDir = improvementInstanceDir(record.dirPath, instance.id);
    assertDirectoryWithinWorkspace(instanceDir, ctx.workspaceRoot);

    const fileName = instance.artifacts?.[body.artifact] ?? body.artifact;
    if (!isSafeArtifactFileName(fileName)) throw new YpiStudioTaskSecurityError("Invalid improvement artifact file name");
    const filePath = path.join(instanceDir, fileName);
    if (!existsSync(path.dirname(filePath))) mkdirSync(path.dirname(filePath), { recursive: true });
    safeRealPath(instanceDir, ctx.workspaceRoot);
    writeFileSync(filePath, body.content, "utf8");

    const now = nowIso();

    // If the improvement is waiting for plan approval, any material change invalidates prior approval.
    if (instance.status === "waiting_plan_approval") {
      const revision = (instance.approval?.revision ?? 1) + 1;
      instance.approval = { ...instance.approval, revision, approvedAt: undefined, contextId: undefined, inputHash: undefined };
    }

    instance.updatedAt = now;
    record.raw.updatedAt = now;
    if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);

    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: `Updated improvement ${instance.displayId} artifact ${body.artifact}`,
      data: { improvementId: instance.id, displayId: instance.displayId, artifact: body.artifact },
    });

    if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after updating improvement artifact");
    return detail;
  });
}

/**
 * Update the implementation plan for an improvement instance.
 * Only allowed while the improvement is in analysis, waiting_plan_approval,
 * or waiting_prototype.  Revising during waiting_plan_approval invalidates the
 * prior approval and bumps the revision.
 */
export function updateYpiStudioImprovementPlan(taskIdOrKey: string, body: YpiStudioImprovementPlanUpdateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot update improvement plans");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) throw new Error("Task has no improvements");

    const index = improvements.instances.findIndex((inst) => inst.id === body.improvementId);
    if (index === -1) throw new Error(`Improvement not found: ${body.improvementId}`);

    const instance = improvements.instances[index];
    const allowedStatuses: YpiStudioImprovementStatus[] = ["analysis", "waiting_plan_approval", "waiting_prototype"];
    if (!body.override && !allowedStatuses.includes(instance.status)) {
      throw new Error(`Improvement plan can only be updated while in analysis, waiting_prototype, or waiting_plan_approval. Current: ${instance.status}`);
    }

    const now = nowIso();
    if (body.implementationPlan) {
      const plan = normalizeImplementationPlan(body.implementationPlan);
      if (!plan) throw new Error("implementationPlan must contain at least one valid subtask with id and title");
      instance.implementationPlan = { ...plan, updatedAt: now };
      instance.implementationProgress = rebuildImplementationProgress(instance.implementationPlan, instance.implementationProgress);
    }

    // In waiting_plan_approval, any plan change bumps revision and clears old approval.
    if (instance.status === "waiting_plan_approval") {
      const revision = (instance.approval?.revision ?? 1) + 1;
      instance.approval = { ...instance.approval, revision, approvedAt: undefined, contextId: undefined, inputHash: undefined };
    }

    instance.updatedAt = now;
    record.raw.updatedAt = now;
    if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);

    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: `Updated improvement ${instance.displayId} implementation plan`,
      data: { improvementId: instance.id, displayId: instance.displayId },
    });

    if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after updating improvement plan");
    return detail;
  });
}

/** Regex matching HTML prototype file names inside the improvement instance directory. */
const IMPROVEMENT_HTML_PROTOTYPE_RE = /\.html?$/i;

/** Checks whether an improvement instance has a readable HTML prototype file in its
 *  instance directory.  Does not validate the HTML content itself. */
function improvementHasHtmlPrototype(instanceDir: string, workspaceRoot: string): boolean {
  if (!existsSync(instanceDir)) return false;
  try {
    const entries = readdirSync(instanceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!IMPROVEMENT_HTML_PROTOTYPE_RE.test(entry.name)) continue;
      const filePath = path.join(instanceDir, entry.name);
      if (!safeFileExists(filePath, workspaceRoot)) continue;
      try {
        const stat = statSync(filePath);
        if (stat.size > 0) return true;
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // If the instance directory cannot be read, treat as no prototype.
  }
  return false;
}

/** Determine whether the improvement's ui.md artifact signals that a UI change is needed.
 *  Heuristic: if ui.md is meaningfully written (not TBD/empty), a prototype is expected. */
function improvementUiGateRequired(instance: YpiStudioImprovementInstance, instanceDir: string, workspaceRoot: string): boolean {
  const uiArtifact = instance.artifacts?.ui;
  if (!uiArtifact) return false;
  const uiPath = path.join(instanceDir, uiArtifact);
  if (!safeFileExists(uiPath, workspaceRoot)) return false;
  try {
    const content = readFileSync(uiPath, "utf8");
    return artifactIsMeaningful(content);
  } catch {
    return false;
  }
}

/** Assert that the improvement plan-review artifact exists and is meaningful.
 *  Throws with a descriptive message when the gate is not satisfied. */
function assertImprovementPlanReviewReady(instance: YpiStudioImprovementInstance, instanceDir: string, workspaceRoot: string): void {
  const planReviewArtifact = instance.artifacts?.["plan-review"];
  if (!planReviewArtifact || !isSafeArtifactFileName(planReviewArtifact)) {
    throw new Error(`Improvement ${instance.displayId}: transition to implementing requires a valid plan-review artifact mapped to a safe .md file.`);
  }
  const filePath = path.join(instanceDir, planReviewArtifact);
  if (!safeFileExists(filePath, workspaceRoot)) {
    throw new Error(`Improvement ${instance.displayId}: plan-review.md is missing. Write a meaningful approval plan before requesting approval.`);
  }
  const content = readFileSync(filePath, "utf8");
  if (!artifactIsMeaningful(content)) {
    throw new Error(`Improvement ${instance.displayId}: plan-review.md is empty or contains only TBD placeholder text. Write meaningful content before approval.`);
  }
}

/** Assert that when the improvement has UI changes (ui.md is meaningful), an HTML
 *  prototype exists in the instance directory. */
function assertImprovementUIEvidence(instance: YpiStudioImprovementInstance, instanceDir: string, workspaceRoot: string): void {
  if (!improvementUiGateRequired(instance, instanceDir, workspaceRoot)) return;
  if (!improvementHasHtmlPrototype(instanceDir, workspaceRoot)) {
    throw new Error(`Improvement ${instance.displayId}: ui.md indicates a UI change is required, but no HTML prototype was found in the improvement directory. Create an HTML prototype before requesting plan approval.`);
  }
}

/** Record explicit user approval for an improvement plan so it can proceed to implementing.
 *  Ensures plan-review is ready and UI evidence exists when required before recording the grant.
 *  Must be called while the improvement is in waiting_plan_approval. */
export function recordYpiStudioImprovementApproval(cwd: string, taskIdOrKey: string, improvementId: string, contextId: string, inputText: string): YpiStudioTaskDetail {
  if (!contextId || !isExplicitYpiStudioApprovalText(inputText)) {
    throw new Error("Explicit approval text is required to record improvement approval (e.g., 确认，批准开始实现).");
  }
  const ctx = createContext(cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot record improvement approval");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) throw new Error("Task has no improvements");

    const index = improvements.instances.findIndex((inst) => inst.id === improvementId);
    if (index === -1) throw new Error(`Improvement not found: ${improvementId}`);

    const instance = improvements.instances[index];
    if (instance.status !== "waiting_plan_approval") {
      throw new Error(`Improvement ${instance.displayId} must be in waiting_plan_approval to record approval. Current status: ${instance.status}`);
    }

    const instanceDir = improvementInstanceDir(record.dirPath, instance.id);
    assertImprovementPlanReviewReady(instance, instanceDir, ctx.workspaceRoot);
    assertImprovementUIEvidence(instance, instanceDir, ctx.workspaceRoot);

    const now = nowIso();
    const revision = (instance.approval?.revision ?? 1);
    instance.approval = {
      revision,
      approvedAt: now,
      contextId,
      inputHash: hashText(inputText),
    };
    instance.updatedAt = now;
    record.raw.updatedAt = now;
    assertTaskBoundToContext(record.raw, contextId);

    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: `User approved improvement ${instance.displayId} plan (revision ${revision})`,
      data: { improvementId: instance.id, displayId: instance.displayId, revision, contextId },
    });

    if (contextId) writeRuntimePointer(ctx, contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after recording improvement approval");
    return detail;
  });
}

/**
 * Revise the improvement plan atomically: bumps revision, clears old approval, and
 * writes updated plan-review / artifacts given in the revision map.
 * Accepts an optional map of artifact file names -> content to rewrite.
 */
export function reviseYpiStudioImprovementPlan(
  taskIdOrKey: string,
  body: YpiStudioImprovementPlanUpdateBody & { artifactUpdates?: Record<string, string> },
): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot revise improvement plans");

    const improvements = record.raw.improvements;
    if (!improvements?.instances?.length) throw new Error("Task has no improvements");

    const index = improvements.instances.findIndex((inst) => inst.id === body.improvementId);
    if (index === -1) throw new Error(`Improvement not found: ${body.improvementId}`);

    const instance = improvements.instances[index];
    const instanceDir = improvementInstanceDir(record.dirPath, instance.id);
    assertDirectoryWithinWorkspace(instanceDir, ctx.workspaceRoot);

    const now = nowIso();
    const revision = (instance.approval?.revision ?? 1) + 1;
    instance.approval = { ...instance.approval, revision, approvedAt: undefined, contextId: undefined, inputHash: undefined };
    instance.updatedAt = now;
    record.raw.updatedAt = now;

    // Update implementation plan if provided
    if (body.implementationPlan) {
      const plan = normalizeImplementationPlan(body.implementationPlan);
      if (!plan) throw new Error("implementationPlan must contain at least one valid subtask with id and title");
      instance.implementationPlan = { ...plan, updatedAt: now };
      instance.implementationProgress = rebuildImplementationProgress(instance.implementationPlan, instance.implementationProgress);
    }

    // Update artifact files if provided
    if (body.artifactUpdates) {
      for (const [artifact, content] of Object.entries(body.artifactUpdates)) {
        const fileName = instance.artifacts?.[artifact] ?? artifact;
        if (!isSafeArtifactFileName(fileName)) continue;
        const filePath = path.join(instanceDir, fileName);
        if (!existsSync(path.dirname(filePath))) mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, "utf8");
      }
    }

    if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);

    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, {
      type: "improvement",
      at: now,
      taskId: record.raw.id,
      message: `Revised improvement ${instance.displayId} plan to revision ${revision}`,
      data: { improvementId: instance.id, displayId: instance.displayId, revision, clearedApproval: true },
    });

    if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after revising improvement plan");
    return detail;
  });
}

function tokenizeKnowledge(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter((token) => token.length >= 2).slice(0, 200));
}

export function getYpiStudioKnowledgeContextForPrompt(cwd: string, query: string, options: { maxEntries?: number; maxEntryChars?: number; maxTotalChars?: number } = {}): string {
  const ctx = createContext(cwd);
  let index: YpiStudioKnowledgeIndex;
  try {
    index = readKnowledgeIndex(ctx);
  } catch {
    return "";
  }
  if (index.entries.length === 0) return "";
  const maxEntries = options.maxEntries ?? 3;
  const maxEntryChars = options.maxEntryChars ?? 500;
  const maxTotalChars = options.maxTotalChars ?? 3500;
  const queryTokens = tokenizeKnowledge(query);
  const scored = index.entries.map((entry) => {
    const haystack = tokenizeKnowledge([entry.title, entry.workflowId, entry.summary, entry.tags.join(" ")].join(" "));
    let score = 0;
    for (const token of queryTokens) if (haystack.has(token)) score += 1;
    return { entry, score };
  }).sort((a, b) => b.score - a.score || b.entry.archivedAt.localeCompare(a.entry.archivedAt));
  const selected = scored.filter((item) => item.score > 0).slice(0, maxEntries);
  for (const item of scored) {
    if (selected.length >= maxEntries) break;
    if (!selected.some((existing) => existing.entry.id === item.entry.id)) selected.push(item);
  }
  const lines = ["<ypi-studio-knowledge>", "Reusable YPI Studio knowledge (bounded summaries only):"];
  for (const { entry } of selected.slice(0, maxEntries)) {
    lines.push(`- ${entry.title} [${entry.workflowId}] (${entry.knowledgePath}): ${clampText(entry.summary, maxEntryChars)}`);
  }
  lines.push("</ypi-studio-knowledge>");
  const block = lines.join("\n");
  return block.length <= maxTotalChars ? block : `${block.slice(0, maxTotalChars - 32)}\n</ypi-studio-knowledge>`;
}

export function listYpiStudioTasks(cwd: string, options: { scope?: YpiStudioTaskScope } = {}): YpiStudioTasksResponse {
  const ctx = createContext(cwd);
  const scope = options.scope ?? "active";
  const active = scope === "active" || scope === "all" ? scanTaskRecords(ctx) : { exists: existsSync(ctx.tasksRoot), records: [], errors: [] };
  const archived = scope === "archived" || scope === "all" ? scanArchivedTaskRecords(ctx) : { exists: existsSync(ctx.archiveRoot), records: [], errors: [] };
  const exists = active.exists || archived.exists;
  if (!exists) {
    return { cwd: ctx.cwd, exists: false, pathLabel: TASKS_DIR, scope, tasks: [], statusCounts: {}, errors: [] };
  }
  const tasks = [...active.records, ...archived.records].map((record) => recordToSummary(ctx, record)).sort(sortTasks);
  const statusCounts: Record<string, number> = {};
  for (const task of tasks) statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
  return { cwd: ctx.cwd, exists: true, pathLabel: TASKS_DIR, scope, tasks, statusCounts, errors: [...active.errors, ...archived.errors] };
}

export function getYpiStudioTaskDetail(cwd: string, taskIdOrKey: string): YpiStudioTaskDetail | null {
  const ctx = createContext(cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  return record ? recordToDetail(ctx, record) : null;
}

export function getYpiStudioTaskIdForContext(cwd: string, contextId: string): string | null {
  const ctx = createContext(cwd);
  return readRuntimePointer(ctx, contextId);
}

export function getCurrentYpiStudioTaskDetail(cwd: string, contextId: string): YpiStudioTaskDetail | null {
  const ctx = createContext(cwd);
  const taskId = getYpiStudioTaskIdForContext(ctx.cwd, contextId);
  return taskId ? getYpiStudioTaskDetail(ctx.cwd, taskId) : null;
}

export function createYpiStudioTask(body: YpiStudioTaskCreateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  ensureTaskRoots(ctx);
  const workflow = getYpiStudioWorkflowOrDefault(ctx.cwd, body.workflowId);
  let id = createTaskId(body.title);
  let dirPath = path.join(ctx.tasksRoot, id);
  if (existsSync(dirPath)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
    dirPath = path.join(ctx.tasksRoot, id);
  }
  mkdirSync(dirPath, { recursive: false });
  assertDirectoryWithinWorkspace(dirPath, ctx.workspaceRoot);
  const createdAt = nowIso();
  const contextIds = body.contextId ? [body.contextId] : [];
  const initialState = workflow.states[workflow.initialStatus];
  const task: YpiStudioTaskRecord = {
    schemaVersion: 1,
    id,
    title: body.title,
    workflowId: workflow.id,
    status: workflow.initialStatus,
    cwd: ctx.cwd,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    contextIds,
    currentMember: initialState?.owner,
    artifacts: { ...DEFAULT_ARTIFACTS },
    subagents: [],
    meta: {},
  };
  writeTaskJson(dirPath, task);
  writeFileSync(path.join(dirPath, EVENTS_JSONL), "", { encoding: "utf8", flag: "wx" });
  createArtifactFiles(dirPath, task.artifacts);
  appendTaskEvent(dirPath, { type: "created", at: createdAt, taskId: id, message: `Created YPI Studio task '${body.title}'`, data: { workflowId: workflow.id } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, id);
  if (!detail) throw new Error("Created task could not be read");
  return detail;
}

export function bindYpiStudioTaskToContext(cwd: string, taskIdOrKey: string, contextId: string): YpiStudioTaskDetail {
  const nextContextId = typeof contextId === "string" ? contextId.trim() : "";
  if (!nextContextId) throw new Error("contextId is required to bind a Studio task");
  if (!isYpiStudioSessionContextId(nextContextId)) {
    throw new YpiStudioTaskSecurityError("contextId must be a known session context (pi_<sessionId>, pi_transcript_<hash>, or pi_process_<hash>)");
  }
  const ctx = createContext(cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
    const record = loadTaskRecord(ctx, taskIdOrKey);
    if (!record?.raw) throw new Error("Task not found");
    if (record.archived) throw new Error("Archived tasks cannot be rebound");

    const previousContextIds = [...record.raw.contextIds];
    const previousSessionContextIds = previousContextIds.filter(isYpiStudioSessionContextId);
    // Idempotent when next is already the sole session-class owner: only refresh pointer, no revision/event.
    const alreadyExclusiveOwner =
      previousSessionContextIds.length === 1 && previousSessionContextIds[0] === nextContextId;

    if (alreadyExclusiveOwner) {
      writeRuntimePointer(ctx, nextContextId, record.raw.id);
      const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
      if (!detail) throw new Error("Task not found after binding");
      return detail;
    }

    const nextContextIds = replaceTaskSessionContext(previousContextIds, nextContextId);
    const removedSessionContextIds = previousSessionContextIds.filter((id) => id !== nextContextId);

    let approvalGrantCleared = false;
    const grant = isApprovalGrant(record.raw.meta.approvalGrant) ? record.raw.meta.approvalGrant : null;
    if (grant && grant.contextId !== nextContextId) {
      record.raw.meta = { ...record.raw.meta, approvalGrant: undefined };
      approvalGrantCleared = true;
    }

    const updatedAt = nowIso();
    record.raw.contextIds = nextContextIds;
    record.raw.updatedAt = updatedAt;
    // Authority first: task.json owns binding; pointers/events are best-effort side effects.
    writeTaskJson(record.dirPath, record.raw);

    let removedPointerCount = 0;
    for (const removedId of removedSessionContextIds) {
      if (removeRuntimePointerIfMatches(ctx, removedId, record.raw.id)) removedPointerCount += 1;
    }
    writeRuntimePointer(ctx, nextContextId, record.raw.id);

    appendTaskEvent(record.dirPath, {
      type: "note",
      at: updatedAt,
      taskId: record.raw.id,
      message: "Transferred Studio task session ownership",
      data: {
        context_transfer: true,
        fromContextIds: previousSessionContextIds,
        toContextId: nextContextId,
        removedPointerCount,
        approvalGrantCleared,
      },
    });

    const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
    if (!detail) throw new Error("Task not found after binding");
    return detail;
  });
}

function findAwaitingApprovalTaskForContext(ctx: TaskContext, contextId: string): TaskRecordOnDisk | null {
  const pointerTaskId = readRuntimePointer(ctx, contextId);
  if (pointerTaskId) {
    const pointed = loadTaskRecord(ctx, pointerTaskId);
    if (pointed?.raw && !pointed.archived && pointed.raw.status === "awaiting_approval") return pointed;
  }
  const candidates = scanTaskRecords(ctx).records
    .filter((record) => record.raw && !record.archived && record.raw.status === "awaiting_approval" && record.raw.contextIds.includes(contextId))
    .sort((a, b) => (b.raw?.updatedAt ?? "").localeCompare(a.raw?.updatedAt ?? ""));
  return candidates[0] ?? null;
}

export function recordYpiStudioUserApproval(cwd: string, contextId: string, inputText: string): YpiStudioTaskDetail | null {
  if (!contextId || !isExplicitYpiStudioApprovalText(inputText)) return null;
  const ctx = createContext(cwd);
  const preliminary = findAwaitingApprovalTaskForContext(ctx, contextId);
  if (!preliminary?.raw || preliminary.archived || preliminary.raw.status !== "awaiting_approval") return null;
  return withTaskMutationLock(ctx, preliminary.raw.id, () => {
    // Re-resolve under the task lock so concurrent transfer cannot race the grant write.
    const record = findAwaitingApprovalTaskForContext(ctx, contextId);
    if (!record?.raw || record.archived || record.raw.status !== "awaiting_approval") return null;
    assertTaskBoundToContext(record.raw, contextId);
    const existingGate = isApprovalGate(record.raw.meta.approvalGate) ? record.raw.meta.approvalGate : approvalGate(record.raw.updatedAt, "unknown", contextId);
    const approvedAt = isoAfter(existingGate.enteredAt);
    record.raw.meta = {
      ...record.raw.meta,
      approvalGate: existingGate,
      approvalGrant: approvalGrant(approvedAt, contextId, inputText),
    };
    record.raw.updatedAt = approvedAt;
    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, { type: "note", at: approvedAt, taskId: record.raw.id, message: "User approved Studio plan", data: { contextId, approvalGate: existingGate } });
    writeRuntimePointer(ctx, contextId, record.raw.id);
    return getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  });
}

export function transitionYpiStudioTask(taskIdOrKey: string, body: YpiStudioTaskTransitionBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  if (record.archived) throw new Error("Archived tasks cannot transition");
  if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);

  // Block completed/archived when improvements are unresolved
  if (body.to === "completed") {
    assertNoUnresolvedImprovementsForComplete(record.raw, "complete");
  }
  if (body.to === "archived") {
    assertNoUnresolvedImprovementsForComplete(record.raw, "archive");
  }

  // When attempting waiting_for_improvements -> review without override, ensure all improvements are resolved
  if (record.raw.status === "waiting_for_improvements" && body.to === "review" && !body.override) {
    const unresolved = record.raw.improvements?.instances?.filter((inst) => isImprovementUnresolved(inst.status)) ?? [];
    if (unresolved.length > 0) {
      const ids = unresolved.map((inst) => inst.displayId).join(", ");
      throw new Error(`Cannot return to review while ${unresolved.length} improvement(s) remain unresolved: ${ids}. Resolve all improvements first or use override.`);
    }
  }

  const workflow = readYpiStudioWorkflow(ctx.cwd, record.raw.workflowId) ?? getYpiStudioWorkflowOrDefault(ctx.cwd, record.raw.workflowId);
  const from = record.raw.status;
  const transition = findYpiStudioTransition(workflow, from, body.to);
  if (!transition && !body.override) throw new Error(`Invalid Studio transition: ${from} -> ${body.to}`);
  if (body.to === "awaiting_approval") {
    assertPlanReviewReadyForApproval(record, ctx.workspaceRoot);
  }
  if (isApprovalImplementationEdge(from, body.to)) {
    assertYpiStudioImplementationApproved(record.raw, body.contextId);
  } else if (transition?.requiresUserApproval && !body.reason && !body.override) {
    throw new Error(`Transition ${from} -> ${body.to} requires user approval reason`);
  }
  if (!workflow.states[body.to]) throw new Error(`Unknown workflow state: ${body.to}`);
  const updatedAt = nowIso();
  record.raw.status = body.to;
  record.raw.updatedAt = updatedAt;
  record.raw.currentMember = workflow.states[body.to]?.owner;
  if (workflow.terminalStatuses.includes(body.to)) record.raw.completedAt = updatedAt;
  if (body.to === "awaiting_approval") {
    record.raw.meta = {
      ...record.raw.meta,
      approvalGate: approvalGate(updatedAt, from, body.contextId),
      approvalGrant: undefined,
    };
  } else if (from === "awaiting_approval" && (body.to === "planning" || body.to === "changes_requested")) {
    // Leaving the approval state without going forward to implementing: clear the old grant
    // so the user must re-approve after any revisions.
    const revision = (record.raw.meta.planRevision ?? 1) + 1;
    record.raw.meta = { ...record.raw.meta, approvalGrant: undefined, planRevision: revision };
  }
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "transition", at: updatedAt, taskId: record.raw.id, from, to: body.to, message: body.reason, data: { override: body.override === true, approvalGate: body.to === "awaiting_approval" } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after transition");
  return detail;
  });
}

export function updateYpiStudioTaskArtifact(taskIdOrKey: string, body: YpiStudioTaskArtifactUpdateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  if (record.archived) throw new Error("Archived tasks cannot update artifacts");
  if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);
  if (record.raw.status === "awaiting_approval") {
    // Any artifact change during approval invalidates the old approval grant and bumps the plan revision.
    const revision = (record.raw.meta.planRevision ?? 1) + 1;
    record.raw.meta = { ...record.raw.meta, approvalGrant: undefined, planRevision: revision };
  }
  const filePath = artifactPath(record.dirPath, record.raw, body.artifact);
  safeRealPath(record.dirPath, ctx.workspaceRoot);
  writeFileSync(filePath, body.content, "utf8");
  const updatedAt = nowIso();
  record.raw.updatedAt = updatedAt;
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "artifact", at: updatedAt, taskId: record.raw.id, artifact: body.artifact, message: `Updated ${body.artifact}` });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after artifact update");
  return detail;
  });
}

/** Apply a subagent run's status to a single subtask progress entry and refresh the DAG.
 *  Shared by the main-task and improvement-instance run recording paths so the queued/running/
 *  done/failed/blocked semantics stay identical. The caller is responsible for scope validation
 *  (main task vs improvement instance) before calling this helper. */
function applySubagentRunToImplementationProgress(
  plan: YpiStudioImplementationPlan,
  progress: YpiStudioImplementationProgress,
  run: YpiStudioTaskSubagentRun,
  updatedAt: string,
): void {
  if (!run.subtaskId || !progress.subtasks[run.subtaskId]) return;
  const subtask = progress.subtasks[run.subtaskId];
  const previousStatus = subtask.status;
  const hadRunId = subtask.runIds.includes(run.id);
  subtask.runIds = Array.from(new Set([...subtask.runIds, run.id]));
  subtask.lastRunId = run.id;
  subtask.updatedAt = updatedAt;
  if (run.status === "queued") {
    subtask.status = "queued";
    subtask.queuedAt ??= updatedAt;
    subtask.finishedAt = undefined;
    subtask.currentRunId = run.id;
  } else if (run.status === "running") {
    subtask.status = "running";
    subtask.startedAt ??= updatedAt;
    subtask.finishedAt = undefined;
    subtask.currentRunId = run.id;
    if (previousStatus === "queued" || (previousStatus !== "running" && !hadRunId)) subtask.attempts = Math.max(1, subtask.attempts + 1);
    progress.activeSubtaskId = run.subtaskId;
  } else if (run.status === "succeeded") {
    subtask.status = "done";
    subtask.finishedAt = run.finishedAt ?? updatedAt;
    subtask.currentRunId = undefined;
    subtask.summary = run.summary ?? subtask.summary;
    subtask.terminationReason = run.terminationReason ?? subtask.terminationReason;
  } else if (run.status === "failed" || run.status === "cancelled") {
    subtask.status = "failed";
    subtask.finishedAt = run.finishedAt ?? updatedAt;
    subtask.currentRunId = undefined;
    subtask.summary = run.summary ?? run.error ?? subtask.summary;
    subtask.blockedReason = run.error ?? run.summary ?? subtask.blockedReason;
    subtask.terminationReason = run.terminationReason ?? run.status;
  } else if (run.status === "waiting_for_user") {
    subtask.status = "blocked";
    subtask.finishedAt = undefined;
    subtask.currentRunId = undefined;
    subtask.summary = run.summary ?? subtask.summary;
    subtask.blockedReason = run.summary ?? run.error ?? "Child Studio member is waiting for user input.";
    subtask.terminationReason = run.terminationReason ?? "waiting_for_user";
  }
  refreshDerivedImplementation(plan, progress);
}

export function recordYpiStudioSubagentRun(cwd: string, taskIdOrKey: string, run: YpiStudioTaskSubagentRun): YpiStudioTaskDetail {
  const ctx = createContext(cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  if (record.archived) throw new Error("Archived tasks cannot record subagent runs");
  const updatedAt = nowIso();
  const previousRun = record.raw.subagents.find((existing) => existing.id === run.id);
  record.raw.subagents = [...record.raw.subagents.filter((existing) => existing.id !== run.id), run];
  if (run.improvementId) {
    // Improvement-instance scoped run: attribute to instance.runIds and update only the
    // scoped instance progress. The main task plan/progress and currentMember are never touched.
    if (record.raw.status !== "waiting_for_improvements") throw new Error(`Improvement-scoped run ${run.id} cannot be recorded while the main task status is ${record.raw.status}; expected waiting_for_improvements.`);
    const instance = record.raw.improvements?.instances.find((inst) => inst.id === run.improvementId);
    if (!instance) throw new Error(`Improvement not found for run ${run.id}: ${run.improvementId}`);
    instance.runIds = Array.from(new Set([...(instance.runIds ?? []), run.id]));
    // Apply run state to the scoped instance progress only; the helper no-ops when the
    // run carries no subtaskId or the subtaskId is not part of the instance plan.
    if (instance.implementationPlan && instance.implementationProgress) {
      applySubagentRunToImplementationProgress(instance.implementationPlan, instance.implementationProgress, run, updatedAt);
    }
    instance.updatedAt = updatedAt;
    record.raw.updatedAt = updatedAt;
    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, {
      type: "subagent",
      at: updatedAt,
      taskId: record.raw.id,
      member: run.member,
      message: run.summary ?? run.error ?? `${run.member} ${run.status}`,
      data: { runId: run.id, subtaskId: run.subtaskId, status: run.status, improvementId: run.improvementId, displayId: instance.displayId, transcript: run.transcript },
    });
  } else {
  if (run.subtaskId && record.raw.implementationPlan && record.raw.implementationProgress?.subtasks[run.subtaskId]) {
    assertTaskStatusForImplementationMutation(record.raw, run.status === "succeeded" ? "done" : run.status === "cancelled" ? "failed" : run.status === "waiting_for_user" ? "blocked" : run.status);
    const progress = record.raw.implementationProgress;
    const subtask = progress.subtasks[run.subtaskId];
    const previousStatus = subtask.status;
    const hadRunId = subtask.runIds.includes(run.id);
    subtask.runIds = Array.from(new Set([...subtask.runIds, run.id]));
    subtask.lastRunId = run.id;
    subtask.updatedAt = updatedAt;
    if (run.status === "queued") {
      subtask.status = "queued";
      subtask.queuedAt ??= updatedAt;
      subtask.finishedAt = undefined;
      subtask.currentRunId = run.id;
    } else if (run.status === "running") {
      subtask.status = "running";
      subtask.startedAt ??= updatedAt;
      subtask.finishedAt = undefined;
      subtask.currentRunId = run.id;
      if (previousStatus === "queued" || (previousStatus !== "running" && !hadRunId)) subtask.attempts = Math.max(1, subtask.attempts + 1);
      progress.activeSubtaskId = run.subtaskId;
    } else if (run.status === "succeeded") {
      subtask.status = "done";
      subtask.finishedAt = run.finishedAt ?? updatedAt;
      subtask.currentRunId = undefined;
      subtask.summary = run.summary ?? subtask.summary;
      subtask.terminationReason = run.terminationReason ?? subtask.terminationReason;
    } else if (run.status === "failed" || run.status === "cancelled") {
      subtask.status = "failed";
      subtask.finishedAt = run.finishedAt ?? updatedAt;
      subtask.currentRunId = undefined;
      subtask.summary = run.summary ?? run.error ?? subtask.summary;
      subtask.blockedReason = run.error ?? run.summary ?? subtask.blockedReason;
      subtask.terminationReason = run.terminationReason ?? run.status;
    } else if (run.status === "waiting_for_user") {
      subtask.status = "blocked";
      subtask.finishedAt = undefined;
      subtask.currentRunId = undefined;
      subtask.summary = run.summary ?? subtask.summary;
      subtask.blockedReason = run.summary ?? run.error ?? "Child Studio member is waiting for user input.";
      subtask.terminationReason = run.terminationReason ?? "waiting_for_user";
    }
    refreshDerivedImplementation(record.raw.implementationPlan, progress);
  }
  record.raw.updatedAt = updatedAt;
  record.raw.currentMember = run.member;
  writeTaskJson(record.dirPath, record.raw);
  const lifecycleChanged = !previousRun || previousRun.status !== run.status;
  if (lifecycleChanged) {
    appendTaskEvent(record.dirPath, {
      type: "subagent",
      at: updatedAt,
      taskId: record.raw.id,
      member: run.member,
      message: run.summary ?? run.error ?? `${run.member} ${run.status}`,
      data: { runId: run.id, subtaskId: run.subtaskId, status: run.status, transcript: run.transcript },
    });
  }
  }
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after subagent update");
  return detail;
  });
}

export function reconcileYpiStudioRuntimeLostSubagentRun(cwd: string, taskIdOrKey: string, runIdOrRun: string | YpiStudioTaskSubagentRun): YpiStudioTaskSubagentRun {
  const task = getYpiStudioTaskDetail(cwd, taskIdOrKey);
  if (!task) throw new Error("Task not found");
  const run = typeof runIdOrRun === "string" ? task.subagents.find((item) => item.id === runIdOrRun) : runIdOrRun;
  if (!run) throw new Error(`Studio subagent run not found: ${String(runIdOrRun)}`);
  if (getYpiStudioChildRun(run.id) || (run.status !== "running" && run.status !== "queued")) return run;
  const finishedAt = nowIso();
  const failedRun: YpiStudioTaskSubagentRun = {
    ...run,
    status: "failed",
    finishedAt,
    summary: run.summary ?? "Studio subagent runtime handle was lost before completion.",
    error: "Studio subagent runtime handle was lost before completion. Retry or handle manually.",
    terminationReason: "runtime_lost",
    progress: run.progress ? { ...run.progress, phase: "finished", updatedAt: finishedAt, terminationReason: "runtime_lost" } : run.progress,
    transcript: run.transcript ? { ...run.transcript, status: "failed", finishedAt, updatedAt: finishedAt } : run.transcript,
  };
  recordYpiStudioSubagentRun(cwd, task.id, failedRun);
  return failedRun;
}

export function getYpiStudioTaskContextForPrompt(cwd: string, taskIdOrKey: string): string {
  const detail = getYpiStudioTaskDetail(cwd, taskIdOrKey);
  if (!detail) return "No active YPI Studio task.";
  const workflow = readYpiStudioWorkflow(cwd, detail.workflowId);
  const docs = Object.values(detail.documents)
    .map((document) => `## ${document.fileName}\n\n${document.content}`)
    .join("\n\n---\n\n");
  return [
    "# YPI Studio Task Context",
    `Task: ${detail.id}`,
    `Title: ${detail.title}`,
    `Workflow: ${workflow?.name ?? detail.workflowId}`,
    `Status: ${detail.status} (${detail.progress.label})`,
    `Owner: ${detail.progress.owner}`,
    `Progress: ${detail.progress.percent}%`,
    `Required artifacts: ${detail.progress.requiredArtifacts.join(", ") || "none"}`,
    `Missing artifacts: ${detail.progress.missingArtifacts.join(", ") || "none"}`,
    "Plan approval book: plan-review.md is the required user-facing approval entry; it must summarize PRD/Design/Implement/Checks and link related artifacts before awaiting_approval.",
    detail.implementationPlan ? `Implementation plan: ${detail.implementation?.done ?? 0}/${detail.implementation?.total ?? detail.implementationPlan.subtasks.length} done; active=${detail.implementation?.activeSubtaskId ?? "none"}; next=${detail.implementation?.nextSubtaskId ?? "none"}; blocked=${detail.implementation?.blocked ?? 0}` : "Implementation plan: not defined",
    docs ? `\n${docs}` : "",
  ].filter(Boolean).join("\n");
}


export function updateYpiStudioImplementationPlan(taskIdOrKey: string, body: YpiStudioTaskImplementationPlanUpdateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  assertImplementationMutable(record);
  if (!record.raw) throw new Error("Task not found");
  if (!(["planning", "awaiting_approval", "changes_requested"] as string[]).includes(record.raw.status)) throw new Error("Implementation plan can only be updated while planning, awaiting_approval, or changes_requested.");
  const plan = normalizeImplementationPlan(body.implementationPlan);
  if (!plan) throw new Error("implementationPlan must contain at least one valid subtask with id and title");
  const updatedAt = nowIso();
  const normalizedPlan = { ...plan, updatedAt };
  record.raw.implementationPlan = normalizedPlan;
  record.raw.implementationProgress = rebuildImplementationProgress(normalizedPlan, record.raw.implementationProgress);
  if (record.raw.status === "awaiting_approval") {
    const revision = (record.raw.meta.planRevision ?? 1) + 1;
    record.raw.meta = { ...record.raw.meta, approvalGate: approvalGate(updatedAt, record.raw.status, body.contextId), approvalGrant: undefined, planRevision: revision };
  }
  record.raw.updatedAt = updatedAt;
  if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "note", at: updatedAt, taskId: record.raw.id, message: "Updated implementation plan", data: { subtaskCount: normalizedPlan.subtasks.length, contextId: body.contextId } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after implementation plan update");
  return detail;
  });
}

export function getNextYpiStudioImplementationSubtask(cwd: string, taskIdOrKey: string, options: { limit?: number; improvementId?: string } = {}): { task: YpiStudioTaskDetail; subtask: YpiStudioImplementationSubtaskPlan | null; subtasks: YpiStudioImplementationSubtaskPlan[]; summary?: YpiStudioImplementationSummary; improvementId?: string; instance?: { id: string; displayId: string; title: string; status: string } } {
  const task = getYpiStudioTaskDetail(cwd, taskIdOrKey);
  if (!task) throw new Error("Task not found");
  if (options.improvementId) {
    if (task.status !== "waiting_for_improvements") throw new Error(`Improvement subtasks can only be queried while the main task is waiting_for_improvements. Current status: ${task.status}`);
    const instance = task.improvements?.instances.find((inst) => inst.id === options.improvementId);
    if (!instance) throw new Error(`Improvement not found: ${options.improvementId}`);
    if (instance.status !== "implementing" && instance.status !== "checking") throw new Error(`Improvement ${instance.displayId} is not executable (status: ${instance.status}). It must be implementing or checking to query ready subtasks.`);
    if (!instance.implementationPlan || !instance.implementationProgress) throw new Error(`Improvement ${instance.displayId} has no implementation plan/progress.`);
    const subtasks = selectReadyYpiStudioImplementationSubtasks(instance.implementationPlan, instance.implementationProgress, options.limit);
    const summary = summarizeImplementation(instance.implementationPlan, instance.implementationProgress);
    return { task, subtask: subtasks[0] ?? null, subtasks, summary, improvementId: instance.id, instance: { id: instance.id, displayId: instance.displayId, title: instance.title, status: instance.status } };
  }
  const subtasks = selectReadyYpiStudioImplementationSubtasks(task.implementationPlan, task.implementationProgress, options.limit);
  return { task, subtask: subtasks[0] ?? null, subtasks, summary: task.implementation };
}

export function claimYpiStudioImplementationSubtask(taskIdOrKey: string, body: YpiStudioTaskImplementationSubtaskClaimBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  assertImplementationMutable(record);
  if (!record.raw) throw new Error("Task not found");
  if (record.raw.status !== "implementing") throw new Error("Cannot claim implementation subtasks until the main task is in implementing after user approval.");
  const plan = record.raw.implementationPlan;
  const progress = record.raw.implementationProgress;
  if (!plan || !progress) throw new Error("Task has no implementation plan to claim from.");
  refreshDerivedImplementation(plan, progress);
  const requestedIds = body.subtaskIds?.length ? body.subtaskIds : body.subtaskId ? [body.subtaskId] : undefined;
  const requestedRunIds = body.runIds ?? (body.runId ? [body.runId] : undefined);
  const targetStatus: YpiStudioImplementationSubtaskStatus = body.status === "queued" ? "queued" : "running";
  const limit = Math.max(1, Math.floor(body.limit ?? requestedIds?.length ?? 1));
  const candidates = requestedIds
    ? requestedIds.map((id) => plan.subtasks.find((subtask) => subtask.id === id) ?? null)
    : selectReadyYpiStudioImplementationSubtasks(plan, progress, limit);
  if (candidates.some((candidate) => !candidate)) throw new Error("One or more requested implementation subtasks do not exist.");
  const selected = candidates.filter((candidate): candidate is YpiStudioImplementationSubtaskPlan => !!candidate).slice(0, limit);
  if (!selected.length) throw new Error("No ready implementation subtask is available. Check dependencies, blocked subtasks, or running active subtask.");
  if (selected.length > concurrencySlotsAvailable(plan, progress)) throw new Error("Requested implementation subtasks exceed available concurrency slots.");
  for (const candidate of selected) {
    const item = progress.subtasks[candidate.id];
    if (!item || item.status !== "ready") throw new Error(`Subtask ${candidate.id} is not ready or no concurrency slot is available`);
    if (!candidate.dependsOn.every((dep) => dependencySatisfiedForPlan(plan, progress, dep))) throw new Error(`Subtask ${candidate.id} has unfinished dependencies`);
  }
  const updatedAt = nowIso();
  const claimedIds: string[] = [];
  selected.forEach((candidate, index) => {
    const item = progress.subtasks[candidate.id];
    const from = item.status;
    const runId = requestedRunIds?.[index] ?? (selected.length === 1 ? body.runId : undefined);
    item.status = targetStatus;
    item.finishedAt = undefined;
    item.updatedAt = updatedAt;
    item.claimedAt = updatedAt;
    item.claimedByContextId = body.contextId;
    if (targetStatus === "running") {
      item.startedAt = updatedAt;
      item.attempts += 1;
      progress.activeSubtaskId = candidate.id;
    } else {
      item.queuedAt = updatedAt;
    }
    if (runId) {
      item.runIds = Array.from(new Set([...item.runIds, runId]));
      item.lastRunId = runId;
      item.currentRunId = runId;
    }
    progress.history = [...(progress.history ?? []), { at: updatedAt, subtaskId: candidate.id, from, to: targetStatus, runId, message: body.message }].slice(-200);
    claimedIds.push(candidate.id);
  });
  refreshDerivedImplementation(plan, progress);
  record.raw.updatedAt = updatedAt;
  if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "note", at: updatedAt, taskId: record.raw.id, message: body.message ?? `Claimed implementation subtasks ${claimedIds.join(", ")}`, data: { subtaskIds: claimedIds, status: targetStatus, runIds: requestedRunIds } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after claim");
  return detail;
  });
}

/** Scoped claim for an improvement instance DAG. Resolves subtasks against
 *  `instance.implementationPlan` / `instance.implementationProgress` only; the main task
 *  plan/progress are never read or mutated. Requires `improvementId` and that the main task
 *  is `waiting_for_improvements` with the instance in `implementing | checking`. */
export function claimYpiStudioImprovementSubtask(taskIdOrKey: string, body: YpiStudioImprovementSubtaskClaimBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  const instance = resolveImprovementInstanceForExecution(record, body.improvementId);
  const plan = instance.implementationPlan!;
  const progress = instance.implementationProgress!;
  refreshDerivedImplementation(plan, progress);
  const requestedIds = body.subtaskIds?.length ? body.subtaskIds : body.subtaskId ? [body.subtaskId] : undefined;
  const requestedRunIds = body.runIds ?? (body.runId ? [body.runId] : undefined);
  const targetStatus: YpiStudioImplementationSubtaskStatus = body.status === "queued" ? "queued" : "running";
  const limit = Math.max(1, Math.floor(body.limit ?? requestedIds?.length ?? 1));
  const candidates = requestedIds
    ? requestedIds.map((id) => plan.subtasks.find((subtask) => subtask.id === id) ?? null)
    : selectReadyYpiStudioImplementationSubtasks(plan, progress, limit);
  if (candidates.some((candidate) => !candidate)) throw new Error("One or more requested improvement subtasks do not exist in the instance plan.");
  const selected = candidates.filter((candidate): candidate is YpiStudioImplementationSubtaskPlan => !!candidate).slice(0, limit);
  if (!selected.length) throw new Error("No ready improvement subtask is available. Check dependencies, blocked subtasks, or running active subtask.");
  if (selected.length > concurrencySlotsAvailable(plan, progress)) throw new Error("Requested improvement subtasks exceed available concurrency slots.");
  for (const candidate of selected) {
    const item = progress.subtasks[candidate.id];
    if (!item || item.status !== "ready") throw new Error(`Improvement subtask ${candidate.id} is not ready or no concurrency slot is available`);
    if (!candidate.dependsOn.every((dep) => dependencySatisfiedForPlan(plan, progress, dep))) throw new Error(`Improvement subtask ${candidate.id} has unfinished dependencies`);
  }
  const updatedAt = nowIso();
  const claimedIds: string[] = [];
  selected.forEach((candidate, index) => {
    const item = progress.subtasks[candidate.id];
    const from = item.status;
    const runId = requestedRunIds?.[index] ?? (selected.length === 1 ? body.runId : undefined);
    item.status = targetStatus;
    item.finishedAt = undefined;
    item.updatedAt = updatedAt;
    item.claimedAt = updatedAt;
    item.claimedByContextId = body.contextId;
    if (targetStatus === "running") {
      item.startedAt = updatedAt;
      item.attempts += 1;
      progress.activeSubtaskId = candidate.id;
    } else {
      item.queuedAt = updatedAt;
    }
    if (runId) {
      item.runIds = Array.from(new Set([...item.runIds, runId]));
      item.lastRunId = runId;
      item.currentRunId = runId;
    }
    progress.history = [...(progress.history ?? []), { at: updatedAt, subtaskId: candidate.id, from, to: targetStatus, runId, message: body.message }].slice(-200);
    claimedIds.push(candidate.id);
  });
  refreshDerivedImplementation(plan, progress);
  instance.implementationProgress = progress;
  instance.updatedAt = updatedAt;
  record.raw.updatedAt = updatedAt;
  if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "note", at: updatedAt, taskId: record.raw.id, message: body.message ?? `Claimed improvement ${instance.displayId} subtasks ${claimedIds.join(", ")}`, data: { improvementId: instance.id, displayId: instance.displayId, subtaskIds: claimedIds, status: targetStatus, runIds: requestedRunIds } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after improvement claim");
  return detail;
  });
}

export function updateYpiStudioImplementationSubtask(taskIdOrKey: string, body: YpiStudioTaskImplementationSubtaskUpdateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  return withTaskMutationLock(ctx, taskIdOrKey, () => {
  const record = loadTaskRecord(ctx, taskIdOrKey);
  assertImplementationMutable(record);
  if (!record.raw) throw new Error("Task not found");
  assertTaskStatusForImplementationMutation(record.raw, body.status);
  const plan = record.raw.implementationPlan;
  const progress = record.raw.implementationProgress;
  if (!plan || !progress) throw new Error("Task has no implementation plan.");
  const item = progress.subtasks[body.subtaskId];
  if (!item) throw new Error(`Unknown implementation subtask: ${body.subtaskId}`);
  const from = item.status;
  const updatedAt = nowIso();
  item.status = body.status;
  item.updatedAt = updatedAt;
  if (body.status === "queued") {
    item.queuedAt = updatedAt;
    item.finishedAt = undefined;
  }
  if (body.status === "running") {
    item.startedAt = updatedAt;
    item.finishedAt = undefined;
    item.attempts += 1;
    progress.activeSubtaskId = body.subtaskId;
  }
  if (body.status === "done" || body.status === "skipped" || body.status === "blocked" || body.status === "failed") item.finishedAt = body.status === "blocked" ? undefined : updatedAt;
  if (body.status === "ready") {
    item.finishedAt = undefined;
    item.blockedBy = undefined;
    item.blockedReason = undefined;
    item.skippedReason = undefined;
    item.terminationReason = undefined;
    item.currentRunId = undefined;
    item.queuedAt = undefined;
    item.claimedAt = undefined;
    item.claimedByContextId = undefined;
  }
  if (body.runId) {
    item.runIds = Array.from(new Set([...item.runIds, body.runId]));
    item.lastRunId = body.runId;
    item.currentRunId = body.runId;
  }
  item.summary = body.message ?? item.summary;
  item.validation = body.validation ?? item.validation;
  item.blockedBy = body.blockedBy ?? item.blockedBy;
  item.blockedReason = body.blockedReason ?? (body.status === "blocked" ? body.message ?? item.blockedReason : item.blockedReason);
  item.skippedReason = body.skippedReason ?? (body.status === "skipped" ? body.message ?? item.skippedReason : item.skippedReason);
  item.terminationReason = body.terminationReason ?? item.terminationReason;
  if (body.localReview) {
    const previous = item.localReview ?? {};
    item.localReview = {
      status: body.localReview.status ?? previous.status,
      runIds: body.localReview.runId ? Array.from(new Set([...(previous.runIds ?? []), body.localReview.runId])) : previous.runIds,
      summary: body.localReview.summary ?? previous.summary,
      updatedAt,
    };
  }
  progress.history = [...(progress.history ?? []), { at: updatedAt, subtaskId: body.subtaskId, from, to: body.status, runId: body.runId, message: body.message }].slice(-200);
  refreshDerivedImplementation(plan, progress);
  record.raw.updatedAt = updatedAt;
  if (body.contextId) assertTaskBoundToContext(record.raw, body.contextId);
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "note", at: updatedAt, taskId: record.raw.id, message: body.message ?? `Implementation subtask ${body.subtaskId} -> ${body.status}`, data: { subtaskId: body.subtaskId, from, to: body.status, runId: body.runId, validation: body.validation, localReview: body.localReview } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after subtask update");
  return detail;
  });
}

export function isYpiStudioTaskCreateBody(value: unknown): value is YpiStudioTaskCreateBody {
  return isRecord(value) && typeof value.cwd === "string" && typeof value.title === "string" && value.title.trim().length > 0;
}

export function isYpiStudioTaskTransitionBody(value: unknown): value is YpiStudioTaskTransitionBody {
  return isRecord(value) && typeof value.cwd === "string" && typeof value.to === "string" && value.to.trim().length > 0;
}

export function isYpiStudioTaskArtifactUpdateBody(value: unknown): value is YpiStudioTaskArtifactUpdateBody {
  return isRecord(value) && typeof value.cwd === "string" && typeof value.artifact === "string" && typeof value.content === "string";
}

export function isYpiStudioTaskImplementationPlanUpdateBody(value: unknown): value is YpiStudioTaskImplementationPlanUpdateBody {
  return isRecord(value) && value.action === "update_implementation_plan" && typeof value.cwd === "string" && isRecord(value.implementationPlan);
}

export function isYpiStudioTaskImplementationSubtaskClaimBody(value: unknown): value is YpiStudioTaskImplementationSubtaskClaimBody {
  return isRecord(value) && value.action === "claim_implementation_subtask" && typeof value.cwd === "string"
    && (value.subtaskId === undefined || typeof value.subtaskId === "string")
    && (value.subtaskIds === undefined || (Array.isArray(value.subtaskIds) && value.subtaskIds.every((item) => typeof item === "string")))
    && (value.limit === undefined || (typeof value.limit === "number" && Number.isFinite(value.limit)))
    && (value.runId === undefined || typeof value.runId === "string")
    && (value.runIds === undefined || (Array.isArray(value.runIds) && value.runIds.every((item) => typeof item === "string")))
    && (value.status === undefined || value.status === "queued" || value.status === "running")
    && (value.message === undefined || typeof value.message === "string")
    && (value.contextId === undefined || typeof value.contextId === "string");
}

export function isYpiStudioImprovementSubtaskClaimBody(value: unknown): value is YpiStudioImprovementSubtaskClaimBody {
  return isRecord(value) && value.action === "claim_improvement_subtask" && typeof value.cwd === "string"
    && typeof value.improvementId === "string"
    && (value.subtaskId === undefined || typeof value.subtaskId === "string")
    && (value.subtaskIds === undefined || (Array.isArray(value.subtaskIds) && value.subtaskIds.every((item) => typeof item === "string")))
    && (value.limit === undefined || (typeof value.limit === "number" && Number.isFinite(value.limit)))
    && (value.runId === undefined || typeof value.runId === "string")
    && (value.runIds === undefined || (Array.isArray(value.runIds) && value.runIds.every((item) => typeof item === "string")))
    && (value.status === undefined || value.status === "queued" || value.status === "running")
    && (value.message === undefined || typeof value.message === "string")
    && (value.contextId === undefined || typeof value.contextId === "string");
}

export function isYpiStudioTaskImplementationSubtaskUpdateBody(value: unknown): value is YpiStudioTaskImplementationSubtaskUpdateBody {
  return isRecord(value) && value.action === "update_implementation_subtask" && typeof value.cwd === "string"
    && typeof value.subtaskId === "string" && isImplementationStatus(value.status)
    && (value.runId === undefined || typeof value.runId === "string")
    && (value.message === undefined || typeof value.message === "string")
    && (value.validation === undefined || (Array.isArray(value.validation) && value.validation.every((item) => typeof item === "string")))
    && (value.blockedBy === undefined || (Array.isArray(value.blockedBy) && value.blockedBy.every((item) => typeof item === "string")))
    && (value.blockedReason === undefined || typeof value.blockedReason === "string")
    && (value.skippedReason === undefined || typeof value.skippedReason === "string")
    && (value.terminationReason === undefined || typeof value.terminationReason === "string")
    && (value.contextId === undefined || typeof value.contextId === "string");
}

export function isYpiStudioTaskArchiveBody(value: unknown): value is YpiStudioTaskArchiveBody & { action: "archive" } {
  return isRecord(value)
    && value.action === "archive"
    && typeof value.cwd === "string"
    && (value.reason === undefined || typeof value.reason === "string")
    && (value.contextId === undefined || typeof value.contextId === "string")
    && (value.knowledgeSummary === undefined || typeof value.knowledgeSummary === "string")
    && (value.knowledgeMarkdown === undefined || typeof value.knowledgeMarkdown === "string")
    && (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string")))
    && (value.allowFallbackKnowledge === undefined || typeof value.allowFallbackKnowledge === "boolean");
}

export function isYpiStudioImprovementCreateBody(value: unknown): value is YpiStudioImprovementCreateBody {
  return isRecord(value)
    && value.action === "create_improvement"
    && typeof value.cwd === "string"
    && typeof value.title === "string" && value.title.trim().length > 0
    && typeof value.feedback === "string"
    && (value.contextId === undefined || typeof value.contextId === "string")
    && (value.owner === undefined || typeof value.owner === "string");
}

export function isYpiStudioImprovementTransitionBody(value: unknown): value is YpiStudioImprovementTransitionBody {
  return isRecord(value)
    && value.action === "transition_improvement"
    && typeof value.cwd === "string"
    && typeof value.improvementId === "string"
    && typeof value.to === "string"
    && (value.contextId === undefined || typeof value.contextId === "string")
    && (value.reason === undefined || typeof value.reason === "string");
}

export function isYpiStudioImprovementDispositionBody(value: unknown): value is YpiStudioImprovementDispositionBody {
  return isRecord(value)
    && value.action === "resolve_improvement_disposition"
    && typeof value.cwd === "string"
    && typeof value.improvementId === "string"
    && (value.disposition === "accepted" || value.disposition === "cancelled" || value.disposition === "failed" || value.disposition === "accepted_not_doing")
    && (value.reason === undefined || typeof value.reason === "string")
    && (value.contextId === undefined || typeof value.contextId === "string");
}

export function isYpiStudioImprovementArtifactUpdateBody(value: unknown): value is YpiStudioImprovementArtifactUpdateBody {
  return isRecord(value)
    && typeof value.cwd === "string"
    && typeof value.artifact === "string"
    && typeof value.content === "string"
    && typeof value.improvementId === "string"
    && (value.contextId === undefined || typeof value.contextId === "string");
}

export function isYpiStudioImprovementPlanUpdateBody(value: unknown): value is YpiStudioImprovementPlanUpdateBody {
  return isRecord(value)
    && value.action === "update_improvement_plan"
    && typeof value.cwd === "string"
    && typeof value.improvementId === "string"
    && (value.implementationPlan === undefined || isRecord(value.implementationPlan))
    && (value.override === undefined || typeof value.override === "boolean")
    && (value.contextId === undefined || typeof value.contextId === "string");
}

export function isYpiStudioImprovementApprovalBody(value: unknown): value is { cwd: string; action: "record_improvement_approval"; improvementId: string; contextId: string; inputText: string } {
  return isRecord(value)
    && value.action === "record_improvement_approval"
    && typeof value.cwd === "string"
    && typeof value.improvementId === "string"
    && typeof value.contextId === "string"
    && typeof value.inputText === "string";
}

export function isYpiStudioImprovementRevisionBody(value: unknown): value is YpiStudioImprovementPlanUpdateBody & { artifactUpdates?: Record<string, string> } {
  return isRecord(value)
    && value.action === "revise_improvement_plan"
    && typeof value.cwd === "string"
    && typeof value.improvementId === "string"
    && (value.implementationPlan === undefined || isRecord(value.implementationPlan))
    && (value.artifactUpdates === undefined || (isRecord(value.artifactUpdates) && Object.values(value.artifactUpdates).every((v) => typeof v === "string")))
    && (value.contextId === undefined || typeof value.contextId === "string");
}
