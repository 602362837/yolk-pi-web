#!/usr/bin/env node
/**
 * Grok runtime failover integration contract (Path B independent patch).
 *
 * Run: npm run test:grok-failover-runtime
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

const rpc = read("lib/rpc-manager.ts");
const failover = read("lib/grok-account-failover.ts");
const chatgpt = read("lib/chatgpt-account-failover.ts");
const hook = read("hooks/useAgentSession.ts");
const chatInput = read("components/ChatInput.tsx");
const settings = read("components/SettingsConfig.tsx");

console.log("\n=== Path B: independent Grok controller ===");

test("Grok controller is separate module with own process state", () => {
  assertIncludes(failover, "__piGrokFailover", "own state key");
  assertNotIncludes(failover, "__piChatGptFailover", "does not share chatgpt state");
  assertNotIncludes(chatgpt, "grok-cli", "chatgpt module unchanged re grok");
  assertNotIncludes(chatgpt, "detectGrok", "chatgpt detector untouched");
});

test("patch chain: grok outer wraps opencode wraps chatgpt", () => {
  assertIncludes(rpc, "this.patchChatGptAccountFailover()", "chatgpt patch");
  assertIncludes(rpc, "this.patchOpencodeGoAccountFailover()", "opencode patch");
  assertIncludes(rpc, "this.patchGrokAccountFailover()", "grok patch");
  assertIncludes(rpc, "grok → opencode-go → chatgpt → original pi SDK", "order docs");
});

test("Grok patch only acts on grok-cli; non-grok pass through", () => {
  assertIncludes(rpc, 'innerAny.model?.provider === "grok-cli"', "snapshot gate");
  assertIncludes(rpc, "attemptGrokAccountFailover", "attempt call");
  assertIncludes(failover, 'provider !== GROK_CLI_PROVIDER_ID', "not_grok_cli early");
  assertIncludes(failover, 'status: "not_grok_cli"', "status");
});

test("trigger Active snapshot + identity removal + budget reset", () => {
  assertIncludes(rpc, "getActiveGrokFailoverAccountId", "snapshot helper");
  assertIncludes(rpc, "messages[messages.length - 1] === assistantMessage", "identity");
  assertIncludes(rpc, "budget.attempts = 0", "reset attempts");
  assertIncludes(rpc, "budget.switches = 0", "reset switches");
});

test("SSE is sanitized (no account ids in event projection)", () => {
  const grokPatchStart = rpc.indexOf("private patchGrokAccountFailover");
  const body = rpc.slice(grokPatchStart, grokPatchStart + 3500);
  assertIncludes(body, 'type: "grok_account_failover"', "event type");
  assertIncludes(body, "status: result.status", "status");
  assertIncludes(body, "message: result.message", "message");
  assertNotIncludes(body, "triggerAccountId: result.triggerAccountId", "no trigger id");
  assertNotIncludes(body, "switchedToAccountId: result.switchedToAccountId", "no switched id");
});

test("concurrency: lock + double Active check + no cascade", () => {
  assertIncludes(failover, "withFailoverLock", "lock");
  assertIncludes(failover, "activeAfterLock", "after lock");
  assertIncludes(failover, "activeBeforeActivate", "before activate");
  assertIncludes(failover, "already_switched_by_other_session", "other session");
  assertIncludes(failover, "retry: true", "retry on other-session");
});

test("manual Active is not a lock — no manuallySelected gate", () => {
  assertNotIncludes(failover, "manuallySelected", "no manual gate");
  assertNotIncludes(failover, "pinned", "no pin gate");
  assertNotIncludes(failover, "locked", "no lock gate");
});

console.log("\n=== UI contracts ===");

test("Settings Grok toggle uses explicit limit language", () => {
  assertIncludes(settings, "明确限额或限流时自动切换可用账号", "toggle label");
  assertIncludes(settings, "section === \"grok\"", "section");
  assertNotIncludes(settings, "普通 rate limit 不触发", "old absolute exclusion gone");
});

test("Chat handles grok_account_failover with terminal vs retrying", () => {
  assertIncludes(hook, "case \"grok_account_failover\"", "hook case");
  assertIncludes(hook, "retrying", "retrying flag");
  assertIncludes(chatInput, "grokFailoverNotice", "chat input prop");
  assertIncludes(chatInput, "grokFailoverNotice.retrying", "terminal guard");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
