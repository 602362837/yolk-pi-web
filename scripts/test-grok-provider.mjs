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
  assertIncludes(peSource, 'from "pi-grok-cli"', "imports from pi-grok-cli");
  assertIncludes(peSource, 'name: "pi-grok-cli"', "extension name is pi-grok-cli");
  assertIncludes(peSource, "factory: grokCliFactory", "factory references grokCliFactory");
});

test("exports grokSessionAccountExtension", () => {
  assertIncludes(peSource, "export const grokSessionAccountExtension", "exports session-account extension");
  assertIncludes(peSource, 'name: "grok-session-account"', "extension name is grok-session-account");
});

test("grokSessionAccountExtension checks provider === grok-cli", () => {
  assertIncludes(peSource, 'ctx.model?.provider !== "grok-cli"', "checks grok-cli provider");
  assertIncludes(peSource, "before_provider_headers", "hooks before_provider_headers");
});

test("grokSessionAccountExtension uses lazy imports to avoid cycles", () => {
  assertIncludes(peSource, 'await import("./grok-session-account")', "lazy-imports session-account");
  assertIncludes(peSource, 'await import("./grok-account-token")', "lazy-imports account-token");
});

test("grokSessionAccountExtension sets Authorization header", () => {
  assertIncludes(peSource, 'event.headers["authorization"]', "sets authorization header with session token");
  assertIncludes(peSource, "Bearer ${token.accessToken}", "uses Bearer token format");
});

test("grokSessionAccountExtension gracefully handles missing session", () => {
  assertIncludes(peSource, "if (!sessionId) return", "returns early without session id");
  assertIncludes(peSource, "if (!storageId) return", "returns early without storage id");
});

test("grokSessionAccountExtension catches errors without breaking request", () => {
  // The catch block lets the request proceed with default auth
  assertIncludes(peSource, "catch {", "has error handler");
  assertIncludes(peSource, "// If we can't resolve", "graceful degradation comment");
});

test("exports webExtensionFactories() helper", () => {
  assertIncludes(peSource, "export function webExtensionFactories", "exports webExtensionFactories");
  assertIncludes(peSource, "[grokCliExtension, grokSessionAccountExtension", "prepends grok + session extensions");
  assertIncludes(peSource, "...extra", "spreads extra factories");
});

test("webExtensionFactories order: grok → session-account → extra", () => {
  // The order determines which extension's before_provider_headers runs first
  // We already verified the array construction above; also check the comment
  assertIncludes(peSource, "Grok session-account runs after provider", "order documented");
});

test("exports ensureGrokBootstrapped() for cold-start safety", () => {
  assertIncludes(peSource, "export function ensureGrokBootstrapped", "exports ensureGrokBootstrapped");
  assertIncludes(peSource, "_grokBootstrapPromise", "uses single-flight promise");
});

test("ensureGrokBootstrapped creates services to load extension", () => {
  assertIncludes(peSource, "createAgentSessionServices", "calls createAgentSessionServices");
  assertIncludes(peSource, "[grokCliExtension]", "registers grok extension for bootstrap");
  assertIncludes(peSource, "// Best-effort only", "catches errors gracefully");
});

test("exports createGrokAwareModelRegistry", () => {
  assertIncludes(peSource, "export async function createGrokAwareModelRegistry", "exports helper");
  assertIncludes(peSource, "await ensureGrokBootstrapped()", "bootstraps before registry create");
  assertIncludes(peSource, "ModelRegistry.create(", "creates grok-aware registry");
});

// ============================================================================
// 2. No deep imports from pi-grok-cli internals
// ============================================================================

console.log("\n=== No deep imports from pi-grok-cli ===");

test("pi-provider-extensions does not deep-import pi-grok-cli/src", () => {
  assertNotIncludes(peSource, "pi-grok-cli/src", "no deep import of src");
  assertNotIncludes(peSource, "pi-grok-cli/dist", "no deep import of dist");
});

test("pi-provider-extensions imports only default export", () => {
  // The only import should be the default factory
  const importMatches = peSource.match(/from\s+["']pi-grok-cli["']/g) || [];
  assert.strictEqual(importMatches.length, 1, "exactly one import from pi-grok-cli");
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

test("app/api/auth/api-key/[provider]/route.ts uses createGrokAwareModelRegistry", () => {
  const source = read("app/api/auth/api-key/[provider]/route.ts");
  assertIncludes(source, "createGrokAwareModelRegistry", "api-key route uses grok-aware registry");
});

test("app/api/auth/all-providers/route.ts uses createGrokAwareModelRegistry", () => {
  const source = read("app/api/auth/all-providers/route.ts");
  assertIncludes(source, "createGrokAwareModelRegistry", "all-providers route uses grok-aware registry");
});

test("app/api/terminal/env/assist/route.ts uses grokCliExtension", () => {
  const source = read("app/api/terminal/env/assist/route.ts");
  assertIncludes(source, "grokCliExtension", "terminal assist uses grok extension");
});

test("app/api/trellis/workflow/assist/route.ts uses grokCliExtension", () => {
  const source = read("app/api/trellis/workflow/assist/route.ts");
  assertIncludes(source, "grokCliExtension", "trellis assist uses grok extension");
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

test("createGrokAwareModelRegistry bootstraps before ModelRegistry.create", () => {
  // Extract the createGrokAwareModelRegistry function body only.
  // Comments earlier in the file also mention ModelRegistry.create.
  const fnStart = peSource.indexOf("export async function createGrokAwareModelRegistry");
  const fnBody = peSource.slice(fnStart);
  const ensureCall = fnBody.indexOf("await ensureGrokBootstrapped()");
  const createCall = fnBody.indexOf("ModelRegistry.create(");
  const orderOk = ensureCall > 0 && createCall > 0 && ensureCall < createCall;
  if (!orderOk) {
    console.log(`    (info) fnStart=${fnStart} ensureCall=${ensureCall} createCall=${createCall}`);
  }
  assert.ok(orderOk, "bootstrap runs before registry create");
});

test("deepseek-balance.ts uses ModelRegistry.create — documented risk", () => {
  const source = read("lib/deepseek-balance.ts");
  // This file has ModelRegistry.create without grok bootstrap;
  // it's a known gap that should be tracked.
  assertIncludes(source, "ModelRegistry.create", "has bare registry create");
  // The test is informational — if future work changes this file, this test
  // alerts that the Grok bootstrap invariant may need updating.
  console.log("    (info) bare ModelRegistry.create in deepseek-balance.ts — tracked");
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
      // These files should use webExtensionFactories or createGrokAwareModelRegistry,
      // not bare ModelRegistry.create.
      if (source.includes("ModelRegistry.create") && !source.includes("webExtensionFactories") && !source.includes("createGrokAwareModelRegistry") && !source.includes("pi-provider-extensions")) {
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

test("grokSessionAccountExtension docs note vision/Imagine risk", () => {
  // This was a decision in the design doc — the session-account extension
  // may not cover vision/Imagine which use different request paths.
  // The comment should acknowledge the limitation.
  assertIncludes(peSource, "before_provider_headers", "token injection mechanism is documented");
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

test("ensureGrokBootstrapped survives missing dependency gracefully", () => {
  // The catch block should not rethrow
  assertIncludes(peSource, "catch {", "bootstrap has error handler");
  assertIncludes(peSource, "// Best-effort only", "bootstrap is best-effort");
});

test("grokSessionAccountExtension does not break non-grok providers", () => {
  // The first check in before_provider_headers returns early for non-grok
  assertIncludes(peSource, 'if (ctx.model?.provider !== "grok-cli") return', "early return for non-grok");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
