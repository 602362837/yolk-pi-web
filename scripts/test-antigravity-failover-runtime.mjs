#!/usr/bin/env node
/**
 * Antigravity runtime failover integration contract (Path B independent patch).
 *
 * Run: npm run test:antigravity-failover-runtime
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
const failover = read("lib/antigravity-account-failover.ts");
const kiro = read("lib/kiro-account-failover.ts");
const grok = read("lib/grok-account-failover.ts");
const chatgpt = read("lib/chatgpt-account-failover.ts");
const opencode = read("lib/opencode-go-account-failover.ts");
const hook = read("hooks/useAgentSession.ts");
const chatInput = read("components/ChatInput.tsx");
const chatWindow = read("components/ChatWindow.tsx");

console.log("\n=== Path B: independent Antigravity controller ===");

test("Antigravity controller is separate module with own process state", () => {
  assertIncludes(failover, "__piAntigravityFailover", "own state key");
  assertNotIncludes(failover, "__piKiroFailover", "does not share kiro state");
  assertNotIncludes(failover, "__piGrokFailover", "does not share grok state");
  assertNotIncludes(failover, "__piChatGptFailover", "does not share chatgpt state");
  assertNotIncludes(kiro, "detectAntigravity", "kiro detector untouched");
  assertNotIncludes(grok, "detectAntigravity", "grok detector untouched");
  assertNotIncludes(chatgpt, "detectAntigravity", "chatgpt detector untouched");
  assertNotIncludes(opencode, "detectAntigravity", "opencode detector untouched");
});

test("patch chain: antigravity outer wraps kiro wraps grok wraps opencode wraps chatgpt", () => {
  assertIncludes(rpc, "this.patchChatGptAccountFailover()", "chatgpt patch");
  assertIncludes(rpc, "this.patchOpencodeGoAccountFailover()", "opencode patch");
  assertIncludes(rpc, "this.patchGrokAccountFailover()", "grok patch");
  assertIncludes(rpc, "this.patchKiroAccountFailover()", "kiro patch");
  assertIncludes(rpc, "this.patchAntigravityAccountFailover()", "antigravity patch");
  assertIncludes(rpc, "antigravity → kiro → grok → opencode-go → chatgpt → original pi SDK", "order docs");

  const ctorStart = rpc.indexOf("constructor(public readonly inner: AgentSessionLike");
  const ctorBody = rpc.slice(ctorStart, ctorStart + 550);
  const chatgptIdx = ctorBody.indexOf("this.patchChatGptAccountFailover()");
  const opencodeIdx = ctorBody.indexOf("this.patchOpencodeGoAccountFailover()");
  const grokIdx = ctorBody.indexOf("this.patchGrokAccountFailover()");
  const kiroIdx = ctorBody.indexOf("this.patchKiroAccountFailover()");
  const antigravityIdx = ctorBody.indexOf("this.patchAntigravityAccountFailover()");
  assert.ok(chatgptIdx >= 0 && opencodeIdx > chatgptIdx, "opencode after chatgpt");
  assert.ok(grokIdx > opencodeIdx, "grok after opencode");
  assert.ok(kiroIdx > grokIdx, "kiro after grok");
  assert.ok(antigravityIdx > kiroIdx, "antigravity after kiro (outermost)");
});

test("Antigravity patch only acts on google-antigravity; non-antigravity pass through", () => {
  assertIncludes(rpc, 'innerAny.model?.provider === "google-antigravity"', "snapshot gate");
  assertIncludes(rpc, "attemptAntigravityAccountFailover", "attempt call");
  assertIncludes(failover, "provider !== ANTIGRAVITY_PROVIDER_ID", "not_antigravity early");
  assertIncludes(failover, 'status: "not_antigravity"', "status");
});

test("trigger Active + public model snapshot + identity removal + budget reset", () => {
  assertIncludes(rpc, "getActiveAntigravityFailoverAccountId", "snapshot helper");
  const patchStart = rpc.indexOf("private patchAntigravityAccountFailover");
  const body = rpc.slice(patchStart, patchStart + 6500);
  assertIncludes(body, "messages[messages.length - 1] === assistantMessage", "identity");
  assertIncludes(body, "budget.attempts = 0", "reset attempts");
  assertIncludes(body, "budget.switches = 0", "reset switches");
  assertIncludes(body, "result.retry", "retry gate");
  assertIncludes(body, "runPublicModelId", "model snapshot");
  assertIncludes(body, "publicModelId", "pass model to controller");
  // Budget lifecycle is bound to the outer user turn via _runAgentPrompt.
  assertIncludes(body, "inner._runAgentPrompt = async (...args: unknown[]) => {", "runAgentPrompt wrap");
  const runPromptIdx = body.indexOf("inner._runAgentPrompt = async");
  const runPromptSlice = body.slice(runPromptIdx, runPromptIdx + 900);
  assertIncludes(runPromptSlice, "budget.attempts = 0", "reset attempts at turn start");
  assertIncludes(runPromptSlice, "budget.switches = 0", "reset switches at turn start");
  assertIncludes(runPromptSlice, "runPublicModelId", "snapshot model at turn start");
});

test("terminal non-retry outcomes do not commit per-turn budget", () => {
  assertIncludes(failover, "// Budget is committed only when this turn actually retries", "budget commit docs");

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

test("SSE is sanitized (no account ids / projectId in event projection)", () => {
  const patchStart = rpc.indexOf("private patchAntigravityAccountFailover");
  const body = rpc.slice(patchStart, patchStart + 5500);
  // Strip comments so privacy checks only see projected fields / code.
  const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assertIncludes(body, 'type: "antigravity_account_failover"', "event type");
  assertIncludes(body, "status: result.status", "status");
  assertIncludes(body, "message: result.message", "message");
  assertIncludes(body, "retry: result.retry", "retry");
  assertNotIncludes(codeOnly, "triggerAccountId: result.triggerAccountId", "no trigger id");
  assertNotIncludes(codeOnly, "switchedToAccountId: result.switchedToAccountId", "no switched id");
  assertNotIncludes(codeOnly, "activeAccountId: result.activeAccountId", "no active id");
  assertNotIncludes(codeOnly, "publicModelId: result.publicModelId", "no public model id leak required");
  assertNotIncludes(codeOnly, "projectId", "no projectId field projection");
});

test("concurrency: lock + double Active check + model revalidation + no cascade", () => {
  assertIncludes(failover, "withFailoverLock", "lock");
  assertIncludes(failover, "activeAfterLock", "after lock");
  assertIncludes(failover, "activeBeforeActivate", "before activate");
  assertIncludes(failover, "already_switched_by_other_session", "other session");
  assertIncludes(failover, "isUsableAntigravityAccount(activeAfterLock, publicModelId, config)", "reuse revalidation");
  assertIncludes(failover, "retry: true", "retry on other-session when usable");
});

test("model-aware: other-model-only quota cannot make candidate usable", () => {
  assertIncludes(failover, "findAntigravityQuotaWindowForPublicModel", "mapping lookup");
  assertIncludes(failover, "isAntigravityPublicModelFailoverSupported", "unsupported model");
  assertIncludes(failover, 'status: "model_unsupported"', "model_unsupported status");
  assertIncludes(failover, "remainingFraction <= 0", "remaining gate");
  // Must not use any-model remaining as health.
  assertNotIncludes(failover, "models.some", "no any-model some()");
  assertNotIncludes(failover, "models.find((", "no bare models.find without mapping");
});

test("manual Active is not a lock — no manuallySelected gate", () => {
  assertNotIncludes(failover, "manuallySelected", "no manual gate");
  assertNotIncludes(failover, "pinned", "no pin gate");
  assertNotIncludes(failover, "isLocked", "no lock gate");
  assertNotIncludes(failover, "manuallyActivated", "no manual activated gate");
});

console.log("\n=== UI contracts ===");

test("Chat handles antigravity_account_failover with terminal vs retrying", () => {
  assertIncludes(hook, "case \"antigravity_account_failover\"", "hook case");
  assertIncludes(hook, "AntigravityFailoverNotice", "notice type");
  assertIncludes(hook, "setAntigravityFailoverNotice", "setter");
  assertIncludes(hook, "retrying", "retrying flag");
  assertIncludes(chatInput, "antigravityFailoverNotice", "chat input prop");
  assertIncludes(chatInput, "antigravityFailoverNotice.retrying", "terminal guard");
  assertIncludes(chatWindow, "antigravityFailoverNotice={antigravityFailoverNotice}", "window wiring");
});

test("terminal statuses must not claim Retrying in Antigravity notice", () => {
  const caseStart = hook.indexOf('case "antigravity_account_failover"');
  const body = hook.slice(caseStart, caseStart + 2800);
  assertIncludes(body, "const retrying = isSwitched || isAlreadySwitched", "retrying only for retry paths");
  assertIncludes(body, "no_usable_account", "terminal no usable");
  assertIncludes(body, "retry_budget_exhausted", "terminal budget");
  assertIncludes(body, "model_unsupported", "terminal model unsupported");
});

test("existing provider failover modules remain independent", () => {
  assertIncludes(kiro, "__piKiroFailover", "kiro state intact");
  assertIncludes(grok, "__piGrokFailover", "grok state intact");
  assertNotIncludes(kiro, "google-antigravity", "kiro does not hardcode antigravity");
  assertNotIncludes(grok, "google-antigravity", "grok does not hardcode antigravity");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
