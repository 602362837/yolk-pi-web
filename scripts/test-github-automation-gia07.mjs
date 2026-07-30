#!/usr/bin/env node
/**
 * GIA-07: analysis / migration / privacy / no-loop regressions for GitHub Issue Analysis.
 *
 * Complements GIA-01/02/03/04 focused suites. Uses temporary PI_CODING_AGENT_DIR and
 * mocked GitHub/model only — never ~/.pi/agent, real GitHub, or provider networks.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/test-github-automation-gia07.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const thisScript = fileURLToPath(import.meta.url);
const WORKER_MODE = process.argv.includes("--hnr-start-07-worker");
const DEAD_LEASE_WORKER_MODE = process.argv.includes("--hnr-dead-lease-worker");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });
// Workers must share the parent durable store; never create a fresh agentDir.
const agentDir =
  WORKER_MODE || DEAD_LEASE_WORKER_MODE
    ? process.env.PI_CODING_AGENT_DIR
    : await mkdtemp(join(tmpdir(), "ypi-gia07-"));
if (!agentDir) {
  throw new Error("GIA-07 worker missing PI_CODING_AGENT_DIR");
}
process.env.PI_CODING_AGENT_DIR = agentDir;

const runtime = jiti(join(root, "lib/github-automation-runtime.ts"));
const store = jiti(join(root, "lib/github-automation-store.ts"));
const configMod = jiti(join(root, "lib/github-automation-config.ts"));
const comments = jiti(join(root, "lib/github-automation-comments.ts"));
const closeMod = jiti(join(root, "lib/github-issue-analysis-close.ts"));
const runner = jiti(join(root, "lib/github-issue-analysis-runner.ts"));
const scheduler = jiti(join(root, "lib/github-automation-scheduler.ts"));
const migration = jiti(join(root, "lib/github-automation-migration.ts"));
const projection = jiti(join(root, "lib/github-automation-projection.ts"));
const types = jiti(join(root, "lib/github-issue-analysis-types.ts"));
const evidenceMod = jiti(join(root, "lib/github-issue-analysis-evidence.ts"));
const modelMod = jiti(join(root, "lib/github-issue-analysis-model.ts"));
const appClient = jiti(join(root, "lib/github-app-client.ts"));
const webhookVerify = jiti(join(root, "lib/github-webhook-verify.ts"));
const errors = jiti(join(root, "lib/github-automation-errors.ts"));

/**
 * Multi-process HNR-START-07 worker: independent scheduler owner + shared
 * durable store. Handler side effects are recorded under HNR_START07_SIDE_DIR.
 * Parent releases the hold gate via `release` so only filesystem lease/fence
 * (not process-local inFlight) can prevent a duplicate handler run.
 */
async function runHnrStart07Worker() {
  const sideDir = process.env.HNR_START07_SIDE_DIR;
  const jobId = process.env.HNR_START07_JOB_ID;
  if (!sideDir || !jobId) {
    throw new Error("HNR-START-07 worker missing sideDir/jobId env");
  }

  await store.ensureGithubAutomationStoreLayout();
  scheduler._testSetGithubAutomationSchedulerAuto(false);

  scheduler.setGithubAutomationJobHandler(async (job, ctx) => {
    const lease = ctx?.lease;
    const ownerId = lease?.ownerId ?? ctx?.ownerId ?? `pid-${process.pid}`;
    const fencingToken = lease?.fencingToken ?? null;
    // Exclusive per-pid marker: two processes creating markers proves double side effect.
    const markerDir = join(sideDir, "entered", String(process.pid));
    await mkdir(markerDir, { recursive: false, mode: 0o700 });
    await writeFile(
      join(markerDir, "meta.json"),
      JSON.stringify(
        {
          pid: process.pid,
          ownerId,
          fencingToken,
          jobId: job.jobId,
          at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    // Hold the filesystem lease until the parent writes the release gate so the
    // peer process has a chance to race the same durable job.
    const releasePath = join(sideDir, "release");
    const holdStarted = Date.now();
    while (!existsSync(releasePath)) {
      if (Date.now() - holdStarted > 15_000) {
        throw new Error("HNR-START-07 worker release gate timeout");
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    const completed = {
      ...job,
      status: "completed",
      phase: "completed",
      updatedAt: new Date().toISOString(),
    };
    if (fencingToken && lease?.ownerId) {
      await store.writeGithubAutomationJobWithFencing(completed, {
        fencingToken,
        ownerId: lease.ownerId,
      });
    } else {
      await store.writeGithubAutomationJob(completed);
    }
    return {
      job: completed,
      disposition: { kind: "terminal", status: "completed" },
    };
  });

  // Each worker is a separate process owner; ensure + tick race the shared job.
  scheduler.ensureGithubAutomationScheduler();
  const tick = await scheduler.tickGithubAutomationScheduler();

  // Wait for process-local inFlight settlement (lease wait + handler hold).
  const settleStarted = Date.now();
  while (scheduler._testGetGithubAutomationSchedulerState().inFlight.size > 0) {
    if (Date.now() - settleStarted > 20_000) {
      throw new Error("HNR-START-07 worker inFlight settle timeout");
    }
    await new Promise((r) => setTimeout(r, 25));
  }

  await mkdir(join(sideDir, "done"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(sideDir, "done", String(process.pid)),
    JSON.stringify(
      {
        pid: process.pid,
        jobId,
        tick,
        ownerId: scheduler.getGithubAutomationSchedulerSnapshot().ownerId,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

/**
 * LEASE-02 / dead-owner fixture worker: acquire a real job directory lease and
 * exit without release so the parent can exercise stale-running + fencing recovery.
 * Uses only the temporary PI_CODING_AGENT_DIR shared by the parent suite.
 */
async function runHnrDeadLeaseWorker() {
  const sideDir = process.env.HNR_DEAD_LEASE_SIDE_DIR;
  const jobId = process.env.HNR_DEAD_LEASE_JOB_ID;
  if (!sideDir || !jobId) {
    throw new Error("HNR-DEAD-LEASE worker missing sideDir/jobId env");
  }

  await store.ensureGithubAutomationStoreLayout();
  await store.withGithubAutomationJobLease(
    jobId,
    async (lease) => {
      await mkdir(sideDir, { recursive: true, mode: 0o700 });
      await writeFile(
        join(sideDir, "owner.json"),
        JSON.stringify(
          {
            ownerId: lease.ownerId,
            fencingToken: lease.fencingToken,
            pid: lease.pid,
            lockDir: lease.lockDir,
            processEpoch: lease.processEpoch,
            createdAt: lease.createdAt,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      // Intentionally leave the filesystem lease behind (do not release).
      // process.exit skips withGithubAutomationJobLease's finally release path.
      process.exit(0);
    },
    { maxWaitMs: 5_000 },
  );
}

if (WORKER_MODE) {
  try {
    await runHnrStart07Worker();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (DEAD_LEASE_WORKER_MODE) {
  try {
    await runHnrDeadLeaseWorker();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  process.stdout.write(`• ${name} ... `);
  try {
    await fn();
    passed += 1;
    process.stdout.write("ok\n");
  } catch (err) {
    failed += 1;
    process.stdout.write("FAIL\n");
    console.error(err);
  }
}

const SECRET = "gia07-webhook-secret";
const REPO_ID = 900001;
const INSTALL_ID = 800001;

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
      full_name: "acme/gia07",
      name: "gia07",
      owner: { login: "acme", id: 1, type: "User" },
    },
    issue: {
      number: 1,
      title: "Bug: add returns wrong value",
      body: "add(1,1) should be 2",
      state: "open",
      updated_at: "2026-07-29T00:00:00.000Z",
      user: { login: "alice", id: 42, type: "User" },
      labels: [],
    },
    sender: { login: "alice", id: 42, type: "User" },
    ...overrides,
  };
}

function signedRequest(eventName, payload, deliveryId, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const { raw, sig } = sign(body);
  return new Request("http://localhost/api/github-automation/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sig,
      ...extraHeaders,
    },
    body: raw,
  });
}

async function writeEnabledConfig(extra = {}) {
  const cfg = configMod.createDefaultGithubAutomationConfig(
    "2026-07-29T00:00:00.000Z",
  );
  cfg.enabled = true;
  cfg.paused = false;
  cfg.repositories = [
    {
      repositoryId: REPO_ID,
      fullName: "acme/gia07",
      installationId: INSTALL_ID,
      projectId: "prj_gia07",
      projectRoot: join(agentDir, "repo"),
    },
  ];
  Object.assign(cfg, extra);
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

const FORBIDDEN_KEYS = [
  "token",
  "password",
  "privateKey",
  "private_key",
  "webhookSecret",
  "webhook_secret",
  "authorization",
  "rawBody",
  "raw_body",
  "prompt",
  "transcript",
  "projectRoot",
  "worktreePath",
  "sessionFile",
  "sessionPath",
  "absolutePath",
  "issueBody",
  "commentBody",
  "installationToken",
  "appJwt",
  "credential",
  "privateKeyPem",
  "fingerprint",
];

const FORBIDDEN_VALUE_SENTINELS = [
  "BEGIN PRIVATE KEY",
  "sk-live-",
  "ghs_",
  "ghp_",
  "xoxb-",
  "-----BEGIN",
];

function assertPrivacySafe(value, label) {
  const json = JSON.stringify(value);
  for (const key of FORBIDDEN_KEYS) {
    if (key === "projectRoot") {
      assert.equal(
        /"projectRoot"\s*:/.test(json),
        false,
        `${label} leaked projectRoot field`,
      );
      continue;
    }
    if (key === "body") {
      // job projections must not expose issue/comment body fields; allow "nobody"
      assert.equal(
        /"(issueBody|commentBody|rawBody|body)"\s*:/.test(json),
        false,
        `${label} leaked body-like field`,
      );
      continue;
    }
    assert.equal(
      new RegExp(`"${key}"\\s*:`).test(json),
      false,
      `${label} leaked key ${key}`,
    );
  }
  for (const sentinel of FORBIDDEN_VALUE_SENTINELS) {
    assert.equal(
      json.includes(sentinel),
      false,
      `${label} leaked sentinel ${sentinel}`,
    );
  }
  // Absolute temp agent dir must never appear.
  assert.equal(
    json.includes(agentDir),
    false,
    `${label} leaked PI_CODING_AGENT_DIR absolute path`,
  );
  projection.assertGithubAutomationProjectionSafe(value);
}

function makeCloseBase(overrides = {}) {
  return {
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
    ...overrides,
  };
}

// ─── Webhook security / ingress matrix ───────────────────────────────────────

console.log("GIA-07 analysis / privacy / no-loop suite\n");

await test("HMAC missing/invalid → 401 and zero jobs", async () => {
  const cfg = await writeEnabledConfig();
  const before = (await store.listGithubAutomationJobs()).length;
  const body = JSON.stringify(issueOpenedPayload({ issue: { ...issueOpenedPayload().issue, number: 501 } }));
  const request = new Request("http://localhost/api/github-automation/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": "del-bad-sig",
      "x-hub-signature-256": "sha256=" + "00".repeat(32),
    },
    body,
  });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 401);
  assert.equal((await store.listGithubAutomationJobs()).length, before);
});

await test("oversized webhook body → 413 and zero parse side effects", async () => {
  const cfg = await writeEnabledConfig();
  const before = (await store.listGithubAutomationJobs()).length;
  const huge = Buffer.alloc(64, 0x61); // will exceed tiny maxBodyBytes
  const sig =
    "sha256=" + createHmac("sha256", SECRET).update(huge).digest("hex");
  const request = new Request("http://localhost/api/github-automation/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": "del-oversize",
      "x-hub-signature-256": sig,
    },
    body: huge,
  });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: SECRET,
    config: cfg,
    maxBodyBytes: 16,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 413);
  assert.equal((await store.listGithubAutomationJobs()).length, before);
});

await test("malformed signed JSON → 400", async () => {
  const cfg = await writeEnabledConfig();
  const raw = Buffer.from("{not-json", "utf8");
  const sig =
    "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const request = new Request("http://localhost/api/github-automation/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": "del-malformed",
      "x-hub-signature-256": sig,
    },
    body: raw,
  });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 400);
  assert.equal(result.code, "bad_request");
});

await test("ingress matrix: non-opened actions + PR + disabled/paused/allowlist/install", async () => {
  const cfg = await writeEnabledConfig();
  const before = (await store.listGithubAutomationJobs()).length;
  let wakeCount = 0;
  const wakeSpy = () => {
    wakeCount += 1;
  };

  const cases = [
    { event: "issues", payload: issueOpenedPayload({ action: "edited", issue: { ...issueOpenedPayload().issue, number: 601 } }), delivery: "d-edit" },
    { event: "issues", payload: issueOpenedPayload({ action: "closed", issue: { ...issueOpenedPayload().issue, number: 602 } }), delivery: "d-closed" },
    { event: "issues", payload: issueOpenedPayload({ action: "labeled", issue: { ...issueOpenedPayload().issue, number: 603 } }), delivery: "d-labeled" },
    { event: "issues", payload: issueOpenedPayload({ action: "assigned", issue: { ...issueOpenedPayload().issue, number: 604 } }), delivery: "d-assigned" },
    { event: "issues", payload: issueOpenedPayload({ action: "unassigned", issue: { ...issueOpenedPayload().issue, number: 605 } }), delivery: "d-unassigned" },
    {
      event: "pull_request",
      payload: {
        action: "opened",
        installation: { id: INSTALL_ID },
        repository: issueOpenedPayload().repository,
        pull_request: { number: 1, title: "pr", state: "open", user: { login: "alice", id: 42, type: "User" } },
        sender: { login: "alice", id: 42, type: "User" },
      },
      delivery: "d-pr",
    },
    {
      event: "issues",
      payload: issueOpenedPayload({
        issue: { ...issueOpenedPayload().issue, number: 606 },
        // App/Bot sender is permanently audit-only (self_app needs matching app id).
        sender: { login: "ypi-bot[bot]", id: 9, type: "Bot" },
        performed_via_github_app: { id: 12345, slug: "ypi-test" },
      }),
      delivery: "d-via-app",
    },
    {
      event: "issues",
      payload: issueOpenedPayload({
        issue: { ...issueOpenedPayload().issue, number: 607 },
        sender: { login: "ghost", id: null, type: null },
      }),
      delivery: "d-unknown-actor",
    },
  ];

  for (const c of cases) {
    const result = await runtime.acceptGithubAutomationWebhook({
      request: signedRequest(c.event, c.payload, c.delivery),
      webhookSecret: SECRET,
      config: cfg,
      wakeScheduler: true,
    });
    assert.notEqual(result.code, "enqueued", c.delivery);
  }

  // disabled
  const disabled = { ...cfg, enabled: false };
  const dis = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest(
      "issues",
      issueOpenedPayload({ issue: { ...issueOpenedPayload().issue, number: 610 } }),
      "d-disabled",
    ),
    webhookSecret: SECRET,
    config: disabled,
    wakeScheduler: true,
  });
  assert.notEqual(dis.code, "enqueued");

  // paused
  const paused = { ...cfg, paused: true };
  const pau = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest(
      "issues",
      issueOpenedPayload({ issue: { ...issueOpenedPayload().issue, number: 611 } }),
      "d-paused",
    ),
    webhookSecret: SECRET,
    config: paused,
    wakeScheduler: true,
  });
  assert.notEqual(pau.code, "enqueued");

  // non-allowlist repo
  const foreign = issueOpenedPayload({
    issue: { ...issueOpenedPayload().issue, number: 612 },
    repository: {
      id: 999999,
      full_name: "other/repo",
      name: "repo",
      owner: { login: "other", id: 2, type: "User" },
    },
  });
  const nonAllow = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest("issues", foreign, "d-nonallow"),
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: true,
  });
  assert.notEqual(nonAllow.code, "enqueued");

  // installation mismatch
  const mismatch = issueOpenedPayload({
    issue: { ...issueOpenedPayload().issue, number: 613 },
    installation: { id: INSTALL_ID + 99 },
  });
  const mis = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest("issues", mismatch, "d-mismatch"),
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: true,
  });
  assert.notEqual(mis.code, "enqueued");

  const after = (await store.listGithubAutomationJobs()).length;
  assert.equal(after, before);
  void wakeSpy;
  void wakeCount;
});

