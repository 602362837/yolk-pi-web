import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SNAPSHOT_JSON_BYTES,
  MEMORY_DIAGNOSTIC_KIND,
  MEMORY_DIAGNOSTIC_SCHEMA_VERSION,
  captureMemorySnapshot,
  compactSnapshot,
  computeFindings,
  serializeSnapshot,
  triggerMemorySnapshot,
  writeSnapshotAtomic,
} from "../lib/memory-diagnostics.ts";

const MiB = 1024 * 1024;
const GiB = 1024 * 1024 * 1024;

// A fake, dependency-free runtime collector so focused tests exercise the
// orchestration/size/atomic-write/lock logic without loading rpc-manager or
// the other owner modules (which use constructor parameter properties the
// Node native TS stripper cannot parse). Production uses the real default.
const fakeRuntime = () => {
  const agentSessions = {
    registryTotal: 0, aliveCount: 0, streamingCount: 0, compactingCount: 0,
    startLockCount: 0, studioChildPinnedSessionCount: 0,
    sessions: { total: 0, sampled: 0, truncated: 0, samples: [] },
  };
  const studio = {
    childRunTotal: 0, childRunByStatus: {}, childRunByRunner: {}, childRunByMember: {},
    childRuns: { total: 0, sampled: 0, truncated: 0, samples: [] },
    continuationCallbackCount: 0, terminalContinuationKeyCount: 0, pendingContinuationTotal: 0,
    pendingContinuations: { total: 0, sampled: 0, truncated: 0, samples: [] },
  };
  const sessionPathCache = { total: 0, sampled: 0, truncated: 0, samples: [] };
  const browserShare = {
    shareCount: 0, shareCodeCount: 0, sessionBindingCount: 0, tombstoneCount: 0,
    commandCount: 0, commandWaiterCount: 0, sharesByStatus: {}, sharesByLifecycleStatus: {},
    commandsByStatus: {}, tombstonesByLifecycleStatus: {},
  };
  const terminals = {
    sessionCount: 0, byKind: {}, byBackend: {}, totalSubscribers: 0, totalBufferChunks: 0,
    estimatedBufferBytes: 0, sessions: { total: 0, sampled: 0, truncated: 0, samples: [] },
  };
  const sessionFileChanges = { sessionCount: 0, sampled: 0, truncated: 0, sessions: [] };
  return {
    runtime: { agentSessions, studio, sessionPathCache, browserShare, terminals, sessionFileChanges },
    errors: [],
    truncation: [],
    agentSessions, studio, sessionPathCache, browserShare, terminals, sessionFileChanges,
  };
};

const CAPTURE_OPTS = { collectRuntime: fakeRuntime };

async function main() {

function memUsage(overrides = {}) {
  return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0, ...overrides };
}

// Use a fresh temp agent dir for every capture so tests never touch the user's
// real ~/.pi/agent/diagnostics directory.
async function withTempAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-memdiag-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// 1. Basic capture + schema + metadata-only response
await withTempAgentDir(async () => {
  const result = await captureMemorySnapshot(CAPTURE_OPTS);
  assert.equal(result.ok, true, "capture should succeed");
  assert.equal(result.kind, MEMORY_DIAGNOSTIC_KIND);
  assert.equal(result.schemaVersion, MEMORY_DIAGNOSTIC_SCHEMA_VERSION);
  assert.ok(result.filePath.endsWith(".json"));
  assert.ok(result.bytes > 0);
  assert.ok(result.durationMs >= 0);
  assert.ok(existsSync(result.filePath));

  // Response must be metadata only — never echo the full snapshot.
  const responseKeys = new Set(Object.keys(result));
  assert.ok(!responseKeys.has("runtime"), "response must not include runtime");
  assert.ok(!responseKeys.has("findings"), "response must not include findings");
  assert.ok(!responseKeys.has("errors"), "response must not include errors");
  assert.ok(!responseKeys.has("process"), "response must not include process");
  assert.ok(!responseKeys.has("truncation"), "response must not include truncation");

  const raw = readFileSync(result.filePath, "utf8");
  const snapshot = JSON.parse(raw);
  assert.equal(snapshot.kind, MEMORY_DIAGNOSTIC_KIND);
  assert.equal(snapshot.schemaVersion, MEMORY_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(snapshot.privacy.includesLocalPaths, true);
  assert.ok(typeof snapshot.privacy.sharingWarning === "string");
  assert.ok(snapshot.runtime && typeof snapshot.runtime === "object");
  assert.ok("agentSessions" in snapshot.runtime);
  assert.ok("process" in snapshot);
  assert.ok(Array.isArray(snapshot.findings));
  assert.ok(Array.isArray(snapshot.errors));
  assert.ok(Array.isArray(snapshot.truncation));
});

// 2. Marker exclusion: env secret marker never appears in file or response
await withTempAgentDir(async () => {
  const marker = "sk-test-secret-marker-XYZ";
  process.env.SECRET_MARKER = marker;
  try {
    const result = await captureMemorySnapshot(CAPTURE_OPTS);
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(marker), "marker must not appear in API response");
    const file = readFileSync(result.filePath, "utf8");
    assert.ok(!file.includes(marker), "marker must not appear in diagnostic file");
    assert.ok(!file.includes("PI_CODING_AGENT_DIR"), "env var name must not appear");
  } finally {
    delete process.env.SECRET_MARKER;
  }
});

