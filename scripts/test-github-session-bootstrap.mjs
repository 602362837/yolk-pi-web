#!/usr/bin/env node
/**
 * GHR-03 focused tests: Session bootstrap fault-injection + #22-shaped control flow.
 *
 * Covers:
 * - binding / module-missing / transient / hard bootstrap failures through the
 *   actual runGithubUnattendedImplementation catch + explicit disposition
 * - scheduler applyDisposition does not fold known bootstrap reasons into
 *   runner_no_progress
 * - success path: unattended_session_created, runner session refs, independent
 *   counters (attempt remains lease-only)
 * - #22-shaped g1 fixture (attempt=900, studio_task_ready, remote_confirmed,
 *   no session) reaches typed outcome without empty-run spin
 * - privacy sentinels: no path / module specifier / stack / credentials
 *
 * Always uses temporary PI_CODING_AGENT_DIR. No live GitHub / no real secrets.
 *
 * Run:
 *   npm run test:github-session-bootstrap
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

const agentDir = mkdtempSync(join(tmpdir(), "pi-ghr03-bootstrap-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const APP_KEY_SENTINEL = "GHR03B_APP_PRIVATE_KEY_SENTINEL_do_not_leak";
const WEBHOOK_SECRET_SENTINEL = "ghr03b_webhook_secret_SENTINEL_aa11bb22";
const INSTALL_TOKEN_SENTINEL = "ghs_GHR03B_INSTALL_TOKEN_SENTINEL_91ab";
const MACHINE_TOKEN_SENTINEL = "gho_GHR03B_MACHINE_TOKEN_SENTINEL_ab2d";
const PATH_SENTINEL = "/Volumes/secret/worktrees/ypi-gha-issue-22-g1";
const MODULE_SENTINEL = "@secret-scope/missing-module-xyz";
const STACK_SENTINEL = "at Object.<anonymous> (/Volumes/secret/boot.js:1:1)";

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
    STACK_SENTINEL,
    "/Users/",
    "/Volumes/",
    "Cannot find module",
    "node_modules/",
  ]) {
    assert.ok(!serialized.includes(needle), `${label}: leaked ${needle}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function gitInit(repoPath) {
  mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "ghr03@example.com"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "ghr03"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  writeFileSync(join(repoPath, "README.md"), "# ghr03 fixture\n");
  writeFileSync(join(repoPath, "docs-guide.md"), "guide\n");
  execFileSync("git", ["add", "README.md", "docs-guide.md"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath, stdio: "ignore" });
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
        // ignore
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
const session = jiti(join(root, "lib/github-automation-session.ts"));
const registry = jiti(join(root, "lib/project-registry.ts"));
const bootstrapErrors = jiti(
  join(root, "lib/agent-session-bootstrap-errors.ts"),
);
const worktree = jiti(join(root, "lib/github-automation-worktree.ts"));

function unattendedConfig(repoPath, overrides = {}) {
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
        projectRoot: repoPath,
        ownerActorIds: [99],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
    ...overrides,
  };
}

async function registerFixtureRepo(label) {
  const repoPath = mkdtempSync(join(tmpdir(), `ghr03-${label}-`));
  gitInit(repoPath);
  await registry.registerProject({
    path: repoPath,
    displayName: `ghr03-${label}`,
  });
  return repoPath;
}

async function markClaimComplete(job) {
  await store.upsertGithubAutomationIssueState({
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    activeJobId: job.jobId,
    generation: job.generation,
    claimStatus: "complete",
  });
}

function clearOverrides() {
  session._testSetGithubAutomationBootstrapOverride?.(null);
  session._testSetGithubFullAgentMemberOverride?.(null);
}

async function resetIsolation() {
  clearOverrides();
  runner._testResetGithubUnattendedInFlight?.();
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();
  runtime._testSetGithubIssueTriageAutoRegisterDisabled(false);
  scheduler._testSetGithubAutomationProductionHandlerReadinessDisabled(false);
  handlerRuntime._testSetGithubAutomationHandlerAutoRegisterDisabled(false);
  projection._testResetGithubAutomationActionRateLimit?.();
  await store.ensureGithubAutomationStoreLayout();
}

/**
 * Seed a job that is already past plan/task gates and ready for Session bootstrap.
 * Uses real WorkTree + Studio task so runGithubUnattendedImplementation enters
 * the bootstrap branch (not fixture-only projection).
 */
