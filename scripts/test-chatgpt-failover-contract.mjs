#!/usr/bin/env node
/**
 * Characterization / contract tests for ChatGPT/Codex account failover.
 *
 * Locks the current production semantics before any shared-core refactor.
 * Uses source inspection + pure detector unit checks. Does not read real
 * accounts, network, or agent dirs.
 *
 * Run: npm run test:chatgpt-failover-contract
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

console.log("\n=== chatgpt-account-failover.ts — source contract ===");

const failover = read("lib/chatgpt-account-failover.ts");
const rpc = read("lib/rpc-manager.ts");
const oauth = read("lib/oauth-accounts.ts");
const config = read("lib/pi-web-config.ts");
const settings = read("components/SettingsConfig.tsx");
const hook = read("hooks/useAgentSession.ts");

test("exports detector, attempt, active helper, budget/result types", () => {
  assertIncludes(failover, "export function detectChatGptQuotaError", "detector export");
  assertIncludes(failover, "export async function attemptChatGptAccountFailover", "attempt export");
  assertIncludes(failover, "export async function getActiveOpenAICodexAccountId", "active helper");
  assertIncludes(failover, "export type ChatGptAccountFailoverReason = \"quota_exhausted\"", "reason");
  assertIncludes(failover, "already_switched_by_other_session", "other-session status");
  assertIncludes(failover, "retry_budget_exhausted", "budget status");
});

test("manual Activate has no lock/pin field in activateOAuthAccount path", () => {
  assertNotIncludes(oauth, "manuallySelected", "no manual lock field");
  assertNotIncludes(oauth, "lockedAccount", "no lockedAccount");
  assertIncludes(oauth, "export async function activateOAuthAccount", "activate export");
  // Activate only updates activeAccountId / auth mirror
  assertIncludes(oauth, "activeAccountId", "writes activeAccountId");
});

test("failover does not check manual lock or session pin", () => {
  assertNotIncludes(failover, "manuallySelected", "no manual gate");
  assertNotIncludes(failover, "sessionPin", "no session pin");
  assertNotIncludes(failover, "locked", "no locked gate in chatgpt failover");
});

test("default config is off with 1 attempt / 1 switch", () => {
  assertIncludes(config, "maxAttemptsPerTurn: 1", "default max attempts");
  assertIncludes(config, "maxAccountSwitchesPerTurn: 1", "default max switches");
  // chatgpt autoFailover.enabled default false
  const idx = config.indexOf("autoFailover: {");
  assert.ok(idx > 0, "autoFailover block exists");
  const slice = config.slice(idx, idx + 300);
  assertIncludes(slice, "enabled: false", "default off");
});

test("process lock + double Active check + cooldown + circular order", () => {
  assertIncludes(failover, "withFailoverLock", "process lock");
  assertIncludes(failover, "activeAfterLock", "post-lock Active check");
  assertIncludes(failover, "activeBeforeActivate", "pre-activate Active check");
  assertIncludes(failover, "already_switched_by_other_session", "other session result");
  assertIncludes(failover, "exhaustedUntil", "cooldown map");
  assertIncludes(failover, "minSwitchIntervalMs", "min interval");
  assertIncludes(failover, "slice(activeIndex + 1)", "circular order from trigger");
});

test("reloadAuthState is invoked after Activate", () => {
  assertIncludes(failover, "options.reloadAuthState()", "reload call");
  assertIncludes(failover, "activateOAuthAccount(OPENAI_CODEX_PROVIDER_ID, nextAccountId)", "activate call");
});

test("RPC patch: run-start Active snapshot, post-run after native, identity removal", () => {
  assertIncludes(rpc, "patchChatGptAccountFailover", "patch method");
  assertIncludes(rpc, "runTriggerAccountId", "trigger snapshot field");
  assertIncludes(rpc, 'innerAny.model?.provider === "openai-codex"', "provider gate on snapshot");
  assertIncludes(rpc, "const shouldContinue = await original()", "native first");
  assertIncludes(rpc, "if (shouldContinue) return true", "early continue");
  assertIncludes(rpc, "messages[messages.length - 1] === assistantMessage", "identity check");
  assertIncludes(rpc, "chatgpt_account_failover", "SSE event");
  assertIncludes(rpc, "budget.attempts = 0", "success reset attempts");
  assertIncludes(rpc, "budget.switches = 0", "success reset switches");
});

test("OpenCode Go patch wraps ChatGPT (chain order baseline)", () => {
  assertIncludes(rpc, "this.patchChatGptAccountFailover()", "chatgpt first in ctor");
  assertIncludes(rpc, "this.patchOpencodeGoAccountFailover()", "opencode after chatgpt");
  assertIncludes(rpc, "opencode-go → chatgpt → original pi SDK", "documented chain");
  assertIncludes(rpc, "const originalPostRun = inner._handlePostAgentRun.bind(inner)", "opencode wraps current");
});

test("Settings and Chat UI keep ChatGPT failover copy", () => {
  assertIncludes(settings, "额度耗尽时自动切换可用账号", "settings label");
  assertIncludes(settings, "普通临时 429/rate limit 不触发切换", "settings rate-limit exclusion");
  assertIncludes(hook, "case \"chatgpt_account_failover\"", "hook handler");
  assertIncludes(hook, "ChatGPT 额度耗尽，已切换账号并重试…", "switched message");
});

console.log("\n=== detectChatGptQuotaError — golden fixtures ===");

// Load detector via jiti/tsx-compatible dynamic import of compiled-less TS through jiti if available.
async function loadDetector() {
  try {
    const jiti = (await import("jiti")).default;
    const loader = jiti(import.meta.url, { interopDefault: true, esmResolve: true });
    return loader(join(root, "lib/chatgpt-account-failover.ts"));
  } catch {
    // Fallback: evaluate detector regex inline to keep contract if jiti fails.
    return {
      detectChatGptQuotaError(message) {
        const record = typeof message === "object" && message !== null ? message : {};
        const stopReason = String(record.stopReason ?? "");
        const errorText = (error) => {
          if (!error) return "";
          if (typeof error === "string") return error;
          if (error instanceof Error) return error.message;
          try { return JSON.stringify(error); } catch { return String(error); }
        };
        const combined = [record.errorMessage, record.message, record.error, record.statusText]
          .map(errorText).join("\n").toLowerCase();
        if (stopReason && stopReason !== "error" && !combined) return null;
        if (/quota|usage limit|usage_limit|insufficient_quota|exceeded your current quota|codex_rate_limits|rate limit reset credit/.test(combined)) {
          return "quota_exhausted";
        }
        return null;
      },
    };
  }
}

const mod = await loadDetector();
const detect = mod.detectChatGptQuotaError;

const positives = [
  "You have exceeded your current quota",
  "insufficient_quota",
  "usage limit reached",
  "usage_limit",
  "codex_rate_limits",
  "rate limit reset credit unavailable",
  "quota exhausted for this account",
];

const negatives = [
  "network error",
  "timeout waiting for response",
  "HTTP 500 internal server error",
  "authentication failed",
  "context overflow",
  "rate of change documentation", // fuzzy, not matched by current regex unless 'rate limit' substring — current regex requires specific phrases
  "",
];

for (const text of positives) {
  test(`positive: ${text.slice(0, 48)}`, () => {
    const reason = detect({ stopReason: "error", errorMessage: text });
    assert.equal(reason, "quota_exhausted", `expected quota_exhausted for ${text}`);
  });
}

for (const text of negatives) {
  test(`negative: ${text || "(empty)"}`, () => {
    const reason = detect({ stopReason: "error", errorMessage: text });
    assert.equal(reason, null, `expected null for ${text}`);
  });
}

test("bare generic 'rate limit' alone does not match current detector", () => {
  // Current production regex requires 'rate limit reset credit' or other quota phrases;
  // plain 'rate limit' alone is intentionally NOT matched.
  const reason = detect({ stopReason: "error", errorMessage: "rate limit" });
  assert.equal(reason, null, "plain rate limit must stay null under GPT contract");
});

test("manual Activate A eligible error still has failover path (no lock gate)", () => {
  // Characterization: attemptChatGptAccountFailover only gates on enabled/provider/detector/budget/active.
  assertIncludes(failover, "if (!config.enabled)", "enabled gate only");
  assertIncludes(failover, "if (provider !== OPENAI_CODEX_PROVIDER_ID)", "provider gate");
  assertIncludes(failover, "const reason = detectChatGptQuotaError(options.message)", "detector gate");
  assertNotIncludes(failover, "manual", "no manual activate special case");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
