// Focused projection tests for GET /api/sessions/:id/studio-children helper.
//
// Covers high-confidence parent association, task status authority + header stale
// fallback, stable sort/terminal trim, defensive active cap, and wire privacy.
//
// Run:
//   npm run test:studio-child-sessions
//   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-studio-child-session-list.mjs

import assert from "node:assert/strict";

const {
  STUDIO_CHILD_DEFENSIVE_ACTIVE_CAP,
  STUDIO_CHILD_TERMINAL_LIMIT,
  applyStudioChildSessionListLimits,
  buildStudioChildSessionListFromSessions,
  getStudioChildSessionListForParent,
  isHighConfidenceStudioChildOfParent,
  normalizeStudioChildPanelStatus,
  projectStudioChildSessionListItem,
  sortStudioChildSessionListItems,
  StudioChildSessionListError,
  truncateStudioChildWireString,
} = await import("../lib/studio-child-session-list.ts");

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

function baseStudioChild(partial = {}) {
  return {
    schemaVersion: 1,
    kind: "ypi-studio-child-session",
    runner: "sdk",
    visibility: "child",
    status: partial.status ?? "running",
    parentSessionId: partial.parentSessionId ?? "parent-1",
    parentSessionFile: "/secret/parent.jsonl",
    contextId: "pi_parent-1",
    taskId: partial.taskId ?? "task-1",
    runId: partial.runId ?? "run-1",
    member: partial.member ?? "implementer",
    subtaskId: partial.subtaskId,
    createdAt: partial.createdAt ?? "2026-07-16T00:00:00.000Z",
    finishedAt: partial.finishedAt,
    terminationReason: partial.terminationReason,
  };
}

function session(partial = {}) {
  return {
    path: partial.path ?? "/secret/sessions/child.jsonl",
    id: partial.id ?? "child-1",
    cwd: partial.cwd ?? "/secret/workspace",
    name: partial.name,
    created: partial.created ?? "2026-07-16T00:00:00.000Z",
    modified: partial.modified ?? "2026-07-16T01:00:00.000Z",
    messageCount: partial.messageCount ?? 3,
    firstMessage: partial.firstMessage ?? "do work",
    parentSessionId: partial.parentSessionId,
    projectId: partial.projectId,
    spaceId: partial.spaceId,
    studioChild: partial.studioChild === null ? undefined : (partial.studioChild ?? baseStudioChild(partial.childMeta ?? {})),
    studioChildDisplay: partial.studioChildDisplay,
  };
}

function assertNoPrivateFields(payload) {
  const json = JSON.stringify(payload);
  const forbidden = [
    "\"path\"",
    "\"cwd\"",
    "parentSessionFile",
    "childSessionFile",
    "contextId",
    "\"prompt\"",
    "\"output\"",
    "\"summary\"",
    "\"error\"",
    "transcript",
    "artifact",
    "/secret/",
  ];
  for (const token of forbidden) {
    assert.equal(json.includes(token), false, `wire must not contain ${token}`);
  }
}

await test("normalizeStudioChildPanelStatus maps known and unknown values", () => {
  assert.equal(normalizeStudioChildPanelStatus("waiting_for_user").status, "waiting_for_user");
  assert.equal(normalizeStudioChildPanelStatus("runtime_lost").status, "runtime_lost");
  assert.deepEqual(normalizeStudioChildPanelStatus("weird"), { status: "unknown", rawStatus: "weird" });
  assert.deepEqual(normalizeStudioChildPanelStatus(undefined), { status: "unknown" });
});

await test("truncateStudioChildWireString enforces budget", () => {
  assert.equal(truncateStudioChildWireString("  hi  "), "hi");
  assert.equal(truncateStudioChildWireString("x".repeat(250))?.length, 200);
  assert.equal(truncateStudioChildWireString("   "), undefined);
});

