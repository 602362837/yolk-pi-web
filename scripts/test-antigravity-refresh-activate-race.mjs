#!/usr/bin/env node
/**
 * antigravity-refresh-activate-race — production-path concurrent refresh vs Activate
 *
 * Drives the real `getAntigravityAccessToken()` and `activateOAuthAccount()` paths
 * with a controlled google-antigravity OAuth provider fixture (registered via
 * registerOAuthProvider).  Refresh is NOT simulated with local credential
 * writes: it goes through getOAuthApiKey → provider.refreshToken → atomic
 * write → Active re-read CAS under withAntigravityProviderLock.
 *
 * Barriers:
 *   - refresh(A) holds inside refreshToken until Activate(B) is mid-flight
 *     or the shared lock is contended (serializes under provider lock).
 *   - Final Active metadata + auth.json mirror must be the newly activated
 *     account; a stale refresh of the previous Active must not overwrite it.
 *   - projectId is preserved on disk and never appears in list projections.
 *
 * Run: node scripts/test-antigravity-refresh-activate-race.mjs
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

const lockSource = await readFile(join(root, "lib/antigravity-account-lock.ts"), "utf8");
const tokenSource = await readFile(join(root, "lib/antigravity-account-token.ts"), "utf8");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

test("lock module has no proper-lockfile static resolve", () => {
  assert.ok(!/require(?:FromHere)?\(\s*["']proper-lockfile["']\s*\)/.test(lockSource));
  assert.ok(!/\bcreateRequire\b/.test(lockSource));
  assert.ok(lockSource.includes("mkdir"));
  assert.ok(lockSource.includes("owner.json"));
});

test("token module uses production getOAuthApiKey + slot-first transaction + provider lock", () => {
  assert.ok(tokenSource.includes("getOAuthApiKey"));
  assert.ok(tokenSource.includes("withAntigravityProviderLock"));
  assert.ok(tokenSource.includes("commitAntigravityCredentialUnderLock"));
  assert.ok(tokenSource.includes("reconcileAntigravityActiveMirrorUnderLock"));
  assert.ok(tokenSource.includes("mergeAntigravityCredential"));
  assert.ok(tokenSource.includes("forceRefresh: true"));
});

test("race test script is registered", () => {
  assert.equal(typeof packageJson.scripts["test:antigravity-refresh-activate-race"], "string");
  assert.ok(
    packageJson.scripts["test:antigravity-refresh-activate-race"].includes(
      "test-antigravity-refresh-activate-race.mjs",
    ),
  );
});

console.log("\n=== production-path race (getAntigravityAccessToken + activateOAuthAccount) ===");

await testAsync("refresh(A)+Activate(B) and refresh(B)+Activate(A) keep new Active mirror", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-antigravity-race-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Use the app oauth-compat registry (same path as production token refresh).
  // pi-ai 0.80.8+ no longer exports a runtime registerOAuthProvider from
  // @earendil-works/pi-ai/oauth.
  const oauth = await jiti.import(
    pathToFileURL(join(root, "lib/pi-ai-oauth-compat.ts")).href,
  );
  const {
    registerOAuthProvider,
    unregisterOAuthProvider,
    getOAuthProvider,
    getOAuthApiKey,
  } = oauth;

  /** @type {{ calls: number, holdMs: number, releaseGate: Promise<void> | null, releaseGateResolve: (() => void) | null, barriers: Array<(info: {call: number, refresh: string}) => Promise<void>> }} */
  const refreshControl = {
    calls: 0,
    holdMs: 80,
    releaseGate: null,
    releaseGateResolve: null,
    barriers: [],
  };

  const previous = getOAuthProvider("google-antigravity");
  registerOAuthProvider({
    id: "google-antigravity",
    name: "Antigravity (test fixture)",
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
      // Intentionally omit projectId to prove merge restores it.
      return {
        access: `refreshed-access-${call}`,
        refresh,
        expires: Date.now() + 3_600_000,
        type: "oauth",
      };
    },
    getApiKey(credentials) {
      const access = typeof credentials.access === "string" ? credentials.access : "";
      const projectId = typeof credentials.projectId === "string" ? credentials.projectId : "";
      // Production package returns JSON; fixtures must match that contract.
      return JSON.stringify({ token: access, projectId });
    },
  });

  try {
    const {
      ANTIGRAVITY_PROVIDER_ID,
      saveOAuthAccountCredential,
      activateOAuthAccount,
      listOAuthAccounts,
    } = await jiti.import(pathToFileURL(join(root, "lib/oauth-accounts.ts")).href);
    const { getAntigravityAccessToken } = await jiti.import(
      pathToFileURL(join(root, "lib/antigravity-account-token.ts")).href,
    );
    const { getWebCredentialStore } = await jiti.import(
      pathToFileURL(join(root, "lib/web-credential-store.ts")).href,
    );
    const readActiveMirror = async () => {
      const store = await getWebCredentialStore();
      return store.read(ANTIGRAVITY_PROVIDER_ID);
    };

    const first = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "prod-access-a",
      refresh: "prod-refresh-a",
      expires: Date.now() - 60_000,
      projectId: "project-a-secret",
      email: "a@example.com",
    });
    const second = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "prod-access-b",
      refresh: "prod-refresh-b",
      expires: Date.now() - 60_000,
      projectId: "project-b-secret",
      email: "b@example.com",
    });

    await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    let listed = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    assert.equal(listed.activeAccountId, first.accountId);

    // ── Race A: concurrent production refresh(A) + Activate(B) ──
    refreshControl.calls = 0;
    refreshControl.barriers = [];
    refreshControl.holdMs = 40;

    const refreshA = getAntigravityAccessToken(first.accountId, { forceRefresh: true });
    const activateB = (async () => {
      await sleep(5);
      return activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, second.accountId);
    })();

    const [tokenA] = await Promise.all([refreshA, activateB]);
    assert.equal(tokenA.refreshed, true, "production getAntigravityAccessToken must refresh A");
    assert.ok(String(tokenA.accessToken).startsWith("refreshed-access-"), "token from fixture refreshToken");
    assert.ok(!String(tokenA.accessToken).includes("project-"), "access token must not embed projectId");

    listed = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    assert.equal(listed.activeAccountId, second.accountId, "Activate B must win Active metadata");

    const mirroredB = await readActiveMirror();
    assert.ok(mirroredB, "auth.json must have google-antigravity credential");
    const mirroredBAccess = String(/** @type {Record<string, unknown>} */ (mirroredB).access ?? "");
    const mirroredBRefresh = String(/** @type {Record<string, unknown>} */ (mirroredB).refresh ?? "");
    assert.equal(mirroredBRefresh, "prod-refresh-b", "auth.json mirror must be newly activated B");
    assert.ok(
      mirroredBAccess === "prod-access-b" || mirroredBAccess.startsWith("refreshed-access-"),
      "B mirror access is either original B or a later B refresh",
    );

    const aCred = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", "google-antigravity", `${encodeURIComponent(first.accountId)}.json`),
        "utf8",
      ),
    );
    assert.ok(String(aCred.access).startsWith("refreshed-access-"), "refresh always persists A credential");
    assert.equal(aCred.projectId, "project-a-secret", "projectId preserved after refresh that omitted it");
    assert.equal(aCred.email, "a@example.com", "email preserved on disk only");
    assert.notEqual(mirroredBRefresh, "prod-refresh-a", "mirror must not be previous Active A");
    assert.ok(!mirroredBAccess.includes("prod-access-a"), "mirror must not keep pre-refresh A access");

    const serializedList = JSON.stringify(listed);
    assert.ok(!serializedList.includes("project-a-secret"), "account list must not leak projectId");
    assert.ok(!serializedList.includes("project-b-secret"), "account list must not leak projectId");
    assert.ok(!serializedList.includes("prod-refresh-"), "account list must not leak refresh token");

    // ── Race B: Active is B; concurrent production refresh(B) + Activate(A) ──
    refreshControl.calls = 0;
    refreshControl.holdMs = 40;

    const refreshB = getAntigravityAccessToken(second.accountId, { forceRefresh: true });
    const activateA = (async () => {
      await sleep(5);
      return activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    })();

    const [tokenB] = await Promise.all([refreshB, activateA]);
    assert.equal(tokenB.refreshed, true, "production getAntigravityAccessToken must refresh B");
    assert.ok(String(tokenB.accessToken).startsWith("refreshed-access-"));

    listed = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    assert.equal(listed.activeAccountId, first.accountId, "Activate A must win Active metadata");

    const mirroredA = await readActiveMirror();
    assert.ok(mirroredA, "auth.json must have google-antigravity credential after Activate A");
    const mirroredAAccess = String(/** @type {Record<string, unknown>} */ (mirroredA).access ?? "");
    const mirroredARefresh = String(/** @type {Record<string, unknown>} */ (mirroredA).refresh ?? "");
    assert.equal(mirroredARefresh, "prod-refresh-a", "auth.json must mirror activated A");
    assert.ok(
      mirroredAAccess.startsWith("refreshed-access-") || mirroredAAccess === "prod-access-a",
      "A mirror is activated credential content",
    );
    assert.notEqual(mirroredARefresh, "prod-refresh-b", "refresh of previous Active must not overwrite new Active");
    assert.ok(!mirroredAAccess.includes("prod-access-b"), "mirror must not keep B original access after Activate A");

    // ── Barrier race: refresh holds inside real refreshToken while Activate runs ──
    await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    const antiDir = join(agentDir, "auth-accounts", "google-antigravity");
    for (const id of [first.accountId, second.accountId]) {
      const credPath = join(antiDir, `${encodeURIComponent(id)}.json`);
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

    const slowRefreshA = getAntigravityAccessToken(first.accountId, { forceRefresh: true });
    await sleep(40);
    const lateActivateB = activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, second.accountId);
    await sleep(20);
    releaseHold();
    const [heldToken] = await Promise.all([slowRefreshA, lateActivateB]);
    assert.equal(heldToken.refreshed, true);
    assert.ok(refreshControl.calls >= 1, "held refresh must invoke real refreshToken");

    listed = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    assert.equal(listed.activeAccountId, second.accountId, "late Activate after held refresh must still win Active");
    const finalMirror = await readActiveMirror();
    assert.ok(finalMirror);
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (finalMirror).refresh ?? ""),
      "prod-refresh-b",
      "final auth.json mirror must be B after held-refresh race",
    );
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (finalMirror).projectId ?? ""),
      "project-b-secret",
      "final mirror must retain B projectId",
    );

    // ── Active refresh: slot-first commit keeps slot and mirror equal ──
    await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    const firstCredPath = join(antiDir, `${encodeURIComponent(first.accountId)}.json`);
    {
      const { writeFile, rename } = await import("node:fs/promises");
      const cred = JSON.parse(await readFile(firstCredPath, "utf8"));
      const next = {
        ...cred,
        access: "expired-active-access",
        expires: Date.now() - 60_000,
      };
      const tmp = `${firstCredPath}.tmp.${process.pid}.active`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, firstCredPath);
    }
    refreshControl.calls = 0;
    refreshControl.holdMs = 0;
    refreshControl.releaseGate = null;
    const activeRefresh = await getAntigravityAccessToken(first.accountId, { forceRefresh: true });
    assert.equal(activeRefresh.refreshed, true);
    assert.equal(refreshControl.calls, 1, "Active refresh invokes refreshToken once");
    const activeSlot = JSON.parse(await readFile(firstCredPath, "utf8"));
    const activeMirror = await readActiveMirror();
    assert.ok(String(activeSlot.access).startsWith("refreshed-access-"));
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (activeMirror).access ?? ""),
      String(activeSlot.access),
      "Active slot and auth.json access must converge",
    );
    assert.equal(
      Number(/** @type {Record<string, unknown>} */ (activeMirror).expires ?? 0),
      Number(activeSlot.expires),
      "Active slot and auth.json expires must converge",
    );
    assert.equal(activeSlot.projectId, "project-a-secret", "server-only projectId retained on slot");
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (activeMirror).projectId ?? ""),
      "project-a-secret",
      "server-only projectId retained on mirror",
    );

    // ── Non-Active refresh must not rewrite Active mirror ──
    const mirrorBeforeNonActive = await readActiveMirror();
    const mirrorBeforeHash = JSON.stringify(mirrorBeforeNonActive);
    const secondCredPath = join(antiDir, `${encodeURIComponent(second.accountId)}.json`);
    {
      const { writeFile, rename } = await import("node:fs/promises");
      const cred = JSON.parse(await readFile(secondCredPath, "utf8"));
      const next = {
        ...cred,
        access: "expired-nonactive-access",
        expires: Date.now() - 60_000,
      };
      const tmp = `${secondCredPath}.tmp.${process.pid}.nonactive`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, secondCredPath);
    }
    refreshControl.calls = 0;
    const nonActiveRefresh = await getAntigravityAccessToken(second.accountId, { forceRefresh: true });
    assert.equal(nonActiveRefresh.refreshed, true);
    assert.equal(refreshControl.calls, 1, "non-Active refresh invokes refreshToken once");
    const nonActiveSlot = JSON.parse(await readFile(secondCredPath, "utf8"));
    assert.ok(String(nonActiveSlot.access).startsWith("refreshed-access-"));
    const mirrorAfterNonActive = await readActiveMirror();
    assert.equal(
      JSON.stringify(mirrorAfterNonActive),
      mirrorBeforeHash,
      "non-Active refresh must leave Active auth.json unchanged",
    );
    listed = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    assert.equal(listed.activeAccountId, first.accountId, "non-Active refresh must not change Active pointer");

    // ── Forced caller is not satisfied by ordinary non-refresh flight ──
    refreshControl.calls = 0;
    const ordinary = getAntigravityAccessToken(first.accountId);
    const forced = getAntigravityAccessToken(first.accountId, { forceRefresh: true });
    const [ordinaryResult, forcedResult] = await Promise.all([ordinary, forced]);
    assert.equal(ordinaryResult.refreshed, false, "ordinary flight only reads valid credential");
    assert.equal(forcedResult.refreshed, true, "forced flight performs a real refresh");
    assert.equal(refreshControl.calls, 1, "force performs exactly one refresh after ordinary read");

    // ── Mirror failure retains slot; ordinary read repairs without second RT ──
    const { createAntigravityCoordinatedCredentialStore } = await jiti.import(
      pathToFileURL(join(root, "lib/antigravity-active-credential-store.ts")).href,
    );
    const rawStore = await getWebCredentialStore();
    const failingRawStore = {
      authPath: rawStore.authPath,
      read: rawStore.read.bind(rawStore),
      list: rawStore.list.bind(rawStore),
      delete: rawStore.delete.bind(rawStore),
      async modify() {
        throw new Error("injected auth mirror failure");
      },
    };
    const coordinatedFailing = createAntigravityCoordinatedCredentialStore(failingRawStore);
    await assert.rejects(
      () =>
        coordinatedFailing.modify(ANTIGRAVITY_PROVIDER_ID, async (current) => ({
          ...current,
          access: "sdk-rotated-access",
          refresh: "prod-refresh-a",
          expires: Date.now() + 3_600_000,
          projectId: "project-a-secret",
          email: "a@example.com",
          type: "oauth",
        })),
      /injected auth mirror failure/,
    );
    const slotAfterMirrorFailure = JSON.parse(await readFile(firstCredPath, "utf8"));
    assert.equal(
      slotAfterMirrorFailure.access,
      "sdk-rotated-access",
      "slot remains after mirror failure; never roll back rotated credential",
    );
    // Restore a stale mirror deliberately, then ordinary valid-token read reconciles.
    await rawStore.modify(ANTIGRAVITY_PROVIDER_ID, async () => ({
      access: "stale-mirror-access",
      refresh: "prod-refresh-a",
      expires: Date.now() + 3_600_000,
      projectId: "project-a-secret",
      email: "a@example.com",
      type: "oauth",
    }));
    refreshControl.calls = 0;
    const reconcileRead = await getAntigravityAccessToken(first.accountId);
    assert.equal(reconcileRead.refreshed, false, "ordinary read must not consume another refresh token");
    assert.equal(refreshControl.calls, 0, "reconciliation must not call refreshToken");
    assert.equal(reconcileRead.accessToken, "sdk-rotated-access");
    const repairedMirror = await readActiveMirror();
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (repairedMirror).access ?? ""),
      "sdk-rotated-access",
      "ordinary read repairs still-Active mirror from slot",
    );

    // ── Coordinated store modify (ModelRuntime / resolveStoredOAuth path) ──
    refreshControl.calls = 0;
    {
      const { writeFile, rename } = await import("node:fs/promises");
      const cred = JSON.parse(await readFile(firstCredPath, "utf8"));
      const next = {
        ...cred,
        access: "runtime-expired-access",
        expires: Date.now() - 60_000,
      };
      const tmp = `${firstCredPath}.tmp.${process.pid}.runtime`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, firstCredPath);
    }
    const coordinated = createAntigravityCoordinatedCredentialStore(rawStore);
    const runtimeCredential = await coordinated.modify(ANTIGRAVITY_PROVIDER_ID, async (current) => {
      assert.ok(current && current.type === "oauth", "SDK callback receives lock-time Active slot");
      const refreshed = await getOAuthApiKey(
        ANTIGRAVITY_PROVIDER_ID,
        /** @type {any} */ (current),
        { forceRefresh: true },
      );
      assert.ok(refreshed?.newCredentials, "fixture refresh resolves for runtime path");
      return {
        ...current,
        ...refreshed.newCredentials,
        type: "oauth",
      };
    });
    assert.ok(runtimeCredential);
    assert.ok(
      String(/** @type {Record<string, unknown>} */ (runtimeCredential).access ?? "").startsWith("refreshed-access-"),
      "resolveStoredOAuth-style modify returns new credential to current request",
    );
    assert.equal(refreshControl.calls, 1, "runtime path performs one refresh");
    const runtimeSlot = JSON.parse(await readFile(firstCredPath, "utf8"));
    const runtimeMirror = await readActiveMirror();
    assert.equal(
      String(runtimeSlot.access),
      String(/** @type {Record<string, unknown>} */ (runtimeCredential).access ?? ""),
      "runtime path writes managed slot",
    );
    assert.equal(
      String(/** @type {Record<string, unknown>} */ (runtimeMirror).access ?? ""),
      String(/** @type {Record<string, unknown>} */ (runtimeCredential).access ?? ""),
      "runtime path mirrors Active auth.json",
    );
    assert.equal(runtimeSlot.projectId, "project-a-secret", "runtime path preserves projectId");
  } finally {
    try {
      unregisterOAuthProvider("google-antigravity");
    } catch {
      // ignore
    }
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
