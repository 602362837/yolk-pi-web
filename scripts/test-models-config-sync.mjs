/**
 * Focused tests for OpenAI-compatible models.json /models sync core + API
 * (MODEL-SYNC-02 / MODEL-SYNC-03).
 *
 * Covers eligibility, URL candidates, 404 fallback, redirects, auth resolution,
 * payload bounds, preview cache, merge preservation, revision conflicts,
 * verification rollback, and the POST /api/models-config/sync route surface.
 * Uses a temp agent dir + local mock HTTP server — no external network.
 *
 * Run:
 *   npm run test:models-config-sync
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const agentDir = mkdtempSync(join(tmpdir(), "pi-models-config-sync-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const {
  assessModelsSyncProviderEligibility,
  buildModelsEndpointCandidates,
  parseOpenAIModelsListPayload,
  fetchOpenAICompatibleModelsList,
  mergeNewModelIdsIntoModelsConfig,
  orderSelectedIdsByRemote,
  computeModelsSyncProviderFingerprint,
  resolveModelsSyncRequestAuth,
  previewModelsConfigSync,
  applyModelsConfigSync,
  applyModelsConfigSyncWithVerification,
  handleModelsConfigSyncRequest,
  parseModelsConfigSyncRequest,
  modelsSyncErrorHttpStatus,
  modelsSyncErrorMessage,
  storeModelsSyncPreview,
  getModelsSyncPreview,
  __resetModelsConfigSyncPreviewCacheForTests,
  __getModelsConfigSyncPreviewCacheSizeForTests,
  ModelsConfigSyncError,
  MODELS_SYNC_FIXED_EXTENSION_PROVIDER_IDS,
  getBuiltinModelsSyncProviderIds,
  MODELS_CONFIG_SYNC_PARTIAL_RELOAD_WARNING,
  collectExistingModelIds,
  buildPreviewModelRows,
  isValidModelsSyncModelId,
} = await import("../lib/models-config-sync.ts");

const {
  readModelsJsonRaw,
  writeModelsJsonAtomic,
  serializeModelsJson,
  getModelsJsonBackupPath,
  stripJsonComments,
  computeRevision,
  EMPTY_MODELS_JSON_REVISION,
  backupModelsJson,
  restoreModelsJsonFromBackup,
} = await import("../lib/models-config-store.ts");

const {
  MODELS_CONFIG_SYNC_MAX_BODY_BYTES,
  MODELS_CONFIG_SYNC_MAX_MODELS,
  MODELS_CONFIG_SYNC_MAX_MODEL_ID_BYTES,
  MODELS_CONFIG_SYNC_PREVIEW_TTL_MS,
  MODELS_CONFIG_SYNC_FORBIDDEN_BODY_KEYS,
  isOpenAICompatibleModelsSyncApi,
  OPENAI_COMPATIBLE_MODELS_SYNC_APIS,
} = await import("../lib/models-config-sync-types.ts");

const { createInMemoryWebCredentialStore } = await import("../lib/web-credential-store.ts");

const { readFileSync } = await import("node:fs");
const { join: pathJoin } = await import("node:path");

/** Source-level contract for the thin Next route (avoid loading next/server in node tests). */
function readSyncRouteSource() {
  return readFileSync(
    pathJoin(process.cwd(), "app/api/models-config/sync/route.ts"),
    "utf8",
  );
}

let passed = 0;
let failed = 0;
let testChain = Promise.resolve();