async function seedImplementingBootstrapReady(options = {}) {
  const {
    issueNumber = 4401,
    title = "docs: bootstrap fault injection",
    attempt = 3,
  } = options;
  const repoPath = await registerFixtureRepo(`boot-${issueNumber}`);
  const cfg = unattendedConfig(repoPath);
  await configMod.writeGithubAutomationConfig(cfg);

  let job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber,
    installationId: 4242,
    deliveryId: null,
    issueTitlePreview: title,
    generation: 1,
    phase: "implementing",
  });
  await markClaimComplete(job);

  const wt = await worktree.ensureGithubAutomationWorktree({
    repository: cfg.repositories[0],
    issueNumber,
    generation: 1,
  });
  assert.ok(wt.worktreePath);
  assert.ok(wt.projectId);
  assert.ok(wt.spaceId);

  const ensured = session.ensureGithubUnattendedStudioTask({
    worktreePath: wt.worktreePath,
    repository: cfg.repositories[0],
    issueNumber,
    issueTitlePreview: title,
    jobId: job.jobId,
    generation: 1,
    owner: {
      ownerActorId: 99,
      ownerCommentId: 7,
      ownerCommentHash: session.hashGithubOwnerCommentForAuthorization("可以做"),
      matchedPhrase: "可以做",
    },
    uiGate: "pass",
  });
  assert.equal(ensured.authorized, true);

  // Force implementing so plan/transition is skipped and bootstrap runs.
  session.transitionGithubUnattendedTaskToImplementing({
    worktreePath: wt.worktreePath,
    taskId: ensured.task.id,
    issueNumber,
    repositoryId: job.repositoryId,
    policyHash: session.buildGithubUnattendedPolicyHash({
      maxFiles: cfg.unattended.maxFiles,
      maxChangedLines: cfg.unattended.maxChangedLines,
    }),
  });

  runner.writeGithubAutomationRunnerState({
    schemaVersion: 1,
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    generation: 1,
    checkpoint: "implementing",
    worktreePath: wt.worktreePath,
    branchName: wt.branchName,
    baseRef: wt.baseRef || "main",
    projectId: wt.projectId,
    spaceId: wt.spaceId,
    taskId: ensured.task.id,
    sessionId: null,
    contextId: null,
    sessionFile: null,
    scopeFingerprint: ensured.binding.scopeFingerprint,
    ownerActorId: 99,
    ownerCommentId: 7,
    ownerCommentHash: session.hashGithubOwnerCommentForAuthorization("可以做"),
    lastMember: null,
    lastRunId: null,
    pauseRequested: false,
    updatedAt: new Date().toISOString(),
    reasonCode: null,
  });

  job = await store.writeGithubAutomationJob({
    ...job,
    status: "queued",
    phase: "implementing",
    checkpoint: "implementing",
    reasonCode: "retry_wake",
    attempt,
    progressRevision: 1,
    agentRunCount: 0,
    noProgressRunCount: 0,
    meaningfulProgressCount: 0,
    blockedAtLayer: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  });

  return { job, cfg, wt, taskId: ensured.task.id, repoPath };
}

// ─── Binding hard fail (real path, no override) ──────────────────────────────