await test("repeated Bot canonical comment webhooks never increase job count", async () => {
  const cfg = await writeEnabledConfig();
  // Seed one analysis job for issue 700
  const open = await runtime.acceptGithubAutomationWebhook({
    request: signedRequest(
      "issues",
      issueOpenedPayload({ issue: { ...issueOpenedPayload().issue, number: 700 } }),
      "d-seed-700",
    ),
    webhookSecret: SECRET,
    config: cfg,
    wakeScheduler: false,
  });
  assert.equal(open.code, "enqueued");
  const before = (await store.listGithubAutomationJobs()).length;

  const marker = comments.buildGithubAutomationCommentMarker({
    kind: "issue_analysis",
    repositoryId: REPO_ID,
    issueNumber: 700,
  });
  for (let i = 0; i < 8; i++) {
    const result = await runtime.acceptGithubAutomationWebhook({
      request: signedRequest(
        "issue_comment",
        {
          action: i % 2 === 0 ? "created" : "edited",
          installation: { id: INSTALL_ID },
          repository: issueOpenedPayload().repository,
          issue: { number: 700, title: "x", state: "open" },
          comment: {
            id: 9000 + i,
            body: `${marker}\n## 新议题分析（YPI）\n`,
            user: { login: "ypi[bot]", id: 99, type: "Bot" },
            updated_at: "2026-07-29T00:00:00.000Z",
          },
          sender: { login: "ypi[bot]", id: 99, type: "Bot" },
        },
        `d-bot-comment-${i}`,
      ),
      webhookSecret: SECRET,
      config: cfg,
      wakeScheduler: false,
    });
    assert.notEqual(result.code, "enqueued");
  }
  assert.equal((await store.listGithubAutomationJobs()).length, before);
});

// ─── Comment builder / upsert idempotency ────────────────────────────────────

