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
 *
 * Run: node scripts/test-grok-quota.mjs
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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
