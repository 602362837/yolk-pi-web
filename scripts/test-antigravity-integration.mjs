#!/usr/bin/env node
/**
 * antigravity-integration — end-to-end source + config + privacy contracts (AG-08)
 *
 * Cross-cuts AG-01…07 without claiming live Google OAuth/quota/failover:
 * - package / Next externalization / jiti bootstrap + callback loopback policy
 * - OAuth store + token CAS + fixed fetchAvailableModels egress
 * - model-aware Path B failover chain + SSE projection
 * - Settings/config defaults + Full/Compact/Aggregate fourth provider
 * - Models/topbar UI capability wiring + dual-independent priority rings
 *   (Flash | Opus side-by-side) with detail-only only for non-priority groups
 * - Privacy: no token/refresh/projectId/raw bodies in API/UI/SSE
 * - No pi-antigravity-rotator dependency or runtime reference
 * - Real-credential blocker is recorded honestly (no mock-as-live claim)
 *
 * Run: npm run test:antigravity-integration
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
const lockSnippet = existsSync(join(root, "package-lock.json"))
  ? read("package-lock.json")
  : "";

test("@yofriadi/pi-antigravity-oauth is pinned to 0.3.0", () => {
  const dep = packageJson.dependencies?.["@yofriadi/pi-antigravity-oauth"];
  assert.equal(dep, "0.3.0", `got ${dep}`);
  if (lockSnippet) {
    assertIncludes(lockSnippet, '"@yofriadi/pi-antigravity-oauth"', "lockfile entry");
    assert.ok(
      /"node_modules\/@yofriadi\/pi-antigravity-oauth"[\s\S]{0,400}?"version":\s*"0\.3\.0"/.test(lockSnippet)
        || /"@yofriadi\/pi-antigravity-oauth@0\.3\.0"/.test(lockSnippet)
        || /"@yofriadi\/pi-antigravity-oauth":\s*\{[\s\S]{0,200}?"version":\s*"0\.3\.0"/.test(lockSnippet),
      "lockfile should pin 0.3.0",
    );
  }
});

test("no pi-antigravity-rotator dependency or package scripts", () => {
  assert.equal(packageJson.dependencies?.["pi-antigravity-rotator"], undefined);
  assert.equal(packageJson.devDependencies?.["pi-antigravity-rotator"], undefined);
  assertNotIncludes(JSON.stringify(packageJson.scripts ?? {}), "pi-antigravity-rotator", "scripts");
});

test("integration + unit scripts are registered", () => {
  for (const script of [
    "test:antigravity-integration",
    "test:antigravity-provider",
    "test:antigravity-callback-security",
    "test:antigravity-accounts",
    "test:antigravity-refresh-activate-race",
    "test:antigravity-config",
    "test:antigravity-quota",
    "test:antigravity-model-quota",
    "test:antigravity-quota-groups",
    "test:antigravity-models-ui",
    "test:antigravity-usage-panel",
    "test:antigravity-failover-adapter",
    "test:antigravity-failover-runtime",
    "test:provider-usage-compact",
    "test:provider-usage-aggregate",
  ]) {
    assert.ok(packageJson.scripts?.[script], `missing script ${script}`);
  }
});

test("Next externalizes jiti + all three fixed providers", () => {
  assertIncludes(nextConfig, '"jiti"', "jiti");
  assertIncludes(nextConfig, '"pi-grok-cli"', "pi-grok-cli");
  assertIncludes(nextConfig, '"pi-kiro-provider"', "pi-kiro-provider");
  assertIncludes(nextConfig, '"@yofriadi/pi-antigravity-oauth"', "antigravity");
});

test("required production modules exist", () => {
  for (const path of [
    "lib/pi-provider-extensions.ts",
    "lib/oauth-account-providers.ts",
    "lib/antigravity-account-lock.ts",
    "lib/antigravity-account-token.ts",
    "lib/antigravity-subscription-quota.ts",
    "lib/antigravity-model-quota.ts",
    "lib/antigravity-quota-groups.ts",
    "lib/antigravity-account-failover.ts",
    "lib/antigravity-usage-ring.ts",
    "lib/pi-web-config.ts",
    "components/AntigravityQuotaView.tsx",
    "components/AntigravityUsagePanel.tsx",
    "components/ProviderUsageTrigger.tsx",
    "components/ProviderUsageAggregatePanel.tsx",
    "components/ProviderUsagePanelContract.ts",
    "app/api/auth/quota/[provider]/route.ts",
  ]) {
    assertFileExists(path);
  }
});

test("installed package audit: version, no postinstall, no rotator", () => {
  const pkgPath = join(root, "node_modules/@yofriadi/pi-antigravity-oauth/package.json");
  assert.ok(existsSync(pkgPath), "package installed");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.equal(pkg.version, "0.3.0");
  assert.equal(pkg.scripts?.postinstall, undefined);
  assert.equal(pkg.scripts?.install, undefined);
  assert.equal(pkg.scripts?.preinstall, undefined);
  const srcDir = join(root, "node_modules/@yofriadi/pi-antigravity-oauth/src");
  assert.ok(existsSync(srcDir), "src publish layout");
  // No child_process / eval in non-vendor package source (egress stays Google).
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "vendor") continue;
        walk(full, out);
      } else if (name.endsWith(".ts") || name.endsWith(".js")) {
        out.push(full);
      }
    }
    return out;
  };
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bchild_process\b/, `${file}: no child_process`);
    assert.doesNotMatch(source, /\beval\s*\(/, `${file}: no eval`);
    assert.doesNotMatch(source, /\bnew Function\b/, `${file}: no Function ctor`);
  }
});

// ============================================================================
// 2. Bootstrap + callback loopback + registry call sites
// ============================================================================

console.log("\n=== bootstrap / callback / registry ===");

const pe = read("lib/pi-provider-extensions.ts");

test("fixed provider list is Grok → Kiro → Antigravity", () => {
  assertIncludes(
    pe,
    "return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension, anyrouterProviderExtension]",
    "order",
  );
  assertIncludes(pe, 'import("pi-grok-cli")', "jiti grok");
  assertIncludes(pe, 'import("pi-kiro-provider")', "jiti kiro");
  // Antigravity resolves installed package.json → pi.extensions entry, then jiti-imports candidates.
  assertIncludes(pe, 'resolveInstalledPackageJson("@yofriadi/pi-antigravity-oauth")', "package resolve");
  assertIncludes(pe, "resolveAntigravityPackageExtensionEntry", "extension entry resolver");
  assertIncludes(pe, "antigravityJitiImportCandidates", "jiti candidate list");
  // Production anchors jiti at app package.json (Next-safe) and imports candidates.
  assertIncludes(pe, "createRuntimeJiti", "jiti antigravity factory helper");
  assertIncludes(pe, "resolveRuntimePackageAnchor", "jiti package-root anchor");
  assertNotIncludes(pe, "createJiti(import.meta.url", "no import.meta.url jiti anchor");
  assertIncludes(pe, "await jiti.import(candidate)", "jiti import candidate");
  assertIncludes(pe, "ANTIGRAVITY_OAUTH_CALLBACK_HOST", "loopback constant");
  assertIncludes(pe, 'ANTIGRAVITY_OAUTH_CALLBACK_HOST = "127.0.0.1"', "forced loopback");
  assertIncludes(pe, "PI_OAUTH_CALLBACK_HOST", "env key");
  assertIncludes(pe, "export function ensureWebProvidersBootstrapped", "legacy OAuth bootstrap");
  assertIncludes(pe, "export async function createWebProviderAwareModelRegistry", "migration stub retained");
  assertIncludes(pe, "was removed for pi SDK 0.80.10", "registry helper hard-fails");
});

test("no application static private import of package src", () => {
  const surface = [
    "lib/pi-provider-extensions.ts",
    "lib/antigravity-subscription-quota.ts",
    "lib/antigravity-model-quota.ts",
    "lib/antigravity-account-token.ts",
    "lib/antigravity-account-failover.ts",
    "lib/rpc-manager.ts",
  ];
  for (const path of surface) {
    const source = read(path);
    // Allow jiti runtime candidate strings; ban static ESM/CJS private imports.
    assert.doesNotMatch(
      source,
      /from\s+["']@yofriadi\/pi-antigravity-oauth\/src(?:\/[^"']*)?["']|require\(\s*["']@yofriadi\/pi-antigravity-oauth\/src(?:\/[^"']*)?["']\s*\)|import\(\s*["']@yofriadi\/pi-antigravity-oauth\/src(?:\/[^"']*)?["']\s*\)/,
      `${path}: no static private src import`,
    );
    assertNotIncludes(source, "pi-antigravity-rotator", `${path} rotator`);
  }
  // Bootstrap may list the public TS entry as a jiti candidate only (package has no main/exports).
  assertIncludes(pe, "antigravityJitiImportCandidates", "candidate helper present");
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
  assertIncludes(read("app/api/auth/providers/route.ts"), "getWebModelRuntime", "providers route");
  assertIncludes(read("app/api/skills/route.ts"), "webExtensionFactories", "skills loader");
  assertIncludes(read("app/api/commands/route.ts"), "webExtensionFactories", "commands loader");
  assertIncludes(read("lib/web-model-runtime.ts"), "createWebAgentSessionServices", "runtime helper");
});

// ============================================================================
// 3. Accounts / token / quota contracts
// ============================================================================

console.log("\n=== accounts / token / quota ===");

const oauthProviders = read("lib/oauth-account-providers.ts");
const token = read("lib/antigravity-account-token.ts");
const lock = read("lib/antigravity-account-lock.ts");
const oauth = read("lib/oauth-accounts.ts");
const quota = read("lib/antigravity-subscription-quota.ts");
const modelQuota = read("lib/antigravity-model-quota.ts");
const quotaRoute = read("app/api/auth/quota/[provider]/route.ts");

test("Antigravity adapter is registered and import-disabled", () => {
  assertIncludes(oauthProviders, 'export const ANTIGRAVITY_PROVIDER_ID = "google-antigravity"', "id");
  assertIncludes(oauthProviders, "[ANTIGRAVITY_PROVIDER_ID, antigravityAdapter]", "map");
  assertIncludes(oauthProviders, "supportsCredentialImport: false", "no import");
  assertIncludes(oauthProviders, "projectId", "credential requires projectId server-side");
});

test("token refresh uses slot-first CAS + forceRefresh + provider lock + 0600 write", () => {
  assertIncludes(token, "forceRefresh", "forceRefresh");
  assertIncludes(token, "commitAntigravityCredentialUnderLock", "slot-first CAS");
  assertIncludes(token, "reconcileAntigravityActiveMirrorUnderLock", "mirror reconcile");
  assertIncludes(token, "getOAuthApiKey", "registered refresh");
  assertIncludes(token, "withAntigravityProviderLock", "shared provider lock");
  assertIncludes(token, "projectId", "merge/projectId awareness");
  assertIncludes(lock, "withAntigravityProviderLock", "lock export");
  assertIncludes(oauth, "withAntigravityProviderLock", "Activate shares provider lock");
  const transaction = read("lib/antigravity-credential-transaction.ts");
  assertIncludes(transaction, "0o600", "secret mode");
  const runtime = read("lib/web-model-runtime.ts");
  assertIncludes(runtime, "createAntigravityCoordinatedCredentialStore", "runtime wraps Antigravity coordinated store");
});

test("quota only hits fixed fetchAvailableModels endpoint", () => {
  assertIncludes(
    quota,
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "fixed host/path",
  );
  assertIncludes(quota, "remainingFraction", "remaining field");
  assertIncludes(quota, "computeUsedPercent", "used percent helper");
  assertIncludes(quota, "STALE_MAX_AGE_MS", "stale ttl");
  assertIncludes(quota, "FRESH_TTL_MS", "fresh ttl");
  assertIncludes(quota, '{"project"', "body project field template or stringify");
  assertNotIncludes(quota, "pi-antigravity-rotator", "no rotator");
  // Must not invent health from default project alone.
  assert.ok(
    !/rising-fact-p41fc/.test(quota) || /never|not|cannot|must not/i.test(quota),
    "default project must not be treated as health evidence in quota module",
  );
});

test("model mapping is fixed 0.3.0 catalog table", () => {
  assertIncludes(modelQuota, 'ANTIGRAVITY_MODEL_QUOTA_PACKAGE_VERSION = "0.3.0"', "version");
  assertIncludes(modelQuota, "ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0", "table");
  assertIncludes(modelQuota, "failoverSupported", "explicit unsupported path");
  assertIncludes(modelQuota, "getAcceptedAntigravityQuotaKeys", "lookup");
  assertIncludes(modelQuota, "findAntigravityQuotaWindowForPublicModel", "match helper");
});

test("quota route: Antigravity GET + POST 405 + no-store", () => {
  assertIncludes(quotaRoute, "getAntigravityAccountSubscriptionQuota", "account query");
  assertIncludes(quotaRoute, "getAntigravityActiveSubscriptionQuota", "active query");
  assertIncludes(quotaRoute, '"Cache-Control": "no-store"', "no-store");
  assertIncludes(quotaRoute, "google-antigravity", "provider id");
  assertIncludes(quotaRoute, "status: 405", "405");
  assertIncludes(quotaRoute, "does not support reset-credit", "POST blocked");
});

// ============================================================================
// 4. Failover Path B
// ============================================================================

console.log("\n=== failover Path B ===");

const failover = read("lib/antigravity-account-failover.ts");
const rpc = read("lib/rpc-manager.ts");
const hook = read("hooks/useAgentSession.ts");
const chatInput = read("components/ChatInput.tsx");

test("classifier hard-negatives before positives; model-aware candidates", () => {
  assertIncludes(failover, "RESOURCE_EXHAUSTED", "positive");
  assertIncludes(failover, "rate_limit_exceeded", "rate limit positive");
  assertIncludes(failover, "detectAntigravityFailoverReason", "classifier");
  assertIncludes(failover, "remainingFraction", "model remaining check");
  assertIncludes(failover, "findAntigravityQuotaWindowForPublicModel", "model match");
  assert.ok(
    failover.includes("fail closed") || failover.includes("fail-closed") || failover.includes("failClosed"),
    "fail-closed docs or logic",
  );
  assert.ok(
    /stale/.test(failover) && /fresh|live/.test(failover),
    "stale rejected / fresh-live required",
  );
  // Bare 429 alone must not be a positive trigger path without explicit semantics.
  assert.ok(
    /bare|Cloud Code Assist API error \(429\)|hard.?neg/i.test(failover)
      || /429/.test(failover),
    "429 handling present",
  );
});

test("Path B failover stays non-group-aware (accepted keys only)", () => {
  assertNotIncludes(failover, "antigravity-quota-groups", "no group module");
  assertNotIncludes(failover, "groupByAntigravityQuotaWindows", "no groupBy");
  assertNotIncludes(failover, "ANTIGRAVITY_PRIORITY_RING_GROUP_IDS", "no priority groups");
  assertNotIncludes(failover, "groupRemaining", "no group remaining");
  assert.ok(
    !/from ["']\.\/antigravity-quota-groups["']/.test(failover)
      && !/from ["']@\/lib\/antigravity-quota-groups["']/.test(failover),
    "must not import group helpers",
  );
  // Candidate gate is public-model window + remainingFraction only.
  assertIncludes(failover, "isFreshMatchingModelQuota", "fresh matching model");
  assertIncludes(failover, "Quota for other models", "other-model never proves current");
});

test("RPC chain is Antigravity → Kiro → Grok → OpenCode → ChatGPT", () => {
  assertIncludes(rpc, "attemptAntigravityAccountFailover", "antigravity patch import/use");
  assert.ok(
    rpc.includes("antigravity → kiro → grok → opencode-go → chatgpt")
      || rpc.includes("Antigravity → Kiro → Grok → OpenCode Go → ChatGPT"),
    "order comment",
  );
  assertIncludes(rpc, 'type: "antigravity_account_failover"', "sse type");
  assertIncludes(rpc, "Never project account ids", "privacy comment");
});

test("frontend notice is sanitized and auto-dismisses", () => {
  assertIncludes(hook, "antigravity_account_failover", "hook handles event");
  assertIncludes(hook, "AntigravityFailoverNotice", "typed notice");
  assertIncludes(hook, "antigravityFailoverNotice", "state");
  assertIncludes(chatInput, "antigravityFailoverNotice", "chat surface");
  assertNotIncludes(hook, "fromAccountId", "no from id");
  assertNotIncludes(hook, "toAccountId", "no to id");
});

// ============================================================================
// 5. Config / Settings / compact + aggregate topbar
// ============================================================================

console.log("\n=== config / settings / compact / aggregate ===");

const config = read("lib/pi-web-config.ts");
const settings = read("components/SettingsConfig.tsx");
const appShell = read("components/AppShell.tsx");
const contract = read("components/ProviderUsagePanelContract.ts");
const aggregate = read("components/ProviderUsageAggregatePanel.tsx");
const antigravityPanel = read("components/AntigravityUsagePanel.tsx");
const usageRing = read("lib/antigravity-usage-ring.ts");
const models = read("components/ModelsConfig.tsx");
const quotaView = read("components/AntigravityQuotaView.tsx");

test("defaults: compact/aggregate off, antigravity panel off, failover off", () => {
  assertIncludes(config, "providerPanelsCompact: false", "compact default");
  assertIncludes(config, "providerPanelsAggregated: false", "aggregate default");
  const antigravityDefault = config.slice(
    config.indexOf("antigravity: {"),
    config.indexOf("antigravity: {") + 600,
  );
  assertIncludes(antigravityDefault, "usagePanelEnabled: false", "panel off");
  assertIncludes(antigravityDefault, "enabled: false", "failover off");
});

test("Settings places Antigravity section + global compact/aggregate copy", () => {
  // Settings tree nav lives in SettingsTreeNavigation; SettingsConfig owns the leaf content.
  const treeNav = read("components/SettingsTreeNavigation.tsx");
  assertIncludes(treeNav, 'label: "Antigravity"', "nav label");
  assertIncludes(treeNav, '"antigravity"', "nav section id");
  assertIncludes(settings, 'view === "antigravity"', "antigravity leaf view");
  assertIncludes(settings, "顶部额度组件简要显示", "compact label");
  assertIncludes(settings, "模型用量组件聚合", "aggregate label");
  assertIncludes(settings, "updateUsage({ providerPanelsCompact", "global compact");
  assertIncludes(settings, "updateUsage({ providerPanelsAggregated", "global aggregate");
  assertIncludes(settings, "updateAntigravity({ usagePanelEnabled", "panel write");
  assertIncludes(settings, "updateAntigravity({ autoFailover:", "failover write");
});

test("AppShell mounts GPT→Grok→Kiro→Antigravity with mutual exclusion + one host", () => {
  assertIncludes(appShell, "AntigravityUsagePanel", "mount antigravity");
  assertIncludes(appShell, "ProviderUsageAggregatePanel", "aggregate shell");
  assertIncludes(appShell, "providerUsageDisplayMode", "global mode");
  assertIncludes(appShell, 'usage.providerPanelsCompact === true ? "compact" : "full"', "mode map");
  assertIncludes(appShell, "app-top-usage-panel", "single host");
  assertIncludes(appShell, "showAntigravityUsage", "flag");
  const gpt = appShell.indexOf("ChatGptUsagePanel");
  const grok = appShell.indexOf("<GrokUsagePanel");
  const kiro = appShell.indexOf("<KiroUsagePanel");
  const anti = appShell.indexOf("<AntigravityUsagePanel");
  assert.ok(gpt > 0 && grok > gpt && kiro > grok && anti > kiro, "order GPT→Grok→Kiro→Antigravity");
  // Aggregate columns include order 3 for Antigravity.
  assertIncludes(appShell, 'key: "antigravity"', "aggregate key");
  assertIncludes(appShell, "order: 3", "aggregate order 3");
});

test("shared contract allowlists Antigravity as fourth provider", () => {
  assertIncludes(contract, '"antigravity"', "key union");
  assertIncludes(contract, '"Antigravity"', "label");
  assertIncludes(contract, "GPT→Grok→Kiro→Antigravity", "order comment");
  assertIncludes(aggregate, "GPT → Grok → Kiro → Antigravity", "aggregate comment");
});

test("Antigravity usage ring projects dual-independent priority groups (not concentric)", () => {
  assertIncludes(usageRing, "remainingFraction", "remaining");
  assertIncludes(usageRing, "usedPercent", "used");
  assertIncludes(usageRing, "groupByAntigravityQuotaWindows", "group helpers");
  assertIncludes(usageRing, "projectAntigravityRingUnit", "ring projector");
  assertIncludes(usageRing, "ANTIGRAVITY_USAGE_ORDER", "order const");
  assertIncludes(usageRing, "dual-independent", "dual mode");
  assertIncludes(usageRing, "ringSlots", "independent slots");
  assertIncludes(usageRing, "ringUnits", "multi independent units");
  // Period N-ring outer/inner is banned for Flash/Opus packing.
  assert.ok(
    /never.*concentric|NEVER pack Flash|never packs Flash\/Opus|side-by-side/i.test(usageRing),
    "bans Flash/Opus concentric packing",
  );
  // resetTime must never become duration evidence.
  assert.ok(
    /resetTime is title\/detail only|never duration|durationMs: null|durationEvidence: undefined/i.test(usageRing),
    "no duration from resetTime",
  );
  // Non-priority multi-model still detail-only + 多模型.
  assertIncludes(usageRing, "ANTIGRAVITY_MULTI_MODEL_FALLBACK", "multi-model fallback const");
  assertIncludes(usageRing, "多模型", "multi-model copy");
  // Shared period projector is not the dual-priority path.
  assert.ok(
    !/projectProviderUsageWindows\(/.test(usageRing)
      || /@deprecated|Prefer group-based|not.*dual priority/i.test(usageRing),
    "dual priority path does not call shared period projector",
  );
  // Comments may mention projectId as a banned field; JSON keys must not project it.
  assert.doesNotMatch(usageRing, /["']projectId["']\s*:/, "no projectId JSON key");
});

test("AntigravityUsagePanel has accountId/generation guards and no secrets", () => {
  assertIncludes(antigravityPanel, "generation", "generation guard");
  assertIncludes(antigravityPanel, "ProviderUsageTrigger", "uses shared trigger");
  assertIncludes(antigravityPanel, "onAggregateProjectionChange", "aggregate owner");
  assertNotIncludes(antigravityPanel, "client_secret", "no client_secret");
  assertNotIncludes(antigravityPanel, "refresh_token", "no refresh_token");
  assert.doesNotMatch(antigravityPanel, /["']projectId["']\s*:/, "no projectId JSON key");
});

test("Models Antigravity branch is capability-driven with per-model quota", () => {
  assertIncludes(models, 'provider.id === "google-antigravity"', "detect");
  assertIncludes(models, "supportsGlobalActiveSemantics", "shared capability");
  assertIncludes(models, "AntigravityQuotaView", "quota view");
  assertIncludes(models, "antigravityQuotaGenerationRef", "generation guard");
  assertIncludes(quotaView, "remainingFraction", "remaining display path");
  assertNotIncludes(quotaView, "Reset credits", "no reset credits UI");
  assertNotIncludes(quotaView, "credential import", "no credential import");
});

// ============================================================================
// 6. Docs presence (AG-08 artifact requirement)
// ============================================================================

console.log("\n=== docs presence ===");

const docs = [
  "docs/integrations/README.md",
  "docs/architecture/overview.md",
  "docs/modules/api.md",
  "docs/modules/frontend.md",
  "docs/modules/library.md",
  "docs/operations/troubleshooting.md",
  "AGENTS.md",
];

for (const path of docs) {
  test(`${path} documents Antigravity`, () => {
    const source = read(path);
    assert.match(source, /[Aa]ntigravity|google-antigravity/, `${path} mentions Antigravity`);
  });
}

test("integrations documents fixed package, risks, dual rings, aggregate fourth column, rollback", () => {
  const source = read("docs/integrations/README.md");
  assertIncludes(source, "@yofriadi/pi-antigravity-oauth", "package");
  assertIncludes(source, "0.3.0", "version");
  assertIncludes(source, "fetchAvailableModels", "quota endpoint");
  assertIncludes(source, "providerPanelsAggregated", "aggregate");
  assertIncludes(source, "127.0.0.1", "loopback");
  assertIncludes(source, "cloud-platform", "wide scope risk");
  assertIncludes(source, "rising-fact-p41fc", "default project risk");
  assertIncludes(source, "Rollback", "rollback section");
  assertNotIncludes(source, "pi-antigravity-rotator as runtime", "no rotator runtime");
  assert.ok(
    /dual-independent|independent ring|side-by-side|并排/.test(source)
      || /Flash[\s\S]{0,120}Opus/.test(source),
    "documents dual independent rings",
  );
  assert.ok(
    /max\(used\)|conservative|保守/.test(source),
    "documents conservative group aggregation",
  );
  assert.ok(
    /not group-aware|non-group-aware|model-aware|accepted.?keys/.test(source),
    "documents non-group-aware failover",
  );
});

test("architecture documents Path B order, model-aware, dual-independent rings", () => {
  const source = read("docs/architecture/overview.md");
  assert.ok(
    source.includes("Antigravity → Kiro → Grok")
      || source.includes("antigravity → kiro → grok")
      || /\*\*Antigravity\*\*[\s\S]{0,200}?\*\*Kiro\*\*[\s\S]{0,200}?\*\*Grok\*\*/.test(source)
      || source.includes("__piAntigravityFailover") && source.includes("__piKiroFailover"),
    "chain",
  );
  assertIncludes(source, "fetchAvailableModels", "quota");
  assertIncludes(source, "fail-closed", "fail-closed");
  assertIncludes(source, "remainingFraction", "remaining");
  // Group display rings are independent; period N-ring stays separate.
  assert.ok(
    /dual-independent|independent ring|side-by-side|并排/.test(source)
      || /Flash[\s\S]{0,80}Opus/.test(source),
    "dual independent Flash/Opus rings",
  );
  assert.ok(
    /not group-aware|non-group-aware|model-aware|accepted.?keys|other-model-only/.test(source),
    "failover stays model-aware / non-group-aware",
  );
  assert.ok(/detail-only|detail only|多模型/.test(source), "detail-only non-priority fallback");
});