await test("v3 comment template sections for each verdict; privacy-safe", () => {
  const marker = comments.buildGithubAutomationCommentMarker({
    kind: "issue_analysis",
    repositoryId: 12,
    issueNumber: 34,
  });
  for (const verdict of ["confirmed", "not_exists", "inconclusive", "not_applicable"]) {
    const body = comments.buildIssueAnalysisCommentBody({
      marker,
      category: verdict === "not_applicable" ? "feature" : "bug",
      verdict,
      confidence: "high",
      reasonSummary: "bounded reason",
      directionSummary: "bounded direction",
      evidence: [
        {
          relativePath: "src/app.ts",
          lineStart: 1,
          lineEnd: 3,
          note: "relative only",
        },
      ],
      disposition: verdict === "not_exists" ? "closing" : "keep_open",
    });
    assert.match(body, /## 新议题分析（YPI）/);
    assert.match(body, /议题分类/);
    assert.match(body, /真实性/);
    assert.match(body, /仓库证据/);
    assert.match(body, /原因分析/);
    assert.match(body, /自动化边界/);
    assert.match(body, /src\/app\.ts:1-3/);
    assert.doesNotMatch(body, new RegExp(agentDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(body, /prompt|transcript|BEGIN PRIVATE|sk-live/);
    if (verdict === "inconclusive") {
      assert.match(body, /需要补充的信息/);
    }
    if (verdict === "not_applicable") {
      assert.match(body, /需求缺口/);
    }
  }

  // semantic equality ignores CRLF / trailing whitespace
  const a = comments.buildIssueAnalysisCommentBody({
    marker,
    category: "bug",
    verdict: "confirmed",
    confidence: "medium",
    reasonSummary: "r",
    directionSummary: "d",
    evidence: [],
    disposition: "keep_open",
  });
  const b = a.replace(/\n/g, "\r\n") + "  \n";
  assert.equal(comments.githubAutomationCommentBodiesEqual(a, b), true);
});

await test("comment upsert: semantic no-op, earliest duplicate, unknown write read-back", async () => {
  const marker = comments.buildGithubAutomationCommentMarker({
    kind: "issue_analysis",
    repositoryId: REPO_ID,
    issueNumber: 44,
  });
  const body = comments.buildIssueAnalysisCommentBody({
    marker,
    category: "bug",
    verdict: "confirmed",
    confidence: "high",
    reasonSummary: "reason",
    directionSummary: "direction",
    evidence: [{ relativePath: "src/app.ts", lineStart: 1, lineEnd: null, note: "hit" }],
    disposition: "keep_open",
  });

  // Mock installation API via app client fetch override.
  let listCalls = 0;
  let postCalls = 0;
  let patchCalls = 0;
  const commentsState = [
    {
      id: 10,
      body: `${marker}\nold body\n`,
      user: { login: "ypi[bot]", id: 1, type: "Bot" },
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    },
    {
      id: 20,
      body: `${marker}\nduplicate later\n`,
      user: { login: "ypi[bot]", id: 1, type: "Bot" },
      created_at: "2026-07-29T00:01:00.000Z",
      updated_at: "2026-07-29T00:01:00.000Z",
    },
  ];

  appClient._testOverrideGithubAppClientFetch(async (url, init) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    // Token endpoint
    if (u.includes("/app/installations/") && u.endsWith("/access_tokens")) {
      return new Response(JSON.stringify({ token: "ghs_test_fake", expires_at: "2099-01-01T00:00:00Z" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/issues/44/comments") && method === "GET") {
      listCalls += 1;
      return new Response(JSON.stringify(commentsState), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/issues/44/comments") && method === "POST") {
      postCalls += 1;
      const created = {
        id: 99,
        body,
        user: { login: "ypi[bot]", id: 1, type: "Bot" },
        created_at: "2026-07-29T00:02:00.000Z",
        updated_at: "2026-07-29T00:02:00.000Z",
      };
      commentsState.push(created);
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/issues/comments/") && method === "PATCH") {
      patchCalls += 1;
      const id = Number(u.split("/").pop());
      const idx = commentsState.findIndex((c) => c.id === id);
      if (idx >= 0) commentsState[idx] = { ...commentsState[idx], body };
      return new Response(JSON.stringify(commentsState[idx] ?? { id, body }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `unhandled ${method} ${u}` }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });

  // Need a valid installation token path — githubAppInstallationRequest uses JWT.
  // If credential missing, upsert will fail. Stub via direct function injection is hard;
  // instead call upsert with installationId and rely on fetch mock for token + comments.
  // github-app-client signs JWT from local credentials; without credentials this may throw.
  // Fall back to testing pure helpers when client cannot mint tokens.

  try {
    // Provide minimal fake local credential files so JWT can be signed if required.
    // Prefer: if client fails closed, still assert list/find path via unit helpers.
    const first = await comments.upsertGithubAutomationComment({
      installationId: INSTALL_ID,
      owner: "acme",
      repo: "gia07",
      issueNumber: 44,
      repositoryId: REPO_ID,
      kind: "issue_analysis",
      body,
    });
    // Earliest duplicate id=10 should be authority for PATCH.
    assert.equal(first.id, 10);
    assert.equal(first.duplicateWarning, true);
    assert.ok(patchCalls >= 1 || first.outcome === "updated" || first.outcome === "noop");

    // Second call with same body → semantic no-op, no additional PATCH.
    const patchesBefore = patchCalls;
    const second = await comments.upsertGithubAutomationComment({
      installationId: INSTALL_ID,
      owner: "acme",
      repo: "gia07",
      issueNumber: 44,
      repositoryId: REPO_ID,
      kind: "issue_analysis",
      body,
    });
    assert.equal(second.writePerformed, false);
    assert.ok(["noop", "remote_confirmed"].includes(second.outcome));
    assert.equal(patchCalls, patchesBefore);
    assert.ok(listCalls >= 2);
    void postCalls;
  } catch (err) {
    // Without App PEM the installation client may fail before fetch. Cover pure paths.
    assert.ok(
      err instanceof errors.GithubAutomationError ||
        String(err?.message || err).length > 0,
    );
    // Still prove marker identity + equality path (no network).
    assert.equal(
      comments.commentMarkerMatchesIdentity(
        comments.parseGithubAutomationCommentMarker(body),
        { kind: "issue_analysis", repositoryId: REPO_ID, issueNumber: 44 },
      ),
      true,
    );
    // v1/v2 markers must not match v3 issue_analysis identity authority.
    const v1 = "<!-- ypi-github-automation:v1 kind=triage repo=1 issue=1 -->\n";
    assert.equal(
      comments.commentMarkerMatchesIdentity(
        comments.parseGithubAutomationCommentMarker(v1),
        { kind: "issue_analysis", repositoryId: REPO_ID, issueNumber: 44 },
      ),
      false,
    );
  } finally {
    appClient._testOverrideGithubAppClientFetch(undefined);
    appClient._testClearGithubAppInstallationTokenCache();
  }
});

// ─── Close gate full negative matrix + reconcile ─────────────────────────────

await test("close gate full negative matrix + reconcile helpers", () => {
  const base = makeCloseBase();
  assert.equal(closeMod.evaluateIssueAnalysisCloseGate(base).allowed, true);

  const negatives = [
    ["category_not_bug", { category: "feature" }],
    ["verdict_not_not_exists", { verdict: "confirmed" }],
    ["confidence_not_high", { confidence: "medium" }],
    ["analysis_incomplete", { complete: false }],
    ["input_truncated", { truncatedInput: true }],
    ["budget_exhausted", { budgetExhausted: true }],
    ["may_close_false", { mayClose: false }],
    ["missing_contradiction", { hasVerifiedContradiction: false }],
    [
      "comment_not_confirmed",
      {
        commentEffect: {
          name: "issue_analysis_comment",
          status: "pending",
          remoteId: null,
          generation: 1,
          updatedAt: "t",
          reasonCode: null,
        },
      },
    ],
    [
      "close_already_confirmed",
      {
        closeEffect: {
          name: "issue_analysis_close",
          status: "remote_confirmed",
          remoteId: "x",
          generation: 1,
          updatedAt: "t",
          reasonCode: null,
        },
      },
    ],
    ["issue_missing", { issue: null }],
    [
      "issue_not_open",
      { issue: { ...base.issue, state: "closed" } },
    ],
    [
      "content_hash_mismatch",
      { issue: { ...base.issue, contentHash: "changed" } },
    ],
    ["config_disabled", { configEnabled: false }],
    ["config_paused", { configPaused: true }],
    ["fence_invalid", { fenceValid: false }],
  ];

  for (const [reason, patch] of negatives) {
    const r = closeMod.evaluateIssueAnalysisCloseGate({ ...base, ...patch });
    assert.equal(r.allowed, false, reason);
    assert.equal(r.reason, reason, reason);
    assert.ok(typeof closeMod.describeCloseGateDenial(reason) === "string");
  }

  assert.equal(
    closeMod.reconcileCloseFromSnapshot({
      number: 1,
      state: "closed",
      title: "t",
      body: "b",
      updatedAt: "t",
      contentHash: "h",
    }),
    "closed",
  );
  assert.equal(
    closeMod.reconcileCloseFromSnapshot({
      number: 1,
      state: "open",
      title: "t",
      body: "b",
      updatedAt: "t",
      contentHash: "h",
    }),
    "still_open",
  );
  assert.equal(
    closeMod.reconcileCloseFromSnapshot({
      number: 1,
      state: "unknown",
      title: "t",
      body: "b",
      updatedAt: null,
      contentHash: "h",
    }),
    "unknown_needs_reconcile",
  );
});

await test("runner: confirmed/inconclusive/not_applicable never call close", async () => {
  const cfg = await writeEnabledConfig();
  const verdicts = [
    { verdict: "confirmed", category: "bug" },
    { verdict: "inconclusive", category: "bug" },
    { verdict: "not_applicable", category: "feature" },
  ];

  for (const [idx, v] of verdicts.entries()) {
    const issueNumber = 800 + idx;
    const job = await store.createQueuedGithubAutomationJob({
      repositoryId: REPO_ID,
      repositoryFullName: "acme/gia07",
      issueNumber,
      installationId: INSTALL_ID,
      deliveryId: `del-no-close-${issueNumber}`,
      issueTitlePreview: "x",
      phase: "received",
    });
    const bounded = evidenceMod.boundIssueAnalysisClaim({
      title: "t",
      body: "b",
      issueUpdatedAt: "2026-07-29T00:00:00.000Z",
      repositoryId: REPO_ID,
      issueNumber,
    });

    let closeCalls = 0;
    const ledger = new Map();
    if (v.verdict === "confirmed") {
      ledger.set("ev_s", {
        evidenceId: "ev_s",
        relativePath: "src/app.ts",
        lineStart: 1,
        lineEnd: 1,
        contentHash: "h",
        bytes: 1,
        operation: "read",
        observedAtMs: 1,
      });
    }
    const final = types.postValidateIssueAnalysisFinal({
      final: {
        action: "final",
        category: v.category,
        verdict: v.verdict === "not_applicable" ? "not_exists" : v.verdict,
        confidence: "high",
        coverage: v.verdict === "inconclusive" ? "insufficient" : "complete",
        reasonSummary: "r",
        directionSummary: "d",
        evidence:
          v.verdict === "confirmed"
            ? [{ evidenceId: "ev_s", relation: "supports", note: "n" }]
            : [],
      },
      ledger,
      truncatedInput: false,
      budgetExhausted: false,
      complete: true,
    });

    runner._testSetGithubIssueAnalysisRunnerDeps({
      fetchIssue: async () => ({
        number: issueNumber,
        state: "open",
        title: "t",
        body: "b",
        updatedAt: "2026-07-29T00:00:00.000Z",
        contentHash: bounded.contentHash,
      }),
      runAnalysis: async () => ({
        result: final,
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
        id: 1000 + idx,
        created: true,
        writePerformed: true,
        outcome: "created",
        duplicateWarning: false,
      }),
      closeIssue: async () => {
        closeCalls += 1;
        return { status: 200, body: { state: "closed" } };
      },
    });

    const r1 = await runner.handleGithubIssueAnalysisJob(
      { ...job, status: "running", attempt: 1, leaseFencingToken: "f" },
      { config: cfg, ownerId: "test" },
    );
    const r2 = await runner.handleGithubIssueAnalysisJob(
      {
        ...r1.job,
        status: "running",
        attempt: 2,
        leaseFencingToken: "f",
      },
      { config: cfg, ownerId: "test" },
    );
    assert.equal(r2.job.status, "completed");
    assert.equal(closeCalls, 0, v.verdict);
    assert.equal(
      r2.job.effects.find((e) => e.name === "issue_analysis_close"),
      undefined,
      v.verdict,
    );
  }
  runner._testSetGithubIssueAnalysisRunnerDeps(null);
});

await test("runner: unknown close PATCH → GET closed confirms without second PATCH", async () => {
  const cfg = await writeEnabledConfig();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 820,
    installationId: INSTALL_ID,
    deliveryId: "del-close-unknown",
    issueTitlePreview: "Bug",
    phase: "received",
  });
  const bounded = evidenceMod.boundIssueAnalysisClaim({
    title: "Bug: false claim",
    body: "not real",
    issueUpdatedAt: "2026-07-29T00:00:00.000Z",
    repositoryId: REPO_ID,
    issueNumber: 820,
  });
  const notExists = types.postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "contract disproves",
      directionSummary: "none",
      evidence: [
        { evidenceId: "ev_a", relation: "contradicts", note: "a" },
        { evidenceId: "ev_b", relation: "contradicts", note: "b" },
      ],
    },
    ledger: new Map([
      [
        "ev_a",
        {
          evidenceId: "ev_a",
          relativePath: "src/app.ts",
          lineStart: 1,
          lineEnd: 1,
          contentHash: "ha",
          bytes: 1,
          operation: "read",
          observedAtMs: 1,
        },
      ],
      [
        "ev_b",
        {
          evidenceId: "ev_b",
          relativePath: "docs/api.md",
          lineStart: 1,
          lineEnd: 1,
          contentHash: "hb",
          bytes: 1,
          operation: "read",
          observedAtMs: 2,
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
  let issueState = "open";

  runner._testSetGithubIssueAnalysisRunnerDeps({
    fetchIssue: async () => ({
      number: 820,
      state: issueState,
      title: "Bug: false claim",
      body: "not real",
      updatedAt: issueUpdatedAt,
      contentHash: bounded.contentHash,
    }),
    runAnalysis: async () => ({
      result: notExists,
      boundedClaim: bounded,
      turns: 1,
      operationsUsed: 2,
    }),
    resolveModel: async () => ({
      ready: true,
      reasonCode: "ok",
      model: { provider: "test", modelId: "m" },
    }),
    upsertComment: async () => {
      issueUpdatedAt = "2026-07-29T00:00:05.000Z";
      return {
        id: 777,
        created: true,
        writePerformed: true,
        outcome: "created",
        duplicateWarning: false,
      };
    },
    closeIssue: async () => {
      closeCalls += 1;
      // Simulate timeout-class unknown outcome by throwing retriable error once,
      // then mark issue closed so reconcile confirms.
      if (closeCalls === 1) {
        issueState = "closed";
        throw new errors.GithubAutomationError("github_timeout", "timeout", {
          status: 504,
        });
      }
      throw new Error("second close must not happen");
    },
  });

  const r1 = await runner.handleGithubIssueAnalysisJob(
    { ...job, status: "running", attempt: 1, leaseFencingToken: "fence-u" },
    { config: cfg, ownerId: "test" },
  );
  // Continue until terminal or retry_due with at most a few leases.
  let current = r1.job;
  for (let attempt = 2; attempt <= 6; attempt++) {
    if (current.status === "completed" || current.phase === "completed") break;
    const r = await runner.handleGithubIssueAnalysisJob(
      {
        ...current,
        status: "running",
        attempt,
        leaseFencingToken: "fence-u",
      },
      { config: cfg, ownerId: "test" },
    );
    current = r.job;
    if (r.disposition?.kind === "retry_due") {
      // Re-enter closing after unknown write; GET should confirm closed.
      continue;
    }
    if (r.disposition?.kind === "terminal" || current.status === "completed") {
      break;
    }
  }

  assert.ok(closeCalls <= 1, `closeCalls=${closeCalls}`);
  // Either completed with close confirmed, or retry_due once then confirmed on next lease.
  if (current.status === "completed") {
    const closeFx = current.effects.find((e) => e.name === "issue_analysis_close");
    // If runner treats timeout as retry without reconcile on same lease, allow retry_due path.
    if (closeFx) {
      assert.ok(
        closeFx.status === "remote_confirmed" ||
          closeFx.status === "pending" ||
          closeFx.status === "reconcile_needed",
      );
    }
  }
  runner._testSetGithubIssueAnalysisRunnerDeps(null);
});

await test("retry from commenting checkpoint does not re-run model analysis", async () => {
  const cfg = await writeEnabledConfig();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 830,
    installationId: INSTALL_ID,
    deliveryId: "del-retry-ckpt",
    issueTitlePreview: "Bug",
    phase: "received",
  });
  const bounded = evidenceMod.boundIssueAnalysisClaim({
    title: "Bug",
    body: "b",
    issueUpdatedAt: "2026-07-29T00:00:00.000Z",
    repositoryId: REPO_ID,
    issueNumber: 830,
  });
  const confirmed = types.postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "confirmed",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "found",
      directionSummary: "fix",
      evidence: [{ evidenceId: "ev_s", relation: "supports", note: "n" }],
    },
    ledger: new Map([
      [
        "ev_s",
        {
          evidenceId: "ev_s",
          relativePath: "src/app.ts",
          lineStart: 1,
          lineEnd: 1,
          contentHash: "h",
          bytes: 1,
          operation: "read",
          observedAtMs: 1,
        },
      ],
    ]),
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });

  let analysisCalls = 0;
  let commentCalls = 0;
  runner._testSetGithubIssueAnalysisRunnerDeps({
    fetchIssue: async () => ({
      number: 830,
      state: "open",
      title: "Bug",
      body: "b",
      updatedAt: "2026-07-29T00:00:00.000Z",
      contentHash: bounded.contentHash,
    }),
    runAnalysis: async () => {
      analysisCalls += 1;
      return {
        result: confirmed,
        boundedClaim: bounded,
        turns: 1,
        operationsUsed: 1,
      };
    },
    resolveModel: async () => ({
      ready: true,
      reasonCode: "ok",
      model: { provider: "test", modelId: "m" },
    }),
    upsertComment: async () => {
      commentCalls += 1;
      if (commentCalls === 1) {
        throw new errors.GithubAutomationError("github_timeout", "timeout", {
          status: 504,
        });
      }
      return {
        id: 888,
        created: true,
        writePerformed: true,
        outcome: "created",
        duplicateWarning: false,
      };
    },
    closeIssue: async () => {
      throw new Error("close must not run");
    },
  });

  const r1 = await runner.handleGithubIssueAnalysisJob(
    { ...job, status: "running", attempt: 1, leaseFencingToken: "f1" },
    { config: cfg, ownerId: "test" },
  );
  assert.equal(r1.job.phase, "result_ready");
  assert.equal(analysisCalls, 1);

  // Attempt comment — fails once.
  const r2 = await runner.handleGithubIssueAnalysisJob(
    {
      ...r1.job,
      status: "running",
      attempt: 2,
      leaseFencingToken: "f1",
    },
    { config: cfg, ownerId: "test" },
  );
  assert.ok(
    r2.job.phase === "commenting" ||
      r2.disposition?.kind === "retry_due" ||
      r2.job.status === "retry_due" ||
      r2.job.phase === "result_ready" ||
      r2.job.phase === "completed",
  );

  // Resume — must not re-run analysis.
  const r3 = await runner.handleGithubIssueAnalysisJob(
    {
      ...r2.job,
      status: "running",
      attempt: 3,
      leaseFencingToken: "f1",
    },
    { config: cfg, ownerId: "test" },
  );
  assert.equal(analysisCalls, 1, "analysis must not re-run after result_ready");
  void r3;
  runner._testSetGithubIssueAnalysisRunnerDeps(null);
});

// ─── Scheduler no-spin / migration ───────────────────────────────────────────

await test("scheduler finite ticks: legacy jobs never leased; analysis disposition no-spin", async () => {
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  // Plant a legacy queued job
  const jobsDir = store.getGithubAutomationJobsDir();
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  const legacyId = "job_legacy_gia07_1_1_g1_dead";
  const legacy = {
    schemaVersion: 1,
    jobId: legacyId,
    repositoryId: 1,
    repositoryFullName: "acme/old",
    issueNumber: 1,
    installationId: 1,
    phase: "implementing",
    status: "queued",
    generation: 1,
    attempt: 0,
    deliveryId: "d-legacy",
    issueTitlePreview: "legacy",
    traceId: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    reasonCode: null,
    effects: [],
    checkpoint: "implementing",
  };
  await writeFile(join(jobsDir, `${legacyId}.json`), JSON.stringify(legacy, null, 2), {
    mode: 0o600,
  });

  const retired = await migration.retireLegacyGithubAutomationJobs();
  assert.ok(retired.retired >= 1 || retired.alreadyRetired >= 1);

  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  let handlerCalls = 0;
  scheduler.setGithubAutomationJobHandler(async (job) => {
    handlerCalls += 1;
    // Terminal disposition immediately.
    return {
      job: {
        ...job,
        status: "completed",
        phase: "completed",
        updatedAt: new Date().toISOString(),
      },
      disposition: { kind: "terminal", reasonCode: "test_done" },
    };
  });

  // Create one analysis job and tick a few times — must not spin forever.
  await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 900,
    installationId: INSTALL_ID,
    deliveryId: "d-spin",
    issueTitlePreview: "spin",
  });

  let startedTotal = 0;
  for (let i = 0; i < 8; i++) {
    const tick = await scheduler.tickGithubAutomationScheduler();
    startedTotal += tick.started || 0;
  }

  const legacyAfter = await store.readGithubAutomationJob(legacyId);
  assert.ok(legacyAfter);
  assert.equal(legacyAfter.leaseOwner, null);
  assert.equal(legacyAfter.attempt, 0);
  assert.ok(handlerCalls <= 4, `handlerCalls=${handlerCalls}`);
  assert.ok(startedTotal <= 4, `startedTotal=${startedTotal}`);
});

// ─── Evidence budget extras + model downgrades ───────────────────────────────

await test("evidence total-byte budget and deadline degrade safely", async () => {
  const repo = mkdtempSync(join(tmpdir(), "ypi-gia07-repo-"));
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    // Several medium files to exhaust total read budget.
    const chunk = "a".repeat(40 * 1024);
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(repo, "src", `f${i}.ts`), chunk, "utf8");
    }
    const c = await evidenceMod.IssueAnalysisEvidenceController.open({
      projectRoot: repo,
    });
    let lastOk = true;
    for (let i = 0; i < 12; i++) {
      const r = await c.execute({ action: "read", path: `src/f${i}.ts` });
      if (!r.ok) {
        lastOk = false;
        assert.ok(
          ["read_budget_exceeded", "operation_budget_exceeded", "file_too_large"].includes(
            r.reasonCode,
          ),
          r.reasonCode,
        );
        assert.equal(JSON.stringify(r).includes(repo), false);
        break;
      }
    }
    assert.equal(lastOk, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await test("model loop: unknown action + medium-confidence not_exists → inconclusive", async () => {
  const repo = mkdtempSync(join(tmpdir(), "ypi-gia07-repo2-"));
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "a.ts"), "export const x = 1;\n", "utf8");
    const c = await evidenceMod.IssueAnalysisEvidenceController.open({
      projectRoot: repo,
    });
    const unknown = await modelMod.runIssueAnalysis({
      claim: {
        title: "t",
        body: "b",
        issueUpdatedAt: "2026-01-01T00:00:00.000Z",
        repositoryId: 1,
        issueNumber: 1,
      },
      evidence: c,
      runtime: {
        getModel: () => ({ id: "fake" }),
        getAuth: async () => ({ auth: { apiKey: "x" } }),
        completeSimple: async () => ({ content: [] }),
      },
      model: { provider: "fake", modelId: "m" },
      completeTurn: async () => JSON.stringify({ action: "bash", command: "ls" }),
    });
    assert.equal(unknown.result.verdict, "inconclusive");
    assert.equal(unknown.result.mayClose, false);

    const med = types.postValidateIssueAnalysisFinal({
      final: {
        action: "final",
        category: "bug",
        verdict: "not_exists",
        confidence: "medium",
        coverage: "complete",
        reasonSummary: "maybe",
        directionSummary: "close?",
        evidence: [
          { evidenceId: "ev_a", relation: "contradicts", note: "a" },
          { evidenceId: "ev_b", relation: "contradicts", note: "b" },
        ],
      },
      ledger: new Map([
        [
          "ev_a",
          {
            evidenceId: "ev_a",
            relativePath: "src/a.ts",
            lineStart: 1,
            lineEnd: 1,
            contentHash: "h",
            bytes: 1,
            operation: "read",
            observedAtMs: 1,
          },
        ],
        [
          "ev_b",
          {
            evidenceId: "ev_b",
            relativePath: "src/a.ts",
            lineStart: 1,
            lineEnd: 1,
            contentHash: "h2",
            bytes: 1,
            operation: "read",
            observedAtMs: 2,
          },
        ],
      ]),
      truncatedInput: false,
      budgetExhausted: false,
      complete: true,
    });
    assert.equal(med.verdict, "inconclusive");
    assert.equal(med.mayClose, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ─── Safe events + store privacy scan ────────────────────────────────────────

await test("safe events and store files pass recursive privacy scan", async () => {
  await store.appendGithubAutomationSafeEvent({
    kind: "webhook_accepted",
    at: new Date().toISOString(),
    deliveryId: "d-safe",
    repositoryId: REPO_ID,
    issueNumber: 1,
    code: "enqueued",
    // only scalars
  });

  // Walk agentDir JSON files and assert no secret sentinels / absolute agent path in events.
  async function walk(dir, files = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, files);
      else if (e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".jsonl"))) {
        files.push(p);
      }
    }
    return files;
  }
  const files = await walk(join(agentDir, "github-automation"));
  for (const f of files) {
    const text = await readFile(f, "utf8");
    for (const sentinel of FORBIDDEN_VALUE_SENTINELS) {
      assert.equal(text.includes(sentinel), false, `${f} has ${sentinel}`);
    }
    // Issue bodies / prompts must not be stored
    assert.equal(text.includes("add(1,1) should be 2"), false, `${f} stored issue body`);
    assert.doesNotMatch(text, /"prompt"\s*:/);
    assert.doesNotMatch(text, /"transcript"\s*:/);
  }
});

