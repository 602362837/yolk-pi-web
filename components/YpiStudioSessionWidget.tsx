"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  YpiStudioPlanReviewModal,
  type YpiStudioPlanReviewTarget,
} from "@/components/YpiStudioPlanReviewModal";
import { usePrompt } from "@/components/AppPromptProvider";
import {
  openStudioTaskHtmlPrototype,
  improvementRelativePath,
  taskRelativeFilePath,
} from "@/lib/ypi-studio-task-preview";
import type {
  YpiStudioImplementationCompactTimelineItem,
  YpiStudioImplementationSubtaskStatus,
  YpiStudioLiveRunOverlay,
  YpiStudioSessionTaskLinkCandidate,
  YpiStudioTaskWidgetProjection,
  YpiStudioTaskWidgetSubagentRun,
  YpiStudioWidgetQuickPreview,
  YpiStudioWidgetQuickPreviewApprovalState,
} from "@/lib/ypi-studio-types";

// ── Props ──
interface Props {
  tasks: YpiStudioSessionTaskLinkCandidate[];
  liveOverlays?: YpiStudioLiveRunOverlay[];
  onOpenTask: (taskKey: string) => void;
  primaryTaskKey?: string;
  /** Authorized Studio cwd for on-demand plan-review reads. */
  cwd?: string;
  /** Stable bound-session context id (`pi_<sessionId>`) for state-machine writes. */
  contextId?: string;
  /** Refresh widget + drawer after a successful mutation (or rejected race). */
  onTaskChanged?: (taskKey: string) => void;
  /** Optional file viewer opener for Markdown relative links / source. */
  onOpenFile?: (filePath: string, fileName: string) => void;
}

interface WidgetPosition { left: number; top: number }
interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

// ── Constants ──
const EXPANDED_POSITION_KEY = "pi-web:ypi-studio-session-widget-position:v2";
const BALL_POSITION_KEY = "pi-web:ypi-studio-session-widget-ball-position:v1";
const EXPANDED_STATE_KEY = "pi-web:ypi-studio-session-widget-expanded";
const DEFAULT_MARGIN = 18;
const DRAG_THRESHOLD_PX = 4;
const MOBILE_MEDIA = "(max-width: 640px)";

// ── Position helpers ──
function clampPosition(pos: WidgetPosition, parent: HTMLElement, element: HTMLElement): WidgetPosition {
  const pw = parent.clientWidth;
  const ph = parent.clientHeight;
  const ew = element.offsetWidth || 360;
  const eh = element.offsetHeight || 48;
  const maxLeft = Math.max(DEFAULT_MARGIN, pw - ew - DEFAULT_MARGIN);
  const maxTop = Math.max(DEFAULT_MARGIN, ph - eh - DEFAULT_MARGIN);
  return {
    left: Math.min(Math.max(DEFAULT_MARGIN, pos.left), maxLeft),
    top: Math.min(Math.max(DEFAULT_MARGIN, pos.top), maxTop),
  };
}

function readPosition(key: string): WidgetPosition | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WidgetPosition>;
    if (typeof parsed?.left === "number" && typeof parsed?.top === "number") {
      return { left: parsed.left, top: parsed.top };
    }
  } catch { /* ignore */ }
  return null;
}

function writePosition(key: string, pos: WidgetPosition): void {
  try { window.localStorage.setItem(key, JSON.stringify(pos)); } catch { /* ignore */ }
}

function readExpandedState(): boolean {
  try {
    const raw = window.localStorage.getItem(EXPANDED_STATE_KEY);
    if (raw === "false") return false;
  } catch { /* ignore */ }
  return true;
}

function writeExpandedState(expanded: boolean): void {
  try { window.localStorage.setItem(EXPANDED_STATE_KEY, String(expanded)); } catch { /* ignore */ }
}

// ── useMobile hook ──
function useMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA);
    const update = () => setMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return mobile;
}

// ── Status helpers ──
function statusColor(status: string): string {
  if (status === "succeeded" || status === "done" || status === "skipped") return "#22c55e";
  if (status === "waiting_for_user" || status === "blocked") return "#f59e0b";
  if (status === "failed") return "#ef4444";
  if (status === "queued" || status === "ready") return "#38bdf8";
  if (status === "cancelled") return "var(--text-dim)";
  if (status === "running" || status === "active") return "var(--accent)";
  return "var(--text-dim)";
}

function subtaskStatusLabel(status: YpiStudioImplementationSubtaskStatus): string {
  if (status === "pending" || status === "waiting") return "等待";
  if (status === "ready") return "就绪";
  if (status === "queued") return "队列";
  if (status === "running") return "运行";
  if (status === "done") return "完成";
  if (status === "failed") return "失败";
  if (status === "blocked") return "阻塞";
  return "跳过";
}

function implementationCount(task: YpiStudioTaskWidgetProjection, status: YpiStudioImplementationSubtaskStatus): number {
  return task.implementationProjection?.statusCounts[status] ?? 0;
}

function implementationCountSummary(task: YpiStudioTaskWidgetProjection): string | undefined {
  const total = task.implementation?.total;
  if (!total && !task.implementationProjection) return undefined;
  const done = implementationCount(task, "done") || task.implementation?.done || 0;
  const skipped = implementationCount(task, "skipped") || task.implementation?.skipped || 0;
  const running = implementationCount(task, "running");
  const queued = implementationCount(task, "queued");
  const waiting = implementationCount(task, "waiting") + implementationCount(task, "pending");
  const ready = implementationCount(task, "ready");
  const failed = implementationCount(task, "failed");
  const blocked = implementationCount(task, "blocked") || task.implementation?.blocked || 0;
  const pieces = [`运行 ${running}`, `队列 ${queued}`, `等待 ${waiting}`, `就绪 ${ready}`, `失败 ${failed}`, `阻塞 ${blocked}`, `完成 ${done + skipped}/${total ?? done + skipped}`];
  return pieces.filter((piece) => !/ (0)(\D|$)/.test(piece) || piece.startsWith("完成")).join(" · ");
}

function visibleSubtasks(task: YpiStudioTaskWidgetProjection): YpiStudioImplementationCompactTimelineItem[] {
  const timeline = task.implementationProjection?.compactTimeline;
  if (timeline?.length) return timeline.slice(0, 3);
  return (task.implementationProjection?.nonTerminalSubtasks ?? []).slice(0, 3).map((subtask) => ({
    id: subtask.id,
    title: subtask.title,
    status: subtask.status,
    displayStatus: subtask.displayStatus,
    member: subtask.member,
    runId: subtask.currentRunId ?? subtask.lastRunId,
    reason: subtask.terminationReason ?? subtask.summary,
    summary: subtask.summary,
    updatedAt: subtask.updatedAt,
  }));
}

// ── Overlay merge ──
function isActiveOverlay(overlay: YpiStudioLiveRunOverlay): boolean {
  return overlay.running || overlay.status === "queued" || overlay.status === "running" || overlay.status === "waiting_for_user";
}

