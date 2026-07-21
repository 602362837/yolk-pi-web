#!/usr/bin/env node
/**
 * antigravity-subscription-quota — fixture parser, projection, and source contract tests
 *
 * Verifies core invariants of the Antigravity fetchAvailableModels quota service
 * without importing the pi SDK or hitting live Google endpoints:
 *
 * 1. remainingFraction 0/1/fraction → usedPercent; invalid/NaN/OOB rejected
 * 2. resetTime display-only normalization
 * 3. empty / malformed / oversized payloads fail safely
 * 4. Safe projection — no token/refresh/projectId/raw body/URL/path
 * 5. Source contract: fixed host, cache TTLs, 401 retry once, POST 405, no-store
 * 6. Default project id is never a health shortcut in source
 * 7. Runtime classification matrix: 401→force refresh→200, invalid_grant reauth,
 *    provider/storage/network non-reauth (temp agent dir + mock fetch only)
 *
 * Run: npm run test:antigravity-quota
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// ─── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
    failed++;
  }
}

function assertIncludes(source, needle, label) {
  assert.ok(source.includes(needle), `${label}: expected to include "${needle}"`);
}

function assertNotIncludes(source, needle, label) {
  assert.ok(!source.includes(needle), `${label}: expected NOT to include "${needle}"`);
}

// ─── Inline mirrors of production parser helpers ─────────────────────────────

const MAX_MODEL_WINDOWS = 64;
const MAX_QUOTA_MODEL_KEY_LEN = 96;
const MAX_QUOTA_MODEL_LABEL_LEN = 80;
const MAX_PUBLIC_MODEL_IDS_PER_WINDOW = 8;

// Minimal reverse map for projection tests (subset; full table covered by model-quota tests)
const PUBLIC_BY_KEY = new Map([
  ["claude-opus-4-5", ["claude-opus-4-5"]],
  ["claude-opus-4-5-thinking", ["claude-opus-4-5"]],
  ["gemini-2.5-pro", ["gemini-2.5-pro"]],
  ["gemini-3-flash", ["gemini-3-flash"]],
  ["gpt-oss-120b-medium", ["gpt-oss-120b"]],
]);

const LABEL_BY_PUBLIC = new Map([
  ["claude-opus-4-5", "Claude Opus 4.5"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-3-flash", "Gemini 3 Flash"],
  ["gpt-oss-120b", "GPT-OSS 120B"],
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeText(value, maxLen) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function parseRemainingFraction(value) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function computeUsedPercent(remainingFraction) {
  const raw = (1 - remainingFraction) * 100;
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw * 1e6) / 1e6;
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

function normalizeAntigravityResetAt(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function getPublicModelIdsForQuotaKey(quotaKey) {
  return PUBLIC_BY_KEY.get(quotaKey) ?? (LABEL_BY_PUBLIC.has(quotaKey) ? [quotaKey] : []);
}

function labelForAntigravityQuotaKey(quotaKey) {
  const publicIds = getPublicModelIdsForQuotaKey(quotaKey);
  for (const id of publicIds) {
    const label = LABEL_BY_PUBLIC.get(id);
    if (label) return label.slice(0, MAX_QUOTA_MODEL_LABEL_LEN);
  }
  return sanitizeText(quotaKey, MAX_QUOTA_MODEL_LABEL_LEN) || "Model";
}

function parseFetchAvailableModelsEntry(modelKey, raw) {
  const id = sanitizeText(modelKey, MAX_QUOTA_MODEL_KEY_LEN);
  if (!id) return null;
  if (!isRecord(raw)) return null;
  const quotaInfo = raw.quotaInfo;
  if (!isRecord(quotaInfo)) return null;
  const remaining = parseRemainingFraction(quotaInfo.remainingFraction);
  if (remaining === null) return null;
  const usedPercent = computeUsedPercent(remaining);
  const label = labelForAntigravityQuotaKey(id);
  const publicModelIds = getPublicModelIdsForQuotaKey(id).slice(0, MAX_PUBLIC_MODEL_IDS_PER_WINDOW);
  const resetsAt = normalizeAntigravityResetAt(quotaInfo.resetTime);
  const window = { id, label, publicModelIds, remainingFraction: remaining, usedPercent };
  if (resetsAt) window.resetsAt = resetsAt;
  return window;
}

function parseFetchAvailableModelsPayload(payload) {
  if (!isRecord(payload)) throw new Error("invalid fetchAvailableModels payload");
  const modelsRaw = payload.models;
  if (!isRecord(modelsRaw)) throw new Error("invalid fetchAvailableModels payload");
  const models = [];
  for (const [key, value] of Object.entries(modelsRaw)) {
    if (models.length >= MAX_MODEL_WINDOWS) break;
    const window = parseFetchAvailableModelsEntry(key, value);
    if (window) models.push(window);
  }
  return { models };
}

function mapAntigravityQuotaHttpError(statusCode, payload) {
  if (statusCode === 401) {
    return { code: "unauthorized", message: "Antigravity authorization expired. Please re-authenticate.", retryable: true };
  }
  if (statusCode === 403) {
    const text = isRecord(payload)
      ? `${typeof payload.error === "string" ? payload.error : ""} ${
          isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : ""
        } ${typeof payload.message === "string" ? payload.message : ""}`
      : "";
    const lower = text.toLowerCase();
    if (/project/.test(lower)) {
      return { code: "invalid_project", message: "Antigravity project is missing or not permitted for quota", retryable: false };
    }
    return { code: "access_denied", message: "Antigravity quota access was denied", retryable: false };
  }
  if (statusCode === 429) {
    return { code: "rate_limited", message: "Antigravity quota endpoint rate limited the request", retryable: true };
  }
  if (statusCode < 200 || statusCode >= 300) {
    return { code: "upstream", message: "Antigravity quota endpoint returned an error", retryable: statusCode >= 500 };
  }
  return null;
}

function buildQuotaResultV1(accountId, entry, cacheState, reauthRequired, error) {
  const ageMs = entry.queriedAt ? Date.now() - entry.queriedAt : null;
  const result = {
    kind: "antigravity_subscription_quota",
    schemaVersion: 1,
    provider: "google-antigravity",
    accountId,
    success: entry.success === true && Array.isArray(entry.models) && entry.models.length > 0,
    models: Array.isArray(entry.models)
      ? entry.models.map((m) => ({ ...m, publicModelIds: [...(m.publicModelIds ?? [])] }))
      : [],
    cache: {
      state: cacheState,
      queriedAt: entry.queriedAt ? new Date(entry.queriedAt).toISOString() : null,
      ageMs,
    },
    reauthRequired: reauthRequired || false,
  };
  if (error) result.error = error;
  return result;
}

// ============================================================================
// 1. remainingFraction math
// ============================================================================

console.log("\n=== remainingFraction / usedPercent ===");

test("remainingFraction=1 → usedPercent 0", () => {
  assert.strictEqual(computeUsedPercent(1), 0);
  const parsed = parseFetchAvailableModelsPayload({
    models: {
      "gemini-2.5-pro": { quotaInfo: { remainingFraction: 1, resetTime: "2026-08-01T00:00:00Z" } },
    },
  });
  assert.strictEqual(parsed.models.length, 1);
  assert.strictEqual(parsed.models[0].remainingFraction, 1);
  assert.strictEqual(parsed.models[0].usedPercent, 0);
  assert.strictEqual(parsed.models[0].resetsAt, "2026-08-01T00:00:00.000Z");
});

test("remainingFraction=0 → usedPercent 100", () => {
  const parsed = parseFetchAvailableModelsPayload({
    models: {
      "gemini-2.5-pro": { quotaInfo: { remainingFraction: 0 } },
    },
  });
  assert.strictEqual(parsed.models[0].remainingFraction, 0);
  assert.strictEqual(parsed.models[0].usedPercent, 100);
});

test("remainingFraction=0.42 → usedPercent 58", () => {
  const parsed = parseFetchAvailableModelsPayload({
    models: {
      "claude-opus-4-5-thinking": {
        quotaInfo: { remainingFraction: 0.42, resetTime: "2026-07-16T12:34:56Z" },
      },
    },
  });
  assert.strictEqual(parsed.models[0].remainingFraction, 0.42);
  assert.strictEqual(parsed.models[0].usedPercent, 58);
  assert.ok(parsed.models[0].publicModelIds.includes("claude-opus-4-5"));
  assert.strictEqual(parsed.models[0].label, "Claude Opus 4.5");
});

test("rejects NaN / OOB / non-number remainingFraction (never coerce to 0)", () => {
  const payload = {
    models: {
      a: { quotaInfo: { remainingFraction: NaN } },
      b: { quotaInfo: { remainingFraction: -0.1 } },
      c: { quotaInfo: { remainingFraction: 1.01 } },
      d: { quotaInfo: { remainingFraction: "0.5" } },
      e: { quotaInfo: { remainingFraction: null } },
      f: { quotaInfo: {} },
      g: { notQuota: true },
      h: { quotaInfo: { remainingFraction: 0.5 } },
    },
  };
  const parsed = parseFetchAvailableModelsPayload(payload);
  assert.strictEqual(parsed.models.length, 1);
  assert.strictEqual(parsed.models[0].id, "h");
  assert.strictEqual(parsed.models[0].remainingFraction, 0.5);
  assert.strictEqual(parsed.models[0].usedPercent, 50);
});

test("invalid resetTime is dropped; remaining still kept", () => {
  const parsed = parseFetchAvailableModelsPayload({
    models: {
      "gemini-2.5-pro": {
        quotaInfo: { remainingFraction: 0.2, resetTime: "not-a-date" },
      },
    },
  });
  assert.strictEqual(parsed.models[0].remainingFraction, 0.2);
  assert.strictEqual(parsed.models[0].resetsAt, undefined);
});

test("numeric / non-string resetTime rejected", () => {
  assert.strictEqual(normalizeAntigravityResetAt(1893456000), undefined);
  assert.strictEqual(normalizeAntigravityResetAt(null), undefined);
  assert.strictEqual(normalizeAntigravityResetAt(""), undefined);
});

// ============================================================================
// 2. Payload shape
// ============================================================================

console.log("\n=== Payload shape ===");

test("models non-object / missing throws", () => {
  assert.throws(() => parseFetchAvailableModelsPayload(null), /invalid fetchAvailableModels payload/);
  assert.throws(() => parseFetchAvailableModelsPayload({}), /invalid fetchAvailableModels payload/);
  assert.throws(
    () => parseFetchAvailableModelsPayload({ models: [] }),
    /invalid fetchAvailableModels payload/,
  );
  assert.throws(
    () => parseFetchAvailableModelsPayload({ models: "x" }),
    /invalid fetchAvailableModels payload/,
  );
});

test("empty models record yields zero windows (caller treats as invalid)", () => {
  assert.deepStrictEqual(parseFetchAvailableModelsPayload({ models: {} }).models, []);
});

test("oversized models map is capped at MAX_MODEL_WINDOWS", () => {
  const models = {};
  for (let i = 0; i < MAX_MODEL_WINDOWS + 20; i++) {
    models[`model-${i}`] = { quotaInfo: { remainingFraction: 1 } };
  }
  const parsed = parseFetchAvailableModelsPayload({ models });
  assert.strictEqual(parsed.models.length, MAX_MODEL_WINDOWS);
});

test("extra raw fields are not projected", () => {
  const parsed = parseFetchAvailableModelsPayload({
    models: {
      "gemini-2.5-pro": {
        quotaInfo: {
          remainingFraction: 0.8,
          resetTime: "2026-08-01T00:00:00Z",
          secretField: "leak-me",
        },
        rawUsage: { tokens: 999 },
      },
    },
    requestId: "req-secret",
    project: "rising-fact-p41fc",
  });
  const json = JSON.stringify(parsed);
  assertNotIncludes(json, "secretField", "no secretField");
  assertNotIncludes(json, "leak-me", "no leak value");
  assertNotIncludes(json, "rawUsage", "no rawUsage");
  assertNotIncludes(json, "requestId", "no requestId");
  assertNotIncludes(json, "rising-fact-p41fc", "no project id");
  assert.strictEqual(parsed.models[0].remainingFraction, 0.8);
});

// ============================================================================
// 3. HTTP error classification
// ============================================================================

console.log("\n=== HTTP error classification ===");

test("401 → unauthorized (reauth path)", () => {
  const err = mapAntigravityQuotaHttpError(401, null);
  assert.strictEqual(err.code, "unauthorized");
  assert.strictEqual(err.retryable, true);
});

test("403 with project language → invalid_project (not reauth)", () => {
  const err = mapAntigravityQuotaHttpError(403, {
    error: { message: "Permission denied for project rising-fact-p41fc" },
  });
  assert.strictEqual(err.code, "invalid_project");
  assert.strictEqual(err.retryable, false);
  // Fixed message must not include project id
  assertNotIncludes(err.message, "rising-fact", "no project id in message");
});

test("403 without project language → access_denied", () => {
  const err = mapAntigravityQuotaHttpError(403, { message: "Forbidden" });
  assert.strictEqual(err.code, "access_denied");
});

test("429 → rate_limited", () => {
  assert.strictEqual(mapAntigravityQuotaHttpError(429, null).code, "rate_limited");
});

// ============================================================================
// 4. Result projection
// ============================================================================

console.log("\n=== Result projection ===");

test("live multi-model result has no total/average fields", () => {
  const entry = {
    success: true,
    queriedAt: Date.now(),
    models: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        publicModelIds: ["gemini-2.5-pro"],
        remainingFraction: 0.5,
        usedPercent: 50,
        resetsAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "claude-opus-4-5",
        label: "Claude Opus 4.5",
        publicModelIds: ["claude-opus-4-5"],
        remainingFraction: 0.1,
        usedPercent: 90,
      },
    ],
  };
  const result = buildQuotaResultV1("opaque-acct", entry, "live", false);
  assert.strictEqual(result.kind, "antigravity_subscription_quota");
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.provider, "google-antigravity");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.models.length, 2);
  assert.strictEqual(result.cache.state, "live");
  assert.strictEqual(result.reauthRequired, false);
  assert.strictEqual(result.error, undefined);
  const json = JSON.stringify(result);
  assertNotIncludes(json, "totalPercent", "no totalPercent");
  assertNotIncludes(json, "average", "no average");
  assertNotIncludes(json, "primaryBucket", "no primary bucket aggregate");
});

test("stale result preserves models + error", () => {
  const entry = {
    success: true,
    queriedAt: Date.now() - 3_600_000,
    models: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        publicModelIds: ["gemini-2.5-pro"],
        remainingFraction: 0.3,
        usedPercent: 70,
      },
    ],
  };
  const result = buildQuotaResultV1("opaque-acct", entry, "stale", false, {
    code: "network",
    message: "Network error contacting Antigravity quota endpoint",
    retryable: true,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.cache.state, "stale");
  assert.ok(result.cache.ageMs >= 3_600_000);
  assert.strictEqual(result.error?.code, "network");
  assert.strictEqual(result.models[0].remainingFraction, 0.3);
});

test("none state — unavailable, empty models", () => {
  const result = buildQuotaResultV1(
    "opaque-acct",
    { success: false, queriedAt: null, models: [] },
    "none",
    false,
    {
      code: "invalid_payload",
      message: "Antigravity quota response contained no usable model windows",
      retryable: false,
    },
  );
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.cache.state, "none");
  assert.deepStrictEqual(result.models, []);
  assert.strictEqual(result.error?.code, "invalid_payload");
});

// ============================================================================
// 5. Security — no secrets in projection
// ============================================================================

console.log("\n=== Security — no secrets in projection ===");

test("result JSON never contains credential / raw fields", () => {
  const entry = {
    success: true,
    queriedAt: Date.now(),
    models: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        publicModelIds: ["gemini-2.5-pro"],
        remainingFraction: 0.9,
        usedPercent: 10,
      },
    ],
  };
  const result = buildQuotaResultV1("opaque-storage-id", entry, "live", false);
  const json = JSON.stringify(result);
  for (const needle of [
    "refresh",
    "projectId",
    "rising-fact-p41fc",
    "client_secret",
    "Authorization",
    "Bearer ",
    "fetchAvailableModels",
    "daily-cloudcode-pa",
    "/Users/",
    "auth-accounts",
    "ya29.",
    "access_token",
  ]) {
    assertNotIncludes(json, needle, `projection must not include ${needle}`);
  }
  // "access" alone may appear in words; ensure no access token field shape
  assert.ok(!/"access"\s*:/.test(json), "no access field");
});

// ============================================================================
// 6. Source-code contract checks
// ============================================================================

console.log("\n=== Source-code contract checks ===");

const quotaSource = read("lib/antigravity-subscription-quota.ts");
const routeSource = read("app/api/auth/quota/[provider]/route.ts");
const mappingSource = read("lib/antigravity-model-quota.ts");

test("fixed fetchAvailableModels host and path only", () => {
  assertIncludes(
    quotaSource,
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "fixed URL",
  );
  assertIncludes(quotaSource, 'JSON.stringify({ project: projectId })', "body project only");
  assertIncludes(quotaSource, "ANTIGRAVITY_UA_VERSION = \"1.104.0\"", "fixed UA version");
  assertIncludes(quotaSource, "antigravity/${ANTIGRAVITY_UA_VERSION} darwin/arm64", "fixed UA template");
  // Must not implement multi-host fallback for quota
  assertNotIncludes(quotaSource, "daily-cloudcode-pa.sandbox.googleapis.com", "no sandbox fallback");
  assertNotIncludes(quotaSource, "autopush-cloudcode-pa", "no autopush fallback");
});

test("never accepts credential URL / arbitrary headers", () => {
  assertNotIncludes(quotaSource, "raw.endpoint", "no credential endpoint");
  assertNotIncludes(quotaSource, "raw.baseUrl", "no credential baseUrl");
  assertNotIncludes(quotaSource, "credential.url", "no credential url");
  assertNotIncludes(quotaSource, "opts.url", "no opts url");
  assertIncludes(quotaSource, "fetchAvailableModelsHeaders", "fixed headers helper");
});

test("cache TTLs, timeout, single-flight, 401 retry once", () => {
  assertIncludes(quotaSource, "FRESH_TTL_MS = 5 * 60_000", "fresh TTL 5min");
  assertIncludes(quotaSource, "STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000", "stale max age");
  assertIncludes(quotaSource, "FETCH_TIMEOUT_MS = 10_000", "fetch timeout");
  assertIncludes(quotaSource, "inflightRequests", "single-flight map");
  assertIncludes(quotaSource, "forceRefresh", "force refresh option");
  assertIncludes(quotaSource, "statusCode === 401", "401 status check");
  assertIncludes(quotaSource, "forceRefresh: true", "force refresh on 401");
});

test("401 force-refresh retry is unconditional (same-token still retries once)", () => {
  const retryStart = quotaSource.indexOf("// 4. 401 only");
  assert.ok(retryStart >= 0, "401 retry block present");
  const retryBlock = quotaSource.slice(retryStart, retryStart + 1200);
  assertIncludes(retryBlock, "forceRefresh: true", "force refresh call");
  assertIncludes(retryBlock, "fetchAvailableModelsData(accessToken, meta.projectId)", "retry fetch");
  assertIncludes(retryBlock, "mapTokenErrorToQuotaError", "refresh failure classification");
  assert.ok(
    !retryBlock.includes("refreshed.accessToken !== accessToken"),
    "must not skip retry when token string is unchanged",
  );
  const forceRefreshCalls = quotaSource.split("forceRefresh: true").length - 1;
  assert.equal(forceRefreshCalls, 1, "exactly one forceRefresh:true site (single retry)");
});

test("token error mapping: only confirmed credential loss is reauth", () => {
  assertIncludes(quotaSource, "export function mapTokenErrorToQuotaError", "exported mapper");
  // Confirmed reauth codes
  assertIncludes(quotaSource, 'code === "unauthorized" || code === "missing_refresh"', "reauth codes");
  // refresh_failed / provider / unavailable are non-reauth
  assertIncludes(quotaSource, 'code === "refresh_failed"', "refresh_failed classified");
  assertIncludes(quotaSource, 'code === "provider_unavailable"', "provider_unavailable classified");
  assertIncludes(quotaSource, 'code === "unavailable"', "unavailable classified");
  // Default unknown is upstream, not unauthorized
  assertIncludes(
    quotaSource,
    'return fixedError("upstream", SAFE_ERROR_MESSAGES.upstream, true);',
    "unknown token errors default to non-reauth upstream",
  );
  // Must not blanket-map refresh_failed with unauthorized
  assert.ok(
    !/code === "unauthorized" \|\| code === "missing_refresh" \|\| code === "refresh_failed"/.test(quotaSource),
    "refresh_failed must not share unauthorized branch",
  );
});

test("403 invalid_project distinct from unauthorized reauth", () => {
  assertIncludes(quotaSource, '"invalid_project"', "invalid_project code");
  assertIncludes(quotaSource, '"access_denied"', "access_denied code");
  assertIncludes(quotaSource, "mapAntigravityQuotaHttpError", "http error mapper");
});

test("uses getAntigravityAccessToken and metadata-only Active reader", () => {
  assertIncludes(quotaSource, "getAntigravityAccessToken", "token resolver");
  assertIncludes(quotaSource, "./antigravity-account-token", "token module import");
  assertIncludes(quotaSource, "readOAuthActiveAccountId", "active account via pure metadata reader");
  assertNotIncludes(quotaSource, "listOAuthAccounts", "quota does not enumerate accounts just to read Active");
  assertIncludes(quotaSource, "ANTIGRAVITY_PROVIDER_ID", "provider id");
});

test("parser rejects invalid remaining; usedPercent from 1-remaining", () => {
  assertIncludes(quotaSource, "parseRemainingFraction", "remaining parser");
  assertIncludes(quotaSource, "computeUsedPercent", "used percent helper");
  assertIncludes(quotaSource, "(1 - remainingFraction) * 100", "used formula");
  assertIncludes(quotaSource, "value < 0 || value > 1", "bounds reject");
});

test("zero valid entries is invalid_payload / not success empty", () => {
  assertIncludes(quotaSource, "invalid_payload", "invalid_payload code");
  assertIncludes(quotaSource, "no usable model windows", "empty windows message");
  assertIncludes(
    quotaSource,
    "result.models && result.models.length > 0 && !result.error",
    "success requires models",
  );
});

test("default project is never a health shortcut", () => {
  assertNotIncludes(quotaSource, "rising-fact-p41fc", "no default project constant in quota service");
  assertIncludes(
    quotaSource,
    "Default project id alone never marks",
    "comment documents non-health default project",
  );
});

test("no private package import in quota modules", () => {
  assertNotIncludes(quotaSource, "@yofriadi/pi-antigravity-oauth/src", "no private src");
  assertNotIncludes(mappingSource, "@yofriadi/pi-antigravity-oauth/src", "mapping no private src");
});

test("route GET/POST google-antigravity with no-store and POST 405", () => {
  assertIncludes(routeSource, "ANTIGRAVITY_PROVIDER_ID", "provider import");
  assertIncludes(routeSource, "getAntigravityAccountSubscriptionQuota", "account quota");
  assertIncludes(routeSource, "getAntigravityActiveSubscriptionQuota", "active quota");
  assertIncludes(routeSource, 'provider === ANTIGRAVITY_PROVIDER_ID', "provider branch");
  assertIncludes(routeSource, '"Cache-Control": "no-store"', "no-store");
  assertIncludes(routeSource, "antigravity_subscription_quota", "wire kind on 405");
  assertIncludes(
    routeSource,
    "Antigravity does not support reset-credit consumption",
    "POST 405 message",
  );
  // Ensure POST antigravity branch returns 405
  const postIdx = routeSource.indexOf("google-antigravity does not support reset-credit");
  assert.ok(postIdx >= 0, "POST antigravity branch present");
  const postBlock = routeSource.slice(postIdx, postIdx + 900);
  assertIncludes(postBlock, "status: 405", "POST status 405");
  assertIncludes(postBlock, "Cache-Control", "POST no-store");
});

test("wire type fields match design AntigravityQuotaResultV1", () => {
  assertIncludes(quotaSource, 'kind: "antigravity_subscription_quota"', "kind");
  assertIncludes(quotaSource, "schemaVersion: 1", "schemaVersion");
  assertIncludes(quotaSource, 'provider: "google-antigravity"', "provider");
  assertIncludes(quotaSource, "remainingFraction", "remainingFraction field");
  assertIncludes(quotaSource, "usedPercent", "usedPercent field");
  assertIncludes(quotaSource, "publicModelIds", "publicModelIds field");
  assertIncludes(quotaSource, 'state: "live" | "fresh" | "stale" | "none"', "cache states");
});

// ============================================================================
// Runtime classification matrix (temp dir + mock fetch, no Google network)
// ============================================================================

console.log("\n=== Runtime reauth classification matrix ===");

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const jiti = createJiti(import.meta.url, { alias: { "@": root } });

await testAsync("mapTokenErrorToQuotaError matrix + 401→refresh→200 / invalid_grant", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-antigravity-quota-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const originalFetch = globalThis.fetch;

  const oauth = await jiti.import(pathToFileURL(join(root, "lib/pi-ai-oauth-compat.ts")).href);
  const {
    registerOAuthProvider,
    unregisterOAuthProvider,
    getOAuthProvider,
  } = oauth;
  const previous = getOAuthProvider("google-antigravity");

  /** @type {{ mode: "ok" | "invalid_grant" | "network" | "no_key", calls: number }} */
  const refreshControl = { mode: "ok", calls: 0 };

  registerOAuthProvider({
    id: "google-antigravity",
    name: "Antigravity (quota classification fixture)",
    async login() {
      throw new Error("login not used in quota classification test");
    },
    async refreshToken(credentials) {
      refreshControl.calls += 1;
      if (refreshControl.mode === "invalid_grant") {
        throw new Error('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}');
      }
      if (refreshControl.mode === "network") {
        throw new Error("fetch failed: ECONNRESET");
      }
      if (refreshControl.mode === "no_key") {
        // Force empty newCredentials path by returning partial; getOAuthApiKey
        // still builds apiKey from getApiKey. Use a throw for refresh_failed-ish.
        throw new Error("Antigravity token refresh failed: upstream 503");
      }
      const refresh = typeof credentials.refresh === "string" ? credentials.refresh : "";
      return {
        access: `quota-refreshed-access-${refreshControl.calls}`,
        refresh,
        expires: Date.now() + 3_600_000,
        type: "oauth",
      };
    },
    getApiKey(credentials) {
      const access = typeof credentials.access === "string" ? credentials.access : "";
      const projectId = typeof credentials.projectId === "string" ? credentials.projectId : "";
      return JSON.stringify({ token: access, projectId });
    },
  });

  try {
    const { mapTokenErrorToQuotaError, getAntigravityAccountSubscriptionQuota, __resetAntigravityQuotaStateForTests } =
      await jiti.import(pathToFileURL(join(root, "lib/antigravity-subscription-quota.ts")).href);
    const { AntigravityTokenError } = await jiti.import(
      pathToFileURL(join(root, "lib/antigravity-account-token.ts")).href,
    );
    const { ANTIGRAVITY_PROVIDER_ID, saveOAuthAccountCredential, activateOAuthAccount } =
      await jiti.import(pathToFileURL(join(root, "lib/oauth-accounts.ts")).href);

    // ── Pure mapper matrix (no network) ──
    const matrix = [
      ["unauthorized", "unauthorized", true],
      ["missing_refresh", "unauthorized", true],
      ["account_not_found", "unauthorized", true],
      ["invalid_credential", "unauthorized", true],
      ["refresh_failed", "upstream", false],
      ["provider_unavailable", "upstream", false],
      ["unavailable", "upstream", false],
      ["network", "network", false],
      ["missing_project", "invalid_project", false],
    ];
    for (const [tokenCode, quotaCode, reauth] of matrix) {
      const mapped = mapTokenErrorToQuotaError(new AntigravityTokenError(/** @type {any} */ (tokenCode)));
      assert.equal(mapped.code, quotaCode, `${tokenCode} → ${quotaCode}`);
      // reauthRequired is derived from unauthorized only at result builders;
      // mapper itself only returns the code.
      if (reauth) assert.equal(mapped.code, "unauthorized", `${tokenCode} reauth code`);
      else assert.notEqual(mapped.code, "unauthorized", `${tokenCode} non-reauth`);
      assert.ok(!JSON.stringify(mapped).includes("project-"), "no project leakage");
      assert.ok(!JSON.stringify(mapped).includes("refresh-"), "no refresh leakage");
    }
    // Unknown errors default to non-reauth upstream
    const unknownMapped = mapTokenErrorToQuotaError(new Error("totally unknown boom"));
    assert.equal(unknownMapped.code, "upstream");

    // ── Live quota: expired AT + valid RT → success / non-reauth ──
    __resetAntigravityQuotaStateForTests();
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    const account = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "quota-old-access",
      refresh: "quota-valid-refresh",
      expires: Date.now() - 60_000,
      projectId: "project-quota-secret",
      email: "quota@example.com",
    });
    await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, account.accountId);

    /** @type {number} */
    let fetchCalls = 0;
    globalThis.fetch = async (input, init) => {
      fetchCalls += 1;
      const url = String(input);
      assert.ok(
        url.includes("daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"),
        "only fixed quota host",
      );
      const auth = /** @type {Record<string, string>} */ (init?.headers || {}).Authorization
        || /** @type {Record<string, string>} */ (init?.headers || {}).authorization
        || "";
      // First call may use old or already-refreshed token depending on resolver timing.
      // After force path, second call must succeed.
      if (fetchCalls === 1 && auth.includes("quota-old-access")) {
        return jsonResponse(401, { error: { message: "Request had invalid authentication credentials" } });
      }
      return jsonResponse(200, {
        models: {
          "gemini-2.5-pro": {
            quotaInfo: { remainingFraction: 0.75, resetTime: "2026-08-01T00:00:00Z" },
          },
        },
      });
    };

    const success = await getAntigravityAccountSubscriptionQuota(account.accountId, { forceRefresh: true });
    assert.equal(success.success, true, "expired AT + valid RT yields success");
    assert.equal(success.reauthRequired, false, "must not reauth when RT valid");
    assert.equal(success.cache.state, "live");
    assert.ok(success.models.length >= 1, "models present");
    assert.ok(refreshControl.calls >= 1, "refresh invoked for expired credential");
    // Slot written with new access (equality check only; no secret logging)
    const slotPath = join(agentDir, "auth-accounts", "google-antigravity", `${encodeURIComponent(account.accountId)}.json`);
    const slot = JSON.parse(await readFile(slotPath, "utf8"));
    assert.ok(String(slot.access).startsWith("quota-refreshed-access-"), "slot updated after refresh");
    assert.equal(slot.projectId, "project-quota-secret", "projectId retained");
    assert.equal(slot.refresh, "quota-valid-refresh", "refresh retained");
    const successJson = JSON.stringify(success);
    assert.ok(!successJson.includes("quota-valid-refresh"), "wire omits refresh");
    assert.ok(!successJson.includes("project-quota-secret"), "wire omits projectId");
    assert.ok(!successJson.includes(agentDir), "wire omits absolute path");

    // ── 401 → force refresh → 200 (explicit first-call 401) ──
    __resetAntigravityQuotaStateForTests();
    // Write a still-valid AT so initial getAntigravityAccessToken does not refresh,
    // then force 401 on first fetchAvailableModels to exercise the single retry.
    const stillValid = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "still-valid-access",
      refresh: "quota-valid-refresh-2",
      expires: Date.now() + 3_600_000,
      projectId: "project-quota-secret-2",
      email: "quota2@example.com",
    });
    await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, stillValid.accountId);
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    fetchCalls = 0;
    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      const headers = init?.headers;
      let auth = "";
      if (headers && typeof headers === "object" && !Array.isArray(headers)) {
        auth = /** @type {Record<string, string>} */ (headers).Authorization
          || /** @type {Record<string, string>} */ (headers).authorization
          || "";
      }
      if (fetchCalls === 1) {
        assert.ok(auth.includes("still-valid-access"), "first fetch uses current AT");
        return jsonResponse(401, { error: "invalid authentication" });
      }
      assert.ok(auth.includes("quota-refreshed-access-"), "retry uses refreshed AT");
      return jsonResponse(200, {
        models: {
          "claude-sonnet-4": { quotaInfo: { remainingFraction: 0.5 } },
        },
      });
    };
    const retryOk = await getAntigravityAccountSubscriptionQuota(stillValid.accountId, { forceRefresh: true });
    assert.equal(retryOk.success, true, "401→refresh→200 success");
    assert.equal(retryOk.reauthRequired, false);
    assert.equal(fetchCalls, 2, "exactly one retry fetch");
    assert.equal(refreshControl.calls, 1, "exactly one force refresh");

    // ── invalid_grant → reauth ──
    __resetAntigravityQuotaStateForTests();
    const revoked = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "revoked-access",
      refresh: "revoked-refresh",
      expires: Date.now() - 10_000,
      projectId: "project-revoked",
      email: "revoked@example.com",
    });
    refreshControl.mode = "invalid_grant";
    refreshControl.calls = 0;
    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(200, { models: { x: { quotaInfo: { remainingFraction: 1 } } } });
    };
    const reauthResult = await getAntigravityAccountSubscriptionQuota(revoked.accountId, { forceRefresh: true });
    assert.equal(reauthResult.success, false);
    assert.equal(reauthResult.reauthRequired, true, "invalid_grant must reauth");
    assert.equal(reauthResult.error?.code, "unauthorized");
    assert.equal(fetchCalls, 0, "no quota fetch when refresh fails with invalid_grant");

    // ── generic refresh_failed / network → non-reauth ──
    __resetAntigravityQuotaStateForTests();
    const transient = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "transient-access",
      refresh: "transient-refresh",
      expires: Date.now() - 10_000,
      projectId: "project-transient",
      email: "transient@example.com",
    });
    refreshControl.mode = "no_key";
    refreshControl.calls = 0;
    const upstreamFail = await getAntigravityAccountSubscriptionQuota(transient.accountId, { forceRefresh: true });
    assert.equal(upstreamFail.success, false);
    assert.equal(upstreamFail.reauthRequired, false, "generic refresh failure must not reauth");
    assert.notEqual(upstreamFail.error?.code, "unauthorized");

    refreshControl.mode = "network";
    refreshControl.calls = 0;
    __resetAntigravityQuotaStateForTests();
    const networkFail = await getAntigravityAccountSubscriptionQuota(transient.accountId, { forceRefresh: true });
    assert.equal(networkFail.success, false);
    assert.equal(networkFail.reauthRequired, false, "network refresh failure must not reauth");
    assert.equal(networkFail.error?.code, "network");

    // ── provider_unavailable structured error → non-reauth ──
    __resetAntigravityQuotaStateForTests();
    const mappedProvider = mapTokenErrorToQuotaError(new AntigravityTokenError("provider_unavailable"));
    assert.equal(mappedProvider.code, "upstream");
    assert.notEqual(mappedProvider.code, "unauthorized");

    // ── 403 project remains non-reauth at HTTP mapper (source already covers);
    // also verify live path surfaces invalid_project without reauth.
    __resetAntigravityQuotaStateForTests();
    const projectDenied = await saveOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, {
      access: "project-denied-access",
      refresh: "project-denied-refresh",
      expires: Date.now() + 3_600_000,
      projectId: "project-denied",
      email: "denied@example.com",
    });
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    globalThis.fetch = async () =>
      jsonResponse(403, { error: { message: "Permission denied for project project-denied" } });
    const denied = await getAntigravityAccountSubscriptionQuota(projectDenied.accountId, { forceRefresh: true });
    assert.equal(denied.success, false);
    assert.equal(denied.reauthRequired, false, "403 project is not reauth");
    assert.equal(denied.error?.code, "invalid_project");
    assert.ok(!JSON.stringify(denied).includes("project-denied"), "wire omits project id value");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      unregisterOAuthProvider("google-antigravity");
    } catch {
      // ignore
    }
    if (previous) {
      try {
        registerOAuthProvider(previous);
      } catch {
        // ignore
      }
    }
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
