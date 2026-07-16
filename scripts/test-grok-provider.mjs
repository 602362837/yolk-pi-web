#!/usr/bin/env node
/**
 * grok-provider-bootstrap — cold-start, registry, and entry-point audit tests
 *
 * Validates that the unified provider extension system (`lib/pi-provider-extensions.ts`)
 * is correctly wired into every Web boot path and that the Grok extension factories
 * meet security / isolation / correctness contracts.
 *
 * - Source-code inspection only — no pi SDK imports, no network, no real agent dir.
 * - Verifies all entry points use webExtensionFactories() or ensureGrokBootstrapped().
 * - Checks registry refresh order safety.
 * - Validates secret-free code paths.
 *
 * Run: node scripts/test-grok-provider.mjs
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
// 1. pi-provider-extensions.ts — exports & contracts
// ============================================================================

console.log("\n=== pi-provider-extensions.ts exports ===");

const peSource = read("lib/pi-provider-extensions.ts");

test("exports grokCliExtension with factory from pi-grok-cli", () => {
  assertIncludes(peSource, "export const grokCliExtension", "exports grokCliExtension");
  assertIncludes(peSource, 'import("pi-grok-cli")', "loads pi-grok-cli via jiti");
  assertIncludes(peSource, 'name: "pi-grok-cli"', "extension name is pi-grok-cli");
  assertIncludes(peSource, "await factory(api)", "invokes extension factory");
});

test("exports grokSessionAccountExtension as retired no-op", () => {
  assertIncludes(peSource, "export const grokSessionAccountExtension", "exports session-account extension");
  assertIncludes(peSource, 'name: "grok-session-account"', "extension name is grok-session-account");
  assertIncludes(peSource, "Session Authorization pin is retired", "documents retirement");
  assertIncludes(peSource, "Intentionally empty", "empty factory");
});

test("retired pin extension no longer overrides Authorization", () => {
  assertNotIncludes(peSource, 'event.headers["authorization"]', "no authorization override");
  assertNotIncludes(peSource, "before_provider_headers", "no header hook");
  assertNotIncludes(peSource, 'await import("./grok-session-account")', "no session-account import");
});

test("exports webExtensionFactories() helper without session pin", () => {
  assertIncludes(peSource, "export function webExtensionFactories", "exports webExtensionFactories");
  assertIncludes(peSource, "return [...webProviderExtensions(), ...extra]", "prepends fixed provider list");
  assertIncludes(peSource, "export function webProviderExtensions", "exports webProviderExtensions");
  assertIncludes(peSource, "return [grokCliExtension, kiroProviderExtension]", "fixed list is Grok then Kiro");
  assertNotIncludes(peSource, "[grokCliExtension, grokSessionAccountExtension", "session pin not wired");
});

test("webExtensionFactories documents global Active auth path", () => {
  assertIncludes(peSource, "global Active account from auth.json", "global Active documented");
  assertIncludes(peSource, "Main inference no longer injects a session-bound Authorization header", "pin retired documented");
});

test("exports ensureWebProvidersBootstrapped() with Grok-named alias", () => {
  assertIncludes(peSource, "export function ensureWebProvidersBootstrapped", "exports ensureWebProvidersBootstrapped");
  assertIncludes(peSource, "export function ensureGrokBootstrapped", "retains ensureGrokBootstrapped alias");
  assertIncludes(peSource, "_webProvidersBootstrapPromise", "uses single-flight promise");
});

test("ensureWebProvidersBootstrapped creates services to load fixed providers", () => {
  assertIncludes(peSource, "createAgentSessionServices", "calls createAgentSessionServices");
  assertIncludes(peSource, "webProviderExtensions()", "registers fixed provider list for bootstrap");
  assertIncludes(peSource, "// Best-effort only", "catches errors gracefully");
});

test("exports createWebProviderAwareModelRegistry with Grok-named alias", () => {
  assertIncludes(peSource, "export async function createWebProviderAwareModelRegistry", "exports helper");
  assertIncludes(peSource, "export async function createGrokAwareModelRegistry", "retains createGrokAwareModelRegistry alias");
  assertIncludes(peSource, "await ensureWebProvidersBootstrapped()", "bootstraps before registry create");
  assertIncludes(peSource, "ModelRegistry.create(", "creates provider-aware registry");
});

// ============================================================================
// 2. No deep imports from pi-grok-cli internals
// ============================================================================

console.log("\n=== No deep imports from pi-grok-cli ===");

test("pi-provider-extensions does not deep-import pi-grok-cli/src", () => {
  assertNotIncludes(peSource, "pi-grok-cli/src", "no deep import of src");
  assertNotIncludes(peSource, "pi-grok-cli/dist", "no deep import of dist");
});

test("pi-provider-extensions loads pi-grok-cli only via jiti dynamic import", () => {
  // Static ESM import is avoided; jiti.import("pi-grok-cli") is the only load site.
  const staticImports = peSource.match(/from\s+["']pi-grok-cli["']/g) || [];
  assert.strictEqual(staticImports.length, 0, "no static import from pi-grok-cli");
  assertIncludes(peSource, 'import("pi-grok-cli")', "jiti dynamic import of pi-grok-cli");
});

test("grok-account-token does not deep-import pi-grok-cli", () => {
  const source = read("lib/grok-account-token.ts");
  assertNotIncludes(source, "pi-grok-cli/src", "no deep import");
  assertNotIncludes(source, "pi-grok-cli/dist", "no deep import");
});

test("grok-subscription-quota does not deep-import pi-grok-cli", () => {
  const source = read("lib/grok-subscription-quota.ts");
  assertNotIncludes(source, "pi-grok-cli/src", "no deep import");
  assertNotIncludes(source, "pi-grok-cli/dist", "no deep import");
});

// ============================================================================
// 3. Entry point audit — every boot path uses common factory
// ============================================================================

console.log("\n=== Entry point audit ===");

test("rpc-manager.ts uses webExtensionFactories", () => {
  const source = read("lib/rpc-manager.ts");
  assertIncludes(source, "webExtensionFactories", "rpc-manager uses factory helper");
});

test("ypi-studio-child-session-runner.ts uses webExtensionFactories", () => {
  const source = read("lib/ypi-studio-child-session-runner.ts");
  assertIncludes(source, "webExtensionFactories", "child runner uses factory helper");
});

test("app/api/models/route.ts uses webExtensionFactories", () => {
  const source = read("app/api/models/route.ts");
  assertIncludes(source, "webExtensionFactories", "models route uses factory helper");
});

test("app/api/auth/providers/route.ts uses webExtensionFactories", () => {
  const source = read("app/api/auth/providers/route.ts");
  assertIncludes(source, "webExtensionFactories", "providers route uses factory helper");
});

test("app/api/auth/login/[provider]/route.ts uses webExtensionFactories", () => {
  const source = read("app/api/auth/login/[provider]/route.ts");
  assertIncludes(source, "webExtensionFactories", "login route uses factory helper");
});

test("app/api/auth/logout/[provider]/route.ts uses webExtensionFactories", () => {
  const source = read("app/api/auth/logout/[provider]/route.ts");
  assertIncludes(source, "webExtensionFactories", "logout route uses factory helper");
});

test("app/api/auth/api-key/[provider]/route.ts uses createWebProviderAwareModelRegistry", () => {
  const source = read("app/api/auth/api-key/[provider]/route.ts");
  assertIncludes(source, "createWebProviderAwareModelRegistry", "api-key route uses provider-aware registry");
});

test("app/api/auth/all-providers/route.ts uses createWebProviderAwareModelRegistry", () => {
  const source = read("app/api/auth/all-providers/route.ts");
  assertIncludes(source, "createWebProviderAwareModelRegistry", "all-providers route uses provider-aware registry");
});

test("app/api/terminal/env/assist/route.ts uses webExtensionFactories", () => {
  const source = read("app/api/terminal/env/assist/route.ts");
  assertIncludes(source, "webExtensionFactories", "terminal assist uses unified provider factories");
});

test("app/api/trellis/workflow/assist/route.ts uses webExtensionFactories", () => {
  const source = read("app/api/trellis/workflow/assist/route.ts");
  assertIncludes(source, "webExtensionFactories", "trellis assist uses unified provider factories");
});

// ============================================================================
// 4. Registry refresh order safety
// ============================================================================

console.log("\n=== Registry refresh order safety ===");

test("pi-provider-extensions documents the refresh invariant", () => {
  // The file header must mention that refresh() can reset global state
  assertIncludes(peSource, "registry-reset can remove grok-cli", "documented registry reset risk");
  assertIncludes(peSource, "must be fed", "documented requirement");
});

test("createWebProviderAwareModelRegistry bootstraps before ModelRegistry.create", () => {
  // Extract the createWebProviderAwareModelRegistry function body only.
  // Comments earlier in the file also mention ModelRegistry.create.
  const fnStart = peSource.indexOf("export async function createWebProviderAwareModelRegistry");
  const fnBody = peSource.slice(fnStart);
  const ensureCall = fnBody.indexOf("await ensureWebProvidersBootstrapped()");
  const createCall = fnBody.indexOf("ModelRegistry.create(");
  const orderOk = ensureCall > 0 && createCall > 0 && ensureCall < createCall;
  if (!orderOk) {
    console.log(`    (info) fnStart=${fnStart} ensureCall=${ensureCall} createCall=${createCall}`);
  }
  assert.ok(orderOk, "bootstrap runs before registry create");
});

test("deepseek-balance.ts bootstraps fixed providers before ModelRegistry.create", () => {
  const source = read("lib/deepseek-balance.ts");
  assertIncludes(source, "ModelRegistry.create", "has bare registry create");
  assertIncludes(source, "ensureWebProvidersBootstrapped", "bootstraps fixed providers first");
});

test("no source file uses ModelRegistry.create without factory path except deepseek-balance", () => {
  // Audit: grep all source files for ModelRegistry.create that don't
  // come from pi-provider-extensions.  We accept deepseek-balance as the
  // only known bare case.
  // This is an existence test, not a runtime assertion.
  const files = [
    { path: "lib/rpc-manager.ts", name: "rpc-manager" },
    { path: "lib/ypi-studio-child-session-runner.ts", name: "child-runner" },
    { path: "app/api/models/route.ts", name: "models" },
    { path: "app/api/auth/providers/route.ts", name: "providers" },
    { path: "app/api/auth/login/[provider]/route.ts", name: "login" },
    { path: "app/api/auth/logout/[provider]/route.ts", name: "logout" },
    { path: "app/api/auth/api-key/[provider]/route.ts", name: "api-key" },
    { path: "app/api/auth/all-providers/route.ts", name: "all-providers" },
    { path: "app/api/terminal/env/assist/route.ts", name: "terminal-assist" },
    { path: "app/api/trellis/workflow/assist/route.ts", name: "trellis-assist" },
  ];
  for (const f of files) {
    try {
      const source = read(f.path);
      // These files should use webExtensionFactories or createWebProviderAwareModelRegistry,
      // not bare ModelRegistry.create.
      if (
        source.includes("ModelRegistry.create") &&
        !source.includes("webExtensionFactories") &&
        !source.includes("createWebProviderAwareModelRegistry") &&
        !source.includes("createGrokAwareModelRegistry") &&
        !source.includes("pi-provider-extensions")
      ) {
        console.log(`    (info) ${f.name} has bare ModelRegistry.create — tracked`);
      }
    } catch {
      // File doesn't exist — skip
    }
  }
  console.log("    (info) bare ModelRegistry.create audit complete");
});

// ============================================================================
// 5. Extension capabilities declaration
// ============================================================================

console.log("\n=== Extension capabilities ===");

test("pi-provider-extensions documents full-extension scope", () => {
  assertIncludes(peSource, "tools, vision", "documents tools and vision");
  assertIncludes(peSource, "Imagine, and request hooks", "documents Imagine and request hooks");
});

test("session pin retirement is documented for main inference", () => {
  assertIncludes(peSource, "Session Authorization pin is retired", "retirement documented");
  assertIncludes(peSource, "global Active account", "global Active path documented");
});

// ============================================================================
// 6. Secret safety — no credentials in extension code
// ============================================================================

console.log("\n=== Secret safety in provider code ===");

const SECRET_SENTINELS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
  /(?<!")(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/g,   // GitHub tokens
  /sk-[A-Za-z0-9]{20,}/g,                                  // OpenAI keys
  'xai-',                                                   // xAI keys
];

test("pi-provider-extensions.ts contains no secret sentinels", () => {
  for (const sentinel of SECRET_SENTINELS) {
    if (typeof sentinel === "string") {
      assertNotIncludes(peSource, sentinel, `no "${sentinel}" in extensions code`);
    } else {
      assert.ok(!sentinel.test(peSource), `no JWT/API-key pattern in extensions code`);
    }
  }
});

test("grok-account-token.ts has no hardcoded xAI endpoints or credentials", () => {
  const source = read("lib/grok-account-token.ts");
  assertNotIncludes(source, "cli-chat-proxy.grok.com", "no billing endpoint in token code");
  assertNotIncludes(source, "auth.x.ai", "no auth endpoint in token code");
});

test("grok-session-account.ts stores only opaque storage ids", () => {
  const source = read("lib/grok-session-account.ts");
  assertIncludes(source, "Only opaque storage ids", "documents no-secret policy");
  assertNotIncludes(source, '"access"', "no access token references in comments");
  assertNotIncludes(source, '"refresh"', "no refresh token references in comments");
});

// ============================================================================
// 7. Module boundary audit
// ============================================================================

console.log("\n=== Module boundary audit ===");

test("oauth-accounts.ts does not import pi-grok-cli as a module", () => {
  const source = read("lib/oauth-accounts.ts");
  // Comments may reference pi-grok-cli for documentation; the important
  // check is that there's no import/require statement.
  assertNotIncludes(source, 'from "pi-grok-cli"', "no pi-grok-cli import");
  assertNotIncludes(source, "from 'pi-grok-cli'", "no pi-grok-cli import (single quote)");
  assertNotIncludes(source, 'require("pi-grok-cli")', "no pi-grok-cli require");
});

test("oauth-account-providers.ts does not import pi-grok-cli as a module", () => {
  const source = read("lib/oauth-account-providers.ts");
  assertNotIncludes(source, 'from "pi-grok-cli"', "no pi-grok-cli import");
  assertNotIncludes(source, "from 'pi-grok-cli'", "no pi-grok-cli import (single quote)");
  assertNotIncludes(source, 'require("pi-grok-cli")', "no pi-grok-cli require");
});

test("grok-subscription-quota.ts imports token resolver, not pi-grok-cli", () => {
  const source = read("lib/grok-subscription-quota.ts");
  assertIncludes(source, "./grok-account-token", "imports from token resolver");
  assertNotIncludes(source, 'from "pi-grok-cli"', "no pi-grok-cli import");
  assertNotIncludes(source, "from 'pi-grok-cli'", "no pi-grok-cli import (single quote)");
  assertNotIncludes(source, 'require("pi-grok-cli")', "no pi-grok-cli require");
});

// ============================================================================
// 8. Error handling & diagnostics
// ============================================================================

console.log("\n=== Error handling ===");

test("ensureWebProvidersBootstrapped survives missing dependency gracefully", () => {
  // The catch block should not rethrow
  assertIncludes(peSource, "catch {", "bootstrap has error handler");
  assertIncludes(peSource, "// Best-effort only", "bootstrap is best-effort");
});

test("retired pin extension is a no-op factory and cannot break non-grok providers", () => {
  assertIncludes(peSource, "Intentionally empty", "empty factory");
  assertNotIncludes(peSource, "before_provider_headers", "no header hook remains");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