await test("high-confidence association rejects forks and mismatched parents", () => {
  const parentId = "parent-1";
  assert.equal(
    isHighConfidenceStudioChildOfParent(session({ studioChild: baseStudioChild({ parentSessionId: parentId }) }), parentId),
    true,
  );
  assert.equal(
    isHighConfidenceStudioChildOfParent(
      session({
        studioChild: null,
        parentSessionId: parentId,
      }),
      parentId,
    ),
    false,
  );
  assert.equal(
    isHighConfidenceStudioChildOfParent(
      session({ studioChild: baseStudioChild({ parentSessionId: "other-parent" }) }),
      parentId,
    ),
    false,
  );
  assert.equal(
    isHighConfidenceStudioChildOfParent(
      session({
        studioChild: {
          ...baseStudioChild(),
          kind: "not-studio",
        },
      }),
      parentId,
    ),
    false,
  );
});

await test("task run status is authoritative when present", () => {
  const item = projectStudioChildSessionListItem(
    session({
      studioChildDisplay: {
        taskTitle: "Ship panel",
        subtaskId: "DATA-01",
        subtaskTitle: "Inventory",
      },
      childMeta: {
        status: "running",
        subtaskId: "DATA-01",
        runId: "run-auth",
      },
    }),
    {
      taskDetail: {
        subagents: [
          {
            id: "run-auth",
            member: "implementer",
            status: "waiting_for_user",
            startedAt: "2026-07-16T00:10:00.000Z",
            finishedAt: undefined,
            prompt: "secret prompt",
            summary: "secret summary",
            error: "secret error",
            childSessionFile: "/secret/child.jsonl",
          },
        ],
      },
    },
  );
  assert.ok(item);
  assert.equal(item.status, "waiting_for_user");
  assert.equal(item.statusSource, "task");
  assert.equal(item.statusMayBeStale, false);
  assert.equal(item.startedAt, "2026-07-16T00:10:00.000Z");
  assert.equal(item.title.includes("DATA-01"), true);
  assert.equal(item.title.includes("Inventory"), true);
  assertNoPrivateFields(item);
});

await test("header fallback marks statusMayBeStale when task run missing", () => {
  const item = projectStudioChildSessionListItem(
    session({
      childMeta: {
        status: "succeeded",
        finishedAt: "2026-07-16T02:00:00.000Z",
        runId: "run-missing",
      },
      studioChildDisplay: { taskTitle: "Old task", subtaskId: "OLD-01", subtaskTitle: "Legacy" },
    }),
    { taskDetail: { subagents: [] } },
  );
  assert.ok(item);
  assert.equal(item.status, "succeeded");
  assert.equal(item.statusSource, "header");
  assert.equal(item.statusMayBeStale, true);
  assert.equal(item.finishedAt, "2026-07-16T02:00:00.000Z");
});

await test("task lookup failure keeps header status and marks stale", () => {
  const item = projectStudioChildSessionListItem(
    session({ childMeta: { status: "running", runId: "run-x" } }),
    { taskDetail: null, taskLookupFailed: true },
  );
  assert.ok(item);
  assert.equal(item.statusSource, "header");
  assert.equal(item.statusMayBeStale, true);
  assert.equal(item.status, "running");
});