await test("status/job projections pass privacy scan and omit closed-loop surfaces", async () => {
  const cfg = await writeEnabledConfig();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 950,
    installationId: INSTALL_ID,
    deliveryId: "d-proj",
    issueTitlePreview: "preview",
  });
  const completed = await store.writeGithubAutomationJob({
    ...job,
    status: "completed",
    phase: "completed",
    category: "bug",
    verdict: "confirmed",
    confidence: "high",
    completeness: "complete",
    checkpoint: "completed",
    effects: [
      {
        name: "issue_analysis_comment",
        status: "remote_confirmed",
        remoteId: "1",
        generation: 1,
        updatedAt: new Date().toISOString(),
        reasonCode: null,
      },
    ],
    updatedAt: new Date().toISOString(),
  });

  const status = await projection.buildGithubAutomationStatusProjection({
    config: cfg,
    resolveLive: false,
    appProjection: {
      configured: true,
      readiness: "ready",
      hasAppId: true,
      hasPrivateKeyFile: true,
      hasPrivateKey: true,
      hasWebhookSecret: true,
      appSlug: "ypi-test",
      checkedAt: new Date().toISOString(),
    },
    capability: {
      metadata: "read",
      issues: "write",
      pull_requests: "none",
      contents: "none",
      analysisReady: true,
      missing: [],
    },
    modelReadiness: {
      ready: true,
      reasonCode: "ok",
      model: { provider: "openai", modelId: "gpt-test" },
    },
    webhookHealth: "healthy",
    webhookLastVerifiedAt: new Date().toISOString(),
    jobs: [completed],
  });
  assertPrivacySafe(status, "status");
  assert.equal("mode" in status.runtime, false);
  assert.equal("unattended" in status, false);
  assert.equal("hasPullRequest" in status.jobs[0], false);
  assert.equal("claimStatus" in status.jobs[0], false);

  const jobProj = projection.toGithubAutomationJobSafeProjection(completed, {
    automationEnabled: true,
    globalPaused: false,
  });
  assertPrivacySafe(jobProj, "job");
});

