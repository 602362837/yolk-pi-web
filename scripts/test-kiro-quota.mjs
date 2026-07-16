#!/usr/bin/env node
/**
 * kiro-subscription-quota — fixture parser, projection, and source contract tests
 *
 * Verifies core invariants of the Kiro GetUsageLimits quota service without
 * importing the pi SDK or hitting live AWS endpoints:
 *
 * 1. Region validation (commercial only; no arbitrary host/URL)
 * 2. usageBreakdownList / usageBreakdown parsing with precision-first numbers
 * 3. Primary bucket selection, subscription title, reset normalization
 * 4. limit<=0 / missing buckets stay unavailable (never fake 0%)
 * 5. Safe projection — no credentials / raw payload / profileArn / paths
 * 6. Source contract: endpoint target, cache TTLs, 401 retry, POST 405
 *
 * Run: npm run test:kiro-quota
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

const AWS_COMMERCIAL_REGION_RE =
  /^(af|ap|ca|eu|il|me|mx|sa|us)-(central|east|north|northeast|northwest|south|southeast|southwest|west)-\d+$/;
const RESOURCE_TYPE_ALLOWLIST = new Set(["CREDIT", "VIBE", "SPEC", "AGENTIC_REQUEST", "OTHER"]);
const MAX_BUCKETS = 8;
const MAX_LABEL_LEN = 64;
const MAX_UNIT_LEN = 32;
const MAX_TITLE_LEN = 80;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeText(value, maxLen) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function validateKiroRegion(raw) {
  if (typeof raw !== "string") return null;
  const region = raw.trim().toLowerCase();
  if (!region || region.includes("/") || region.includes(".") || region.includes(":")) return null;
  if (!AWS_COMMERCIAL_REGION_RE.test(region)) return null;
  if (region.includes("gov") || region.startsWith("cn-")) return null;
  return region;
}

function toFiniteNonNegative(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  return null;
}

function normalizeResetAt(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return undefined;
    return date.toISOString();
  }
  return undefined;
}

function mapResourceType(raw) {
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  if (RESOURCE_TYPE_ALLOWLIST.has(upper)) return upper;
  if (!upper) return undefined;
  return "OTHER";
}

function defaultLabelFor(resourceType, index) {
  switch (resourceType) {
    case "CREDIT":
      return "Credits";
    case "AGENTIC_REQUEST":
      return "Agentic Requests";
    case "VIBE":
      return "Vibe";
    case "SPEC":
      return "Spec";
    default:
      return `Usage ${index + 1}`;
  }
}

function extractUsageNumber(record, precisionKey, intKey) {
  const precision = toFiniteNonNegative(record[precisionKey]);
  if (precision !== null) return precision;
  return toFiniteNonNegative(record[intKey]);
}

function parseUsageBreakdownItem(raw, index) {
  if (!isRecord(raw)) return null;
  const used = extractUsageNumber(raw, "currentUsageWithPrecision", "currentUsage");
  const limit = extractUsageNumber(raw, "usageLimitWithPrecision", "usageLimit");
  if (used === null || limit === null || limit <= 0) return null;

  const resourceType = mapResourceType(raw.resourceType ?? raw.resource_type);
  const unit = sanitizeText(raw.unit ?? raw.displayUnit ?? raw.display_unit, MAX_UNIT_LEN);
  const label =
    sanitizeText(raw.displayName ?? raw.display_name ?? raw.name ?? raw.resourceType, MAX_LABEL_LEN) ??
    defaultLabelFor(resourceType, index);
  const idBase =
    (resourceType ?? label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bucket";
  const id = `${idBase}-${index}`;
  const resetsAt = normalizeResetAt(
    raw.nextDateReset ?? raw.next_date_reset ?? raw.resetDate ?? raw.resetsAt,
  );
  const remaining = Math.max(0, limit - used);
  const utilization = Math.min(100, Math.max(0, (used / limit) * 100));
  const bucket = { id, label, used, limit, remaining, utilization };
  if (resourceType) bucket.resourceType = resourceType;
  if (unit) bucket.unit = unit;
  if (resetsAt) bucket.resetsAt = resetsAt;
  return bucket;
}

function parseGetUsageLimitsPayload(payload) {
  if (!isRecord(payload)) throw new Error("invalid usage limits payload");

  let items = [];
  if (Array.isArray(payload.usageBreakdownList)) {
    items = payload.usageBreakdownList;
  } else if (isRecord(payload.usageBreakdown)) {
    items = [payload.usageBreakdown];
  } else if (Array.isArray(payload.usageBreakdown)) {
    items = payload.usageBreakdown;
  }

  const buckets = [];
  for (let i = 0; i < items.length && buckets.length < MAX_BUCKETS; i++) {
    const bucket = parseUsageBreakdownItem(items[i], i);
    if (bucket) buckets.push(bucket);
  }

  let subscriptionTitle;
  const subInfo = payload.subscriptionInfo ?? payload.subscription_info;
  if (isRecord(subInfo)) {
    subscriptionTitle = sanitizeText(
      subInfo.subscriptionTitle ?? subInfo.subscription_title ?? subInfo.title ?? subInfo.planName ?? subInfo.plan_name,
      MAX_TITLE_LEN,
    );
  } else {
    subscriptionTitle = sanitizeText(payload.subscriptionTitle, MAX_TITLE_LEN);
  }

  const topReset = normalizeResetAt(payload.nextDateReset ?? payload.next_date_reset);
  if (topReset) {
    for (const bucket of buckets) {
      if (!bucket.resetsAt) bucket.resetsAt = topReset;
    }
  }

  const primary = buckets.find((b) => b.resourceType === "CREDIT") ?? buckets[0];
  return {
    buckets,
    subscriptionTitle,
    primaryBucketId: primary?.id,
  };
}

function buildQuotaResultV1(accountId, entry, cacheState, reauthRequired, error) {
  const ageMs = entry.queriedAt ? Date.now() - entry.queriedAt : null;
  const result = {
    kind: "kiro_subscription_quota",
    schemaVersion: 1,
    provider: "kiro",
    accountId,
    success: entry.success === true && Array.isArray(entry.buckets) && entry.buckets.length > 0,
    buckets: Array.isArray(entry.buckets) ? entry.buckets.map((b) => ({ ...b })) : [],
    cache: {
      state: cacheState,
      queriedAt: entry.queriedAt ? new Date(entry.queriedAt).toISOString() : null,
      ageMs,
    },
    reauthRequired: reauthRequired || false,
  };
  if (entry.subscriptionTitle) result.subscription = { title: entry.subscriptionTitle };
  if (entry.primaryBucketId) result.primaryBucketId = entry.primaryBucketId;
  if (error) result.error = error;
  return result;
}

// ============================================================================
// 1. Region validation
// ============================================================================

console.log("\n=== Region validation ===");

test("accepts us-east-1", () => {
  assert.strictEqual(validateKiroRegion("us-east-1"), "us-east-1");
});

test("accepts eu-west-1 and normalizes case", () => {
  assert.strictEqual(validateKiroRegion("EU-WEST-1"), "eu-west-1");
});

test("rejects arbitrary URL / host fragments", () => {
  assert.strictEqual(validateKiroRegion("https://evil.example/"), null);
  assert.strictEqual(validateKiroRegion("q.us-east-1.amazonaws.com"), null);
  assert.strictEqual(validateKiroRegion("us-east-1.evil"), null);
});

test("rejects gov / cn partitions and empty", () => {
  assert.strictEqual(validateKiroRegion("us-gov-west-1"), null);
  assert.strictEqual(validateKiroRegion("cn-north-1"), null);
  assert.strictEqual(validateKiroRegion(""), null);
  assert.strictEqual(validateKiroRegion(null), null);
});

// ============================================================================
// 2. Payload parsing
// ============================================================================

console.log("\n=== GetUsageLimits payload parsing ===");

test("usageBreakdownList with precision fields + CREDIT primary", () => {
  const payload = {
    usageBreakdownList: [
      {
        resourceType: "AGENTIC_REQUEST",
        currentUsage: 10,
        usageLimit: 100,
        unit: "requests",
        nextDateReset: "2026-08-01T00:00:00Z",
      },
      {
        resourceType: "CREDIT",
        currentUsageWithPrecision: 12.5,
        usageLimitWithPrecision: 100,
        currentUsage: 12,
        usageLimit: 100,
        displayName: "Credits",
        unit: "USD",
        nextDateReset: "2026-08-15T00:00:00Z",
      },
    ],
    subscriptionInfo: { subscriptionTitle: "Kiro Pro" },
  };
  const parsed = parseGetUsageLimitsPayload(payload);
  assert.strictEqual(parsed.buckets.length, 2);
  assert.strictEqual(parsed.subscriptionTitle, "Kiro Pro");
  assert.ok(parsed.primaryBucketId?.startsWith("credit-"));
  const credit = parsed.buckets.find((b) => b.resourceType === "CREDIT");
  assert.ok(credit);
  assert.strictEqual(credit.used, 12.5);
  assert.strictEqual(credit.limit, 100);
  assert.strictEqual(credit.remaining, 87.5);
  assert.strictEqual(credit.utilization, 12.5);
  assert.strictEqual(credit.unit, "USD");
  assert.strictEqual(credit.resetsAt, "2026-08-15T00:00:00.000Z");
});

test("legacy singular usageBreakdown works", () => {
  const payload = {
    usageBreakdown: {
      resourceType: "CREDIT",
      currentUsage: 40,
      usageLimit: 200,
      nextDateReset: 1893456000, // epoch seconds ~2030-01-01
    },
  };
  const parsed = parseGetUsageLimitsPayload(payload);
  assert.strictEqual(parsed.buckets.length, 1);
  assert.strictEqual(parsed.buckets[0].used, 40);
  assert.strictEqual(parsed.buckets[0].limit, 200);
  assert.strictEqual(parsed.buckets[0].remaining, 160);
  assert.strictEqual(parsed.buckets[0].utilization, 20);
  assert.ok(parsed.buckets[0].resetsAt);
  assert.strictEqual(parsed.primaryBucketId, parsed.buckets[0].id);
});

test("top-level nextDateReset fills missing bucket resets", () => {
  const payload = {
    nextDateReset: "2026-09-01T12:00:00Z",
    usageBreakdownList: [
      { resourceType: "CREDIT", currentUsage: 1, usageLimit: 10 },
    ],
  };
  const parsed = parseGetUsageLimitsPayload(payload);
  assert.strictEqual(parsed.buckets[0].resetsAt, "2026-09-01T12:00:00.000Z");
});

test("limit <= 0 is dropped (never 0%)", () => {
  const payload = {
    usageBreakdownList: [
      { resourceType: "CREDIT", currentUsage: 0, usageLimit: 0 },
      { resourceType: "CREDIT", currentUsageWithPrecision: 5, usageLimitWithPrecision: -1 },
      { resourceType: "AGENTIC_REQUEST", currentUsage: 2, usageLimit: 10 },
    ],
  };
  const parsed = parseGetUsageLimitsPayload(payload);
  assert.strictEqual(parsed.buckets.length, 1);
  assert.strictEqual(parsed.buckets[0].resourceType, "AGENTIC_REQUEST");
  assert.notStrictEqual(parsed.buckets[0].utilization, 0); // 20%
  assert.strictEqual(parsed.buckets[0].utilization, 20);
});

test("empty / missing breakdowns produce no buckets", () => {
  assert.deepStrictEqual(parseGetUsageLimitsPayload({}).buckets, []);
  assert.deepStrictEqual(parseGetUsageLimitsPayload({ usageBreakdownList: [] }).buckets, []);
});

test("NaN / negative used dropped", () => {
  const payload = {
    usageBreakdownList: [
      { resourceType: "CREDIT", currentUsage: NaN, usageLimit: 10 },
      { resourceType: "CREDIT", currentUsage: -3, usageLimit: 10 },
      { resourceType: "CREDIT", currentUsage: "not-a-number", usageLimit: 10 },
    ],
  };
  assert.strictEqual(parseGetUsageLimitsPayload(payload).buckets.length, 0);
});

test("used > limit clamps remaining 0 and utilization 100", () => {
  const payload = {
    usageBreakdownList: [
      { resourceType: "CREDIT", currentUsage: 150, usageLimit: 100 },
    ],
  };
  const bucket = parseGetUsageLimitsPayload(payload).buckets[0];
  assert.strictEqual(bucket.remaining, 0);
  assert.strictEqual(bucket.utilization, 100);
});

test("unknown resourceType maps to OTHER", () => {
  const payload = {
    usageBreakdownList: [
      { resourceType: "MYSTERY_BUCKET", currentUsage: 1, usageLimit: 5, displayName: "Mystery" },
    ],
  };
  const bucket = parseGetUsageLimitsPayload(payload).buckets[0];
  assert.strictEqual(bucket.resourceType, "OTHER");
  assert.strictEqual(bucket.label, "Mystery");
});

test("subscription title is sanitized and length-capped", () => {
  const long = `Kiro ${"X".repeat(200)}`;
  const payload = {
    usageBreakdownList: [{ resourceType: "CREDIT", currentUsage: 1, usageLimit: 2 }],
    subscriptionInfo: { title: `\u0000${long}` },
  };
  const parsed = parseGetUsageLimitsPayload(payload);
  assert.ok(parsed.subscriptionTitle);
  assert.ok(parsed.subscriptionTitle.length <= MAX_TITLE_LEN);
  assert.ok(!parsed.subscriptionTitle.includes("\u0000"));
});

test("does not project userInfo / email / overage raw fields", () => {
  const payload = {
    usageBreakdownList: [{ resourceType: "CREDIT", currentUsage: 1, usageLimit: 10 }],
    userInfo: { email: "secret@example.com", name: "Secret" },
    overage: { amount: 99, currency: "USD" },
    subscriptionInfo: { subscriptionTitle: "Pro", freeTrial: { days: 7 } },
  };
  const parsed = parseGetUsageLimitsPayload(payload);
  const json = JSON.stringify(parsed);
  assertNotIncludes(json, "secret@example.com", "no email leak");
  assertNotIncludes(json, "userInfo", "no userInfo key");
  assertNotIncludes(json, "overage", "no overage key");
  assertNotIncludes(json, "freeTrial", "no freeTrial key");
  assert.strictEqual(parsed.subscriptionTitle, "Pro");
});

test("invalid payload type throws", () => {
  assert.throws(() => parseGetUsageLimitsPayload(null), /invalid usage limits payload/);
  assert.throws(() => parseGetUsageLimitsPayload("x"), /invalid usage limits payload/);
});

// ============================================================================
// 3. Result projection
// ============================================================================

console.log("\n=== Result projection ===");

test("live result with multiple buckets", () => {
  const entry = {
    success: true,
    queriedAt: Date.now(),
    subscriptionTitle: "Kiro Pro",
    primaryBucketId: "credit-1",
    buckets: [
      {
        id: "credit-1",
        label: "Credits",
        resourceType: "CREDIT",
        used: 25,
        limit: 100,
        remaining: 75,
        utilization: 25,
        unit: "USD",
        resetsAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "agentic-request-0",
        label: "Agentic Requests",
        resourceType: "AGENTIC_REQUEST",
        used: 10,
        limit: 50,
        remaining: 40,
        utilization: 20,
      },
    ],
  };
  const result = buildQuotaResultV1("acct_kiro", entry, "live", false);
  assert.strictEqual(result.kind, "kiro_subscription_quota");
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.provider, "kiro");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.cache.state, "live");
  assert.strictEqual(result.buckets.length, 2);
  assert.strictEqual(result.primaryBucketId, "credit-1");
  assert.strictEqual(result.subscription?.title, "Kiro Pro");
  assert.strictEqual(result.reauthRequired, false);
  assert.strictEqual(result.error, undefined);
});

test("stale result preserves buckets + error", () => {
  const entry = {
    success: true,
    queriedAt: Date.now() - 3_600_000,
    primaryBucketId: "credit-0",
    buckets: [
      {
        id: "credit-0",
        label: "Credits",
        resourceType: "CREDIT",
        used: 90,
        limit: 100,
        remaining: 10,
        utilization: 90,
      },
    ],
  };
  const result = buildQuotaResultV1("acct_kiro", entry, "stale", false, {
    code: "network",
    message: "Upstream timeout",
    retryable: true,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.cache.state, "stale");
  assert.ok(result.cache.ageMs >= 3_600_000);
  assert.strictEqual(result.error?.code, "network");
  assert.strictEqual(result.buckets[0].remaining, 10);
});

test("none state — unavailable, empty buckets", () => {
  const entry = { success: false, queriedAt: null, buckets: [] };
  const result = buildQuotaResultV1("acct_kiro", entry, "none", false, {
    code: "invalid_payload",
    message: "Usage limits response contained no usable buckets",
    retryable: false,
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.cache.state, "none");
  assert.deepStrictEqual(result.buckets, []);
  assert.strictEqual(result.error?.code, "invalid_payload");
});

test("reauthRequired flag with unauthorized", () => {
  const entry = {
    success: true,
    queriedAt: Date.now(),
    buckets: [
      {
        id: "credit-0",
        label: "Credits",
        resourceType: "CREDIT",
        used: 1,
        limit: 10,
        remaining: 9,
        utilization: 10,
      },
    ],
  };
  const result = buildQuotaResultV1("acct_kiro", entry, "stale", true, {
    code: "unauthorized",
    message: "Token expired",
    retryable: true,
  });
  assert.strictEqual(result.reauthRequired, true);
  assert.strictEqual(result.error?.code, "unauthorized");
});

// ============================================================================
// 4. Security — no secrets in projection
// ============================================================================

console.log("\n=== Security — no secrets in projection ===");

test("result JSON never contains credential / raw fields", () => {
  const entry = {
    success: true,
    queriedAt: Date.now(),
    subscriptionTitle: "Pro",
    primaryBucketId: "credit-0",
    buckets: [
      {
        id: "credit-0",
        label: "Credits",
        resourceType: "CREDIT",
        used: 1,
        limit: 10,
        remaining: 9,
        utilization: 10,
      },
    ],
  };
  const result = buildQuotaResultV1("opaque-storage-id", entry, "live", false);
  const json = JSON.stringify(result);
  for (const needle of [
    "access",
    "refresh",
    "clientSecret",
    "profileArn",
    "arn:aws",
    "Authorization",
    "Bearer",
    "usageBreakdownList",
    "userInfo",
    "email",
    "/Users/",
    "auth-accounts",
    "q.us-east-1.amazonaws.com",
  ]) {
    assertNotIncludes(json, needle, `projection must not include ${needle}`);
  }
});

// ============================================================================
// 5. Source-code contract checks
// ============================================================================

console.log("\n=== Source-code contract checks ===");

const kiroQuotaSource = read("lib/kiro-subscription-quota.ts");
const routeSource = read("app/api/auth/quota/[provider]/route.ts");

test("fixed GetUsageLimits target and commercial host template", () => {
  assertIncludes(kiroQuotaSource, "AmazonCodeWhispererService.GetUsageLimits", "X-Amz-Target");
  assertIncludes(kiroQuotaSource, "https://q.${region}.amazonaws.com/", "host template");
  assertIncludes(kiroQuotaSource, "AI_EDITOR", "origin");
  assertIncludes(kiroQuotaSource, 'resourceType: "CREDIT"', "primary body resourceType");
});

test("never accepts arbitrary endpoint from credentials", () => {
  assertNotIncludes(kiroQuotaSource, "raw.endpoint", "no credential endpoint");
  assertNotIncludes(kiroQuotaSource, "raw.baseUrl", "no credential baseUrl");
  assertNotIncludes(kiroQuotaSource, "raw.url", "no credential url");
  assertIncludes(kiroQuotaSource, "validateKiroRegion", "region validator");
  assertIncludes(kiroQuotaSource, "AWS_COMMERCIAL_REGION_RE", "region allowlist regex");
});

test("cache TTLs and timeout", () => {
  assertIncludes(kiroQuotaSource, "FRESH_TTL_MS = 60_000", "fresh TTL");
  assertIncludes(kiroQuotaSource, "STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000", "stale max age");
  assertIncludes(kiroQuotaSource, "FETCH_TIMEOUT_MS = 10_000", "fetch timeout");
});

test("single-flight, force refresh, 401 retry once", () => {
  assertIncludes(kiroQuotaSource, "inflightRequests", "single-flight map");
  assertIncludes(kiroQuotaSource, "forceRefresh", "force refresh option");
  assertIncludes(kiroQuotaSource, "statusCode === 401", "401 status check");
  assertIncludes(kiroQuotaSource, "forceRefresh: true", "force refresh on 401");
  // 403 must not force token refresh path (access_denied)
  assertIncludes(kiroQuotaSource, '"access_denied"', "access_denied code");
});

test("401 force-refresh retry is unconditional (same-token still retries once)", () => {
  const retryStart = kiroQuotaSource.indexOf("// 4. 401 only");
  assert.ok(retryStart >= 0, "401 retry block present");
  const retryBlock = kiroQuotaSource.slice(retryStart, retryStart + 700);
  assertIncludes(retryBlock, "forceRefresh: true", "force refresh call");
  assertIncludes(retryBlock, "fetchUsageLimitsData(accessToken, meta.region, meta.profileArn)", "retry fetch");
  // Must NOT gate the retry on accessToken inequality.
  assert.ok(
    !retryBlock.includes("refreshed.accessToken !== accessToken"),
    "must not skip retry when token string is unchanged",
  );
  assertIncludes(
    retryBlock,
    "accessToken = refreshed.accessToken",
    "uses refreshed token for retry regardless of string equality",
  );
  // Only one force-refresh path in the query function — never loops.
  const forceRefreshCalls = kiroQuotaSource.split("forceRefresh: true").length - 1;
  assert.equal(forceRefreshCalls, 1, "exactly one forceRefresh:true site (single retry)");
});

test("ValidationException fallback at most once", () => {
  assertIncludes(kiroQuotaSource, "ValidationException", "validation exception detection");
  assertIncludes(kiroQuotaSource, "buildFallbackBody", "fallback body helper");
  assertIncludes(kiroQuotaSource, "buildPrimaryBody", "primary body helper");
});

test("uses getKiroAccessToken and listOAuthAccounts", () => {
  assertIncludes(kiroQuotaSource, "getKiroAccessToken", "token resolver");
  assertIncludes(kiroQuotaSource, "./kiro-account-token", "token module import");
  assertIncludes(kiroQuotaSource, "listOAuthAccounts", "active account via list");
  assertIncludes(kiroQuotaSource, "KIRO_PROVIDER_ID", "provider id");
});

test("no deep import of pi-kiro-provider internals", () => {
  assertNotIncludes(kiroQuotaSource, "pi-kiro-provider/src", "no deep import");
  assertNotIncludes(kiroQuotaSource, "from \"pi-kiro-provider\"", "no package import in quota module");
});

test("error code allowlist includes unsupported_region / access_denied", () => {
  for (const code of [
    '"network"',
    '"rate_limited"',
    '"unauthorized"',
    '"access_denied"',
    '"upstream"',
    '"invalid_payload"',
    '"unsupported_region"',
  ]) {
    assertIncludes(kiroQuotaSource, code, `error code ${code}`);
  }
});

test("wire kind/schema fixed", () => {
  assertIncludes(kiroQuotaSource, 'kind: "kiro_subscription_quota"', "kind");
  assertIncludes(kiroQuotaSource, "schemaVersion: 1", "schemaVersion");
  assertIncludes(kiroQuotaSource, 'provider: "kiro"', "provider");
});

test("route GET dispatches kiro with no-store", () => {
  assertIncludes(routeSource, "getKiroAccountSubscriptionQuota", "account quota import");
  assertIncludes(routeSource, "getKiroActiveSubscriptionQuota", "active quota import");
  assertIncludes(routeSource, "kiro-subscription-quota", "module import");
  assertIncludes(routeSource, "KIRO_PROVIDER_ID", "provider constant");
  assertIncludes(routeSource, "provider === KIRO_PROVIDER_ID", "GET branch");
  assertIncludes(routeSource, "Cache-Control", "cache control header");
  assertIncludes(routeSource, "no-store", "no-store");
  assertIncludes(routeSource, 'refresh") === "1"', "force refresh query");
});

test("route POST returns 405 for kiro", () => {
  assertIncludes(routeSource, "Kiro does not support reset-credit", "405 message");
  // Ensure kiro branch still returns 405 status
  const kiroPostIdx = routeSource.indexOf("provider === KIRO_PROVIDER_ID");
  assert.ok(kiroPostIdx > 0, "kiro provider branch exists");
  assertIncludes(routeSource.slice(kiroPostIdx), "status: 405", "POST 405 for kiro");
  assertIncludes(routeSource.slice(kiroPostIdx), "no-store", "POST also no-store");
});

test("Grok and Codex routes remain present", () => {
  assertIncludes(routeSource, "GROK_CLI_PROVIDER_ID", "grok still handled");
  assertIncludes(routeSource, "getGrokAccountSubscriptionQuota", "grok account quota");
  assertIncludes(routeSource, "getOAuthProviderSubscriptionQuota", "codex path");
  assertIncludes(routeSource, "consumeOAuthProviderResetCredit", "codex reset credit");
});

// ============================================================================
// 6. Edge cases
// ============================================================================

console.log("\n=== Edge cases ===");

test("precision preferred over integer", () => {
  const bucket = parseUsageBreakdownItem(
    {
      resourceType: "CREDIT",
      currentUsageWithPrecision: 1.25,
      usageLimitWithPrecision: 10.5,
      currentUsage: 1,
      usageLimit: 10,
    },
    0,
  );
  assert.ok(bucket);
  assert.strictEqual(bucket.used, 1.25);
  assert.strictEqual(bucket.limit, 10.5);
  assert.strictEqual(bucket.remaining, 9.25);
});

test("string numbers accepted", () => {
  const bucket = parseUsageBreakdownItem(
    { resourceType: "CREDIT", currentUsage: "3", usageLimit: "12" },
    0,
  );
  assert.ok(bucket);
  assert.strictEqual(bucket.used, 3);
  assert.strictEqual(bucket.limit, 12);
  assert.strictEqual(bucket.utilization, 25);
});

test("max buckets capped", () => {
  const list = Array.from({ length: 20 }, (_, i) => ({
    resourceType: "OTHER",
    currentUsage: i,
    usageLimit: 100,
  }));
  const parsed = parseGetUsageLimitsPayload({ usageBreakdownList: list });
  assert.strictEqual(parsed.buckets.length, MAX_BUCKETS);
});

test("fresh vs live projection states", () => {
  const entry = {
    success: true,
    queriedAt: Date.now() - 15_000,
    buckets: [
      {
        id: "credit-0",
        label: "Credits",
        resourceType: "CREDIT",
        used: 1,
        limit: 10,
        remaining: 9,
        utilization: 10,
      },
    ],
  };
  const fresh = buildQuotaResultV1("a", entry, "fresh", false);
  const live = buildQuotaResultV1("a", entry, "live", false);
  assert.strictEqual(fresh.cache.state, "fresh");
  assert.strictEqual(live.cache.state, "live");
  assert.ok(fresh.cache.ageMs >= 15_000);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
