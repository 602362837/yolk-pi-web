/**
 * PSI-06 performance benchmark for project-space session list.
 *
 * Fixture (default):
 *   ~300 active sessions, ~180 Studio children overall
 *   target space: 22 linked roots + 60 Studio children / 3 unique tasks
 *   plus 1 / 22 / 100 candidate-size warm samples
 *
 * Gates (content-safe; no paths/titles logged):
 *   warm directed list  P50 ≤ 500ms, P95 ≤ 1500ms
 *   cold recovery       P95 ≤ 5000ms (hard budget 10s)
 *   inventoryGlobalCalls = 0 on directed path
 *   studioProjectionCalls ≤ uniqueLinkedTasks
 *   concurrent web-config / models / models-config vs isolation baseline:
 *     added P95 ≤ 500ms when possible; report evidence if provider cold-start dominates
 *
 * Run:
 *   npm run bench:project-space-sessions
 *   node --loader ./scripts/ts-extension-loader.mjs scripts/bench-project-space-sessions.mjs
 *
 * Options:
 *   --samples 30
 *   --warmup 1
 *   --skip-related   skip settings/models concurrency probe
 *   --json out.json  write machine-readable summary
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const agentDir = mkdtempSync(join(tmpdir(), "pi-pssi-bench-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
// Keep directed list ON for benchmark (default).
delete process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST;

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  return args[idx + 1] ?? fallback;
}
const SAMPLES = Math.max(5, Number(argValue("--samples", "30")) || 30);
const WARMUP = Math.max(0, Number(argValue("--warmup", "1")) || 1);
const SKIP_RELATED = args.includes("--skip-related");
const JSON_OUT = argValue("--json", "");

const WARM_P50_MS = 500;
const WARM_P95_MS = 1500;
const COLD_P95_MS = 5000;
const RELATED_ADDED_P95_MS = 500;

const list = await import("../lib/project-space-session-list.ts");
const projection = await import("../lib/studio-child-display-projection.ts");
const {
  createYpiStudioTask,
  recordYpiStudioSubagentRun,
  recordYpiStudioUserApproval,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioTaskArtifact,
} = await import("../lib/ypi-studio-tasks.ts");

function spaceFixture(root, overrides = {}) {
  const realRoot = realpathSync(root);
  return {
    id: "main",
    projectId: "prj_bench_main",
    path: realRoot,
    realPath: realRoot,
    pathKey: realRoot,
    ...overrides,
  };
}

function makeTempSpace(prefix = "pssi-bench-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSessionJsonl(filePath, header, messages = []) {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const lines = [JSON.stringify(header)];
  for (const msg of messages) {
    lines.push(
      JSON.stringify({
        type: "message",
        id: msg.id || `m_${Math.random().toString(16).slice(2, 10)}`,
        parentId: null,
        timestamp: msg.timestamp || header.timestamp || new Date().toISOString(),
        message: {
          role: msg.role || "user",
          content: msg.content || "hello",
          timestamp: Date.parse(msg.timestamp || header.timestamp || Date.now()),
        },
      }),
    );
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function sessionFileFor(spaceRoot, sessionId, agentRoot = agentDir) {
  const dir = list.getEncodedSessionDirForCwd(spaceRoot, agentRoot);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${sessionId}.jsonl`);
}

function linkedHeader(space, sessionId, overrides = {}) {
  return {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: overrides.timestamp || "2026-07-24T01:00:00.000Z",
    cwd: overrides.cwd || space.path,
    projectId: overrides.projectId ?? space.projectId,
    spaceId: overrides.spaceId ?? space.id,
    ...overrides.extra,
  };
}

function writePlanReview(cwd, taskId, contextId) {
  updateYpiStudioTaskArtifact(taskId, {
    cwd,
    action: "update_artifact",
    artifact: "plan-review",
    content: `# plan-review\n\ncontext=${contextId}\n`,
    contextId,
  });
}

async function seedTask(cwd, title) {
  const contextId = `pi_bench_${Math.random().toString(16).slice(2, 10)}`;
  const task = createYpiStudioTask({
    cwd,
    title,
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
        { id: "PSI-A", title: "Bench step A", order: 10, dependsOn: [] },
        { id: "PSI-B", title: "Bench step B", order: 20, dependsOn: [] },
      ],
    },
  });
  writePlanReview(cwd, task.id, contextId);
  transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
  recordYpiStudioUserApproval(cwd, contextId, "批准");
  transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
  return task;
}

async function buildFixture(options = {}) {
  const targetRootCount = options.targetRootCount ?? 22;
  const targetChildCount = options.targetChildCount ?? 60;
  const targetUniqueTasks = options.targetUniqueTasks ?? 3;
  const noiseRootCount = options.noiseRootCount ?? 100;
  const noiseChildCount = options.noiseChildCount ?? 120;
  const otherLinkedCount = options.otherLinkedCount ?? 18;
  const suffix = Math.random().toString(16).slice(2, 10);
  // Optional isolated agent dir so size sweeps do not destroy the primary fixture.
  const fixtureAgentDir = options.agentDir ?? agentDir;
  mkdirSync(join(fixtureAgentDir, "sessions"), { recursive: true });

  const targetRoot = realpathSync(makeTempSpace("pssi-bench-target-"));
  const noiseRoot = realpathSync(makeTempSpace("pssi-bench-noise-"));
  const otherRoot = realpathSync(makeTempSpace("pssi-bench-other-"));
  const space = spaceFixture(targetRoot, { id: "main", projectId: `prj_bench_target_${suffix}` });
  const noiseSpace = spaceFixture(noiseRoot, { id: "main", projectId: `prj_bench_noise_${suffix}` });
  const otherSpace = spaceFixture(otherRoot, { id: "main", projectId: `prj_bench_other_${suffix}` });

  const tasks = [];
  for (let t = 0; t < targetUniqueTasks; t += 1) {
    const task = await seedTask(targetRoot, `Bench target task ${t + 1}`);
    recordYpiStudioSubagentRun(targetRoot, task.id, {
      id: `run-t${t}`,
      taskId: task.id,
      member: "implementer",
      status: "running",
      mode: "async",
      subtaskId: t % 2 === 0 ? "PSI-A" : "PSI-B",
      summary: `bench-run-${t}`,
      startedAt: "2026-07-24T04:00:00.000Z",
      updatedAt: "2026-07-24T04:00:00.000Z",
    });
    tasks.push(task);
  }

  const parentIds = [];
  for (let i = 0; i < targetRootCount; i += 1) {
    const id = `sess_bench_root_${String(i).padStart(3, "0")}`;
    parentIds.push(id);
    writeSessionJsonl(sessionFileFor(targetRoot, id, fixtureAgentDir), linkedHeader(space, id), [
      { role: "user", content: `target-root-${i}` },
    ]);
  }

  for (let i = 0; i < targetChildCount; i += 1) {
    const id = `sess_bench_child_${String(i).padStart(3, "0")}`;
    const parentId = parentIds[i % Math.min(3, Math.max(1, parentIds.length))];
    const task = tasks[i % Math.max(1, tasks.length)];
    const parentPath = sessionFileFor(targetRoot, parentId, fixtureAgentDir);
    writeSessionJsonl(
      sessionFileFor(targetRoot, id, fixtureAgentDir),
      linkedHeader(space, id, {
        extra: {
          parentSession: parentPath,
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: task.id,
            runId: `run-t${i % Math.max(1, tasks.length)}`,
            member: "implementer",
            subtaskId: i % 2 === 0 ? "PSI-A" : "PSI-B",
            parentSessionId: parentId,
            status: "running",
          },
        },
      }),
      [{ role: "user", content: `target-child-${i}` }],
    );
  }

  for (let i = 0; i < noiseRootCount; i += 1) {
    const id = `sess_noise_root_${String(i).padStart(3, "0")}`;
    writeSessionJsonl(sessionFileFor(noiseRoot, id, fixtureAgentDir), linkedHeader(noiseSpace, id), [
      { role: "user", content: `noise-root-${i}` },
    ]);
  }
  for (let i = 0; i < noiseChildCount; i += 1) {
    const id = `sess_noise_child_${String(i).padStart(3, "0")}`;
    writeSessionJsonl(
      sessionFileFor(noiseRoot, id, fixtureAgentDir),
      linkedHeader(noiseSpace, id, {
        extra: {
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: "noise-task-never-loaded",
            runId: `noise-run-${i}`,
            member: "implementer",
            subtaskId: "NOISE",
            parentSessionId: `sess_noise_root_${String(i % Math.max(1, noiseRootCount)).padStart(3, "0")}`,
            status: "running",
          },
        },
      }),
      [{ role: "user", content: `noise-child-${i}` }],
    );
  }
  for (let i = 0; i < otherLinkedCount; i += 1) {
    const id = `sess_other_${String(i).padStart(3, "0")}`;
    writeSessionJsonl(sessionFileFor(otherRoot, id, fixtureAgentDir), linkedHeader(otherSpace, id), [
      { role: "user", content: `other-${i}` },
    ]);
  }

  const totalSessions =
    targetRootCount + targetChildCount + noiseRootCount + noiseChildCount + otherLinkedCount;
  const totalChildren = targetChildCount + noiseChildCount;

  return {
    space,
    targetRoot,
    agentDir: fixtureAgentDir,
    tasks,
    targetRootCount,
    targetChildCount,
    targetUniqueTasks,
    totalSessions,
    totalChildren,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function fmt(ms) {
  return `${ms.toFixed(1)}ms`;
}

function round(ms) {
  return Math.round(ms * 10) / 10;
}

async function timeAsync(fn) {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  return { ms, value };
}

function resetCaches() {
  list.__resetProjectSpaceSessionListForTests();
  projection.__resetStudioChildDisplayProjectionForTests();
}

function dropIndex(spaceRoot) {
  rmSync(join(spaceRoot, ".ypi", "sessions"), { recursive: true, force: true });
}

async function sampleCold(fixture, n) {
  const fixtureAgentDir = fixture.agentDir ?? agentDir;
  const times = [];
  const countersAgg = {
    inventoryGlobalCalls: 0,
    studioProjectionCalls: 0,
    uniqueLinkedTasks: 0,
    recoveryRuns: 0,
    headerOnlyDiscoveryFiles: 0,
  };
  for (let i = 0; i < n; i += 1) {
    resetCaches();
    dropIndex(fixture.targetRoot);
    const counters = list.createProjectSpaceSessionListCounters();
    const { ms, value } = await timeAsync(() =>
      list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir: fixtureAgentDir,
        forceValidate: true,
        counters,
      }),
    );
    times.push(ms);
    countersAgg.inventoryGlobalCalls += counters.inventoryGlobalCalls;
    countersAgg.studioProjectionCalls += counters.studioProjectionCalls;
    countersAgg.uniqueLinkedTasks += counters.uniqueLinkedTasks;
    countersAgg.recoveryRuns += counters.recoveryRuns;
    countersAgg.headerOnlyDiscoveryFiles += counters.headerOnlyDiscoveryFiles;
    if (value.diagnostics.inventoryGlobalCalls !== 0) {
      throw new Error("cold path inventoryGlobalCalls != 0");
    }
    if (value.sessions.filter((s) => !s.studioChild).length !== fixture.targetRootCount) {
      throw new Error(
        `cold root count mismatch: got ${value.sessions.filter((s) => !s.studioChild).length}`,
      );
    }
  }
  return { times, countersAgg };
}

async function sampleWarm(fixture, n) {
  const fixtureAgentDir = fixture.agentDir ?? agentDir;
  // Seed complete index once, then sample warm directed validates.
  resetCaches();
  await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
    space: fixture.space,
    agentDir: fixtureAgentDir,
    forceFullReconcile: true,
  });

  const times = [];
  const countersAgg = {
    inventoryGlobalCalls: 0,
    studioProjectionCalls: 0,
    uniqueLinkedTasks: 0,
    metadataScans: 0,
    headerOnlyDiscoveryFiles: 0,
  };
  for (let i = 0; i < n; i += 1) {
    // Clear response snapshot / projection so each sample measures validate path,
    // not the 5s snapshot short-circuit (still no global inventory).
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const counters = list.createProjectSpaceSessionListCounters();
    const { ms, value } = await timeAsync(() =>
      list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir: fixtureAgentDir,
        forceValidate: true,
        counters,
      }),
    );
    times.push(ms);
    countersAgg.inventoryGlobalCalls += counters.inventoryGlobalCalls;
    countersAgg.studioProjectionCalls += counters.studioProjectionCalls;
    countersAgg.uniqueLinkedTasks += counters.uniqueLinkedTasks;
    countersAgg.metadataScans += counters.metadataScans;
    countersAgg.headerOnlyDiscoveryFiles += counters.headerOnlyDiscoveryFiles;
    if (value.diagnostics.inventoryGlobalCalls !== 0) {
      throw new Error("warm path inventoryGlobalCalls != 0");
    }
    if (counters.studioProjectionCalls > counters.uniqueLinkedTasks) {
      throw new Error(
        `studioProjectionCalls ${counters.studioProjectionCalls} > uniqueLinkedTasks ${counters.uniqueLinkedTasks}`,
      );
    }
  }
  return { times, countersAgg };
}

async function sampleWarmWithCompleteIndexOnly(fixture, n) {
  // Keep index on disk; only clear in-process snapshot/projection between samples.
  const fixtureAgentDir = fixture.agentDir ?? agentDir;
  resetCaches();
  await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
    space: fixture.space,
    agentDir: fixtureAgentDir,
    forceFullReconcile: true,
  });
  return sampleWarm(fixture, n);
}

async function sampleConcurrentSingleFlight(fixture) {
  const fixtureAgentDir = fixture.agentDir ?? agentDir;
  resetCaches();
  dropIndex(fixture.targetRoot);
  const c1 = list.createProjectSpaceSessionListCounters();
  const c2 = list.createProjectSpaceSessionListCounters();
  const c3 = list.createProjectSpaceSessionListCounters();
  const t0 = performance.now();
  await Promise.all([
    list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir: fixtureAgentDir,
      forceValidate: true,
      counters: c1,
    }),
    list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir: fixtureAgentDir,
      forceValidate: true,
      counters: c2,
    }),
    list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir: fixtureAgentDir,
      forceValidate: true,
      counters: c3,
    }),
  ]);
  const ms = performance.now() - t0;
  const recoveryRuns = c1.recoveryRuns + c2.recoveryRuns + c3.recoveryRuns;
  const inventory = c1.inventoryGlobalCalls + c2.inventoryGlobalCalls + c3.inventoryGlobalCalls;
  return { ms, recoveryRuns, inventory };
}

/**
 * Load model-runtime via jiti (parameter properties are unsupported by Node strip-only).
 * Returns null when jiti cannot load the module; models probe is then marked skipped.
 */
