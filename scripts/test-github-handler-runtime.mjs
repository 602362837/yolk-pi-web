#!/usr/bin/env node
/**
 * GHR-03 focused tests: handler readiness at action/tick entries.
 *
 * Covers:
 * - cold Settings-style retry without webhook registers full triage handler
 * - concurrent ensure is single-flight / idempotent
 * - load/register/verify fault → handler_not_ready, no lease/attempt, no runner_no_progress
 * - direct tick cannot process production planning jobs via default handler
 * - privacy sentinels on safe events / projections
 *
 * Always uses temporary PI_CODING_AGENT_DIR. No live GitHub / no real secrets.
 *
 * Run:
 *   npm run test:github-handler-runtime
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

const agentDir = mkdtempSync(join(tmpdir(), "pi-ghr03-handler-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const APP_KEY_SENTINEL = "GHR03_APP_PRIVATE_KEY_SENTINEL_do_not_leak";
const WEBHOOK_SECRET_SENTINEL = "ghr03_webhook_secret_SENTINEL_aa11bb22";
const INSTALL_TOKEN_SENTINEL = "ghs_GHR03_INSTALL_TOKEN_SENTINEL_91ab";
const MACHINE_TOKEN_SENTINEL = "gho_GHR03_MACHINE_TOKEN_SENTINEL_ab2d";
const PATH_SENTINEL = "/Volumes/secret/worktrees/ypi-gha-issue-22-g1";
const MODULE_SENTINEL = "@secret-scope/missing-module-xyz";

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((err) => {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(err);
    });
}

function assertNoSentinel(value, label) {
  if (value === null || value === undefined) return;
  let serialized;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  for (const needle of [
    APP_KEY_SENTINEL,
    WEBHOOK_SECRET_SENTINEL,
    INSTALL_TOKEN_SENTINEL,
    MACHINE_TOKEN_SENTINEL,
    "BEGIN RSA PRIVATE KEY",
    "BEGIN PRIVATE KEY",
    PATH_SENTINEL,
    MODULE_SENTINEL,
    "/Users/",
    "/Volumes/",
    "Cannot find module",
    "at Object.",
    "node_modules/",
  ]) {
    assert.ok(!serialized.includes(needle), `${label}: leaked ${needle}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJob(store, jobId, predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let job = await store.readGithubAutomationJob(jobId);
  while (Date.now() < deadline) {
    if (job && predicate(job)) return job;
    await sleep(20);
    job = await store.readGithubAutomationJob(jobId);
  }
  return job;
}

function readAllSafeEvents() {
  const eventsDir = join(agentDir, "github-automation", "events");
  if (!existsSync(eventsDir)) return [];
  const out = [];
  for (const name of readdirSync(eventsDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const text = readFileSync(join(eventsDir, name), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // ignore malformed
      }
    }
  }
  return out;
}

const store = jiti(join(root, "lib/github-automation-store.ts"));
const configMod = jiti(join(root, "lib/github-automation-config.ts"));
const scheduler = jiti(join(root, "lib/github-automation-scheduler.ts"));
const projection = jiti(join(root, "lib/github-automation-projection.ts"));
const runtime = jiti(join(root, "lib/github-automation-runtime.ts"));
const handlerRuntime = jiti(
  join(root, "lib/github-automation-handler-runtime.ts"),
);
const runner = jiti(join(root, "lib/github-automation-runner.ts"));

function makeUnattendedConfig() {
  const base = configMod.createDefaultGithubAutomationConfig();
  return {
    ...base,
    enabled: true,
    mode: "unattended",
    paused: false,
    unattended: {
      ...base.unattended,
      enabled: true,
      executionProfile: "full-agent",
      riskProfile: "docs-and-small-bugfix",
      maxConcurrency: 1,
      maxFiles: 12,
      maxChangedLines: 500,
      validationCommands: ["true"],
    },
    repositories: [
      {
        repositoryId: 602362837,
        fullName: "602362837/yolk-pi-web",
        installationId: 4242,
        projectId: null,
        projectRoot: agentDir,
        ownerActorIds: [99],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
  };
}

async function resetRuntimeIsolation({ productionReady = true } = {}) {
  runner._testResetGithubUnattendedInFlight?.();
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();
  projection._testResetGithubAutomationActionRateLimit?.();
  // productionReady=true: allow ensure to load full triage handler
  runtime._testSetGithubIssueTriageAutoRegisterDisabled(!productionReady);
  if (productionReady) {
    scheduler._testSetGithubAutomationProductionHandlerReadinessDisabled(false);
    handlerRuntime._testSetGithubAutomationHandlerAutoRegisterDisabled(false);
  }
  await store.ensureGithubAutomationStoreLayout();
  await configMod.writeGithubAutomationConfig(makeUnattendedConfig());
}

async function seedPlanningJob(issueNumber, attempt = 900) {
  let job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber,
    installationId: 4242,
    deliveryId: null,
    issueTitlePreview: "docs: ghr03 cold retry",
    generation: 1,
    phase: "planning",
  });
  job = await store.writeGithubAutomationJob({
    ...job,
    status: "paused",
    phase: "paused",
    checkpoint: "studio_task_ready",
    reasonCode: "paused",
    attempt,
    progressRevision: 0,
    agentRunCount: 0,
    noProgressRunCount: 2,
    meaningfulProgressCount: 0,
    blockedAtLayer: null,
    retryability: null,
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    effects: store.upsertEffectMarker([], {
      name: "owner_command",
      status: "remote_confirmed",
      remoteId: `cmd-ghr03-${issueNumber}`,
      generation: 1,
      reasonCode: "owner_authorized_unattended",
    }),
  });
  runner.writeGithubAutomationRunnerState({
    schemaVersion: 1,
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    generation: 1,
    checkpoint: "studio_task_ready",
    worktreePath: PATH_SENTINEL,
    branchName: `ypi/gha/602362837/issue-${issueNumber}/g1`,
    baseRef: "main",
    projectId: "prj_ghr03",
    spaceId: "wt_ghr03",
    taskId: `task-ghr03-${issueNumber}`,
    sessionId: null,
    contextId: null,
    sessionFile: null,
    scopeFingerprint: "scope-fp",
    ownerActorId: 99,
    ownerCommentId: 7,
    ownerCommentHash: "h".repeat(64),
    lastMember: null,
    lastRunId: null,
    pauseRequested: true,
    updatedAt: new Date().toISOString(),
    reasonCode: "paused",
  });
  return job;
}

// ─── Cold retry / readiness ──────────────────────────────────────────────────

await test("GHR-03 cold Settings retry without webhook registers full triage handler", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  // Explicit empty registry — no webhook, no prior register.
  assert.equal(
    scheduler.getGithubAutomationJobHandlerRegistration().kind,
    "none",
  );

  const job = await seedPlanningJob(3301, 900);
  const beforeAttempt = job.attempt;

  const action = await projection.applyGithubAutomationJobAction({
    jobId: job.jobId,
    action: "retry",
    config: makeUnattendedConfig(),
    wakeScheduler: false,
  });
  assert.equal(action.ok, true);
  assert.equal(action.code, "accepted");

  const reg = scheduler.getGithubAutomationJobHandlerRegistration();
  assert.equal(reg.kind, "github_issue_triage");
  assert.ok(reg.generation >= 1);
  assert.equal(handlerRuntime.isGithubAutomationJobHandlerReady(), true);

  const after = await store.readGithubAutomationJob(job.jobId);
  assert.equal(after.generation, 1);
  assert.equal(after.attempt, beforeAttempt);
  assert.ok(
    after.status === "queued" || after.reasonCode === "retry_wake",
    `expected queued/retry_wake, got status=${after.status} reason=${after.reasonCode}`,
  );
  assert.notEqual(after.reasonCode, "runner_no_progress");
  assert.notEqual(after.reasonCode, "handler_not_ready");
  assertNoSentinel(action.job, "retry action projection");
});

await test("GHR-03 concurrent ensure is single-flight and registry-verified", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();

  const results = await Promise.all([
    handlerRuntime.ensureGithubAutomationJobHandlerReady(),
    handlerRuntime.ensureGithubAutomationJobHandlerReady(),
    handlerRuntime.ensureGithubAutomationJobHandlerReady(),
  ]);
  for (const r of results) {
    assert.equal(r.kind, "ready");
    assert.equal(r.handlerKind, "github_issue_triage");
  }
  const reg = scheduler.getGithubAutomationJobHandlerRegistration();
  assert.equal(reg.kind, "github_issue_triage");
  // All ready results share the same generation from the live registry.
  assert.ok(results.every((r) => r.generation === reg.generation));
});

// ─── Handler not ready ───────────────────────────────────────────────────────

await test("GHR-03 load fault → handler_not_ready without lease/attempt/no-progress", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();
  handlerRuntime._testSetGithubAutomationHandlerForceStageFailure("load");

  const job = await seedPlanningJob(3302, 900);
  const beforeAttempt = job.attempt;

  const action = await projection.applyGithubAutomationJobAction({
    jobId: job.jobId,
    action: "retry",
    config: makeUnattendedConfig(),
    wakeScheduler: false,
  });
  assert.equal(action.ok, true);
  assert.equal(action.partial, true);
  assert.match(String(action.message || ""), /handler runtime is not ready/i);

  const after = await store.readGithubAutomationJob(job.jobId);
  assert.equal(after.reasonCode, "handler_not_ready");
  assert.equal(after.blockedAtLayer, "scheduler");
  assert.equal(after.attempt, beforeAttempt);
  assert.equal(after.generation, 1);
  assert.notEqual(after.reasonCode, "runner_no_progress");

  const safe = projection.toGithubAutomationJobSafeProjection(after, {
    claimStatus: "complete",
    automationEnabled: true,
    mode: "unattended",
    globalPaused: false,
  });
  assert.equal(safe.reasonCode, "handler_not_ready");
  assert.equal(safe.blockedAtLayer, "scheduler");
  assert.ok(
    safe.sessionAvailability === "none" ||
      safe.sessionAvailability === "missing" ||
      safe.sessionAvailability == null ||
      safe.sessionAvailability === "not_started",
  );
  assertNoSentinel(safe, "handler_not_ready projection");

  const events = readAllSafeEvents().filter(
    (e) => e.jobId === job.jobId && e.kind === "github_automation_handler_not_ready",
  );
  assert.ok(events.length >= 1, "expected handler_not_ready safe event");
  for (const ev of events) {
    assert.equal(ev.reasonCode, "handler_not_ready");
    assert.ok(ev.meta?.stage === "load" || typeof ev.meta?.stage === "string");
    assertNoSentinel(ev, "handler_not_ready event");
  }

  // Direct tick must also refuse lease while not ready.
  const tick = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick.started, 0);
  const afterTick = await store.readGithubAutomationJob(job.jobId);
  assert.equal(afterTick.attempt, beforeAttempt);
  assert.equal(afterTick.reasonCode, "handler_not_ready");
  assert.notEqual(afterTick.reasonCode, "runner_no_progress");

  handlerRuntime._testSetGithubAutomationHandlerForceStageFailure(null);
});

await test("GHR-03 register/verify faults surface handler_not_ready and recover after clear", async () => {
  await resetRuntimeIsolation({ productionReady: true });

  for (const stage of ["register", "verify"]) {
    scheduler._testResetGithubAutomationHandlerRegistry?.();
    handlerRuntime._testResetGithubAutomationHandlerRuntime();
    handlerRuntime._testSetGithubAutomationHandlerForceStageFailure(stage);

    const state = await handlerRuntime.ensureGithubAutomationJobHandlerReady();
    assert.equal(state.kind, "not_ready");
    assert.equal(state.reasonCode, "handler_not_ready");
    assert.equal(state.stage, stage);
    assert.ok(state.diagnosticCode);
    assertNoSentinel(state, `not_ready ${stage}`);

    // Clear fault and failure backoff so next ensure can succeed.
    handlerRuntime._testSetGithubAutomationHandlerForceStageFailure(null);
    handlerRuntime._testResetGithubAutomationHandlerRuntime();
    const recovered = await handlerRuntime.ensureGithubAutomationJobHandlerReady();
    assert.equal(recovered.kind, "ready");
    assert.equal(
      scheduler.getGithubAutomationJobHandlerRegistration().kind,
      "github_issue_triage",
    );
  }
});

await test("GHR-03 direct tick with empty registry does not lease planning job as default", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  // Force auto-register off so ensure fails; production readiness gate stays on.
  handlerRuntime._testResetGithubAutomationHandlerRuntime();
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testSetGithubAutomationHandlerAutoRegisterDisabled(true);
  scheduler._testSetGithubAutomationProductionHandlerReadinessDisabled(false);

  let job = await seedPlanningJob(3303, 42);
  // Make runnable without going through action ensure.
  job = await store.writeGithubAutomationJob({
    ...job,
    status: "queued",
    phase: "planning",
    checkpoint: "studio_task_ready",
    reasonCode: "retry_wake",
    pauseRequested: false,
  });
  const beforeAttempt = job.attempt;

  const tick = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick.started, 0);

  const after = await waitForJob(
    store,
    job.jobId,
    (j) => j.reasonCode === "handler_not_ready" || j.attempt !== beforeAttempt,
    2_000,
  );
  assert.equal(after.attempt, beforeAttempt, "no business lease without readiness");
  assert.notEqual(after.reasonCode, "runner_no_progress");
  // surfaceHandlerNotReadyWithoutLease may park reason on the job.
  assert.ok(
    after.reasonCode === "handler_not_ready" ||
      after.reasonCode === "retry_wake" ||
      after.status === "queued",
    `unexpected after tick: ${after.status}/${after.reasonCode}`,
  );
});

await test("GHR-06 async webpack-like module settles thenable exports before ready", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();

  const realHandler = async (job) => ({
    job: {
      ...job,
      reasonCode: "async_module_loader_ok",
    },
    wakeAgain: false,
  });

  // Simulate Next async-module shape: loader returns a thenable namespace whose
  // named exports are NOT functions until the thenable settles (webpack c.a).
  // Use a sync loader so Promise resolution does not pre-flatten before our
  // awaitIfThenable path (matches require() of an async webpack module).
  handlerRuntime._testSetGithubAutomationHandlerModuleLoader(() => {
    const pending = Promise.resolve().then(() => ({
      githubIssueTriageJobHandler: realHandler,
      registerGithubIssueTriageHandler: () => {
        scheduler.setGithubAutomationJobHandler(realHandler, {
          kind: "github_issue_triage",
        });
      },
    }));
    // Pre-settlement namespace: thenable, exports not yet functions.
    return {
      then: (resolve, reject) => pending.then(resolve, reject),
      githubIssueTriageJobHandler: undefined,
      registerGithubIssueTriageHandler: undefined,
    };
  });

  const state = await handlerRuntime.ensureGithubAutomationJobHandlerReady();
  assert.equal(state.kind, "ready", `expected ready, got ${JSON.stringify(state)}`);
  assert.equal(state.handlerKind, "github_issue_triage");
  assert.equal(
    scheduler.getGithubAutomationJobHandlerRegistration().kind,
    "github_issue_triage",
  );
  assert.equal(handlerRuntime.isGithubAutomationJobHandlerReady(), true);

  handlerRuntime._testSetGithubAutomationHandlerModuleLoader(null);
});

await test("GHR-06 register-only export path registers via live registry", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();

  const realHandler = async (job) => ({
    job: { ...job, reasonCode: "register_only_ok" },
    wakeAgain: false,
  });

  // No direct handler export — only registerGithubIssueTriageHandler is a function.
  // This is the robust production fallback when async factories expose register
  // more reliably than the handler export itself.
  handlerRuntime._testSetGithubAutomationHandlerModuleLoader(async () => ({
    // deliberately omit githubIssueTriageJobHandler
    registerGithubIssueTriageHandler: () => {
      scheduler.setGithubAutomationJobHandler(realHandler, {
        kind: "github_issue_triage",
      });
    },
  }));

  const state = await handlerRuntime.ensureGithubAutomationJobHandlerReady();
  assert.equal(state.kind, "ready", `expected ready, got ${JSON.stringify(state)}`);
  assert.equal(
    scheduler.getGithubAutomationJobHandlerRegistration().kind,
    "github_issue_triage",
  );
  const live = scheduler.getGithubAutomationJobHandler();
  assert.equal(typeof live, "function");
  const sample = await live(
    {
      jobId: "job_register_only",
      attempt: 1,
      generation: 1,
      phase: "planning",
      status: "queued",
      reasonCode: null,
    },
    { config: makeUnattendedConfig(), ownerId: "t", lease: null },
  );
  assert.equal(sample.job.reasonCode, "register_only_ok");

  handlerRuntime._testSetGithubAutomationHandlerModuleLoader(null);
});

await test("GHR-06 pre-await incomplete namespace fails as export_missing not no-progress", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();

  // Reproduces the original production FAIL shape: module loads without throw,
  // but exports are never functions (async factory not settled / incomplete).
  handlerRuntime._testSetGithubAutomationHandlerModuleLoader(async () => ({
    githubIssueTriageJobHandler: undefined,
    registerGithubIssueTriageHandler: undefined,
  }));

  const state = await handlerRuntime.ensureGithubAutomationJobHandlerReady();
  assert.equal(state.kind, "not_ready");
  assert.equal(state.reasonCode, "handler_not_ready");
  assert.equal(state.stage, "load");
  assert.equal(state.diagnosticCode, "handler_module_export_missing");
  assert.notEqual(state.reasonCode, "runner_no_progress");
  assertNoSentinel(state, "async incomplete not_ready");

  handlerRuntime._testSetGithubAutomationHandlerModuleLoader(null);
});

await test("GHR-03 default handler defensive path returns handler_not_ready for non-received", async () => {
  await resetRuntimeIsolation({ productionReady: true });
  // Force the live registry onto the default handler while production readiness
  // remains enabled — this is the defensive fallback path for a mis-registered
  // production process (must not return planning jobs unchanged).
  scheduler.setGithubAutomationJobHandler(null);
  assert.equal(
    scheduler.getGithubAutomationJobHandlerRegistration().kind,
    "default",
  );
  assert.equal(
    scheduler.isGithubAutomationProductionHandlerReadinessDisabled(),
    false,
  );

  let job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 3304,
    installationId: 4242,
    deliveryId: null,
    issueTitlePreview: "docs: default defensive",
    generation: 1,
    phase: "planning",
  });
  job = await store.writeGithubAutomationJob({
    ...job,
    status: "queued",
    phase: "planning",
    checkpoint: "studio_task_ready",
    reasonCode: "retry_wake",
    attempt: 5,
  });

  const handler = scheduler.getGithubAutomationJobHandler();
  const result = await handler(job, {
    config: makeUnattendedConfig(),
    ownerId: "test-owner",
    lease: {
      fencingToken: "fence-test",
      ownerId: "test-owner",
      heartbeat: async () => true,
    },
  });
  assert.equal(result.disposition?.kind, "retry_due");
  assert.equal(result.job.reasonCode, "handler_not_ready");
  assert.notEqual(result.job.reasonCode, "runner_no_progress");
  // attempt not mutated by default handler itself
  assert.equal(result.job.attempt, 5);
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

runner._testResetGithubUnattendedInFlight?.();
handlerRuntime._testResetGithubAutomationHandlerRuntime?.();
scheduler._testResetGithubAutomationScheduler?.();

console.log("");
console.log(`passed=${passed} failed=${failed}`);

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // ignore
}

if (failed > 0) process.exitCode = 1;
