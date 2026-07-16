#!/usr/bin/env node
/**
 * Kiro runtime failover integration contract (Path B independent patch).
 *
 * Run: npm run test:kiro-failover-runtime
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
const failover = read("lib/kiro-account-failover.ts");
const grok = read("lib/grok-account-failover.ts");
const chatgpt = read("lib/chatgpt-account-failover.ts");
const opencode = read("lib/opencode-go-account-failover.ts");
const hook = read("hooks/useAgentSession.ts");
const chatInput = read("components/ChatInput.tsx");
const chatWindow = read("components/ChatWindow.tsx");

console.log("\n=== Path B: independent Kiro controller ===");

test("Kiro controller is separate module with own process state", () => {
  assertIncludes(failover, "__piKiroFailover", "own state key");
  assertNotIncludes(failover, "__piGrokFailover", "does not share grok state");
  assertNotIncludes(failover, "__piChatGptFailover", "does not share chatgpt state");
  assertNotIncludes(grok, "detectKiro", "grok detector untouched");
  assertNotIncludes(chatgpt, "detectKiro", "chatgpt detector untouched");
  assertNotIncludes(opencode, "detectKiro", "opencode detector untouched");
  assertNotIncludes(chatgpt, "kiro", "chatgpt module unchanged re kiro");
});

test("patch chain: kiro outer wraps grok wraps opencode wraps chatgpt", () => {
  assertIncludes(rpc, "this.patchChatGptAccountFailover()", "chatgpt patch");
  assertIncludes(rpc, "this.patchOpencodeGoAccountFailover()", "opencode patch");
  assertIncludes(rpc, "this.patchGrokAccountFailover()", "grok patch");
  assertIncludes(rpc, "this.patchKiroAccountFailover()", "kiro patch");
  assertIncludes(rpc, "kiro → grok → opencode-go → chatgpt → original pi SDK", "order docs");

  const ctorStart = rpc.indexOf("constructor(public readonly inner: AgentSessionLike");
  const ctorBody = rpc.slice(ctorStart, ctorStart + 450);
  const chatgptIdx = ctorBody.indexOf("this.patchChatGptAccountFailover()");
  const opencodeIdx = ctorBody.indexOf("this.patchOpencodeGoAccountFailover()");
  const grokIdx = ctorBody.indexOf("this.patchGrokAccountFailover()");
  const kiroIdx = ctorBody.indexOf("this.patchKiroAccountFailover()");
  assert.ok(chatgptIdx >= 0 && opencodeIdx > chatgptIdx, "opencode after chatgpt");
  assert.ok(grokIdx > opencodeIdx, "grok after opencode");
  assert.ok(kiroIdx > grokIdx, "kiro after grok (outermost)");
});

test("Kiro patch only acts on kiro; non-kiro pass through", () => {
  assertIncludes(rpc, 'innerAny.model?.provider === "kiro"', "snapshot gate");
  assertIncludes(rpc, "attemptKiroAccountFailover", "attempt call");
  assertIncludes(failover, "provider !== KIRO_PROVIDER_ID", "not_kiro early");
  assertIncludes(failover, 'status: "not_kiro"', "status");
});

test("trigger Active snapshot + identity removal + budget reset", () => {
  assertIncludes(rpc, "getActiveKiroFailoverAccountId", "snapshot helper");
  const kiroPatchStart = rpc.indexOf("private patchKiroAccountFailover");
  const body = rpc.slice(kiroPatchStart, kiroPatchStart + 5500);
  assertIncludes(body, "messages[messages.length - 1] === assistantMessage", "identity");
  assertIncludes(body, "budget.attempts = 0", "reset attempts");
  assertIncludes(body, "budget.switches = 0", "reset switches");
  assertIncludes(body, "result.retry", "retry gate");
  // Budget lifecycle is bound to the outer user turn via _runAgentPrompt.
  assertIncludes(body, "inner._runAgentPrompt = async (...args: unknown[]) => {", "runAgentPrompt wrap");
  const runPromptIdx = body.indexOf("inner._runAgentPrompt = async");
  const runPromptSlice = body.slice(runPromptIdx, runPromptIdx + 600);
  assertIncludes(runPromptSlice, "budget.attempts = 0", "reset attempts at turn start");
  assertIncludes(runPromptSlice, "budget.switches = 0", "reset switches at turn start");
});

test("terminal non-retry outcomes do not commit per-turn budget", () => {
  // attempts/switches only increment on retry paths (switched / already_switched).
  assertIncludes(failover, "// Budget is committed only when this turn actually retries", "budget commit docs");

  // No attempts++ before entering the failover lock.
  const lockIdx = failover.indexOf("return withFailoverLock");
  assert.ok(lockIdx > 0, "withFailoverLock entry present");
  const beforeLock = failover.slice(0, lockIdx);
  assertNotIncludes(beforeLock, "options.budget.attempts += 1", "no attempts++ before lock");
  assertNotIncludes(beforeLock, "options.budget.switches += 1", "no switches++ before lock");

  // Every attempts += 1 must be on a retry:true path.
  const attemptCommits = [...failover.matchAll(/options\.budget\.attempts \+= 1;/g)];
  assert.equal(attemptCommits.length, 3, "exactly three attempts commits (2 reuse + 1 switch)");
  for (const match of attemptCommits) {
    const idx = match.index ?? 0;
    const window = failover.slice(idx, idx + 500);
    assertIncludes(window, "retry: true", `attempts commit near ${idx} must be retry path`);
  }

  // no_usable_account / failed must not increment budget.
  const noUsableIdx = failover.indexOf('status: "no_usable_account"');
  assert.ok(noUsableIdx > 0, "no_usable_account status present");
  const noUsableWindow = failover.slice(noUsableIdx - 200, noUsableIdx + 250);
  assertNotIncludes(noUsableWindow, "budget.attempts += 1", "no_usable_account does not commit attempts");
  assertNotIncludes(noUsableWindow, "budget.switches += 1", "no_usable_account does not commit switches");

  const failedIdx = failover.indexOf('status: "failed"');
  assert.ok(failedIdx > 0, "failed status present");
  const failedWindow = failover.slice(failedIdx - 120, failedIdx + 200);
  assertNotIncludes(failedWindow, "budget.attempts += 1", "failed does not commit attempts");
});

test("SSE is sanitized (no account ids in event projection)", () => {
  const kiroPatchStart = rpc.indexOf("private patchKiroAccountFailover");
  const body = rpc.slice(kiroPatchStart, kiroPatchStart + 4500);
  assertIncludes(body, 'type: "kiro_account_failover"', "event type");
  assertIncludes(body, "status: result.status", "status");
  assertIncludes(body, "message: result.message", "message");
  assertIncludes(body, "retry: result.retry", "retry");
  assertNotIncludes(body, "triggerAccountId: result.triggerAccountId", "no trigger id");
  assertNotIncludes(body, "switchedToAccountId: result.switchedToAccountId", "no switched id");
  assertNotIncludes(body, "activeAccountId: result.activeAccountId", "no active id");
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
  // Avoid matching lock mutex helper name with a false positive: ensure no "isLocked" product gate.
  assertNotIncludes(failover, "isLocked", "no lock gate");
  assertNotIncludes(failover, "manuallyActivated", "no manual activated gate");
});

console.log("\n=== UI contracts ===");

test("Chat handles kiro_account_failover with terminal vs retrying", () => {
  assertIncludes(hook, "case \"kiro_account_failover\"", "hook case");
  assertIncludes(hook, "KiroFailoverNotice", "notice type");
  assertIncludes(hook, "setKiroFailoverNotice", "setter");
  assertIncludes(hook, "retrying", "retrying flag");
  assertIncludes(chatInput, "kiroFailoverNotice", "chat input prop");
  assertIncludes(chatInput, "kiroFailoverNotice.retrying", "terminal guard");
  assertIncludes(chatWindow, "kiroFailoverNotice={kiroFailoverNotice}", "window wiring");
});

test("terminal statuses must not claim Retrying in Kiro notice", () => {
  const caseStart = hook.indexOf('case "kiro_account_failover"');
  const body = hook.slice(caseStart, caseStart + 2500);
  assertIncludes(body, "const retrying = isSwitched || isAlreadySwitched", "retrying only for retry paths");
  assertIncludes(body, "no_usable_account", "terminal no usable");
  assertIncludes(body, "retry_budget_exhausted", "terminal budget");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
