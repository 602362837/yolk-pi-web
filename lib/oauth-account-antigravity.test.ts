/**
 * antigravity saved-account store tests
 *
 * Validates that the generic OAuth account store can save, list, activate, and
 * delete google-antigravity credentials independently of openai-codex/grok/kiro.
 * Covers opaque storage ids, projectId secrecy, delete-active protection, and
 * secret-safe projections.  No Google network calls.
 */

import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Conditionally skip permission tests on platforms where chmod semantics differ.
const POSIX_PERM = process.platform !== "win32";

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

async function main(): Promise<void> {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-oauth-antigravity-account-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const {
    ANTIGRAVITY_PROVIDER_ID,
    GROK_CLI_PROVIDER_ID,
    KIRO_PROVIDER_ID,
    OPENAI_CODEX_PROVIDER_ID,
    getOAuthAccountAdapter,
    deleteOAuthAccount,
    importOAuthAccountCredential,
    listOAuthAccounts,
    readOAuthAccountCredential,
    saveOAuthAccountCredential,
    activateOAuthAccount,
  } = await import("./oauth-accounts");

  const firstCred = {
    access: encodeJwtPayload({ email: "alpha@example.com", name: "Alpha User" }),
    refresh: "antigravity-refresh-alpha",
    expires: 1_800_000_000_000,
    projectId: "secret-project-alpha-xyz",
    email: "alpha@example.com",
  };

  const secondCred = {
    access: "antigravity-access-beta",
    refresh: "antigravity-refresh-beta",
    expires: 1_800_000_000_001,
    projectId: "secret-project-beta-xyz",
    email: "beta@example.com",
  };

  try {
    // ── basic save / list / read ──────────────────────────────────────────

    const first = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, firstCred);
    const second = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, secondCred);

    notStrictEqual(first.accountId, second.accountId, "each antigravity credential gets an independent storage id");
    strictEqual(first.accountId.startsWith("acct_"), true);
    strictEqual(second.accountId.startsWith("acct_"), true);

    // Saving the same real identity again must still allocate a new opaque id.
    const third = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      ...firstCred,
      access: encodeJwtPayload({ email: "alpha@example.com" }),
      refresh: "antigravity-refresh-alpha",
    });
    notStrictEqual(third.accountId, first.accountId, "duplicate login must not overwrite the first storage id");

    const list = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    strictEqual(list.provider, ANTIGRAVITY_PROVIDER_ID);
    strictEqual(list.accounts.length, 3);
    deepStrictEqual(
      list.accounts.map((a) => a.accountId).sort(),
      [first.accountId, second.accountId, third.accountId].sort(),
    );

    // Account projections must never include secrets or projectId.
    for (const account of list.accounts) {
      const serialized = JSON.stringify(account);
      ok(!serialized.includes("secret-project-"), "account projection must not leak projectId");
      ok(!serialized.includes("antigravity-refresh-"), "account projection must not leak refresh");
      ok(!serialized.includes("antigravity-access-"), "account projection must not leak access");
    }

    const readFirst = await readOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    strictEqual(readFirst.refresh, "antigravity-refresh-alpha");
    strictEqual(readFirst.expires, 1_800_000_000_000);
    strictEqual((readFirst as Record<string, unknown>).projectId, "secret-project-alpha-xyz");
    strictEqual((readFirst as Record<string, unknown>).email, "alpha@example.com");
    ok(
      typeof readFirst.accountId === "string" && readFirst.accountId.startsWith("antigravity-"),
      "real account id is hashed refresh token",
    );

    const readSecond = await readOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, second.accountId);
    strictEqual(readSecond.refresh, "antigravity-refresh-beta");
    strictEqual((readSecond as Record<string, unknown>).projectId, "secret-project-beta-xyz");
    notStrictEqual(readFirst.accountId, readSecond.accountId, "different refresh tokens produce different real account ids");

    // ── metadata contains no credential material / projectId ──────────────

    const metadata = JSON.parse(
      await readFile(join(agentDir, "auth-accounts", ANTIGRAVITY_PROVIDER_ID, "accounts.json"), "utf8"),
    ) as { version: number; accounts: Array<Record<string, unknown>> };
    strictEqual(metadata.version, 2);
    const metadataSerialized = JSON.stringify(metadata);
    ok(!metadataSerialized.includes("secret-project-"), "accounts.json must not contain projectId");
    ok(!metadataSerialized.includes("antigravity-refresh-"), "accounts.json must not contain refresh");
    for (const entry of metadata.accounts) {
      ok(typeof entry.accountId === "string");
      ok(typeof entry.chatgptAccountId === "string");
      ok(String(entry.chatgptAccountId).startsWith("antigravity-"));
      strictEqual("access" in entry, false, "metadata must not contain access token");
      strictEqual("refresh" in entry, false, "metadata must not contain refresh token");
      strictEqual("projectId" in entry, false, "metadata must not contain projectId");
    }

    // Credential file must contain the full credential for refresh.
    const credFile = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", ANTIGRAVITY_PROVIDER_ID, `${encodeURIComponent(first.accountId)}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    strictEqual(credFile.access, firstCred.access);
    strictEqual(credFile.refresh, "antigravity-refresh-alpha");
    strictEqual(credFile.projectId, "secret-project-alpha-xyz");

    // ── file permissions (POSIX) ──────────────────────────────────────────

    if (POSIX_PERM) {
      const credStat = await stat(
        join(agentDir, "auth-accounts", ANTIGRAVITY_PROVIDER_ID, `${encodeURIComponent(first.accountId)}.json`),
      );
      strictEqual(credStat.mode & 0o777, 0o600, "credential file must be 0600");

      const dirStat = await stat(join(agentDir, "auth-accounts", ANTIGRAVITY_PROVIDER_ID));
      strictEqual(dirStat.mode & 0o777, 0o700, "account store directory must be 0700");
    }

    // ── provider isolation ────────────────────────────────────────────────

    const openaiList = await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID);
    const antiIds = new Set([first.accountId, second.accountId, third.accountId]);
    for (const account of openaiList.accounts) {
      ok(!antiIds.has(account.accountId), "antigravity accounts must not leak into openai-codex listing");
    }

    await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "grok-access",
      refresh: "grok-refresh",
      expires: 1_800_000_000_000,
    });
    await saveOAuthAccountCredential(KIRO_PROVIDER_ID, {
      access: "kiro-access",
      refresh: "kiro-refresh",
      expires: 1_800_000_000_000,
    });
    const antiList = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    strictEqual(antiList.accounts.length, 3, "other provider accounts must not appear in antigravity listing");

    // ── activation ────────────────────────────────────────────────────────

    let afterActivate = await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    strictEqual(afterActivate.activeAccountId, first.accountId);
    const activeSummary = afterActivate.accounts.find((a) => a.accountId === first.accountId);
    ok(activeSummary?.active, "activated account should be marked active");
    ok(activeSummary?.lastActivatedAt, "lastActivatedAt should be set");

    afterActivate = await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, second.accountId);
    strictEqual(afterActivate.activeAccountId, second.accountId);

    // ── delete non-active ─────────────────────────────────────────────────

    await deleteOAuthAccount(ANTIGRAVITY_PROVIDER_ID, first.accountId);
    const afterDelete = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
    strictEqual(afterDelete.accounts.some((a) => a.accountId === first.accountId), false);
    strictEqual(afterDelete.activeAccountId, second.accountId);

    const deletedDir = join(agentDir, "auth-accounts", ANTIGRAVITY_PROVIDER_ID, "deleted");
    const deletedFiles = await readdir(deletedDir);
    ok(deletedFiles.length >= 1, "deleted credential should be in deleted/");

    // ── cannot delete active account ──────────────────────────────────────

    await rejects(
      () => deleteOAuthAccount(ANTIGRAVITY_PROVIDER_ID, second.accountId),
      { name: "OAuthAccountStoreError" },
      "deleting active account must return 409",
    );

    // ── credential import is rejected ─────────────────────────────────────

    await rejects(
      () => importOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, "raw", firstCred),
      { name: "OAuthAccountStoreError" },
      "google-antigravity must reject credential import",
    );

    // ── adapter registry ──────────────────────────────────────────────────

    const adapter = getOAuthAccountAdapter(ANTIGRAVITY_PROVIDER_ID);
    strictEqual(adapter.id, ANTIGRAVITY_PROVIDER_ID);
    strictEqual(adapter.supportsCredentialImport, false);
    strictEqual(adapter.isCredential(firstCred), true);
    strictEqual(adapter.isCredential(secondCred), true);
    strictEqual(adapter.isCredential({ access: "a", refresh: "r", expires: Number.NaN, projectId: "p" }), false);
    strictEqual(adapter.isCredential({ access: "a", refresh: "r", expires: 1 }), false, "missing projectId rejected");
    strictEqual(adapter.isCredential({ access: "", refresh: "r", expires: 1, projectId: "p" }), false);
    strictEqual(adapter.isCredential({}), false);
    strictEqual(adapter.isCredential(null), false);

    const openaiAdapter = getOAuthAccountAdapter(OPENAI_CODEX_PROVIDER_ID);
    strictEqual(openaiAdapter.isCredential(firstCred), false, "openai adapter rejects antigravity creds without type:oauth");

    // ── display hint safety ───────────────────────────────────────────────

    const firstHint = adapter.deriveDisplayHint(firstCred);
    strictEqual(firstHint, "alpha@example.com", "display hint uses safe email");
    ok(!String(firstHint).includes("secret-project-"), "display hint must not include projectId");

    const noEmailHint = adapter.deriveDisplayHint({
      access: encodeJwtPayload({ name: "Only Name" }),
      refresh: "r",
      expires: 1,
      projectId: "must-not-leak",
    });
    strictEqual(noEmailHint, "Only Name");
    ok(!String(noEmailHint).includes("must-not-leak"));

    console.log("Antigravity OAuth account store tests passed");
  } finally {
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
