/**
 * Focused regression tests for YPI Studio exclusive session ownership (OWN-3).
 * Uses isolated temp workspaces under os.tmpdir(); does not touch real user agent dirs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveYpiStudioTask,
  assertTaskBoundToContext,
  bindYpiStudioTaskToContext,
  createYpiStudioTask,
  getYpiStudioTaskDetail,
  getYpiStudioTaskIdForContext,
  isYpiStudioSessionContextId,
  recordYpiStudioUserApproval,
  removeYpiStudioRuntimePointerIfMatches,
  replaceTaskSessionContext,
  transitionYpiStudioTask,
  updateYpiStudioTaskArtifact,
  YpiStudioTaskSecurityError,
} from "../lib/ypi-studio-tasks.ts";
import { resolveYpiStudioTaskForSession } from "../lib/ypi-studio-session-link.ts";

function withTempCwd(prefix, fn) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function withTempCwdAsync(prefix, fn) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function taskJsonPath(cwd, taskId) {
  return join(cwd, ".ypi", "tasks", taskId, "task.json");
}

function eventsPath(cwd, taskId) {
  return join(cwd, ".ypi", "tasks", taskId, "events.jsonl");
}

function runtimePointerPath(cwd, contextId) {
  const safe = contextId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  return join(cwd, ".ypi", ".runtime", "sessions", `${safe}.json`);
}

function readTaskJson(cwd, taskId) {
  return JSON.parse(readFileSync(taskJsonPath(cwd, taskId), "utf8"));
}

function writeTaskJsonRaw(cwd, taskId, mutator) {
  const path = taskJsonPath(cwd, taskId);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  mutator(raw);
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

function readPointer(cwd, contextId) {
  const path = runtimePointerPath(cwd, contextId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed?.currentTask === "string" ? parsed.currentTask : null;
  } catch {
    return null;
  }
}

function writePointer(cwd, contextId, taskId) {
  const path = runtimePointerPath(cwd, contextId);
  const dir = join(cwd, ".ypi", ".runtime", "sessions");
  if (!existsSync(dir)) {
    createYpiStudioTask({ cwd, title: "pointer-root-bootstrap", workflowId: "feature-dev", contextId: "pi_bootstrap_pointer_root" });
  }
  writeFileSync(path, `${JSON.stringify({ currentTask: taskId, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function transferEvents(cwd, taskId) {
  const path = eventsPath(cwd, taskId);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event?.data?.context_transfer === true);
}

function sessionLink(cwd, sessionId, sessionFilePath = join(cwd, "sessions", `${sessionId}.jsonl`), entries = []) {
  return resolveYpiStudioTaskForSession({
    cwd,
    sessionId,
    sessionFilePath,
    entries,
  });
}

function taskIdsInLink(result) {
  return (result.tasks ?? []).map((candidate) => candidate.task.id);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function writePlanReview(cwd, taskId, contextId) {
  updateYpiStudioTaskArtifact(taskId, {
    cwd,
    action: "update_artifact",
    artifact: "plan-review",
    content: "# 计划审批书\n\n## 审批请求\n请审阅并确认。\n",
    contextId,
  });
}

function completeTaskForArchive(cwd, taskId, contextId) {
  transitionYpiStudioTask(taskId, { cwd, to: "planning", override: true, contextId });
  writePlanReview(cwd, taskId, contextId);
  transitionYpiStudioTask(taskId, { cwd, to: "awaiting_approval", override: true, contextId });
  recordYpiStudioUserApproval(cwd, contextId, "确认开始实现");
  transitionYpiStudioTask(taskId, { cwd, to: "implementing", override: true, contextId });
  transitionYpiStudioTask(taskId, { cwd, to: "checking", override: true, contextId });
  transitionYpiStudioTask(taskId, { cwd, to: "review", override: true, contextId });
  transitionYpiStudioTask(taskId, { cwd, to: "completed", override: true, contextId });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

{
  assert.equal(isYpiStudioSessionContextId("pi_abc"), true);
  assert.equal(isYpiStudioSessionContextId("pi_transcript_deadbeef"), true);
  assert.equal(isYpiStudioSessionContextId("pi_process_deadbeef"), true);
  assert.equal(isYpiStudioSessionContextId("pi_"), false);
  assert.equal(isYpiStudioSessionContextId("pi_transcript_"), false);
  assert.equal(isYpiStudioSessionContextId("pi_process_"), false);
  assert.equal(isYpiStudioSessionContextId("external_meta"), false);
  assert.equal(isYpiStudioSessionContextId("workspace:foo"), false);
  assert.equal(isYpiStudioSessionContextId(""), false);
}

{
  const next = replaceTaskSessionContext(
    ["pi_s1", "pi_transcript_old", "pi_process_old", "external_meta", "workspace:keep", "pi_s1"],
    "pi_s2",
  );
  assert.deepEqual(next, ["external_meta", "workspace:keep", "pi_s2"]);
  assert.deepEqual(replaceTaskSessionContext(["external_meta", "pi_s2"], "pi_s2"), ["external_meta", "pi_s2"]);
}

{
  assert.throws(() => assertTaskBoundToContext({ contextIds: ["pi_s1"] }, undefined), /bound session context/i);
  assert.throws(() => assertTaskBoundToContext({ contextIds: ["pi_s1"] }, "pi_s2"), /not bound/i);
  assert.doesNotThrow(() => assertTaskBoundToContext({ contextIds: ["pi_s1"] }, "pi_s1"));
}

// ---------------------------------------------------------------------------
// create@s1 → bind@s2 exclusive transfer + session-link widget candidates
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-create-transfer-", (cwd) => {
  const s1 = "session-owner-1";
  const s2 = "session-owner-2";
  const s1Ctx = `pi_${s1}`;
  const s2Ctx = `pi_${s2}`;
  const s1File = join(cwd, "sessions", `${s1}.jsonl`);
  const s2File = join(cwd, "sessions", `${s2}.jsonl`);

  const task = createYpiStudioTask({ cwd, title: "Ownership A", workflowId: "feature-dev", contextId: s1Ctx });
  assert.deepEqual(task.contextIds, [s1Ctx]);
  assert.equal(getYpiStudioTaskIdForContext(cwd, s1Ctx), task.id);
  assert.deepEqual(taskIdsInLink(sessionLink(cwd, s1, s1File)), [task.id]);
  assert.deepEqual(taskIdsInLink(sessionLink(cwd, s2, s2File)), []);

  const transferred = bindYpiStudioTaskToContext(cwd, task.id, s2Ctx);
  assert.deepEqual(transferred.contextIds, [s2Ctx]);
  assert.equal(getYpiStudioTaskIdForContext(cwd, s1Ctx), null);
  assert.equal(getYpiStudioTaskIdForContext(cwd, s2Ctx), task.id);

  const s1Link = sessionLink(cwd, s1, s1File);
  const s2Link = sessionLink(cwd, s2, s2File);
  assert.deepEqual(taskIdsInLink(s1Link), []);
  assert.deepEqual(taskIdsInLink(s2Link), [task.id]);
  assert.ok(transferEvents(cwd, task.id).length >= 1);
});

// ---------------------------------------------------------------------------
// Transcript mention of A on s1 does not restore widget after transfer
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-transcript-diag-", (cwd) => {
  const s1 = "session-transcript-1";
  const s2 = "session-transcript-2";
  const s1Ctx = `pi_${s1}`;
  const s2Ctx = `pi_${s2}`;
  const s1File = join(cwd, "sessions", `${s1}.jsonl`);

  const task = createYpiStudioTask({ cwd, title: "Transcript mention A", workflowId: "feature-dev", contextId: s1Ctx });
  bindYpiStudioTaskToContext(cwd, task.id, s2Ctx);

  // session-link only scrapes TEXT_TASK_RE from toolResult message texts (not assistant free text).
  const entries = [
    {
      id: "e1",
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "read",
        content: [{ type: "text", text: `Created YPI Studio task ${task.id}` }],
        isError: false,
        timestamp: Date.now(),
      },
    },
  ];
  const s1Link = sessionLink(cwd, s1, s1File, entries);
  assert.deepEqual(taskIdsInLink(s1Link), [], "transcript mention must not re-bind transferred task");
  assert.ok(
    s1Link.diagnostics?.observedUnboundTaskKeys?.includes(task.id) ||
      s1Link.diagnostics?.transcriptObservedTaskKeys?.includes(task.id) ||
      s1Link.warnings?.includes("transcript-mentions-unbound-tasks"),
    `transcript evidence should remain diagnostics-only, got ${JSON.stringify(s1Link.diagnostics)} warnings=${JSON.stringify(s1Link.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// Runtime pointer cleanup: only unlink when pointer still targets transferred task
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-pointer-cleanup-", (cwd) => {
  const s1Ctx = "pi_pointer_s1";
  const s2Ctx = "pi_pointer_s2";
  const otherCtx = "pi_pointer_other";
  const transcriptCtx = "pi_transcript_abcdef0123456789abcdef01";
  const processCtx = "pi_process_abcdef0123456789abcdef01";

  const taskA = createYpiStudioTask({ cwd, title: "Pointer task A", workflowId: "feature-dev", contextId: s1Ctx });
  const taskB = createYpiStudioTask({ cwd, title: "Pointer task B", workflowId: "feature-dev", contextId: otherCtx });

  writeTaskJsonRaw(cwd, taskA.id, (raw) => {
    raw.contextIds = [s1Ctx, transcriptCtx, processCtx, "external_meta"];
  });
  writePointer(cwd, s1Ctx, taskA.id);
  writePointer(cwd, transcriptCtx, taskA.id);
  writePointer(cwd, processCtx, taskA.id);
  assert.equal(readPointer(cwd, otherCtx), taskB.id);

  const transferred = bindYpiStudioTaskToContext(cwd, taskA.id, s2Ctx);
  assert.deepEqual(transferred.contextIds.sort(), ["external_meta", s2Ctx].sort());
  assert.equal(readPointer(cwd, s1Ctx), null, "old s1 pointer to A removed");
  assert.equal(readPointer(cwd, transcriptCtx), null, "old transcript pointer to A removed");
  assert.equal(readPointer(cwd, processCtx), null, "old process pointer to A removed");
  assert.equal(readPointer(cwd, s2Ctx), taskA.id, "new owner pointer written");
  assert.equal(readPointer(cwd, otherCtx), taskB.id, "unrelated pointer preserved");

  writePointer(cwd, "pi_compare_keep", taskB.id);
  assert.equal(removeYpiStudioRuntimePointerIfMatches(cwd, "pi_compare_keep", taskA.id), false);
  assert.equal(readPointer(cwd, "pi_compare_keep"), taskB.id);
  writePointer(cwd, "pi_compare_drop", taskA.id);
  assert.equal(removeYpiStudioRuntimePointerIfMatches(cwd, "pi_compare_drop", taskA.id), true);
  assert.equal(readPointer(cwd, "pi_compare_drop"), null);
});

// ---------------------------------------------------------------------------
// Idempotent rebind@s2: no duplicate context, no extra transfer event
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-idempotent-bind-", (cwd) => {
  const s1Ctx = "pi_idem_s1";
  const s2Ctx = "pi_idem_s2";
  const task = createYpiStudioTask({ cwd, title: "Idempotent bind", workflowId: "feature-dev", contextId: s1Ctx });
  bindYpiStudioTaskToContext(cwd, task.id, s2Ctx);
  const eventsAfterFirst = transferEvents(cwd, task.id).length;
  const updatedAtAfterFirst = getYpiStudioTaskDetail(cwd, task.id)?.updatedAt;

  const again = bindYpiStudioTaskToContext(cwd, task.id, s2Ctx);
  assert.deepEqual(again.contextIds, [s2Ctx]);
  assert.equal(transferEvents(cwd, task.id).length, eventsAfterFirst, "idempotent rebind must not append another transfer event");
  assert.equal(getYpiStudioTaskDetail(cwd, task.id)?.updatedAt, updatedAtAfterFirst);
  assert.equal(getYpiStudioTaskIdForContext(cwd, s2Ctx), task.id);
});

// ---------------------------------------------------------------------------
// Legacy multi-owner lazy normalization on next explicit bind
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-legacy-lazy-", (cwd) => {
  const s1Ctx = "pi_legacy_s1";
  const s2Ctx = "pi_legacy_s2";
  const s3Ctx = "pi_legacy_s3";
  const task = createYpiStudioTask({ cwd, title: "Legacy multi owner", workflowId: "feature-dev", contextId: s1Ctx });
  writeTaskJsonRaw(cwd, task.id, (raw) => {
    raw.contextIds = [s1Ctx, s2Ctx, "custom_label", s3Ctx];
  });
  writePointer(cwd, s1Ctx, task.id);
  writePointer(cwd, s2Ctx, task.id);
  writePointer(cwd, s3Ctx, task.id);

  const s1File = join(cwd, "sessions", "legacy-s1.jsonl");
  const s2File = join(cwd, "sessions", "legacy-s2.jsonl");
  const linkS1 = resolveYpiStudioTaskForSession({ cwd, sessionId: "legacy_s1", sessionFilePath: s1File, entries: [] });
  const linkS2 = resolveYpiStudioTaskForSession({ cwd, sessionId: "legacy_s2", sessionFilePath: s2File, entries: [] });
  assert.ok(taskIdsInLink(linkS1).includes(task.id), "legacy multi-owner still visible to s1 before repair");
  assert.ok(taskIdsInLink(linkS2).includes(task.id), "legacy multi-owner still visible to s2 before repair");

  const normalized = bindYpiStudioTaskToContext(cwd, task.id, "pi_legacy_new");
  assert.deepEqual(normalized.contextIds.sort(), ["custom_label", "pi_legacy_new"].sort());
  assert.equal(readPointer(cwd, s1Ctx), null);
  assert.equal(readPointer(cwd, s2Ctx), null);
  assert.equal(readPointer(cwd, s3Ctx), null);
  assert.equal(readPointer(cwd, "pi_legacy_new"), task.id);
  assert.ok(!taskIdsInLink(resolveYpiStudioTaskForSession({ cwd, sessionId: "legacy_s1", sessionFilePath: s1File, entries: [] })).includes(task.id));
  assert.ok(!taskIdsInLink(resolveYpiStudioTaskForSession({ cwd, sessionId: "legacy_s2", sessionFilePath: s2File, entries: [] })).includes(task.id));
});

// ---------------------------------------------------------------------------
// Approval grant cannot be reused across sessions after transfer
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-approval-transfer-", (cwd) => {
  const s1Ctx = "pi_approval_s1";
  const s2Ctx = "pi_approval_s2";
  const task = createYpiStudioTask({ cwd, title: "Approval transfer", workflowId: "feature-dev", contextId: s1Ctx });

  transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId: s1Ctx });
  writePlanReview(cwd, task.id, s1Ctx);
  transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId: s1Ctx });
  const approved = recordYpiStudioUserApproval(cwd, s1Ctx, "确认，开始实现");
  assert.equal(approved?.meta.approvalGrant?.contextId, s1Ctx);

  const transferred = bindYpiStudioTaskToContext(cwd, task.id, s2Ctx);
  assert.equal(transferred.meta.approvalGrant, undefined, "cross-session grant cleared on transfer");
  assert.deepEqual(transferred.contextIds, [s2Ctx]);
  const transferNote = transferEvents(cwd, task.id).at(-1);
  assert.equal(transferNote?.data?.approvalGrantCleared, true);

  assert.throws(
    () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId: s1Ctx }),
    /not bound/i,
  );
  assert.equal(recordYpiStudioUserApproval(cwd, s1Ctx, "确认，开始实现"), null, "s1 no longer finds awaiting task via bound context");

  assert.throws(
    () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId: s2Ctx }),
    /no approvalGrant|approvalGrant/i,
  );

  const reapproved = recordYpiStudioUserApproval(cwd, s2Ctx, "确认，开始实现");
  assert.equal(reapproved?.meta.approvalGrant?.contextId, s2Ctx);
  const implementing = transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId: s2Ctx });
  assert.equal(implementing.status, "implementing");
});

// ---------------------------------------------------------------------------
// Non-owner mutations rejected without mutating contextIds
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-mutation-guard-", (cwd) => {
  const ownerCtx = "pi_guard_owner";
  const strangerCtx = "pi_guard_stranger";
  const task = createYpiStudioTask({ cwd, title: "Mutation guard", workflowId: "feature-dev", contextId: ownerCtx });
  const before = readTaskJson(cwd, task.id);

  assert.throws(
    () => transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId: strangerCtx }),
    /not bound/i,
  );
  assert.throws(
    () =>
      updateYpiStudioTaskArtifact(task.id, {
        cwd,
        action: "update_artifact",
        artifact: "brief",
        content: "# hijack\n",
        contextId: strangerCtx,
      }),
    /not bound/i,
  );

  const after = readTaskJson(cwd, task.id);
  assert.deepEqual(after.contextIds, before.contextIds);
  assert.equal(after.status, before.status);
  assert.equal(after.updatedAt, before.updatedAt);
});

// ---------------------------------------------------------------------------
// One session may bind multiple different tasks (multi-task widget)
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-multi-task-session-", (cwd) => {
  const sessionId = "multi-task-session";
  const ctx = `pi_${sessionId}`;
  const sessionFile = join(cwd, "sessions", `${sessionId}.jsonl`);

  const taskA = createYpiStudioTask({ cwd, title: "Multi task A", workflowId: "feature-dev", contextId: "pi_seed_a" });
  const taskB = createYpiStudioTask({ cwd, title: "Multi task B", workflowId: "feature-dev", contextId: "pi_seed_b" });
  bindYpiStudioTaskToContext(cwd, taskA.id, ctx);
  bindYpiStudioTaskToContext(cwd, taskB.id, ctx);

  const link = sessionLink(cwd, sessionId, sessionFile);
  const ids = taskIdsInLink(link).sort();
  assert.deepEqual(ids, [taskA.id, taskB.id].sort());
  assert.equal(link.tasks.length, 2);
});

// ---------------------------------------------------------------------------
// Invalid context / first bind for ownerless task
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-bind-edges-", (cwd) => {
  const ownerCtx = "pi_edge_owner";
  const task = createYpiStudioTask({ cwd, title: "Bind edges", workflowId: "feature-dev", contextId: ownerCtx });

  assert.throws(
    () => bindYpiStudioTaskToContext(cwd, task.id, "external_meta"),
    (err) => err instanceof YpiStudioTaskSecurityError || /known session context/i.test(String(err?.message ?? err)),
  );
  assert.throws(() => bindYpiStudioTaskToContext(cwd, task.id, ""), /contextId is required/i);

  const orphan = createYpiStudioTask({ cwd, title: "Orphan bind", workflowId: "feature-dev" });
  assert.deepEqual(orphan.contextIds, []);
  const bound = bindYpiStudioTaskToContext(cwd, orphan.id, "pi_orphan_owner");
  assert.deepEqual(bound.contextIds, ["pi_orphan_owner"]);
});

// ---------------------------------------------------------------------------
// Archived task bind still rejected
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-archived-bind-", (cwd) => {
  const ownerCtx = "pi_archived_owner";
  const task = createYpiStudioTask({ cwd, title: "Archived bind", workflowId: "feature-dev", contextId: ownerCtx });
  completeTaskForArchive(cwd, task.id, ownerCtx);
  archiveYpiStudioTask(task.id, {
    cwd,
    action: "archive",
    contextId: ownerCtx,
    knowledgeSummary: "Test archive knowledge for ownership regression.",
    knowledgeMarkdown: "Reusable note: exclusive session ownership tests cover archived rebind rejection.",
  });
  assert.throws(
    () => bindYpiStudioTaskToContext(cwd, task.id, "pi_new_after_archive"),
    /Archived tasks cannot be rebound|already archived|not found/i,
  );
});

// ---------------------------------------------------------------------------
// Concurrent bind: final owner is exactly one session context
// ---------------------------------------------------------------------------

await withTempCwdAsync("ypi-studio-own-concurrent-bind-", async (cwd) => {
  const seedCtx = "pi_concurrent_seed";
  const task = createYpiStudioTask({ cwd, title: "Concurrent bind", workflowId: "feature-dev", contextId: seedCtx });
  const contenders = Array.from({ length: 8 }, (_, i) => `pi_concurrent_${i}`);

  await Promise.all(
    contenders.map((contextId) =>
      Promise.resolve().then(() => bindYpiStudioTaskToContext(cwd, task.id, contextId)),
    ),
  );

  const final = getYpiStudioTaskDetail(cwd, task.id);
  assert.ok(final);
  const sessionOwners = final.contextIds.filter((id) => isYpiStudioSessionContextId(id));
  assert.equal(sessionOwners.length, 1, `expected single session owner, got ${JSON.stringify(final.contextIds)}`);
  assert.ok(contenders.includes(sessionOwners[0]));
  assert.equal(getYpiStudioTaskIdForContext(cwd, sessionOwners[0]), task.id);
  assert.equal(readTaskJson(cwd, task.id).id, task.id);
  const events = transferEvents(cwd, task.id);
  assert.ok(events.length >= 1);
  for (const event of events) {
    assert.equal(typeof event.data.toContextId, "string");
    assert.ok(Array.isArray(event.data.fromContextIds));
  }
});

// ---------------------------------------------------------------------------
// Transcript / process key forms accepted as exclusive owners
// ---------------------------------------------------------------------------

withTempCwd("ypi-studio-own-key-forms-", (cwd) => {
  const sessionFile = join(cwd, "sessions", "key-forms.jsonl");
  const transcriptKey = `pi_transcript_${hash(sessionFile)}`;
  const processKey = `pi_process_${hash("process-fallback")}`;
  const task = createYpiStudioTask({ cwd, title: "Key forms", workflowId: "feature-dev", contextId: "pi_key_seed" });

  bindYpiStudioTaskToContext(cwd, task.id, transcriptKey);
  assert.deepEqual(getYpiStudioTaskDetail(cwd, task.id)?.contextIds, [transcriptKey]);
  const link = resolveYpiStudioTaskForSession({
    cwd,
    sessionId: "key-forms-session",
    sessionFilePath: sessionFile,
    entries: [],
  });
  assert.ok(taskIdsInLink(link).includes(task.id));

  bindYpiStudioTaskToContext(cwd, task.id, processKey);
  assert.deepEqual(getYpiStudioTaskDetail(cwd, task.id)?.contextIds, [processKey]);
  // process keys are session-class for ownership cleanup but not widget evidence
  const linkAfterProcess = resolveYpiStudioTaskForSession({
    cwd,
    sessionId: "key-forms-session",
    sessionFilePath: sessionFile,
    entries: [],
  });
  assert.ok(!taskIdsInLink(linkAfterProcess).includes(task.id), "pi_process_* must not alone surface widget bound candidates");
});

console.log("ypi-studio session ownership tests passed");
