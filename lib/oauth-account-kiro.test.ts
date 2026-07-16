/**
 * kiro saved-account store tests
 *
 * Validates that the generic OAuth account store can save, list, activate, and
 * delete kiro credentials independently of openai-codex/grok-cli.  Covers
 * Builder ID and social credential shapes, opaque storage ids, delete-active
 * protection, and secret-safe projections.  No AWS/Kiro network calls.
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
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-oauth-kiro-account-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const {
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

  // Builder ID credentials from pi-kiro-provider keep client metadata for OIDC refresh.
  const builderCred = {
    access: encodeJwtPayload({ email: "builder@example.com", name: "Builder User" }),
    refresh: "kiro-refresh-builder-one",
    expires: 1_800_000_000_000,
    clientId: "kiro-client-id",
    clientSecret: "kiro-client-secret-value",
    region: "us-east-1",
    authMethod: "builder-id",
  };

  // Social credentials may include profileArn / provider / request headers.
  const socialCred = {
    access: "kiro-access-social-two",
    refresh: "kiro-refresh-social-two",
    expires: 1_800_000_000_001,
    profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABCDEFGHIJK",
    authMethod: "google",
    provider: "Google",
    request: {
      headers: {
        "X-Amzn-Kiro-ProfileArn": "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABCDEFGHIJK",
      },
    },
  };

  try {
    // ── basic save / list / read ──────────────────────────────────────────

    const first = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, builderCred);
    const second = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, socialCred);

    notStrictEqual(first.accountId, second.accountId, "each kiro credential gets an independent storage id");
    strictEqual(first.accountId.startsWith("acct_"), true);
    strictEqual(second.accountId.startsWith("acct_"), true);

    // Saving the same real identity again must still allocate a new opaque id.
    const third = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, {
      ...builderCred,
      access: encodeJwtPayload({ email: "builder@example.com" }),
      refresh: "kiro-refresh-builder-one",
    });
    notStrictEqual(third.accountId, first.accountId, "duplicate login must not overwrite the first storage id");

    const list = await listOAuthAccounts(KIRO_PROVIDER_ID);
    strictEqual(list.provider, KIRO_PROVIDER_ID);
    strictEqual(list.accounts.length, 3);
    deepStrictEqual(
      list.accounts.map((a) => a.accountId).sort(),
      [first.accountId, second.accountId, third.accountId].sort(),
    );

    // Account projections must never include secrets or full profile ARN.
    for (const account of list.accounts) {
      const serialized = JSON.stringify(account);
      ok(!serialized.includes("kiro-client-secret-value"), "account projection must not leak clientSecret");
      ok(!serialized.includes("kiro-refresh-"), "account projection must not leak refresh token");
      ok(!serialized.includes("arn:aws:codewhisperer"), "account projection must not leak profileArn");
      ok(!serialized.includes("X-Amzn-Kiro-ProfileArn"), "account projection must not leak request headers");
    }

    const readFirst = await readOAuthAccountCredential(KIRO_PROVIDER_ID, first.accountId);
    strictEqual(readFirst.refresh, "kiro-refresh-builder-one");
    strictEqual(readFirst.expires, 1_800_000_000_000);
    strictEqual((readFirst as Record<string, unknown>).clientId, "kiro-client-id");
    strictEqual((readFirst as Record<string, unknown>).clientSecret, "kiro-client-secret-value");
    strictEqual((readFirst as Record<string, unknown>).region, "us-east-1");
    strictEqual((readFirst as Record<string, unknown>).authMethod, "builder-id");
    ok(typeof readFirst.accountId === "string" && readFirst.accountId.startsWith("kiro-"), "real account id is hashed refresh token");

    const readSecond = await readOAuthAccountCredential(KIRO_PROVIDER_ID, second.accountId);
    strictEqual(readSecond.refresh, "kiro-refresh-social-two");
    strictEqual((readSecond as Record<string, unknown>).profileArn, socialCred.profileArn);
    strictEqual((readSecond as Record<string, unknown>).authMethod, "google");
    strictEqual((readSecond as Record<string, unknown>).provider, "Google");
    notStrictEqual(readFirst.accountId, readSecond.accountId, "different refresh tokens produce different real account ids");

    // ── metadata contains no credential material ──────────────────────────

    const metadata = JSON.parse(
      await readFile(join(agentDir, "auth-accounts", KIRO_PROVIDER_ID, "accounts.json"), "utf8"),
    ) as { version: number; accounts: Array<Record<string, unknown>> };
    strictEqual(metadata.version, 2);
    for (const entry of metadata.accounts) {
      ok(typeof entry.accountId === "string");
      ok(typeof entry.chatgptAccountId === "string");
      ok(String(entry.chatgptAccountId).startsWith("kiro-"));
      strictEqual("access" in entry, false, "metadata must not contain access token");
      strictEqual("refresh" in entry, false, "metadata must not contain refresh token");
      strictEqual("clientSecret" in entry, false, "metadata must not contain clientSecret");
      strictEqual("profileArn" in entry, false, "metadata must not contain profileArn");
    }

    // Credential file must contain the full credential for refresh.
    const credFile = JSON.parse(
      await readFile(
        join(agentDir, "auth-accounts", KIRO_PROVIDER_ID, `${encodeURIComponent(first.accountId)}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    strictEqual(credFile.access, builderCred.access);
    strictEqual(credFile.refresh, "kiro-refresh-builder-one");
    strictEqual(credFile.clientSecret, "kiro-client-secret-value");
    strictEqual(credFile.region, "us-east-1");

    // ── file permissions (POSIX) ──────────────────────────────────────────

    if (POSIX_PERM) {
      const credStat = await stat(
        join(agentDir, "auth-accounts", KIRO_PROVIDER_ID, `${encodeURIComponent(first.accountId)}.json`),
      );
      strictEqual(credStat.mode & 0o777, 0o600, "credential file must be 0600");

      const dirStat = await stat(join(agentDir, "auth-accounts", KIRO_PROVIDER_ID));
      strictEqual(dirStat.mode & 0o777, 0o700, "account store directory must be 0700");
    }

    // ── provider isolation ────────────────────────────────────────────────

    const openaiList = await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID);
    const kiroIds = new Set([first.accountId, second.accountId, third.accountId]);
    for (const account of openaiList.accounts) {
      ok(!kiroIds.has(account.accountId), "kiro accounts must not leak into openai-codex listing");
    }

    await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "grok-access",
      refresh: "grok-refresh",
      expires: 1_800_000_000_000,
    });
    const kiroList = await listOAuthAccounts(KIRO_PROVIDER_ID);
    strictEqual(kiroList.accounts.length, 3, "grok-cli accounts must not appear in kiro listing");

    // ── activation ────────────────────────────────────────────────────────

    let afterActivate = await activateOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
    strictEqual(afterActivate.activeAccountId, first.accountId);
    const activeSummary = afterActivate.accounts.find((a) => a.accountId === first.accountId);
    ok(activeSummary?.active, "activated account should be marked active");
    ok(activeSummary?.lastActivatedAt, "lastActivatedAt should be set");

    afterActivate = await activateOAuthAccount(KIRO_PROVIDER_ID, second.accountId);
    strictEqual(afterActivate.activeAccountId, second.accountId);

    // ── delete non-active ─────────────────────────────────────────────────

    await deleteOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
    const afterDelete = await listOAuthAccounts(KIRO_PROVIDER_ID);
    strictEqual(afterDelete.accounts.some((a) => a.accountId === first.accountId), false);
    strictEqual(afterDelete.activeAccountId, second.accountId);

    const deletedDir = join(agentDir, "auth-accounts", KIRO_PROVIDER_ID, "deleted");
    const deletedFiles = await readdir(deletedDir);
    ok(deletedFiles.length >= 1, "deleted credential should be in deleted/");

    // ── cannot delete active account ──────────────────────────────────────

    await rejects(
      () => deleteOAuthAccount(KIRO_PROVIDER_ID, second.accountId),
      { name: "OAuthAccountStoreError" },
      "deleting active account must return 409",
    );

    // ── credential import is rejected ─────────────────────────────────────

    await rejects(
      () => importOAuthAccountCredential(KIRO_PROVIDER_ID, "raw", builderCred),
      { name: "OAuthAccountStoreError" },
      "kiro must reject credential import",
    );

    // ── adapter registry ──────────────────────────────────────────────────

    const kiroAdapter = getOAuthAccountAdapter(KIRO_PROVIDER_ID);
    strictEqual(kiroAdapter.id, KIRO_PROVIDER_ID);
    strictEqual(kiroAdapter.supportsCredentialImport, false);
    strictEqual(kiroAdapter.isCredential(builderCred), true);
    strictEqual(kiroAdapter.isCredential(socialCred), true);
    strictEqual(kiroAdapter.isCredential({ access: "a", refresh: "r", expires: Number.NaN }), false);
    strictEqual(kiroAdapter.isCredential({ access: "", refresh: "r", expires: 1 }), false);
    strictEqual(kiroAdapter.isCredential({}), false);
    strictEqual(kiroAdapter.isCredential(null), false);

    const openaiAdapter = getOAuthAccountAdapter(OPENAI_CODEX_PROVIDER_ID);
    strictEqual(openaiAdapter.isCredential(builderCred), false, "openai adapter rejects kiro creds without type:oauth");

    // ── display hint safety ───────────────────────────────────────────────

    const builderHint = kiroAdapter.deriveDisplayHint(builderCred);
    strictEqual(builderHint, "builder@example.com", "display hint extracted from access JWT email");

    const socialHint = kiroAdapter.deriveDisplayHint(socialCred);
    strictEqual(socialHint, "Google/google", "fallback hint uses provider/authMethod without secrets");
    ok(!String(socialHint).includes("arn:aws"), "display hint must not include profileArn");

    console.log("Kiro OAuth account store tests passed");
  } finally {
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
