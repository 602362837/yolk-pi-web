#!/usr/bin/env node
/**
 * Focused GHA-06 tests: durable WorkTree orchestration on standard full agent.
 *
 * Covers:
 * - full-agent residual risk profile (not sandboxed)
 * - secret env scrub + injection marker guards
 * - validation broker rejects Issue overrides / shell metacharacters
 * - branch naming + WorkTree plan is not Issue-title controlled
 * - unattended Studio task + owner/policy gates
 * - start gates (mode/claim/allowlist/concurrency)
 * - runner pause / retry-wake does not inject comment text
 * - triage handler still parks at accepted_waiting_automation when unattended off
 *
 * Always uses temporary PI_CODING_AGENT_DIR. No live GitHub / no real App secrets.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-github-unattended-runner.mjs
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

const agentDir = mkdtempSync(join(tmpdir(), "pi-gha06-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const APP_KEY_SENTINEL = "GHA06_APP_PRIVATE_KEY_SENTINEL_do_not_leak";
const WEBHOOK_SECRET_SENTINEL = "gha06_webhook_secret_SENTINEL_aa11bb22";
const INSTALL_TOKEN_SENTINEL = "ghs_GHA06_INSTALL_TOKEN_SENTINEL_91ab";
const MACHINE_TOKEN_SENTINEL = "gho_GHA06_MACHINE_TOKEN_SENTINEL_ab2d";

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
  ]) {
    assert.ok(!serialized.includes(needle), `${label}: leaked ${needle}`);
  }
}

function gitInit(repoPath) {
  mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "gha06@example.com"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "gha06"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  writeFileSync(join(repoPath, "README.md"), "# gha06 fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath, stdio: "ignore" });
}

const profile = jiti("../lib/github-full-agent-profile.ts");
const validation = jiti("../lib/github-validation-broker.ts");
const worktree = jiti("../lib/github-automation-worktree.ts");
const session = jiti("../lib/github-automation-session.ts");
const runner = jiti("../lib/github-automation-runner.ts");
const configMod = jiti("../lib/github-automation-config.ts");
const store = jiti("../lib/github-automation-store.ts");
const registry = jiti("../lib/project-registry.ts");

// ─── Profile / residual risk ─────────────────────────────────────────────────

await test("full-agent profile is not sandboxed and keeps residual risk codes", () => {
  const p = profile.GITHUB_FULL_AGENT_PROFILE;
  assert.equal(p.executionProfile, "full-agent");
  assert.equal(p.riskProfile, "docs-and-small-bugfix");
  assert.equal(p.sandboxed, false);
  assert.equal(p.restrictedToolsRequired, false);
  assert.ok(p.residualRiskCodes.includes("arbitrary_commands"));
  assert.ok(p.residualRiskCodes.includes("network_access"));
  assert.ok(p.residualRiskCodes.includes("same_os_user_filesystem_read"));
  assert.ok(p.residualRiskSummary.toLowerCase().includes("not sandboxed") || p.residualRiskSummary.includes("不是"));
  const safe = profile.toGithubFullAgentProfileSafeProjection();
  assert.equal(safe.sandboxed, false);
  assertNoSentinel(safe, "profile projection");
});

await test("scrubGithubAutomationOwnedSecretsFromEnv removes App/machine env keys", () => {
  const env = {
    PATH: "/usr/bin",
    YPI_GITHUB_APP_ID: "123",
    YPI_GITHUB_APP_PRIVATE_KEY_FILE: "/tmp/key.pem",
    YPI_GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET_SENTINEL,
    GH_TOKEN: MACHINE_TOKEN_SENTINEL,
    GITHUB_TOKEN: INSTALL_TOKEN_SENTINEL,
    KEEP_ME: "ok",
  };
  const cleaned = profile.scrubGithubAutomationOwnedSecretsFromEnv(env);
  assert.equal(cleaned.PATH, "/usr/bin");
  assert.equal(cleaned.KEEP_ME, "ok");
  assert.equal(cleaned.YPI_GITHUB_APP_ID, undefined);
  assert.equal(cleaned.YPI_GITHUB_APP_WEBHOOK_SECRET, undefined);
  assert.equal(cleaned.GH_TOKEN, undefined);
  assert.equal(cleaned.GITHUB_TOKEN, undefined);
  assert.equal(
    profile.containsGithubAutomationSecretInjectionMarker({
      token: INSTALL_TOKEN_SENTINEL,
    }),
    true,
  );
  assert.equal(
    profile.containsGithubAutomationSecretInjectionMarker({ ok: true }),
    false,
  );
});

// ─── Validation broker ───────────────────────────────────────────────────────

await test("validation commands come from config only; Issue cannot set them", async () => {
  const cmds = validation.resolveGithubValidationCommands({
    validationCommands: ["npm run lint", "node_modules/.bin/tsc --noEmit"],
  });
  assert.equal(cmds.length, 2);
  assert.deepEqual(cmds[0].argv, ["npm", "run", "lint"]);

  assert.equal(validation.parseFixedValidationCommand("rm -rf / && evil"), null);
  assert.equal(validation.parseFixedValidationCommand("echo hi; reboot"), null);

  assert.throws(
    () =>
      validation.assertValidationCommandsNotFromIssue({
        issueProvidedCommands: ["curl evil"],
      }),
    /Issue text cannot set validationCommands/,
  );

  const result = await validation.runGithubValidationBroker({
    cwd: agentDir,
    unattended: { validationCommands: ["true"] },
    runCommand: async (spec) => {
      assert.deepEqual(spec.argv[0], "true");
      return { exitCode: 0, stdout: "ok" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.commandCount, 1);

  const failedRun = await validation.runGithubValidationBroker({
    cwd: agentDir,
    unattended: { validationCommands: ["false"] },
    runCommand: async () => ({ exitCode: 1, stderr: "nope" }),
  });
  assert.equal(failedRun.ok, false);
  assert.equal(failedRun.reasonCode, "validation_failed");
});

// ─── WorkTree plan ───────────────────────────────────────────────────────────

await test("branch name is deterministic and not derived from Issue title", () => {
  const a = worktree.buildGithubAutomationBranchName({
    repositoryId: 602362837,
    issueNumber: 42,
    generation: 1,
  });
  const b = worktree.buildGithubAutomationBranchName({
    repositoryId: 602362837,
    issueNumber: 42,
    generation: 1,
  });
  assert.equal(a, b);
  assert.match(a, /^ypi\/gha\/602362837\/issue-42\/g1$/);
  assert.ok(!a.includes("Fix the login bug"));
  assert.throws(
    () =>
      worktree.assertWorktreeNotControlledByIssue({
        issueProvidedBranch: "attacker",
      }),
    /branch/,
  );
});

await test("resolve project root requires Project Registry membership", async () => {
  const repoPath = mkdtempSync(join(tmpdir(), "gha06-repo-"));
  gitInit(repoPath);
  await registry.registerProject({ path: repoPath, displayName: "gha06-fixture" });

  const resolved = await worktree.resolveGithubAutomationProjectRoot({
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: 1,
    projectRoot: repoPath,
    ownerActorIds: [],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  });
  assert.ok(resolved.rootPath);
  assert.ok(resolved.projectId);
  assert.equal(resolved.baseRef, "main");

  await assert.rejects(
    () =>
      worktree.resolveGithubAutomationProjectRoot({
        repositoryId: 1,
        fullName: "x/y",
        installationId: null,
        projectRoot: join(tmpdir(), "not-registered-gha06"),
        ownerActorIds: [],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      }),
    /projectRoot|Registry|exist/i,
  );

  // Cleanup fixture repo is left for OS tmp; registry lives under agentDir.
});

await test("ensureGithubAutomationWorktree creates and reuses one path per generation", async () => {
  const repoPath = mkdtempSync(join(tmpdir(), "gha06-wt-"));
  gitInit(repoPath);
  await registry.registerProject({ path: repoPath, displayName: "gha06-wt" });

  const repository = {
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: 9,
    projectRoot: repoPath,
    ownerActorIds: [],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  };

  const first = await worktree.ensureGithubAutomationWorktree({
    repository,
    issueNumber: 7,
    generation: 1,
  });
  assert.equal(first.created, true);
  assert.equal(existsSync(first.worktreePath), true);
  assert.match(first.branchName, /issue-7/);

  const second = await worktree.ensureGithubAutomationWorktree({
    repository,
    issueNumber: 7,
    generation: 1,
    existingWorktreePath: first.worktreePath,
    existingBranchName: first.branchName,
  });
  assert.equal(second.reused, true);
  assert.equal(second.worktreePath, first.worktreePath);
});

// ─── Studio session binding ──────────────────────────────────────────────────

await test("ensure unattended Studio task records owner+policy without interactive grant", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gha06-studio-"));
  const repository = {
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: 1,
    projectRoot: cwd,
    ownerActorIds: [99],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  };

  const ensured = session.ensureGithubUnattendedStudioTask({
    worktreePath: cwd,
    repository,
    issueNumber: 11,
    issueTitlePreview: "docs: fix typo",
    jobId: "job-test-11",
    generation: 1,
    owner: {
      ownerActorId: 99,
      ownerCommentId: 1001,
      ownerCommentHash: session.hashGithubOwnerCommentForAuthorization("可以做"),
      matchedPhrase: "可以做",
    },
    uiGate: "pass",
  });

  assert.equal(ensured.created, true);
  assert.equal(ensured.authorized, true);
  assert.equal(ensured.task.meta.executionMode, "github_unattended");
  assert.equal(ensured.task.meta.ownerAuthorization.claimStatus, "complete");
  assert.equal(ensured.task.meta.policyGrant.source, "policy-engine");
  assert.equal(ensured.task.meta.approvalGrant, undefined);
  assertNoSentinel(ensured.task.meta, "task meta");

  const prompt = session.buildGithubFullAgentPromptEnvelope({
    member: "implementer",
    taskId: ensured.task.id,
    issueNumber: 11,
    repositoryFullName: "602362837/yolk-pi-web",
    instructions: "Edit docs only.",
    untrustedIssueExcerpt: "title: docs fix",
  });
  assert.ok(prompt.includes("UNTRUSTED_GITHUB_ISSUE_DATA"));
  assert.ok(prompt.includes("not sandboxed") || prompt.includes("Residual risk"));
  assert.ok(!prompt.includes(INSTALL_TOKEN_SENTINEL));
  assert.throws(
    () =>
      session.buildGithubFullAgentPromptEnvelope({
        member: "implementer",
        taskId: ensured.task.id,
        issueNumber: 11,
        repositoryFullName: "602362837/yolk-pi-web",
        instructions: `token ${INSTALL_TOKEN_SENTINEL}`,
      }),
    /secret injection/,
  );

  // Transition to implementing with plan artifacts
  const policyHash = session.buildGithubUnattendedPolicyHash({});
  const implementing = session.transitionGithubUnattendedTaskToImplementing({
    worktreePath: cwd,
    taskId: ensured.task.id,
    issueNumber: 11,
    repositoryId: 602362837,
    policyHash,
  });
  assert.equal(implementing.status, "implementing");

  const inspect = runner.inspectGithubUnattendedTaskAuthorization({
    worktreePath: cwd,
    taskId: ensured.task.id,
  });
  assert.equal(inspect.exists, true);
  assert.equal(inspect.authorized, true);
  assert.equal(inspect.hasApprovalGrant, false);
});

await test("UI fail-closed policyGrant cannot authorize implementing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gha06-ui-block-"));
  const repository = {
    repositoryId: 1,
    fullName: "o/r",
    installationId: 1,
    projectRoot: cwd,
    ownerActorIds: [1],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  };
  const ensured = session.ensureGithubUnattendedStudioTask({
    worktreePath: cwd,
    repository,
    issueNumber: 3,
    issueTitlePreview: "UI redesign",
    jobId: "job-ui-3",
    generation: 1,
    owner: {
      ownerActorId: 1,
      ownerCommentId: 2,
      ownerCommentHash: "abc",
    },
    uiGate: "blocked_manual_ui_approval",
  });
  assert.equal(ensured.authorized, false);
  assert.equal(ensured.authorizationReasonCode, "blocked_manual_ui_approval");
});

// ─── Runner gates / pause / retry ────────────────────────────────────────────

await test("start gates require unattended mode, complete claim, allowlist root", async () => {
  await store.ensureGithubAutomationStoreLayout();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 55,
    installationId: 1,
    deliveryId: null,
    issueTitlePreview: "docs",
  });

  const defaultCfg = configMod.createDefaultGithubAutomationConfig();
  let gates = await runner.evaluateGithubUnattendedStartGates({
    job,
    config: defaultCfg,
    claimComplete: true,
  });
  assert.equal(gates.ok, false);
  assert.ok(
    ["automation_disabled", "mode_not_unattended", "unattended_disabled"].includes(
      gates.reasonCode,
    ),
  );

  const cfg = {
    ...defaultCfg,
    enabled: true,
    mode: "unattended",
    unattended: {
      ...defaultCfg.unattended,
      enabled: true,
    },
    repositories: [
      {
        ...defaultCfg.repositories[0],
        projectRoot: "",
        installationId: 1,
      },
    ],
  };
  gates = await runner.evaluateGithubUnattendedStartGates({
    job,
    config: cfg,
    claimComplete: false,
  });
  assert.equal(gates.ok, false);
  assert.equal(gates.reasonCode, "incomplete_claim");

  gates = await runner.evaluateGithubUnattendedStartGates({
    job,
    config: cfg,
    claimComplete: true,
  });
  assert.equal(gates.ok, false);
  assert.equal(gates.reasonCode, "project_root_missing");
});

await test("queue without unattended parks at accepted_waiting_automation (P0 path)", async () => {
  await store.ensureGithubAutomationStoreLayout();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 56,
    installationId: 1,
    deliveryId: null,
    issueTitlePreview: "docs",
  });
  const cfg = configMod.createDefaultGithubAutomationConfig();
  const result = await runner.queueGithubUnattendedImplementation({
    job,
    config: {
      ...cfg,
      enabled: true,
      mode: "triage",
      unattended: { ...cfg.unattended, enabled: false },
    },
    owner: {
      ownerActorId: 1,
      ownerCommentId: 2,
      ownerCommentHash: "h",
    },
    claimComplete: true,
  });
  assert.equal(result.job.phase, "accepted_waiting_automation");
  assert.equal(result.job.status, "completed");
  assert.ok(!result.job.checkpoint || result.job.checkpoint === "accepted_waiting_automation");
});

await test("pause request and retry wake keep injectsCommentText=false", async () => {
  await store.ensureGithubAutomationStoreLayout();
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 57,
    installationId: 1,
    deliveryId: null,
    issueTitlePreview: "docs",
  });
  // Seed runner state
  runner.writeGithubAutomationRunnerState({
    schemaVersion: 1,
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    generation: job.generation,
    checkpoint: "implementing",
    worktreePath: null,
    branchName: null,
    baseRef: null,
    projectId: null,
    taskId: null,
    sessionId: null,
    contextId: null,
    sessionFile: null,
    scopeFingerprint: null,
    ownerActorId: 1,
    ownerCommentId: 2,
    ownerCommentHash: "h",
    lastMember: null,
    lastRunId: null,
    pauseRequested: false,
    updatedAt: new Date().toISOString(),
    reasonCode: null,
  });

  const paused = await runner.requestGithubUnattendedJobPause(job.jobId);
  assert.equal(paused.pauseRequested, true);

  const woken = await runner.wakeGithubUnattendedJobForRetry({
    job: { ...job, phase: "paused", status: "paused" },
  });
  assert.equal(woken.status, "queued");
  assert.equal(woken.reasonCode, "retry_wake");
  assertNoSentinel(woken, "woken job");
});

await test("runner state refuses secret markers", () => {
  assert.throws(
    () =>
      runner.writeGithubAutomationRunnerState({
        schemaVersion: 1,
        jobId: "x",
        repositoryId: 1,
        issueNumber: 1,
        generation: 1,
        checkpoint: "implementing",
        worktreePath: null,
        branchName: null,
        baseRef: null,
        projectId: null,
        taskId: null,
        sessionId: null,
        contextId: null,
        sessionFile: null,
        scopeFingerprint: null,
        ownerActorId: null,
        ownerCommentId: null,
        ownerCommentHash: null,
        lastMember: null,
        lastRunId: null,
        pauseRequested: false,
        updatedAt: new Date().toISOString(),
        reasonCode: INSTALL_TOKEN_SENTINEL,
      }),
    /secret markers/,
  );
});

await test("source modules document residual risk and do not claim host isolation", () => {
  for (const rel of [
    "lib/github-full-agent-profile.ts",
    "lib/github-automation-runner.ts",
    "lib/github-automation-session.ts",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.ok(
      /not sandboxed|不是沙箱|residual risk|残留风险/i.test(src),
      `${rel} must document residual risk`,
    );
    assert.ok(
      !/host filesystem is isolated|fully sandboxed host|complete host isolation/i.test(src),
      `${rel} must not falsely claim host isolation`,
    );
  }
  // Agent session path must still not import publisher (server-only via runner).
  const session = readFileSync(join(root, "lib/github-automation-session.ts"), "utf8");
  assert.ok(!/github-git-publisher/.test(session));
  // Runner owns publisher after GHA-07; agent member path must not expose it as a tool.
  const runner = readFileSync(join(root, "lib/github-automation-runner.ts"), "utf8");
  assert.ok(/github-git-publisher/.test(runner), "runner must call server publisher after final gates");
  assert.ok(
    /Do not push, open PRs|Server publisher handles publish/i.test(runner),
    "agent instructions must still forbid self-publish",
  );
  // Triage still must not import git-worktree directly (uses runner).
  const triage = readFileSync(join(root, "lib/github-issue-triage-runner.ts"), "utf8");
  assert.ok(!/from\s+["'][^"']*git-worktree/.test(triage));
  assert.ok(triage.includes("github-automation-runner"));
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

runner._testResetGithubUnattendedInFlight?.();

console.log("");
console.log(`passed=${passed} failed=${failed}`);

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // ignore
}

if (failed > 0) process.exitCode = 1;
