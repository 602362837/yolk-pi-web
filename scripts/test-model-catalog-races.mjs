/**
 * Model catalog epoch invalidation + race protection (MLP-05).
 *
 * Covers:
 * - successful invalidate advances epoch and drops burst cache
 * - failed / skipped mutation (no invalidate) leaves epoch and cache intact
 * - late old-generation builds cannot publish into a newer epoch
 * - failed pending clears so the next request can rebuild
 * - external atomic models.json replace is visible after explicit invalidate
 * - catalog cache/pending are isolated by canonical agentDir (not shared
 *   across distinct explicit agentDirs)
 * - GET /api/models catalog-build failure is 500 model_catalog_unavailable
 *   (never soft 200 empty); recovery restores success wire; bad cwd stays 400
 * - source contracts for models-config / sync / prices / reloadRpcAuthState
 *
 * Uses a temporary PI_CODING_AGENT_DIR and zero network. No paths, secrets,
 * account ids, or model config bodies are logged.
 *
 * Run: npm run test:model-catalog-races
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Match other catalog suites: jiti must resolve `@/lib/*`.
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
  } catch (error) {
    console.log(
      `  \x1b[31m✗\x1b[0m ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    failed += 1;
  }
}

async function seedIsolatedAgentDir(agentDir) {
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify(
      {
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
    `${JSON.stringify(
      { defaultProvider: "test-offline", defaultModel: "offline-model" },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "anyrouter.json"),
    `${JSON.stringify({ models: [] }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await mkdir(join(agentDir, "auth-api-key-accounts", "anyrouter"), {
    recursive: true,
    mode: 0o700,
  });
}

function fakeRuntimeEntry(agentDir, modelId, modelName) {
  return {
    runtime: {
      refresh: async () => {},
      getAvailableSnapshot: () => [
        {
          id: modelId,
          name: modelName,
          provider: "test-offline",
        },
      ],
      getProvider: () => ({ name: "Test Offline" }),
      getProviders: () => [],
      getModel: () => undefined,
      registerProvider: () => {},
    },
    credentials: {},
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  };
}

async function main() {
  console.log("\n=== model-catalog races (epoch + agentDir identity) ===\n");

  process.env.PI_OFFLINE = "1";
  delete process.env.PI_MODEL_CATALOG_TIMING;

  const metricsMod = await jiti.import(join(root, "lib/model-catalog-metrics.ts"));
  const runtimeMod = await jiti.import(join(root, "lib/web-model-runtime.ts"));
  const catalogMod = await jiti.import(join(root, "lib/model-catalog-service.ts"));

  const {
    enableModelCatalogMetrics,
    resetModelCatalogMetrics,
    getModelCatalogMetricsSnapshot,
    __resetModelCatalogMetricsForTests,
  } = metricsMod;
  const {
    __resetWebModelRuntimeCacheForTests,
    __setWebModelRuntimeTestHooksForTests,
  } = runtimeMod;
  const {
    getWebModelCatalogSnapshot,
    invalidateWebModelCatalog,
    getWebModelCatalogEpoch,
    __resetWebModelCatalogForTests,
  } = catalogMod;

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-model-catalog-races-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await seedIsolatedAgentDir(agentDir);

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("unexpected network during model-catalog race suite");
  };

  const resetAll = () => {
    __setWebModelRuntimeTestHooksForTests(undefined);
    __resetWebModelCatalogForTests();
    __resetWebModelRuntimeCacheForTests();
    __resetModelCatalogMetricsForTests();
    enableModelCatalogMetrics(true);
    resetModelCatalogMetrics();
  };

  try {
    await test("invalidate advances epoch and drops burst cache", async () => {
      resetAll();
      const first = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(first.modelList.some((m) => m.id === "offline-model"));
      const epoch1 = getWebModelCatalogEpoch();

      resetModelCatalogMetrics();
      await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      const warm = getModelCatalogMetricsSnapshot();
      assert.ok((warm.counts["catalog.cache_hit"] ?? 0) >= 1, "expected warm cache hit");

      invalidateWebModelCatalog("models_config");
      assert.equal(getWebModelCatalogEpoch(), epoch1 + 1);

      resetModelCatalogMetrics();
      const second = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(second.modelList.some((m) => m.id === "offline-model"));
      const after = getModelCatalogMetricsSnapshot();
      assert.ok((after.counts["catalog.cache_miss"] ?? 0) >= 1, "post-invalidate must miss");
      assert.equal(after.counts["catalog.cache_hit"] ?? 0, 0);
    });

    await test("failed mutation contract: no invalidate leaves epoch and cache intact", async () => {
      resetAll();
      await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      const epochBefore = getWebModelCatalogEpoch();

      // Simulate failed mutation: never call invalidateWebModelCatalog.
      resetModelCatalogMetrics();
      await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.equal(getWebModelCatalogEpoch(), epochBefore);
      assert.ok(
        (getModelCatalogMetricsSnapshot().counts["catalog.cache_hit"] ?? 0) >= 1,
        "failed mutation must not drop catalog burst cache",
      );
      assert.equal(getModelCatalogMetricsSnapshot().counts["catalog.invalidate"] ?? 0, 0);
    });

    await test("late old-generation build cannot publish into newer epoch", async () => {
      resetAll();

      let releaseBuild;
      const gate = new Promise((resolve) => {
        releaseBuild = resolve;
      });
      let builds = 0;

      __setWebModelRuntimeTestHooksForTests({
        createEntry: async () => {
          builds += 1;
          const buildId = builds;
          if (buildId === 1) await gate;
          return fakeRuntimeEntry(
            agentDir,
            buildId === 1 ? "late-old" : "fresh-new",
            buildId === 1 ? "Late Old" : "Fresh New",
          );
        },
        refreshOffline: async () => {},
      });

      const latePromise = getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      // Let the first build enter the gate.
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(builds, 1, "first builder must have started");

      invalidateWebModelCatalog("test");
      // Drop admin runtime so the new epoch does not share the in-flight entry.
      // Note: __resetWebModelRuntimeCacheForTests clears test hooks — reinstall.
      __resetWebModelRuntimeCacheForTests();
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async () => {
          builds += 1;
          const buildId = builds;
          if (buildId === 1) await gate;
          return fakeRuntimeEntry(
            agentDir,
            buildId === 1 ? "late-old" : "fresh-new",
            buildId === 1 ? "Late Old" : "Fresh New",
          );
        },
        refreshOffline: async () => {},
      });

      const freshPromise = getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      // Allow both builders to proceed.
      releaseBuild();

      const [late, fresh] = await Promise.all([latePromise, freshPromise]);
      assert.equal(late.modelList[0]?.id, "late-old");
      assert.equal(fresh.modelList[0]?.id, "fresh-new");

      // Late builder must not have refilled the new epoch cache.
      const again = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.equal(again.modelList[0]?.id, "fresh-new");
    });

    await test("failed pending clears; next request rebuilds", async () => {
      resetAll();
      let calls = 0;
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async () => {
          calls += 1;
          if (calls === 1) throw new Error("synthetic catalog build failure");
          return fakeRuntimeEntry(agentDir, "recovered", "Recovered");
        },
        refreshOffline: async () => {},
      });

      await assert.rejects(
        () => getWebModelCatalogSnapshot({ cwd: agentDir, agentDir }),
        /synthetic catalog build failure/,
      );
      // Catalog pending and admin runtime pending both clear on failure so the
      // next request can rebuild without an explicit epoch bump.
      const recovered = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.equal(recovered.modelList[0]?.id, "recovered");
      assert.equal(calls, 2);
    });

    await test("distinct agentDirs isolate cache and concurrent pending flights", async () => {
      resetAll();

      const agentDirA = await mkdtemp(join(tmpdir(), "ypi-model-catalog-key-a-"));
      const agentDirB = await mkdtemp(join(tmpdir(), "ypi-model-catalog-key-b-"));
      await seedIsolatedAgentDir(agentDirA);
      await seedIsolatedAgentDir(agentDirB);

      try {
        let releaseA;
        const gateA = new Promise((resolve) => {
          releaseA = resolve;
        });
        const buildsByDir = new Map();

        __setWebModelRuntimeTestHooksForTests({
          createEntry: async (dir) => {
            buildsByDir.set(dir, (buildsByDir.get(dir) ?? 0) + 1);
            if (dir === agentDirA) await gateA;
            const modelId = dir === agentDirA ? "model-a" : "model-b";
            const modelName = dir === agentDirA ? "Model A" : "Model B";
            return fakeRuntimeEntry(dir, modelId, modelName);
          },
          refreshOffline: async () => {},
        });

        const firstA = getWebModelCatalogSnapshot({ cwd: agentDirA, agentDir: agentDirA });
        // Ensure A entered its gated build before B starts, so a global pending
        // would incorrectly make B wait on A's flight.
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(buildsByDir.get(agentDirA), 1, "A builder must start first");

        resetModelCatalogMetrics();
        const firstB = await getWebModelCatalogSnapshot({
          cwd: agentDirB,
          agentDir: agentDirB,
        });
        assert.equal(firstB.modelList[0]?.id, "model-b");
        assert.equal(buildsByDir.get(agentDirB), 1, "B must not reuse A's pending");
        assert.equal(
          getModelCatalogMetricsSnapshot().counts["catalog.cache_shared"] ?? 0,
          0,
          "B must not share A's in-flight catalog",
        );

        // Same agentDir concurrent waiters still coalesce.
        resetModelCatalogMetrics();
        const sharedA1 = getWebModelCatalogSnapshot({ cwd: agentDirA, agentDir: agentDirA });
        const sharedA2 = getWebModelCatalogSnapshot({ cwd: agentDirA, agentDir: agentDirA });
        releaseA();
        const [a1, a2, aFirst] = await Promise.all([sharedA1, sharedA2, firstA]);
        assert.equal(aFirst.modelList[0]?.id, "model-a");
        assert.equal(a1.modelList[0]?.id, "model-a");
        assert.equal(a2.modelList[0]?.id, "model-a");
        assert.equal(buildsByDir.get(agentDirA), 1, "A same-key waiters share one build");
        assert.ok(
          (getModelCatalogMetricsSnapshot().counts["catalog.cache_shared"] ?? 0) >= 1,
          "same agentDir concurrent waiters must share flight",
        );

        // Warm cache remains isolated: A hit must not serve B's models.
        resetModelCatalogMetrics();
        const warmA = await getWebModelCatalogSnapshot({
          cwd: agentDirA,
          agentDir: agentDirA,
        });
        const warmB = await getWebModelCatalogSnapshot({
          cwd: agentDirB,
          agentDir: agentDirB,
        });
        assert.equal(warmA.modelList[0]?.id, "model-a");
        assert.equal(warmB.modelList[0]?.id, "model-b");
        assert.ok(
          (getModelCatalogMetricsSnapshot().counts["catalog.cache_hit"] ?? 0) >= 2,
          "both agentDirs should hit their own burst cache",
        );
        assert.equal(buildsByDir.get(agentDirA), 1);
        assert.equal(buildsByDir.get(agentDirB), 1);
      } finally {
        await rm(agentDirA, { recursive: true, force: true }).catch(() => {});
        await rm(agentDirB, { recursive: true, force: true }).catch(() => {});
      }
    });

    await test("external models.json replace visible after explicit invalidate", async () => {
      resetAll();
      const before = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(before.modelList.some((m) => m.id === "offline-model"));
      assert.ok(!before.modelList.some((m) => m.id === "offline-model-b"));

      const next = {
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
              {
                id: "offline-model-b",
                name: "Offline Model B",
                reasoning: false,
                input: ["text"],
              },
            ],
          },
        },
      };
      const tmp = join(agentDir, `.models.${Date.now()}.tmp`);
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, join(agentDir, "models.json"));

      // Correctness boundary is epoch/invalidation, not mtime watching.
      invalidateWebModelCatalog("models_config");
      __resetWebModelRuntimeCacheForTests();
      const after = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(
        after.modelList.some((m) => m.id === "offline-model-b"),
        "post-invalidate catalog must observe external models.json replace",
      );
    });

    await test("GET /api/models returns 500 model_catalog_unavailable (not soft 200 empty)", async () => {
      resetAll();
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async () => {
          throw new Error("synthetic route catalog failure");
        },
        refreshOffline: async () => {},
      });

      const routeMod = await jiti.import(join(root, "app/api/models/route.ts"));
      assert.equal(typeof routeMod.GET, "function");

      const failRes = await routeMod.GET(
        new Request(`http://local/api/models?cwd=${encodeURIComponent(agentDir)}`),
      );
      assert.equal(failRes.status, 500, "catalog build failure must be non-2xx");
      assert.equal(failRes.headers.get("cache-control"), "no-store");
      const failBody = await failRes.json();
      assert.equal(failBody.error, "model_catalog_unavailable");
      assert.equal(failBody.code, "model_catalog_unavailable");
      assert.equal(failBody.modelList, undefined, "error body must not look like success catalog");
      assert.equal(failBody.models, undefined);

      // Recovery: clear the synthetic failure; next GET must succeed with wire shape.
      __setWebModelRuntimeTestHooksForTests(undefined);
      __resetWebModelRuntimeCacheForTests();
      __resetWebModelCatalogForTests();

      const okRes = await routeMod.GET(
        new Request(`http://local/api/models?cwd=${encodeURIComponent(agentDir)}`),
      );
      assert.equal(okRes.status, 200);
      const okBody = await okRes.json();
      assert.ok(okBody && typeof okBody.models === "object");
      assert.ok(Array.isArray(okBody.modelList));
      assert.ok("defaultModel" in okBody);
      assert.ok(okBody.thinkingLevels && typeof okBody.thinkingLevels === "object");
      assert.ok(okBody.thinkingLevelMaps && typeof okBody.thinkingLevelMaps === "object");
      assert.ok(
        okBody.modelList.some((m) => m.id === "offline-model"),
        "recovered catalog includes fixture model",
      );

      // cwd validation remains 400 (not remapped to catalog_unavailable).
      const badCwd = await routeMod.GET(
        new Request("http://local/api/models?cwd=/definitely-not-a-real-ypi-cwd-path"),
      );
      assert.equal(badCwd.status, 400);
      const badBody = await badCwd.json();
      assert.match(String(badBody.error || ""), /does not exist/i);
    });

    await test("models-config route source invalidates only after written success", async () => {
      const routeSource = await readFile(
        join(root, "app/api/models-config/route.ts"),
        "utf8",
      );
      assert.match(routeSource, /invalidateWebModelCatalog\("models_config"\)/);
      assert.match(
        routeSource,
        /if \(outcome\.written\) \{\s*invalidateWebModelCatalog\("models_config"\)/s,
      );
    });

    await test("models-config-sync invalidates after verified write only", async () => {
      const source = await readFile(join(root, "lib/models-config-sync.ts"), "utf8");
      assert.match(source, /invalidateWebModelCatalog\("models_config_sync"\)/);
      assert.match(
        source,
        /Do not advance the model-catalog epoch: verification failed/,
      );
      const failIdx = source.indexOf(
        "Do not advance the model-catalog epoch: verification failed",
      );
      const okIdx = source.indexOf('invalidateWebModelCatalog("models_config_sync")');
      assert.ok(failIdx >= 0 && okIdx > failIdx, "success invalidate after failure path");
    });

    await test("model-price apply invalidates after successful written patch", async () => {
      const source = await readFile(join(root, "lib/model-price-config.ts"), "utf8");
      assert.match(source, /invalidateWebModelCatalog\("model_prices"\)/);
      assert.match(
        source,
        /if \(outcome\.written\) \{\s*try \{\s*const \{ invalidateWebModelCatalog \}/s,
      );
    });

    await test("reloadRpcAuthState advances catalog epoch (auth mutation contract)", async () => {
      const source = await readFile(join(root, "lib/rpc-manager.ts"), "utf8");
      assert.match(source, /invalidateWebModelCatalog\("auth_mutation"\)/);
      const fnIdx = source.indexOf("export async function reloadRpcAuthState");
      const invIdx = source.indexOf(
        'invalidateWebModelCatalog("auth_mutation")',
        fnIdx,
      );
      assert.ok(fnIdx >= 0 && invIdx > fnIdx, "auth catalog invalidate lives inside reloadRpcAuthState");
    });

    await test("zero network during race suite", async () => {
      assert.equal(networkCalls, 0);
    });
  } finally {
    __setWebModelRuntimeTestHooksForTests(undefined);
    globalThis.fetch = originalFetch;
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