await test("GHR-03 binding missing → session_bootstrap_failed + blocked disposition", async () => {
  await resetIsolation();
  const { job, cfg, wt, taskId } = await seedImplementingBootstrapReady({
    issueNumber: 4401,
  });

  // Clear both binding ids so the runner hits the pre-bootstrap binding gate
  // (projectId+spaceId must be paired). Leaving projectId alone can still
  // allow best-effort space repair and fall into real runtime bootstrap.
  runner.writeGithubAutomationRunnerState({
    ...runner.readGithubAutomationRunnerState(job.jobId),
    projectId: null,
    spaceId: null,
    worktreePath: wt.worktreePath,
    taskId,
  });

  const result = await runner.runGithubUnattendedImplementation({
    job,
    config: cfg,
    claimComplete: true,
  });

  assert.equal(result.job.reasonCode, "session_bootstrap_failed");
  assert.equal(result.job.blockedAtLayer, "session_bootstrap");
  assert.equal(result.job.status, "blocked");
  assert.equal(result.disposition?.kind, "blocked");
  assert.equal(result.disposition?.reasonCode, "session_bootstrap_failed");
  assert.notEqual(result.job.reasonCode, "runner_no_progress");
  assert.equal(result.job.generation, 1);
  assert.equal(result.job.attempt, job.attempt);

  const state = runner.readGithubAutomationRunnerState(job.jobId);
  assert.equal(state?.sessionId, null);
  assert.equal(state?.generation, 1);
  assert.ok(state?.taskId);

  const events = readAllSafeEvents().filter(
    (e) =>
      e.jobId === job.jobId && e.kind === "unattended_session_bootstrap_failed",
  );
  assert.ok(events.length >= 1);
  for (const ev of events) {
    assert.equal(ev.meta?.bootstrapCode, "session_binding_invalid");
    assert.equal(ev.meta?.stage, "binding");
    assert.equal(ev.meta?.retryable, false);
    assert.ok(typeof ev.meta?.message === "string");
    assertNoSentinel(ev, "binding bootstrap event");
  }
  assertNoSentinel(result.job, "binding bootstrap job");
});

// ─── MODULE_NOT_FOUND via override (actual catch) ────────────────────────────

await test("GHR-03 MODULE_NOT_FOUND → session_runtime_module_missing without specifier leak", async () => {
  await resetIsolation();
  const { job, cfg } = await seedImplementingBootstrapReady({
    issueNumber: 4402,
    title: "docs: module missing",
  });

  session._testSetGithubAutomationBootstrapOverride(async () => {
    const err = Object.assign(
      new Error(`Cannot find module '${MODULE_SENTINEL}'\n${STACK_SENTINEL}`),
      { code: "MODULE_NOT_FOUND" },
    );
    throw err;
  });

  const result = await runner.runGithubUnattendedImplementation({
    job,
    config: cfg,
    claimComplete: true,
  });

  assert.equal(result.job.reasonCode, "session_bootstrap_failed");
  assert.equal(result.job.blockedAtLayer, "session_bootstrap");
  assert.equal(result.job.status, "blocked");
  assert.equal(result.disposition?.kind, "blocked");
  assert.notEqual(result.job.reasonCode, "runner_no_progress");

  const events = readAllSafeEvents().filter(
    (e) =>
      e.jobId === job.jobId && e.kind === "unattended_session_bootstrap_failed",
  );
  assert.ok(events.length >= 1);
  const meta = events[events.length - 1].meta || {};
  assert.equal(meta.bootstrapCode, "session_runtime_module_missing");
  assert.equal(meta.stage, "runtime_load");
  assert.equal(meta.retryable, false);
  assert.ok(typeof meta.message === "string");
  assert.ok(!String(meta.message).includes(MODULE_SENTINEL));
  assert.ok(!String(meta.message).includes("Cannot find module"));
  assertNoSentinel(events[events.length - 1], "module-missing event");
  assertNoSentinel(result.job, "module-missing job");

  // Same-generation / WT retained
  const state = runner.readGithubAutomationRunnerState(job.jobId);
  assert.equal(state?.sessionId, null);
  assert.equal(state?.generation, 1);
  assert.ok(state?.worktreePath);
  assert.ok(state?.taskId);
});

// ─── Transient EBUSY ─────────────────────────────────────────────────────────

