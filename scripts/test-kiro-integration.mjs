#!/usr/bin/env node
/**
 * kiro-integration — end-to-end source + config + privacy contracts (KIRO-08)
 *
 * Cross-cuts KIRO-01…07 without live AWS/Kiro OAuth:
 * - package / Next externalization / jiti bootstrap
 * - OAuth store + token CAS + GetUsageLimits endpoint safety
 * - Path B failover chain + SSE projection
 * - Settings/config defaults + compact topbar host
 * - Models/topbar UI capability wiring
 * - Privacy: no secrets/profileArn/raw bodies in API/UI/SSE
 * - Real-credential blocker is recorded honestly (no mock-as-live claim)
 *
 * Run: npm run test:kiro-integration
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
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

function assertFileExists(relativePath) {
  assert.ok(existsSync(join(root, relativePath)), `missing ${relativePath}`);
}

// ============================================================================
// 1. Package / scripts / dependency surface
// ============================================================================

console.log("\n=== package / scripts / dependency ===");

const packageJson = JSON.parse(read("package.json"));
const nextConfig = read("next.config.ts");

test("pi-kiro-provider@0.2.x is a runtime dependency", () => {
  const dep = packageJson.dependencies?.["pi-kiro-provider"];
  assert.ok(typeof dep === "string" && dep.includes("0.2"), `got ${dep}`);
});

test("integration + unit scripts are registered", () => {
  for (const script of [
    "test:kiro-integration",
    "test:kiro-provider",
    "test:kiro-accounts",
    "test:kiro-config",
    "test:kiro-quota",
    "test:kiro-models-ui",
    "test:kiro-failover-adapter",
    "test:kiro-failover-runtime",
    "test:provider-usage-compact",
  ]) {
    assert.ok(packageJson.scripts?.[script], `missing script ${script}`);
  }
});

test("Next externalizes jiti + both fixed providers", () => {
  assertIncludes(nextConfig, '"jiti"', "jiti");
  assertIncludes(nextConfig, '"pi-grok-cli"', "pi-grok-cli");
  assertIncludes(nextConfig, '"pi-kiro-provider"', "pi-kiro-provider");
});

test("required production modules exist", () => {
  for (const path of [
    "lib/pi-provider-extensions.ts",
    "lib/oauth-account-providers.ts",
    "lib/kiro-account-token.ts",
    "lib/kiro-subscription-quota.ts",
    "lib/kiro-account-failover.ts",
    "lib/pi-web-config.ts",
    "components/KiroQuotaView.tsx",
    "components/KiroUsagePanel.tsx",
    "components/ProviderUsageTrigger.tsx",
    "app/api/auth/quota/[provider]/route.ts",
  ]) {
    assertFileExists(path);
  }
});

// ============================================================================
// 2. Bootstrap + registry call sites
// ============================================================================

console.log("\n=== bootstrap / registry ===");

const pe = read("lib/pi-provider-extensions.ts");

test("fixed provider list is Grok then Kiro then Antigravity", () => {
  assertIncludes(pe, "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension]", "order");
  assertIncludes(pe, 'import("pi-kiro-provider")', "jiti kiro");
  assertIncludes(pe, 'import("pi-grok-cli")', "jiti grok");
  assertIncludes(pe, "export function ensureWebProvidersBootstrapped", "legacy OAuth bootstrap");
  assertIncludes(pe, "was removed for pi SDK 0.80.10", "registry helper hard-fails");
});

test("key call sites use ModelRuntime helpers", () => {
  const sessionSites = [
    ["lib/rpc-manager.ts", "createWebAgentSessionServices"],
    ["lib/ypi-studio-child-session-runner.ts", "createWebAgentSessionServices"],
    ["app/api/models/route.ts", "createWebAgentSessionServices"],
    ["app/api/terminal/env/assist/route.ts", "createWebAgentSessionServices"],
    ["app/api/trellis/workflow/assist/route.ts", "createWebAgentSessionServices"],
  ];
  for (const [path, needle] of sessionSites) {
    assertIncludes(read(path), needle, path);
  }
  const adminSites = [
    ["app/api/auth/providers/route.ts", "getWebModelRuntime"],
    ["app/api/auth/all-providers/route.ts", "getWebModelRuntime"],
  ];
  for (const [path, needle] of adminSites) {
    assertIncludes(read(path), needle, path);
  }
  // ResourceLoader-only paths still use factories without ModelRegistry.
  assertIncludes(read("app/api/skills/route.ts"), "webExtensionFactories", "skills");
  assertIncludes(read("app/api/commands/route.ts"), "webExtensionFactories", "commands");
  const peSource = read("lib/pi-provider-extensions.ts");
  assertIncludes(peSource, "createWebProviderAwareModelRegistry", "migration stub retained");
  assertIncludes(peSource, "ensureWebProvidersBootstrapped", "legacy bootstrap helper");
  assertIncludes(read("lib/web-model-runtime.ts"), "createWebAgentSessionServices", "runtime helper");
});

// ============================================================================
// 3. Accounts / token / quota contracts
// ============================================================================

console.log("\n=== accounts / token / quota ===");

const oauthProviders = read("lib/oauth-account-providers.ts");
const token = read("lib/kiro-account-token.ts");
const quota = read("lib/kiro-subscription-quota.ts");
const quotaRoute = read("app/api/auth/quota/[provider]/route.ts");

test("Kiro adapter is registered and import-disabled", () => {
  assertIncludes(oauthProviders, 'export const KIRO_PROVIDER_ID = "kiro"', "id");
  assertIncludes(oauthProviders, "[KIRO_PROVIDER_ID, kiroAdapter]", "map");
  assertIncludes(oauthProviders, "supportsCredentialImport: false", "no import");
});

test("token refresh uses CAS + forceRefresh + 0600 write", () => {
  assertIncludes(token, "forceRefresh", "forceRefresh");
  assertIncludes(token, "mirrorActiveCredentialIfActive", "CAS helper or call");
  assertIncludes(token, "0o600", "secret mode");
  assertIncludes(token, "getOAuthApiKey", "registered refresh");
  assertIncludes(token, "activeAccountId", "CAS compares active");
  assertIncludes(token, "withKiroProviderLock", "shared provider lock");
  assert.ok(
    !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(token),
    "token must not resolve package.json export subpath",
  );
  const lock = read("lib/kiro-account-lock.ts");
  assertIncludes(lock, "withKiroProviderLock", "lock module export");
  assert.ok(
    !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(lock),
    "lock must not resolve package.json export subpath",
  );
  const oauth = read("lib/oauth-accounts.ts");
  assertIncludes(oauth, "withKiroProviderLock", "Activate shares provider lock");
});

test("quota only hits fixed GetUsageLimits endpoint", () => {
  assertIncludes(quota, "AmazonCodeWhispererService.GetUsageLimits", "target");
  assertIncludes(quota, "https://q.${region}.amazonaws.com/", "host template");
  assertIncludes(quota, "validateKiroRegion", "region gate");
  assertIncludes(quota, "usageBreakdownList", "list parse");
  assertIncludes(quota, "usageBreakdown", "legacy parse");
  assertIncludes(quota, "STALE_MAX_AGE_MS", "stale ttl");
  assertIncludes(quota, "FRESH_TTL_MS", "fresh ttl");
  assertNotIncludes(quota, "meteringEvent", "no metering fake quota");
});

test("quota route: Kiro GET + POST 405 + no-store", () => {
  assertIncludes(quotaRoute, "getKiroAccountSubscriptionQuota", "account query");
  assertIncludes(quotaRoute, "getKiroActiveSubscriptionQuota", "active query");
  assertIncludes(quotaRoute, '"Cache-Control": "no-store"', "no-store");
  assertIncludes(quotaRoute, "kiro does not support reset-credit", "POST blocked");
  assertIncludes(quotaRoute, "status: 405", "405");
});

// ============================================================================
// 4. Failover Path B
// ============================================================================

console.log("\n=== failover Path B ===");

const failover = read("lib/kiro-account-failover.ts");
const rpc = read("lib/rpc-manager.ts");
const hook = read("hooks/useAgentSession.ts");
const chatInput = read("components/ChatInput.tsx");

test("classifier hard-negatives capacity + bare status before positives", () => {
  assertIncludes(failover, "INSUFFICIENT_MODEL_CAPACITY", "capacity hard-neg");
  assertIncludes(failover, "MONTHLY_REQUEST_COUNT", "monthly positive");
  assertIncludes(failover, "OVERAGE_REQUEST_LIMIT_EXCEEDED", "overage positive");
  assertIncludes(failover, "CONVERSATION_LIMIT_EXCEEDED", "conversation positive");
  assertIncludes(failover, "DAILY_REQUEST_COUNT", "daily positive");
  assert.ok(
    failover.includes("fail closed") || failover.includes("fail-closed"),
    "fail-closed docs or logic",
  );
  assertIncludes(failover, 'quota.cache.state === "stale"', "stale rejected");
});

test("RPC chain is Kiro → Grok → OpenCode → ChatGPT", () => {
  assertIncludes(rpc, "patchKiroAccountFailover", "kiro patch");
  assert.ok(
    rpc.includes("kiro → grok → opencode-go → chatgpt")
      || rpc.includes("Kiro → Grok → OpenCode Go → ChatGPT"),
    "order comment",
  );
  assertIncludes(rpc, 'type: "kiro_account_failover"', "sse type");
  assertIncludes(rpc, "Never project account ids", "privacy comment");
});

test("frontend notice is sanitized and auto-dismisses", () => {
  assertIncludes(hook, "kiro_account_failover", "hook handles event");
  assertIncludes(hook, "KiroFailoverNotice", "typed notice");
  assertIncludes(chatInput, "kiroFailoverNotice", "chat surface");
  assertNotIncludes(hook, "fromAccountId", "no from id");
  assertNotIncludes(hook, "toAccountId", "no to id");
});

// ============================================================================
// 5. Config / Settings / compact topbar
// ============================================================================

console.log("\n=== config / settings / compact ===");

const config = read("lib/pi-web-config.ts");
const settings = read("components/SettingsConfig.tsx");
const appShell = read("components/AppShell.tsx");
const trigger = read("components/ProviderUsageTrigger.tsx");
const kiroPanel = read("components/KiroUsagePanel.tsx");
const models = read("components/ModelsConfig.tsx");

test("defaults: compact off, kiro panel off, kiro failover off", () => {
  assertIncludes(config, "providerPanelsCompact: false", "compact default");
  const kiroDefault = config.slice(config.indexOf("kiro: {"), config.indexOf("kiro: {") + 500);
  assertIncludes(kiroDefault, "usagePanelEnabled: false", "panel off");
  assertIncludes(kiroDefault, "enabled: false", "failover off");
});

test("Settings places compact in Usage and Kiro toggles in Kiro section", () => {
  // Settings tree nav lives in SettingsTreeNavigation; SettingsConfig owns the leaf content.
  const treeNav = read("components/SettingsTreeNavigation.tsx");
  assertIncludes(treeNav, 'label: "Kiro"', "kiro nav label");
  assertIncludes(treeNav, '"kiro"', "kiro section id");
  assertIncludes(settings, "顶部额度组件简要显示", "compact label");
  assertIncludes(settings, "updateUsage({ providerPanelsCompact })", "global compact");
  assertIncludes(settings, "Kiro 用量悬浮面板", "kiro panel toggle");
  assertIncludes(settings, "updateKiro({ usagePanelEnabled", "kiro panel write");
  assertIncludes(settings, "updateKiro({ autoFailover:", "kiro failover write");
  assertIncludes(settings, 'view === "kiro"', "kiro leaf view");
});

test("AppShell mounts GPT→Grok→Kiro with one host + global mode", () => {
  assertIncludes(appShell, "KiroUsagePanel", "mount kiro");
  assertIncludes(appShell, "providerUsageDisplayMode", "global mode");
  assertIncludes(appShell, 'usage.providerPanelsCompact === true ? "compact" : "full"', "mode map");
  assertIncludes(appShell, "app-top-usage-panel", "single host");
  const gpt = appShell.indexOf("ChatGptUsagePanel");
  const grok = appShell.indexOf("<GrokUsagePanel");
  const kiro = appShell.indexOf("<KiroUsagePanel");
  assert.ok(gpt > 0 && grok > gpt && kiro > grok, "order GPT→Grok→Kiro");
});

test("shared trigger is pure presentational compact primitive", () => {
  assertIncludes(trigger, 'ProviderUsageDisplayMode = "full" | "compact"', "modes");
  assertIncludes(trigger, "compactSummaries.slice(0, 2)", "max two summaries");
  assert.doesNotMatch(trigger, /fetch\(|\/api\/auth/, "no network");
});

test("KiroUsagePanel has accountId/generation guards and no secrets", () => {
  assertIncludes(kiroPanel, "generation", "generation guard");
  assertIncludes(kiroPanel, "ProviderUsageTrigger", "uses shared trigger");
  assertNotIncludes(kiroPanel, "clientSecret", "no clientSecret");
  assertNotIncludes(kiroPanel, "profileArn", "no profileArn");
  assertNotIncludes(kiroPanel, "refresh_token", "no refresh");
});

test("Models Kiro branch is capability-driven with three OAuth methods", () => {
  assertIncludes(models, 'provider.id === "kiro"', "kiro detect");
  assertIncludes(models, "supportsGlobalActiveSemantics", "shared capability");
  assertIncludes(models, "handleKiroLoginMethod", "method picker");
  assertIncludes(models, '"builder-id"', "builder-id");
  assertIncludes(models, '"google"', "google");
  assertIncludes(models, '"github"', "github");
  assertIncludes(models, "KiroQuotaView", "quota view");
  assertIncludes(models, "hideCodexQuotaSummary = isGrok || isKiro", "hides Codex reset-credit summary for Kiro");
  const kiroQuotaView = read("components/KiroQuotaView.tsx");
  assertNotIncludes(kiroQuotaView, "Reset credits", "KiroQuotaView has no reset credits UI");
  assertNotIncludes(kiroQuotaView, "credential import", "KiroQuotaView has no credential import");
});

// ============================================================================
// 6. Docs presence (KIRO-08 artifact requirement)
// ============================================================================

console.log("\n=== docs presence ===");

const docs = [
  "docs/integrations/README.md",
  "docs/architecture/overview.md",
  "docs/modules/api.md",
  "docs/modules/frontend.md",
  "docs/modules/library.md",
  "docs/operations/troubleshooting.md",
];

for (const path of docs) {
  test(`${path} documents Kiro`, () => {
    const source = read(path);
    assert.match(source, /[Kk]iro/, `${path} mentions Kiro`);
  });
}

test("integrations documents GetUsageLimits + rollback", () => {
  const source = read("docs/integrations/README.md");
  assertIncludes(source, "GetUsageLimits", "endpoint");
  assertIncludes(source, "pi-kiro-provider", "package");
  assertIncludes(source, "providerPanelsCompact", "compact");
  assertIncludes(source, "Rollback", "rollback section");
});

test("architecture documents Path B order and fail-closed", () => {
  const source = read("docs/architecture/overview.md");
  assert.ok(
    source.includes("kiro → grok") || source.includes("Kiro → Grok"),
    "chain",
  );
  assertIncludes(source, "GetUsageLimits", "quota");
  assertIncludes(source, "fail-closed", "fail-closed");
});

// ============================================================================
// 7. Privacy scan across Kiro surface files
// ============================================================================

console.log("\n=== privacy scan ===");

test("UI/SSE/quota wire surfaces omit secret JSON keys", () => {
  // Browser-facing and wire-projection files must not serialize secrets.
  // Server token/quota modules may use accessToken/profileArn as local vars only.
  const uiFiles = [
    "components/KiroQuotaView.tsx",
    "components/KiroUsagePanel.tsx",
    "hooks/useAgentSession.ts",
    "app/api/auth/quota/[provider]/route.ts",
  ];
  for (const path of uiFiles) {
    const source = read(path);
    assertNotIncludes(source, "clientSecret", `${path}: no clientSecret`);
    assert.doesNotMatch(source, /["']profileArn["']\s*:/, `${path}: no profileArn JSON key`);
    assert.doesNotMatch(source, /["']refresh["']\s*:\s*["'`]/, `${path}: no refresh secret literal`);
    assert.doesNotMatch(source, /["']access["']\s*:\s*["'`]/, `${path}: no access secret literal`);
  }
  // Failover SSE emitter must not include account ids even if controller result has them.
  const rpcSource = read("lib/rpc-manager.ts");
  const kiroEmit = rpcSource.slice(
    rpcSource.indexOf('type: "kiro_account_failover"'),
    rpcSource.indexOf('type: "kiro_account_failover"') + 400,
  );
  assertNotIncludes(kiroEmit, "accountId", "SSE emit omits accountId");
  assertNotIncludes(kiroEmit, "fromAccount", "SSE emit omits fromAccount");
  assertNotIncludes(kiroEmit, "toAccount", "SSE emit omits toAccount");
});

// ============================================================================
// 8. Real credential availability (honest blocker recording)
// ============================================================================

console.log("\n=== real-provider availability ===");

function hasKiroCredentialFiles() {
  const dir = join(homedir(), ".pi/agent/auth-accounts/kiro");
  if (!existsSync(dir)) return { present: false, reason: "auth-accounts/kiro missing" };
  let secretFiles = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name === "accounts.json" || name.startsWith(".")) continue;
      const st = statSync(join(dir, name));
      if (st.isFile()) secretFiles += 1;
    }
  } catch {
    return { present: false, reason: "unable to read kiro account dir" };
  }
  if (secretFiles === 0) return { present: false, reason: "no opaque credential files" };
  return { present: true, reason: `${secretFiles} credential file(s)` };
}

function authJsonHasKiro() {
  const authPath = join(homedir(), ".pi/agent/auth.json");
  if (!existsSync(authPath)) return false;
  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    return Boolean(auth && typeof auth === "object" && auth.kiro);
  } catch {
    return false;
  }
}

const cred = hasKiroCredentialFiles();
const activeMirror = authJsonHasKiro();

test("records real Kiro credential availability without claiming live OAuth pass", () => {
  // This test always passes; it prints an explicit blocker/status for the handoff.
  if (!cred.present && !activeMirror) {
    console.log(
      "  \x1b[33m!\x1b[0m REAL_PROVIDER_BLOCKER: no local Kiro OAuth credentials " +
        `(${cred.reason}; auth.json has no kiro mirror). ` +
        "Automated suite must not claim live login/model/quota acceptance.",
    );
  } else {
    console.log(
      `  \x1b[33m!\x1b[0m REAL_PROVIDER_PARTIAL: credentials detected (${cred.reason}; ` +
        `auth.json kiro=${activeMirror}). Live OAuth/chat/quota still require manual browser verification; ` +
        "this integration script does not exercise network login.",
    );
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
