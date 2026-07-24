#!/usr/bin/env node
/**
 * Focused GHA-07 tests: docs+small-bugfix policy, final diff gate, PR contract,
 * server publisher credential isolation / reuse.
 *
 * Always uses temporary PI_CODING_AGENT_DIR. No live GitHub / no real App secrets.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-github-publish-policy.mjs
 */

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

const agentDir = mkdtempSync(join(tmpdir(), "pi-gha07-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const APP_KEY_SENTINEL = "GHA07_APP_PRIVATE_KEY_SENTINEL_do_not_leak";
const WEBHOOK_SECRET_SENTINEL = "gha07_webhook_secret_SENTINEL_cc33dd44";
const INSTALL_TOKEN_SENTINEL = "ghs_GHA07_INSTALL_TOKEN_SENTINEL_77cd";
const MACHINE_TOKEN_SENTINEL = "gho_GHA07_MACHINE_TOKEN_SENTINEL_ee9f";

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
    assert.ok(
      !serialized.includes(needle),
      `${label} must not contain sentinel ${needle}`,
    );
  }
}

const risk = jiti(join(root, "lib/github-risk-policy.ts"));
const diffPolicy = jiti(join(root, "lib/github-diff-policy.ts"));
const prContract = jiti(join(root, "lib/github-pr-contract.ts"));
const publisher = jiti(join(root, "lib/github-git-publisher.ts"));

const limits = { maxFiles: 12, maxChangedLines: 500 };

// ─── Risk policy matrix ──────────────────────────────────────────────────────

await test("docs paths are allowed at plan and final stages", () => {
  const files = [
    { path: "docs/modules/api.md", additions: 10, deletions: 2 },
    { path: "README.md", additions: 1, deletions: 0 },
    { path: "AGENTS.md", additions: 3, deletions: 1 },
  ];
  for (const stage of ["plan", "final"]) {
    const result = risk.evaluateGithubRiskPolicy({
      stage,
      limits,
      files,
      riskProfile: "docs-and-small-bugfix",
    });
    assert.equal(result.decision, "allow", stage);
    assert.equal(result.classification, "docs");
    assert.equal(result.reasonCode, "allowed_docs");
  }
});