await test("GHR-03 transient EBUSY → session_bootstrap_transient + retry_due disposition", async () => {
  await resetIsolation();
  const { job, cfg } = await seedImplementingBootstrapReady({
    issueNumber: 4403,
    title: "docs: transient busy",
  });

  session._testSetGithubAutomationBootstrapOverride(async () => {
    throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
  });

  const result = await runner.runGithubUnattendedImplementation({
    job,
    config: cfg,
    claimComplete: true,
  });

  assert.equal(result.job.reasonCode, "session_bootstrap_transient");
  assert.equal(result.job.blockedAtLayer, "session_bootstrap");
  assert.equal(result.job.status, "retry_due");
  assert.equal(result.disposition?.kind, "retry_due");
  assert.equal(result.disposition?.reasonCode, "session_bootstrap_transient");
  assert.ok(result.job.nextRetryAt);
  assert.notEqual(result.job.reasonCode, "runner_no_progress");
  assert.equal(result.job.generation, 1);
  assert.equal(result.job.attempt, job.attempt);

  const events = readAllSafeEvents().filter(
    (e) =>
      e.jobId === job.jobId && e.kind === "unattended_session_bootstrap_failed",
  );
  assert.ok(events.length >= 1);
  const meta = events[events.length - 1].meta || {};
  assert.equal(meta.bootstrapCode, "session_runtime_start_failed");
  assert.equal(meta.stage, "runtime_start");
  assert.equal(meta.retryable, true);
  assertNoSentinel(events[events.length - 1], "transient event");
});

// ─── Unknown hard error ──────────────────────────────────────────────────────

await test("GHR-03 unknown hard bootstrap → session_bootstrap_failed + blocked", async () => {
  await resetIsolation();
  const { job, cfg } = await seedImplementingBootstrapReady({
    issueNumber: 4404,
    title: "docs: unknown hard",
  });

  session._testSetGithubAutomationBootstrapOverride(async () => {
    throw new Error(`Internal explosion at ${PATH_SENTINEL}\n${STACK_SENTINEL}`);
  });

  const result = await runner.runGithubUnattendedImplementation({
    job,
    config: cfg,
    claimComplete: true,
  });

  assert.equal(result.job.reasonCode, "session_bootstrap_failed");
  assert.equal(result.job.status, "blocked");
  assert.equal(result.disposition?.kind, "blocked");
  assert.notEqual(result.job.reasonCode, "runner_no_progress");

  const events = readAllSafeEvents().filter(
    (e) =>
      e.jobId === job.jobId && e.kind === "unattended_session_bootstrap_failed",
  );
  assert.ok(events.length >= 1);
  const meta = events[events.length - 1].meta || {};
  assert.equal(meta.bootstrapCode, "session_unknown");
  assert.equal(meta.retryable, false);
  assertNoSentinel(events[events.length - 1], "unknown hard event");
  assertNoSentinel(result.job, "unknown hard job");
});

// ─── Disposition preservation through scheduler apply path ───────────────────

await test("GHR-03 scheduler apply preserves bootstrap reason (no runner_no_progress fold)", async () => {
  await resetIsolation();
  const { job, cfg } = await seedImplementingBootstrapReady({
    issueNumber: 4405,
    title: "docs: disposition preserve",
    attempt: 11,
  });

  session._testSetGithubAutomationBootstrapOverride(async () => {
    throw Object.assign(new Error("Cannot find module 'x'"), {
      code: "MODULE_NOT_FOUND",
    });
  });

  // Register a thin custom handler that calls the real unattended continue path
  // so applyHandlerDisposition runs on the returned disposition.
  scheduler.setGithubAutomationJobHandler(async (running) => {
    return runner.runGithubUnattendedImplementation({
      job: running,
      config: cfg,
      claimComplete: true,
    });
  });

  await store.writeGithubAutomationJob({
    ...job,
    status: "queued",
    phase: "implementing",
    checkpoint: "implementing",
    reasonCode: "retry_wake",
  });

  const beforeAttempt = job.attempt;
  const tick = await scheduler.tickGithubAutomationScheduler();
  assert.ok(tick.started >= 1);

  const deadline = Date.now() + 4_000;
  let after = await store.readGithubAutomationJob(job.jobId);
  while (Date.now() < deadline) {
    if (
      after &&
      (after.reasonCode === "session_bootstrap_failed" ||
        after.reasonCode === "session_bootstrap_transient" ||
        after.status === "blocked" ||
        after.status === "retry_due")
    ) {
      break;
    }
    await sleep(20);
    after = await store.readGithubAutomationJob(job.jobId);
  }

  assert.equal(after.reasonCode, "session_bootstrap_failed");
  assert.equal(after.blockedAtLayer, "session_bootstrap");
  assert.notEqual(after.reasonCode, "runner_no_progress");
  assert.equal(after.generation, 1);
  // One lease run increments attempt exactly once.
  assert.equal(after.attempt, beforeAttempt + 1);
  assertNoSentinel(after, "scheduler-applied bootstrap job");
});

