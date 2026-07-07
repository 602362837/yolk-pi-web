import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimYpiStudioImplementationSubtask,
  createYpiStudioTask,
  getNextYpiStudioImplementationSubtask,
  implementationCounts,
  normalizeImplementationPlan,
  propagateBlockedDependents,
  recordYpiStudioSubagentRun,
  recordYpiStudioUserApproval,
  refreshDerivedImplementationDAG,
  selectNextYpiStudioImplementationSubtask,
  selectReadyYpiStudioImplementationSubtasks,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
} from "../lib/ypi-studio-tasks.ts";
import {
  countActiveYpiStudioChildRunsForSession,
  registerYpiStudioChildRun,
  registerYpiStudioSessionContinuation,
  scheduleYpiStudioChildRunContinuation,
  unregisterYpiStudioChildRun,
  unregisterYpiStudioSessionContinuation,
} from "../lib/ypi-studio-subagent-runtime.ts";

const now = "2026-07-03T00:00:00.000Z";

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
    const approvalContextId = "pi_inline_approval_current_chat";
    const task = createYpiStudioTask({ cwd, title: "Inline approval", workflowId: "feature-dev", contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    const transitioned = transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId: approvalContextId, reason: "用户批准开始实现" });
    assert.equal(transitioned.status, "implementing");
    assert.equal(transitioned.meta.approvalGrant?.contextId, approvalContextId);
    assert.ok(transitioned.contextIds.includes(approvalContextId));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-approval-"));
  try {
    const contextId = "pi_approval_fallback";
    const task = createYpiStudioTask({ cwd, title: "Approval fallback", workflowId: "feature-dev", contextId });
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

console.log("ypi-studio DAG scheduler tests passed");
