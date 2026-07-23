#!/usr/bin/env node
/**
 * kiro-provider-bootstrap — cold-start, ModelRuntime, and entry-point audit tests
 *
 * Validates that `pi-kiro-provider` is fixed into the unified Web provider
 * bootstrap (`lib/pi-provider-extensions.ts` + `lib/web-model-runtime.ts`)
 * without static Next/Turbopack imports of its TypeScript source tree, and that
 * Grok remains co-loaded on the *target* ModelRuntime.
 *
 * - Source-code inspection only — no pi SDK imports, no network, no real agent dir.
 * - Verifies jiti + serverExternalPackages + ModelRuntime call-site coverage.
 * - Confirms no deep imports of package private paths and no AuthStorage path.
 *
 * Run: node scripts/test-kiro-provider.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

test("package.json depends on pi-kiro-provider@0.2.2-compatible range", () => {
  const dep = packageJson.dependencies?.["pi-kiro-provider"];
  assert.ok(typeof dep === "string" && dep.length > 0, "pi-kiro-provider is a dependency");
  assert.ok(dep.includes("0.2.2") || dep === "^0.2.2" || dep.startsWith("^0.2."), `version range includes 0.2.x, got ${dep}`);
});

test("package.json exposes test:kiro-provider script", () => {
  assert.ok(packageJson.scripts?.["test:kiro-provider"], "test:kiro-provider script exists");
});

test("next.config.ts externalizes jiti, pi-grok-cli, pi-kiro-provider, and antigravity", () => {
  assertIncludes(nextConfig, '"jiti"', "externalizes jiti");
  assertIncludes(nextConfig, '"pi-grok-cli"', "externalizes pi-grok-cli");
  assertIncludes(nextConfig, '"pi-kiro-provider"', "externalizes pi-kiro-provider");
  assertIncludes(nextConfig, '"@yofriadi/pi-antigravity-oauth"', "externalizes antigravity package");
});

test("pi-kiro-provider is installed with TypeScript package entry", () => {
  const pkgPath = join(root, "node_modules/pi-kiro-provider/package.json");
  assert.ok(existsSync(pkgPath), "node_modules/pi-kiro-provider exists");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.strictEqual(pkg.version, "0.2.2", "installed version is 0.2.2");
  assert.ok(String(pkg.main || "").endsWith(".ts") || String(pkg.exports?.["."] || "").includes(".ts"), "package entry is TypeScript source");
});

// ============================================================================
// 2. pi-provider-extensions + web-model-runtime contracts
// ============================================================================

console.log("\n=== pi-provider-extensions.ts contracts ===");

const peSource = read("lib/pi-provider-extensions.ts");
const runtimeSource = read("lib/web-model-runtime.ts");

test("exports kiroProviderExtension loaded via jiti only", () => {
  assertIncludes(peSource, "export const kiroProviderExtension", "exports kiroProviderExtension");
  assertIncludes(peSource, 'name: "pi-kiro-provider"', "extension name is pi-kiro-provider");
  assertIncludes(peSource, 'import("pi-kiro-provider")', "loads pi-kiro-provider via jiti");
  assertIncludes(peSource, "await factory(api)", "invokes extension factory");
  const staticImports = peSource.match(/from\s+["']pi-kiro-provider["']/g) || [];
  assert.strictEqual(staticImports.length, 0, "no static import from pi-kiro-provider");
});

test("does not deep-import pi-kiro-provider private paths", () => {
  assertNotIncludes(peSource, "pi-kiro-provider/src", "no deep import of src");
  assertNotIncludes(peSource, "pi-kiro-provider/dist", "no deep import of dist");
});

test("Grok remains co-loaded with Kiro in fixed provider list", () => {
  assertIncludes(peSource, "export const grokCliExtension", "still exports grokCliExtension");
  assertIncludes(peSource, 'import("pi-grok-cli")', "still loads pi-grok-cli via jiti");
  assertIncludes(
    peSource,
    "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension, anyrouterProviderExtension]",
    "order is Grok then Kiro then Antigravity",
  );
});

test("webExtensionFactories prepends both fixed providers", () => {
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

test("per-provider load failure is isolated", () => {
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
  assert.ok(
    antigravityFactory.includes("catch {") || antigravityFactory.includes("catch (err)"),
    "Antigravity factory isolates failures",
  );
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
    assertNotIncludes(source, "extensionFactories: [grokCliExtension]", `${file.label} does not pass Grok-only list`);
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

test("no production source statically imports pi-kiro-provider", () => {
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
    assertNotIncludes(source, 'from "pi-kiro-provider"', `${path} has no static import`);
    assertNotIncludes(source, "from 'pi-kiro-provider'", `${path} has no static import (single quote)`);
    assertNotIncludes(source, "pi-kiro-provider/src", `${path} has no private src import`);
  }
});

// ============================================================================
// 4. Refresh / cold-start safety docs
// ============================================================================

console.log("\n=== Cold-start / refresh safety ===");

test("documents target-runtime fixed-provider invariant", () => {
  assertIncludes(peSource, "Fixed providers must be injected into the ModelRuntime", "documents target-runtime requirement");
  assertIncludes(peSource, "Grok/Kiro/Antigravity", "documents all three fixed providers");
  assertIncludes(peSource, "Do not treat a throwaway global bootstrap as a guarantee", "documents non-global bootstrap");
});

test("runtime helper is the only catalog registration path", () => {
  assertIncludes(runtimeSource, "createWebAgentSessionServices", "canonical services helper");
  assertIncludes(peSource, "Prefer", "documents prefer ModelRuntime helpers");
  assertIncludes(peSource, "getWebModelRuntime", "points to getWebModelRuntime");
});

// ============================================================================
// 5. Secret safety
// ============================================================================

console.log("\n=== Secret safety ===");

test("pi-provider-extensions.ts contains no JWT/API-key sentinels", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(peSource), "no JWT pattern");
  assertNotIncludes(peSource, "sk-", "no OpenAI key prefix");
  assertNotIncludes(peSource, "xai-", "no xAI key prefix");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
