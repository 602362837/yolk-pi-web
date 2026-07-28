#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true, alias: { "@": root } });
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed += 1; }
  catch (error) { console.log(`  \x1b[31m✗\x1b[0m ${name}: ${error instanceof Error ? error.message : String(error)}`); failed += 1; }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

console.log("\n=== models provider auth summary ===\n");
const {
  projectLocalOAuthProviderSummary,
  getOAuthProviderAuthorityFingerprint,
  verifyProviderAuth,
  invalidateProviderVerification,
  __resetModelsProviderAuthSummaryForTests,
  modelsProviderAuthSummaryConstants,
} = await jiti.import(join(root, "lib/models-provider-auth-summary.ts"));

await test("local summary is metadata-only and never calls checkAuth", async () => {
  let checks = 0;
  const runtime = {
    getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
    checkAuth: async () => { checks += 1; return true; },
  };
  const summary = await projectLocalOAuthProviderSummary(runtime, { id: "fixture-oauth", name: "Fixture" });
  assert.equal(checks, 0);
  assert.equal(summary.localConfigured, true);
  assert.equal(summary.loggedIn, true);
  assert.equal(summary.statusBasis, "local");
  assert.match(summary.localStateRevision, /^[A-Za-z0-9_-]{30,}$/);
  assert.doesNotMatch(summary.localStateRevision, /fixture|stored/);
});

await test("external authority rotation changes the revision with identical safe summary metadata", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-models-authority-"));
  const runtime = {
    getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
    checkAuth: async () => true,
  };
  try {
    const accountDir = join(agentDir, "auth-accounts", "fixture-oauth");
    await mkdir(accountDir, { recursive: true });
    await writeFile(join(accountDir, "accounts.json"), JSON.stringify({ activeAccountId: "same-account", accounts: [] }));
    await writeFile(join(accountDir, "same-account.json"), JSON.stringify({ access: "first-secret" }));
    const before = await projectLocalOAuthProviderSummary(runtime, { id: "fixture-oauth" }, { agentDir });
    const firstFingerprint = await getOAuthProviderAuthorityFingerprint("fixture-oauth", agentDir);
    // Simulates another process refreshing the same managed-account slot while
    // its configured/count/Active display projection is unchanged.
    await writeFile(join(accountDir, "same-account.json"), JSON.stringify({ access: "rotated-secret" }));
    const after = await projectLocalOAuthProviderSummary(runtime, { id: "fixture-oauth" }, { agentDir });
    const secondFingerprint = await getOAuthProviderAuthorityFingerprint("fixture-oauth", agentDir);
    assert.equal(before.localConfigured, after.localConfigured);
    assert.equal(before.accountCount, after.accountCount);
    assert.equal(before.activeAccountDisplayName, after.activeAccountDisplayName);
    assert.notEqual(firstFingerprint, secondFingerprint);
    assert.notEqual(before.localStateRevision, after.localStateRevision);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

await test("same runtime/provider/revision shares one checkAuth flight and cache", async () => {
  __resetModelsProviderAuthSummaryForTests();
  let checks = 0;
  const gate = deferred();
  const runtime = {
    getProviderAuthStatus: () => ({ configured: false }),
    checkAuth: async () => { checks += 1; return gate.promise; },
  };
  const all = Array.from({ length: 20 }, () => verifyProviderAuth("runtime-a", runtime, "fixture-oauth", "r1"));
  assert.equal(checks, 1);
  gate.resolve(true);
  const values = await Promise.all(all);
  assert.ok(values.every((value) => value.state === "valid" && value.basedOnRevision === "r1"));
  const cached = await verifyProviderAuth("runtime-a", runtime, "fixture-oauth", "r1");
  assert.equal(cached.state, "valid");
  assert.equal(checks, 1);
});

await test("models.json auth does not create a configured OAuth row", async () => {
  const runtime = {
    getProviderAuthStatus: () => ({ configured: true, source: "models_json_key" }),
    checkAuth: async () => true,
  };
  const summary = await projectLocalOAuthProviderSummary(runtime, { id: "fixture-oauth" });
  assert.equal(summary.localConfigured, false);
  assert.equal(summary.loggedIn, false);
});

await test("invalidation supersedes a late flight and revisions do not share", async () => {
  __resetModelsProviderAuthSummaryForTests();
  let checks = 0;
  const oldGate = deferred();
  const runtime = {
    getProviderAuthStatus: () => ({ configured: false }),
    checkAuth: async () => { checks += 1; return checks === 1 ? oldGate.promise : true; },
  };
  const old = verifyProviderAuth("runtime-a", runtime, "fixture-oauth", "r1");
  invalidateProviderVerification("fixture-oauth");
  assert.equal((await old).state, "superseded");
  oldGate.resolve(true); // late completion cannot publish/cache r1
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = await verifyProviderAuth("runtime-a", runtime, "fixture-oauth", "r2");
  assert.equal(fresh.state, "valid");
  assert.equal(checks, 2);
});

await test("deadline keeps a non-publishable tombstone after late settlement", async () => {
  __resetModelsProviderAuthSummaryForTests();
  let checks = 0;
  const gate = deferred();
  const runtime = {
    getProviderAuthStatus: () => ({ configured: false }),
    checkAuth: async () => { checks += 1; return gate.promise; },
  };
  const first = verifyProviderAuth("runtime-a", runtime, "fixture-oauth", "r-timeout");
  await new Promise((resolve) => setTimeout(resolve, modelsProviderAuthSummaryConstants.verifyDeadlineMs + 25));
  assert.equal((await first).state, "timeout");
  gate.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  const retained = await verifyProviderAuth("runtime-a", runtime, "fixture-oauth", "r-timeout");
  assert.equal(retained.state, "timeout");
  assert.equal(checks, 1);
});

__resetModelsProviderAuthSummaryForTests();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
