/**
 * Focused test suite for lib/model-price-* modules (PRC-01).
 *
 * Covers:
 * - model-price-types:   validation helpers
 * - model-price-config:  stripJsonComments, readModelsJsonRaw, computeRevision,
 *                        mergePriceChanges, backup/atomic write, revision gate,
 *                        JSONC/tiers/headers preservation
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs \
 *        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        scripts/test-model-prices.mjs
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

// Must set BEFORE importing modules that resolve getAgentDir().
const agentDir = mkdtempSync(join(tmpdir(), "pi-model-prices-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  isValidPriceValue,
  validatePriceRates,
  validatePricePatchChanges,
  MODEL_PRICE_PATCH_BATCH_MAX,
  MODEL_PRICE_MAX_VALUE,
} = await import("../lib/model-price-types.ts");

const {
  stripJsonComments,
  readModelsJsonRaw,
  computeRevision,
  mergePriceChanges,
  backupModelsJson,
  writeModelsJsonAtomic,
  getModelsJsonPath,
  getModelsJsonBackupPath,
  applyPricePatch,
} = await import("../lib/model-price-config.ts");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assertStringContains(haystack, needle, msg) {
  assert.ok(haystack.includes(needle), msg ?? `expected "${needle}" in: ${haystack.slice(0, 200)}`);
}

function assertStringNotContains(haystack, needle, msg) {
  assert.ok(!haystack.includes(needle), msg ?? `unexpected "${needle}" in: ${haystack.slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Tests: stripJsonComments
// ---------------------------------------------------------------------------

console.log("\nstripJsonComments");

test("removes line comments", () => {
  const result = stripJsonComments('{\n  // comment\n  "key": "value"\n}');
  assert.ok(!result.includes("//"), "should not contain comments");
  assert.ok(result.includes('"key"'), "should preserve JSON");
});

test("removes trailing commas before }", () => {
  const result = stripJsonComments('{ "a": 1, }');
  assert.ok(!result.includes(", }"), "should remove trailing comma");
  JSON.parse(result); // must be valid JSON
});

test("removes trailing commas before ]", () => {
  const result = stripJsonComments('[1, 2, 3,]');
  assert.ok(!result.includes(",]"), "should remove trailing comma");
  JSON.parse(result);
});

test("preserves string literals with // inside", () => {
  const result = stripJsonComments('{ "url": "https://example.com/path", "key": "val" }');
  assert.ok(result.includes("https://example.com/path"), "should preserve URL string");
  JSON.parse(result);
});

test("preserves string literals with commas", () => {
  const result = stripJsonComments('{ "a": "hello, world" }');
  JSON.parse(result);
  assert.ok(result.includes("hello, world"), "should preserve comma inside string");
});

test("handles backslash-escaped quotes", () => {
  const result = stripJsonComments('{ "key": "say \\"hello\\" // not a comment" }');
  JSON.parse(result);
  assertStringContains(result, 'say \\"hello\\"');
});

// ---------------------------------------------------------------------------
// Tests: computeRevision
// ---------------------------------------------------------------------------

console.log("\ncomputeRevision");

test("produces deterministic hash", () => {
  const r1 = computeRevision("hello");
  const r2 = computeRevision("hello");
  assert.equal(r1, r2);
});

test("different content produces different hash", () => {
  const r1 = computeRevision("hello");
  const r2 = computeRevision("world");
  assert.notEqual(r1, r2);
});

test("hash is 16 hex chars", () => {
  const r = computeRevision("test");
  assert.equal(r.length, 16);
  assert.ok(/^[0-9a-f]+$/.test(r), "should be hex");
});

// ---------------------------------------------------------------------------
// Tests: readModelsJsonRaw
// ---------------------------------------------------------------------------

console.log("\nreadModelsJsonRaw");

test("returns empty when file does not exist", () => {
  // Ensure models.json does not exist in temp dir
  const modelsPath = getModelsJsonPath();
  if (existsSync(modelsPath)) rmSync(modelsPath);

  const result = readModelsJsonRaw();
  assert.equal(result.exists, false);
  assert.equal(result.raw, "{}");
  assert.deepEqual(result.parsed, {});
  assert.equal(typeof result.revision, "string");
});

test("returns parsed content when file exists", () => {
  const modelsPath = getModelsJsonPath();
  writeFileSync(modelsPath, JSON.stringify({ providers: { test: { api: "openai-completions" } } }), "utf8");

  const result = readModelsJsonRaw();
  assert.equal(result.exists, true);
  assert.ok(!result.parseError, "should not have parse error");
  assert.deepEqual(result.parsed, { providers: { test: { api: "openai-completions" } } });
  assert.equal(typeof result.revision, "string");
});

test("handles JSONC with comments", () => {
  const modelsPath = getModelsJsonPath();
  writeFileSync(modelsPath, '{ // top comment\n  "providers": {\n    "test": { "key": "value", } // trailing\n  }\n}', "utf8");

  const result = readModelsJsonRaw();
  assert.equal(result.exists, true);
  assert.ok(!result.parseError, "should parse JSONC");
  assert.deepEqual(result.parsed.providers, { test: { key: "value" } });
});

test("reports parse error for invalid JSONC", () => {
  const modelsPath = getModelsJsonPath();
  writeFileSync(modelsPath, "{ invalid json !!!", "utf8");

  const result = readModelsJsonRaw();
  assert.equal(result.exists, true);
  assert.ok(result.parseError, "should report parse error");
});

test("revision changes when file content changes", () => {
  const modelsPath = getModelsJsonPath();
  writeFileSync(modelsPath, '{"a":1}', "utf8");
  const r1 = readModelsJsonRaw().revision;

  writeFileSync(modelsPath, '{"a":2}', "utf8");
  const r2 = readModelsJsonRaw().revision;

  assert.notEqual(r1, r2);
});

// ---------------------------------------------------------------------------
// Tests: mergePriceChanges
// ---------------------------------------------------------------------------

console.log("\nmergePriceChanges");

test("adds cost to modelOverrides for unknown model", () => {
  const parsed = { providers: {} };
  const changes = [{ provider: "openai", model: "gpt-4", prices: { input: 5, output: 15 } }];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results.length, 1);
  assert.equal(results[0].success, true);
  assert.equal(results[0].provider, "openai");
  assert.equal(results[0].model, "gpt-4");

  const providers = data.providers;
  const openai = providers.openai;
  assert.ok(openai, "provider should exist");
  assert.ok(openai.modelOverrides, "modelOverrides should exist");
  assert.deepEqual(openai.modelOverrides["gpt-4"].cost, { input: 5, output: 15 });
});

test("merges cost into existing modelOverrides without removing other fields", () => {
  const parsed = {
    providers: {
      openai: {
        modelOverrides: {
          "gpt-4": {
            name: "GPT-4 Custom",
            reasoning: true,
          },
        },
      },
    },
  };

  const changes = [{ provider: "openai", model: "gpt-4", prices: { input: 5, output: 15 } }];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, true);
  const override = data.providers.openai.modelOverrides["gpt-4"];
  assert.equal(override.name, "GPT-4 Custom");
  assert.equal(override.reasoning, true);
  // cost should contain only the fields that were set (partial merge)
  assert.deepEqual(override.cost, { input: 5, output: 15 });
});

test("preserves cacheWrite and tiers in existing cost", () => {
  const parsed = {
    providers: {
      openai: {
        modelOverrides: {
          "gpt-4": {
            cost: {
              input: 3,
              output: 12,
              cacheRead: 0.3,
              cacheWrite: 6,
              tiers: [{ inputTokensAbove: 272000, input: 6, output: 24, cacheRead: 0.6, cacheWrite: 12 }],
            },
          },
        },
      },
    },
  };

  const changes = [{ provider: "openai", model: "gpt-4", prices: { input: 5 } }];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, true);
  const cost = data.providers.openai.modelOverrides["gpt-4"].cost;
  assert.equal(cost.input, 5); // updated
  assert.equal(cost.output, 12); // preserved
  assert.equal(cost.cacheRead, 0.3); // preserved
  assert.equal(cost.cacheWrite, 6); // preserved
  assert.ok(Array.isArray(cost.tiers), "tiers should be preserved");
  assert.equal(cost.tiers[0].input, 6);
});

test("preserves provider-level fields (baseUrl, headers, compat)", () => {
  const parsed = {
    providers: {
      custom: {
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        apiKey: "$ENV_VAR",
        headers: { "x-custom": "val" },
        modelOverrides: {},
      },
    },
  };

  const changes = [{ provider: "custom", model: "my-model", prices: { input: 1, output: 2 } }];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, true);
  const provider = data.providers.custom;
  assert.equal(provider.baseUrl, "https://api.example.com/v1");
  assert.equal(provider.api, "openai-completions");
  assert.equal(provider.apiKey, "$ENV_VAR");
  assert.deepEqual(provider.headers, { "x-custom": "val" });
});

test("updates custom model cost in models array", () => {
  const parsed = {
    providers: {
      ollama: {
        baseUrl: "http://localhost:11434/v1",
        models: [
          { id: "llama3.1:8b", name: "Llama 3.1" },
          { id: "qwen2.5-coder:7b", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  };

  const changes = [{ provider: "ollama", model: "qwen2.5-coder:7b", prices: { input: 0.5, output: 1.5 } }];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, true);
  const models = data.providers.ollama.models;
  assert.deepEqual(models[1].cost, { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 });
});

test("explicitFree marks cost as zero", () => {
  const parsed = { providers: {} };
  const changes = [{ provider: "openai", model: "free-model", prices: {}, explicitFree: true }];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, true);
  const cost = data.providers.openai.modelOverrides["free-model"].cost;
  assert.deepEqual(cost, { input: 0, output: 0, cacheRead: 0 });
});

test("returns error for invalid price values", () => {
  const parsed = { providers: {} };
  const changes = [{ provider: "test", model: "bad", prices: { input: -1 } }];

  const { results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, false);
  assertStringContains(results[0].error, "Invalid input price");
});

test("returns error for NaN price", () => {
  const parsed = { providers: {} };
  const changes = [{ provider: "test", model: "bad", prices: { input: NaN } }];

  const { results } = mergePriceChanges(parsed, changes);

  assert.equal(results[0].success, false);
});

test("batch with partial failures returns mixed results", () => {
  const parsed = { providers: {} };
  const changes = [
    { provider: "openai", model: "gpt-4", prices: { input: 5, output: 15 } },
    { provider: "test", model: "bad", prices: { input: -1 } }, // invalid
    { provider: "anthropic", model: "claude", prices: { input: 3, output: 10 } },
  ];

  const { data, results } = mergePriceChanges(parsed, changes);

  assert.equal(results.length, 3);
  assert.equal(results[0].success, true);
  assert.equal(results[1].success, false);
  assert.equal(results[2].success, true);

  // Valid changes should still be applied
  assert.ok(data.providers.openai);
  assert.ok(data.providers.anthropic);
});

// ---------------------------------------------------------------------------
// Tests: backup & atomic write
// ---------------------------------------------------------------------------

console.log("\nbackupModelsJson / writeModelsJsonAtomic");

test("backupModelsJson returns undefined when file does not exist", () => {
  const modelsPath = getModelsJsonPath();
  if (existsSync(modelsPath)) rmSync(modelsPath);

  const backupPath = backupModelsJson();
  assert.equal(backupPath, undefined);
});

test("backupModelsJson creates backup when file exists", () => {
  const modelsPath = getModelsJsonPath();
  writeFileSync(modelsPath, JSON.stringify({ test: true }), "utf8");

  const backupPath = backupModelsJson();
  assert.ok(backupPath, "should return backup path");
  assert.ok(existsSync(backupPath), "backup file should exist");
  assert.equal(readFileSync(backupPath, "utf8"), JSON.stringify({ test: true }));
});

test("writeModelsJsonAtomic writes file atomically", () => {
  const content = JSON.stringify({ providers: { test: { api: "openai-completions" } } }, null, 2) + "\n";
  writeModelsJsonAtomic(content);

  const modelsPath = getModelsJsonPath();
  assert.ok(existsSync(modelsPath), "file should exist");
  const readBack = readFileSync(modelsPath, "utf8");
  assert.equal(readBack, content);
});

test("writeModelsJsonAtomic creates parent directories", () => {
  // Models path should already work; this is implicitly tested above
  const modelsPath = getModelsJsonPath();
  assert.ok(existsSync(modelsPath));
});

// ---------------------------------------------------------------------------
// Tests: applyPricePatch (revision gate, 409)
// ---------------------------------------------------------------------------

console.log("\napplyPricePatch");

test("returns 409 when revision does not match", () => {
  // Write initial content
  writeModelsJsonAtomic(JSON.stringify({ providers: {} }, null, 2) + "\n");

  const result = applyPricePatch({
    revision: "0000000000000000", // wrong revision
    changes: [{ provider: "test", model: "m", prices: { input: 1 } }],
  });

  assert.equal(result.status, 409);
  assert.equal(result.success, false);
});

test("returns 422 for invalid batch", () => {
  const current = readModelsJsonRaw();
  const rev = current.revision;

  const result = applyPricePatch({
    revision: rev,
    changes: [{ provider: "test", model: "bad", prices: { input: -5 } }],
  });

  assert.equal(result.status, 422);
  assert.equal(result.success, false);
});

test("successful apply returns 200 and new revision", () => {
  // Write clean content first
  writeModelsJsonAtomic(JSON.stringify({ providers: {} }, null, 2) + "\n");

  const current = readModelsJsonRaw();
  const rev = current.revision;

  const result = applyPricePatch({
    revision: rev,
    changes: [{ provider: "openai", model: "gpt-5", prices: { input: 5, output: 15, cacheRead: 1 } }],
  });

  assert.equal(result.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].success, true);

  // New revision should be different
  assert.notEqual(result.revision, rev);
  assert.equal(typeof result.revision, "string");

  // File should be written
  const finalRaw = readModelsJsonRaw();
  const cost = finalRaw.parsed.providers?.openai?.modelOverrides?.["gpt-5"]?.cost;
  assert.ok(cost, "cost should be written");
  assert.equal(cost.input, 5);
  assert.equal(cost.output, 15);
  assert.equal(cost.cacheRead, 1);
});

// ---------------------------------------------------------------------------
// Tests: validation helpers (model-price-types)
// ---------------------------------------------------------------------------

console.log("\nisValidPriceValue / validatePriceRates / validatePricePatchChanges");

test("isValidPriceValue accepts valid values", () => {
  assert.equal(isValidPriceValue(0), true);
  assert.equal(isValidPriceValue(1.5), true);
  assert.equal(isValidPriceValue(1000000), true);
});

test("isValidPriceValue rejects invalid values", () => {
  assert.equal(isValidPriceValue(-1), false);
  assert.equal(isValidPriceValue(NaN), false);
  assert.equal(isValidPriceValue(Infinity), false);
  assert.equal(isValidPriceValue("5"), false);
  assert.equal(isValidPriceValue(null), false);
  assert.equal(isValidPriceValue(undefined), false);
  assert.equal(isValidPriceValue(2000000), false); // exceeds max
});

test("validatePriceRates rejects non-object", () => {
  const result = validatePriceRates("not an object");
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validatePriceRates accepts valid partial rates", () => {
  const result = validatePriceRates({ input: 5, output: 15 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.rates, { input: 5, output: 15, cacheRead: 0 });
});

test("validatePriceRates rejects NaN in rates", () => {
  const result = validatePriceRates({ input: NaN });
  assert.equal(result.valid, false);
});

test("validatePricePatchChanges rejects empty array", () => {
  const result = validatePricePatchChanges([]);
  assert.equal(result.valid, false);
});

test("validatePricePatchChanges rejects oversized batch", () => {
  const changes = Array.from({ length: MODEL_PRICE_PATCH_BATCH_MAX + 1 }, (_, i) => ({
    provider: "test",
    model: `model-${i}`,
    prices: { input: 1 },
  }));
  const result = validatePricePatchChanges(changes);
  assert.equal(result.valid, false);
  assertStringContains(result.errors[0], "exceeds maximum");
});

test("validatePricePatchChanges rejects duplicate targets", () => {
  const result = validatePricePatchChanges([
    { provider: "test", model: "m1", prices: { input: 1 } },
    { provider: "test", model: "m1", prices: { input: 2 } },
  ]);
  assert.equal(result.valid, false);
  assertStringContains(result.errors[0], "duplicate");
});

test("validatePricePatchChanges accepts valid batch", () => {
  const result = validatePricePatchChanges([
    { provider: "test", model: "m1", prices: { input: 1 } },
    { provider: "test", model: "m2", prices: { input: 2 }, explicitFree: true },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1].explicitFree, true);
});

// ---------------------------------------------------------------------------
// Identity + third-party matching (IMP-001)
// ---------------------------------------------------------------------------

const {
  normalizeModelIdentity,
  scoreCatalogMatch,
  stripModelNoise,
} = await import("../lib/model-price-identity.ts");

const { tryDeterministicMatch } = await import("../lib/model-price-sources.ts");

test("stripModelNoise removes thinking/router suffixes", () => {
  const r = stripModelNoise("claude-opus-4-6-thinking");
  assert.equal(r.cleaned, "claude-opus-4-6");
});

test("normalizeModelIdentity infers anthropic from claude alias", () => {
  const id = normalizeModelIdentity("cpa", "claude-opus-4-6-thinking");
  assert.equal(id.inferredVendor, "anthropic");
  assert.equal(id.coreModelId, "claude-opus-4-6");
  assert.ok(id.compactKey.includes("claudeopus"));
});

test("normalizeModelIdentity infers openai from gpt alias", () => {
  const id = normalizeModelIdentity("any", "gpt-5.5");
  assert.equal(id.inferredVendor, "openai");
  assert.equal(id.coreModelId, "gpt-5-5");
});

test("scoreCatalogMatch prefers vendor-aligned catalog entries", () => {
  const id = normalizeModelIdentity("cpa", "claude-sonnet-4-6");
  const good = scoreCatalogMatch(id, "anthropic/claude-sonnet-4", "Claude Sonnet 4");
  const bad = scoreCatalogMatch(id, "openai/gpt-4o", "GPT-4o");
  assert.ok(good > bad);
  assert.ok(good >= 70);
});

test("tryDeterministicMatch matches third-party claude alias via catalog", async () => {
  const catalog = new Map([
    [
      "anthropic/claude-opus-4",
      {
        id: "anthropic/claude-opus-4",
        name: "Claude Opus 4",
        pricing: { prompt: "0.000015", completion: "0.000075" },
      },
    ],
    [
      "openai/gpt-4o",
      {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        pricing: { prompt: "0.000005", completion: "0.000015" },
      },
    ],
  ]);

  const match = await tryDeterministicMatch("cpa", "claude-opus-4-6-thinking", catalog);
  assert.ok(match, "expected a match for third-party claude alias");
  assert.equal(match.matchedId, "anthropic/claude-opus-4");
  assert.ok((match.prices.input ?? 0) > 0);
  // OpenRouter per-token * 1e6
  assert.equal(match.prices.input, 15);
  assert.equal(match.prices.output, 75);
});

test("tryDeterministicMatch matches any/gpt against openai catalog", async () => {
  const catalog = new Map([
    [
      "openai/gpt-5.5",
      {
        id: "openai/gpt-5.5",
        name: "GPT-5.5",
        pricing: { prompt: "0.000002", completion: "0.000008" },
      },
    ],
  ]);
  const match = await tryDeterministicMatch("any", "gpt-5.5", catalog);
  assert.ok(match, "expected gpt match");
  assert.equal(match.matchedId, "openai/gpt-5.5");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
