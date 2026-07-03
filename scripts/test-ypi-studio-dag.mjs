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
  recordYpiStudioUserApproval,
  refreshDerivedImplementationDAG,
  selectNextYpiStudioImplementationSubtask,
  selectReadyYpiStudioImplementationSubtasks,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
} from "../lib/ypi-studio-tasks.ts";

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
