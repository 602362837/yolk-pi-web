#!/usr/bin/env node
/**
 * antigravity-quota-groups — fixed group mapping + conservative aggregation
 *
 * Covers AG-G01:
 * - 0.3.0 public ids + acceptedQuotaKeys have deterministic group membership
 * - unknown keys → other
 * - shared routing keys have single membership
 * - max(used) / min(remaining); no avg/sum
 * - empty groups omitted; variants sorted by id
 * - resetTime never becomes duration
 * - pure module (no React/network/fs/private package src)
 *
 * Run: npm run test:antigravity-quota-groups
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

const groups = await import("../lib/antigravity-quota-groups.ts");
const modelQuota = await import("../lib/antigravity-model-quota.ts");

function window(partial) {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    publicModelIds: partial.publicModelIds ?? [],
    remainingFraction: partial.remainingFraction,
    usedPercent:
      partial.usedPercent ??
      (Number.isFinite(partial.remainingFraction)
        ? (1 - partial.remainingFraction) * 100
        : Number.NaN),
    resetsAt: partial.resetsAt,
  };
}

const source = read("lib/antigravity-quota-groups.ts");

console.log("\n=== Source purity ===");

await test("module has no React / network / fs / private package imports", () => {
  assert.doesNotMatch(source, /from\s+["']react["']/);
  assert.doesNotMatch(source, /from\s+["']fs["']|from\s+["']node:fs["']/);
  assert.doesNotMatch(source, /@yofriadi\/pi-antigravity-oauth\/src/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /durationMs|durationEvidence/);
  // Aggregation must stay conservative.
  assert.match(source, /Math\.max/);
  assert.match(source, /Math\.min/);
  assert.doesNotMatch(source, /\/\s*variants\.length|reduce\s*\(\s*\(?\s*a\s*,\s*b/);
});

console.log("\n=== Catalog coverage ===");

await test("every 0.3.0 public id + acceptedQuotaKey has fixed group membership", () => {
  const known = groups.listKnownAntigravityQuotaKeysForGroups();
  assert.ok(known.length > 0, "expected known keys");
  for (const key of known) {
    const groupId = groups.resolveAntigravityQuotaGroupId(key);
    assert.ok(
      groups.ANTIGRAVITY_QUOTA_GROUP_ORDER.includes(groupId),
      `${key} → invalid group ${groupId}`,
    );
    // Must be explicit table entry, not accidental other (except keys intentionally other).
    const table = groups.ANTIGRAVITY_QUOTA_KEY_TO_GROUP_0_3_0;
    assert.ok(key in table, `missing fixed table entry for ${key}`);
  }
});

await test("public catalog ids map to expected groups", () => {
  const expected = {
    "claude-opus-4-5": "claude-opus",
    "claude-opus-4-6": "claude-opus",
    "claude-sonnet-4-5": "claude-sonnet",
    "claude-sonnet-4-6": "claude-sonnet",
    "gemini-2.5-flash": "gemini-2.5",
    "gemini-2.5-flash-lite": "gemini-2.5",
    "gemini-2.5-pro": "gemini-2.5",
    "gemini-3-flash": "gemini-3-flash",
    "gemini-3-pro": "gemini-pro",
    "gemini-3.1-flash-image": "other",
    "gemini-3.1-flash-lite": "other",
    "gemini-3.1-pro": "gemini-pro",
    "gemini-3.5-flash": "gemini-3-flash",
    "gpt-oss-120b": "other",
    tab_flash_lite_preview: "other",
    tab_jump_flash_lite_preview: "other",
  };
  for (const [id, groupId] of Object.entries(expected)) {
    assert.equal(
      groups.resolveAntigravityQuotaGroupId(id),
      groupId,
      `${id} group`,
    );
  }
});

await test("routing keys share single group membership with public family", () => {
  const flashKeys = [
    "gemini-3-flash",
    "gemini-3-flash-agent",
    "gemini-3.5-flash",
    "gemini-3.5-flash-extra-low",
    "gemini-3.5-flash-low",
  ];
  for (const key of flashKeys) {
    assert.equal(groups.resolveAntigravityQuotaGroupId(key), "gemini-3-flash");
  }
  assert.equal(
    groups.resolveAntigravityQuotaGroupId("claude-opus-4-6-thinking"),
    "claude-opus",
  );
  assert.equal(
    groups.resolveAntigravityQuotaGroupId("gemini-pro-agent"),
    "gemini-pro",
  );
  // Shared routing keys must not appear under two different groups in the table.
  const membership = new Map();
  for (const [key, groupId] of Object.entries(groups.ANTIGRAVITY_QUOTA_KEY_TO_GROUP_0_3_0)) {
    assert.ok(!membership.has(key) || membership.get(key) === groupId);
    membership.set(key, groupId);
  }
  // model-quota reverse index may list shared keys under multiple public ids;
  // group table still assigns each key once.
  const shared = ["gemini-3-flash-agent", "gemini-3.5-flash-extra-low", "gemini-3.5-flash-low"];
  for (const key of shared) {
    const publicIds = modelQuota.getPublicModelIdsForQuotaKey(key);
    assert.ok(publicIds.length >= 1, `${key} should map to public ids`);
    assert.equal(groups.resolveAntigravityQuotaGroupId(key), "gemini-3-flash");
  }
});

await test("unknown / empty keys map to other", () => {
  assert.equal(groups.resolveAntigravityQuotaGroupId("totally-unknown-model"), "other");
  assert.equal(groups.resolveAntigravityQuotaGroupId(""), "other");
  assert.equal(groups.resolveAntigravityQuotaGroupId(null), "other");
  assert.equal(groups.resolveAntigravityQuotaGroupId(undefined), "other");
  assert.equal(groups.resolveAntigravityQuotaGroupId("   "), "other");
});

console.log("\n=== Conservative aggregation ===");

await test("max(used) / min(remaining); empty groups omitted; variants sorted", () => {
  const result = groups.groupByAntigravityQuotaWindows([
    window({
      id: "claude-opus-4-6-thinking",
      remainingFraction: 0.88,
      usedPercent: 12,
      resetsAt: "2026-07-20T12:00:00.000Z",
    }),
    window({
      id: "claude-opus-4-6",
      remainingFraction: 0.9,
      usedPercent: 10,
      resetsAt: "2026-07-18T00:00:00.000Z",
    }),
    window({
      id: "gemini-3-flash-agent",
      remainingFraction: 0.15,
      usedPercent: 85,
    }),
    window({
      id: "gemini-3.5-flash",
      remainingFraction: 0.2,
      usedPercent: 80,
    }),
    window({
      id: "gemini-3.1-pro",
      remainingFraction: 0.45,
      usedPercent: 55,
    }),
    // unsafe → dropped
    window({ id: "bad", remainingFraction: 1.5, usedPercent: 10 }),
  ]);

  const ids = result.map((g) => g.groupId);
  assert.deepEqual(ids, ["gemini-3-flash", "claude-opus", "gemini-pro"]);
  assert.ok(!ids.includes("claude-sonnet"));
  assert.ok(!ids.includes("gemini-2.5"));
  assert.ok(!ids.includes("other"));

  const flash = result.find((g) => g.groupId === "gemini-3-flash");
  assert.ok(flash);
  assert.equal(flash.usedPercent, 85);
  assert.equal(flash.remainingFraction, 0.15);
  assert.equal(flash.shortLabel, "G");
  assert.equal(flash.priorityRing, true);
  assert.deepEqual(
    flash.variants.map((v) => v.id),
    ["gemini-3-flash-agent", "gemini-3.5-flash"],
  );

  const opus = result.find((g) => g.groupId === "claude-opus");
  assert.ok(opus);
  assert.equal(opus.usedPercent, 12);
  assert.equal(opus.remainingFraction, 0.88);
  assert.equal(opus.shortLabel, "A");
  assert.equal(opus.priorityRing, true);
  // Earliest resetsAt among variants (display only)
  assert.equal(opus.resetsAt, "2026-07-18T00:00:00.000Z");
  assert.deepEqual(
    opus.variants.map((v) => v.id),
    ["claude-opus-4-6", "claude-opus-4-6-thinking"],
  );

  const pro = result.find((g) => g.groupId === "gemini-pro");
  assert.ok(pro);
  assert.equal(pro.usedPercent, 55);
  assert.equal(pro.priorityRing, false);
});

await test("duplicate window.id merges conservatively", () => {
  const result = groups.groupByAntigravityQuotaWindows([
    window({
      id: "gemini-3-flash",
      remainingFraction: 0.4,
      usedPercent: 60,
      resetsAt: "2026-08-01T00:00:00.000Z",
    }),
    window({
      id: "gemini-3-flash",
      remainingFraction: 0.25,
      usedPercent: 75,
      resetsAt: "2026-07-01T00:00:00.000Z",
    }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].variants.length, 1);
  assert.equal(result[0].usedPercent, 75);
  assert.equal(result[0].remainingFraction, 0.25);
  assert.equal(result[0].resetsAt, "2026-07-01T00:00:00.000Z");
});

await test("unknown keys land in other; priority groups empty → omitted", () => {
  const result = groups.groupByAntigravityQuotaWindows([
    window({ id: "custom-lab-model", remainingFraction: 0.5, usedPercent: 50 }),
    window({ id: "gpt-oss-120b-medium", remainingFraction: 0.1, usedPercent: 90 }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].groupId, "other");
  assert.equal(result[0].usedPercent, 90);
  assert.equal(result[0].remainingFraction, 0.1);
  assert.equal(result[0].priorityRing, false);
  assert.deepEqual(
    result[0].variants.map((v) => v.id),
    ["custom-lab-model", "gpt-oss-120b-medium"],
  );
});

await test("empty / all-unsafe input yields empty groups", () => {
  assert.deepEqual(groups.groupByAntigravityQuotaWindows([]), []);
  assert.deepEqual(groups.groupByAntigravityQuotaWindows(null), []);
  assert.deepEqual(
    groups.groupByAntigravityQuotaWindows([
      window({ id: "x", remainingFraction: Number.NaN, usedPercent: 10 }),
    ]),
    [],
  );
});

await test("group order helpers and priority flags", () => {
  assert.deepEqual(groups.ANTIGRAVITY_PRIORITY_RING_GROUP_IDS, [
    "gemini-3-flash",
    "claude-opus",
  ]);
  assert.equal(groups.isAntigravityPriorityRingGroup("gemini-3-flash"), true);
  assert.equal(groups.isAntigravityPriorityRingGroup("claude-opus"), true);
  assert.equal(groups.isAntigravityPriorityRingGroup("gemini-pro"), false);
  const metas = groups.listAntigravityQuotaGroupMetas();
  assert.deepEqual(
    metas.map((m) => m.id),
    [...groups.ANTIGRAVITY_QUOTA_GROUP_ORDER],
  );
  assert.equal(metas[0].shortLabel, "G");
  assert.equal(metas[1].shortLabel, "A");
  // Opus label emphasizes 4.6 family naming in meta (group, not single key)
  assert.match(metas[1].label, /Opus/);
});

console.log("\n=== No optimistic math ===");

await test("never averages used percent across variants", () => {
  const result = groups.groupByAntigravityQuotaWindows([
    window({ id: "claude-opus-4-6", remainingFraction: 1, usedPercent: 0 }),
    window({ id: "claude-opus-4-6-thinking", remainingFraction: 0, usedPercent: 100 }),
  ]);
  assert.equal(result.length, 1);
  // avg would be 50 — must be max 100 / min 0
  assert.equal(result[0].usedPercent, 100);
  assert.equal(result[0].remainingFraction, 0);
});

console.log("\n=== Shared live quota pools ===");

await test("collapse same remaining+reset pool into preferred groups", () => {
  const resetGemini = "2026-07-17T05:50:04.000Z";
  const resetClaude = "2026-07-17T06:42:03.000Z";
  const result = groups.groupByAntigravityQuotaWindows([
    window({ id: "gemini-3-flash", remainingFraction: 0.9285332, usedPercent: 7.14668, resetsAt: resetGemini }),
    window({ id: "gemini-3.1-pro-high", remainingFraction: 0.9285332, usedPercent: 7.14668, resetsAt: resetGemini }),
    window({ id: "gemini-2.5-flash", remainingFraction: 0.9285332, usedPercent: 7.14668, resetsAt: resetGemini }),
    window({ id: "claude-opus-4-6-thinking", remainingFraction: 1, usedPercent: 0, resetsAt: resetClaude }),
    window({ id: "claude-sonnet-4-6", remainingFraction: 1, usedPercent: 0, resetsAt: resetClaude }),
    window({ id: "gpt-oss-120b-medium", remainingFraction: 1, usedPercent: 0, resetsAt: resetClaude }),
  ]);
  assert.equal(result.length, 2, "expect Gemini pool + Claude/GPT pool only");
  assert.equal(result[0].groupId, "gemini-3-flash");
  assert.equal(result[1].groupId, "claude-opus");
  assert.ok(result[0].variants.length >= 3);
  assert.ok(result[1].variants.length >= 3);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll antigravity-quota-groups tests passed.");
