#!/usr/bin/env node
/**
 * grok-provider-bootstrap — cold-start, ModelRuntime, and entry-point audit tests
 *
 * Validates that the unified provider extension system (`lib/pi-provider-extensions.ts`)
 * and provider-aware ModelRuntime helpers (`lib/web-model-runtime.ts`) are correctly
 * wired into every Web boot path and that the Grok extension factories meet
 * security / isolation / correctness contracts for pi SDK 0.80.10+.
 *
 * - Source-code inspection only — no pi SDK imports, no network, no real agent dir.
 * - Verifies catalog/request paths use createWebAgentSessionServices / getWebModelRuntime.
 * - Rejects regressions to AuthStorage / ModelRegistry.create / old services fields.
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
const runtimeSource = read("lib/web-model-runtime.ts");

test("exports grokCliExtension with factory from pi-grok-cli", () => {
  assertIncludes(peSource, "export const grokCliExtension", "exports grokCliExtension");
  assertIncludes(peSource, 'import("pi-grok-cli")', "loads pi-grok-cli via jiti");
  assertIncludes(peSource, 'name: "pi-grok-cli"', "extension name is pi-grok-cli");
  assertIncludes(peSource, "await factory(api)", "invokes extension factory");
});

test("grok factory bridges public OAuth into compat without private imports", () => {
  assertIncludes(peSource, "bridgePublicProviderOAuthToCompat", "bridges public oauth config");
  assertIncludes(peSource, "GROK_CLI_PROVIDER_ID", "targets grok-cli id");
  assertIncludes(peSource, "originalRegisterProvider", "wraps registerProvider");
  assertNotIncludes(peSource, "pi-grok-cli/src", "no private package import");
  assertNotIncludes(peSource, "client_secret", "does not copy client secret");
  assertNotIncludes(peSource, "clientSecret", "does not copy client secret camelCase");
});

test("compat registry supports non-overwriting public OAuth bridge helpers", () => {
  const compatSource = read("lib/pi-ai-oauth-compat.ts");
  assertIncludes(compatSource, "export function registerOAuthProviderIfAbsent", "if-absent register");
  assertIncludes(compatSource, "export function bridgePublicProviderOAuthToCompat", "public oauth bridge");
  assertIncludes(compatSource, "Never overwrites an existing explicit registration", "documents non-overwrite");
});

test("token helper treats missing OAuth bridge as provider_unavailable", () => {
  const tokenSource = read("lib/grok-account-token.ts");
  assertIncludes(tokenSource, "provider_unavailable", "structured provider unavailable code");
  assertIncludes(tokenSource, 'throw new GrokTokenError("provider_unavailable")', "throws provider_unavailable");
  assertIncludes(tokenSource, "export class GrokTokenError", "exports GrokTokenError");
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
  assertIncludes(
    peSource,
    "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension]",
    "fixed list is Grok then Kiro then Antigravity",
  );
  assertNotIncludes(peSource, "[grokCliExtension, grokSessionAccountExtension", "session pin not wired");
});

test("webExtensionFactories documents global Active auth path", () => {
  assertIncludes(peSource, "global Active account from auth.json", "global Active documented");
  assertIncludes(peSource, "Main inference no longer injects a session-bound Authorization header", "pin retired documented");
});

test("exports ensureWebProvidersBootstrapped() as legacy OAuth preload only", () => {
  assertIncludes(peSource, "export function ensureWebProvidersBootstrapped", "exports ensureWebProvidersBootstrapped");
  assertIncludes(peSource, "export function ensureGrokBootstrapped", "retains ensureGrokBootstrapped alias");
  assertIncludes(peSource, "_webProvidersBootstrapPromise", "uses single-flight promise");
  assertIncludes(peSource, "NOT a ModelRuntime catalog guarantee", "documents non-catalog role");
  assertIncludes(peSource, "createWebAgentSessionServices", "bootstrap uses services helper");
  assertIncludes(peSource, "// Best-effort only", "catches errors gracefully");
});

test("createWebProviderAwareModelRegistry is a hard-fail migration stub", () => {
  assertIncludes(peSource, "export async function createWebProviderAwareModelRegistry", "exports helper");
  assertIncludes(peSource, "export async function createGrokAwareModelRegistry", "retains createGrokAwareModelRegistry alias");
  assertIncludes(peSource, "was removed for pi SDK 0.80.10", "hard-fail message");
  assertIncludes(peSource, "use getWebModelRuntime()", "points to ModelRuntime");
  // Comments may mention the removed API; executable ModelRegistry.create calls must not remain.
  const codeOnly = peSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bModelRegistry\.create\s*\(/.test(codeOnly), "no executable ModelRegistry.create path remains");
});

test("web-model-runtime registers fixed providers on the target runtime", () => {
  assertIncludes(runtimeSource, "export async function createWebModelRuntime", "createWebModelRuntime");
  assertIncludes(runtimeSource, "export async function getWebModelRuntime", "getWebModelRuntime");
  assertIncludes(runtimeSource, "export async function createWebAgentSessionServices", "createWebAgentSessionServices");
  assertIncludes(runtimeSource, "webExtensionFactories(", "services helper feeds factories");
  assertIncludes(runtimeSource, "webProviderExtensions()", "admin runtime uses fixed providers");
  assertIncludes(runtimeSource, "createAgentSessionServices", "SDK services entry");
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
// 3. Entry point audit — every catalog/request path uses ModelRuntime helpers
// ============================================================================

console.log("\n=== Entry point audit (ModelRuntime) ===");

const sessionServiceFiles = [
  { path: "lib/rpc-manager.ts", label: "rpc-manager" },
  { path: "lib/ypi-studio-child-session-runner.ts", label: "studio child runner" },
  { path: "app/api/models/route.ts", label: "models route" },
  { path: "app/api/terminal/env/assist/route.ts", label: "terminal assist" },
  { path: "app/api/trellis/workflow/assist/route.ts", label: "trellis assist" },
  { path: "app/api/model-prices/suggest/route.ts", label: "model-prices suggest" },
];

for (const file of sessionServiceFiles) {
  test(`${file.label} uses createWebAgentSessionServices`, () => {
    const source = read(file.path);
    assertIncludes(source, "createWebAgentSessionServices", `${file.label} uses services helper`);
    assertNotIncludes(source, "ModelRegistry.create", `${file.label} does not use ModelRegistry.create`);
    assertNotIncludes(source, "services.modelRegistry", `${file.label} does not use services.modelRegistry`);
  });
}

const adminRuntimeFiles = [
  { path: "app/api/auth/providers/route.ts", label: "auth providers route" },
  { path: "app/api/auth/logout/[provider]/route.ts", label: "auth logout route" },
  { path: "app/api/auth/api-key/[provider]/route.ts", label: "api-key route" },
  { path: "app/api/auth/all-providers/route.ts", label: "all-providers route" },
  { path: "app/api/model-prices/route.ts", label: "model-prices route" },
  { path: "lib/deepseek-balance.ts", label: "deepseek-balance" },
];

for (const file of adminRuntimeFiles) {
  test(`${file.label} uses getWebModelRuntime`, () => {
    const source = read(file.path);
    assertIncludes(source, "getWebModelRuntime", `${file.label} uses getWebModelRuntime`);
    assertNotIncludes(source, "ModelRegistry.create", `${file.label} does not use ModelRegistry.create`);
    assertNotIncludes(source, "createWebProviderAwareModelRegistry(", `${file.label} does not call removed registry helper`);
  });
}

test("auth login route uses ModelRuntime login + isolated add-account store", () => {
  const source = read("app/api/auth/login/[provider]/route.ts");
  assertIncludes(source, "getWebModelRuntime", "normal login uses admin runtime");
  assertIncludes(source, "createWebModelRuntime", "add-account uses isolated runtime");
  assertIncludes(source, "createInMemoryWebCredentialStore", "add-account uses memory credential store");
  assertIncludes(source, "createWebAgentSessionServices", "add-account registers fixed providers on target runtime");
  assertIncludes(source, "runtime.login(provider, \"oauth\"", "uses ModelRuntime.login");
  assertNotIncludes(source, "ModelRegistry.create", "no ModelRegistry.create");
  assertNotIncludes(source, "AuthStorage", "no AuthStorage");
});

test("models-config test uses temporary isolated runtime", () => {
  const source = read("app/api/models-config/test/route.ts");
  assertIncludes(source, "createTemporaryWebModelRuntimeServices", "temporary runtime helper");
  assertIncludes(source, "services.modelRuntime", "uses modelRuntime");
  assertNotIncludes(source, "createWebProviderAwareModelRegistry", "no removed registry helper");
  assertNotIncludes(source, "ModelRegistry.create", "no ModelRegistry.create");
});

test("skills/commands still use webExtensionFactories for ResourceLoader only", () => {
  const skills = read("app/api/skills/route.ts");
  const commands = read("app/api/commands/route.ts");
  assertIncludes(skills, "webExtensionFactories", "skills uses factories for loader");
  assertIncludes(commands, "webExtensionFactories", "commands uses factories for loader");
  assertNotIncludes(skills, "ModelRegistry.create", "skills no ModelRegistry.create");
  assertNotIncludes(commands, "ModelRegistry.create", "commands no ModelRegistry.create");
});

// ============================================================================
// 4. Stale-API negative audit
// ============================================================================

console.log("\n=== Stale AuthStorage / ModelRegistry contract ===");

test("application runtime code has no AuthStorage import from coding-agent root", () => {
  const files = [
    "lib/rpc-manager.ts",
    "lib/ypi-studio-child-session-runner.ts",
    "lib/oauth-accounts.ts",
    "lib/api-key-accounts.ts",
    "lib/deepseek-balance.ts",
    "lib/web-model-runtime.ts",
    "lib/web-credential-store.ts",
    "app/api/models/route.ts",
    "app/api/auth/providers/route.ts",
    "app/api/auth/login/[provider]/route.ts",
    "app/api/auth/logout/[provider]/route.ts",
    "app/api/auth/api-key/[provider]/route.ts",
    "app/api/auth/all-providers/route.ts",
  ];
  for (const path of files) {
    const source = read(path);
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.ok(
      !/import\s*\{[^}]*\bAuthStorage\b[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/.test(source),
      `${path} must not import AuthStorage from coding-agent root`,
    );
    assert.ok(!/\bModelRegistry\.create\s*\(/.test(codeOnly), `${path} must not call ModelRegistry.create`);
    assert.ok(!/\bservices\.authStorage\b/.test(codeOnly), `${path} must not use services.authStorage`);
    assert.ok(!/\bservices\.modelRegistry\b/.test(codeOnly), `${path} must not use services.modelRegistry`);
    assert.ok(!/\binner\.modelRegistry\b/.test(codeOnly), `${path} must not use inner.modelRegistry`);
  }
});

test("rpc-manager and studio child use services.modelRuntime", () => {
  const rpc = read("lib/rpc-manager.ts");
  const studio = read("lib/ypi-studio-child-session-runner.ts");
  assertIncludes(rpc, "createWebAgentSessionServices", "rpc services helper");
  assertIncludes(rpc, "modelRuntime", "rpc modelRuntime");
  assertIncludes(studio, "createWebAgentSessionServices", "studio services helper");
  assertIncludes(studio, "services.modelRuntime", "studio modelRuntime");
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
  assertIncludes(peSource, "catch {", "bootstrap has error handler");
  assertIncludes(peSource, "// Best-effort only", "bootstrap is best-effort");
});

test("retired pin extension is a no-op factory and cannot break non-grok providers", () => {
  assertIncludes(peSource, "Intentionally empty", "empty factory");
  assertNotIncludes(peSource, "before_provider_headers", "no header hook remains");
});

// ==============================================================================
// 9. Real public package bootstrap → compat registry
// ==============================================================================

console.log("\n=== Real public package bootstrap → compat registry ===");

async function runGrokBootstrapCompatRuntimeTest() {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createJiti } = await import("jiti");

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-oauth-bridge-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Load TS modules via jiti without path aliases.
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const compat = await jiti.import(join(root, "lib/pi-ai-oauth-compat.ts"));
  const pe = await jiti.import(join(root, "lib/pi-provider-extensions.ts"));
  const runtime = await jiti.import(join(root, "lib/web-model-runtime.ts"));

  const previousGrok = compat.getOAuthProvider("grok-cli");
  const previousAntigravity = compat.getOAuthProvider("google-antigravity");
  const previousKiro = compat.getOAuthProvider("kiro");
  // Start from a clean compat map so this proves the production bridge, not a
  // leftover fixture from another test process.
  compat.__resetPiAiOauthCompatForTests();
  runtime.__resetWebModelRuntimeCacheForTests?.();

  try {
    // No credentials, no xAI network: only public extension registration.
    // Do not pre-register a grok-cli fixture before bootstrap.
    await pe.ensureWebProvidersBootstrapped();

    const grok = compat.getOAuthProvider("grok-cli");
    assert.ok(grok, "grok-cli compat provider available after real bootstrap");
    assert.strictEqual(typeof grok.refreshToken, "function", "refreshToken present");
    assert.strictEqual(typeof grok.getApiKey, "function", "getApiKey present");
    assert.strictEqual(typeof grok.login, "function", "login present");

    // Non-overwrite: explicit fixture must survive a second bridge attempt.
    const fixtureRefreshCalls = { n: 0 };
    compat.registerOAuthProvider({
      id: "grok-cli",
      name: "fixture-grok",
      refreshToken: async (creds) => {
        fixtureRefreshCalls.n += 1;
        return creds;
      },
      getApiKey: () => "fixture-key",
      login: async () => {
        throw new Error("fixture login should not run");
      },
    });

    // Re-run only the public oauth projection path to prove if-absent semantics.
    const bridged = compat.bridgePublicProviderOAuthToCompat("grok-cli", {
      name: "public-package-grok",
      refreshToken: async (creds) => creds,
      getApiKey: () => "public-key",
      login: async () => {
        throw new Error("public login should not run");
      },
    });
    assert.strictEqual(bridged, false, "bridge reports no overwrite when fixture exists");

    const after = compat.getOAuthProvider("grok-cli");
    assert.strictEqual(after?.name, "fixture-grok", "bridge does not overwrite explicit fixture");
    assert.strictEqual(typeof after?.getApiKey, "function");
    assert.strictEqual(await after.getApiKey({}), "fixture-key");
    void fixtureRefreshCalls;
  } finally {
    compat.__resetPiAiOauthCompatForTests();
    if (previousGrok) compat.registerOAuthProvider(previousGrok);
    if (previousAntigravity) compat.registerOAuthProvider(previousAntigravity);
    if (previousKiro) compat.registerOAuthProvider(previousKiro);
    runtime.__resetWebModelRuntimeCacheForTests?.();
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

await (async () => {
  try {
    await runGrokBootstrapCompatRuntimeTest();
    console.log(`  \x1b[32m✓\x1b[0m real public package bootstrap registers grok-cli in compat registry`);
    passed++;
  } catch (err) {
    console.log(
      `  \x1b[31m✗\x1b[0m real public package bootstrap registers grok-cli in compat registry: ${err.message}`,
    );
    failed++;
  }
})();

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
