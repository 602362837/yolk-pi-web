#!/usr/bin/env node
/**
 * MLP-04 — browser model catalog resource races / single-flight.
 *
 * Pure module tests for hooks/useModelCatalog.ts (no React DOM).
 * Uses a controllable fake fetch; never touches network or agentDir.
 *
 * Server-side epoch races live in scripts/test-model-catalog-races.mjs.
 *
 * Run: node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-model-catalog-client.mjs
 *  or: npm run test:model-catalog-client
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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

function catalogBody(tag) {
  return {
    models: { [`m-${tag}`]: `Model ${tag}` },
    modelList: [
      {
        id: `m-${tag}`,
        name: `Model ${tag}`,
        provider: "p",
        providerDisplayName: "P",
      },
    ],
    defaultModel: { provider: "p", modelId: `m-${tag}` },
    thinkingLevels: { [`p:m-${tag}`]: ["off", "medium"] },
    thinkingLevelMaps: {},
  };
}

function deferred() {
  /** @type {(v: unknown) => void} */
  let resolve;
  /** @type {(e: unknown) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (v) => resolve(v),
    reject: (e) => reject(e),
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function main() {
  console.log("\n=== model-catalog client (MLP-04 shared resource) ===\n");

  const mod = await jiti.import(join(root, "hooks/useModelCatalog.ts"));
  const {
    ensureModelCatalog,
    invalidateModelCatalog,
    refreshModelCatalog,
    parseModelCatalogPayload,
    __resetModelCatalogForTests,
    __getModelCatalogSnapshotForTests,
    __getModelCatalogGenerationForTests,
    __getModelCatalogAbortCountForTests,
    __getModelCatalogInflightGenerationForTests,
  } = mod;

  // Node has no window; force ensure to run by defining a minimal window.
  if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis;
  }

  await test("parseModelCatalogPayload accepts wire shape", () => {
    const parsed = parseModelCatalogPayload(catalogBody("a"));
    assert.ok(parsed);
    assert.equal(parsed.modelList.length, 1);
    assert.equal(parsed.defaultModel?.modelId, "m-a");
    assert.deepEqual(parsed.thinkingLevels["p:m-a"], ["off", "medium"]);
  });

  await test("parseModelCatalogPayload rejects non-object models", () => {
    assert.equal(parseModelCatalogPayload({ modelList: [] }), null);
    assert.equal(parseModelCatalogPayload(null), null);
  });

  await test("concurrent ensure shares one flight", async () => {
    let fetchCount = 0;
    const gate = deferred();
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        fetchCount += 1;
        await gate.promise;
        return jsonResponse(catalogBody("shared"));
      },
    });

    const p1 = ensureModelCatalog();
    const p2 = ensureModelCatalog();
    const p3 = ensureModelCatalog();
    assert.equal(fetchCount, 1, "one fetch for concurrent ensure");
    assert.equal(__getModelCatalogSnapshotForTests().inflight, true);

    gate.resolve(undefined);
    await Promise.all([p1, p2, p3]);

    const snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "ready");
    assert.equal(snap.inflight, false);
    assert.equal(snap.data?.modelList[0]?.id, "m-shared");
    assert.equal(fetchCount, 1);
  });

  await test("ready generation is a no-op until invalidate", async () => {
    let fetchCount = 0;
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        fetchCount += 1;
        return jsonResponse(catalogBody("warm"));
      },
    });
    await ensureModelCatalog();
    assert.equal(fetchCount, 1);
    await ensureModelCatalog();
    await ensureModelCatalog();
    assert.equal(fetchCount, 1, "warm ensure must not refetch same generation");
  });

  await test("invalidate + ensure fetches next generation", async () => {
    let fetchCount = 0;
    let lastTag = "";
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        fetchCount += 1;
        lastTag = fetchCount === 1 ? "g0" : "g1";
        return jsonResponse(catalogBody(lastTag));
      },
    });

    await ensureModelCatalog();
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-g0");
    const gen0 = __getModelCatalogGenerationForTests();

    invalidateModelCatalog();
    assert.equal(__getModelCatalogGenerationForTests(), gen0 + 1);
    // last-good retained
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-g0");
    assert.notEqual(
      __getModelCatalogSnapshotForTests().dataGeneration,
      __getModelCatalogGenerationForTests(),
      "dataGeneration must lag after invalidate",
    );

    await ensureModelCatalog();
    assert.equal(fetchCount, 2);
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-g1");
    assert.equal(
      __getModelCatalogSnapshotForTests().dataGeneration,
      __getModelCatalogGenerationForTests(),
    );
  });

  await test("refreshModelCatalog force bumps generation and fetches", async () => {
    let fetchCount = 0;
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        fetchCount += 1;
        return jsonResponse(catalogBody(`r${fetchCount}`));
      },
    });
    await ensureModelCatalog();
    await refreshModelCatalog({ force: true });
    assert.equal(fetchCount, 2);
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-r2");
  });

  await test("stale generation response cannot overwrite newer catalog", async () => {
    const gen1Gate = deferred();
    const gen2Gate = deferred();
    let fetchCount = 0;
    /** @type {AbortSignal[]} */
    const signals = [];

    __resetModelCatalogForTests({
      fetchImpl: async (_url, init = {}) => {
        fetchCount += 1;
        const signal = init.signal;
        if (signal) signals.push(signal);
        if (fetchCount === 1) {
          await gen1Gate.promise;
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          return jsonResponse(catalogBody("stale"));
        }
        await gen2Gate.promise;
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        return jsonResponse(catalogBody("fresh"));
      },
    });

    const first = ensureModelCatalog();
    // Advance generation while first is still in flight.
    invalidateModelCatalog();
    assert.equal(
      __getModelCatalogAbortCountForTests(),
      1,
      "invalidate must abort the previous shared flight",
    );
    assert.equal(signals[0]?.aborted, true, "first request signal must be aborted");
    assert.equal(
      __getModelCatalogInflightGenerationForTests(),
      null,
      "aborted flight ownership is dropped",
    );
    const second = ensureModelCatalog();

    // Resolve newer generation first.
    gen2Gate.resolve(undefined);
    await second;
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-fresh");

    // Late stale response must not clobber (aborted path settles via AbortError).
    gen1Gate.resolve(undefined);
    await first;
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-fresh");
    assert.equal(__getModelCatalogSnapshotForTests().status, "ready");
    assert.notEqual(
      __getModelCatalogSnapshotForTests().error,
      "Aborted",
      "AbortError must not surface as catalog error",
    );
  });

  await test("invalidate aborts in-flight fetch and starts a new signal", async () => {
    const firstGate = deferred();
    /** @type {AbortSignal[]} */
    const signals = [];
    let fetchCount = 0;

    __resetModelCatalogForTests({
      fetchImpl: async (_url, init = {}) => {
        fetchCount += 1;
        const signal = init.signal;
        assert.ok(signal, "catalog fetch must pass AbortSignal");
        signals.push(signal);
        if (fetchCount === 1) {
          await firstGate.promise;
          if (signal.aborted) {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            throw err;
          }
          return jsonResponse(catalogBody("old"));
        }
        if (signal.aborted) {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          throw err;
        }
        return jsonResponse(catalogBody("new"));
      },
    });

    const first = ensureModelCatalog();
    assert.equal(fetchCount, 1);
    assert.equal(signals[0]?.aborted, false);

    await refreshModelCatalog({ force: true });
    assert.equal(fetchCount, 2, "force refresh starts next-generation fetch");
    assert.equal(__getModelCatalogAbortCountForTests(), 1);
    assert.equal(signals[0]?.aborted, true);
    assert.equal(signals[1]?.aborted, false);
    assert.equal(signals[0] === signals[1], false, "new generation uses a new controller");
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-new");

    firstGate.resolve(undefined);
    await first;
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-new");
    assert.equal(__getModelCatalogSnapshotForTests().status, "ready");
  });

  await test("concurrent waiters share one controller; unmount-style drop does not abort", async () => {
    const gate = deferred();
    /** @type {AbortSignal | null} */
    let sharedSignal = null;
    __resetModelCatalogForTests({
      fetchImpl: async (_url, init = {}) => {
        sharedSignal = init.signal ?? null;
        await gate.promise;
        if (sharedSignal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        return jsonResponse(catalogBody("shared-signal"));
      },
    });

    const p1 = ensureModelCatalog();
    const p2 = ensureModelCatalog();
    assert.ok(sharedSignal);
    assert.equal(sharedSignal.aborted, false);
    assert.equal(__getModelCatalogAbortCountForTests(), 0);
    // Simulate one subscriber unmount: dropping a Promise reference must not abort.
    void p2;
    assert.equal(sharedSignal.aborted, false);

    gate.resolve(undefined);
    await p1;
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-shared-signal");
    assert.equal(__getModelCatalogAbortCountForTests(), 0);
  });

  await test("abort of current generation without invalidate does not publish error", async () => {
    const gate = deferred();
    /** @type {AbortSignal | null} */
    let signal = null;
    __resetModelCatalogForTests({
      fetchImpl: async (_url, init = {}) => {
        signal = init.signal ?? null;
        await gate.promise;
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        return jsonResponse(catalogBody("never"));
      },
    });

    const p = ensureModelCatalog();
    // Test reset aborts any attached flight (same path as generation supersede).
    __resetModelCatalogForTests({
      fetchImpl: async () => jsonResponse(catalogBody("after-reset")),
    });
    gate.resolve(undefined);
    await p;
    const snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "idle");
    assert.equal(snap.error, null);
    assert.equal(snap.data, null);
  });

  await test("HTTP error keeps last-good and surfaces error", async () => {
    let call = 0;
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return jsonResponse(catalogBody("ok"));
        return jsonResponse(
          { error: "model_catalog_unavailable", code: "model_catalog_unavailable" },
          500,
        );
      },
    });
    await ensureModelCatalog();
    invalidateModelCatalog();
    await ensureModelCatalog();
    const snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "error");
    assert.equal(snap.error, "model_catalog_unavailable");
    assert.equal(snap.data?.modelList[0]?.id, "m-ok", "last-good retained");
  });

  await test("soft 200 empty catalog would overwrite last-good (why route must 500)", async () => {
    // Guardrail: if /api/models ever soft-fails with HTTP 200 + empty models,
    // parseModelCatalogPayload accepts it and the shared resource publishes empty.
    // Production route must therefore use non-2xx model_catalog_unavailable.
    let call = 0;
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return jsonResponse(catalogBody("ok"));
        return jsonResponse({
          models: {},
          modelList: [],
          defaultModel: null,
          thinkingLevels: {},
          thinkingLevelMaps: {},
        });
      },
    });
    await ensureModelCatalog();
    assert.equal(__getModelCatalogSnapshotForTests().data?.modelList[0]?.id, "m-ok");
    invalidateModelCatalog();
    await ensureModelCatalog();
    const snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "ready");
    assert.equal(snap.error, null);
    assert.equal(snap.data?.modelList.length, 0, "empty 200 publishes as success");
    assert.notEqual(snap.data?.modelList[0]?.id, "m-ok");
  });

  await test("recovery after catalog 500 restores ready without losing prior last-good mid-flight", async () => {
    let call = 0;
    __resetModelCatalogForTests({
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return jsonResponse(catalogBody("ok"));
        if (call === 2) {
          return jsonResponse(
            { error: "model_catalog_unavailable", code: "model_catalog_unavailable" },
            500,
          );
        }
        return jsonResponse(catalogBody("recovered"));
      },
    });
    await ensureModelCatalog();
    invalidateModelCatalog();
    await ensureModelCatalog();
    let snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "error");
    assert.equal(snap.error, "model_catalog_unavailable");
    assert.equal(snap.data?.modelList[0]?.id, "m-ok", "last-good retained through failure");

    invalidateModelCatalog();
    await ensureModelCatalog();
    snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "ready");
    assert.equal(snap.error, null);
    assert.equal(snap.data?.modelList[0]?.id, "m-recovered");
    assert.equal(call, 3);
  });

  await test("invalid payload yields error without publishing", async () => {
    __resetModelCatalogForTests({
      fetchImpl: async () => jsonResponse({ not: "catalog" }),
    });
    await ensureModelCatalog();
    const snap = __getModelCatalogSnapshotForTests();
    assert.equal(snap.status, "error");
    assert.equal(snap.error, "invalid_model_catalog");
    assert.equal(snap.data, null);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
