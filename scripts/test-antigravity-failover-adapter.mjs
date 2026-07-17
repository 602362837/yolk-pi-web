#!/usr/bin/env node
/**
 * Antigravity failover adapter contract tests: classifier, config, model-aware
 * candidate freshness.
 *
 * Classifier fixtures are evaluated against a pure inline mirror of
 * `detectAntigravityFailoverReason` kept in lockstep with the production
 * source via structural assertions. Full module import is avoided because the
 * controller pulls OAuth/quota deps that need the installed pi packages.
 *
 * Run: npm run test:antigravity-failover-adapter
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

const failover = read("lib/antigravity-account-failover.ts");
const config = read("lib/pi-web-config.ts");
const quota = read("lib/antigravity-subscription-quota.ts");
const modelQuota = read("lib/antigravity-model-quota.ts");

test("antigravity.autoFailover defaults off with Kiro-aligned budgets", () => {
  assertIncludes(config, "export interface PiWebAntigravityAutoFailoverConfig", "type");
  assertIncludes(config, "antigravity: {", "antigravity section");
  const idx = config.indexOf("antigravity: {");
  // Prefer the defaults block which includes autoFailover.enabled: false.
  const defaultsIdx = config.indexOf("antigravity: {\n    usagePanelEnabled: false");
  const slice = config.slice(defaultsIdx >= 0 ? defaultsIdx : idx, (defaultsIdx >= 0 ? defaultsIdx : idx) + 450);
  assertIncludes(slice, "enabled: false", "default off");
  assertIncludes(slice, "maxAttemptsPerTurn: 1", "1 attempt");
  assertIncludes(slice, "maxAccountSwitchesPerTurn: 1", "1 switch");
  assertIncludes(slice, "quotaCacheMaxAgeMs", "cache age");
});

test("candidate checks model-aware remaining/fresh/live/reauth fail-closed", () => {
  assertIncludes(failover, "findAntigravityQuotaWindowForPublicModel", "model mapping helper");
  assertIncludes(failover, "isAntigravityPublicModelFailoverSupported", "supported gate");
  assertIncludes(failover, "remainingFraction", "remainingFraction gate");
  assertIncludes(failover, "remainingFraction <= 0", "remaining gate");
  assertIncludes(failover, "reauthRequired", "reauth");
  assertIncludes(failover, 'cache.state === "none" || quota.cache.state === "stale"', "stale/none fail closed");
  assertIncludes(failover, 'cache.state !== "fresh" && quota.cache.state !== "live"', "fresh/live only");
  assertIncludes(failover, "quotaCacheMaxAgeMs", "freshness");
  assertIncludes(failover, "getAntigravityAccountSubscriptionQuota", "uses antigravity quota");
  assertIncludes(quota, "export async function getAntigravityAccountSubscriptionQuota", "quota export");
  assertIncludes(modelQuota, "export function findAntigravityQuotaWindowForPublicModel", "mapping export");
});

test("no broad /limit|rate/ classifier", () => {
  const withoutComments = failover.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assertNotIncludes(withoutComments, "/limit|rate/", "no broad regex in code");
  assertNotIncludes(withoutComments, "/limit|rate/i", "no broad i regex in code");
});

test("hard negatives include bare 429, Cloud Code Assist API error, auth/project/capacity", () => {
  assertIncludes(failover, "cloud code assist api error", "cloud code assist 429");
  assertIncludes(failover, "authentication|unauthorized|reauth", "auth negative");
  assertIncludes(failover, "invalid[_ -]?project", "project negative");
  assertIncludes(failover, "access[_ -]?denied", "access denied negative");
  assertIncludes(failover, "network|fetch failed", "network negative");
  assertIncludes(failover, "timeout|timed out", "timeout negative");
  assertIncludes(failover, "insufficient[_ -]?model[_ -]?capacity|overloaded", "capacity negative");
  assertIncludes(failover, "^(status=)?(429|400|401|403|404|500|502|503|504|529)$", "bare status");
});

test("production detector still contains lockstep markers used by fixtures", () => {
  assertIncludes(failover, "RESOURCE_EXHAUSTED", "RESOURCE_EXHAUSTED");
  assertIncludes(failover, "quota_exhausted", "quota_exhausted");
  assertIncludes(failover, "quotaResetDelay", "quotaResetDelay");
  assertIncludes(failover, "quotaResetTimeStamp", "quotaResetTimeStamp");
  assertIncludes(failover, "rate_limit_exceeded", "rate limit code");
  assertIncludes(failover, "too[_ -]?many[_ -]?requests", "too many requests");
  assertIncludes(failover, "insufficient_quota", "insufficient_quota");
});

test("controller owns process state and concurrency primitives", () => {
  assertIncludes(failover, "__piAntigravityFailover", "own state key");
  assertIncludes(failover, "withFailoverLock", "lock");
  assertIncludes(failover, "activeAfterLock", "after lock");
  assertIncludes(failover, "activeBeforeActivate", "before activate");
  assertIncludes(failover, "already_switched_by_other_session", "other session");
  assertIncludes(failover, "maxAttemptsPerTurn", "budget attempts");
  assertIncludes(failover, "maxAccountSwitchesPerTurn", "budget switches");
  assertIncludes(failover, "publicModelId", "model-aware snapshot");
});

test("already_switched revalidates matching-model quota before retry", () => {
  assertIncludes(failover, "isUsableAntigravityAccount(activeAfterLock, publicModelId, config)", "revalidate after lock");
  assertIncludes(failover, "isUsableAntigravityAccount(activeBeforeActivate, publicModelId, config)", "revalidate before activate");
  // When new Active has no matching model quota, status is terminal no_usable_account.
  const alreadyIdx = failover.indexOf("activeAfterLock && activeAfterLock !== triggerAccountId");
  assert.ok(alreadyIdx > 0, "after-lock Active check present");
  const window = failover.slice(alreadyIdx, alreadyIdx + 900);
  assertIncludes(window, 'status: "no_usable_account"', "terminal when new Active unusable");
  assertIncludes(window, "retry: false", "no blind retry");
});

test("failed catch message is display-safe (no raw error leak)", () => {
  assertIncludes(failover, 'message: "Antigravity account failover failed."', "safe failed message");
  assertNotIncludes(failover, "errorText(error)", "does not project catch error text");
});

test("independent of Grok/Kiro process state", () => {
  assertNotIncludes(failover, "__piKiroFailover", "no kiro state");
  assertNotIncludes(failover, "__piGrokFailover", "no grok state");
  assertNotIncludes(failover, "__piChatGptFailover", "no chatgpt state");
});

test("failover is model-key aware and never group-aware", () => {
  // Candidate selection must stay on public-model accepted keys only.
  assertNotIncludes(failover, "antigravity-quota-groups", "no group helper import path");
  assertNotIncludes(failover, "groupByAntigravityQuotaWindows", "no groupBy");
  assertNotIncludes(failover, "ANTIGRAVITY_PRIORITY_RING_GROUP_IDS", "no priority ring groups");
  assertNotIncludes(failover, "groupRemaining", "no group remaining field");
  assertNotIncludes(failover, "remainingFraction of group", "no group remaining prose gate");
  // Must not import display aggregation into the controller.
  assert.ok(
    !/from ["']\.\/antigravity-quota-groups["']/.test(failover)
      && !/from ["']@\/lib\/antigravity-quota-groups["']/.test(failover),
    "must not import antigravity-quota-groups",
  );
  // Usability still goes through public-model window lookup + remainingFraction.
  assertIncludes(failover, "findAntigravityQuotaWindowForPublicModel(publicModelId, models)", "public model window");
  assertIncludes(failover, "isFreshMatchingModelQuota", "fresh matching model gate");
});

console.log("\n=== model-aware candidate gate (same-group remaining is not enough) ===");

/**
 * Inline mirror of getAcceptedAntigravityQuotaKeys + findAntigravityQuotaWindowForPublicModel
 * for the two priority catalog models used by UI grouping. Failover never reads groups.
 */
