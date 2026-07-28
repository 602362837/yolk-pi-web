#!/usr/bin/env node
/**
 * Focused tests for provider-aware ModelRuntime foundation (SDK-01).
 *
 * Run: npm run test:web-model-runtime
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

async function main() {
  console.log("\n=== web-model-runtime foundation ===\n");

  const runtimeMod = await jiti.import(join(root, "lib/web-model-runtime.ts"));
  const providerMod = await jiti.import(join(root, "lib/pi-provider-extensions.ts"));
  const {
    createWebModelRuntime,
    getWebModelRuntime,
    createWebAgentSessionServices,
    createTemporaryWebModelRuntimeServices,
    __resetWebModelRuntimeCacheForTests,
    __setWebModelRuntimeTestHooksForTests,
  } = runtimeMod;
  const { createWebProviderAwareModelRegistry } = providerMod;

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-web-runtime-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  __resetWebModelRuntimeCacheForTests();

  try {
    await test("admin runtime cold init and offline refresh are single-flight per key", async () => {
      __resetWebModelRuntimeCacheForTests();
      let createCalls = 0;
      let refreshCalls = 0;
      let releaseCreate;
      const createGate = new Promise((resolve) => {
        releaseCreate = resolve;
      });
      const fakeRuntime = { refresh: async () => undefined };
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async (_dir, modelsPath) => {
          createCalls += 1;
          await createGate;
          return {
            runtime: fakeRuntime,
            credentials: {},
            authPath: join(agentDir, "auth.json"),
            modelsPath,
          };
        },
        refreshOffline: async () => {
          refreshCalls += 1;
        },
      });
      const callers = Array.from({ length: 20 }, () => getWebModelRuntime({ agentDir }));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(createCalls, 1);
      releaseCreate();
      const runtimes = await Promise.all(callers);
      assert.ok(runtimes.every((runtime) => runtime === fakeRuntime));
      assert.equal(refreshCalls, 1);
      __resetWebModelRuntimeCacheForTests();
    });

    await test("admin runtime pending failures clear so init and refresh can retry", async () => {
      __resetWebModelRuntimeCacheForTests();
      let createCalls = 0;
      let refreshCalls = 0;
      const fakeRuntime = { refresh: async () => undefined };
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async (_dir, modelsPath) => {
          createCalls += 1;
          if (createCalls === 1) throw new Error("init failed");
          return {
            runtime: fakeRuntime,
            credentials: {},
            authPath: join(agentDir, "auth.json"),
            modelsPath,
          };
        },
        refreshOffline: async () => {
          refreshCalls += 1;
          if (refreshCalls === 1) throw new Error("refresh failed");
        },
      });
      await assert.rejects(() => getWebModelRuntime({ agentDir }), /init failed/);
      await assert.rejects(() => getWebModelRuntime({ agentDir }), /refresh failed/);
      const runtime = await getWebModelRuntime({ agentDir });
      assert.equal(runtime, fakeRuntime);
      assert.equal(createCalls, 2);
      assert.equal(refreshCalls, 2);
      __resetWebModelRuntimeCacheForTests();
    });

    await test("network opt-in does not alter shared offline initialization", async () => {
      __resetWebModelRuntimeCacheForTests();
      let initAllowNetwork;
      let offlineRefreshes = 0;
      let networkRefreshes = 0;
      const fakeRuntime = {
        refresh: async ({ allowNetwork }) => {
          if (allowNetwork) networkRefreshes += 1;
        },
      };
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async (_dir, modelsPath, allowModelNetwork) => {
          initAllowNetwork = allowModelNetwork;
          return {
            runtime: fakeRuntime,
            credentials: {},
            authPath: join(agentDir, "auth.json"),
            modelsPath,
          };
        },
        refreshOffline: async () => {
          offlineRefreshes += 1;
        },
      });
      await getWebModelRuntime({ agentDir, allowModelNetwork: true });
      assert.equal(initAllowNetwork, false);
      assert.equal(offlineRefreshes, 0);
      assert.equal(networkRefreshes, 1);
      __resetWebModelRuntimeCacheForTests();
    });

    await test("admin runtime keys remain isolated", async () => {
      __resetWebModelRuntimeCacheForTests();
      let createCalls = 0;
      let refreshCalls = 0;
      __setWebModelRuntimeTestHooksForTests({
        createEntry: async (_dir, modelsPath) => {
          createCalls += 1;
          return {
            runtime: { refresh: async () => undefined },
            credentials: {},
            authPath: join(agentDir, "auth.json"),
            modelsPath,
          };
        },
        refreshOffline: async () => {
          refreshCalls += 1;
        },
      });
      const [a, b] = await Promise.all([
        getWebModelRuntime({ agentDir, modelsPath: join(agentDir, "a.json") }),
        getWebModelRuntime({ agentDir, modelsPath: join(agentDir, "b.json") }),
      ]);
      assert.notEqual(a, b);
      assert.equal(createCalls, 2);
      assert.equal(refreshCalls, 2);
      __resetWebModelRuntimeCacheForTests();
    });

    await test("createWebProviderAwareModelRegistry hard-fails (no AuthStorage path)", async () => {
      await assert.rejects(
        () => createWebProviderAwareModelRegistry(),
        /removed for pi SDK 0\\.80\\.10|getWebModelRuntime|createWebAgentSessionServices/,
      );
    });

    await test("createWebModelRuntime returns isolated ModelRuntime", async () => {
      const a = await createWebModelRuntime({ agentDir });
      const b = await createWebModelRuntime({ agentDir });
      assert.notEqual(a, b);
      assert.equal(typeof a.getModels, "function");
      assert.equal(typeof a.getAuth, "function");
      assert.equal(typeof a.refresh, "function");
    });

    await test("getWebModelRuntime caches admin runtime by agentDir/modelsPath", async () => {
      __resetWebModelRuntimeCacheForTests();
      const a = await getWebModelRuntime({ agentDir });
      const b = await getWebModelRuntime({ agentDir });
      assert.equal(a, b);
      const tempModels = join(agentDir, "tmp-models.json");
      await writeFile(tempModels, JSON.stringify({ providers: {} }, null, 2));
      // Temporary path creates a different cache key when using get — but
      // createTemporary helper must not share the default entry.
      const tempServices = await createTemporaryWebModelRuntimeServices({
        cwd: agentDir,
        agentDir,
        modelsPath: tempModels,
      });
      assert.notEqual(tempServices.modelRuntime, a);
      // Default admin runtime still the same instance
      const c = await getWebModelRuntime({ agentDir });
      assert.equal(c, a);
    });

    await test("createWebAgentSessionServices registers fixed providers on target runtime", async () => {
      const services = await createWebAgentSessionServices({
        cwd: agentDir,
        agentDir,
        fixedProvidersOnly: true,
      });
      assert.ok(services.modelRuntime);
      const ids = [...(services.modelRuntime.getRegisteredProviderIds?.() ?? [])];
      for (const id of ["grok-cli", "kiro", "google-antigravity"]) {
        assert.ok(
          ids.includes(id) || services.modelRuntime.getProvider(id),
          `${id} must register on the target ModelRuntime (got: ${ids.join(",")})`,
        );
      }
      // Kiro specifically exercises the pi-ai/oauth runtime shim under jiti.
      assert.ok(
        (services.modelRuntime.getModels("kiro")?.length ?? 0) > 0,
        "kiro models must be available on the target runtime",
      );
    });

    await test("session services isolation: two services do not share runtime instance", async () => {
      const s1 = await createWebAgentSessionServices({
        cwd: join(agentDir, "proj-a"),
        agentDir,
        fixedProvidersOnly: true,
      });
      const s2 = await createWebAgentSessionServices({
        cwd: join(agentDir, "proj-b"),
        agentDir,
        fixedProvidersOnly: true,
      });
      assert.notEqual(s1.modelRuntime, s2.modelRuntime);
    });

    await test("temporary modelsPath services do not pollute default admin cache", async () => {
      __resetWebModelRuntimeCacheForTests();
      const defaultRuntime = await getWebModelRuntime({ agentDir });
      const tempModels = join(agentDir, "verify-models.json");
      await writeFile(
        tempModels,
        JSON.stringify(
          {
            providers: {
              "test-temp": {
                baseUrl: "http://127.0.0.1:9",
                api: "openai-completions",
                apiKey: "test",
                models: [{ id: "temp-model", name: "Temp", reasoning: false, input: ["text"] }],
              },
            },
          },
          null,
          2,
        ),
      );
      const tempServices = await createTemporaryWebModelRuntimeServices({
        cwd: agentDir,
        agentDir,
        modelsPath: tempModels,
      });
      await tempServices.modelRuntime.refresh({ allowNetwork: false });
      const defaultAfter = await getWebModelRuntime({ agentDir });
      assert.equal(defaultAfter, defaultRuntime);
      // Temp model should not appear on the default admin runtime.
      assert.equal(defaultAfter.getModel("test-temp", "temp-model"), undefined);
    });
  } finally {
    __resetWebModelRuntimeCacheForTests();
    await rm(agentDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
