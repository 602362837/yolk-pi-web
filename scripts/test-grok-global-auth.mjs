#!/usr/bin/env node
/**
 * Grok global Active auth contract — session pin retired, live reload path.
 *
 * Run: npm run test:grok-global-auth
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const extensions = read("lib/pi-provider-extensions.ts");
const rpc = read("lib/rpc-manager.ts");
const studio = read("lib/ypi-studio-child-session-runner.ts");
const types = read("lib/types.ts");
const session = read("lib/grok-session-account.ts");
const models = read("components/ModelsConfig.tsx");

console.log("\n=== pin retired from main inference ===");

test("webExtensionFactories only includes fixed providers without session pin", () => {
  assertIncludes(extensions, "return [...webProviderExtensions(), ...extra]", "factories without session pin");
  assertIncludes(extensions, "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension]", "fixed list is Grok then Kiro then Antigravity");
  assertNotIncludes(extensions, "return [grokCliExtension, grokSessionAccountExtension, ...extra]", "old pin wiring gone");
});

test("session pin extension no longer overrides Authorization", () => {
  assertIncludes(extensions, "Intentionally empty", "empty factory");
  assertNotIncludes(extensions, 'event.headers["authorization"]', "no auth override");
});

test("rpc-manager no longer binds/restores/unbinds Grok pin", () => {
  assertNotIncludes(rpc, "bindGrokSessionAccount", "no bind");
  assertNotIncludes(rpc, "restoreGrokSessionAccountBinding", "no restore");
  assertNotIncludes(rpc, "unbindGrokSessionAccount", "no unbind");
  assertNotIncludes(rpc, "getGrokSessionAccount", "no get binding");
  assertIncludes(rpc, "Grok session pin is retired", "documented retirement");
});

test("studio child runner no longer inherits pin", () => {
  assertNotIncludes(studio, "bindGrokSessionAccount", "no bind");
  assertNotIncludes(studio, "unbindGrokSessionAccount", "no unbind");
  assertNotIncludes(studio, "readGrokSessionAccountFromHeader", "no header inherit");
  assertIncludes(studio, "Grok session pin is retired", "documented");
});

test("historical header field remains parseable but deprecated", () => {
  assertIncludes(types, "grokAccountStorageId?: string", "field retained");
  assertIncludes(types, "@deprecated", "deprecated marker");
  assertIncludes(session, "getActiveGrokAccountId", "active helper kept");
  assertIncludes(session, "readGrokSessionAccountFromHeader", "header reader kept");
});

console.log("\n=== live reload / global Active ===");

test("reloadRpcAuthState refreshes same-identity model descriptor without setModel", () => {
  assertIncludes(rpc, "export function reloadRpcAuthState", "export");
  assertIncludes(rpc, "modelRegistry.refresh", "refresh");
  assertIncludes(rpc, "cleanupSessionResources", "cleanup");
  assertIncludes(rpc, "live.model = refreshed", "in-memory replace");
  // Ensure we do not call setModel inside reload (comments may mention setModel).
  const reloadStart = rpc.indexOf("export function reloadRpcAuthState");
  const reloadEnd = rpc.indexOf("export function destroyRpcSessionsForCwd");
  const body = rpc.slice(reloadStart, reloadEnd > 0 ? reloadEnd : reloadStart + 2000);
  const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bsetModel\s*\(/.test(codeOnly), "no setModel call in reload body");
  assert.ok(!/model_change/.test(codeOnly), "no model_change in reload code");
});

test("Models UI describes global Active, not session pin", () => {
  assertIncludes(models, "全局当前 Active", "global Active copy");
  assertIncludes(models, "不是锁定账号", "not lock");
  assertNotIncludes(models, "Session Pinning", "old pin copy removed");
  assertNotIncludes(models, "新建会话的默认账号", "old default-session-only copy removed");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
