#!/usr/bin/env node
/**
 * ChatGPT top-bar usage panel contract checks.
 *
 * Covers:
 * - GPT Chinese tier labels (5 小时 / 周 / 7 天额度) without monthly forgery
 * - Chinese relative age + countdown helpers (Models English helpers unchanged)
 * - Source wiring: onOpenModels, page_fallback, AbortController generation,
 *   30s accounts-only revalidation, fixed viewport clamp, dialog/aria,
 *   Reset credits + scheduler/lock repair secondary zone
 * - Safe Chinese credential/error allowlist; no Grok schema/fresh/stale
 * - chatgpt.usagePanelEnabled default false
 *
 * Run:
 *   npm run test:chatgpt-usage-panel
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-chatgpt-usage-panel.mjs
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

const {
  QUOTA_TIER_LABELS,
  GPT_QUOTA_TIER_COMPACT_LABELS,
  GPT_QUOTA_TIER_PANEL_LABELS,
  formatQuotaQueriedAt,
  formatGptQuotaRelativeAge,
  formatGptResetCountdown,
  formatResetCountdown,
  knownQuotaTiers,
} = await import("../lib/quota-display.ts");

await test("chatgpt.usagePanelEnabled defaults to false", () => {
  assert.equal(DEFAULT_PI_WEB_CONFIG.chatgpt.usagePanelEnabled, false);
});

await test("Models English tier labels stay 5h/7d", () => {
  assert.equal(QUOTA_TIER_LABELS.five_hour, "5h");
  assert.equal(QUOTA_TIER_LABELS.seven_day, "7d");
  assert.equal(Object.keys(QUOTA_TIER_LABELS).includes("month"), false);
  assert.equal(Object.keys(QUOTA_TIER_LABELS).includes("monthly"), false);
});

await test("GPT Chinese compact/panel tier labels keep real windows", () => {
  assert.equal(GPT_QUOTA_TIER_COMPACT_LABELS.five_hour, "5 小时");
  assert.equal(GPT_QUOTA_TIER_COMPACT_LABELS.seven_day, "周");
  assert.equal(GPT_QUOTA_TIER_PANEL_LABELS.five_hour, "5 小时额度");
  assert.equal(GPT_QUOTA_TIER_PANEL_LABELS.seven_day, "7 天额度");
  assert.equal(Object.keys(GPT_QUOTA_TIER_COMPACT_LABELS).includes("month"), false);
  assert.equal(Object.keys(GPT_QUOTA_TIER_PANEL_LABELS).includes("monthly"), false);
});

await test("knownQuotaTiers filters only five_hour/seven_day", () => {
  const tiers = knownQuotaTiers([
    { name: "five_hour", utilization: 10, resetsAt: null },
    { name: "seven_day", utilization: 20, resetsAt: null },
    { name: "month", utilization: 99, resetsAt: null },
    { name: "unknown", utilization: 1, resetsAt: null },
  ]);
  assert.deepEqual(tiers.map((tier) => tier.name), ["five_hour", "seven_day"]);
});

await test("formatQuotaQueriedAt remains English for Models consumers", () => {
  assert.equal(formatQuotaQueriedAt(null), "never");
  assert.equal(formatQuotaQueriedAt(Date.now() - 1_000), "just now");
  assert.match(formatQuotaQueriedAt(Date.now() - 120_000), /m ago$/);
});

await test("formatGptQuotaRelativeAge returns Chinese ages", () => {
  assert.equal(formatGptQuotaRelativeAge(null), null);
  assert.equal(formatGptQuotaRelativeAge(undefined), null);
  assert.equal(formatGptQuotaRelativeAge(0), null);
  assert.equal(formatGptQuotaRelativeAge(Date.now() - 1_000), "刚刚");
  assert.match(formatGptQuotaRelativeAge(Date.now() - 15_000) ?? "", /秒$/);
  assert.match(formatGptQuotaRelativeAge(Date.now() - 5 * 60_000) ?? "", /分钟$/);
  assert.match(formatGptQuotaRelativeAge(Date.now() - 3 * 3_600_000) ?? "", /小时$/);
  assert.match(formatGptQuotaRelativeAge(Date.now() - 2 * 86_400_000) ?? "", /天$/);
});

await test("formatGptResetCountdown is Chinese while English helper stays intact", () => {
  const inTwoHours = new Date(Date.now() + 2 * 3_600_000 + 15 * 60_000).toISOString();
  const chinese = formatGptResetCountdown(inTwoHours);
  const english = formatResetCountdown(inTwoHours);
  assert.match(chinese ?? "", /小时/);
  assert.match(chinese ?? "", /分/);
  assert.doesNotMatch(chinese ?? "", /h |m$/);
  assert.match(english ?? "", /h /);
  assert.equal(formatGptResetCountdown(null), null);
  assert.equal(formatGptResetCountdown("not-a-date"), null);
});

await test("ChatGptUsagePanel source contract: shell, cache sources, safety, APIs", () => {
  const panel = read("components/ChatGptUsagePanel.tsx");
  const appShell = read("components/AppShell.tsx");
  const globals = read("app/globals.css");
  const config = read("lib/pi-web-config.ts");

  // Prop + AppShell wiring
  assert.match(panel, /onOpenModels\?: \(\) => void/);
  assert.match(panel, /onOpenModels\?\.\(\)/);
  assert.match(appShell, /ChatGptUsagePanelHost onOpenModels=\{\(\) => setModelsConfigOpen\(true\)\}/);
  assert.match(appShell, /showChatGptUsage &&/);
  assert.match(appShell, /showGrokUsage &&/);
  assert.match(appShell, /app-top-usage-panel/);
  assert.match(appShell, /showAnyProviderUsage \? 12 : rightPanelTogglePadding/);

  // Real windows only — no monthly forgery for GPT
  assert.match(panel, /5 小时/);
  assert.match(panel, /7 天额度/);
  assert.doesNotMatch(panel, /月度额度|Monthly|month_window|monthlyQuota/);
  assert.doesNotMatch(panel, /GrokQuotaResultV1|from ["'].*GrokQuotaView|from ["'].*GrokUsagePanel/);

  // Cache sources: live / cached / page_fallback / none — not Grok fresh/stale TTL
  assert.match(panel, /type ChatGptQuotaSource = "live" \| "cached" \| "page_fallback" \| "none"/);
  assert.match(panel, /pageSnapshotsRef/);
  assert.match(panel, /刷新失败，正在展示本页上次成功数据/);
  assert.match(panel, /已缓存/);
  assert.match(panel, /实时/);
  assert.match(panel, /无缓存/);
  assert.doesNotMatch(panel, /缓存新鲜|缓存已过期|"fresh"|"stale"/);

  // Request policy: 30s accounts metadata only; quota GET on manual/activate
  assert.match(panel, /ACCOUNT_CACHE_POLL_INTERVAL_MS = 30_000/);
  assert.match(panel, /document\.hidden/);
  assert.match(panel, /\/api\/auth\/accounts\/\$\{encodeURIComponent\(GPT_PROVIDER_ID\)\}/);
  assert.match(panel, /\/api\/auth\/quota\/\$\{encodeURIComponent\(GPT_PROVIDER_ID\)\}/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /accountsRequestGen|quotaRequestGen/);
  assert.match(panel, /URLSearchParams\(\{ accountId \}\)/);

  // Fixed viewport clamp + a11y
  assert.match(panel, /Math\.min\(392,/);
  assert.match(panel, /min\(392px, calc\(100vw - 16px\)\)/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /aria-controls=\{panelDomId\}/);
  assert.match(panel, /role="progressbar"/);
  assert.match(panel, /Escape/);
  assert.match(panel, /triggerRef\.current\?\.focus\(\)/);

  // Credential + operation safety allowlist (fixed Chinese; no raw server fields rendered)
  assert.match(panel, /登录已失效，需要重新登录/);
  assert.match(panel, /未找到 OAuth 凭据/);
  assert.match(panel, /无法读取 OAuth 凭据/);
  assert.match(panel, /无法加载 ChatGPT 账号列表，请稍后重试/);
  assert.match(panel, /账号已切换，额度刷新失败/);
  assert.match(panel, /切换 Active 账号失败，已保留当前账号/);
  assert.match(panel, /Reset credits 消耗失败，未更新当前额度/);
  assert.match(panel, /最近一次后台刷新失败/);
  assert.match(panel, /最近一次账号刷新失败/);
  // Types may declare these fields, but JSX/expression interpolation of the raw values is forbidden.
  assert.doesNotMatch(panel, /\{\s*[A-Za-z0-9_$.?]+credentialMessage\s*\}/);
  assert.doesNotMatch(panel, /\{\s*[A-Za-z0-9_$.?]*quotaCache\.error\s*\}/);
  assert.doesNotMatch(panel, /\{\s*[A-Za-z0-9_$.?]*\.error\s*\}/);
  assert.doesNotMatch(panel, /\{\s*schedulerStatus\.lastError\s*\}/);
  assert.doesNotMatch(panel, /\{\s*schedulerStatus\.lastAccountError\s*\}/);
  assert.doesNotMatch(panel, /\{\s*[A-Za-z0-9_$.?]*lock\.path\s*\}/);
  // Scheduler errors project through SAFE_MESSAGES only
  assert.match(panel, /SAFE_MESSAGES\.schedulerLastError/);
  assert.match(panel, /SAFE_MESSAGES\.schedulerAccountError/);
  assert.match(panel, /schedulerStatus\.lastError &&/);
  assert.match(panel, /schedulerStatus\.lastAccountError &&/);

  // GPT-only secondary tools retained
  assert.match(panel, /Reset credits/);
  assert.match(panel, /usage-refresh\/status/);
  assert.match(panel, /usage-refresh\/repair-lock/);
  assert.match(panel, /confirm:\s*true/);
  assert.match(panel, /GPT 专属工具/);
  assert.match(panel, /后台自动刷新/);
  assert.match(panel, /修复刷新锁/);

  // Config default + CSS reduced-motion/focus scoped under .chatgpt-usage-panel
  assert.match(config, /usagePanelEnabled:\s*false/);
  assert.match(config, /"chatgpt\.usagePanelEnabled"/);
  assert.match(globals, /\.chatgpt-usage-panel__spinner/);
  assert.match(globals, /\.chatgpt-usage-panel__trigger:focus-visible/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.chatgpt-usage-panel__spinner/);
});

await test("Grok panel still owns fresh/stale and has no GPT Reset/scheduler", () => {
  const grokPanel = read("components/GrokUsagePanel.tsx");
  const grokView = read("components/GrokQuotaView.tsx");
  assert.match(grokView, /fresh:\s*"缓存新鲜"/);
  assert.match(grokView, /stale:\s*"缓存已过期"/);
  assert.doesNotMatch(grokPanel, /reset credit|scheduler|warmup|repair-lock/i);
  assert.doesNotMatch(grokView, /reset credit|scheduler|warmup|repair-lock/i);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll chatgpt usage panel checks passed.");
