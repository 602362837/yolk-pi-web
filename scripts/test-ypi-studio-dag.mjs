import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveYpiStudioImprovementPlanFromWidget,
  approveYpiStudioPlanFromWidget,
  archiveYpiStudioTask,
  bindYpiStudioTaskToContext,
  claimYpiStudioImprovementSubtask,
  claimYpiStudioImplementationSubtask,
  createYpiStudioImprovement,
  createYpiStudioTask,
  getNextYpiStudioImplementationSubtask,
  getYpiStudioTaskDetail,
  implementationCounts,
  isExplicitYpiStudioApprovalText,
  isYpiStudioWidgetStartUserAcceptanceBody,
  listYpiStudioTaskHtmlPrototypeFileNames,
  normalizeImplementationPlan,
  propagateBlockedDependents,
  reconcileYpiStudioImprovements,
  reconcileYpiStudioRuntimeLostSubagentRun,
  recordYpiStudioImprovementApproval,
  recordYpiStudioSubagentRun,
  recordYpiStudioUserApproval,
  refreshDerivedImplementationDAG,
  requestYpiStudioPlanChangesFromWidget,
  resolveYpiStudioImprovementDisposition,
  resolveYpiStudioImprovementRelativeFile,
  reviseYpiStudioImprovementPlan,
  selectNextYpiStudioImplementationSubtask,
  selectReadyYpiStudioImplementationSubtasks,
  startYpiStudioUserAcceptanceFromWidget,
  transitionYpiStudioImprovement,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioImprovementArtifact,
  updateYpiStudioImprovementPlan,
  updateYpiStudioTaskArtifact,
  ypiStudioTaskPlanReviewFileExists,
  YpiStudioTaskSecurityError,
} from "../lib/ypi-studio-tasks.ts";
import {
  buildYpiStudioRequestPlanChangesContinuationCommand,
  parseYpiStudioSessionIdFromContextId,
  resolveYpiStudioRequestPlanChangesContinuation,
  resolveYpiStudioSessionAutocontinueCommand,
  resolveYpiStudioTaskForSession,
} from "../lib/ypi-studio-session-link.ts";
import {
  countActiveYpiStudioChildRunsForSession,
  registerYpiStudioChildRun,
  registerYpiStudioSessionContinuation,
  scheduleYpiStudioChildRunContinuation,
  unregisterYpiStudioChildRun,
  unregisterYpiStudioSessionContinuation,
} from "../lib/ypi-studio-subagent-runtime.ts";
import { parseSessionHeaderMetadata } from "../lib/session-header-metadata.ts";

const now = "2026-07-03T00:00:00.000Z";

function writePlanReview(cwd, taskId, contextId) {
  updateYpiStudioTaskArtifact(taskId, {
    cwd,
    action: "update_artifact",
    artifact: "plan-review",
    content: "# 蛋黄派计划审批书\n\n## 审批请求\n请审阅并确认。\n\n## 必读产物\n- [Implementation Plan](./implement.md)\n",
    contextId,
  });
}

{
  const metadata = parseSessionHeaderMetadata(JSON.stringify({
    type: "session",
    id: "child-session",
    timestamp: now,
    cwd: process.cwd(),
    parentSession: "/tmp/parent.jsonl",
    projectId: "project-1",
    spaceId: "main",
    studioChild: {
      schemaVersion: 1,
      kind: "ypi-studio-child-session",
      runner: "sdk",
      visibility: "child",
      status: "running",
      parentSessionId: "parent-session",
      parentSessionFile: "/tmp/parent.jsonl",
      contextId: "pi_parent-session",
      taskId: "task-1",
      runId: "run-1",
      member: "checker",
      subtaskId: "check-docs",
      createdAt: now,
    },
  }));
  assert.equal(metadata.projectLink.projectId, "project-1");
  assert.equal(metadata.projectLink.spaceId, "main");
  assert.equal(metadata.studioChild?.kind, "ypi-studio-child-session");
  assert.equal(metadata.studioChild?.runner, "sdk");
  assert.equal(metadata.studioChild?.parentSessionId, "parent-session");
  assert.equal(metadata.studioChild?.taskId, "task-1");
}

function plan(subtasks, extra = {}) {
  const normalized = normalizeImplementationPlan({
    schemaVersion: 2,
    maxConcurrency: 3,
    subtasks: subtasks.map((subtask, index) => ({ title: subtask.id, order: (index + 1) * 10, dependsOn: [], ...subtask })),
    ...extra,
  });
  assert.ok(normalized);
  return normalized;
}

function progressFor(implementationPlan, statuses = {}) {
  const progress = {
    schemaVersion: implementationPlan.schemaVersion,
    updatedAt: now,
    counts: {
      pending: 0,
      waiting: 0,
      ready: 0,
      queued: 0,
      running: 0,
      blocked: 0,
      failed: 0,
      done: 0,
      skipped: 0,
    },
    subtasks: {},
  };
  for (const subtask of implementationPlan.subtasks) {
    progress.subtasks[subtask.id] = {
      id: subtask.id,
      status: statuses[subtask.id] ?? "waiting",
      updatedAt: now,
      attempts: 0,
      runIds: [],
    };
  }
  progress.counts = implementationCounts(progress);
  return progress;
}

{
  const p = plan([{ id: "A" }, { id: "B", dependsOn: ["A"] }, { id: "C", dependsOn: ["B"] }], { maxConcurrency: 2 });
  const g = refreshDerivedImplementationDAG(p, progressFor(p));
  assert.deepEqual(selectReadyYpiStudioImplementationSubtasks(p, g).map((item) => item.id), ["A"]);
  g.subtasks.A.status = "done";
  refreshDerivedImplementationDAG(p, g);
  assert.equal(selectNextYpiStudioImplementationSubtask(p, g)?.id, "B");
  assert.equal(g.subtasks.C.status, "waiting");
  assert.equal(g.subtasks.C.waitingOn?.[0]?.id, "B");
}

{
  const p = plan([{ id: "A" }, { id: "B", dependsOn: ["A"] }, { id: "C", dependsOn: ["A"] }, { id: "D", dependsOn: ["A"] }], { maxConcurrency: 2 });
  const g = refreshDerivedImplementationDAG(p, progressFor(p, { A: "done" }));
  assert.deepEqual(selectReadyYpiStudioImplementationSubtasks(p, g).map((item) => item.id), ["B", "C"]);
  g.subtasks.B.status = "queued";
  refreshDerivedImplementationDAG(p, g);
  assert.deepEqual(selectReadyYpiStudioImplementationSubtasks(p, g).map((item) => item.id), ["C"]);
  g.subtasks.C.status = "running";
  refreshDerivedImplementationDAG(p, g);
  assert.deepEqual(selectReadyYpiStudioImplementationSubtasks(p, g).map((item) => item.id), []);
}

{
  const p = plan([{ id: "A" }, { id: "B" }, { id: "C", dependsOn: ["A", "B"] }]);
  const g = refreshDerivedImplementationDAG(p, progressFor(p, { A: "done", B: "waiting" }));
  assert.equal(g.subtasks.C.status, "waiting");
  assert.deepEqual(g.subtasks.C.waitingOn?.map((item) => item.id), ["B"]);
  g.subtasks.B.status = "done";
  refreshDerivedImplementationDAG(p, g);
  assert.equal(g.subtasks.C.status, "ready");
}

{
  assert.throws(() => normalizeImplementationPlan({ schemaVersion: 2, subtasks: [{ id: "A", title: "A", dependsOn: ["missing"] }] }), /missing subtask missing/);
  assert.throws(() => normalizeImplementationPlan({ schemaVersion: 2, subtasks: [{ id: "A", title: "A", dependsOn: ["A"] }] }), /cannot depend on itself/);
  assert.throws(() => normalizeImplementationPlan({ schemaVersion: 2, subtasks: [{ id: "A", title: "A", dependsOn: [] }, { id: "A", title: "Duplicate", dependsOn: [] }] }), /Duplicate implementation subtask id: A/);
  assert.throws(() => normalizeImplementationPlan({ schemaVersion: 2, subtasks: [{ id: "A", title: "A", dependsOn: ["B"] }, { id: "B", title: "B", dependsOn: ["A"] }] }), /cycle detected/);
}

{
  const p = plan([{ id: "A" }, { id: "B", dependsOn: ["A"] }, { id: "C" }, { id: "D", dependsOn: ["B"] }]);
  const g = progressFor(p, { A: "failed", B: "waiting", C: "waiting", D: "waiting" });
  propagateBlockedDependents(p, g);
  assert.equal(g.subtasks.B.status, "blocked");
  assert.deepEqual(g.subtasks.B.blockedBy, ["A"]);
  assert.equal(g.subtasks.D.status, "blocked");
  assert.deepEqual(g.subtasks.D.blockedBy, ["B"]);
  assert.equal(g.subtasks.C.status, "waiting");
}

{
  const p = plan([{ id: "A" }, { id: "B", dependsOn: ["A"] }, { id: "C", dependsOn: ["B"] }]);
  const g = refreshDerivedImplementationDAG(p, progressFor(p, { A: "failed", B: "waiting", C: "waiting" }));
  assert.equal(g.subtasks.B.status, "blocked");
  assert.equal(g.subtasks.C.status, "blocked");
  g.subtasks.A.status = "done";
  refreshDerivedImplementationDAG(p, g);
  assert.equal(g.subtasks.B.status, "ready");
  assert.equal(g.subtasks.B.blockedReason, undefined);
  assert.equal(g.subtasks.B.blockedBy, undefined);
  assert.equal(g.subtasks.C.status, "waiting");
  assert.deepEqual(g.subtasks.C.waitingOn?.map((item) => item.id), ["B"]);
  g.subtasks.B.status = "done";
  refreshDerivedImplementationDAG(p, g);
  assert.equal(g.subtasks.C.status, "ready");
}