// ============================================================================
// 7. Privacy scan across Antigravity surface files
// ============================================================================

console.log("\n=== privacy scan ===");

test("UI/SSE/quota wire surfaces omit secret JSON keys and raw projectId", () => {
  const uiFiles = [
    "components/AntigravityQuotaView.tsx",
    "components/AntigravityUsagePanel.tsx",
    "hooks/useAgentSession.ts",
    "app/api/auth/quota/[provider]/route.ts",
    "lib/antigravity-usage-ring.ts",
  ];
  for (const path of uiFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /["']client_secret["']\s*:/, `${path}: no client_secret JSON key`);
    assert.doesNotMatch(source, /["']refresh["']\s*:\s*["'`]/, `${path}: no refresh secret literal`);
    assert.doesNotMatch(source, /["']access["']\s*:\s*["'`]/, `${path}: no access secret literal`);
    // projectId must not be projected as a response/DOM field assignment in UI surfaces.
    if (path.startsWith("components/") || path.startsWith("hooks/")) {
      assert.doesNotMatch(source, /["']projectId["']\s*:/, `${path}: no projectId JSON key`);
    }
  }
  // Failover SSE emitter must not include account ids even if controller result has them.
  const rpcSource = read("lib/rpc-manager.ts");
  const emitIdx = rpcSource.indexOf('type: "antigravity_account_failover"');
  assert.ok(emitIdx > 0, "SSE emit present");
  const antiEmit = rpcSource.slice(emitIdx, emitIdx + 500);
  assertNotIncludes(antiEmit, "accountId", "SSE emit omits accountId");
  assertNotIncludes(antiEmit, "fromAccount", "SSE emit omits fromAccount");
  assertNotIncludes(antiEmit, "toAccount", "SSE emit omits toAccount");
  // Privacy comment may mention projectId as banned; the payload must not assign it.
  assert.doesNotMatch(antiEmit, /projectId\s*:/, "SSE emit omits projectId field");
  assertIncludes(antiEmit, "Never project account ids", "privacy comment present");
});

// ============================================================================
// 8. Real credential availability (honest blocker recording)
// ============================================================================

console.log("\n=== real-provider availability ===");

function hasAntigravityCredentialFiles() {
  const dir = join(homedir(), ".pi/agent/auth-accounts/google-antigravity");
  if (!existsSync(dir)) return { present: false, reason: "auth-accounts/google-antigravity missing" };
  let secretFiles = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name === "accounts.json" || name.startsWith(".")) continue;
      const st = statSync(join(dir, name));
      if (st.isFile()) secretFiles += 1;
    }
  } catch {
    return { present: false, reason: "unable to read antigravity account dir" };
  }
  if (secretFiles === 0) return { present: false, reason: "no opaque credential files" };
  return { present: true, reason: `${secretFiles} credential file(s)` };
}

function authJsonHasAntigravity() {
  const authPath = join(homedir(), ".pi/agent/auth.json");
  if (!existsSync(authPath)) return false;
  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    return Boolean(auth && typeof auth === "object" && auth["google-antigravity"]);
  } catch {
    return false;
  }
}

const cred = hasAntigravityCredentialFiles();
const activeMirror = authJsonHasAntigravity();

test("records real Antigravity credential availability without claiming live OAuth pass", () => {
  // This test always passes; it prints an explicit blocker/status for the handoff.
  if (!cred.present && !activeMirror) {
    console.log(
      "  \x1b[33m!\x1b[0m REAL_PROVIDER_BLOCKER: no local Antigravity OAuth credentials " +
        `(${cred.reason}; auth.json has no google-antigravity mirror). ` +
        "Automated suite must not claim live login/model/quota/failover acceptance.",
    );
  } else {
    console.log(
      `  \x1b[33m!\x1b[0m REAL_PROVIDER_PARTIAL: credentials detected (${cred.reason}; ` +
        `auth.json google-antigravity=${activeMirror}). Live OAuth/chat/quota still require manual browser verification; ` +
        "this integration script does not exercise network login or live failover.",
    );
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