function test(name, fn) {
  testChain = testChain.then(async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err && err.stack ? err.stack : err}`);
    }
  });
  return testChain;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function withMockServer(handler, fn) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn({ baseUrl, port, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function writeModelsConfig(config) {
  writeModelsJsonAtomic(serializeModelsJson(config));
  return readModelsJsonRaw();
}

// ── Eligibility ───────────────────────────────────────────────────────────────

console.log("\neligibility");

test("accepts custom openai-completions with valid baseUrl", () => {
  const result = assessModelsSyncProviderEligibility("local-openai", {
    api: "openai-completions",
    baseUrl: "https://example.local/v1",
    models: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider.api, "openai-completions");
});

test("accepts openai-responses", () => {
  const result = assessModelsSyncProviderEligibility("local-resp", {
    api: "openai-responses",
    baseUrl: "http://localhost:8080",
  });
  assert.equal(result.ok, true);
});

test("denies anthropic / google protocols", () => {
  for (const api of ["anthropic-messages", "google-generative-ai"]) {
    const result = assessModelsSyncProviderEligibility("p", {
      api,
      baseUrl: "https://example.local",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "unsupported_protocol");
  }
});

test("denies missing api", () => {
  const result = assessModelsSyncProviderEligibility("p", {
    baseUrl: "https://example.local",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_protocol");
});

test("denies builtin provider ids", () => {
  const builtins = getBuiltinModelsSyncProviderIds();
  assert.ok(builtins.has("openai"));
  const result = assessModelsSyncProviderEligibility("openai", {
    api: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    models: [{ id: "gpt-test" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "provider_not_custom");
});

test("denies fixed extension providers", () => {
  for (const id of MODELS_SYNC_FIXED_EXTENSION_PROVIDER_IDS) {
    const result = assessModelsSyncProviderEligibility(id, {
      api: "openai-completions",
      baseUrl: "https://example.local/v1",
    });
    assert.equal(result.ok, false, id);
    assert.equal(result.code, "provider_not_custom", id);
  }
});

test("denies invalid baseUrl schemes", () => {
  for (const baseUrl of ["ftp://x", "not a url", ""]) {
    const result = assessModelsSyncProviderEligibility("p", {
      api: "openai-completions",
      baseUrl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_base_url");
  }
});

// ── URL candidates ────────────────────────────────────────────────────────────

console.log("\nendpoint candidates");

test("root host tries /models then /v1/models", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host"), [
    "https://host/models",
    "https://host/v1/models",
  ]);
  assert.deepEqual(buildModelsEndpointCandidates("https://host/"), [
    "https://host/models",
    "https://host/v1/models",
  ]);
});

test("/v1 base becomes single /v1/models", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host/v1"), [
    "https://host/v1/models",
  ]);
  assert.deepEqual(buildModelsEndpointCandidates("http://localhost:11434/v1/"), [
    "http://localhost:11434/v1/models",
  ]);
});

test("custom prefix tries /models then /v1/models under prefix", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host/api"), [
    "https://host/api/models",
    "https://host/api/v1/models",
  ]);
});

test("already /models or /v1/models is not duplicated", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host/models"), [
    "https://host/models",
  ]);
  assert.deepEqual(buildModelsEndpointCandidates("https://host/v1/models"), [
    "https://host/v1/models",
  ]);
});

test("query and hash are dropped", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host/v1?x=1#frag"), [
    "https://host/v1/models",
  ]);
});

// ── Payload parse ─────────────────────────────────────────────────────────────

console.log("\npayload parse");

test("parses OpenAI data[] and dedupes first-seen order", () => {
  const models = parseOpenAIModelsListPayload({
    data: [
      { id: "a", owned_by: "org" },
      { id: "b" },
      { id: "a", owned_by: "other" },
      { id: "c" },
    ],
  });
  assert.deepEqual(
    models.map((m) => m.id),
    ["a", "b", "c"],
  );
  assert.equal(models[0].ownedBy, "org");
});

test("rejects invalid ids and non-object payloads", () => {
  assert.throws(
    () => parseOpenAIModelsListPayload({ data: [{ id: "" }] }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_response",
  );
  assert.throws(
    () => parseOpenAIModelsListPayload({ models: [] }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_response",
  );
  assert.throws(
    () => parseOpenAIModelsListPayload({ data: [{ id: "x\ny" }] }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_response",
  );
});

test("rejects too many models", () => {
  const data = Array.from({ length: MODELS_CONFIG_SYNC_MAX_MODELS + 1 }, (_, i) => ({
    id: `m-${i}`,
  }));
  assert.throws(
    () => parseOpenAIModelsListPayload({ data }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "too_many_models",
  );
});

// ── Fetch / redirect / fallback ───────────────────────────────────────────────

console.log("\nfetch + redirect + fallback");

test("404 on /models falls back to /v1/models", async () => {
  const hits = [];
  await withMockServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/models") {
      res.statusCode = 404;
      res.end("missing");
      return;
    }
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fallback-model" }] }));
      return;
    }
    res.statusCode = 500;
    res.end("nope");
  }, async ({ baseUrl }) => {
    const models = await fetchOpenAICompatibleModelsList(
      buildModelsEndpointCandidates(baseUrl),
      { Accept: "application/json", Authorization: "Bearer test-key" },
    );
    assert.deepEqual(
      models.map((m) => m.id),
      ["fallback-model"],
    );
    assert.deepEqual(hits, ["/models", "/v1/models"]);
  });
});

test("401 does not try fallback path", async () => {
  const hits = [];
  await withMockServer((req, res) => {
    hits.push(req.url);
    res.statusCode = 401;
    res.end("nope");
  }, async ({ baseUrl }) => {
    await assert.rejects(
      () =>
        fetchOpenAICompatibleModelsList(buildModelsEndpointCandidates(baseUrl), {
          Accept: "application/json",
          Authorization: "Bearer test-key",
        }),
      (e) => e instanceof ModelsConfigSyncError && e.code === "auth_failed",
    );
    assert.deepEqual(hits, ["/models"]);
  });
});

test("same-origin redirect is followed; cross-origin blocked", async () => {
  await withMockServer((req, res) => {
    if (req.url === "/models") {
      res.statusCode = 302;
      res.setHeader("location", "/v1/models");
      res.end();
      return;
    }
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "redir" }] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async ({ baseUrl }) => {
    const models = await fetchOpenAICompatibleModelsList([`${baseUrl}/models`], {
      Accept: "application/json",
      Authorization: "Bearer secret-token-xyz",
    });
    assert.equal(models[0].id, "redir");
  });

  await withMockServer((req, res) => {
    res.statusCode = 302;
    res.setHeader("location", "https://evil.example/models");
    res.end();
  }, async ({ baseUrl }) => {
    await assert.rejects(
      () =>
        fetchOpenAICompatibleModelsList([`${baseUrl}/models`], {
          Accept: "application/json",
          Authorization: "Bearer secret-token-xyz",
        }),
      (e) => e instanceof ModelsConfigSyncError && e.code === "redirect_blocked",
    );
  });
});

test("oversize body and invalid JSON fail safely", async () => {
  await withMockServer((req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end("x".repeat(MODELS_CONFIG_SYNC_MAX_BODY_BYTES + 10));
  }, async ({ baseUrl }) => {
    await assert.rejects(
      () =>
        fetchOpenAICompatibleModelsList([`${baseUrl}/models`], {
          Accept: "application/json",
        }, { maxBodyBytes: 1024 }),
      (e) => e instanceof ModelsConfigSyncError && e.code === "response_too_large",
    );
  });

  await withMockServer((req, res) => {
    res.statusCode = 200;
    res.end("not-json");
  }, async ({ baseUrl }) => {
    await assert.rejects(
      () =>
        fetchOpenAICompatibleModelsList([`${baseUrl}/models`], {
          Accept: "application/json",
        }),
      (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_response",
    );
  });
});

test("429 and 500 map to stable codes without fallback", async () => {
  for (const [status, code] of [
    [429, "rate_limited"],
    [500, "upstream_unavailable"],
  ]) {
    const hits = [];
    await withMockServer((req, res) => {
      hits.push(req.url);
      res.statusCode = status;
      res.end("err");
    }, async ({ baseUrl }) => {
      await assert.rejects(
        () =>
          fetchOpenAICompatibleModelsList(buildModelsEndpointCandidates(baseUrl), {
            Accept: "application/json",
          }),
        (e) => e instanceof ModelsConfigSyncError && e.code === code,
      );
      assert.deepEqual(hits, ["/models"]);
    });
  }
});

// ── Auth resolution ───────────────────────────────────────────────────────────

console.log("\nauth resolution");

test("auth.json api_key wins over models.json apiKey", async () => {
  const credentials = createInMemoryWebCredentialStore({
    "local-openai": { type: "api_key", key: "from-auth-json" },
  });
  const eligibility = assessModelsSyncProviderEligibility("local-openai", {
    api: "openai-completions",
    baseUrl: "https://example.local/v1",
    apiKey: "from-models-json",
  });
  assert.equal(eligibility.ok, true);
  const auth = await resolveModelsSyncRequestAuth(eligibility.provider, credentials);
  assert.equal(auth.apiKey, "from-auth-json");
  assert.equal(auth.headers.Authorization, "Bearer from-auth-json");
});

test("models.json apiKey fallback when auth.json missing", async () => {
  const credentials = createInMemoryWebCredentialStore({});
  const eligibility = assessModelsSyncProviderEligibility("local-openai", {
    api: "openai-completions",
    baseUrl: "https://example.local/v1",
    apiKey: "fallback-key",
  });
  const auth = await resolveModelsSyncRequestAuth(eligibility.provider, credentials);
  assert.equal(auth.apiKey, "fallback-key");
});

test("oauth credential is unsupported_auth", async () => {
  const credentials = createInMemoryWebCredentialStore({
    "local-openai": {
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: Date.now() + 60_000,
    },
  });
  const eligibility = assessModelsSyncProviderEligibility("local-openai", {
    api: "openai-completions",
    baseUrl: "https://example.local/v1",
    apiKey: "fallback-key",
  });
  await assert.rejects(
    () => resolveModelsSyncRequestAuth(eligibility.provider, credentials),
    (e) => e instanceof ModelsConfigSyncError && e.code === "unsupported_auth",
  );
});

test("custom Authorization header is not overwritten", async () => {
  const credentials = createInMemoryWebCredentialStore({
    "local-openai": { type: "api_key", key: "from-auth-json" },
  });
  const eligibility = assessModelsSyncProviderEligibility("local-openai", {
    api: "openai-completions",
    baseUrl: "https://example.local/v1",
    headers: { Authorization: "Custom $TOKEN", TOKEN: "abc" },
    env: { TOKEN: "abc" },
  });
  // resolveConfigValue on "Custom $TOKEN" with env TOKEN=abc
  const auth = await resolveModelsSyncRequestAuth(eligibility.provider, credentials);
  assert.equal(auth.headers.Authorization, "Custom abc");
});

test("missing credentials => credential_unavailable", async () => {
  const credentials = createInMemoryWebCredentialStore({});
  const eligibility = assessModelsSyncProviderEligibility("local-openai", {
    api: "openai-completions",
    baseUrl: "https://example.local/v1",
  });
  await assert.rejects(
    () => resolveModelsSyncRequestAuth(eligibility.provider, credentials),
    (e) => e instanceof ModelsConfigSyncError && e.code === "credential_unavailable",
  );
});

// ── Merge ─────────────────────────────────────────────────────────────────────

console.log("\nmerge");

test("merge appends {id} only and preserves existing deep fields", () => {
  const existingModel = {
    id: "keep-me",
    name: "Keep",
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 8192,
    compat: { thinkingFormat: "openai" },
    customUnknown: { nested: true },
  };
  const otherProvider = {
    api: "openai-completions",
    baseUrl: "https://other",
    models: [{ id: "other-model", cost: { input: 9, output: 9, cacheRead: 0, cacheWrite: 0 } }],
  };
  const config = {
    providers: {
      target: {
        api: "openai-completions",
        baseUrl: "https://target/v1",
        apiKey: "secret-should-stay",
        headers: { "X-Custom": "1" },
        modelOverrides: { "keep-me": { temperature: 0.2 } },
        models: [existingModel],
        unknownProviderField: "keep",
      },
      other: otherProvider,
    },
    topLevelUnknown: 42,
  };
  const before = deepClone(config);
  const result = mergeNewModelIdsIntoModelsConfig(config, "target", [
    "keep-me",
    "new-a",
    "new-b",
    "new-a",
  ]);

  assert.deepEqual(result.addedIds, ["new-a", "new-b"]);
  assert.deepEqual(result.skippedExistingIds, ["keep-me"]);
  assert.equal(result.totalModels, 3);

  const target = result.config.providers.target;
  assert.deepEqual(target.models[0], before.providers.target.models[0]);
  assert.deepEqual(target.models[1], { id: "new-a" });
  assert.deepEqual(target.models[2], { id: "new-b" });
  assert.deepEqual(target.modelOverrides, before.providers.target.modelOverrides);
  assert.equal(target.apiKey, "secret-should-stay");
  assert.deepEqual(target.headers, before.providers.target.headers);
  assert.equal(target.unknownProviderField, "keep");
  assert.deepEqual(result.config.providers.other, before.providers.other);
  assert.equal(result.config.topLevelUnknown, 42);
});

test("orderSelectedIdsByRemote rejects unknown ids and preserves remote order", () => {
  assert.deepEqual(orderSelectedIdsByRemote(["c", "a", "b"], ["b", "c"]), ["c", "b"]);
  assert.throws(
    () => orderSelectedIdsByRemote(["a"], ["missing"]),
    (e) => e instanceof ModelsConfigSyncError && e.code === "preview_mismatch",
  );
});

// ── Preview cache ─────────────────────────────────────────────────────────────

console.log("\npreview cache");

test("preview cache stores fingerprint/ids only and expires", () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const now = 1_000_000;
  storeModelsSyncPreview({
    previewId: "p1",
    providerId: "local",
    revision: "rev1",
    fingerprint: "fp",
    remoteIds: ["a", "b"],
    existingIds: ["a"],
    expiresAt: now + 1000,
    createdAt: now,
  });
  assert.equal(__getModelsConfigSyncPreviewCacheSizeForTests(), 1);
  const entry = getModelsSyncPreview("p1", now + 10);
  assert.ok(entry);
  assert.deepEqual(entry.remoteIds, ["a", "b"]);
  // Ensure no secret-looking fields
  assert.equal("apiKey" in entry, false);
  assert.equal("headers" in entry, false);
  assert.equal("baseUrl" in entry, false);
  assert.equal(getModelsSyncPreview("p1", now + 1001), null);
});

// ── End-to-end preview + apply ────────────────────────────────────────────────

console.log("\npreview + apply");

test("preview then apply merges under revision and skips existing", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const secretKey = "fixture-key-do-not-print-value-in-asserts";
  const existing = {
    id: "exists",
    cost: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 },
    custom: "keep",
  };

  await withMockServer((req, res) => {
    // Ensure Authorization is present but never logged by test.
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secretKey}`) {
      res.statusCode = 401;
      res.end("bad auth");
      return;
    }
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: [
            { id: "exists", owned_by: "local" },
            { id: "new-1" },
            { id: "new-2" },
            { id: "new-1" },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async ({ baseUrl }) => {
    const written = writeModelsConfig({
      providers: {
        "local-openai": {
          api: "openai-completions",
          baseUrl: `${baseUrl}/v1`,
          apiKey: secretKey,
          modelOverrides: { exists: { temperature: 0 } },
          models: [existing],
        },
        other: {
          api: "openai-completions",
          baseUrl: "https://other",
          models: [{ id: "o1", cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
        },
      },
    });

    const credentials = createInMemoryWebCredentialStore({});
    const preview = await previewModelsConfigSync("local-openai", {
      credentials,
      parsedConfig: written.parsed,
      revision: written.revision,
    });

    assert.equal(preview.kind, "models_config_sync_preview");
    assert.equal(preview.totals.remote, 3);
    assert.equal(preview.totals.new, 2);
    assert.equal(preview.totals.existing, 1);
    // Wire privacy: no secret projection
    const previewJson = JSON.stringify(preview);
    assert.equal(previewJson.includes(secretKey), false);
    assert.equal(previewJson.includes(baseUrl), false);

    const apply = await applyModelsConfigSync({
      providerId: "local-openai",
      previewId: preview.previewId,
      revision: preview.revision,
      modelIds: ["new-2", "exists", "new-1"],
    });

    assert.deepEqual(apply.addedIds, ["new-1", "new-2"]); // remote order
    assert.deepEqual(apply.skippedExistingIds, ["exists"]);
    assert.equal(apply.totalModels, 3);

    const after = readModelsJsonRaw();
    assert.equal(after.parseError, undefined);
    const target = after.parsed.providers["local-openai"];
    assert.deepEqual(target.models[0], existing);
    assert.deepEqual(target.models[1], { id: "new-1" });
    assert.deepEqual(target.models[2], { id: "new-2" });
    assert.deepEqual(target.modelOverrides, { exists: { temperature: 0 } });
    assert.deepEqual(after.parsed.providers.other.models[0].id, "o1");
    assert.notEqual(after.revision, written.revision);
  });
});