// 3. Concurrent single-flight -> one 201, one 409, then a third succeeds
await withTempAgentDir(async () => {
  const [a, b] = await Promise.all([triggerMemorySnapshot(CAPTURE_OPTS), triggerMemorySnapshot(CAPTURE_OPTS)]);
  const ok = [a, b].filter((r) => r.ok);
  const conflict = [a, b].filter((r) => !r.ok && r.code === "snapshot_in_progress");
  assert.equal(ok.length, 1, "exactly one capture should succeed");
  assert.equal(conflict.length, 1, "exactly one should get snapshot_in_progress");
  // After the first resolves, a third trigger must succeed (lock released).
  const c = await triggerMemorySnapshot(CAPTURE_OPTS);
  assert.equal(c.ok, true, "lock must release after in-flight capture resolves");
  assert.ok(existsSync(c.filePath));
});

// ---------------------------------------------------------------------------
// 4. Findings thresholds (pure function)
// ---------------------------------------------------------------------------
{
  const empty = computeFindings({
    memoryUsage: memUsage(),
    aliveSessionCount: 0,
    registrySessionTotal: 0,
    startLockCount: 0,
    maxSessionContentBytes: 0,
    maxListenerCount: 0,
    studioChildPinnedSessionCount: 0,
    oldestActiveChildAgeMs: null,
    pendingContinuationTotal: 0,
    maxPendingContinuationAttempts: null,
    pathCacheTotal: 0,
    terminalSessionCount: 0,
    browserShareCount: 0,
  });
  assert.equal(empty.length, 0, "no findings at zero baseline");

  const rss = computeFindings({ memoryUsage: memUsage({ rss: GiB - 1 }), aliveSessionCount: 0 });
  assert.ok(!rss.some((f) => f.code === "rss_high"), "rss below 1GiB should not warn");

  const rssWarn = computeFindings({ memoryUsage: memUsage({ rss: GiB + 1 }), aliveSessionCount: 0 });
  const w = rssWarn.find((f) => f.code === "rss_high");
  assert.ok(w && w.severity === "warning", "rss >= 1GiB should warn");

  const rssCrit = computeFindings({ memoryUsage: memUsage({ rss: 2 * GiB + 1 }), aliveSessionCount: 0 });
  const cc = rssCrit.find((f) => f.code === "rss_high");
  assert.ok(cc && cc.severity === "critical", "rss >= 2GiB should be critical");

  const heap = computeFindings({ memoryUsage: memUsage({ heapUsed: 768 * MiB + 1 }), aliveSessionCount: 0 });
  assert.ok(heap.some((f) => f.code === "heap_used_high"), "heap >= 768MiB should warn");

  const sessions = computeFindings({ memoryUsage: memUsage(), aliveSessionCount: 10 });
  assert.ok(sessions.some((f) => f.code === "many_alive_sessions"), "10 alive sessions should warn");

  const content = computeFindings({ memoryUsage: memUsage(), maxSessionContentBytes: 50 * MiB });
  assert.ok(content.some((f) => f.code === "large_session_content"), "50MiB content should warn");

  const listeners = computeFindings({ memoryUsage: memUsage(), maxListenerCount: 10 });
  assert.ok(listeners.some((f) => f.code === "many_listeners"), "10 listeners should finding");

  const child = computeFindings({ memoryUsage: memUsage(), oldestActiveChildAgeMs: 30 * 60 * 1000 });
  assert.ok(child.some((f) => f.code === "long_running_child"), "30min child should warn");

  const pend = computeFindings({ memoryUsage: memUsage(), pendingContinuationTotal: 20 });
  assert.ok(pend.some((f) => f.code === "many_pending_continuations"), "20 pending should warn");

  const pend2 = computeFindings({ memoryUsage: memUsage(), maxPendingContinuationAttempts: 10 });
  assert.ok(pend2.some((f) => f.code === "high_continuation_attempts"), "10 attempts should warn");

  const cache = computeFindings({ memoryUsage: memUsage(), pathCacheTotal: 500, aliveSessionCount: 10 });
  assert.ok(cache.some((f) => f.code === "large_path_cache"), "path cache >= max(500, alive*20) should finding");
  const cacheBelow = computeFindings({ memoryUsage: memUsage(), pathCacheTotal: 499 });
  assert.ok(!cacheBelow.some((f) => f.code === "large_path_cache"), "path cache below threshold should not finding");

  const terms = computeFindings({ memoryUsage: memUsage(), terminalSessionCount: 50 });
  assert.ok(terms.some((f) => f.code === "many_terminals"));
  const shares = computeFindings({ memoryUsage: memUsage(), browserShareCount: 50 });
  assert.ok(shares.some((f) => f.code === "many_browser_shares"));

  // Findings must never claim a confirmed leak in wording.
  for (const f of [...rssCrit, ...heap, ...sessions, ...content, ...child, ...pend]) {
    assert.ok(!/confirmed leak/i.test(f.message), `finding ${f.code} must not claim a confirmed leak`);
  }
}

