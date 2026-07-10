import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-oauth-account-store-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const {
    OPENAI_CODEX_PROVIDER_ID,
    importOAuthAccountCredential,
    listOAuthAccounts,
    readOAuthAccountCredential,
    saveOAuthAccountCredential,
  } = await import("./oauth-accounts");

  const providerDir = join(agentDir, "auth-accounts", OPENAI_CODEX_PROVIDER_ID);
  const realChatGptAccountId = "real-chatgpt-account-id";

  try {
  const first = await saveOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, {
    type: "oauth",
    access: "access-one",
    refresh: "refresh-one",
    expires: 1_800_000_000_000,
    accountId: realChatGptAccountId,
  });
  const second = await saveOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, {
    type: "oauth",
    access: "access-two",
    refresh: "refresh-two",
    expires: 1_800_000_000_000,
    accountId: realChatGptAccountId,
  });

  notStrictEqual(first.accountId, second.accountId, "each saved credential needs an independent storage id");
  strictEqual(first.accountId.startsWith("acct_"), true);
  strictEqual(second.accountId.startsWith("acct_"), true);
  deepStrictEqual(
    (await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID)).accounts.map((account) => account.accountId).sort(),
    [first.accountId, second.accountId].sort(),
  );
  strictEqual((await readOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, first.accountId)).accountId, realChatGptAccountId);
  strictEqual((await readOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, first.accountId)).access, "access-one");
  strictEqual((await readOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, second.accountId)).accountId, realChatGptAccountId);
  strictEqual((await readOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, second.accountId)).access, "access-two");

  const metadata = JSON.parse(await readFile(join(providerDir, "accounts.json"), "utf8")) as { version: number; accounts: { accountId: string; chatgptAccountId?: string }[] };
  strictEqual(metadata.version, 2);
  deepStrictEqual(metadata.accounts.map((account) => account.chatgptAccountId), [realChatGptAccountId, realChatGptAccountId]);

  const legacyId = "legacy-chatgpt-id";
  await writeFile(join(providerDir, `${encodeURIComponent(legacyId)}.json`), JSON.stringify({
    type: "oauth", access: "legacy-access", refresh: "legacy-refresh", expires: 1_800_000_000_000, accountId: legacyId,
  }));
  await writeFile(join(providerDir, "accounts.json"), JSON.stringify({
    version: 1,
    activeAccountId: legacyId,
    accounts: [{ accountId: legacyId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  }));

  const legacy = await readOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, legacyId);
  strictEqual(legacy.accountId, legacyId, "v1 files remain readable at their legacy storage path");
  await saveOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, { ...legacy, access: "legacy-access-refreshed" }, { storageId: legacyId });
  const rewrittenLegacy = JSON.parse(await readFile(join(providerDir, `${encodeURIComponent(legacyId)}.json`), "utf8")) as { accountId: string; access: string };
  strictEqual(rewrittenLegacy.accountId, legacyId);
  strictEqual(rewrittenLegacy.access, "legacy-access-refreshed", "refresh-style writes preserve the legacy path");

  const imported = await importOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, "cpa", [
    {
      type: "codex",
      account_id: realChatGptAccountId,
      access_token: "cpa-access-without-refresh",
      expired: "2027-01-01T00:00:00Z",
    },
    {
      type: "codex",
      account_id: realChatGptAccountId,
      access_token: "cpa-access-with-refresh",
      refresh_token: "cpa-refresh",
      expired: "2027-01-01T00:00:00Z",
    },
  ]);
  strictEqual(imported.warnings.length, 1, "missing CPA refresh token is a non-blocking warning");
  strictEqual(imported.warnings[0].code, "missing_refresh_token");
  strictEqual(imported.accounts.length, 3, "CPA imports sharing a real id remain distinct from legacy storage");
  const importedCredentials = await Promise.all(imported.accounts
    .filter((account) => account.accountId !== legacyId)
    .map((account) => readOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, account.accountId)));
  strictEqual(importedCredentials.filter((account) => account.accountId === realChatGptAccountId).length, 2);
  deepStrictEqual(importedCredentials.map((account) => account.access).sort(), ["cpa-access-with-refresh", "cpa-access-without-refresh"].sort());
  strictEqual(importedCredentials.some((account) => account.refresh === ""), true, "missing refresh is stored as an empty string");
  const duplicateImport = await importOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, "cpa", {
    type: "codex",
    account_id: realChatGptAccountId,
    access_token: "cpa-access-with-refresh",
    refresh_token: "cpa-refresh",
    expired: "2027-01-01T00:00:00Z",
  });
  strictEqual(duplicateImport.accounts.length, 4, "an identical CPA credential is stored as a separate account");

  const countBeforeInvalidBatch = (await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID)).accounts.length;
  await importOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, "cpa", [
    { account_id: "another-real-id", access_token: "valid-access", expired: "2027-01-01T00:00:00Z" },
    { account_id: "another-real-id", refresh_token: "missing-access", expired: "2027-01-01T00:00:00Z" },
  ]).then(
    () => { throw new Error("invalid CPA batch unexpectedly imported"); },
    (error: unknown) => strictEqual((error as Error).message, "CPA JSON 缺少 access_token"),
  );
  strictEqual((await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID)).accounts.length, countBeforeInvalidBatch, "invalid batch leaves no partial imports");

  console.log("OAuth account storage identity and CPA import tests passed");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
}

void main();
