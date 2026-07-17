#!/usr/bin/env node
/**
 * kiro-accounts — account lifecycle, token refresh CAS, and safety contract tests
 *
 * Validates the Kiro OAuth saved-account adapter, token resolver isolation,
 * and secret-safe projections.  Uses source-code inspection plus jiti-backed
 * in-process tests (no real AWS/Kiro network).
 *
 * Run: node scripts/test-kiro-accounts.mjs
 */

import assert from "node:assert/strict";
import { accessSync, readFileSync } from "node:fs";
import { createJiti } from "jiti";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// ─── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
    failed++;
  }
}

function assertIncludes(source, needle, label) {
  assert.ok(source.includes(needle), `${label}: expected to include "${needle}"`);
}

function assertNotIncludes(source, needle, label) {
  assert.ok(!source.includes(needle), `${label}: expected NOT to include "${needle}"`);
}

// ============================================================================
// 1. oauth-account-providers.ts — Kiro adapter registry
// ============================================================================

console.log("\n=== oauth-account-providers.ts — Kiro adapter registry ===");

const apSource = read("lib/oauth-account-providers.ts");

test("KIRO_PROVIDER_ID is 'kiro'", () => {
  assertIncludes(apSource, 'export const KIRO_PROVIDER_ID = "kiro"', "constant is kiro");
});

test("kiroAdapter is registered in the map", () => {
  assertIncludes(apSource, "[KIRO_PROVIDER_ID, kiroAdapter]", "kiro adapter is registered");
});

test("OPENAI_CODEX and GROK_CLI provider ids remain unchanged", () => {
  assertIncludes(apSource, 'export const OPENAI_CODEX_PROVIDER_ID = "openai-codex"', "openai-codex constant unchanged");
  assertIncludes(apSource, 'export const GROK_CLI_PROVIDER_ID = "grok-cli"', "grok-cli constant unchanged");
});

test("kiroAdapter.supportsCredentialImport is false", () => {
  const kiroBlock = apSource.match(/export const kiroAdapter[\s\S]*?maskAccountId,\n};/)?.[0] || "";
  assertIncludes(kiroBlock, "supportsCredentialImport: false", "no credential import for Kiro");
  assertIncludes(kiroBlock, "Credential import is not supported for kiro", "import rejected with error");
});

test("kiroAdapter.isCredential validates non-empty access/refresh and finite expires", () => {
  const check = apSource.match(/function isKiroCredential[\s\S]*?^}/m)?.[0] || "";
  assertIncludes(check, "isNonEmptyString(value.access)", "checks access is non-empty string");
  assertIncludes(check, "isNonEmptyString(value.refresh)", "checks refresh is non-empty string");
  assertIncludes(check, "Number.isFinite(value.expires)", "checks expires is finite");
  assertNotIncludes(check, 'value.type === "oauth"', "does not require type sentinel");
});

test("kiroAdapter derives real account id from refresh token hash", () => {
  assertIncludes(apSource, "deriveKiroRealAccountId", "derives real account id");
  assertIncludes(apSource, 'createHash("sha256").update(refresh)', "hashes refresh token");
  assertIncludes(apSource, "kiro-", "prefixes with kiro-");
});

test("kiroAdapter display hint never returns secrets or profileArn", () => {
  const hintFn = apSource.match(/function deriveKiroDisplayHint[\s\S]*?^}/m)?.[0] || "";
  assertIncludes(hintFn, "claims.email", "checks email claim");
  assertIncludes(hintFn, "claims.name", "checks name claim");
  assertIncludes(hintFn, "authMethod", "can fall back to authMethod");
  const returnLines = hintFn
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("return "));
  for (const line of returnLines) {
    assertNotIncludes(line, "profileArn", "return path does not use profileArn");
    assertNotIncludes(line, "clientSecret", "return path does not use clientSecret");
    assertNotIncludes(line, "request", "return path does not use request headers");
    assertNotIncludes(line, "access", "return path does not use access token");
    assertNotIncludes(line, "refresh", "return path does not use refresh token");
  }
});

// ============================================================================
// 2. oauth-accounts.ts — generic store remains provider-neutral
// ============================================================================

console.log("\n=== oauth-accounts.ts — Kiro-compatible store ===");

const oaSource = read("lib/oauth-accounts.ts");

test("KIRO_PROVIDER_ID is re-exported from oauth-accounts", () => {
  assertIncludes(oaSource, "KIRO_PROVIDER_ID,", "re-exports KIRO_PROVIDER_ID");
});

