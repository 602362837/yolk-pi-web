#!/usr/bin/env node
/**
 * Model catalog GET read-purity (MLP-01 baseline → MLP-03 TO-BE gate).
 *
 * Fixed-provider catalog loads must not reconcile/write AnyRouter derived
 * mirrors. Explicit reconcile still repairs missing bridge under mutation
 * lock with equal-value no-op on repeat.
 *
 * Uses a temporary PI_CODING_AGENT_DIR and forces PI_OFFLINE. Never prints
 * paths, credentials, account ids, or model names.
 *
 * Run: node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-model-catalog-read-purity.mjs
 *  or: npm run test:model-catalog-read-purity
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countOf(snapshot, name) {
  return snapshot.counts[name] ?? 0;
}

async function safeStatMeta(path) {
  try {
    const st = await stat(path);
    return {
      exists: true,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { exists: false, size: 0, mtimeMs: 0 };
    }
    throw err;
  }
}

async function fileFingerprint(path) {
  try {
    const raw = await readFile(path);
    return fingerprint(raw);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return "missing";
    }
    throw err;
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
    `${JSON.stringify({ defaultProvider: "test-offline", defaultModel: "offline-model" }, null, 2)}\n`,
    { mode: 0o600 },
  );
  // Global catalog-only AnyRouter source (no Active). Catalog loads must not
  // create/repair the derived bridge; explicit bootstrap does that.
  await writeFile(
    join(agentDir, "anyrouter.json"),
    `${JSON.stringify(
      {
        baseUrl: "http://127.0.0.1:9",
        models: [{ id: "anyrouter-offline", name: "AnyRouter Offline", reasoning: false, input: ["text"] }],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await mkdir(join(agentDir, "auth-api-key-accounts", "anyrouter"), {
    recursive: true,
    mode: 0o700,
  });
}

async function catalogLikeLoad(createWebAgentSessionServices, agentDir) {
  const services = await createWebAgentSessionServices({
    cwd: agentDir,
    agentDir,
    fixedProvidersOnly: true,
  });
  await services.modelRuntime.getAvailable();
}

async function main() {
  console.log("\n=== model-catalog read-purity (MLP-03) ===\n");

  process.env.PI_OFFLINE = "1";
  delete process.env.PI_MODEL_CATALOG_TIMING;

  const metricsMod = await jiti.import(join(root, "lib/model-catalog-metrics.ts"));
  const runtimeMod = await jiti.import(join(root, "lib/web-model-runtime.ts"));
  const credentialMod = await jiti.import(join(root, "lib/web-credential-store.ts"));
  const bridgeMod = await jiti.import(join(root, "lib/anyrouter-runtime-bridge.ts"));
  const {
    enableModelCatalogMetrics,
    resetModelCatalogMetrics,
    getModelCatalogMetricsSnapshot,
    formatModelCatalogMetricsLine,
    __resetModelCatalogMetricsForTests,
  } = metricsMod;
  const {
    createWebAgentSessionServices,
    __resetWebModelRuntimeCacheForTests,
  } = runtimeMod;
  const { __resetWebCredentialStoreCacheForTests } = credentialMod;
  const {
    reconcileAnyRouterRuntimeMirrors,
    ensureAnyRouterRuntimeMirrorsBootstrapped,
    __resetAnyRouterRuntimeBridgeStateForTests,
  } = bridgeMod;

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-model-catalog-purity-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await seedIsolatedAgentDir(agentDir);

  const authPath = join(agentDir, "auth.json");
  const bridgePath = join(
    agentDir,
    "auth-api-key-accounts",
    "anyrouter",
    ".runtime",
    "provider.json",
  );

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("unexpected network during model-catalog read-purity baseline");
  };

  try {
    await test("catalog-like load is pure-read (no AnyRouter reconcile / mirror write)", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetAnyRouterRuntimeBridgeStateForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();
      networkCalls = 0;

      const beforeAuth = await safeStatMeta(authPath);
      const beforeAuthFp = await fileFingerprint(authPath);
      const beforeBridge = await safeStatMeta(bridgePath);

      await catalogLikeLoad(createWebAgentSessionServices, agentDir);

      const afterAuth = await safeStatMeta(authPath);
      const afterAuthFp = await fileFingerprint(authPath);
      const afterBridge = await safeStatMeta(bridgePath);
      const snapshot = getModelCatalogMetricsSnapshot();

      assert.equal(networkCalls, 0, "catalog load must not call fetch");
      assert.equal(countOf(snapshot, "anyrouter.reconcile"), 0, "catalog must not reconcile");
      assert.equal(
        countOf(snapshot, "anyrouter.auth_mirror_set") +
          countOf(snapshot, "anyrouter.auth_mirror_clear"),
        0,
        "catalog must not mirror auth",
      );
      assert.equal(
        countOf(snapshot, "anyrouter.bridge_write") +
          countOf(snapshot, "anyrouter.bridge_remove"),
        0,
        "catalog must not mutate bridge",
      );
      assert.equal(countOf(snapshot, "credential.modify"), 0);
      assert.equal(countOf(snapshot, "credential.delete"), 0);
      assert.equal(beforeAuthFp, afterAuthFp, "auth content must not change");
      assert.equal(beforeAuth.mtimeMs, afterAuth.mtimeMs, "auth mtime must not change");
      assert.equal(beforeBridge.exists, false);
      assert.equal(afterBridge.exists, false, "catalog must not create missing bridge");

      console.log(
        `  · pure-read: reconcile=${countOf(snapshot, "anyrouter.reconcile")}` +
          ` bridge_mut=0 auth_mirror=0` +
          ` raw_read=${countOf(snapshot, "credential.raw_read")}`,
      );
    });

    await test("second catalog-like load stays pure-read after explicit bootstrap", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetAnyRouterRuntimeBridgeStateForTests();
      enableModelCatalogMetrics(true);

      // Explicit mutation/bootstrap path may create the catalog-only bridge once.
      await ensureAnyRouterRuntimeMirrorsBootstrapped();
      assert.equal((await safeStatMeta(bridgePath)).exists, true, "bootstrap creates bridge");

      resetModelCatalogMetrics();
      networkCalls = 0;

      const beforeAuth = await safeStatMeta(authPath);
      const beforeAuthFp = await fileFingerprint(authPath);
      const beforeBridge = await safeStatMeta(bridgePath);
      const beforeBridgeFp = await fileFingerprint(bridgePath);

      await catalogLikeLoad(createWebAgentSessionServices, agentDir);

      const afterAuth = await safeStatMeta(authPath);
      const afterAuthFp = await fileFingerprint(authPath);
      const afterBridge = await safeStatMeta(bridgePath);
      const afterBridgeFp = await fileFingerprint(bridgePath);
      const snapshot = getModelCatalogMetricsSnapshot();

      assert.equal(networkCalls, 0);
      assert.equal(countOf(snapshot, "anyrouter.reconcile"), 0);
      assert.equal(
        countOf(snapshot, "anyrouter.bridge_write") +
          countOf(snapshot, "anyrouter.bridge_remove") +
          countOf(snapshot, "anyrouter.auth_mirror_set") +
          countOf(snapshot, "anyrouter.auth_mirror_clear"),
        0,
      );
      assert.equal(beforeAuthFp, afterAuthFp);
      assert.equal(beforeBridgeFp, afterBridgeFp);
      assert.equal(beforeAuth.mtimeMs, afterAuth.mtimeMs);
      assert.equal(beforeBridge.mtimeMs, afterBridge.mtimeMs);

      console.log(
        `  · second pure-read after bootstrap: reconcile=0` +
          ` authFpEqual=true bridgeFpEqual=true mtimeStable=true`,
      );
    });

    await test("explicit reconcile no-ops when mirrors already match", async () => {
      __resetAnyRouterRuntimeBridgeStateForTests();
      enableModelCatalogMetrics(true);
      // Ensure bridge exists from previous bootstrap.
      await ensureAnyRouterRuntimeMirrorsBootstrapped();
      resetModelCatalogMetrics();

      const beforeAuth = await safeStatMeta(authPath);
      const beforeAuthFp = await fileFingerprint(authPath);
      const beforeBridge = await safeStatMeta(bridgePath);
      const beforeBridgeFp = await fileFingerprint(bridgePath);

      await reconcileAnyRouterRuntimeMirrors();

      const afterAuth = await safeStatMeta(authPath);
      const afterAuthFp = await fileFingerprint(authPath);
      const afterBridge = await safeStatMeta(bridgePath);
      const afterBridgeFp = await fileFingerprint(bridgePath);
      const snapshot = getModelCatalogMetricsSnapshot();

      assert.equal(countOf(snapshot, "anyrouter.reconcile"), 1);
      assert.ok(
        countOf(snapshot, "anyrouter.reconcile_noop") >= 1 ||
          (countOf(snapshot, "anyrouter.bridge_noop") >= 1 &&
            countOf(snapshot, "anyrouter.auth_mirror_noop") >= 1),
        "expected equal-value no-op counters",
      );
      assert.equal(
        countOf(snapshot, "anyrouter.bridge_write") +
          countOf(snapshot, "anyrouter.bridge_remove"),
        0,
        "matched bridge must not rewrite",
      );
      assert.equal(
        countOf(snapshot, "anyrouter.auth_mirror_set") +
          countOf(snapshot, "anyrouter.auth_mirror_clear"),
        0,
        "matched auth must not rewrite",
      );
      assert.equal(beforeAuthFp, afterAuthFp);
      assert.equal(beforeBridgeFp, afterBridgeFp);
      assert.equal(beforeAuth.mtimeMs, afterAuth.mtimeMs);
      assert.equal(beforeBridge.mtimeMs, afterBridge.mtimeMs);

      console.log(
        `  · explicit reconcile no-op: reconcile=${countOf(snapshot, "anyrouter.reconcile")}` +
          ` reconcile_noop=${countOf(snapshot, "anyrouter.reconcile_noop")}` +
          ` bridge_noop=${countOf(snapshot, "anyrouter.bridge_noop")}` +
          ` auth_mirror_noop=${countOf(snapshot, "anyrouter.auth_mirror_noop")}`,
      );
    });

    await test("concurrent explicit reconciles share one flight", async () => {
      __resetAnyRouterRuntimeBridgeStateForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();

      const concurrency = 4;
      await Promise.all(
        Array.from({ length: concurrency }, () => reconcileAnyRouterRuntimeMirrors()),
      );
      const snapshot = getModelCatalogMetricsSnapshot();
      assert.equal(
        countOf(snapshot, "anyrouter.reconcile"),
        1,
        "exactly one reconcile owner under concurrent explicit callers",
      );
      assert.ok(
        countOf(snapshot, "anyrouter.reconcile_shared") >= concurrency - 1,
        "remaining callers must share the flight",
      );
      console.log(
        `  · concurrent reconcile x${concurrency}: owner=${countOf(snapshot, "anyrouter.reconcile")}` +
          ` shared=${countOf(snapshot, "anyrouter.reconcile_shared")}`,
      );
    });

    await test("concurrent catalog-like loads never reconcile", async () => {
      __resetWebModelRuntimeCacheForTests();
      __resetWebCredentialStoreCacheForTests();
      __resetAnyRouterRuntimeBridgeStateForTests();
      enableModelCatalogMetrics(true);
      resetModelCatalogMetrics();
      networkCalls = 0;

      const concurrency = 4;
      await Promise.all(
        Array.from({ length: concurrency }, () =>
          catalogLikeLoad(createWebAgentSessionServices, agentDir),
        ),
      );
      const snapshot = getModelCatalogMetricsSnapshot();
      assert.equal(networkCalls, 0);
      assert.equal(countOf(snapshot, "anyrouter.reconcile"), 0);
      assert.equal(
        countOf(snapshot, "anyrouter.bridge_write") +
          countOf(snapshot, "anyrouter.bridge_remove") +
          countOf(snapshot, "anyrouter.auth_mirror_set") +
          countOf(snapshot, "anyrouter.auth_mirror_clear"),
        0,
      );
      console.log(
        `  · concurrent catalog x${concurrency}: reconcile=0` +
          ` runtime.create=${countOf(snapshot, "runtime.create")}` +
          ` raw_read=${countOf(snapshot, "credential.raw_read")}`,
      );
    });

    await test("metrics / logs remain content-safe", async () => {
      const line = formatModelCatalogMetricsLine(getModelCatalogMetricsSnapshot());
      assert.ok(!line.includes(agentDir));
      assert.ok(!line.includes("offline-catalog-fixture-key"));
      assert.ok(!line.includes("anyrouter-offline"));
      assert.ok(!line.includes("provider.json"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    __resetModelCatalogMetricsForTests();
    __resetWebModelRuntimeCacheForTests();
    __resetWebCredentialStoreCacheForTests();
    __resetAnyRouterRuntimeBridgeStateForTests();
    await rm(agentDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
