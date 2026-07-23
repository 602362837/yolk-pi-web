#!/usr/bin/env node
/**
 * anyrouter-provider-bootstrap — cold-start / pin / patch / loader contract tests
 *
 * AR-01 focused suite:
 * - exact pi-anyrouter@0.3.2 pin + serverExternalPackages
 * - version/source-hash verified patch (fail closed on drift)
 * - jiti public entry via createRuntimeJiti (no static Next import)
 * - fixed provider order Grok → Kiro → Antigravity → AnyRouter
 * - per-provider failure isolation
 *
 * Source-contract checks do not call real AnyRouter. Optional install checks
 * require node_modules after `npm install`.
 *
 * Run: node scripts/test-anyrouter-provider.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PI_ANYROUTER_PACKAGE,
  PI_ANYROUTER_PATCHED_SHA256,
  PI_ANYROUTER_UNPATCHED_SHA256,
  PI_ANYROUTER_VERSION,
  inspectPiAnyrouterInstall,
} from "./verify-pi-anyrouter-patch.mjs";

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

console.log("\n=== package.json / next.config / patch provenance ===");

const packageJson = JSON.parse(read("package.json"));
const nextConfig = read("next.config.ts");
const peSource = read("lib/pi-provider-extensions.ts");
const runtimeSource = read("lib/web-model-runtime.ts");
const patchPath = join(root, "patches", `${PI_ANYROUTER_PACKAGE}+${PI_ANYROUTER_VERSION}.patch`);
const verifySource = read("scripts/verify-pi-anyrouter-patch.mjs");
const applySource = read("scripts/apply-pi-anyrouter-patch.mjs");

test("package.json exact-pins pi-anyrouter@0.3.2", () => {
  assert.strictEqual(
    packageJson.dependencies?.[PI_ANYROUTER_PACKAGE],
    PI_ANYROUTER_VERSION,
    "exact 0.3.2 dependency",
  );
});

test("package.json publishes patches + apply/verify scripts and postinstall hook", () => {
  assert.ok(Array.isArray(packageJson.files) && packageJson.files.includes("patches"), "files includes patches");
  assert.ok(packageJson.scripts?.["postinstall"]?.includes("apply-pi-anyrouter-patch"), "postinstall applies patch");
  assert.ok(packageJson.scripts?.["verify:pi-anyrouter-patch"], "verify script");
  assert.ok(packageJson.scripts?.["test:anyrouter-provider"], "test:anyrouter-provider script");
});

test("next.config.ts externalizes jiti + four fixed provider packages", () => {
  assertIncludes(nextConfig, '"jiti"', "externalizes jiti");
  assertIncludes(nextConfig, '"pi-grok-cli"', "externalizes pi-grok-cli");
  assertIncludes(nextConfig, '"pi-kiro-provider"', "externalizes pi-kiro-provider");
  assertIncludes(nextConfig, '"@yofriadi/pi-antigravity-oauth"', "externalizes antigravity");
  assertIncludes(nextConfig, '"pi-anyrouter"', "externalizes pi-anyrouter");
});

test("patch file + hash constants exist and fail closed on mismatch", () => {
  assert.ok(existsSync(patchPath), "patch file present");
  assertIncludes(verifySource, PI_ANYROUTER_UNPATCHED_SHA256, "pristine hash constant");
  assertIncludes(verifySource, PI_ANYROUTER_PATCHED_SHA256, "patched hash constant");
  assertIncludes(verifySource, "fail closed", "fail-closed wording");
  assertIncludes(applySource, "patch", "apply uses patch tool");
  assertIncludes(applySource, "assertPiAnyrouterPatched", "apply re-verifies");
});

console.log("\n=== pi-provider-extensions / web-model-runtime contracts ===");

test("exports anyrouterProviderExtension loaded via createRuntimeJiti only", () => {
  assertIncludes(peSource, "export const anyrouterProviderExtension", "exports anyrouterProviderExtension");
  assertIncludes(peSource, 'name: "pi-anyrouter"', "extension name is pi-anyrouter");
  assertIncludes(peSource, 'import("pi-anyrouter")', "loads public package entry via jiti");
  assertIncludes(peSource, "createRuntimeJiti", "uses createRuntimeJiti");
  assertIncludes(peSource, "resolveRuntimePackageAnchor", "anchors at process.cwd()/package.json");
  const staticImports = peSource.match(/from\s+["']pi-anyrouter["']/g) || [];
  assert.strictEqual(staticImports.length, 0, "no static import from pi-anyrouter");
  assertNotIncludes(peSource, "createJiti(import.meta.url", "no import.meta.url jiti anchor");
});

test("does not deep-import pi-anyrouter private paths", () => {
  assertNotIncludes(peSource, "pi-anyrouter/src", "no deep src import");
  assertNotIncludes(peSource, "pi-anyrouter/dist", "no deep dist import");
});

test("fixed provider order is Grok → Kiro → Antigravity → AnyRouter", () => {
  assertIncludes(peSource, "export const anyrouterProviderExtension", "exports AnyRouter extension");
  // Multi-line fixed list: Grok → Kiro → Antigravity → AnyRouter.
  const orderMatch = peSource.match(
    /export function webProviderExtensions\(\)[\s\S]*?return \[([\s\S]*?)\];/,
  );
  assert.ok(orderMatch, "webProviderExtensions return list present");
  const orderBody = orderMatch[1];
  const names = [...orderBody.matchAll(/([a-zA-Z0-9_]+Extension)/g)].map((m) => m[1]);
  assert.deepEqual(
    names,
    [
      "grokCliExtension",
      "kiroProviderExtension",
      "antigravityProviderExtension",
      "anyrouterProviderExtension",
    ],
    `order must be Grok→Kiro→Antigravity→AnyRouter, got ${names.join(",")}`,
  );
});

test("AnyRouter load failure is isolated and does not use AuthStorage/ModelRegistry.create", () => {
  assertIncludes(peSource, "failed to load anyrouter provider", "logs isolated failure");
  // Best-effort catch around the factory so other providers continue.
  const factoryIdx = peSource.indexOf("export const anyrouterProviderExtension");
  assert.ok(factoryIdx >= 0, "factory present");
  const slice = peSource.slice(factoryIdx, factoryIdx + 1800);
  assertIncludes(slice, "catch", "has failure isolation catch");
  const codeOnly = peSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bModelRegistry\.create\s*\(/.test(codeOnly), "no ModelRegistry.create");
  assert.ok(!/\bAuthStorage\b/.test(codeOnly), "no AuthStorage usage");
});

test("AnyRouter registration intercepts static apiKey so CredentialStore remains authoritative", () => {
  assertIncludes(peSource, 'name === "anyrouter"', "intercepts anyrouter registerProvider");
  assertIncludes(
    peSource,
    "ensureAnyRouterConfigEnvPointsAtBridge",
    "points PI_ANYROUTER_CC_CONFIG at the Web-managed runtime bridge before package import",
  );
  assertIncludes(
    peSource,
    "reconcileAnyRouterRuntimeMirrors",
    "cold-load reconciles Active bridge before package registration",
  );
  assertIncludes(peSource, "apiKey: undefined", "strips static register-time apiKey");
});

test("web-model-runtime documents / injects fixed providers including AnyRouter", () => {
  assertIncludes(runtimeSource, "webProviderExtensions()", "admin fixed providers");
  assertIncludes(runtimeSource, "webExtensionFactories", "session factories");
  assertIncludes(runtimeSource, "Grok → Kiro → Antigravity → AnyRouter", "order documented");
});

console.log("\n=== installed package (when present) ===");

const installed = existsSync(join(root, "node_modules", PI_ANYROUTER_PACKAGE, "package.json"));
if (!installed) {
  test("pi-anyrouter install check skipped (node_modules missing)", () => {
    assert.ok(true);
  });
} else {
  test("installed pi-anyrouter is 0.3.2 and patched", () => {
    const info = inspectPiAnyrouterInstall(root);
    assert.strictEqual(info.version, PI_ANYROUTER_VERSION);
    assert.strictEqual(info.state, "patched", `expected patched, got ${info.state} hash=${info.hash}`);
    assert.strictEqual(info.hash, PI_ANYROUTER_PATCHED_SHA256);
    assert.ok(info.hasWebManaged && info.hasAbortableDelay && info.hasSafeError && info.hasDeferredKey);
  });

  test("patched source still contains Claude/Codex protocol conversion markers", () => {
    const index = read(join("node_modules", PI_ANYROUTER_PACKAGE, "index.ts"));
    assertIncludes(index, "/v1/messages?beta=true", "Claude messages route");
    assertIncludes(index, "function convertMessages", "Claude convertMessages");
    assertIncludes(index, "function buildCodexRequestBody", "Codex body builder");
    assertIncludes(index, "function applyCodexSsePayload", "Codex SSE apply");
    assertIncludes(index, "getCodexResponsesUrl", "Codex URL helper");
    assertIncludes(index, "tryStreamAnyRouterCodex", "Codex stream path");
    assertIncludes(index, "tryStreamAnyRouterCc", "Claude stream path");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