function mergeRuns(task: YpiStudioTaskWidgetProjection, overlays: YpiStudioLiveRunOverlay[] = []): YpiStudioTaskWidgetSubagentRun[] {
  const relevant = overlays.filter((overlay) => isActiveOverlay(overlay) && (overlay.taskKey === task.key || overlay.taskId === task.id));
  const liveRuns = relevant.map((overlay): YpiStudioTaskWidgetSubagentRun => ({
    id: overlay.runId ?? overlay.toolCallId,
    member: overlay.member ?? "studio",
    subtaskId: overlay.subtaskId,
    status: overlay.status ?? "running",
    startedAt: new Date(overlay.updatedAt).toISOString(),
    summary: overlay.lastTextPreview ?? overlay.subtaskTitle ?? overlay.taskTitle,
    model: overlay.model,
    thinking: overlay.thinking,
    phase: overlay.phase,
    tokens: overlay.tokens,
    tps: overlay.tps,
    currentTool: overlay.currentTool,
    lastItemsPreview: overlay.itemsPreview ?? [],
  }));
  const liveIds = new Set(liveRuns.map((run) => run.id));
  return [...liveRuns, ...task.subagents.filter((run) => !liveIds.has(run.id))]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-5);
}

function latestRunSummary(runs: YpiStudioTaskWidgetSubagentRun[]): string | undefined {
  const active = runs.find((r) => r.status === "running" || r.status === "queued");
  if (active) {
    const tps = typeof active.tps === "number" ? `${active.tps.toFixed(1)} t/s` : undefined;
    return `${active.member} · ${active.phase ?? active.status}${tps ? ` · ${tps}` : ""}`;
  }
  const last = runs[runs.length - 1];
  if (last) return `${last.member} · ${last.status}`;
  return undefined;
}

// ── Ball status ──
type BallUrgency = "needs_user" | "failed" | "running" | "idle";

function computeBallUrgency(tasks: YpiStudioSessionTaskLinkCandidate[]): BallUrgency {
  let urgency: BallUrgency = "idle";
  for (const c of tasks) {
    const s = c.task.implementationProjection?.sessionRuntime?.status;
    if (s === "needs_user") return "needs_user";
    if (c.task.status === "failed" || c.task.status === "blocked") urgency = "failed";
    const subtaskCounts = c.task.implementationProjection?.statusCounts;
    if (subtaskCounts && (subtaskCounts.failed > 0 || subtaskCounts.blocked > 0)) {
      urgency = "failed";
    }
    // Improvement flows that wait on the user should surface as needs_user.
    const imp = c.task.improvements;
    if (imp && imp.unresolved > 0) {
      const first = imp.instances.find((inst) => inst.status === "waiting_plan_approval" || inst.status === "waiting_user_acceptance");
      if (first) return "needs_user";
      if (urgency === "idle") urgency = "running";
    }
    const hasActive = c.task.subagents.some((r) => r.status === "running" || r.status === "queued" || r.status === "waiting_for_user");
    if (hasActive && urgency === "idle") urgency = "running";
  }
  return urgency;
}

function ballColor(urgency: BallUrgency): { bg: string; glow: string } {
  if (urgency === "needs_user") return { bg: "#f59e0b", glow: "rgba(245,158,11,0.7)" };
  if (urgency === "failed") return { bg: "#ef4444", glow: "rgba(239,68,68,0.55)" };
  if (urgency === "running") return { bg: "var(--accent)", glow: "rgba(37,99,235,0.4)" };
  return { bg: "var(--accent)", glow: "rgba(37,99,235,0.4)" };
}

// ── TaskCard ──
type WorkflowRailState = "done" | "current" | "attention" | "failed" | "blocked" | "unknown";
type WorkflowRailStageId =
  | "brief"
  | "design"
  | "implement"
  | "checks"
  | "review"
  | "user_acceptance"
  | "completed"
  | "archived";

/** Full eight-station display rail. Presentation only — never drives server transitions. */
const WORKFLOW_RAIL_STAGES = [
  { id: "brief" as const, label: "Brief", shortLabel: "Brief", artifacts: ["brief"] },
  { id: "design" as const, label: "Design", shortLabel: "Design", artifacts: ["prd", "design", "ui"] },
  { id: "implement" as const, label: "Implement", shortLabel: "Implement", artifacts: ["implement", "handoff"] },
  { id: "checks" as const, label: "Checks", shortLabel: "Checks", artifacts: ["checks"] },
  { id: "review" as const, label: "Review", shortLabel: "Review", artifacts: ["plan-review", "review", "summary"] },
  { id: "user_acceptance" as const, label: "User Acceptance", shortLabel: "User Acc.", artifacts: [] as string[] },
  { id: "completed" as const, label: "Completed", shortLabel: "Completed", artifacts: [] as string[] },
  { id: "archived" as const, label: "Archived", shortLabel: "Archived", artifacts: [] as string[] },
] as const;

const WORKFLOW_RAIL_STAGE_INDEX: Record<WorkflowRailStageId, number> = {
  brief: 0,
  design: 1,
  implement: 2,
  checks: 3,
  review: 4,
  user_acceptance: 5,
  completed: 6,
  archived: 7,
};

/** Post-checks lifecycle stages are driven only by runtime status, never by planning docs. */
const POST_CHECKS_STAGE_IDS = new Set<WorkflowRailStageId>([
  "review",
  "user_acceptance",
  "completed",
  "archived",
]);

function artifactMatchesStage(artifact: string, aliases: readonly string[]): boolean {
  const name = artifact.toLowerCase().replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  return aliases.some((alias) => name === alias || name.startsWith(`${alias}-`) || name.startsWith(`${alias}_`));
}

function workflowStageForStep(step: YpiStudioTaskWidgetProjection["steps"][number]): WorkflowRailStageId | undefined {
  // Prefer workflow state ids. Filenames alone cannot establish runtime Checks/
  // Review/User Acceptance completion — planning docs often exist early.
  if (step.id === "intake") return "brief";
  if (step.id === "planning" || step.id === "awaiting_approval") return "design";
  if (step.id === "implementing") return "implement";
  if (step.id === "checking" || step.id === "changes_requested") return "checks";
  if (step.id === "ready" || step.id === "review") return "review";
  if (step.id === "user_acceptance" || step.id === "waiting_for_improvements") return "user_acceptance";
  if (step.id === "completed") return "completed";
  if (step.id === "archived") return "archived";
  // Only map early stations from required-artifact aliases; never promote post-checks
  // stations from prewritten checks.md / review.md presence.
  return WORKFLOW_RAIL_STAGES.find((stage) => (
    !POST_CHECKS_STAGE_IDS.has(stage.id)
    && stage.artifacts.length > 0
    && step.requiredArtifacts.some((artifact) => artifactMatchesStage(artifact, stage.artifacts))
  ))?.id;
}

function workflowStageFromTaskStatus(status: string, task: YpiStudioTaskWidgetProjection): WorkflowRailStageId | undefined {
  if (task.archived || status === "archived") return "archived";
  if (status === "completed") return "completed";
  if (status === "user_acceptance" || status === "waiting_for_improvements") return "user_acceptance";
  if (status === "ready" || status === "review") return "review";
  if (status === "checking" || status === "changes_requested") return "checks";
  if (status === "implementing") return "implement";
  if (status === "planning" || status === "awaiting_approval") return "design";
  if (status === "intake") return "brief";
  return undefined;
}

