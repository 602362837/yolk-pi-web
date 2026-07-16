#!/usr/bin/env node
/**
 * kiro-cold-auth — cold route / Turbopack-safe lock resolution smoke
 *
 * Ensures Kiro token lock resolution never references `proper-lockfile` or the
 * unsupported `@earendil-works/pi-coding-agent/package.json` export subpath
 * (which made Next/Turbopack fail and cold `/api/auth/providers` return 500),
 * and that the production import graph for Auth providers can load.
 *
 * Run: node scripts/test-kiro-cold-auth.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createJiti } from "jiti";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log("\n=== source contracts (Turbopack-safe lock resolution) ===");

const tokenSource = read("lib/kiro-account-token.ts");
const lockSource = read("lib/kiro-account-lock.ts");
const oauthSource = read("lib/oauth-accounts.ts");
const packageJson = JSON.parse(read("package.json"));

function hasForbiddenPackageJsonResolve(source) {
  // Turbopack fails on static package.json export subpath resolution.
  // Comments may mention the forbidden path; only executable resolve patterns count.
  return (
    /require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(source) ||
    /createRequire\([^)]*package\.json/.test(source) ||
    /from\s+["']@earendil-works\/pi-coding-agent\/package\.json["']/.test(source)
  );
}

function hasProperLockfileStaticResolve(source) {
  // Turbopack statically traces createRequire("proper-lockfile") even inside try/catch.
  return (
    /require(?:FromHere)?\(\s*["']proper-lockfile["']\s*\)/.test(source) ||
    /from\s+["']proper-lockfile["']/.test(source) ||
    /createRequire\([^)]*\)\s*\(\s*["']proper-lockfile["']\s*\)/.test(source) ||
    /import\s+.*["']proper-lockfile["']/.test(source)
  );
}

test("token module does not resolve package.json export subpath", () => {
  assert.ok(!hasForbiddenPackageJsonResolve(tokenSource), "kiro-account-token must not resolve package.json subpath");
  assert.ok(
    !tokenSource.includes('requireFromHere.resolve("@earendil-works/pi-coding-agent/package.json")'),
    "no createRequire package.json resolve fallback",
  );
});

test("lock module uses fs mkdir primitives without proper-lockfile", () => {
  assert.ok(!hasForbiddenPackageJsonResolve(lockSource), "kiro-account-lock must not resolve package.json subpath");
  assert.ok(!hasProperLockfileStaticResolve(lockSource), "must not statically resolve proper-lockfile");
  assert.ok(!/\bcreateRequire\b/.test(lockSource), "no createRequire in lock module");
  assert.ok(lockSource.includes("mkdir"), "uses mkdir for exclusive lock dir");
  assert.ok(lockSource.includes("owner.json"), "writes owner metadata");
  assert.ok(lockSource.includes("LOCK_STALE_MS"), "stale lock recovery");
  assert.ok(lockSource.includes("withKiroProviderLock"), "exports provider lock");
  assert.ok(lockSource.includes("provider.refresh-activate.lock"), "provider-level lock directory");
});

test("token refresh uses shared provider lock", () => {
  assert.ok(tokenSource.includes('from "./kiro-account-lock"'), "imports lock module");
  assert.ok(tokenSource.includes("withKiroProviderLock"), "calls provider lock");
  assert.ok(tokenSource.includes("readActiveStorageId"), "re-reads Active under lock");
  assert.ok(tokenSource.includes("mirrorActiveCredentialIfActive"), "CAS mirror helper");
});

test("Activate shares Kiro provider lock", () => {
  assert.ok(oauthSource.includes('from "./kiro-account-lock"'), "oauth-accounts imports lock");
  assert.ok(oauthSource.includes("withKiroProviderLock"), "Activate wraps Kiro path");
  assert.ok(oauthSource.includes("provider === KIRO_PROVIDER_ID"), "Kiro-only lock");
});

test("cold-auth test script is registered", () => {
  assert.equal(typeof packageJson.scripts["test:kiro-cold-auth"], "string");
  assert.ok(packageJson.scripts["test:kiro-cold-auth"].includes("test-kiro-cold-auth.mjs"));
});

// Import graph used by Auth routes (same chain that previously 500'd):
// kiro-account-token → kiro-subscription-quota → kiro-account-failover → rpc-manager → routes
const importGraph = [
  "lib/kiro-account-lock.ts",
  "lib/kiro-account-token.ts",
  "lib/kiro-subscription-quota.ts",
  "lib/kiro-account-failover.ts",
];

for (const path of importGraph) {
  test(`${path} source has no package.json subpath or proper-lockfile resolve`, () => {
    const src = read(path);
    assert.ok(!hasForbiddenPackageJsonResolve(src), `${path} must not resolve package.json export subpath`);
    assert.ok(!hasProperLockfileStaticResolve(src), `${path} must not resolve proper-lockfile`);
  });
}

console.log("\n=== runtime load smoke (jiti, isolated agent dir) ===");

const agentDir = mkdtempSync(join(tmpdir(), "ypi-kiro-cold-auth-"));
const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": root },
});

await testAsync("kiro-account-lock loads and runs fs-primitive lock", async () => {
  const mod = await jiti.import(pathToFileURL(join(root, "lib/kiro-account-lock.ts")).href);
  assert.equal(typeof mod.withKiroProviderLock, "function");
  assert.equal(mod.__kiroLockUsesFsPrimitivesForTests(), true, "fs primitive lock helper");
  let ran = false;
  await mod.withKiroProviderLock(async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

await testAsync("kiro-account-token loads without Turbopack-style package.json resolve", async () => {
  const mod = await jiti.import(pathToFileURL(join(root, "lib/kiro-account-token.ts")).href);
  assert.equal(typeof mod.getKiroAccessToken, "function");
});

await testAsync("quota + failover modules load (Auth import chain)", async () => {
  const quota = await jiti.import(pathToFileURL(join(root, "lib/kiro-subscription-quota.ts")).href);
  const failover = await jiti.import(pathToFileURL(join(root, "lib/kiro-account-failover.ts")).href);
  assert.equal(typeof quota.getKiroActiveSubscriptionQuota, "function");
  assert.equal(typeof failover.attemptKiroAccountFailover, "function");
  assert.equal(typeof failover.detectKiroFailoverReason, "function");
});

await testAsync("auth providers route module loads (cold discovery path)", async () => {
  // Loading the route module exercises the same static import graph Next compiles.
  const route = await jiti.import(pathToFileURL(join(root, "app/api/auth/providers/route.ts")).href);
  assert.equal(typeof route.GET, "function");
});

await testAsync("models route module loads (cold discovery path)", async () => {
  const route = await jiti.import(pathToFileURL(join(root, "app/api/models/route.ts")).href);
  assert.equal(typeof route.GET, "function");
});

if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
rmSync(agentDir, { recursive: true, force: true });

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