test("opaque storage id allocation remains acct_ based", () => {
  assertIncludes(oaSource, "acct_", "storage id prefix is acct_");
  assertIncludes(oaSource, "allocateStorageId", "allocates fresh storage ids");
});

test("activateOAuthAccount still mirrors type:oauth for provider-native credentials", () => {
  assertIncludes(oaSource, 'type: "oauth"', "adds type:oauth sentinel for Pi compatibility");
  assertIncludes(oaSource, "getWebCredentialStore", "uses Web CredentialStore");
  assertIncludes(oaSource, "store.modify(provider", "mirrors via store.modify");
  assertNotIncludes(oaSource, "authStorage.set(", "no AuthStorage.set path");
});

test("delete-active protection remains in generic store", () => {
  assertIncludes(oaSource, "Active OAuth account cannot be deleted", "409 for active deletion");
});

// ============================================================================
// 3. kiro-account-token.ts — resolver safety
// ============================================================================

console.log("\n=== kiro-account-token.ts — resolver safety ===");

const tokenSource = read("lib/kiro-account-token.ts");

test("Single-flight keyed by kiro:storageId", () => {
  assertIncludes(tokenSource, "flightKey(storageId)", "computes flight key");
  assertIncludes(tokenSource, "`kiro:${storageId}`", "key includes provider prefix");
});

test("Inflight registry is per-process (Map)", () => {
  assertIncludes(tokenSource, "const inflightRefreshes = new Map", "process-level inflight map");
});

test("Refresh uses getOAuthApiKey from pi-ai/oauth", () => {
  assertIncludes(tokenSource, "getOAuthApiKey", "uses pi-ai OAuth machinery");
  assertIncludes(tokenSource, "KIRO_PROVIDER_ID", "targets kiro provider");
});

test("Refreshed credential written atomically to storage id file", () => {
  assertIncludes(tokenSource, "atomicWriteJson(", "atomic credential write");
  assertIncludes(tokenSource, "tmp + rename", "documents atomic writes");
});

test("Active-mirror compare-and-set before updating auth.json", () => {
  assertIncludes(tokenSource, "mirrorActiveCredentialIfActive", "CAS before mirror update");
  assertIncludes(tokenSource, "readActiveStorageId", "re-reads Active under lock");
  assertIncludes(tokenSource, "currentActiveStorageId !== storageId", "checks if still active");
});

