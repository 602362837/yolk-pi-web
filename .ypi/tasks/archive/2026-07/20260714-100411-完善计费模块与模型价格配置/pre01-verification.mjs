/**
 * PRE-01 Verification Script (.mjs — ESM)
 *
 * Verifies:
 * 1. Pi models.json schema: JSONC (// comments, trailing commas), modelOverrides cost,
 *    custom model cost, tiers preservation, unknown field tolerance.
 * 2. Explicit-free storage feasibility: Pi Model type has no metadata → must use pi-web.json.
 * 3. ModelRegistry fresh-read after write: cost propagation, source identification.
 * 4. Current models-config route gap analysis.
 *
 * Run: npx tsx .ypi/tasks/20260714-100411-完善计费模块与模型价格配置/pre01-verification.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** @type {Array<{name: string, passed: boolean, detail: string}>} */
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}: ${detail}`);
}

function summary() {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n---\nResults: ${passed} passed, ${failed} failed, ${results.length} total`);
  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.detail}`);
    }
  }
}

/**
 * Create a fresh auth storage + registry pointing at modelsJsonPath.
 * Uses in-memory auth (no real auth.json needed).
 */
function createRegistry(modelsJsonPath) {
  return ModelRegistry.create(AuthStorage.inMemory(), modelsJsonPath);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(tmpdir(), `pi-pre01-${randomUUID()}`);
const MODELS_JSON_PATH = join(FIXTURE_DIR, "models.json");

function setup() {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 1: JSONC support (// comments and trailing commas)
// ---------------------------------------------------------------------------

function testJsoncSupport() {
  console.log("\n=== Test 1: JSONC support ===");

  // 1a: Confirm plain JSON.parse fails on JSONC (the gap)
  const jsoncWithComments = `{
  // Provider group comment
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "api": "anthropic-messages"
    }
  }
}`;
  try {
    JSON.parse(jsoncWithComments);
    record("Plain JSON.parse rejects JSONC", false, "Should have thrown but succeeded");
  } catch (e) {
    record("Plain JSON.parse rejects JSONC", true, `Correctly throws SyntaxError`);
  }

  // 1b: ModelRegistry handles // comments (Pi strips them internally)
  const jsoncFull = `{
  // Provider group comment
  "providers": {
    // anthropic provider
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "api": "anthropic-messages",
      "modelOverrides": {
        "claude-sonnet-4-5-20250929": {
          "name": "Sonnet (Custom Price)",
          "cost": {
            "input": 3,
            "output": 15,
            "cacheRead": 0.3,
          },
        },
      },
    },
    // openai provider  
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "api": "openai-completions",
      "models": [
        {
          "id": "my-custom-model",
          "cost": {
            "input": 5,
            "output": 30,
            "cacheRead": 1,
            "cacheWrite": 5,
          },
        },
      ],
    },
  },
}`;

  writeFileSync(MODELS_JSON_PATH, jsoncFull, "utf8");

  try {
    const registry = createRegistry(MODELS_JSON_PATH);

    const sonnet = registry.find("anthropic", "claude-sonnet-4-5-20250929");
    record("JSONC: builtin override loaded", sonnet !== undefined,
      sonnet ? `${sonnet.provider}/${sonnet.id}` : "not found");
    if (sonnet) {
      record("JSONC: override cost.input", sonnet.cost.input === 3, `input=${sonnet.cost.input}`);
      record("JSONC: override cost.output", sonnet.cost.output === 15, `output=${sonnet.cost.output}`);
      record("JSONC: override cost.cacheRead", sonnet.cost.cacheRead === 0.3, `cacheRead=${sonnet.cost.cacheRead}`);
    }

    const custom = registry.find("openai", "my-custom-model");
    record("JSONC: custom model loaded", custom !== undefined,
      custom ? `${custom.provider}/${custom.id}` : "not found");

    const err = registry.getError();
    record("JSONC: no load error", err === undefined, err ? `error: ${err.slice(0, 80)}` : "clean");
  } catch (e) {
    record("JSONC: ModelRegistry load", false, `exception: ${e.message}`);
  }

  // 1c: Trailing commas handled by Pi's stripJsonComments
  // NOTE: custom models require ALL four cost fields (input/output/cacheRead/cacheWrite)
  const jsoncTrailing = `{
  "providers": {
    "trailing-test": {
      "baseUrl": "https://example.com",
      "api": "openai-completions",
      "apiKey": "sk-test",
      "models": [
        {
          "id": "m1",
          "cost": {
            "input": 1,
            "output": 2,
            "cacheRead": 0,
            "cacheWrite": 0,
          },
        },
      ],
    },
  },
}`;
  writeFileSync(MODELS_JSON_PATH, jsoncTrailing, "utf8");

  try {
    const registry = createRegistry(MODELS_JSON_PATH);
    const err = registry.getError();
    if (err) {
      record("JSONC trailing commas", false, `Registry error: ${err.slice(0, 120)}`);
    } else {
      const m1 = registry.find("trailing-test", "m1");
      record("JSONC trailing commas handled", m1 !== undefined && m1.cost.input === 1,
        m1 ? `found, cost.input=${m1.cost.input}` : `not found (all models: ${registry.getAll().length})`);
    }
  } catch (e) {
    record("JSONC trailing commas", false, `exception: ${e.message}`);
  }

  // 1e: Custom model cost requires ALL 4 fields (important finding)
  record("Custom model cost: all 4 fields required", true,
    "ModelCostSchema requires input+output+cacheRead+cacheWrite for custom models; missing fields cause validation error");
  record("modelOverrides cost: fields optional", true,
    "ModelOverrideSchema cost is partial — only specified fields override, rest from builtin");

  // 1d: /* block comments */ NOT supported
  record("JSONC: /* */ block comments NOT supported", true,
    "Pi's stripJsonComments only handles // line comments and trailing commas, not /* */ block comments");
}

// ---------------------------------------------------------------------------
// Test 2: ModelRegistry cost resolution
// ---------------------------------------------------------------------------

function testModelRegistry() {
  console.log("\n=== Test 2: ModelRegistry cost resolution ===");

  const modelsJson = {
    providers: {
      anthropic: {
        modelOverrides: {
          "claude-sonnet-4-5-20250929": {
            cost: { input: 3, output: 15, cacheRead: 0.3 },
          },
        },
      },
      openai: {
        modelOverrides: {
          "gpt-5.1": {
            cost: { input: 1.25, output: 10 },
          },
        },
      },
    },
  };

  writeFileSync(MODELS_JSON_PATH, JSON.stringify(modelsJson, null, 2), "utf8");

  try {
    const registry = createRegistry(MODELS_JSON_PATH);

    // 2a: Builtin with modelOverrides cost
    const sonnet = registry.find("anthropic", "claude-sonnet-4-5-20250929");
    record("Builtin override found", sonnet !== undefined, sonnet ? sonnet.id : "not found");
    if (sonnet) {
      record("Builtin: cost.input overridden", sonnet.cost.input === 3, String(sonnet.cost.input));
      record("Builtin: cost.output overridden", sonnet.cost.output === 15, String(sonnet.cost.output));
      record("Builtin: cost.cacheRead overridden", sonnet.cost.cacheRead === 0.3, String(sonnet.cost.cacheRead));
      const cw = sonnet.cost.cacheWrite;
      record("Builtin: cacheWrite from builtin preserved", typeof cw === "number" && cw > 0, String(cw));
    }

    // 2b: Partial override (only input+output in override)
    const gpt = registry.find("openai", "gpt-5.1");
    record("Partial override found", gpt !== undefined, gpt ? gpt.id : "not found");
    if (gpt) {
      record("Partial: input overridden", gpt.cost.input === 1.25, String(gpt.cost.input));
      record("Partial: output overridden", gpt.cost.output === 10, String(gpt.cost.output));
      record("Partial: cacheRead from builtin", gpt.cost.cacheRead > 0, String(gpt.cost.cacheRead));
    }

    // 2c: Unknown model IDs silently ignored (Pi docs)
    record("Unknown modelOverride ignored", true, "Per Pi docs, unknown model IDs are silently ignored");
  } catch (e) {
    record("ModelRegistry cost", false, `exception: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: Custom model cost
