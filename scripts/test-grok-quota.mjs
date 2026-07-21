#!/usr/bin/env node
/**
 * grok-subscription-quota — fixture parser, cache, and failure tests
 *
 * Verifies core invariants of the Grok billing/quota service without
 * importing the pi SDK or hitting live xAI endpoints:
 *
 * 1. Monthly billing payload parsing
 * 2. Weekly billing payload parsing (present / missing / malformed)
 * 3. Fresh / stale / none cache states
 * 4. Error code classification (network, rate_limited, unauthorized, etc.)
 * 5. Safe projection — no credentials or raw payloads leak
 * 6. Edge cases (used > limit, invalid dates, negative values, NaN)
 * 7. Runtime classification matrix: 401/403 retry, token mapper, stale/reauth
 *    (temp agent dir + mock OAuth/billing fetch only)
 *
 * Run: node scripts/test-grok-quota.mjs
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
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

// ─── Inline parsing functions (mirrored from grok-subscription-quota.ts) ─────

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMonthlyBilling(payload) {
  if (!isRecord(payload)) throw new Error("invalid billing payload");
  const config = payload.config;
  if (!isRecord(config)) throw new Error("invalid billing payload");
  const monthlyLimit = config.monthlyLimit?.val;
  const used = config.used?.val;
  const billingPeriodEnd = config.billingPeriodEnd;
  if (
    typeof monthlyLimit !== "number" || !Number.isFinite(monthlyLimit) || monthlyLimit < 0 ||
    typeof used !== "number" || !Number.isFinite(used) || used < 0 ||
    typeof billingPeriodEnd !== "string" || !Number.isFinite(Date.parse(billingPeriodEnd))
  ) {
    throw new Error("invalid billing payload");
  }
  return { monthlyLimit, used, billingPeriodEnd };
}

function parseWeeklyBilling(payload) {
  if (!isRecord(payload)) return undefined;
  const config = payload.config;
  if (!isRecord(config)) return undefined;
  const currentPeriod = config.currentPeriod;
  if (!isRecord(currentPeriod) || currentPeriod.type !== "USAGE_PERIOD_TYPE_WEEKLY") return undefined;
  const creditUsagePercent = config.creditUsagePercent;
  const billingPeriodEnd = config.billingPeriodEnd;
  if (
    typeof creditUsagePercent !== "number" || !Number.isFinite(creditUsagePercent) || creditUsagePercent < 0 ||
    typeof billingPeriodEnd !== "string" || !Number.isFinite(Date.parse(billingPeriodEnd))
  ) {
    return undefined;
  }
  return { creditUsagePercent, billingPeriodEnd };
}

function normalizeCacheEntry(monthly, weekly, queriedAt, success = true) {
  return { monthly: monthly ?? null, weekly: weekly ?? null, success, queriedAt };
}

function buildQuotaResultV1(accountId, entry, cacheState, reauthRequired, error) {
  const ageMs = entry.queriedAt ? Date.now() - entry.queriedAt : null;
  const result = {
    kind: "grok_subscription_quota",
    schemaVersion: 1,
    success: entry.success && entry.monthly !== null,
    provider: "grok-cli",
    accountId,
    cache: {
      state: cacheState,
      queriedAt: entry.queriedAt ? new Date(entry.queriedAt).toISOString() : null,
      ageMs,
    },
    reauthRequired: reauthRequired || false,
  };

  if (entry.monthly) {
    const limit = entry.monthly.monthlyLimit;
    const used = entry.monthly.used;
    const remaining = Math.max(0, limit - used);
    const utilization = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
    const resetsAt = (() => {
      if (typeof entry.monthly.billingPeriodEnd !== "string") return null;
      const t = Date.parse(entry.monthly.billingPeriodEnd);
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    })();
    if (resetsAt) result.monthly = { limit, used, remaining, utilization, resetsAt };
  }

  if (entry.weekly) {
    const resetsAt = (() => {
      if (typeof entry.weekly.billingPeriodEnd !== "string") return null;
      const t = Date.parse(entry.weekly.billingPeriodEnd);
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    })();
    if (resetsAt) result.weekly = { usedPercent: Math.min(100, Math.max(0, entry.weekly.creditUsagePercent)), resetsAt };
  }

  if (error) result.error = error;
  return result;
}

// ============================================================================
// 1. Monthly billing payload parsing
// ============================================================================

console.log("\n=== Monthly billing parsing ===");

test("valid monthly payload", () => {
  const payload = {
    config: {
      monthlyLimit: { val: 5000 },
      used: { val: 1234 },
      billingPeriodEnd: "2026-08-01T00:00:00Z",
    },
  };
  const result = parseMonthlyBilling(payload);
  assert.strictEqual(result.monthlyLimit, 5000);
  assert.strictEqual(result.used, 1234);
  assert.strictEqual(result.billingPeriodEnd, "2026-08-01T00:00:00Z");
});

test("monthly payload — missing config", () => {
  assert.throws(() => parseMonthlyBilling({}), /invalid billing payload/);
});

test("monthly payload — missing monthlyLimit", () => {
  const payload = { config: { used: { val: 100 } } };
  assert.throws(() => parseMonthlyBilling(payload), /invalid billing payload/);
});

test("monthly payload — NaN monthlyLimit", () => {
  const payload = { config: { monthlyLimit: { val: NaN }, used: { val: 100 }, billingPeriodEnd: "2026-08-01T00:00:00Z" } };
  assert.throws(() => parseMonthlyBilling(payload), /invalid billing payload/);
});

test("monthly payload — negative used", () => {
  const payload = { config: { monthlyLimit: { val: 5000 }, used: { val: -1 }, billingPeriodEnd: "2026-08-01T00:00:00Z" } };
  assert.throws(() => parseMonthlyBilling(payload), /invalid billing payload/);
});

test("monthly payload — used > limit (valid, no error)", () => {
  const payload = { config: { monthlyLimit: { val: 5000 }, used: { val: 9999 }, billingPeriodEnd: "2026-08-01T00:00:00Z" } };
  const result = parseMonthlyBilling(payload);
  assert.strictEqual(result.used, 9999);
});

test("monthly payload — invalid billingPeriodEnd", () => {
  const payload = { config: { monthlyLimit: { val: 5000 }, used: { val: 100 }, billingPeriodEnd: "not-a-date" } };
  assert.throws(() => parseMonthlyBilling(payload), /invalid billing payload/);
});

test("monthly payload — zero limit and used", () => {
  const payload = { config: { monthlyLimit: { val: 0 }, used: { val: 0 }, billingPeriodEnd: "2026-08-01T00:00:00Z" } };
  const result = parseMonthlyBilling(payload);
  assert.strictEqual(result.monthlyLimit, 0);
  assert.strictEqual(result.used, 0);
});

// ============================================================================
// 2. Weekly billing payload parsing
// ============================================================================

console.log("\n=== Weekly billing parsing ===");

test("valid weekly payload", () => {
  const payload = {
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
      creditUsagePercent: 42.5,
      billingPeriodEnd: "2026-07-21T00:00:00Z",
    },
  };
  const result = parseWeeklyBilling(payload);
  assert.ok(result);
  assert.strictEqual(result.creditUsagePercent, 42.5);
  assert.strictEqual(result.billingPeriodEnd, "2026-07-21T00:00:00Z");
});

test("weekly payload — not weekly type returns undefined", () => {
  const payload = {
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" },
      creditUsagePercent: 42.5,
      billingPeriodEnd: "2026-07-21T00:00:00Z",
    },
  };
  assert.strictEqual(parseWeeklyBilling(payload), undefined);
});

test("weekly payload — missing currentPeriod returns undefined", () => {
  const payload = {
    config: {
      creditUsagePercent: 42.5,
      billingPeriodEnd: "2026-07-21T00:00:00Z",
    },
  };
  assert.strictEqual(parseWeeklyBilling(payload), undefined);
});

test("weekly payload — NaN creditUsagePercent returns undefined", () => {
  const payload = {
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
      creditUsagePercent: NaN,
      billingPeriodEnd: "2026-07-21T00:00:00Z",
    },
  };
  assert.strictEqual(parseWeeklyBilling(payload), undefined);
});

test("weekly payload — negative creditUsagePercent returns undefined", () => {
  const payload = {
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
      creditUsagePercent: -5,
      billingPeriodEnd: "2026-07-21T00:00:00Z",
    },
  };
  assert.strictEqual(parseWeeklyBilling(payload), undefined);
});

test("weekly payload — invalid date returns undefined", () => {
  const payload = {
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
      creditUsagePercent: 42.5,
      billingPeriodEnd: "not-a-date",
    },
  };
  assert.strictEqual(parseWeeklyBilling(payload), undefined);
});

// ============================================================================
// 3. Result projection — monthly
// ============================================================================

console.log("\n=== Result projection ===");

test("full live result with monthly + weekly", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1500, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    { creditUsagePercent: 30, billingPeriodEnd: "2026-07-21T00:00:00Z" },
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.kind, "grok_subscription_quota");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.cache.state, "live");
  assert.ok(result.monthly);
  assert.strictEqual(result.monthly.limit, 5000);
  assert.strictEqual(result.monthly.used, 1500);
  assert.strictEqual(result.monthly.remaining, 3500);
  assert.strictEqual(result.monthly.utilization, 30); // (1500/5000)*100
  assert.ok(result.weekly);
  assert.strictEqual(result.weekly.usedPercent, 30);
  assert.strictEqual(result.reauthRequired, false);
  assert.strictEqual(result.error, undefined);
});

test("live result with monthly only (no weekly)", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 1000, used: 999, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.monthly.utilization, 99.9);
  assert.strictEqual(result.monthly.remaining, 1);
  assert.strictEqual(result.weekly, undefined);
});

test("stale result preserves existing data", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 2000, used: 2000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now() - 3600_000, // 1 hour old
  );
  const result = buildQuotaResultV1("acct_test", entry, "stale", false, {
    code: "network",
    message: "Upstream timeout",
    retryable: true,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.cache.state, "stale");
  assert.ok(result.cache.ageMs >= 3600_000);
  assert.ok(result.error);
  assert.strictEqual(result.error.code, "network");
  assert.strictEqual(result.monthly.remaining, 0);
  assert.strictEqual(result.monthly.utilization, 100);
});

test("none state — no data available", () => {
  const entry = normalizeCacheEntry(null, null, null, false);
  const result = buildQuotaResultV1("acct_test", entry, "none", false, {
    code: "network",
    message: "No cached quota data available",
    retryable: true,
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.cache.state, "none");
  assert.strictEqual(result.cache.queriedAt, null);
  assert.strictEqual(result.monthly, undefined);
});

test("reauthRequired flag", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 0, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "stale", true, {
    code: "unauthorized",
    message: "Token expired",
    retryable: true,
  });
  assert.strictEqual(result.reauthRequired, true);
  assert.strictEqual(result.error.code, "unauthorized");
});

test("used > limit — utilization clamped to 100, remaining 0", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 1000, used: 2000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.monthly.remaining, 0);
  assert.strictEqual(result.monthly.utilization, 100);
});

test("zero limit — utilization 0", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 0, used: 0, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.monthly.utilization, 0);
  assert.strictEqual(result.monthly.remaining, 0);
});

test("weekly usedPercent clamped 0-100", () => {
  // Over 100%
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    { creditUsagePercent: 150, billingPeriodEnd: "2026-07-21T00:00:00Z" },
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.weekly.usedPercent, 100);
});

// ============================================================================
// 4. Security — no secrets in projection
// ============================================================================

console.log("\n=== Security — no secrets in projection ===");

test("result JSON never contains 'access' token", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  const json = JSON.stringify(result);
  assertNotIncludes(json, "access", "JSON must not contain access token field");
  assertNotIncludes(json, "refresh", "JSON must not contain refresh token field");
  assertNotIncludes(json, "token", "JSON must not contain token field");
});

test("result JSON never contains raw upstream payload fields", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  const json = JSON.stringify(result);
  assertNotIncludes(json, '"config"', "JSON must not contain raw billing config");
  assertNotIncludes(json, "monthlyLimit", "JSON must not contain raw monthlyLimit");
});

// ============================================================================
// 5. Source-code contract checks
// ============================================================================

console.log("\n=== Source-code contract checks ===");

const grokQuotaSource = read("lib/grok-subscription-quota.ts");

test("GROK_BILLING_BASE_URL is defined", () => {
  assertIncludes(grokQuotaSource, "GROK_BILLING_BASE_URL", "base URL constant");
});

test("FRESH_TTL_MS = 60_000", () => {
  assertIncludes(grokQuotaSource, "FRESH_TTL_MS = 60_000", "fresh TTL");
});

test("STALE_MAX_AGE_MS = 24h", () => {
  assertIncludes(grokQuotaSource, "STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000", "stale max age");
});

test("FETCH_TIMEOUT_MS = 10_000", () => {
  assertIncludes(grokQuotaSource, "FETCH_TIMEOUT_MS = 10_000", "fetch timeout");
});

test("Cache-Control: no-store in route handler", () => {
  const routeSource = read("app/api/auth/quota/[provider]/route.ts");
  assertIncludes(routeSource, "Cache-Control", "route has Cache-Control header");
  assertIncludes(routeSource, "no-store", "route has no-store value");
});

test("No deep import of pi-grok-cli internals", () => {
  assertNotIncludes(grokQuotaSource, "pi-grok-cli/src", "no deep import");
  assertNotIncludes(grokQuotaSource, "pi-grok-cli/dist", "no deep import");
});

test("Uses getGrokAccessToken from grok-account-token", () => {
  assertIncludes(grokQuotaSource, "getGrokAccessToken", "uses token resolver");
  assertIncludes(grokQuotaSource, "./grok-account-token", "imports from grok-account-token");
});

test("Uses getActiveGrokAccountId from grok-session-account", () => {
  assertIncludes(grokQuotaSource, "getActiveGrokAccountId", "uses active account helper");
  assertIncludes(grokQuotaSource, "./grok-session-account", "imports from grok-session-account");
});

test("No credential material in error messages", () => {
  // Error messages must not contain words like access, refresh, token, secret, password, key
  assertNotIncludes(grokQuotaSource, '"access"', "no bare access in error strings");
  assertNotIncludes(grokQuotaSource, "password", "no password in source");
  assertNotIncludes(grokQuotaSource, "secret", "no secret in source");
});

test("Error codes are a fixed allowlist", () => {
  assertIncludes(grokQuotaSource, 'type QuotaErrorCode', "QuotaErrorCode type exists");
  assertIncludes(grokQuotaSource, '"network"', "network error code");
  assertIncludes(grokQuotaSource, '"rate_limited"', "rate_limited error code");
  assertIncludes(grokQuotaSource, '"unauthorized"', "unauthorized error code");
  assertIncludes(grokQuotaSource, '"upstream"', "upstream error code");
  assertIncludes(grokQuotaSource, '"invalid_payload"', "invalid_payload error code");
});

test("Monthly fields: monthlyLimit.val, used.val, billingPeriodEnd", () => {
  assertIncludes(grokQuotaSource, "monthlyLimit", "monthlyLimit field");
  assertIncludes(grokQuotaSource, "billingPeriodEnd", "billingPeriodEnd field");
});

test("Weekly fields: currentPeriod.type, creditUsagePercent, billingPeriodEnd", () => {
  assertIncludes(grokQuotaSource, "USAGE_PERIOD_TYPE_WEEKLY", "weekly period type");
  assertIncludes(grokQuotaSource, "creditUsagePercent", "creditUsagePercent field");
});

test("401/403 triggers refresh+retry", () => {
  assertIncludes(grokQuotaSource, "401", "handles 401");
  assertIncludes(grokQuotaSource, "403", "handles 403");
});

test("Single-flight key uses grok-cli provider id", () => {
  assertIncludes(grokQuotaSource, "GROK_CLI_PROVIDER_ID", "single-flight key uses provider id");
});

test("POST returns 405 for grok-cli (no reset-credit)", () => {
  const routeSource = read("app/api/auth/quota/[provider]/route.ts");
  assertIncludes(routeSource, "405", "POST returns 405 for grok-cli");
  assertIncludes(routeSource, "reset-credit", "mentions reset-credit");
});

// ============================================================================
// 6. Route handler contract checks
// ============================================================================

console.log("\n=== Route handler contract checks ===");

const routeSource = read("app/api/auth/quota/[provider]/route.ts");

test("Route imports Grok quota functions", () => {
  assertIncludes(routeSource, "getGrokAccountSubscriptionQuota", "imports account quota fn");
  assertIncludes(routeSource, "getGrokActiveSubscriptionQuota", "imports active quota fn");
  assertIncludes(routeSource, "grok-subscription-quota", "imports from grok module");
});

test("Route dispatches grok-cli on GET", () => {
  assertIncludes(routeSource, "provider === GROK_CLI_PROVIDER_ID", "checks grok-cli on GET");
});

test("Route accepts ?refresh=1 for force refresh", () => {
  assertIncludes(routeSource, '"refresh"', "reads refresh param");
  assertIncludes(routeSource, 'forceRefresh', "forceRefresh variable");
});

test("Route accepts ?accountId= for specific account", () => {
  assertIncludes(routeSource, '"accountId"', "reads accountId param on GET grok path");
});

test("OpenAI Codex path unchanged", () => {
  assertIncludes(routeSource, "getOAuthProviderSubscriptionQuota", "Codex provider quota fn still used");
  assertIncludes(routeSource, "getOAuthAccountSubscriptionQuota", "Codex account quota fn still used");
});

// ============================================================================
// 7. Edge cases
// ============================================================================

console.log("\n=== Edge cases ===");

test("result with invalid monthly date drops monthly block, success stays true", () => {
  // The parse layer rejects invalid dates before they reach the cache.
  // If an invalid date somehow reaches the cache, the monthly block is
  // omitted from the projection but success reflects the raw entry.
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1000, billingPeriodEnd: "not-valid-date" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  // monthly block is omitted because resetsAt can't be parsed
  assert.strictEqual(result.monthly, undefined);
  // entry.monthly is not null, so success reflects that
  assert.strictEqual(result.success, true);
});

test("result with only weekly (no monthly) is unsuccessful", () => {
  const entry = normalizeCacheEntry(
    null,
    { creditUsagePercent: 42, billingPeriodEnd: "2026-07-21T00:00:00Z" },
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.monthly, undefined);
});

test("fresh cache state vs stale — age within TTL = fresh", () => {
  const age = 30_000; // 30s < 60s TTL
  // This is validated by the service logic; we just verify the projection
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now() - age,
  );
  const result = buildQuotaResultV1("acct_test", entry, "fresh", false);
  assert.strictEqual(result.cache.state, "fresh");
  assert.ok(result.cache.ageMs >= age);
  assert.ok(result.cache.ageMs < age + 100);
});

test("GrokQuotaResultV1 kind and schemaVersion are fixed", () => {
  const entry = normalizeCacheEntry(
    { monthlyLimit: 5000, used: 1000, billingPeriodEnd: "2026-08-01T00:00:00Z" },
    null,
    Date.now(),
  );
  const result = buildQuotaResultV1("acct_test", entry, "live", false);
  assert.strictEqual(result.kind, "grok_subscription_quota");
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.provider, "grok-cli");
});

test("token→quota mapper and unconditional billing retry after force refresh", () => {
  assertIncludes(grokQuotaSource, "mapGrokTokenErrorToQuotaError", "token→quota mapper");
  assertIncludes(grokQuotaSource, "mapGrokBillingHttpError", "billing HTTP mapper");
  assertIncludes(grokQuotaSource, "forceRefresh: true", "force refresh once");
  assertIncludes(grokQuotaSource, "after a successful force refresh", "unconditional retry comment");
  assertIncludes(grokQuotaSource, "normalizeQuotaCacheEntry", "success cache normalization");
  assertIncludes(grokQuotaSource, "__resetGrokQuotaStateForTests", "test reset helper");
  // First-pass 403 must not be unauthorized/reauth evidence.
  assertIncludes(grokQuotaSource, "access_denied", "403 access denied messaging");
  const forceRefreshCalls = grokQuotaSource.split("forceRefresh: true").length - 1;
  assert.equal(forceRefreshCalls, 1, "exactly one forceRefresh:true site (single retry)");
});

// ============================================================================
// 8. Runtime classification matrix (temp dir + mock fetch, no xAI network)
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

function billingOkBody() {
  return {
    config: {
      monthlyLimit: { val: 5000 },
      used: { val: 1200 },
      billingPeriodEnd: "2026-08-01T00:00:00Z",
    },
  };
}

const jiti = createJiti(import.meta.url, { alias: { "@": root } });

await testAsync("mapGrokTokenErrorToQuotaError + 401/403/stale runtime matrix", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-quota-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const originalFetch = globalThis.fetch;

  const oauth = await jiti.import(pathToFileURL(join(root, "lib/pi-ai-oauth-compat.ts")).href);
  const {
    registerOAuthProvider,
    unregisterOAuthProvider,
    getOAuthProvider,
  } = oauth;
  const previous = getOAuthProvider("grok-cli");

  /** @type {{ mode: "ok" | "invalid_grant" | "network" | "generic" | "provider", calls: number }} */
  const refreshControl = { mode: "ok", calls: 0 };

  registerOAuthProvider({
    id: "grok-cli",
    name: "Grok (quota classification fixture)",
    async login() {
      throw new Error("login not used in quota classification test");
    },
    async refreshToken(credentials) {
      refreshControl.calls += 1;
      if (refreshControl.mode === "invalid_grant") {
        const err = new Error("invalid_grant");
        err.code = "refresh_failed";
        err.reloginRequired = true;
        throw err;
      }
      if (refreshControl.mode === "network") {
        throw new Error("fetch failed: ECONNRESET");
      }
      if (refreshControl.mode === "generic") {
        throw new Error("Grok OAuth token refresh failed: upstream 503");
      }
      if (refreshControl.mode === "provider") {
        const err = new Error("provider unavailable");
        err.code = "discovery_failed";
        throw err;
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
      return typeof credentials.access === "string" ? credentials.access : "";
    },
  });

  try {
    const {
      mapGrokTokenErrorToQuotaError,
      mapGrokBillingHttpError,
      getGrokAccountSubscriptionQuota,
      __resetGrokQuotaStateForTests,
    } = await jiti.import(pathToFileURL(join(root, "lib/grok-subscription-quota.ts")).href);
    const { GrokTokenError } = await jiti.import(
      pathToFileURL(join(root, "lib/grok-account-token.ts")).href,
    );
    const { GROK_CLI_PROVIDER_ID, saveOAuthAccountCredential, activateOAuthAccount } =
      await jiti.import(pathToFileURL(join(root, "lib/oauth-accounts.ts")).href);

    // ── Pure mapper matrix (no network) ──
    const matrix = [
      ["unauthorized", "unauthorized", true],
      ["missing_refresh", "unauthorized", true],
      ["account_not_found", "unauthorized", true],
      ["invalid_credential", "unauthorized", true],
      ["missing_storage_id", "unauthorized", true],
      ["refresh_failed", "upstream", false],
      ["provider_unavailable", "upstream", false],
      ["unavailable", "upstream", false],
      ["network", "network", false],
    ];
    for (const [tokenCode, quotaCode, reauth] of matrix) {
      const mapped = mapGrokTokenErrorToQuotaError(new GrokTokenError(/** @type {any} */ (tokenCode)));
      assert.equal(mapped.code, quotaCode, `${tokenCode} → ${quotaCode}`);
      if (reauth) assert.equal(mapped.code, "unauthorized", `${tokenCode} reauth code`);
      else assert.notEqual(mapped.code, "unauthorized", `${tokenCode} non-reauth`);
      const json = JSON.stringify(mapped);
      assert.ok(!json.includes("cli-chat-proxy"), "no billing host leak");
      assert.ok(!json.includes("refresh-"), "no refresh leak");
    }
    const unknownMapped = mapGrokTokenErrorToQuotaError(new Error("totally unknown boom"));
    assert.equal(unknownMapped.code, "upstream");

    assert.equal(mapGrokBillingHttpError(401).code, "unauthorized");
    assert.equal(mapGrokBillingHttpError(403).code, "upstream", "403 is non-reauth");
    assert.equal(mapGrokBillingHttpError(429).code, "rate_limited");
    assert.equal(mapGrokBillingHttpError(503).code, "upstream");

    // ── 401 → force refresh → 200 ──
    __resetGrokQuotaStateForTests();
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    const stillValid = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "still-valid-access",
      refresh: "quota-valid-refresh-2",
      expires: Date.now() + 3_600_000,
    });
    await activateOAuthAccount(GROK_CLI_PROVIDER_ID, stillValid.accountId);

    /** @type {number} */
    let fetchCalls = 0;
    globalThis.fetch = async (input, init) => {
      fetchCalls += 1;
      const url = String(input);
      assert.ok(url.includes("cli-chat-proxy.grok.com/v1/billing"), "only fixed billing host");
      const headers = init?.headers || {};
      const auth =
        (typeof headers.get === "function" ? headers.get("authorization") : null)
        || headers.authorization
        || headers.Authorization
        || "";
      if (fetchCalls === 1) {
        assert.ok(auth.includes("still-valid-access"), "first fetch uses current AT");
        return jsonResponse(401, { error: "invalid authentication" });
      }
      // Second call is monthly retry; weekly may follow as best-effort.
      if (auth.includes("quota-refreshed-access-")) {
        if (url.includes("format=credits")) {
          return jsonResponse(200, {
            config: {
              currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
              creditUsagePercent: 12,
              billingPeriodEnd: "2026-07-21T00:00:00Z",
            },
          });
        }
        return jsonResponse(200, billingOkBody());
      }
      return jsonResponse(500, { error: "unexpected token on retry" });
    };

    const retryOk = await getGrokAccountSubscriptionQuota(stillValid.accountId, { forceRefresh: true });
    assert.equal(retryOk.success, true, "401→refresh→200 success");
    assert.equal(retryOk.reauthRequired, false);
    assert.equal(retryOk.cache.state, "live");
    assert.ok(retryOk.monthly, "monthly present");
    assert.equal(refreshControl.calls, 1, "exactly one force refresh");
    // monthly first 401 + monthly retry 200 (+ optional weekly) => >=2 billing monthly-ish calls
    assert.ok(fetchCalls >= 2, "at least one retry fetch");
    // monthly path only twice (401 then 200); weekly may add one more
    assert.ok(fetchCalls <= 3, "refresh/retry bounded");
    const retryJson = JSON.stringify(retryOk);
    assert.ok(!retryJson.includes("still-valid-access"), "wire omits access");
    assert.ok(!retryJson.includes("quota-valid-refresh-2"), "wire omits refresh");
    assert.ok(!retryJson.includes(agentDir), "wire omits absolute path");

    // ── 401 → force refresh → still 401 (reauth) ──
    __resetGrokQuotaStateForTests();
    const still401 = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "still-401-access",
      refresh: "quota-valid-refresh-401",
      expires: Date.now() + 3_600_000,
    });
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(401, { error: "still unauthorized" });
    };
    const retryStill401 = await getGrokAccountSubscriptionQuota(still401.accountId, { forceRefresh: true });
    assert.equal(retryStill401.success, false);
    assert.equal(retryStill401.reauthRequired, true, "refresh then 401 reauth");
    assert.equal(retryStill401.error?.code, "unauthorized");
    assert.equal(refreshControl.calls, 1, "one force refresh on 401 path");
    assert.equal(fetchCalls, 2, "exactly one billing retry after refresh");

    // ── 403 → force refresh → 403 (non-reauth) ──
    __resetGrokQuotaStateForTests();
    const denied = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "denied-access",
      refresh: "quota-valid-refresh-403",
      expires: Date.now() + 3_600_000,
    });
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(403, { error: "access denied" });
    };
    const deniedResult = await getGrokAccountSubscriptionQuota(denied.accountId, { forceRefresh: true });
    assert.equal(deniedResult.success, false);
    assert.equal(deniedResult.reauthRequired, false, "final 403 non-reauth");
    assert.equal(deniedResult.error?.code, "upstream");
    assert.equal(refreshControl.calls, 1, "one compatibility force refresh on 403");
    assert.equal(fetchCalls, 2, "exactly one billing retry after 403 refresh");

    // ── invalid_grant / reloginRequired on force refresh → reauth ──
    __resetGrokQuotaStateForTests();
    const revoked = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "revoked-access",
      refresh: "revoked-refresh",
      expires: Date.now() + 3_600_000,
    });
    refreshControl.mode = "invalid_grant";
    refreshControl.calls = 0;
    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(401, { error: "invalid authentication" });
    };
    const reauthResult = await getGrokAccountSubscriptionQuota(revoked.accountId, { forceRefresh: true });
    assert.equal(reauthResult.success, false);
    assert.equal(reauthResult.reauthRequired, true, "reloginRequired must reauth");
    assert.equal(reauthResult.error?.code, "unauthorized");
    assert.equal(refreshControl.calls, 1);
    assert.equal(fetchCalls, 1, "no billing retry when force refresh fails");

    // ── provider/network/generic refresh failure after 401 → non-reauth ──
    __resetGrokQuotaStateForTests();
    const transient = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "transient-access",
      refresh: "transient-refresh",
      expires: Date.now() + 3_600_000,
    });
    globalThis.fetch = async () => jsonResponse(401, { error: "invalid authentication" });

    refreshControl.mode = "generic";
    refreshControl.calls = 0;
    const upstreamFail = await getGrokAccountSubscriptionQuota(transient.accountId, { forceRefresh: true });
    assert.equal(upstreamFail.success, false);
    assert.equal(upstreamFail.reauthRequired, false, "generic refresh failure must not reauth");
    assert.notEqual(upstreamFail.error?.code, "unauthorized");

    __resetGrokQuotaStateForTests();
    refreshControl.mode = "network";
    refreshControl.calls = 0;
    const networkFail = await getGrokAccountSubscriptionQuota(transient.accountId, { forceRefresh: true });
    assert.equal(networkFail.success, false);
    assert.equal(networkFail.reauthRequired, false, "network refresh failure must not reauth");
    assert.equal(networkFail.error?.code, "network");

    __resetGrokQuotaStateForTests();
    refreshControl.mode = "provider";
    refreshControl.calls = 0;
    const providerFail = await getGrokAccountSubscriptionQuota(transient.accountId, { forceRefresh: true });
    assert.equal(providerFail.success, false);
    assert.equal(providerFail.reauthRequired, false, "provider/discovery failure must not reauth");
    assert.notEqual(providerFail.error?.code, "unauthorized");

    // ── stale success + transient (non-reauth) / credential loss (reauth) ──
    __resetGrokQuotaStateForTests();
    const staleAccount = await saveOAuthAccountCredential(GROK_CLI_PROVIDER_ID, {
      access: "stale-access",
      refresh: "stale-refresh",
      expires: Date.now() + 3_600_000,
    });
    // Seed a sticky historical success+reauth cache entry and ensure it is normalized.
    const cacheDir = join(agentDir, "auth-accounts", "grok-cli");
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const cachePath = join(cacheDir, ".quota-cache.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          [staleAccount.accountId]: {
            monthly: {
              monthlyLimit: 5000,
              used: 100,
              billingPeriodEnd: "2026-08-01T00:00:00Z",
            },
            weekly: null,
            success: true,
            queriedAt: Date.now() - 120_000,
            reauthRequired: true,
          },
        },
      }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );

    refreshControl.mode = "network";
    refreshControl.calls = 0;
    globalThis.fetch = async () => jsonResponse(401, { error: "invalid authentication" });
    const staleTransient = await getGrokAccountSubscriptionQuota(staleAccount.accountId, {
      forceRefresh: true,
    });
    assert.equal(staleTransient.success, true, "stale success retained");
    assert.equal(staleTransient.cache.state, "stale");
    assert.equal(staleTransient.reauthRequired, false, "transient+stale non-reauth");
    assert.ok(staleTransient.monthly, "monthly retained from stale cache");
    assert.equal(staleTransient.monthly.used, 100);

    // Confirmed credential loss + stale keeps monthly and reauth=true.
    __resetGrokQuotaStateForTests();
    // Re-seed success cache without sticky reauth after previous read normalization path.
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          [staleAccount.accountId]: {
            monthly: {
              monthlyLimit: 5000,
              used: 100,
              billingPeriodEnd: "2026-08-01T00:00:00Z",
            },
            weekly: null,
            success: true,
            queriedAt: Date.now() - 120_000,
            reauthRequired: true,
          },
        },
      }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    refreshControl.mode = "invalid_grant";
    refreshControl.calls = 0;
    globalThis.fetch = async () => jsonResponse(401, { error: "invalid authentication" });
    const staleReauth = await getGrokAccountSubscriptionQuota(staleAccount.accountId, {
      forceRefresh: true,
    });
    assert.equal(staleReauth.success, true, "stale monthly retained with credential loss");
    assert.equal(staleReauth.cache.state, "stale");
    assert.equal(staleReauth.reauthRequired, true, "confirmed credential loss + stale reauth");
    assert.equal(staleReauth.error?.code, "unauthorized");

    // Live success clears historical reauth: first force a success after sticky seed.
    __resetGrokQuotaStateForTests();
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          [staleAccount.accountId]: {
            monthly: {
              monthlyLimit: 5000,
              used: 100,
              billingPeriodEnd: "2026-08-01T00:00:00Z",
            },
            weekly: null,
            success: true,
            queriedAt: Date.now() - 120_000,
            reauthRequired: true,
          },
        },
      }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    refreshControl.mode = "ok";
    refreshControl.calls = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("format=credits")) {
        return jsonResponse(200, {
          config: {
            currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
            creditUsagePercent: 5,
            billingPeriodEnd: "2026-07-21T00:00:00Z",
          },
        });
      }
      return jsonResponse(200, billingOkBody());
    };
    const live = await getGrokAccountSubscriptionQuota(staleAccount.accountId, { forceRefresh: true });
    assert.equal(live.success, true);
    assert.equal(live.reauthRequired, false, "live success clears reauth");
    assert.equal(live.cache.state, "live");
    const persistedAfter = JSON.parse(await readFile(cachePath, "utf8"));
    const liveEntry = persistedAfter.entries[staleAccount.accountId];
    assert.equal(liveEntry.success, true);
    assert.ok(!liveEntry.reauthRequired, "persisted success entry has no sticky reauth");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      unregisterOAuthProvider("grok-cli");
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

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
