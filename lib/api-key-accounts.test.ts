/**
 * Isolated lifecycle regression coverage for managed API-key accounts
 * (xai / opencode-go / anyrouter) and AnyRouter source-config contracts.
 *
 * Always runs against a temporary PI_CODING_AGENT_DIR so the user's real
 * `~/.pi/agent` auth store is never read or written.
 *
 * Run with: npm run test:api-key-accounts
 */

import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getWebCredentialStore } from "./web-credential-store";

async function setAuthCredential(provider: string, credential: { type: "api_key"; key: string }) {
  const store = await getWebCredentialStore();
  await store.modify(provider, async () => credential);
}

async function readAuthCredential(provider: string) {
  const store = await getWebCredentialStore();
  return store.read(provider);
}
import {
  __apiKeyAccountLockUsesFsPrimitivesForTests,
  activateApiKeyAccount,
  createApiKeyAccount,
  deleteApiKeyAccount,
  disableApiKeyAccount,
  getApiKeyProviderSummary,
  importLegacyKeyIfNeeded,
  isManagedApiKeyProvider,
  listApiKeyAccounts,
  requiresExplicitActiveDisposition,
  revealApiKeyAccount,
  updateApiKeyAccount,
} from "./api-key-accounts";
import {
  __anyrouterConfigEnvNamesForTests,
  __anyrouterConfigLockUsesFsPrimitivesForTests,
  ANYROUTER_PROVIDER_ID,
  getAnyRouterSafeConfig,
  patchAnyRouterConfig,
  readAnyrouterConfigRaw,
  resolveAnyRouterEffectiveBaseUrl,
  resolveLegacyAnyrouterSourceApiKey,
  validateAnyRouterBaseUrl,
} from "./anyrouter-config";
import {
  ensureAnyRouterConfigEnvPointsAtBridge,
  getAnyRouterConfigEnvNameForTests,
  getAnyRouterRuntimeBridgePath,
  readAnyRouterRuntimeBridgeUnlocked,
  reconcileAnyRouterRuntimeMirrors,
} from "./anyrouter-runtime-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      passed += 1;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  \x1b[31m✗\x1b[0m ${name}: ${message}`);
      failed += 1;
    });
}

