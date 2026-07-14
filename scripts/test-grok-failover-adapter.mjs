#!/usr/bin/env node
/**
 * Grok failover adapter contract tests: classifier, config, forceRefresh, bypass.
 *
 * Classifier fixtures are evaluated against a pure inline mirror of
 * `detectGrokFailoverReason` kept in lockstep with the production source via
 * structural assertions. Full module import is avoided because the controller
 * pulls OAuth/quota deps that need the installed pi packages.
 *
 * Run: npm run test:grok-failover-adapter
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

const failover = read("lib/grok-account-failover.ts");
const token = read("lib/grok-account-token.ts");
const quota = read("lib/grok-subscription-quota.ts");
const config = read("lib/pi-web-config.ts");

test("grok.autoFailover defaults off with GPT-aligned budgets", () => {
  assertIncludes(config, "export interface PiWebGrokAutoFailoverConfig", "type");
  assertIncludes(config, "grok: {", "grok section");
  const grokIdx = config.indexOf("grok: {");
  const slice = config.slice(grokIdx, grokIdx + 400);
  assertIncludes(slice, "enabled: false", "default off");
  assertIncludes(slice, "maxAttemptsPerTurn: 1", "1 attempt");
  assertIncludes(slice, "maxAccountSwitchesPerTurn: 1", "1 switch");
  assertIncludes(slice, "quotaCacheMaxAgeMs", "cache age");
});

test("forceRefresh:true is real, not minValidityMs:0 fake", () => {
  assertIncludes(token, "forceRefresh?: boolean", "option");
  assertIncludes(token, "forceRefresh || !access || epochNow() >= expires - minValidityMs", "force path");
  assertIncludes(quota, "forceRefresh: true", "quota uses forceRefresh");
  assertIncludes(quota, "(result.statusCode === 401 || result.statusCode === 403)", "parenthesized 401/403");
});

test("fixed token bypass is display-safe", () => {
  assertIncludes(failover, "detectGrokFixedTokenBypass", "bypass helper");
  assertIncludes(failover, "GROK_CLI_OAUTH_TOKEN", "env check");
  assertIncludes(failover, "fixed_token_bypass", "status");
  assertNotIncludes(failover, "Bearer ", "no bearer in module messages");
});

test("no broad /limit|rate/ classifier", () => {
  const withoutComments = failover.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assertNotIncludes(withoutComments, "/limit|rate/", "no broad regex in code");
  assertNotIncludes(withoutComments, "/limit|rate/i", "no broad i regex in code");
});

test("candidate checks monthly/weekly/fresh/reauth", () => {
  assertIncludes(failover, "monthly.remaining <= 0", "monthly remaining");
  assertIncludes(failover, "weekly.usedPercent >= 100", "weekly cap");
  assertIncludes(failover, "reauthRequired", "reauth");
  assertIncludes(failover, "quotaCacheMaxAgeMs", "freshness");
});

test("production detector still contains lockstep markers used by fixtures", () => {
  assertIncludes(failover, "rate_limit_exceeded", "rate limit code");
  assertIncludes(failover, "too[_ -]?many[_ -]?requests", "too many requests");
  assertIncludes(failover, "insufficient_quota", "insufficient_quota");
  assertIncludes(failover, "monthly (usage )?limit", "monthly");
  assertIncludes(failover, "weekly (usage )?limit", "weekly");
  assertIncludes(failover, "credits? (exhausted|exceeded|depleted)", "credits");
  assertIncludes(failover, "authentication|unauthorized|reauth", "auth negative");
  assertIncludes(failover, "network|fetch failed", "network negative");
  assertIncludes(failover, "timeout|timed out", "timeout negative");
});

console.log("\n=== detectGrokFailoverReason fixtures (inline mirror) ===");

// Keep this pure function aligned with lib/grok-account-failover.ts.
// Structural markers above fail if production drifts without updating fixtures.
function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function detectGrokFailoverReason(message) {
  const record = typeof message === "object" && message !== null ? message : {};
  const stopReason = String(record.stopReason ?? "");
  const parts = [
    record.errorMessage,
    record.message,
    record.error,
    record.statusText,
    record.code,
    record.type,
    record.errorCode,
    record.error_type,
    typeof record.status === "number" ? `status=${record.status}` : "",
  ].map(errorText);
  if (typeof record.error === "object" && record.error !== null) {
    const nested = record.error;
    parts.push(errorText(nested.message), errorText(nested.code), errorText(nested.type), errorText(nested.error));
  }
  const combined = parts.filter(Boolean).join("\n");
  const lower = combined.toLowerCase();
  if (!combined.trim()) return null;
  if (stopReason && stopReason !== "error") return null;

  if (
    /\b(authentication|unauthorized|reauth|re-auth|reauthenticate|invalid.?token|expired.?token|login required|please (log|sign) ?in)\b/i.test(lower)
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
    || /\b(weekly (usage )?limit (reached|exceeded|exhausted)|weekly quota)\b/i.test(lower)
    || /\b(credits? (exhausted|exceeded|depleted)|out of credits|no credits remaining)\b/i.test(lower)
    || /\b(exceeded your (current )?quota|you have exceeded your quota)\b/i.test(lower)
    || /\bcode["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
    || /\btype["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  return null;
}

function detectGrokFixedTokenBypass() {
  const tokenEnv = process.env.GROK_CLI_OAUTH_TOKEN?.trim()
    || process.env.GROK_OAUTH_TOKEN?.trim()
    || process.env.XAI_OAUTH_TOKEN?.trim();
  if (!tokenEnv) return null;
  return "Grok is using a fixed environment token, so managed account switching cannot change the request credential. Remove the fixed token override or manage credentials outside auto failover.";
}

const positives = [
  { text: "insufficient_quota", reason: "quota_exhausted" },
  { text: "quota exceeded", reason: "quota_exhausted" },
  { text: "monthly usage limit reached", reason: "quota_exhausted" },
  { text: "weekly usage limit reached", reason: "quota_exhausted" },
  { text: "credits exhausted", reason: "quota_exhausted" },
  { text: "rate_limit_exceeded", reason: "rate_limited" },
  { text: "too many requests", reason: "rate_limited" },
  { text: "You are being rate limited by the provider", reason: "rate_limited" },
  { text: 'code: "insufficient_quota"', reason: "quota_exhausted" },
];

const negatives = [
  "429",
  "status=429",
  "See documentation for rate of change limits in training",
  "network error: fetch failed",
  "timeout waiting for upstream",
  "HTTP 500 internal server error",
  "502 bad gateway",
  "authentication failed, please reauth",
  "unauthorized invalid token",
  "context overflow: maximum context length exceeded",
  "content filter blocked this response",
  "model unavailable: unknown model",
];

for (const item of positives) {
  test(`positive: ${item.text}`, () => {
    assert.equal(detectGrokFailoverReason({ stopReason: "error", errorMessage: item.text }), item.reason);
  });
}

for (const text of negatives) {
  test(`negative: ${text}`, () => {
    assert.equal(detectGrokFailoverReason({ stopReason: "error", errorMessage: text }), null);
  });
}

test("non-error stopReason does not trigger", () => {
  assert.equal(detectGrokFailoverReason({ stopReason: "length", errorMessage: "quota exceeded" }), null);
});

test("bypass detects env token without leaking it", () => {
  const prev = process.env.GROK_CLI_OAUTH_TOKEN;
  process.env.GROK_CLI_OAUTH_TOKEN = "secret-token-value-xyz";
  try {
    const msg = detectGrokFixedTokenBypass();
    assert.ok(msg, "bypass message present");
    assert.ok(!msg.includes("secret-token-value-xyz"), "does not leak token");
  } finally {
    if (prev === undefined) delete process.env.GROK_CLI_OAUTH_TOKEN;
    else process.env.GROK_CLI_OAUTH_TOKEN = prev;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
