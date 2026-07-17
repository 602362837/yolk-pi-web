#!/usr/bin/env node
/**
 * antigravity-model-quota — fixed 0.3.0 public-model ↔ quota-key contract tests
 *
 * Verifies:
 * 1. Every 0.3.0 catalog public model id is present in the fixed table
 * 2. Accepted keys cover package request-time routing ids
 * 3. Unknown / unmapped models fail closed for failover
 * 4. Other-model quota keys do not prove current-model usability
 * 5. No runtime private import of package src/**
 *
 * Run: npm run test:antigravity-model-quota
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
  assert.ok(source.includes(needle), `${label}: expected to include "${needle}"`);
}

function assertNotIncludes(source, needle, label) {
  assert.ok(!source.includes(needle), `${label}: expected NOT to include "${needle}"`);
}

// ─── Inline mirrors of production mapping (must stay in sync with source) ────

const ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0 = [
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro",
  "gemini-3.5-flash",
  "gpt-oss-120b",
  "tab_flash_lite_preview",
  "tab_jump_flash_lite_preview",
];

const TABLE = [
  {
    id: "claude-opus-4-5",
    acceptedQuotaKeys: ["claude-opus-4-5", "claude-opus-4-5-thinking"],
    failoverSupported: true,
  },
  {
    id: "claude-opus-4-6",
    acceptedQuotaKeys: ["claude-opus-4-6", "claude-opus-4-6-thinking"],
    failoverSupported: true,
  },
  {
    id: "claude-sonnet-4-5",
    acceptedQuotaKeys: ["claude-sonnet-4-5", "claude-sonnet-4-5-thinking"],
    failoverSupported: true,
  },
  {
    id: "claude-sonnet-4-6",
    acceptedQuotaKeys: ["claude-sonnet-4-6"],
    failoverSupported: true,
  },
  {
    id: "gemini-2.5-flash",
    acceptedQuotaKeys: ["gemini-2.5-flash", "gemini-2.5-flash-thinking"],
    failoverSupported: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    acceptedQuotaKeys: ["gemini-2.5-flash-lite"],
    failoverSupported: true,
  },
  {
    id: "gemini-2.5-pro",
    acceptedQuotaKeys: ["gemini-2.5-pro"],
    failoverSupported: true,
  },
  {
    id: "gemini-3-flash",
    acceptedQuotaKeys: [
      "gemini-3-flash",
      "gemini-3-flash-agent",
      "gemini-3.5-flash-extra-low",
      "gemini-3.5-flash-low",
    ],
    failoverSupported: true,
  },
  {
    id: "gemini-3-pro",
    acceptedQuotaKeys: ["gemini-3-pro", "gemini-3-pro-low", "gemini-3-pro-high"],
    failoverSupported: true,
  },
  {
    id: "gemini-3.1-flash-image",
    acceptedQuotaKeys: ["gemini-3.1-flash-image"],
    failoverSupported: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    acceptedQuotaKeys: ["gemini-3.1-flash-lite"],
    failoverSupported: true,
  },
  {
    id: "gemini-3.1-pro",
    acceptedQuotaKeys: ["gemini-3.1-pro", "gemini-3.1-pro-low", "gemini-pro-agent"],
    failoverSupported: true,
  },
  {
    id: "gemini-3.5-flash",
    acceptedQuotaKeys: [
      "gemini-3.5-flash",
      "gemini-3.5-flash-extra-low",
      "gemini-3.5-flash-low",
      "gemini-3-flash-agent",
    ],
    failoverSupported: true,
  },
  {
    id: "gpt-oss-120b",
    acceptedQuotaKeys: ["gpt-oss-120b", "gpt-oss-120b-medium"],
    failoverSupported: true,
  },
  {
    id: "tab_flash_lite_preview",
    acceptedQuotaKeys: ["tab_flash_lite_preview"],
    failoverSupported: true,
  },
  {
    id: "tab_jump_flash_lite_preview",
    acceptedQuotaKeys: ["tab_jump_flash_lite_preview"],
    failoverSupported: true,
  },
];

const byId = new Map(TABLE.map((e) => [e.id, e]));
const publicIdsByQuotaKey = new Map();
for (const entry of TABLE) {
  for (const key of entry.acceptedQuotaKeys) {
    const list = publicIdsByQuotaKey.get(key) ?? [];
    if (!list.includes(entry.id)) list.push(entry.id);
    publicIdsByQuotaKey.set(key, list);
  }
}

function getAcceptedAntigravityQuotaKeys(publicModelId) {
  const entry = byId.get(publicModelId?.trim?.() ?? "");
  if (!entry || !entry.failoverSupported) return [];
  return entry.acceptedQuotaKeys;
}

function isAntigravityPublicModelFailoverSupported(publicModelId) {
  const entry = byId.get(publicModelId?.trim?.() ?? "");
  return Boolean(entry && entry.failoverSupported && entry.acceptedQuotaKeys.length > 0);
}

function findAntigravityQuotaWindowForPublicModel(publicModelId, windows) {
  const keys = getAcceptedAntigravityQuotaKeys(publicModelId);
  if (keys.length === 0) return null;
  const keySet = new Set(keys);
  for (const window of windows) {
    if (keySet.has(window.id)) return window;
  }
  return null;
}

// ─── Package catalog audit ───────────────────────────────────────────────────

const pkgModelsSource = read("node_modules/@yofriadi/pi-antigravity-oauth/src/models.ts");
const pkgJson = JSON.parse(read("node_modules/@yofriadi/pi-antigravity-oauth/package.json"));
const mappingSource = read("lib/antigravity-model-quota.ts");

console.log("\n=== Package version lock ===");

test("package is locked at 0.3.0", () => {
  assert.strictEqual(pkgJson.version, "0.3.0");
  assertIncludes(mappingSource, 'ANTIGRAVITY_MODEL_QUOTA_PACKAGE_VERSION = "0.3.0"', "version constant");
});

console.log("\n=== Catalog coverage ===");

test("table covers every 0.3.0 public catalog id exactly once", () => {
  const ids = TABLE.map((e) => e.id);
  assert.deepStrictEqual([...ids].sort(), [...ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0].sort());
  assert.strictEqual(new Set(ids).size, ids.length, "no duplicate public ids");
});

test("every package ANTIGRAVITY_MODELS id is in the fixed table", () => {
  const idMatches = [...pkgModelsSource.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(idMatches.length >= ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0.length, "package model ids present");
  for (const id of idMatches) {
    assert.ok(byId.has(id), `missing mapping for package model id ${id}`);
  }
});

test("request routing ids from package are accepted for their public models", () => {
  // Sample critical routing keys from 0.3.0 models.ts
  const expectations = [
    ["claude-opus-4-5", "claude-opus-4-5-thinking"],
    ["claude-sonnet-4-5", "claude-sonnet-4-5-thinking"],
    ["gemini-2.5-flash", "gemini-2.5-flash-thinking"],
    ["gemini-3-flash", "gemini-3-flash-agent"],
    ["gemini-3-flash", "gemini-3.5-flash-extra-low"],
    ["gemini-3-pro", "gemini-3-pro-high"],
    ["gemini-3.1-pro", "gemini-pro-agent"],
    ["gpt-oss-120b", "gpt-oss-120b-medium"],
  ];
  for (const [publicId, key] of expectations) {
    assert.ok(
      getAcceptedAntigravityQuotaKeys(publicId).includes(key),
      `${publicId} must accept routing key ${key}`,
    );
  }
});

console.log("\n=== Fail-closed mapping ===");

test("unknown public model is unsupported and has no accepted keys", () => {
  assert.strictEqual(isAntigravityPublicModelFailoverSupported("not-a-real-model"), false);
  assert.deepStrictEqual(getAcceptedAntigravityQuotaKeys("not-a-real-model"), []);
  assert.deepStrictEqual(getAcceptedAntigravityQuotaKeys(""), []);
});

test("other-model-only quota does not match current public model", () => {
  const windows = [
    { id: "claude-opus-4-5", remainingFraction: 0.9 },
    { id: "gemini-2.5-pro", remainingFraction: 0.5 },
  ];
  // Current model gemini-3-flash has no matching window even though others have quota
  assert.strictEqual(findAntigravityQuotaWindowForPublicModel("gemini-3-flash", windows), null);
  // Matching key works
  const match = findAntigravityQuotaWindowForPublicModel("claude-opus-4-5", windows);
  assert.ok(match);
  assert.strictEqual(match.id, "claude-opus-4-5");
  assert.strictEqual(match.remainingFraction, 0.9);
});

test("routing key match is accepted for public model", () => {
  const windows = [{ id: "claude-opus-4-5-thinking", remainingFraction: 0.42 }];
  const match = findAntigravityQuotaWindowForPublicModel("claude-opus-4-5", windows);
  assert.ok(match);
  assert.strictEqual(match.remainingFraction, 0.42);
});

test("remainingFraction=0 window is still found (caller decides >0)", () => {
  const windows = [{ id: "gemini-2.5-pro", remainingFraction: 0 }];
  const match = findAntigravityQuotaWindowForPublicModel("gemini-2.5-pro", windows);
  assert.ok(match);
  assert.strictEqual(match.remainingFraction, 0);
});

console.log("\n=== Source contract ===");

test("mapping module has no runtime private package import", () => {
  assertNotIncludes(mappingSource, '@yofriadi/pi-antigravity-oauth/src', "no private src import");
  assertNotIncludes(mappingSource, 'from "@yofriadi/pi-antigravity-oauth"', "no package runtime import");
  assertIncludes(mappingSource, "ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0", "fixed table export");
  assertIncludes(mappingSource, "getAcceptedAntigravityQuotaKeys", "accepted keys helper");
  assertIncludes(mappingSource, "findAntigravityQuotaWindowForPublicModel", "window lookup helper");
});

test("production table source lists every catalog id", () => {
  for (const id of ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0) {
    assertIncludes(mappingSource, `"${id}"`, `source includes ${id}`);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
