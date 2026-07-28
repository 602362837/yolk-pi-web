import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORKTREE_CHECK_LIMITS,
  WORKTREE_CHECK_POLICY_ID,
  WORKTREE_CHECK_REASON_CODES,
  parseCheckReport,
  parseWorktreeCheckExecutionResult,
  reconcileCheckReport,
  worktreeCheckSystemGuidance,
} from "../lib/worktree-check-policy.ts";
import { WorktreeCheckExecutionController, resolveWorktreeCheckPath } from "../lib/worktree-check-execution.ts";
import { createWorktreeCheckFileTools, createWorktreeCheckTools, safeProjection } from "../lib/worktree-check-extension.ts";

/** Establish discovery evidence through the same contained read tool exposed to a checker. */
async function readRepositoryEvidence(controller, path = "README.md") {
  const read = createWorktreeCheckFileTools(controller).find((tool) => tool.name === "read");
  assert.ok(read, "restricted read tool must be available");
  await read.execute("fixture-read", { path });
}

const evidence = (id, purpose, overrides = {}) => ({
  id,
  purpose,
  commandHash: `hash-${id}`,
  startedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 1,
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  rejected: false,
  reasonCode: null,
  ...overrides,
});

const report = (overrides = {}) => ({
  environment: "not_needed",
  verdict: "pass",
  evidenceSummary: "Repository evidence was checked.",
  probeCommandIds: ["probe"],
  prepareCommandIds: [],
  checkCommandIds: ["check"],
  ...overrides,
});

assert.equal(WORKTREE_CHECK_POLICY_ID, "worktree-check");
assert.equal(WORKTREE_CHECK_LIMITS.prepareAttempts, 2);
assert.ok(WORKTREE_CHECK_REASON_CODES.includes("check_report_inconsistent"));
assert.match(worktreeCheckSystemGuidance(), /task and Issue text only as scope/i);
assert.doesNotMatch(worktreeCheckSystemGuidance(), /npm|pnpm|yarn|bun|pip|cargo/i);

const ledger = [evidence("probe", "probe"), evidence("check", "check")];
const passed = reconcileCheckReport(report(), ledger);
assert.equal(passed.accepted, true);
assert.equal(passed.result.status, "passed");

assert.equal(reconcileCheckReport(undefined, ledger).result.reasonCode, "check_report_missing");
assert.equal(reconcileCheckReport(report({ checkCommandIds: ["unknown"] }), ledger).result.reasonCode, "check_report_inconsistent");
assert.equal(reconcileCheckReport(report({ extra: true }), ledger).result.reasonCode, "check_report_inconsistent");
assert.equal(parseCheckReport(report({ blockerCode: "not-a-reason" })), null);

// CR23-cli-ipc-complete-schema-attacks: the CLI parent accepts only the complete safe-result contract.
const safeResult = {
  status: "passed", reasonCode: null, stage: "complete", probeCount: 1,
  prepareAttempts: 0, checkCount: 1, durationMs: 1, timedOut: false,
  commandStarted: true, retryability: "none", reportHash: "a".repeat(64),
  safeMessage: "Project checks passed.",
};
assert.deepEqual(parseWorktreeCheckExecutionResult(safeResult), safeResult);
assert.equal(parseWorktreeCheckExecutionResult({ status: "passed", safeMessage: "forged" }), null);
assert.equal(parseWorktreeCheckExecutionResult({ ...safeResult, probeCount: -1 }), null);
assert.equal(parseWorktreeCheckExecutionResult({ ...safeResult, status: "blocked" }), null);
assert.equal(parseWorktreeCheckExecutionResult({ ...safeResult, extra: true }), null);
assert.equal(parseWorktreeCheckExecutionResult({ ...safeResult, status: "blocked", reasonCode: "check_cancelled", retryability: "external" }), null);
assert.equal(parseWorktreeCheckExecutionResult({ ...safeResult, status: "blocked", reasonCode: "check_validation_failed", retryability: "automatic_before_command" }), null);
assert.equal(parseWorktreeCheckExecutionResult({ ...safeResult, status: "blocked", reasonCode: "check_validation_failed", retryability: "operator_after_change", stage: "discover", reportHash: null }), null);