await test("stable sort: waiting → running → queued → terminal newest-first", () => {
  const items = sortStudioChildSessionListItems([
    {
      sessionId: "t-old",
      taskId: "t",
      runId: "r1",
      member: "implementer",
      title: "old terminal",
      status: "succeeded",
      statusSource: "task",
      statusMayBeStale: false,
      createdAt: "2026-07-16T00:00:00.000Z",
      modifiedAt: "2026-07-16T03:00:00.000Z",
      finishedAt: "2026-07-16T03:00:00.000Z",
      messageCount: 1,
    },
    {
      sessionId: "t-new",
      taskId: "t",
      runId: "r2",
      member: "implementer",
      title: "new terminal",
      status: "failed",
      statusSource: "task",
      statusMayBeStale: false,
      createdAt: "2026-07-16T00:00:00.000Z",
      modifiedAt: "2026-07-16T04:00:00.000Z",
      finishedAt: "2026-07-16T04:00:00.000Z",
      messageCount: 1,
    },
    {
      sessionId: "a-queued",
      taskId: "t",
      runId: "r3",
      member: "implementer",
      title: "queued",
      status: "queued",
      statusSource: "task",
      statusMayBeStale: false,
      createdAt: "2026-07-16T00:20:00.000Z",
      modifiedAt: "2026-07-16T00:20:00.000Z",
      startedAt: "2026-07-16T00:20:00.000Z",
      messageCount: 0,
    },
    {
      sessionId: "a-running",
      taskId: "t",
      runId: "r4",
      member: "implementer",
      title: "running",
      status: "running",
      statusSource: "task",
      statusMayBeStale: false,
      createdAt: "2026-07-16T00:10:00.000Z",
      modifiedAt: "2026-07-16T00:10:00.000Z",
      startedAt: "2026-07-16T00:10:00.000Z",
      messageCount: 1,
    },
    {
      sessionId: "a-wait",
      taskId: "t",
      runId: "r5",
      member: "implementer",
      title: "waiting",
      status: "waiting_for_user",
      statusSource: "task",
      statusMayBeStale: false,
      createdAt: "2026-07-16T00:05:00.000Z",
      modifiedAt: "2026-07-16T00:05:00.000Z",
      startedAt: "2026-07-16T00:05:00.000Z",
      messageCount: 2,
    },
  ]);

  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["a-wait", "a-running", "a-queued", "t-new", "t-old"],
  );
});

await test("terminal limit keeps newest 20 and marks truncation", () => {
  const terminals = Array.from({ length: 25 }, (_, index) => ({
    sessionId: `term-${String(index).padStart(2, "0")}`,
    taskId: "t",
    runId: `r-${index}`,
    member: "implementer",
    title: `term ${index}`,
    status: "succeeded",
    statusSource: "task",
    statusMayBeStale: false,
    createdAt: "2026-07-16T00:00:00.000Z",
    modifiedAt: `2026-07-16T${String(index).padStart(2, "0")}:00:00.000Z`,
    finishedAt: `2026-07-16T${String(index).padStart(2, "0")}:00:00.000Z`,
    messageCount: 1,
  }));
  const sorted = sortStudioChildSessionListItems(terminals);
  const limited = applyStudioChildSessionListLimits(sorted);
  assert.equal(limited.terminalAvailable, 25);
  assert.equal(limited.terminalReturned, STUDIO_CHILD_TERMINAL_LIMIT);
  assert.equal(limited.terminalTruncated, true);
  assert.equal(limited.children.length, STUDIO_CHILD_TERMINAL_LIMIT);
  assert.equal(limited.children[0].sessionId, "term-24");
  assert.equal(limited.children.at(-1).sessionId, "term-05");
});

await test("defensive active cap truncates with explicit flag", () => {
  const actives = Array.from({ length: 5 }, (_, index) => ({
    sessionId: `act-${index}`,
    taskId: "t",
    runId: `r-${index}`,
    member: "implementer",
    title: `act ${index}`,
    status: "running",
    statusSource: "task",
    statusMayBeStale: false,
    createdAt: `2026-07-16T00:0${index}:00.000Z`,
    modifiedAt: `2026-07-16T00:0${index}:00.000Z`,
    startedAt: `2026-07-16T00:0${index}:00.000Z`,
    messageCount: 1,
  }));
  const limited = applyStudioChildSessionListLimits(sortStudioChildSessionListItems(actives), {
    defensiveActiveCap: 3,
  });
  assert.equal(limited.activeCount, 3);
  assert.equal(limited.activeTruncated, true);
  assert.equal(limited.defensiveActiveCap, 3);
  assert.equal(limited.children.length, 3);
});