// ─── Bootstrap success ───────────────────────────────────────────────────────

await test("GHR-03 bootstrap success emits session_created and advances independent counters", async () => {
  await resetIsolation();
  const { job, cfg, wt } = await seedImplementingBootstrapReady({
    issueNumber: 4406,
    title: "docs: session success",
    attempt: 7,
  });

  const fakeSessionId = "sess_ghr03_success_aabbccdd";
  session._testSetGithubAutomationBootstrapOverride(async (input) => {
    assert.equal(input.projectId, wt.projectId);
    assert.equal(input.spaceId, wt.spaceId);
    return {
      session: {
        sessionFile: join(PATH_SENTINEL, "sessions", `${fakeSessionId}.jsonl`),
        destroy() {},
        dispose() {},
      },
      sessionId: fakeSessionId,
      cwd: input.worktreePath,
      contextId: `pi_${fakeSessionId}`,
      sessionFile: join(PATH_SENTINEL, "sessions", `${fakeSessionId}.jsonl`),
    };
  });
  // Stop after Session: implementer must not hit real Studio child.
  session._testSetGithubFullAgentMemberOverride(async () => ({
    output: "noop implementer for GHR-03",
    status: "succeeded",
    warnings: [],
    childSessionId: "child_ghr03",
  }));

  const beforeAttempt = job.attempt;
  const result = await runner.runGithubUnattendedImplementation({
    job,
    config: cfg,
    claimComplete: true,
  });

  // Success may advance into implementer/checking; Session evidence is required.
  const state = runner.readGithubAutomationRunnerState(job.jobId);
  assert.equal(state?.sessionId, fakeSessionId);
  assert.equal(state?.contextId, `pi_${fakeSessionId}`);
  assert.ok(state?.sessionFile);
  assert.equal(state?.generation, 1);
  assert.equal(state?.projectId, wt.projectId);
  assert.equal(state?.spaceId, wt.spaceId);

  assert.ok((result.job.agentRunCount ?? 0) >= 1);
  assert.ok((result.job.meaningfulProgressCount ?? 0) >= 1);
  assert.ok((result.job.progressRevision ?? 0) >= 1);
  assert.equal(result.job.lastMeaningfulProgressKind, "session_created");
  // attempt is lease-only; direct runner call does not bump it.
  assert.equal(result.job.attempt, beforeAttempt);
  assert.equal(result.job.generation, 1);

  const created = readAllSafeEvents().filter(
    (e) => e.jobId === job.jobId && e.kind === "unattended_session_created",
  );
  assert.ok(created.length >= 1, "expected unattended_session_created");
  for (const ev of created) {
    assert.ok(ev.meta?.hasProjectId === true);
    assert.ok(ev.meta?.hasSpaceId === true);
    // Must not leak full sessionFile / absolute path.
    assert.ok(!JSON.stringify(ev).includes("sessionFile"));
    assertNoSentinel(ev, "session_created event");
  }

  const safe = projection.toGithubAutomationJobSafeProjection(result.job, {
    claimStatus: "complete",
    automationEnabled: true,
    mode: "unattended",
    globalPaused: false,
  });
  assertNoSentinel(safe, "success projection");
  // sessionFile must never appear on wire projection
  assert.ok(!JSON.stringify(safe).includes("sessionFile"));
  assert.ok(!JSON.stringify(safe).includes(PATH_SENTINEL));
});

// ─── #22-shaped fixture through real action/readiness path ───────────────────