async function loadModelsRuntimeViaJiti() {
  try {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const runtime = await jiti.import(join(process.cwd(), "lib/web-model-runtime.ts"));
    const agent = await jiti.import("@earendil-works/pi-coding-agent");
    return {
      createWebAgentSessionServices: runtime.createWebAgentSessionServices,
      getAgentDir: agent.getAgentDir,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function measureRelatedBaseline(samples) {
  const { readPiWebConfigForApi } = await import("../lib/pi-web-config.ts");
  const { readModelsJsonRaw } = await import("../lib/models-config-store.ts");
  const modelsRuntime = await loadModelsRuntimeViaJiti();
  const modelsAvailable = typeof modelsRuntime.createWebAgentSessionServices === "function";

  const webConfig = [];
  const modelsConfig = [];
  const models = [];

  // Isolation baselines (no concurrent session list).
  for (let i = 0; i < samples; i += 1) {
    {
      const { ms } = await timeAsync(async () => readPiWebConfigForApi());
      webConfig.push(ms);
    }
    {
      const { ms } = await timeAsync(async () => readModelsJsonRaw());
      modelsConfig.push(ms);
    }
    if (modelsAvailable) {
      const { ms } = await timeAsync(async () => {
        // Mirrors /api/models fixedProvidersOnly listing cost without HTTP.
        const services = await modelsRuntime.createWebAgentSessionServices({
          cwd: process.cwd(),
          agentDir: modelsRuntime.getAgentDir(),
          fixedProvidersOnly: true,
        });
        await services.modelRuntime.getAvailable();
      });
      models.push(ms);
    }
  }

  return {
    webConfig: summarize(webConfig),
    modelsConfig: summarize(modelsConfig),
    models: modelsAvailable ? summarize(models) : null,
    modelsSkippedReason: modelsAvailable ? null : modelsRuntime.error || "models runtime unavailable",
  };
}

async function measureRelatedUnderSessionLoad(fixture, samples) {
  const fixtureAgentDir = fixture.agentDir ?? agentDir;
  const { readPiWebConfigForApi } = await import("../lib/pi-web-config.ts");
  const { readModelsJsonRaw } = await import("../lib/models-config-store.ts");
  const modelsRuntime = await loadModelsRuntimeViaJiti();
  const modelsAvailable = typeof modelsRuntime.createWebAgentSessionServices === "function";

  // Seed complete index so concurrent session work is warm directed validate.
  resetCaches();
  await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
    space: fixture.space,
    agentDir: fixtureAgentDir,
    forceFullReconcile: true,
  });

  const webConfig = [];
  const modelsConfig = [];
  const models = [];
  const sessionMs = [];

  for (let i = 0; i < samples; i += 1) {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const counters = list.createProjectSpaceSessionListCounters();

    const sessionP = timeAsync(() =>
      list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir: fixtureAgentDir,
        forceValidate: true,
        counters,
      }),
    );
    const webP = timeAsync(async () => readPiWebConfigForApi());
    const modelsConfigP = timeAsync(async () => readModelsJsonRaw());
    const modelsP = modelsAvailable
      ? timeAsync(async () => {
          const services = await modelsRuntime.createWebAgentSessionServices({
            cwd: process.cwd(),
            agentDir: modelsRuntime.getAgentDir(),
            fixedProvidersOnly: true,
          });
          await services.modelRuntime.getAvailable();
        })
      : Promise.resolve({ ms: 0, value: null });

    const [session, web, mc, m] = await Promise.all([sessionP, webP, modelsConfigP, modelsP]);
    sessionMs.push(session.ms);
    webConfig.push(web.ms);
    modelsConfig.push(mc.ms);
    if (modelsAvailable) models.push(m.ms);
    if (counters.inventoryGlobalCalls !== 0) {
      throw new Error("related concurrent path inventoryGlobalCalls != 0");
    }
  }

  return {
    session: summarize(sessionMs),
    webConfig: summarize(webConfig),
    modelsConfig: summarize(modelsConfig),
    models: modelsAvailable ? summarize(models) : null,
    modelsSkippedReason: modelsAvailable ? null : modelsRuntime.error || "models runtime unavailable",
  };
}

