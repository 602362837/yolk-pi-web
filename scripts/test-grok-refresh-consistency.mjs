#!/usr/bin/env node
/**
 * Grok managed-slot / auth.json mirror consistency tests. Uses a temporary
 * agent dir and a local OAuth fixture; it never contacts xAI.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const providerId = "grok-cli";

async function load(relativePath) {
  return jiti.import(pathToFileURL(join(root, relativePath)).href);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const fixture = {
  calls: 0,
  gate: null,
  started: null,
  provider: {
    id: providerId,
    name: "Grok consistency fixture",
    async refreshToken(credentials) {
      fixture.calls += 1;
      fixture.started?.resolve();
      await fixture.gate?.promise;
      const refresh = typeof credentials.refresh === "string" ? credentials.refresh : "";
      const version = /^R(\d+)$/.exec(refresh)?.[1];
      if (version === undefined) throw new Error("fixture rejected credential");
      const next = Number(version) + 1;
      return {
        ...credentials,
        access: `A${next}`,
        refresh: `R${next}`,
        expires: Date.now() + 3_600_000,
        type: "oauth",
      };
    },
    getApiKey(credentials) {
      return typeof credentials.access === "string" ? credentials.access : "";
    },
  },
};

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

let passed = 0;
let failed = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  } finally {
    fixture.gate = null;
    fixture.started = null;
  }
}

const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-refresh-consistency-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const oauth = await load("lib/pi-ai-oauth-compat.ts");
const accounts = await load("lib/oauth-accounts.ts");
const tokens = await load("lib/grok-account-token.ts");
const { getWebCredentialStore } = await load("lib/web-credential-store.ts");
const rawStore = await getWebCredentialStore();

async function seedActive() {
  const account = await accounts.saveOAuthAccountCredential(providerId, {
    access: "A0", refresh: "R0", expires: Date.now() - 60_000,
  });
  await accounts.activateOAuthAccount(providerId, account.accountId);
  return account;
}

function slotPath(accountId) {
  return join(agentDir, "auth-accounts", providerId, `${encodeURIComponent(accountId)}.json`);
}

try {
  oauth.registerOAuthProvider(fixture.provider);

  await test("rotates R0 → R1 → R2 from the authoritative slot", async () => {
    const account = await seedActive();
    const first = await tokens.getGrokAccessToken(account.accountId, { forceRefresh: true });
    const second = await tokens.getGrokAccessToken(account.accountId, { forceRefresh: true });
    assert.equal(first.refreshed, true);
    assert.equal(second.refreshed, true);
    const slot = await readJson(slotPath(account.accountId));
    const mirror = await rawStore.read(providerId);
    assert.equal(slot.refresh, "R2");
    assert.equal(mirror?.refresh, "R2");
  });

  await test("valid Active read reconciles a failed mirror without refreshing", async () => {
    const account = await seedActive();
    const authPath = join(agentDir, "auth.json");
    const oldMirror = await readFile(authPath, "utf8");
    await rm(authPath, { force: true });
    // A directory at auth.json makes the raw auth store fail after the slot
    // commit, simulating a mirror write failure without mocking production code.
    await mkdir(authPath);
    const before = fixture.calls;
    await assert.rejects(
      () => tokens.getGrokAccessToken(account.accountId, { forceRefresh: true }),
      (error) => error instanceof tokens.GrokTokenError && error.code === "unavailable",
    );
    const rotatedSlot = await readJson(slotPath(account.accountId));
    assert.equal(rotatedSlot.refresh, "R1", "slot stays durable after mirror failure");
    assert.equal(fixture.calls, before + 1, "only the forced refresh calls the fixture");

    // Valid AT must remain usable even while Active mirror repair is still failing.
    const stillBroken = await tokens.getGrokAccessToken(account.accountId, { minValidityMs: 0 });
    assert.equal(stillBroken.refreshed, false, "valid AT path does not force another refresh");
    assert.equal(stillBroken.accessToken, rotatedSlot.access, "returns authoritative slot AT while mirror is broken");
    assert.equal(fixture.calls, before + 1, "temporary mirror failure does not consume another refresh token");

    await rm(authPath, { recursive: true, force: true });
    await writeFile(authPath, oldMirror, { mode: 0o600 });
    const result = await tokens.getGrokAccessToken(account.accountId, { minValidityMs: 0 });
    assert.equal(result.refreshed, false, "recovery uses the valid slot token");
    assert.equal((await rawStore.read(providerId))?.refresh, "R1", "mirror converges slot → mirror");
    assert.equal(fixture.calls, before + 1, "recovery does not consume another refresh token");
  });

  await test("structured token evidence maps provider/generic refresh and reloginRequired", async () => {
    const { mapGrokOAuthError, GrokTokenError } = tokens;
    const missing = mapGrokOAuthError(Object.assign(new Error("missing rt"), {
      name: "XaiOAuthError",
      code: "refresh_missing",
      reloginRequired: true,
    }));
    assert.equal(missing.code, "missing_refresh");

    const relogin = mapGrokOAuthError(Object.assign(new Error("revoked body must not leak"), {
      name: "XaiOAuthError",
      code: "refresh_failed",
      reloginRequired: true,
    }));
    assert.equal(relogin.code, "unauthorized");
    assert.equal(relogin.message.includes("revoked body"), false);

    const generic = mapGrokOAuthError(Object.assign(new Error("temporary refresh glitch"), {
      name: "XaiOAuthError",
      code: "refresh_failed",
      reloginRequired: false,
    }));
    assert.equal(generic.code, "refresh_failed");

    const provider = mapGrokOAuthError(new Error("OAuth provider is not available for grok-cli"));
    assert.equal(provider.code, "provider_unavailable");

    await assert.rejects(
      () => tokens.getGrokAccessToken(""),
      (error) => error instanceof GrokTokenError && error.code === "missing_storage_id",
    );
    await assert.rejects(
      () => tokens.getGrokAccessToken("missing-account-id"),
      (error) => error instanceof GrokTokenError && error.code === "account_not_found",
    );
  });

  await test("matching valid mirror is a zero-write read and non-Active slots cannot repair it", async () => {
    const active = await seedActive();
    await tokens.getGrokAccessToken(active.accountId, { forceRefresh: true });
    const authPath = join(agentDir, "auth.json");
    const beforeBytes = await readFile(authPath, "utf8");
    const beforeMtime = (await stat(authPath)).mtimeMs;
    const calls = fixture.calls;
    await tokens.getGrokAccessToken(active.accountId, { minValidityMs: 0 });
    assert.equal(await readFile(authPath, "utf8"), beforeBytes);
    assert.equal((await stat(authPath)).mtimeMs, beforeMtime);
    assert.equal(fixture.calls, calls);

    const replacement = await accounts.saveOAuthAccountCredential(providerId, {
      access: "B0", refresh: "R0", expires: Date.now() + 3_600_000,
    });
    await accounts.activateOAuthAccount(providerId, replacement.accountId);
    const replacementMirror = await readFile(authPath, "utf8");
    await tokens.getGrokAccessToken(active.accountId, { minValidityMs: 0 });
    assert.equal(await readFile(authPath, "utf8"), replacementMirror, "old non-Active slot cannot overwrite mirror");
  });

  await test("barrier serializes refresh → Activate and shares forced refresh flights", async () => {
    const first = await seedActive();
    const second = await accounts.saveOAuthAccountCredential(providerId, {
      access: "B0", refresh: "R0", expires: Date.now() + 3_600_000,
    });
    fixture.gate = deferred();
    fixture.started = deferred();
    const refresh = tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    const sameRefresh = tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    await fixture.started.promise;
    const slotBeforeList = await readFile(slotPath(first.accountId), "utf8");
    const mirrorBeforeList = await readFile(join(agentDir, "auth.json"), "utf8");
    const listBefore = await accounts.listOAuthAccounts(providerId);
    assert.equal(listBefore.activeAccountId, first.accountId, "pure list observes metadata without entering refresh lock");
    assert.equal(await readFile(slotPath(first.accountId), "utf8"), slotBeforeList, "list does not rewrite the held slot");
    assert.equal(await readFile(join(agentDir, "auth.json"), "utf8"), mirrorBeforeList, "list does not rewrite the mirror");
    assert.equal(JSON.stringify(listBefore).includes("R0"), false, "list never serializes credential sentinels");
    const activate = accounts.activateOAuthAccount(providerId, second.accountId);
    fixture.gate.resolve();
    const [one, two] = await Promise.all([refresh, sameRefresh]);
    await activate;
    assert.equal(one.accessToken, two.accessToken, "forced callers share one flight");
    const listed = await accounts.listOAuthAccounts(providerId);
    assert.equal(listed.activeAccountId, second.accountId);
    assert.equal((await rawStore.read(providerId))?.access, "B0", "Activate wins the final mirror");
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