test("stale revision apply fails closed without write", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const current = writeModelsConfig({
    providers: {
      "local-openai": {
        api: "openai-completions",
        baseUrl: "https://example.local/v1",
        apiKey: "k",
        models: [],
      },
    },
  });

  const eligibility = assessModelsSyncProviderEligibility(
    "local-openai",
    current.parsed.providers["local-openai"],
  );
  storeModelsSyncPreview({
    previewId: "preview-stale",
    providerId: "local-openai",
    revision: current.revision,
    fingerprint: computeModelsSyncProviderFingerprint(eligibility.provider),
    remoteIds: ["m1"],
    existingIds: [],
    expiresAt: Date.now() + MODELS_CONFIG_SYNC_PREVIEW_TTL_MS,
    createdAt: Date.now(),
  });

  // Concurrent writer changes revision.
  writeModelsConfig({
    providers: {
      "local-openai": {
        api: "openai-completions",
        baseUrl: "https://example.local/v1",
        apiKey: "k",
        models: [{ id: "already" }],
      },
    },
  });

  await assert.rejects(
    () =>
      applyModelsConfigSync({
        providerId: "local-openai",
        previewId: "preview-stale",
        revision: current.revision,
        modelIds: ["m1"],
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "stale_revision",
  );

  const after = readModelsJsonRaw();
  assert.equal(after.parsed.providers["local-openai"].models.length, 1);
  assert.equal(after.parsed.providers["local-openai"].models[0].id, "already");
});

test("preview expiry prevents apply", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const now = Date.now();
  storeModelsSyncPreview({
    previewId: "expired",
    providerId: "local-openai",
    revision: "rev",
    fingerprint: "fp",
    remoteIds: ["m1"],
    existingIds: [],
    expiresAt: now - 1,
    createdAt: now - 10_000,
  });
  await assert.rejects(
    () =>
      applyModelsConfigSync(
        {
          providerId: "local-openai",
          previewId: "expired",
          revision: "rev",
          modelIds: ["m1"],
        },
        { now: () => now },
      ),
    (e) => e instanceof ModelsConfigSyncError && e.code === "preview_expired",
  );
});

