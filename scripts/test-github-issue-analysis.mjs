#!/usr/bin/env node
/**
 * Focused GIA-02 tests: contained read-only evidence controller + strict model analyzer.
 *
 * Uses temporary directories only. Never reads ~/.pi/agent, never calls real GitHub/providers.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-github-issue-analysis.mjs
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

const agentDir = mkdtempSync(join(tmpdir(), "pi-gia02-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const types = jiti(join(root, "lib/github-issue-analysis-types.ts"));
const evidenceMod = jiti(join(root, "lib/github-issue-analysis-evidence.ts"));
const modelMod = jiti(join(root, "lib/github-issue-analysis-model.ts"));

const {
  ISSUE_ANALYSIS_LIMITS,
  parseIssueAnalysisModelAction,
  parseIssueAnalysisModelActionFromText,
  postValidateIssueAnalysisFinal,
  buildInconclusiveIssueAnalysisResult,
} = types;

const {
  IssueAnalysisEvidenceController,
  boundIssueAnalysisClaim,
  normalizeRelativePath,
  isSecretLikeBasename,
  isExcludedDirName,
} = evidenceMod;

const { runIssueAnalysis, resolveIssueAnalysisModelReadiness } = modelMod;

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pi-gia02-repo-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
  mkdirSync(join(dir, ".git", "objects"), { recursive: true });
  mkdirSync(join(dir, ".ypi", "sessions"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "src", "app.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\n", "utf8");
  writeFileSync(join(dir, "src", "bug.ts"), "export const KNOWN = 'stable-contract-v1';\n// authoritative: feature is implemented\n", "utf8");
  writeFileSync(join(dir, "docs", "api.md"), "# API\n\nadd(a,b) returns sum.\n", "utf8");
  writeFileSync(join(dir, "README.md"), "# demo\n", "utf8");
  writeFileSync(join(dir, ".env"), "SECRET=super-secret\n", "utf8");
  writeFileSync(join(dir, "auth.json"), "{\"token\":\"x\"}\n", "utf8");
  writeFileSync(join(dir, "private.pem"), "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n", "utf8");
  writeFileSync(join(dir, "node_modules", "left-pad", "index.js"), "module.exports=x=>x\n", "utf8");
  writeFileSync(join(dir, ".git", "objects", "pack"), "packdata\n", "utf8");
  writeFileSync(join(dir, ".ypi", "sessions", "index.v1.json"), "{}\n", "utf8");
  writeFileSync(join(dir, "dist", "bundle.js"), "console.log(1)\n", "utf8");
  writeFileSync(join(dir, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 4, 5]));
  return dir;
}

function assertNoAbsLeak(value, rootPath) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(
    text.includes(rootPath),
    false,
    `absolute root leaked: ${rootPath}`,
  );
}

async function openController(repo, overrides = {}) {
  const opened = await IssueAnalysisEvidenceController.open({
    projectRoot: repo,
    ...overrides,
  });
  assert.equal(opened instanceof IssueAnalysisEvidenceController, true, "controller open failed");
  return opened;
}

console.log("GIA-02 issue analysis focused tests\n");

await runCase("normalize rejects absolute/url/dotdot/backslash/NUL", () => {
  for (const bad of [
    "/etc/passwd",
    "../secret",
    "foo/../../etc",
    "C:\\\\Windows",
    "foo\\bar",
    "file://x",
    "https://example.com/a",
    "a\0b",
    "",
  ]) {
    const r = normalizeRelativePath(bad);
    assert.equal(r.ok, false, bad);
  }
  assert.deepEqual(normalizeRelativePath("."), { ok: true, relativePath: "." });
  assert.deepEqual(normalizeRelativePath("./src/app.ts"), {
    ok: true,
    relativePath: "src/app.ts",
  });
});

await runCase("secret-like and excluded dir helpers", () => {
  assert.equal(isSecretLikeBasename(".env"), true);
  assert.equal(isSecretLikeBasename(".env.local"), true);
  assert.equal(isSecretLikeBasename("auth.json"), true);
  assert.equal(isSecretLikeBasename("private.pem"), true);
  assert.equal(isSecretLikeBasename("my-token.txt"), true);
  assert.equal(isSecretLikeBasename("app.ts"), false);
  assert.equal(isExcludedDirName("node_modules"), true);
  assert.equal(isExcludedDirName(".git"), true);
  assert.equal(isExcludedDirName("src"), false);
});

await runCase("list root hides excluded/secret entries", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const result = await c.execute({ action: "list", path: "." });
    assert.equal(result.ok, true);
    assert.equal(result.entries.includes("src/"), true);
    assert.equal(result.entries.includes("README.md"), true);
    assert.equal(result.entries.includes("node_modules/"), false);
    assert.equal(result.entries.includes(".git/"), false);
    assert.equal(result.entries.includes(".ypi/"), false);
    assert.equal(result.entries.includes("dist/"), false);
    assert.equal(result.entries.includes(".env"), false);
    assert.equal(result.entries.includes("auth.json"), false);
    assert.equal(result.entries.includes("private.pem"), false);
    assertNoAbsLeak(result, repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("rejects absolute/.. path without leaking root", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    for (const path of ["/etc/passwd", "../", "src/../../etc/passwd", "node_modules/left-pad/index.js"]) {
      const result = await c.execute({ action: "read", path });
      assert.equal(result.ok, false, path);
      assert.ok(
        ["path_rejected", "excluded_directory", "secret_like_rejected"].includes(result.reasonCode),
        path + " " + result.reasonCode,
      );
      assertNoAbsLeak(result, repo);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("rejects symlink file and symlink dir escape", async () => {
  const repo = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), "pi-gia02-out-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "outside\n", "utf8");
    symlinkSync(join(outside, "secret.txt"), join(repo, "src", "link.ts"));
    symlinkSync(outside, join(repo, "escape-dir"));
    const c = await openController(repo);
    const fileLink = await c.execute({ action: "read", path: "src/link.ts" });
    assert.equal(fileLink.ok, false);
    assert.equal(fileLink.reasonCode, "symlink_rejected");
    const dirLink = await c.execute({ action: "list", path: "escape-dir" });
    assert.equal(dirLink.ok, false);
    assert.ok(["symlink_rejected", "path_rejected"].includes(dirLink.reasonCode));
    assertNoAbsLeak(fileLink, repo);
    assertNoAbsLeak(fileLink, outside);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

await runCase("rejects binary and secret-like reads", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const bin = await c.execute({ action: "read", path: "binary.bin" });
    assert.equal(bin.ok, false);
    assert.equal(bin.reasonCode, "binary_rejected");
    const env = await c.execute({ action: "read", path: ".env" });
    assert.equal(env.ok, false);
    assert.equal(env.reasonCode, "secret_like_rejected");
    const pem = await c.execute({ action: "read", path: "private.pem" });
    assert.equal(pem.ok, false);
    assert.equal(pem.reasonCode, "secret_like_rejected");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("read success creates ledger entry with relative path", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const result = await c.execute({ action: "read", path: "src/app.ts" });
    assert.equal(result.ok, true);
    assert.equal(result.relativePath, "src/app.ts");
    assert.match(result.evidenceId, /^ev_[a-f0-9]+$/);
    assert.equal(result.content.includes("export function add"), true);
    const entry = c.getLedgerEntry(result.evidenceId);
    assert.ok(entry);
    assert.equal(entry.relativePath, "src/app.ts");
    assert.equal(entry.operation, "read");
    assert.equal(entry.contentHash.length, 64);
    assertNoAbsLeak(result, repo);
    assertNoAbsLeak([...c.getLedgerSnapshot().values()], repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("grep hit creates ledger; miss does not invent contradicts", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const hit = await c.execute({ action: "grep", path: "src", pattern: "KNOWN" });
    assert.equal(hit.ok, true);
    assert.ok(hit.hits.length >= 1);
    assert.ok(c.getLedgerEntry(hit.hits[0].evidenceId));

    const miss = await c.execute({ action: "grep", path: "src", pattern: "this-string-is-absent-zzz" });
    assert.equal(miss.ok, true);
    assert.equal(miss.hits.length, 0);
    // miss must not add ledger rows
    assert.equal(c.getLedgerSnapshot().size, hit.hits.length);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("find glob returns relative matches and skips excluded", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const result = await c.execute({ action: "find", path: ".", pattern: "*.ts" });
    assert.equal(result.ok, true);
    assert.ok(result.entries.some((e) => e.endsWith(".ts")));
    assert.equal(result.entries.some((e) => e.includes("node_modules")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("operation budget exhausts safely", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    // Drain operation budget with list calls.
    for (let i = 0; i < ISSUE_ANALYSIS_LIMITS.maxEvidenceOperations; i++) {
      const r = await c.execute({ action: "list", path: "." });
      assert.equal(r.ok, true);
    }
    const blocked = await c.execute({ action: "list", path: "." });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reasonCode, "operation_budget_exceeded");
    assert.equal(c.isBudgetExhausted(), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("file read budget rejects oversized file", async () => {
  const repo = makeRepo();
  try {
    const big = "x".repeat(ISSUE_ANALYSIS_LIMITS.maxFileBytes + 10);
    writeFileSync(join(repo, "src", "big.ts"), big, "utf8");
    const c = await openController(repo);
    const result = await c.execute({ action: "read", path: "src/big.ts" });
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, "file_too_large");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("boundIssueAnalysisClaim marks truncation", () => {
  const claim = boundIssueAnalysisClaim({
    title: "t".repeat(ISSUE_ANALYSIS_LIMITS.maxIssueTitleChars + 5),
    body: "b".repeat(ISSUE_ANALYSIS_LIMITS.maxIssueBodyChars + 5),
    issueUpdatedAt: "2026-01-01T00:00:00.000Z",
    repositoryId: 1,
    issueNumber: 2,
  });
  assert.equal(claim.truncated, true);
  assert.equal(claim.titleTruncated, true);
  assert.equal(claim.bodyTruncated, true);
  assert.equal(claim.title.length, ISSUE_ANALYSIS_LIMITS.maxIssueTitleChars);
  assert.equal(claim.contentHash.length, 64);
});

await runCase("parse model action rejects extra keys and unknown actions", () => {
  assert.equal(parseIssueAnalysisModelAction({ action: "bash", command: "rm" }), null);
  assert.equal(
    parseIssueAnalysisModelAction({ action: "list", path: ".", extra: 1 }),
    null,
  );
  assert.equal(
    parseIssueAnalysisModelAction({ action: "final", category: "bug" }),
    null,
  );
  assert.deepEqual(parseIssueAnalysisModelAction({ action: "list", path: "src" }), {
    action: "list",
    path: "src",
  });
  const fromFence = parseIssueAnalysisModelActionFromText(
    "```json\n{\"action\":\"list\",\"path\":\".\"}\n```",
  );
  assert.deepEqual(fromFence, { action: "list", path: "." });
});

await runCase("post-validate: feature becomes not_applicable", () => {
  const ledger = new Map();
  const result = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "feature",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "not implemented yet",
      directionSummary: "build it",
      evidence: [],
    },
    ledger,
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(result.verdict, "not_applicable");
  assert.equal(result.mayClose, false);
});

await runCase("post-validate: grep-miss style empty contradicts cannot close", () => {
  const result = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "could not find the bug",
      directionSummary: "close it",
      evidence: [],
    },
    ledger: new Map(),
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.mayClose, false);
  assert.equal(result.reasonCode, "evidence_missing_contradicts");
});

await runCase("post-validate: unknown evidence id degrades", () => {
  const result = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "confirmed",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "found it",
      directionSummary: "fix",
      evidence: [
        { evidenceId: "ev_deadbeef01", relation: "supports", note: "here" },
      ],
    },
    ledger: new Map(),
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.reasonCode, "evidence_unknown");
  assert.equal(result.mayClose, false);
});

await runCase("post-validate: confirmed requires supports; not_exists needs 2 contradicts", () => {
  const ledger = new Map([
    [
      "ev_aaa1111101",
      {
        evidenceId: "ev_aaa1111101",
        relativePath: "src/bug.ts",
        lineStart: 1,
        lineEnd: 1,
        contentHash: "a".repeat(64),
        bytes: 10,
        operation: "read",
        observedAtMs: 1,
      },
    ],
    [
      "ev_bbb2222202",
      {
        evidenceId: "ev_bbb2222202",
        relativePath: "docs/api.md",
        lineStart: 1,
        lineEnd: 2,
        contentHash: "b".repeat(64),
        bytes: 10,
        operation: "read",
        observedAtMs: 2,
      },
    ],
  ]);

  const noSupport = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "confirmed",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "I think so",
      directionSummary: "fix",
      evidence: [],
    },
    ledger,
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(noSupport.verdict, "inconclusive");
  assert.equal(noSupport.reasonCode, "evidence_missing_supports");

  const oneContradict = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "contract denies",
      directionSummary: "close",
      evidence: [
        { evidenceId: "ev_aaa1111101", relation: "contradicts", note: "contract" },
      ],
    },
    ledger,
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(oneContradict.verdict, "inconclusive");
  assert.equal(oneContradict.mayClose, false);

  const twoContradict = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "contract and docs deny the bug",
      directionSummary: "no action",
      evidence: [
        { evidenceId: "ev_aaa1111101", relation: "contradicts", note: "contract" },
        { evidenceId: "ev_bbb2222202", relation: "contradicts", note: "docs" },
      ],
    },
    ledger,
    truncatedInput: false,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(twoContradict.verdict, "not_exists");
  assert.equal(twoContradict.mayClose, true);
  assert.equal(twoContradict.evidence.length, 2);
  assert.equal(twoContradict.evidence[0].relativePath, "src/bug.ts");

  const truncated = postValidateIssueAnalysisFinal({
    final: {
      action: "final",
      category: "bug",
      verdict: "not_exists",
      confidence: "high",
      coverage: "complete",
      reasonSummary: "contract and docs deny the bug",
      directionSummary: "no action",
      evidence: [
        { evidenceId: "ev_aaa1111101", relation: "contradicts", note: "contract" },
        { evidenceId: "ev_bbb2222202", relation: "contradicts", note: "docs" },
      ],
    },
    ledger,
    truncatedInput: true,
    budgetExhausted: false,
    complete: true,
  });
  assert.equal(truncated.verdict, "inconclusive");
  assert.equal(truncated.mayClose, false);
});

await runCase("model loop: valid action then final confirmed", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    let turn = 0;
    const outcome = await runIssueAnalysis({
      claim: {
        title: "add returns wrong value",
        body: "src/app.ts add is broken",
        issueUpdatedAt: "2026-01-01T00:00:00.000Z",
        repositoryId: 99,
        issueNumber: 7,
      },
      evidence: c,
      runtime: {
        getModel: () => ({ id: "fake" }),
        getAuth: async () => ({ auth: { apiKey: "x" } }),
        completeSimple: async () => ({ content: [] }),
      },
      model: { provider: "fake", modelId: "fake-model" },
      completeTurn: async () => {
        turn += 1;
        if (turn === 1) {
          return JSON.stringify({ action: "read", path: "src/app.ts" });
        }
        // After read observation, return final with ledger id from controller
        const ids = [...c.getLedgerSnapshot().keys()];
        assert.ok(ids.length >= 1);
        return JSON.stringify({
          action: "final",
          category: "bug",
          verdict: "confirmed",
          confidence: "high",
          coverage: "complete",
          reasonSummary: "Code path matches the reported function.",
          directionSummary: "Inspect add() and add regression coverage.",
          evidence: [
            {
              evidenceId: ids[0],
              relation: "supports",
              note: "function definition present",
            },
          ],
        });
      },
    });
    assert.equal(outcome.result.verdict, "confirmed");
    assert.equal(outcome.result.mayClose, false);
    assert.equal(outcome.result.category, "bug");
    assert.ok(outcome.turns >= 2);
    assertNoAbsLeak(outcome.result, repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("model loop: invalid JSON degrades inconclusive", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const outcome = await runIssueAnalysis({
      claim: {
        title: "x",
        body: "y",
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
      model: { provider: "fake", modelId: "fake-model" },
      completeTurn: async () => "not-json at all",
    });
    assert.equal(outcome.result.verdict, "inconclusive");
    assert.equal(outcome.result.mayClose, false);
    assert.equal(outcome.result.reasonCode, "invalid_model_output");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("model loop: feature final forced not_applicable", async () => {
  const repo = makeRepo();
  try {
    const c = await openController(repo);
    const outcome = await runIssueAnalysis({
      claim: {
        title: "add dark mode",
        body: "please",
        issueUpdatedAt: "2026-01-01T00:00:00.000Z",
        repositoryId: 1,
        issueNumber: 3,
      },
      evidence: c,
      runtime: {
        getModel: () => ({ id: "fake" }),
        getAuth: async () => ({ auth: { apiKey: "x" } }),
        completeSimple: async () => ({ content: [] }),
      },
      model: { provider: "fake", modelId: "fake-model" },
      completeTurn: async () =>
        JSON.stringify({
          action: "final",
          category: "feature",
          verdict: "not_exists",
          confidence: "high",
          coverage: "complete",
          reasonSummary: "not implemented",
          directionSummary: "implement dark mode",
          evidence: [],
        }),
    });
    assert.equal(outcome.result.category, "feature");
    assert.equal(outcome.result.verdict, "not_applicable");
    assert.equal(outcome.result.mayClose, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

await runCase("model readiness fails without model ref", async () => {
  const readiness = await resolveIssueAnalysisModelReadiness({
    modelRef: null,
    settingsDefault: null,
    runtime: null,
  });
  // Without yolk specific and without settingsDefault, not ready.
  // (ambient pi-web may exist; force null modelRef path via empty settings)
  const forced = await resolveIssueAnalysisModelReadiness({
    modelRef: { provider: "", modelId: "" },
    runtime: null,
  });
  assert.equal(forced.ready, false);
  assert.equal(forced.reasonCode, "model_unavailable");
  void readiness;
});

await runCase("model readiness probes auth", async () => {
  const ready = await resolveIssueAnalysisModelReadiness({
    modelRef: { provider: "p", modelId: "m" },
    runtime: {
      getModel: () => ({ id: "m" }),
      getAuth: async () => ({ auth: { apiKey: "k" } }),
      completeSimple: async () => ({ content: [] }),
    },
  });
  assert.equal(ready.ready, true);
  const unready = await resolveIssueAnalysisModelReadiness({
    modelRef: { provider: "p", modelId: "m" },
    runtime: {
      getModel: () => ({ id: "m" }),
      getAuth: async () => ({ auth: {} }),
      completeSimple: async () => ({ content: [] }),
    },
  });
  assert.equal(unready.ready, false);
});

await runCase("source scan clean (no write/spawn/AgentSession imports)", async () => {
  const fs = await import("node:fs");
  for (const rel of [
    "lib/github-issue-analysis-types.ts",
    "lib/github-issue-analysis-evidence.ts",
    "lib/github-issue-analysis-model.ts",
  ]) {
    const src = fs.readFileSync(join(root, rel), "utf8");
    // Strip block/line comments so documentation of the negative capability does not fail the scan.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const token of [
      "createAgentSession",
      "github-automation-session",
      "github-automation-worktree",
      "github-git-publisher",
      "ypi-studio-child-session-runner",
      "worktree-check-execution",
      "child_process",
      "spawn(",
      "execFile",
      "writeFile",
      "appendFile",
      "rmSync",
      "unlinkSync",
    ]) {
      assert.equal(code.includes(token), false, `${rel} contains ${token}`);
    }
    // Import-form AgentSession only (comments may mention the forbidden surface).
    assert.equal(
      /import\s+.*AgentSession/.test(code) || /from\s+["'].*agent-session/.test(code),
      false,
      `${rel} imports AgentSession`,
    );
  }
});

await runCase("buildInconclusive never mayClose", () => {
  const r = buildInconclusiveIssueAnalysisResult({
    reasonCode: "model_error",
    reasonSummary: "provider failed",
  });
  assert.equal(r.mayClose, false);
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.resultHash.length, 64);
});

console.log(`\n${passed} passed, ${failed} failed`);
rmSync(agentDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