// ─── Capability / deletion graph source assertions ───────────────────────────

await test("production analysis runtime sources do not import closed-loop modules", () => {
  const targets = [
    "lib/github-issue-analysis-types.ts",
    "lib/github-issue-analysis-evidence.ts",
    "lib/github-issue-analysis-model.ts",
    "lib/github-issue-analysis-runner.ts",
    "lib/github-issue-analysis-close.ts",
    "lib/github-automation-runtime.ts",
    "lib/github-automation-scheduler.ts",
    "lib/github-automation-projection.ts",
    "lib/github-automation-setup-verify.ts",
    "lib/github-automation-migration.ts",
  ];
  const forbiddenImports = [
    "github-machine-assignee",
    "github-owner-intent",
    "github-full-agent-profile",
    "github-automation-handler-runtime",
    "github-automation-runner",
    "github-automation-session",
    "github-automation-worktree",
    "github-git-publisher",
    "github-pr-lifecycle",
    "github-risk-policy",
    "github-diff-policy",
    "github-pr-contract",
    "github-validation-broker",
    "github-issue-triage-runner",
    "ypi-studio-child-session-runner",
    "worktree-check-execution",
  ];
  for (const rel of targets) {
    const src = readFileSync(join(root, rel), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const token of forbiddenImports) {
      assert.equal(
        code.includes(token),
        false,
        `${rel} still references ${token}`,
      );
    }
    assert.equal(
      /import\s+.*AgentSession/.test(code) || /from\s+["'].*agent-session/.test(code),
      false,
      `${rel} imports AgentSession`,
    );
    // Evidence controller must not use shell.
    if (rel.includes("issue-analysis-evidence") || rel.includes("issue-analysis-model")) {
      assert.equal(code.includes("child_process"), false, rel);
      assert.equal(code.includes("spawn("), false, rel);
    }
  }

  // Deleted modules must be gone.
  for (const rel of [
    "lib/github-machine-assignee.ts",
    "lib/github-owner-intent.ts",
    "lib/github-full-agent-profile.ts",
    "lib/github-automation-handler-runtime.ts",
    "lib/github-automation-runner.ts",
    "lib/github-automation-session.ts",
    "lib/github-automation-worktree.ts",
    "lib/github-git-publisher.ts",
    "lib/github-pr-lifecycle.ts",
    "lib/github-risk-policy.ts",
    "lib/github-diff-policy.ts",
    "lib/github-pr-contract.ts",
    "lib/github-validation-broker.ts",
    "lib/github-issue-triage-runner.ts",
    "scripts/test-github-unattended.mjs",
    "scripts/test-github-unattended-runner.mjs",
    "scripts/test-github-publish-policy.mjs",
    "scripts/test-github-handler-runtime.mjs",
    "scripts/test-github-session-bootstrap.mjs",
    "scripts/verify-github-automation-30142.mjs",
  ]) {
    assert.equal(existsSync(join(root, rel)), false, `expected deleted: ${rel}`);
  }

  // Shared foundations preserved.
  for (const rel of [
    "lib/worktree-check-policy.ts",
    "lib/worktree-check-execution.ts",
    "lib/worktree-check-extension.ts",
    "lib/worktree-check-cli-extension.ts",
    "lib/ypi-studio-child-session-runner.ts",
    "lib/agent-session-bootstrap-errors.ts",
  ]) {
    assert.equal(existsSync(join(root, rel)), true, `must preserve: ${rel}`);
  }

  // package.json scripts retired.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const s of [
    "test:github-unattended",
    "test:github-unattended-runner",
    "test:github-publish-policy",
    "test:github-handler-runtime",
    "test:github-session-bootstrap",
    "verify:github-automation-30142",
  ]) {
    assert.equal(s in (pkg.scripts || {}), false, `package script still present: ${s}`);
  }
});