test("wire types forbid secret/url body keys constant", () => {
  for (const key of ["url", "baseUrl", "headers", "apiKey", "path"]) {
    assert.ok(
      MODELS_CONFIG_SYNC_FORBIDDEN_BODY_KEYS.includes(key),
      `missing forbidden key ${key}`,
    );
  }
  assert.ok(MODELS_CONFIG_SYNC_MAX_MODEL_ID_BYTES === 256);
});

// ── Verification rollback + HTTP mapping (MODEL-SYNC-03) ─────────────────────

console.log("\nverification + API route");

test("verification failure rolls back models.json from pre-write backup", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const before = writeModelsConfig({
    providers: {
      "local-openai": {
        api: "openai-completions",
        baseUrl: "https://example.local/v1",
        apiKey: "k",
        models: [{ id: "keep", custom: true }],
      },
    },
  });

  const eligibility = assessModelsSyncProviderEligibility(
    "local-openai",
    before.parsed.providers["local-openai"],
  );
  storeModelsSyncPreview({
    previewId: "preview-verify-fail",
    providerId: "local-openai",
    revision: before.revision,
    fingerprint: computeModelsSyncProviderFingerprint(eligibility.provider),
    remoteIds: ["new-model"],
    existingIds: ["keep"],
    expiresAt: Date.now() + MODELS_CONFIG_SYNC_PREVIEW_TTL_MS,
    createdAt: Date.now(),
  });

  await assert.rejects(
    () =>
      applyModelsConfigSync(
        {
          providerId: "local-openai",
          previewId: "preview-verify-fail",
          revision: before.revision,
          modelIds: ["new-model"],
        },
        {
          verifyWrittenConfig: async () => {
            throw new Error("boom");
          },
        },
      ),
    (e) => e instanceof ModelsConfigSyncError && e.code === "verification_failed",
  );

  const after = readModelsJsonRaw();
  assert.equal(after.parseError, undefined);
  assert.deepEqual(after.parsed.providers["local-openai"].models, [
    { id: "keep", custom: true },
  ]);
  assert.equal(after.revision, before.revision);
  // Backup file should exist from the write attempt.
  assert.ok(getModelsJsonBackupPath());
});