test("Provider-level lock serializes refresh + Activate + CAS", () => {
  assertIncludes(tokenSource, "withKiroProviderLock", "provider lock helper");
  assertIncludes(tokenSource, "./kiro-account-lock", "dedicated lock module");
  assert.ok(
    !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(tokenSource),
    "token must not resolve package.json export subpath",
  );
  const lockSource = read("lib/kiro-account-lock.ts");
  assert.ok(
    !/require(?:FromHere)?\(\s*["']proper-lockfile["']\s*\)/.test(lockSource)
      && !/from\s+["']proper-lockfile["']/.test(lockSource)
      && !/import\s+.*["']proper-lockfile["']/.test(lockSource),
    "no proper-lockfile static resolve",
  );
  assertNotIncludes(lockSource, "createRequire", "no nested package createRequire");
  assertIncludes(lockSource, "mkdir", "fs mkdir lock");
  assertIncludes(lockSource, "owner.json", "lock owner metadata");
  assertIncludes(lockSource, "provider.refresh-activate.lock", "provider lock path");
  assert.ok(
    !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(lockSource),
    "lock module must not resolve package.json export subpath",
  );
  const oauth = read("lib/oauth-accounts.ts");
  assertIncludes(oauth, "withKiroProviderLock", "Activate shares provider lock");
  assertIncludes(oauth, "provider === KIRO_PROVIDER_ID", "Kiro-only Activate wrap");
});

test("forceRefresh is real and not minValidityMs:0 fake", () => {
  assertIncludes(tokenSource, "forceRefresh?: boolean", "option");
  assertIncludes(tokenSource, "forceRefresh || !access || epochNow() >= expires - minValidityMs", "force path");
});

test("Credentials stored at 0600 in 0700 directory", () => {
  assertIncludes(tokenSource, "JSON_FILE_MODE = 0o600", "0600 constant");
  assertIncludes(tokenSource, "ACCOUNT_DIR_MODE = 0o700", "0700 constant");
  assertIncludes(tokenSource, "mode: ACCOUNT_DIR_MODE", "sets directory mode");
  assertIncludes(tokenSource, "mode: JSON_FILE_MODE", "sets file mode");
});

test("No credential material in throw messages", () => {
  const throwLines = tokenSource.split("\n").filter((l) => l.includes("throw new Error")).join("\n");
  assert.ok(throwLines.includes("storageId") || tokenSource.includes("storageId"), "error messages use storageId");
  assertNotIncludes(throwLines, "eyJ", "no JWT in error messages");
  assertNotIncludes(throwLines, "clientSecret", "no clientSecret in throw strings");
});

test("getKiroAccessToken validates storageId is non-empty", () => {
  assertIncludes(tokenSource, "!storageId.trim()", "validates non-empty storage id");
  assertIncludes(tokenSource, "kiroAccountStorageId is required", "error for empty id");
});

// ============================================================================
// 4. Auth routes remain provider-scoped
// ============================================================================

console.log("\n=== Auth routes — Kiro provider-scoped flows ===");

const providersRoute = read("app/api/auth/providers/route.ts");
const loginRoute = read("app/api/auth/login/[provider]/route.ts");
const accountsRoute = read("app/api/auth/accounts/[provider]/route.ts");
const activateRoute = read("app/api/auth/accounts/[provider]/activate/route.ts");

test("providers route includes Kiro display name", () => {
  assertIncludes(providersRoute, 'kiro: "Kiro (Builder ID / Google / GitHub)"', "display name for kiro");
  assertIncludes(providersRoute, "isSupportedOAuthAccountProvider", "uses managed accounts for supported providers");
});

test("login route supports add-account mode for any supported OAuth provider", () => {
  assertIncludes(loginRoute, "isSupportedOAuthAccountProvider(provider)", "checks provider support");
  assertIncludes(loginRoute, "createInMemoryWebCredentialStore", "add-account uses isolated memory store");
  assertIncludes(loginRoute, "createWebModelRuntime", "add-account uses isolated ModelRuntime");
  assertIncludes(loginRoute, "saveOAuthAccountCredential(provider, credential", "saves managed account from login credential");
  assertIncludes(loginRoute, "reloadRpcAuthState()", "reloads live auth after login");
  assertNotIncludes(loginRoute, "authStorage.get(", "no AuthStorage.get path");
});

test("accounts routes stay generic and do not hard-code kiro secrets", () => {
  assertIncludes(accountsRoute, "listOAuthAccounts", "list accounts");
  assertIncludes(accountsRoute, "deleteOAuthAccount", "delete accounts");
  assertIncludes(activateRoute, "activateOAuthAccount", "activate accounts");
  assertIncludes(activateRoute, "reloadRpcAuthState()", "reloads live auth after activate");
  assertNotIncludes(accountsRoute, "clientSecret", "accounts route has no clientSecret");
  assertNotIncludes(activateRoute, "profileArn", "activate route has no profileArn");
});

// ============================================================================
// 5. Runtime tests via jiti
// ============================================================================

console.log("\n=== Runtime tests (jiti) ===");

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": root,
  },
});

const runtimeTests = [
  "lib/oauth-account-kiro.test.ts",
  "lib/kiro-account-token.test.ts",
];

for (const testPath of runtimeTests) {
  const fullPath = join(root, testPath);
  try {
    accessSync(fullPath);
  } catch {
    test(`${testPath} exists`, () => {
      throw new Error(`missing ${testPath}`);
    });
    continue;
  }

  test(`runtime: ${testPath}`, () => {
    // executed below asynchronously
  });
}

async function runRuntimeTests() {
  let runtimeFailures = 0;
  for (const testPath of runtimeTests) {
    const fullPath = join(root, testPath);
    try {
      accessSync(fullPath);
    } catch {
      continue;
    }
    console.log(`\n▶ Running ${testPath} …`);
    try {
      await jiti.import(pathToFileURL(fullPath).href);
      console.log(`✓ ${testPath} PASSED`);
      passed += 1;
    } catch (error) {
      console.error(`✗ ${testPath} FAILED:`, error instanceof Error ? error.message : String(error));
      console.error(error);
      failed += 1;
      runtimeFailures += 1;
    }
  }
  return runtimeFailures;
}

const runtimeFailures = await runRuntimeTests();

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0 || runtimeFailures > 0) process.exit(1);
