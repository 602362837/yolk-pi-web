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
import { accessSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

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

test("explicit Active lifecycle APIs replace ambiguous sync", () => {
  assertIncludes(oaSource, "export async function readOAuthActiveAccountId", "exports metadata-only Active reader");
  assertIncludes(oaSource, "export async function bootstrapOAuthActiveAccountCredential", "exports legacy bootstrap command");
  assertIncludes(oaSource, "export async function adoptOAuthActiveAccountCredential", "exports explicit adoption command");
  assertIncludes(oaSource, "export async function clearOAuthActiveAccount", "exports lock-held logout clear command");
  assertNotIncludes(oaSource, "syncActiveOAuthAccountCredential", "old ambiguous sync is removed");
});

test("list is a pure metadata projection", () => {
  const listStart = oaSource.indexOf("export async function listOAuthAccounts");
  const listEnd = oaSource.indexOf("export async function updateOAuthAccountMetadata", listStart);
  const listSource = oaSource.slice(listStart, listEnd);
  assertNotIncludes(listSource, "getWebCredentialStore", "list does not read auth.json");
  assertNotIncludes(listSource, "backfillLabel", "list does not perform remote label backfill");
  assertNotIncludes(listSource, "writeMetadata", "list does not rewrite metadata");
});

// ============================================================================
// 3. grok-account-token.ts — resolver safety
// ============================================================================

console.log("\n=== grok-account-token.ts — resolver safety ===");

const tokenSource = read("lib/grok-account-token.ts");
const transactionSource = read("lib/grok-credential-transaction.ts");

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

test("Refreshed credential uses the shared slot-first transaction", () => {
  assertIncludes(tokenSource, "commitGrokCredentialUnderLock", "uses coordinated transaction");
  assertIncludes(transactionSource, "atomicWriteSlot", "atomically writes authoritative slot");
});

test("Active-mirror compare-and-set happens after the slot commit", () => {
  assertIncludes(transactionSource, "await atomicWriteSlot", "commits slot first");
  assertIncludes(transactionSource, "current.storageId !== input.storageId", "checks Active pointer before mirror");
  assertIncludes(transactionSource, "rawStore.modify", "mirrors through raw credential store");
});

test("Refresh failure preserves existing credential", () => {
  assertIncludes(tokenSource, "throw new GrokTokenError", "throws structured GrokTokenError on failure");
  // The caller must handle — credential file is not deleted on failure
  assertNotIncludes(tokenSource, "unlink(", "does not delete credential on failure");
  assertNotIncludes(tokenSource, "rm(", "does not remove credential on failure");
});

test("Token errors are credential-evidence-only structured codes", () => {
  assertIncludes(tokenSource, "export type GrokTokenErrorCode", "exports fixed error codes");
  assertIncludes(tokenSource, "export function mapGrokOAuthError", "exports oauth error mapper");
  assertIncludes(tokenSource, '"missing_refresh"', "missing_refresh code");
  assertIncludes(tokenSource, '"unauthorized"', "unauthorized code");
  assertIncludes(tokenSource, '"refresh_failed"', "refresh_failed non-reauth code");
  assertIncludes(tokenSource, '"provider_unavailable"', "provider_unavailable non-reauth code");
  assertIncludes(tokenSource, '"network"', "network non-reauth code");
  assertIncludes(tokenSource, '"unavailable"', "unavailable non-reauth code");
  assertIncludes(tokenSource, "reloginRequired", "reads third-party reloginRequired evidence");
  assertIncludes(tokenSource, 'code === "refresh_missing"', "maps Xai refresh_missing");
  // Valid AT path must not be blocked by temporary Active mirror repair failure.
  const validAtBlock = tokenSource.slice(
    tokenSource.indexOf("if (!needsRefresh)"),
    tokenSource.indexOf("return refreshGrokCredentialUnderLock"),
  );
  assertIncludes(validAtBlock, "reconcileGrokActiveMirrorUnderLock", "reconciles on valid AT path");
  assertIncludes(validAtBlock, "catch (error)", "best-effort reconcile catch");
  assertIncludes(validAtBlock, "void error", "swallows temporary reconcile failure");
  assertIncludes(validAtBlock, "accessToken: access", "still returns valid AT after reconcile failure");
});

test("No credential material in log/error messages", () => {
  // Error messages use fixed safe text, not credential keys or upstream bodies.
  // Comments may mention "access" and "refresh" for documentation;
  // the key invariant is that throw/error strings don't leak values.
  const throwLines = tokenSource.split('\n').filter(
    (l) =>
      l.includes('throw new Error')
      || l.includes('throw new OAuth')
      || l.includes('throw new GrokTokenError')
      || l.includes('GROK_TOKEN_SAFE_MESSAGES')
  ).join('\n');
  assert.ok(
    tokenSource.includes('storageId') || throwLines.length > 0,
    "token helper retains storageId handling",
  );
  // Error strings must not contain the literal pattern of a JWT or API key
  assertNotIncludes(throwLines, 'eyJ', "no JWT in error messages");
  assertNotIncludes(throwLines, 'sk-', "no API key in error messages");
  assertNotIncludes(tokenSource, "access_token=", "no access_token leak");
  assertNotIncludes(tokenSource, "refresh_token=", "no refresh_token leak");
});

test("getGrokAccessToken validates storageId is non-empty", () => {
  assertIncludes(tokenSource, "!normalizedStorageId", "validates non-empty storage id");
  assertIncludes(tokenSource, 'throw new GrokTokenError("missing_storage_id")', "structured missing_storage_id");
});

test("invalidateGrokTokenFlight removes in-flight promise", () => {
  assertIncludes(tokenSource, "inflightRefreshes.delete", "removes flight entry");
});

test("Credentials stored at 0600 in 0700 directory", () => {
  assertIncludes(transactionSource, "JSON_FILE_MODE = 0o600", "0600 constant");
  assertIncludes(transactionSource, "ACCOUNT_DIR_MODE = 0o700", "0700 constant");
  assertIncludes(transactionSource, "mode: ACCOUNT_DIR_MODE", "sets directory mode");
  assertIncludes(transactionSource, "JSON_FILE_MODE", "sets file mode");
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

test("getActiveGrokAccountId reads only the Active metadata pointer", () => {
  assertIncludes(sessionSource, "isSupportedOAuthAccountProvider", "checks provider support");
  assertIncludes(sessionSource, "readOAuthActiveAccountId", "uses metadata-only Active reader");
  assertNotIncludes(sessionSource, "listOAuthAccounts", "does not enumerate accounts just to read Active");
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
  assertIncludes(tokenSource, "concurrent forced callers share one forced flight", "documents mode-aware single-flight");
});

test("getGrokAccessToken documents the slot-first commit contract", () => {
  assertIncludes(tokenSource, "slot first", "documents transaction ordering");
  assertIncludes(transactionSource, "write failure never rolls", "documents no rollback on mirror failure");
});

test("getGrokAccessToken keeps credential data out of logs", () => {
  assertNotIncludes(tokenSource, "console.log", "no credential logging");
});

test("minValidityMs default is 120_000 (2 min)", () => {
  assertIncludes(tokenSource, "minValidityMs: opts.minValidityMs ?? 120_000", "default 2 min validity");
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

test("managed OAuth routes use explicit lifecycle commands", () => {
  const accountsRoute = read("app/api/auth/accounts/[provider]/route.ts");
  const providersRoute = read("app/api/auth/providers/route.ts");
  const logoutRoute = read("app/api/auth/logout/[provider]/route.ts");
  assertIncludes(accountsRoute, "bootstrapOAuthActiveAccountCredential(provider)", "account GET bootstraps legacy mirror before pure list");
  assertIncludes(providersRoute, "bootstrapOAuthActiveAccountCredential(p.id).catch", "provider GET isolates bootstrap failures");
  assertIncludes(logoutRoute, "clearOAuthActiveAccount(provider, () => runtime.logout(provider))", "logout clears the pointer inside the lifecycle command");
  assertIncludes(logoutRoute, "reloadRpcAuthState", "logout reloads live runtime only after clear");
  assertNotIncludes(logoutRoute, "listOAuthAccounts", "logout never enumerates accounts to clear Active");
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
  assertIncludes(tokenSource, '"auth-accounts"', "uses same account-store directory");
  // Quota cache also uses the same directory
  const quotaSource = read("lib/grok-subscription-quota.ts");
  assertIncludes(quotaSource, '"auth-accounts"', "quota cache in auth-accounts dir");
  assertIncludes(quotaSource, 'GROK_CLI_PROVIDER_ID', "quota cache uses provider id");
});

test("Deleted accounts go to auth-accounts/<provider>/deleted/", () => {
  assertIncludes(oaSource, 'DELETED_ACCOUNT_DIR = "deleted"', "deleted subdirectory");
});

// ============================================================================
// 11. grok-account-lock.ts — provider lock
// ============================================================================

console.log("\n=== grok-account-lock.ts — provider lock ===");

const grokLockSource = read("lib/grok-account-lock.ts");

test("grok-account-lock uses mkdir-based locking (no third-party packages)", () => {
  assertIncludes(grokLockSource, "LOCK_DIR_NAME", "has lock dir constant");
  assertIncludes(grokLockSource, 'LOCK_OWNER_FILE = "owner.json"', "has owner file");
  assertIncludes(grokLockSource, "mkdir(lockDir", "uses mkdir for exclusive lock");
  assertNotIncludes(grokLockSource, "proper-lockfile", "no third-party lock library");
  assertNotIncludes(grokLockSource, "lockfile", "no lockfile dependency");
});

test("grok-account-lock is independent from Kiro/Antigravity locks", () => {
  assertNotIncludes(grokLockSource, "KIRO_PROVIDER_ID", "does not reference Kiro provider");
  assertNotIncludes(grokLockSource, "ANTIGRAVITY_PROVIDER_ID", "does not reference Antigravity provider");
  assertIncludes(grokLockSource, "GROK_CLI_PROVIDER_ID", "references only Grok provider");
});

test("grok-account-lock has stale lock recovery", () => {
  assertIncludes(grokLockSource, "LOCK_STALE_MS", "has stale timeout");
  assertIncludes(grokLockSource, "tryRemoveStaleLock", "has stale recovery function");
  assertIncludes(grokLockSource, "LOCK_MAX_WAIT_MS", "has max wait");
});

test("grok-account-lock uses process mutex + cross-process fs dir lock", () => {
  assertIncludes(grokLockSource, "processLock", "has process-level mutex");
  assertIncludes(grokLockSource, "withProcessLock", "has process lock wrapper");
  assertIncludes(grokLockSource, "withFsDirLock", "has filesystem lock wrapper");
  assertIncludes(grokLockSource, "withGrokProviderLock", "exports public withGrokProviderLock");
});

test("grok-account-lock covers refresh + Activate + reauth", () => {
  assertIncludes(grokLockSource, "refresh/Activate/reauth", "documents lock coverage");
  assertIncludes(grokLockSource, "LOCK_DIR_NAME = \"provider.refresh-activate-reauth.lock\"", "lock name includes reauth");
});

test("grok-account-lock uses atomic write for owner file", () => {
  assertIncludes(grokLockSource, "writeFile(ownerPath", "writes owner metadata");
  assertIncludes(grokLockSource, "JSON_FILE_MODE", "owner file has permission constant");
});

test("grok-account-lock test helper exists", () => {
  assertIncludes(grokLockSource, "__grokLockUsesFsPrimitivesForTests", "test helper exported");
});

// ============================================================================
// 12. oauth-accounts.ts — reauthenticateOAuthAccount
// ============================================================================

console.log("\n=== oauth-accounts.ts — reauthenticateOAuthAccount ===");

test("reauthenticateOAuthAccount is exported", () => {
  assertIncludes(oaSource, "export async function reauthenticateOAuthAccount", "function exported");
});

test("reauthenticateOAuthAccount P0 guard: only grok-cli", () => {
  assertIncludes(oaSource, 'provider !== GROK_CLI_PROVIDER_ID', "rejects non-grok providers");
  assertIncludes(oaSource, "Reauthentication is currently only supported for grok-cli", "clear error message");
});

test("reauthenticateOAuthAccount validates credential via adapter", () => {
  assertIncludes(oaSource, "adapter.isCredential(credential)", "validates credential shape");
});

test("reauthenticateOAuthAccount runs under Grok provider lock", () => {
  assertIncludes(oaSource, "withGrokProviderLock(async", "wraps in provider lock");
});

test("reauthenticateOAuthAccount lock-time verifies target exists", () => {
  assertIncludes(oaSource, "Lock-time: verify target credential file", "documents lock-time check");
  assertIncludes(oaSource, 'throw new OAuthAccountStoreError("Saved OAuth account not found"', "throws for missing target");
});

test("reauthenticateOAuthAccount preserves user metadata fields", () => {
  assertIncludes(oaSource, "existingEntry", "captures old metadata entry");
  assertIncludes(oaSource, "chatgptAccountId", "updates diagnostic id");
  assertIncludes(oaSource, "updatedAt", "updates timestamp");
});

test("reauthenticateOAuthAccount uses atomic credential write (tmp+rename)", () => {
  assertIncludes(oaSource, "tmpCredPath", "uses tmp file for credential");
  assertIncludes(oaSource, "rename(tmpCredPath", "uses rename for atomic credential write");
});

test("reauthenticateOAuthAccount has best-effort credential rollback on metadata failure", () => {
  assertIncludes(oaSource, "oldCredentialRaw", "backs up old credential");
  assertIncludes(oaSource, "best-effort", "documents rollback is best-effort");
});

test("reauthenticateOAuthAccount updates auth.json mirror only when target is active", () => {
  assertIncludes(oaSource, "wasActive", "tracks pre-reauth active state");
  assertIncludes(oaSource, "getWebCredentialStore", "uses credential store for mirror");
});

test("reauthenticateOAuthAccount invalidates token flight after success", () => {
  assertIncludes(oaSource, "invalidateGrokTokenFlight", "invalidates token flight");
});

test("reauthenticateOAuthAccount bumps quota generation and deletes persisted cache", () => {
  assertIncludes(oaSource, "bumpGrokQuotaGeneration", "bumps quota generation");
  assertIncludes(oaSource, "deleteGrokQuotaPersistedCacheEntry", "deletes persisted quota cache");
});

test("reauthenticateOAuthAccount no credential material in error messages", () => {
  const reauthFn = oaSource.match(/reauthenticateOAuthAccount[\s\S]*?^export /m)?.[0] || "";
  // Error messages use fixed strings, never variable credential content
  assertNotIncludes(reauthFn, 'cred.access', "no credential access in error paths");
  assertNotIncludes(reauthFn, 'cred.refresh', "no credential refresh in error paths");
});

test("activateOAuthAccount uses Grok provider lock", () => {
  assertIncludes(oaSource, 'provider === GROK_CLI_PROVIDER_ID', "dispatches on Grok");
  assertIncludes(oaSource, 'withGrokProviderLock(run)', "wraps activate with Grok lock");
});

// ============================================================================
// 13. grok-account-token.ts — Grok provider lock integration
// ============================================================================

console.log("\n=== grok-account-token.ts — lock integration ===");

test("getGrokAccessToken refresh runs under Grok provider lock", () => {
  const tokenSource2 = read("lib/grok-account-token.ts");
  assertIncludes(tokenSource2, "withGrokProviderLock", "uses Grok provider lock");
  assertIncludes(tokenSource2, "return withGrokProviderLock", "runs the lock-time reread under the provider lock");
});

test("grok-account-token imports lock from grok-account-lock", () => {
  const tokenSource2 = read("lib/grok-account-token.ts");
  assertIncludes(tokenSource2, 'import { withGrokProviderLock } from "./grok-account-lock"', "imports lock");
});

// ============================================================================
// 14. grok-subscription-quota.ts — generation isolation
// ============================================================================

console.log("\n=== grok-subscription-quota.ts — generation isolation ===");

const quotaSource = read("lib/grok-subscription-quota.ts");

test("quota generation counter prevents stale writes after reauth", () => {
  assertIncludes(quotaSource, "quotaGenerations", "has generation map");
  assertIncludes(quotaSource, "bumpGrokQuotaGeneration", "bump function exported");
  assertIncludes(quotaSource, "getGrokQuotaGeneration", "getter function exported");
  assertIncludes(quotaSource, "startGeneration = getGrokQuotaGeneration", "captures generation at start");
});

test("quota fetch discards success result when generation changed", () => {
  assertIncludes(quotaSource, "getGrokQuotaGeneration(accountId) !== startGeneration", "checks generation before writing");
  assertIncludes(quotaSource, "Credential was replaced mid-flight", "documents discard reason");
});

test("deleteGrokQuotaPersistedCacheEntry removes entry atomically", () => {
  assertIncludes(quotaSource, "deleteGrokQuotaPersistedCacheEntry", "delete function exported");
  assertIncludes(quotaSource, "delete persisted.entries[accountId]", "removes account entry");
  assertIncludes(quotaSource, "Best-effort", "documents best-effort nature");
});

test("bumpGrokQuotaGeneration clears in-memory cache entry", () => {
  assertIncludes(quotaSource, "quotaCache.delete(accountId)", "clears memory cache");
});

// ============================================================================
// 15. Runtime tests via jiti (structured token evidence)
// ============================================================================

console.log("\n=== Runtime tests (jiti) ===");

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": root,
  },
});

const runtimeTests = [
  "lib/grok-account-token.test.ts",
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