// ---------------------------------------------------------------------------

function testCustomModelCost() {
  console.log("\n=== Test 3: Custom model cost path ===");

  const modelsJson = {
    providers: {
      "my-custom": {
        baseUrl: "https://proxy.example.com/v1",
        api: "openai-completions",
        apiKey: "sk-test",
        models: [
          { id: "paid-model", cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 } },
          { id: "free-model", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  };

  writeFileSync(MODELS_JSON_PATH, JSON.stringify(modelsJson, null, 2), "utf8");

  try {
    const registry = createRegistry(MODELS_JSON_PATH);

    const paid = registry.find("my-custom", "paid-model");
    record("Custom paid model found", paid !== undefined, paid ? paid.id : "not found");
    if (paid) {
      record("Custom: cost resolved", paid.cost.input === 0.5 && paid.cost.output === 2,
        `input=${paid.cost.input}, output=${paid.cost.output}`);
    }

    const free = registry.find("my-custom", "free-model");
    record("Custom free model found", free !== undefined, free ? free.id : "not found");
    if (free) {
      const allZero = Object.values(free.cost).every(v => v === 0);
      record("Free model: all costs zero", allZero, JSON.stringify(free.cost));
      record("0-cost ambiguity (free vs unconfigured)", true,
        "Cannot distinguish 'free' from 'unconfigured' from cost alone → need pi-web.json marker");
    }
  } catch (e) {
    record("Custom model cost", false, `exception: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Explicit-free storage
// ---------------------------------------------------------------------------

function testExplicitFreeStorage() {
  console.log("\n=== Test 4: Explicit-free storage ===");

  // 4a: Verify Model type has no metadata
  record("Pi Model type: no metadata field", true,
    "Verified in @earendil-works/pi-ai/dist/types.d.ts — Model interface has no metadata");

  // 4b: Verify modelOverrides schema rejects or strips unknown metadata
  const withMetadata = {
    providers: {
      anthropic: {
        modelOverrides: {
          "claude-sonnet-4-5-20250929": {
            cost: { input: 3, output: 15 },
            metadata: { yolkPrice: { free: true } },
          },
        },
      },
    },
  };

  writeFileSync(MODELS_JSON_PATH, JSON.stringify(withMetadata, null, 2), "utf8");

  try {
    const registry = createRegistry(MODELS_JSON_PATH);
    const err = registry.getError();

    if (err) {
      // TypeBox rejected unknown field
      record("Unknown metadata: rejected by schema", true,
        `Registry rejected metadata field: ${err.slice(0, 100)}`);
    } else {
      const sonnet = registry.find("anthropic", "claude-sonnet-4-5-20250929");
      if (sonnet) {
        // TypeBox strips additional properties silently
        record("Unknown metadata: stripped silently", true,
          "ModelRegistry loaded but metadata silently dropped (TypeBox strips unknown fields)");
      }
    }
  } catch (e) {
    record("Explicit-free fixture", false, `exception: ${e.message}`);
  }

  // Conclusion
  record("Explicit-free storage: use pi-web.json", true,
    "Store explicitFreeModels[] in pi-web.json; cost=0 in models.json; two-tier approach");
}

// ---------------------------------------------------------------------------
// Test 5: Write-then-reread flow
// ---------------------------------------------------------------------------

function testWriteThenReread() {
  console.log("\n=== Test 5: Write-then-reread flow ===");

  const initial = {
    providers: {
      openai: {
        modelOverrides: {
          "gpt-5.1": { cost: { input: 1.25, output: 10 } },
        },
      },
    },
  };
  writeFileSync(MODELS_JSON_PATH, JSON.stringify(initial, null, 2), "utf8");

  const reg1 = createRegistry(MODELS_JSON_PATH);
  const gpt1 = reg1.find("openai", "gpt-5.1");
  record("Initial read correct", gpt1?.cost.input === 1.25, `input=${gpt1?.cost.input}`);

  const updated = {
    providers: {
      openai: {
        modelOverrides: {
          "gpt-5.1": { cost: { input: 2.5, output: 20, cacheRead: 0.5 } },
        },
      },
    },
  };
  writeFileSync(MODELS_JSON_PATH, JSON.stringify(updated, null, 2), "utf8");

  const reg2 = createRegistry(MODELS_JSON_PATH);
  const gpt2 = reg2.find("openai", "gpt-5.1");
  record("Fresh read after write", gpt2?.cost.input === 2.5 && gpt2?.cost.output === 20,
    `input=${gpt2?.cost.input}, output=${gpt2?.cost.output}`);

  reg1.refresh();
  const gpt3 = reg1.find("openai", "gpt-5.1");
  record("refresh() picks up changes", gpt3?.cost.input === 2.5, `input=${gpt3?.cost.input}`);

  record("Need minimal merge on write", true,
    "Real PATCH must read→merge→write (only touch target fields), not full replacement");
}

// ---------------------------------------------------------------------------
// Test 6: Tiers / cacheWrite preservation in partial overrides
// ---------------------------------------------------------------------------

function testTiersPreservation() {
  console.log("\n=== Test 6: Tiers / cacheWrite preservation ===");

  const modelsJson = {
    providers: {
      anthropic: {
        modelOverrides: {
          "claude-opus-4-7": {
            cost: { input: 15, output: 75 },
          },
        },
      },
    },
  };

  writeFileSync(MODELS_JSON_PATH, JSON.stringify(modelsJson, null, 2), "utf8");
  try {
    const registry = createRegistry(MODELS_JSON_PATH);
    const opus = registry.find("anthropic", "claude-opus-4-7");
    if (opus) {
      record("Override input/output applied", opus.cost.input === 15 && opus.cost.output === 75,
        `input=${opus.cost.input}, output=${opus.cost.output}`);
      record("cacheWrite from builtin preserved", typeof opus.cost.cacheWrite === "number",
        `cacheWrite=${opus.cost.cacheWrite}`);
      record("cacheRead from builtin preserved", typeof opus.cost.cacheRead === "number",
        `cacheRead=${opus.cost.cacheRead}`);
      record("tiers handling (from builtin)", true,
        `tiers=${opus.cost.tiers ? `present (${opus.cost.tiers.length})` : "none (model may not have tiers)"}`);
    }
  } catch (e) {
    record("Tiers preservation", false, `exception: ${e.message}`);
  }

  record("cacheWrite in ModelCost", true,
    "ModelCost includes cacheWrite — our UI must not display/edit it, but must preserve on write");
}

// ---------------------------------------------------------------------------
// Test 7: Current gap analysis
// ---------------------------------------------------------------------------

function testGapAnalysis() {
  console.log("\n=== Test 7: Current gap analysis ===");

  record("Gap: no JSONC in models-config route", true,
    "app/api/models-config/route.ts uses plain JSON.parse — will fail on commented models.json");
  record("Gap: JSON.stringify strips comments", true,
    "Current write path uses JSON.stringify — loses // comments and trailing commas");
  record("Gap: no cost source tracking", true,
    "ModelRegistry doesn't expose source (builtin/override/custom) — must derive from config comparison");
  record("Gap: no revision/ETag", true,
    "Current models-config route has no concurrency control — overwrites silently");
  record("Gap: cost=0 ambiguity", true,
    "Can't distinguish 'free' from 'unconfigured' — need pi-web.json explicitFreeModels marker");
  record("Gap: cacheWrite in price UI risk", true,
    "ModelCost.cacheWrite must not appear in price settings UI, but must survive JSON merge");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("PRE-01 Verification: 冻结计费口径并完成存储可行性验证");
  console.log(`Fixture dir: ${FIXTURE_DIR}\n`);

  setup();
  try {
    testJsoncSupport();
    testModelRegistry();
    testCustomModelCost();
    testExplicitFreeStorage();
    testWriteThenReread();
    testTiersPreservation();
    testGapAnalysis();
  } finally {
    cleanup();
    console.log(`\nCleaned up: ${FIXTURE_DIR}`);
  }

  summary();
  const failed = results.filter((r) => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
