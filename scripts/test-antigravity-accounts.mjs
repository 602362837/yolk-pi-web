#!/usr/bin/env node
/**
 * antigravity-accounts — account lifecycle, token refresh CAS, and safety contract tests
 *
 * Validates the Antigravity OAuth saved-account adapter, token resolver isolation,
 * and secret-safe projections.  Uses source-code inspection plus jiti-backed
 * in-process tests (no real Google network).
 *
 * Run: node scripts/test-antigravity-accounts.mjs
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
// 1. oauth-account-providers.ts — Antigravity adapter registry
// ============================================================================

console.log("\n=== oauth-account-providers.ts — Antigravity adapter registry ===");

const apSource = read("lib/oauth-account-providers.ts");

test("ANTIGRAVITY_PROVIDER_ID is 'google-antigravity'", () => {
  assertIncludes(apSource, 'export const ANTIGRAVITY_PROVIDER_ID = "google-antigravity"', "constant is google-antigravity");
});

test("antigravityAdapter is registered in the map", () => {
  assertIncludes(apSource, "[ANTIGRAVITY_PROVIDER_ID, antigravityAdapter]", "antigravity adapter is registered");
});

test("OPENAI_CODEX, GROK_CLI, KIRO provider ids remain unchanged", () => {
  assertIncludes(apSource, 'export const OPENAI_CODEX_PROVIDER_ID = "openai-codex"', "openai-codex constant unchanged");
  assertIncludes(apSource, 'export const GROK_CLI_PROVIDER_ID = "grok-cli"', "grok-cli constant unchanged");
  assertIncludes(apSource, 'export const KIRO_PROVIDER_ID = "kiro"', "kiro constant unchanged");
});

test("antigravityAdapter.supportsCredentialImport is false", () => {
  const block = apSource.match(/export const antigravityAdapter[\s\S]*?maskAccountId,\n};/)?.[0] || "";
  assertIncludes(block, "supportsCredentialImport: false", "no credential import for Antigravity");
  assertIncludes(block, "Credential import is not supported for google-antigravity", "import rejected with error");
});

test("antigravityAdapter.isCredential validates access/refresh/projectId and finite expires", () => {
  const check = apSource.match(/function isAntigravityCredential[\s\S]*?^}/m)?.[0] || "";
  assertIncludes(check, "isNonEmptyString(value.access)", "checks access is non-empty string");
  assertIncludes(check, "isNonEmptyString(value.refresh)", "checks refresh is non-empty string");
  assertIncludes(check, "isNonEmptyString(value.projectId)", "checks projectId is non-empty string");
  assertIncludes(check, "Number.isFinite(value.expires)", "checks expires is finite");
  assertNotIncludes(check, 'value.type === "oauth"', "does not require type sentinel");
});

test("antigravityAdapter derives real account id from refresh token hash", () => {
  assertIncludes(apSource, "deriveAntigravityRealAccountId", "derives real account id");
  assertIncludes(apSource, 'createHash("sha256").update(refresh)', "hashes refresh token");
  assertIncludes(apSource, "antigravity-", "prefixes with antigravity-");
});

test("antigravityAdapter display hint never returns projectId or tokens", () => {
  const hintFn = apSource.match(/function deriveAntigravityDisplayHint[\s\S]*?^}/m)?.[0] || "";
  assertIncludes(hintFn, "credential.email", "checks email field");
  assertIncludes(hintFn, "claims.email", "checks email claim");
  assertIncludes(hintFn, "claims.name", "checks name claim");
  const returnLines = hintFn
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("return "));
  for (const line of returnLines) {
    assertNotIncludes(line, "projectId", "return path does not use projectId");
    assertNotIncludes(line, "refresh", "return path does not use refresh token");
  }
});

// ============================================================================
// 2. oauth-accounts.ts — generic store remains provider-neutral
// ============================================================================

console.log("\n=== oauth-accounts.ts — Antigravity-compatible store ===");

const oaSource = read("lib/oauth-accounts.ts");

test("ANTIGRAVITY_PROVIDER_ID is re-exported from oauth-accounts", () => {
  assertIncludes(oaSource, "ANTIGRAVITY_PROVIDER_ID,", "re-exports ANTIGRAVITY_PROVIDER_ID");
});

test("opaque storage id allocation remains acct_ based", () => {
  assertIncludes(oaSource, "acct_", "storage id prefix is acct_");
  assertIncludes(oaSource, "allocateStorageId", "allocates fresh storage ids");
});

test("activateOAuthAccount wraps Antigravity with provider lock", () => {
  assertIncludes(oaSource, "withAntigravityProviderLock", "Activate shares Antigravity provider lock");
  assertIncludes(oaSource, "provider === ANTIGRAVITY_PROVIDER_ID", "Antigravity-only Activate wrap");
  assertIncludes(oaSource, "withKiroProviderLock", "Kiro Activate lock preserved");
});

test("delete-active protection remains in generic store", () => {
  assertIncludes(oaSource, "Active OAuth account cannot be deleted", "409 for active deletion");
});

// ============================================================================
// 3. antigravity-account-token.ts — resolver safety
// ============================================================================

console.log("\n=== antigravity-account-token.ts — resolver safety ===");

const tokenSource = read("lib/antigravity-account-token.ts");

test("Single-flight keyed by antigravity:storageId", () => {
  assertIncludes(tokenSource, "flightKey(storageId)", "computes flight key");
  assertIncludes(tokenSource, "`antigravity:${storageId}`", "key includes provider prefix");
});

test("Inflight registry is per-process (Map)", () => {
  assertIncludes(tokenSource, "const inflightRefreshes = new Map", "process-level inflight map");
});

test("Refresh uses getOAuthApiKey from pi-ai/oauth", () => {
  assertIncludes(tokenSource, "getOAuthApiKey", "uses pi-ai OAuth machinery");
  assertIncludes(tokenSource, "ANTIGRAVITY_PROVIDER_ID", "targets google-antigravity provider");
});

test("Refreshed credential written atomically and merges projectId", () => {
  assertIncludes(tokenSource, "atomicWriteJson(", "atomic credential write");
  assertIncludes(tokenSource, "mergeAntigravityCredential", "merges refresh with existing credential");
  assertIncludes(tokenSource, "projectId", "projectId merge/guard present");
});

test("Active-mirror compare-and-set before updating auth.json", () => {
  assertIncludes(tokenSource, "mirrorActiveCredentialIfActive", "CAS before mirror update");
  assertIncludes(tokenSource, "readActiveStorageId", "re-reads Active under lock");
  assertIncludes(tokenSource, "currentActiveStorageId !== storageId", "checks if still active");
});

test("Provider-level lock serializes refresh + Activate + CAS", () => {
  assertIncludes(tokenSource, "withAntigravityProviderLock", "provider lock helper");
  assertIncludes(tokenSource, "./antigravity-account-lock", "dedicated lock module");
  assert.ok(
    !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(tokenSource),
    "token must not resolve package.json export subpath",
  );
  const lockSource = read("lib/antigravity-account-lock.ts");
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
  assertIncludes(lockSource, "ANTIGRAVITY_PROVIDER_ID", "lock scoped to antigravity store");
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

test("API key JSON is parsed; projectId not returned to callers", () => {
  assertIncludes(tokenSource, "parseAntigravityApiKeyPayload", "parses JSON api key");
  assertIncludes(tokenSource, "parsed.token", "reads token field");
  assertNotIncludes(
    tokenSource.match(/export function parseAntigravityApiKeyPayload[\s\S]*?^}/m)?.[0] || "",
    "return parsed.projectId",
    "parser must not return projectId",
  );
});

test("Upstream errors map to fixed safe messages", () => {
  assertIncludes(tokenSource, "mapAntigravityOAuthError", "error mapper");
  assertIncludes(tokenSource, "sanitizeAntigravityLoginError", "login sanitizer");
  assertIncludes(tokenSource, "SAFE_ERROR_MESSAGES", "fixed message table");
  assertIncludes(tokenSource, "Please re-authenticate", "safe reauth copy");
});

test("No credential material in throw messages", () => {
  const throwLines = tokenSource.split("\n").filter((l) => l.includes("throw new")).join("\n");
  assertNotIncludes(throwLines, "eyJ", "no JWT in error messages");
  assertNotIncludes(throwLines, "client_secret", "no client_secret in throw strings");
});

// ============================================================================
// 4. Auth routes remain provider-scoped + Antigravity safe projection
// ============================================================================

console.log("\n=== Auth routes — Antigravity provider-scoped flows ===");

const providersRoute = read("app/api/auth/providers/route.ts");
const loginRoute = read("app/api/auth/login/[provider]/route.ts");
const accountsRoute = read("app/api/auth/accounts/[provider]/route.ts");
const activateRoute = read("app/api/auth/accounts/[provider]/activate/route.ts");

test("providers route includes Antigravity display name", () => {
  assertIncludes(providersRoute, '"google-antigravity": "Antigravity (Gemini 3, Claude, GPT-OSS)"', "display name");
  assertIncludes(providersRoute, "isSupportedOAuthAccountProvider", "uses managed accounts for supported providers");
});

test("login route supports add-account mode and sanitizes Antigravity errors", () => {
  assertIncludes(loginRoute, "isSupportedOAuthAccountProvider(provider)", "checks provider support");
  assertIncludes(loginRoute, "saveOAuthAccountCredential(provider, authStorage.get(provider))", "saves managed account");
  assertIncludes(loginRoute, "sanitizeAntigravityLoginError", "sanitizes Antigravity login errors");
  assertIncludes(loginRoute, "ANTIGRAVITY_PROVIDER_ID", "Antigravity-specific sanitization branch");
  assertIncludes(loginRoute, "reloadRpcAuthState()", "reloads live auth after login");
});

test("accounts routes stay generic and do not hard-code secrets", () => {
  assertIncludes(accountsRoute, "listOAuthAccounts", "list accounts");
  assertIncludes(accountsRoute, "deleteOAuthAccount", "delete accounts");
  assertIncludes(activateRoute, "activateOAuthAccount", "activate accounts");
  assertIncludes(activateRoute, "reloadRpcAuthState()", "reloads live auth after activate");
  assertNotIncludes(accountsRoute, "projectId", "accounts route has no projectId");
  assertNotIncludes(activateRoute, "projectId", "activate route has no projectId");
  assertNotIncludes(accountsRoute, "client_secret", "accounts route has no client_secret");
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
  "lib/oauth-account-antigravity.test.ts",
  "lib/antigravity-account-token.test.ts",
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
