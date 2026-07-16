#!/usr/bin/env node
/**
 * Provider top-bar usage compact-mode contract checks (KIRO-07).
 *
 * Covers:
 * - Shared ProviderUsageTrigger full/compact presentation primitive
 * - Global usage.providerPanelsCompact wiring through AppShell
 * - GPT 5h/week, Grok month/week, Kiro primary remaining labels stay provider-correct
 * - Single app-top-usage-panel host, GPT→Grok→Kiro order, one right padding
 * - KiroUsagePanel accountId/generation guards and safe short fallbacks (no 0% invent)
 * - No secret/raw payload projection in Kiro panel source
 *
 * Run:
 *   npm run test:provider-usage-compact
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-provider-usage-compact.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

const {
  DEFAULT_PI_WEB_CONFIG,
} = await import("../lib/pi-web-config.ts");

await test("usage.providerPanelsCompact defaults to false (full triggers)", () => {
  assert.equal(DEFAULT_PI_WEB_CONFIG.usage.providerPanelsCompact, false);
  assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.usagePanelEnabled, false);
});

await test("ProviderUsageTrigger is pure presentational full/compact primitive", () => {
  const trigger = read("components/ProviderUsageTrigger.tsx");
  assert.match(trigger, /export type ProviderUsageDisplayMode = "full" \| "compact"/);
  assert.match(trigger, /export function ProviderUsageTrigger/);
  assert.match(trigger, /displayMode === "compact"/);
  assert.match(trigger, /compactSummaries\.slice\(0, 2\)/);
  assert.match(trigger, /compactFallback/);
  assert.match(trigger, /providerLabel/);
  // Must not own network / accounts / quota state machines.
  assert.doesNotMatch(trigger, /fetch\(|useState|useEffect|\/api\/auth/);
  assert.doesNotMatch(trigger, /openai-codex|grok-cli|kiro_subscription_quota/);
});

await test("AppShell mounts GPT→Grok→Kiro with one host and global displayMode", () => {
  const appShell = read("components/AppShell.tsx");
  assert.match(appShell, /import \{ KiroUsagePanel \} from "\.\/KiroUsagePanel"/);
  assert.match(appShell, /showKiroUsage = webConfig\?\.kiro\.usagePanelEnabled === true/);
  assert.match(appShell, /showAnyProviderUsage = showChatGptUsage \|\| showGrokUsage \|\| showKiroUsage/);
  assert.match(appShell, /providerUsageDisplayMode/);
  assert.match(appShell, /usage\.providerPanelsCompact === true \? "compact" : "full"/);
  assert.match(appShell, /app-top-usage-panel/);
  assert.match(appShell, /showAnyProviderUsage \? 12 : rightPanelTogglePadding/);

  // Order: GPT then Grok then Kiro in the single host.
  const gptIdx = appShell.indexOf("ChatGptUsagePanelHost");
  const grokIdx = appShell.indexOf("<GrokUsagePanel");
  const kiroIdx = appShell.indexOf("<KiroUsagePanel");
  assert.ok(gptIdx > 0 && grokIdx > gptIdx && kiroIdx > grokIdx, "expected GPT → Grok → Kiro mount order");

  assert.match(appShell, /displayMode=\{providerUsageDisplayMode\}/);
  // Only one paddingRight assignment on the usage host.
  const hostBlock = appShell.slice(
    appShell.indexOf("app-top-usage-panel"),
    appShell.indexOf("app-top-usage-panel") + 900,
  );
  assert.equal((hostBlock.match(/paddingRight/g) || []).length, 1);
});

await test("ChatGptUsagePanel keeps 5h/week schema and accepts displayMode", () => {
  const panel = read("components/ChatGptUsagePanel.tsx");
  assert.match(panel, /displayMode\?: ProviderUsageDisplayMode/);
  assert.match(panel, /displayMode = "full"/);
  assert.match(panel, /ProviderUsageTrigger/);
  assert.match(panel, /label: "5h"/);
  assert.match(panel, /label: "周"/);
  assert.match(panel, /GPT_QUOTA_TIER_COMPACT_LABELS\.five_hour/);
  assert.match(panel, /GPT_QUOTA_TIER_COMPACT_LABELS\.seven_day/);
  assert.doesNotMatch(panel, /月度额度|monthly\.utilization|GrokQuotaResultV1|kiro_subscription_quota/);
  assert.match(panel, /compactFallback/);
  assert.match(panel, /需登录|额度未知|登录/);
});

await test("GrokUsagePanel keeps month/week schema and accepts displayMode", () => {
  const panel = read("components/GrokUsagePanel.tsx");
  assert.match(panel, /displayMode\?: ProviderUsageDisplayMode/);
  assert.match(panel, /displayMode = "full"/);
  assert.match(panel, /ProviderUsageTrigger/);
  assert.match(panel, /label: "月"/);
  assert.match(panel, /label: "周"/);
  assert.match(panel, /monthlyPercent|quota\?\.monthly/);
  assert.match(panel, /weeklyPercent|quota\?\.weekly/);
  assert.doesNotMatch(panel, /five_hour|seven_day|kiro_subscription_quota|Reset credits/);
  assert.match(panel, /compactFallback/);
});

await test("KiroUsagePanel primary remaining compact + Active race guards", () => {
  const panel = read("components/KiroUsagePanel.tsx");
  assert.match(panel, /export function KiroUsagePanel/);
  assert.match(panel, /displayMode\?: ProviderUsageDisplayMode/);
  assert.match(panel, /ProviderUsageTrigger/);
  assert.match(panel, /KIRO_PROVIDER_ID = "kiro"/);
  assert.match(panel, /kind === "kiro_subscription_quota"/);
  assert.match(panel, /label: "剩余"/);
  assert.match(panel, /formatKiroRemaining/);
  assert.match(panel, /quotaRequestGen|accountsRequestGen/);
  assert.match(panel, /accountId && data\.accountId && data\.accountId !== accountId/);
  assert.match(panel, /setQuota\(null\)/);
  assert.match(panel, /quotaMatchesAccount|safeQuota/);
  assert.match(panel, /Math\.min\(392,/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /Escape/);
  assert.match(panel, /triggerRef\.current\?\.focus\(\)/);
  assert.match(panel, /role="progressbar"/);
  // Short compact fallbacks — never invent 0%.
  assert.match(panel, /fallback = "登录"/);
  assert.match(panel, /fallback = "加载中"/);
  assert.match(panel, /fallback = "需登录"/);
  assert.match(panel, /fallback = "不可用"/);
  assert.match(panel, /fallback = "额度未知"/);
  // Unknown states must not invent a fake 0% utilization for display.
  assert.doesNotMatch(panel, /invent(?:ed)?\s*0%|伪造\s*0%|fallback\s*=\s*["']0%/);
  // No secret / raw payload leakage patterns in UI source.
  assert.doesNotMatch(panel, /clientSecret|profileArn|refresh_token|access_token|userInfo/);
  assert.doesNotMatch(panel, /Reset credits|credential import|JSON import/i);
  assert.doesNotMatch(panel, /\{\s*[A-Za-z0-9_$.?]*\.error\.message\s*\}/);
});

await test("globals.css shared trigger + Kiro reduced-motion/focus", () => {
  const globals = read("app/globals.css");
  assert.match(globals, /\.provider-usage-trigger/);
  assert.match(globals, /\.provider-usage-trigger__spinner/);
  assert.match(globals, /\.kiro-usage-panel/);
  assert.match(globals, /\.kiro-usage-panel__skeleton-shimmer/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.provider-usage-trigger__spinner/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.kiro-usage-panel/);
  assert.match(globals, /GPT→Grok→Kiro|GPT\/Grok\/Kiro/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll provider usage compact checks passed.");