await test("buildStudioChildSessionListFromSessions filters forks and merges task status", () => {
  const parentId = "parent-1";
  const sessions = [
    session({
      id: "parent-1",
      studioChild: null,
      path: "/secret/parent.jsonl",
    }),
    session({
      id: "child-wait",
      childMeta: {
        parentSessionId: parentId,
        status: "running",
        runId: "run-wait",
        taskId: "task-a",
        subtaskId: "PANEL-01",
        createdAt: "2026-07-16T00:01:00.000Z",
      },
      studioChildDisplay: {
        taskTitle: "Panel work",
        subtaskId: "PANEL-01",
        subtaskTitle: "UI panel",
      },
      modified: "2026-07-16T00:30:00.000Z",
    }),
    session({
      id: "child-done",
      childMeta: {
        parentSessionId: parentId,
        status: "running",
        runId: "run-done",
        taskId: "task-a",
        subtaskId: "DATA-01",
        createdAt: "2026-07-16T00:00:00.000Z",
        finishedAt: "2026-07-16T00:20:00.000Z",
      },
      studioChildDisplay: {
        taskTitle: "Panel work",
        subtaskId: "DATA-01",
        subtaskTitle: "Inventory",
      },
      modified: "2026-07-16T00:20:00.000Z",
    }),
    // Ordinary fork: parentSessionId only, no studioChild → excluded
    session({
      id: "fork-1",
      studioChild: null,
      parentSessionId: parentId,
      path: "/secret/fork.jsonl",
    }),
    // Studio child of another parent → excluded
    session({
      id: "other-child",
      childMeta: {
        parentSessionId: "parent-other",
        runId: "run-other",
        taskId: "task-b",
      },
    }),
  ];

  const detail = {
    id: "task-a",
    title: "Panel work",
    subagents: [
      {
        id: "run-wait",
        member: "implementer",
        status: "waiting_for_user",
        startedAt: "2026-07-16T00:01:00.000Z",
        prompt: "should not leak",
        childSessionFile: "/secret/should-not-leak.jsonl",
      },
      {
        id: "run-done",
        member: "implementer",
        status: "succeeded",
        startedAt: "2026-07-16T00:00:00.000Z",
        finishedAt: "2026-07-16T00:20:00.000Z",
        summary: "should not leak",
      },
    ],
  };

  const response = buildStudioChildSessionListFromSessions(parentId, sessions, {
    generatedAt: "2026-07-16T05:00:00.000Z",
    taskLookup: {
      getDetail(cwd, taskId) {
        assert.equal(cwd, "/secret/workspace");
        assert.equal(taskId, "task-a");
        return detail;
      },
    },
  });

  assert.equal(response.kind, "ypi_studio_child_sessions");
  assert.equal(response.parentSessionId, parentId);
  assert.equal(response.children.length, 2);
  assert.equal(response.children[0].sessionId, "child-wait");
  assert.equal(response.children[0].status, "waiting_for_user");
  assert.equal(response.children[0].statusSource, "task");
  assert.equal(response.children[1].sessionId, "child-done");
  assert.equal(response.children[1].status, "succeeded");
  assert.equal(response.counts.active, 1);
  assert.equal(response.counts.waitingForUser, 1);
  assert.equal(response.counts.terminalAvailable, 1);
  assert.equal(response.counts.terminalReturned, 1);
  assert.equal(response.limits.terminal, STUDIO_CHILD_TERMINAL_LIMIT);
  assert.equal(response.limits.defensiveActiveCap, STUDIO_CHILD_DEFENSIVE_ACTIVE_CAP);
  assert.equal(response.limits.terminalTruncated, false);
  assert.equal(response.generatedAt, "2026-07-16T05:00:00.000Z");
  assertNoPrivateFields(response);
});

