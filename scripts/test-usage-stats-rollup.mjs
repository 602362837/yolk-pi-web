// Lightweight regression check for the Usage aggregation chain.
//
// Validates that lib/usage-stats.ts getUsageStats / getUsageStatsForSessionRollup
// truly roll up Studio child session usage under both active and archive scopes:
//   - global totals include child usage
//   - bySession keeps child rows with kind=studio_child + parentSessionId
//   - byParentSession.totals === ownTotals + studioChildTotals
//   - orphan child (parent missing) keeps parentFound=false
//   - session_rollup(parent/child/standalone) matches the confirmed display 口径
//
// Builds real JSONL fixtures under a temp PI_CODING_AGENT_DIR so the actual
// SessionManager + session-reader scan path is exercised. No heavy test framework.
//
// Run: node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-usage-stats-rollup.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Must set the agent dir BEFORE importing any module that resolves getAgentDir().
const agentDir = mkdtempSync(join(tmpdir(), "pi-usage-rollup-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { getUsageStats, getUsageStatsForSessionRollup } = await import("../lib/usage-stats.ts");

const cwd = "/tmp/usage-rollup-test-cwd";
const encodedCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
const sessionsDir = join(agentDir, "sessions", encodedCwd);
const archiveDir = join(agentDir, "sessions-archive", encodedCwd);
mkdirSync(sessionsDir, { recursive: true });

function uuid() {
  return `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 18).padStart(16, "0")}`;
}

function ts(date) {
  return date.toISOString();
}

function header({ id, cwdOverride, studioChild, parentSessionPath }) {
  const base = { type: "session", version: 1, id, timestamp: ts(new Date()), cwd: cwdOverride ?? cwd };
  if (parentSessionPath) base.parentSession = parentSessionPath;
  if (studioChild) base.studioChild = studioChild;
  return JSON.stringify(base);
}

function assistantMessage({ id, usage }) {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: ts(new Date()),
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      model: "test-model",
      provider: "test-provider",
      usage: {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        cost: {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          total: usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0),
        },
      },
    },
  });
}