function gate(name, ok, detail) {
  return { name, ok, detail };
}

function printSummary(title, stats) {
  console.log(
    `  ${title}: n=${stats.n} min=${fmt(stats.min)} p50=${fmt(stats.p50)} p95=${fmt(stats.p95)} mean=${fmt(stats.mean)} max=${fmt(stats.max)}`,
  );
}

console.log("=== PSI-06 project-space session list benchmark ===");
console.log(`agentDir fixture root: (opaque temp; not printed)`);
console.log(`samples=${SAMPLES} warmup=${WARMUP}`);
console.log(`machine=${process.platform} ${process.arch} node=${process.version}`);
console.log(`cwd disk note: external/volume timing may vary`);

const primary = await buildFixture();
console.log(
  `fixture: totalSessions=${primary.totalSessions} totalChildren=${primary.totalChildren} targetRoots=${primary.targetRootCount} targetChildren=${primary.targetChildCount} uniqueTasks=${primary.targetUniqueTasks}`,
);

// Warmup rounds (not scored).
for (let i = 0; i < WARMUP; i += 1) {
  resetCaches();
  dropIndex(primary.targetRoot);
  await list.listSessionsForProjectSpace(primary.space.projectId, primary.space.id, {
    space: primary.space,
    agentDir: primary.agentDir,
    forceValidate: true,
  });
  resetCaches();
  await list.listSessionsForProjectSpace(primary.space.projectId, primary.space.id, {
    space: primary.space,
    agentDir: primary.agentDir,
    forceValidate: true,
  });
}

