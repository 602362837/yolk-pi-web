#!/usr/bin/env node
/**
 * test-grok-reauth — Grok reauth API route, error mapping, and contract tests
 *
 * Validates OAuth SSE login route reauth mode, safe error projection,
 * store integration, and compatibility guarantees. Uses source-code
 * inspection (no pi SDK imports, no network, no real agent dir).
 *
 * Run: node scripts/test-grok-reauth.mjs
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
// 1. grok-login-errors.ts — safe error mapper
// ============================================================================

console.log("\n=== grok-login-errors.ts — safe error mapper ===");

const errorsSource = read("lib/grok-login-errors.ts");

test("sanitizeGrokLoginError is exported", () => {
  assertIncludes(errorsSource, "export function sanitizeGrokLoginError", "function exported");
});

test("isGrokLoginCancelled is exported", () => {
  assertIncludes(errorsSource, "export function isGrokLoginCancelled", "function exported");
});

test("GROK_LOGIN_FALLBACK_SAFE is a generic message, not raw error", () => {
  assertIncludes(errorsSource, "Grok login failed. Please retry or use a different login method.", "generic fallback message");
});

test("Error map includes cancelled sentinel", () => {
  assertIncludes(errorsSource, "Login cancelled", "handles cancelled");
});

test("Error map includes authorization denied", () => {
  assertIncludes(errorsSource, "authorization denied", "handles denied");
  assertIncludes(errorsSource, "access_denied", "handles access_denied");
});

test("Error map includes timeout", () => {
  assertIncludes(errorsSource, "timed out", "handles timeout");
});

test("Error map includes device code expired", () => {
  assertIncludes(errorsSource, "device code expired", "handles device expired");
});

test("Error map includes bind/address-in-use", () => {
  assertIncludes(errorsSource, "address in use", "handles bind failure");
});

test("Error map includes refresh missing", () => {
  assertIncludes(errorsSource, "refresh", "handles refresh issues");
  assertIncludes(errorsSource, "incomplete", "describes incomplete credential");
});

test("Error map includes select/unsupported method", () => {
  assertIncludes(errorsSource, "unsupported method", "handles unsupported method");
});

test("Error map includes target account not found", () => {
  assertIncludes(errorsSource, "no longer exists", "handles deleted target");
});

test("Error map includes provider not supported for reauth", () => {
  assertIncludes(errorsSource, "Reauthentication is currently only supported", "handles unsupported provider");
});

test("isGrokLoginCancelled handles AbortError", () => {
  assertIncludes(errorsSource, "AbortError", "handles AbortError as cancelled");
});

test("sanitizeGrokLoginError preserves 'Login cancelled' sentinel", () => {
  assertIncludes(errorsSource, 'return rawMsg; // keep as sentinel for SSE "cancelled" path', "preserves cancel sentinel");
});

test("No raw upstream response text patterns in safe messages", () => {
  // Safe messages should never contain JSON fields like "error_description"
  assertNotIncludes(errorsSource, "error_description", "no raw oauth error field in safe messages");
  assertNotIncludes(errorsSource, "error_uri", "no raw oauth error field in safe messages");
});

test("No filesystem paths in safe messages", () => {
  assertNotIncludes(errorsSource, "/auth.json", "no path in safe messages");
  assertNotIncludes(errorsSource, "auth-accounts", "no path in safe messages");
});

test("No credential field names in safe messages", () => {
  // Safe messages don't mention access token, refresh token, id token
  const safeMessagesSection = errorsSource.match(/GROK_LOGIN_ERROR_MAP[\s\S]*?\];/)?.[0] || "";
  assertNotIncludes(safeMessagesSection, 'access_token', "no access token mention in safe messages");
  assertNotIncludes(safeMessagesSection, 'refresh_token', "no refresh token mention in safe messages");
  assertNotIncludes(safeMessagesSection, 'id_token', "no id token mention in safe messages");
});

// ============================================================================
// 2. Route: reauth mode contract
// ============================================================================

console.log("\n=== Route: reauth mode contract ===");

const routeSource = read("app/api/auth/login/[provider]/route.ts");

test("Route parses accountMode=reauth from query", () => {
  assertIncludes(routeSource, 'accountMode === "reauth"', "parses reauth mode");
});

test("Route parses accountId for reauth", () => {
  assertIncludes(routeSource, 'url.searchParams.get("accountId")', "parses accountId param");
  assertIncludes(routeSource, "reauthAccountId", "has reauthAccountId variable");
});

test("Route validates reauth only for grok-cli", () => {
  assertIncludes(routeSource, 'provider !== GROK_CLI_PROVIDER_ID', "rejects non-grok reauth");
  assertIncludes(routeSource, "Reauthentication is not supported for this provider.", "clear error");
});

test("Route validates accountId is present for reauth", () => {
  assertIncludes(routeSource, "accountId is required for reauthentication", "requires accountId");
});

test("Route preflight verifies target account exists", () => {
  assertIncludes(routeSource, "Preflight: verify the target account", "documents preflight");
  assertIncludes(routeSource, "listOAuthAccounts(GROK_CLI_PROVIDER_ID)", "calls listOAuthAccounts");
  assertIncludes(routeSource, "no longer exists", "target-gone message");
});

test("Route uses isolated in-memory store for reauth (same as add)", () => {
  assertIncludes(routeSource, "useIsolatedStore = addAccountMode || reauthMode", "shares isolated store logic");
  assertIncludes(routeSource, "createInMemoryWebCredentialStore()", "creates memory store");
});

test("Route loads fixed providers for isolated store (add and reauth)", () => {
  assertIncludes(routeSource, "useIsolatedStore", "checks isolated store flag");
  assertIncludes(routeSource, "fixedProvidersOnly: true", "loads fixed providers only");
});

test("Route calls reauthenticateOAuthAccount on success", () => {
  assertIncludes(routeSource, "reauthenticateOAuthAccount", "calls reauth store helper");
  assertIncludes(routeSource, "GROK_CLI_PROVIDER_ID", "passes grok-cli provider");
  assertIncludes(routeSource, "reauthAccountId", "passes accountId");
  assertIncludes(routeSource, "credential as Credential", "passes credential");
});

test("Route reloads RPC auth only when target is Active", () => {
  assertIncludes(routeSource, "if (active)", "checks active flag before reload");
  assertIncludes(routeSource, "reloadRpcAuthState()", "calls reload");
});

test("Route SSE success projection is safe", () => {
  // Success response includes account summary, reauthenticated flag, active boolean
  assertIncludes(routeSource, 'type: "success"', "success type");
  assertIncludes(routeSource, "reauthenticated: true", "reauthenticated flag");
  assertIncludes(routeSource, "active", "active boolean in response");
  // Must not include raw credential fields
  const successBlock = routeSource.match(/send\(controller, \{\s*type: "success",[\s\S]*?\}\);/) || "";
  // Success messages mention account but not secret values
  assertNotIncludes(successBlock, 'access', "no access token in success");
  assertNotIncludes(successBlock, 'refresh', "no refresh token in success");
});

test("Route Active vs non-Active success messages differ", () => {
  assertIncludes(routeSource, "Global active credential updated", "active success message");
  assertIncludes(routeSource, "Global active credential unchanged", "non-active success message");
});

test("Route uses safe Grok error mapper for all flows", () => {
  assertIncludes(routeSource, 'provider === GROK_CLI_PROVIDER_ID', "checks for Grok provider");
  assertIncludes(routeSource, "sanitizeGrokLoginError", "uses safe error mapper");
  assertIncludes(routeSource, "isGrokLoginCancelled", "checks cancel sentinel");
});

test("Route preserves Antigravity safe error handling", () => {
  assertIncludes(routeSource, "sanitizeAntigravityLoginError", "antigravity safe error preserved");
});

// ============================================================================
// 3. Route: backward compatibility
// ============================================================================

console.log("\n=== Route: backward compatibility ===");

test("Route still accepts empty accountMode (provider-wide login)", () => {
  // The validation only rejects unknown modes, not empty
  assertIncludes(routeSource, 'accountMode && accountMode !== "add" && accountMode !== "reauth"', "only rejects unknown modes");
});

test("Route still accepts accountMode=add", () => {
  assertIncludes(routeSource, 'saveOAuthAccountCredential(provider, credential', "add still calls save");
  assertIncludes(routeSource, 'Account saved successfully', "add success message unchanged");
});

test("Route still syncs active for provider-wide login", () => {
  assertIncludes(routeSource, "syncActiveOAuthAccountCredential", "provider-wide sync preserved");
});

test("Route POST callback unchanged", () => {
  // The POST handler should not have been modified
  const postStart = routeSource.indexOf("export async function POST");
  const getStart = routeSource.indexOf("export async function GET");
  const postBody = routeSource.slice(postStart, getStart);
  assertIncludes(postBody, "token and code required", "POST contract unchanged");
  assertIncludes(postBody, "token.startsWith(`${provider}-`)", "POST token check unchanged");
  assertNotIncludes(postBody, "reauth", "POST handler has no reauth logic");
});

test("Route still validates addAccountMode for supported providers", () => {
  assertIncludes(routeSource, "addAccountMode && !isSupportedOAuthAccountProvider", "add validation preserved");
});

// ============================================================================
// 4. Integration: reauth → store → lock → cache
// ============================================================================

console.log("\n=== Integration: reauth → store → lock → cache ===");

const oaSource = read("lib/oauth-accounts.ts");

test("reauthenticateOAuthAccount is imported by route", () => {
  assertIncludes(routeSource, 'reauthenticateOAuthAccount,\n} from "@/lib/oauth-accounts"', "imported from oauth-accounts");
});

test("reauthenticateOAuthAccount P0 guard only grok-cli", () => {
  assertIncludes(oaSource, 'provider !== GROK_CLI_PROVIDER_ID', "P0 guard in store");
});

test("reauthenticateOAuthAccount uses Grok provider lock", () => {
  assertIncludes(oaSource, "withGrokProviderLock(async", "under provider lock");
});

test("reauthenticateOAuthAccount invalidates token flight", () => {
  assertIncludes(oaSource, "invalidateGrokTokenFlight", "invalidates flight");
  assertIncludes(oaSource, "normalizedAccountId", "passed storage id");
});

test("reauthenticateOAuthAccount bumps quota generation", () => {
  assertIncludes(oaSource, "bumpGrokQuotaGeneration", "bumps generation");
  assertIncludes(oaSource, "deleteGrokQuotaPersistedCacheEntry", "deletes persisted cache");
});

// ============================================================================
// 5. Secret safety: no credential in route, errors, or SSE
// ============================================================================

console.log("\n=== Secret safety: route projection ===");

test("Route SSE never returns raw credential fields", () => {
  // The only credential reference in the send path is via `reauthenticateOAuthAccount`
  // which only returns OAuthAccountSummary (safe). The route must not send credential directly.
  assertNotIncludes(routeSource, 'credential.access', "no raw access in SSE projection");
  assertNotIncludes(routeSource, 'credential.refresh', "no raw refresh in SSE projection");
  assertNotIncludes(routeSource, 'credential.expires', "no raw expires in SSE projection");
});

test("Route SSE never returns callback URL or device code in success/error", () => {
  // auth_url notification is upstream from pi-grok-cli, not in success/error
  // device_code notification is also upstream
  // Success/error must not repeat these
  const errorAndSuccessBlocks = routeSource.match(/catch \(err\)[\s\S]*?finally \{/)?.[0] || "";
  assertNotIncludes(errorAndSuccessBlocks, 'auth_url', "no auth_url in error handling");
  assertNotIncludes(errorAndSuccessBlocks, 'device_code', "no device_code in error handling");
});

test("Route error messages do not include credential paths", () => {
  // The route imports from @/lib/oauth-accounts (a path alias), which
  // contains the substring auth-accounts; that is not a data leak.
  // Check that error/success strings don't leak filesystem paths.
  const sendCalls = routeSource.match(/send\(controller, \{[\s\S]*?message:[\s\S]*?\}\);/g) || [];
  for (const call of sendCalls) {
    assertNotIncludes(call, 'auth-accounts', "no account store path in SSE message");
    assertNotIncludes(call, '.json', "no file extension in SSE message");
  }
});

test("Route never imports AuthStorage or private pi-grok-cli internals", () => {
  assertNotIncludes(routeSource, "AuthStorage", "no AuthStorage import");
  assertNotIncludes(routeSource, "pi-grok-cli/src", "no private provider deep import");
  assertNotIncludes(routeSource, "ModelRegistry", "no ModelRegistry usage");
});

test("Route always uses Web CredentialStore boundary", () => {
  assertIncludes(routeSource, "createInMemoryWebCredentialStore", "uses Web store interface");
  assertIncludes(routeSource, "getWebModelRuntime", "uses Web model runtime");
});

// ============================================================================
// 6. Provider scope: only Grok, no leak to Kiro/Antigravity
// ============================================================================

console.log("\n=== Provider scope: Grok-only reauth ===");

test("Route does not enable reauth for Kiro", () => {
  // Kiro provider id should not appear in reauth logic
  const reauthBlock = routeSource.match(/if \(reauthMode\)[\s\S]*?^\s*}/m)?.[0] || "";
  assertNotIncludes(reauthBlock, "KIRO_PROVIDER_ID", "no kiro in reauth block");
  assertNotIncludes(reauthBlock, "kiro", "no kiro reference in reauth");
});

test("Route does not enable reauth for Antigravity", () => {
  const reauthBlock = routeSource.match(/if \(reauthMode\)[\s\S]*?^\s*}/m)?.[0] || "";
  assertNotIncludes(reauthBlock, "ANTIGRAVITY_PROVIDER_ID", "no antigravity in reauth block");
});

test("Route does not enable reauth for openai-codex", () => {
  const reauthBlock = routeSource.match(/if \(reauthMode\)[\s\S]*?^\s*}/m)?.[0] || "";
  assertNotIncludes(reauthBlock, "openai-codex", "no openai in reauth block");
});

test("grok-login-errors.ts is independent of other providers", () => {
  assertNotIncludes(errorsSource, "KIRO_PROVIDER_ID", "no kiro in grok error mapper");
  assertNotIncludes(errorsSource, "ANTIGRAVITY_PROVIDER_ID", "no antigravity in grok error mapper");
  assertNotIncludes(errorsSource, "openai-codex", "no openai in grok error mapper");
});

// ============================================================================
// 7. accountId safety: never treated as filesystem path
// ============================================================================

console.log("\n=== accountId safety ===");

test("Route validates accountId exists in store, not on filesystem directly", () => {
  // The route calls listOAuthAccounts (which goes through adapter + metadata),
  // not a raw fs.access call with accountId in the path.
  assertIncludes(routeSource, "listOAuthAccounts", "uses store abstraction");
  assertNotIncludes(routeSource, "credentialPath", "no raw path construction in route");
  assertNotIncludes(routeSource, "pathExists", "no raw fs check in route");
});

test("reauthenticateOAuthAccount validates storageId via store, not raw path", () => {
  // The function uses credentialPath() internally but validates through adapter first
  // and checks existence only within the lock boundary.
  assertIncludes(oaSource, "encodedCredentialFileName", "uses encoded file name");
  assertIncludes(oaSource, "encodeURIComponent", "encodes URI component");
});

// ============================================================================
// 8. Dependencies: no new package imports
// ============================================================================

console.log("\n=== Dependencies ===");

test("No new runtime dependencies added for reauth", () => {
  // All reauth code reuses existing pi-ai, pi-coding-agent, pi-grok-cli, and Node builtins
  // The package.json should not have new entries beyond what was already there.
  const routeImports = routeSource.match(/import .* from ["']([^"']+)["']/g) || [];
  for (const imp of routeImports) {
    const matched = imp.match(/from ["']([^"']+)["']/);
    if (!matched) continue;
    const pkg = matched[1];
    // Only check npm-scoped packages (start with @), skip path aliases (@/lib/...)
    if (pkg.startsWith("@") && !pkg.startsWith("@/")) {
      // Must be @earendil-works/pi-ai or @earendil-works/pi-coding-agent (existing)
      assert.ok(
        pkg === "@earendil-works/pi-ai" || pkg === "@earendil-works/pi-coding-agent",
        `no new @ scoped package: ${pkg}`,
      );
    }
  }
  // Check no new pi-grok-cli import (the route should not directly import it)
  assertNotIncludes(routeSource, "pi-grok-cli", "no pi-grok-cli direct import in route");
});

// ============================================================================
// 9. Existing Grok add flow regression
// ============================================================================

console.log("\n=== Existing Grok add flow regression ===");

test("Grok add mode still uses saveOAuthAccountCredential", () => {
  assertIncludes(routeSource, "saveOAuthAccountCredential(provider, credential", "add uses save");
});

test("Grok add mode success message unchanged", () => {
  assertIncludes(routeSource, "Account saved successfully", "add success message");
});

test("Grok add errors now use safe mapper instead of raw messages", () => {
  // When provider === GROK_CLI_PROVIDER_ID, all errors (including add) use safe mapper
  const errorBlock = routeSource.match(/catch \(err\)[\s\S]*?finally \{/)?.[0] || "";
  assertIncludes(errorBlock, 'provider === GROK_CLI_PROVIDER_ID', "grok check first");
  assertIncludes(errorBlock, "sanitizeGrokLoginError", "safe mapper for grok");
});

// ============================================================================
// 10. Cleanup and lifecycle
// ============================================================================

console.log("\n=== Cleanup and lifecycle ===");

test("Route cleanup still runs for reauth", () => {
  // The cleanup function is in the finally block and is shared by all modes
  assertIncludes(routeSource, "cleanup();", "cleanup in finally");
  assertIncludes(routeSource, "controller.close();", "controller closed");
});

test("Route abort signal disconnected for reauth", () => {
  assertIncludes(routeSource, "abort.abort()", "abort on cancel");
  assertIncludes(routeSource, 'abort.signal.addEventListener("abort", cleanup)', "cleanup on abort");
});

test("Route reauth isolated store not leaked to durable Active", () => {
  // reauthenticateOAuthAccount() handles durable writes internally;
  // the route never directly touches auth.json or durable store.
  assertNotIncludes(routeSource, "getWebCredentialStore", "route does not directly access durable store");
  assertNotIncludes(routeSource, "auth.json", "route does not reference auth.json");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