function workflowStageHasDoneEvidence(task: YpiStudioTaskWidgetProjection, stage: typeof WORKFLOW_RAIL_STAGES[number]): boolean {
  // Terminal archive: every station has durable completion evidence.
  if (task.archived || task.status === "archived") return true;

  // Later stations must never be marked done because a planning markdown file exists.
  if (stage.id === "archived") return false;
  if (stage.id === "completed") return task.status === "completed";
  if (stage.id === "user_acceptance") return task.status === "completed";
  if (stage.id === "review") {
    return task.status === "user_acceptance"
      || task.status === "waiting_for_improvements"
      || task.status === "completed";
  }

  const workflowEvidence = task.steps.filter((step) => workflowStageForStep(step) === stage.id);
  if (workflowEvidence.length > 0) {
    return workflowEvidence.some((step) => step.status === "done");
  }
  // Artifact fallback only for early planning/implementation stations.
  // Post-checks stations intentionally have empty alias lists and must not
  // inherit completion from planning markdown files.
  if (POST_CHECKS_STAGE_IDS.has(stage.id)) return false;
  const aliases = stage.artifacts as readonly string[];
  if (aliases.length === 0) return false;
  return task.artifacts.completed.some((artifact) => artifactMatchesStage(artifact, aliases));
}

function workflowRailActiveStage(task: YpiStudioTaskWidgetProjection): WorkflowRailStageId | undefined {
  // Status-first for post-checks lifecycle so archived/completed/user_acceptance
  // remain visible after Review even when workflow steps omit later states.
  const stageFromStatus = workflowStageFromTaskStatus(task.status, task);
  if (stageFromStatus && POST_CHECKS_STAGE_IDS.has(stageFromStatus)) return stageFromStatus;

  const activeWorkflowStep = task.steps.find((step) => step.status === "active");
  const stageFromWorkflow = activeWorkflowStep && workflowStageForStep(activeWorkflowStep);
  if (stageFromWorkflow) return stageFromWorkflow;
  if (stageFromStatus) return stageFromStatus;

  const runtime = task.implementationProjection?.sessionRuntime?.status;
  const counts = task.implementationProjection?.statusCounts;
  // Improvement wait is a post-checks user gate, not implement motion.
  if (task.status === "waiting_for_improvements") return "user_acceptance";
  if (runtime === "needs_user" || runtime === "waiting_for_studio_children" || (counts && (counts.running > 0 || counts.queued > 0 || counts.ready > 0))) {
    // If the main task is already past implement, keep the late-stage marker.
    if (stageFromStatus && WORKFLOW_RAIL_STAGE_INDEX[stageFromStatus] >= WORKFLOW_RAIL_STAGE_INDEX.review) {
      return stageFromStatus;
    }
    return "implement";
  }

  // Generic failed/blocked task states have no canonical workflow step. Place
  // the attention marker on the first station without completion evidence rather
  // than silently rendering every station as neutral.
  if (task.status === "failed" || task.status === "blocked" || (counts && (counts.failed > 0 || counts.blocked > 0))) {
    return WORKFLOW_RAIL_STAGES.find((stage) => !workflowStageHasDoneEvidence(task, stage))?.id ?? "review";
  }
  return undefined;
}

function workflowRailNeedsUserAttention(task: YpiStudioTaskWidgetProjection): boolean {
  const runtime = task.implementationProjection?.sessionRuntime?.status;
  if (runtime === "needs_user" || runtime === "waiting_for_studio_children") return true;
  if (task.status === "user_acceptance" || task.status === "waiting_for_improvements") return true;
  if (task.status === "ready" || task.status === "review") {
    // Main-task re-acceptance after improvements, or first-time review gate.
    return true;
  }
  const imp = task.improvements;
  if (imp && imp.instances.some((inst) => inst.status === "waiting_user_acceptance" || inst.canAccept)) return true;
  return false;
}

/**
 * Soft motion (halo/flow) for the active cursor. Terminal completed/archived
 * cards stay static; everything else with a live current/attention station
 * may animate so the rail remains readable in review/awaiting_approval too.
 */
function workflowRailAllowsMotion(task: YpiStudioTaskWidgetProjection): boolean {
  if (task.archived || task.status === "archived" || task.status === "completed") return false;
  return true;
}

function workflowRailNodeSymbol(state: WorkflowRailState): string {
  if (state === "done") return "✓";
  if (state === "current") return "▶";
  if (state === "attention") return "!";
  if (state === "failed") return "!";
  if (state === "blocked") return "×";
  return "○";
}

