/**
 * Model catalog epoch invalidation + race protection (MLP-05) and MCR-01
 * custom provider/model visibility regressions.
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
 * - MCR-01 F1/F2: warm append-model and whole-provider visibility after
 *   production catalog invalidate (no test runtime reset); fresh session
 *   runtime vs shared admin catalog dual assertion
 * - MCR-01: runtime.getError fail-closed (no 200 partial catalog)
 * - MCR-03: models_config invalidate evicts admin runtime config generation;
 *   late old init/refresh cannot refill; auth/test reasons keep warm runtime;
 *   distinct agentDir/modelsPath keys stay isolated
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
    invalidateWebModelRuntimeConfig,
    getWebModelRuntime,
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

      // models_config invalidate must advance catalog epoch AND admin config
      // generation. Do not use the test runtime reset as the production fix.
      invalidateWebModelCatalog("models_config");
      const after = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(
        after.modelList.some((m) => m.id === "offline-model-b"),
        "post-invalidate catalog must observe external models.json replace",
      );
    });

    await test("MCR-01 F1: warm append model becomes visible after production catalog invalidate only", async () => {
      // MCR-03: models_config invalidate must evict admin runtime config so the
      // next catalog build rereads models.json. Do NOT call the test runtime reset.
      await seedIsolatedAgentDir(agentDir);
      resetAll();
      const before = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(before.modelList.some((m) => m.provider === "test-offline" && m.id === "offline-model"));
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
      const tmp = join(agentDir, `.models.append.${Date.now()}.tmp`);
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, join(agentDir, "models.json"));

      invalidateWebModelCatalog("models_config");
      const after = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
      assert.ok(
        after.modelList.some((m) => m.provider === "test-offline" && m.id === "offline-model-b"),
        "production catalog invalidate must surface appended custom model without test runtime reset",
      );
    });

    await test("MCR-01 F2: warm whole-provider visible after production invalidate; fresh session dual-assert", async () => {
      // Shared selector catalog comes from admin runtime, not the fresh session
      // runtime. models_config invalidate must make both see beta without a
      // test runtime reset.
      try {
        resetAll();
        await writeFile(
          join(agentDir, "auth.json"),
          `${JSON.stringify(
            {
              alpha: { type: "api_key", key: "fake-alpha-key" },
              beta: { type: "api_key", key: "fake-beta-key" },
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
                alpha: {
                  baseUrl: "http://127.0.0.1:9",
                  api: "openai-completions",
                  apiKey: "fake-alpha-key",
                  models: [
                    {
                      id: "model-a",
                      name: "Alpha A",
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

        // Force a real warm admin runtime (no fake createEntry hooks).
        __setWebModelRuntimeTestHooksForTests(undefined);
        __resetWebModelRuntimeCacheForTests();
        __resetWebModelCatalogForTests();

        const warm = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
        assert.ok(warm.modelList.some((m) => m.provider === "alpha" && m.id === "model-a"));
        assert.ok(!warm.modelList.some((m) => m.provider === "beta"));

        await writeFile(
          join(agentDir, "models.json"),
          `${JSON.stringify(
            {
              providers: {
                alpha: {
                  baseUrl: "http://127.0.0.1:9",
                  api: "openai-completions",
                  apiKey: "fake-alpha-key",
                  models: [
                    {
                      id: "model-a",
                      name: "Alpha A",
                      reasoning: false,
                      input: ["text"],
                    },
                  ],
                },
                beta: {
                  baseUrl: "http://127.0.0.1:9",
                  api: "openai-completions",
                  apiKey: "fake-beta-key",
                  models: [
                    {
                      id: "beta-model",
                      name: "Beta Model",
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

        // Production commit path: catalog epoch + admin config generation.
        // Must NOT use __resetWebModelRuntimeCacheForTests as the fix.
        invalidateWebModelCatalog("models_config");

        const { createWebModelRuntime } = runtimeMod;
        const freshSessionRuntime = await createWebModelRuntime({
          agentDir,
          allowModelNetwork: false,
        });
        await freshSessionRuntime.refresh({ allowNetwork: false });
        assert.ok(
          freshSessionRuntime.getModel("beta", "beta-model"),
          "fresh session runtime must load the new whole provider from models.json",
        );
        assert.ok(
          freshSessionRuntime
            .getAvailableSnapshot()
            .some((m) => m.provider === "beta" && m.id === "beta-model"),
          "fresh session available snapshot must include beta when auth is configured",
        );

        const shared = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
        assert.ok(
          shared.modelList.some((m) => m.provider === "beta" && m.id === "beta-model"),
          "shared admin catalog (selector source) must include whole provider after production commit invalidate; fresh session runtime alone is not enough",
        );
        assert.ok(
          shared.modelList.some((m) => m.provider === "alpha" && m.id === "model-a"),
          "existing alpha group must remain",
        );
      } finally {
        // Always restore the shared offline fixture even when the pre-fix
        // shared-catalog assertion fails.
        await seedIsolatedAgentDir(agentDir);
        resetAll();
      }
    });

    await test("MCR-01: runtime.getError must fail closed as 500 model_catalog_unavailable", async () => {
      await seedIsolatedAgentDir(agentDir);
      resetAll();
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async () => ({
          runtime: {
            refresh: async () => {},
            getError: () => 'Provider "broken": baseUrl is required',
            getAvailableSnapshot: () => [
              {
                id: "partial-surviving",
                name: "Partial Surviving",
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
        }),
        refreshOffline: async () => {},
      });

      await assert.rejects(
        () => getWebModelCatalogSnapshot({ cwd: agentDir, agentDir }),
        /model catalog unavailable|catalog.*unavailable|getError|composition/i,
        "catalog build must refuse to project when runtime.getError is set",
      );

      const routeMod = await jiti.import(join(root, "app/api/models/route.ts"));
      const failRes = await routeMod.GET(
        new Request(`http://local/api/models?cwd=${encodeURIComponent(agentDir)}`),
      );
      assert.equal(failRes.status, 500, "runtime.getError must not soft-succeed as 200 partial catalog");
      const failBody = await failRes.json();
      assert.equal(failBody.error, "model_catalog_unavailable");
      assert.equal(failBody.code, "model_catalog_unavailable");
      assert.equal(failBody.modelList, undefined);
      assert.equal(
        JSON.stringify(failBody).includes("baseUrl"),
        false,
        "safe error body must not leak SDK composition details",
      );
    });

    await test("MCR-03: models_config invalidate evicts admin runtime; auth/test keep warm", async () => {
      resetAll();
      const warm = await getWebModelRuntime({ agentDir, allowModelNetwork: false });
      const again = await getWebModelRuntime({ agentDir, allowModelNetwork: false });
      assert.equal(again, warm, "warm admin runtime must be reused before config invalidate");

      invalidateWebModelCatalog("auth_mutation");
      const afterAuth = await getWebModelRuntime({ agentDir, allowModelNetwork: false });
      assert.equal(
        afterAuth,
        warm,
        "auth_mutation must not force a new admin runtime create",
      );

      invalidateWebModelCatalog("test");
      const afterTest = await getWebModelRuntime({ agentDir, allowModelNetwork: false });
      assert.equal(
        afterTest,
        warm,
        "test epoch bump must preserve warm admin runtime (performance gate)",
      );

      invalidateWebModelCatalog("models_config");
      const afterConfig = await getWebModelRuntime({ agentDir, allowModelNetwork: false });
      assert.notEqual(
        afterConfig,
        warm,
        "models_config must create a fresh admin runtime that rereads models.json",
      );
    });

    await test("MCR-03: late old admin init cannot refill after config invalidate", async () => {
      resetAll();

      let releaseCreate;
      const createGate = new Promise((resolve) => {
        releaseCreate = resolve;
      });
      let createCalls = 0;
      const oldRuntime = { refresh: async () => undefined, marker: "old" };
      const newRuntime = { refresh: async () => undefined, marker: "new" };

      __setWebModelRuntimeTestHooksForTests({
        createEntry: async (_dir, modelsPath) => {
          createCalls += 1;
          const call = createCalls;
          if (call === 1) await createGate;
          return {
            runtime: call === 1 ? oldRuntime : newRuntime,
            credentials: {},
            authPath: join(agentDir, "auth.json"),
            modelsPath,
          };
        },
        refreshOffline: async () => {},
      });

      const latePromise = getWebModelRuntime({ agentDir });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(createCalls, 1, "old init must have started");

      invalidateWebModelRuntimeConfig({ agentDir });
      const freshPromise = getWebModelRuntime({ agentDir });
      releaseCreate();

      const [late, fresh] = await Promise.all([latePromise, freshPromise]);
      // Old waiter may keep the entry it started; it must not publish into the
      // new generation cache. Fresh post-invalidate callers must get newRuntime.
      assert.equal(late, oldRuntime);
      assert.equal(fresh, newRuntime);
      assert.equal(createCalls, 2, "config invalidate must start a new init flight");

      const again = await getWebModelRuntime({ agentDir });
      assert.equal(again, newRuntime, "resolved cache must hold only the new generation");
    });

    await test("MCR-03: late old admin refresh finally must not delete newer pending", async () => {
      resetAll();

      let releaseRefresh;
      const refreshGate = new Promise((resolve) => {
        releaseRefresh = resolve;
      });
      let refreshCalls = 0;
      let createCalls = 0;
      const firstRuntime = { refresh: async () => undefined, marker: "first" };
      const secondRuntime = { refresh: async () => undefined, marker: "second" };

      __setWebModelRuntimeTestHooksForTests({
        createEntry: async (_dir, modelsPath) => {
          createCalls += 1;
          return {
            runtime: createCalls === 1 ? firstRuntime : secondRuntime,
            credentials: {},
            authPath: join(agentDir, "auth.json"),
            modelsPath,
          };
        },
        refreshOffline: async () => {
          refreshCalls += 1;
          if (refreshCalls === 1) await refreshGate;
        },
      });

      const firstWarm = getWebModelRuntime({ agentDir });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(createCalls, 1);
      assert.equal(refreshCalls, 1, "first offline refresh must be gated");

      invalidateWebModelRuntimeConfig({ agentDir });
      const secondWarm = getWebModelRuntime({ agentDir });
      // Allow the old refresh to finish after the new generation already owns
      // its pending/refresh slots. Old finally must not clear the new slot.
      releaseRefresh();

      const [first, second] = await Promise.all([firstWarm, secondWarm]);
      // Old-generation waiter may keep the runtime it already resolved; it must
      // not refill cache or disrupt the new-generation request.
      assert.equal(first, firstRuntime);
      assert.equal(second, secondRuntime);
      assert.equal(createCalls, 2);

      const again = await getWebModelRuntime({ agentDir });
      assert.equal(again, secondRuntime, "resolved cache must serve only the new generation");
      assert.ok(refreshCalls >= 2, "new generation must run its own offline refresh");
    });

    await test("MCR-03: distinct agentDir/modelsPath config invalidations stay isolated", async () => {
      resetAll();
      const otherDir = await mkdtemp(join(tmpdir(), "ypi-model-runtime-key-b-"));
      await seedIsolatedAgentDir(otherDir);
      const otherModels = join(agentDir, "other-models.json");
      await writeFile(otherModels, `${JSON.stringify({ providers: {} }, null, 2)}\n`, {
        mode: 0o600,
      });

      try {
        const a = await getWebModelRuntime({ agentDir });
        const b = await getWebModelRuntime({ agentDir: otherDir });
        const c = await getWebModelRuntime({ agentDir, modelsPath: otherModels });
        assert.notEqual(a, b);
        assert.notEqual(a, c);

        invalidateWebModelRuntimeConfig({ agentDir });
        const a2 = await getWebModelRuntime({ agentDir });
        const b2 = await getWebModelRuntime({ agentDir: otherDir });
        const c2 = await getWebModelRuntime({ agentDir, modelsPath: otherModels });
        assert.notEqual(a2, a, "default key must be rebuilt");
        assert.equal(b2, b, "other agentDir must stay warm");
        assert.equal(c2, c, "other modelsPath must stay warm");
      } finally {
        await rm(otherDir, { recursive: true, force: true }).catch(() => {});
      }
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
      assert.match(routeSource, /notifyModelsConfigCommitted\(\{\s*reason:\s*"models_config"/s);
      assert.match(
        routeSource,
        /if \(outcome\.written\) \{\s*await notifyModelsConfigCommitted\(\{\s*reason:\s*"models_config"/s,
      );
      assert.doesNotMatch(
        routeSource,
        /invalidateWebModelCatalog\(/,
        "route must use the unified commit notification owner",
      );
    });

    await test("models-config-sync invalidates after verified write only", async () => {
      const source = await readFile(join(root, "lib/models-config-sync.ts"), "utf8");
      assert.match(source, /notifyModelsConfigCommitted\(/);
      assert.match(
        source,
        /reason:\s*"models_config_sync"/,
      );
      assert.match(
        source,
        /Do not advance the model-catalog epoch: verification failed/,
      );
      const failIdx = source.indexOf(
        "Do not advance the model-catalog epoch: verification failed",
      );
      const okIdx = source.indexOf('reason: "models_config_sync"');
      assert.ok(failIdx >= 0 && okIdx > failIdx, "success notify after failure path");
      assert.doesNotMatch(
        source,
        /invalidateWebModelCatalog\("models_config_sync"\)/,
        "sync must not own a duplicate catalog invalidate",
      );
    });

    await test("model-price apply invalidates after successful written patch", async () => {
      const source = await readFile(join(root, "lib/model-price-config.ts"), "utf8");
      assert.match(source, /notifyModelsConfigCommitted\(/);
      assert.match(
        source,
        /if \(outcome\.written\) \{\s*try \{\s*(?:if \(options\.notifyCommitted\) \{[\s\S]*?\} else \{\s*)?const \{ notifyModelsConfigCommitted \}/s,
      );
      assert.match(source, /reason:\s*"model_prices"/);
      assert.match(
        source,
        /notifyCommitted\?:\s*\(args:\s*\{\s*reason:\s*"model_prices";\s*\}\)\s*=>\s*Promise<unknown>/s,
        "price writer may inject notifyCommitted only as a production-neutral test seam",
      );
      assert.doesNotMatch(
        source,
        /invalidateWebModelCatalog\("model_prices"\)/,
        "price writer must use the unified commit notification owner",
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
      assert.match(source, /export async function reloadRpcModelsConfigState/);
      assert.match(source, /modelRuntime\.reloadConfig\(\)/);
      const setModelIdx = source.indexOf('case "set_model"');
      const setModelEnd = source.indexOf('case "fork"', setModelIdx);
      const setModelBody = source.slice(
        setModelIdx,
        setModelEnd > 0 ? setModelEnd : setModelIdx + 1800,
      );
      assert.match(setModelBody, /reloadConfig\(\)/);
      assert.match(setModelBody, /Model not found/);
      const reloadCount = (setModelBody.match(/reloadConfig\(\)/g) || []).length;
      assert.equal(reloadCount, 1, "set_model exact miss reloads config only once");
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
