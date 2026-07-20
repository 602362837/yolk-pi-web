/**
 * Pure helpers for widget-decision → Chat Send continuation.
 *
 * Separated from session-link and rpc-manager to avoid circular dependencies.
 * All exports are side-effect-free functions suitable for React components,
 * test scripts, and server helpers alike.
 */

import type { YpiStudioWidgetUserActionKind } from "./ypi-studio-types";

// ── Kinds that need Chat Send after a successful PATCH ──

/** Union of widget decision kinds that must trigger a Chat Send continuation. */
export type YpiStudioWidgetContinueKind = Extract<
  YpiStudioWidgetUserActionKind,
  "approve_plan" | "request_plan_changes" | "approve_improvement_plan"
>;

const CONTINUE_KINDS: ReadonlySet<YpiStudioWidgetUserActionKind> = new Set([
  "approve_plan",
  "request_plan_changes",
  "approve_improvement_plan",
]);

/**
 * Type-guard: returns true when the given widget user-action kind requires
 * a Chat Send continuation after the PATCH succeeds.
 */
export function ypiStudioWidgetActionNeedsChatContinue(
  kind: YpiStudioWidgetUserActionKind,
): kind is YpiStudioWidgetContinueKind {
  return CONTINUE_KINDS.has(kind);
}

// ── Prompt builder ──

export interface YpiStudioWidgetChatContinuePromptInput {
  kind: YpiStudioWidgetContinueKind;
  taskId: string;
  taskKey?: string;
  expectedRevision: number;
  /** Only for request_plan_changes: revision after the bump. */
  revisionTo?: number;
  /** Only for approve_improvement_plan. */
  improvementId?: string;
  displayId?: string;
  /**
   * Already-persisted feedback (request_plan_changes). Truncated to ≤200
   * characters in the prompt to keep the Chat message bounded.
   */
  feedback?: string;
  /** Optional display label for the target (e.g. task title, improvement title). */
  targetLabel?: string;
}

/**
 * Maximum characters of persisted feedback carried into the Chat prompt.
 * The full feedback is already on disk; this is only a human-visible summary.
 */
const FEEDBACK_TRUNCATE_LEN = 200;

/**
 * Build a fixed, machine-auditable Chat user-message for widget decision
 * continuation. The prompt is pure text; it never contains HTML, URLs, file
 * paths, or secret material.
 *
 * Semantics are locked to the Hybrid B contract (PRD §3.2). Callers MUST
 * have already persisted the decision via PATCH before calling this function;
 * this builder only produces text — it does NOT perform any side effect.
 */
export function buildYpiStudioWidgetChatContinuePrompt(
  input: YpiStudioWidgetChatContinuePromptInput,
): string {
  const feedbackSummary = input.feedback
    ? input.feedback.trim().slice(0, FEEDBACK_TRUNCATE_LEN)
    : undefined;

  switch (input.kind) {
    case "approve_plan":
      return buildApprovePlanPrompt(input);
    case "request_plan_changes":
      return buildRequestPlanChangesPrompt(input, feedbackSummary);
    case "approve_improvement_plan":
      return buildApproveImprovementPlanPrompt(input);
    default: {
      // Exhaustive check: CONTINUE_KINDS covers all three; this branch is
      // unreachable at runtime.  Included for type-narrowing robustness.
      const _exhaustive: never = input.kind;
      throw new Error(`Unsupported continue kind: ${_exhaustive}`);
    }
  }
}

// ── Per-kind builders ──

function buildApprovePlanPrompt(
  input: YpiStudioWidgetChatContinuePromptInput,
): string {
  return [
    "YPI Studio 用户已在会话浮窗批准主任务计划（source=user-widget）。该决定已落库：status 应为 implementing，approvalGrant 已写入。",
    "请继续自动编排，不要等待用户再次输入批准文案。",
    "",
    `- taskId: ${input.taskId}`,
    `- action: approve_plan`,
    `- expectedRevision: ${input.expectedRevision}`,
    input.targetLabel ? `- target: ${truncateTarget(input.targetLabel)}` : undefined,
    "- reason: widget approve_plan persisted; continue implementing orchestration",
    input.taskKey ? `- taskKey: ${input.taskKey}` : undefined,
    "",
    "请：ypi_studio_task(current/get) 确认状态 → 按 implementationPlan 执行 implementation_next/claim 并派发 implementer（遵守 maxConcurrency）→ 不要伪造额外批准。",
  ].filter(Boolean).join("\n");
}

function buildRequestPlanChangesPrompt(
  input: YpiStudioWidgetChatContinuePromptInput,
  feedbackSummary?: string,
): string {
  const revFrom =
    typeof input.revisionTo === "number" && input.revisionTo > input.expectedRevision
      ? input.revisionTo - 1
      : input.expectedRevision;
  const revTo = input.revisionTo ?? input.expectedRevision;

  return [
    "YPI Studio 用户已在会话浮窗请求修改计划。该决定已落库（status=planning，旧 grant 已清除，planRevision 已提升）。请继续自动重跑架构规划。",
    "",
    `- taskId: ${input.taskId}`,
    `- action: request_plan_changes`,
    `- revisionFrom: ${revFrom}`,
    `- revisionTo: ${revTo}`,
    feedbackSummary ? `- feedbackSummary: ${feedbackSummary}` : undefined,
    "- reason: widget request_plan_changes persisted; wake architect planning",
    input.taskKey ? `- taskKey: ${input.taskKey}` : undefined,
    "",
    feedbackSummary
      ? `以任务事件/产物中的完整 feedback 为准，勿要求用户再次粘贴。请更新规划产物与 plan-review，保存 implementationPlan，transition 到 awaiting_approval 后停止；不要本轮进入 implementing。`
      : "请更新规划产物与 plan-review，保存 implementationPlan，transition 到 awaiting_approval 后停止；不要本轮进入 implementing。",
  ].filter(Boolean).join("\n");
}

function buildApproveImprovementPlanPrompt(
  input: YpiStudioWidgetChatContinuePromptInput,
): string {
  const display = input.displayId ?? input.improvementId ?? "(unknown)";

  return [
    "YPI Studio 用户已在会话浮窗批准改进计划（source=user-widget）。该改进实例应已进入 implementing；主任务保持 waiting_for_improvements。",
    "",
    `- taskId: ${input.taskId}`,
    `- action: approve_improvement_plan`,
    `- improvementId: ${input.improvementId ?? "(missing)"}`,
    `- displayId: ${display}`,
    `- expectedRevision: ${input.expectedRevision}`,
    input.targetLabel ? `- target: ${truncateTarget(input.targetLabel)}` : undefined,
    "- reason: widget approve_improvement_plan persisted; continue instance DAG",
    input.taskKey ? `- taskKey: ${input.taskKey}` : undefined,
    "",
    "请仅推进该 improvement 的 instance plan（claim/dispatch），不要误批主任务计划，不要完成/归档主任务。",
  ].filter(Boolean).join("\n");
}

// ── Internal helpers ──

function truncateTarget(label: string, max = 120): string {
  return label.length <= max ? label : label.slice(0, max - 1) + "…";
}