// ---------------------------------------------------------------------------
// 5. compactSnapshot + serializeSnapshot: size budget, fallback, and hard cap
// ---------------------------------------------------------------------------
{
  // compactSnapshot pure: strips all sample arrays, marks compacted true.
  const base = {
    kind: MEMORY_DIAGNOSTIC_KIND,
    schemaVersion: MEMORY_DIAGNOSTIC_SCHEMA_VERSION,
    snapshotId: "x",
    capturedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.001Z",
    durationMs: 1,
    partial: false,
    compacted: false,
    privacy: { includesLocalPaths: true, excludes: [], sharingWarning: "w" },
    limits: {},
    process: { error: "skip" },
    runtime: {
      agentSessions: { registryTotal: 1, aliveCount: 1, streamingCount: 0, compactingCount: 0, startLockCount: 0, studioChildPinnedSessionCount: 0, sessions: { total: 1, sampled: 1, truncated: 0, samples: [{ sessionId: "a", cwd: "x" }] } },
      studio: { childRunTotal: 1, childRunByStatus: {}, childRunByRunner: {}, childRunByMember: {}, childRuns: { total: 1, sampled: 1, truncated: 0, samples: [{ runId: "r" }] }, continuationCallbackCount: 0, terminalContinuationKeyCount: 0, pendingContinuationTotal: 1, pendingContinuations: { total: 1, sampled: 1, truncated: 0, samples: [{ continuationKey: "k" }] } },
      sessionPathCache: { total: 1, sampled: 1, truncated: 0, samples: [{ sessionId: "a", path: "p" }] },
      terminals: { sessionCount: 1, byKind: {}, byBackend: {}, totalSubscribers: 0, totalBufferChunks: 0, estimatedBufferBytes: 0, sessions: { total: 1, sampled: 1, truncated: 0, samples: [{ id: "t", kind: "local", backend: "pty", cwd: "x", shell: "sh", subscriberCount: 0, bufferChunks: 0, estimatedBufferBytes: 0, closed: false }] } },
      sessionFileChanges: { sessionCount: 1, sampled: 1, truncated: 0, sessions: [{ sessionId: "a", fileCount: 1, pendingToolCount: 0 }] },
    },
    findings: [],
    errors: [],
    truncation: [],
  };
  const compact = compactSnapshot(base);
  assert.equal(compact.compacted, true);
  assert.equal(compact.runtime.agentSessions.sessions.samples.length, 0);
  assert.equal(compact.runtime.studio.childRuns.samples.length, 0);
  assert.equal(compact.runtime.studio.pendingContinuations.samples.length, 0);
  assert.equal(compact.runtime.sessionPathCache.samples.length, 0);
  assert.equal(compact.runtime.terminals.sessions.samples.length, 0);
  assert.equal(compact.runtime.sessionFileChanges.sessions.length, 0);
  // Totals/aggregates retained.
  assert.equal(compact.runtime.agentSessions.sessions.total, 1);
  assert.equal(compact.runtime.studio.childRunTotal, 1);
  // Original is not mutated.
  assert.equal(base.runtime.agentSessions.sessions.samples.length, 1);
}

