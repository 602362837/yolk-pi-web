#!/usr/bin/env node
/**
 * grok-refresh-consistency — production-path credential consistency regression
 *
 * Exercises getGrokAccessToken(), listOAuthAccounts(), and activateOAuthAccount()
 * with a controlled OAuth provider. No network or real agent directory is used.
 * Deferred barriers deliberately control refresh ordering; this test uses no sleeps.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function credential(version, expires = Date.now() - 60_000) {
  return {
    access: `sentinel-access-${version}`,
    refresh: `sentinel-refresh-${version}`,
    expires,
    tokenEndpoint: "https://fixture.invalid/token",
  };
}

async function main() {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-refresh-consistency-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const oauth = await jiti.import(pathToFileURL(join(root, "lib/pi-ai-oauth-compat.ts")).href);
  const previousProvider = oauth.getOAuthProvider("grok-cli");
  const calls = [];
  let gate = null;
  let refreshFailure = null;
  let refreshStarted = null;

  oauth.registerOAuthProvider({
    id: "grok-cli",
    name: "Grok consistency fixture",
    async login() {
      throw new Error("fixture login is not used");
    },
    async refreshToken(current) {
      const refresh = typeof current.refresh === "string" ? current.refresh : "";
      calls.push(refresh);
      refreshStarted?.resolve();
      if (gate) await gate.promise;
      if (refreshFailure) throw refreshFailure;
      const version = calls.length;
      return credential(`rotated-${version}`, Date.now() + 3_600_000);
    },
    getApiKey(current) {
      return typeof current.access === "string" ? current.access : "";
    },
  });

  try {
    const accounts = await jiti.import(pathToFileURL(join(root, "lib/oauth-accounts.ts")).href);
    const tokens = await jiti.import(pathToFileURL(join(root, "lib/grok-account-token.ts")).href);
    const storeModule = await jiti.import(pathToFileURL(join(root, "lib/web-credential-store.ts")).href);
    const provider = accounts.GROK_CLI_PROVIDER_ID;
    const accountDir = join(agentDir, "auth-accounts", provider);
    const slotPath = (id) => join(accountDir, `${encodeURIComponent(id)}.json`);
    const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
    const writeJson = async (path, value) => {
      const tmp = `${path}.test-tmp-${process.pid}`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, path);
    };
    const authPath = (await storeModule.getWebCredentialStore()).authPath;
    const readMirror = async () => {
      const credential = await (await storeModule.getWebCredentialStore()).read(provider);
      return credential ?? {};
    };
    const assertSlotAndMirror = async (id, expected) => {
      const slot = await readJson(slotPath(id));
      const mirror = await readMirror();
      for (const key of ["access", "refresh", "expires"]) {
        assert.equal(slot[key], expected[key], `slot ${key} must be current`);
        assert.equal(mirror[key], expected[key], `mirror ${key} must be current`);
      }
    };

    const first = await accounts.saveOAuthAccountCredential(provider, credential("r0"));
    const second = await accounts.saveOAuthAccountCredential(provider, credential("b0"));
    await accounts.activateOAuthAccount(provider, first.accountId);

    // Active C0 -> C1 commits both persistence locations.
    calls.length = 0;
    const firstRefresh = await tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    assert.equal(firstRefresh.refreshed, true);
    assert.deepEqual(calls, ["sentinel-refresh-r0"]);
    await assertSlotAndMirror(first.accountId, credential("rotated-1", (await readJson(slotPath(first.accountId))).expires));

    // Rotation remains durable: a second refresh must submit R1, never R0.
    await writeJson(slotPath(first.accountId), { ...(await readJson(slotPath(first.accountId))), expires: Date.now() - 1 });
    await tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    assert.deepEqual(calls, ["sentinel-refresh-r0", "sentinel-refresh-rotated-1"]);
    await assertSlotAndMirror(first.accountId, credential("rotated-2", (await readJson(slotPath(first.accountId))).expires));

    // A real list runs while refreshToken is held. It can observe old metadata,
    // but must not write an old auth mirror back into the slot.
    const beforeBarrier = credential("barrier-r0");
    await accounts.saveOAuthAccountCredential(provider, beforeBarrier, { storageId: first.accountId });
    const credentialStore = await storeModule.getWebCredentialStore();
    await credentialStore.modify(provider, async () => ({ ...beforeBarrier, type: "oauth" }));
    calls.length = 0;
    gate = deferred();
    refreshStarted = deferred();
    const heldRefresh = tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    await refreshStarted.promise;
    const listedDuringRefresh = await accounts.listOAuthAccounts(provider);
    assert.equal(listedDuringRefresh.activeAccountId, first.accountId);
    gate.resolve();
    gate = null;
    refreshStarted = null;
    await heldRefresh;
    await assertSlotAndMirror(first.accountId, credential("rotated-1", (await readJson(slotPath(first.accountId))).expires));

    // Activate B queued behind a held refresh(A): B owns final Active/mirror;
    // A nevertheless retains its newly rotated credential.
    await accounts.saveOAuthAccountCredential(provider, credential("race-a"), { storageId: first.accountId });
    await accounts.activateOAuthAccount(provider, first.accountId);
    gate = deferred();
    refreshStarted = deferred();
    const refreshA = tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    await refreshStarted.promise;
    const activateB = accounts.activateOAuthAccount(provider, second.accountId);
    gate.resolve();
    gate = null;
    refreshStarted = null;
    await Promise.all([refreshA, activateB]);
    const afterRace = await accounts.listOAuthAccounts(provider);
    assert.equal(afterRace.activeAccountId, second.accountId);
    assert.equal((await readMirror()).refresh, "sentinel-refresh-b0");
    assert.equal((await readJson(slotPath(first.accountId))).refresh, "sentinel-refresh-rotated-2");

    // A non-Active refresh updates only A, leaving B's mirror untouched.
    const mirrorBeforeNonActive = await readMirror();
    await writeJson(slotPath(first.accountId), { ...(await readJson(slotPath(first.accountId))), expires: Date.now() - 1 });
    calls.length = 0;
    await tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    assert.equal((await accounts.listOAuthAccounts(provider)).activeAccountId, second.accountId);
    assert.deepEqual(await readMirror(), mirrorBeforeNonActive);
    assert.equal((await readJson(slotPath(first.accountId))).refresh, "sentinel-refresh-rotated-1");

    // Same process / same storage id shares one upstream refresh flight.
    await accounts.saveOAuthAccountCredential(provider, credential("flight-r0"), { storageId: first.accountId });
    calls.length = 0;
    gate = deferred();
    refreshStarted = deferred();
    const flightOne = tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    await refreshStarted.promise;
    const flightTwo = tokens.getGrokAccessToken(first.accountId, { forceRefresh: true });
    gate.resolve();
    gate = null;
    refreshStarted = null;
    const [one, two] = await Promise.all([flightOne, flightTwo]);
    assert.equal(calls.length, 1);
    assert.equal(one.accessToken, two.accessToken);

    // Provider failure is zero-write and does not expose sentinel credentials.
    await writeJson(slotPath(first.accountId), { ...(await readJson(slotPath(first.accountId))), expires: Date.now() - 1 });
    const slotBeforeFailure = await readFile(slotPath(first.accountId), "utf8");
    const authBeforeFailure = await readFile(authPath, "utf8");
    refreshFailure = new Error("fixture upstream failure");
    await assert.rejects(
      () => tokens.getGrokAccessToken(first.accountId, { forceRefresh: true }),
      (error) => error instanceof Error && !error.message.includes("sentinel-"),
    );
    refreshFailure = null;
    assert.equal(await readFile(slotPath(first.accountId), "utf8"), slotBeforeFailure);
    assert.equal(await readFile(authPath, "utf8"), authBeforeFailure);

    // Corrupt Active metadata fails before the provider can consume a token.
    const metadataPath = join(accountDir, "accounts.json");
    const validMetadata = await readFile(metadataPath, "utf8");
    await writeFile(metadataPath, "{ malformed", { mode: 0o600 });
    calls.length = 0;
    await assert.rejects(() => tokens.getGrokAccessToken(first.accountId, { forceRefresh: true }));
    assert.equal(calls.length, 0);
    await writeFile(metadataPath, validMetadata, { mode: 0o600 });

    // A malformed mirror makes the post-slot projection fail. The new rotating
    // slot remains authoritative; after restoring the old mirror, a valid-token
    // resolution repairs it without another provider refresh.
    await accounts.activateOAuthAccount(provider, first.accountId);
    await accounts.saveOAuthAccountCredential(provider, credential("recover-r0"), { storageId: first.accountId });
    const oldMirror = await readFile(authPath, "utf8");
    await writeFile(authPath, "{ malformed", { mode: 0o600 });
    calls.length = 0;
    await assert.rejects(
      () => tokens.getGrokAccessToken(first.accountId, { forceRefresh: true }),
      (error) => error instanceof Error && error.message === "Failed to persist active Grok OAuth credential",
    );
    assert.equal(calls.length, 1);
    assert.equal((await readJson(slotPath(first.accountId))).refresh, "sentinel-refresh-rotated-1");
    await writeFile(authPath, oldMirror, { mode: 0o600 });
    const recovered = await tokens.getGrokAccessToken(first.accountId);
    assert.equal(recovered.refreshed, false);
    assert.equal((await readMirror()).refresh, "sentinel-refresh-rotated-1");

    // Account projections and thrown errors do not serialize fixture secrets.
    const serializedList = JSON.stringify(await accounts.listOAuthAccounts(provider));
    assert.ok(!serializedList.includes("sentinel-access-"));
    assert.ok(!serializedList.includes("sentinel-refresh-"));
    console.log("Grok refresh consistency tests passed");
  } finally {
    oauth.unregisterOAuthProvider("grok-cli");
    if (previousProvider) oauth.registerOAuthProvider(previousProvider);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
