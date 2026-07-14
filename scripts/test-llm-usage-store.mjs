/**
 * Test suite for lib/llm-usage-* core modules (CORE-01).
 *
 * Covers:
 * - llm-usage-types:     schema, createLlmUsageTotals, addLlmUsageToTotals
 * - llm-usage-normalize: normalizeSdkUsage edge cases, normalizeProvider/Model
 * - llm-usage-store:     atomic write-once, idempotent, read, corrupt isolation
 * - llm-usage-recorder:  call lifecycle, final-once, backfill idempotent,
 *                         workspace hash, retry diagnostics, privacy
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs \
 *        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        scripts/test-llm-usage-store.mjs
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

// Must set BEFORE importing modules that resolve getAgentDir().
const agentDir = mkdtempSync(join(tmpdir(), "pi-llm-usage-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const eventsDir = join(agentDir, "usage-events", "v1");

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  LLM_USAGE_SOURCE_KINDS,
  createLlmUsageTotals,
  addLlmUsageToTotals,
  formatUtcDate,
} = await import("../lib/llm-usage-types.ts");

const { normalizeSdkUsage, normalizeProvider, normalizeModel } =
  await import("../lib/llm-usage-normalize.ts");

const {
  writeLlmUsageEvent,
  readLlmUsageEvents,
  backfillEventId,
  generateCallId,
  generateEventId,
} = await import("../lib/llm-usage-store.ts");

const {
  createCall,
  recordFinalUsage,
  recordAbortedUsage,
  recordErrorUsage,
  recordBackfillUsage,
  hashWorkspace,
  recorderDiagnostics,
  resetRecorderForTest,
} = await import("../lib/llm-usage-recorder.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage(overrides = {}) {
  return {
    input: 100,
    output: 200,
    cacheRead: 50,
    cacheWrite: 30,
    totalTokens: 380,
    cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${name}: ${msg}`);
    process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
  }
}

// ---------------------------------------------------------------------------
// llm-usage-types
// ---------------------------------------------------------------------------

await test("formatUtcDate returns YYYY-MM-DD", () => {
  assert.equal(formatUtcDate(new Date("2026-07-13T12:00:00Z")), "2026-07-13");
  assert.equal(formatUtcDate(new Date("2025-01-01T00:00:00Z")), "2025-01-01");
});

await test("createLlmUsageTotals returns zero totals", () => {
  const t = createLlmUsageTotals();
  assert.equal(t.input, 0);
  assert.equal(t.calls, 0);
  assert.equal(t.successCalls, 0);
  assert.equal(t.errorCalls, 0);
  assert.equal(t.reasoning, undefined);
});

await test("addLlmUsageToTotals accumulates correctly (cacheWrite ignored)", () => {
  const totals = createLlmUsageTotals();
  const evt = {
    status: "success",
    usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 3, totalTokens: 38, cost: { total: 0.05 } },
  };
  addLlmUsageToTotals(totals, evt);
  assert.equal(totals.input, 10);
  assert.equal(totals.output, 20);
  assert.equal(totals.cacheRead, 5);
  assert.equal(totals.cacheWrite, 0, "cacheWrite must stay 0 — no longer aggregated");
  assert.equal(totals.totalTokens, 38);
  assert.equal(totals.calls, 1);
  assert.equal(totals.successCalls, 1);
  assert.equal(totals.errorCalls, 0);
  assert.equal(totals.cost, 0.05);
});

await test("addLlmUsageToTotals tracks error/aborted separately", () => {
  const totals = createLlmUsageTotals();
  addLlmUsageToTotals(totals, { status: "error", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } } });
  addLlmUsageToTotals(totals, { status: "aborted", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } } });
  addLlmUsageToTotals(totals, { status: "success", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } } });
  assert.equal(totals.calls, 3);
  assert.equal(totals.successCalls, 1);
  assert.equal(totals.errorCalls, 1);
  assert.equal(totals.abortedCalls, 1);
});

await test("addLlmUsageToTotals handles reasoning (subset of output)", () => {
  const totals = createLlmUsageTotals();
  addLlmUsageToTotals(totals, { status: "success", usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { total: 0 }, reasoning: 5 } });
  assert.equal(totals.reasoning, 5);
  assert.equal(totals.output, 20); // output unchanged, reasoning is subset
  // Second event without reasoning: keeps running total
  addLlmUsageToTotals(totals, { status: "success", usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { total: 0 } } });
  assert.equal(totals.reasoning, 5); // unchanged
});

// ---------------------------------------------------------------------------
// llm-usage-normalize
// ---------------------------------------------------------------------------

await test("normalizeSdkUsage maps all fields (cacheWrite zeroed)", () => {
  const result = normalizeSdkUsage(usage());
  assert.equal(result.input, 100);
  assert.equal(result.output, 200);
  assert.equal(result.cacheRead, 50);
  assert.equal(result.cacheWrite, 0, "cacheWrite must be 0 — no longer collected");
  assert.equal(result.totalTokens, 380);
  assert.equal(result.cost.input, 0.01);
  assert.equal(result.cost.cacheWrite, 0, "cost.cacheWrite must be 0 — no longer collected");
  assert.equal(result.cost.total, 0.033);
  assert.equal(result.cacheWrite1h, undefined, "cacheWrite1h must not be emitted");
});

await test("normalizeSdkUsage prefers SDK totalTokens", () => {
  const result = normalizeSdkUsage(usage({ totalTokens: 999 }));
  assert.equal(result.totalTokens, 999);
});

await test("normalizeSdkUsage falls back to sum when totalTokens missing (cacheWrite excluded)", () => {
  const result = normalizeSdkUsage(usage({ totalTokens: undefined }));
  // 100+200+50 = 350 (cacheWrite no longer included in fallback sum)
  assert.equal(result.totalTokens, 350);
  assert.equal(result.cacheWrite, 0);
});

await test("normalizeSdkUsage clamps NaN/Infinity/negative to 0", () => {
  const result = normalizeSdkUsage(usage({ input: NaN, output: Infinity, cacheRead: -5, cacheWrite: undefined, totalTokens: -1 }));
  assert.equal(result.input, 0);
  assert.equal(result.output, 0);
  assert.equal(result.cacheRead, 0);
  assert.equal(result.cacheWrite, 0);
  assert.equal(result.totalTokens, 0); // b/c totalTokens was -1 → falls to sum (0)
});

await test("normalizeSdkUsage never emits cacheWrite1h", () => {
  const result = normalizeSdkUsage(usage({ cacheWrite1h: 15 }));
  assert.equal(result.cacheWrite1h, undefined, "cacheWrite1h must not be emitted");
});

await test("normalizeSdkUsage omits cacheWrite1h when NaN", () => {
  const result = normalizeSdkUsage(usage({ cacheWrite1h: NaN }));
  assert.equal(result.cacheWrite1h, undefined);
});

await test("normalizeSdkUsage preserves reasoning when valid", () => {
  const result = normalizeSdkUsage(usage({ reasoning: 42 }));
  assert.equal(result.reasoning, 42);
});

await test("normalizeSdkUsage omits reasoning when undefined", () => {
  const result = normalizeSdkUsage(usage({ reasoning: undefined }));
  assert.equal(result.reasoning, undefined);
});

await test("normalizeSdkUsage: reasoning does NOT inflate output", () => {
  const result = normalizeSdkUsage(usage({ output: 200, reasoning: 100, totalTokens: 380 }));
  assert.equal(result.output, 200); // reasoning is subset, output unchanged
  assert.equal(result.totalTokens, 380);
});

await test("normalizeProvider handles valid / empty / whitespace", () => {
  assert.equal(normalizeProvider("openai"), "openai");
  assert.equal(normalizeProvider("  claude  "), "claude");
  assert.equal(normalizeProvider(""), "unknown");
  assert.equal(normalizeProvider(undefined), "unknown");
  assert.equal(normalizeProvider(123), "unknown");
});

await test("normalizeModel handles valid / empty / whitespace", () => {
  assert.equal(normalizeModel("gpt-4"), "gpt-4");
  assert.equal(normalizeModel(""), "unknown");
  assert.equal(normalizeModel(null), "unknown");
});

// ---------------------------------------------------------------------------
// llm-usage-store: atomic write-once
// ---------------------------------------------------------------------------

await test("writeLlmUsageEvent writes to date-partitioned dir", () => {
  resetRecorderForTest();
  const occurredAt = new Date("2026-07-13T12:00:00Z");
  const event = {
    kind: "yolk-llm-usage-event",
    schemaVersion: 1,
    eventId: "evt_test_001",
    callId: "call_test_001",
    occurredAt: occurredAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: "success",
    provider: "openai",
    requestedModel: "gpt-4",
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } },
    source: { kind: "chat" },
    provenance: { mode: "native", usageSource: "sdk", attemptVisibility: "finalized_completion_only" },
  };
  const result = writeLlmUsageEvent(event);
  assert.equal(result.written, true);
  assert.ok(existsSync(join(eventsDir, "2026-07-13", "evt_test_001.json")));

  // Verify JSON content
  const raw = readFileSync(join(eventsDir, "2026-07-13", "evt_test_001.json"), "utf-8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.eventId, "evt_test_001");
  assert.equal(parsed.status, "success");
});

await test("writeLlmUsageEvent is idempotent on same eventId", () => {
  const occurredAt = new Date("2026-07-13T13:00:00Z");
  const event = {
    kind: "yolk-llm-usage-event",
    schemaVersion: 1,
    eventId: "evt_test_dup",
    callId: "call_dup",
    occurredAt: occurredAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: "success",
    provider: "x",
    requestedModel: "y",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    source: { kind: "chat" },
    provenance: { mode: "native", usageSource: "sdk", attemptVisibility: "finalized_completion_only" },
  };
  const r1 = writeLlmUsageEvent(event);
  assert.equal(r1.written, true);

  // Second write with same eventId
  const r2 = writeLlmUsageEvent(event);
  assert.equal(r2.written, false);
  assert.equal(r2.existingEventId, "evt_test_dup");
});

await test("readLlmUsageEvents returns events in date range", () => {
  const events = readLlmUsageEvents(
    new Date("2026-07-13T00:00:00Z"),
    new Date("2026-07-13T23:59:59Z"),
  );
  // We wrote at least evt_test_001 and evt_test_dup above
  assert.ok(events.events.length >= 2);
  assert.ok(events.events.some((e) => e.eventId === "evt_test_001"));
  assert.ok(events.events.some((e) => e.eventId === "evt_test_dup"));
});

await test("readLlmUsageEvents isolates corrupt JSON file", () => {
  const dateDir = join(eventsDir, "2026-07-13");
  mkdirSync(dateDir, { recursive: true });
  writeFileSync(join(dateDir, "corrupt.json"), "not valid json {{{", "utf-8");

  let corruptReason = "";
  const result = readLlmUsageEvents(
    new Date("2026-07-13T00:00:00Z"),
    new Date("2026-07-13T23:59:59Z"),
    (id, reason) => { if (id === "corrupt.json") corruptReason = reason; },
  );
  assert.ok(result.corruptFiles >= 1);
  assert.equal(corruptReason, "invalid JSON");
  // Valid events still returned
  assert.ok(result.events.length >= 2);
});

await test("readLlmUsageEvents skips oversized file", () => {
  const dateDir = join(eventsDir, "2026-07-13");
  mkdirSync(dateDir, { recursive: true });
  // Write a file just under 128K — won't be oversized
  // The store MAX is 128 * 1024; write a file that's exactly 129KB
  const bigContent = JSON.stringify({ x: "a".repeat(129 * 1024) });
  writeFileSync(join(dateDir, "oversized.json"), bigContent, "utf-8");

  let skipReason = "";
  readLlmUsageEvents(
    new Date("2026-07-13T00:00:00Z"),
    new Date("2026-07-13T23:59:59Z"),
    (id, reason) => { if (id === "oversized.json") skipReason = reason; },
  );
  assert.ok(skipReason.includes("oversized"));
});

await test("readLlmUsageEvents returns empty for no date range", () => {
  const result = readLlmUsageEvents(
    new Date("2020-01-01T00:00:00Z"),
    new Date("2020-01-01T23:59:59Z"),
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.corruptFiles, 0);
});

await test("backfillEventId is deterministic", () => {
  const id1 = backfillEventId("session-1", "entry-1");
  const id2 = backfillEventId("session-1", "entry-1");
  assert.equal(id1, id2);
  assert.ok(id1.length === 64); // SHA-256 hex
});

await test("generateCallId / generateEventId are unique", () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(generateCallId());
  assert.equal(ids.size, 100);
  const evtIds = new Set();
  for (let i = 0; i < 100; i++) evtIds.add(generateEventId());
  assert.equal(evtIds.size, 100);
});

// ---------------------------------------------------------------------------
// llm-usage-recorder: call lifecycle
// ---------------------------------------------------------------------------

await test("createCall → recordFinalUsage writes event", () => {
  resetRecorderForTest();
  const callId = createCall({
    sourceKind: "chat",
    workspacePath: "/tmp/test-ws",
    sessionId: "sess-1",
  });
  assert.ok(callId.startsWith("call_"));

  const result = recordFinalUsage(callId, usage(), {
    sourceKind: "chat",
    provider: "openai",
    requestedModel: "gpt-4",
    workspacePath: "/tmp/test-ws",
    sessionId: "sess-1",
  });
  assert.equal(result.written, true);
  assert.equal(recorderDiagnostics.successfulWrites, 1);

  // Read back
  const all = readLlmUsageEvents(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2027-12-31T23:59:59Z"),
  );
  const evt = all.events.find((e) => e.callId === callId);
  assert.ok(evt);
  assert.equal(evt.provider, "openai");
  assert.equal(evt.requestedModel, "gpt-4");
  assert.equal(evt.status, "success");
  assert.equal(evt.source.kind, "chat");
  assert.equal(evt.scope.sessionId, "sess-1");
  assert.equal(evt.provenance.mode, "native");
});

await test("recordFinalUsage: double-finalize is no-op", () => {
  resetRecorderForTest();
  const callId = createCall({ sourceKind: "warmup" });
  const r1 = recordFinalUsage(callId, usage(), {
    sourceKind: "warmup",
    provider: "x",
    requestedModel: "y",
  });
  assert.equal(r1.written, true);
  const r2 = recordFinalUsage(callId, usage(), {
    sourceKind: "warmup",
    provider: "x",
    requestedModel: "y",
  });
  assert.equal(r2.written, false);
  assert.equal(r2.error, "already finalized");
});

await test("recordAbortedUsage writes zero-usage event", () => {
  resetRecorderForTest();
  const callId = createCall({ sourceKind: "model_test" });
  const result = recordAbortedUsage(callId, "aborted", {
    sourceKind: "model_test",
    provider: "test-p",
    requestedModel: "test-m",
  });
  assert.equal(result.written, true);

  const all = readLlmUsageEvents(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2027-12-31T23:59:59Z"),
  );
  const evt = all.events.find((e) => e.callId === callId);
  assert.ok(evt);
  assert.equal(evt.status, "aborted");
  assert.equal(evt.usage.input, 0);
  assert.equal(evt.usage.totalTokens, 0);
});

await test("recordErrorUsage preserves partial usage on error", () => {
  resetRecorderForTest();
  const callId = createCall({ sourceKind: "terminal_env_assist" });
  const partialUsage = usage({ input: 50, output: 0, totalTokens: 50 });
  const result = recordErrorUsage(callId, partialUsage, {
    sourceKind: "terminal_env_assist",
    provider: "p",
    requestedModel: "m",
  });
  assert.equal(result.written, true);

  const all = readLlmUsageEvents(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2027-12-31T23:59:59Z"),
  );
  const evt = all.events.find((e) => e.callId === callId);
  assert.equal(evt.status, "error");
  assert.equal(evt.usage.input, 50);
});

// ---------------------------------------------------------------------------
// Backfill idempotent
// ---------------------------------------------------------------------------

await test("recordBackfillUsage is idempotent", () => {
  resetRecorderForTest();
  const r1 = recordBackfillUsage(usage(), {
    sessionId: "sess-backfill-1",
    entryId: "entry-1",
    occurredAt: "2026-06-01T10:00:00Z",
    provider: "openai",
    model: "gpt-4",
    workspacePath: "/tmp/test",
  });
  assert.equal(r1.written, true);

  // Same session/entry — same deterministic eventId
  const r2 = recordBackfillUsage(usage(), {
    sessionId: "sess-backfill-1",
    entryId: "entry-1",
    occurredAt: "2026-06-01T10:00:00Z",
    provider: "openai",
    model: "gpt-4",
    workspacePath: "/tmp/test",
  });
  assert.equal(r2.written, false);
  assert.ok(r2.existingEventId);
  assert.equal(recorderDiagnostics.idempotentSkips, 1);
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

await test("workspace path is hashed, raw path NOT in event", () => {
  resetRecorderForTest();
  const wsPath = "/home/user/projects/my-app";
  const hash = hashWorkspace(wsPath);
  assert.ok(hash.length === 24);
  assert.ok(!hash.includes("/"));
  assert.ok(!hash.includes("my-app"));

  const callId = createCall({ sourceKind: "chat", workspacePath: wsPath, sessionId: "s" });
  const result = recordFinalUsage(callId, usage(), {
    sourceKind: "chat",
    provider: "p",
    requestedModel: "m",
    workspacePath: wsPath,
    sessionId: "s",
  });
  assert.equal(result.written, true);

  const all = readLlmUsageEvents(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2027-12-31T23:59:59Z"),
  );
  const evt = all.events.find((e) => e.callId === callId);
  assert.ok(evt);
  assert.equal(evt.scope.workspaceKey, hash);
  // Verify JSON on disk contains NO raw path
  const dateDir = join(eventsDir, formatUtcDate(new Date()));
  const files = readdirSync(dateDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const content = readFileSync(join(dateDir, f), "utf-8");
    assert.ok(!content.includes(wsPath), `file ${f} should NOT contain raw workspace path`);
  }
});

await test("event JSON on disk contains NO prompt/output/responseId", () => {
  const dateDir = join(eventsDir, formatUtcDate(new Date()));
  if (!existsSync(dateDir)) return; // no events written in this phase
  const files = readdirSync(dateDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    // Skip known test artifacts that aren't valid event JSON
    if (f === "corrupt.json" || f === "oversized.json") continue;
    const content = readFileSync(join(dateDir, f), "utf-8");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Non-JSON files are test artifacts; skip
      continue;
    }
    // Only check records that look like usage events
    if (parsed.kind !== "yolk-llm-usage-event") continue;
    assert.equal(parsed.prompt, undefined, `${f}: prompt field leaked`);
    assert.equal(parsed.output, undefined, `${f}: output field leaked`);
    assert.equal(parsed.responseId, undefined, `${f}: responseId field leaked`);
    assert.equal(parsed.accountId, undefined, `${f}: accountId field leaked`);
    assert.equal(parsed.credential, undefined, `${f}: credential field leaked`);
  }
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

await test("recorderDiagnostics track counts", () => {
  resetRecorderForTest();
  const callId = createCall({ sourceKind: "chat" });
  recordFinalUsage(callId, usage(), { sourceKind: "chat", provider: "p", requestedModel: "m" });
  assert.equal(recorderDiagnostics.totalWrites, 1);
  assert.equal(recorderDiagnostics.successfulWrites, 1);
});

// ---------------------------------------------------------------------------
// Unknown provider/model preserved
// ---------------------------------------------------------------------------

await test("unknown provider/model recorded as 'unknown' not dropped", () => {
  resetRecorderForTest();
  const callId = createCall({ sourceKind: "trellis_workflow_assist" });
  recordFinalUsage(callId, usage(), {
    sourceKind: "trellis_workflow_assist",
    provider: "",
    requestedModel: "",
  });
  const all = readLlmUsageEvents(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2027-12-31T23:59:59Z"),
  );
  const evt = all.events.find((e) => e.callId === callId);
  assert.ok(evt);
  assert.equal(evt.provider, "unknown");
  assert.equal(evt.requestedModel, "unknown");
});

// ---------------------------------------------------------------------------
// Source kind coverage
// ---------------------------------------------------------------------------

await test("all LLM_USAGE_SOURCE_KINDS are strings", () => {
  for (const kind of LLM_USAGE_SOURCE_KINDS) {
    assert.equal(typeof kind, "string");
  }
  assert.ok(LLM_USAGE_SOURCE_KINDS.includes("chat"));
  assert.ok(LLM_USAGE_SOURCE_KINDS.includes("compaction"));
  assert.ok(LLM_USAGE_SOURCE_KINDS.includes("legacy_session_backfill"));
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch { /* ok */ }

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log("\nFailures:");
  for (const e of errors) console.log(`  - ${e}`);
}
process.exit(failed > 0 ? 1 : 0);