await test("single task failure degrades only that task and continues others", () => {
  const parentId = "parent-1";
  const sessions = [
    session({
      id: "child-ok",
      childMeta: {
        parentSessionId: parentId,
        taskId: "task-ok",
        runId: "run-ok",
        status: "queued",
      },
    }),
    session({
      id: "child-bad",
      childMeta: {
        parentSessionId: parentId,
        taskId: "task-bad",
        runId: "run-bad",
        status: "running",
      },
    }),
  ];

  const response = buildStudioChildSessionListFromSessions(parentId, sessions, {
    generatedAt: "2026-07-16T06:00:00.000Z",
    taskLookup: {
      getDetail(_cwd, taskId) {
        if (taskId === "task-bad") throw new Error("disk boom");
        return {
          subagents: [
            {
              id: "run-ok",
              member: "implementer",
              status: "queued",
              startedAt: "2026-07-16T00:00:00.000Z",
            },
          ],
        };
      },
    },
  });

  assert.equal(response.children.length, 2);
  const ok = response.children.find((item) => item.sessionId === "child-ok");
  const bad = response.children.find((item) => item.sessionId === "child-bad");
  assert.equal(ok?.statusSource, "task");
  assert.equal(ok?.statusMayBeStale, false);
  assert.equal(bad?.statusSource, "header");
  assert.equal(bad?.statusMayBeStale, true);
  assert.ok(response.warnings?.some((warning) => warning.startsWith("task_lookup_failed:")));
  assertNoPrivateFields(response);
});

await test("getStudioChildSessionListForParent rejects missing and child ids without path leakage", async () => {
  const sessions = [
    session({ id: "parent-1", studioChild: null }),
    session({
      id: "child-1",
      childMeta: { parentSessionId: "parent-1", runId: "run-1", taskId: "task-1" },
    }),
  ];

  await assert.rejects(
    () => getStudioChildSessionListForParent("missing", {
      listSessions: async () => sessions,
      taskLookup: { getDetail: () => null },
    }),
    (error) => {
      assert.ok(error instanceof StudioChildSessionListError);
      assert.equal(error.code, "not_found");
      assert.equal(error.status, 404);
      assert.equal(String(error.message).includes("/secret"), false);
      return true;
    },
  );

  await assert.rejects(
    () => getStudioChildSessionListForParent("child-1", {
      listSessions: async () => sessions,
      taskLookup: { getDetail: () => null },
    }),
    (error) => {
      assert.ok(error instanceof StudioChildSessionListError);
      assert.equal(error.code, "is_studio_child");
      assert.equal(error.status, 400);
      assert.equal(String(error.message).includes("/secret"), false);
      return true;
    },
  );

  const ok = await getStudioChildSessionListForParent("parent-1", {
    listSessions: async () => sessions,
    taskLookup: { getDetail: () => null },
    generatedAt: "2026-07-16T07:00:00.000Z",
  });
  assert.equal(ok.children.length, 1);
  assert.equal(ok.children[0].statusMayBeStale, true);
  assertNoPrivateFields(ok);
});

await test("task detail is deduped per cwd+taskId within one build", () => {
  let calls = 0;
  const parentId = "parent-1";
  const sessions = [
    session({
      id: "child-a",
      childMeta: { parentSessionId: parentId, taskId: "task-shared", runId: "run-a", status: "running" },
    }),
    session({
      id: "child-b",
      childMeta: { parentSessionId: parentId, taskId: "task-shared", runId: "run-b", status: "queued" },
    }),
  ];
  buildStudioChildSessionListFromSessions(parentId, sessions, {
    taskLookup: {
      getDetail() {
        calls += 1;
        return {
          subagents: [
            { id: "run-a", member: "implementer", status: "running", startedAt: "2026-07-16T00:00:00.000Z" },
            { id: "run-b", member: "implementer", status: "queued", startedAt: "2026-07-16T00:01:00.000Z" },
          ],
        };
      },
    },
  });
  assert.equal(calls, 1);
});

console.log("");
if (failures > 0) {
  console.error(`studio-child-session-list tests: ${failures} failed`);
  process.exit(1);
}
console.log("studio-child-session-list tests: all passed");
