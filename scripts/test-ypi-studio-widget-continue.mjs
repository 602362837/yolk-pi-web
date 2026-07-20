/**
 * Tests for ypi-studio-widget-continue pure helper:
 * - ypiStudioWidgetActionNeedsChatContinue matrix
 * - buildYpiStudioWidgetChatContinuePrompt shape / invariants
 */
import assert from "node:assert/strict";

import {
  ypiStudioWidgetActionNeedsChatContinue,
  buildYpiStudioWidgetChatContinuePrompt,
} from "../lib/ypi-studio-widget-continue.ts";

// ── needsChatContinue matrix ──

{
  // True for continue kinds
  assert.equal(ypiStudioWidgetActionNeedsChatContinue("approve_plan"), true);
  assert.equal(ypiStudioWidgetActionNeedsChatContinue("request_plan_changes"), true);
  assert.equal(ypiStudioWidgetActionNeedsChatContinue("approve_improvement_plan"), true);

  // False for non-continue kinds
  assert.equal(ypiStudioWidgetActionNeedsChatContinue("start_user_acceptance"), false);
  // Completed CTAs: return is PATCH-only; studio_archive is Chat Send-only (not post-PATCH continue).
  assert.equal(ypiStudioWidgetActionNeedsChatContinue("return_to_user_acceptance"), false);
  assert.equal(ypiStudioWidgetActionNeedsChatContinue("studio_archive"), false);

  // Type-level: the type-guard narrows correctly — no runtime assertion needed
  // but we verify the boolean return matches the set.
}

// ── Prompt builder: structural invariants (shared across all kinds) ──

function assertPromptInvariants(prompt) {
  assert.equal(typeof prompt, "string");
  assert.ok(prompt.length > 0);
  // Must not contain HTML tags
  assert.ok(!/<[a-zA-Z]/.test(prompt), `prompt must not contain HTML tags: ${prompt.slice(0, 200)}`);
  assert.ok(!/<\/[a-zA-Z]/.test(prompt), `prompt must not contain closing HTML tags: ${prompt.slice(0, 200)}`);
  // Must not contain http(s) endpoints
  assert.ok(!/https?:\/\//.test(prompt), `prompt must not contain URLs: ${prompt.slice(0, 200)}`);
  // Must be under 4000 chars
  assert.ok(prompt.length <= 4000, `prompt too long: ${prompt.length}`);
}

// ── approve_plan ──

{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "approve_plan",
    taskId: "20260718-test-task",
    taskKey: "20260718-test-task-title",
    expectedRevision: 3,
    targetLabel: "测试任务·浮窗决策 CTA 改为 Chat Send 续推并在工作中禁用",
  });
  assertPromptInvariants(prompt);
  assert.ok(prompt.includes("taskId: 20260718-test-task"));
  assert.ok(prompt.includes("action: approve_plan"));
  assert.ok(prompt.includes("expectedRevision: 3"));
  assert.ok(prompt.includes("taskKey: 20260718-test-task-title"));
  assert.ok(prompt.includes("widget approve_plan persisted"));
  assert.ok(prompt.includes("不要伪造额外批准"));
  assert.ok(prompt.includes("maxConcurrency"));
  // Should not mention improvement or feedback
  assert.ok(!prompt.includes("improvementId"));
  assert.ok(!prompt.includes("feedbackSummary"));
}

// Minimal approve_plan
{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "approve_plan",
    taskId: "task-minimal",
    expectedRevision: 1,
  });
  assertPromptInvariants(prompt);
  assert.ok(prompt.includes("taskId: task-minimal"));
  assert.ok(prompt.includes("expectedRevision: 1"));
  assert.ok(!prompt.includes("taskKey:"));
}

// ── request_plan_changes (with and without feedback) ──

{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "request_plan_changes",
    taskId: "20260718-rc-task",
    expectedRevision: 2,
    revisionTo: 3,
    feedback: "计划需要更详细的错误处理策略，并且应该补充安全审查步骤。用户的系统涉及敏感数据，需要提供审计日志方案。另外 UI 原型需要对齐现有的设计系统组件库，不要引入新的颜色或间距变量。建议使用已有的 DecisionCard 和 TaskAction 组件来复用交互逻辑，减少重复代码。",
    targetLabel: "请求修改任务",
  });
  assertPromptInvariants(prompt);
  assert.ok(prompt.includes("taskId: 20260718-rc-task"));
  assert.ok(prompt.includes("action: request_plan_changes"));
  assert.ok(prompt.includes("revisionFrom: 2"));
  assert.ok(prompt.includes("revisionTo: 3"));
  assert.ok(prompt.includes("widget request_plan_changes persisted"));
  assert.ok(prompt.includes("feedbackSummary:"));
  // feedback truncated to ≤200 chars
  const fbStart = prompt.indexOf("feedbackSummary: ");
  const fbLine = prompt.slice(fbStart).split("\n")[0];
  const fbValue = fbLine.slice("feedbackSummary: ".length);
  assert.ok(fbValue.length <= 200, `feedback summary too long: ${fbValue.length}`);
  assert.ok(prompt.includes("勿要求用户再次粘贴"));
  assert.ok(prompt.includes("不要本轮进入 implementing"));
  // Should not contain improvement details
  assert.ok(!prompt.includes("improvementId"));
}

