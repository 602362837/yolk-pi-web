#!/usr/bin/env node
/**
 * MLP-02 — model catalog performance / shared offline catalog service.
 *
 * Exercises `getWebModelCatalogSnapshot` (production `/api/models` path) under
 * a temporary PI_CODING_AGENT_DIR with network forced off. Asserts epoch
 * single-flight, admin runtime reuse, and no extra getAvailable scans.
 *
 * Never prints paths, credentials, account ids, or model names.
 *
 * Run: node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-model-catalog-performance.mjs
 *  or: npm run test:model-catalog-performance
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Match other provider suites: jiti must resolve `@/lib/*` for AnyRouter bridge.
const jiti = createJiti(join(root, "package.json"), {
  interopDefault: true,
  alias: { "@": root },
});

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (err) {
    console.log(
      `  \x1b[31m✗\x1b[0m ${name}: ${err instanceof Error ? err.message : String(err)}`,
    );
    failed += 1;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function countOf(snapshot, name) {
  return snapshot.counts[name] ?? 0;
}

function summarizeScenario(label, durationsMs, snapshot) {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? 0;
  console.log(
    `  · ${label}: n=${sorted.length} p50=${Math.round(p50)}ms p95=${Math.round(p95)}ms max=${Math.round(max)}ms`,
  );
  console.log(
    `    counters: runtime.create=${countOf(snapshot, "runtime.create")}` +
      ` admin_init=${countOf(snapshot, "runtime.admin_init")}` +
      ` admin_refresh=${countOf(snapshot, "runtime.admin_refresh")}` +
      ` services=${countOf(snapshot, "runtime.services_create")}` +
      ` refresh=${countOf(snapshot, "runtime.refresh_calls")}` +
      ` getAvailable=${countOf(snapshot, "runtime.get_available")}` +
      ` cache_hit=${countOf(snapshot, "catalog.cache_hit")}` +
      ` cache_miss=${countOf(snapshot, "catalog.cache_miss")}` +
      ` cache_shared=${countOf(snapshot, "catalog.cache_shared")}` +
      ` raw_read=${countOf(snapshot, "credential.raw_read")}` +
      ` anyrouter.reconcile=${countOf(snapshot, "anyrouter.reconcile")}`,
  );
  return { p50, p95, max };
}

async function seedIsolatedAgentDir(agentDir) {
  // Minimal offline fixtures. No real provider secrets or network endpoints.
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify(
      {
        // Literal offline key — never printed. Exists only so availability
        // scans have a non-empty credential file to re-read.
        "test-offline": { type: "api_key", key: "offline-catalog-fixture-key" },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          "test-offline": {
            baseUrl: "http://127.0.0.1:9",
            api: "openai-completions",
            apiKey: "offline-catalog-fixture-key",
            models: [
              {
                id: "offline-model",
                name: "Offline Model",
                reasoning: false,
                input: ["text"],
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: "test-offline", defaultModel: "offline-model" }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(join(agentDir, "anyrouter.json"), `${JSON.stringify({ models: [] }, null, 2)}\n`, {
    mode: 0o600,
  });
  await mkdir(join(agentDir, "auth-api-key-accounts", "anyrouter"), { recursive: true, mode: 0o700 });
}

/**
 * Production `/api/models` path after MLP-02: shared offline catalog snapshot.
 */
async function loadCatalogSnapshot(mods, agentDir) {
  return mods.getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
}

