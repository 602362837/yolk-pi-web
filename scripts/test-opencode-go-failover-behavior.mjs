#!/usr/bin/env node
/**
 * Source-code analysis tests for opencode-go failover contracts.
 *
 * Verifies key invariants that are hard to unit-test without full FS mocking:
 * - Managed account disable/enable/activate disabled-rejection behavior.
 * - Config default-off and field shape.
 * - RPC integration patch ordering and event emission.
 * - No plaintext key exposure in events or failover module.
 *
 * Run: node scripts/test-opencode-go-failover-behavior.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function assertIncludes(source, needle, label) {
  assert.ok(
    source.includes(needle),
    `${label}: expected to include "${needle}"`,
  );
}

function assertNotIncludes(source, needle, label) {
  assert.ok(
    !source.includes(needle),
    `${label}: expected NOT to include "${needle}"`,
  );
}

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

// ---------------------------------------------------------------------------
// 1. api-key-accounts.ts — disable/enable/activate behavior
// ---------------------------------------------------------------------------

console.log("\n=== api-key-accounts.ts ===");

const apiKeyAccounts = read("lib/api-key-accounts.ts");

test("ApiKeyAccountDisabledError class exported", () => {
  assertIncludes(apiKeyAccounts, "export class ApiKeyAccountDisabledError", "class export");
});

test("activateApiKeyAccount rejects disabled accounts", () => {
  assertIncludes(apiKeyAccounts, "targetEntry?.disabled", "disabled check");
  assertIncludes(apiKeyAccounts, "throw new ApiKeyAccountDisabledError", "throws on disabled");
});

test("disableApiKeyAccount requires replacement or clearActive for active account", () => {
  assertIncludes(apiKeyAccounts, "Cannot disable the active account without a replacement or explicit clearActive", "active-account safety");
  assertIncludes(apiKeyAccounts, "replacementAccountId", "replacement param");
  assertIncludes(apiKeyAccounts, "clearActive", "clearActive param");
});

test("disableApiKeyAccount sets disabled metadata fields", () => {
  assertIncludes(apiKeyAccounts, "disabled: true", "disabled flag");
  assertIncludes(apiKeyAccounts, "disabledAt:", "disabledAt timestamp");
  assertIncludes(apiKeyAccounts, "disabledReason:", "disabledReason field");
  assertIncludes(apiKeyAccounts, "disabledBy:", "disabledBy field");
  assertIncludes(apiKeyAccounts, "autoDisabledReason:", "autoDisabledReason field");
});

test("disableApiKeyAccount clears enable tracking fields on disable", () => {
  assertIncludes(apiKeyAccounts, "enabledAt: undefined", "clears enabledAt");
  assertIncludes(apiKeyAccounts, "enabledBy: undefined", "clears enabledBy");
});

test("enableApiKeyAccount clears disabled fields", () => {
  assertIncludes(apiKeyAccounts, "disabled: false", "clears disabled flag");
  assertIncludes(apiKeyAccounts, "disabledAt: undefined", "clears disabledAt");
  assertIncludes(apiKeyAccounts, "disabledReason: undefined", "clears disabledReason");
  assertIncludes(apiKeyAccounts, "disabledBy: undefined", "clears disabledBy");
  assertIncludes(apiKeyAccounts, "autoDisabledReason: undefined", "clears autoDisabledReason");
});

test("enableApiKeyAccount sets enabledTracking", () => {
  assertIncludes(apiKeyAccounts, 'enabledBy: "user"', "enabledBy user");
  assertIncludes(apiKeyAccounts, "enabledAt: now", "enabledAt set");
});

test("enableApiKeyAccount does not auto-activate", () => {
  // enable does NOT call mirrorActiveCredential or activate
  const enableFnStart = apiKeyAccounts.indexOf("export async function enableApiKeyAccount");
  const disableFnStart = apiKeyAccounts.indexOf("export async function disableApiKeyAccount");
  const enableBody = apiKeyAccounts.slice(enableFnStart, disableFnStart);
  assertNotIncludes(enableBody, "mirrorActiveCredential", "enable does not mirror active");
});

test("disableApiKeyAccount handles replacementAccountId for active", () => {
  assertIncludes(apiKeyAccounts, "replacementAccountId", "replacement param");
  assertIncludes(apiKeyAccounts, "Replacement account is disabled", "replacement disabled check");
  assertIncludes(apiKeyAccounts, "Replacement account not found", "replacement not-found check");
  assertIncludes(apiKeyAccounts, "Cannot replace active account with itself", "self-replacement guard");
});

test("disableApiKeyAccount is no-op for already disabled", () => {
  assertIncludes(apiKeyAccounts, "entry.disabled", "already-disabled check");
  // The early return path
  assertIncludes(apiKeyAccounts, "return listApiKeyAccounts(provider)", "early return on already disabled");
});

test("activateApiKeyAccount includes disabled reason in error message", () => {
  assertIncludes(apiKeyAccounts, "disabledReason", "disabledReason in error");
  assertIncludes(apiKeyAccounts, "Account is disabled", "disabled error message");
});

test("account metadata type includes disabled fields", () => {
  assertIncludes(apiKeyAccounts, "disabled?: boolean", "disabled boolean field");
  assertIncludes(apiKeyAccounts, "disabledAt?: string", "disabledAt field");
  assertIncludes(apiKeyAccounts, "disabledReason?: string", "disabledReason field");
  assertIncludes(apiKeyAccounts, "disabledBy?:", "disabledBy field");
  assertIncludes(apiKeyAccounts, "autoDisabledReason?:", "autoDisabledReason field");
  assertIncludes(apiKeyAccounts, "enabledAt?: string", "enabledAt field");
  assertIncludes(apiKeyAccounts, "enabledBy?:", "enabledBy field");
});

test("normalizeAccountEntry treats missing disabled as enabled", () => {
  assertIncludes(apiKeyAccounts, 'typeof value.disabled === "boolean" ? value.disabled : undefined', "disabled defaults to undefined");
});

test("account summary includes disabled fields", () => {
  assertIncludes(apiKeyAccounts, "disabled: entry.disabled === true ? true : undefined", "summary disabled projection");
  assertIncludes(apiKeyAccounts, "disabledReason: entry.disabledReason", "summary disabledReason");
  assertIncludes(apiKeyAccounts, "disabledBy: entry.disabledBy", "summary disabledBy");
  assertIncludes(apiKeyAccounts, "autoDisabledReason: entry.autoDisabledReason", "summary autoDisabledReason");
  assertIncludes(apiKeyAccounts, "enabledAt: entry.enabledAt", "summary enabledAt");
});

test("no plaintext key in metadata type", () => {
  const metadataIfaceStart = apiKeyAccounts.indexOf("interface ApiKeyAccountMetadata {");
  const nextExport = apiKeyAccounts.indexOf("\ninterface ", metadataIfaceStart + 1);
  const metadataBody = apiKeyAccounts.slice(metadataIfaceStart, nextExport > 0 ? nextExport : apiKeyAccounts.length);
  assertNotIncludes(metadataBody, "apiKey:", "no apiKey in metadata");
  assertNotIncludes(metadataBody, "plaintext", "no plaintext in metadata");
  assertNotIncludes(metadataBody, "secret:", "no secret in metadata");
});

// ---------------------------------------------------------------------------
// 2. opencode-go-account-failover.ts — invariants
// ---------------------------------------------------------------------------

console.log("\n=== opencode-go-account-failover.ts ===");

const failover = read("lib/opencode-go-account-failover.ts");

test("failover event result type has no plaintext key fields", () => {
  // The result interface should not contain apiKey, key, secret, plaintext
  assertNotIncludes(failover, "apiKey?:", "no apiKey in result");
  assertNotIncludes(failover, "secret?:", "no secret in result");
  assertNotIncludes(failover, "plaintext", "no plaintext in result");
});

test("failover uses globalThis for lock state", () => {
  assertIncludes(failover, "__piOpencodeGoFailover", "globalThis key");
});

test("failover has exhaustedCooldownMs usage", () => {
  assertIncludes(failover, "exhaustedCooldownMs", "config cooldown field");
});

test("failover checks config.enabled before failover", () => {
  assertIncludes(failover, "config.enabled", "config enabled check");
});

test("failover returns disabled status when config disabled", () => {
  assertIncludes(failover, 'status: "disabled"', "disabled status");
});

test("account_unusable calls disableApiKeyAccount", () => {
  const reasonBlock = failover.indexOf('reason === "account_unusable"');
  assert.ok(reasonBlock > 0, "account_unusable block exists");
  const afterReason = failover.slice(reasonBlock, reasonBlock + 600);
  assertIncludes(afterReason, "disableApiKeyAccount", "disableApiKeyAccount call");
  assertIncludes(afterReason, '"account_unusable"', "autoDisabledReason");
  assertIncludes(afterReason, '"system"', "disabledBy system");
});

test("quota_exhausted marks cooldown", () => {
  const cooldownBlock = failover.indexOf("quota_exhausted: mark cooldown");
  assert.ok(cooldownBlock > 0, "cooldown comment exists");
  assertIncludes(failover, "exhaustedUntil.set", "cooldown map set");
});

test("active-changed-after-lock guard exists", () => {
  assertIncludes(failover, "activeAfterLock", "activeAfterLock variable");
  assertIncludes(failover, "already_switched_by_other_session", "already switched status");
  assertIncludes(failover, "activeAfterLock !== triggerAccountId", "active changed check");
});

test("double-check before activate (TOCTOU) exists", () => {
  assertIncludes(failover, "activeBeforeActivate", "activeBeforeActivate variable");
  assertIncludes(failover, "activeBeforeActivate !== triggerAccountId", "TOCTOU check");
});

test("candidate selection skips disabled accounts", () => {
  assertIncludes(failover, "account.disabled", "disabled check in selection");
});

test("withFailoverLock wraps the mutex region", () => {
  assertIncludes(failover, "withFailoverLock", "lock wrapper");
});

test("minSwitchIntervalMs respected", () => {
  assertIncludes(failover, "minSwitchIntervalMs", "switch interval config");
});

// ---------------------------------------------------------------------------
// 3. pi-web-config.ts — default-off config
// ---------------------------------------------------------------------------

console.log("\n=== pi-web-config.ts ===");

const piWebConfig = read("lib/pi-web-config.ts");

test("opencodeGo.autoFailover default config block exists", () => {
  assertIncludes(piWebConfig, "opencodeGo:", "opencodeGo config key");
  assertIncludes(piWebConfig, "autoFailover:", "autoFailover config key");
});

test("autoFailover enabled default is false", () => {
  // The first "opencodeGo:" is in type definitions; find the DEFAULT_PI_WEB_CONFIG block instead
  const defaultsStart = piWebConfig.indexOf("DEFAULT_PI_WEB_CONFIG");
  const opencodeGoInDefaults = piWebConfig.indexOf("opencodeGo:", defaultsStart);
  const afterConfig = piWebConfig.slice(opencodeGoInDefaults, opencodeGoInDefaults + 300);
  assertIncludes(afterConfig, "enabled: false", "enabled defaults to false");
});

test("autoFailover config includes maxAttemptsPerTurn", () => {
  assertIncludes(piWebConfig, "maxAttemptsPerTurn:", "maxAttemptsPerTurn field");
});

test("autoFailover config includes maxAccountSwitchesPerTurn", () => {
  assertIncludes(piWebConfig, "maxAccountSwitchesPerTurn:", "maxAccountSwitchesPerTurn field");
});

test("autoFailover config includes exhaustedCooldownMs", () => {
  assertIncludes(piWebConfig, "exhaustedCooldownMs:", "exhaustedCooldownMs field");
});

test("autoFailover config includes minSwitchIntervalMs", () => {
  assertIncludes(piWebConfig, "minSwitchIntervalMs:", "minSwitchIntervalMs field");
});

test("PiWebOpencodeGoConfig type exists", () => {
  assertIncludes(piWebConfig, "PiWebOpencodeGoConfig", "config type");
  assertIncludes(piWebConfig, "PiWebOpencodeGoAutoFailoverConfig", "failover config type");
});

test("validateOpencodeGoAutoFailoverConfig validates enabled as boolean", () => {
  assertIncludes(piWebConfig, 'opencodeGo.autoFailover.enabled', "validation path");
  assertIncludes(piWebConfig, "requireBoolean", "boolean validation");
});

test("validateOpencodeGoAutoFailoverConfig validates max fields", () => {
  const validateFn = piWebConfig.indexOf("function validateOpencodeGoAutoFailoverConfig");
  const validateOpencodeGoConfigFn = piWebConfig.indexOf("function validatePiWebOpencodeGoConfig", validateFn + 1);
  const body = piWebConfig.slice(validateFn, validateOpencodeGoConfigFn > 0 ? validateOpencodeGoConfigFn : validateFn + 800);
  assertIncludes(body, "maxAttemptsPerTurn", "maxAttemptsPerTurn validated");
  assertIncludes(body, "maxAccountSwitchesPerTurn", "maxAccountSwitchesPerTurn validated");
  assertIncludes(body, "exhaustedCooldownMs", "exhaustedCooldownMs validated");
  assertIncludes(body, "minSwitchIntervalMs", "minSwitchIntervalMs validated");
});

// ---------------------------------------------------------------------------
// 4. rpc-manager.ts — integration invariants
// ---------------------------------------------------------------------------

console.log("\n=== rpc-manager.ts ===");

const rpcManager = read("lib/rpc-manager.ts");

test("AgentSessionWrapper patches opencode-go failover", () => {
  assertIncludes(rpcManager, "patchOpencodeGoAccountFailover", "patch method exists");
});

test("patch is called in constructor", () => {
  // Constructor should call both patches
  assertIncludes(rpcManager, "this.patchOpencodeGoAccountFailover", "constructor call");
});

test("imports attemptOpencodeGoAccountFailover", () => {
  assertIncludes(rpcManager, "attemptOpencodeGoAccountFailover", "failover import");
  assertIncludes(rpcManager, "getActiveOpencodeGoAccountId", "active account id import");
  assertIncludes(rpcManager, "OpencodeGoFailoverTurnBudget", "budget type import");
});

test("captures trigger account before run", () => {
  assertIncludes(rpcManager, "runTriggerAccountId", "trigger capture variable");
  assertIncludes(rpcManager, 'provider === "opencode-go"', "provider check");
});

test("emits opencode_go_account_failover event", () => {
  assertIncludes(rpcManager, "opencode_go_account_failover", "event type string");
  assertIncludes(rpcManager, "emitEvent", "emitEvent call");
});

test("skips emit for trivial statuses", () => {
  assertIncludes(rpcManager, 'result.status !== "not_opencode_go"', "not_opencode_go filter");
  assertIncludes(rpcManager, 'result.status !== "not_eligible"', "not_eligible filter");
  assertIncludes(rpcManager, 'result.status !== "disabled"', "disabled filter");
});

test("removes failed assistant message on retry", () => {
  assertIncludes(rpcManager, "result.retry", "retry check");
  assertIncludes(rpcManager, "slice(0, -1)", "message removal");
});

test("resets budget on non-error stopReason", () => {
  assertIncludes(rpcManager, "budget.attempts = 0", "attempts reset");
  assertIncludes(rpcManager, "budget.switches = 0", "switches reset");
  assertIncludes(rpcManager, "stopReason !== \"error\"", "non-error reset condition");
});

test("chain order: opencode-go wraps chatgpt wraps pi SDK", () => {
  assertIncludes(rpcManager, "opencode-go → chatgpt → original pi SDK", "chain order comment");
});

test("per-turn budget initialized", () => {
  assertIncludes(rpcManager, "attempts: 0", "budget attempts init");
  assertIncludes(rpcManager, "switches: 0", "budget switches init");
  assertIncludes(rpcManager, "attemptedAccountIds: []", "budget attemptedIds init");
});

// ---------------------------------------------------------------------------
// 5. hooks/useAgentSession.ts — frontend event handling
// ---------------------------------------------------------------------------

console.log("\n=== hooks/useAgentSession.ts ===");

const useAgentSession = read("hooks/useAgentSession.ts");

test("handles opencode_go_account_failover SSE event", () => {
  assertIncludes(useAgentSession, "opencode_go_account_failover", "event handler case");
});

test("OpencodeGoFailoverNotice type exported", () => {
  assertIncludes(useAgentSession, "export interface OpencodeGoFailoverNotice", "notice type export");
});

test("notice includes status and message", () => {
  const noticeStart = useAgentSession.indexOf("export interface OpencodeGoFailoverNotice");
  const noticeEnd = useAgentSession.indexOf("}", noticeStart + 60);
  const noticeBody = useAgentSession.slice(noticeStart, noticeEnd + 1);
  assertIncludes(noticeBody, "status", "status field");
  assertIncludes(noticeBody, "message", "message field");
});

test("notice does not expose apiKey or secret", () => {
  const noticeStart = useAgentSession.indexOf("export interface OpencodeGoFailoverNotice");
  const noticeEnd = useAgentSession.indexOf("}", noticeStart + 100);
  const noticeBody = useAgentSession.slice(noticeStart, noticeEnd + 1);
  assertNotIncludes(noticeBody, "apiKey", "no apiKey in notice");
  assertNotIncludes(noticeBody, "secret", "no secret in notice");
  assertNotIncludes(noticeBody, "plaintext", "no plaintext in notice");
});

test("notice auto-dismisses after 12s", () => {
  // Uses 12_000ms (underscore separator)
  assert.ok(
    useAgentSession.includes("12_000") || useAgentSession.includes("12000"),
    "12s auto-dismiss timer",
  );
});

// ---------------------------------------------------------------------------
// 6. app/api/auth/api-key/accounts/[accountId]/route.ts — enable/disable API
// ---------------------------------------------------------------------------

console.log("\n=== accounts/[accountId]/route.ts ===");

const accountRoute = read("app/api/auth/api-key/[provider]/accounts/[accountId]/route.ts");

test("PATCH action=enable calls enableApiKeyAccount", () => {
  assertIncludes(accountRoute, 'action === "enable"', "enable action");
  assertIncludes(accountRoute, "enableApiKeyAccount", "enable call");
});

test("PATCH action=disable calls disableApiKeyAccount with options", () => {
  assertIncludes(accountRoute, 'action === "disable"', "disable action");
  assertIncludes(accountRoute, "disableApiKeyAccount", "disable call");
  assertIncludes(accountRoute, "reason:", "reason param");
  assertIncludes(accountRoute, "replacementAccountId:", "replacementAccountId param");
  assertIncludes(accountRoute, "clearActive:", "clearActive param");
});

test("PATCH disable passes disabledBy from body", () => {
  assertIncludes(accountRoute, 'disabledBy === "system"', "disabledBy parsing");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