const ACCEPTED_KEYS_BY_PUBLIC_MODEL = {
  "claude-opus-4-6": ["claude-opus-4-6", "claude-opus-4-6-thinking"],
  "claude-opus-4-5": ["claude-opus-4-5", "claude-opus-4-5-thinking"],
  "gemini-3-flash": [
    "gemini-3-flash",
    "gemini-3-flash-agent",
    "gemini-3.5-flash",
    "gemini-3.5-flash-extra-low",
  ],
};

function findWindowForPublicModel(publicModelId, windows) {
  const keys = ACCEPTED_KEYS_BY_PUBLIC_MODEL[publicModelId];
  if (!keys || keys.length === 0) return null;
  const keySet = new Set(keys);
  for (const window of windows) {
    if (keySet.has(window.id)) return window;
  }
  return null;
}

function isFreshMatchingModelQuotaMirror(quota, publicModelId) {
  if (!quota.success || quota.reauthRequired) return false;
  if (quota.cache.state !== "fresh" && quota.cache.state !== "live") return false;
  const window = findWindowForPublicModel(publicModelId, quota.models ?? []);
  if (!window) return false;
  if (!Number.isFinite(window.remainingFraction) || window.remainingFraction <= 0) return false;
  return true;
}

test("same-group sibling key remaining does not prove current public model usable", () => {
  // Current request model is Claude Opus 4.6; only its accepted keys count.
  // Claude Opus 4.5 (same UI group) has remaining — must NOT make the account usable.
  const windows = [
    { id: "claude-opus-4-6", remainingFraction: 0 },
    { id: "claude-opus-4-6-thinking", remainingFraction: 0 },
    { id: "claude-opus-4-5", remainingFraction: 0.9 },
    { id: "gemini-3-flash", remainingFraction: 0.8 },
  ];
  const matched = findWindowForPublicModel("claude-opus-4-6", windows);
  assert.equal(matched?.id, "claude-opus-4-6");
  assert.equal(matched?.remainingFraction, 0);
  assert.equal(
    isFreshMatchingModelQuotaMirror(
      { success: true, reauthRequired: false, cache: { state: "live" }, models: windows },
      "claude-opus-4-6",
    ),
    false,
    "group-healthy siblings must not open failover candidate",
  );
});

