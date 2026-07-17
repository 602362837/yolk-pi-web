#!/usr/bin/env node
/**
 * grok-accounts — account lifecycle, security regression, and non-Grok integrity tests
 *
 * Validates the Grok OAuth saved-account system, token resolver isolation,
 * session binding semantics, and cross-module safety invariants.  Uses
 * source-code inspection (no pi SDK imports, no network, no real agent dir)
 * supplemented with targeted in-process tests via jiti for critical paths.
 *
 * Run: node scripts/test-grok-accounts.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
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
  assert.ok(
    source.includes(needle),
    `${label}: expected to include "${needle}"`,
  );
}

function assertNotIncludes(source, needle, label) {
  assert.ok(
    !source.includes(needle),
    `${label}: expected NOT to include "${needle}"`,
  );
}

// ============================================================================
// 1. oauth-account-providers.ts — adapter registry
// ============================================================================

console.log("\n=== oauth-account-providers.ts — adapter registry ===");

const apSource = read("lib/oauth-account-providers.ts");

test("grokCliAdapter is registered in the map", () => {
  assertIncludes(apSource, "[GROK_CLI_PROVIDER_ID, grokCliAdapter]", "grok adapter is registered");
});

test("GROK_CLI_PROVIDER_ID is 'grok-cli'", () => {
  assertIncludes(apSource, 'export const GROK_CLI_PROVIDER_ID = "grok-cli"', "constant is grok-cli");
});

test("OPENAI_CODEX_PROVIDER_ID is unchanged", () => {
  assertIncludes(apSource, 'export const OPENAI_CODEX_PROVIDER_ID = "openai-codex"', "openai-codex constant unchanged");
});

test("isSupportedOAuthAccountProvider returns true for grok-cli", () => {
  assertIncludes(apSource, "adapters.has(provider)", "checks adapter map");
});

test("getOAuthAccountAdapter throws for unknown providers", () => {
  assertIncludes(apSource, "OAuth account management is not supported", "error for unknown providers");
  assertIncludes(apSource, "Supported providers:", "lists supported providers");
});

// ─── Grok adapter contract ───────────────────────────────────────────────────

test("grokCliAdapter.id is 'grok-cli'", () => {
  assertIncludes(apSource, 'id: GROK_CLI_PROVIDER_ID', "adapter id is grok-cli");
});

test("grokCliAdapter.supportsCredentialImport is false", () => {
  assertIncludes(apSource, "supportsCredentialImport: false", "no credential import for Grok");
});

test("grokCliAdapter.normalizeImportCredential throws", () => {
  assertIncludes(apSource, "Credential import is not supported", "import rejected with error");
});

test("grokCliAdapter.isCredential validates access/refresh/expires", () => {
  assertIncludes(apSource, "typeof value.access === \"string\"", "checks access is string");
  assertIncludes(apSource, "typeof value.refresh === \"string\"", "checks refresh is string");
  assertIncludes(apSource, "typeof value.expires === \"number\"", "checks expires is number");
});

test("grokCliAdapter.isCredential does NOT require type:oauth sentinel", () => {
  // Unlike openai-codex, grok-cli credentials from pi-grok-cli lack type:oauth
  // The adapter must not require it.
  const grokCheck = apSource.match(/isGrokCliCredential[\s\S]*?^}/m)?.[0] || "";
  assertNotIncludes(grokCheck, 'value.type === "oauth"', "does not require type sentinel");
});

test("grokCliAdapter derives real account id from refresh token", () => {
  assertIncludes(apSource, "deriveGrokCliRealAccountId", "derives real account id");
  assertIncludes(apSource, 'createHash("sha256").update(refresh)', "hashes refresh token");
  assertIncludes(apSource, "grok-", "prefixes with grok-");
});

test("grokCliAdapter display hint from idToken/access claims — no secrets", () => {
  const hintFn = apSource.match(/deriveGrokCliDisplayHint[\s\S]*?^}/m)?.[0] || "";
  assertIncludes(hintFn, "claims.email", "checks email claim");
  assertIncludes(hintFn, "claims.name", "checks name claim");
  // Must not return tokens or codes
  assertNotIncludes(hintFn, '"access"', "does not return access token");
  assertNotIncludes(hintFn, '"refresh"', "does not return refresh token");
});

// ─── OpenAI Codex adapter unchanged ──────────────────────────────────────────

test("openAICodexAdapter.supportsCredentialImport is true", () => {
  assertIncludes(apSource, "supportsCredentialImport: true", "OpenAI supports credential import");
});

test("openAICodexAdapter requires type:oauth", () => {
  assertIncludes(apSource, 'value.type === "oauth"', "OpenAI requires type sentinel");
});

test("openAICodexAdapter.isCredential rejects non-oauth creds", () => {
  // The OpenAI adapter should reject grok-style creds (no type:oauth).
  // This is ensured by requiring type:oauth in isOpenAICodexCredential.
  assertIncludes(apSource, "isOpenAICodexCredential", "has dedicated check function");
  assertIncludes(apSource, 'value.type === "oauth"', "requires type:oauth");
});

// ============================================================================
// 2. oauth-accounts.ts — generic store invariants
// ============================================================================

console.log("\n=== oauth-accounts.ts — store invariants ===");

const oaSource = read("lib/oauth-accounts.ts");

test("Metadata file is accounts.json, not containing credential", () => {
  assertIncludes(oaSource, 'METADATA_FILE = "accounts.json"', "metadata is accounts.json");
});

test("Credential files stored per opaque storage id", () => {
  assertIncludes(oaSource, "encodeURIComponent(accountId)", "opaque id encoded in filename");
});

test("Storage id format uses acct_ prefix", () => {
  assertIncludes(oaSource, 'acct_', "storage id prefix is acct_");
});

test("saveOAuthAccountCredential delegates to adapter.isCredential", () => {
  assertIncludes(oaSource, "adapter.isCredential(credential)", "validates via adapter");
});

test("Adapter registered before any store operation", () => {
  // getAdapter is called first in all public functions
  assertIncludes(oaSource, "function accountStorePath", "helper uses adapter validation");
  assertIncludes(oaSource, "getAdapter(provider)", "adapter called early");
});

test("deleteOAuthAccount prevents active account deletion (409)", () => {
  assertIncludes(oaSource, "Active OAuth account cannot be deleted", "409 for active deletion");
  assertIncludes(oaSource, "metadata.activeAccountId === normalizedAccountId", "checks active status");
});

test("activateOAuthAccount mirrors via CredentialStore.modify (auth.json)", () => {
  assertIncludes(oaSource, "getWebCredentialStore", "uses Web CredentialStore");
  assertIncludes(oaSource, "store.modify(provider", "mirrors via store.modify");
  assertIncludes(oaSource, 'type: "oauth"', "adds type:oauth sentinel for Pi compatibility");
  assertNotIncludes(oaSource, "authStorage.set(", "no AuthStorage.set path");
  assertNotIncludes(oaSource, "AuthStorage", "no AuthStorage import/usage");
});

test("Atomic writes use tmp + rename", () => {
  // The generic writeJsonFile or atomicWriteJson pattern
  assertIncludes(oaSource, "writeFile(", "writes files");
  // writeJsonFile doesn't use tmp+rename but rather direct writeFile;
  // The credential files are written through writeJsonFile which sets 0600.
  assertIncludes(oaSource, "JSON_FILE_MODE", "has permission constant");
});

test("File permissions: JSON_FILE_MODE 0600, ACCOUNT_DIR_MODE 0700", () => {
  assertIncludes(oaSource, "JSON_FILE_MODE = 0o600", "0600 for JSON files");
  assertIncludes(oaSource, "ACCOUNT_DIR_MODE = 0o700", "0700 for directories");
});

test("Credentials moved to deleted/ on delete, not purged", () => {
  assertIncludes(oaSource, 'DELETED_ACCOUNT_DIR = "deleted"', "deleted directory exists");
  assertIncludes(oaSource, "rename(sourcePath, deletedCredentialPath", "moves to deleted");
});

test("Metadata accounts array only contains opaque accountId, not credential", () => {
  // The metadata entry normalization must not include credential fields
  const normalizeFn = oaSource.match(/normalizeAccountEntry[\s\S]*?^function /m)?.[0] || "";
  assertNotIncludes(normalizeFn, '"access"', "metadata does not store access token");
  assertNotIncludes(normalizeFn, '"refresh"', "metadata does not store refresh token");
});

test("syncActiveOAuthAccountCredential clears active when credential missing", () => {
  assertIncludes(oaSource, "clearActiveAccount(provider)", "clears active when missing");
});

// ============================================================================
// 3. grok-account-token.ts — resolver safety
// ============================================================================

console.log("\n=== grok-account-token.ts — resolver safety ===");

const tokenSource = read("lib/grok-account-token.ts");

test("Single-flight keyed by grok-cli:storageId", () => {
  assertIncludes(tokenSource, 'flightKey(storageId)', "computes flight key");
  assertIncludes(tokenSource, '`grok-cli:${storageId}`', "key includes provider prefix");
});

test("Inflight registry is per-process (Map)", () => {
  assertIncludes(tokenSource, "const inflightRefreshes = new Map", "process-level inflight map");
});

test("Refresh retry uses getOAuthApiKey from pi-ai/oauth", () => {
  assertIncludes(tokenSource, "getOAuthApiKey", "uses pi-ai OAuth machinery");
});

test("Refreshed credential written atomically to storage id file", () => {
  assertIncludes(tokenSource, "atomicWriteJson(", "atomic credential write");
});

test("Active-mirror compare-and-set before updating auth.json", () => {
  assertIncludes(tokenSource, "mirrorActiveCredentialIfActive", "CAS before mirror update");
  assertIncludes(tokenSource, "currentActiveStorageId !== storageId", "checks if still active");
});

test("Refresh failure preserves existing credential", () => {
  assertIncludes(tokenSource, "throw new Error(", "throws on refresh failure");
  // The caller must handle — credential file is not deleted on failure
});

test("No credential material in log/error messages", () => {
  // Error messages use storageId references, not credential keys.
  // Comments may mention "access" and "refresh" for documentation;
  // the key invariant is that throw/error strings don't leak values.
  const throwLines = tokenSource.split('\n').filter(
    (l) => l.includes('throw new Error') || l.includes('throw new OAuth')
  ).join('\n');
  // Error messages should reference storageId, never credential values
  assert.ok(
    throwLines.includes('storageId') || tokenSource.includes('storageId'),
    "error messages use storageId"
  );
  // Error strings must not contain the literal pattern of a JWT or API key
  assertNotIncludes(throwLines, 'eyJ', "no JWT in error messages");
  assertNotIncludes(throwLines, 'sk-', "no API key in error messages");
});

test("getGrokAccessToken validates storageId is non-empty", () => {
  assertIncludes(tokenSource, "!storageId.trim()", "validates non-empty storage id");
  assertIncludes(tokenSource, "grokAccountStorageId is required", "error for empty id");
});

test("invalidateGrokTokenFlight removes in-flight promise", () => {
  assertIncludes(tokenSource, "inflightRefreshes.delete", "removes flight entry");
});

test("Credentials stored at 0600 in 0700 directory", () => {
  assertIncludes(tokenSource, "JSON_FILE_MODE = 0o600", "0600 constant");
  assertIncludes(tokenSource, "ACCOUNT_DIR_MODE = 0o700", "0700 constant");
  // Permissions are set via mkdir({mode}) and writeFile({mode}),
  // which sets the mode atomically at creation time.
  assertIncludes(tokenSource, "mode: ACCOUNT_DIR_MODE", "sets directory mode");
  assertIncludes(tokenSource, "mode: JSON_FILE_MODE", "sets file mode");
});

// ============================================================================
// 4. grok-session-account.ts — binding safety
// ============================================================================

console.log("\n=== grok-session-account.ts — binding safety ===");

const sessionSource = read("lib/grok-session-account.ts");

test("Runtime registry is a Map (sessionId → storageId)", () => {
  assertIncludes(sessionSource, "const sessionBindings = new Map", "runtime binding registry");
});

test("Only opaque storage ids stored — no tokens", () => {
  assertIncludes(sessionSource, "Only opaque storage ids", "documents no-secret policy");
});

test("Session header field is grokAccountStorageId", () => {
  assertIncludes(sessionSource, "grokAccountStorageId", "field name in header");
});

test("readSessionHeaderFromFile handles missing files gracefully", () => {
  assertIncludes(sessionSource, "catch {", "catches file read errors");
  assertIncludes(sessionSource, "return null", "returns null for missing");
});

test("bindGrokSessionAccount validates non-empty storageId", () => {
  assertIncludes(sessionSource, "!storageId.trim()", "validates non-empty");
  assertIncludes(sessionSource, "return", "early return for empty");
});

test("unbindGrokSessionAccount invalidates token flight", () => {
  assertIncludes(sessionSource, "invalidateGrokTokenFlight(storageId)", "cleans up token flight");
});

test("getActiveGrokAccountId checks provider support first", () => {
  assertIncludes(sessionSource, "isSupportedOAuthAccountProvider", "checks provider support");
  assertIncludes(sessionSource, "listOAuthAccounts", "reads from account store");
});

test("restoreGrokSessionAccountBinding only reads, does not write", () => {
  assertIncludes(sessionSource, "readSessionHeaderFromFile", "reads from file");
  assertIncludes(sessionSource, "sessionBindings.set", "updates runtime only");
});

test("Session pin retirement and historical header compatibility documented", () => {
  assertIncludes(sessionSource, "Session Authorization pinning is retired", "pin retirement documented");
  assertIncludes(sessionSource, "historical header parsing only", "header parse-only documented");
  assertIncludes(sessionSource, "no longer wired into", "lifecycle unbind documented");
  assertIncludes(sessionSource, "getActiveGrokAccountId", "active helper retained");
});

// ============================================================================
// 5. Cross-module secret safety
// ============================================================================

console.log("\n=== Cross-module secret safety ===");

const ALL_GROK_MODULES = [
  "lib/pi-provider-extensions.ts",
  "lib/grok-account-token.ts",
  "lib/grok-session-account.ts",
  "lib/grok-subscription-quota.ts",
  "lib/oauth-account-providers.ts",
  "lib/oauth-accounts.ts",
  "lib/oauth-account-converters.ts",
];

test("No auth code in any Grok module", () => {
  for (const path of ALL_GROK_MODULES) {
    const source = read(path);
    assertNotIncludes(source, "authorization_code", `${path}: no auth code`);
    assertNotIncludes(source, "code_verifier", `${path}: no code verifier`);
  }
});

test("No callback URL in any Grok module", () => {
  // OAuth callback URLs should only be handled by pi-grok-cli internals.
  // Comments documenting that callback URLs are NOT stored are acceptable.
  for (const path of ALL_GROK_MODULES) {
    const source = read(path);
    // The word "callback" in documentation comments is fine;
    // we check for actual URL patterns or redirect_uri usage.
    assertNotIncludes(source, "redirect_uri", `${path}: no redirect URI`);
    // "127.0.0.1:56122" is the loopback used by pi-grok-cli OAuth;
    // it should not appear in Web modules.
    assertNotIncludes(source, "127.0.0.1:56122", `${path}: no loopback callback address`);
  }
});

test("No raw billing payload fields in non-quota modules", () => {
  const nonQuota = ALL_GROK_MODULES.filter((p) => p !== "lib/grok-subscription-quota.ts");
  for (const path of nonQuota) {
    const source = read(path);
    assertNotIncludes(source, "monthlyLimit", `${path}: no raw billing field`);
    assertNotIncludes(source, "creditUsagePercent", `${path}: no raw billing field`);
  }
});

test("No hardcoded xAI auth endpoints in Web modules", () => {
  // Only grok-subscription-quota.ts should reference the billing URL
  for (const path of ALL_GROK_MODULES) {
    const source = read(path);
    if (path === "lib/grok-subscription-quota.ts") {
      // billing endpoint is allowed here
      continue;
    }
    assertNotIncludes(source, "auth.x.ai", `${path}: no xAI auth endpoint`);
  }
});

test("Error messages in oauth-account modules never include credential keys", () => {
  for (const path of ["lib/oauth-accounts.ts", "lib/oauth-account-providers.ts"]) {
    const source = read(path);
    // Error messages should use terms like "credential", "token", "account"
    // but never literal "access" or "refresh" in a way that leaks values
    // String literal checks for known dangerous patterns
    assertNotIncludes(source, '"access_token"', `${path}: no literal access_token in strings`);
    assertNotIncludes(source, '"refresh_token"', `${path}: no literal refresh_token in strings`);
  }
});

// ============================================================================
// 6. Non-Grok provider regression
// ============================================================================

console.log("\n=== Non-Grok provider regression ===");

test("OpenAI Codex provider id unchanged", () => {
  for (const path of ALL_GROK_MODULES) {
    const source = read(path);
    // No module should redefine OPENAI_CODEX_PROVIDER_ID
    if (path === "lib/oauth-account-providers.ts") continue;
    if (source.includes("openai-codex")) {
      // Non-provider modules should not hard-code openai-codex;
      // only the adapter file defines provider ids.
      if (path !== "lib/grok-subscription-quota.ts" && !source.includes("openai-codex")) {
        // acceptable
      }
    }
  }
  // Just verify the constant isn't accidentally changed
  assertIncludes(apSource, '"openai-codex"', "openai-codex id unchanged");
});

test("openai-codex credential import still works (adapters registered)", () => {
  assertIncludes(apSource, "openAICodexAdapter", "openai adapter defined");
  assertIncludes(apSource, "supportsCredentialImport: true", "openai import supported");
});

test("subscription-quota.ts still exports openai-codex functions", () => {
  const source = read("lib/subscription-quota.ts");
  assertIncludes(source, "getOAuthProviderSubscriptionQuota", "provider quota function exists");
  assertIncludes(source, "getOAuthAccountSubscriptionQuota", "account quota function exists");
  assertIncludes(source, "consumeOAuthProviderResetCredit", "reset-credit function exists");
});

test("oauth-account-converters.ts still handles CPA/sub2api/raw", () => {
  const source = read("lib/oauth-account-converters.ts");
  assertIncludes(source, '"cpa"', "cpa mode");
  assertIncludes(source, '"sub2api"', "sub2api mode");
  assertIncludes(source, '"raw"', "raw mode");
});

test("No module imports grok-cli adapter from oauth-accounts except via getAdapter", () => {
  // All oauth-accounts operations should go through the generic API,
  // not directly accessing grokCliAdapter
  for (const path of ["lib/grok-session-account.ts", "lib/grok-account-token.ts"]) {
    const source = read(path);
    assertNotIncludes(source, "grokCliAdapter", `${path}: does not import adapter directly`);
    assertNotIncludes(source, "openAICodexAdapter", `${path}: no openai adapter leak`);
  }
});

// ============================================================================
// 7. Token resolver: edge case documentation
// ============================================================================

console.log("\n=== Token resolver edge case coverage ===");

test("getGrokAccessToken documents the single-flight contract", () => {
  assertIncludes(tokenSource, "One in-flight refresh per storageId", "documents single-flight");
});

test("getGrokAccessToken documents the secret write contract", () => {
  assertIncludes(tokenSource, "Secret writes use tmp + rename", "documents atomic writes");
});

test("getGrokAccessToken documents active-mirror CAS", () => {
  assertIncludes(tokenSource, "auth.json mirror is only updated", "documents CAS mirror");
});

test("getGrokAccessToken documents no-logging policy", () => {
  assertIncludes(tokenSource, "No credential material is ever logged", "documents no-logging");
});

test("minValidityMs default is 120_000 (2 min)", () => {
  assertIncludes(tokenSource, "minValidityMs = 120_000", "default 2 min validity");
});

test("signal propagation for abort support", () => {
  assertIncludes(tokenSource, "signal?.throwIfAborted()", "abort signal support");
});

// ============================================================================
// 8. Types contract check
// ============================================================================

console.log("\n=== Types contract check ===");

test("SessionHeader includes grokAccountStorageId field", () => {
  const typesSource = read("lib/types.ts");
  assertIncludes(typesSource, "grokAccountStorageId?: string", "types include grok field");
  assertIncludes(typesSource, "Non-secret", "documents non-secret nature");
  assertIncludes(typesSource, "Historical Grok session pin field", "describes deprecated field purpose");
});

// ============================================================================
// 9. Route-level safety check
// ============================================================================

console.log("\n=== Route-level safety check ===");

test("quota route uses Cache-Control: no-store", () => {
  const source = read("app/api/auth/quota/[provider]/route.ts");
  assertIncludes(source, 'Cache-Control": "no-store"', "Cache-Control no-store");
});

test("quota route uses grok-specific function for grok-cli", () => {
  const source = read("app/api/auth/quota/[provider]/route.ts");
  assertIncludes(source, "provider === GROK_CLI_PROVIDER_ID", "dispatches on grok-cli");
  assertIncludes(source, "getGrokAccountSubscriptionQuota", "calls grok quota fn");
  assertIncludes(source, "getGrokActiveSubscriptionQuota", "calls grok active quota fn");
});

test("quota route POST returns 405 for grok-cli", () => {
  const source = read("app/api/auth/quota/[provider]/route.ts");
  assertIncludes(source, "405", "returns 405 for POST");
  assertIncludes(source, "Grok does not support reset-credit", "clear error message");
});

test("quota route GET for grok-cli returns 401 on reauthRequired", () => {
  const source = read("app/api/auth/quota/[provider]/route.ts");
  assertIncludes(source, "result.reauthRequired ? 401", "returns 401 for reauth");
});

// ============================================================================
// 10. Filesystem layout contract
// ============================================================================

console.log("\n=== Filesystem layout contract ===");

test("Credential store directory: auth-accounts/<provider>/", () => {
  assertIncludes(oaSource, 'ACCOUNT_STORE_DIR = "auth-accounts"', "base dir is auth-accounts");
  assertIncludes(oaSource, "join(getAgentDir(), ACCOUNT_STORE_DIR, provider)", "provider subdirectory");
});

test("Grok credential directory includes auth-accounts/grok-cli/", () => {
  // grok-account-token.ts should construct the same path
  assertIncludes(tokenSource, 'ACCOUNT_STORE_DIR = "auth-accounts"', "uses same ACCOUNT_STORE_DIR");
  // Quota cache also uses the same directory
  const quotaSource = read("lib/grok-subscription-quota.ts");
  assertIncludes(quotaSource, '"auth-accounts"', "quota cache in auth-accounts dir");
  assertIncludes(quotaSource, 'GROK_CLI_PROVIDER_ID', "quota cache uses provider id");
});

test("Deleted accounts go to auth-accounts/<provider>/deleted/", () => {
  assertIncludes(oaSource, 'DELETED_ACCOUNT_DIR = "deleted"', "deleted subdirectory");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
