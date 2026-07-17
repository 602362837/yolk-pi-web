import { createHash } from "crypto";
import type { SessionEntry, AgentMessage, ToolResultMessage, AssistantMessage, ToolCallContent } from "./types";
import {
  getYpiStudioTaskDetail,
  getYpiStudioTaskIdForContext,
  implementationCounts,
  listYpiStudioTaskHtmlPrototypeFileNames,
  listYpiStudioTasks,
  ypiStudioTaskPlanReviewFileExists,
} from "./ypi-studio-tasks";
import { readYpiStudioSubagentTranscriptPreview } from "./ypi-studio-transcripts";
import { getYpiStudioChildRun } from "./ypi-studio-subagent-runtime";
import { orderYpiStudioWorkflowStates } from "./ypi-studio-workflow-flow";
import { readYpiStudioWorkflow } from "./ypi-studio-workflows";
import type {
  YpiStudioSessionTaskLinkCandidate,
  YpiStudioSessionTaskLinkSource,
  YpiStudioSessionTasksLinkResult,
  YpiStudioTaskDetail,
  YpiStudioTaskSummary,
  YpiStudioTaskWidgetProjection,
  YpiStudioWidgetQuickPreview,
  YpiStudioWidgetQuickPreviewApprovalState,
  YpiStudioWidgetUserAction,
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

function resolveRuntimeTaskId(cwd: string, sessionId: string, sessionFilePath: string): string | null {
  for (const key of exactRuntimeKeys(sessionId, sessionFilePath)) {
    const candidate = getYpiStudioTaskIdForContext(cwd, key);
    if (candidate) return candidate;
  }
  return null;
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
  if (toolName === "ypi_studio_task" || toolName === "ypi_studio_subagent" || toolName === "ypi_studio_wait") return;
}

function collectTranscriptEvidence(entries: SessionEntry[], cwd: string): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  entries.forEach((entry, order) => {
    if (entry.type !== "message") return;
    const message = entry.message;
    if (message.role === "toolResult") {
      if (message.toolName === "ypi_studio_task" || message.toolName === "ypi_studio_subagent" || message.toolName === "ypi_studio_wait") {
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
    const handle = getYpiStudioChildRun(run.id);
    const progress = handle?.progress ?? run.progress;
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
      status: normalizeRunStatus(handle?.status === "runtime_lost" ? run.status : handle?.status ?? run.status),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: clip(run.summary),
      error: clip(run.error),
      model: run.model,
      thinking: run.thinking,
      modelSource: run.modelSource,
      thinkingSource: run.thinkingSource,
      phase: progress?.phase,
      tokens: progress?.tokens,
      tps: progress?.tps,
      currentTool: progress?.currentTool,
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

function widgetArtifactEvidence(detail: YpiStudioTaskDetail): Pick<YpiStudioTaskWidgetProjection["artifacts"], "available" | "completed"> {
  // `progress.completedArtifacts` intentionally describes only the current workflow
  // state. The task drawer, however, lists the complete task artifact registry.
  // Keep the compact widget on that same evidence set so an implementing task does
  // not appear to have only its current state's handoff artifact.
  const available = Object.keys(detail.documents);
  const artifactKeyFor = (value: string) => detail.documents[value]
    ? value
    : Object.entries(detail.artifacts).find(([, fileName]) => fileName === value)?.[0] ?? value;
  const completed = new Set(detail.progress.completedArtifacts.map(artifactKeyFor));
  for (const [artifact, document] of Object.entries(detail.documents)) {
    const content = document.content.trim();
    if (content.length > 0 && !/\bTBD\b|待填写|YPI Studio workflow/i.test(content)) completed.add(artifact);
  }
  return { available, completed: [...completed] };
}

/**
 * Map main-task approval evidence to a quick-preview tone.
 * Uses only current meta.approvalGrant / planRevision — never "opened" or file existence.
 * After a successful grant, the grant remains while status leaves awaiting_approval (approved).
 * When grant is cleared and planRevision advanced, treat as revision_changed unless still pending first review.
 */
function mainPlanApprovalState(detail: YpiStudioTaskDetail): YpiStudioWidgetQuickPreviewApprovalState {
  if (detail.archived) return "readonly";
  if (detail.meta.approvalGrant) return "approved";
  const revision = typeof detail.meta.planRevision === "number" ? detail.meta.planRevision : undefined;
  if (revision !== undefined && revision >= 2) return "revision_changed";
  return "pending";
}

/** Map improvement instance approval evidence to a quick-preview tone. */
function improvementPlanApprovalState(
  detail: YpiStudioTaskDetail,
  instance: NonNullable<YpiStudioTaskDetail["improvements"]>["instances"][number],
): YpiStudioWidgetQuickPreviewApprovalState {
  if (detail.archived) return "readonly";
  if (instance.approval?.approvedAt) return "approved";
  const revision = typeof instance.approval?.revision === "number" ? instance.approval.revision : undefined;
  if (revision !== undefined && revision >= 2) return "revision_changed";
  return "pending";
}

/**
 * Build additive, filename-only quick-preview descriptors from the full artifact registry
 * and improvement mappings. Presence does NOT depend on awaiting_approval / waiting_plan_approval.
 * Never reads or returns Markdown/HTML bodies.
 */
function buildWidgetQuickPreviews(cwd: string, detail: YpiStudioTaskDetail): YpiStudioWidgetQuickPreview[] {
  const previews: YpiStudioWidgetQuickPreview[] = [];
  const mainApproval = mainPlanApprovalState(detail);

  // Main plan-review: registry mapping or on-disk plan-review.md (archived included).
  const mainPlanFile =
    (typeof detail.artifacts["plan-review"] === "string" && detail.artifacts["plan-review"].trim()
      ? detail.artifacts["plan-review"].trim()
      : undefined)
    ?? (ypiStudioTaskPlanReviewFileExists(cwd, detail.key) ? "plan-review.md" : undefined);
  if (mainPlanFile) {
    previews.push({
      kind: "plan-review",
      fileName: mainPlanFile,
      label: "计划审批书",
      approvalState: mainApproval,
    });
  }

  // Main-task HTML prototypes (task root only).
  for (const fileName of listYpiStudioTaskHtmlPrototypeFileNames(cwd, detail.key)) {
    previews.push({
      kind: "prototype",
      fileName,
      label: "HTML 原型",
      approvalState: mainApproval,
    });
  }

  for (const instance of detail.improvements?.instances ?? []) {
    const displayId = instance.displayId || instance.id;
    const approval = improvementPlanApprovalState(detail, instance);
    const planFile =
      (typeof instance.artifacts?.["plan-review"] === "string" && instance.artifacts["plan-review"].trim()
        ? instance.artifacts["plan-review"].trim()
        : undefined)
      ?? (ypiStudioTaskPlanReviewFileExists(cwd, detail.key, { improvementId: instance.id }) ? "plan-review.md" : undefined);
    if (planFile) {
      previews.push({
        kind: "improvement-plan",
        fileName: planFile,
        label: `改进计划 · ${displayId}`,
        approvalState: approval,
        improvementId: instance.id,
        displayId,
      });
    }
    for (const fileName of listYpiStudioTaskHtmlPrototypeFileNames(cwd, detail.key, { improvementId: instance.id })) {
      previews.push({
        kind: "prototype",
        fileName,
        label: `HTML 原型 · ${displayId}`,
        approvalState: approval,
        improvementId: instance.id,
        displayId,
      });
    }
  }

  return previews;
}

/**
 * Convenience gate for main-task result acceptance in the session widget.
 * Server transition gates (unresolved improvements, archive, requiresUserApproval, binding) remain authoritative.
 * Does not treat review_ready / review as completable.
 */
export function canAcceptMainTask(input: {
  status: string;
  archived?: boolean;
  unresolvedImprovementCount: number;
}): boolean {
  return !input.archived
    && input.status === "user_acceptance"
    && input.unresolvedImprovementCount === 0;
}

/** Max decision CTAs projected per task card (one primary + one secondary). */
const WIDGET_USER_ACTIONS_MAX = 2;

/** Bound display copy so descriptors stay sparse and never carry long free text. */
function boundWidgetTargetLabel(value: string, max = 120): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Project sparse, allowlisted Phase 1 decision CTAs for the session widget.
 * Visibility is advisory only; write paths revalidate binding/status/revision/material gates.
 * Never emits endpoints, PATCH bodies, artifact content, feedback, or paths.
 */
export function buildWidgetUserActions(detail: {
  status: string;
  archived?: boolean;
  title: string;
  meta?: { planRevision?: number } | null;
  improvements?: {
    instances?: Array<{
      id: string;
      displayId?: string;
      title?: string;
      status: string;
      approval?: { revision?: number } | null;
    }>;
  } | null;
}): YpiStudioWidgetUserAction[] {
  if (detail.archived) return [];

  if (detail.status === "awaiting_approval") {
    const revision = typeof detail.meta?.planRevision === "number" && Number.isFinite(detail.meta.planRevision)
      ? detail.meta.planRevision
      : 1;
    const targetLabel = boundWidgetTargetLabel(`${detail.title} · Revision ${revision}`);
    const actions: YpiStudioWidgetUserAction[] = [
      {
        id: `main:approve:r${revision}`,
        kind: "approve_plan",
        label: "批准并开始实现",
        role: "primary",
        requiresConfirmation: true,
        expectedRevision: revision,
        targetLabel,
      },
      {
        id: `main:request_changes:r${revision}`,
        kind: "request_plan_changes",
        label: "需要修改",
        role: "secondary",
        requiresConfirmation: true,
        expectedRevision: revision,
        targetLabel,
      },
    ];
    return actions.slice(0, WIDGET_USER_ACTIONS_MAX);
  }

  if (detail.status === "waiting_for_improvements") {
    const firstWaitingPlan = (detail.improvements?.instances ?? []).find(
      (instance) => instance.status === "waiting_plan_approval",
    );
    if (!firstWaitingPlan?.id) return [];

    const revision = typeof firstWaitingPlan.approval?.revision === "number"
      && Number.isFinite(firstWaitingPlan.approval.revision)
      ? firstWaitingPlan.approval.revision
      : 1;
    const displayId = (firstWaitingPlan.displayId || firstWaitingPlan.id).trim() || firstWaitingPlan.id;
    const title = (firstWaitingPlan.title || displayId).trim() || displayId;
    return [{
      id: `improvement:${firstWaitingPlan.id}:approve:r${revision}`,
      kind: "approve_improvement_plan",
      label: "批准该改进计划",
      role: "primary",
      requiresConfirmation: true,
      expectedRevision: revision,
      improvementId: firstWaitingPlan.id,
      displayId,
      targetLabel: boundWidgetTargetLabel(`${displayId} · ${title} · Revision ${revision}`),
    }];
  }

  // Enter existing user_acceptance from clean review only. Advisory; write path rechecks.
  // Do not project on parentStatus alone (e.g. review_ready while still waiting_for_improvements).
  if (detail.status === "review") {
    const unresolvedCount = (detail.improvements?.instances ?? []).filter(
      (instance) => !["accepted", "accepted_not_doing"].includes(instance.status),
    ).length;
    if (unresolvedCount > 0) return [];

    const revision = typeof detail.meta?.planRevision === "number" && Number.isFinite(detail.meta.planRevision)
      ? detail.meta.planRevision
      : 1;
    return [{
      id: `main:start_user_acceptance:r${revision}`,
      kind: "start_user_acceptance",
      label: "开始用户验收",
      role: "primary",
      requiresConfirmation: true,
      expectedRevision: revision,
      targetLabel: boundWidgetTargetLabel(`主任务 · ${detail.title}`),
    }];
  }

  return [];
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
  const improvementSummary = detail.improvements?.instances?.length ? (() => {
    const instances = detail.improvements!.instances;
    const unresolved = instances.filter((inst) =>
      !["accepted", "accepted_not_doing"].includes(inst.status)
    );
    const firstUnresolved = unresolved[0];
    const blocker = firstUnresolved
      ? firstUnresolved.status === "waiting_plan_approval"
        ? `${firstUnresolved.displayId} 等待计划批准`
        : firstUnresolved.status === "waiting_clarification"
          ? `${firstUnresolved.displayId} 等待澄清`
          : firstUnresolved.status === "cancelled" || firstUnresolved.status === "failed"
            ? `${firstUnresolved.displayId} ${firstUnresolved.status === "cancelled" ? "已取消" : "失败"}，等待"接受不处理"`
            : `${firstUnresolved.displayId} ${firstUnresolved.status}`
      : undefined;
    const nextAction = firstUnresolved
      ? firstUnresolved.status === "analysis" || firstUnresolved.status === "waiting_clarification"
        ? "在绑定聊天中派发改进师"
        : firstUnresolved.status === "waiting_plan_approval"
          ? `在绑定聊天中批准 ${firstUnresolved.displayId} 的计划`
          : firstUnresolved.status === "implementing" || firstUnresolved.status === "checking"
            ? "等待子成员完成"
            : firstUnresolved.status === "waiting_user_acceptance"
              ? `请验收 ${firstUnresolved.displayId}`
              : firstUnresolved.status === "cancelled" || firstUnresolved.status === "failed"
                ? `在聊天中说明是否接受不处理 ${firstUnresolved.displayId}`
                : "复核改进状态"
      : "复核全部改进并再次验收主任务";
    return {
      parentStatus: detail.improvements!.parentStatus,
      total: instances.length,
      unresolved: unresolved.length,
      blocker,
      nextAction,
      instances: instances.map((inst) => ({
        id: inst.id,
        displayId: inst.displayId,
        title: inst.title,
        status: inst.status,
        owner: inst.owner,
        updatedAt: inst.updatedAt,
        // Server status remains authoritative; canAccept is a convenience flag for UI.
        canAccept: !detail.archived && inst.status === "waiting_user_acceptance" ? true : undefined,
      })),
    };
  })() : undefined;

  const quickPreviews = buildWidgetQuickPreviews(cwd, detail);
  const userActions = buildWidgetUserActions(detail);
  const unresolvedImprovementCount = improvementSummary?.unresolved ?? 0;
  // Omit false so older clients and sparse JSON stay quiet; UI checks === true.
  const canAcceptMain = canAcceptMainTask({
    status: detail.status,
    archived: detail.archived,
    unresolvedImprovementCount,
  }) ? true : undefined;

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
    canAcceptMain,
    artifacts: {
      required: detail.progress.requiredArtifacts,
      optional: detail.progress.optionalArtifacts,
      ...widgetArtifactEvidence(detail),
      missing: detail.progress.missingArtifacts,
    },
    quickPreviews: quickPreviews.length > 0 ? quickPreviews : undefined,
    // Sparse additive field: omit when empty so older clients stay quiet.
    userActions: userActions.length > 0 ? userActions : undefined,
    steps,
    subagents: buildSubagents(cwd, detail),
    events: detail.events.slice(-5).reverse().map((event) => ({ type: event.type, at: event.at, message: event.message, from: event.from, to: event.to, member: event.member, artifact: event.artifact })),
    implementation: detail.implementation,
    implementationProjection: buildWidgetImplementationProjection(detail),
    improvements: improvementSummary,
  };
}

/** Priority for sorting bound candidates: lower number = higher priority. */
const STATUS_SORT_PRIORITY: Record<string, number> = {
  needs_user: 0,
  blocked: 1,
  failed: 1,
  implementing: 2,
  checking: 2,
  awaiting_approval: 3,
  changes_requested: 3,
  planning: 4,
  intake: 5,
  ready: 6,
  completed: 7,
  archived: 8,
  cancelled: 8,
};

function candidateSortKey(summary: YpiStudioTaskSummary, isRuntimeCurrent: boolean): number {
  const statusPri = STATUS_SORT_PRIORITY[summary.status] ?? 6;
  const runtimeBonus = isRuntimeCurrent ? 0 : 1;
  const archivedPenalty = summary.archived ? 200 : 0;
  return statusPri * 10 + runtimeBonus + archivedPenalty;
}

function buildCandidate(
  cwd: string,
  summary: YpiStudioTaskSummary,
  isCurrent: boolean,
  isPrimary: boolean,
  lastEvidenceOrder?: number,
): YpiStudioSessionTaskLinkCandidate | null {
  const projection = buildProjection(cwd, summary);
  if (!projection) return null;
  const sources: YpiStudioSessionTaskLinkSource[] = ["task-context"];
  if (isCurrent) sources.push("session-runtime");
  return {
    task: projection,
    sources,
    confidence: "high",
    relationship: "bound-context",
    current: isCurrent,
    primary: isPrimary,
    lastEvidenceOrder,
  };
}

export function resolveYpiStudioTaskForSession(options: ResolveOptions): YpiStudioSessionTasksLinkResult {
  const tasksResponse = listYpiStudioTasks(options.cwd, { scope: "all" });
  const index = buildTaskIndex(tasksResponse.tasks);
  const exactKeys = new Set(exactRuntimeKeys(options.sessionId, options.sessionFilePath));

  // 1. Find all bound candidates: tasks whose contextIds contain an exact session context key.
  const boundSummaries: YpiStudioTaskSummary[] = [];
  for (const task of index.tasks) {
    if (task.contextIds.some((cid) => exactKeys.has(cid) && !cid.startsWith("pi_process_"))) {
      boundSummaries.push(task);
    }
  }

  // 2. Runtime pointer evidence — only marks bound tasks as current.
  const runtimeTaskId = resolveRuntimeTaskId(options.cwd, options.sessionId, options.sessionFilePath);
  const runtimeCurrentSummary = runtimeTaskId
    ? boundSummaries.find((t) => t.key === runtimeTaskId || t.id === runtimeTaskId) ?? null
    : null;

  // 3. Transcript evidence — for diagnostics and lastEvidenceOrder only.
  const scopedEntries = branchEntries(options.entries, options.leafId);
  const transcriptEvidence = collectTranscriptEvidence(scopedEntries, options.cwd);
  const transcriptObservedKeys: string[] = [];
  const transcriptOrderByKey = new Map<string, number>();
  for (const ev of transcriptEvidence) {
    const matched = matchCandidate(ev.candidate, index);
    if (matched && matched !== "ambiguous") {
      if (!transcriptObservedKeys.includes(matched.key)) {
        transcriptObservedKeys.push(matched.key);
      }
      const existingOrder = transcriptOrderByKey.get(matched.key);
      if (existingOrder === undefined || ev.order > existingOrder) {
        transcriptOrderByKey.set(matched.key, ev.order);
      }
    }
  }

  // 4. Build diagnostics.
  const diagnostics: YpiStudioSessionTasksLinkResult["diagnostics"] = {};
  const runtimeUnboundTaskKey =
    runtimeTaskId && !boundSummaries.some((t) => t.key === runtimeTaskId || t.id === runtimeTaskId)
      ? runtimeTaskId
      : undefined;
  const observedUnboundTaskKeys = transcriptObservedKeys.filter(
    (key) => !boundSummaries.some((t) => t.key === key),
  );
  if (observedUnboundTaskKeys.length > 0) diagnostics.observedUnboundTaskKeys = observedUnboundTaskKeys;
  if (runtimeUnboundTaskKey) diagnostics.runtimeUnboundTaskKey = runtimeUnboundTaskKey;
  if (transcriptObservedKeys.length > 0) diagnostics.transcriptObservedTaskKeys = transcriptObservedKeys;

  // 5. No bound candidates.
  if (boundSummaries.length === 0) {
    const result: YpiStudioSessionTasksLinkResult = {
      task: null,
      tasks: [],
      reason: tasksResponse.exists ? (tasksResponse.tasks.length > 0 ? "task-not-found" : "no-evidence") : "no-evidence",
    };
    if (Object.keys(diagnostics).length > 0) result.diagnostics = diagnostics;
    const warnings: string[] = [];
    if (runtimeUnboundTaskKey) warnings.push("runtime-points-to-unbound-task");
    if (observedUnboundTaskKeys.length > 0) warnings.push("transcript-mentions-unbound-tasks");
    if (warnings.length > 0) result.warnings = warnings;
    return result;
  }

  // 6. Sort bound candidates.
  boundSummaries.sort((a, b) => {
    const aCurrent = runtimeCurrentSummary ? a.key === runtimeCurrentSummary.key : false;
    const bCurrent = runtimeCurrentSummary ? b.key === runtimeCurrentSummary.key : false;
    const aKey = candidateSortKey(a, aCurrent);
    const bKey = candidateSortKey(b, bCurrent);
    if (aKey !== bKey) return aKey - bKey;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  // 7. Build candidate projections.
  const candidates: YpiStudioSessionTaskLinkCandidate[] = [];
  for (let index = 0; index < boundSummaries.length; index++) {
    const summary = boundSummaries[index];
    const isCurrent = runtimeCurrentSummary ? summary.key === runtimeCurrentSummary.key : false;
    const isPrimary = index === 0;
    const lastEvidenceOrder = transcriptOrderByKey.get(summary.key);
    const candidate = buildCandidate(options.cwd, summary, isCurrent, isPrimary, lastEvidenceOrder);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return { task: null, tasks: [], reason: "task-not-found" };
  }

  const primary = candidates[0];
  const warnings: string[] = [];
  if (candidates.length > 1) warnings.push("multiple-bound-tasks");
  if (runtimeUnboundTaskKey) warnings.push("runtime-points-to-unbound-task");
  if (observedUnboundTaskKeys.length > 0) warnings.push("transcript-mentions-unbound-tasks");

  const result: YpiStudioSessionTasksLinkResult = {
    task: primary.task,
    tasks: candidates,
    primaryTaskKey: primary.task.key,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
  if (Object.keys(diagnostics).length > 0) result.diagnostics = diagnostics;
  return result;
}

/**
 * Session-route helper: resolve primary-task autocontinue command.
 * - Main implementing: ready + free slots on the primary task main DAG.
 * - waiting_for_improvements: first implementing improvement with ready + free slots
 *   on the instance DAG only (never main plan).
 * Returns null when no continuation should fire. Safe: never throws on missing plan;
 * never rolls back user decisions.
 */
export function resolveYpiStudioSessionAutocontinueCommand(options: {
  cwd: string;
  primaryTask: YpiStudioTaskWidgetProjection | null | undefined;
}): Record<string, unknown> | null {
  const primaryTask = options.primaryTask;
  if (!primaryTask || primaryTask.archived) return null;

  if (primaryTask.status === "implementing") {
    const projection = primaryTask.implementationProjection;
    if (!projection) return null;
    const counts = projection.statusCounts;
    const activeCount = (counts?.running ?? 0) + (counts?.queued ?? 0);
    const readyCount = counts?.ready ?? 0;
    const availableSlots = Math.max(0, projection.maxConcurrency - activeCount);
    if (readyCount <= 0 || availableSlots <= 0) return null;
    return {
      type: "studio_autocontinue",
      taskId: primaryTask.id,
      readySubtaskCount: readyCount,
      availableSlots,
      stateKey: `${primaryTask.updatedAt}:${activeCount}:${readyCount}:${availableSlots}:${projection.nextSubtaskIds?.join(",") ?? ""}`,
      reason: "studio-task poll observed ready main subtasks with free concurrency slots (primary task only)",
    };
  }

  if (primaryTask.status !== "waiting_for_improvements") return null;

  const detail = getYpiStudioTaskDetail(options.cwd, primaryTask.id);
  if (!detail || detail.archived || detail.status !== "waiting_for_improvements") return null;

  // First implementing improvement with a plan that has ready work + free slots.
  const instances = detail.improvements?.instances ?? [];
  for (const instance of instances) {
    if (instance.status !== "implementing") continue;
    const plan = instance.implementationPlan;
    const progress = instance.implementationProgress;
    if (!plan || !progress) continue;
    const counts = implementationCounts(progress);
    const activeCount = (counts.running ?? 0) + (counts.queued ?? 0);
    const readyCount = counts.ready ?? 0;
    const maxConcurrency = Math.max(1, plan.maxConcurrency ?? plan.execution?.maxParallel ?? 1);
    const availableSlots = Math.max(0, maxConcurrency - activeCount);
    if (readyCount <= 0 || availableSlots <= 0) continue;
    const nextIds = progress.nextSubtaskIds ?? (progress.nextSubtaskId ? [progress.nextSubtaskId] : []);
    const revision = instance.approval?.revision ?? 1;
    return {
      type: "studio_autocontinue",
      taskId: detail.id,
      improvementId: instance.id,
      displayId: instance.displayId,
      readySubtaskCount: readyCount,
      availableSlots,
      stateKey: `imp:${instance.id}:r${revision}:${instance.updatedAt}:${activeCount}:${readyCount}:${availableSlots}:${nextIds.join(",")}`,
      reason: `studio-task poll observed ready improvement ${instance.displayId} subtasks with free concurrency slots (primary task only; instance DAG)`,
    };
  }

  return null;
}

/**
 * Map a session-class contextId (`pi_<sessionId>`) back to the raw session id for RPC lookup.
 * Transcript/process contexts are not live RPC wrappers and return null.
 */
export function parseYpiStudioSessionIdFromContextId(contextId: string): string | null {
  if (typeof contextId !== "string" || !contextId.startsWith("pi_")) return null;
  if (contextId.startsWith("pi_transcript_") || contextId.startsWith("pi_process_")) return null;
  const sessionId = contextId.slice("pi_".length);
  return sessionId || null;
}

/**
 * Best-effort studio_user_action command after request_plan_changes.
 * Feedback must already be persisted; this only wakes the bound session.
 * Callers (task PATCH route) should send via getRpcSession(sessionId)?.send(command).catch(() => {})
 * and never roll back the persisted planning decision if the wrapper is missing/busy.
 */
export function buildYpiStudioRequestPlanChangesContinuationCommand(options: {
  taskId: string;
  feedback: string;
  revisionFrom: number;
  revisionTo: number;
  updatedAt?: string;
}): Record<string, unknown> {
  const feedback = options.feedback.trim().slice(0, 2000);
  return {
    type: "studio_user_action",
    taskId: options.taskId,
    action: "request_plan_changes",
    feedback,
    revisionFrom: options.revisionFrom,
    revisionTo: options.revisionTo,
    stateKey: `${options.updatedAt ?? ""}:r${options.revisionFrom}->${options.revisionTo}:${feedback.slice(0, 80)}`,
    reason: "widget request_plan_changes persisted; wake architect planning",
  };
}

/**
 * Resolve sessionId + studio_user_action command after a successful request_plan_changes mutation.
 * Returns null only when contextId is not a live session-class id.
 */
export function resolveYpiStudioRequestPlanChangesContinuation(options: {
  contextId: string;
  taskId: string;
  feedback: string;
  revisionFrom: number;
  revisionTo: number;
  updatedAt?: string;
}): { sessionId: string; command: Record<string, unknown> } | null {
  const sessionId = parseYpiStudioSessionIdFromContextId(options.contextId);
  if (!sessionId) return null;
  return {
    sessionId,
    command: buildYpiStudioRequestPlanChangesContinuationCommand({
      taskId: options.taskId,
      feedback: options.feedback,
      revisionFrom: options.revisionFrom,
      revisionTo: options.revisionTo,
      updatedAt: options.updatedAt,
    }),
  };
}

/**
 * One-shot helper for task PATCH after a successful request_plan_changes mutation.
 * Lazy-imports getRpcSession to keep session-link free of circular startup deps with rpc-manager.
 * Never throws; never rolls back the already-persisted planning decision.
 */
export function bestEffortContinueAfterWidgetRequestPlanChanges(options: {
  contextId: string;
  taskId: string;
  feedback: string;
  revisionFrom: number;
  revisionTo: number;
  updatedAt?: string;
}): void {
  try {
    const resolved = resolveYpiStudioRequestPlanChangesContinuation(options);
    if (!resolved) return;
    // Dynamic import avoids a static cycle: rpc-manager -> extension -> tasks/session-link.
    void import("./rpc-manager").then(({ bestEffortSendStudioCommand }) => {
      bestEffortSendStudioCommand(resolved.sessionId, resolved.command);
    }).catch(() => {});
  } catch {
    // Recoverable from bound chat.
  }
}