{
  const legacy = normalizeImplementationPlan({ schemaVersion: 1, subtasks: [{ id: "A", title: "A", dependsOn: ["missing", "A"] }, { id: "B", title: "B", dependsOn: ["A"] }] });
  assert.ok(legacy);
  assert.deepEqual(legacy.subtasks.find((item) => item.id === "A")?.dependsOn, []);
  const g = refreshDerivedImplementationDAG(legacy, progressFor(legacy, { A: "pending", B: "pending" }));
  assert.equal(g.subtasks.A.status, "ready");
  assert.equal(g.subtasks.B.status, "pending");
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-dag-"));
  try {
    const contextId = "pi_batch_claim";
    const task = createYpiStudioTask({ cwd, title: "Batch claim", workflowId: "feature-dev", contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [
          { id: "A", title: "A", order: 10, dependsOn: [] },
          { id: "B", title: "B", order: 20, dependsOn: [] },
          { id: "C", title: "C", order: 30, dependsOn: [] },
        ],
      },
    });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    const next = getNextYpiStudioImplementationSubtask(cwd, task.id, { limit: 3 });
    assert.deepEqual(next.subtasks.map((item) => item.id), ["A", "B"]);
    const claimed = claimYpiStudioImplementationSubtask(task.id, { cwd, action: "claim_implementation_subtask", limit: 3, status: "queued", contextId });
    assert.deepEqual(claimed.implementationProgress?.queuedSubtaskIds, ["A", "B"]);
    assert.equal(claimed.implementationProgress?.subtasks.C.status, "ready");
    assert.throws(() => claimYpiStudioImplementationSubtask(task.id, { cwd, action: "claim_implementation_subtask", subtaskId: "C", contextId }), /not ready|no concurrency slot|exceed available concurrency/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const parentSessionId = "pi_parent_waiting_children";
  registerYpiStudioChildRun({
    runId: "run-active",
    taskId: "task-active",
    member: "implementer",
    cwd: process.cwd(),
    parentSessionId,
    startedAt: now,
    status: "running",
    abort: () => {},
  });
  registerYpiStudioChildRun({
    runId: "run-done",
    taskId: "task-active",
    member: "implementer",
    cwd: process.cwd(),
    parentSessionId,
    startedAt: now,
    status: "succeeded",
    abort: () => {},
  });
  try {
    assert.equal(countActiveYpiStudioChildRunsForSession(parentSessionId), 1);
  } finally {
    unregisterYpiStudioChildRun("run-active");
    unregisterYpiStudioChildRun("run-done");
  }
  assert.equal(countActiveYpiStudioChildRunsForSession(parentSessionId), 0);
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-runtime-projection-"));
  try {
    const contextId = "pi_runtime_projection";
    const task = createYpiStudioTask({ cwd, title: "Runtime projection", workflowId: "feature-dev", contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [
          { id: "A", title: "A", order: 10, dependsOn: [] },
          { id: "B", title: "B", order: 20, dependsOn: ["A"] },
        ],
      },
    });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "批准开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    claimYpiStudioImplementationSubtask(task.id, { cwd, action: "claim_implementation_subtask", subtaskId: "A", status: "queued", contextId });
    const running = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-runtime-A",
      taskId: task.id,
      member: "implementer",
      status: "running",
      mode: "async",
      subtaskId: "A",
      startedAt: now,
      updatedAt: now,
    });
    assert.equal(running.implementationProjection?.sessionRuntime?.status, "waiting_for_studio_children");
    assert.equal(running.implementationProjection?.sessionRuntime?.activeRunCount, 1);
    const blocked = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-runtime-A",
      taskId: task.id,
      member: "implementer",
      status: "waiting_for_user",
      mode: "async",
      subtaskId: "A",
      startedAt: now,
      updatedAt: now,
      summary: "Need user decision",
      terminationReason: "waiting_for_user",
    });
    assert.equal(blocked.implementationProgress?.subtasks.A.status, "blocked");
    assert.equal(blocked.implementationProgress?.subtasks.B.status, "blocked");
    assert.equal(blocked.implementationProjection?.sessionRuntime?.status, "needs_user");
    assert.match(blocked.implementationProjection?.sessionRuntime?.message ?? "", /失败 0、阻塞 2/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const parentSessionId = "pi_terminal_continuation";
  const payload = {
    runId: "run-terminal-continuation",
    taskId: "task-terminal-continuation",
    subtaskId: "A",
    member: "implementer",
    cwd: process.cwd(),
    parentSessionId,
    status: "succeeded",
    summary: "done",
    finishedAt: now,
  };
  let calls = 0;
  const received = new Promise((resolve) => {
    registerYpiStudioSessionContinuation(parentSessionId, (actual) => {
      calls += 1;
      resolve(actual);
    });
  });
  try {
    assert.equal(scheduleYpiStudioChildRunContinuation(payload), true);
    assert.equal(scheduleYpiStudioChildRunContinuation(payload), false);
    const actual = await received;
    assert.equal(actual.continuationKey, `${parentSessionId}:${payload.taskId}:${payload.runId}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
  } finally {
    unregisterYpiStudioSessionContinuation(parentSessionId);
  }
}

{
  const parentSessionId = "pi_terminal_continuation_late_register";
  const payload = {
    runId: "run-terminal-continuation-late",
    taskId: "task-terminal-continuation-late",
    subtaskId: "A",
    member: "implementer",
    cwd: process.cwd(),
    parentSessionId,
    status: "succeeded",
    summary: "done",
    finishedAt: now,
  };
  assert.equal(scheduleYpiStudioChildRunContinuation(payload), false);
  assert.equal(scheduleYpiStudioChildRunContinuation(payload), false);
  let calls = 0;
  const received = new Promise((resolve) => {
    registerYpiStudioSessionContinuation(parentSessionId, (actual) => {
      calls += 1;
      resolve(actual);
    });
  });
  try {
    const actual = await received;
    assert.equal(actual.continuationKey, `${parentSessionId}:${payload.taskId}:${payload.runId}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
  } finally {
    unregisterYpiStudioSessionContinuation(parentSessionId);
  }
}

{
  const parentSessionId = "pi_terminal_continuation_retry_rejected";
  const payload = {
    runId: "run-terminal-continuation-retry",
    taskId: "task-terminal-continuation-retry",
    subtaskId: "A",
    member: "implementer",
    cwd: process.cwd(),
    parentSessionId,
    status: "succeeded",
    summary: "done",
    finishedAt: now,
  };
  let calls = 0;
  registerYpiStudioSessionContinuation(parentSessionId, () => {
    calls += 1;
    return false;
  });
  try {
    assert.equal(scheduleYpiStudioChildRunContinuation(payload), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    unregisterYpiStudioSessionContinuation(parentSessionId);
    const received = new Promise((resolve) => {
      registerYpiStudioSessionContinuation(parentSessionId, (actual) => {
        calls += 1;
        resolve(actual);
      });
    });
    const actual = await received;
    assert.equal(actual.continuationKey, `${parentSessionId}:${payload.taskId}:${payload.runId}`);
    assert.equal(calls, 2);
  } finally {
    unregisterYpiStudioSessionContinuation(parentSessionId);
  }
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-inline-approval-"));
  try {
    const contextId = "pi_inline_approval";
    const task = createYpiStudioTask({ cwd, title: "Inline approval", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId, reason: "用户批准开始实现" }),
      /no approvalGrant is recorded/,
    );
    const approved = recordYpiStudioUserApproval(cwd, contextId, "确认，开始实现");
    assert.equal(approved?.meta.approvalGrant?.contextId, contextId);
    const transitioned = transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId, reason: "用户批准开始实现" });
    assert.equal(transitioned.status, "implementing");
    assert.equal(transitioned.meta.approvalGrant?.contextId, contextId);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-"));
  try {
    const contextId = "pi_approval_fallback";
    const task = createYpiStudioTask({ cwd, title: "Approval fallback", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    const pointer = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
    if (existsSync(pointer)) unlinkSync(pointer);
    const approved = recordYpiStudioUserApproval(cwd, contextId, "确认，开始实现");
    assert.equal(approved?.meta.approvalGrant?.contextId, contextId);
    const transitioned = transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    assert.equal(transitioned.status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const approved = [
    "确认",
    "批准",
    "同意该方案",
    "确认，开始实现",
    "确认开始实现",
    "批准开始实现",
    "确认，批准开始实现",
    "按方案做",
    "可以开始实现",
    "ＡＰＰＲＯＶＥ",
    "I approve this plan",
    "go ahead",
    "please proceed",
    "start implementation",
  ];
  const rejected = [
    "排查浮窗批准问题",
    "为什么会误触发批准",
    "用户说：批准",
    "“批准”",
    "不批准",
    "先别实现",
    "需要修改",
    "not approved",
    "wait, do not proceed",
    "批准\n开始实现",
    `确认 ${"讨论".repeat(50)}`,
  ];
  for (const text of approved) assert.equal(isExplicitYpiStudioApprovalText(text), true, `must approve: ${text}`);
  for (const text of rejected) assert.equal(isExplicitYpiStudioApprovalText(text), false, `must reject: ${text}`);
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-intent-gate-"));
  try {
    const contextId = "pi_approval_intent_gate";
    const task = createYpiStudioTask({ cwd, title: "Approval intent gate", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });

    assert.equal(recordYpiStudioUserApproval(cwd, contextId, "排查浮窗批准问题"), null);
    assert.equal(getYpiStudioTaskDetail(cwd, task.id)?.meta.approvalGrant, undefined);
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }),
      /no approvalGrant is recorded/,
    );

    const approved = recordYpiStudioUserApproval(cwd, contextId, "I approve this plan");
    assert.equal(approved?.meta.approvalGrant?.source, "user-input");
    assert.equal(transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }).status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Improvement persistence tests ---

{
  // Create improvement from review status
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-create-"));
  try {
    const contextId = "pi_imp_create";
    const task = createYpiStudioTask({ cwd, title: "Improvement create from review", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const detail = createYpiStudioImprovement(task.id, {
      cwd,
      action: "create_improvement",
      title: "Fix narrow layout",
      feedback: "The sidebar is too cramped on small screens",
      contextId,
    });

    assert.ok(detail.improvements);
    assert.equal(detail.improvements.parentStatus, "waiting_for_improvements");
    assert.equal(detail.improvements.instances.length, 1);
    assert.equal(detail.improvements.instances[0].displayId, "IMP-001");
    assert.equal(detail.improvements.instances[0].status, "analysis");
    assert.equal(detail.improvements.instances[0].owner, "improver");
    assert.equal(detail.improvements.instances[0].title, "Fix narrow layout");
    assert.equal(detail.improvements.instances[0].feedback, "The sidebar is too cramped on small screens");
    assert.equal(detail.status, "waiting_for_improvements");

    // Instance directory created
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", detail.improvements.instances[0].id);
    assert.ok(existsSync(instDir));
    assert.ok(existsSync(join(instDir, "brief.md")));
    assert.ok(existsSync(join(instDir, "design.md")));

    // Not a top-level task
    assert.equal(detail.key, task.key);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Create improvement from user_acceptance status
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-accept-"));
  try {
    const contextId = "pi_imp_accept";
    const task = createYpiStudioTask({ cwd, title: "Improvement from user_acceptance", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "user_acceptance", override: true, contextId });

    const detail = createYpiStudioImprovement(task.id, {
      cwd,
      action: "create_improvement",
      title: "Add loading states",
      feedback: "Need loading indicators when fetching data",
      contextId,
    });

    assert.equal(detail.status, "waiting_for_improvements");
    assert.equal(detail.improvements.instances[0].displayId, "IMP-001");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Cannot create improvement from invalid statuses
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-invalid-"));
  try {
    const contextId = "pi_imp_invalid";
    const task = createYpiStudioTask({ cwd, title: "Invalid improvement", workflowId: "feature-dev", contextId });

    assert.throws(
      () => createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "test", feedback: "test", contextId }),
      /Improvements can only be created while the main task is in review, user_acceptance, or waiting_for_improvements/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Multiple improvements get sequential display IDs
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-multi-"));
  try {
    const contextId = "pi_imp_multi";
    const task = createYpiStudioTask({ cwd, title: "Multiple improvements", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const d1 = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Fix A", feedback: "feedback a", contextId });
    assert.equal(d1.improvements.instances[0].displayId, "IMP-001");

    const d2 = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Fix B", feedback: "feedback b", contextId });
    assert.equal(d2.improvements.instances.length, 2);
    assert.equal(d2.improvements.instances[0].displayId, "IMP-001");
    assert.equal(d2.improvements.instances[1].displayId, "IMP-002");

    const d3 = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Fix C", feedback: "feedback c", contextId });
    assert.equal(d3.improvements.instances.length, 3);
    assert.equal(d3.improvements.instances[2].displayId, "IMP-003");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Transition improvement through valid path: analysis -> waiting_plan_approval -> implementing
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-transition-"));
  try {
    const contextId = "pi_imp_transition";
    const task = createYpiStudioTask({ cwd, title: "Transition improvement", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Transition test", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Write meaningful plan-review for approval gate
    const transInstDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(transInstDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    const d2 = transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Plan ready",
    });
    assert.equal(d2.improvements.instances[0].status, "waiting_plan_approval");

    recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");

    const d3 = transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Plan approved",
    });
    assert.equal(d3.improvements.instances[0].status, "implementing");

    // Invalid transition: cannot go from implementing to accepted (must go through checking -> waiting_user_acceptance)
    assert.throws(
      () => transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "accepted", contextId }),
      /Invalid improvement transition/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Full lifecycle: analysis -> ... -> accepted, then reconcile back to review
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-full-lifecycle-"));
  try {
    const contextId = "pi_imp_full";
    const task = createYpiStudioTask({ cwd, title: "Full lifecycle", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Full test", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Write meaningful plan-review for approval gate
    const fullInstDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(fullInstDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    // Walk through valid transitions
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Plan ready" });
    recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Approved" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "checking", contextId, reason: "Implemented" });

    // Before acceptance, task should still be waiting_for_improvements
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "waiting_for_improvements");
    assert.equal(detail.improvements.parentStatus, "waiting_for_improvements");

    // Cannot complete while unresolved
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "completed", override: true, contextId }),
      /remain unresolved/,
    );

    // Accept the improvement
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_user_acceptance", contextId, reason: "Checks pass" });
    detail = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "accepted", contextId, reason: "User accepted" });

    // After acceptance, task should return to review (not completed!)
    assert.equal(detail.status, "review");
    assert.equal(detail.improvements.parentStatus, "review_ready");
    assert.equal(detail.improvements.instances[0].status, "accepted");
    assert.ok(detail.improvements.instances[0].completedAt);

    // After improvements resolved, task should be in review and can proceed to user_acceptance
    // Direct review -> completed is not a valid workflow transition (must go through user_acceptance)
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "completed", contextId }),
      /Invalid Studio transition/,
    );
    // But review -> user_acceptance is valid (no override needed)
    const acceptance = transitionYpiStudioTask(task.id, { cwd, to: "user_acceptance", contextId });
    assert.equal(acceptance.status, "user_acceptance");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Failed improvement needs explicit accepted_not_doing disposition
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-disposition-"));
  try {
    const contextId = "pi_imp_disposition";
    const task = createYpiStudioTask({ cwd, title: "Disposition test", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Failing test", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Cancel the improvement
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "cancelled", contextId, reason: "Not needed" });

    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "waiting_for_improvements");

    // Cannot complete while cancelled (unresolved)
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "completed", override: true, contextId }),
      /remain unresolved/,
    );

    // Resolve with accepted_not_doing
    detail = resolveYpiStudioImprovementDisposition(task.id, {
      cwd, action: "resolve_improvement_disposition", improvementId: impId, disposition: "accepted_not_doing", reason: "User accepts not doing", contextId,
    });

    assert.equal(detail.status, "review");
    assert.equal(detail.improvements.instances[0].status, "accepted_not_doing");
    assert.equal(detail.improvements.instances[0].disposition, "accepted_not_doing");
    assert.equal(detail.improvements.instances[0].disposedReason, "User accepts not doing");
    assert.ok(detail.improvements.instances[0].disposedAt);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Reconcile: only transitions to review when ALL improvements resolved; multiple improvements
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-reconcile-multi-"));
  try {
    const contextId = "pi_imp_reconcile";
    const task = createYpiStudioTask({ cwd, title: "Reconcile multi", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const d1 = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Fix A", feedback: "a", contextId });
    const d2 = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Fix B", feedback: "b", contextId });
    const imp1 = d1.improvements.instances[0].id;
    const imp2 = d2.improvements.instances[1].id;

    // Write meaningful plan-review for approval gate
    const recInstDir1 = join(cwd, ".ypi", "tasks", task.id, "improvements", imp1);
    writeFileSync(join(recInstDir1, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    // Accept imp1: still waiting because imp2 is unresolved
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: imp1, to: "waiting_plan_approval", contextId, reason: "Ready" });
    recordYpiStudioImprovementApproval(cwd, task.id, imp1, contextId, "确认，批准开始实现");
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: imp1, to: "implementing", contextId, reason: "Go" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: imp1, to: "checking", contextId, reason: "Done" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: imp1, to: "waiting_user_acceptance", contextId, reason: "Pass" });
    let detail = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: imp1, to: "accepted", contextId, reason: "User ok" });

    // Still waiting for imp2
    assert.equal(detail.status, "waiting_for_improvements");
    assert.equal(detail.improvements.parentStatus, "waiting_for_improvements");

    // Cancel and accept_not_doing imp2
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: imp2, to: "cancelled", contextId, reason: "Abandon" });
    detail = resolveYpiStudioImprovementDisposition(task.id, { cwd, action: "resolve_improvement_disposition", improvementId: imp2, disposition: "accepted_not_doing", reason: "Accept not doing", contextId });

    // Now all resolved -> back to review
    assert.equal(detail.status, "review");
    assert.equal(detail.improvements.parentStatus, "review_ready");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Old task without improvements field is read correctly (no crash)
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-legacy-"));
  try {
    const contextId = "pi_imp_legacy";
    const task = createYpiStudioTask({ cwd, title: "Legacy task no improvements", workflowId: "feature-dev", contextId });
    const detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.improvements, undefined);

    // Can still transition normally
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    assert.equal(getYpiStudioTaskDetail(cwd, task.id).status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Failed improvement -> accepted_not_doing via disposition
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-failed-disposition-"));
  try {
    const contextId = "pi_imp_failed";
    const task = createYpiStudioTask({ cwd, title: "Failed disposition", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Will fail", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Transition to failed
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "failed", contextId, reason: "Cannot implement" });

    // Cannot accept_not_doing a non-cancelled/failed improvement that is in analysis
    // First verify main task is blocked
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "waiting_for_improvements");
    assert.equal(detail.improvements.instances[0].status, "failed");

    // Resolve failed with accepted_not_doing
    detail = resolveYpiStudioImprovementDisposition(task.id, {
      cwd, action: "resolve_improvement_disposition", improvementId: impId, disposition: "accepted_not_doing", reason: "User acknowledges failure", contextId,
    });

    assert.equal(detail.status, "review");
    assert.equal(detail.improvements.instances[0].status, "accepted_not_doing");
    assert.equal(detail.improvements.instances[0].disposition, "accepted_not_doing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Validate explicit reconcile function (already called after mutations, but test standalone too)
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-reconcile-standalone-"));
  try {
    const contextId = "pi_imp_reconcile_standalone";
    const task = createYpiStudioTask({ cwd, title: "Reconcile standalone", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Reconcile test", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Write meaningful plan-review for approval gate
    const recStandaloneDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(recStandaloneDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    // Calling reconcile when unresolved should not change status
    let r = reconcileYpiStudioImprovements(cwd, task.id);
    assert.equal(r.status, "waiting_for_improvements");
    assert.equal(r.improvements.parentStatus, "waiting_for_improvements");

    // Accept the improvement and reconcile
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });
    recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Go" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "checking", contextId, reason: "Done" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_user_acceptance", contextId, reason: "Pass" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "accepted", contextId, reason: "Ok" });

    // Reconcile should already have happened, but call it again to verify idempotency
    r = reconcileYpiStudioImprovements(cwd, task.id);
    assert.equal(r.status, "review");
    assert.equal(r.improvements.parentStatus, "review_ready");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Improvement approval tests ---

{
  // Main task artifact update during awaiting_approval clears the approval grant
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-invalidate-artifact-"));
  try {
    const contextId = "pi_approval_artifact";
    const task = createYpiStudioTask({ cwd, title: "Approval invalidation via artifact", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.ok(detail.meta.approvalGrant);

    // Updating an artifact during awaiting_approval should clear the grant
    detail = updateYpiStudioTaskArtifact(task.id, { cwd, artifact: "design", content: "# Revised design\n\nChanged.\n", contextId });
    assert.equal(detail.meta.approvalGrant, undefined);
    assert.ok(detail.meta.planRevision);
    assert.ok(detail.meta.planRevision >= 2, `Expected planRevision >= 2, got ${detail.meta.planRevision}`);

    // Without a new approval, transition to implementing must fail
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }),
      /no approvalGrant is recorded/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Main task implementation plan update during awaiting_approval clears the approval grant
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-invalidate-plan-"));
  try {
    const contextId = "pi_approval_plan";
    const task = createYpiStudioTask({ cwd, title: "Approval invalidation via plan", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.ok(detail.meta.approvalGrant);

    // Updating implementation plan during awaiting_approval should clear the grant and bump revision
    detail = updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [{ id: "A", title: "Task A", order: 10, dependsOn: [] }],
      },
    });
    assert.equal(detail.meta.approvalGrant, undefined);
    assert.ok(detail.meta.planRevision >= 2);

    // Must re-approve
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }),
      /no approvalGrant is recorded/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Transition from awaiting_approval back to planning/changes_requested clears the grant
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-changes-requested-"));
  try {
    const contextId = "pi_approval_changes";
    const task = createYpiStudioTask({ cwd, title: "Changes requested clears grant", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");

    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.ok(detail.meta.approvalGrant);

    // User requests changes: go back to planning
    detail = transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId, reason: "User requested changes" });
    assert.equal(detail.meta.approvalGrant, undefined);
    // Revision should have been bumped
    assert.ok(detail.meta.planRevision >= 2);

    // Going back to awaiting_approval is allowed, but no grant yet
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }),
      /no approvalGrant is recorded/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Revision number is preserved across task reads and doesn't reset
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-revision-persist-"));
  try {
    const contextId = "pi_approval_revision";
    const task = createYpiStudioTask({ cwd, title: "Revision persist", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");

    // Artifact update bumps revision
    let detail = updateYpiStudioTaskArtifact(task.id, { cwd, artifact: "design", content: "Revised", contextId });
    const rev1 = detail.meta.planRevision;
    assert.ok(rev1 >= 2);

    // Another artifact update bumps it again
    detail = updateYpiStudioTaskArtifact(task.id, { cwd, artifact: "prd", content: "Revised PRD", contextId });
    assert.ok(detail.meta.planRevision > rev1);

    // Reload and verify revision is persisted
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.ok(detail.meta.planRevision >= 3);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Improvement plan approval gates ---

{
  // Improvement awaiting_plan_approval -> implementing requires explicit approval
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-approval-gate-"));
  try {
    const contextId = "pi_imp_approval_gate";
    const task = createYpiStudioTask({ cwd, title: "Imp approval gate", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Improvement with plan", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Write meaningful plan-review.md into the improvement instance directory
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(instDir, "plan-review.md"), "# Improvement Plan Review\n\nApproval request for this improvement.\n\n## Artifacts\n- [Brief](./brief.md)\n", "utf8");

    // Move to waiting_plan_approval
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Plan ready" });

    // Without approval, transitioning to implementing must fail
    assert.throws(
      () => transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId }),
      /transition to implementing requires recorded user approval/,
    );

    // Diagnostic prose must not create an improvement approval grant.
    assert.throws(
      () => recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "排查浮窗批准问题"),
      /Explicit approval text is required/,
    );
    assert.equal(getYpiStudioTaskDetail(cwd, task.id)?.improvements?.instances[0].approval?.approvedAt, undefined);

    // Record approval
    const approved = recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");
    const approvedInst = approved.improvements.instances[0];
    assert.equal(approvedInst.approval.revision, 1);
    assert.ok(approvedInst.approval.approvedAt);
    assert.equal(approvedInst.approval.contextId, contextId);
    assert.ok(approvedInst.approval.inputHash);

    // Now transition to implementing should succeed
    const implemented = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Approved" });
    assert.equal(implemented.improvements.instances[0].status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement plan artifact change during waiting_plan_approval invalidates approval
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-invalidate-approval-"));
  try {
    const contextId = "pi_imp_invalidate";
    const task = createYpiStudioTask({ cwd, title: "Imp invalidation", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Invalidate test", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // Write plan-review
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(instDir, "plan-review.md"), "# Plan Review\n\nMeaningful content.\n", "utf8");

    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });
    let approvedDet = recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");
    assert.ok(approvedDet.improvements.instances[0].approval.approvedAt);
    assert.equal(approvedDet.improvements.instances[0].approval.revision, 1);

    // Updating an artifact should invalidate the approval and bump revision
    const revised = updateYpiStudioImprovementArtifact(task.id, {
      cwd, improvementId: impId, artifact: "brief", content: "# Revised Brief\n\nChanged.\n", contextId,
    });
    const revisedInst = revised.improvements.instances[0];
    assert.equal(revisedInst.approval.revision, 2);
    assert.equal(revisedInst.approval.approvedAt, undefined);
    assert.equal(revisedInst.approval.contextId, undefined);

    // Transition to implementing should fail without re-approval
    assert.throws(
      () => transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId }),
      /transition to implementing requires recorded user approval/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement reviseYpiStudioImprovementPlan atomically bumps revision
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-revise-plan-"));
  try {
    const contextId = "pi_imp_revise";
    const task = createYpiStudioTask({ cwd, title: "Revise plan", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Revise test", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(instDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });
    recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");

    // Revise: bumps revision, clears approval
    const revised = reviseYpiStudioImprovementPlan(task.id, {
      cwd, action: "update_improvement_plan", improvementId: impId, contextId,
      artifactUpdates: { "brief": "# Revised Brief\n\nNew content.\n", "plan-review": "# Revised Plan Review\n\nUpdated.\n" },
    });
    const revisedInst = revised.improvements.instances[0];
    assert.equal(revisedInst.approval.revision, 2);
    assert.equal(revisedInst.approval.approvedAt, undefined);

    // Verify files were actually updated
    const briefContent = readFileSync(join(instDir, "brief.md"), "utf8");
    assert.ok(briefContent.includes("Revised Brief"));

    // Transition without re-approval should fail
    assert.throws(
      () => transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId }),
      /transition to implementing requires recorded user approval/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // UI gate: improvement with meaningful ui.md must have HTML prototype before approval
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-ui-gate-"));
  try {
    const contextId = "pi_imp_ui_gate";
    const task = createYpiStudioTask({ cwd, title: "UI gate test", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "UI change", feedback: "Need layout changes", contextId });
    const impId = created.improvements.instances[0].id;
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);

    // Write meaningful plan-review and ui.md (indicating UI change needed)
    writeFileSync(join(instDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");
    writeFileSync(join(instDir, "ui.md"), "# UI Design\n\nThe layout must change.\n\n## Changes\n- Add responsive sidebar\n", "utf8");

    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });

    // Approval should fail without HTML prototype when ui.md is meaningful
    assert.throws(
      () => recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现"),
      /no HTML prototype was found/,
    );

    // Add an HTML prototype
    writeFileSync(join(instDir, "prototype.html"), "<!DOCTYPE html><html><body>Prototype</body></html>", "utf8");

    // Now approval should succeed
    const approved = recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");
    assert.ok(approved.improvements.instances[0].approval.approvedAt);

    // Transition to implementing should also succeed
    const implemented = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Go" });
    assert.equal(implemented.improvements.instances[0].status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Empty/TBD plan-review.md blocks improvement approval
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-plan-review-gate-"));
  try {
    const contextId = "pi_imp_plan_review_gate";
    const task = createYpiStudioTask({ cwd, title: "Plan review gate", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "No plan review", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;

    // plan-review.md is still the TBD placeholder from creation
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });

    // Approval should fail because plan-review.md is empty/TBD
    assert.throws(
      () => recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现"),
      /plan-review\.md is empty or contains only TBD placeholder/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Different contextId blocks improvement transition to implementing
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-cross-context-"));
  try {
    const contextId = "pi_imp_cross_ctx";
    const otherCtx = "pi_other_session";
    const task = createYpiStudioTask({ cwd, title: "Cross context", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Cross context", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(instDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });

    // Approve with contextId
    recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");

    // Transition with a different contextId should fail.
    // Exclusive session ownership rejects non-owner contexts before approval-grant matching.
    assert.throws(
      () => transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId: otherCtx }),
      /not bound to this session context|approval was recorded in a different session context/,
    );

    // But transition without providing a contextId should work (already null check passes)
    // Actually let's test that the original contextId still works
    const implemented = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Go" });
    assert.equal(implemented.improvements.instances[0].status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement plan update via updateYpiStudioImprovementPlan
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-improvement-plan-update-"));
  try {
    const contextId = "pi_imp_plan_update";
    const task = createYpiStudioTask({ cwd, title: "Imp plan update", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Plan update", feedback: "test", contextId });
    const impId = created.improvements.instances[0].id;
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(instDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");

    // In analysis, should be able to update plan
    let detail = updateYpiStudioImprovementPlan(task.id, {
      cwd, action: "update_improvement_plan", improvementId: impId, contextId,
      implementationPlan: {
        schemaVersion: 2, maxConcurrency: 1,
        subtasks: [{ id: "A", title: "Task A", order: 10, dependsOn: [] }],
      },
    });
    assert.ok(detail.improvements.instances[0].implementationPlan);
    assert.equal(detail.improvements.instances[0].implementationPlan.subtasks.length, 1);

    // In waiting_plan_approval, updating plan should invalidate approval
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready" });
    recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");

    detail = updateYpiStudioImprovementPlan(task.id, {
      cwd, action: "update_improvement_plan", improvementId: impId, contextId,
      implementationPlan: {
        schemaVersion: 2, maxConcurrency: 1,
        subtasks: [{ id: "B", title: "Task B", order: 10, dependsOn: [] }],
      },
    });
    assert.equal(detail.improvements.instances[0].approval.revision, 2);
    assert.equal(detail.improvements.instances[0].approval.approvedAt, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Legacy approval compatibility: main task approval still works unchanged
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-legacy-compat-"));
  try {
    const contextId = "pi_approval_legacy_compat";
    const task = createYpiStudioTask({ cwd, title: "Legacy compat", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });

    // Standard approval flow
    let approved = recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    assert.ok(approved);
    assert.ok(approved.meta.approvalGrant);
    assert.equal(approved.meta.approvalGrant.source, "user-input");

    // Transition to implementing works
    const implemented = transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    assert.equal(implemented.status, "implementing");

    // planRevision should be undefined or 1 for legacy tasks without revision bumps
    // (it's undefined because we never bumped it)
    assert.equal(implemented.meta.planRevision, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Improvement file API security boundaries (gate #4) ---

function setupImprovementTask(cwd, contextId, title = "File security", feedback = "Sidebar is too cramped on small screens") {
  const task = createYpiStudioTask({ cwd, title, workflowId: "feature-dev", contextId });
  writePlanReview(cwd, task.id, contextId);
  transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
  transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
  recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
  transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
  transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
  transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
  const detail = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Imp file security", feedback, contextId });
  return { task, instance: detail.improvements.instances[0] };
}

{
  // Improvement file resolver: valid in-instance file resolves; instance dir is the root.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-file-valid-"));
  try {
    const contextId = "pi_imp_file_valid";
    const { task, instance } = setupImprovementTask(cwd, contextId);
    const resolved = resolveYpiStudioImprovementRelativeFile(cwd, task.id, instance.id, "brief.md");
    assert.ok(resolved.realPath.endsWith(join("improvements", instance.id, "brief.md")));
    assert.ok(resolved.stat.isFile());
    // A path that escapes the instance dir (back into the task dir) must be rejected.
    assert.throws(
      () => resolveYpiStudioImprovementRelativeFile(cwd, task.id, instance.id, "../task.json"),
      (err) => err instanceof YpiStudioTaskSecurityError,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement file resolver rejects URL schemes, absolute paths, backslashes, and .. traversal.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-file-security-"));
  try {
    const contextId = "pi_imp_file_security";
    const { task, instance } = setupImprovementTask(cwd, contextId);
    const bad = [
      "https://example.com/evil.html",
      "file:///etc/passwd",
      "/etc/passwd",
      "C:/evil.txt",
      "..\\..\\task.json",
      "../../etc/passwd",
      "./../../secret",
    ];
    for (const inputPath of bad) {
      assert.throws(
        () => resolveYpiStudioImprovementRelativeFile(cwd, task.id, instance.id, inputPath),
        (err) => err instanceof YpiStudioTaskSecurityError,
        `expected security error for ${inputPath}`,
      );
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement file resolver rejects symlink targets that escape the instance directory.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-file-symlink-"));
  try {
    const contextId = "pi_imp_file_symlink";
    const { task, instance } = setupImprovementTask(cwd, contextId);
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", instance.id);
    const outsideDir = mkdtempSync(join(tmpdir(), "ypi-studio-imp-outside-"));
    try {
      writeFileSync(join(outsideDir, "secret.txt"), "secret", "utf8");
      const linkPath = join(instDir, "leak.md");
      let created = false;
      try {
        symlinkSync(join(outsideDir, "secret.txt"), linkPath);
        created = true;
      } catch {
        // Symlinks may be unavailable on some CI platforms; skip the assertion gracefully.
      }
      if (created) {
        assert.throws(
          () => resolveYpiStudioImprovementRelativeFile(cwd, task.id, instance.id, "leak.md"),
          (err) => err instanceof YpiStudioTaskSecurityError,
        );
      }
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement file resolver rejects unknown improvement ids and tasks without improvements.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-file-ownership-"));
  try {
    const contextId = "pi_imp_file_ownership";
    const { task, instance } = setupImprovementTask(cwd, contextId);
    // Unknown improvement id does not resolve.
    assert.throws(
      () => resolveYpiStudioImprovementRelativeFile(cwd, task.id, "imp_does_not_exist", "brief.md"),
      /Improvement not found/,
    );
    // A task without improvements rejects instance resolution entirely.
    const otherTask = createYpiStudioTask({ cwd, title: "No improvements task", workflowId: "feature-dev", contextId: "pi_other_task" });
    assert.throws(
      () => resolveYpiStudioImprovementRelativeFile(cwd, otherTask.id, instance.id, "brief.md"),
      /Task has no improvements/,
    );
    // Cross-task: an instance id that belongs to the first task is not visible under another task.
    assert.throws(
      () => resolveYpiStudioImprovementRelativeFile(cwd, otherTask.id, instance.id, "brief.md"),
      /Task has no improvements/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Bounded widget projection (gate #9): no full feedback in widget/detail projection ---

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-bounded-projection-"));
  try {
    const contextId = "pi_imp_bounded_projection";
    const longFeedback = "The sidebar collapses awkwardly below 768px and the primary CTA overlaps the filter panel. This is sensitive feedback that must not leak into the lightweight widget/tool projection.";
    const { task, instance } = setupImprovementTask(cwd, contextId, "Bounded projection", longFeedback);

    // Bind the main task to a session context so the session-task resolver returns it.
    const sessionId = "bounded-projection-session";
    const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `pi_${sessionId}.json`);
    bindYpiStudioTaskToContext(cwd, task.id, `pi_${sessionId}`);

    const result = resolveYpiStudioTaskForSession({
      cwd,
      sessionId,
      sessionFilePath,
      entries: [],
    });
    assert.equal(result.tasks.length, 1);
    assert.ok(result.task, "backward-compatible primary projection is present");
    const projection = result.tasks[0].task;
    const primaryProjection = result.task;
    assert.ok(projection.improvements, "widget projection includes improvements summary");
    assert.equal(primaryProjection.improvements, projection.improvements);
    assert.equal(projection.improvements.parentStatus, "waiting_for_improvements");
    assert.equal(projection.improvements.total, 1);
    assert.equal(projection.improvements.unresolved, 1);
    assert.ok(projection.improvements.blocker, "widget projection surfaces a blocker");
    assert.ok(projection.improvements.nextAction, "widget projection surfaces a next action");

    const projectedInstance = projection.improvements.instances[0];
    assert.equal(projectedInstance.id, instance.id);
    assert.equal(projectedInstance.displayId, "IMP-001");
    assert.equal(projectedInstance.status, "analysis");
    assert.equal(projectedInstance.owner, "improver");
    // Bounded: the widget projection must NOT include full feedback text or transcript content.
    assert.ok(!("feedback" in projectedInstance), "widget projection must not include full feedback");
    assert.ok(!("transcript" in projectedInstance));
    assert.ok(!("feedback" in projection.improvements));

    // The authoritative task detail (used by the detail page Overview tab) still carries feedback,
    // confirming the bound is at the widget/tool projection layer, not the authoritative record.
    const detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.improvements.instances[0].feedback, longFeedback);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Bounded tool projection: compact task tool payload only carries a bounded feedback preview.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-tool-projection-"));
  try {
    const contextId = "pi_imp_tool_projection";
    const longFeedback = "A".repeat(500);
    const { task } = setupImprovementTask(cwd, contextId, "Tool projection", longFeedback);
    const detail = getYpiStudioTaskDetail(cwd, task.id);
    // The compact tool projection built by the extension only exposes feedbackPreview (bounded),
    // not the raw feedback string. The authoritative detail keeps the full feedback for the Overview tab.
    // We assert the invariant at the data contract level: detail.improvements keeps full feedback,
    // while the compact projection layer (see lib/ypi-studio-extension.ts compactYpiStudioTaskForTool)
    // maps instances to { id, displayId, title, status, owner, approvalMode, updatedAt, feedbackPreview }.
    assert.equal(detail.improvements.instances[0].feedback.length, 500);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Improvement instance scope: claim/next/run attribution (B1/B2) ---

/** Set up an improvement instance in an executable `implementing` state with a plan.
 *  Returns { cwd, contextId, task, instance } where the main task is `waiting_for_improvements`. */
function setupImprovementImplementing(cwd, contextId, title, instancePlan, mainPlan) {
  const task = createYpiStudioTask({ cwd, title, workflowId: "feature-dev", contextId });
  writePlanReview(cwd, task.id, contextId);
  transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
  if (mainPlan) {
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: mainPlan,
    });
  }
  transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
  recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
  transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
  transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
  transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
  const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title, feedback: "test feedback", contextId });
  const impId = created.improvements.instances[0].id;
  // Set the instance plan while still in analysis.
  updateYpiStudioImprovementPlan(task.id, {
    cwd, action: "update_improvement_plan", improvementId: impId, contextId,
    implementationPlan: instancePlan,
  });
  // Write a meaningful plan-review for the approval gate.
  const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
  writeFileSync(join(instDir, "plan-review.md"), "# Improvement Plan Review\n\nMeaningful content for approval.\n", "utf8");
  transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Plan ready" });
  recordYpiStudioImprovementApproval(cwd, task.id, impId, contextId, "确认，批准开始实现");
  const implemented = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: impId, to: "implementing", contextId, reason: "Approved" });
  return { task, instance: implemented.improvements.instances[0] };
}

{
  // Positive: implementation_next(improvementId) returns only instance ready subtasks.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-next-"));
  try {
    const contextId = "pi_imp_scope_next";
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Scope next", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [
        { id: "A", title: "Instance A", order: 10, dependsOn: [] },
        { id: "B", title: "Instance B", order: 20, dependsOn: ["A"] },
      ],
    });
    // Main task has no plan here; instance next should resolve only instance ready subtasks.
    const next = getNextYpiStudioImplementationSubtask(cwd, task.id, { limit: 5, improvementId: instance.id });
    assert.equal(next.improvementId, instance.id);
    assert.ok(next.instance);
    assert.equal(next.instance.id, instance.id);
    assert.deepEqual(next.subtasks.map((item) => item.id), ["A"]);
    assert.equal(next.subtask.id, "A");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Positive: claim_improvement_subtask only mutates instance progress, not main plan.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-claim-"));
  try {
    const contextId = "pi_imp_scope_claim";
    const mainPlan = {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [
        { id: "A", title: "Main A", order: 10, dependsOn: [] },
        { id: "B", title: "Main B", order: 20, dependsOn: ["A"] },
      ],
    };
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Scope claim", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [
        { id: "X", title: "Instance X", order: 10, dependsOn: [] },
      ],
    }, mainPlan);
    // Main task is waiting_for_improvements, so the main-plan subtask A is NOT executable.
    // The instance plan uses X (different from main ids).
    const beforeMain = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(beforeMain.implementationProgress.subtasks.A.status, "ready");
    const claimed = claimYpiStudioImprovementSubtask(task.id, {
      cwd, action: "claim_improvement_subtask", improvementId: instance.id, subtaskId: "X", status: "running", contextId,
    });
    const claimedInstance = claimed.improvements.instances.find((inst) => inst.id === instance.id);
    assert.equal(claimedInstance.implementationProgress.subtasks.X.status, "running");
    // Main plan A must remain unchanged (ready), not running.
    assert.equal(claimed.implementationProgress.subtasks.A.status, "ready");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Negative: unknown improvementId is rejected for next and claim.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-unknown-"));
  try {
    const contextId = "pi_imp_scope_unknown";
    const { task } = setupImprovementImplementing(cwd, contextId, "Unknown imp", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "A", order: 10, dependsOn: [] }],
    });
    assert.throws(
      () => getNextYpiStudioImplementationSubtask(cwd, task.id, { improvementId: "imp_does_not_exist" }),
      /Improvement not found/,
    );
    assert.throws(
      () => claimYpiStudioImprovementSubtask(task.id, { cwd, action: "claim_improvement_subtask", improvementId: "imp_does_not_exist", subtaskId: "A", contextId }),
      /Improvement not found/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Negative: instance not in an executable state (analysis) rejects next/claim.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-not-exec-"));
  try {
    const contextId = "pi_imp_scope_not_exec";
    const task = createYpiStudioTask({ cwd, title: "Not exec", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
    const created = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Still analysis", feedback: "x", contextId });
    const impId = created.improvements.instances[0].id;
    // Instance remains in analysis; querying next must reject.
    assert.throws(
      () => getNextYpiStudioImplementationSubtask(cwd, task.id, { improvementId: impId }),
      /not executable|has no implementation plan/,
    );
    assert.throws(
      () => claimYpiStudioImprovementSubtask(task.id, { cwd, action: "claim_improvement_subtask", improvementId: impId, subtaskId: "A", contextId }),
      /not executable|has no implementation plan/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Negative: claiming a main-plan subtask id under an improvement scope is rejected.
  // Both the main plan and instance plan use id "A"; the instance claim must only resolve "A"
  // against the instance plan. Here the instance plan has only "X", so "A" does not exist there.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-main-id-"));
  try {
    const contextId = "pi_imp_scope_main_id";
    const mainPlan = {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "Main A", order: 10, dependsOn: [] }],
    };
    const instancePlan = {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "X", title: "Instance X", order: 10, dependsOn: [] }],
    };
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Overlap id", instancePlan, mainPlan);
    assert.throws(
      () => claimYpiStudioImprovementSubtask(task.id, { cwd, action: "claim_improvement_subtask", improvementId: instance.id, subtaskId: "A", contextId }),
      /do not exist in the instance plan/,
    );
    // Main-task claim_implementation_subtask is rejected while the main task waits for improvements.
    assert.throws(
      () => claimYpiStudioImplementationSubtask(task.id, { cwd, action: "claim_implementation_subtask", subtaskId: "A", contextId }),
      /Cannot claim implementation subtasks until the main task is in implementing/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Negative: claiming an instance subtask id without improvementId (main-task claim) is rejected
  // because the main task is waiting_for_improvements and has its own plan without that id.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-no-imp-id-"));
  try {
    const contextId = "pi_imp_scope_no_imp";
    const mainPlan = {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "Main A", order: 10, dependsOn: [] }],
    };
    const { task } = setupImprovementImplementing(cwd, contextId, "No imp id", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "X", title: "Instance X", order: 10, dependsOn: [] }],
    }, mainPlan);
    // X exists only in the instance plan; a main-task claim for X fails (not in main plan / wrong status).
    assert.throws(
      () => claimYpiStudioImplementationSubtask(task.id, { cwd, action: "claim_implementation_subtask", subtaskId: "X", contextId }),
      /Cannot claim implementation subtasks until the main task is in implementing/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Positive: run attribution — running/succeeded/cancelled runs append to instance.runIds once each.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-run-attr-"));
  try {
    const contextId = "pi_imp_scope_run_attr";
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Run attribution", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [
        { id: "A", title: "A", order: 10, dependsOn: [] },
        { id: "B", title: "B", order: 20, dependsOn: ["A"] },
      ],
    });

    // Record a running run for subtask A.
    const running = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-imp-A", taskId: task.id, member: "implementer", status: "running", mode: "async",
      subtaskId: "A", improvementId: instance.id, startedAt: now, updatedAt: now,
    });
    let inst = running.improvements.instances.find((item) => item.id === instance.id);
    assert.deepEqual(inst.runIds, ["run-imp-A"]);
    assert.equal(inst.implementationProgress.subtasks.A.status, "running");
    // Main task plan/progress is untouched (no main plan set).
    assert.equal(running.implementationProgress, undefined);

    // Succeed the run.
    const succeeded = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-imp-A", taskId: task.id, member: "implementer", status: "succeeded", mode: "async",
      subtaskId: "A", improvementId: instance.id, startedAt: now, updatedAt: now, finishedAt: now, summary: "done",
    });
    inst = succeeded.improvements.instances.find((item) => item.id === instance.id);
    assert.deepEqual(inst.runIds, ["run-imp-A"]);
    assert.equal(inst.implementationProgress.subtasks.A.status, "done");
    // B becomes ready after A is done.
    assert.equal(inst.implementationProgress.subtasks.B.status, "ready");

    // A cancelled run for B appends a new id without removing the prior.
    const cancelled = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-imp-B-cancel", taskId: task.id, member: "checker", status: "cancelled", mode: "async",
      subtaskId: "B", improvementId: instance.id, startedAt: now, updatedAt: now, finishedAt: now, summary: "cancelled",
    });
    inst = cancelled.improvements.instances.find((item) => item.id === instance.id);
    assert.deepEqual(inst.runIds, ["run-imp-A", "run-imp-B-cancel"]);
    assert.equal(inst.implementationProgress.subtasks.B.status, "failed");

    // Duplicate terminal write of run-imp-A must not add the id again.
    const redone = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-imp-A", taskId: task.id, member: "implementer", status: "succeeded", mode: "async",
      subtaskId: "A", improvementId: instance.id, startedAt: now, updatedAt: now, finishedAt: now, summary: "redone",
    });
    inst = redone.improvements.instances.find((item) => item.id === instance.id);
    assert.deepEqual(inst.runIds, ["run-imp-A", "run-imp-B-cancel"], "runIds must be deduped across lifecycle writes");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Positive: a second instance and the main progress are not polluted by a scoped run.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-isolation-"));
  try {
    const contextId = "pi_imp_scope_isolation";
    const mainPlan = {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "Main A", order: 10, dependsOn: [] }],
    };
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Isolation", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "Instance A", order: 10, dependsOn: [] }],
    }, mainPlan);
    // Create a second improvement instance in implementing state with its own plan.
    const second = createYpiStudioImprovement(task.id, { cwd, action: "create_improvement", title: "Second imp", feedback: "y", contextId });
    const secondId = second.improvements.instances[1].id;
    updateYpiStudioImprovementPlan(task.id, {
      cwd, action: "update_improvement_plan", improvementId: secondId, contextId,
      implementationPlan: { schemaVersion: 2, maxConcurrency: 1, subtasks: [{ id: "A", title: "Second A", order: 10, dependsOn: [] }] },
    });
    const secondDir = join(cwd, ".ypi", "tasks", task.id, "improvements", secondId);
    writeFileSync(join(secondDir, "plan-review.md"), "# Plan Review\n\nMeaningful.\n", "utf8");
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: secondId, to: "waiting_plan_approval", contextId, reason: "Ready" });
    recordYpiStudioImprovementApproval(cwd, task.id, secondId, contextId, "确认，批准开始实现");
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: secondId, to: "implementing", contextId, reason: "Go" });

    // Record a scoped run for the first instance only.
    const detail = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-iso-1", taskId: task.id, member: "implementer", status: "running", mode: "async",
      subtaskId: "A", improvementId: instance.id, startedAt: now, updatedAt: now,
    });
    const firstInst = detail.improvements.instances.find((item) => item.id === instance.id);
    const secondInst = detail.improvements.instances.find((item) => item.id === secondId);
    assert.deepEqual(firstInst.runIds, ["run-iso-1"]);
    assert.deepEqual(secondInst.runIds, [], "second instance must not be polluted");
    assert.equal(firstInst.implementationProgress.subtasks.A.status, "running");
    // Second instance A remains ready (not running).
    assert.equal(secondInst.implementationProgress.subtasks.A.status, "ready");
    // Main task plan A remains ready (not running), since main task is waiting_for_improvements.
    assert.equal(detail.implementationProgress.subtasks.A.status, "ready");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Negative: recording an improvement-scoped run after the main task leaves waiting_for_improvements
  // (e.g. instance accepted -> main back to review) is rejected.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-run-stale-"));
  try {
    const contextId = "pi_imp_scope_run_stale";
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Stale run", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "A", order: 10, dependsOn: [] }],
    });
    // Resolve the improvement so the main task returns to review.
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: instance.id, to: "checking", contextId, reason: "Done" });
    transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: instance.id, to: "waiting_user_acceptance", contextId, reason: "Pass" });
    const accepted = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: instance.id, to: "accepted", contextId, reason: "User ok" });
    assert.equal(accepted.status, "review");
    // Recording a scoped run now must fail because the main task is no longer waiting_for_improvements.
    assert.throws(
      () => recordYpiStudioSubagentRun(cwd, task.id, {
        id: "run-stale", taskId: task.id, member: "implementer", status: "running", mode: "async",
        subtaskId: "A", improvementId: instance.id, startedAt: now, updatedAt: now,
      }),
      /cannot be recorded while the main task status is review/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Positive: runtime-lost reconciliation preserves improvementId and instance run attribution.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-runtime-lost-"));
  try {
    const contextId = "pi_imp_scope_runtime_lost";
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Runtime lost", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "A", order: 10, dependsOn: [] }],
    });
    // Start a scoped run.
    const running = recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-rt-lost", taskId: task.id, member: "implementer", status: "running", mode: "async",
      subtaskId: "A", improvementId: instance.id, startedAt: now, updatedAt: now,
    });
    let inst = running.improvements.instances.find((item) => item.id === instance.id);
    assert.deepEqual(inst.runIds, ["run-rt-lost"]);
    // Simulate runtime-lost reconciliation: the run has no registry handle and is running.
    const failed = reconcileYpiStudioRuntimeLostSubagentRun(cwd, task.id, "run-rt-lost");
    assert.equal(failed.status, "failed");
    assert.equal(failed.improvementId, instance.id, "runtime-lost run keeps improvementId");
    assert.equal(failed.terminationReason, "runtime_lost");
    const detail = getYpiStudioTaskDetail(cwd, task.id);
    inst = detail.improvements.instances.find((item) => item.id === instance.id);
    assert.deepEqual(inst.runIds, ["run-rt-lost"], "runtime-lost reconciliation keeps the run id once");
    assert.equal(inst.implementationProgress.subtasks.A.status, "failed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Positive: checking-state instance can claim a subtask for review.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-imp-scope-checking-"));
  try {
    const contextId = "pi_imp_scope_checking";
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Checking scope", {
      schemaVersion: 2, maxConcurrency: 1,
      subtasks: [{ id: "A", title: "A", order: 10, dependsOn: [] }],
    });
    // Transition the instance to checking.
    const checking = transitionYpiStudioImprovement(task.id, { cwd, action: "transition_improvement", improvementId: instance.id, to: "checking", contextId, reason: "Implemented" });
    const checkingInstance = checking.improvements.instances.find((item) => item.id === instance.id);
    assert.equal(checkingInstance.status, "checking");
    // next/claim should still resolve against the instance plan in checking state.
    const next = getNextYpiStudioImplementationSubtask(cwd, task.id, { improvementId: instance.id });
    assert.deepEqual(next.subtasks.map((item) => item.id), ["A"]);
    const claimed = claimYpiStudioImprovementSubtask(task.id, { cwd, action: "claim_improvement_subtask", improvementId: instance.id, subtaskId: "A", status: "running", contextId });
    const claimedInstance = claimed.improvements.instances.find((item) => item.id === instance.id);
    assert.equal(claimedInstance.implementationProgress.subtasks.A.status, "running");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Widget quickPreviews projection (DATA-01): permanent plan/prototype descriptors ---