const failedPrepare = [
  evidence("probe", "probe"),
  evidence("prepare", "prepare", { exitCode: 1, reasonCode: "check_dependency_prepare_failed" }),
  evidence("check", "check"),
];
assert.equal(
  reconcileCheckReport(report({ prepareCommandIds: ["prepare"] }), failedPrepare).result.reasonCode,
  "check_report_inconsistent",
);
assert.equal(
  reconcileCheckReport(report({ prepareCommandIds: [] }), failedPrepare).result.reasonCode,
  "check_report_inconsistent",
);

const correctedPrepare = [
  evidence("probe", "probe"),
  evidence("prepare-one", "prepare", { exitCode: 1, reasonCode: "check_dependency_prepare_failed" }),
  evidence("prepare-two", "prepare"),
  evidence("check", "check"),
];
assert.equal(
  reconcileCheckReport(report({ environment: "ready", prepareCommandIds: ["prepare-one", "prepare-two"] }), correctedPrepare).result.status,
  "passed",
);

const failedCheck = [evidence("probe", "probe"), evidence("check", "check", { exitCode: 1, reasonCode: "check_validation_failed" })];
assert.equal(reconcileCheckReport(report(), failedCheck).result.reasonCode, "check_report_inconsistent");
const needsWork = reconcileCheckReport(report({ verdict: "needs_work" }), failedCheck);
assert.equal(needsWork.accepted, true);
assert.equal(needsWork.result.status, "needs_work");

const blocked = reconcileCheckReport(
  report({ environment: "blocked", verdict: "blocked", blockerCode: "check_dependency_tool_missing", checkCommandIds: [] }),
  [evidence("probe", "probe")],
);
assert.equal(blocked.accepted, true);
assert.equal(blocked.result.reasonCode, "check_dependency_tool_missing");

const root = mkdtempSync(join(tmpdir(), "ypi-worktree-check-"));
const main = join(root, "main");
const linked = join(root, "linked");
try {
  mkdirSync(main);
  const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git(main, ["init"]);
  git(main, ["config", "user.email", "fixture@example.invalid"]);
  git(main, ["config", "user.name", "Fixture"]);
  writeFileSync(join(main, ".gitignore"), ["deps", ""].join("\n"));
  writeFileSync(join(main, "README.md"), "fixture");
  git(main, ["add", "."]); git(main, ["commit", "-m", "fixture"]);
  git(main, ["worktree", "add", "-b", "check-fixture", linked]);
  mkdirSync(join(linked, "tools"));
  writeFileSync(join(linked, "tools", "probe"), ["#!/bin/sh", "exit 0", ""].join("\n"));
  writeFileSync(join(linked, "tools", "prepare-fail"), ["#!/bin/sh", "exit 1", ""].join("\n"));
  writeFileSync(join(linked, "tools", "prepare-ok"), ["#!/bin/sh", "mkdir -p deps; touch deps/ready; exit 0", ""].join("\n"));
  writeFileSync(join(linked, "tools", "check"), ["#!/bin/sh", "test -f deps/ready", ""].join("\n"));
  for (const name of ["probe", "prepare-fail", "prepare-ok", "check"]) chmodSync(join(linked, "tools", name), 0o755);
  const controller = new WorktreeCheckExecutionController({ worktreePath: linked, agentDir: join(root, "agent"), env: { PATH: process.env.PATH } });
  assert.equal(await controller.acquireLease(), true);
  await readRepositoryEvidence(controller);
  const probe = await controller.execute({ purpose: "probe", executable: "tools/probe", args: [] });
  const first = await controller.execute({ purpose: "prepare", executable: "tools/prepare-fail", args: [] });
  assert.equal(first.reasonCode, "check_dependency_prepare_failed");
  const second = await controller.execute({ purpose: "prepare", executable: "tools/prepare-ok", args: [], retryOfCommandId: first.commandId });
  assert.equal(second.reasonCode, null);
  const check = await controller.execute({ purpose: "check", executable: "tools/check", args: [] });
  const runtimePass = controller.submitReport({ environment: "ready", verdict: "pass", evidenceSummary: "fixture", probeCommandIds: [probe.commandId], prepareCommandIds: [first.commandId, second.commandId], checkCommandIds: [check.commandId] });
  assert.equal(runtimePass.status, "passed");
  const third = await controller.execute({ purpose: "prepare", executable: "tools/prepare-ok", args: [], retryOfCommandId: first.commandId });
  assert.equal(third.reasonCode, "check_dependency_prepare_attempt_limit");
  await controller.releaseLease();

  // CR01-direct-main-prepare-zero-spawn: main checkout can discover/check under
  // the restricted profile but never prepare.
  const mainController = new WorktreeCheckExecutionController({ worktreePath: main, agentDir: join(root, "main-agent"), env: { PATH: process.env.PATH }, allowMainWorktree: true });
  assert.equal(await mainController.acquireLease(), true);
  await readRepositoryEvidence(mainController);
  await mainController.execute({ purpose: "probe", executable: "true", args: [] });
  const mainPrepare = await mainController.execute({ purpose: "prepare", executable: "true", args: [] });
  assert.equal(mainPrepare.reasonCode, "check_command_rejected");
  await mainController.releaseLease();
} finally { rmSync(root, { recursive: true, force: true }); }

