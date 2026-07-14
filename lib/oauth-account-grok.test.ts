/**
 * grok-cli saved-account store tests
 *
 * Validates that the generic OAuth account store can save, list, activate, and
 * delete grok-cli credentials independently of openai-codex.  No xAI network
 * calls; no real ~/.pi/agent or ~/.grok/auth.json access.
 */

import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

    console.log("Grok OAuth account store tests passed");
  } finally {
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
