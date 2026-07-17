/**
 * Isolated lifecycle regression coverage for managed API-key accounts,
 * focused on provider id `xai` (and cross-provider isolation with
 * `opencode-go`).
 *
 * Always runs against a temporary PI_CODING_AGENT_DIR so the user's real
 * `~/.pi/agent` auth store is never read or written.
 *
 * Run with: npm run test:api-key-accounts
 */

import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
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
  activateApiKeyAccount,
  createApiKeyAccount,
  deleteApiKeyAccount,
  getApiKeyProviderSummary,
  importLegacyKeyIfNeeded,
  isManagedApiKeyProvider,
  listApiKeyAccounts,
  revealApiKeyAccount,
  updateApiKeyAccount,
} from "./api-key-accounts";

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
  const ALL_SECRETS = [
    LEGACY_XAI_KEY,
    SECOND_XAI_KEY,
    UPDATED_XAI_KEY,
    OPENCODE_KEY_SAME_AS_SECOND,
    OPENCODE_KEY_OTHER,
  ];

  try {
    console.log("\n=== managed provider allowlist ===");

    await test("xai and opencode-go are managed; others stay single", () => {
      strictEqual(isManagedApiKeyProvider("xai"), true);
      strictEqual(isManagedApiKeyProvider("opencode-go"), true);
      strictEqual(isManagedApiKeyProvider("openai"), false);
      strictEqual(isManagedApiKeyProvider("anthropic"), false);
      strictEqual(isManagedApiKeyProvider("google"), false);
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

    console.log("\n=== legacy import idempotency ===");

    let importedAccountId = "";

    await test("first list imports legacy xAI key exactly once as active Imported key", async () => {
      const first = await listApiKeyAccounts("xai");
      strictEqual(first.provider, "xai");
      strictEqual(first.authMode, "managed_accounts");
      strictEqual(first.accountCount, 1);
      strictEqual(first.accounts.length, 1);
      const account = first.accounts[0];
      strictEqual(account.displayName, "Imported key");
      strictEqual(account.active, true);
      ok(account.importedFromLegacyAt, "importedFromLegacyAt must be set");
      ok(account.maskedKeyPreview.includes("****"), "list returns masked preview");
      ok(!containsPlaintext(first, [LEGACY_XAI_KEY]), "list must not include plaintext");
      importedAccountId = account.accountId;

      const metadata = await readMetadata(agentDir, "xai");
      strictEqual(metadata.activeAccountId, importedAccountId);
      strictEqual(metadata.accounts.length, 1);
      strictEqual(metadata.accounts[0].keyFingerprint, fingerprint(LEGACY_XAI_KEY));
      ok(
        !containsPlaintext(metadata, [LEGACY_XAI_KEY]),
        "accounts.json metadata must not store plaintext key",
      );

      const secretRaw = await readFile(
        join(agentDir, "auth-api-key-accounts", "xai", `${encodeURIComponent(importedAccountId)}.json`),
        "utf8",
      );
      const secret = JSON.parse(secretRaw) as { type: string; key: string };
      strictEqual(secret.type, "api_key");
      strictEqual(secret.key, LEGACY_XAI_KEY);

      // Permissions: secret file 0600 when the platform supports mode bits.
      const secretStat = await stat(
        join(agentDir, "auth-api-key-accounts", "xai", `${encodeURIComponent(importedAccountId)}.json`),
      );
      if (process.platform !== "win32") {
        strictEqual(secretStat.mode & 0o777, 0o600, "secret file mode should be 0600");
      }
    });

    await test("repeat list / importLegacyKeyIfNeeded does not create a second account", async () => {
      const secondList = await listApiKeyAccounts("xai");
      strictEqual(secondList.accountCount, 1);
      strictEqual(secondList.accounts[0].accountId, importedAccountId);

      const imported = await importLegacyKeyIfNeeded("xai");
      strictEqual(imported, false, "second import must be a no-op");

      const thirdList = await listApiKeyAccounts("xai");
      strictEqual(thirdList.accountCount, 1);
      strictEqual(thirdList.activeAccountId, importedAccountId);
    });

    console.log("\n=== create / update / activate / mirror ===");

    let secondAccountId = "";

    await test("create second xAI account without activating keeps legacy active", async () => {
      const created = await createApiKeyAccount("xai", {
        displayName: "Secondary xAI",
        description: "manual key",
        apiKey: SECOND_XAI_KEY,
        activate: false,
      });
      strictEqual(created.accountCount, 2);
      strictEqual(created.activeAccountId, importedAccountId);
      const secondary = created.accounts.find((a) => a.displayName === "Secondary xAI");
      ok(secondary);
      secondAccountId = secondary!.accountId;
      strictEqual(secondary!.active, false);
      ok(!containsPlaintext(created, ALL_SECRETS), "create response must not leak plaintext");

      const auth = await readAuthJson(agentDir);
      const xaiCred = auth.xai as { type?: string; key?: string } | undefined;
      strictEqual(xaiCred?.key, LEGACY_XAI_KEY, "auth.json still mirrors the active legacy key");
    });

    await test("activate second account mirrors new key into auth.json", async () => {
      const activated = await activateApiKeyAccount("xai", secondAccountId);
      strictEqual(activated.activeAccountId, secondAccountId);
      const active = activated.accounts.find((a) => a.accountId === secondAccountId);
      strictEqual(active?.active, true);

      const auth = await readAuthCredential("xai");
      strictEqual(auth?.type, "api_key");
      strictEqual(
        auth && auth.type === "api_key" ? auth.key : null,
        SECOND_XAI_KEY,
        "active mirror must follow activation",
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

    console.log("\n=== isolation safety ===");

    await test("test only wrote under the temporary agent directory", async () => {
      strictEqual(process.env.PI_CODING_AGENT_DIR, agentDir);
      strictEqual(getAgentDir(), agentDir);
      const entries = await readdir(agentDir);
      ok(entries.includes("auth.json") || entries.includes("auth-api-key-accounts"));
      // Real user agent dir must not gain a marker written only in this test.
      // We cannot assert the real dir is unchanged (other processes may write),
      // but we assert we never pointed getAgentDir at it during the suite.
      notStrictEqual(getAgentDir(), realAgentDir);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
    await rm(agentDir, { recursive: true, force: true });
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