function writeSession(dir, { id, cwdOverride, studioChild, parentSessionPath, messages }) {
  const file = join(dir, `${ts(new Date()).replace(/[:.]/g, "-")}_${id}.jsonl`);
  const lines = [header({ id, cwdOverride, studioChild, parentSessionPath })];
  for (const m of messages) lines.push(m);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

function studioChildHeader(parentId) {
  return {
    schemaVersion: 1,
    kind: "ypi-studio-child-session",
    runner: "sdk",
    visibility: "child",
    status: "succeeded",
    parentSessionId: parentId,
    taskId: "task-1",
    runId: "run-1",
    member: "implementer",
  };
}

const parentId = uuid();
const childId = uuid();
const childNoUsageId = uuid();
const standaloneId = uuid();
const orphanChildId = uuid();
const archivedChildId = uuid();
const missingParentId = uuid(); // referenced by orphanChild, never written

// Parent: own usage only.
const parentFile = writeSession(sessionsDir, {
  id: parentId,
  messages: [
    assistantMessage({ id: uuid(), usage: { input: 10, output: 20 } }), // total cost 30
  ],
});

// Studio child with real usage.
writeSession(sessionsDir, {
  id: childId,
  studioChild: studioChildHeader(parentId),
  parentSessionPath: parentFile,
  messages: [
    assistantMessage({ id: uuid(), usage: { input: 5, output: 5 } }), // total cost 10
  ],
});

// Studio child with NO usage (only count). Must NOT trigger child usage markers.
writeSession(sessionsDir, {
  id: childNoUsageId,
  studioChild: studioChildHeader(parentId),
  parentSessionPath: parentFile,
  messages: [],
});

// Standalone session (no studio child).
writeSession(sessionsDir, {
  id: standaloneId,
  messages: [
    assistantMessage({ id: uuid(), usage: { input: 1, output: 2 } }), // total cost 3
  ],
});

// Orphan studio child: parent id points at a session that does not exist.
writeSession(sessionsDir, {
  id: orphanChildId,
  studioChild: studioChildHeader(missingParentId),
  parentSessionPath: "/nonexistent/parent.jsonl",
  messages: [
    assistantMessage({ id: uuid(), usage: { input: 2, output: 2 } }), // total cost 4
  ],
});

// Archived studio child: lives under sessions-archive/.
mkdirSync(archiveDir, { recursive: true });
writeSession(archiveDir, {
  id: archivedChildId,
  studioChild: studioChildHeader(parentId),
  parentSessionPath: parentFile,
  messages: [
    assistantMessage({ id: uuid(), usage: { input: 7, output: 7 } }), // total cost 14
  ],
});

const from = new Date(Date.now() - 60 * 60 * 1000);
const to = new Date(Date.now() + 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// 1. Global stats with archived included.
// ---------------------------------------------------------------------------
const stats = await getUsageStats({ from, to, includeArchived: true });

// global totals = parent(30) + child(10) + standalone(3) + orphan(4) + archived child(14) = 61
assert.equal(stats.scope.includeStudioChildren, true, "scope.includeStudioChildren must be true");
assert.equal(stats.totals.cost, 61, `global totals.cost expected 61, got ${stats.totals.cost}`);
assert.equal(stats.totals.calls, 5, `global totals.calls expected 5, got ${stats.totals.calls}`);

// bySession keeps child row with kind + parentSessionId.
const childRow = stats.bySession.find((row) => row.sessionId === childId);
assert.ok(childRow, "bySession must include the studio child row");
assert.equal(childRow.kind, "studio_child", "child row kind must be studio_child");
assert.equal(childRow.parentSessionId, parentId, "child row parentSessionId must point at parent");
assert.equal(childRow.totals.cost, 10, "child row totals.cost must equal its own usage");

// No-usage child appears in bySession only if it has no usage records -> it should NOT appear
// (bySession is built from usage records only).
const noUsageRow = stats.bySession.find((row) => row.sessionId === childNoUsageId);
assert.equal(noUsageRow, undefined, "child with no usage must not appear in bySession");

// ---------------------------------------------------------------------------
// 2. byParentSession rollups.
// ---------------------------------------------------------------------------
const parentRollup = stats.byParentSession.find((row) => row.parentSessionId === parentId);
assert.ok(parentRollup, "byParentSession must include parent rollup");
assert.equal(parentRollup.parentFound, true, "parent must be found");
// parent own(30) + child(10) + archived child(14) = 54; no-usage child contributes 0.
assert.equal(parentRollup.ownTotals.cost, 30, "parent ownTotals.cost must be 30");
assert.equal(parentRollup.studioChildTotals.cost, 24, `parent studioChildTotals.cost must be 24, got ${parentRollup.studioChildTotals.cost}`);
assert.equal(
  parentRollup.totals.cost,
  parentRollup.ownTotals.cost + parentRollup.studioChildTotals.cost,
  "byParentSession.totals must equal ownTotals + studioChildTotals",
);
assert.equal(parentRollup.studioChildSessionCount, 3, "parent must count 3 studio children (incl. no-usage + archived)");
assert.ok(parentRollup.studioChildSessionIds.includes(childId), "parent rollup must list child with usage");
assert.ok(parentRollup.studioChildSessionIds.includes(childNoUsageId), "parent rollup must list no-usage child");
assert.ok(parentRollup.studioChildSessionIds.includes(archivedChildId), "parent rollup must list archived child");

const orphanRollup = stats.byParentSession.find((row) => row.parentSessionId === missingParentId);
assert.ok(orphanRollup, "orphan child must still produce a rollup row");
assert.equal(orphanRollup.parentFound, false, "orphan child rollup must have parentFound=false");
assert.equal(orphanRollup.totals.cost, 4, "orphan rollup totals must equal the orphan child usage");
assert.equal(orphanRollup.ownTotals.cost, 0, "orphan rollup ownTotals must be 0 (parent missing)");

const standaloneRollup = stats.byParentSession.find((row) => row.parentSessionId === standaloneId);
assert.ok(standaloneRollup, "standalone must appear as its own parent rollup");
assert.equal(standaloneRollup.studioChildSessionCount, 0, "standalone must have zero studio children");
assert.equal(standaloneRollup.totals.cost, 3, "standalone rollup totals must equal its own usage");

// ---------------------------------------------------------------------------
// 3. includeArchived=false drops archived child from global totals and parent rollup.
// ---------------------------------------------------------------------------
const statsNoArchive = await getUsageStats({ from, to, includeArchived: false });
assert.equal(statsNoArchive.totals.cost, 47, `no-archive totals.cost expected 47 (61-14), got ${statsNoArchive.totals.cost}`);
const parentRollupNoArchive = statsNoArchive.byParentSession.find((row) => row.parentSessionId === parentId);
assert.ok(parentRollupNoArchive, "parent rollup must exist without archive");
assert.equal(parentRollupNoArchive.studioChildTotals.cost, 10, "no-archive parent studioChildTotals must be 10 (only active child)");
assert.equal(parentRollupNoArchive.studioChildSessionCount, 2, "no-archive parent must count 2 studio children");

// ---------------------------------------------------------------------------
// 4. session_rollup(parent).
// ---------------------------------------------------------------------------
const parentSessionRollup = await getUsageStatsForSessionRollup({ sessionId: parentId, includeArchived: true });
assert.ok(parentSessionRollup, "parent rollup must resolve");
assert.equal(parentSessionRollup.selectedSessionKind, "parent", "parent rollup selectedSessionKind must be parent");
assert.equal(parentSessionRollup.parentFound, true, "parent rollup parentFound must be true");
assert.equal(parentSessionRollup.parentSessionId, parentId, "parent rollup parentSessionId must be itself");
assert.equal(parentSessionRollup.totals.cost, 54, "parent rollup totals must be 54 (own+children incl archived)");
assert.equal(parentSessionRollup.ownTotals.cost, 30, "parent rollup ownTotals must be 30");
assert.equal(parentSessionRollup.studioChildTotals.cost, 24, "parent rollup studioChildTotals must be 24");
assert.equal(
  parentSessionRollup.totals.cost,
  parentSessionRollup.ownTotals.cost + parentSessionRollup.studioChildTotals.cost,
  "session_rollup(parent).totals must equal own + children",
);
// Display 口径: parent compact shows parent rollup; selectedSessionTotals === own totals.
assert.equal(parentSessionRollup.selectedSessionTotals.cost, 30, "parent selectedSessionTotals must be own totals (30)");
assert.equal(parentSessionRollup.parentRollupTotals.cost, parentSessionRollup.totals.cost, "parentRollupTotals must equal totals");
assert.equal(parentSessionRollup.studioChildSessionCount, 3, "parent rollup must report 3 child sessions");
assert.ok(parentSessionRollup.childSessions.some((child) => child.sessionId === childId), "childSessions must include the child with usage");

// ---------------------------------------------------------------------------
// 5. session_rollup(child) — child audit session shows its own usage, tooltip carries parent rollup.
// ---------------------------------------------------------------------------
const childSessionRollup = await getUsageStatsForSessionRollup({ sessionId: childId, includeArchived: true });
assert.ok(childSessionRollup, "child rollup must resolve");
assert.equal(childSessionRollup.selectedSessionKind, "studio_child", "child rollup selectedSessionKind must be studio_child");
assert.equal(childSessionRollup.parentSessionId, parentId, "child rollup parentSessionId must point at parent");
assert.equal(childSessionRollup.parentFound, true, "child rollup parentFound must be true");
// Compact display value = the child's own usage (10), NOT the parent rollup.
assert.equal(childSessionRollup.selectedSessionTotals.cost, 10, "child selectedSessionTotals must be its own usage (10)");
// Tooltip parent rollup = parent own + all children (incl archived) = 54.
assert.equal(childSessionRollup.parentRollupTotals.cost, 54, "child parentRollupTotals must be the parent rollup (54)");
assert.equal(childSessionRollup.totals.cost, 54, "child rollup totals (legacy) must still be parent rollup for back-compat");
assert.equal(childSessionRollup.studioChildSessionCount, 3, "child rollup must still enumerate siblings");

// ---------------------------------------------------------------------------
// 6. session_rollup(standalone).
// ---------------------------------------------------------------------------
const standaloneSessionRollup = await getUsageStatsForSessionRollup({ sessionId: standaloneId, includeArchived: true });
assert.ok(standaloneSessionRollup, "standalone rollup must resolve");
assert.equal(standaloneSessionRollup.selectedSessionKind, "standalone", "standalone selectedSessionKind must be standalone");
assert.equal(standaloneSessionRollup.totals.cost, 3, "standalone rollup totals must be 3");
assert.equal(standaloneSessionRollup.ownTotals.cost, 3, "standalone ownTotals must be 3");
assert.equal(standaloneSessionRollup.studioChildTotals.cost, 0, "standalone studioChildTotals must be 0");
assert.equal(standaloneSessionRollup.selectedSessionTotals.cost, 3, "standalone selectedSessionTotals must equal totals");
assert.equal(standaloneSessionRollup.parentRollupTotals.cost, 3, "standalone parentRollupTotals must equal totals");
assert.equal(standaloneSessionRollup.studioChildSessionCount, 0, "standalone must have zero children");

// ---------------------------------------------------------------------------
// 7. session_rollup(orphan child) — parent missing, still resolves own usage.
// ---------------------------------------------------------------------------
const orphanSessionRollup = await getUsageStatsForSessionRollup({ sessionId: orphanChildId, includeArchived: true });
assert.ok(orphanSessionRollup, "orphan child rollup must resolve");
assert.equal(orphanSessionRollup.selectedSessionKind, "studio_child", "orphan child selectedSessionKind must be studio_child");
assert.equal(orphanSessionRollup.parentFound, false, "orphan child rollup parentFound must be false");
assert.equal(orphanSessionRollup.selectedSessionTotals.cost, 4, "orphan child selectedSessionTotals must be its own usage (4)");

// ---------------------------------------------------------------------------
// 8. session_rollup for archived child works via metadata scan path.
// ---------------------------------------------------------------------------
const archivedSessionRollup = await getUsageStatsForSessionRollup({ sessionId: archivedChildId, includeArchived: true });
assert.ok(archivedSessionRollup, "archived child rollup must resolve via metadata scan");
assert.equal(archivedSessionRollup.selectedSessionKind, "studio_child", "archived child selectedSessionKind must be studio_child");
assert.equal(archivedSessionRollup.selectedSessionTotals.cost, 14, "archived child selectedSessionTotals must be its own usage (14)");
assert.equal(archivedSessionRollup.parentFound, true, "archived child parent must be found among active sessions");
assert.equal(archivedSessionRollup.parentRollupTotals.cost, 54, "archived child parentRollupTotals must include itself (54)");

// Cleanup.
rmSync(agentDir, { recursive: true, force: true });

console.log("usage stats rollup regression tests passed");
console.log("  fixtures: 1 parent + 1 child(usage) + 1 child(no-usage) + 1 standalone + 1 orphan child + 1 archived child");
console.log("  verified: global totals, bySession, byParentSession (parent/orphan/standalone),");
console.log("            session_rollup(parent/child/standalone/orphan/archived), includeArchived toggle");
