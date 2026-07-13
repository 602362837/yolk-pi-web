// TITLE-CHECKS: Studio child session title helper + projection cache isolation.
//
// Run:
//   npm run test:session-title
//   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-session-title.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createYpiStudioTask,
  recordYpiStudioSubagentRun,
  recordYpiStudioUserApproval,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioTaskArtifact,
} from "../lib/ypi-studio-tasks.ts";
import {
  invalidateSessionListSnapshots,
  projectStudioChildDisplay,
} from "../lib/session-reader.ts";
import {
  PENDING_SESSION_TITLE,
  SESSION_TITLE_MAX_LENGTH,
  displayTitleForSession,
  studioChildSessionTitle,
  truncateSessionTitle,
} from "../lib/session-title.ts";

const now = "2026-07-13T00:00:00.000Z";
let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function writePlanReview(cwd, taskId, contextId) {
  updateYpiStudioTaskArtifact(taskId, {
    cwd,
    action: "update_artifact",
    artifact: "plan-review",
    content: "# 蛋黄派计划审批书\n\n## 审批请求\n请审阅并确认。\n\n## 必读产物\n- [Implementation Plan](./implement.md)\n",
    contextId,
  });
}

function childSession(partial = {}) {
  return {
    id: partial.id ?? "child-session-id",
    name: partial.name,
    firstMessage: partial.firstMessage ?? "",
    messageCount: partial.messageCount ?? 1,
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
      member: "implementer",
      createdAt: now,
      ...partial.studioChild,
    },
    studioChildDisplay: partial.studioChildDisplay,
  };
}

console.log("session-title helper");

await test("subtask id + title", () => {
  assert.equal(
    studioChildSessionTitle({
      subtaskId: "TITLE-PROJECTION",
      subtaskTitle: "Unify Studio child step titles",
      member: "implementer",
      taskTitle: "Parent task",
    }),
    "TITLE-PROJECTION · Unify Studio child step titles",
  );
});

await test("id-only when title missing", () => {
  assert.equal(
    studioChildSessionTitle({
      subtaskId: "TITLE-CHECKS",
      member: "checker",
      taskTitle: "Parent task",
    }),
    "TITLE-CHECKS",
  );
  assert.equal(
    studioChildSessionTitle({
      subtaskId: "TITLE-CHECKS",
      subtaskTitle: "   ",
      member: "checker",
    }),
    "TITLE-CHECKS",
  );
});

await test("no-subtask fallback uses member + task title", () => {
  assert.equal(
    studioChildSessionTitle({
      member: "architect",
      taskTitle: "子 session 名称拼入 step 编号信息",
      runSummary: "planning",
      taskId: "20260713-125949-task",
    }),
    "architect · 子 session 名称拼入 step 编号信息",
  );
});

await test("whitespace normalization", () => {
  assert.equal(
    studioChildSessionTitle({
      subtaskId: "  STEP-01  ",
      subtaskTitle: "  增加共享\nchild\tsession 标题 helper  ",
    }),
    "STEP-01 · 增加共享 child session 标题 helper",
  );
});

await test("50-char priority keeps full subtask id before title", () => {
  const subtaskId = "VERY-LONG-SUBTASK-ID-0123456789";
  const title = "this title would normally push past the max length budget";
  const result = studioChildSessionTitle({ subtaskId, subtaskTitle: title, member: "implementer" });
  assert.ok(result.startsWith(subtaskId), `expected id prefix, got ${result}`);
  assert.ok(result.includes(" · "), `expected separator, got ${result}`);
  assert.equal(result.length, SESSION_TITLE_MAX_LENGTH);
  assert.equal(result, `${subtaskId} · ${title}`.slice(0, SESSION_TITLE_MAX_LENGTH));
});

await test("id alone is truncated when longer than max", () => {
  const subtaskId = "X".repeat(SESSION_TITLE_MAX_LENGTH + 12);
  const result = studioChildSessionTitle({ subtaskId, subtaskTitle: "ignored" });
  assert.equal(result, "X".repeat(SESSION_TITLE_MAX_LENGTH));
  assert.equal(result.length, SESSION_TITLE_MAX_LENGTH);
});

await test("no-subtask long title prefers task title over member", () => {
  const taskTitle = "这是一个很长的任务标题用于验证无 subtask 时优先保留标题而不是 member 前缀";
  const result = studioChildSessionTitle({
    member: "improver",
    taskTitle,
  });
  assert.equal(result, truncateSessionTitle(taskTitle));
  assert.ok(!result.startsWith("improver"), `member should not crowd title: ${result}`);
  assert.equal(result.length <= SESSION_TITLE_MAX_LENGTH, true);
});

await test("runSummary and taskId fallbacks", () => {
  assert.equal(
    studioChildSessionTitle({ member: "architect", runSummary: "drafting plan" }),
    "architect · drafting plan",
  );
  assert.equal(
    studioChildSessionTitle({ member: "architect", taskId: "path/to/20260713-task-id" }),
    "architect · 20260713-task-id",
  );
});