{
  // Compact-success path: full snapshot > 5 MiB because of one large sample
  // field the compact fallback strips, but totals are small.
  const big = "X".repeat(6 * MiB);
  const oversized = {
    kind: MEMORY_DIAGNOSTIC_KIND,
    schemaVersion: MEMORY_DIAGNOSTIC_SCHEMA_VERSION,
    snapshotId: "big",
    capturedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.001Z",
    durationMs: 1,
    partial: false,
    compacted: false,
    privacy: { includesLocalPaths: true, excludes: [], sharingWarning: "w" },
    limits: {},
    process: { error: "skip" },
    runtime: {
      agentSessions: { registryTotal: 1, aliveCount: 1, streamingCount: 0, compactingCount: 0, startLockCount: 0, studioChildPinnedSessionCount: 0, sessions: { total: 1, sampled: 1, truncated: 0, samples: [{ sessionId: "a", cwd: big, sessionFile: "x" }] } },
    },
    findings: [],
    errors: [],
    truncation: [],
  };
  const res = serializeSnapshot(oversized);
  assert.equal(res.ok, true, "compact fallback should bring snapshot under cap");
  assert.equal(res.compacted, true);
  assert.ok(Buffer.byteLength(res.json, "utf8") <= MAX_SNAPSHOT_JSON_BYTES);
  assert.equal(JSON.parse(res.json).compacted, true);
  assert.equal(JSON.parse(res.json).runtime.agentSessions.sessions.samples.length, 0);
}

{
  // Hard-cap path: a field preserved by compact (privacy) keeps JSON over cap.
  const huge = "Y".repeat(6 * MiB);
  const tooLarge = {
    kind: MEMORY_DIAGNOSTIC_KIND,
    schemaVersion: MEMORY_DIAGNOSTIC_SCHEMA_VERSION,
    snapshotId: "huge",
    capturedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.001Z",
    durationMs: 1,
    partial: false,
    compacted: false,
    privacy: { includesLocalPaths: true, excludes: [], sharingWarning: huge },
    limits: {},
    process: { error: "skip" },
    runtime: {},
    findings: [],
    errors: [],
    truncation: [],
  };
  const res = serializeSnapshot(tooLarge);
  assert.equal(res.ok, false);
  assert.equal(res.code, "snapshot_too_large");
}

// 6. Atomic write: success path + mkdir failure cleanup (no leftover tmp)
await withTempAgentDir(async () => {
  const ok = writeSnapshotAtomic({ capturedAtMs: Date.now(), json: "{\"kind\":\"x\"}" });
  assert.equal(ok.ok, true);
  assert.ok(existsSync(ok.filePath));
  // No stray tmp files in the diagnostics dir.
  const entries = readdirOnlyTmp(ok.filePath);
  assert.equal(entries.length, 0, "no temp files should remain after success");
});

await withTempAgentDir((dir) => {
  // Make "diagnostics" a regular file so mkdirSync of a directory fails.
  writeFileSync(join(dir, "diagnostics"), "blocked");
  const res = writeSnapshotAtomic({ capturedAtMs: Date.now(), json: "{}" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "diagnostics_dir_unavailable");
  // No temp file written/cleaned; the blocking file is untouched.
  assert.ok(!existsSync(join(dir, "diagnostics", "memory-")));
});

function readdirOnlyTmp(filePath) {
  const fdir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (!existsSync(fdir)) return [];
  return readdirSync(fdir).filter((n) => n.startsWith(".~"));
}

// 7. captureMemory snapshot error path when agent dir is unwritable as dir
await withTempAgentDir(async (dir) => {
  writeFileSync(join(dir, "diagnostics"), "blocked");
  const result = await captureMemorySnapshot(CAPTURE_OPTS);
  assert.equal(result.ok, false);
  assert.equal(result.code, "diagnostics_dir_unavailable");
  assert.ok(!existsSync(join(dir, "diagnostics", "memory-")));
});

console.log("memory-diagnostics tests: all passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});