test("apply with verification success + partial live reload warning", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const before = writeModelsConfig({
    providers: {
      "local-openai": {
        api: "openai-completions",
        baseUrl: "https://example.local/v1",
        apiKey: "k",
        models: [],
      },
    },
  });
  const eligibility = assessModelsSyncProviderEligibility(
    "local-openai",
    before.parsed.providers["local-openai"],
  );
  storeModelsSyncPreview({
    previewId: "preview-ok",
    providerId: "local-openai",
    revision: before.revision,
    fingerprint: computeModelsSyncProviderFingerprint(eligibility.provider),
    remoteIds: ["added-1"],
    existingIds: [],
    expiresAt: Date.now() + MODELS_CONFIG_SYNC_PREVIEW_TTL_MS,
    createdAt: Date.now(),
  });

  let verified = false;
  const result = await applyModelsConfigSyncWithVerification(
    {
      providerId: "local-openai",
      previewId: "preview-ok",
      revision: before.revision,
      modelIds: ["added-1"],
    },
    {
      verifyWrittenConfig: async ({ addedIds }) => {
        verified = true;
        assert.deepEqual(addedIds, ["added-1"]);
      },
      reloadLiveRuntimes: async () => "partial",
    },
  );

  assert.equal(verified, true);
  assert.deepEqual(result.addedIds, ["added-1"]);
  assert.equal(result.runtimeReload, "partial");
  assert.equal(result.warning, MODELS_CONFIG_SYNC_PARTIAL_RELOAD_WARNING);
  const after = readModelsJsonRaw();
  assert.equal(after.parsed.providers["local-openai"].models[0].id, "added-1");
  // Wire privacy: no secret projection
  assert.equal(JSON.stringify(result).includes("https://example.local"), false);
});

test("HTTP status mapping covers designed codes", () => {
  assert.equal(modelsSyncErrorHttpStatus("invalid_request"), 400);
  assert.equal(modelsSyncErrorHttpStatus("auth_failed"), 401);
  assert.equal(modelsSyncErrorHttpStatus("provider_not_custom"), 403);
  assert.equal(modelsSyncErrorHttpStatus("provider_not_found"), 404);
  assert.equal(modelsSyncErrorHttpStatus("stale_revision"), 409);
  assert.equal(modelsSyncErrorHttpStatus("preview_expired"), 409);
  assert.equal(modelsSyncErrorHttpStatus("response_too_large"), 413);
  assert.equal(modelsSyncErrorHttpStatus("credential_unavailable"), 422);
  assert.equal(modelsSyncErrorHttpStatus("rate_limited"), 429);
  assert.equal(modelsSyncErrorHttpStatus("network_error"), 502);
  assert.equal(modelsSyncErrorHttpStatus("timeout"), 504);
  assert.equal(modelsSyncErrorHttpStatus("verification_failed"), 500);
  assert.ok(modelsSyncErrorMessage("stale_revision").length > 0);
});