await test("GHR-03 #22-shaped studio_task_ready cold retry reaches typed bootstrap outcome", async () => {
  await resetIsolation();
  const repoPath = await registerFixtureRepo("issue22-shape");
  const cfg = unattendedConfig(repoPath);
  await configMod.writeGithubAutomationConfig(cfg);

  // Real WorkTree + authorized task at studio_task_ready (no session).
  const issueNumber = 22;
  let job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber,
    installationId: 4242,
    deliveryId: "del-ghr03-22",
    issueTitlePreview: "docs: ghr03 #22-shaped recovery",
    generation: 1,
    phase: "planning",
  });
  await markClaimComplete(job);

  const wt = await worktree.ensureGithubAutomationWorktree({
    repository: cfg.repositories[0],
    issueNumber,
    generation: 1,
  });
  const ensured = session.ensureGithubUnattendedStudioTask({
    worktreePath: wt.worktreePath,
    repository: cfg.repositories[0],
    issueNumber,
    issueTitlePreview: "docs: ghr03 #22-shaped recovery",
    jobId: job.jobId,
    generation: 1,
    owner: {
      ownerActorId: 99,
      ownerCommentId: 4242,
      ownerCommentHash: session.hashGithubOwnerCommentForAuthorization("可以做"),
      matchedPhrase: "可以做",
    },
    uiGate: "pass",
  });

  const commandKey = "cmd-ghr03-22-adoption";
  job = await store.writeGithubAutomationJob({
    ...job,
    status: "paused",
    phase: "paused",
    checkpoint: "studio_task_ready",
    reasonCode: "paused",
    attempt: 900,
    progressRevision: 0,
    agentRunCount: 0,
    noProgressRunCount: 2,
    meaningfulProgressCount: 0,
    blockedAtLayer: null,
    retryability: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    effects: store.upsertEffectMarker([], {
      name: "owner_command",
      status: "remote_confirmed",
      remoteId: commandKey,
      generation: 1,
      reasonCode: "owner_authorized_unattended",
    }),
    pendingCommand: {
      deliveryId: "del-ghr03-22",
      commentId: 4242,
      versionHash: "deadbeef",
      commandKey,
      state: "pending",
      updatedAt: new Date().toISOString(),
    },
  });

  runner.writeGithubAutomationRunnerState({
    schemaVersion: 1,
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    generation: 1,
    checkpoint: "studio_task_ready",
    worktreePath: wt.worktreePath,
    branchName: wt.branchName,
    baseRef: wt.baseRef || "main",
    projectId: wt.projectId,
    spaceId: wt.spaceId,
    taskId: ensured.task.id,
    sessionId: null,
    contextId: null,
    sessionFile: null,
    scopeFingerprint: ensured.binding.scopeFingerprint,
    ownerActorId: 99,
    ownerCommentId: 4242,
    ownerCommentHash: session.hashGithubOwnerCommentForAuthorization("可以做"),
    lastMember: null,
    lastRunId: null,
    pauseRequested: true,
    updatedAt: new Date().toISOString(),
    reasonCode: "paused",
  });

  // Force a typed hard bootstrap failure so the control-flow test stays finite
  // without launching a real agent. Still exercises action→readiness→handler.
  session._testSetGithubAutomationBootstrapOverride(async () => {
    throw new bootstrapErrors.AgentSessionBootstrapError(
      `raw secret path ${PATH_SENTINEL} module ${MODULE_SENTINEL}`,
      500,
      {
        bootstrapCode: "session_runtime_module_missing",
        stage: "runtime_load",
        retryability: "operator",
      },
    );
  });

  // Cold registry: no webhook.
  scheduler._testResetGithubAutomationHandlerRegistry?.();
  handlerRuntime._testResetGithubAutomationHandlerRuntime();
  assert.equal(
    scheduler.getGithubAutomationJobHandlerRegistration().kind,
    "none",
  );

  const action = await projection.applyGithubAutomationJobAction({
    jobId: job.jobId,
    action: "retry",
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(action.ok, true);
  assert.equal(
    scheduler.getGithubAutomationJobHandlerRegistration().kind,
    "github_issue_triage",
  );

  const afterAction = await store.readGithubAutomationJob(job.jobId);
  assert.equal(afterAction.generation, 1);
  assert.equal(afterAction.attempt, 900, "retry must not reset attempt");
  assert.notEqual(afterAction.reasonCode, "runner_no_progress");

  // Drive real full handler via scheduler tick (not a custom no-op).
  // Handler is already registered as github_issue_triage by ensure.
  const tick = await scheduler.tickGithubAutomationScheduler();
  assert.ok(tick.started >= 1, "tick must lease the ready job with full handler");

  const deadline = Date.now() + 8_000;
  let finalJob = await store.readGithubAutomationJob(job.jobId);
  while (Date.now() < deadline) {
    if (
      finalJob &&
      (finalJob.reasonCode === "session_bootstrap_failed" ||
        finalJob.reasonCode === "session_bootstrap_transient" ||
        finalJob.sessionId ||
        finalJob.agentRunCount >= 1 ||
        (finalJob.status === "blocked" &&
          finalJob.blockedAtLayer === "session_bootstrap") ||
        finalJob.status === "blocked")
    ) {
      // Prefer bootstrap outcome; also accept policy blocks as typed (not no-progress).
      if (
        finalJob.reasonCode === "session_bootstrap_failed" ||
        finalJob.reasonCode === "session_bootstrap_transient" ||
        finalJob.reasonCode === "runner_no_progress" ||
        finalJob.status !== "running"
      ) {
        break;
      }
    }
    await sleep(30);
    finalJob = await store.readGithubAutomationJob(job.jobId);
  }

  assert.equal(finalJob.generation, 1);
  assert.ok(finalJob.attempt >= 900);
  assert.ok(
    finalJob.attempt <= 902,
    `attempt must not explode (got ${finalJob.attempt})`,
  );
  assert.notEqual(
    finalJob.reasonCode,
    "runner_no_progress",
    "known path must not collapse to no-progress",
  );
  // Prefer explicit bootstrap failure from our override; policy block is also typed.
  assert.ok(
    finalJob.reasonCode === "session_bootstrap_failed" ||
      finalJob.reasonCode === "session_bootstrap_transient" ||
      finalJob.blockedAtLayer === "session_bootstrap" ||
      finalJob.blockedAtLayer === "policy_plan" ||
      finalJob.blockedAtLayer === "policy_pre" ||
      finalJob.agentRunCount >= 1,
    `expected typed bootstrap/policy/session outcome, got ${finalJob.status}/${finalJob.reasonCode}/${finalJob.blockedAtLayer}`,
  );

  const runnerState = runner.readGithubAutomationRunnerState(job.jobId);
  assert.equal(runnerState?.generation, 1);
  assert.equal(runnerState?.taskId, ensured.task.id);
  assert.equal(runnerState?.branchName, wt.branchName);
  // No g2 / history wipe.
  assert.equal(
    (await store.listGithubAutomationJobs()).filter(
      (j) => j.issueNumber === issueNumber,
    ).length,
    1,
  );

  const events = readAllSafeEvents().filter((e) => e.jobId === job.jobId);
  assert.ok(
    events.some((e) => e.kind === "job_started"),
    "expected job_started",
  );
  // implementing or bootstrap failed after implementing
  assert.ok(
    events.some(
      (e) =>
        e.kind === "unattended_implementing" ||
        e.kind === "unattended_session_bootstrap_failed" ||
        e.kind === "unattended_plan_policy_blocked" ||
        e.kind === "unattended_policy_blocked",
    ),
    "expected implementing or typed failure event",
  );
  for (const ev of events) {
    assertNoSentinel(ev, `event ${ev.kind}`);
  }
  assertNoSentinel(finalJob, "final #22-shaped job");
});

// ─── incomplete_claim disposition ────────────────────────────────────────────

await test("GHR-03 incomplete_claim returns explicit blocked disposition", async () => {
  await resetIsolation();
  const repoPath = await registerFixtureRepo("incomplete-claim");
  const cfg = unattendedConfig(repoPath);
  await configMod.writeGithubAutomationConfig(cfg);

  let job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 4407,
    installationId: 4242,
    deliveryId: null,
    issueTitlePreview: "docs: incomplete claim",
    generation: 1,
    phase: "implementing",
  });
  // claimStatus intentionally incomplete
  job = await store.writeGithubAutomationJob({
    ...job,
    status: "queued",
    phase: "implementing",
    checkpoint: "implementing",
    attempt: 4,
  });

  const result = await runner.runGithubUnattendedImplementation({
    job,
    config: cfg,
    claimComplete: false,
  });
  assert.equal(result.job.reasonCode, "incomplete_claim");
  assert.equal(result.disposition?.kind, "blocked");
  assert.notEqual(result.job.reasonCode, "runner_no_progress");
  assert.equal(result.job.attempt, 4);
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

clearOverrides();
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