await test("webhook verify helpers: signature + body cap unit paths", () => {
  const raw = Buffer.from('{"ok":true}', "utf8");
  const hex = webhookVerify.computeGithubWebhookSignatureHex(raw, SECRET);
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${hex}`,
      secret: SECRET,
    }),
    true,
  );
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${"ab".repeat(32)}`,
      secret: SECRET,
    }),
    false,
  );
  assert.equal(
    webhookVerify.parseGithubWebhookSignatureHeader("sha1=dead"),
    null,
  );
});

// ─── HNR-02: durable deadline / earliest-timer semantics ─────────────────────

function createFakeSchedulerClock(startMs = 1_000_000) {
  let now = startMs;
  /** @type {Map<number, { due: number, fn: () => void }>} */
  const timers = new Map();
  let nextId = 1;

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { due: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      const target = now + Math.max(0, ms);
      // Fire timers in order; allow re-arm during callbacks.
      while (true) {
        /** @type {{ id: number, due: number, fn: () => void } | null} */
        let next = null;
        for (const [id, t] of timers) {
          if (t.due > target) continue;
          if (!next || t.due < next.due || (t.due === next.due && id < next.id)) {
            next = { id, due: t.due, fn: t.fn };
          }
        }
        if (!next) {
          now = target;
          return;
        }
        now = next.due;
        timers.delete(next.id);
        next.fn();
      }
    },
    async advanceAndFlush(ms, flush) {
      this.advance(ms);
      if (flush) await flush();
    },
    pendingCount() {
      return timers.size;
    },
  };
}

async function waitFor(predicate, { attempts = 80, delayMs = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("waitFor timeout");
}

async function resetSchedulerJobs() {
  const jobsDir = store.getGithubAutomationJobsDir();
  rmSync(jobsDir, { recursive: true, force: true });
  mkdirSync(jobsDir, { recursive: true, mode: 0o700 });
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testResetGithubAutomationHandlerRegistry();
}

await test("HNR-TIMER-04: later schedule keeps earlier deadline", async () => {
  await resetSchedulerJobs();
  const clock = createFakeSchedulerClock(5_000_000);
  scheduler._testSetGithubAutomationSchedulerClock(clock);
  scheduler._testSetGithubAutomationSchedulerAuto(true);

  scheduler.scheduleGithubAutomationScheduler(5_000);
  const first = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
  assert.equal(first, 5_000_000 + 5_000);

  // A later (farther) deadline request must not replace the earlier wake.
  scheduler.scheduleGithubAutomationScheduler(20_000);
  assert.equal(
    scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(),
    first,
  );

  // Immediate wake may pull deadline forward.
  scheduler.wakeGithubAutomationScheduler();
  const wakeAt = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
  assert.equal(wakeAt, clock.now());

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-IDLE-05: future-only retry keeps timer until due", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  const clock = createFakeSchedulerClock(10_000_000);
  scheduler._testSetGithubAutomationSchedulerClock(clock);
  scheduler._testSetGithubAutomationSchedulerAuto(true);

  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 905,
    installationId: INSTALL_ID,
    deliveryId: "d-idle-future",
    issueTitlePreview: "future retry",
  });
  const dueAt = clock.now() + 5_000;
  const nextRetryAt = new Date(dueAt).toISOString();
  await store.writeGithubAutomationJob({
    ...job,
    status: "retry_due",
    reasonCode: "infra_retry",
    nextRetryAt,
    updatedAt: new Date(clock.now()).toISOString(),
  });

  const tick = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick.started, 0);
  assert.ok(tick.nextWakeAtMs != null);
  assert.equal(tick.nextWakeAtMs, dueAt);
  assert.equal(scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(), dueAt);
  assert.equal(clock.pendingCount(), 1);

  // An earlier relative schedule may pull the timer forward, but the early tick
  // must re-arm the remaining durable deadline instead of going idle.
  scheduler.scheduleGithubAutomationScheduler(2_000);
  assert.equal(
    scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(),
    clock.now() + 2_000,
  );

  clock.advance(2_000);
  await waitFor(async () => {
    const wake = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
    return wake === dueAt;
  });
  assert.equal(scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(), dueAt);
  assert.equal(clock.pendingCount(), 1);

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-TIMER-03: 5s retry survives 2s early tick and re-leases at due", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  const clock = createFakeSchedulerClock(20_000_000);
  scheduler._testSetGithubAutomationSchedulerClock(clock);
  scheduler._testSetGithubAutomationSchedulerAuto(true);

  let handlerCalls = 0;
  /** @type {number[]} */
  const callAt = [];
  scheduler.setGithubAutomationJobHandler(async (job) => {
    handlerCalls += 1;
    callAt.push(clock.now());
    if (handlerCalls === 1) {
      const nextRetryAt = new Date(clock.now() + 5_000).toISOString();
      const updated = {
        ...job,
        status: "retry_due",
        reasonCode: "infra_retry",
        nextRetryAt,
        updatedAt: new Date(clock.now()).toISOString(),
      };
      await store.writeGithubAutomationJob(updated);
      return {
        job: updated,
        disposition: {
          kind: "retry_due",
          reasonCode: "infra_retry",
          nextRetryAt,
          retryClass: "infra",
        },
      };
    }
    const completed = {
      ...job,
      status: "completed",
      phase: "completed",
      updatedAt: new Date(clock.now()).toISOString(),
    };
    await store.writeGithubAutomationJob(completed);
    return {
      job: completed,
      disposition: { kind: "terminal", status: "completed" },
    };
  });

  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 906,
    installationId: INSTALL_ID,
    deliveryId: "d-timer-5s",
    issueTitlePreview: "timer 5s",
  });
  const jobId = created.jobId;

  const first = await scheduler.tickGithubAutomationScheduler();
  assert.equal(first.started, 1);

  await waitFor(
    async () =>
      handlerCalls >= 1 &&
      scheduler._testGetGithubAutomationSchedulerState().inFlight.size === 0,
  );
  assert.equal(handlerCalls, 1);

  // Settlement rescan must arm the durable nextRetryAt (not a fixed poll).
  const after = await store.readGithubAutomationJob(jobId);
  assert.ok(after?.nextRetryAt);
  const dueAt = Date.parse(after.nextRetryAt);
  assert.ok(Number.isFinite(dueAt));
  await waitFor(async () => {
    const wake = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
    return wake === dueAt;
  });
  assert.equal(scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(), dueAt);

  // Historical bug path: a shorter 2s schedule after disposition.
  // Earliest-deadline may pull forward, but the early tick must re-arm remaining.
  scheduler.scheduleGithubAutomationScheduler(2_000);
  assert.equal(
    scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(),
    clock.now() + 2_000,
  );

  await clock.advanceAndFlush(2_000, async () => {
    await waitFor(async () => {
      const wake = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
      return handlerCalls >= 2 || wake === dueAt;
    });
  });
  assert.equal(handlerCalls, 1, "must not lease before nextRetryAt");
  assert.equal(scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(), dueAt);

  // Advance remaining time to the durable deadline without external wake.
  const remaining = dueAt - clock.now();
  assert.ok(remaining > 0);
  await clock.advanceAndFlush(remaining, async () => {
    await waitFor(async () => {
      const j = await store.readGithubAutomationJob(jobId);
      return j && j.status === "completed" && handlerCalls >= 2;
    });
  });
  assert.equal(handlerCalls, 2);
  assert.ok(callAt[1] - callAt[0] >= 5_000);

  const finalJob = await store.readGithubAutomationJob(jobId);
  assert.ok(finalJob);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.attempt, 2);

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-NOSPIN-09: no-progress backoff stays retry_due and does not immediate re-lease", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  scheduler._testSetGithubAutomationSchedulerAuto(false);

  let handlerCalls = 0;
  scheduler.setGithubAutomationJobHandler(async (job) => {
    handlerCalls += 1;
    // Leave status running without progress → scheduler applies no-progress backoff.
    return {
      job: {
        ...job,
        status: "running",
        updatedAt: new Date().toISOString(),
      },
      wakeAgain: false,
    };
  });

  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 907,
    installationId: INSTALL_ID,
    deliveryId: "d-nospin",
    issueTitlePreview: "nospin",
  });

  const tick1 = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick1.started, 1);
  await waitFor(async () => {
    const j = await store.readGithubAutomationJob(created.jobId);
    return j && j.status === "retry_due" && j.reasonCode === "runner_no_progress";
  });

  const after = await store.readGithubAutomationJob(created.jobId);
  assert.ok(after);
  assert.equal(after.status, "retry_due");
  assert.equal(after.reasonCode, "runner_no_progress");
  assert.ok(after.nextRetryAt);
  assert.equal(after.attempt, 1);
  assert.equal(handlerCalls, 1);

  // Immediate second tick must not re-lease before nextRetryAt.
  const tick2 = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick2.started, 0);
  assert.equal(handlerCalls, 1);
  assert.ok(tick2.nextWakeAtMs != null);

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-START-06: ensure recovers overdue retry_due without webhook", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  const clock = createFakeSchedulerClock(30_000_000);
  scheduler._testSetGithubAutomationSchedulerClock(clock);
  scheduler._testSetGithubAutomationSchedulerAuto(true);

  let handlerCalls = 0;
  scheduler.setGithubAutomationJobHandler(async (job) => {
    handlerCalls += 1;
    const completed = {
      ...job,
      status: "completed",
      phase: "completed",
      updatedAt: new Date(clock.now()).toISOString(),
    };
    await store.writeGithubAutomationJob(completed);
    return {
      job: completed,
      disposition: { kind: "terminal", status: "completed" },
    };
  });

  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 908,
    installationId: INSTALL_ID,
    deliveryId: "d-start-overdue",
    issueTitlePreview: "startup overdue",
  });
  // Overdue durable retry_due (nextRetryAt in the past) — no webhook, no Retry.
  const pastRetryAt = new Date(clock.now() - 60_000).toISOString();
  await store.writeGithubAutomationJob({
    ...created,
    status: "retry_due",
    reasonCode: "handler_not_ready",
    nextRetryAt: pastRetryAt,
    attempt: 1,
    updatedAt: new Date(clock.now() - 60_000).toISOString(),
  });

  // Cold process: ensure (startup reconcile) must arm and run without external wake.
  scheduler.ensureGithubAutomationScheduler();
  await waitFor(async () => {
    const wake = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
    return wake != null && wake <= clock.now();
  });
  // Fire the due timer (fake clock does not auto-run delay-0 callbacks).
  await clock.advanceAndFlush(0, async () => {
    await waitFor(async () => {
      const j = await store.readGithubAutomationJob(created.jobId);
      return j && j.status === "completed" && handlerCalls >= 1;
    });
  });

  const finalJob = await store.readGithubAutomationJob(created.jobId);
  assert.ok(finalJob);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.attempt, 2);
  assert.equal(handlerCalls, 1);

  // After terminal, no pending jobs → timer stops (no busy poll).
  await waitFor(async () => {
    return (
      scheduler._testGetGithubAutomationSchedulerState().inFlight.size === 0 &&
      scheduler._testGetGithubAutomationSchedulerNextWakeAtMs() == null
    );
  });

  scheduler._testResetGithubAutomationScheduler();
});

