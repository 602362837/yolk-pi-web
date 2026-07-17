/**
 * Focused tests for CTA-PROJECTION-02:
 * - sparse userActions projection rules
 * - explicit widget PATCH body guards (shape only; domain helpers covered by studio-dag)
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildWidgetUserActions,
  resolveYpiStudioTaskForSession,
} from "../lib/ypi-studio-session-link.ts";
import {
  bindYpiStudioTaskToContext,
  createYpiStudioTask,
  createYpiStudioImprovement,
  getYpiStudioTaskDetail,
  isYpiStudioTaskTransitionBody,
  isYpiStudioWidgetApproveImprovementPlanBody,
  isYpiStudioWidgetApprovePlanBody,
  isYpiStudioWidgetRequestPlanChangesBody,
  isYpiStudioWidgetStartUserAcceptanceBody,
  recordYpiStudioUserApproval,
  resolveYpiStudioImprovementDisposition,
  transitionYpiStudioImprovement,
  transitionYpiStudioTask,
} from "../lib/ypi-studio-tasks.ts";

function writePlanReview(cwd, taskId, contextId) {
  const dir = join(cwd, ".ypi", "tasks", taskId);
  writeFileSync(
    join(dir, "plan-review.md"),
    `# Plan Review\n\nContext: ${contextId}\n\nMeaningful approval plan content for tests.\n`,
    "utf8",
  );
}

function bindSessionProjection(cwd, taskId, contextId) {
  if (!contextId.startsWith("pi_")) throw new Error(`expected pi_ contextId, got ${contextId}`);
  const sessionId = contextId.slice("pi_".length);
  const sessionFilePath = join(cwd, ".ypi", ".runtime", "sessions", `${contextId}.json`);
  bindYpiStudioTaskToContext(cwd, taskId, contextId);
  return resolveYpiStudioTaskForSession({
    cwd,
    sessionId,
    sessionFilePath,
    entries: [],
  });
}

function assertBoundedUserActions(actions) {
  assert.ok(Array.isArray(actions));
  assert.ok(actions.length <= 2, `userActions max 2, got ${actions.length}`);
  for (const action of actions) {
    assert.equal(typeof action.id, "string");
    assert.ok(action.id.length > 0);
    assert.ok([
      "approve_plan",
      "request_plan_changes",
      "approve_improvement_plan",
      "start_user_acceptance",
    ].includes(action.kind));
    assert.equal(typeof action.label, "string");
    assert.ok(["primary", "secondary"].includes(action.role));
    assert.equal(action.requiresConfirmation, true);
    assert.equal(typeof action.expectedRevision, "number");
    assert.equal(typeof action.targetLabel, "string");
    assert.ok(action.targetLabel.length > 0);
    assert.ok(action.targetLabel.length <= 120, "targetLabel must stay bounded");
    // Never project remote-exec / material payload fields.
    for (const forbidden of [
      "endpoint", "url", "method", "body", "feedback", "content", "markdown",
      "html", "path", "cwd", "override", "source", "transcript",
    ]) {
      assert.ok(!(forbidden in action), `action must not include ${forbidden}`);
    }
    if (action.kind === "approve_improvement_plan") {
      assert.equal(typeof action.improvementId, "string");
      assert.ok(action.improvementId.length > 0);
      assert.equal(typeof action.displayId, "string");
    } else {
      assert.equal(action.improvementId, undefined);
    }
  }
}

// --- Pure projection rules ---

{
  assert.deepEqual(
    buildWidgetUserActions({ status: "planning", title: "T", archived: false }),
    [],
    "planning has no decision CTA",
  );
  assert.deepEqual(
    buildWidgetUserActions({ status: "implementing", title: "T" }),
    [],
    "implementing has no decision CTA",
  );
  assert.deepEqual(
    buildWidgetUserActions({ status: "checking", title: "T" }),
    [],
    "checking has no decision CTA",
  );
  assert.deepEqual(
    buildWidgetUserActions({ status: "awaiting_approval", title: "T", archived: true, meta: { planRevision: 1 } }),
    [],
    "archived tasks project empty userActions",
  );

  const mainActions = buildWidgetUserActions({
    status: "awaiting_approval",
    title: "Main plan task",
    meta: { planRevision: 3 },
  });
  assertBoundedUserActions(mainActions);
  assert.equal(mainActions.length, 2);
  assert.equal(mainActions[0].kind, "approve_plan");
  assert.equal(mainActions[0].role, "primary");
  assert.equal(mainActions[0].label, "批准并开始实现");
  assert.equal(mainActions[0].expectedRevision, 3);
  assert.equal(mainActions[0].id, "main:approve:r3");
  assert.equal(mainActions[1].kind, "request_plan_changes");
  assert.equal(mainActions[1].role, "secondary");
  assert.equal(mainActions[1].label, "需要修改");
  assert.equal(mainActions[1].expectedRevision, 3);
  assert.ok(mainActions[0].targetLabel.includes("Revision 3"));

  // Default revision when meta.planRevision absent.
  const defaultRev = buildWidgetUserActions({ status: "awaiting_approval", title: "No rev" });
  assert.equal(defaultRev[0].expectedRevision, 1);
  assert.equal(defaultRev[0].id, "main:approve:r1");

  // Improvement: only first waiting_plan_approval, parent must be waiting_for_improvements.
  const impActions = buildWidgetUserActions({
    status: "waiting_for_improvements",
    title: "Parent",
    improvements: {
      instances: [
        {
          id: "imp-old",
          displayId: "IMP-001",
          title: "Already implementing",
          status: "implementing",
          approval: { revision: 1 },
        },
        {
          id: "imp-a",
          displayId: "IMP-002",
          title: "First waiting plan",
          status: "waiting_plan_approval",
          approval: { revision: 2 },
        },
        {
          id: "imp-b",
          displayId: "IMP-003",
          title: "Second waiting plan",
          status: "waiting_plan_approval",
          approval: { revision: 4 },
        },
        {
          id: "imp-c",
          displayId: "IMP-004",
          title: "Result accept still separate",
          status: "waiting_user_acceptance",
        },
      ],
    },
  });
  assertBoundedUserActions(impActions);
  assert.equal(impActions.length, 1, "only first waiting plan approval is projected");
  assert.equal(impActions[0].kind, "approve_improvement_plan");
  assert.equal(impActions[0].improvementId, "imp-a");
  assert.equal(impActions[0].displayId, "IMP-002");
  assert.equal(impActions[0].expectedRevision, 2);
  assert.equal(impActions[0].id, "improvement:imp-a:approve:r2");
  assert.ok(impActions[0].targetLabel.includes("IMP-002"));
  assert.ok(impActions[0].targetLabel.includes("Revision 2"));

  // Parent not in waiting_for_improvements => empty even if instances wait plan approval.
  assert.deepEqual(
    buildWidgetUserActions({
      status: "user_acceptance",
      title: "Main accept",
      improvements: {
        instances: [{ id: "x", displayId: "IMP-9", title: "x", status: "waiting_plan_approval" }],
      },
    }),
    [],
  );

  // review + unresolved=0 => exactly one start_user_acceptance primary CTA.
  const reviewClean = buildWidgetUserActions({
    status: "review",
    title: "Ready for acceptance",
    meta: { planRevision: 4 },
    improvements: {
      instances: [
        { id: "imp-done", displayId: "IMP-001", title: "done", status: "accepted" },
        { id: "imp-skip", displayId: "IMP-002", title: "skip", status: "accepted_not_doing" },
      ],
    },
  });
  assertBoundedUserActions(reviewClean);
  assert.equal(reviewClean.length, 1);
  assert.equal(reviewClean[0].kind, "start_user_acceptance");
  assert.equal(reviewClean[0].role, "primary");
  assert.equal(reviewClean[0].label, "开始用户验收");
  assert.equal(reviewClean[0].expectedRevision, 4);
  assert.equal(reviewClean[0].id, "main:start_user_acceptance:r4");
  assert.ok(reviewClean[0].targetLabel.includes("主任务"));
  assert.ok(reviewClean[0].targetLabel.includes("Ready for acceptance"));

  // No instances is also clean review.
  const reviewNoImp = buildWidgetUserActions({
    status: "review",
    title: "No improvements",
  });
  assert.equal(reviewNoImp.length, 1);
  assert.equal(reviewNoImp[0].kind, "start_user_acceptance");
  assert.equal(reviewNoImp[0].expectedRevision, 1);
  assert.equal(reviewNoImp[0].id, "main:start_user_acceptance:r1");

  // review + still unresolved => no start_user_acceptance CTA.
  assert.deepEqual(
    buildWidgetUserActions({
      status: "review",
      title: "Still has improvements",
      improvements: {
        instances: [
          { id: "imp-open", displayId: "IMP-003", title: "open", status: "waiting_user_acceptance" },
        ],
      },
    }),
    [],
    "review with unresolved improvements must not project start_user_acceptance",
  );

  // Other phases must not project start_user_acceptance.
  for (const status of ["user_acceptance", "implementing", "checking", "awaiting_approval", "planning"]) {
    const actions = buildWidgetUserActions({
      status,
      title: "Other phase",
      meta: { planRevision: 1 },
      improvements: { instances: [] },
    });
    assert.ok(
      !actions.some((action) => action.kind === "start_user_acceptance"),
      `${status} must not project start_user_acceptance`,
    );
  }
  assert.deepEqual(
    buildWidgetUserActions({
      status: "review",
      title: "Archived review",
      archived: true,
      meta: { planRevision: 1 },
    }),
    [],
    "archived review projects empty userActions",
  );
}

// --- Integration: projection on live task detail + conservation of canAcceptMain/quickPreviews ---

{
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-widget-actions-proj-"));
  try {
    const contextId = "pi_widget_actions_proj";
    const task = createYpiStudioTask({ cwd, title: "Projection live", workflowId: "feature-dev", contextId });
    writePlanReview(cwd, task.id, contextId);

    // planning: no userActions
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    let result = bindSessionProjection(cwd, task.id, contextId);
    assert.ok(result.task);
    assert.equal(result.task.userActions, undefined);
    assert.ok(Array.isArray(result.task.quickPreviews) && result.task.quickPreviews.length > 0, "quickPreviews conserved");

    // awaiting_approval: primary + secondary
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    result = bindSessionProjection(cwd, task.id, contextId);
    assert.equal(result.task.status, "awaiting_approval");
    assertBoundedUserActions(result.task.userActions);
    assert.equal(result.task.userActions.length, 2);
    assert.equal(result.task.userActions[0].kind, "approve_plan");
    assert.equal(result.task.userActions[1].kind, "request_plan_changes");
    assert.ok(result.task.quickPreviews.some((p) => p.kind === "plan-review"));
    assert.notEqual(result.task.canAcceptMain, true);

    // implementing: empty again
    recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    result = bindSessionProjection(cwd, task.id, contextId);
    assert.equal(result.task.status, "implementing");
    assert.equal(result.task.userActions, undefined);
    assert.ok(result.task.quickPreviews.some((p) => p.kind === "plan-review"), "quickPreviews still present after approval");

    // improvement waiting plan approval
    transitionYpiStudioTask(task.id, { cwd, to: "checking", override: true, contextId });
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
    const created = createYpiStudioImprovement(task.id, {
      cwd, action: "create_improvement", title: "Projection imp", feedback: "need fix", contextId,
    });
    const impId = created.improvements.instances[0].id;
    const instDir = join(cwd, ".ypi", "tasks", task.id, "improvements", impId);
    mkdirSync(instDir, { recursive: true });
    writeFileSync(join(instDir, "plan-review.md"), "# Improvement Plan Review\n\nApprove this improvement.\n", "utf8");
    // Second improvement also waiting plan approval — projection must keep only first.
    const created2 = createYpiStudioImprovement(task.id, {
      cwd, action: "create_improvement", title: "Second imp", feedback: "another", contextId,
    });
    const impId2 = created2.improvements.instances.find((i) => i.id !== impId)?.id;
    assert.ok(impId2);
    const instDir2 = join(cwd, ".ypi", "tasks", task.id, "improvements", impId2);
    mkdirSync(instDir2, { recursive: true });
    writeFileSync(join(instDir2, "plan-review.md"), "# Improvement Plan Review 2\n\nAlso waiting.\n", "utf8");

    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: impId, to: "waiting_plan_approval", contextId, reason: "Ready",
    });
    transitionYpiStudioImprovement(task.id, {
      cwd, action: "transition_improvement", improvementId: impId2, to: "waiting_plan_approval", contextId, reason: "Ready",
    });

    const detail = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(detail.status, "waiting_for_improvements");
    result = bindSessionProjection(cwd, task.id, contextId);
    assertBoundedUserActions(result.task.userActions);
    assert.equal(result.task.userActions.length, 1);
    assert.equal(result.task.userActions[0].kind, "approve_improvement_plan");
    assert.equal(result.task.userActions[0].improvementId, impId);
    // Conservation: improvements summary + canAccept flags still projected independently of plan CTAs.
    assert.ok(result.task.improvements);
    assert.equal(result.task.improvements.unresolved >= 2, true);
    assert.ok(result.task.quickPreviews.some((p) => p.kind === "improvement-plan" && p.improvementId === impId));

    // review + unresolved improvements: no start_user_acceptance CTA; canAcceptMain stays false.
    transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
    result = bindSessionProjection(cwd, task.id, contextId);
    assert.equal(result.task.status, "review");
    assert.equal(result.task.userActions, undefined);
    assert.notEqual(result.task.canAcceptMain, true);

    // Resolve all improvements via accepted_not_doing path, then stay/force review for clean CTA.
    for (const instance of getYpiStudioTaskDetail(cwd, task.id).improvements.instances) {
      if (["accepted", "accepted_not_doing"].includes(instance.status)) continue;
      if (instance.status !== "cancelled" && instance.status !== "failed") {
        transitionYpiStudioImprovement(task.id, {
          cwd,
          action: "transition_improvement",
          improvementId: instance.id,
          to: "cancelled",
          contextId,
          reason: "Resolve for projection test",
        });
      }
      resolveYpiStudioImprovementDisposition(task.id, {
        cwd,
        action: "resolve_improvement_disposition",
        improvementId: instance.id,
        disposition: "accepted_not_doing",
        reason: "Not needed for projection test",
        contextId,
      });
    }
    let detailAfter = getYpiStudioTaskDetail(cwd, task.id);
    // Returning from waiting_for_improvements may leave status as waiting_for_improvements or review depending on auto-advance.
    if (detailAfter.status !== "review") {
      transitionYpiStudioTask(task.id, { cwd, to: "review", override: true, contextId });
      detailAfter = getYpiStudioTaskDetail(cwd, task.id);
    }
    assert.equal(detailAfter.status, "review");
    assert.ok(
      (detailAfter.improvements?.instances ?? []).every(
        (inst) => inst.status === "accepted" || inst.status === "accepted_not_doing",
      ),
      "all improvements must be resolved before clean review CTA",
    );
    result = bindSessionProjection(cwd, task.id, contextId);
    assertBoundedUserActions(result.task.userActions);
    assert.equal(result.task.userActions.length, 1);
    assert.equal(result.task.userActions[0].kind, "start_user_acceptance");
    assert.equal(result.task.userActions[0].role, "primary");
    assert.equal(result.task.userActions[0].label, "开始用户验收");
    assert.notEqual(result.task.canAcceptMain, true, "canAcceptMain must remain false while still in review");
    assert.ok(Array.isArray(result.task.quickPreviews), "quickPreviews conserved on review CTA");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// --- Explicit body guards: match fixed actions, reject override, do not swallow as transition ---

{
  const approve = {
    cwd: "/tmp",
    action: "approve_plan",
    contextId: "pi_session",
    expectedRevision: 1,
  };
  assert.equal(isYpiStudioWidgetApprovePlanBody(approve), true);
  assert.equal(isYpiStudioTaskTransitionBody(approve), false, "approve_plan must not match transition body");
  assert.equal(isYpiStudioWidgetApprovePlanBody({ ...approve, override: true }), false, "override rejected");
  assert.equal(isYpiStudioWidgetApprovePlanBody({ ...approve, expectedRevision: 1.5 }), false);
  assert.equal(isYpiStudioWidgetApprovePlanBody({ ...approve, expectedRevision: "1" }), false);

  const changes = {
    cwd: "/tmp",
    action: "request_plan_changes",
    contextId: "pi_session",
    expectedRevision: 2,
    feedback: "please fix",
  };
  assert.equal(isYpiStudioWidgetRequestPlanChangesBody(changes), true);
  assert.equal(isYpiStudioTaskTransitionBody(changes), false);
  assert.equal(isYpiStudioWidgetRequestPlanChangesBody({ ...changes, override: false }), false);
  assert.equal(isYpiStudioWidgetRequestPlanChangesBody({ ...changes, feedback: 1 }), false);

  const imp = {
    cwd: "/tmp",
    action: "approve_improvement_plan",
    contextId: "pi_session",
    expectedRevision: 1,
    improvementId: "imp-1",
  };
  assert.equal(isYpiStudioWidgetApproveImprovementPlanBody(imp), true);
  assert.equal(isYpiStudioTaskTransitionBody(imp), false);
  assert.equal(isYpiStudioWidgetApproveImprovementPlanBody({ ...imp, override: true }), false);
  assert.equal(isYpiStudioWidgetApproveImprovementPlanBody({ ...imp, improvementId: 1 }), false);

  const startUa = {
    cwd: "/tmp",
    action: "start_user_acceptance",
    contextId: "pi_session",
    expectedRevision: 1,
  };
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody(startUa), true);
  assert.equal(isYpiStudioTaskTransitionBody(startUa), false, "start_user_acceptance must not match transition body");
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...startUa, override: true }), false, "override rejected");
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...startUa, expectedRevision: 1.5 }), false);
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...startUa, expectedRevision: "1" }), false);
  assert.equal(isYpiStudioWidgetStartUserAcceptanceBody({ ...startUa, reason: "x" }), true, "extra reason field does not break shape; helper ignores it");

  // Loose parent transition still works for legitimate transition bodies.
  assert.equal(isYpiStudioTaskTransitionBody({ cwd: "/tmp", to: "implementing" }), true);
  assert.equal(isYpiStudioTaskTransitionBody({ cwd: "/tmp", to: "implementing", action: "transition" }), true);
  assert.equal(
    isYpiStudioTaskTransitionBody({ cwd: "/tmp", to: "accepted", action: "transition_improvement", improvementId: "x" }),
    false,
  );
}

console.log("ypi-studio widget-actions projection tests passed");