test("other priority group remaining never makes exhausted model a candidate", () => {
  // Flash group healthy, Opus 4.6 exhausted → still not usable for Opus 4.6 request.
  const windows = [
    { id: "claude-opus-4-6", remainingFraction: 0 },
    { id: "gemini-3-flash", remainingFraction: 0.95 },
    { id: "gemini-3-flash-agent", remainingFraction: 0.95 },
  ];
  assert.equal(
    isFreshMatchingModelQuotaMirror(
      { success: true, reauthRequired: false, cache: { state: "fresh" }, models: windows },
      "claude-opus-4-6",
    ),
    false,
  );
  // Conversely, Flash request is usable even if Opus is empty.
  assert.equal(
    isFreshMatchingModelQuotaMirror(
      { success: true, reauthRequired: false, cache: { state: "fresh" }, models: windows },
      "gemini-3-flash",
    ),
    true,
  );
});

test("matching accepted key with remaining > 0 is usable; missing mapping fails closed", () => {
  const windows = [
    { id: "claude-opus-4-6-thinking", remainingFraction: 0.4 },
  ];
  assert.equal(
    isFreshMatchingModelQuotaMirror(
      { success: true, reauthRequired: false, cache: { state: "live" }, models: windows },
      "claude-opus-4-6",
    ),
    true,
  );
  assert.equal(
    isFreshMatchingModelQuotaMirror(
      { success: true, reauthRequired: false, cache: { state: "live" }, models: windows },
      "totally-unknown-model",
    ),
    false,
  );
});

console.log("\n=== detectAntigravityFailoverReason fixtures (inline mirror) ===");

// Keep this pure function aligned with lib/antigravity-account-failover.ts.
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

