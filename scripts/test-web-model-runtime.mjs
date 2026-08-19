#!/usr/bin/env node
/**
 * Focused tests for provider-aware ModelRuntime foundation (SDK-01) and
 * MCR-01 custom provider/model SDK contracts:
 * - refresh() stays stale for new models/providers; reloadConfig/fresh reread
 * - fixed extension registrations survive same-runtime reloadConfig
 * - no-auth / missing-env are loaded-but-unavailable (expected auth gate)
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

    await test("MCR-01 SDK: refresh stays stale; reloadConfig and fresh runtime reread modelsPath", async () => {
      process.env.PI_OFFLINE = "1";
      const localDir = await mkdtemp(join(tmpdir(), "ypi-web-runtime-reload-"));
      try {
        await writeFile(
          join(localDir, "auth.json"),
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
          join(localDir, "models.json"),
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
        await writeFile(
          join(localDir, "anyrouter.json"),
          `${JSON.stringify({ models: [] }, null, 2)}\n`,
          { mode: 0o600 },
        );

        const warm = await createWebModelRuntime({
          agentDir: localDir,
          allowModelNetwork: false,
        });
        await warm.refresh({ allowNetwork: false });
        assert.ok(warm.getModel("alpha", "model-a"));
        assert.equal(warm.getModel("beta", "beta-model"), undefined);

        await writeFile(
          join(localDir, "models.json"),
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
                    {
                      id: "model-b",
                      name: "Alpha B",
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

        await warm.refresh({ allowNetwork: false });
        assert.equal(
          warm.getModel("alpha", "model-b"),
          undefined,
          "Pi 0.80.10 refresh() must not reread modelsPath",
        );
        assert.equal(
          warm.getModel("beta", "beta-model"),
          undefined,
          "Pi 0.80.10 refresh() must not discover a new provider",
        );

        await warm.reloadConfig();
        assert.ok(warm.getModel("alpha", "model-b"), "reloadConfig must load appended model");
        assert.ok(warm.getModel("beta", "beta-model"), "reloadConfig must load whole new provider");
        assert.ok(
          warm
            .getAvailableSnapshot()
            .some((m) => m.provider === "beta" && m.id === "beta-model"),
          "reloadConfig available snapshot must include beta",
        );

        const fresh = await createWebModelRuntime({
          agentDir: localDir,
          allowModelNetwork: false,
        });
        await fresh.refresh({ allowNetwork: false });
        assert.ok(fresh.getModel("beta", "beta-model"));
        assert.ok(
          fresh
            .getAvailableSnapshot()
            .some((m) => m.provider === "beta" && m.id === "beta-model"),
        );
      } finally {
        await rm(localDir, { recursive: true, force: true });
      }
    });

    await test("MCR-01 SDK: fixed extension registrations survive same-runtime reloadConfig", async () => {
      process.env.PI_OFFLINE = "1";
      const localDir = await mkdtemp(join(tmpdir(), "ypi-web-runtime-ext-"));
      try {
        await writeFile(join(localDir, "auth.json"), "{}\n", { mode: 0o600 });
        await writeFile(
          join(localDir, "models.json"),
          `${JSON.stringify({ providers: {} }, null, 2)}\n`,
          { mode: 0o600 },
        );
        await writeFile(
          join(localDir, "anyrouter.json"),
          `${JSON.stringify({ models: [] }, null, 2)}\n`,
          { mode: 0o600 },
        );

        const services = await createWebAgentSessionServices({
          cwd: localDir,
          agentDir: localDir,
          fixedProvidersOnly: true,
        });
        const runtime = services.modelRuntime;
        const beforeIds = new Set(runtime.getRegisteredProviderIds?.() ?? []);
        for (const id of ["grok-cli", "kiro", "google-antigravity"]) {
          assert.ok(
            beforeIds.has(id) || runtime.getProvider(id),
            `${id} must be registered before reloadConfig`,
          );
        }
        assert.ok((runtime.getModels("kiro")?.length ?? 0) > 0);

        await runtime.reloadConfig();

        const afterIds = new Set(runtime.getRegisteredProviderIds?.() ?? []);
        for (const id of ["grok-cli", "kiro", "google-antigravity"]) {
          assert.ok(
            afterIds.has(id) || runtime.getProvider(id),
            `${id} must survive reloadConfig without re-registerProvider`,
          );
        }
        assert.ok(
          (runtime.getModels("kiro")?.length ?? 0) > 0,
          "kiro models must remain after reloadConfig",
        );
      } finally {
        await rm(localDir, { recursive: true, force: true });
      }
    });

    await test("MCR-01 expected: no-auth/missing-env are loaded-but-unavailable; literal/stored are available", async () => {
      process.env.PI_OFFLINE = "1";
      const cases = [
        {
          label: "nokey",
          providers: {
            nokey: {
              baseUrl: "http://127.0.0.1:9",
              api: "openai-completions",
              models: [{ id: "m", name: "M", reasoning: false, input: ["text"] }],
            },
          },
          auth: {},
          expectAvailable: false,
        },
        {
          label: "missingEnv",
          providers: {
            missingEnv: {
              baseUrl: "http://127.0.0.1:9",
              api: "openai-completions",
              apiKey: "${MISSING_YPI_ENV_KEY_FOR_MCR01}",
              models: [{ id: "m", name: "M", reasoning: false, input: ["text"] }],
            },
          },
          auth: {},
          expectAvailable: false,
        },
        {
          label: "literal",
          providers: {
            literal: {
              baseUrl: "http://127.0.0.1:9",
              api: "openai-completions",
              apiKey: "literal-fake-key",
              models: [{ id: "m", name: "M", reasoning: false, input: ["text"] }],
            },
          },
          auth: {},
          expectAvailable: true,
        },
        {
          label: "stored",
          providers: {
            stored: {
              baseUrl: "http://127.0.0.1:9",
              api: "openai-completions",
              models: [{ id: "m", name: "M", reasoning: false, input: ["text"] }],
            },
          },
          auth: { stored: { type: "api_key", key: "stored-fake-key" } },
          expectAvailable: true,
        },
      ];

      for (const fixture of cases) {
        const localDir = await mkdtemp(join(tmpdir(), `ypi-web-runtime-auth-${fixture.label}-`));
        try {
          await writeFile(
            join(localDir, "auth.json"),
            `${JSON.stringify(fixture.auth, null, 2)}\n`,
            { mode: 0o600 },
          );
          await writeFile(
            join(localDir, "models.json"),
            `${JSON.stringify({ providers: fixture.providers }, null, 2)}\n`,
            { mode: 0o600 },
          );
          const providerId = Object.keys(fixture.providers)[0];
          const runtime = await createWebModelRuntime({
            agentDir: localDir,
            allowModelNetwork: false,
          });
          await runtime.refresh({ allowNetwork: false });
          assert.ok(
            runtime.getProvider(providerId),
            `${fixture.label}: provider must load even without selector availability`,
          );
          assert.ok(
            runtime.getModel(providerId, "m"),
            `${fixture.label}: model must load (getModel) even when unavailable`,
          );
          assert.equal(
            runtime
              .getAvailableSnapshot()
              .some((m) => m.provider === providerId && m.id === "m"),
            fixture.expectAvailable,
            `${fixture.label}: available=${fixture.expectAvailable} is expected Pi auth gate, not a reload bug`,
          );
          assert.equal(runtime.getError(), undefined, `${fixture.label}: must not be a composition error`);
        } finally {
          await rm(localDir, { recursive: true, force: true });
        }
      }
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
