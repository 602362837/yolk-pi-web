#!/usr/bin/env node
/**
 * antigravity-provider-bootstrap — cold-start, registry, and entry-point audit
 *
 * Validates that `@yofriadi/pi-antigravity-oauth@0.3.0` is fixed into the
 * unified Web provider bootstrap (`lib/pi-provider-extensions.ts`) without
 * static Next/Turbopack imports of its TypeScript source tree, and that Grok
 * and Kiro remain co-loaded in order Grok → Kiro → Antigravity.
 *
 * - Source-code inspection + package version contract.
 * - Verifies jiti + serverExternalPackages + call-site coverage.
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
// 2. pi-provider-extensions contracts
// ============================================================================

console.log("\n=== pi-provider-extensions.ts contracts ===");

const peSource = read("lib/pi-provider-extensions.ts");

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
  assertIncludes(peSource, "createJiti(join(process.cwd(), \"package.json\"), { interopDefault: true })", "jiti anchored at app package root");
  assertIncludes(peSource, "antigravityJitiImportCandidates", "has jiti candidate fallbacks for source-only package");
});

test("does not deep-import private antigravity paths from application code", () => {
  // Loader may resolve the package-declared pi.extensions entry (./src/index.ts).
  // Application code must not hardcode private cloud-code / oauth modules.
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
    "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension]",
    "order is Grok then Kiro then Antigravity",
  );
});

test("webExtensionFactories prepends all three fixed providers", () => {
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
  // Antigravity logs the failure reason; still must isolate and not rethrow.
  assert(
    antigravityFactory.includes("catch {") || antigravityFactory.includes("catch (err)"),
    "Antigravity factory isolates failures",
  );
  assertIncludes(antigravityFactory, "console.error", "Antigravity logs load failures instead of silent swallow");
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
    assertNotIncludes(source, "extensionFactories: [kiroProviderExtension]", `${file.label} does not pass Kiro-only list`);
    assertNotIncludes(source, "extensionFactories: [antigravityProviderExtension]", `${file.label} does not pass Antigravity-only list`);
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

test("no production source statically imports @yofriadi/pi-antigravity-oauth", () => {
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

test("documents registry-reset risk for all three fixed providers", () => {
  assertIncludes(peSource, "registry-reset can remove grok-cli / kiro / google-antigravity", "documents three providers");
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
  assertNotIncludes(peSource, "client_secret", "no client_secret");
});

// ============================================================================
// 6. Runtime discovery (optional if jiti/loader works)
// ============================================================================

console.log("\n=== Runtime package entry resolution ===");

test("resolveAntigravityPackageExtensionEntry returns package-declared index", () => {
  // Dynamic import of the TS module via jiti is exercised by callback-security;
  // here we only assert the package contract the loader depends on.
  const pkg = JSON.parse(read("node_modules/@yofriadi/pi-antigravity-oauth/package.json"));
  assert.strictEqual(pkg.pi.extensions[0], "./src/index.ts", "declared public entry is ./src/index.ts");
  assert.ok(existsSync(join(root, "node_modules/@yofriadi/pi-antigravity-oauth/src/index.ts")), "entry file exists");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
