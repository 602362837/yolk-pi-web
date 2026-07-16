#!/usr/bin/env node
/**
 * kiro-refresh-activate-race — production-path concurrent refresh vs Activate
 *
 * Drives the real `getKiroAccessToken()` and `activateOAuthAccount()` paths
 * with a controlled Kiro OAuth provider fixture (registered via
 * registerOAuthProvider).  Refresh is NOT simulated with local credential
 * writes: it goes through getOAuthApiKey → provider.refreshToken → atomic
 * write → Active re-read CAS under withKiroProviderLock.
 *
 * Barriers:
 *   - refresh(A) holds inside refreshToken until Activate(B) is mid-flight
 *     or the shared lock is contended (serializes under provider lock).
 *   - Final Active metadata + auth.json mirror must be the newly activated
 *     account; a stale refresh of the previous Active must not overwrite it.
 *
 * Run: node scripts/test-kiro-refresh-activate-race.mjs
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err instanceof Error ? err.message : String(err)}`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log("\n=== source contracts ===");

const lockSource = await readFile(join(root, "lib/kiro-account-lock.ts"), "utf8");
const tokenSource = await readFile(join(root, "lib/kiro-account-token.ts"), "utf8");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

test("lock module has no proper-lockfile static resolve", () => {
  assert.ok(!/require(?:FromHere)?\(\s*["']proper-lockfile["']\s*\)/.test(lockSource));
  assert.ok(!/\bcreateRequire\b/.test(lockSource));
  assert.ok(lockSource.includes("mkdir"));
  assert.ok(lockSource.includes("owner.json"));
});

test("token module uses production getOAuthApiKey + withKiroProviderLock", () => {
  assert.ok(tokenSource.includes("getOAuthApiKey"));
  assert.ok(tokenSource.includes("withKiroProviderLock"));
  assert.ok(tokenSource.includes("mirrorActiveCredentialIfActive"));
});

test("race test script is registered", () => {
  assert.equal(typeof packageJson.scripts["test:kiro-refresh-activate-race"], "string");
  assert.ok(packageJson.scripts["test:kiro-refresh-activate-race"].includes("test-kiro-refresh-activate-race.mjs"));
});

console.log("\n=== production-path race (getKiroAccessToken + activateOAuthAccount) ===");

await testAsync("refresh(A)+Activate(B) and refresh(B)+Activate(A) keep new Active mirror", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-kiro-race-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Register controlled OAuth provider BEFORE importing token module consumers
  // that call getOAuthApiKey("kiro", ...).
  const oauth = await import("@earendil-works/pi-ai/oauth");
  const {
    registerOAuthProvider,
    unregisterOAuthProvider,
    getOAuthProvider,
  } = oauth;

  /** @type {{ calls: number, holdMs: number, releaseGate: Promise<void> | null, releaseGateResolve: (() => void) | null, barriers: Array<(info: {call: number, refresh: string}) => Promise<void>> }} */
  const refreshControl = {
    calls: 0,
    holdMs: 80,
    releaseGate: null,
    releaseGateResolve: null,
    barriers: [],
  };

  const previous = getOAuthProvider("kiro");
  registerOAuthProvider({
    id: "kiro",
    name: "Kiro (test fixture)",
    async login() {
      throw new Error("login not used in race test");
    },
    async refreshToken(credentials) {
      refreshControl.calls += 1;
      const call = refreshControl.calls;
      const refresh = typeof credentials.refresh === "string" ? credentials.refresh : "";
      for (const barrier of refreshControl.barriers) {
        await barrier({ call, refresh });
      }
      if (refreshControl.releaseGate) {
        await refreshControl.releaseGate;
      }
      await sleep(refreshControl.holdMs);
      return {
        ...credentials,
        access: `refreshed-access-${call}`,
        expires: Date.now() + 3_600_000,
        type: "oauth",
      };
    },
    getApiKey(credentials) {
      return typeof credentials.access === "string" ? credentials.access : "";
    },
  });

  try {
    const {
      KIRO_PROVIDER_ID,
      saveOAuthAccountCredential,
      activateOAuthAccount,
      listOAuthAccounts,
    } = await jiti.import(pathToFileURL(join(root, "lib/oauth-accounts.ts")).href);
    const { getKiroAccessToken } = await jiti.import(
      pathToFileURL(join(root, "lib/kiro-account-token.ts")).href,
    );
    const { AuthStorage } = await import("@earendil-works/pi-coding-agent");

    // expires in the past so production getOAuthApiKey actually invokes
    // provider.refreshToken (it only refreshes when Date.now() >= expires).
    const first = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, {
      access: "prod-access-a",
      refresh: "prod-refresh-a",
      expires: Date.now() - 60_000,
      clientId: "prod-client-a",
      clientSecret: "prod-secret-a",
      region: "us-east-1",
      authMethod: "builder-id",
    });
    const second = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, {
      access: "prod-access-b",
      refresh: "prod-refresh-b",
      expires: Date.now() - 60_000,
      clientId: "prod-client-b",
      clientSecret: "prod-secret-b",
      region: "us-west-2",
      authMethod: "builder-id",
    });

    await activateOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
    let listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
    assert.equal(listed.activeAccountId, first.accountId);

    // ── Race A: concurrent production refresh(A) + Activate(B) ──
    // Under the shared provider lock these serialize. Regardless of order,
    // final Active/mirror must be B (Activate wins metadata; CAS skips stale mirror).
    refreshControl.calls = 0;
    refreshControl.barriers = [];
    refreshControl.holdMs = 40;

    const refreshA = getKiroAccessToken(first.accountId, { forceRefresh: true });
    const activateB = (async () => {
      await sleep(5);
      return activateOAuthAccount(KIRO_PROVIDER_ID, second.accountId);
    })();

    const [tokenA] = await Promise.all([refreshA, activateB]);
    assert.equal(tokenA.refreshed, true, "production getKiroAccessToken must refresh A");
    assert.ok(String(tokenA.accessToken).startsWith("refreshed-access-"), "token from fixture refreshToken");

    listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
    assert.equal(listed.activeAccountId, second.accountId, "Activate B must win Active metadata");

    const mirroredB = AuthStorage.create().get(KIRO_PROVIDER_ID);
    assert.ok(mirroredB, "auth.json must have kiro credential");
    const mirroredBAccess = String(/** @type {Record<string, unknown>} */ (mirroredB).access ?? "");
    const mirroredBRefresh = String(/** @type {Record<string, unknown>} */ (mirroredB).refresh ?? "");
    assert.equal(mirroredBRefresh, "prod-refresh-b", "auth.json mirror must be newly activated B");
    assert.ok(
      mirroredBAccess === "prod-access-b" || mirroredBAccess.startsWith("refreshed-access-"),
      "B mirror access is either original B or a later B refresh",
    );
    // If refresh of A completed after Activate B, CAS must not leave A's access as Active mirror.
    // A's credential file may still be refreshed.
    const aCred = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", "kiro", `${encodeURIComponent(first.accountId)}.json`),
        "utf8",
      ),
    );
    assert.ok(String(aCred.access).startsWith("refreshed-access-"), "refresh always persists A credential");
    assert.equal(aCred.clientSecret, "prod-secret-a", "Builder secret preserved on disk only");
    assert.notEqual(mirroredBRefresh, "prod-refresh-a", "mirror must not be previous Active A");
    assert.ok(!mirroredBAccess.includes("prod-access-a"), "mirror must not keep pre-refresh A access");

    // Privacy: list projection must not dump secrets.
    const serializedList = JSON.stringify(listed);
    assert.ok(!serializedList.includes("prod-secret-"), "account list must not leak clientSecret");
    assert.ok(!serializedList.includes("prod-refresh-"), "account list must not leak refresh token");

    // ── Race B: Active is B; concurrent production refresh(B) + Activate(A) ──
    refreshControl.calls = 0;
    refreshControl.holdMs = 40;

    const refreshB = getKiroAccessToken(second.accountId, { forceRefresh: true });
    const activateA = (async () => {
      await sleep(5);
      return activateOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
    })();

    const [tokenB] = await Promise.all([refreshB, activateA]);
    assert.equal(tokenB.refreshed, true, "production getKiroAccessToken must refresh B");
    assert.ok(String(tokenB.accessToken).startsWith("refreshed-access-"));

    listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
    assert.equal(listed.activeAccountId, first.accountId, "Activate A must win Active metadata");

    const mirroredA = AuthStorage.create().get(KIRO_PROVIDER_ID);
    assert.ok(mirroredA, "auth.json must have kiro credential after Activate A");
    const mirroredAAccess = String(/** @type {Record<string, unknown>} */ (mirroredA).access ?? "");
    const mirroredARefresh = String(/** @type {Record<string, unknown>} */ (mirroredA).refresh ?? "");
    assert.equal(mirroredARefresh, "prod-refresh-a", "auth.json must mirror activated A");
    // Activate reads on-disk A (already refreshed in race A).
    assert.ok(
      mirroredAAccess.startsWith("refreshed-access-") || mirroredAAccess === "prod-access-a",
      "A mirror is activated credential content",
    );
    assert.notEqual(mirroredARefresh, "prod-refresh-b", "refresh of previous Active must not overwrite new Active");
    assert.ok(!mirroredAAccess.includes("prod-access-b"), "mirror must not keep B original access after Activate A");

    // ── Barrier race: refresh holds inside real refreshToken while Activate runs ──
    // Start refresh first so it enters the lock; hold refreshToken until Activate is scheduled.
    // Re-expire on-disk credentials so getOAuthApiKey actually invokes refreshToken.
    await activateOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
    const kiroDir = join(agentDir, "auth-accounts", "kiro");
    for (const id of [first.accountId, second.accountId]) {
      const credPath = join(kiroDir, `${encodeURIComponent(id)}.json`);
      const cred = JSON.parse(await readFile(credPath, "utf8"));
      const { writeFile, rename } = await import("node:fs/promises");
      const next = { ...cred, expires: Date.now() - 60_000 };
      const tmp = `${credPath}.tmp.${process.pid}`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, credPath);
    }

    refreshControl.calls = 0;
    refreshControl.holdMs = 10;
    let releaseHold;
    refreshControl.releaseGate = new Promise((resolve) => {
      releaseHold = resolve;
    });

    const slowRefreshA = getKiroAccessToken(first.accountId, { forceRefresh: true });
    // Give refresh time to enter provider lock and call refreshToken (which awaits the gate).
    await sleep(40);
    const lateActivateB = activateOAuthAccount(KIRO_PROVIDER_ID, second.accountId);
    // Let Activate contend on the lock; then release refreshToken.
    await sleep(20);
    releaseHold();
    const [heldToken] = await Promise.all([slowRefreshA, lateActivateB]);
    assert.equal(heldToken.refreshed, true);
    assert.ok(refreshControl.calls >= 1, "held refresh must invoke real refreshToken");

    listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
    assert.equal(listed.activeAccountId, second.accountId, "late Activate after held refresh must still win Active");
    const finalMirror = AuthStorage.create().get(KIRO_PROVIDER_ID);
    assert.ok(finalMirror);
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (finalMirror).refresh ?? ""),
      "prod-refresh-b",
      "final auth.json mirror must be B after held-refresh race",
    );
  } finally {
    try {
      unregisterOAuthProvider("kiro");
    } catch {
      // ignore
    }
    // Restore previous registration if any (best-effort).
    if (previous) {
      try {
        registerOAuthProvider(previous);
      } catch {
        // ignore
      }
    }
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
});

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