async function main() {
  console.log("\n=== model-catalog performance (MLP-02 shared offline catalog) ===\n");

  // Force offline SDK model refresh; catalog evidence must not hit providers.
  process.env.PI_OFFLINE = "1";
  delete process.env.PI_MODEL_CATALOG_TIMING;

  const metricsMod = await jiti.import(join(root, "lib/model-catalog-metrics.ts"));
  const runtimeMod = await jiti.import(join(root, "lib/web-model-runtime.ts"));
  const catalogMod = await jiti.import(join(root, "lib/model-catalog-service.ts"));
  const credentialMod = await jiti.import(join(root, "lib/web-credential-store.ts"));
  const {
    enableModelCatalogMetrics,
    resetModelCatalogMetrics,
    getModelCatalogMetricsSnapshot,
    formatModelCatalogMetricsLine,
    __resetModelCatalogMetricsForTests,
  } = metricsMod;
  const { __resetWebModelRuntimeCacheForTests } = runtimeMod;
  const {
    getWebModelCatalogSnapshot,
    invalidateWebModelCatalog,
    getWebModelCatalogEpoch,
    __resetWebModelCatalogForTests,
  } = catalogMod;
  const { __resetWebCredentialStoreCacheForTests } = credentialMod;

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-model-catalog-perf-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await seedIsolatedAgentDir(agentDir);

  const mods = { getWebModelCatalogSnapshot };

  // Network guard: any unexpected fetch in this process fails the suite.
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("unexpected network during model-catalog performance suite");
  };

  try {
    await test("metrics default disabled (zero overhead path)", async () => {
      __resetModelCatalogMetricsForTests();
      assert.equal(getModelCatalogMetricsSnapshot().enabled, false);
      const line = formatModelCatalogMetricsLine();
      assert.ok(line.includes("enabled=0"));
      assert.ok(!line.includes(agentDir), "metrics line must not include agentDir");
    });

    await test("cold shared catalog: one admin runtime, no getAvailable scan", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetWebModelCatalogForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();
      networkCalls = 0;

      const started = performance.now();
      const result = await loadCatalogSnapshot(mods, agentDir);
      const durationMs = performance.now() - started;
      const snapshot = getModelCatalogMetricsSnapshot();
      summarizeScenario("cold", [durationMs], snapshot);

      assert.equal(networkCalls, 0, "catalog load must not call fetch");
      assert.ok(Array.isArray(result.modelList), "wire modelList required");
      assert.ok(result.models && typeof result.models === "object", "wire models map required");
      assert.ok(
        result.defaultModel === null ||
          (typeof result.defaultModel?.provider === "string" &&
            typeof result.defaultModel?.modelId === "string"),
        "defaultModel shape",
      );
      assert.equal(countOf(snapshot, "runtime.create"), 1, "cold path creates one runtime");
      assert.equal(countOf(snapshot, "runtime.admin_init"), 1, "cold path one admin init");
      assert.equal(
        countOf(snapshot, "runtime.services_create"),
        0,
        "catalog must not create session services",
      );
      assert.equal(
        countOf(snapshot, "runtime.get_available"),
        0,
        "catalog must use getAvailableSnapshot, not getAvailable()",
      );
      assert.ok(countOf(snapshot, "catalog.cache_miss") >= 1, "cold is a cache miss");
      assert.ok(durationMs < 30_000, `cold exceeded 30s (${Math.round(durationMs)}ms)`);
    });

    await test("warm repeated snapshots share admin runtime and burst cache", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetWebModelCatalogForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();
      networkCalls = 0;

      const warmN = 5;
      const durations = [];
      for (let i = 0; i < warmN; i += 1) {
        const started = performance.now();
        await loadCatalogSnapshot(mods, agentDir);
        durations.push(performance.now() - started);
      }
      const snapshot = getModelCatalogMetricsSnapshot();
      const stats = summarizeScenario(`warm x${warmN}`, durations, snapshot);

      assert.equal(networkCalls, 0);
      // Shared admin runtime: at most one create for the whole warm series.
      assert.equal(
        countOf(snapshot, "runtime.create"),
        1,
        `warm series must reuse one runtime, got create=${countOf(snapshot, "runtime.create")}`,
      );
      assert.equal(
        countOf(snapshot, "runtime.get_available"),
        0,
        "warm path must not call getAvailable()",
      );
      // First call miss; remaining should hit burst cache without rebuild.
      assert.equal(countOf(snapshot, "catalog.cache_miss"), 1, "only first warm call builds");
      assert.ok(
        countOf(snapshot, "catalog.cache_hit") >= warmN - 1,
        `expected >=${warmN - 1} cache hits, got ${countOf(snapshot, "catalog.cache_hit")}`,
      );
      // Offline warm gate (isolated fixtures): p95 ≤ 500ms.
      assert.ok(
        stats.p95 <= 500,
        `warm p95 ${Math.round(stats.p95)}ms exceeds 500ms PRD gate`,
      );
    });

    await test("8 concurrent snapshots share one catalog flight", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetWebModelCatalogForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();
      networkCalls = 0;

      const concurrency = 8;
      const started = performance.now();
      const results = await Promise.all(
        Array.from({ length: concurrency }, () => loadCatalogSnapshot(mods, agentDir)),
      );
      const wallMs = performance.now() - started;
      const snapshot = getModelCatalogMetricsSnapshot();
      summarizeScenario(`concurrent x${concurrency} wall`, [wallMs], snapshot);

      assert.equal(networkCalls, 0);
      assert.equal(results.length, concurrency);
      assert.equal(
        countOf(snapshot, "runtime.create"),
        1,
        "concurrent cold callers must share one runtime create",
      );
      assert.equal(
        countOf(snapshot, "catalog.cache_miss"),
        1,
        "concurrent cold callers must share one catalog build",
      );
      assert.ok(
        countOf(snapshot, "catalog.cache_shared") >= concurrency - 1,
        `expected shared waiters, got ${countOf(snapshot, "catalog.cache_shared")}`,
      );
      assert.equal(countOf(snapshot, "runtime.get_available"), 0);
      // All waiters receive the same projected list length.
      const counts = results.map((r) => r.modelList.length);
      assert.ok(counts.every((n) => n === counts[0]), "shared snapshot projection");
      assert.ok(wallMs < 30_000, `8-concurrent exceeded 30s (${Math.round(wallMs)}ms)`);
    });

    await test("invalidate advances epoch and forces one rebuild", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetWebModelCatalogForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();

      const first = await loadCatalogSnapshot(mods, agentDir);
      const epoch1 = getWebModelCatalogEpoch();
      assert.equal(epoch1, 1);
      assert.ok(first.modelList);

      invalidateWebModelCatalog("test");
      assert.equal(getWebModelCatalogEpoch(), 2);

      resetModelCatalogMetrics();
      enableModelCatalogMetrics(true);
      const second = await loadCatalogSnapshot(mods, agentDir);
      const snapshot = getModelCatalogMetricsSnapshot();
      assert.ok(second.modelList);
      assert.equal(countOf(snapshot, "catalog.cache_miss"), 1, "post-invalidate rebuild is a miss");
      assert.equal(countOf(snapshot, "catalog.cache_hit"), 0);
      // Admin runtime still cached — no second create after invalidate.
      assert.equal(
        countOf(snapshot, "runtime.create"),
        0,
        "invalidate must not force a new admin runtime create",
      );
    });

    await test("metrics line stays content-safe", async () => {
      enableModelCatalogMetrics(true);
      const line = formatModelCatalogMetricsLine(getModelCatalogMetricsSnapshot());
      assert.ok(line.startsWith("[model-catalog-metrics]"));
      const dirHash = createHash("sha256").update(agentDir).digest("hex").slice(0, 16);
      assert.ok(!line.includes(agentDir), "must not include agentDir path");
      assert.ok(!line.includes(dirHash), "must not include agentDir hash either");
      assert.ok(!line.includes("offline-catalog-fixture-key"), "must not include fixture key");
      assert.ok(!line.includes("test-offline"), "must not include provider id");
      assert.ok(!line.includes("offline-model"), "must not include model id");
    });

    await test("disabling metrics stops further accumulation", async () => {
      __resetWebModelCatalogForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();
      await loadCatalogSnapshot(mods, agentDir);
      const mid = getModelCatalogMetricsSnapshot();
      assert.ok(countOf(mid, "catalog.cache_miss") >= 1 || countOf(mid, "catalog.cache_hit") >= 1);
      enableModelCatalogMetrics(false);
      await loadCatalogSnapshot(mods, agentDir);
      const after = getModelCatalogMetricsSnapshot();
      assert.equal(
        countOf(after, "catalog.cache_miss") + countOf(after, "catalog.cache_hit"),
        countOf(mid, "catalog.cache_miss") + countOf(mid, "catalog.cache_hit"),
        "disabled metrics must not accumulate",
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
    __resetModelCatalogMetricsForTests();
    __resetWebModelRuntimeCacheForTests();
    __resetWebModelCatalogForTests();
    __resetWebCredentialStoreCacheForTests();
    await rm(agentDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
