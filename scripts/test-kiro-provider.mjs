#!/usr/bin/env node
/**
 * kiro-provider-bootstrap — cold-start, registry, and entry-point audit tests
 *
 * Validates that `pi-kiro-provider` is fixed into the unified Web provider
 * bootstrap (`lib/pi-provider-extensions.ts`) without static Next/Turbopack
 * imports of its TypeScript source tree, and that Grok remains co-loaded.
 *
 * - Source-code inspection only — no pi SDK imports, no network, no real agent dir.
 * - Verifies jiti + serverExternalPackages + call-site coverage.
 * - Confirms no deep imports of package private paths.
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

test("next.config.ts externalizes jiti, pi-grok-cli, and pi-kiro-provider", () => {
  assertIncludes(nextConfig, '"jiti"', "externalizes jiti");
  assertIncludes(nextConfig, '"pi-grok-cli"', "externalizes pi-grok-cli");
  assertIncludes(nextConfig, '"pi-kiro-provider"', "externalizes pi-kiro-provider");
});

test("pi-kiro-provider is installed with TypeScript package entry", () => {
  const pkgPath = join(root, "node_modules/pi-kiro-provider/package.json");
  assert.ok(existsSync(pkgPath), "node_modules/pi-kiro-provider exists");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.strictEqual(pkg.version, "0.2.2", "installed version is 0.2.2");
  assert.ok(String(pkg.main || "").endsWith(".ts") || String(pkg.exports?.["."] || "").includes(".ts"), "package entry is TypeScript source");
});

// ============================================================================
// 2. pi-provider-extensions contracts
// ============================================================================

console.log("\n=== pi-provider-extensions.ts contracts ===");

const peSource = read("lib/pi-provider-extensions.ts");

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
  assertIncludes(peSource, "return [grokCliExtension, kiroProviderExtension]", "order is Grok then Kiro");
});

test("webExtensionFactories prepends both fixed providers", () => {
  assertIncludes(peSource, "export function webProviderExtensions", "exports webProviderExtensions");
  assertIncludes(peSource, "export function webExtensionFactories", "exports webExtensionFactories");
  assertIncludes(peSource, "return [...webProviderExtensions(), ...extra]", "prepends fixed providers");
  assertNotIncludes(peSource, "[grokCliExtension, grokSessionAccountExtension", "session pin not wired");
});

test("provider-neutral bootstrap helpers exist with Grok aliases", () => {
  assertIncludes(peSource, "export function ensureWebProvidersBootstrapped", "exports ensureWebProvidersBootstrapped");
  assertIncludes(peSource, "export function ensureGrokBootstrapped", "retains ensureGrokBootstrapped alias");
  assertIncludes(peSource, "export async function createWebProviderAwareModelRegistry", "exports createWebProviderAwareModelRegistry");
  assertIncludes(peSource, "export async function createGrokAwareModelRegistry", "retains createGrokAwareModelRegistry alias");
  assertIncludes(peSource, "await ensureWebProvidersBootstrapped()", "bootstraps before registry create");
  assertIncludes(peSource, "webProviderExtensions()", "bootstrap loads fixed provider list");
});

test("per-provider load failure is isolated", () => {
  // Each named extension factory must catch its own load errors.
  const grokFactory = peSource.slice(
    peSource.indexOf("export const grokCliExtension"),
    peSource.indexOf("export const kiroProviderExtension"),
  );
  const kiroFactory = peSource.slice(
    peSource.indexOf("export const kiroProviderExtension"),
    peSource.indexOf("export const grokSessionAccountExtension"),
  );
  assertIncludes(grokFactory, "catch {", "Grok factory isolates failures");
  assertIncludes(kiroFactory, "catch {", "Kiro factory isolates failures");
  assertIncludes(peSource, "Best-effort per provider", "documents per-provider isolation");
});

// ============================================================================
// 3. Entry-point audit — every boot path uses unified factories
// ============================================================================

console.log("\n=== Entry point audit ===");

const unifiedFactoryFiles = [
  { path: "lib/rpc-manager.ts", label: "rpc-manager" },
  { path: "lib/ypi-studio-child-session-runner.ts", label: "studio child runner" },
  { path: "app/api/models/route.ts", label: "models route" },
  { path: "app/api/auth/providers/route.ts", label: "auth providers route" },
  { path: "app/api/auth/login/[provider]/route.ts", label: "auth login route" },
  { path: "app/api/auth/logout/[provider]/route.ts", label: "auth logout route" },
  { path: "app/api/skills/route.ts", label: "skills route" },
  { path: "app/api/commands/route.ts", label: "commands route" },
  { path: "app/api/terminal/env/assist/route.ts", label: "terminal env assist" },
  { path: "app/api/trellis/workflow/assist/route.ts", label: "trellis workflow assist" },
  { path: "app/api/model-prices/route.ts", label: "model-prices route" },
  { path: "app/api/model-prices/suggest/route.ts", label: "model-prices suggest route" },
];

for (const file of unifiedFactoryFiles) {
  test(`${file.label} uses webExtensionFactories`, () => {
    const source = read(file.path);
    assertIncludes(source, "webExtensionFactories", `${file.label} uses unified factories`);
    assertNotIncludes(source, "extensionFactories: [grokCliExtension]", `${file.label} does not pass Grok-only list`);
  });
}

const registryHelperFiles = [
  { path: "app/api/auth/api-key/[provider]/route.ts", label: "api-key route" },
  { path: "app/api/auth/all-providers/route.ts", label: "all-providers route" },
  { path: "app/api/models-config/test/route.ts", label: "models-config test route" },
];

for (const file of registryHelperFiles) {
  test(`${file.label} uses createWebProviderAwareModelRegistry`, () => {
    const source = read(file.path);
    assertIncludes(source, "createWebProviderAwareModelRegistry", `${file.label} uses provider-aware registry`);
  });
}

test("deepseek-balance bootstraps fixed providers before bare registry create", () => {
  const source = read("lib/deepseek-balance.ts");
  assertIncludes(source, "ensureWebProvidersBootstrapped", "uses provider-neutral bootstrap");
  assertIncludes(source, "ModelRegistry.create", "creates registry after bootstrap");
});

test("no production source statically imports pi-kiro-provider", () => {
  const files = [
    "lib/pi-provider-extensions.ts",
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

test("documents registry-reset risk for both fixed providers", () => {
  assertIncludes(peSource, "registry-reset can remove grok-cli / kiro", "documents both providers");
  assertIncludes(peSource, "must be fed", "documents requirement");
});

test("createWebProviderAwareModelRegistry bootstraps before ModelRegistry.create", () => {
  const fnStart = peSource.indexOf("export async function createWebProviderAwareModelRegistry");
  const fnBody = peSource.slice(fnStart);
  const ensureCall = fnBody.indexOf("await ensureWebProvidersBootstrapped()");
  const createCall = fnBody.indexOf("ModelRegistry.create(");
  assert.ok(ensureCall > 0 && createCall > 0 && ensureCall < createCall, "bootstrap runs before registry create");
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