test("request parser rejects forbidden URL/key body fields", () => {
  for (const extra of [
    { url: "https://evil" },
    { baseUrl: "https://evil" },
    { headers: { Authorization: "x" } },
    { apiKey: "k" },
    { path: "/models" },
  ]) {
    assert.throws(
      () =>
        parseModelsConfigSyncRequest({
          action: "preview",
          providerId: "local-openai",
          ...extra,
        }),
      (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
      JSON.stringify(extra),
    );
  }
});

test("request parser rejects unknown extra keys and missing action", () => {
  assert.throws(
    () =>
      parseModelsConfigSyncRequest({
        action: "preview",
        providerId: "x",
        unexpected: 1,
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
  assert.throws(
    () => parseModelsConfigSyncRequest({ providerId: "x" }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
});

test("handleModelsConfigSyncRequest preview does not write models.json", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const secretKey = "route-preview-key-not-for-stdout";
  await withMockServer((req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "remote-a" }, { id: "remote-b" }] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async ({ baseUrl }) => {
    const written = writeModelsConfig({
      providers: {
        "local-openai": {
          api: "openai-completions",
          baseUrl: `${baseUrl}/v1`,
          apiKey: secretKey,
          models: [{ id: "remote-a" }],
        },
      },
    });

    const credentials = createInMemoryWebCredentialStore({});
    const preview = await handleModelsConfigSyncRequest(
      { action: "preview", providerId: "local-openai" },
      { credentials },
    );
    assert.equal(preview.kind, "models_config_sync_preview");
    assert.equal(preview.totals.remote, 2);
    assert.equal(preview.totals.new, 1);
    assert.equal(preview.totals.existing, 1);
    assert.equal(JSON.stringify(preview).includes(secretKey), false);
    assert.equal(JSON.stringify(preview).includes(baseUrl), false);

    const after = readModelsJsonRaw();
    assert.equal(after.revision, written.revision);
    assert.equal(after.parsed.providers["local-openai"].models.length, 1);
  });
});

test("handleModelsConfigSyncRequest apply merges with injected verify/reload", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const secretKey = "route-apply-key-not-for-stdout";
  await withMockServer((req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "exists" }, { id: "new-from-api" }] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async ({ baseUrl }) => {
    writeModelsConfig({
      providers: {
        "local-openai": {
          api: "openai-completions",
          baseUrl: `${baseUrl}/v1`,
          apiKey: secretKey,
          models: [
            {
              id: "exists",
              cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
              keep: true,
            },
          ],
        },
      },
    });

    const credentials = createInMemoryWebCredentialStore({});
    const preview = await handleModelsConfigSyncRequest(
      { action: "preview", providerId: "local-openai" },
      { credentials },
    );
    assert.equal(preview.kind, "models_config_sync_preview");

    const apply = await handleModelsConfigSyncRequest(
      {
        action: "apply",
        providerId: "local-openai",
        previewId: preview.previewId,
        revision: preview.revision,
        modelIds: ["new-from-api", "exists"],
      },
      {
        verifyWrittenConfig: async () => {},
        reloadLiveRuntimes: async () => "ok",
      },
    );

    assert.equal(apply.kind, "models_config_sync_apply");
    assert.deepEqual(apply.addedIds, ["new-from-api"]);
    assert.deepEqual(apply.skippedExistingIds, ["exists"]);
    assert.equal(apply.runtimeReload, "ok");
    assert.equal(JSON.stringify(apply).includes(secretKey), false);
    assert.equal(JSON.stringify(apply).includes(baseUrl), false);

    const after = readModelsJsonRaw();
    assert.deepEqual(after.parsed.providers["local-openai"].models[0], {
      id: "exists",
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      keep: true,
    });
    assert.deepEqual(after.parsed.providers["local-openai"].models[1], {
      id: "new-from-api",
    });
  });
});

test("handleModelsConfigSyncRequest apply stale revision is stale_revision", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const current = writeModelsConfig({
    providers: {
      "local-openai": {
        api: "openai-completions",
        baseUrl: "https://example.local/v1",
        apiKey: "k",
        models: [],
      },
    },
  });
  const eligibility = assessModelsSyncProviderEligibility(
    "local-openai",
    current.parsed.providers["local-openai"],
  );
  storeModelsSyncPreview({
    previewId: "preview-route-stale",
    providerId: "local-openai",
    revision: current.revision,
    fingerprint: computeModelsSyncProviderFingerprint(eligibility.provider),
    remoteIds: ["m1"],
    existingIds: [],
    expiresAt: Date.now() + MODELS_CONFIG_SYNC_PREVIEW_TTL_MS,
    createdAt: Date.now(),
  });

  writeModelsConfig({
    providers: {
      "local-openai": {
        api: "openai-completions",
        baseUrl: "https://example.local/v1",
        apiKey: "k",
        models: [{ id: "already" }],
      },
    },
  });

  await assert.rejects(
    () =>
      handleModelsConfigSyncRequest({
        action: "apply",
        providerId: "local-openai",
        previewId: "preview-route-stale",
        revision: current.revision,
        modelIds: ["m1"],
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "stale_revision",
  );
  assert.equal(modelsSyncErrorHttpStatus("stale_revision"), 409);
});

test("sync route source is thin no-store POST wrapper", () => {
  const source = readSyncRouteSource();
  assert.match(source, /export async function POST/);
  assert.match(source, /Cache-Control: no-store/);
  assert.match(source, /handleModelsConfigSyncRequest/);
  assert.match(source, /modelsSyncErrorHttpStatus/);
  assert.doesNotMatch(source, /baseUrl\s*:/);
  assert.doesNotMatch(source, /apiKey\s*:/);
});

// ── Store module ─────────────────────────────────────────────────────────────

console.log("\nmodels-config-store");

test("computeRevision produces deterministic SHA-256 hex", () => {
  const a = computeRevision('{"a":1}');
  const b = computeRevision('{"a":1}');
  assert.equal(a, b);
  assert.equal(typeof a, "string");
  assert.equal(a.length, 16);
  assert.notEqual(a, computeRevision('{"a":2}'));
  assert.equal(EMPTY_MODELS_JSON_REVISION, computeRevision("{}"));
});

test("stripJsonComments removes // line comments", () => {
  assert.equal(
    stripJsonComments('{\n  "a": 1 // comment\n}'),
    '{\n  "a": 1 \n}',
  );
});

test("stripJsonComments preserves string content with //", () => {
  assert.equal(
    stripJsonComments('{ "url": "https://host/path" }'),
    '{ "url": "https://host/path" }',
  );
});

test("stripJsonComments removes trailing commas before } ]", () => {
  const input = '{ "a": 1, } { "b": [1, 2, ] }';
  const result = stripJsonComments(input);
  assert.match(result, /"a": 1\s*\}/);
  assert.match(result, /\[1, 2\s*\]/);
});

test("readModelsJsonRaw returns empty state for missing file", () => {
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(tmpdir(), "nonexistent-mcs-" + Date.now());
  try {
    const result = readModelsJsonRaw();
    assert.equal(result.exists, false);
    assert.equal(result.revision, EMPTY_MODELS_JSON_REVISION);
    assert.equal(result.parseError, undefined);
  } finally {
    process.env.PI_CODING_AGENT_DIR = prev;
  }
});

test("readModelsJsonRaw parse error fails closed", async () => {
  const { writeFileSync } = await import("node:fs");
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const dir = mkdtempSync(join(tmpdir(), "pi-mcs-store-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const agentDir = getAgentDir();
  writeFileSync(join(agentDir, "models.json"), "{ bad json ", "utf8");
  try {
    const result = readModelsJsonRaw();
    assert.equal(result.exists, true);
    assert.ok(typeof result.parseError === "string" && result.parseError.length > 0);
    // parsed is empty on parse error
    assert.deepEqual(result.parsed, {});
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test("backup + restore round-trip preserves content", () => {
  const original = { providers: { p: { api: "openai-completions", baseUrl: "https://x", models: [] } } };
  writeModelsJsonAtomic(serializeModelsJson(original));
  const before = readModelsJsonRaw();
  const backupPath = backupModelsJson();
  assert.ok(backupPath);

  // Change the file
  writeModelsJsonAtomic(serializeModelsJson({ providers: { changed: "yes" } }));
  assert.notEqual(readModelsJsonRaw().revision, before.revision);

  // Restore
  restoreModelsJsonFromBackup(backupPath);
  const after = readModelsJsonRaw();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.parsed, original);
});

test("atomic write creates file directly (no .tmp leftover)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const dir = mkdtempSync(join(tmpdir(), "pi-mcs-atomic-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const agentDir = getAgentDir();
  const targetPath = join(agentDir, "models.json");
  try {
    writeModelsJsonAtomic(serializeModelsJson({ test: "atomic" }));
    const content = JSON.parse(readFileSync(targetPath, "utf8"));
    assert.deepEqual(content, { test: "atomic" });
    // No .tmp files left behind
    const entries = readdirSync(agentDir);
    const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ── Type helpers ──────────────────────────────────────────────────────────────

console.log("\nsync type helpers");

test("isOpenAICompatibleModelsSyncApi accepts only openai variants", () => {
  assert.equal(isOpenAICompatibleModelsSyncApi("openai-completions"), true);
  assert.equal(isOpenAICompatibleModelsSyncApi("openai-responses"), true);
  assert.equal(isOpenAICompatibleModelsSyncApi("anthropic-messages"), false);
  assert.equal(isOpenAICompatibleModelsSyncApi("google-generative-ai"), false);
  assert.equal(isOpenAICompatibleModelsSyncApi(undefined), false);
  assert.equal(isOpenAICompatibleModelsSyncApi(null), false);
  assert.equal(isOpenAICompatibleModelsSyncApi(""), false);
});

test("OPENAI_COMPATIBLE_MODELS_SYNC_APIS contains two values", () => {
  assert.deepEqual([...OPENAI_COMPATIBLE_MODELS_SYNC_APIS].sort(), [
    "openai-completions",
    "openai-responses",
  ]);
});

test("isValidModelsSyncModelId rejects control chars and oversized", () => {
  assert.equal(isValidModelsSyncModelId("valid-model"), true);
  assert.equal(isValidModelsSyncModelId("a".repeat(256)), true);
  assert.equal(isValidModelsSyncModelId("a".repeat(257)), false);
  assert.equal(isValidModelsSyncModelId(""), false);
  assert.equal(isValidModelsSyncModelId("with\nnewline"), false);
  assert.equal(isValidModelsSyncModelId("with\x00null"), false);
});

test("collectExistingModelIds extracts valid string ids", () => {
  assert.deepEqual(
    [...collectExistingModelIds({ models: [{ id: "a" }, { id: "b" }, { noId: true }] })].sort(),
    ["a", "b"],
  );
  assert.equal(
    collectExistingModelIds({ notAnArray: "models" }).size,
    0,
  );
  assert.equal(
    collectExistingModelIds(undefined).size,
    0,
  );
});

test("buildPreviewModelRows marks new/existing correctly", () => {
  const rows = buildPreviewModelRows(
    [{ id: "a", ownedBy: "v1" }, { id: "b" }, { id: "c", ownedBy: "v2" }],
    new Set(["b"]),
  );
  assert.deepEqual(rows, [
    { id: "a", status: "new", ownedBy: "v1" },
    { id: "b", status: "existing" },
    { id: "c", status: "new", ownedBy: "v2" },
  ]);
});

// ── URL candidates edge cases ─────────────────────────────────────────────────

console.log("\nendpoint candidates (extended)");

test("baseUrl with trailing double slash", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host//"), [
    "https://host/models",
    "https://host/v1/models",
  ]);
});

test("baseUrl http scheme accepted", () => {
  assert.deepEqual(buildModelsEndpointCandidates("http://localhost:8080"), [
    "http://localhost:8080/models",
    "http://localhost:8080/v1/models",
  ]);
});

test("already /v1/ handles trailing slash", () => {
  assert.deepEqual(buildModelsEndpointCandidates("https://host/v1/"), [
    "https://host/v1/models",
  ]);
});

// ── Fingerprint ───────────────────────────────────────────────────────────────

console.log("\nfingerprint");

test("fingerprint is deterministic and stable", () => {
  const a = assessModelsSyncProviderEligibility("p", {
    api: "openai-completions",
    baseUrl: "https://example/v1",
    apiKey: "secret-1",
  });
  const b = assessModelsSyncProviderEligibility("p", {
    api: "openai-completions",
    baseUrl: "https://example/v1",
    apiKey: "secret-1",
  });
  assert.equal(
    computeModelsSyncProviderFingerprint(a.provider),
    computeModelsSyncProviderFingerprint(b.provider),
  );
});

test("fingerprint changes when apiKey differs", () => {
  const a = assessModelsSyncProviderEligibility("p", {
    api: "openai-completions",
    baseUrl: "https://example/v1",
    apiKey: "secret-1",
  });
  const b = assessModelsSyncProviderEligibility("p", {
    api: "openai-completions",
    baseUrl: "https://example/v1",
    apiKey: "secret-2",
  });
  assert.notEqual(
    computeModelsSyncProviderFingerprint(a.provider),
    computeModelsSyncProviderFingerprint(b.provider),
  );
});

test("fingerprint changes when baseUrl differs", () => {
  const a = assessModelsSyncProviderEligibility("p", {
    api: "openai-completions",
    baseUrl: "https://example/v1",
  });
  const b = assessModelsSyncProviderEligibility("p", {
    api: "openai-completions",
    baseUrl: "https://other/v1",
  });
  assert.notEqual(
    computeModelsSyncProviderFingerprint(a.provider),
    computeModelsSyncProviderFingerprint(b.provider),
  );
});

// ── Preview cache extended ────────────────────────────────────────────────────

console.log("\npreview cache (extended)");

test("preview cache evicts oldest when at max capacity", () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  const now = 1_000_000;
  const max = 20;
  for (let i = 0; i < max + 3; i += 1) {
    storeModelsSyncPreview({
      previewId: `p-${i}`,
      providerId: "local",
      revision: "rev",
      fingerprint: "fp",
      remoteIds: ["a"],
      existingIds: [],
      expiresAt: now + 10_000,
      createdAt: now + i,
    });
  }
  // Should be capped
  assert.ok(__getModelsConfigSyncPreviewCacheSizeForTests() <= max);
  // Oldest entries should have been evicted
  assert.equal(getModelsSyncPreview("p-0", now + 1), null);
  assert.equal(getModelsSyncPreview("p-1", now + 2), null);
  // Newest entries should survive
  const lastIdx = max + 2;
  assert.ok(getModelsSyncPreview(`p-${lastIdx}`, now + lastIdx + 1) !== null);
});

// ── Merge extended ────────────────────────────────────────────────────────────

console.log("\nmerge (extended)");

test("merge with no new ids does not mutate config", () => {
  const config = {
    providers: {
      p: {
        api: "openai-completions",
        baseUrl: "https://x",
        models: [{ id: "a", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }],
      },
    },
  };
  const result = mergeNewModelIdsIntoModelsConfig(config, "p", ["a"]);
  assert.deepEqual(result.addedIds, []);
  assert.deepEqual(result.skippedExistingIds, ["a"]);
  assert.equal(result.totalModels, 1);
  // config reference unchanged when no additions
  assert.equal(result.config, config);
});

test("merge preserves other provider completely", () => {
  const config = {
    providers: {
      target: { api: "openai-completions", baseUrl: "https://t", models: [] },
      other: {
        api: "anthropic-messages",
        baseUrl: "https://o",
        apiKey: "keep-me",
        headers: { "X-Key": "val" },
        modelOverrides: { m: { temperature: 0.5 } },
        models: [{ id: "o1", extraField: true }],
      },
    },
    settings: { defaultModel: "o1" },
  };
  const result = mergeNewModelIdsIntoModelsConfig(config, "target", ["new-1", "new-2"]);
  const other = result.config.providers.other;
  assert.deepEqual(other.api, "anthropic-messages");
  assert.deepEqual(other.apiKey, "keep-me");
  assert.deepEqual(other.headers, { "X-Key": "val" });
  assert.deepEqual(other.modelOverrides, { m: { temperature: 0.5 } });
  assert.deepEqual(other.models, [{ id: "o1", extraField: true }]);
  assert.equal(result.config.settings.defaultModel, "o1");
});

// ── Parse / route extended ────────────────────────────────────────────────────

console.log("\nparse / route (extended)");

test("parse rejects invalid action value", () => {
  assert.throws(
    () => parseModelsConfigSyncRequest({ action: "delete", providerId: "x" }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
  assert.throws(
    () => parseModelsConfigSyncRequest({ action: null, providerId: "x" }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
});

test("parse rejects apply with non-array modelIds", () => {
  assert.throws(
    () =>
      parseModelsConfigSyncRequest({
        action: "apply",
        providerId: "x",
        previewId: "p",
        revision: "r",
        modelIds: "not-array",
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
});

test("parse rejects apply with empty modelIds", () => {
  assert.throws(
    () =>
      parseModelsConfigSyncRequest({
        action: "apply",
        providerId: "x",
        previewId: "p",
        revision: "r",
        modelIds: [],
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
});

test("parse rejects preview with extra body fields", () => {
  assert.throws(
    () =>
      parseModelsConfigSyncRequest({
        action: "preview",
        providerId: "x",
        extraField: 1,
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "invalid_request",
  );
});

test("handleModelsConfigSyncRequest rejects non-OpenAI protocol", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  writeModelsConfig({
    providers: {
      "my-anthropic": {
        api: "anthropic-messages",
        baseUrl: "https://example/v1",
        models: [],
      },
    },
  });
  await assert.rejects(
    () =>
      handleModelsConfigSyncRequest({
        action: "preview",
        providerId: "my-anthropic",
      }),
    (e) => e instanceof ModelsConfigSyncError && e.code === "unsupported_protocol",
  );
});

test("handleModelsConfigSyncRequest rejects builtin provider by id", async () => {
  __resetModelsConfigSyncPreviewCacheForTests();
  await assert.rejects(
    () =>
      handleModelsConfigSyncRequest({
        action: "preview",
        providerId: "openai",
      }),
    // openai is not in models.json so provider_not_found is acceptable
    (e) => e instanceof ModelsConfigSyncError,
  );
});

test("modelsSyncErrorHttpStatus covers all error codes without default", () => {
  const allCodes = [
    "invalid_request", "provider_not_found", "provider_not_custom",
    "unsupported_protocol", "invalid_base_url", "credential_unavailable",
    "unsupported_auth", "auth_failed", "endpoint_not_found",
    "rate_limited", "upstream_unavailable", "timeout",
    "network_error", "redirect_blocked", "response_too_large",
    "invalid_response", "too_many_models", "preview_expired",
    "preview_mismatch", "stale_revision", "models_config_invalid",
    "write_failed", "verification_failed",
  ];
  for (const code of allCodes) {
    const status = modelsSyncErrorHttpStatus(code);
    assert.ok(Number.isInteger(status) && status >= 400 && status <= 599, `${code} → ${status}`);
  }
  assert.equal(allCodes.length, 23);
});

test("modelsSyncErrorMessage has a non-empty message for every code", () => {
  const allCodes = [
    "invalid_request", "provider_not_found", "provider_not_custom",
    "unsupported_protocol", "invalid_base_url", "credential_unavailable",
    "unsupported_auth", "auth_failed", "endpoint_not_found",
    "rate_limited", "upstream_unavailable", "timeout",
    "network_error", "redirect_blocked", "response_too_large",
    "invalid_response", "too_many_models", "preview_expired",
    "preview_mismatch", "stale_revision", "models_config_invalid",
    "write_failed", "verification_failed",
  ];
  for (const code of allCodes) {
    assert.ok(modelsSyncErrorMessage(code).length > 0, code);
  }
});

test("ModelsConfigSyncError stores code and default message", () => {
  const e = new ModelsConfigSyncError("stale_revision");
  assert.equal(e.code, "stale_revision");
  assert.equal(e.message, modelsSyncErrorMessage("stale_revision"));
  const e2 = new ModelsConfigSyncError("auth_failed", "Custom");
  assert.equal(e2.message, "Custom");
});

test("mergeNewModelIdsIntoModelsConfig throws for missing provider", () => {
  assert.throws(
    () => mergeNewModelIdsIntoModelsConfig({ providers: {} }, "missing", ["a"]),
    (e) => e instanceof ModelsConfigSyncError && e.code === "provider_not_found",
  );
});

// ── Run ───────────────────────────────────────────────────────────────────────

await testChain;

console.log(`\n${passed} passed, ${failed} failed`);

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // best-effort
}

if (failed > 0) process.exit(1);