function WorkflowRail({ task }: { task: YpiStudioTaskWidgetProjection }) {
  const activeStage = workflowRailActiveStage(task);
  const counts = task.implementationProjection?.statusCounts;
  const hasFailure = task.status === "blocked" || task.status === "failed" || Boolean(counts && counts.failed > 0);
  const hasBlock = task.status === "blocked" || Boolean(counts && counts.blocked > 0);
  const needsAttention = workflowRailNeedsUserAttention(task);
  const allowsMotion = workflowRailAllowsMotion(task);
  const activeIndex = activeStage ? WORKFLOW_RAIL_STAGE_INDEX[activeStage] : -1;

  const stations = WORKFLOW_RAIL_STAGES.map((stage, index) => {
    // Workflow/status evidence is authoritative. Prewritten checks.md must not
    // mark runtime Checks / Review / User Acceptance complete.
    // Once the runtime cursor is past a station, earlier stations show done
    // (display-only cumulative progress; never writes state).
    // Archived tasks keep the full eight-station history and mark every station done.
    let state: WorkflowRailState = "unknown";
    if (task.archived || task.status === "archived") {
      state = "done";
    } else if (activeIndex >= 0 && index < activeIndex) {
      state = "done";
    } else if (workflowStageHasDoneEvidence(task, stage)) {
      state = "done";
    }
    if (stage.id === activeStage && !(task.archived || task.status === "archived")) {
      state = hasBlock ? "blocked" : hasFailure ? "failed" : needsAttention ? "attention" : "current";
    } else if (stage.id === activeStage && (task.archived || task.status === "archived")) {
      // Keep Archived readable as the terminal station while still showing ✓ evidence.
      state = "done";
    }
    const stateLabel: Record<WorkflowRailState, string> = {
      done: "已完成",
      current: "进行中",
      attention: "待确认",
      failed: "失败",
      blocked: "阻塞",
      unknown: "未开始",
    };
    // Terminal stations never emit a forward connector. Within a row, the last
    // column (every 4th station in the 2×4 rail) also omits the line so the
    // shimmer does not visually jump to the next row mid-card.
    const isRowEnd = (index + 1) % 4 === 0;
    const isLast = index === WORKFLOW_RAIL_STAGES.length - 1;
    const canConnectForward = !isLast && !isRowEnd;
    // Current / attention / failed / blocked all get a soft halo so the cursor
    // is visible even when the task is paused on review or user acceptance.
    const isCursor = state === "current" || state === "attention" || state === "failed" || state === "blocked";
    return {
      ...stage,
      state,
      stateLabel: stateLabel[state],
      hasHalo: allowsMotion && isCursor,
      hasFlow: allowsMotion && isCursor && canConnectForward
        && stage.id !== "completed" && stage.id !== "archived",
      showLine: canConnectForward,
    };
  });

  return (
    <div
      className="ypi-studio-workflow-rail is-eight-station"
      aria-label="Workflow 进度：Brief、Design、Implement、Checks、Review、User Acceptance、Completed、Archived"
    >
      {stations.map((station) => (
        <div className="ypi-studio-workflow-rail-segment" key={station.id}>
          <div className={`ypi-studio-workflow-rail-station is-${station.state}`}>
            <span
              className={`ypi-studio-workflow-rail-node is-${station.state}${station.hasHalo ? " is-halo" : ""}`}
              title={`${station.label}：${station.stateLabel}`}
              aria-label={`${station.label}：${station.stateLabel}`}
            >
              {workflowRailNodeSymbol(station.state)}
            </span>
            <span className="ypi-studio-workflow-rail-label" title={station.label}>{station.shortLabel}</span>
          </div>
          {station.showLine && (
            <span
              className={`ypi-studio-workflow-rail-line is-${station.state}${station.hasFlow ? " is-flowing" : ""}`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}

type AcceptableImprovement = {
  id: string;
  displayId: string;
  title: string;
};

/** Only waiting_user_acceptance instances; never invent a target. */
function acceptableImprovementsForTask(task: YpiStudioTaskWidgetProjection): AcceptableImprovement[] {
  if (task.archived || task.status === "archived" || task.status === "completed") return [];
  const instances = task.improvements?.instances ?? [];
  return instances
    .filter((inst) => inst.status === "waiting_user_acceptance" || inst.canAccept === true)
    .filter((inst) => inst.status === "waiting_user_acceptance")
    .map((inst) => ({
      id: inst.id,
      displayId: inst.displayId,
      title: inst.title,
    }));
}

type QuickPreviewAction = {
  key: string;
  kind: YpiStudioWidgetQuickPreview["kind"];
  label: string;
  stateWord: string;
  icon: string;
  tone: YpiStudioWidgetQuickPreviewApprovalState;
  ariaLabel: string;
  title: string;
  /** Markdown plan opens the read-only modal. */
  planTarget?: YpiStudioPlanReviewTarget;
  /** HTML prototype opens via files API mode=preview. */
  prototype?: {
    fileName: string;
    improvementId?: string;
  };
};

function quickPreviewStateWord(
  kind: YpiStudioWidgetQuickPreview["kind"],
  approvalState: YpiStudioWidgetQuickPreviewApprovalState,
): string {
  if (kind === "prototype") {
    if (approvalState === "approved") return "· ✓ 已确认";
    if (approvalState === "revision_changed") return "· 需重审";
    if (approvalState === "readonly") return "· 只读";
    return "· 待确认";
  }
  if (approvalState === "approved") return "· ✓ 已批准";
  if (approvalState === "revision_changed") return "· 已变更需重审";
  if (approvalState === "readonly") return "· 只读";
  return "· 待审批";
}

function quickPreviewAriaState(
  kind: YpiStudioWidgetQuickPreview["kind"],
  approvalState: YpiStudioWidgetQuickPreviewApprovalState,
): string {
  if (kind === "prototype") {
    if (approvalState === "approved") return "已确认";
    if (approvalState === "revision_changed") return "计划已变更，需重审";
    if (approvalState === "readonly") return "只读历史";
    return "待确认";
  }
  if (approvalState === "approved") return "已批准";
  if (approvalState === "revision_changed") return "计划已变更，需重审";
  if (approvalState === "readonly") return "只读历史";
  return "待审批";
}

/**
 * Build permanent plan / HTML prototype actions from additive quickPreviews.
 * Presence no longer depends on awaiting_approval / waiting_plan_approval.
 * Improvement-scoped entries always carry explicit improvementId.
 */
function quickPreviewActionsForTask(task: YpiStudioTaskWidgetProjection): QuickPreviewAction[] {
  const previews = task.quickPreviews ?? [];
  if (previews.length === 0) return [];

  const actions: QuickPreviewAction[] = [];
  for (const preview of previews) {
    // FLOW-01 will handle acceptance; UI-01 only surfaces plan/prototype/improvement-plan.
    if (preview.kind === "improvement-plan" && !preview.improvementId) continue;

    const stateWord = quickPreviewStateWord(preview.kind, preview.approvalState);
    const ariaState = quickPreviewAriaState(preview.kind, preview.approvalState);
    const scopeLabel = preview.displayId
      ? `改进项 ${preview.displayId}`
      : preview.improvementId
        ? `改进项 ${preview.improvementId}`
        : "主任务";
    const key = [
      preview.kind,
      preview.improvementId ?? "main",
      preview.fileName,
    ].join(":");

    if (preview.kind === "prototype") {
      actions.push({
        key,
        kind: preview.kind,
        label: preview.label,
        stateWord,
        icon: "↗",
        tone: preview.approvalState,
        ariaLabel: `在新页面打开《${task.title}》${scopeLabel} HTML 原型（${ariaState}）`,
        title: `${preview.label} ${stateWord} · 新页面预览`,
        prototype: {
          fileName: preview.fileName,
          improvementId: preview.improvementId,
        },
      });
      continue;
    }

    actions.push({
      key,
      kind: preview.kind,
      label: preview.label,
      stateWord,
      icon: "▤",
      tone: preview.approvalState,
      ariaLabel: `预览《${task.title}》${scopeLabel} ${preview.label}（${ariaState}）`,
      title: `${preview.label} ${stateWord} · 只读`,
      planTarget: {
        taskKey: task.key,
        taskTitle: task.title,
        pathLabel: task.pathLabel,
        fileName: preview.fileName,
        improvementId: preview.improvementId,
        improvementDisplayId: preview.displayId,
      },
    });
  }
  return actions;
}

function BallVisual({
  urgency,
  taskCount,
  colors,
  dragging,
  attentionSequence,
}: {
  urgency: BallUrgency;
  taskCount: number;
  colors: ReturnType<typeof ballColor>;
  dragging: boolean;
  attentionSequence: number;
}) {
  const attention = urgency === "needs_user" || urgency === "failed";
  return (
    <div
      // Remount only this visual layer when attention changes, never the draggable shell.
      key={attentionSequence}
      className={`ypi-studio-widget-ball-visual is-${urgency}${attention ? " is-attention" : ""}${dragging ? " is-dragging" : ""}`}
      style={{ background: colors.bg, boxShadow: `0 4px 16px ${colors.glow}` }}
    >
      <span aria-hidden="true">工</span>
      <span className="ypi-studio-widget-ball-status" aria-hidden="true">
        {urgency === "needs_user" ? "!" : urgency === "failed" ? "×" : urgency === "running" ? "…" : ""}
      </span>
      {taskCount > 0 && <span className="ypi-studio-widget-ball-count">{taskCount}</span>}
    </div>
  );
}

function TaskCard({
  candidate,
  runs,
  isPrimary,
  onOpen,
  onPreviewPlan,
  onOpenPrototype,
  onAcceptImprovement,
  acceptingImprovementId,
}: {
  candidate: YpiStudioSessionTaskLinkCandidate;
  runs: YpiStudioTaskWidgetSubagentRun[];
  isPrimary: boolean;
  onOpen: () => void;
  onPreviewPlan?: (target: YpiStudioPlanReviewTarget) => void;
  onOpenPrototype?: (options: {
    taskKey: string;
    fileName: string;
    improvementId?: string;
    label: string;
  }) => void;
  onAcceptImprovement?: (improvement: AcceptableImprovement) => void;
  acceptingImprovementId?: string | null;
}) {
  const task = candidate.task;
  const completedCount = task.artifacts.completed.length;
  const availableArtifactCount = task.artifacts.available.length;
  const impSummary = implementationCountSummary(task);
  const runtime = task.implementationProjection?.sessionRuntime;
  const subtasks = visibleSubtasks(task);
  const runSummary = latestRunSummary(runs);
  const improvements = task.improvements;
  const improvementUnresolved = improvements?.unresolved ?? 0;
  const improvementWaiting = task.status === "waiting_for_improvements" || (improvements && improvementUnresolved > 0);
  const quickActions = quickPreviewActionsForTask(task);
  const acceptableImprovements = acceptableImprovementsForTask(task);
  const isArchivedReadOnly = Boolean(task.archived || task.status === "archived");

  return (
    <div
      className={`ypi-studio-task-card${isArchivedReadOnly ? " is-archived" : ""}`}
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
        cursor: "default",
        background: isPrimary ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
        borderLeft: isPrimary ? "3px solid var(--accent)" : "3px solid transparent",
      }}
    >
      {/* Top row: workflow context, progress, and the sole detail action. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <span style={{
          width: 18, height: 18, borderRadius: 6, display: "grid", placeItems: "center",
          background: "rgba(37,99,235,0.13)", color: "var(--accent)", fontWeight: 900, fontSize: 10, flexShrink: 0,
        }}>工</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Studio · {task.workflowName ?? task.workflowId}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text)", fontWeight: 700, flexShrink: 0 }}>{task.progress}%</span>
        <button
          type="button"
          className="ypi-studio-task-detail-button"
          aria-label={`打开《${task.title}》详情`}
          title="打开任务详情"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 5 }}>
        {task.title}
      </div>

      <WorkflowRail task={task} />

      {/* Meta row */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", color: "var(--text-dim)", fontSize: 10, marginBottom: 3 }}>
        <span style={{ color: improvementWaiting ? "#b45309" : statusColor(task.status), fontWeight: 700 }}>
          {task.status === "waiting_for_improvements" ? "等待改进完成" : task.statusLabel}
        </span>
        <span>·</span>
        <span>{task.currentMember ?? "—"}</span>
        <span>·</span>
        <span title={`当前阶段待产物：${task.artifacts.missing.join("、") || "无"}`}>产物 {completedCount}/{availableArtifactCount}</span>
        {task.implementation && (
          <>
            <span>·</span>
            <span>子任务 {(task.implementation.done ?? 0) + (task.implementation.skipped ?? 0)}/{task.implementation.total}</span>
          </>
        )}
      </div>

      {/* Improvement flow — bounded summary; never includes full feedback. */}
      {improvements && improvementUnresolved > 0 && (
        <div
          className="ypi-studio-widget-improvement"
          style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 3, padding: "5px 7px", borderRadius: 7, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)" }}
          aria-live="polite"
        >
          <span style={{ fontSize: 10, fontWeight: 800, color: "#b45309", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            待处理改进 {improvementUnresolved} 项
          </span>
          {improvements.blocker && (
            <span style={{ fontSize: 10, color: "#b45309", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              阻塞：{improvements.blocker}
            </span>
          )}
          {improvements.nextAction && (
            <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              下一步：{improvements.nextAction}
            </span>
          )}
          {/* Explicit per-instance accept actions; only waiting_user_acceptance. */}
          {!isArchivedReadOnly && acceptableImprovements.length > 0 && (
            <div className="ypi-studio-widget-accept-list" role="group" aria-label="改进结果验收">
              {acceptableImprovements.map((inst) => {
                const busy = acceptingImprovementId === inst.id;
                return (
                  <div key={inst.id} className="ypi-studio-widget-accept-item">
                    <span className="ypi-studio-widget-accept-meta" title={`${inst.displayId} · ${inst.title}`}>
                      ! {inst.displayId} 改进结果待验收
                    </span>
                    <button
                      type="button"
                      className={`ypi-studio-widget-accept-btn${busy ? " is-busy" : ""}`}
                      disabled={Boolean(acceptingImprovementId)}
                      aria-busy={busy || undefined}
                      aria-label={`确认改进任务 ${inst.displayId}「${inst.title}」已完成（改进结果验收，不是计划审批）`}
                      title="确认该改进任务已完成 · 这是结果验收，不是计划审批"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (acceptingImprovementId) return;
                        onAcceptImprovement?.(inst);
                      }}
                    >
                      {busy ? "验收中…" : "确认该改进任务已完成"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {improvements && improvements.parentStatus === "review_ready" && improvementUnresolved === 0 && improvements.total > 0 && (
        <div
          className="ypi-studio-widget-reaccept-notice"
          style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          role="status"
          aria-live="polite"
        >
          ✓ 改进已完成，主任务需要再次验收
        </div>
      )}
      {isArchivedReadOnly && (
        <div className="ypi-studio-widget-archived-badge" role="status">
          ▣ 已归档 · 只读
        </div>
      )}

      {/* Permanent plan/prototype quick previews — GET-only; never grant approval. */}
      {quickActions.length > 0 && (
        <div className="ypi-studio-widget-plan-action-row" role="group" aria-label="计划与原型快速预览">
          {quickActions.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`ypi-studio-widget-plan-review-btn is-${entry.tone}${entry.kind === "prototype" ? " is-prototype" : ""}`}
              aria-label={entry.ariaLabel}
              title={entry.title}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (entry.prototype) {
                  onOpenPrototype?.({
                    taskKey: task.key,
                    fileName: entry.prototype.fileName,
                    improvementId: entry.prototype.improvementId,
                    label: entry.label,
                  });
                  return;
                }
                if (entry.planTarget) onPreviewPlan?.(entry.planTarget);
              }}
            >
              <span className="ypi-studio-widget-plan-review-btn-icon" aria-hidden="true">{entry.icon}</span>
              <span className="ypi-studio-widget-plan-review-btn-label">{entry.label}</span>
              <span className="ypi-studio-widget-plan-review-btn-state">{entry.stateWord}</span>
            </button>
          ))}
        </div>
      )}

      {/* Runtime */}
      {runtime && runtime.status !== "idle" && (
        <div style={{
          display: "flex", gap: 5, alignItems: "center", marginBottom: 3,
          color: runtime.status === "needs_user" ? "#f59e0b" : runtime.status === "completed" ? "#22c55e" : "var(--accent)",
          fontSize: 10, fontWeight: 700, overflow: "hidden",
        }}>
          <span
            className={runtime.status === "waiting_for_studio_children" ? "ypi-studio-widget-pulse" : undefined}
            style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", flexShrink: 0 }}
          />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {runtime.status === "waiting_for_studio_children"
              ? `等待并行子任务 · 运行 ${runtime.activeRunCount} · 就绪 ${runtime.readySubtaskCount}`
              : runtime.message}
          </span>
        </div>
      )}

      {/* Implementation summary */}
      {impSummary && (
        <div style={{
          color: (implementationCount(task, "failed") > 0 || implementationCount(task, "blocked") > 0) ? "#f59e0b" : "var(--text-dim)",
          fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
        }}>
          {impSummary}
        </div>
      )}

      {/* Subtask timeline (compact) */}
      {subtasks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", fontSize: 9, color: "var(--text-dim)", marginBottom: 2 }}>
          {subtasks.map((st) => (
            <span key={st.id} style={{ color: statusColor(st.status), whiteSpace: "nowrap" }}>
              {subtaskStatusLabel(st.status)} {st.title.slice(0, 20)}{st.title.length > 20 ? "…" : ""}
            </span>
          ))}
        </div>
      )}

      {/* Latest run */}
      {runSummary && (
        <div style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {runSummary}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// YpiStudioSessionWidget (multi-task)
// ═══════════════════════════════════════════
export function YpiStudioSessionWidget({
  tasks,
  liveOverlays = [],
  onOpenTask,
  primaryTaskKey,
  cwd,
  contextId,
  onTaskChanged,
  onOpenFile,
}: Props) {
  const isMobile = useMobile();
  const { confirm, toast } = usePrompt();
  const [expanded, setExpanded] = useState(() => readExpandedState());
  const [panelPosition, setPanelPosition] = useState<WidgetPosition | null>(null);
  const [ballPosition, setBallPosition] = useState<WidgetPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ballDragging, setBallDragging] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [attentionSequence, setAttentionSequence] = useState(0);
  const [planReviewTarget, setPlanReviewTarget] = useState<YpiStudioPlanReviewTarget | null>(null);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const acceptingInFlightRef = useRef(false);

  const handlePreviewPlan = useCallback((target: YpiStudioPlanReviewTarget) => {
    setPlanReviewTarget(target);
  }, []);

  const handleClosePlanReview = useCallback(() => {
    setPlanReviewTarget(null);
  }, []);

  /** HTML prototypes always open via task-local files API mode=preview in a new tab. */
  const handleOpenPrototype = useCallback((options: {
    taskKey: string;
    fileName: string;
    improvementId?: string;
    label: string;
  }) => {
    if (!cwd?.trim()) return;
    const candidate = tasks.find((item) => item.task.key === options.taskKey);
    const opened = openStudioTaskHtmlPrototype({
      taskKey: options.taskKey,
      cwd,
      fileName: options.fileName,
      improvementId: options.improvementId,
      onBlocked: () => {
        if (!candidate || !onOpenFile) return;
        const relative = options.improvementId
          ? improvementRelativePath(options.improvementId, options.fileName)
          : options.fileName;
        onOpenFile(taskRelativeFilePath(cwd, candidate.task, relative), options.fileName);
      },
    });
    void opened;
  }, [cwd, onOpenFile, tasks]);

  /**
   * Confirm then PATCH transition_improvement → accepted.
   * Never optimistically mark complete; refresh on both success and server rejection.
   */
  const handleAcceptImprovement = useCallback(async (
    taskKey: string,
    improvement: AcceptableImprovement,
  ) => {
    if (acceptingInFlightRef.current) return;
    if (!cwd?.trim()) {
      toast({ message: "无法验收：缺少工作区 cwd", tone: "error" });
      return;
    }
    if (!contextId?.trim()) {
      toast({ message: "无法验收：当前会话未绑定 contextId", tone: "error" });
      return;
    }

    const confirmed = await confirm({
      title: "确认该改进任务已完成？",
      message: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>
            这是<strong>验收改进结果</strong>，不是批准改进计划。确认后，改进项
            {" "}
            <code style={{ fontSize: 12 }}>{improvement.displayId}</code>
            {" "}
            将从 <code style={{ fontSize: 12 }}>waiting_user_acceptance</code> 经既有状态机记为已验收。
          </p>
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(245,158,11,0.45)",
              background: "rgba(245,158,11,0.1)",
              color: "#92400e",
              fontSize: 12,
            }}
          >
            <div><strong>确认对象：</strong>{improvement.displayId}「{improvement.title}」</div>
            <div style={{ marginTop: 4 }}><strong>结果：</strong>用户验收通过；若全部改进已解决，主任务回到 review 再次验收，不会自动完成。</div>
          </div>
        </div>
      ) as ReactNode,
      confirmLabel: "确认改进已完成",
      cancelLabel: "暂不验收",
      intent: "danger",
    });
    if (!confirmed) return;

    acceptingInFlightRef.current = true;
    setAcceptingKey(`${taskKey}:${improvement.id}`);
    try {
      const res = await fetch(`/api/studio/tasks/${encodeURIComponent(taskKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          action: "transition_improvement",
          improvementId: improvement.id,
          to: "accepted",
          contextId,
          reason: "User accepted from session widget",
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `验收失败（HTTP ${res.status}）`);
      }
      toast({
        message: `已确认 ${improvement.displayId} 完成；主任务将按状态机 reconcile，不会自动 completed。`,
        tone: "success",
      });
      onTaskChanged?.(taskKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ message: `改进验收失败：${message}`, tone: "error" });
      // Refresh so a race (already accepted elsewhere) does not leave a stale accept button.
      onTaskChanged?.(taskKey);
    } finally {
      acceptingInFlightRef.current = false;
      setAcceptingKey(null);
    }
  }, [confirm, contextId, cwd, onTaskChanged, toast]);

  // Drop stale modal targets when session tasks or authorized cwd change.
  useEffect(() => {
    if (!planReviewTarget) return;
    if (!cwd?.trim()) {
      setPlanReviewTarget(null);
      return;
    }
    const stillVisible = tasks.some((candidate) => candidate.task.key === planReviewTarget.taskKey);
    if (!stillVisible) setPlanReviewTarget(null);
  }, [cwd, planReviewTarget, tasks]);

  const panelRef = useRef<HTMLElement | null>(null);
  const ballRef = useRef<HTMLDivElement | null>(null);
  const panelDragRef = useRef<DragState | null>(null);
  const ballDragRef = useRef<DragState | null>(null);
  const panelPosRef = useRef<WidgetPosition | null>(null);
  const ballPosRef = useRef<WidgetPosition | null>(null);
  const previousBallUrgencyRef = useRef<BallUrgency | null>(null);

  // Keep refs in sync with state
  useEffect(() => { panelPosRef.current = panelPosition; }, [panelPosition]);
  useEffect(() => { ballPosRef.current = ballPosition; }, [ballPosition]);

  // Persist expanded state
  useEffect(() => { writeExpandedState(expanded); }, [expanded]);

  // Sort candidates for display: needs_user > failed/blocked > running/queued > current > updatedAt
  const sortedCandidates = useMemo(() => {
    const rank = (c: YpiStudioSessionTaskLinkCandidate): number => {
      const rt = c.task.implementationProjection?.sessionRuntime?.status;
      if (rt === "needs_user") return 0;
      const counts = c.task.implementationProjection?.statusCounts;
      if (counts && (counts.failed > 0 || counts.blocked > 0)) return 1;
      if (c.task.subagents.some((r) => r.status === "running" || r.status === "queued" || r.status === "waiting_for_user")) return 2;
      if (rt && rt !== "idle" && rt !== "completed") return 3;
      if (c.task.implementationProjection?.statusCounts && (c.task.implementationProjection.statusCounts.queued > 0 || c.task.implementationProjection.statusCounts.running > 0)) return 3;
      if (c.current) return 4;
      if (c.primary) return 5;
      return 10;
    };
    return [...tasks].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return new Date(b.task.updatedAt).getTime() - new Date(a.task.updatedAt).getTime();
    });
  }, [tasks]);

  // Pre-compute merged runs per candidate
  const candidateRuns = useMemo(() => {
    const map = new Map<string, YpiStudioTaskWidgetSubagentRun[]>();
    for (const c of sortedCandidates) {
      map.set(c.task.key, mergeRuns(c.task, liveOverlays));
    }
    return map;
  }, [sortedCandidates, liveOverlays]);

  const ballUrgency = useMemo(() => computeBallUrgency(tasks), [tasks]);
  const ballColors = ballColor(ballUrgency);

  // Attention rings are finite and only restart when the underlying urgency changes.
  useEffect(() => {
    const previous = previousBallUrgencyRef.current;
    if (previous !== null && previous !== ballUrgency && (ballUrgency === "needs_user" || ballUrgency === "failed")) {
      setAttentionSequence((sequence) => sequence + 1);
    }
    previousBallUrgencyRef.current = ballUrgency;
  }, [ballUrgency]);

  // ── Panel position management ──
  useEffect(() => {
    if (isMobile) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;

    const fallback = {
      left: Math.max(DEFAULT_MARGIN, parent.clientWidth - 376 - DEFAULT_MARGIN),
      top: DEFAULT_MARGIN,
    };
    const clampLatest = (latest: WidgetPosition | null) =>
      clampPosition(latest ?? readPosition(EXPANDED_POSITION_KEY) ?? fallback, parent, panel);
    setPanelPosition(clampLatest);

    const observer = new ResizeObserver(() => {
      setPanelPosition(clampLatest);
    });
    observer.observe(parent);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [expanded, isMobile, tasks.length]); // Re-run when the mounted panel or its content size changes.

  // ── Ball position management ──
  useEffect(() => {
    if (isMobile) return;
    const ball = ballRef.current;
    const parent = ball?.parentElement;
    if (!ball || !parent) return;

    const fallback = {
      left: Math.max(DEFAULT_MARGIN, parent.clientWidth - 66 - DEFAULT_MARGIN),
      top: DEFAULT_MARGIN,
    };
    const clampLatest = (latest: WidgetPosition | null) =>
      clampPosition(latest ?? readPosition(BALL_POSITION_KEY) ?? fallback, parent, ball);
    setBallPosition(clampLatest);

    const observer = new ResizeObserver(() => {
      setBallPosition(clampLatest);
    });
    observer.observe(parent);
    observer.observe(ball);
    return () => observer.disconnect();
  }, [expanded, isMobile, tasks.length]);

  // ── Panel drag handlers ──
  const handlePanelPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (isMobile || event.button !== 0) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const rect = panel.getBoundingClientRect();
    panelDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    panel.setPointerCapture(event.pointerId);
  }, [isMobile]);

  const handlePanelPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !panel || !parent) return;
    if (!drag.dragged && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return;

    drag.dragged = true;
    const rect = parent.getBoundingClientRect();
    setPanelPosition(clampPosition(
      { left: event.clientX - rect.left - drag.offsetX, top: event.clientY - rect.top - drag.offsetY },
      parent,
      panel,
    ));
    setDragging(true);
  }, []);

  const finishPanelDrag = useCallback((event: PointerEvent<HTMLElement>, persist: boolean) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (panelRef.current?.hasPointerCapture(event.pointerId)) {
      panelRef.current.releasePointerCapture(event.pointerId);
    }
    if (persist && drag.dragged && panelPosRef.current) {
      writePosition(EXPANDED_POSITION_KEY, panelPosRef.current);
    }
    setDragging(false);
    panelDragRef.current = null;
  }, []);

  const handlePanelPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    finishPanelDrag(event, true);
  }, [finishPanelDrag]);

  const handlePanelPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    finishPanelDrag(event, false);
  }, [finishPanelDrag]);

  // ── Ball drag handlers ──
  const handleBallPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (isMobile || event.button !== 0) return;
    const ball = ballRef.current;
    const parent = ball?.parentElement;
    if (!ball || !parent) return;
    const rect = ball.getBoundingClientRect();
    ballDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    ball.setPointerCapture(event.pointerId);
  }, [isMobile]);

  const handleBallPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = ballDragRef.current;
    const ball = ballRef.current;
    const parent = ball?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !ball || !parent) return;
    if (!drag.dragged && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return;

    drag.dragged = true;
    const rect = parent.getBoundingClientRect();
    setBallPosition(clampPosition(
      { left: event.clientX - rect.left - drag.offsetX, top: event.clientY - rect.top - drag.offsetY },
      parent,
      ball,
    ));
    setBallDragging(true);
  }, []);

  const finishBallDrag = useCallback((event: PointerEvent<HTMLElement>, persist: boolean) => {
    const drag = ballDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (ballRef.current?.hasPointerCapture(event.pointerId)) {
      ballRef.current.releasePointerCapture(event.pointerId);
    }
    if (persist && drag.dragged && ballPosRef.current) {
      writePosition(BALL_POSITION_KEY, ballPosRef.current);
    }
    const wasDragged = drag.dragged;
    setBallDragging(false);
    ballDragRef.current = null;
    // Only a completed light press restores the panel; cancelled gestures never do.
    if (persist && !wasDragged) setExpanded(true);
  }, []);

  const handleBallPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    finishBallDrag(event, true);
  }, [finishBallDrag]);

  const handleBallPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    finishBallDrag(event, false);
  }, [finishBallDrag]);

  // ── Clamp on window resize ──
  useEffect(() => {
    if (isMobile) return;
    const handleResize = () => {
      const panel = panelRef.current;
      const ball = ballRef.current;
      const parent = panel?.parentElement ?? ball?.parentElement;
      if (!parent) return;
      if (panel) setPanelPosition((prev) => prev ? clampPosition(prev, parent, panel) : null);
      if (ball) setBallPosition((prev) => prev ? clampPosition(prev, parent, ball) : null);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  const planReviewModal = (
    <YpiStudioPlanReviewModal
      open={Boolean(planReviewTarget) && Boolean(cwd?.trim())}
      cwd={cwd ?? ""}
      target={planReviewTarget}
      onClose={handleClosePlanReview}
      onOpenFile={onOpenFile}
    />
  );

  // A bound task is the sole rendering prerequisite. Drawer focus must not hide
  // or rewrite the user-selected expanded/collapsed presentation.
  if (tasks.length === 0) return null;

  // ═══════════════════════════════════════════
  // Mobile
  // ═══════════════════════════════════════════
  if (isMobile) {
    const primary = sortedCandidates[0];
    const primaryTask = primary?.task;
    const pillLabel = primaryTask
      ? `工 Studio ${primaryTask.progress}% · ${primaryTask.status === "waiting_for_improvements" ? "等待改进完成" : (primaryTask.currentMember ?? primaryTask.statusLabel)}`
      : `工 Studio (${tasks.length})`;

    return (
      <>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          style={{
            position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", zIndex: 250,
            border: `1px solid ${ballUrgency === "needs_user" ? "#f59e0b" : "var(--border)"}`,
            background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
            color: "var(--text)", borderRadius: 999, padding: "7px 16px",
            fontSize: 12, fontWeight: 800,
            boxShadow: `0 10px 30px rgba(0,0,0,0.18)${ballUrgency === "needs_user" ? ", 0 0 0 3px rgba(245,158,11,0.3)" : ""}`,
            backdropFilter: "blur(10px)",
          }}
        >
          {pillLabel}
          {tasks.length > 1 && (
            <span style={{
              marginLeft: 6, background: ballUrgency === "needs_user" ? "#f59e0b" : "var(--accent)",
              color: "white", borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 900,
            }}>
              {tasks.length}
            </span>
          )}
        </button>

        {mobileOpen && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end" }}
            onClick={() => setMobileOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%", maxHeight: "78vh", overflowY: "auto",
                borderTopLeftRadius: 16, borderTopRightRadius: 16,
                border: "1px solid var(--border)", background: "var(--bg)",
                boxShadow: "0 -16px 40px rgba(0,0,0,0.22)",
              }}
            >
              <div style={{ padding: "12px 14px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 700 }}>
                  YPI Studio ({tasks.length})
                </span>
                <button
                  onClick={() => setMobileOpen(false)}
                  style={{
                    padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)",
                    background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  关闭
                </button>
              </div>
              <div style={{ paddingBottom: 12 }}>
                {sortedCandidates.map((c) => (
                  <TaskCard
                    key={c.task.key}
                    candidate={c}
                    runs={candidateRuns.get(c.task.key) ?? []}
                    isPrimary={c.task.key === primaryTaskKey}
                    onOpen={() => { onOpenTask(c.task.key); setMobileOpen(false); }}
                    onPreviewPlan={handlePreviewPlan}
                    onOpenPrototype={handleOpenPrototype}
                    onAcceptImprovement={(improvement) => {
                      void handleAcceptImprovement(c.task.key, improvement);
                    }}
                    acceptingImprovementId={
                      acceptingKey?.startsWith(`${c.task.key}:`)
                        ? acceptingKey.slice(c.task.key.length + 1)
                        : null
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {planReviewModal}
      </>
    );
  }

  // ═══════════════════════════════════════════
  // Desktop — Collapsed: Floating Ball
  // ═══════════════════════════════════════════
  if (!expanded) {
    return (
      <>
        <div
          ref={ballRef}
          role="button"
          tabIndex={0}
          aria-label={`打开 YPI Studio 任务面板（${tasks.length} 个任务，${ballUrgency === "needs_user" ? "需要处理" : ballUrgency === "failed" ? "存在失败或阻塞" : ballUrgency === "running" ? "正在运行" : "空闲"}）`}
          onPointerDown={handleBallPointerDown}
          onPointerMove={handleBallPointerMove}
          onPointerUp={handleBallPointerUp}
          onPointerCancel={handleBallPointerCancel}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(true); } }}
          className={`ypi-studio-widget-ball-shell${ballDragging ? " is-dragging" : ""}`}
          style={{
            position: "absolute",
            zIndex: 250,
            width: 48, height: 48,
            left: ballPosition?.left,
            top: ballPosition?.top,
            cursor: ballDragging ? "grabbing" : "grab",
            // Position and drag feedback belong to the shell; visual animation is inside BallVisual.
            transform: ballDragging ? "scale(1.06)" : "scale(1)",
            border: "none",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          <BallVisual
            urgency={ballUrgency}
            taskCount={tasks.length}
            colors={ballColors}
            dragging={ballDragging}
            attentionSequence={attentionSequence}
          />
        </div>
        {planReviewModal}
      </>
    );
  }

  // ═══════════════════════════════════════════
  // Desktop — Expanded: Card Stack Panel
  // ═══════════════════════════════════════════
  return (
    <aside
      ref={panelRef}
      role="region"
      aria-label="YPI Studio 任务面板"
      onPointerMove={handlePanelPointerMove}
      onPointerUp={handlePanelPointerUp}
      onPointerCancel={handlePanelPointerCancel}
      style={{
        position: "absolute",
        zIndex: 250,
        width: 360,
        maxWidth: "calc(100% - 36px)",
        left: panelPosition?.left,
        top: panelPosition?.top,
      }}
    >
      <div className={`ypi-studio-widget-panel-visual${dragging ? " is-dragging" : ""}`}>
      {/* Header — drag handle */}
      <div
        onPointerDown={handlePanelPointerDown}
        style={{
          padding: "8px 12px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: dragging ? "grabbing" : "grab",
          flexShrink: 0,
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          ⚡ YPI Studio ({tasks.length})
        </span>
        <button
          type="button"
          aria-label="收纳为悬浮球"
          title="收纳为悬浮球"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          style={{
            width: 22, height: 22, lineHeight: "18px", borderRadius: 5,
            border: "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
            background: "color-mix(in srgb, var(--bg) 60%, transparent)",
            color: "var(--text-dim)", cursor: "pointer", fontSize: 12, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: 0.75,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.background = "color-mix(in srgb, var(--bg) 60%, transparent)"; }}
        >
          ➖
        </button>
      </div>

      {/* Body — scrollable card list */}
      <div
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          minHeight: 0,
        }}
      >
        {sortedCandidates.map((c) => (
          <TaskCard
            key={c.task.key}
            candidate={c}
            runs={candidateRuns.get(c.task.key) ?? []}
            isPrimary={c.task.key === primaryTaskKey}
            onOpen={() => onOpenTask(c.task.key)}
            onPreviewPlan={handlePreviewPlan}
            onOpenPrototype={handleOpenPrototype}
            onAcceptImprovement={(improvement) => {
              void handleAcceptImprovement(c.task.key, improvement);
            }}
            acceptingImprovementId={
              acceptingKey?.startsWith(`${c.task.key}:`)
                ? acceptingKey.slice(c.task.key.length + 1)
                : null
            }
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: "6px 12px",
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border)",
        fontSize: 10,
        color: "var(--text-muted)",
        textAlign: "center",
        flexShrink: 0,
      }}>
        共绑定 {tasks.length} 个任务 · 仅展示绑定当前会话的 Task
      </div>
      </div>
      {planReviewModal}
    </aside>
  );
}