function detectAntigravityFailoverReason(message) {
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
    pushText(parts, nested.statusText);
    if (typeof nested.status === "number") parts.push(`status=${nested.status}`);
  }

  const combined = parts.filter(Boolean).join("\n");
  const lower = combined.toLowerCase();
  if (!combined.trim()) return null;
  if (stopReason && stopReason !== "error") return null;

  if (
    /\b(authentication|unauthorized|reauth|re-auth|reauthenticate|invalid.?token|expired.?token|invalid.?grant|login required|please (log|sign) ?in)\b/i.test(lower)
    || /\b(project (id )?(missing|invalid|not found|required)|invalid[_ -]?project|access[_ -]?denied|permission denied|forbidden)\b/i.test(lower)
    || /\b(network|fetch failed|econnreset|enotfound|econnrefused|socket hang up)\b/i.test(lower)
    || /\b(timeout|timed out|deadline exceeded|aborted|abort(?:ed)?(?:error)?)\b/i.test(lower)
    || /\b(context (length |window )?(overflow|exceeded)|maximum context|token limit exceeded for context)\b/i.test(lower)
    || /\b(content filter|content.?policy|safety filter|moderation)\b/i.test(lower)
    || /\b(model (not found|unavailable|does not exist)|unknown model)\b/i.test(lower)
    || /\b(insufficient[_ -]?model[_ -]?capacity|overloaded|model capacity|capacity exceeded)\b/i.test(lower)
    || /(?:^|\s)(500|502|503|504|529)\b/.test(combined)
  ) {
    return null;
  }

  if (/^(status=)?(429|400|401|403|404|500|502|503|504|529)$/i.test(combined.trim())) {
    return null;
  }
  if (
    /\bcloud code assist api error\s*\(\s*429\s*\)\b/i.test(lower)
    && !/\b(resource_exhausted|quota_exhausted|quota exceeded|quota exhausted|quotareset|rate_limit|too many requests|rate limit)\b/i.test(lower)
  ) {
    return null;
  }

  if (
    /\bRESOURCE_EXHAUSTED\b/.test(combined)
    || /\bquota_exhausted\b/i.test(combined)
    || /\bquota[_ -]?exceeded\b/i.test(lower)
    || /\bquota[_ -]?exhausted\b/i.test(lower)
    || /\bquotaResetDelay\b/i.test(combined)
    || /\bquotaResetTimeStamp\b/i.test(combined)
    || /\bquotaResetTime\b/i.test(combined)
  ) {
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
    || /\b(exceeded your (current )?quota|you have exceeded your quota)\b/i.test(lower)
    || /\bcode["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit|resource_exhausted|quota_exhausted)\b/i.test(combined)
    || /\btype["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit|resource_exhausted|quota_exhausted)\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  return null;
}

function msg(partial) {
  return { role: "assistant", stopReason: "error", ...partial };
}

const positives = [
  ["RESOURCE_EXHAUSTED", msg({ errorMessage: "RESOURCE_EXHAUSTED: quota" }), "quota_exhausted"],
  ["quota_exhausted code", msg({ errorMessage: "quota_exhausted" }), "quota_exhausted"],
  ["quota exceeded", msg({ errorMessage: "You have quota exceeded for this model" }), "quota_exhausted"],
  ["quotaResetDelay", msg({ errorMessage: "wait quotaResetDelay=3600" }), "quota_exhausted"],
  ["quotaResetTimeStamp", msg({ errorMessage: "quotaResetTimeStamp=2026-01-01" }), "quota_exhausted"],
  ["rate_limit_exceeded", msg({ errorMessage: "rate_limit_exceeded" }), "rate_limited"],
  ["too many requests", msg({ errorMessage: "Too many requests, please slow down" }), "rate_limited"],
  ["explicit rate limit + 429", msg({ errorMessage: "429 rate limit exceeded", status: 429 }), "rate_limited"],
  ["nested error code", msg({ error: { code: "RESOURCE_EXHAUSTED", message: "out" } }), "quota_exhausted"],
];

const negatives = [
  ["bare 429", msg({ errorMessage: "429" })],
  ["status=429 only", msg({ status: 429 })],
  ["Cloud Code Assist API error (429)", msg({ errorMessage: "Cloud Code Assist API error (429)" })],
  ["401 unauthorized", msg({ errorMessage: "401 unauthorized" })],
  ["403 forbidden project", msg({ errorMessage: "403 access denied invalid project" })],
  ["invalid grant", msg({ errorMessage: "invalid_grant please reauth" })],
  ["expired token", msg({ errorMessage: "expired token" })],
  ["network", msg({ errorMessage: "network fetch failed" })],
  ["timeout", msg({ errorMessage: "request timed out" })],
  ["abort", msg({ errorMessage: "The operation was aborted" })],
  ["500", msg({ errorMessage: "500 internal server error" })],
  ["503", msg({ errorMessage: "503 service unavailable" })],
  ["529", msg({ errorMessage: "529 overloaded" })],
  ["capacity", msg({ errorMessage: "INSUFFICIENT_MODEL_CAPACITY" })],
  ["overloaded", msg({ errorMessage: "model overloaded, try later" })],
  ["context", msg({ errorMessage: "context window exceeded" })],
  ["content filter", msg({ errorMessage: "content filter blocked" })],
  ["model not found", msg({ errorMessage: "model not found" })],
  ["fuzzy help rate", msg({ errorMessage: "See documentation for more information about rate limits" })],
  ["non-error stopReason", { role: "assistant", stopReason: "length", errorMessage: "RESOURCE_EXHAUSTED" }],
  ["empty", msg({ errorMessage: "" })],
];

for (const [name, input, expected] of positives) {
  test(`positive: ${name}`, () => {
    assert.equal(detectAntigravityFailoverReason(input), expected);
  });
}

for (const [name, input] of negatives) {
  test(`negative: ${name}`, () => {
    assert.equal(detectAntigravityFailoverReason(input), null);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