console.log("\n[cold recovery] missing index → complete rebuild");
const cold = await sampleCold(primary, SAMPLES);
const coldStats = summarize(cold.times);
printSummary("cold", coldStats);
console.log(
  `  counters: inventoryGlobalCalls=${cold.countersAgg.inventoryGlobalCalls} recoveryRuns=${cold.countersAgg.recoveryRuns} studioProjectionCalls/uniqueTasks sum=${cold.countersAgg.studioProjectionCalls}/${cold.countersAgg.uniqueLinkedTasks}`,
);

console.log("\n[warm directed] complete index + forceValidate (no snapshot short-circuit)");
const warm = await sampleWarmWithCompleteIndexOnly(primary, SAMPLES);
const warmStats = summarize(warm.times);
printSummary("warm", warmStats);
console.log(
  `  counters: inventoryGlobalCalls=${warm.countersAgg.inventoryGlobalCalls} headerOnlyDiscoveryFiles=${warm.countersAgg.headerOnlyDiscoveryFiles} metadataScans=${warm.countersAgg.metadataScans} studioProjectionCalls/uniqueTasks sum=${warm.countersAgg.studioProjectionCalls}/${warm.countersAgg.uniqueLinkedTasks}`,
);

console.log("\n[candidate sizes] warm P50/P95 for 1 / 22 / 100 roots");
const sizeStats = {};
for (const rootCount of [1, 22, 100]) {
  // Isolated agent dir so size sweeps never delete the primary fixture sessions.
  const sizeAgentDir = mkdtempSync(join(tmpdir(), `pi-pssi-bench-size-${rootCount}-`));
  const fixture = await buildFixture({
    targetRootCount: rootCount,
    targetChildCount: rootCount === 1 ? 0 : Math.min(60, rootCount * 2),
    noiseRootCount: 80,
    noiseChildCount: 100,
    otherLinkedCount: 20,
    agentDir: sizeAgentDir,
  });
  // Seed + warm samples (smaller sample count for size sweep).
  const n = Math.max(10, Math.floor(SAMPLES / 2));
  for (let i = 0; i < Math.min(1, WARMUP); i += 1) {
    resetCaches();
    await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir: fixture.agentDir,
      forceFullReconcile: true,
    });
  }
  const sampled = await sampleWarm(fixture, n);
  sizeStats[rootCount] = summarize(sampled.times);
  printSummary(`roots=${rootCount}`, sizeStats[rootCount]);
  try {
    rmSync(sizeAgentDir, { recursive: true, force: true });
    rmSync(fixture.targetRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

console.log("\n[single-flight] 3 concurrent cold recoveries");
const flight = await sampleConcurrentSingleFlight(primary);
console.log(
  `  wall=${fmt(flight.ms)} recoveryRuns=${flight.recoveryRuns} inventoryGlobalCalls=${flight.inventory}`,
);

let related = null;
if (!SKIP_RELATED) {
  console.log("\n[related entries] isolation baseline vs concurrent with warm session list");
  // Fewer samples for models (provider/runtime may be heavy/noisy).
  const relatedSamples = Math.max(5, Math.min(15, Math.floor(SAMPLES / 2)));
  const baseline = await measureRelatedBaseline(relatedSamples);
  const underLoad = await measureRelatedUnderSessionLoad(primary, relatedSamples);
  related = { baseline, underLoad, samples: relatedSamples };
  printSummary("web-config baseline", baseline.webConfig);
  printSummary("web-config concurrent", underLoad.webConfig);
  printSummary("models-config baseline", baseline.modelsConfig);
  printSummary("models-config concurrent", underLoad.modelsConfig);
  if (baseline.models && underLoad.models) {
    printSummary("models baseline", baseline.models);
    printSummary("models concurrent", underLoad.models);
  } else {
    console.log(
      `  models probe skipped: ${baseline.modelsSkippedReason || underLoad.modelsSkippedReason || "unavailable"}`,
    );
  }
  printSummary("session concurrent", underLoad.session);
  const addModels =
    baseline.models && underLoad.models
      ? underLoad.models.p95 - baseline.models.p95
      : null;
  console.log(
    `  added p95 web-config=${fmt(underLoad.webConfig.p95 - baseline.webConfig.p95)} models-config=${fmt(underLoad.modelsConfig.p95 - baseline.modelsConfig.p95)} models=${addModels == null ? "n/a" : fmt(addModels)}`,
  );
}

const gates = [
  gate("warm P50 ≤ 500ms", warmStats.p50 <= WARM_P50_MS, `p50=${fmt(warmStats.p50)}`),
  gate("warm P95 ≤ 1.5s", warmStats.p95 <= WARM_P95_MS, `p95=${fmt(warmStats.p95)}`),
  gate("cold P95 ≤ 5s", coldStats.p95 <= COLD_P95_MS, `p95=${fmt(coldStats.p95)}`),
  gate("cold max < 10s hard budget", coldStats.max < 10_000, `max=${fmt(coldStats.max)}`),
  gate(
    "warm inventoryGlobalCalls=0",
    warm.countersAgg.inventoryGlobalCalls === 0,
    `sum=${warm.countersAgg.inventoryGlobalCalls}`,
  ),
  gate(
    "cold inventoryGlobalCalls=0",
    cold.countersAgg.inventoryGlobalCalls === 0,
    `sum=${cold.countersAgg.inventoryGlobalCalls}`,
  ),
  gate(
    "studioProjectionCalls ≤ uniqueLinkedTasks (warm sum)",
    warm.countersAgg.studioProjectionCalls <= warm.countersAgg.uniqueLinkedTasks,
    `${warm.countersAgg.studioProjectionCalls}≤${warm.countersAgg.uniqueLinkedTasks}`,
  ),
  gate(
    "concurrent recovery single-flight",
    flight.recoveryRuns === 1 && flight.inventory === 0,
    `recoveryRuns=${flight.recoveryRuns} inventory=${flight.inventory}`,
  ),
];

if (related) {
  const addWeb = related.underLoad.webConfig.p95 - related.baseline.webConfig.p95;
  const addMc = related.underLoad.modelsConfig.p95 - related.baseline.modelsConfig.p95;
  const hasModels = Boolean(related.baseline.models && related.underLoad.models);
  const addModels = hasModels
    ? related.underLoad.models.p95 - related.baseline.models.p95
    : null;
  // Hard integrity: must not add 10s-class waits on always-available related entries.
  gates.push(
    gate(
      "related entries no 10s-class added wait (web-config/models-config)",
      addWeb < 10_000 && addMc < 10_000,
      `addedP95 web=${fmt(addWeb)} models-config=${fmt(addMc)}`,
    ),
  );
  if (hasModels) {
    gates.push(
      gate(
        "related models no 10s-class added wait",
        addModels < 10_000,
        `addedP95 models=${fmt(addModels)}`,
      ),
    );
  }
  // Stretch target ≤500ms added p95 — report separately so provider cold-start can be Phase 2.
  gates.push(
    gate(
      "related added P95 ≤ 500ms (stretch; provider cold-start may dominate models)",
      addWeb <= RELATED_ADDED_P95_MS &&
        addMc <= RELATED_ADDED_P95_MS &&
        (addModels == null || addModels <= RELATED_ADDED_P95_MS),
      `addedP95 web=${fmt(addWeb)} models-config=${fmt(addMc)} models=${addModels == null ? "n/a" : fmt(addModels)}`,
    ),
  );
}

console.log("\n=== gates ===");
let failed = 0;
let stretchFailed = 0;
for (const g of gates) {
  const stretch = g.name.includes("stretch");
  if (!g.ok) {
    if (stretch) stretchFailed += 1;
    else failed += 1;
  }
  console.log(`  ${g.ok ? "PASS" : stretch ? "WARN" : "FAIL"}  ${g.name}  (${g.detail})`);
}

const report = {
  schemaVersion: 1,
  kind: "ypi-project-space-session-bench",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  samples: SAMPLES,
  warmup: WARMUP,
  fixture: {
    totalSessions: primary.totalSessions,
    totalChildren: primary.totalChildren,
    targetRootCount: primary.targetRootCount,
    targetChildCount: primary.targetChildCount,
    targetUniqueTasks: primary.targetUniqueTasks,
  },
  cold: { ...coldStats, counters: cold.countersAgg },
  warm: { ...warmStats, counters: warm.countersAgg },
  candidateSizes: sizeStats,
  singleFlight: flight,
  related,
  gates: gates.map((g) => ({
    name: g.name,
    ok: g.ok,
    detail: g.detail,
    stretch: g.name.includes("stretch"),
  })),
  roundMs: {
    warmP50: round(warmStats.p50),
    warmP95: round(warmStats.p95),
    coldP50: round(coldStats.p50),
    coldP95: round(coldStats.p95),
  },
};

if (JSON_OUT) {
  writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nwrote JSON report: ${JSON_OUT}`);
}

// Cleanup temp agent dir + space roots best-effort.
try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // ignore
}
for (const root of [primary.targetRoot]) {
  try {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

if (failed > 0) {
  console.error(`\n${failed} hard gate(s) failed; ${stretchFailed} stretch warning(s)`);
  process.exit(1);
}
if (stretchFailed > 0) {
  console.log(
    `\nAll hard gates passed; ${stretchFailed} stretch warning(s) — capture evidence for Phase 2 if models cold-start dominates.`,
  );
  process.exit(0);
}
console.log("\nAll gates passed.");
process.exit(0);