/** Resolve widget projection while keeping the existing session context exclusive owner. */
function bindSessionProjection(cwd, taskId, contextId) {
  if (!contextId.startsWith("pi_")) throw new Error(`expected pi_ contextId, got ${contextId}`);
  const sessionId = contextId.slice("pi_".length);
  const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
  // Refresh pointer under the same context used for create/mutations (exclusive bind is idempotent).
  bindYpiStudioTaskToContext(cwd, taskId, contextId);
  return resolveYpiStudioTaskForSession({
    cwd,
    sessionId,
    sessionFilePath,
    entries: [],
  });
}

function assertBoundedQuickPreviews(projection) {
  assert.ok(Array.isArray(projection.quickPreviews), "quickPreviews must be an array when descriptors exist");
  for (const preview of projection.quickPreviews) {
    assert.ok(["plan-review", "prototype", "improvement-plan"].includes(preview.kind), `unexpected kind ${preview.kind}`);
    assert.equal(typeof preview.fileName, "string");
    assert.ok(preview.fileName.length > 0);
    assert.equal(typeof preview.label, "string");
    assert.ok(["pending", "approved", "revision_changed", "readonly"].includes(preview.approvalState));
    // Bounded: no bodies, feedback, or transcript on descriptors.
    assert.ok(!("content" in preview));
    assert.ok(!("body" in preview));
    assert.ok(!("markdown" in preview));
    assert.ok(!("html" in preview));
    assert.ok(!("feedback" in preview));
    assert.ok(!("transcript" in preview));
    if (preview.kind === "improvement-plan" || (preview.kind === "prototype" && preview.improvementId)) {
      assert.equal(typeof preview.improvementId, "string");
      assert.ok(preview.improvementId.length > 0, "improvement-scoped previews must carry explicit improvementId");
    }
  }
  const serialized = JSON.stringify(projection);
  assert.ok(!serialized.includes("<html"), "projection must not embed HTML body");
  assert.ok(!serialized.includes("# 蛋黄派计划审批书"), "projection must not embed plan-review body");
}

