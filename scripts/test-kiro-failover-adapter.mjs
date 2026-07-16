#!/usr/bin/env node
/**
 * Kiro failover adapter contract tests: classifier, config, candidate freshness.
 *
 * Classifier fixtures are evaluated against a pure inline mirror of
 * `detectKiroFailoverReason` kept in lockstep with the production source via
 * structural assertions. Full module import is avoided because the controller
 * pulls OAuth/quota deps that need the installed pi packages.
 *
 * Run: npm run test:kiro-failover-adapter
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

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
  assert.ok(source.includes(needle), `${label}: expected to include ${JSON.stringify(needle)}`);
}

function assertNotIncludes(source, needle, label) {
  assert.ok(!source.includes(needle), `${label}: expected NOT to include ${JSON.stringify(needle)}`);
}

console.log("\n=== source contracts ===");

const failover = read("lib/kiro-account-failover.ts");
const config = read("lib/pi-web-config.ts");
const quota = read("lib/kiro-subscription-quota.ts");

test("kiro.autoFailover defaults off with Grok-aligned budgets", () => {
  assertIncludes(config, "export interface PiWebKiroAutoFailoverConfig", "type");
  assertIncludes(config, "kiro: {", "kiro section");
  const kiroIdx = config.indexOf("kiro: {");
  const slice = config.slice(kiroIdx, kiroIdx + 450);
  assertIncludes(slice, "enabled: false", "default off");
  assertIncludes(slice, "maxAttemptsPerTurn: 1", "1 attempt");
  assertIncludes(slice, "maxAccountSwitchesPerTurn: 1", "1 switch");
  assertIncludes(slice, "quotaCacheMaxAgeMs", "cache age");
});

test("candidate checks primary remaining/fresh/live/reauth fail-closed", () => {
  assertIncludes(failover, "primary.remaining", "primary remaining");
  assertIncludes(failover, "remaining <= 0", "remaining gate");
  assertIncludes(failover, "reauthRequired", "reauth");
  assertIncludes(failover, 'cache.state === "none" || quota.cache.state === "stale"', "stale/none fail closed");
  assertIncludes(failover, 'cache.state !== "fresh" && quota.cache.state !== "live"', "fresh/live only");
  assertIncludes(failover, "quotaCacheMaxAgeMs", "freshness");
  assertIncludes(failover, "getKiroAccountSubscriptionQuota", "uses kiro quota");
  assertIncludes(quota, "export async function getKiroAccountSubscriptionQuota", "quota export");
});

test("no broad /limit|rate/ classifier", () => {
  const withoutComments = failover.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assertNotIncludes(withoutComments, "/limit|rate/", "no broad regex in code");
  assertNotIncludes(withoutComments, "/limit|rate/i", "no broad i regex in code");
});

test("hard negatives include capacity and bare status", () => {
  assertIncludes(failover, "insufficient[_ -]?model[_ -]?capacity", "capacity regex");
  assertIncludes(failover, "authentication|unauthorized|reauth", "auth negative");
  assertIncludes(failover, "network|fetch failed", "network negative");
  assertIncludes(failover, "timeout|timed out", "timeout negative");
  assertIncludes(failover, "^(status=)?(429|400|401|403|404|500|502|503)$", "bare status");
});

test("production detector still contains lockstep markers used by fixtures", () => {
  assertIncludes(failover, "MONTHLY_REQUEST_COUNT", "monthly request count");
  assertIncludes(failover, "OVERAGE_REQUEST_LIMIT_EXCEEDED", "overage");
  assertIncludes(failover, "CONVERSATION_LIMIT_EXCEEDED", "conversation limit");
  assertIncludes(failover, "DAILY_REQUEST_COUNT", "daily request count");
  assertIncludes(failover, "ServiceQuotaExceededError", "service quota");
  assertIncludes(failover, "quota_or_entitlement", "authFailure reason");
  assertIncludes(failover, "rate_limit_exceeded", "rate limit code");
  assertIncludes(failover, "too[_ -]?many[_ -]?requests", "too many requests");
  assertIncludes(failover, "insufficient_quota", "insufficient_quota");
  assertIncludes(failover, "monthly (usage )?limit", "monthly");
});

test("controller owns process state and concurrency primitives", () => {
  assertIncludes(failover, "__piKiroFailover", "own state key");
  assertIncludes(failover, "withFailoverLock", "lock");
  assertIncludes(failover, "activeAfterLock", "after lock");
  assertIncludes(failover, "activeBeforeActivate", "before activate");
  assertIncludes(failover, "already_switched_by_other_session", "other session");
  assertIncludes(failover, "maxAttemptsPerTurn", "budget attempts");
  assertIncludes(failover, "maxAccountSwitchesPerTurn", "budget switches");
});

test("failed catch message is display-safe (no raw error leak)", () => {
  assertIncludes(failover, 'message: "Kiro account failover failed."', "safe failed message");
  assertNotIncludes(failover, "errorText(error)", "does not project catch error text");
});

console.log("\n=== detectKiroFailoverReason fixtures (inline mirror) ===");

// Keep this pure function aligned with lib/kiro-account-failover.ts.
// Structural markers above fail if production drifts without updating fixtures.
function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function pushText(parts, value) {
  const text = errorText(value);
  if (text) parts.push(text);
}

function detectKiroFailoverReason(message) {
  const record = typeof message === "object" && message !== null ? message : {};
  const stopReason = String(record.stopReason ?? "");
  const parts = [];

  pushText(parts, record.errorMessage);
  pushText(parts, record.message);
  pushText(parts, record.error);
  pushText(parts, record.statusText);
  pushText(parts, record.code);
  pushText(parts, record.type);
  pushText(parts, record.errorCode);
  pushText(parts, record.error_type);
  pushText(parts, record.reason);
  if (typeof record.status === "number") parts.push(`status=${record.status}`);

  if (typeof record.error === "object" && record.error !== null) {
    const nested = record.error;
    pushText(parts, nested.message);
    pushText(parts, nested.code);
    pushText(parts, nested.type);
    pushText(parts, nested.error);
    pushText(parts, nested.reason);
    pushText(parts, nested.errorCode);
  }

  let authFailureReason = "";
  const authFailure = record.authFailure
    ?? (typeof record.error === "object" && record.error !== null
      ? record.error.authFailure
      : undefined);
  if (typeof authFailure === "object" && authFailure !== null) {
    authFailureReason = String(authFailure.reason ?? "").trim();
    pushText(parts, authFailure.reason);
    pushText(parts, authFailure.message);
    pushText(parts, authFailure.code);
    pushText(parts, authFailure.type);
  } else if (typeof authFailure === "string") {
    authFailureReason = authFailure.trim();
    pushText(parts, authFailure);
  }

  const combined = parts.filter(Boolean).join("\n");
  const lower = combined.toLowerCase();
  if (!combined.trim()) return null;
  if (stopReason && stopReason !== "error") return null;

  if (
    /\binsufficient[_ -]?model[_ -]?capacity\b/i.test(combined)
    || /\b(authentication|unauthorized|reauth|re-auth|reauthenticate|invalid.?token|expired.?token|invalid.?grant|login required|please (log|sign) ?in)\b/i.test(lower)
    || /\b(network|fetch failed|econnreset|enotfound|econnrefused|socket hang up)\b/i.test(lower)
    || /\b(timeout|timed out|deadline exceeded)\b/i.test(lower)
    || /\b(context (length |window )?(overflow|exceeded)|maximum context|token limit exceeded for context)\b/i.test(lower)
    || /\b(content filter|content.?policy|safety filter|moderation)\b/i.test(lower)
    || /\b(model (not found|unavailable|does not exist)|unknown model)\b/i.test(lower)
    || /(?:^|\s)(500|502|503|504)\b/.test(combined)
  ) {
    return null;
  }

  if (/^(status=)?(429|400|401|403|404|500|502|503)$/i.test(combined.trim())) {
    return null;
  }

  if (
    /\bMONTHLY_REQUEST_COUNT\b/.test(combined)
    || /\bOVERAGE_REQUEST_LIMIT_EXCEEDED\b/.test(combined)
    || /\bCONVERSATION_LIMIT_EXCEEDED\b/.test(combined)
    || /\bDAILY_REQUEST_COUNT\b/.test(combined)
    || /\bServiceQuotaExceededError\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  if (authFailureReason === "quota_or_entitlement") {
    if (/\b(unauthorized|invalid.?token|expired.?token|invalid.?grant|reauth)\b/i.test(lower)) {
      return null;
    }
    return "quota_exhausted";
  }

  if (
    /\b(rate_limit_exceeded|rate-limit-exceeded|ratelimitexceeded)\b/i.test(combined)
    || /\btoo[_ -]?many[_ -]?requests\b/i.test(lower)
    || /\brate[_ -]?limit(?:ed|ing)?\b/i.test(lower)
    || /\bcode["'=\s:]+rate[_-]?limit/i.test(combined)
    || /\btype["'=\s:]+rate[_-]?limit/i.test(combined)
  ) {
    if (/\b(how to|learn more|documentation|for more information about rate|rate of change)\b/i.test(lower)) {
      return null;
    }
    return "rate_limited";
  }

  if (
    /\b(insufficient_quota|quota_exceeded|quota exceeded|quota exhausted)\b/i.test(lower)
    || /\b(usage[_ -]?limit|usage limit (reached|exceeded|exhausted))\b/i.test(lower)
    || /\b(monthly (usage )?limit (reached|exceeded|exhausted)|monthly quota)\b/i.test(lower)
    || /\b(daily (usage |request )?limit (reached|exceeded|exhausted)|daily quota)\b/i.test(lower)
    || /\b(credits? (exhausted|exceeded|depleted)|out of credits|no credits remaining)\b/i.test(lower)
    || /\b(exceeded your (current )?quota|you have exceeded your quota)\b/i.test(lower)
    || /\bcode["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
    || /\btype["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  return null;
}

const positives = [
  { text: "MONTHLY_REQUEST_COUNT", reason: "quota_exhausted" },
  { text: "OVERAGE_REQUEST_LIMIT_EXCEEDED", reason: "quota_exhausted" },
  { text: "CONVERSATION_LIMIT_EXCEEDED", reason: "quota_exhausted" },
  { text: "DAILY_REQUEST_COUNT", reason: "quota_exhausted" },
  { text: "ServiceQuotaExceededError", reason: "quota_exhausted" },
  { text: "insufficient_quota", reason: "quota_exhausted" },
  { text: "quota exceeded", reason: "quota_exhausted" },
  { text: "quota exhausted", reason: "quota_exhausted" },
  { text: "monthly usage limit reached", reason: "quota_exhausted" },
  { text: "rate_limit_exceeded", reason: "rate_limited" },
  { text: "too many requests", reason: "rate_limited" },
  { text: "You are being rate limited by the provider", reason: "rate_limited" },
  { text: 'code: "insufficient_quota"', reason: "quota_exhausted" },
];

const negatives = [
  "429",
  "status=429",
  "403",
  "status=403",
  "INSUFFICIENT_MODEL_CAPACITY",
  "insufficient model capacity for this request",
  "See documentation for rate of change limits in training",
  "network error: fetch failed",
  "timeout waiting for upstream",
  "HTTP 500 internal server error",
  "502 bad gateway",
  "authentication failed, please reauth",
  "unauthorized invalid token",
  "invalid_grant please reauthenticate",
  "context overflow: maximum context length exceeded",
  "content filter blocked this response",
  "model unavailable: unknown model",
];

for (const item of positives) {
  test(`positive: ${item.text}`, () => {
    assert.equal(detectKiroFailoverReason({ stopReason: "error", errorMessage: item.text }), item.reason);
  });
}

for (const text of negatives) {
  test(`negative: ${text}`, () => {
    assert.equal(detectKiroFailoverReason({ stopReason: "error", errorMessage: text }), null);
  });
}

test("authFailure.reason quota_or_entitlement is eligible", () => {
  assert.equal(
    detectKiroFailoverReason({
      stopReason: "error",
      errorMessage: "request denied",
      authFailure: { reason: "quota_or_entitlement" },
    }),
    "quota_exhausted",
  );
});

test("authFailure.reason with unauthorized subclass is not eligible", () => {
  assert.equal(
    detectKiroFailoverReason({
      stopReason: "error",
      errorMessage: "unauthorized invalid token",
      authFailure: { reason: "quota_or_entitlement" },
    }),
    null,
  );
});

test("non-error stopReason does not trigger", () => {
  assert.equal(detectKiroFailoverReason({ stopReason: "length", errorMessage: "MONTHLY_REQUEST_COUNT" }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
