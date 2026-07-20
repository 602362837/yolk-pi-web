/**
 * grok-cli saved-account store tests
 *
 * Validates that the generic OAuth account store can save, list, activate, and
 * delete grok-cli credentials independently of openai-codex.  No xAI network
 * calls; no real ~/.pi/agent or ~/.grok/auth.json access.
 */

import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Conditionally skip permission tests on platforms where chmod semantics differ.
const POSIX_PERM = process.platform !== "win32";

async function main(): Promise<void> {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-oauth-grok-account-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const {
    GROK_CLI_PROVIDER_ID,
    OPENAI_CODEX_PROVIDER_ID,
    getOAuthAccountAdapter,
    deleteOAuthAccount,
    importOAuthAccountCredential,
    listOAuthAccounts,
    readOAuthAccountCredential,
    saveOAuthAccountCredential,
    activateOAuthAccount,
  } = await import("./oauth-accounts");

  // grok-cli credentials from pi-grok-cli login() have access/refresh/expires
  // but no "type":"oauth" sentinel. Extra fields (tokenEndpoint, idToken, etc.)
  // are preserved but opaque to the store.
  const grokCred = {
    access: "grok-access-one",
    refresh: "grok-refresh-one",
    expires: 1_800_000_000_000,
    tokenEndpoint: "https://auth.x.ai/oauth/token",
    idToken: "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InRlc3RAeC5haSJ9.signature",
    tokenType: "Bearer",
    baseUrl: "https://cli-chat-proxy.grok.com/v1",
  };

  const grokCredTwo = {
    access: "grok-access-two",
    refresh: "grok-refresh-two",
    expires: 1_800_000_000_001,
    tokenEndpoint: "https://auth.x.ai/oauth/token",
  };

  try {
    // ── basic save / list / read ──────────────────────────────────────────

    const first = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, grokCred);
    const second = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, grokCredTwo);

    notStrictEqual(first.accountId, second.accountId, "each grok credential gets an independent storage id");
    strictEqual(first.accountId.startsWith("acct_"), true);
    strictEqual(second.accountId.startsWith("acct_"), true);

    const list = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    strictEqual(list.provider, GROK_CLI_PROVIDER_ID);
    strictEqual(list.accounts.length, 2);
    deepStrictEqual(
      list.accounts.map((a) => a.accountId).sort(),
      [first.accountId, second.accountId].sort(),
    );

    const readFirst = await readOAuthAccountCredential(GROK_CLI_PROVIDER_ID, first.accountId);
    strictEqual(readFirst.access, "grok-access-one");
    strictEqual(readFirst.refresh, "grok-refresh-one");
    strictEqual(readFirst.expires, 1_800_000_000_000);
    // The real account id is derived from the refresh hash.
    ok(typeof readFirst.accountId === "string" && readFirst.accountId.length > 0, "real account id is computed");
    // Extra fields are preserved.
    strictEqual((readFirst as Record<string, unknown>).tokenEndpoint, "https://auth.x.ai/oauth/token");

    const readSecond = await readOAuthAccountCredential(GROK_CLI_PROVIDER_ID, second.accountId);
    notStrictEqual(readFirst.accountId, readSecond.accountId, "different refresh tokens produce different real account ids");

    // ── metadata contains no credential material ──────────────────────────

    const metadata = JSON.parse(
      await readFile(join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, "accounts.json"), "utf8"),
    ) as { version: number; accounts: Array<Record<string, unknown>> };
    strictEqual(metadata.version, 2);
    for (const entry of metadata.accounts) {
      ok(typeof entry.accountId === "string");
      ok(typeof entry.chatgptAccountId === "string");
      // Metadata must never contain access/refresh tokens.
      strictEqual("access" in entry, false, "metadata must not contain access token");
      strictEqual("refresh" in entry, false, "metadata must not contain refresh token");
    }

    // Credential file must contain the full credential.
    const credFile = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, `${encodeURIComponent(first.accountId)}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    strictEqual(credFile.access, "grok-access-one");
    strictEqual(credFile.refresh, "grok-refresh-one");

    // ── file permissions (POSIX) ──────────────────────────────────────────

    if (POSIX_PERM) {
      const credStat = await stat(
        join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, `${encodeURIComponent(first.accountId)}.json`),
      );
      // Mask: only owner bits
      strictEqual(credStat.mode & 0o777, 0o600, "credential file must be 0600");

      const dirStat = await stat(join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID));
      strictEqual(dirStat.mode & 0o777, 0o700, "account store directory must be 0700");
    }

    // ── provider isolation ────────────────────────────────────────────────

    // Grok accounts must not appear in openai-codex listings.
    const openaiList = await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID);
    const grokIds = new Set([first.accountId, second.accountId]);
    for (const account of openaiList.accounts) {
      ok(!grokIds.has(account.accountId), "grok accounts must not leak into openai-codex listing");
    }

    // Save an openai-codex account and verify it doesn't leak into grok.
    await saveOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, {
      type: "oauth",
      access: "oai-access",
      refresh: "oai-refresh",
      expires: 1_800_000_000_000,
      accountId: "oai-real-id",
    });
    const grokList = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    strictEqual(grokList.accounts.length, 2, "openai-codex accounts must not appear in grok listing");

    // ── activation ────────────────────────────────────────────────────────

    let afterActivate = await activateOAuthAccount(GROK_CLI_PROVIDER_ID, first.accountId);
    strictEqual(afterActivate.activeAccountId, first.accountId);
    const activeSummary = afterActivate.accounts.find((a) => a.accountId === first.accountId);
    ok(activeSummary?.active, "activated account should be marked active");
    ok(activeSummary?.lastActivatedAt, "lastActivatedAt should be set");

    // Activate second account, first should no longer be active.
    afterActivate = await activateOAuthAccount(GROK_CLI_PROVIDER_ID, second.accountId);
    strictEqual(afterActivate.activeAccountId, second.accountId);

    // ── delete non-active ─────────────────────────────────────────────────

    await deleteOAuthAccount(GROK_CLI_PROVIDER_ID, first.accountId);
    const afterDelete = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    strictEqual(afterDelete.accounts.length, 1);
    strictEqual(afterDelete.accounts[0].accountId, second.accountId);

    // Deleted credential moves to deleted/ directory.
    const deletedDir = join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, "deleted");
    const deletedFiles = await (await import("node:fs/promises")).readdir(deletedDir);
    strictEqual(deletedFiles.length, 1, "deleted credential should be in deleted/");

    // ── cannot delete active account ──────────────────────────────────────

    await rejects(
      () => deleteOAuthAccount(GROK_CLI_PROVIDER_ID, second.accountId),
      { name: "OAuthAccountStoreError" },
      "deleting active account must return 409",
    );

    // ── credential import is rejected ─────────────────────────────────────

    await rejects(
      () => importOAuthAccountCredential(GROK_CLI_PROVIDER_ID, "raw", grokCred),
      { name: "OAuthAccountStoreError" },
      "grok-cli must reject credential import",
    );

    // ── unsupported provider rejects ──────────────────────────────────────

    await rejects(
      () => saveOAuthAccountCredential("nonexistent-provider", { access: "x", refresh: "y", expires: 1 }),
      { name: "OAuthAccountStoreError" },
      "unknown provider must return 400",
    );

    // ── adapter registry ──────────────────────────────────────────────────

    const grokAdapter = getOAuthAccountAdapter(GROK_CLI_PROVIDER_ID);
    strictEqual(grokAdapter.id, GROK_CLI_PROVIDER_ID);
    strictEqual(grokAdapter.supportsCredentialImport, false);
    strictEqual(grokAdapter.isCredential(grokCred), true);
    strictEqual(grokAdapter.isCredential({ type: "oauth", access: "a", refresh: "r", expires: 1 }), true, "grok adapter accepts type:oauth creds too");
    strictEqual(grokAdapter.isCredential({}), false);
    strictEqual(grokAdapter.isCredential(null), false);

    const openaiAdapter = getOAuthAccountAdapter(OPENAI_CODEX_PROVIDER_ID);
    strictEqual(openaiAdapter.supportsCredentialImport, true);
    // OpenAI adapter requires type:oauth — grok-style creds are rejected.
    strictEqual(openaiAdapter.isCredential(grokCred), false, "openai adapter rejects grok creds");

    // ── display hint from grok credential ─────────────────────────────────

    const hint = grokAdapter.deriveDisplayHint(grokCred);
    strictEqual(hint, "test@x.ai", "display hint extracted from idToken email claim");

    const noHint = grokAdapter.deriveDisplayHint(grokCredTwo);
    strictEqual(noHint, null, "no display hint when no idToken with claims");

    // ── reauthentication ─────────────────────────────────────────────────

    const { reauthenticateOAuthAccount, updateOAuthAccountLabel } = await import("./oauth-accounts");

    // P0 guard: non-grok provider is rejected.
    await rejects(
      () => reauthenticateOAuthAccount(OPENAI_CODEX_PROVIDER_ID, "any-id", grokCred),
      { name: "OAuthAccountStoreError" },
      "reauth of non-grok provider must be rejected",
    );

    // Missing target is rejected.
    await rejects(
      () => reauthenticateOAuthAccount(GROK_CLI_PROVIDER_ID, "acct_nonexistent", grokCred),
      { name: "OAuthAccountStoreError" },
      "reauth of nonexistent account must be rejected",
    );

    // Malformed credential is rejected.
    await rejects(
      () => reauthenticateOAuthAccount(GROK_CLI_PROVIDER_ID, second.accountId, {}),
      { name: "OAuthAccountStoreError" },
      "reauth with invalid credential must be rejected",
    );

    // Set a label and extraInfo on second account to verify preservation.
    await updateOAuthAccountLabel(GROK_CLI_PROVIDER_ID, second.accountId, "My Grok Backup");
    const metaPath = join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, "accounts.json");
    const metaBefore = JSON.parse(await readFile(metaPath, "utf8")) as { version: number; accounts: Array<Record<string, unknown>> };
    const entryBefore = metaBefore.accounts.find((e) => e.accountId === second.accountId);
    ok(entryBefore, "second account must exist before reauth");
    const createdBefore = entryBefore!.createdAt as string;
    const oldChatgptId = entryBefore!.chatgptAccountId as string;

    // Reauth the second (active) account with a new credential.
    const reauthCred = {
      access: "grok-access-reauthed",
      refresh: "grok-refresh-reauthed",
      expires: 1_800_000_000_500,
      tokenEndpoint: "https://auth.x.ai/oauth/token",
    };

    const reauthResult = await reauthenticateOAuthAccount(GROK_CLI_PROVIDER_ID, second.accountId, reauthCred);
    strictEqual(reauthResult.active, true, "target was active before reauth");
    strictEqual(reauthResult.account.accountId, second.accountId, "opaque storage id preserved");
    strictEqual(reauthResult.account.label, "My Grok Backup", "label preserved");
    strictEqual(reauthResult.account.createdAt, createdBefore, "createdAt preserved");
    notStrictEqual(reauthResult.account.updatedAt, createdBefore, "updatedAt must be refreshed");
    ok(reauthResult.account.active, "active account must still be active");

    // Verify metadata was updated correctly.
    const metaAfter = JSON.parse(await readFile(metaPath, "utf8")) as { version: number; activeAccountId?: string; accounts: Array<Record<string, unknown>> };
    strictEqual(metaAfter.activeAccountId, second.accountId, "active still points to reauth'd account");
    const entryAfter = metaAfter.accounts.find((e) => e.accountId === second.accountId);
    ok(entryAfter, "reauth'd entry must exist");
    strictEqual(entryAfter!.label, "My Grok Backup", "label preserved in metadata");
    strictEqual(entryAfter!.createdAt, createdBefore, "createdAt preserved in metadata");
    notStrictEqual(entryAfter!.chatgptAccountId, oldChatgptId, "diagnostic id must change with new credential");

    // Credential file must contain the new credential.
    const credAfter = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, `${encodeURIComponent(second.accountId)}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    strictEqual(credAfter.access, "grok-access-reauthed");
    strictEqual(credAfter.refresh, "grok-refresh-reauthed");
    strictEqual(credAfter.expires, 1_800_000_000_500);

    // Metadata must never contain credential material.
    strictEqual("access" in entryAfter!, false, "metadata must not contain access token after reauth");
    strictEqual("refresh" in entryAfter!, false, "metadata must not contain refresh token after reauth");

    // Account count must not increase.
    const afterList = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    strictEqual(afterList.accounts.length, 1, "account count must not increase (first was deleted)");
    strictEqual(afterList.accounts[0].accountId, second.accountId);

    // ── reauth of non-active account must not change Active ───────────────

    // Create a third account and activate second, making third the non-active one.
    const grokCredThree = {
      access: "grok-access-three",
      refresh: "grok-refresh-three",
      expires: 1_800_000_000_200,
    };
    const third = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, grokCredThree);
    // Activate third, so second becomes non-active.
    await activateOAuthAccount(GROK_CLI_PROVIDER_ID, third.accountId);
    const listBeforeNonActive = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    strictEqual(listBeforeNonActive.activeAccountId, third.accountId, "third must be active");

    const nonActiveReauthCred = {
      access: "grok-access-na-reauth",
      refresh: "grok-refresh-na-reauth",
      expires: 1_800_000_000_600,
    };
    const nonActiveResult = await reauthenticateOAuthAccount(GROK_CLI_PROVIDER_ID, second.accountId, nonActiveReauthCred);
    strictEqual(nonActiveResult.active, false, "non-active target reports active=false");

    // Active must still point to third.
    const listAfterNonActive = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    strictEqual(listAfterNonActive.activeAccountId, third.accountId, "active must be unchanged after non-active reauth");

    // Non-active credential file updated.
    const nonActiveCredAfter = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, `${encodeURIComponent(second.accountId)}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    strictEqual(nonActiveCredAfter.access, "grok-access-na-reauth");

    // ── file permissions after reauth (POSIX) ─────────────────────────────

    if (POSIX_PERM) {
      const reauthCredStat = await stat(
        join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, `${encodeURIComponent(second.accountId)}.json`),
      );
      strictEqual(reauthCredStat.mode & 0o777, 0o600, "credential file after reauth must be 0600");
    }

    // ── race: delete + reauth serialized by provider lock ───────────────

    // Create a standalone account for the race test.
    const raceCred = {
      access: "grok-access-race",
      refresh: "grok-refresh-race",
      expires: 1_800_000_000_800,
    };
    const raceAccount = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, raceCred);

    // Concurrent delete and reauth on the same target: the lock must
    // serialize them so only one wins cleanly.
    const deletePromise = deleteOAuthAccount(GROK_CLI_PROVIDER_ID, raceAccount.accountId)
      .then(() => "delete-won" as const)
      .catch(() => "delete-failed" as const);
    const reauthPromise = reauthenticateOAuthAccount(
      GROK_CLI_PROVIDER_ID,
      raceAccount.accountId,
      { access: "grok-access-race-2", refresh: "grok-refresh-race-2", expires: 1_800_000_000_900 },
    ).then(() => "reauth-won" as const).catch(() => "reauth-failed" as const);

    const [deleteOutcome, reauthOutcome] = await Promise.all([deletePromise, reauthPromise]);
    // One must win cleanly; the other must fail with a controlled error.
    ok(
      (deleteOutcome === "delete-won" && reauthOutcome === "reauth-failed") ||
        (deleteOutcome === "delete-failed" && reauthOutcome === "reauth-won"),
      `delete+reauth race must serialize: delete=${deleteOutcome} reauth=${reauthOutcome}`,
    );

    // The loser must not have created a duplicate or leaked state.
    const listAfterRace = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    ok(listAfterRace.accounts.length <= 4, "account count must not inflate after race");

    // ── controlled quota generation races ───────────────────────────────

    const {
      bumpGrokQuotaGeneration,
      deleteGrokQuotaPersistedCacheEntry,
      getGrokAccountSubscriptionQuota,
      invalidateGrokQuotaCache,
    } = await import("./grok-subscription-quota");
    const { withGrokProviderLock } = await import("./grok-account-lock");
    const quotaFile = join(agentDir, "auth-accounts", GROK_CLI_PROVIDER_ID, ".quota-cache.json");
    const originalFetch = globalThis.fetch;
    let monthlyFetches = 0;
    const monthlyPayload = (used: number) => ({
      config: {
        monthlyLimit: { val: 100 },
        used: { val: used },
        billingPeriodEnd: "2030-01-01T00:00:00.000Z",
      },
    });
    const weeklyPayload = {
      config: {
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
        creditUsagePercent: 10,
        billingPeriodEnd: "2030-01-01T00:00:00.000Z",
      },
    };
    const installFetch = (monthly: () => Promise<Response>) => {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("format=credits")) return new Response(JSON.stringify(weeklyPayload), { status: 200 });
        monthlyFetches += 1;
        return monthly();
      }) as typeof fetch;
    };
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
      return { promise, resolve };
    };
    const readPersistedEntries = async () => {
      try {
        return (JSON.parse(await readFile(quotaFile, "utf8")) as { entries?: Record<string, unknown> }).entries ?? {};
      } catch {
        return {};
      }
    };

    try {
      // Success flight: reauth invalidates it after fetch begins. The old live
      // result must neither return nor re-populate memory/disk.
      const successRace = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
        access: "grok-access-success-race", refresh: "grok-refresh-success-race", expires: 1_900_000_000_000,
      });
      const successGate = deferred<Response>();
      const successStarted = deferred<void>();
      installFetch(async () => {
        successStarted.resolve();
        return successGate.promise;
      });
      const oldSuccess = getGrokAccountSubscriptionQuota(successRace.accountId, { forceRefresh: true });
      await successStarted.promise;
      bumpGrokQuotaGeneration(successRace.accountId);
      await deleteGrokQuotaPersistedCacheEntry(successRace.accountId);
      successGate.resolve(new Response(JSON.stringify(monthlyPayload(91)), { status: 200 }));
      const oldSuccessResult = await oldSuccess;
      strictEqual(oldSuccessResult.cache.state, "none", "old success flight must not return quota after reauth bump");
      strictEqual((await readPersistedEntries())[successRace.accountId], undefined, "old success must not restore persisted cache");

      installFetch(async () => new Response(JSON.stringify(monthlyPayload(7)), { status: 200 }));
      const replacementSuccess = await getGrokAccountSubscriptionQuota(successRace.accountId);
      strictEqual(replacementSuccess.monthly?.used, 7, "old success must not restore the in-memory cache");

      // Error/stale flight: seed a real cache, delay the error response, then
      // bump generation and remove persisted data before it can publish stale.
      const staleRace = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
        access: "grok-access-stale-race", refresh: "grok-refresh-stale-race", expires: 1_900_000_000_000,
      });
      installFetch(async () => new Response(JSON.stringify(monthlyPayload(22)), { status: 200 }));
      await getGrokAccountSubscriptionQuota(staleRace.accountId, { forceRefresh: true });
      invalidateGrokQuotaCache(staleRace.accountId);
      const errorGate = deferred<Response>();
      const errorStarted = deferred<void>();
      installFetch(async () => {
        errorStarted.resolve();
        return errorGate.promise;
      });
      const oldError = getGrokAccountSubscriptionQuota(staleRace.accountId, { forceRefresh: true });
      await errorStarted.promise;
      bumpGrokQuotaGeneration(staleRace.accountId);
      await deleteGrokQuotaPersistedCacheEntry(staleRace.accountId);
      errorGate.resolve(new Response("unavailable", { status: 503 }));
      const oldErrorResult = await oldError;
      strictEqual(oldErrorResult.cache.state, "none", "old error flight must not return stale quota after reauth bump");
      strictEqual((await readPersistedEntries())[staleRace.accountId], undefined, "old error must not restore persisted cache");

      // Token-failure stale fallback: queue token resolution behind the same
      // provider lock, then perform the reauth invalidation before it runs.
      const tokenRace = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
        access: "", refresh: "", expires: 0,
      });
      await writeFile(quotaFile, `${JSON.stringify({
        schemaVersion: 1,
        entries: {
          [tokenRace.accountId]: {
            monthly: { monthlyLimit: 100, used: 44, billingPeriodEnd: "2030-01-01T00:00:00.000Z" },
            weekly: null,
            success: true,
            queriedAt: Date.now(),
          },
        },
      })}\n`, "utf8");
      let oldTokenFailure!: Promise<Awaited<ReturnType<typeof getGrokAccountSubscriptionQuota>>>;
      await withGrokProviderLock(async () => {
        oldTokenFailure = getGrokAccountSubscriptionQuota(tokenRace.accountId, { forceRefresh: true });
        await new Promise<void>((resolve) => setImmediate(resolve));
        bumpGrokQuotaGeneration(tokenRace.accountId);
        await deleteGrokQuotaPersistedCacheEntry(tokenRace.accountId);
      });
      const oldTokenResult = await oldTokenFailure;
      strictEqual(oldTokenResult.cache.state, "none", "old token-failure flight must not return stale quota after reauth bump");
      strictEqual((await readPersistedEntries())[tokenRace.accountId], undefined, "old token failure must not restore persisted cache");
      ok(monthlyFetches >= 4, "replacement live request must fetch instead of using stale memory");
    } finally {
      globalThis.fetch = originalFetch;
    }

    console.log("Grok OAuth account store tests passed");
  } finally {
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

// The aggregate runner awaits this promise before it changes PI_CODING_AGENT_DIR
// for the next test file. Keeping it exported avoids overlapping temp stores.
export const oauthAccountGrokTestCompletion = main();
