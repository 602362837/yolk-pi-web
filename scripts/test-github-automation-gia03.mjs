#!/usr/bin/env node
/**
 * Focused GIA-03 tests: opened-only ingress, analysis runner comment/close gates.
 *
 * Temporary PI_CODING_AGENT_DIR only. No real GitHub / provider / ~/.pi/agent.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/test-github-automation-gia03.mjs
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });
const agentDir = await mkdtemp(join(tmpdir(), "ypi-gia03-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const runtime = jiti(join(root, "lib/github-automation-runtime.ts"));
const store = jiti(join(root, "lib/github-automation-store.ts"));
const configMod = jiti(join(root, "lib/github-automation-config.ts"));
const comments = jiti(join(root, "lib/github-automation-comments.ts"));
const closeMod = jiti(join(root, "lib/github-issue-analysis-close.ts"));
const runner = jiti(join(root, "lib/github-issue-analysis-runner.ts"));
const scheduler = jiti(join(root, "lib/github-automation-scheduler.ts"));
const evidenceMod = jiti(join(root, "lib/github-issue-analysis-evidence.ts"));
const types = jiti(join(root, "lib/github-issue-analysis-types.ts"));

let passed = 0;
async function test(name, fn) {
  process.stdout.write(`• ${name} ... `);
  await fn();
  passed += 1;
  process.stdout.write("ok\n");
}

const SECRET = "gia03-webhook-secret";
const REPO_ID = 424242;
const INSTALL_ID = 777;

function sign(body) {
  const raw = Buffer.from(body, "utf8");
  const sig =
    "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  return { raw, sig };
}

function issueOpenedPayload(overrides = {}) {
  return {
    action: "opened",
    installation: { id: INSTALL_ID },
    repository: {
      id: REPO_ID,
      full_name: "acme/demo",
      name: "demo",
      owner: { login: "acme", id: 1, type: "User" },
    },
    issue: {
      number: 9,
      title: "Bug: add returns wrong value",
      body: "add(1,1) should be 2 but returns 3",
      state: "open",
      updated_at: "2026-07-29T00:00:00.000Z",
      user: { login: "alice", id: 42, type: "User" },
      labels: [],
    },
    sender: { login: "alice", id: 42, type: "User" },
    ...overrides,
  };
}

function signedRequest(eventName, payload, deliveryId) {
  const body = JSON.stringify(payload);
  const { raw, sig } = sign(body);
  const request = new Request("http://localhost/api/github-automation/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sig,
    },
    body: raw,
  });
  return { request, raw };
}

async function writeEnabledConfig() {
  const cfg = configMod.createDefaultGithubAutomationConfig(
    "2026-07-29T00:00:00.000Z",
  );
  cfg.enabled = true;
  cfg.paused = false;
  cfg.repositories = [
    {
      repositoryId: REPO_ID,
      fullName: "acme/demo",
      installationId: INSTALL_ID,
      projectId: "prj_demo",
      projectRoot: join(agentDir, "repo"),
    },
  ];
  cfg.revision = configMod.computeGithubAutomationConfigRevision(cfg);
  await mkdir(join(agentDir, "github-automation"), { recursive: true });
  await writeFile(
    join(agentDir, "github-automation", "config.json"),
    JSON.stringify(cfg, null, 2) + "\n",
    "utf8",
  );
  await mkdir(join(agentDir, "repo", "src"), { recursive: true });
  await writeFile(
    join(agentDir, "repo", "src", "app.ts"),
    "export function add(a: number, b: number) { return a + b; }\n",
    "utf8",
  );
  return cfg;
}

// ─── Marker / close gate unit tests ──────────────────────────────────────────

await test("v3 issue_analysis marker identity is kind+repo+issue only", () => {
  const marker = comments.buildGithubAutomationCommentMarker({
    kind: "issue_analysis",
    repositoryId: 12,
    issueNumber: 34,
    traceId: "must-not-appear",
  });
  assert.match(marker, /v3 kind=issue_analysis repo=12 issue=34/);
  assert.doesNotMatch(marker, /trace|must-not-appear|job|hash/);
  const parsed = comments.parseGithubAutomationCommentMarker(
    `${marker}\n## body`,
  );
  assert.equal(parsed.version, 3);
  assert.equal(parsed.kind, "issue_analysis");
  assert.equal(parsed.repositoryId, 12);
  assert.equal(parsed.issueNumber, 34);
});

await test("close gate denies every negative condition", () => {
  const base = {
    category: "bug",
    verdict: "not_exists",
    confidence: "high",
    complete: true,
    truncatedInput: false,
    budgetExhausted: false,
    mayClose: true,
    hasVerifiedContradiction: true,
    commentEffect: {
      name: "issue_analysis_comment",
      status: "remote_confirmed",
      remoteId: "1",
      generation: 1,
      updatedAt: "t",
      reasonCode: null,
    },
    closeEffect: null,
    analysisContentHash: "abc",
    issue: {
      number: 1,
      state: "open",
      title: "t",
      body: "b",
      updatedAt: "t",
      contentHash: "abc",
    },
    configEnabled: true,
    configPaused: false,
    fenceValid: true,
  };
  assert.equal(closeMod.evaluateIssueAnalysisCloseGate(base).allowed, true);
  assert.equal(
    closeMod.evaluateIssueAnalysisCloseGate({ ...base, category: "feature" })
      .reason,
    "category_not_bug",
  );
  assert.equal(
    closeMod.evaluateIssueAnalysisCloseGate({
      ...base,
      confidence: "medium",
    }).reason,
    "confidence_not_high",
  );
  assert.equal(
    closeMod.evaluateIssueAnalysisCloseGate({
      ...base,
      hasVerifiedContradiction: false,
    }).reason,
    "missing_contradiction",
  );
  assert.equal(
    closeMod.evaluateIssueAnalysisCloseGate({
      ...base,
      issue: { ...base.issue, contentHash: "changed" },
    }).reason,
    "content_hash_mismatch",
  );
  assert.equal(
    closeMod.evaluateIssueAnalysisCloseGate({
      ...base,
      configPaused: true,
    }).reason,
    "config_paused",
  );
});

// ─── Ingress matrix ──────────────────────────────────────────────────────────

await test("human issues.opened enqueues one v2 analysis job", async () => {
  const cfg = await writeEnabledConfig();
  runtime._testSetGithubIssueTriageAutoRegisterDisabled(true);
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);

  const { request } = signedRequest(
    "issues",
    issueOpenedPayload(),
    "del-open-1",
  );
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 202);
  assert.equal(result.code, "enqueued");
  assert.ok(result.jobId);

  const jobs = await store.listGithubAutomationJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].schemaVersion, 2);
  assert.equal(jobs[0].kind, "issue_analysis");
  assert.equal(jobs[0].phase, "received");
  assert.equal(jobs[0].status, "queued");
  assert.equal(jobs[0].generation, 1);
});

await test("duplicate delivery id does not create second job", async () => {
  const cfg = await writeEnabledConfig();
  const payload = issueOpenedPayload({
    issue: { ...issueOpenedPayload().issue, number: 91 },
  });
  const { request: r1 } = signedRequest("issues", payload, "del-dup-1");
  const { request: r2 } = signedRequest("issues", payload, "del-dup-1");
  const a = await runtime.acceptGithubAutomationWebhook({
    request: r1,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  const b = await runtime.acceptGithubAutomationWebhook({
    request: r2,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(a.code, "enqueued");
  assert.equal(b.code, "duplicate");
  const forIssue = (await store.listGithubAutomationJobs()).filter(
    (j) => j.issueNumber === 91 && j.repositoryId === REPO_ID,
  );
  assert.equal(forIssue.length, 1);
});

await test("second distinct opened delivery for same issue creates zero new job", async () => {
  const cfg = await writeEnabledConfig();
  // Use a fresh issue number.
  const p1 = issueOpenedPayload({
    issue: {
      ...issueOpenedPayload().issue,
      number: 100,
    },
  });
  const p2 = issueOpenedPayload({
    issue: {
      ...issueOpenedPayload().issue,
      number: 100,
    },
  });
  const r1 = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest("issues", p1, "del-same-a").request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  const r2 = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest("issues", p2, "del-same-b").request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(r1.code, "enqueued");
  assert.equal(r2.code, "ignored");
  assert.equal(r2.ignoreReason, "analysis_already_exists");
  const jobs = (await store.listGithubAutomationJobs()).filter(
    (j) => j.issueNumber === 100,
  );
  assert.equal(jobs.length, 1);
});

await test("issue_comment / reopened / self app produce zero jobs", async () => {
  const cfg = await writeEnabledConfig();
  const before = (await store.listGithubAutomationJobs()).length;

  const comment = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest(
      "issue_comment",
      {
        action: "created",
        installation: { id: INSTALL_ID },
        repository: issueOpenedPayload().repository,
        issue: { number: 200, title: "x", state: "open" },
        comment: {
          id: 1,
          body: "hi",
          user: { login: "alice", id: 42, type: "User" },
          updated_at: "2026-07-29T00:00:00.000Z",
        },
        sender: { login: "alice", id: 42, type: "User" },
      },
      "del-comment-1",
    ).request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(comment.code, "ignored");

  const reopened = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest(
      "issues",
      issueOpenedPayload({
        action: "reopened",
        issue: { ...issueOpenedPayload().issue, number: 201 },
      }),
      "del-reopen-1",
    ).request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(reopened.code, "ignored");

  const selfBot = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest(
      "issues",
      issueOpenedPayload({
        issue: { ...issueOpenedPayload().issue, number: 202 },
        sender: { login: "ypi[bot]", id: 99, type: "Bot" },
      }),
      "del-bot-1",
    ).request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(selfBot.code, "ignored");
  assert.equal(selfBot.ignoreReason, "bot_actor_event");

  const after = (await store.listGithubAutomationJobs()).length;
  assert.equal(after, before);
});

// ─── Runner lifecycle with fakes ─────────────────────────────────────────────

await test("runner analyzes → comments → completes open for confirmed", async () => {
  const cfg = await writeEnabledConfig();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/demo",
    issueNumber: 300,
    installationId: INSTALL_ID,
    deliveryId: "del-run-1",
    issueTitlePreview: "Bug",
    phase: "received",
  });

  const bounded = evidenceMod.boundIssueAnalysisClaim({
    title: "Bug: add",
    body: "broken",
    issueUpdatedAt: "2026-07-29T00:00:00.000Z",
    repositoryId: REPO_ID,
    issueNumber: 300,
  });

  const confirmed = types.postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "confirmed",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "Code shows the bug path.",
      directionSummary: "Fix the return value.",
      evidence: [
        {
          evidenceId: "ev_test",
          relation: "supports",
          note: "implementation",
        },
      ],
    },
    ledger: new Map([
      [
        "ev_test",
        {
          evidenceId: "ev_test",
          relativePath: "src/app.ts",
          lineStart: 1,
          lineEnd: 1,
          contentHash: "h",
          bytes: 10,
          operation: "read",
          observedAtMs: Date.now(),
        },
      ],
    ]),
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });

  runner._testSetGithubIssueAnalysisRunnerDeps({
    fetchIssue: async () => ({
      number: 300,
      state: "open",
      title: "Bug: add",
      body: "broken",
      updatedAt: "2026-07-29T00:00:00.000Z",
      contentHash: bounded.contentHash,
    }),
    runAnalysis: async () => ({
      result: confirmed,
      boundedClaim: bounded,
      turns: 1,
      operationsUsed: 1,
    }),
    resolveModel: async () => ({
      ready: true,
      reasonCode: "ok",
      model: { provider: "test", modelId: "m" },
    }),
    upsertComment: async () => ({
      id: 555,
      created: true,
      writePerformed: true,
      outcome: "created",
      duplicateWarning: false,
    }),
    closeIssue: async () => {
      throw new Error("close must not be called for confirmed");
    },
  });

  const result1 = await runner.handleGithubIssueAnalysisJob(
    { ...job, status: "running", attempt: 1, leaseFencingToken: "fence-1" },
    { config: cfg, ownerId: "test" },
  );
  assert.equal(result1.job.phase, "result_ready");
  assert.ok(result1.job.resultId);

  const result2 = await runner.handleGithubIssueAnalysisJob(
    {
      ...result1.job,
      status: "running",
      attempt: 2,
      leaseFencingToken: "fence-1",
    },
    { config: cfg, ownerId: "test" },
  );
  assert.equal(result2.job.phase, "completed");
  assert.equal(result2.job.status, "completed");
  assert.equal(result2.job.verdict, "confirmed");
  const commentFx = result2.job.effects.find(
    (e) => e.name === "issue_analysis_comment",
  );
  assert.equal(commentFx?.status, "remote_confirmed");
  const closeFx = result2.job.effects.find(
    (e) => e.name === "issue_analysis_close",
  );
  assert.equal(closeFx, undefined);

  runner._testSetGithubIssueAnalysisRunnerDeps(null);
});

await test("runner closes only when all gates pass for not_exists", async () => {
  const cfg = await writeEnabledConfig();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/demo",
    issueNumber: 301,
    installationId: INSTALL_ID,
    deliveryId: "del-run-2",
    issueTitlePreview: "Bug",
    phase: "received",
  });

  const bounded = evidenceMod.boundIssueAnalysisClaim({
    title: "Bug: missing feature X",
    body: "X is missing",
    issueUpdatedAt: "2026-07-29T00:00:00.000Z",
    repositoryId: REPO_ID,
    issueNumber: 301,
  });

  // Build a mayClose=true result via postValidate with two contradicts.
  const notExists = types.postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "Authoritative contract disproves the claim.",
      directionSummary: "No code change needed.",
      evidence: [
        {
          evidenceId: "ev_a",
          relation: "contradicts",
          note: "contract",
        },
        {
          evidenceId: "ev_b",
          relation: "contradicts",
          note: "test",
        },
      ],
    },
    ledger: new Map([
      [
        "ev_a",
        {
          evidenceId: "ev_a",
          relativePath: "src/app.ts",
          lineStart: 1,
          lineEnd: 2,
          contentHash: "ha",
          bytes: 10,
          operation: "read",
          observedAtMs: Date.now(),
        },
      ],
      [
        "ev_b",
        {
          evidenceId: "ev_b",
          relativePath: "docs/api.md",
          lineStart: 1,
          lineEnd: 2,
          contentHash: "hb",
          bytes: 10,
          operation: "read",
          observedAtMs: Date.now(),
        },
      ],
    ]),
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(notExists.mayClose, true);

  let closeCalls = 0;
  let issueUpdatedAt = "2026-07-29T00:00:00.000Z";
  runner._testSetGithubIssueAnalysisRunnerDeps({
    fetchIssue: async () => {
      // After comment, updated_at advances but content hash stays the same.
      return {
        number: 301,
        state: closeCalls > 0 ? "closed" : "open",
        title: "Bug: missing feature X",
        body: "X is missing",
        updatedAt: issueUpdatedAt,
        contentHash: bounded.contentHash,
      };
    },
    runAnalysis: async () => ({
      result: notExists,
      boundedClaim: bounded,
      turns: 2,
      operationsUsed: 4,
    }),
    resolveModel: async () => ({
      ready: true,
      reasonCode: "ok",
      model: { provider: "test", modelId: "m" },
    }),
    upsertComment: async () => {
      // Simulate GitHub bumping updated_at on comment write.
      issueUpdatedAt = "2026-07-29T00:00:05.000Z";
      return {
        id: 556,
        created: true,
        writePerformed: true,
        outcome: "created",
        duplicateWarning: false,
      };
    },
    closeIssue: async () => {
      closeCalls += 1;
      return { status: 200, body: { state: "closed" } };
    },
  });

  const r1 = await runner.handleGithubIssueAnalysisJob(
    { ...job, status: "running", attempt: 1, leaseFencingToken: "fence-2" },
    { config: cfg, ownerId: "test" },
  );
  assert.equal(r1.job.phase, "result_ready");

  const r2 = await runner.handleGithubIssueAnalysisJob(
    {
      ...r1.job,
      status: "running",
      attempt: 2,
      leaseFencingToken: "fence-2",
    },
    { config: cfg, ownerId: "test" },
  );
  assert.equal(r2.job.phase, "completed");
  assert.equal(r2.job.status, "completed");
  assert.equal(r2.job.verdict, "not_exists");
  assert.equal(closeCalls, 1);
  const closeFx = r2.job.effects.find((e) => e.name === "issue_analysis_close");
  assert.equal(closeFx?.status, "remote_confirmed");

  runner._testSetGithubIssueAnalysisRunnerDeps(null);
});

await test("scheduler registers analysis handler without triage graph", () => {
  scheduler._testResetGithubAutomationHandlerRegistry();
  scheduler.registerGithubIssueAnalysisJobHandler(
    runner.githubIssueAnalysisJobHandler,
  );
  const reg = scheduler.getGithubAutomationJobHandlerRegistration();
  assert.equal(reg.kind, "custom");
  assert.equal(typeof reg.handler, "function");
});

console.log(`\nGIA-03 focused tests passed: ${passed}`);
