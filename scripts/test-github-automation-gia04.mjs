/**
 * GIA-04 focused contracts: analysis-only config/status/verify/jobs/permission projections.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/test-github-automation-gia04.mjs
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });
const agentDir = await mkdtemp(join(tmpdir(), "ypi-gia04-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const types = jiti(join(root, "lib/github-automation-types.ts"));
const config = jiti(join(root, "lib/github-automation-config.ts"));
const store = jiti(join(root, "lib/github-automation-store.ts"));
const projection = jiti(join(root, "lib/github-automation-projection.ts"));
const setupVerify = jiti(join(root, "lib/github-automation-setup-verify.ts"));
const errors = jiti(join(root, "lib/github-automation-errors.ts"));

let passed = 0;
async function test(name, fn) {
  process.stdout.write(`• ${name} ... `);
  await fn();
  passed += 1;
  process.stdout.write("ok\n");
}

function assertNoForbiddenSurface(value, label) {
  const json = JSON.stringify(value);
  const forbidden = [
    "projectRoot",
    "worktreePath",
    "sessionFile",
    "sessionPath",
    "issueBody",
    "commentBody",
    "full-agent",
    "executionProfile",
    "riskProfile",
    "unattendedEnabled",
    "unattendedEligible",
    "p0Triage",
    "p1Unattended",
    "claimStatus",
    "hasPullRequest",
    "prNumber",
    "headBranch",
    "baseRef",
    "ownerActorIds",
    "assigneeIdentitySource",
    "ypi:claimed",
    "residualRisk",
    "validationCommands",
    "agentExecutionState",
    "sessionAvailability",
    "workspaceLabel",
    "sessionIdShort",
  ];
  for (const key of forbidden) {
    // Allow "projectRootConfigured" but never bare projectRoot key as a JSON field.
    if (key === "projectRoot") {
      assert.equal(
        /"projectRoot"\s*:/.test(json),
        false,
        `${label} leaked projectRoot field`,
      );
      continue;
    }
    assert.equal(
      json.includes(key),
      false,
      `${label} leaked forbidden surface ${key}`,
    );
  }
  projection.assertGithubAutomationProjectionSafe(value);
}

const now = "2026-07-29T02:00:00.000Z";

const sampleConfig = {
  schemaVersion: 2,
  enabled: true,
  paused: false,
  repositories: [
    {
      repositoryId: 4242,
      fullName: "acme/analysis",
      installationId: 9001,
      projectId: "prj_analysis",
      projectRoot: join(agentDir, "repo-secret-root"),
    },
  ],
  analysis: { maxConcurrency: 2 },
  revision: "rev_test_1",
  updatedAt: now,
};

const readyApp = {
  configured: true,
  readiness: "ready",
  hasAppId: true,
  hasPrivateKeyFile: true,
  hasPrivateKey: true,
  hasWebhookSecret: true,
  appSlug: "ypi-test",
  checkedAt: now,
};

const readyCapability = types.deriveGithubAppCapability({
  metadata: "read",
  issues: "write",
  pull_requests: "none",
  contents: "none",
});

const readyModel = {
  ready: true,
  reasonCode: "ok",
  model: { provider: "openai", modelId: "gpt-test" },
};

await test("permission projection only reports Metadata + Issues", () => {
  const perms =
    projection.toGithubAutomationAnalysisPermissionProjection(readyCapability);
  assert.equal(perms.analysisReady, true);
  assert.deepEqual(perms.missing, []);
  assert.equal(perms.snapshot.metadata, "read");
  assert.equal(perms.snapshot.issues, "write");
  assert.equal("pull_requests" in perms.snapshot, false);
  assert.equal("contents" in perms.snapshot, false);
  assert.equal("p0Triage" in perms, false);
  assert.equal("p1Unattended" in perms, false);

  const missing = projection.toGithubAutomationAnalysisPermissionProjection(
    types.deriveGithubAppCapability(types.emptyPermissionSnapshot()),
  );
  assert.equal(missing.analysisReady, false);
  assert.ok(missing.missing.includes("metadata"));
  assert.ok(missing.missing.includes("issues"));
});

await test("config wire patch rejects closed-loop and secret fields", () => {
  for (const field of [
    "mode",
    "unattended",
    "triage",
    "baseRef",
    "ownerActorIds",
    "executionProfile",
    "riskProfile",
    "token",
    "webhookSecret",
    "projectRoot",
  ]) {
    assert.throws(
      () =>
        projection.parseGithubAutomationConfigWirePatch({
          revision: "r1",
          [field]: field === "enabled" ? true : "x",
        }),
      (err) =>
        err instanceof errors.GithubAutomationError &&
        err.code === "invalid_config",
      `expected reject for ${field}`,
    );
  }

  const ok = projection.parseGithubAutomationConfigWirePatch({
    revision: "r1",
    enabled: true,
    paused: true,
    analysis: { maxConcurrency: 3 },
  });
  assert.equal(ok.enabled, true);
  assert.equal(ok.paused, true);
  assert.equal(ok.analysis.maxConcurrency, 3);
});

await test("status projection is analysis-only and privacy-safe", async () => {
  await mkdir(join(agentDir, "repo-secret-root"), { recursive: true });
  const written = await config.writeGithubAutomationConfig({
    ...sampleConfig,
    revision: undefined,
  });

  const analysisJob = await store.createQueuedGithubAutomationJob({
    repositoryId: 4242,
    repositoryFullName: "acme/analysis",
    issueNumber: 7,
    installationId: 9001,
    deliveryId: "d1",
    issueTitlePreview: "bug: example",
  });
  const completed = await store.writeGithubAutomationJob({
    ...analysisJob,
    status: "completed",
    phase: "completed",
    category: "bug",
    verdict: "confirmed",
    confidence: "high",
    completeness: "complete",
    budgetExceeded: false,
    checkpoint: "completed",
    effects: [
      {
        name: "issue_analysis_comment",
        status: "remote_confirmed",
        remoteId: "c1",
        generation: 1,
        updatedAt: now,
        reasonCode: null,
      },
    ],
    updatedAt: now,
  });

  const status = await projection.buildGithubAutomationStatusProjection({
    config: written,
    resolveLive: false,
    appProjection: readyApp,
    capability: readyCapability,
    modelReadiness: readyModel,
    webhookHealth: "healthy",
    webhookLastVerifiedAt: now,
    jobs: [completed],
  });

  assert.equal(status.runtime.enabled, true);
  assert.equal(status.runtime.paused, false);
  assert.equal(status.runtime.analysisMaxConcurrency, 2);
  assert.equal(status.readiness.permissions.analysisReady, true);
  assert.equal(status.readiness.model.ready, true);
  assert.equal(status.readiness.model.provider, "openai");
  assert.equal(status.jobs.length, 1);
  assert.equal(status.jobs[0].category, "bug");
  assert.equal(status.jobs[0].verdict, "confirmed");
  assert.equal(status.jobs[0].outcome, "completed_open");
  assert.equal(status.jobs[0].comment.status, "remote_confirmed");
  assert.equal(status.jobs[0].close.status, null);
  assert.equal(status.jobs[0].kind, "issue_analysis");
  assert.equal("assignee" in status.readiness, false);
  assert.equal("policy" in status, false);
  assert.equal("mode" in status.runtime, false);
  assert.equal("executionProfile" in status.runtime, false);
  assert.equal("baseRef" in status.repositories[0], false);
  assert.equal("ownerActorIds" in status.repositories[0], false);
  assert.equal("claimStatus" in status.jobs[0], false);
  assert.equal("hasPullRequest" in status.jobs[0], false);
  assert.equal("prNumber" in status.jobs[0], false);
  assertNoForbiddenSurface(status, "status");
  assert.ok(!JSON.stringify(status).includes(join(agentDir, "repo-secret-root")));
});

await test("setup verify is analysis-ready without assignee/P1 and has zero side effects", async () => {
  const cfg = await config.readGithubAutomationConfig();
  const result = await setupVerify.runGithubAutomationSetupVerify({
    config: cfg,
    resolveLive: false,
    appProjection: readyApp,
    capability: readyCapability,
    modelReadiness: readyModel,
    webhookHealth: "healthy",
    webhookLastVerifiedAt: now,
    webhookRecentDeliveryCount: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.analysisReady, true);
  assert.equal(result.allReady, true);
  assert.deepEqual(result.sideEffects, {
    enqueuedJobs: false,
    schedulerWoken: false,
    githubMutations: false,
  });
  assert.equal(result.summary.permissions.analysisReady, true);
  assert.equal(result.summary.model.ready, true);
  assert.equal("assignee" in result.summary, false);
  assert.equal("p0Ready" in result, false);
  assert.equal("p1Ready" in result, false);
  assert.equal("unattendedEligible" in result, false);

  const codes = result.checklist.map((c) => c.code);
  assert.ok(codes.includes("analysis_model"));
  assert.ok(codes.includes("permissions"));
  assert.equal(codes.includes("assignee"), false);
  assert.ok(
    result.checklist.find((c) => c.code === "permissions")?.title.includes("Issues"),
  );
  assertNoForbiddenSurface(result, "verify");

  const side = setupVerify.githubAutomationSetupVerifySideEffectContract();
  assert.equal(side.enqueuesJobs, false);
  assert.equal(side.wakesScheduler, false);
  assert.equal(side.mutatesGithub, false);
});

await test("job projection + retry only; pause/resume rejected by action type", async () => {
  const cfg = await config.readGithubAutomationConfig();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 4242,
    repositoryFullName: "acme/analysis",
    issueNumber: 11,
    installationId: 9001,
    deliveryId: "d-retry",
    issueTitlePreview: "retry me",
  });
  const blocked = await store.writeGithubAutomationJob({
    ...job,
    status: "blocked",
    phase: "blocked",
    reasonCode: "comment_write_failed",
    checkpoint: "commenting",
    category: "bug",
    verdict: "confirmed",
    confidence: "medium",
    retryability: "operator",
    updatedAt: now,
  });

  const proj = projection.toGithubAutomationJobSafeProjection(blocked, {
    automationEnabled: true,
    globalPaused: false,
  });
  assert.equal(proj.actions.length, 1);
  assert.equal(proj.actions[0].action, "retry");
  assert.equal(proj.actions[0].available, true);
  assert.equal(proj.outcome, "blocked");
  assert.equal("claimStatus" in proj, false);
  assert.equal("hasPullRequest" in proj, false);
  assertNoForbiddenSurface(proj, "job projection");

  // Reject pause/resume at the action function level (route also rejects).
  const pauseResult = await projection.applyGithubAutomationJobAction({
    jobId: blocked.jobId,
    action: "pause",
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(pauseResult.ok, false);
  assert.equal(pauseResult.code, "not_allowed");

  const resumeResult = await projection.applyGithubAutomationJobAction({
    jobId: blocked.jobId,
    action: "resume",
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(resumeResult.ok, false);
  assert.equal(resumeResult.code, "not_allowed");

  const retry = await projection.applyGithubAutomationJobAction({
    jobId: blocked.jobId,
    action: "retry",
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.code, "accepted");
  assert.equal(retry.job.status, "queued");
  assert.equal(retry.job.checkpoint, "commenting");
  assert.equal(retry.job.reasonCode, "retry_wake");
  // Does not invent a new result or wipe category/verdict.
  assert.equal(retry.job.category, "bug");
  assert.equal(retry.job.verdict, "confirmed");
});

await test("legacy jobs cannot be retried via analysis action gate", async () => {
  const jobsDir = store.getGithubAutomationJobsDir();
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  const legacyId = "job_legacy_1_1_g1_deadbeef";
  const legacy = {
    schemaVersion: 1,
    jobId: legacyId,
    repositoryId: 1,
    repositoryFullName: "acme/old",
    issueNumber: 1,
    installationId: 1,
    kind: "legacy_pipeline",
    phase: "implementation_queued",
    status: "queued",
    generation: 1,
    attempt: 0,
    deliveryId: null,
    issueTitlePreview: "legacy",
    traceId: "t",
    createdAt: now,
    updatedAt: now,
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    reasonCode: null,
    effects: [],
    checkpoint: "worktree_ready",
  };
  await writeFile(join(jobsDir, `${legacyId}.json`), JSON.stringify(legacy), {
    mode: 0o600,
  });

  const actions = projection.evaluateGithubAutomationJobActions(legacy, {
    automationEnabled: true,
  });
  assert.equal(actions[0].available, false);
  assert.equal(actions[0].reasonCode, "legacy_pipeline_retired");

  const result = await projection.applyGithubAutomationJobAction({
    jobId: legacyId,
    action: "retry",
    wakeScheduler: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_allowed");
});

await test("completed analysis job is not retryable", async () => {
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 4242,
    repositoryFullName: "acme/analysis",
    issueNumber: 99,
    installationId: 9001,
    deliveryId: "d-done",
    issueTitlePreview: "done",
  });
  const completed = await store.writeGithubAutomationJob({
    ...job,
    status: "completed",
    phase: "completed",
    checkpoint: "completed",
    category: "feature",
    verdict: "not_applicable",
    confidence: "high",
    updatedAt: now,
  });
  const actions = projection.evaluateGithubAutomationJobActions(completed, {
    automationEnabled: true,
  });
  assert.equal(actions[0].available, false);
  assert.equal(actions[0].reasonCode, "job_completed");
  assert.equal(
    projection.deriveGithubIssueAnalysisOutcome(completed),
    "completed_open",
  );
});

console.log(`\nGIA-04 focused suite: ${passed} passed`);