// The remaining matrix uses only local Git repositories and executable fixture
// wrappers. It deliberately does not invoke a package manager, registry, or user agent dir.
const regressionRoot = mkdtempSync(join(tmpdir(), "ypi-worktree-check-regression-"));
const regressionMain = join(regressionRoot, "main");
const regressionLinked = join(regressionRoot, "linked");
try {
  mkdirSync(regressionMain);
  const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git(regressionMain, ["init"]);
  git(regressionMain, ["config", "user.email", "fixture@example.invalid"]);
  git(regressionMain, ["config", "user.name", "Fixture"]);
  writeFileSync(join(regressionMain, ".gitignore"), "artifacts\n");
  writeFileSync(join(regressionMain, "README.md"), "fixture B uses its own wrapper names\n");
  git(regressionMain, ["add", "."]); git(regressionMain, ["commit", "-m", "fixture"]);
  git(regressionMain, ["worktree", "add", "-b", "regression-fixture", regressionLinked]);
  mkdirSync(join(regressionLinked, "bin"));
  const scripts = {
    probe: "#!/bin/sh\nexit 0\n",
    restore: "#!/bin/sh\nmkdir -p artifacts; touch artifacts/ready\n",
    verify: "#!/bin/sh\ntest -f artifacts/ready\n",
    fail: "#!/bin/sh\nexit 1\n",
    mutate: "#!/bin/sh\nprintf changed > tracked-config.txt\n",
    // The test process receives this only after the background descendant exists
    // and its PID is durably recorded. This is a fixture-only readiness handshake,
    // not a timing/polling signal for the controller.
    sleeper: `#!/bin/sh
sleep 20 &
echo $! > child.pid
kill -USR1 ${process.pid}
wait
`,
  };
  for (const [name, content] of Object.entries(scripts)) {
    writeFileSync(join(regressionLinked, "bin", name), content);
    chmodSync(join(regressionLinked, "bin", name), 0o755);
  }

  // A differently-shaped project fixture still uses the same generic executor.
  const controller = new WorktreeCheckExecutionController({
    worktreePath: regressionLinked,
    agentDir: join(regressionRoot, "agent"),
    env: { PATH: process.env.PATH },
  });
  assert.equal(await controller.acquireLease(), true);
  await readRepositoryEvidence(controller);
  const probeB = await controller.execute({ purpose: "probe", executable: "bin/probe", args: [] });
  const restoreB = await controller.execute({ purpose: "prepare", executable: "bin/restore", args: [] });
  const verifyB = await controller.execute({ purpose: "check", executable: "bin/verify", args: [] });
  const passB = controller.submitReport({
    environment: "ready", verdict: "pass", evidenceSummary: "local wrapper fixture",
    probeCommandIds: [probeB.commandId], prepareCommandIds: [restoreB.commandId], checkCommandIds: [verifyB.commandId],
  });
  assert.equal(passB.status, "passed");
  assert.equal(existsSync(join(regressionLinked, "artifacts", "ready")), true);
  assert.deepEqual(Object.keys(safeProjection(passB)).sort(), ["checkCount", "commandStarted", "durationMs", "prepareAttempts", "probeCount", "reasonCode", "reportHash", "retryability", "safeMessage", "stage", "status", "timedOut"].sort());
  assert.doesNotMatch(JSON.stringify(safeProjection(passB)), /bin\/restore|artifacts|PATH/);
  await controller.releaseLease();

  // Tool sets are parity primitives: contained files plus the two server tools,
  // never an unrestricted shell. This is independent of the repository shape.
  const toolsController = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "tools-agent"), env: { PATH: process.env.PATH } });
  const toolNames = [...createWorktreeCheckFileTools(toolsController), ...createWorktreeCheckTools(toolsController)].map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["edit", "find", "grep", "ls", "read", "submit_check_report", "worktree_check_exec", "write"]);
  await assert.rejects(() => resolveWorktreeCheckPath(regressionLinked, "../outside"), /check_command_rejected/);
  await assert.rejects(() => resolveWorktreeCheckPath(regressionLinked, ".ypi/tasks/authority.json", true), /check_command_rejected/);

  // CR04–CR14 run through the production controller and contained tool factory;
  // no ledger helper is used to manufacture discovery evidence.
  const discoveredController = async (name) => {
    const instance = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, name), env: { PATH: process.env.PATH } });
    assert.equal(await instance.acquireLease(), true);
    await readRepositoryEvidence(instance);
    const probe = await instance.execute({ purpose: "probe", executable: "bin/probe", args: [] });
    assert.equal(probe.exitCode, 0);
    return instance;
  };
  const runCase = async (id, execute) => {
    await execute();
    console.log(`ok - ${id}`);
  };

  await runCase("CR04-exec-env-delegation-rejected", async () => {
    const current = await discoveredController("cr04-agent");
    const result = await current.execute({ purpose: "probe", executable: "env", args: ["sh", "-c", "true"] });
    assert.equal(result.reasonCode, "check_command_rejected");
    await current.releaseLease();
  });
  await runCase("CR05-exec-xargs-delegation-rejected", async () => {
    const current = await discoveredController("cr05-agent");
    const result = await current.execute({ purpose: "probe", executable: "xargs", args: ["sh"] });
    assert.equal(result.reasonCode, "check_command_rejected");
    await current.releaseLease();
  });
  await runCase("CR06-exec-find-exec-rejected", async () => {
    const current = await discoveredController("cr06-agent");
    const result = await current.execute({ purpose: "probe", executable: "find", args: [".", "-exec", "true", ";"] });
    assert.equal(result.reasonCode, "check_command_rejected");
    await current.releaseLease();
  });
  await runCase("CR07-exec-path-valued-escape-rejected", async () => {
    const current = await discoveredController("cr07-agent");
    for (const args of [["/tmp/outside"], ["--output=/tmp/outside"], ["../outside"]]) {
      const result = await current.execute({ purpose: "probe", executable: "bin/probe", args });
      assert.equal(result.reasonCode, "check_command_rejected");
    }
    await current.releaseLease();
  });
  await runCase("CR08-exec-git-root-override-rejected", async () => {
    const current = await discoveredController("cr08-agent");
    const allowed = await current.execute({ purpose: "probe", executable: "git", args: ["status", "--short"] });
    assert.equal(allowed.exitCode, 0);
    for (const args of [["-C", "/tmp", "status"], ["--git-dir=/tmp/x", "status"], ["--work-tree=/tmp", "status"]]) {
      const result = await current.execute({ purpose: "probe", executable: "git", args });
      assert.equal(result.reasonCode, "check_command_rejected");
    }
    await current.releaseLease();
  });
  await runCase("CR09-file-symlink-ancestor-rejected", async () => {
    const outside = join(regressionRoot, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(regressionLinked, "outside-link"));
    const current = await discoveredController("cr09-agent");
    const write = createWorktreeCheckFileTools(current).find((tool) => tool.name === "write");
    assert.ok(write);
    await assert.rejects(() => write.execute("cr09", { path: "outside-link/new-file", content: "must not escape" }));
    assert.equal(existsSync(join(outside, "new-file")), false);
    await current.releaseLease();
  });
  await runCase("CR10-discovery-read-and-probe-unlocks", async () => {
    const current = await discoveredController("cr10-agent");
    const result = await current.execute({ purpose: "prepare", executable: "bin/restore", args: [] });
    assert.equal(result.exitCode, 0);
    await current.releaseLease();
  });
  await runCase("CR11-discovery-read-failures-do-not-unlock", async () => {
    const current = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "cr11-agent"), env: { PATH: process.env.PATH } });
    assert.equal(await current.acquireLease(), true);
    const read = createWorktreeCheckFileTools(current).find((tool) => tool.name === "read");
    assert.ok(read);
    await assert.rejects(() => read.execute("cr11", { path: "../outside" }));
    const result = await current.execute({ purpose: "check", executable: "bin/verify", args: [] });
    assert.equal(result.reasonCode, "check_dependency_discovery_inconclusive");
    await current.releaseLease();
  });
  await runCase("CR12-discovery-read-without-probe-rejected", async () => {
    const current = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "cr12-agent"), env: { PATH: process.env.PATH } });
    assert.equal(await current.acquireLease(), true);
    await readRepositoryEvidence(current);
    const result = await current.execute({ purpose: "prepare", executable: "bin/restore", args: [] });
    assert.equal(result.reasonCode, "check_dependency_discovery_inconclusive");
    await current.releaseLease();
  });
  await runCase("CR13-discovery-bad-probes-do-not-unlock", async () => {
    const current = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "cr13-agent"), env: { PATH: process.env.PATH } });
    assert.equal(await current.acquireLease(), true);
    await readRepositoryEvidence(current);
    const failedProbe = await current.execute({ purpose: "probe", executable: "bin/fail", args: [] });
    assert.equal(failedProbe.reasonCode, "check_dependency_tool_missing");
    const result = await current.execute({ purpose: "check", executable: "bin/verify", args: [] });
    assert.equal(result.reasonCode, "check_dependency_discovery_inconclusive");
    await current.releaseLease();
  });
  await runCase("CR14-ledger-prepare-check-report-consistent", async () => {
    const current = await discoveredController("cr14-agent");
    const prepared = await current.execute({ purpose: "prepare", executable: "bin/restore", args: [] });
    const checked = await current.execute({ purpose: "check", executable: "bin/verify", args: [] });
    const probeId = current.getLedger().find((entry) => entry.purpose === "probe")?.id;
    assert.ok(probeId);
    assert.equal(current.submitReport({ environment: "ready", verdict: "pass", evidenceSummary: "fixture", probeCommandIds: [probeId], prepareCommandIds: [prepared.commandId], checkCommandIds: [checked.commandId] }).status, "passed");
    await current.releaseLease();
  });

  // A live owner cannot be stolen; this uses the lease protocol rather than a timing-only assertion.
  const owner = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "lease-agent"), env: { PATH: process.env.PATH } });
  const contender = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "lease-agent"), env: { PATH: process.env.PATH } });
  assert.equal(await owner.acquireLease(), true);
  assert.equal(await contender.acquireLease(0), false);
  assert.equal(contender.finalize().reasonCode, "check_execution_lease_timeout");
  await owner.releaseLease();

  const denied = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "deny-agent"), env: { PATH: process.env.PATH } });
  assert.equal(await denied.acquireLease(), true);
  await readRepositoryEvidence(denied);
  for (const input of [
    { purpose: "probe", executable: "/bin/sh", args: [] },
    { purpose: "probe", executable: "sh", args: ["-c", "echo unsafe"] },
    { purpose: "probe", executable: "git", args: ["push"] },
    { purpose: "probe", executable: "bin/probe", args: ["--global"] },
    { purpose: "probe", executable: "bin/probe", args: ["token=not-safe"] },
    { purpose: "probe", executable: "bin/probe", args: [], cwd: "../" },
  ]) {
    const result = await denied.execute(input);
    assert.equal(result.rejected, true);
    assert.equal(result.reasonCode, "check_command_rejected");
  }
  assert.equal(denied.finalize().reasonCode, "check_command_rejected");
  await denied.releaseLease();

  // A failed prepare followed by free text/no report retains its specific reason.
  const failed = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "failed-agent"), env: { PATH: process.env.PATH } });
  assert.equal(await failed.acquireLease(), true);
  await readRepositoryEvidence(failed);
  await failed.execute({ purpose: "probe", executable: "bin/probe", args: [] });
  const failedPrepareResult = await failed.execute({ purpose: "prepare", executable: "bin/fail", args: [] });
  assert.equal(failedPrepareResult.reasonCode, "check_dependency_prepare_failed");
  assert.equal(failed.finalize().reasonCode, "check_dependency_prepare_failed");
  await failed.releaseLease();

  // Tracked mutations are detected and never reverted by the controller.
  rmSync(join(regressionLinked, "tracked-config.txt"), { force: true });
  const mutation = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "mutation-agent"), env: { PATH: process.env.PATH } });
  assert.equal(await mutation.acquireLease(), true);
  await readRepositoryEvidence(mutation);
  await mutation.execute({ purpose: "probe", executable: "bin/probe", args: [] });
  const mutationResult = await mutation.execute({ purpose: "prepare", executable: "bin/mutate", args: [] });
  assert.equal(mutationResult.reasonCode, "check_dependency_prepare_mutated_sources");
  assert.equal(existsSync(join(regressionLinked, "tracked-config.txt")), true, "controller must not reset source changes");
  await mutation.releaseLease();

  // CR17-controller-abort-kills-descendants: only the controller's constructor
  // signal is aborted. The wrapper records a real grandchild PID so this checks
  // process-group termination rather than a tool-local abort result.
  await runCase("CR17-controller-abort-kills-descendants", async () => {
    rmSync(join(regressionLinked, "child.pid"), { force: true });
    const abort = new AbortController();
    const aborting = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "abort-agent"), env: { PATH: process.env.PATH }, signal: abort.signal });
    assert.equal(await aborting.acquireLease(), true);
    await readRepositoryEvidence(aborting);
    await aborting.execute({ purpose: "probe", executable: "bin/probe", args: [] });
    let descendantReady;
    const descendantReadyPromise = new Promise((resolve) => { descendantReady = resolve; });
    process.once("SIGUSR1", descendantReady);
    try {
      const running = aborting.execute({ purpose: "check", executable: "bin/sleeper", args: [] });
      await descendantReadyPromise;
      assert.equal(existsSync(join(regressionLinked, "child.pid")), true, "fixture must expose a grandchild before controller abort");
      const descendantPid = Number(readFileSync(join(regressionLinked, "child.pid"), "utf8").trim());
      assert.ok(Number.isInteger(descendantPid) && descendantPid > 1);
      abort.abort();
      const aborted = await running;
      assert.equal(aborted.reasonCode, "check_cancelled");
      assert.equal(aborting.finalize().reasonCode, "check_cancelled");
      // The wrapper waits for its child, so its close event proves the descendant
      // has been reaped; no post-abort sleep/polling is necessary.
      assert.throws(() => process.kill(descendantPid, 0), /ESRCH/, "controller abort must kill the descendant process group");
    } finally {
      process.removeListener("SIGUSR1", descendantReady);
      await aborting.releaseLease();
    }
  });

  // Durable GitHub generation state cannot reopen the two-attempt prepare budget.
  const exhausted = new WorktreeCheckExecutionController({ worktreePath: regressionLinked, agentDir: join(regressionRoot, "exhausted-agent"), env: { PATH: process.env.PATH }, initialPrepareAttempts: 2 });
  assert.equal(await exhausted.acquireLease(), true);
  await readRepositoryEvidence(exhausted);
  await exhausted.execute({ purpose: "probe", executable: "bin/probe", args: [] });
  const exhaustedResult = await exhausted.execute({ purpose: "prepare", executable: "bin/restore", args: [] });
  assert.equal(exhaustedResult.reasonCode, "check_dependency_prepare_attempt_limit");
  await exhausted.releaseLease();
} finally {
  rmSync(regressionRoot, { recursive: true, force: true });
}

console.log("worktree check policy and runtime tests passed");