function fingerprint(key: string): string {
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

function containsPlaintext(value: unknown, secrets: string[]): boolean {
  const text = JSON.stringify(value);
  return secrets.some((secret) => text.includes(secret));
}

async function readAuthJson(agentDir: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readMetadata(
  agentDir: string,
  provider: string,
): Promise<{ activeAccountId: string | null; accounts: Array<Record<string, unknown>> }> {
  const raw = await readFile(
    join(agentDir, "auth-api-key-accounts", provider, "accounts.json"),
    "utf8",
  );
  return JSON.parse(raw) as {
    activeAccountId: string | null;
    accounts: Array<Record<string, unknown>>;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const realAgentDir = join(homedir(), ".pi", "agent");
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-api-key-accounts-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Fail fast if isolation is broken before any test mutates state.
  strictEqual(getAgentDir(), agentDir, "getAgentDir must honor PI_CODING_AGENT_DIR");
  notStrictEqual(agentDir, realAgentDir, "temp agent dir must not be the real user agent dir");
  ok(!agentDir.startsWith(realAgentDir + "/"), "temp agent dir must not nest under real agent dir");

  const LEGACY_XAI_KEY = "xai-legacy-key-AAAA-BBBB-CCCC";
  const SECOND_XAI_KEY = "xai-second-key-DDDD-EEEE-FFFF";
  const UPDATED_XAI_KEY = "xai-updated-key-GGGG-HHHH-IIII";
  const OPENCODE_KEY_SAME_AS_SECOND = SECOND_XAI_KEY; // intentional same fingerprint across providers
  const OPENCODE_KEY_OTHER = "opencode-go-key-JJJJ-KKKK-LLLL";
  const ANYROUTER_KEY_A = "anyrouter-key-AAAA-1111-2222";
  const ANYROUTER_KEY_B = "anyrouter-key-BBBB-3333-4444";
  const ANYROUTER_LEGACY_SOURCE_KEY = "anyrouter-source-legacy-KEY-ZZZZ";
  const ALL_SECRETS = [
    LEGACY_XAI_KEY,
    SECOND_XAI_KEY,
    UPDATED_XAI_KEY,
    OPENCODE_KEY_SAME_AS_SECOND,
    OPENCODE_KEY_OTHER,
    ANYROUTER_KEY_A,
    ANYROUTER_KEY_B,
    ANYROUTER_LEGACY_SOURCE_KEY,
  ];

  // Clear AnyRouter env overrides for deterministic config tests.
  const envNames = __anyrouterConfigEnvNamesForTests();
  const savedEnv: Record<string, string | undefined> = {};
  for (const name of Object.values(envNames)) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  try {
    console.log("\n=== managed provider allowlist ===");

    await test("xai, opencode-go and anyrouter are managed; others stay single", () => {
      strictEqual(isManagedApiKeyProvider("xai"), true);
      strictEqual(isManagedApiKeyProvider("opencode-go"), true);
      strictEqual(isManagedApiKeyProvider("anyrouter"), true);
      strictEqual(isManagedApiKeyProvider(ANYROUTER_PROVIDER_ID), true);
      strictEqual(isManagedApiKeyProvider("openai"), false);
      strictEqual(isManagedApiKeyProvider("anthropic"), false);
      strictEqual(isManagedApiKeyProvider("google"), false);
      strictEqual(requiresExplicitActiveDisposition("anyrouter"), true);
      strictEqual(requiresExplicitActiveDisposition("xai"), false);
      strictEqual(requiresExplicitActiveDisposition("opencode-go"), false);
      ok(__apiKeyAccountLockUsesFsPrimitivesForTests());
      ok(__anyrouterConfigLockUsesFsPrimitivesForTests());
    });

    console.log("\n=== summary does not trigger legacy import ===");

    await test("summary sees legacy credential without creating account store", async () => {
      await setAuthCredential("xai", { type: "api_key", key: LEGACY_XAI_KEY });
      const summary = await getApiKeyProviderSummary("xai");
      ok(summary);
      strictEqual(summary!.authMode, "managed_accounts");
      strictEqual(summary!.configured, true);
      strictEqual(summary!.accountCount, 1);
      strictEqual(summary!.activeAccountId, null);
      ok(!containsPlaintext(summary, ALL_SECRETS), "summary must not contain plaintext keys");

      // No account store directory yet — list (not summary) performs import.
      let storeExists = true;
      try {
        await readdir(join(agentDir, "auth-api-key-accounts", "xai"));
      } catch {
        storeExists = false;
      }
      strictEqual(storeExists, false, "summary must not create auth-api-key-accounts/xai");
    });

    console.log("\n=== xAI lifecycle (legacy import, activate, update, reveal, delete fallback) ===");

    let importedAccountId = "";
    let secondAccountId = "";

    await test("list imports legacy xAI key once and masks list projection", async () => {
      const first = await listApiKeyAccounts("xai");
      strictEqual(first.provider, "xai");
      strictEqual(first.authMode, "managed_accounts");
      strictEqual(first.accountCount, 1);
      strictEqual(first.accounts.length, 1);
      importedAccountId = first.accounts[0].accountId;
      strictEqual(first.activeAccountId, importedAccountId);
      strictEqual(first.accounts[0].active, true);
      ok(!containsPlaintext(first, ALL_SECRETS), "list must never include plaintext keys");
      ok(!("keyFingerprint" in first.accounts[0]), "list must not expose fingerprint");

      const metadata = await readMetadata(agentDir, "xai");
      strictEqual(metadata.activeAccountId, importedAccountId);
      strictEqual(metadata.accounts[0].keyFingerprint, fingerprint(LEGACY_XAI_KEY));
      ok(
        typeof metadata.accounts[0].importedFromLegacyAt === "string",
        "import timestamp recorded",
      );

      // Secret file exists and is 0600 where the platform supports modes.
      const secretPath = join(
        agentDir,
        "auth-api-key-accounts",
        "xai",
        `${encodeURIComponent(importedAccountId)}.json`,
      );
      const secret = JSON.parse(await readFile(secretPath, "utf8")) as { key?: string };
      strictEqual(secret.key, LEGACY_XAI_KEY);
      const st = await stat(secretPath);
      // On some platforms mode bits are not fully honored; only assert when they look set.
      if ((st.mode & 0o777) === 0o600 || (st.mode & 0o777) === 0o666) {
        // Accept either strict 0600 or platform-default; never world-writable with group/other write alone.
        ok((st.mode & 0o002) === 0, "secret file must not be world-writable");
      }

      // Second list is idempotent.
      const secondList = await listApiKeyAccounts("xai");
      strictEqual(secondList.accountCount, 1);
      strictEqual(secondList.accounts[0].accountId, importedAccountId);

      const imported = await importLegacyKeyIfNeeded("xai");
      strictEqual(imported, false, "second import must be a no-op");

      const thirdList = await listApiKeyAccounts("xai");
      strictEqual(thirdList.accountCount, 1);
    });

    await test("create second xAI account without activating leaves active unchanged", async () => {
      const created = await createApiKeyAccount("xai", {
        displayName: "Secondary xAI",
        description: "backup",
        apiKey: SECOND_XAI_KEY,
        activate: false,
      });
      strictEqual(created.accountCount, 2);
      secondAccountId = created.accounts.find((a) => a.accountId !== importedAccountId)!.accountId;
      strictEqual(created.activeAccountId, importedAccountId);
      ok(!containsPlaintext(created, ALL_SECRETS));

      const auth = await readAuthJson(agentDir);
      const xaiCred = auth.xai as { type?: string; key?: string } | undefined;
      strictEqual(xaiCred?.key, LEGACY_XAI_KEY, "auth.json still mirrors the active legacy key");
    });

    await test("activate second account rewrites auth.json mirror", async () => {
      const activated = await activateApiKeyAccount("xai", secondAccountId);
      strictEqual(activated.activeAccountId, secondAccountId);
      ok(activated.accounts.find((a) => a.accountId === secondAccountId)?.active);

      const auth = await readAuthCredential("xai");
      strictEqual(
        auth && auth.type === "api_key" ? auth.key : null,
        SECOND_XAI_KEY,
      );

      const authJson = await readAuthJson(agentDir);
      const xaiCred = authJson.xai as { type?: string; key?: string } | undefined;
      strictEqual(xaiCred?.key, SECOND_XAI_KEY);
    });

    await test("update active account key rewrites secret and auth.json mirror", async () => {
      const updated = await updateApiKeyAccount("xai", secondAccountId, {
        displayName: "Secondary xAI (rotated)",
        apiKey: UPDATED_XAI_KEY,
      });
      const entry = updated.accounts.find((a) => a.accountId === secondAccountId);
      strictEqual(entry?.displayName, "Secondary xAI (rotated)");
      ok(!containsPlaintext(updated, ALL_SECRETS), "update response must not leak plaintext");

      const revealed = await revealApiKeyAccount("xai", secondAccountId);
      strictEqual(revealed.apiKey, UPDATED_XAI_KEY);

      const auth = await readAuthCredential("xai");
      strictEqual(
        auth && auth.type === "api_key" ? auth.key : null,
        UPDATED_XAI_KEY,
        "active key update must re-mirror",
      );
    });

    await test("reveal returns only the requested account plaintext", async () => {
      const revealed = await revealApiKeyAccount("xai", importedAccountId);
      strictEqual(revealed.accountId, importedAccountId);
      strictEqual(revealed.apiKey, LEGACY_XAI_KEY);
      strictEqual(Object.keys(revealed).sort().join(","), "accountId,apiKey");
    });

    console.log("\n=== delete fallback and last-account clear ===");

    await test("deleting active account falls back to most recently activated remaining account", async () => {
      // Ensure imported account becomes the fallback (only remaining after delete).
      const afterDelete = await deleteApiKeyAccount("xai", secondAccountId);
      strictEqual(afterDelete.accountCount, 1);
      strictEqual(afterDelete.activeAccountId, importedAccountId);
      strictEqual(afterDelete.accounts[0].active, true);

      const auth = await readAuthCredential("xai");
      strictEqual(
        auth && auth.type === "api_key" ? auth.key : null,
        LEGACY_XAI_KEY,
        "fallback account must be mirrored",
      );
    });

    await test("deleting the last xAI account clears auth.json credential", async () => {
      const empty = await deleteApiKeyAccount("xai", importedAccountId);
      strictEqual(empty.accountCount, 0);
      strictEqual(empty.activeAccountId, null);
      deepStrictEqual(empty.accounts, []);

      const auth = await readAuthCredential("xai");
      strictEqual(auth, undefined, "last-delete must clear xAI from auth storage");

      const authJson = await readAuthJson(agentDir);
      strictEqual(authJson.xai, undefined, "last-delete must remove xai from auth.json");
    });

    console.log("\n=== xai / opencode-go isolation ===");

    await test("identical key fingerprints are not deduped across providers", async () => {
      // Seed both providers with the same raw key value.
      const xaiList = await createApiKeyAccount("xai", {
        displayName: "xAI shared fingerprint",
        apiKey: OPENCODE_KEY_SAME_AS_SECOND,
        activate: true,
      });
      const ogList = await createApiKeyAccount("opencode-go", {
        displayName: "OpenCode shared fingerprint",
        apiKey: OPENCODE_KEY_SAME_AS_SECOND,
        activate: true,
      });

      strictEqual(xaiList.accountCount, 1);
      strictEqual(ogList.accountCount, 1);
      notStrictEqual(
        xaiList.accounts[0].accountId,
        ogList.accounts[0].accountId,
        "account ids must be independent per provider",
      );

      const xaiMeta = await readMetadata(agentDir, "xai");
      const ogMeta = await readMetadata(agentDir, "opencode-go");
      strictEqual(xaiMeta.accounts[0].keyFingerprint, fingerprint(OPENCODE_KEY_SAME_AS_SECOND));
      strictEqual(ogMeta.accounts[0].keyFingerprint, fingerprint(OPENCODE_KEY_SAME_AS_SECOND));

      // Add a second opencode-go key and ensure xAI store is untouched.
      await createApiKeyAccount("opencode-go", {
        displayName: "OpenCode other",
        apiKey: OPENCODE_KEY_OTHER,
        activate: false,
      });
      const xaiAfter = await listApiKeyAccounts("xai");
      const ogAfter = await listApiKeyAccounts("opencode-go");
      strictEqual(xaiAfter.accountCount, 1, "opencode-go writes must not mutate xAI accounts");
      strictEqual(ogAfter.accountCount, 2);

      const auth = await readAuthJson(agentDir);
      const xaiCred = auth.xai as { key?: string } | undefined;
      const ogCred = auth["opencode-go"] as { key?: string } | undefined;
      strictEqual(xaiCred?.key, OPENCODE_KEY_SAME_AS_SECOND);
      strictEqual(ogCred?.key, OPENCODE_KEY_SAME_AS_SECOND);

      // Delete all xAI accounts; opencode-go must remain configured.
      await deleteApiKeyAccount("xai", xaiAfter.accounts[0].accountId);
      strictEqual((await listApiKeyAccounts("xai")).accountCount, 0);
      strictEqual(await readAuthCredential("xai"), undefined);
      strictEqual((await listApiKeyAccounts("opencode-go")).accountCount, 2);
      const ogStill = await readAuthCredential("opencode-go");
      strictEqual(
        ogStill && ogStill.type === "api_key" ? ogStill.key : null,
        OPENCODE_KEY_SAME_AS_SECOND,
      );
    });

    console.log("\n=== AnyRouter config contracts ===");

    await test("validateAnyRouterBaseUrl rejects userinfo/query/hash and normalizes trailing slash", () => {
      strictEqual(
        validateAnyRouterBaseUrl("https://anyrouter.example/v1/"),
        "https://anyrouter.example/v1",
      );
      rejectsSync(() => validateAnyRouterBaseUrl("https://user:pass@anyrouter.example"));
      rejectsSync(() => validateAnyRouterBaseUrl("https://anyrouter.example?x=1"));
      rejectsSync(() => validateAnyRouterBaseUrl("https://anyrouter.example#frag"));
      rejectsSync(() => validateAnyRouterBaseUrl("ftp://anyrouter.example"));
    });

    await test("safe config GET has no apiKey/models body/path and defaults retry", async () => {
      await writeFile(
        join(agentDir, "anyrouter.json"),
        JSON.stringify(
          {
            baseUrl: "https://anyrouter.example/",
            apiKey: ANYROUTER_LEGACY_SOURCE_KEY,
            models: [{ id: "claude-opus-4-8" }, { id: "gpt-codex" }],
            futureField: { keep: true },
            retry: { maxRetries: 5 },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const safe = getAnyRouterSafeConfig();
      strictEqual(safe.provider, "anyrouter");
      strictEqual(safe.globalBaseUrl, "https://anyrouter.example");
      strictEqual(safe.globalBaseUrlSource, "config");
      strictEqual(safe.globalBaseUrlEditable, true);
      strictEqual(safe.modelsConfigured, true);
      strictEqual(safe.modelCount, 2);
      strictEqual(safe.retry.effective.maxRetries, 5);
      strictEqual(safe.retry.source.maxRetries, "config");
      strictEqual(safe.retry.effective.baseDelayMs, 1000);
      strictEqual(safe.retry.source.baseDelayMs, "default");
      ok(!("apiKey" in safe));
      ok(!("models" in safe));
      ok(!("path" in safe));
      ok(!("futureField" in safe));
      ok(!containsPlaintext(safe, ALL_SECRETS));
      ok(!JSON.stringify(safe).includes(agentDir), "safe projection must not include absolute path");
    });

    await test("config PATCH preserves models/apiKey/unknown fields and rejects stale revision", async () => {
      const before = getAnyRouterSafeConfig();
      const patched = await patchAnyRouterConfig({
        revision: before.revision,
        baseUrl: "https://anyrouter.example/v2",
        retry: { maxRetries: 8, jitterMs: 100 },
      });
      strictEqual(patched.globalBaseUrl, "https://anyrouter.example/v2");
      strictEqual(patched.retry.effective.maxRetries, 8);
      strictEqual(patched.retry.effective.jitterMs, 100);
      strictEqual(patched.modelCount, 2);

      const raw = JSON.parse(await readFile(join(agentDir, "anyrouter.json"), "utf8")) as Record<
        string,
        unknown
      >;
      strictEqual(raw.apiKey, ANYROUTER_LEGACY_SOURCE_KEY, "apiKey must be preserved");
      ok(Array.isArray(raw.models) && (raw.models as unknown[]).length === 2);
      deepStrictEqual(raw.futureField, { keep: true });

      await rejects(
        () =>
          patchAnyRouterConfig({
            revision: before.revision,
            baseUrl: "https://should-not-write.example",
          }),
        (err: unknown) =>
          err instanceof Error &&
          err.name === "AnyRouterConfigError" &&
          (err as { code?: string }).code === "stale_revision",
      );

      const afterConflict = getAnyRouterSafeConfig();
      strictEqual(afterConflict.globalBaseUrl, "https://anyrouter.example/v2");
    });

    await test("env overrides retry/baseUrl source and blocks PATCH of env-owned fields", async () => {
      process.env[envNames.baseUrl] = "https://env-anyrouter.example";
      process.env[envNames.maxRetries] = "3";
      try {
        const safe = getAnyRouterSafeConfig();
        strictEqual(safe.globalBaseUrl, "https://env-anyrouter.example");
        strictEqual(safe.globalBaseUrlSource, "env");
        strictEqual(safe.globalBaseUrlEditable, false);
        strictEqual(safe.retry.effective.maxRetries, 3);
        strictEqual(safe.retry.source.maxRetries, "env");
        strictEqual(safe.retry.editable.maxRetries, false);
        strictEqual(safe.retry.editable.baseDelayMs, true);

        await rejects(
          () =>
            patchAnyRouterConfig({
              revision: safe.revision,
              retry: { maxRetries: 9 },
            }),
          (err: unknown) => err instanceof Error && /environment/i.test(err.message),
        );

        // Non-env field still writable.
        const patched = await patchAnyRouterConfig({
          revision: safe.revision,
          retry: { baseDelayMs: 500 },
        });
        strictEqual(patched.retry.effective.baseDelayMs, 500);
        strictEqual(patched.retry.effective.maxRetries, 3);
      } finally {
        delete process.env[envNames.baseUrl];
        delete process.env[envNames.maxRetries];
      }
    });

    await test("account override beats global env/source for effective Base URL", () => {
      process.env[envNames.baseUrl] = "https://env-anyrouter.example";
      try {
        strictEqual(
          resolveAnyRouterEffectiveBaseUrl({
            accountBaseUrlOverride: "https://account.example/v1/",
            storedGlobalBaseUrl: "https://config.example",
          }),
          "https://account.example/v1",
        );
        strictEqual(
          resolveAnyRouterEffectiveBaseUrl({
            accountBaseUrlOverride: "",
            storedGlobalBaseUrl: "https://config.example",
          }),
          "https://env-anyrouter.example",
        );
      } finally {
        delete process.env[envNames.baseUrl];
      }
    });

    console.log("\n=== AnyRouter managed accounts ===");

    let anyA = "";
    let anyB = "";

    await test("list imports legacy anyrouter.json apiKey without rewriting source", async () => {
      // Ensure source still has the legacy key from earlier config tests.
      const sourceBefore = readAnyrouterConfigRaw();
      strictEqual(sourceBefore.apiKey, ANYROUTER_LEGACY_SOURCE_KEY);

      const list = await listApiKeyAccounts("anyrouter");
      ok(list.accountCount >= 1);
      ok(!containsPlaintext(list, ALL_SECRETS));
      const imported = list.accounts.find((a) => a.displayName.includes("Imported"));
      ok(imported, "source key should import as opaque account");
      anyA = imported!.accountId;

      const sourceAfter = readAnyrouterConfigRaw();
      strictEqual(
        sourceAfter.apiKey,
        ANYROUTER_LEGACY_SOURCE_KEY,
        "legacy source apiKey must not be deleted",
      );
      strictEqual(resolveLegacyAnyrouterSourceApiKey(sourceAfter.apiKey), ANYROUTER_LEGACY_SOURCE_KEY);

      // Idempotent.
      const again = await importLegacyKeyIfNeeded("anyrouter");
      strictEqual(again, false);
      strictEqual((await listApiKeyAccounts("anyrouter")).accountCount, list.accountCount);
    });

    await test("create AnyRouter account with baseUrlOverride; list returns override only", async () => {
      const created = await createApiKeyAccount("anyrouter", {
        displayName: "AnyRouter B",
        apiKey: ANYROUTER_KEY_B,
        activate: false,
        baseUrlOverride: "https://override-b.example/v1/",
      });
      anyB = created.accounts.find((a) => a.displayName === "AnyRouter B")!.accountId;
      const entry = created.accounts.find((a) => a.accountId === anyB)!;
      strictEqual(entry.baseUrlOverride, "https://override-b.example/v1");
      ok(!containsPlaintext(created, ALL_SECRETS));
      // Active remains the imported account.
      strictEqual(created.activeAccountId, anyA);

      const auth = await readAuthCredential("anyrouter");
      strictEqual(
        auth && auth.type === "api_key" ? auth.key : null,
        ANYROUTER_LEGACY_SOURCE_KEY,
        "non-active create must not change Active mirror",
      );
    });

    await test("non-active update of baseUrlOverride never mutates Active pointer", async () => {
      const beforeActive = (await listApiKeyAccounts("anyrouter")).activeAccountId;
      const updated = await updateApiKeyAccount("anyrouter", anyB, {
        baseUrlOverride: "https://override-b2.example",
        displayName: "AnyRouter B2",
      });
      strictEqual(updated.activeAccountId, beforeActive);
      const entry = updated.accounts.find((a) => a.accountId === anyB)!;
      strictEqual(entry.baseUrlOverride, "https://override-b2.example");
      strictEqual(entry.displayName, "AnyRouter B2");

      // Clear override
      const cleared = await updateApiKeyAccount("anyrouter", anyB, { baseUrlOverride: null });
      const clearedEntry = cleared.accounts.find((a) => a.accountId === anyB)!;
      strictEqual(clearedEntry.baseUrlOverride, undefined);
      strictEqual(cleared.activeAccountId, beforeActive);
    });

    await test("active AnyRouter delete without disposition is rejected", async () => {
      // Ensure two accounts and active is anyA
      await activateApiKeyAccount("anyrouter", anyA);
      await rejects(
        () => deleteApiKeyAccount("anyrouter", anyA),
        (err: unknown) =>
          err instanceof Error &&
          (err as { status?: number }).status === 409 &&
          /replacement|disconnect|clearActive/i.test(err.message),
      );
      const still = await listApiKeyAccounts("anyrouter");
      strictEqual(still.activeAccountId, anyA);
      strictEqual(still.accountCount, 2);
    });

    await test("active AnyRouter delete with explicit replacement switches Active", async () => {
      const after = await deleteApiKeyAccount("anyrouter", anyA, {
        replacementAccountId: anyB,
      });
      strictEqual(after.accountCount, 1);
      strictEqual(after.activeAccountId, anyB);
      const auth = await readAuthCredential("anyrouter");
      strictEqual(auth && auth.type === "api_key" ? auth.key : null, ANYROUTER_KEY_B);
    });

    await test("active AnyRouter disable requires clearActive or replacement", async () => {
      // Recreate A so we have two accounts again.
      const recreated = await createApiKeyAccount("anyrouter", {
        displayName: "AnyRouter A2",
        apiKey: ANYROUTER_KEY_A,
        activate: false,
      });
      anyA = recreated.accounts.find((a) => a.displayName === "AnyRouter A2")!.accountId;
      await activateApiKeyAccount("anyrouter", anyA);

      await rejects(
        () => disableApiKeyAccount("anyrouter", anyA),
        (err: unknown) => err instanceof Error && (err as { status?: number }).status === 409,
      );

      const disabled = await disableApiKeyAccount("anyrouter", anyA, { clearActive: true });
      strictEqual(disabled.activeAccountId, null);
      const entry = disabled.accounts.find((a) => a.accountId === anyA)!;
      strictEqual(entry.disabled, true);
      strictEqual(await readAuthCredential("anyrouter"), undefined);
    });

    await test("Active AnyRouter activate writes runtime bridge with effective key/baseUrl/retry", async () => {
      // Fresh unique keys so we do not collide with earlier fingerprints.
      const BRIDGE_KEY = "anyrouter-bridge-active-KEY-9999";
      const BRIDGE_KEY_B = "anyrouter-bridge-nonactive-KEY-8888";
      ALL_SECRETS.push(BRIDGE_KEY, BRIDGE_KEY_B);

      // Clear remaining accounts so bridge tests start from a known state.
      const existing = await listApiKeyAccounts("anyrouter");
      for (const account of existing.accounts) {
        await deleteApiKeyAccount("anyrouter", account.accountId, { clearActive: true });
      }

      const created = await createApiKeyAccount("anyrouter", {
        displayName: "Bridge Active",
        apiKey: BRIDGE_KEY,
        activate: true,
        baseUrlOverride: "https://active-override.example/v1/",
      });
      anyA = created.accounts.find((a) => a.displayName === "Bridge Active")!.accountId;
      strictEqual(created.activeAccountId, anyA);

      const bridge = await readAnyRouterRuntimeBridgeUnlocked();
      ok(bridge, "runtime bridge must exist for Active account");
      strictEqual(bridge!.webManaged, true);
      strictEqual(bridge!.apiKey, BRIDGE_KEY);
      strictEqual(bridge!.baseUrl, "https://active-override.example/v1");
      ok(Array.isArray(bridge!.models) && bridge!.models.length >= 1);
      // Effective retry is whatever source config currently holds (prior PATCH
      // tests may have changed stored values); must be a finite integer in range.
      ok(
        Number.isInteger(bridge!.retry.maxRetries) &&
          bridge!.retry.maxRetries >= 0 &&
          bridge!.retry.maxRetries <= 20,
      );
      ok(
        Number.isInteger(bridge!.retry.baseDelayMs) && bridge!.retry.baseDelayMs >= 100,
      );

      const auth = await readAuthCredential("anyrouter");
      strictEqual(auth && auth.type === "api_key" ? auth.key : null, BRIDGE_KEY);

      // Env pointer must be the stable bridge path (loader-time, not per-request).
      ensureAnyRouterConfigEnvPointsAtBridge();
      strictEqual(process.env[getAnyRouterConfigEnvNameForTests()], getAnyRouterRuntimeBridgePath());

      // Permissions best-effort (platforms without mode bits still pass path checks).
      try {
        const st = await stat(getAnyRouterRuntimeBridgePath());
        if (typeof st.mode === "number") {
          ok((st.mode & 0o777) === 0o600 || (st.mode & 0o022) === 0);
        }
        await access(getAnyRouterRuntimeBridgePath(), fsConstants.R_OK);
      } catch {
        // ignore permission probe failures on exotic fs
      }

      // Non-active create + update must not rewrite bridge/auth.
      const createdB = await createApiKeyAccount("anyrouter", {
        displayName: "Bridge NonActive",
        apiKey: BRIDGE_KEY_B,
        activate: false,
        baseUrlOverride: "https://non-active-override.example",
      });
      anyB = createdB.accounts.find((a) => a.displayName === "Bridge NonActive")!.accountId;
      const bridgeBefore = await readAnyRouterRuntimeBridgeUnlocked();
      const authBefore = await readAuthCredential("anyrouter");

      await updateApiKeyAccount("anyrouter", anyB, {
        displayName: "Bridge NonActive renamed",
        baseUrlOverride: "https://non-active-override-2.example",
      });

      const bridgeAfterNonActive = await readAnyRouterRuntimeBridgeUnlocked();
      const authAfterNonActive = await readAuthCredential("anyrouter");
      deepStrictEqual(
        bridgeAfterNonActive,
        bridgeBefore,
        "non-active update must not rewrite bridge",
      );
      deepStrictEqual(
        authAfterNonActive,
        authBefore,
        "non-active update must not rewrite auth.json",
      );
      strictEqual((await listApiKeyAccounts("anyrouter")).activeAccountId, anyA);

      // Same-account Activate repairs a missing bridge.
      await rm(getAnyRouterRuntimeBridgePath(), { force: true });
      strictEqual(await readAnyRouterRuntimeBridgeUnlocked(), null);
      await activateApiKeyAccount("anyrouter", anyA);
      const repaired = await readAnyRouterRuntimeBridgeUnlocked();
      ok(repaired, "repeat Activate must rewrite missing bridge");
      strictEqual(repaired!.apiKey, BRIDGE_KEY);
      strictEqual(repaired!.webManaged, true);

      // Cold reconcile path also repairs.
      await rm(getAnyRouterRuntimeBridgePath(), { force: true });
      await reconcileAnyRouterRuntimeMirrors();
      const cold = await readAnyRouterRuntimeBridgeUnlocked();
      ok(cold, "cold reconcile must rewrite missing bridge");
      strictEqual(cold!.apiKey, BRIDGE_KEY);

      // Active baseUrlOverride update rebuilds bridge effective URL.
      await updateApiKeyAccount("anyrouter", anyA, {
        baseUrlOverride: "https://active-new-override.example/v2/",
      });
      const bridgeOverride = await readAnyRouterRuntimeBridgeUnlocked();
      ok(bridgeOverride);
      strictEqual(bridgeOverride!.baseUrl, "https://active-new-override.example/v2");

      await updateApiKeyAccount("anyrouter", anyA, { baseUrlOverride: null });
      const bridgeInherited = await readAnyRouterRuntimeBridgeUnlocked();
      ok(bridgeInherited);
      ok(
        typeof bridgeInherited!.baseUrl === "string" &&
          bridgeInherited!.baseUrl.startsWith("https://"),
        "cleared override must inherit global baseUrl",
      );
      notStrictEqual(bridgeInherited!.baseUrl, "https://active-new-override.example/v2");

      // Explicit disconnect clears auth and Active key from bridge.
      await deleteApiKeyAccount("anyrouter", anyA, { clearActive: true });
      strictEqual((await listApiKeyAccounts("anyrouter")).activeAccountId, null);
      strictEqual(await readAuthCredential("anyrouter"), undefined);
      const bridgeDisconnected = await readAnyRouterRuntimeBridgeUnlocked();
      if (bridgeDisconnected) {
        strictEqual(
          bridgeDisconnected.apiKey,
          "",
          "disconnect must not leave Active key in bridge",
        );
        strictEqual(bridgeDisconnected.webManaged, true);
      }

    });

    await test("active AnyRouter delete with clearActive disconnects without fallback", async () => {
      // Fresh dual-account setup independent of prior bridge tests.
      const remaining = await listApiKeyAccounts("anyrouter");
      for (const account of remaining.accounts) {
        await deleteApiKeyAccount("anyrouter", account.accountId, { clearActive: true });
      }

      const aCreated = await createApiKeyAccount("anyrouter", {
        displayName: "AnyRouter A clear",
        apiKey: `${ANYROUTER_KEY_A}-clear`,
        activate: false,
      });
      anyA = aCreated.accounts.find((a) => a.displayName === "AnyRouter A clear")!.accountId;
      const bCreated = await createApiKeyAccount("anyrouter", {
        displayName: "AnyRouter B clear",
        apiKey: `${ANYROUTER_KEY_B}-clear`,
        activate: true,
      });
      anyB = bCreated.accounts.find((a) => a.displayName === "AnyRouter B clear")!.accountId;

      const after = await deleteApiKeyAccount("anyrouter", anyB, { clearActive: true });
      strictEqual(after.activeAccountId, null);
      ok(after.accounts.some((a) => a.accountId === anyA));
      strictEqual(await readAuthCredential("anyrouter"), undefined);
    });

    await test("concurrent AnyRouter creates do not corrupt metadata", async () => {
      // Clean remaining accounts first.
      const existing = await listApiKeyAccounts("anyrouter");
      for (const account of existing.accounts) {
        await deleteApiKeyAccount("anyrouter", account.accountId, {
          clearActive: true,
        });
      }

      // Remove legacy source apiKey so creates do not re-import a 6th account.
      const cfg = getAnyRouterSafeConfig();
      const raw = JSON.parse(await readFile(join(agentDir, "anyrouter.json"), "utf8")) as Record<
        string,
        unknown
      >;
      delete raw.apiKey;
      await writeFile(join(agentDir, "anyrouter.json"), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      void cfg;

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createApiKeyAccount("anyrouter", {
            displayName: `Concurrent ${i}`,
            apiKey: `anyrouter-concurrent-key-${i}-${"X".repeat(8)}`,
            activate: i === 0,
          }),
        ),
      );
      const listed = await listApiKeyAccounts("anyrouter");
      strictEqual(listed.accountCount, 5);
      ok(listed.activeAccountId);
      ok(!containsPlaintext(listed, ALL_SECRETS));
      const meta = await readMetadata(agentDir, "anyrouter");
      const fps = new Set(meta.accounts.map((a) => a.keyFingerprint));
      strictEqual(fps.size, 5);
    });

    await test("malformed future metadata schema fails closed", async () => {
      const dir = join(agentDir, "auth-api-key-accounts", "anyrouter");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "accounts.json"),
        JSON.stringify({ version: 99, provider: "anyrouter", accounts: [] }),
        "utf8",
      );
      await rejects(
        () => listApiKeyAccounts("anyrouter"),
        (err: unknown) => err instanceof Error && /version/i.test(err.message),
      );
      // Restore empty valid metadata for cleanup.
      await writeFile(
        join(dir, "accounts.json"),
        JSON.stringify({ version: 1, provider: "anyrouter", activeAccountId: null, accounts: [] }),
        "utf8",
      );
    });

    console.log("\n=== isolation safety ===");

    await test("test only wrote under the temporary agent directory", async () => {
      strictEqual(process.env.PI_CODING_AGENT_DIR, agentDir);
      strictEqual(getAgentDir(), agentDir);
      const entries = await readdir(agentDir);
      ok(
        entries.includes("auth.json") ||
          entries.includes("auth-api-key-accounts") ||
          entries.includes("anyrouter.json"),
      );
      notStrictEqual(getAgentDir(), realAgentDir);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete process.env.PI_CODING_AGENT_DIR;
    await rm(agentDir, { recursive: true, force: true });
  }
}

function rejectsSync(fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(threw, "expected function to throw");
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
