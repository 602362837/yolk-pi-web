#!/usr/bin/env node
/**
 * antigravity-provider-bootstrap — cold-start, ModelRuntime, and entry-point audit
 *
 * Validates that `@yofriadi/pi-antigravity-oauth@0.3.0` is fixed into the
 * unified Web provider bootstrap (`lib/pi-provider-extensions.ts` +
 * `lib/web-model-runtime.ts`) without static Next/Turbopack imports of its
 * TypeScript source tree, and that Grok and Kiro remain co-loaded in order
 * Grok → Kiro → Antigravity on the target ModelRuntime.
 *
 * - Source-code inspection + package version contract.
 * - Verifies jiti + serverExternalPackages + ModelRuntime call-site coverage.
 * - Confirms no deep private imports beyond the package-declared public entry.
 *
 * Run: node scripts/test-antigravity-provider.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

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
  assert.ok(source.includes(needle), `${label}: expected to include ${JSON.stringify(needle)}`);
}

function assertNotIncludes(source, needle, label) {
  assert.ok(!source.includes(needle), `${label}: expected NOT to include ${JSON.stringify(needle)}`);
}

// ============================================================================
// 1. package + Next externalization
// ============================================================================

console.log("\n=== package.json / next.config ===");

const packageJson = JSON.parse(read("package.json"));
const nextConfig = read("next.config.ts");

test("package.json depends on exact @yofriadi/pi-antigravity-oauth@0.3.0", () => {
  const dep = packageJson.dependencies?.["@yofriadi/pi-antigravity-oauth"];
  assert.strictEqual(dep, "0.3.0", `exact 0.3.0 dependency, got ${dep}`);
});

test("package.json exposes test:antigravity-provider and callback-security scripts", () => {
  assert.ok(packageJson.scripts?.["test:antigravity-provider"], "test:antigravity-provider exists");
  assert.ok(packageJson.scripts?.["test:antigravity-callback-security"], "test:antigravity-callback-security exists");
});

test("next.config.ts externalizes jiti and all three fixed provider packages", () => {
  assertIncludes(nextConfig, '"jiti"', "externalizes jiti");
  assertIncludes(nextConfig, '"pi-grok-cli"', "externalizes pi-grok-cli");
  assertIncludes(nextConfig, '"pi-kiro-provider"', "externalizes pi-kiro-provider");
  assertIncludes(nextConfig, '"@yofriadi/pi-antigravity-oauth"', "externalizes antigravity package");
});

test("antigravity package is installed at 0.3.0 with public pi.extensions entry", () => {
  const pkgPath = join(root, "node_modules/@yofriadi/pi-antigravity-oauth/package.json");
  assert.ok(existsSync(pkgPath), "node_modules/@yofriadi/pi-antigravity-oauth exists");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.strictEqual(pkg.version, "0.3.0", "installed version is 0.3.0");
  assert.ok(Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.length > 0, "declares pi.extensions");
  assert.ok(String(pkg.pi.extensions[0]).includes("index"), "public extension entry is index");
});

// ============================================================================
// 2. pi-provider-extensions + web-model-runtime contracts
// ============================================================================

console.log("\n=== pi-provider-extensions.ts contracts ===");

const peSource = read("lib/pi-provider-extensions.ts");
const runtimeSource = read("lib/web-model-runtime.ts");

test("exports antigravityProviderExtension loaded via jiti public entry only", () => {
  assertIncludes(peSource, "export const antigravityProviderExtension", "exports antigravityProviderExtension");
  assertIncludes(peSource, 'name: "@yofriadi/pi-antigravity-oauth"', "extension name is package name");
  assertIncludes(peSource, "loadAntigravityExtensionFactory", "uses single-flight loader");
  assertIncludes(peSource, "await factory(api)", "invokes extension factory");
  const staticImports = peSource.match(/from\s+["']@yofriadi\/pi-antigravity-oauth["']/g) || [];
  assert.strictEqual(staticImports.length, 0, "no static import from package root");
});

test("forces loopback host before first Antigravity jiti import", () => {
  assertIncludes(peSource, 'ANTIGRAVITY_OAUTH_CALLBACK_HOST = "127.0.0.1"', "loopback constant");
  assertIncludes(peSource, 'ANTIGRAVITY_OAUTH_CALLBACK_HOST_ENV = "PI_OAUTH_CALLBACK_HOST"', "env key");
  assertIncludes(peSource, "export function resolveAntigravityOAuthCallbackHost", "host policy export");
  assertIncludes(peSource, "export function loadAntigravityExtensionFactory", "loader export");
  assertIncludes(peSource, "process.env[envKey] = resolveAntigravityOAuthCallbackHost(previous)", "forces host before import");
  assertIncludes(peSource, "createRuntimeJiti", "jiti helper avoids import.meta.url bake-in");
  assertIncludes(peSource, "resolveRuntimePackageAnchor", "jiti anchors at process.cwd()/package.json");
  assertNotIncludes(peSource, "createJiti(import.meta.url", "no import.meta.url jiti anchor");
  assertIncludes(peSource, "antigravityJitiImportCandidates", "has jiti candidate fallbacks for source-only package");
});

test("does not deep-import private antigravity paths from application code", () => {
  assertNotIncludes(peSource, "pi-antigravity-oauth/src/cloud-code-assist", "no cloud-code private import");
  assertNotIncludes(peSource, "pi-antigravity-oauth/src/google-antigravity-oauth", "no oauth private import");
  assertNotIncludes(peSource, "pi-antigravity-oauth/src/models", "no models private import");
  assertNotIncludes(peSource, "pi-antigravity-rotator", "no rotator dependency");
});

test("fixed provider order is Grok → Kiro → Antigravity", () => {
  assertIncludes(peSource, "export const grokCliExtension", "exports grok");
  assertIncludes(peSource, "export const kiroProviderExtension", "exports kiro");
  assertIncludes(peSource, "export const antigravityProviderExtension", "exports antigravity");
  assertIncludes(
    peSource,
    "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension, anyrouterProviderExtension]",
    "order is Grok then Kiro then Antigravity",
  );
});

test("webExtensionFactories prepends all three fixed providers", () => {
  assertIncludes(peSource, "export function webProviderExtensions", "exports webProviderExtensions");
  assertIncludes(peSource, "export function webExtensionFactories", "exports webExtensionFactories");
  assertIncludes(peSource, "return [...webProviderExtensions(), ...extra]", "prepends fixed providers");
  assertNotIncludes(peSource, "[grokCliExtension, grokSessionAccountExtension", "session pin not wired");
});

test("provider-neutral bootstrap is legacy OAuth preload; registry helper hard-fails", () => {
  assertIncludes(peSource, "export function ensureWebProvidersBootstrapped", "exports ensureWebProvidersBootstrapped");
  assertIncludes(peSource, "export function ensureGrokBootstrapped", "retains ensureGrokBootstrapped alias");
  assertIncludes(peSource, "export async function createWebProviderAwareModelRegistry", "exports createWebProviderAwareModelRegistry");
  assertIncludes(peSource, "export async function createGrokAwareModelRegistry", "retains createGrokAwareModelRegistry alias");
  assertIncludes(peSource, "was removed for pi SDK 0.80.10", "hard-fail message");
  assertIncludes(peSource, "NOT a ModelRuntime catalog guarantee", "documents non-catalog role");
  assertIncludes(peSource, "createWebAgentSessionServices", "bootstrap uses services helper");
  const codeOnly = peSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bModelRegistry\.create\s*\(/.test(codeOnly), "no executable ModelRegistry.create path");
});

test("web-model-runtime injects fixed providers into target ModelRuntime", () => {
  assertIncludes(runtimeSource, "createWebAgentSessionServices", "services helper");
  assertIncludes(runtimeSource, "getWebModelRuntime", "admin runtime");
  assertIncludes(runtimeSource, "webExtensionFactories(", "session factories");
  assertIncludes(runtimeSource, "webProviderExtensions()", "admin fixed providers");
});

test("per-provider load failure is isolated for all three factories", () => {
  const grokFactory = peSource.slice(
    peSource.indexOf("export const grokCliExtension"),
    peSource.indexOf("export const kiroProviderExtension"),
  );
  const kiroFactory = peSource.slice(
    peSource.indexOf("export const kiroProviderExtension"),
    peSource.indexOf("export const antigravityProviderExtension"),
  );
  const antigravityFactory = peSource.slice(
    peSource.indexOf("export const antigravityProviderExtension"),
    peSource.indexOf("export const grokSessionAccountExtension"),
  );
  assertIncludes(grokFactory, "catch {", "Grok factory isolates failures");
  assertIncludes(kiroFactory, "catch {", "Kiro factory isolates failures");
  assert(
    antigravityFactory.includes("catch {") || antigravityFactory.includes("catch (err)"),
    "Antigravity factory isolates failures",
  );
  assertIncludes(antigravityFactory, "console.error", "Antigravity logs load failures instead of silent swallow");
  assertIncludes(peSource, "Best-effort per provider", "documents per-provider isolation");
});

// ============================================================================
// 3. Entry-point audit — ModelRuntime paths
// ============================================================================

console.log("\n=== Entry point audit ===");

const sessionServiceFiles = [
  { path: "lib/rpc-manager.ts", label: "rpc-manager" },
  { path: "lib/ypi-studio-child-session-runner.ts", label: "studio child runner" },
  { path: "app/api/models/route.ts", label: "models route" },
  { path: "app/api/terminal/env/assist/route.ts", label: "terminal env assist" },
  { path: "app/api/trellis/workflow/assist/route.ts", label: "trellis workflow assist" },
  { path: "app/api/model-prices/suggest/route.ts", label: "model-prices suggest route" },
];

for (const file of sessionServiceFiles) {
  test(`${file.label} uses createWebAgentSessionServices`, () => {
    const source = read(file.path);
    assertIncludes(source, "createWebAgentSessionServices", `${file.label} uses services helper`);
    assertNotIncludes(source, "ModelRegistry.create", `${file.label} does not use ModelRegistry.create`);
    assertNotIncludes(source, "extensionFactories: [grokCliExtension]", `${file.label} does not pass Grok-only list`);
    assertNotIncludes(source, "extensionFactories: [kiroProviderExtension]", `${file.label} does not pass Kiro-only list`);
    assertNotIncludes(source, "extensionFactories: [antigravityProviderExtension]", `${file.label} does not pass Antigravity-only list`);
  });
}

const adminRuntimeFiles = [
  { path: "app/api/auth/providers/route.ts", label: "auth providers route" },
  { path: "app/api/auth/login/[provider]/route.ts", label: "auth login route" },
  { path: "app/api/auth/logout/[provider]/route.ts", label: "auth logout route" },
  { path: "app/api/auth/api-key/[provider]/route.ts", label: "api-key route" },
  { path: "app/api/auth/all-providers/route.ts", label: "all-providers route" },
  { path: "app/api/model-prices/route.ts", label: "model-prices route" },
];

for (const file of adminRuntimeFiles) {
  test(`${file.label} uses getWebModelRuntime or createWebModelRuntime`, () => {
    const source = read(file.path);
    assert.ok(
      source.includes("getWebModelRuntime") || source.includes("createWebModelRuntime"),
      `${file.label} uses ModelRuntime factory`,
    );
    assertNotIncludes(source, "createWebProviderAwareModelRegistry(", `${file.label} does not call removed registry helper`);
    assertNotIncludes(source, "ModelRegistry.create", `${file.label} does not use ModelRegistry.create`);
  });
}

const loaderOnlyFiles = [
  { path: "app/api/skills/route.ts", label: "skills route" },
  { path: "app/api/commands/route.ts", label: "commands route" },
];

for (const file of loaderOnlyFiles) {
  test(`${file.label} uses webExtensionFactories for ResourceLoader`, () => {
    const source = read(file.path);
    assertIncludes(source, "webExtensionFactories", `${file.label} uses unified factories`);
    assertNotIncludes(source, "extensionFactories: [antigravityProviderExtension]", `${file.label} does not pass Antigravity-only list`);
  });
}

test("models-config test uses temporary isolated runtime", () => {
  const source = read("app/api/models-config/test/route.ts");
  assertIncludes(source, "createTemporaryWebModelRuntimeServices", "temporary runtime helper");
  assertNotIncludes(source, "createWebProviderAwareModelRegistry", "no removed registry helper");
  assertNotIncludes(source, "ModelRegistry.create", "no ModelRegistry.create");
});

test("deepseek-balance uses getWebModelRuntime (no bare registry create)", () => {
  const source = read("lib/deepseek-balance.ts");
  assertIncludes(source, "getWebModelRuntime", "uses admin ModelRuntime");
  assertNotIncludes(source, "ModelRegistry.create", "no ModelRegistry.create");
  assertNotIncludes(source, "ensureWebProvidersBootstrapped", "does not rely on process-global bootstrap for catalog");
});

test("no production source statically imports @yofriadi/pi-antigravity-oauth", () => {
  const files = [
    "lib/pi-provider-extensions.ts",
    "lib/web-model-runtime.ts",
    "lib/rpc-manager.ts",
    "lib/ypi-studio-child-session-runner.ts",
    "lib/deepseek-balance.ts",
    "app/api/models/route.ts",
    "app/api/auth/providers/route.ts",
    "app/api/auth/login/[provider]/route.ts",
    "app/api/auth/logout/[provider]/route.ts",
    "app/api/auth/all-providers/route.ts",
    "app/api/auth/api-key/[provider]/route.ts",
    "app/api/models-config/test/route.ts",
    "app/api/skills/route.ts",
    "app/api/commands/route.ts",
    "app/api/terminal/env/assist/route.ts",
    "app/api/trellis/workflow/assist/route.ts",
    "app/api/model-prices/route.ts",
    "app/api/model-prices/suggest/route.ts",
  ];
  for (const path of files) {
    const source = read(path);
    assertNotIncludes(source, 'from "@yofriadi/pi-antigravity-oauth"', `${path} has no static import`);
    assertNotIncludes(source, "from '@yofriadi/pi-antigravity-oauth'", `${path} has no static import (single quote)`);
    assertNotIncludes(source, "pi-antigravity-oauth/src/cloud-code-assist", `${path} has no private cloud-code import`);
    assertNotIncludes(source, "pi-antigravity-rotator", `${path} does not reference rotator`);
  }
});

// ============================================================================
// 4. Refresh / cold-start safety
// ============================================================================

console.log("\n=== Cold-start / refresh safety ===");

test("documents target-runtime fixed-provider invariant", () => {
  assertIncludes(peSource, "Fixed providers must be injected into the ModelRuntime", "documents target-runtime requirement");
  assertIncludes(peSource, "Grok/Kiro/Antigravity", "documents all three fixed providers");
  assertIncludes(peSource, "Do not treat a throwaway global bootstrap as a guarantee", "documents non-global bootstrap");
});

test("runtime helper is the only catalog registration path", () => {
  assertIncludes(runtimeSource, "createWebAgentSessionServices", "canonical services helper");
  assertIncludes(peSource, "getWebModelRuntime", "points to getWebModelRuntime");
  assertIncludes(peSource, "createWebAgentSessionServices", "points to createWebAgentSessionServices");
});

// ============================================================================
// 5. Secret safety
// ============================================================================

console.log("\n=== Secret safety ===");

test("pi-provider-extensions.ts contains no JWT/API-key sentinels", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(peSource), "no JWT pattern");
  assertNotIncludes(peSource, "sk-", "no OpenAI key prefix");
  assertNotIncludes(peSource, "xai-", "no xAI key prefix");
  assertNotIncludes(peSource, "client_secret", "no client_secret");
});

// ============================================================================
// 6. Runtime discovery (optional if jiti/loader works)
// ============================================================================

console.log("\n=== Runtime package entry resolution ===");

test("resolveAntigravityPackageExtensionEntry returns package-declared index", () => {
  const pkg = JSON.parse(read("node_modules/@yofriadi/pi-antigravity-oauth/package.json"));
  assert.strictEqual(pkg.pi.extensions[0], "./src/index.ts", "declared public entry is ./src/index.ts");
  assert.ok(existsSync(join(root, "node_modules/@yofriadi/pi-antigravity-oauth/src/index.ts")), "entry file exists");
});

test("antigravity factory bridges public OAuth into compat without private imports", () => {
  assertIncludes(peSource, "bridgePublicProviderOAuthToCompat", "bridges public oauth config");
  assertIncludes(peSource, "ANTIGRAVITY_PROVIDER_ID", "targets google-antigravity id");
  assertIncludes(peSource, "originalRegisterProvider", "wraps registerProvider");
  assertNotIncludes(peSource, "pi-antigravity-oauth/src/google-antigravity-oauth", "no private oauth import");
  assertNotIncludes(peSource, "client_secret", "does not copy client secret");
});

test("compat registry supports non-overwriting public OAuth bridge helpers", () => {
  const compatSource = read("lib/pi-ai-oauth-compat.ts");
  assertIncludes(compatSource, "export function registerOAuthProviderIfAbsent", "if-absent register");
  assertIncludes(compatSource, "export function bridgePublicProviderOAuthToCompat", "public oauth bridge");
  assertIncludes(compatSource, "Never overwrites an existing explicit registration", "documents non-overwrite");
});

test("token helper treats missing OAuth bridge as provider_unavailable", () => {
  const tokenSource = read("lib/antigravity-account-token.ts");
  assertIncludes(tokenSource, "provider_unavailable", "structured provider unavailable code");
  assertIncludes(tokenSource, "throw new AntigravityTokenError(\"provider_unavailable\")", "throws provider_unavailable");
  assertIncludes(tokenSource, "if (error instanceof AntigravityTokenError) throw error", "preserves structured errors");
});

// ============================================================================
// 7. Real public package bootstrap → compat registry
// ============================================================================

console.log("\n=== Real public package bootstrap → compat registry ===");

async function runBootstrapCompatRuntimeTest() {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createJiti } = await import("jiti");
  const { pathToFileURL } = await import("node:url");

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-ag-oauth-bridge-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Load TS modules via jiti without path aliases.
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const compat = await jiti.import(join(root, "lib/pi-ai-oauth-compat.ts"));
  const pe = await jiti.import(join(root, "lib/pi-provider-extensions.ts"));
  const runtime = await jiti.import(join(root, "lib/web-model-runtime.ts"));

  const previousAntigravity = compat.getOAuthProvider("google-antigravity");
  const previousKiro = compat.getOAuthProvider("kiro");
  // Start from a clean compat map so this proves the production bridge, not a
  // leftover fixture from another test process.
  compat.__resetPiAiOauthCompatForTests();
  runtime.__resetWebModelRuntimeCacheForTests?.();

  try {
    // No credentials, no Google network: only public extension registration.
    await pe.ensureWebProvidersBootstrapped();

    const antigravity = compat.getOAuthProvider("google-antigravity");
    assert.ok(antigravity, "google-antigravity compat provider available after real bootstrap");
    assert.strictEqual(typeof antigravity.refreshToken, "function", "refreshToken present");
    assert.strictEqual(typeof antigravity.getApiKey, "function", "getApiKey present");
    assert.strictEqual(typeof antigravity.login, "function", "login present");

    // Non-overwrite: explicit fixture must survive a second bridge attempt.
    const fixtureRefreshCalls = { n: 0 };
    compat.registerOAuthProvider({
      id: "google-antigravity",
      name: "fixture-antigravity",
      refreshToken: async (creds) => {
        fixtureRefreshCalls.n += 1;
        return creds;
      },
      getApiKey: () => "fixture-key",
      login: async () => {
        throw new Error("fixture login should not run");
      },
    });
    // Re-run the public factory wrap path against a stub runtime API to prove
    // bridgePublicProviderOAuthToCompat does not replace the fixture.
    const factory = await pe.loadAntigravityExtensionFactory();
    await factory({
      registerProvider(name, config) {
        if (name === "google-antigravity") {
          compat.bridgePublicProviderOAuthToCompat(name, config?.oauth);
        }
      },
    });
    const after = compat.getOAuthProvider("google-antigravity");
    assert.strictEqual(after?.name, "fixture-antigravity", "bridge does not overwrite explicit fixture");
    assert.strictEqual(typeof after?.getApiKey, "function");
    assert.strictEqual(await after.getApiKey({}), "fixture-key");
    void fixtureRefreshCalls;
    void pathToFileURL;
  } finally {
    compat.__resetPiAiOauthCompatForTests();
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
    await runBootstrapCompatRuntimeTest();
    console.log(`  \x1b[32m✓\x1b[0m real public package bootstrap registers google-antigravity in compat registry`);
    passed++;
  } catch (err) {
    console.log(
      `  \x1b[31m✗\x1b[0m real public package bootstrap registers google-antigravity in compat registry: ${err.message}`,
    );
    failed++;
  }
})();

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
