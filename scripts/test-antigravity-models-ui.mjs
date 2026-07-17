#!/usr/bin/env node
/**
 * antigravity-models-ui — Models OAuth multi-account + AntigravityQuotaView contract tests
 *
 * Source-level checks for AG-06 + IMP-001 AG-G04:
 * - capability-driven managed OAuth UI for google-antigravity
 * - single Google OAuth add path (no JSON import)
 * - non-official / wide-scope risk disclosure
 * - Active semantics, protected delete, reauth recovery
 * - grouped quota board (shared groupBy helpers; conservative headers)
 * - no cross-model totals; no Flash/Opus concentric dual-layer construction
 * - AbortController + generation + accountId race guards
 * - privacy: no projectId/token/raw body projection in DOM helpers
 *
 * Run: npm run test:antigravity-models-ui
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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

console.log("\nantigravity-models-ui contract checks\n");

const models = read("components/ModelsConfig.tsx");
const antigravityView = read("components/AntigravityQuotaView.tsx");
const packageJson = read("package.json");
const groupsHelper = read("lib/antigravity-quota-groups.ts");

test("package.json exposes test:antigravity-models-ui", () => {
  assert.match(packageJson, /"test:antigravity-models-ui"\s*:/);
});

test("ModelsConfig imports AntigravityQuotaView and registers google-antigravity icon", () => {
  assert.match(models, /from "\.\/AntigravityQuotaView"/);
  assert.match(models, /"google-antigravity"\s*:\s*\{\s*Icon:\s*GoogleColorIcon/);
});

test("OAuthDetail uses provider capabilities including Antigravity for shared UI", () => {
  assert.match(models, /const isAntigravity = provider\.id === "google-antigravity"/);
  assert.match(models, /supportsGlobalActiveSemantics = isGrok \|\| isKiro \|\| isAntigravity/);
  assert.match(models, /supportsProtectedDelete = isGrok \|\| isKiro \|\| isAntigravity/);
  assert.match(models, /hideCodexQuotaSummary = isGrok \|\| isKiro \|\| isAntigravity/);
  assert.match(models, /ManagedOAuthDeleteConfirmDialog/);
  assert.match(models, /providerLabel=\{isAntigravity \? "Antigravity" : isKiro \? "Kiro" : "Grok"\}/);
});

test("Antigravity login is single OAuth add path without JSON import UI", () => {
  assert.match(models, /➕ 添加 Antigravity 账号 \(OAuth 登录\)/);
  assert.match(models, /handleLogin\("add"\)/);
  assert.match(models, /不支持 Credential JSON 导入/);
  assert.match(models, /localhost:51121\/oauth-callback/);
  // Antigravity must not open the Codex method/json import dialog path
  assert.doesNotMatch(models, /isAntigravity[\s\S]{0,120}setAddAccountDialogView\("json"\)/);
  assert.doesNotMatch(models, /isAntigravity[\s\S]{0,200}supportsCredentialImport\s*=\s*true/);
});

test("Antigravity risk disclosure covers non-official channel and wide cloud-platform scope", () => {
  assert.match(models, /安全与非官方通道提示 \(Antigravity Scope\)/);
  assert.match(models, /非官方 Google Cloud Code 通道/);
  assert.match(models, /cloud-platform \(GCP 完整资源读写\)/);
  assert.match(models, /client_secret、token 凭证或 projectId/);
});

test("Antigravity Active semantics and protected delete copy are present", () => {
  assert.match(models, /Activate 只设置 Antigravity 的/);
  assert.match(models, /全局当前 Active/);
  assert.match(models, /in-flight 请求不会中途更换 token/);
  assert.match(models, /fail-closed/);
  assert.match(models, /已连接 \$\{accounts\.length\} 个 Antigravity 账号/);
});

test("Antigravity quota loader uses force refresh, accountId, AbortController and generation guards", () => {
  assert.match(models, /const loadAntigravityQuota = useCallback/);
  assert.match(models, /antigravityQuotaAbortRef/);
  assert.match(models, /antigravityQuotaGenerationRef/);
  assert.match(models, /new AbortController\(\)/);
  assert.match(models, /generation !== antigravityQuotaGenerationRef\.current/);
  assert.match(models, /data\.accountId !== quotaAccountId/);
  assert.match(models, /setAntigravityQuota\(null\)/);
  assert.match(models, /refresh=1/);
  assert.match(models, /\/api\/auth\/quota\/\$\{encodeURIComponent\(provider\.id\)\}/);
  assert.match(models, /<AntigravityQuotaView/);
  assert.match(models, /🔄 刷新当前 Antigravity 额度/);
});

test("Models UI forbids secret projection and cross-model total fabrication for Antigravity", () => {
  // Extract Antigravity-oriented OAuthDetail slices for privacy assertions.
  // Codex JSON import may still mention access_token elsewhere in the file.
  const antigravitySlices = [
    models.slice(models.indexOf("const isAntigravity = provider.id === \"google-antigravity\"")),
    models.includes("安全与非官方通道提示")
      ? models.slice(models.indexOf("安全与非官方通道提示"), models.indexOf("安全与非官方通道提示") + 800)
      : "",
  ].join("\n");
  assert.doesNotMatch(antigravitySlices, /\bprojectId\s*[:=]/);
  assert.doesNotMatch(antigravitySlices, /\baccess_token\b|\brefresh_token\b/i);
  assert.doesNotMatch(models, /isAntigravity[\s\S]{0,200}setAddAccountDialogView\("json"\)/);
  assert.doesNotMatch(models, /跨模型总|average.*quota|total.*remainingFraction/i);
  // Prefer fixed codes when refreshing Antigravity quota
  assert.match(models, /invalid_project/);
  assert.match(models, /Antigravity 登录已失效，需要重新登录/);
  // Risk copy must say secrets/projectId are never collected
  assert.match(models, /不会收集或上报您的 client_secret、token 凭证或 projectId/);
});

test("AntigravityQuotaView is pure presentational with allowlisted per-model states", () => {
  assert.match(antigravityView, /export function AntigravityQuotaView/);
  assert.match(antigravityView, /export function antigravityQuotaErrorMessage/);
  assert.match(antigravityView, /fetchAvailableModels/);
  assert.match(antigravityView, /live:\s*"实时"/);
  assert.match(antigravityView, /fresh:\s*"缓存新鲜"/);
  assert.match(antigravityView, /stale:\s*"缓存已过期"/);
  assert.match(antigravityView, /none:\s*"无缓存"/);
  assert.match(antigravityView, /Antigravity 登录已失效，需要重新登录/);
  assert.match(antigravityView, /invalid_project/);
  assert.match(antigravityView, /access_denied/);
  assert.match(antigravityView, /role="progressbar"/);
  assert.match(antigravityView, /使用率/);
  assert.match(antigravityView, /剩余/);
  assert.match(antigravityView, /安全重置时间/);
  assert.match(antigravityView, /不求和、不平均/);
  assert.doesNotMatch(antigravityView, /reset credit|scheduler|warmup/i);
  // Comments may mention projectId as a forbidden field; no assignments/rendering of secrets.
  assert.doesNotMatch(antigravityView, /\bprojectId\s*[:=]/);
  assert.doesNotMatch(antigravityView, /\baccess_token\b|\brefresh_token\b|\bclient_secret\b/i);
  assert.doesNotMatch(antigravityView, /fetch\(/);
  // UI copy may say "不会伪造跨模型总额度"; ensure no actual aggregation helpers.
  assert.doesNotMatch(antigravityView, /\baverage\s*\(|reduce\s*\(|totalPercent|usedPercentSum/i);
});

test("AntigravityQuotaView never invents 0% for unknown values or totals", () => {
  assert.match(antigravityView, /return "未知"/);
  assert.match(antigravityView, /不会把未知数值显示为 0%/);
  assert.match(antigravityView, /也不会伪造跨模型总额度/);
  assert.match(antigravityView, /used === null \? "0%" : `\$\{Math\.min/);
  assert.match(antigravityView, /aria-valuenow=\{used === null \? undefined/);
});

test("AntigravityQuotaView reuses shared groupBy helpers (no second mapping table)", () => {
  assert.match(antigravityView, /from "@\/lib\/antigravity-quota-groups"/);
  assert.match(antigravityView, /groupByAntigravityQuotaWindows/);
  // Must not redeclare a local quotaKey→group table.
  assert.doesNotMatch(antigravityView, /QUOTA_KEY_TO_GROUP|quotaKeyToGroup|GROUP_MAP\s*=/);
  assert.doesNotMatch(antigravityView, /ANTIGRAVITY_QUOTA_KEY_TO_GROUP/);
  // Shared helper owns the fixed table.
  assert.match(groupsHelper, /export const ANTIGRAVITY_QUOTA_KEY_TO_GROUP_0_3_0/);
  assert.match(groupsHelper, /export function groupByAntigravityQuotaWindows/);
});

test("AntigravityQuotaView renders grouped accordion with conservative headers", () => {
  assert.match(antigravityView, /className="antigravity-quota-groups"/);
  assert.match(antigravityView, /className="antigravity-quota-group"/);
  assert.match(antigravityView, /className="antigravity-quota-group-summary"/);
  assert.match(antigravityView, /className="antigravity-quota-group-meta"/);
  assert.match(antigravityView, /className="antigravity-quota-group-variants"/);
  assert.match(antigravityView, /className="antigravity-quota-group-variant"/);
  assert.match(antigravityView, /data-group-id=\{group\.groupId\}/);
  assert.match(antigravityView, /data-variant-id=\{variant\.id\}/);
  assert.match(antigravityView, /<details/);
  assert.match(antigravityView, /<summary/);
  // Default collapsed: no defaultOpen / open={true} on group details.
  assert.doesNotMatch(antigravityView, /<details[^>]*(defaultOpen|open=\{true\})/);
  assert.match(antigravityView, /保守聚合/);
  assert.match(antigravityView, /组内变体取最紧额度|组内取最紧额度/);
  assert.match(antigravityView, /已用 \{formatPercent\(used\)\}/);
  assert.match(antigravityView, /group\.variants\.map/);
  // Flat models.map board is gone; group-first only.
  assert.doesNotMatch(antigravityView, /models\.map\s*\(/);
});

test("AntigravityQuotaView forbids Flash/Opus concentric dual-layer construction", () => {
  // Models board is accordion groups, not a shared N-ring packing Flash+Opus layers.
  assert.doesNotMatch(
    antigravityView,
    /createProviderUsageRingUnit|layers:\s*\[\s*[^\]]*flash[^\]]*opus/i,
  );
  assert.doesNotMatch(antigravityView, /outer\s*[:=].*Flash|inner\s*[:=].*Opus/i);
  assert.doesNotMatch(antigravityView, /durationMs|durationEvidence/);
  // resetTime must not be treated as duration evidence in this view.
  assert.match(antigravityView, /不把 reset 时间当作 duration/);
});

test("Unknown / empty quota still preserves account management path", () => {
  // Empty quota board must not block account management (copy + no throw helpers).
  assert.match(antigravityView, /额度暂不可用。账号管理与对话仍可继续使用/);
  assert.match(antigravityView, /!loading && !hasModels && !quota\?\.reauthRequired/);
  // Account badge still renders independently of models.
  assert.match(antigravityView, /account && \(/);
  assert.match(antigravityView, /account\.displayName/);
  assert.match(antigravityView, /account\.maskedAccountId/);
  // Error banners keep reauth / invalid_project / access_denied allowlist.
  assert.match(antigravityView, /quota\?\.reauthRequired/);
  assert.match(antigravityView, /isInvalidProject/);
  assert.match(antigravityView, /isAccessDenied/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\nAll antigravity-models-ui checks passed (${passed}).`);