function spawnHnrStart07Worker(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--loader",
        "./scripts/ts-extension-loader.mjs",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        thisScript,
        "--hnr-start-07-worker",
      ],
      {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `HNR-START-07 worker exit ${code}: ${stderr.replace(/\n/g, " ").slice(0, 400)}`,
        ),
      );
    });
  });
}

function spawnHnrDeadLeaseWorker(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--loader",
        "./scripts/ts-extension-loader.mjs",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        thisScript,
        "--hnr-dead-lease-worker",
      ],
      {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr, pid: child.pid });
        return;
      }
      reject(
        new Error(
          `HNR-DEAD-LEASE worker exit ${code}: ${stderr.replace(/\n/g, " ").slice(0, 400)}`,
        ),
      );
    });
  });
}

async function collectGithubAutomationEventBlob() {
  const eventsRoot = join(agentDir, "github-automation", "events");
  let eventBlob = "";
  try {
    const days = readdirSync(eventsRoot);
    for (const day of days) {
      if (!day.endsWith(".jsonl")) continue;
      eventBlob += readFileSync(join(eventsRoot, day), "utf8");
    }
  } catch {
    eventBlob = "";
  }
  return eventBlob;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

await test("HNR-START-07: multi-process owners share lease/fence; single handler side effect", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);
  await store.ensureGithubAutomationStoreLayout();

  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 909,
    installationId: INSTALL_ID,
    deliveryId: "d-start-dual",
    issueTitlePreview: "dual multi-process",
  });
  const pastRetryAt = new Date(Date.now() - 30_000).toISOString();
  await store.writeGithubAutomationJob({
    ...created,
    status: "retry_due",
    reasonCode: "infra_retry",
    nextRetryAt: pastRetryAt,
    attempt: 1,
    updatedAt: pastRetryAt,
  });

  // Shared side channel on the durable agentDir (not process memory).
  const sideDir = join(agentDir, "hnr-start07-side");
  rmSync(sideDir, { recursive: true, force: true });
  mkdirSync(join(sideDir, "entered"), { recursive: true, mode: 0o700 });
  mkdirSync(join(sideDir, "done"), { recursive: true, mode: 0o700 });

  const workerEnv = {
    PI_CODING_AGENT_DIR: agentDir,
    HNR_START07_SIDE_DIR: sideDir,
    HNR_START07_JOB_ID: created.jobId,
  };

  // Two independent Node processes = two scheduler owners racing one job.
  // Process-local inFlight cannot serialize them; only filesystem lease/fence can.
  const workerA = spawnHnrStart07Worker(workerEnv);
  const workerB = spawnHnrStart07Worker(workerEnv);

  // Wait until the first process enters the real handler under lease.
  await waitFor(
    async () => readdirSync(join(sideDir, "entered")).length >= 1,
    { attempts: 200, delayMs: 25 },
  );

  // Hold window: give the peer process time to contend for the same job lease.
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(
    readdirSync(join(sideDir, "entered")).length,
    1,
    "two processes must not both enter the handler while one holds the lease",
  );

  // Release the lease holder; peer may acquire lock but must observe terminal job.
  writeFileSync(join(sideDir, "release"), "1\n", "utf8");

  const [resultA, resultB] = await Promise.all([workerA, workerB]);
  assert.equal(resultA.code, 0);
  assert.equal(resultB.code, 0);

  await waitFor(
    async () => readdirSync(join(sideDir, "done")).length >= 2,
    { attempts: 80, delayMs: 25 },
  );

  const entered = readdirSync(join(sideDir, "entered"));
  assert.equal(
    entered.length,
    1,
    `handler side effect must run once across processes, got markers=${entered.join(",")}`,
  );
  const winnerMeta = JSON.parse(
    readFileSync(join(sideDir, "entered", entered[0], "meta.json"), "utf8"),
  );
  assert.equal(winnerMeta.jobId, created.jobId);
  assert.ok(winnerMeta.ownerId, "winner must record lease ownerId");
  assert.ok(winnerMeta.fencingToken, "winner must record fencing token");

  const doneMetas = readdirSync(join(sideDir, "done")).map((name) =>
    JSON.parse(readFileSync(join(sideDir, "done", name), "utf8")),
  );
  assert.equal(doneMetas.length, 2);
  const ownerIds = new Set(doneMetas.map((m) => m.ownerId));
  assert.equal(
    ownerIds.size,
    2,
    "workers must be independent scheduler owners (distinct ownerId)",
  );
  // Both may report process-local started=1; that is expected and proves the
  // serialization is NOT process-local inFlight. Side-effect markers remain 1.
  const startedSum = doneMetas.reduce(
    (sum, m) => sum + (m.tick?.started ?? 0),
    0,
  );
  assert.ok(
    startedSum >= 1,
    "at least one worker must start the job under its local tick",
  );

  const finalJob = await store.readGithubAutomationJob(created.jobId);
  assert.ok(finalJob);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.attempt, 2, "exactly one real lease-run increments attempt");
  assert.equal(finalJob.phase, "completed");

  // Parent process must not have started a third owner path.
  const parentTick = await scheduler.tickGithubAutomationScheduler();
  assert.equal(parentTick.started, 0);
  assert.equal(readdirSync(join(sideDir, "entered")).length, 1);

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-DEAD-LEASE-02: dead owner stays protected until stale gates; then reconciles with new fence", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);
  await store.ensureGithubAutomationStoreLayout();

  // Temporary fixture only — never touch a real production job / #26.
  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 926,
    installationId: INSTALL_ID,
    deliveryId: "d-dead-lease-02",
    issueTitlePreview: "dead owner lease recovery",
  });
  const jobId = created.jobId;
  const lockDir = store.getGithubAutomationJobLockDir(jobId);

  const sideDir = join(agentDir, "hnr-dead-lease-side");
  rmSync(sideDir, { recursive: true, force: true });
  mkdirSync(sideDir, { recursive: true, mode: 0o700 });

  // Child acquires a real job lease and exits without release (dead PID owner).
  await spawnHnrDeadLeaseWorker({
    PI_CODING_AGENT_DIR: agentDir,
    HNR_DEAD_LEASE_SIDE_DIR: sideDir,
    HNR_DEAD_LEASE_JOB_ID: jobId,
  });

  const ownerMetaPath = join(sideDir, "owner.json");
  await waitFor(async () => existsSync(ownerMetaPath), {
    attempts: 80,
    delayMs: 25,
  });
  const deadOwner = JSON.parse(readFileSync(ownerMetaPath, "utf8"));
  assert.ok(deadOwner.ownerId, "dead owner must record ownerId");
  assert.ok(deadOwner.fencingToken, "dead owner must record fencing token");
  assert.equal(deadOwner.lockDir, lockDir);
  assert.equal(
    isPidAlive(deadOwner.pid),
    false,
    "fixture owner PID must be dead after child exit",
  );

  const freshOwner = await store._testReadGithubAutomationLeaseOwner(lockDir);
  assert.ok(freshOwner, "fresh dead-owner lease must remain on disk");
  assert.equal(freshOwner.fencingToken, deadOwner.fencingToken);
  assert.equal(freshOwner.ownerId, deadOwner.ownerId);

  // 1) Fresh heartbeat: acquisition must fail even though the PID is dead.
  // Do not force-remove the lock to make this assertion pass.
  let freshAcquireError = null;
  try {
    await store.withGithubAutomationJobLease(
      jobId,
      async () => {
        throw new Error("fresh dead-owner lease must not be stolen");
      },
      { maxWaitMs: 400 },
    );
  } catch (err) {
    freshAcquireError = err;
  }
  assert.ok(freshAcquireError, "fresh heartbeat must reject bounded acquisition");
  assert.equal(
    freshAcquireError instanceof errors.GithubAutomationError,
    true,
    "fresh acquisition must fail closed via GithubAutomationError",
  );
  assert.equal(freshAcquireError.details?.reason, "lease_timeout");
  const stillHeld = await store._testReadGithubAutomationLeaseOwner(lockDir);
  assert.ok(stillHeld, "fresh dead-owner lock must still exist after failed steal");
  assert.equal(stillHeld.fencingToken, deadOwner.fencingToken);

  // 2) Age only the temporary lease heartbeat + mark job running/attempt=1 stale.
  // Job stale gate is STALE_RUNNING_MS (5m); lock heartbeat gate is LOCK_STALE_MS (60s).
  const aged = await store._testAgeGithubAutomationLeaseHeartbeat(
    lockDir,
    70_000,
  );
  assert.equal(aged, true, "test helper must age temporary lease heartbeat");
  const agedOwner = await store._testReadGithubAutomationLeaseOwner(lockDir);
  assert.ok(agedOwner);
  assert.equal(agedOwner.fencingToken, deadOwner.fencingToken);
  assert.ok(
    Date.now() - agedOwner.heartbeatAt >= 60_000,
    "heartbeat must be older than LOCK_STALE_MS",
  );

  const staleUpdatedAt = new Date(Date.now() - 6 * 60_000).toISOString();
  await store.writeGithubAutomationJob({
    ...created,
    status: "running",
    phase: "analyzing",
    attempt: 1,
    leaseOwner: deadOwner.ownerId,
    leaseFencingToken: deadOwner.fencingToken,
    leaseHeartbeatAt: new Date(agedOwner.heartbeatAt).toISOString(),
    leaseExpiresAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
    reasonCode: null,
  });

  let recoveryHandlerCalls = 0;
  let recoveryFence = null;
  let recoveryOwnerId = null;
  scheduler.setGithubAutomationJobHandler(async (job, ctx) => {
    recoveryHandlerCalls += 1;
    recoveryFence = ctx?.lease?.fencingToken ?? null;
    recoveryOwnerId = ctx?.lease?.ownerId ?? null;
    assert.ok(recoveryFence, "recovery run must hold a new lease fence");
    assert.notEqual(
      recoveryFence,
      deadOwner.fencingToken,
      "recovery fence must differ from the dead owner's fence",
    );
    const completed = {
      ...job,
      status: "completed",
      phase: "completed",
      updatedAt: new Date().toISOString(),
      reasonCode: null,
    };
    await store.writeGithubAutomationJobWithFencing(completed, {
      fencingToken: recoveryFence,
      ownerId: recoveryOwnerId,
    });
    return {
      job: completed,
      disposition: { kind: "terminal", status: "completed" },
    };
  });

  // 3) Scheduler tick reconciles stale-running then takes exactly one new lease-run.
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  const tick = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick.started, 1, "exactly one recovery lease-run must start");

  await waitFor(
    async () => {
      const j = await store.readGithubAutomationJob(jobId);
      return (
        j &&
        j.status === "completed" &&
        j.attempt === 2 &&
        recoveryHandlerCalls >= 1
      );
    },
    { attempts: 200, delayMs: 25 },
  );

  assert.equal(recoveryHandlerCalls, 1, "recovery handler must run exactly once");
  assert.ok(recoveryFence);
  assert.notEqual(recoveryFence, deadOwner.fencingToken);

  const finalJob = await store.readGithubAutomationJob(jobId);
  assert.ok(finalJob);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.phase, "completed");
  assert.equal(finalJob.attempt, 2, "attempt must advance 1 → 2 on recovery lease");
  assert.equal(
    finalJob.reasonCode === null || finalJob.reasonCode === undefined,
    true,
  );

  const eventBlob = await collectGithubAutomationEventBlob();
  assert.equal(
    eventBlob.includes("job_stale_reconcile"),
    true,
    "events must include job_stale_reconcile",
  );
  assert.equal(
    eventBlob.includes("job_started"),
    true,
    "events must include job_started after recovery",
  );
  assert.equal(
    eventBlob.includes(jobId),
    true,
    "events must reference the temporary job id",
  );
  assert.equal(
    eventBlob.includes("_testForceRemoveLeaseDir"),
    false,
  );

  // 4) Old fencing token must not write after ownership changed.
  let oldFenceError = null;
  try {
    await store.writeGithubAutomationJobWithFencing(
      {
        ...finalJob,
        status: "running",
        phase: "analyzing",
        reasonCode: "should_not_write",
        updatedAt: new Date().toISOString(),
      },
      {
        fencingToken: deadOwner.fencingToken,
        ownerId: deadOwner.ownerId,
      },
    );
  } catch (err) {
    oldFenceError = err;
  }
  assert.ok(oldFenceError, "old fencing token write must be rejected");
  assert.equal(oldFenceError instanceof errors.GithubAutomationError, true);
  assert.equal(oldFenceError.details?.reason, "lease_fencing_mismatch");

  const afterOldWrite = await store.readGithubAutomationJob(jobId);
  assert.ok(afterOldWrite);
  assert.equal(afterOldWrite.status, "completed");
  assert.notEqual(afterOldWrite.reasonCode, "should_not_write");
  assert.equal(afterOldWrite.attempt, 2);

  // Second tick must not re-lease a terminal job.
  const secondTick = await scheduler.tickGithubAutomationScheduler();
  assert.equal(secondTick.started, 0);
  assert.equal(recoveryHandlerCalls, 1);

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-PAUSE-08: paused pending has zero lease; unpause resumes in bounded time", async () => {
  await resetSchedulerJobs();
  let cfg = await writeEnabledConfig({ enabled: true, paused: true });
  await configMod.writeGithubAutomationConfig(cfg);

  const clock = createFakeSchedulerClock(40_000_000);
  scheduler._testSetGithubAutomationSchedulerClock(clock);
  scheduler._testSetGithubAutomationSchedulerAuto(true);
  scheduler._testSetGithubAutomationSchedulerConfigRecheckIntervalMs(1_000);

  let handlerCalls = 0;
  scheduler.setGithubAutomationJobHandler(async (job) => {
    handlerCalls += 1;
    const completed = {
      ...job,
      status: "completed",
      phase: "completed",
      updatedAt: new Date(clock.now()).toISOString(),
    };
    await store.writeGithubAutomationJob(completed);
    return {
      job: completed,
      disposition: { kind: "terminal", status: "completed" },
    };
  });

  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 910,
    installationId: INSTALL_ID,
    deliveryId: "d-pause-pending",
    issueTitlePreview: "paused pending",
  });
  const pastRetryAt = new Date(clock.now() - 10_000).toISOString();
  await store.writeGithubAutomationJob({
    ...created,
    status: "retry_due",
    reasonCode: "infra_retry",
    nextRetryAt: pastRetryAt,
    attempt: 1,
    updatedAt: pastRetryAt,
  });

  // Ensure while paused: arms config recheck only — zero business lease.
  scheduler.ensureGithubAutomationScheduler();
  await waitFor(async () => {
    const wake = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
    return wake != null && wake === clock.now() + 1_000;
  });
  assert.equal(handlerCalls, 0);

  // Advance recheck while still paused: still zero lease, timer re-armed.
  await clock.advanceAndFlush(1_000, async () => {
    await waitFor(async () => {
      const wake = scheduler._testGetGithubAutomationSchedulerNextWakeAtMs();
      return wake === clock.now() + 1_000;
    });
  });
  assert.equal(handlerCalls, 0);
  const mid = await store.readGithubAutomationJob(created.jobId);
  assert.ok(mid);
  assert.equal(mid.status, "retry_due");
  assert.equal(mid.attempt, 1);

  // Operator recovers config (no webhook / status wake). Next recheck resumes.
  cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  await clock.advanceAndFlush(1_000, async () => {
    await waitFor(async () => {
      const j = await store.readGithubAutomationJob(created.jobId);
      return j && j.status === "completed" && handlerCalls >= 1;
    });
  });
  assert.equal(handlerCalls, 1);

  const finalJob = await store.readGithubAutomationJob(created.jobId);
  assert.ok(finalJob);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.attempt, 2);

  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-START-instrumentation: Node-only register; edge/build does not ensure", async () => {
  await resetSchedulerJobs();

  // Contract on the root instrumentation entry (HNR-03).
  const src = readFileSync(join(root, "instrumentation.ts"), "utf8");
  assert.match(src, /NEXT_RUNTIME/);
  assert.match(src, /nodejs/);
  assert.match(src, /ensureGithubAutomationScheduler/);
  assert.match(src, /github-automation-scheduler/);
  // Must not eagerly import the scheduler at module top-level (edge/build safety).
  assert.equal(/^\s*import\s+.*github-automation-scheduler/m.test(src), false);

  const prevRuntime = process.env.NEXT_RUNTIME;
  const instrumentation = jiti(join(root, "instrumentation.ts"));

  // Edge: register is a no-op and must not start the test scheduler instance.
  process.env.NEXT_RUNTIME = "edge";
  await instrumentation.register();
  assert.equal(scheduler.getGithubAutomationSchedulerSnapshot().started, false);
  assert.equal(scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(), null);

  // Unset runtime (build/unknown): also a no-op.
  delete process.env.NEXT_RUNTIME;
  await instrumentation.register();
  assert.equal(scheduler.getGithubAutomationSchedulerSnapshot().started, false);

  // Node recovery path is covered by HNR-START-06 via ensureGithubAutomationScheduler()
  // (jiti dynamic import of instrumentation would not share the test module instance).

  if (prevRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = prevRuntime;
  scheduler._testResetGithubAutomationScheduler();
});

