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
 *
 * Run: npm run test:antigravity-quota
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
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
  const retryBlock = quotaSource.slice(retryStart, retryStart + 700);
  assertIncludes(retryBlock, "forceRefresh: true", "force refresh call");
  assertIncludes(retryBlock, "fetchAvailableModelsData(accessToken, meta.projectId)", "retry fetch");
  assert.ok(
    !retryBlock.includes("refreshed.accessToken !== accessToken"),
    "must not skip retry when token string is unchanged",
  );
  const forceRefreshCalls = quotaSource.split("forceRefresh: true").length - 1;
  assert.equal(forceRefreshCalls, 1, "exactly one forceRefresh:true site (single retry)");
});

test("403 invalid_project distinct from unauthorized reauth", () => {
  assertIncludes(quotaSource, '"invalid_project"', "invalid_project code");
  assertIncludes(quotaSource, '"access_denied"', "access_denied code");
  assertIncludes(quotaSource, "mapAntigravityQuotaHttpError", "http error mapper");
});

test("uses getAntigravityAccessToken and listOAuthAccounts", () => {
  assertIncludes(quotaSource, "getAntigravityAccessToken", "token resolver");
  assertIncludes(quotaSource, "./antigravity-account-token", "token module import");
  assertIncludes(quotaSource, "listOAuthAccounts", "active account via list");
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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
