/**
 * Models-config request lifecycle races + MCR-01 direct PUT semantic
 * false-success regressions.
 *
 * Run: npm run test:models-config-races
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import {
  mergeRevisionedOAuthVerification,
  ModelsRequestLifecycle,
} from "../lib/models-config-lifecycle.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), {
  interopDefault: true,
  alias: { "@": root },
});

function deferredFetch(signal) {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  // Deliberately ignores AbortSignal: this is the provider/fetch behavior that
  // makes generation and lifecycle checks the actual commit boundary.
  return { promise, resolve, signal };
}

async function settleRequest(gate, token, deferred, commit) {
  const value = await deferred.promise;
  if (gate.isCurrent(token)) commit(value);
}

async function testSlowFirstFastSecond() {
  const gate = new ModelsRequestLifecycle();
  const first = gate.begin("catalog");
  const firstAbort = new AbortController();
  const slow = deferredFetch(firstAbort.signal);
  let rows = [];
  const firstCommit = settleRequest(gate, first, slow, (value) => { rows = value; });

  const second = gate.begin("catalog");
  firstAbort.abort();
  assert.equal(slow.signal.aborted, true, "test setup must settle S1 despite abort");
  const fast = deferredFetch();
  const secondCommit = settleRequest(gate, second, fast, (value) => { rows = value; });
  fast.resolve(["S2"]);
  await secondCommit;
  slow.resolve(["S1"]);
  await firstCommit;
  assert.deepEqual(rows, ["S2"], "S1 must not overwrite a newer catalog generation");
}

async function testCloseReopen() {
  const oldModal = new ModelsRequestLifecycle();
  const oldRequest = oldModal.begin("config");
  const closeAbort = new AbortController();
  const slow = deferredFetch(closeAbort.signal);
  let oldCommits = 0;
  const pending = settleRequest(oldModal, oldRequest, slow, () => { oldCommits += 1; });
  closeAbort.abort();
  oldModal.close();
  assert.equal(slow.signal.aborted, true, "closed request still settles despite abort");

  const reopenedModal = new ModelsRequestLifecycle();
  const fresh = reopenedModal.begin("config");
  let config = null;
  assert.ok(reopenedModal.isCurrent(fresh));
  slow.resolve({ providers: { stale: {} } });
  await pending;
  assert.equal(oldCommits, 0, "a settled request after close must not commit");
  config = { providers: { fresh: {} } };
  assert.deepEqual(config, { providers: { fresh: {} } });
}

async function testProviderAndAccountSwitch() {
  const gate = new ModelsRequestLifecycle();
  const grokA = gate.begin("quota", { providerId: "grok-cli", accountId: "A" });
  const grokAResult = deferredFetch();
  let quota = null;
  const oldQuota = settleRequest(gate, grokA, grokAResult, (value) => { quota = value; });

  const kiroB = gate.begin("quota", { providerId: "kiro", accountId: "B" });
  const kiroBResult = deferredFetch();
  const newQuota = settleRequest(gate, kiroB, kiroBResult, (value) => { quota = value; });
  kiroBResult.resolve("kiro-B");
  await newQuota;
  grokAResult.resolve("grok-A");
  await oldQuota;
  assert.equal(quota, "kiro-B", "provider/account A cannot commit after switching to B");
}

async function testMutationBeatsOldGet() {
  const gate = new ModelsRequestLifecycle();
  const oldGet = gate.begin("accounts", { providerId: "grok-cli" });
  const deferred = deferredFetch();
  let accounts = ["before"];
  const pending = settleRequest(gate, oldGet, deferred, (value) => { accounts = value; });

  // A mutation invalidates reads before the POST starts, then its safe response
  // is committed synchronously as the authoritative local projection.
  gate.invalidate("accounts");
  accounts = ["new-active"];
  deferred.resolve(["old-active"]);
  await pending;
  assert.deepEqual(accounts, ["new-active"], "old GET cannot overwrite mutation response");
}

function testVerificationRevisionOwnership() {
  const summary = [{
    id: "grok-cli",
    localStateRevision: "r2",
    localConfigured: true,
    accountCount: 2,
    activeAccountDisplayName: "new",
    loggedIn: true,
  }];
  const stale = mergeRevisionedOAuthVerification(summary, [{
    id: "grok-cli",
    verification: { basedOnRevision: "r1", state: "invalid" },
  }]);
  assert.strictEqual(stale[0], summary[0], "verification with another revision must not merge");

  const current = mergeRevisionedOAuthVerification(summary, [{
    id: "grok-cli",
    verification: { basedOnRevision: "r2", state: "invalid" },
  }]);
  assert.equal(current[0].loggedIn, false);
  assert.equal(current[0].accountCount, 2, "verification cannot own account count");
  assert.equal(current[0].activeAccountDisplayName, "new", "verification cannot own Active selection");
}

async function testRevealAndCopyLateResult() {
  const gate = new ModelsRequestLifecycle();
  const revealA = gate.begin("reveal", { providerId: "xai", accountId: "A" });
  const slowReveal = deferredFetch();
  let plaintext = null;
  let copied = false;
  const pending = settleRequest(gate, revealA, slowReveal, (key) => {
    plaintext = key;
    copied = true;
  });

  // Switching provider clears sensitive state and starts a fresh reveal lane.
  gate.begin("reveal", { providerId: "anyrouter", accountId: "B" });
  plaintext = null;
  copied = false;
  slowReveal.resolve("sk-old-secret");
  await pending;
  assert.equal(plaintext, null, "late plaintext must not enter the next provider state");
  assert.equal(copied, false, "late reveal must not trigger copy state");
}

async function seedModelsConfigAgentDir(agentDir) {
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify(
      {
        alpha: { type: "api_key", key: "fake-alpha-key" },
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
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      { defaultProvider: "alpha", defaultModel: "model-a" },
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

async function testDirectPutSemanticFalseSuccessRegressions() {
  process.env.PI_OFFLINE = "1";
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-models-config-mcr01-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("unexpected network during models-config MCR-01 suite");
  };

  try {
    await seedModelsConfigAgentDir(agentDir);

    const runtimeMod = await jiti.import(join(root, "lib/web-model-runtime.ts"));
    const catalogMod = await jiti.import(join(root, "lib/model-catalog-service.ts"));
    const storeMod = await jiti.import(join(root, "lib/models-config-store.ts"));
    const routeMod = await jiti.import(join(root, "app/api/models-config/route.ts"));

    const {
      createWebModelRuntime,
      __resetWebModelRuntimeCacheForTests,
    } = runtimeMod;
    const {
      getWebModelCatalogSnapshot,
      getWebModelCatalogEpoch,
      __resetWebModelCatalogForTests,
    } = catalogMod;
    const { readModelsJsonRaw } = storeMod;

    __resetWebModelCatalogForTests();
    __resetWebModelRuntimeCacheForTests();

    const before = readModelsJsonRaw();
    assert.equal(before.parseError, undefined);
    const beforeRevision = before.revision;
    const beforeRaw = await readFile(join(agentDir, "models.json"), "utf8");
    const epochBefore = getWebModelCatalogEpoch();

    // Warm shared catalog so later partial/empty success would be observable.
    const warmCatalog = await getWebModelCatalogSnapshot({ cwd: agentDir, agentDir });
    assert.ok(warmCatalog.modelList.some((m) => m.provider === "alpha" && m.id === "model-a"));

    const missingBaseUrlBody = {
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
        broken: {
          api: "openai-completions",
          apiKey: "broken-fake-key",
          models: [
            {
              id: "broken-model",
              name: "Broken",
              reasoning: false,
              input: ["text"],
            },
          ],
        },
      },
    };

    const putFailures = [];

    const putRes = await routeMod.PUT(
      new Request("http://local/api/models-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(missingBaseUrlBody),
      }),
    );
    const putBody = await putRes.json();
    const afterRaw = await readFile(join(agentDir, "models.json"), "utf8");
    const after = readModelsJsonRaw();

    if (putRes.status !== 422) {
      putFailures.push(
        `missing baseUrl PUT expected 422, got ${putRes.status} success=${putBody.success === true}`,
      );
    }
    if (putBody.code !== "models_config_invalid" && putRes.status === 422) {
      putFailures.push(`missing baseUrl PUT code=${putBody.code}`);
    }
    if (afterRaw !== beforeRaw) {
      putFailures.push("missing baseUrl PUT rewrote models.json (must be no-write)");
    }
    if (after.revision !== beforeRevision && putRes.status === 422) {
      putFailures.push("missing baseUrl PUT changed revision");
    }
    if (getWebModelCatalogEpoch() !== epochBefore && putRes.status === 422) {
      putFailures.push("missing baseUrl PUT advanced catalog epoch");
    }
    if (JSON.stringify(putBody).includes("baseUrl")) {
      putFailures.push("PUT error body leaked baseUrl detail");
    }
    if (JSON.stringify(putBody).includes(agentDir)) {
      putFailures.push("PUT error body leaked operator path");
    }

    // Restore pristine bytes before the empty-id attempt when current code wrote.
    await writeFile(join(agentDir, "models.json"), beforeRaw, { mode: 0o600 });

    // Empty model id currently can write and make Pi reject the whole models.json.
    // Desired contract: 422 no-write, preserving the prior valid alpha provider.
    const emptyIdBody = {
      providers: {
        alpha: {
          baseUrl: "http://127.0.0.1:9",
          api: "openai-completions",
          apiKey: "fake-alpha-key",
          models: [
            {
              id: "",
              name: "Empty",
              reasoning: false,
              input: ["text"],
            },
          ],
        },
      },
    };
    const emptyRes = await routeMod.PUT(
      new Request("http://local/api/models-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(emptyIdBody),
      }),
    );
    const emptyBody = await emptyRes.json();
    const afterEmptyRaw = await readFile(join(agentDir, "models.json"), "utf8");
    if (emptyRes.status !== 422) {
      putFailures.push(
        `empty model id PUT expected 422, got ${emptyRes.status} success=${emptyBody.success === true}`,
      );
    }
    if (emptyBody.code !== "models_config_invalid" && emptyRes.status === 422) {
      putFailures.push(`empty model id PUT code=${emptyBody.code}`);
    }
    if (afterEmptyRaw !== beforeRaw) {
      putFailures.push("empty model id PUT rewrote models.json (must be no-write)");
    }
    if (getWebModelCatalogEpoch() !== epochBefore) {
      putFailures.push("semantic invalid PUT advanced catalog epoch");
    }

    // MCR-02: structurally valid provider without auth must still save (loaded,
    // not available). Do not require getAvailableSnapshot presence.
    const noAuthBody = {
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
        nokey: {
          baseUrl: "http://127.0.0.1:9",
          api: "openai-completions",
          models: [
            {
              id: "nokey-model",
              name: "No Key",
              reasoning: false,
              input: ["text"],
            },
          ],
        },
      },
    };
    const noAuthRes = await routeMod.PUT(
      new Request("http://local/api/models-config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${beforeRevision}"`,
        },
        body: JSON.stringify(noAuthBody),
      }),
    );
    const noAuthBodyJson = await noAuthRes.json();
    if (noAuthRes.status !== 200 || noAuthBodyJson.success !== true) {
      putFailures.push(
        `no-auth provider PUT expected success wire, got ${noAuthRes.status} success=${noAuthBodyJson.success}`,
      );
    }
    if (typeof noAuthBodyJson.revision !== "string" || !noAuthBodyJson.revision) {
      putFailures.push("no-auth provider PUT missing revision");
    }
    const afterNoAuth = readModelsJsonRaw();
    if (!afterNoAuth.exists || afterNoAuth.parseError) {
      putFailures.push("no-auth provider PUT left models.json unreadable");
    } else if (!afterNoAuth.parsed?.providers?.nokey) {
      putFailures.push("no-auth provider PUT did not persist nokey provider");
    }

    // Valid complete provider append keeps existing success wire.
    const afterNoAuthRevision = afterNoAuth.revision;
    const validAppendBody = {
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
        nokey: noAuthBody.providers.nokey,
      },
    };
    const validRes = await routeMod.PUT(
      new Request("http://local/api/models-config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${afterNoAuthRevision}"`,
        },
        body: JSON.stringify(validAppendBody),
      }),
    );
    const validBody = await validRes.json();
    if (validRes.status !== 200 || validBody.success !== true) {
      putFailures.push(
        `valid append PUT expected success, got ${validRes.status} success=${validBody.success}`,
      );
    }
    if (typeof validBody.revision !== "string" || validBody.revision === afterNoAuthRevision) {
      putFailures.push("valid append PUT must advance revision");
    }

    // Composition control only (catalog fail-closed is owned by MCR-03).
    await writeFile(
      join(agentDir, "models.json"),
      `${JSON.stringify(missingBaseUrlBody, null, 2)}\n`,
      { mode: 0o600 },
    );
    __resetWebModelRuntimeCacheForTests();

    const brokenRuntime = await createWebModelRuntime({
      agentDir,
      allowModelNetwork: false,
    });
    await brokenRuntime.refresh({ allowNetwork: false });
    assert.ok(
      brokenRuntime.getError(),
      "missing baseUrl must produce runtime.getError after load",
    );
    assert.equal(
      brokenRuntime.getModel("broken", "broken-model"),
      undefined,
      "broken provider must be absent from composition",
    );

    assert.equal(networkCalls, 0, "MCR-02 candidate verification suite must stay offline");

    if (putFailures.length > 0) {
      assert.fail(putFailures.join("; "));
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

let passed = 0;
let failed = 0;

async function run(name, fn) {
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

console.log("\n=== models-config races + MCR-01 false-success ===\n");

await run("slow first / fast second generation", testSlowFirstFastSecond);
await run("close reopen does not commit", testCloseReopen);
await run("provider/account switch", testProviderAndAccountSwitch);
await run("mutation beats old GET", testMutationBeatsOldGet);
await run("verification revision ownership", async () => {
  testVerificationRevisionOwnership();
});
await run("reveal/copy late result", testRevealAndCopyLateResult);
await run(
  "MCR-02: direct PUT semantic invalid is 422 no-write; valid/no-auth still save",
  testDirectPutSemanticFalseSuccessRegressions,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