// request_plan_changes without explicit revisionTo
{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "request_plan_changes",
    taskId: "task-no-revto",
    expectedRevision: 5,
  });
  assertPromptInvariants(prompt);
  assert.ok(prompt.includes("revisionFrom: 5"));
  assert.ok(prompt.includes("revisionTo: 5"));
  assert.ok(!prompt.includes("feedbackSummary:"));
}

// request_plan_changes without feedback
{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "request_plan_changes",
    taskId: "task-no-fb",
    expectedRevision: 1,
  });
  assertPromptInvariants(prompt);
  assert.ok(!prompt.includes("feedbackSummary"));
  assert.ok(!prompt.includes("勿要求用户再次粘贴"));
}

// ── approve_improvement_plan ──

{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "approve_improvement_plan",
    taskId: "20260718-imp-task",
    improvementId: "imp-abc-123",
    displayId: "IMP-007",
    expectedRevision: 2,
    targetLabel: "改进：优化错误处理与日志审计",
  });
  assertPromptInvariants(prompt);
  assert.ok(prompt.includes("taskId: 20260718-imp-task"));
  assert.ok(prompt.includes("action: approve_improvement_plan"));
  assert.ok(prompt.includes("improvementId: imp-abc-123"));
  assert.ok(prompt.includes("displayId: IMP-007"));
  assert.ok(prompt.includes("expectedRevision: 2"));
  assert.ok(prompt.includes("widget approve_improvement_plan persisted"));
  assert.ok(prompt.includes("不要误批主任务计划"));
  assert.ok(prompt.includes("不要完成/归档主任务"));
  // Should not mention feedback
  assert.ok(!prompt.includes("feedbackSummary"));
}

// approve_improvement_plan without displayId
{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "approve_improvement_plan",
    taskId: "task-imp-no-display",
    improvementId: "imp-no-display",
    expectedRevision: 1,
  });
  assertPromptInvariants(prompt);
  // Falls back to improvementId
  assert.ok(prompt.includes("displayId: imp-no-display"));
}

// ── Edge: feedback exactly at limit ──

{
  const longFeedback = "A".repeat(200);
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "request_plan_changes",
    taskId: "task-edge",
    expectedRevision: 1,
    revisionTo: 2,
    feedback: longFeedback,
  });
  assertPromptInvariants(prompt);
  const fbStart = prompt.indexOf("feedbackSummary: ");
  const fbLine = prompt.slice(fbStart).split("\n")[0];
  const fbValue = fbLine.slice("feedbackSummary: ".length);
  assert.equal(fbValue.length, 200);
}

// Edge: feedback just over the limit
{
  const overFeedback = "B".repeat(250);
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "request_plan_changes",
    taskId: "task-edge-over",
    expectedRevision: 1,
    revisionTo: 2,
    feedback: overFeedback,
  });
  assertPromptInvariants(prompt);
  const fbStart = prompt.indexOf("feedbackSummary: ");
  const fbLine = prompt.slice(fbStart).split("\n")[0];
  const fbValue = fbLine.slice("feedbackSummary: ".length);
  assert.equal(fbValue.length, 200, `expected truncated to 200, got ${fbValue.length}`);
}

// Edge: whitespace-only feedback → no feedbackSummary line
{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "request_plan_changes",
    taskId: "task-ws-fb",
    expectedRevision: 1,
    feedback: "   ",
  });
  assertPromptInvariants(prompt);
  assert.ok(!prompt.includes("feedbackSummary"));
}

// ── TaskKey propagation ──

{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "approve_plan",
    taskId: "tk-task",
    taskKey: "tk-key-slug",
    expectedRevision: 1,
  });
  assert.ok(prompt.includes("taskKey: tk-key-slug"));
}

{
  const prompt = buildYpiStudioWidgetChatContinuePrompt({
    kind: "approve_improvement_plan",
    taskId: "tk-imp-task",
    taskKey: "tk-imp-key",
    improvementId: "imp-tk",
    expectedRevision: 1,
  });
  assert.ok(prompt.includes("taskKey: tk-imp-key"));
}

console.log("ypi-studio-widget-continue tests passed");