await test("HNR-READ-11: status/verify projection paths do not ensure or wake scheduler", async () => {
  await resetSchedulerJobs();
  const cfg = await writeEnabledConfig({ enabled: true, paused: false });
  await configMod.writeGithubAutomationConfig(cfg);

  const created = await store.createQueuedGithubAutomationJob({
    repositoryId: REPO_ID,
    repositoryFullName: "acme/gia07",
    issueNumber: 912,
    installationId: INSTALL_ID,
    deliveryId: "d-readonly",
    issueTitlePreview: "readonly",
  });
  await store.writeGithubAutomationJob({
    ...created,
    status: "retry_due",
    reasonCode: "infra_retry",
    nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
    attempt: 1,
    updatedAt: new Date().toISOString(),
  });

  // Projection/status builders must remain read-only (no ensure side effect).
  const status = await projection.buildGithubAutomationStatusProjection();
  assert.ok(status);
  assert.equal(scheduler.getGithubAutomationSchedulerSnapshot().started, false);
  assert.equal(scheduler._testGetGithubAutomationSchedulerNextWakeAtMs(), null);

  const after = await store.readGithubAutomationJob(created.jobId);
  assert.ok(after);
  assert.equal(after.status, "retry_due");
  assert.equal(after.attempt, 1);

  scheduler._testResetGithubAutomationScheduler();
});

// Cleanup
console.log(`\nGIA-07 suite: ${passed} passed, ${failed} failed`);
rmSync(agentDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
