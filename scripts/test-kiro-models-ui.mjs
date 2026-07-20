#!/usr/bin/env node
/**
 * kiro-models-ui — Models OAuth multi-account + KiroQuotaView contract tests
 *
 * Source-level checks for KIRO-06:
 * - provider-capability OAuth UI (not a cloned Grok-only tree)
 * - Builder ID / Google / GitHub method picker + SSE select auto-answer
 * - Active-first accounts, protected delete, no secrets/raw error projection
 * - KiroQuotaView bucket/cache/reauth/unavailable presentation
 *
 * Run: npm run test:kiro-models-ui
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

console.log("\nkiro-models-ui contract checks\n");

const models = read("components/ModelsConfig.tsx");
const kiroView = read("components/KiroQuotaView.tsx");
const packageJson = read("package.json");

test("package.json exposes test:kiro-models-ui", () => {
  assert.match(packageJson, /"test:kiro-models-ui"\s*:/);
});

test("ModelsConfig imports KiroQuotaView and registers kiro icon", () => {
  assert.match(models, /from "\.\/KiroQuotaView"/);
  assert.match(models, /"kiro"\s*:\s*\{\s*Icon:\s*AwsColorIcon/);
});

test("OAuthDetail uses provider capabilities rather than Grok-only hard branches for shared UI", () => {
  assert.match(models, /const isKiro = provider\.id === "kiro"/);
  assert.match(models, /supportsGlobalActiveSemantics/);
  assert.match(models, /supportsOAuthMethodPicker/);
  assert.match(models, /supportsProtectedDelete/);
  assert.match(models, /hideCodexQuotaSummary/);
  assert.match(models, /ManagedOAuthDeleteConfirmDialog/);
  // Shared delete dialog should not stay Grok-named only
  assert.doesNotMatch(models, /function GrokDeleteConfirmDialog/);
});

test("Kiro login methods expose Builder ID / Google / GitHub", () => {
  assert.match(models, /handleKiroLoginMethod/);
  assert.match(models, /"builder-id"/);
  assert.match(models, /"google"/);
  assert.match(models, /"github"/);
  assert.match(models, /AWS Builder ID/);
  assert.match(models, /Google/);
  assert.match(models, /GitHub/);
  assert.match(models, /preferredKiroMethodRef/);
  assert.match(models, /select_request/);
  assert.match(models, /➕ 添加 Kiro 账号/);
});

test("Kiro Active semantics and protected delete copy are present", () => {
  assert.match(models, /「启用」只设置 Kiro 的/);
  assert.match(models, /全局当前账号/);
  assert.match(models, /进行中的请求不会更换 Token/);
  assert.match(models, /providerLabel=\{isAntigravity \? "Antigravity" : isKiro \? "Kiro" : "Grok"\}/);
  assert.match(models, /自动切号并删除/);
});

test("Kiro quota loader uses force refresh and accountId query", () => {
  assert.match(models, /const loadKiroQuota = useCallback/);
  assert.match(models, /\/api\/auth\/quota\/\$\{encodeURIComponent\(provider\.id\)\}/);
  assert.match(models, /refresh=1/);
  assert.match(models, /setKiroQuota/);
  assert.match(models, /<KiroQuotaView/);
  assert.match(models, /🔄 刷新当前 Kiro 额度/);
});

test("Models UI forbids import/reset-credit/secret projection for Kiro", () => {
  assert.match(models, /不支持 JSON 凭据导入/);
  assert.match(models, /access \/ refresh \/ clientSecret \/ profileArn 不会出现在浏览器/);
  // Kiro branch must not render Codex reset credits
  assert.doesNotMatch(models, /isKiro[\s\S]{0,200}Reset credits/);
  assert.doesNotMatch(models, /supportsCredentialImport\s*=\s*true/);
  // No raw profile ARN display helpers in Models OAuthDetail
  assert.doesNotMatch(models, /profileArn\s*[:=]/);
});

test("KiroQuotaView is pure presentational with allowlisted states", () => {
  assert.match(kiroView, /export function KiroQuotaView/);
  assert.match(kiroView, /export function kiroQuotaErrorMessage/);
  assert.match(kiroView, /GetUsageLimits/);
  assert.match(kiroView, /live:\s*"实时"/);
  assert.match(kiroView, /fresh:\s*"缓存新鲜"/);
  assert.match(kiroView, /stale:\s*"缓存已过期"/);
  assert.match(kiroView, /none:\s*"无缓存"/);
  assert.match(kiroView, /Kiro 登录已失效，需要重新登录/);
  assert.match(kiroView, /unsupported_region/);
  assert.match(kiroView, /额度暂不可用/);
  assert.match(kiroView, /role="progressbar"/);
  assert.match(kiroView, /主额度/);
  assert.match(kiroView, /剩余 \{formatAmount\(bucket\.remaining\)\}/);
  assert.doesNotMatch(kiroView, /reset credit|scheduler|warmup/i);
  assert.doesNotMatch(kiroView, /profileArn|clientSecret|access_token|refresh_token/i);
  assert.doesNotMatch(kiroView, /fetch\(/);
});

test("KiroQuotaView never invents 0% for unknown values", () => {
  assert.match(kiroView, /return "未知"/);
  assert.match(kiroView, /utilization === null \? "0%" : `\$\{Math\.min/);
  assert.match(kiroView, /不会把未知数值显示为 0%/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\nAll kiro-models-ui checks passed (${passed}).`);
