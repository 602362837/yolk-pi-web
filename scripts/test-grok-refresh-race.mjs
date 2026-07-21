#!/usr/bin/env node
/**
 * Grok refresh rotation behavior tests. All OAuth providers are local fixtures;
 * the test never contacts xAI and only uses temporary agent directories.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const providerId = "grok-cli";
const oldRefresh = "fixture-old-refresh";
const refreshedAccess = "fixture-refreshed-access";
const refreshedRefresh = "fixture-refreshed-refresh";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function load(relativePath) {
  return jiti.import(pathToFileURL(join(root, relativePath)).href);
}

function fixtureProvider(counterPath) {
  return {
    id: providerId,
    name: "Grok test fixture",
    async refreshToken(credentials) {
      const refresh = typeof credentials.refresh === "string" ? credentials.refresh : "";
      if (refresh !== oldRefresh && refresh !== refreshedRefresh) {
        throw new Error("fixture rejected an unexpected refresh credential");
      }
      let calls = 0;
      try {
        calls = Number(await readFile(counterPath, "utf8"));
      } catch {
        // The first call creates the counter.
      }
      await writeFile(counterPath, String(calls + 1), "utf8");
      await sleep(20);
      return {
        ...credentials,
        access: refreshedAccess,
        refresh: refreshedRefresh,
        expires: Date.now() + 3_600_000,
        type: "oauth",
      };
    },
    getApiKey(credentials) {
      return typeof credentials.access === "string" ? credentials.access : "";
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function seedActive(accounts) {
  const first = await accounts.saveOAuthAccountCredential(providerId, {
    access: "fixture-expired-access",
    refresh: oldRefresh,
    expires: Date.now() - 60_000,
  });
  await accounts.activateOAuthAccount(providerId, first.accountId);
  return first;
}

async function runChild() {
  const counterPath = process.env.GROK_RACE_COUNTER;
  if (!counterPath) throw new Error("missing child fixture configuration");
  const oauth = await load("lib/pi-ai-oauth-compat.ts");
  oauth.registerOAuthProvider(fixtureProvider(counterPath));
  try {
    const accounts = await load("lib/oauth-accounts.ts");
    const active = await accounts.listOAuthAccounts(providerId);
    if (!active.activeAccountId) throw new Error("child has no Active account");
    const tokens = await load("lib/grok-account-token.ts");
    const result = await tokens.getGrokAccessToken(active.activeAccountId, { minValidityMs: 0 });
    if (!result.refreshed && result.accessToken !== refreshedAccess) {
      throw new Error("child did not observe the rotated credential");
    }
  } finally {
    oauth.unregisterOAuthProvider(providerId);
  }
}

async function spawnChild(agentDir, counterPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
      cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, GROK_RACE_COUNTER: counterPath },
      stdio: "pipe",
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`refresh-race child failed (${code}): ${stderr.replace(/\n/g, " ").slice(0, 160)}`));
    });
  });
}

if (process.argv.includes("--child")) {
  await runChild();
  process.exit(0);
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-refresh-race-"));
const counterPath = join(agentDir, "refresh-call-count");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const oauth = await load("lib/pi-ai-oauth-compat.ts");
const accounts = await load("lib/oauth-accounts.ts");
const rawStore = await (await load("lib/web-credential-store.ts")).getWebCredentialStore();
const tokenResolver = await load("lib/grok-account-token.ts");
const coordinated = await load("lib/grok-active-credential-store.ts");

try {
  oauth.registerOAuthProvider(fixtureProvider(counterPath));

  await test("SDK coordinated modify and managed refresh consume one rotating credential", async () => {
    const active = await seedActive(accounts);
    const store = coordinated.createGrokCoordinatedCredentialStore(rawStore);
    const sdkRefresh = store.modify(providerId, async (current) => {
      assert.ok(current && current.type === "oauth", "SDK callback receives the lock-time slot credential");
      const refreshed = await oauth.getOAuthApiKey(providerId, current, { forceRefresh: true });
      assert.ok(refreshed, "fixture refresh resolves");
      return refreshed.newCredentials;
    });
    const managedRefresh = tokenResolver.getGrokAccessToken(active.accountId, { minValidityMs: 0 });
    const [, managed] = await Promise.all([sdkRefresh, managedRefresh]);
    assert.equal(managed.accessToken === refreshedAccess, true, "managed waiter observes the committed credential");
    assert.equal(Number(await readFile(counterPath, "utf8")), 1, "old refresh credential is consumed exactly once");

    const listed = await accounts.listOAuthAccounts(providerId);
    const slot = await readJson(join(agentDir, "auth-accounts", providerId, `${encodeURIComponent(active.accountId)}.json`));
    const mirror = await rawStore.read(providerId);
    assert.equal(listed.activeAccountId, active.accountId, "list retains Active pointer");
    assert.equal(slot.refresh === refreshedRefresh, true, "listing does not restore the old slot credential");
    assert.equal(mirror?.refresh === refreshedRefresh, true, "auth mirror converges with the authoritative slot");
  });

  await test("forced request is not satisfied by an ordinary non-refresh flight", async () => {
    const listed = await accounts.listOAuthAccounts(providerId);
    const activeId = listed.activeAccountId;
    assert.ok(activeId, "Active account exists");
    const before = Number(await readFile(counterPath, "utf8"));
    const ordinary = tokenResolver.getGrokAccessToken(activeId, { minValidityMs: 0 });
    const forced = tokenResolver.getGrokAccessToken(activeId, { forceRefresh: true });
    const [normalResult, forcedResult] = await Promise.all([ordinary, forced]);
    assert.equal(normalResult.refreshed, false, "ordinary flight only reads valid credential");
    assert.equal(forcedResult.refreshed, true, "forced flight performs a real refresh");
    assert.equal(Number(await readFile(counterPath, "utf8")), before + 1, "force performs exactly one additional refresh");
  });

  await test("two processes converge slot and auth mirror after one refresh", async () => {
    const secondDir = await mkdtemp(join(tmpdir(), "ypi-grok-refresh-process-"));
    const secondCounter = join(secondDir, "refresh-call-count");
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = secondDir;
    try {
      const childAccounts = await load("lib/oauth-accounts.ts");
      const active = await seedActive(childAccounts);
      await Promise.all([spawnChild(secondDir, secondCounter), spawnChild(secondDir, secondCounter)]);
      assert.equal(Number(await readFile(secondCounter, "utf8")), 1, "two processes call refresh once");
      const slot = await readJson(join(secondDir, "auth-accounts", providerId, `${encodeURIComponent(active.accountId)}.json`));
      const auth = await readJson(join(secondDir, "auth.json"));
      assert.equal(slot.refresh === refreshedRefresh, true, "slot keeps rotated credential");
      assert.equal(auth[providerId]?.refresh === refreshedRefresh, true, "auth mirror matches rotated slot");
    } finally {
      process.env.PI_CODING_AGENT_DIR = prior;
      await rm(secondDir, { recursive: true, force: true });
    }
  });

  await test("mirror failure retains the authoritative rotated slot", async () => {
    const active = await seedActive(accounts);
    const failingRawStore = {
      authPath: rawStore.authPath,
      read: rawStore.read.bind(rawStore),
      list: rawStore.list.bind(rawStore),
      delete: rawStore.delete.bind(rawStore),
      async modify() { throw new Error("injected auth mirror failure"); },
    };
    const store = coordinated.createGrokCoordinatedCredentialStore(failingRawStore);
    await assert.rejects(
      () => store.modify(providerId, async (current) => ({ ...current, access: refreshedAccess, refresh: refreshedRefresh, expires: Date.now() + 3_600_000 })),
      /injected auth mirror failure/,
    );
    const slot = await readJson(join(agentDir, "auth-accounts", providerId, `${encodeURIComponent(active.accountId)}.json`));
    const canonical = await store.read(providerId);
    assert.equal(slot.refresh === refreshedRefresh, true, "slot is never rolled back after mirror failure");
    assert.equal(canonical?.refresh === refreshedRefresh, true, "coordinated reads continue from the authoritative slot");
  });

  await test("refresh and Activate leave the newly selected account mirrored", async () => {
    const first = await seedActive(accounts);
    const second = await accounts.saveOAuthAccountCredential(providerId, {
      access: "fixture-second-access",
      refresh: "fixture-second-refresh",
      expires: Date.now() + 3_600_000,
    });
    const refresh = tokenResolver.getGrokAccessToken(first.accountId, { forceRefresh: true });
    const activate = (async () => { await sleep(5); return accounts.activateOAuthAccount(providerId, second.accountId); })();
    await Promise.all([refresh, activate]);
    const list = await accounts.listOAuthAccounts(providerId);
    const mirror = await rawStore.read(providerId);
    assert.equal(list.activeAccountId, second.accountId, "Activate wins the Active pointer after serialized refresh");
    assert.equal(mirror?.refresh === "fixture-second-refresh", true, "old Active refresh cannot overwrite new mirror");
  });
} finally {
  oauth.unregisterOAuthProvider(providerId);
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
}

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