await test("displayTitleForSession uses projection subtaskId and shared helper", () => {
  assert.equal(
    displayTitleForSession(childSession({
      studioChild: { subtaskId: "HEADER-ID", member: "implementer", taskId: "task-1" },
      studioChildDisplay: {
        subtaskId: "STEP-01",
        subtaskTitle: "增加共享 child session 标题 helper",
        taskTitle: "Parent",
      },
    })),
    "STEP-01 · 增加共享 child session 标题 helper",
  );

  assert.equal(
    displayTitleForSession(childSession({
      studioChild: { subtaskId: "HEADER-ONLY", member: "checker", taskId: "task-1" },
      studioChildDisplay: undefined,
    })),
    "HEADER-ONLY",
  );

  assert.equal(
    displayTitleForSession(childSession({
      studioChild: { member: "architect", taskId: "task-1", subtaskId: undefined },
      studioChildDisplay: { taskTitle: "子 session 名称拼入 step 编号信息" },
    })),
    "architect · 子 session 名称拼入 step 编号信息",
  );
});

await test("ordinary session fallback is unchanged", () => {
  assert.equal(
    displayTitleForSession({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "  Explicit Name  ",
      firstMessage: "ignored",
      messageCount: 2,
    }),
    "Explicit Name",
  );
  assert.equal(
    displayTitleForSession({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      firstMessage: "  first   user\nmessage  ",
      messageCount: 1,
    }),
    "first user message",
  );
  assert.equal(
    displayTitleForSession({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      firstMessage: "",
      messageCount: 0,
    }),
    PENDING_SESSION_TITLE,
  );
  assert.equal(
    displayTitleForSession({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      firstMessage: "",
      messageCount: 3,
    }),
    "aaaaaaaa-bbb",
  );
});

console.log("studio child display projection");

await test("same-task children isolate by subtaskId and runId", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ypi-session-title-proj-"));
  try {
    invalidateSessionListSnapshots();
    const contextId = "pi_title_projection_isolation";
    const task = createYpiStudioTask({
      cwd,
      title: "子 session 名称拼入 step 编号信息",
      workflowId: "feature-dev",
      contextId,
    });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [
          { id: "TITLE-PROJECTION", title: "Unify Studio child step titles", order: 20, dependsOn: [] },
          { id: "TITLE-CHECKS", title: "Add focused tests and docs", order: 30, dependsOn: [] },
        ],
      },
    });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "批准");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });

    recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-proj-a",
      taskId: task.id,
      member: "implementer",
      status: "running",
      mode: "async",
      subtaskId: "TITLE-PROJECTION",
      summary: "projection summary A",
      startedAt: now,
      updatedAt: now,
    });
    recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-checks-b",
      taskId: task.id,
      member: "checker",
      status: "running",
      mode: "async",
      subtaskId: "TITLE-CHECKS",
      summary: "projection summary B",
      startedAt: now,
      updatedAt: now,
    });

    const childA = {
      schemaVersion: 1,
      kind: "ypi-studio-child-session",
      runner: "sdk",
      visibility: "child",
      status: "running",
      parentSessionId: "parent-session",
      parentSessionFile: "/tmp/parent.jsonl",
      contextId,
      taskId: task.id,
      runId: "run-proj-a",
      member: "implementer",
      subtaskId: "TITLE-PROJECTION",
      createdAt: now,
    };
    const childB = {
      ...childA,
      runId: "run-checks-b",
      member: "checker",
      subtaskId: "TITLE-CHECKS",
      status: "running",
    };

    const displayA = projectStudioChildDisplay(cwd, childA);
    const displayB = projectStudioChildDisplay(cwd, childB);
    assert.equal(displayA?.subtaskId, "TITLE-PROJECTION");
    assert.equal(displayA?.subtaskTitle, "Unify Studio child step titles");
    assert.equal(displayA?.runSummary, "projection summary A");
    assert.equal(displayB?.subtaskId, "TITLE-CHECKS");
    assert.equal(displayB?.subtaskTitle, "Add focused tests and docs");
    assert.equal(displayB?.runSummary, "projection summary B");

    // Cached re-read must not cross-contaminate.
    const displayAAgain = projectStudioChildDisplay(cwd, childA);
    assert.equal(displayAAgain?.subtaskId, "TITLE-PROJECTION");
    assert.equal(displayAAgain?.subtaskTitle, "Unify Studio child step titles");
    assert.equal(displayAAgain?.runSummary, "projection summary A");

    assert.equal(
      displayTitleForSession({
        id: "child-a",
        firstMessage: "",
        messageCount: 1,
        studioChild: childA,
        studioChildDisplay: displayA,
      }),
      "TITLE-PROJECTION · Unify Studio child step titles",
    );
    assert.equal(
      displayTitleForSession({
        id: "child-b",
        firstMessage: "",
        messageCount: 1,
        studioChild: childB,
        studioChildDisplay: displayB,
      }),
      "TITLE-CHECKS · Add focused tests and docs",
    );

    // Header-only path still surfaces stable step id when task detail is missing.
    const missingTaskDisplay = projectStudioChildDisplay(cwd, {
      ...childA,
      taskId: "missing-task-id",
      subtaskId: "ORPHAN-STEP",
      runId: "run-orphan",
    });
    assert.deepEqual(missingTaskDisplay, { subtaskId: "ORPHAN-STEP" });
    assert.equal(
      displayTitleForSession({
        id: "orphan-child",
        firstMessage: "",
        messageCount: 1,
        studioChild: {
          ...childA,
          taskId: "missing-task-id",
          subtaskId: "ORPHAN-STEP",
          runId: "run-orphan",
        },
        studioChildDisplay: missingTaskDisplay,
      }),
      "ORPHAN-STEP",
    );
  } finally {
    invalidateSessionListSnapshots();
    rmSync(cwd, { recursive: true, force: true });
  }
});

if (failures > 0) {
  console.error(`\nsession-title tests failed: ${failures}`);
  process.exit(1);
}

console.log("\nsession-title tests passed");