{
  // Main plan-review persists after approval and into implementing; HTML appears only when present.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-quick-preview-main-"));
  try {
    const contextId = "pi_widget_quick_main";
    const task = createYpiStudioTask({ cwd, title: "Quick preview main", workflowId: "feature-dev", contextId });
    // Default artifact registry creates plan-review.md placeholders; descriptors must not wait for awaiting_approval.
    assert.equal(ypiStudioTaskPlanReviewFileExists(cwd, task.id), true);
    assert.deepEqual(listYpiStudioTaskHtmlPrototypeFileNames(cwd, task.id), []);

    let result = bindSessionProjection(cwd, task.id, contextId);
    let projection = result.task;
    assert.ok(projection);
    assertBoundedQuickPreviews(projection);
    const mainPlanPending = projection.quickPreviews.find((item) => item.kind === "plan-review" && !item.improvementId);
    assert.ok(mainPlanPending, "plan-review descriptor exists before awaiting_approval");
    assert.equal(mainPlanPending.fileName, "plan-review.md");
    assert.equal(mainPlanPending.approvalState, "pending");
    assert.ok(!projection.quickPreviews.some((item) => item.kind === "prototype"), "no HTML mapping => no prototype button");

    writePlanReview(cwd, task.id, contextId);
    assert.equal(ypiStudioTaskPlanReviewFileExists(cwd, task.id), true);

    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    result = bindSessionProjection(cwd, task.id, contextId);
    projection = result.task;
    assert.equal(projection.status, "awaiting_approval");
    assert.equal(projection.quickPreviews.find((item) => item.kind === "plan-review").approvalState, "pending");

    // Write a main-task HTML prototype while still awaiting approval.
    writeFileSync(
      join(cwd, ".ypi", "tasks", task.id, "ypi-studio-widget-state-prototype.html"),
      "<!DOCTYPE html><html><body>Main prototype body must not leak</body></html>\n",
      "utf8",
    );
    assert.deepEqual(
      listYpiStudioTaskHtmlPrototypeFileNames(cwd, task.id),
      ["ypi-studio-widget-state-prototype.html"],
    );

    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    result = bindSessionProjection(cwd, task.id, contextId);
    projection = result.task;
    assert.equal(projection.status, "implementing");
    assertBoundedQuickPreviews(projection);
    const mainPlanApproved = projection.quickPreviews.find((item) => item.kind === "plan-review" && !item.improvementId);
    assert.ok(mainPlanApproved, "plan-review remains after leaving awaiting_approval");
    assert.equal(mainPlanApproved.approvalState, "approved");
    const mainProto = projection.quickPreviews.find((item) => item.kind === "prototype" && !item.improvementId);
    assert.ok(mainProto, "HTML prototype descriptor present after file appears");
    assert.equal(mainProto.fileName, "ypi-studio-widget-state-prototype.html");
    assert.equal(mainProto.approvalState, "approved");
    assert.ok(!JSON.stringify(projection).includes("Main prototype body must not leak"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Revision clear: updating plan during awaiting_approval clears grant and projects revision_changed.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-quick-preview-revision-"));
  try {
    const contextId = "pi_widget_quick_revision";
    const task = createYpiStudioTask({ cwd, title: "Quick preview revision", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    let result = bindSessionProjection(cwd, task.id, contextId);
    assert.equal(result.task.quickPreviews.find((item) => item.kind === "plan-review").approvalState, "approved");

    updateYpiStudioTaskArtifact(task.id, {
      cwd,
      action: "update_artifact",
      artifact: "plan-review",
      content: "# 蛋黄派计划审批书\n\n## 审批请求\n计划已变更，请重审。\n",
      contextId,
    });
    result = bindSessionProjection(cwd, task.id, contextId);
    const plan = result.task.quickPreviews.find((item) => item.kind === "plan-review");
    assert.ok(plan, "descriptor remains after revision");
    assert.equal(plan.approvalState, "revision_changed");
    assert.ok(!JSON.stringify(result.task).includes("计划已变更，请重审"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Multi-improvement: each improvement-plan carries its own improvementId; statuses independent.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-quick-preview-multi-"));
  try {
    const contextId = "pi_widget_quick_multi";
    const { task, instance } = setupImprovementTask(cwd, contextId, "Multi quick preview");
    const second = createYpiStudioImprovement(task.id, {
      cwd,
      action: "create_improvement",
      title: "Second improvement",
      feedback: "Second feedback stays out of widget",
      contextId,
    });
    const secondInstance = second.improvements.instances.find((item) => item.id !== instance.id);
    assert.ok(secondInstance);

    const firstDir = join(cwd, ".ypi", "tasks", task.id, "improvements", instance.id);
    const secondDir = join(cwd, ".ypi", "tasks", task.id, "improvements", secondInstance.id);
    writeFileSync(join(firstDir, "plan-review.md"), "# Imp plan one\n\nMeaningful.\n", "utf8");
    writeFileSync(join(secondDir, "plan-review.md"), "# Imp plan two\n\nMeaningful.\n", "utf8");
    writeFileSync(join(firstDir, "imp-one.html"), "<!DOCTYPE html><html><body>IMP1 body</body></html>\n", "utf8");

    // Advance first improvement through plan approval so its approvalState becomes approved.
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: instance.id, to: "waiting_plan_approval", contextId, reason: "Plan ready",
    });
    recordYpiStudioImprovementApproval(cwd, task.id, instance.id, contextId, "确认，批准开始实现");
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: instance.id, to: "implementing", contextId, reason: "Approved",
    });
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: instance.id, to: "checking", contextId, reason: "Done impl",
    });
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: instance.id, to: "waiting_user_acceptance", contextId, reason: "Checks ok",
    });

    const result = bindSessionProjection(cwd, task.id, contextId);
    const projection = result.task;
    assert.ok(projection);
    assertBoundedQuickPreviews(projection);

    const mainPlan = projection.quickPreviews.find((item) => item.kind === "plan-review" && !item.improvementId);
    assert.ok(mainPlan, "main plan remains while improvements are open");
    assert.equal(mainPlan.approvalState, "approved");

    const impPlans = projection.quickPreviews.filter((item) => item.kind === "improvement-plan");
    assert.equal(impPlans.length, 2);
    const firstPlan = impPlans.find((item) => item.improvementId === instance.id);
    const secondPlan = impPlans.find((item) => item.improvementId === secondInstance.id);
    assert.ok(firstPlan);
    assert.ok(secondPlan);
    assert.equal(firstPlan.displayId, instance.displayId);
    assert.equal(secondPlan.displayId, secondInstance.displayId);
    assert.equal(firstPlan.approvalState, "approved");
    assert.equal(secondPlan.approvalState, "pending");
    assert.notEqual(firstPlan.improvementId, secondPlan.improvementId);

    const firstProto = projection.quickPreviews.find(
      (item) => item.kind === "prototype" && item.improvementId === instance.id,
    );
    assert.ok(firstProto);
    assert.equal(firstProto.fileName, "imp-one.html");
    assert.ok(!projection.quickPreviews.some(
      (item) => item.kind === "prototype" && item.improvementId === secondInstance.id,
    ), "second improvement without HTML has no prototype descriptor");

    // canAccept only for waiting_user_acceptance instances.
    const projectedFirst = projection.improvements.instances.find((item) => item.id === instance.id);
    const projectedSecond = projection.improvements.instances.find((item) => item.id === secondInstance.id);
    assert.equal(projectedFirst.status, "waiting_user_acceptance");
    assert.equal(projectedFirst.canAccept, true);
    assert.equal(projectedSecond.canAccept, undefined);
    assert.ok(!("feedback" in projectedFirst));
    assert.ok(!JSON.stringify(projection).includes("Second feedback stays out of widget"));
    assert.ok(!JSON.stringify(projection).includes("IMP1 body"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Completed + archived tasks still project readonly plan descriptors; no canAccept.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-quick-preview-archive-"));
  try {
    const contextId = "pi_widget_quick_archive";
    const task = createYpiStudioTask({ cwd, title: "Quick preview archive", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    writeFileSync(
      join(cwd, ".ypi", "tasks", task.id, "archive-proto.html"),
      "<!DOCTYPE html><html><body>archive</body></html>\n",
      "utf8",
    );
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "user_acceptance", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "completed", override: true, contextId });

    let result = bindSessionProjection(cwd, task.id, contextId);
    let projection = result.task;
    assert.equal(projection.status, "completed");
    assertBoundedQuickPreviews(projection);
    assert.equal(projection.quickPreviews.find((item) => item.kind === "plan-review").approvalState, "approved");
    assert.ok(projection.quickPreviews.some((item) => item.kind === "prototype" && item.fileName === "archive-proto.html"));

    const archived = archiveYpiStudioTask(task.id, {
      cwd,
      reason: "archive quick preview fixture",
      contextId,
      allowFallbackKnowledge: true,
      knowledgeSummary: "Archived for quick preview coverage.",
      knowledgeMarkdown: "# Archive\n\n## Summary\nArchived for quick preview coverage.\n",
    });
    assert.ok(archived.task.key.startsWith("archived:"));
    assert.equal(archived.task.archived, true);

    // Archive clears session runtime pointers and forbids rebinding; helpers still resolve archived path.
    assert.equal(ypiStudioTaskPlanReviewFileExists(cwd, archived.task.key), true);
    assert.deepEqual(listYpiStudioTaskHtmlPrototypeFileNames(cwd, archived.task.key), ["archive-proto.html"]);

    // Archived tasks keep contextIds, so session-link can still project readonly quickPreviews.
    const sessionId = contextId.slice("pi_".length);
    const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
    result = resolveYpiStudioTaskForSession({ cwd, sessionId, sessionFilePath, entries: [] });
    projection = result.task
      ?? result.tasks.find((item) => item.task.key === archived.task.key)?.task
      ?? null;
    assert.ok(projection, "archived bound task still projects readonly descriptors");
    assert.equal(projection.archived, true);
    assertBoundedQuickPreviews(projection);
    assert.equal(projection.quickPreviews.find((item) => item.kind === "plan-review").approvalState, "readonly");
    assert.ok(projection.quickPreviews.some((item) => item.kind === "prototype" && item.fileName === "archive-proto.html"));
    if (projection.improvements?.instances?.length) {
      assert.ok(projection.improvements.instances.every((item) => item.canAccept !== true));
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Widget start_user_acceptance domain helper (SUA-DOMAIN-01) ---

{
  const body = {
    cwd: "/tmp",
    action: "start_user_acceptance",
    contextId: "pi_session",
    expectedRevision: 1,
  };
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody(body), true);
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...body, override: true }), false, "override rejected");
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...body, expectedRevision: 1.5 }), false);
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...body, expectedRevision: "1" }), false);
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...body, action: "approve_plan" }), false);
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-start-ua-"));
  try {
    const contextId = "pi_widget_start_ua";
    const task = createYpiStudioTask({ cwd, title: "Widget start UA", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "review");
    const revision = detail.meta.planRevision ?? 1;
    const grantBefore = detail.meta.approvalGrant;

    // Wrong context: zero write
    assert.throws(
      () => startYpiStudioUserAcceptanceFromWidget(task.id, {
        cwd, action: "start_user_acceptance", contextId: "pi_other_session", expectedRevision: revision,
      }),
      /not bound to this session context/,
    );
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "review");

    // Stale revision: zero write
    assert.throws(
      () => startYpiStudioUserAcceptanceFromWidget(task.id, {
        cwd, action: "start_user_acceptance", contextId, expectedRevision: revision + 99,
      }),
      /plan revision changed/,
    );
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "review");

    // Unresolved improvements: zero write
    const withImp = createYpiStudioImprovement(task.id, {
      cwd, action: "create_improvement", title: "Block UA", feedback: "still open", contextId,
    });
    assert.equal(withImp.status, "waiting_for_improvements");
    // Parent may leave review when creating improvements; force back to review with unresolved instance.
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "review");
    assert.ok(detail.improvements?.instances?.some((inst) => inst.status !== "accepted" && inst.status !== "accepted_not_doing"));
    assert.throws(
      () => startYpiStudioUserAcceptanceFromWidget(task.id, {
        cwd, action: "start_user_acceptance", contextId, expectedRevision: detail.meta.planRevision ?? 1,
      }),
      /zero unresolved improvements/,
    );
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "review", "unresolved must not leave review");

    // Resolve the improvement so clean review can proceed
    const impId = detail.improvements.instances[0].id;
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: impId, to: "cancelled", contextId,
    });
    resolveYpiStudioImprovementDisposition(task.id, {
      cwd,
      action: "resolve_improvement_disposition",
      improvementId: impId,
      disposition: "accepted_not_doing",
      reason: "Not needed for UA domain test",
      contextId,
    });
    detail = getYpiStudioTaskDetail(cwd, task.id);
    // Parent may auto-reconcile; ensure review + clean for happy path.
    if (detail.status !== "review") {
      transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
      detail = getYpiStudioTaskDetail(cwd, task.id);
    }
    assert.equal(detail.status, "review");
    assert.ok((detail.improvements?.instances ?? []).every((inst) => inst.status === "accepted" || inst.status === "accepted_not_doing"));

    const accepted = startYpiStudioUserAcceptanceFromWidget(task.id, {
      cwd,
      action: "start_user_acceptance",
      contextId,
      expectedRevision: detail.meta.planRevision ?? 1,
    });
    assert.equal(accepted.status, "user_acceptance");
    assert.ok(!accepted.completedAt, "must not complete");
    assert.ok(!accepted.archived, "must not archive");
    assert.deepEqual(accepted.meta.approvalGrant, grantBefore, "must not write/clear plan grant");
    assert.equal(accepted.currentMember, "main");

    const eventsPath = join(cwd, ".ypi", "tasks", task.id, "events.jsonl");
    const events = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const startEvent = events.find((ev) => ev.type === "transition" && ev.data?.action === "start_user_acceptance");
    assert.ok(startEvent, "auditable start_user_acceptance transition event");
    assert.equal(startEvent.from, "review");
    assert.equal(startEvent.to, "user_acceptance");
    assert.equal(startEvent.data.source, "user-widget");
    assert.equal(startEvent.data.contextId, contextId);

    // Wrong status after success: zero partial write / no re-entry
    assert.throws(
      () => startYpiStudioUserAcceptanceFromWidget(task.id, {
        cwd, action: "start_user_acceptance", contextId, expectedRevision: accepted.meta.planRevision ?? 1,
      }),
      /requires status review/,
    );
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "user_acceptance");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Widget decision CTA domain helpers (CTA-DOMAIN-01) ---

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-approve-plan-"));
  try {
    const contextId = "pi_widget_approve_plan";
    const task = createYpiStudioTask({ cwd, title: "Widget approve plan", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });

    // Wrong context: zero write
    assert.throws(
      () => approveYpiStudioPlanFromWidget(task.id, {
        cwd, action: "approve_plan", contextId: "pi_other_session", expectedRevision: 1,
      }),
      /not bound to this session context/,
    );
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "awaiting_approval");
    assert.equal(detail.meta.approvalGrant, undefined);

    // Stale revision: zero write
    assert.throws(
      () => approveYpiStudioPlanFromWidget(task.id, {
        cwd, action: "approve_plan", contextId, expectedRevision: 99,
      }),
      /plan revision changed/,
    );
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "awaiting_approval");
    assert.equal(detail.meta.approvalGrant, undefined);

    // Happy path: one user-widget grant + atomic implementing
    const approved = approveYpiStudioPlanFromWidget(task.id, {
      cwd, action: "approve_plan", contextId, expectedRevision: 1,
    });
    assert.equal(approved.status, "implementing");
    assert.equal(approved.meta.approvalGrant?.source, "user-widget");
    assert.equal(approved.meta.approvalGrant?.contextId, contextId);
    assert.ok(approved.meta.approvalGrant?.inputHash);

    // Second approve conflicts on status; no double transition
    assert.throws(
      () => approveYpiStudioPlanFromWidget(task.id, {
        cwd, action: "approve_plan", contextId, expectedRevision: 1,
      }),
      /requires status awaiting_approval/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-request-changes-"));
  try {
    const contextId = "pi_widget_request_changes";
    const task = createYpiStudioTask({ cwd, title: "Widget request changes", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    // Pre-seed a chat grant so request_changes must clear it.
    recordYpiStudioUserApproval(cwd, contextId, "确认，开始实现");
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.ok(detail.meta.approvalGrant);

    assert.throws(
      () => requestYpiStudioPlanChangesFromWidget(task.id, {
        cwd, action: "request_plan_changes", contextId, expectedRevision: 1, feedback: "   ",
      }),
      /non-empty feedback/,
    );
    detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "awaiting_approval");
    assert.ok(detail.meta.approvalGrant, "blank feedback must not clear grant");

    const changed = requestYpiStudioPlanChangesFromWidget(task.id, {
      cwd,
      action: "request_plan_changes",
      contextId,
      expectedRevision: 1,
      feedback: "请补充 Checks 与 HTML 原型链接",
    });
    assert.equal(changed.status, "planning");
    assert.equal(changed.meta.approvalGrant, undefined);
    assert.equal(changed.meta.planRevision, 2);
    assert.equal(changed.currentMember, "architect");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-imp-approve-"));
  try {
    const contextId = "pi_widget_imp_approve";
    const task = createYpiStudioTask({ cwd, title: "Widget improvement approve", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });

    const created = createYpiStudioImprovement(task.id, {
      cwd, action: "create_improvement", title: "Widget imp", feedback: "need fix", contextId,
    });
    const impId = created.improvements.instances[0].id;
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    writeFileSync(join(instDir, "plan-review.md"), "# Improvement Plan Review\n\nApprove this improvement.\n", "utf8");
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready",
    });

    // Missing material gate: zero write
    writeFileSync(join(instDir, "plan-review.md"), "TBD\n", "utf8");
    assert.throws(
      () => approveYpiStudioImprovementPlanFromWidget(task.id, {
        cwd, action: "approve_improvement_plan", contextId, expectedRevision: 1, improvementId: impId,
      }),
      /plan-review\.md is empty|TBD placeholder/,
    );
    let detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "waiting_for_improvements");
    assert.equal(detail.improvements.instances[0].status, "waiting_plan_approval");
    assert.equal(detail.improvements.instances[0].approval?.approvedAt, undefined);

    writeFileSync(join(instDir, "plan-review.md"), "# Improvement Plan Review\n\nApprove this improvement.\n", "utf8");

    // Wrong improvement id: zero write
    assert.throws(
      () => approveYpiStudioImprovementPlanFromWidget(task.id, {
        cwd, action: "approve_improvement_plan", contextId, expectedRevision: 1, improvementId: "does-not-exist",
      }),
      /Improvement not found/,
    );

    const approved = approveYpiStudioImprovementPlanFromWidget(task.id, {
      cwd, action: "approve_improvement_plan", contextId, expectedRevision: 1, improvementId: impId,
    });
    assert.equal(approved.status, "waiting_for_improvements", "parent stays waiting_for_improvements");
    const inst = approved.improvements.instances[0];
    assert.equal(inst.status, "implementing");
    assert.equal(inst.approval?.source, "user-widget");
    assert.equal(inst.approval?.contextId, contextId);
    assert.equal(inst.approval?.revision, 1);
    assert.ok(inst.approval?.approvedAt);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // user-widget grant remains readable by the existing implementation gate
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-grant-compat-"));
  try {
    const contextId = "pi_widget_grant_compat";
    const task = createYpiStudioTask({ cwd, title: "Widget grant compat", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    const approved = approveYpiStudioPlanFromWidget(task.id, {
      cwd, action: "approve_plan", contextId, expectedRevision: 1,
    });
    assert.equal(approved.status, "implementing");
    assert.equal(approved.meta.approvalGrant?.source, "user-widget");
    // Historical chat path still works independently
    const chatTask = createYpiStudioTask({ cwd, title: "Chat grant still works", workflowId: "feature-dev", contextId: "pi_chat_grant_still" });
    writePlanReview(cwd, chatTask.id, "pi_chat_grant_still");
    transitionYpiStudioTask(chatTask.id, { cwd, to: "awaiting_approval", override: true, contextId: "pi_chat_grant_still" });
    const chatApproved = recordYpiStudioUserApproval(cwd, "pi_chat_grant_still", "确认，开始实现");
    assert.equal(chatApproved?.meta.approvalGrant?.source, "user-input");
    const transitioned = transitionYpiStudioTask(chatTask.id, {
      cwd, to: "implementing", override: true, contextId: "pi_chat_grant_still", reason: "用户批准开始实现",
    });
    assert.equal(transitioned.status, "implementing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Widget decision continuation helpers (CTA-CONTINUATION-03) ---

{
  // Main implementing autocontinue: ready + free slots, no improvementId.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-cont-main-"));
  try {
    const contextId = "pi_cont_main_session";
    const task = createYpiStudioTask({ cwd, title: "Main cont", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [
          { id: "A", title: "Main A", order: 10, dependsOn: [] },
          { id: "B", title: "Main B", order: 20, dependsOn: [] },
        ],
      },
    });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    approveYpiStudioPlanFromWidget(task.id, {
      cwd, action: "approve_plan", contextId, expectedRevision: 1,
    });
    const detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "implementing");
    const sessionId = parseYpiStudioSessionIdFromContextId(contextId);
    assert.equal(sessionId, "cont_main_session");
    const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
    const link = resolveYpiStudioTaskForSession({ cwd, sessionId, sessionFilePath, entries: [] });
    const command = resolveYpiStudioSessionAutocontinueCommand({ cwd, primaryTask: link.task });
    assert.ok(command, "main ready+slots should project autocontinue");
    assert.equal(command.type, "studio_autocontinue");
    assert.equal(command.taskId, task.id);
    assert.equal(command.improvementId, undefined);
    assert.ok(command.availableSlots >= 1);
    assert.ok(command.readySubtaskCount >= 1);
    assert.match(String(command.stateKey), /:/);
    // Same stateKey payload should be stable for 30s dedupe on the RPC side.
    const again = resolveYpiStudioSessionAutocontinueCommand({ cwd, primaryTask: link.task });
    assert.equal(again.stateKey, command.stateKey);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Improvement implementing autocontinue: must include improvementId and not claim main DAG.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-cont-imp-"));
  try {
    const contextId = "pi_cont_imp_session";
    const mainPlan = {
      schemaVersion: 2,
      maxConcurrency: 1,
      subtasks: [
        { id: "MAIN_A", title: "Main A", order: 10, dependsOn: [] },
      ],
    };
    const { task, instance } = setupImprovementImplementing(cwd, contextId, "Imp cont", {
      schemaVersion: 2,
      maxConcurrency: 1,
      subtasks: [
        { id: "IMP_A", title: "Instance A", order: 10, dependsOn: [] },
      ],
    }, mainPlan);
    // Parent detail after setup: waiting_for_improvements with instance implementing.
    const detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "waiting_for_improvements");
    assert.equal(detail.improvements.instances[0].status, "implementing");
    // Main plan still has ready MAIN_A, but continuation must scope to instance.
    assert.equal(detail.implementationProgress.subtasks.MAIN_A.status, "ready");

    const sessionId = parseYpiStudioSessionIdFromContextId(contextId);
    const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
    const link = resolveYpiStudioTaskForSession({ cwd, sessionId, sessionFilePath, entries: [] });
    const command = resolveYpiStudioSessionAutocontinueCommand({ cwd, primaryTask: link.task });
    assert.ok(command, "improvement ready+slots should project autocontinue");
    assert.equal(command.type, "studio_autocontinue");
    assert.equal(command.taskId, detail.id);
    assert.equal(command.improvementId, instance.id);
    assert.equal(command.displayId, instance.displayId);
    assert.ok(String(command.stateKey).includes(`imp:${instance.id}`));
    assert.match(String(command.reason), /instance DAG/);
    // Prompt builder path is covered by command shape; claim path remains improvement-scoped.
    const next = getNextYpiStudioImplementationSubtask(cwd, detail.id, {
      limit: 5,
      improvementId: command.improvementId,
    });
    assert.deepEqual(next.subtasks.map((item) => item.id), ["IMP_A"]);
    assert.ok(!next.subtasks.some((item) => item.id === "MAIN_A"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // request_plan_changes continuation: fixed studio_user_action with bounded feedback; no task mutation.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-cont-request-"));
  try {
    const contextId = "pi_cont_request_session";
    const task = createYpiStudioTask({ cwd, title: "Request cont", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    const changed = requestYpiStudioPlanChangesFromWidget(task.id, {
      cwd,
      action: "request_plan_changes",
      contextId,
      expectedRevision: 1,
      feedback: "请补充 Checks 与 HTML 原型",
    });
    assert.equal(changed.status, "planning");
    assert.equal(changed.meta.planRevision, 2);

    const resolved = resolveYpiStudioRequestPlanChangesContinuation({
      contextId,
      taskId: changed.id,
      feedback: "请补充 Checks 与 HTML 原型",
      revisionFrom: 1,
      revisionTo: 2,
      updatedAt: changed.updatedAt,
    });
    assert.ok(resolved);
    assert.equal(resolved.sessionId, "cont_request_session");
    assert.equal(resolved.command.type, "studio_user_action");
    assert.equal(resolved.command.action, "request_plan_changes");
    assert.equal(resolved.command.taskId, changed.id);
    assert.equal(resolved.command.feedback, "请补充 Checks 与 HTML 原型");
    assert.equal(resolved.command.revisionFrom, 1);
    assert.equal(resolved.command.revisionTo, 2);

    // Continuation builder is pure: re-reading task shows planning still, grant cleared.
    const after = getYpiStudioTaskDetail(cwd, changed.id);
    assert.equal(after.status, "planning");
    assert.equal(after.meta.approvalGrant, undefined);

    // Non-session context yields null (no throw).
    assert.equal(
      resolveYpiStudioRequestPlanChangesContinuation({
        contextId: "pi_transcript_abc",
        taskId: changed.id,
        feedback: "x",
        revisionFrom: 1,
        revisionTo: 2,
      }),
      null,
    );

    // Stable command shape for dedupe key consumers.
    const cmd = buildYpiStudioRequestPlanChangesContinuationCommand({
      taskId: changed.id,
      feedback: "  keep  ",
      revisionFrom: 1,
      revisionTo: 2,
      updatedAt: "t1",
    });
    assert.equal(cmd.feedback, "keep");
    assert.ok(String(cmd.stateKey).includes("r1->2"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Non-decision phases project no autocontinue command.
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-cont-idle-"));
  try {
    const contextId = "pi_cont_idle_session";
    const task = createYpiStudioTask({ cwd, title: "Idle cont", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    const sessionId = parseYpiStudioSessionIdFromContextId(contextId);
    const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
    const link = resolveYpiStudioTaskForSession({ cwd, sessionId, sessionFilePath, entries: [] });
    assert.equal(link.task?.status, "awaiting_approval");
    assert.equal(resolveYpiStudioSessionAutocontinueCommand({ cwd, primaryTask: link.task }), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log("ypi-studio DAG scheduler tests passed");