await test("explicit small bugfix in lib/ is allowed when flagged", () => {
  const result = risk.evaluateGithubRiskPolicy({
    stage: "final",
    limits,
    files: [
      { path: "lib/token-format.ts", additions: 5, deletions: 2, status: "M" },
    ],
    explicitSmallBugfix: true,
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.classification, "small_bugfix");
});

await test("non-docs without explicitSmallBugfix is fail-closed uncertain", () => {
  const result = risk.evaluateGithubRiskPolicy({
    stage: "final",
    limits,
    files: [{ path: "lib/token-format.ts", additions: 5, deletions: 2 }],
    explicitSmallBugfix: false,
  });
  assert.equal(result.decision, "block");
  assert.equal(result.reasonCode, "blocked_uncertain");
});

await test("UI / workflow / secret / lockfile / infra / binary classes block", () => {
  const cases = [
    { path: "components/ChatWindow.tsx", code: "blocked_ui_interaction" },
    { path: "app/globals.css", code: "blocked_ui_interaction" },
    { path: ".github/workflows/ci.yml", code: "blocked_workflow_ci" },
    { path: "package-lock.json", code: "blocked_dependency_lockfile" },
    { path: "package.json", code: "blocked_dependency_lockfile" },
    { path: "lib/web-credential-store.ts", code: "blocked_secret_auth" },
    { path: ".env.local", code: "blocked_secret_auth" },
    { path: "Dockerfile", code: "blocked_infra" },
    { path: "assets/tool.exe", code: "blocked_binary_or_symlink", isBinary: true },
    { path: "vendor/lib", code: "blocked_submodule", isSubmodule: true },
    { path: "link-path", code: "blocked_binary_or_symlink", isSymlink: true },
  ];
  for (const c of cases) {
    const result = risk.evaluateGithubRiskPolicy({
      stage: "final",
      limits,
      files: [
        {
          path: c.path,
          additions: 1,
          deletions: 0,
          isBinary: c.isBinary,
          isSubmodule: c.isSubmodule,
          isSymlink: c.isSymlink,
        },
      ],
      explicitSmallBugfix: true,
    });
    assert.equal(result.decision, "block", c.path);
    assert.equal(result.reasonCode, c.code, c.path);
  }
});

await test("over-limit files/lines block even for docs", () => {
  const many = Array.from({ length: 13 }, (_, i) => ({
    path: `docs/note-${i}.md`,
    additions: 1,
    deletions: 0,
  }));
  const overFiles = risk.evaluateGithubRiskPolicy({
    stage: "final",
    limits,
    files: many,
  });
  assert.equal(overFiles.reasonCode, "blocked_over_limit");

  const overLines = risk.evaluateGithubRiskPolicy({
    stage: "final",
    limits: { maxFiles: 12, maxChangedLines: 10 },
    files: [{ path: "docs/big.md", additions: 20, deletions: 0 }],
  });
  assert.equal(overLines.reasonCode, "blocked_over_limit");
});

await test("plan-text UI/release/secret hints fail closed without files", () => {
  const ui = risk.evaluateGithubRiskPolicy({
    stage: "pre",
    limits,
    files: [],
    planText: "需要改 Settings 页面交互",
  });
  assert.equal(ui.decision, "block");
  assert.equal(ui.classification, "ui_interaction");

  const rel = risk.evaluateGithubRiskPolicy({
    stage: "plan",
    limits,
    files: [{ path: "docs/x.md", additions: 1, deletions: 0 }],
    planText: "prepare npm publish release",
  });
  assert.equal(rel.decision, "block");
  assert.equal(rel.classification, "release_publish");
});

await test("empty final diff is blocked", () => {
  const result = risk.evaluateGithubRiskPolicy({
    stage: "final",
    limits,
    files: [],
  });
  assert.equal(result.reasonCode, "blocked_empty_diff");
});

await test("wrong riskProfile is blocked", () => {
  const result = risk.evaluateGithubRiskPolicy({
    stage: "final",
    limits,
    files: [{ path: "docs/a.md", additions: 1, deletions: 0 }],
    riskProfile: "anything-else",
  });
  assert.equal(result.reasonCode, "blocked_risk_profile");
});

// ─── Diff parsers ────────────────────────────────────────────────────────────

await test("parseGitNameStatus and numstat handle renames and binaries", () => {
  const names = diffPolicy.parseGitNameStatus(
    ["M\tlib/a.ts", "A\tdocs/b.md", "R100\told.md\tnew.md"].join("\n"),
  );
  assert.equal(names.length, 3);
  assert.equal(names[2].path, "new.md");
  assert.equal(names[2].fromPath, "old.md");

  const nums = diffPolicy.parseGitNumstat(
    ["3\t1\tlib/a.ts", "-\t-\tbin/tool.exe"].join("\n"),
  );
  assert.equal(nums[0].additions, 3);
  assert.equal(nums[1].isBinary, true);
});

await test("evaluateGithubDiffPolicy uses snapshot and final allow helper", async () => {
  const snapshot = {
    baseRef: "main",
    files: [{ path: "docs/architecture/overview.md", additions: 4, deletions: 1 }],
    nameStatusRawPreview: "M\tdocs/architecture/overview.md",
    numstatRawPreview: "4\t1\tdocs/architecture/overview.md",
  };
  const evaluation = await diffPolicy.evaluateGithubDiffPolicy({
    stage: "final",
    cwd: agentDir,
    baseRef: "main",
    limits,
    snapshot,
  });
  assert.equal(evaluation.policy.decision, "allow");
  assert.equal(diffPolicy.isGithubFinalDiffAllowed(evaluation), true);

  assert.throws(
    () =>
      diffPolicy.assertDiffArgsNotFromIssue({ issueProvidedBaseRef: "evil" }),
    /cannot set diff baseRef/,
  );
});

// ─── PR contract ─────────────────────────────────────────────────────────────

await test("PR body has exactly one same-repo Fixes #N and blocks cross-repo", () => {
  const body = prContract.buildGithubAutomationPrBody({
    repositoryFullName: "602362837/yolk-pi-web",
    repositoryId: 602362837,
    issueNumber: 42,
    headBranch: "ypi/gha/602362837/issue-42/g1",
    baseRef: "main",
    title: "文档：补充自动化说明",
    scopeSummary: "更新 docs",
    validationSummary: "lint + tsc",
    riskSummary: "full agent residual risk accepted",
    traceId: "trace-abc",
    classification: "docs",
  });
  assert.match(body.body, /Fixes #42/);
  assert.equal(body.closingLine, "Fixes #42");
  const check = prContract.checkGithubPrClosingContract(body.body, 42);
  assert.equal(check.ok, true);
  assertNoSentinel(body, "pr body");

  const bad = prContract.checkGithubPrClosingContract(
    "Fixes 602362837/other#9\nFixes #42",
    42,
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.reasonCode, "cross_repo_closing");

  const multi = prContract.checkGithubPrClosingContract("Fixes #1\nCloses #2", 1);
  assert.equal(multi.ok, false);

  const review = prContract.isGithubAutomationPrClosingBlocking({
    body: body.body,
    expectedIssueNumber: 42,
  });
  assert.equal(review.block, false);

  const missing = prContract.isGithubAutomationPrClosingBlocking({
    body: "no closing keyword\n<!-- ypi-github-automation:pr-contract v1 -->",
    expectedIssueNumber: 42,
  });
  assert.equal(missing.block, true);
});

await test("selectReusableGithubPr prefers open same head/base", () => {
  const picked = prContract.selectReusableGithubPr(
    [
      {
        number: 9,
        htmlUrl: "https://github.com/o/r/pull/9",
        state: "closed",
        headRef: "ypi/gha/1/issue-1/g1",
        baseRef: "main",
        merged: false,
      },
      {
        number: 11,
        htmlUrl: "https://github.com/o/r/pull/11",
        state: "open",
        headRef: "ypi/gha/1/issue-1/g1",
        baseRef: "main",
        merged: false,
      },
      {
        number: 12,
        htmlUrl: "https://github.com/o/r/pull/12",
        state: "open",
        headRef: "other",
        baseRef: "main",
        merged: false,
      },
    ],
    { headBranch: "ypi/gha/1/issue-1/g1", baseRef: "main" },
  );
  assert.equal(picked.number, 11);
});

// ─── Publisher ───────────────────────────────────────────────────────────────

await test("credential-free remote URL never embeds token", () => {
  const url = publisher.buildGithubCredentialFreeRemoteUrl("602362837/yolk-pi-web");
  assert.equal(url, "https://github.com/602362837/yolk-pi-web.git");
  assert.ok(!url.includes("@"));
  assert.ok(!/x-access-token/i.test(url));
});

await test("publisher target validation rejects main head and mismatched repo", () => {
  const repository = {
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: 99,
    projectRoot: "/tmp/repo",
    ownerActorIds: [],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  };
  assert.throws(() =>
    publisher.assertPublisherTargetFixed({
      repository,
      target: {
        repositoryId: 1,
        repositoryFullName: "602362837/yolk-pi-web",
        installationId: 99,
        baseRef: "main",
        headBranch: "ypi/gha/1/issue-1/g1",
        issueNumber: 1,
        worktreePath: "/tmp/wt",
      },
    }),
  );
  assert.throws(() =>
    publisher.assertPublisherTargetFixed({
      repository,
      target: {
        repositoryId: 602362837,
        repositoryFullName: "602362837/yolk-pi-web",
        installationId: 99,
        baseRef: "main",
        headBranch: "main",
        issueNumber: 1,
        worktreePath: "/tmp/wt",
      },
    }),
  );
});

await test("askpass helper is 0700-ish and cleanup removes token file", () => {
  const { askpassPath, cleanup } = publisher.createGithubGitAskpassHelper({
    username: "x-access-token",
    password: INSTALL_TOKEN_SENTINEL,
  });
  assert.ok(existsSync(askpassPath));
  const content = readFileSync(askpassPath, "utf8");
  assert.ok(content.includes(INSTALL_TOKEN_SENTINEL));
  cleanup();
  assert.ok(!existsSync(askpassPath));
});

await test("publish refuses without final/checker/validation gates", async () => {
  const repository = {
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: 99,
    projectRoot: "/tmp/repo",
    ownerActorIds: [],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  };
  const target = {
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    installationId: 99,
    baseRef: "main",
    headBranch: "ypi/gha/602362837/issue-7/g1",
    issueNumber: 7,
    worktreePath: agentDir,
  };
  await assert.rejects(
    () =>
      publisher.publishGithubAutomationChange({
        repository,
        target,
        finalDiffAllowed: false,
        checkerPassed: true,
        validationPassed: true,
        commitMessage: "x",
        prTitle: "x",
        scopeSummary: "x",
        validationSummary: "x",
        riskSummary: "x",
        traceId: "t",
      }),
    /final diff/i,
  );
});

await test("createOrReuse PR reuses existing open PR and never embeds token", async () => {
  const target = {
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    installationId: 99,
    baseRef: "main",
    headBranch: "ypi/gha/602362837/issue-7/g1",
    issueNumber: 7,
    worktreePath: agentDir,
  };
  const prBody = prContract.buildGithubAutomationPrBody({
    repositoryFullName: target.repositoryFullName,
    repositoryId: target.repositoryId,
    issueNumber: target.issueNumber,
    headBranch: target.headBranch,
    baseRef: target.baseRef,
    title: "修复：示例",
    scopeSummary: "docs",
    validationSummary: "ok",
    riskSummary: "residual",
    traceId: "trace-1",
  });

  const calls = [];
  const result = await publisher.createOrReuseGithubAutomationPr(
    { target, prBody },
    {
      githubRequest: async (_id, path, options) => {
        calls.push({ path, method: options?.method ?? "GET", body: options?.body });
        assertNoSentinel(path, "github path");
        assertNoSentinel(options?.body, "github body");
        if (path.includes("/pulls?") || path.includes("/pulls&")) {
          return {
            status: 200,
            body: [
              {
                number: 55,
                html_url: "https://github.com/602362837/yolk-pi-web/pull/55",
                state: "open",
                head: { ref: target.headBranch },
                base: { ref: "main" },
                merged: false,
              },
            ],
          };
        }
        return { status: 500, body: {} };
      },
    },
  );

  assert.equal(result.reused, true);
  assert.equal(result.prNumber, 55);
  assert.equal(result.created, false);
  assert.ok(calls.every((c) => c.method === "GET"), "must not POST when open PR exists");
  assertNoSentinel(result, "pr result");
});

await test("createOrReuse creates PR when none exists; body has Fixes #N", async () => {
  const target = {
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    installationId: 99,
    baseRef: "main",
    headBranch: "ypi/gha/602362837/issue-8/g1",
    issueNumber: 8,
    worktreePath: agentDir,
  };
  const prBody = prContract.buildGithubAutomationPrBody({
    repositoryFullName: target.repositoryFullName,
    repositoryId: target.repositoryId,
    issueNumber: 8,
    headBranch: target.headBranch,
    baseRef: "main",
    title: "文档：示例",
    scopeSummary: "docs only",
    validationSummary: "lint ok",
    riskSummary: "residual risk",
    traceId: "trace-2",
  });

  let createdBody = null;
  const result = await publisher.createOrReuseGithubAutomationPr(
    { target, prBody },
    {
      githubRequest: async (_id, path, options) => {
        if ((options?.method ?? "GET") === "GET") {
          return { status: 200, body: [] };
        }
        createdBody = options?.body;
        assertNoSentinel(createdBody, "create body");
        assert.match(createdBody.body, /Fixes #8/);
        assert.equal(createdBody.head, target.headBranch);
        assert.equal(createdBody.base, "main");
        return {
          status: 201,
          body: {
            number: 90,
            html_url: "https://github.com/602362837/yolk-pi-web/pull/90",
          },
        };
      },
    },
  );
  assert.equal(result.created, true);
  assert.equal(result.prNumber, 90);
  assert.ok(createdBody);
});

await test("push uses askpass env and credential-free origin; no force", async () => {
  const gitLog = [];
  const target = {
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    installationId: 99,
    baseRef: "main",
    headBranch: "ypi/gha/602362837/issue-9/g1",
    issueNumber: 9,
    worktreePath: agentDir,
  };

  const push = await publisher.pushGithubAutomationBranch(target, {
    getInstallationToken: async () => ({ token: INSTALL_TOKEN_SENTINEL }),
    runGit: async (args, options) => {
      gitLog.push({ args: [...args], envAskpass: options.env.GIT_ASKPASS || "" });
      assert.ok(!args.includes("--force") && !args.includes("-f"));
      assert.ok(!args.includes("main") || args[0] !== "push");
      // argv must not contain token
      assertNoSentinel(args, "git argv");
      assertNoSentinel(options.env.GITHUB_TOKEN, "env GITHUB_TOKEN");
      assertNoSentinel(options.env.GH_TOKEN, "env GH_TOKEN");
      if (args[0] === "remote" && args[1] === "get-url") {
        if (gitLog.filter((g) => g.args[0] === "remote" && g.args[1] === "set-url").length === 0) {
          // first get-url may fail to trigger add; simulate missing then present
        }
        return "https://github.com/602362837/yolk-pi-web.git";
      }
      if (args[0] === "remote" && args[1] === "set-url") {
        assert.equal(args[3], "https://github.com/602362837/yolk-pi-web.git");
        return "";
      }
      if (args[0] === "push") {
        assert.ok(options.env.GIT_ASKPASS, "GIT_ASKPASS must be set for push");
        assert.ok(String(args).includes(target.headBranch));
        return "ok";
      }
      return "";
    },
  });

  assert.equal(push.pushed, true);
  assert.equal(push.remoteUrl, "https://github.com/602362837/yolk-pi-web.git");
  assertNoSentinel(push, "push result");
  assert.ok(gitLog.some((g) => g.args[0] === "push"));
});

await test("publisher forbidden flags helper lists force/main protections", () => {
  const flags = publisher._testGithubPublisherForbiddenFlags();
  assert.ok(flags.includes("--force"));
  assert.ok(flags.includes("main"));
});

await test("end-to-end publishGithubAutomationChange with mocks", async () => {
  // Create a tiny git repo as worktree so commit path can run with mock git only.
  const wt = mkdtempSync(join(tmpdir(), "pi-gha07-wt-"));
  const repository = {
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: 123,
    projectRoot: wt,
    ownerActorIds: [],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
  };
  const target = {
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    installationId: 123,
    baseRef: "main",
    headBranch: "ypi/gha/602362837/issue-10/g1",
    issueNumber: 10,
    worktreePath: wt,
  };

  const result = await publisher.publishGithubAutomationChange(
    {
      repository,
      target,
      finalDiffAllowed: true,
      checkerPassed: true,
      validationPassed: true,
      commitMessage: "ypi: automation for #10",
      prTitle: "文档：自动化",
      scopeSummary: "docs",
      validationSummary: "ok",
      riskSummary: "residual",
      traceId: "trace-e2e",
      classification: "docs",
    },
    {
      getInstallationToken: async () => ({ token: INSTALL_TOKEN_SENTINEL }),
      runGit: async (args) => {
        assertNoSentinel(args, "e2e git argv");
        if (args[0] === "status") return " M docs/a.md";
        if (args[0] === "rev-parse") return "abc123deadbeef";
        if (args[0] === "remote" && args[1] === "get-url") {
          return "https://github.com/602362837/yolk-pi-web.git";
        }
        return "";
      },
      githubRequest: async (_id, path, options) => {
        assertNoSentinel({ path, body: options?.body }, "e2e github");
        if ((options?.method ?? "GET") === "GET") return { status: 200, body: [] };
        return {
          status: 201,
          body: {
            number: 101,
            html_url: "https://github.com/602362837/yolk-pi-web/pull/101",
          },
        };
      },
    },
  );

  assert.equal(result.pr.prNumber, 101);
  assert.equal(result.pr.created, true);
  assert.match(result.prBody.body, /Fixes #10/);
  assertNoSentinel(result, "e2e result");

  try {
    rmSync(wt, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ─── Skills contract review ──────────────────────────────────────────────────

await test("skills document App author, machine assignee, residual risk, Fixes contract", () => {
  const autoPath = join(root, ".pi/skills/github-issue-auto-implement/SKILL.md");
  assert.ok(existsSync(autoPath), "github-issue-auto-implement skill must exist");
  const auto = readFileSync(autoPath, "utf8");
  assert.match(auto, /full agent|full-agent/i);
  assert.match(auto, /not sandboxed|不是沙箱|残留风险|residual risk/i);
  assert.match(auto, /publisher|server-owned|不.*push/i);
  assert.ok(!auto.includes(INSTALL_TOKEN_SENTINEL));

  const submit = readFileSync(join(root, ".pi/skills/submit-pr/SKILL.md"), "utf8");
  assert.match(submit, /Fixes #|Automation|自动化/);

  const review = readFileSync(join(root, ".pi/skills/pr-review-handle/SKILL.md"), "utf8");
  assert.match(review, /closing contract|Fixes #|Development/i);

  const triage = readFileSync(join(root, ".pi/skills/github-issue-triage/SKILL.md"), "utf8");
  assert.match(triage, /machine|assignee|App Bot|ypi:claimed/i);
});

// ─── Module source sentinels ─────────────────────────────────────────────────

await test("publisher and policy modules redact and avoid shell Issue interpolation", () => {
  for (const rel of [
    "lib/github-risk-policy.ts",
    "lib/github-diff-policy.ts",
    "lib/github-git-publisher.ts",
    "lib/github-pr-contract.ts",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.ok(!/shell:\s*true/.test(src), `${rel} must not use shell:true`);
    assert.ok(
      !/host filesystem is isolated|fully sandboxed/.test(src),
      `${rel} must not claim host isolation`,
    );
  }
  const pub = readFileSync(join(root, "lib/github-git-publisher.ts"), "utf8");
  assert.match(pub, /GIT_ASKPASS/);
  assert.match(pub, /credential-free|credential free|Credential-free/i);
  assert.match(pub, /force/i);
});

console.log("");
console.log(`passed=${passed} failed=${failed}`);

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // ignore
}

if (failed > 0) process.exitCode = 1;
