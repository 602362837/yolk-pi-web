#!/usr/bin/env node
/**
 * Grok usage panel config + presentational helper checks.
 *
 * Covers:
 * - grok.usagePanelEnabled default false
 * - missing-field normalize compatibility via read/write patch merge
 * - strict validate rejects non-boolean usagePanelEnabled
 * - partial grok patch preserves autoFailover
 * - shared Chinese labels and consumer wiring in source
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-grok-usage-panel-config.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-usage-panel-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

try {
  const {
    DEFAULT_PI_WEB_CONFIG,
    PiWebConfigValidationError,
    readPiWebConfig,
    validatePiWebGrokConfig,
    writePiWebConfigPatch,
  } = await import("../lib/pi-web-config.ts");

  await test("DEFAULT grok.usagePanelEnabled is false", () => {
    assert.equal(DEFAULT_PI_WEB_CONFIG.grok.usagePanelEnabled, false);
    assert.equal(DEFAULT_PI_WEB_CONFIG.grok.autoFailover.enabled, false);
  });

  await test("missing usagePanelEnabled normalizes to false on read", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        grok: {
          autoFailover: {
            enabled: true,
            maxAttemptsPerTurn: 1,
            maxAccountSwitchesPerTurn: 1,
            quotaCacheMaxAgeMs: 300000,
            exhaustedCooldownMs: 1800000,
            minSwitchIntervalMs: 10000,
          },
        },
      }),
      "utf8",
    );
    const config = readPiWebConfig();
    assert.equal(config.grok.usagePanelEnabled, false);
    assert.equal(config.grok.autoFailover.enabled, true);
  });

  await test("validate rejects non-boolean usagePanelEnabled", () => {
    assert.throws(
      () => validatePiWebGrokConfig({
        usagePanelEnabled: "yes",
        autoFailover: DEFAULT_PI_WEB_CONFIG.grok.autoFailover,
      }),
      (error) => error instanceof PiWebConfigValidationError
        && String(error.message).includes("grok.usagePanelEnabled"),
    );
  });

  await test("partial usagePanelEnabled patch preserves autoFailover", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        grok: {
          usagePanelEnabled: false,
          autoFailover: {
            enabled: true,
            maxAttemptsPerTurn: 1,
            maxAccountSwitchesPerTurn: 1,
            quotaCacheMaxAgeMs: 300000,
            exhaustedCooldownMs: 1800000,
            minSwitchIntervalMs: 10000,
          },
        },
      }),
      "utf8",
    );

    const result = writePiWebConfigPatch({
      grok: { usagePanelEnabled: true },
    });
    assert.equal(result.config.grok.usagePanelEnabled, true);
    assert.equal(result.config.grok.autoFailover.enabled, true);
    assert.equal(result.config.grok.autoFailover.maxAttemptsPerTurn, 1);
  });

  await test("shared Chinese cache/error helpers stay allowlisted", () => {
    const view = read("components/GrokQuotaView.tsx");
    assert.match(view, /live:\s*"实时"/);
    assert.match(view, /fresh:\s*"缓存新鲜"/);
    assert.match(view, /stale:\s*"缓存已过期"/);
    assert.match(view, /none:\s*"无缓存"/);
    assert.match(view, /export function grokQuotaErrorMessage/);
    assert.match(view, /Grok 登录已失效，需要重新登录/);
    assert.match(view, /无法连接额度服务，正在展示上次成功数据/);
    assert.match(view, /额度服务暂时限流/);
    assert.match(view, /当前 API 未提供周额度/);
    assert.match(view, /role="progressbar"/);
    assert.doesNotMatch(view, /reset credit|scheduler|warmup/i);
  });

  await test("module graph references expected consumers", () => {
    const appShell = read("components/AppShell.tsx");
    const settings = read("components/SettingsConfig.tsx");
    const models = read("components/ModelsConfig.tsx");
    const panel = read("components/GrokUsagePanel.tsx");
    const globals = read("app/globals.css");
    const config = read("lib/pi-web-config.ts");

    assert.match(config, /usagePanelEnabled:\s*false/);
    assert.match(config, /"grok\.usagePanelEnabled"/);
    assert.match(appShell, /showGrokUsage/);
    assert.match(appShell, /GrokUsagePanel/);
    assert.match(appShell, /app-top-usage-panel/);
    assert.match(appShell, /showAnyProviderUsage \? 12 : rightPanelTogglePadding/);
    assert.match(settings, /Grok 用量悬浮面板/);
    assert.match(settings, /usagePanelEnabled/);
    assert.match(models, /from "\.\/GrokQuotaView"/);
    assert.match(panel, /params\.set\("refresh", "1"\)/);
    assert.match(panel, /正在切换…/);
    assert.match(panel, /设为 Active/);
    assert.match(panel, /缓存已过期/);
    assert.match(panel, /额度暂不可用/);
    assert.doesNotMatch(panel, /cache 已过期/);
    assert.doesNotMatch(panel, /quota 暂不可用/);
    assert.doesNotMatch(panel, /reset credit|scheduler|warmup/i);
    assert.match(globals, /\.app-top-usage-panel\s*\{[\s\S]*padding-right:\s*84px/i);
  });

  const {
    buildGrokUsageAggregateProjection,
    buildGrokUsageRingUnit,
  } = await import("../components/GrokUsageProjection.ts");
  const {
    formatRingCenterValue,
    isValidRingUnitCenter,
    PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS,
  } = await import("../components/ProviderUsagePanelContract.ts");

  const monthly = {
    limit: 1000,
    used: 730,
    remaining: 270,
    utilization: 73,
    resetsAt: "2026-08-01T00:00:00.000Z",
  };
  const weekly = {
    usedPercent: 51,
    resetsAt: "2026-07-20T00:00:00.000Z",
  };

  await test("Grok dual windows: outer week / inner month, center is week not month", () => {
    const unit = buildGrokUsageRingUnit({
      hasAccount: true,
      monthly,
      weekly,
      cacheState: "live",
    });
    assert.ok(unit);
    assert.equal(unit.layers.length, 2);
    // Shared projector: short→long regardless of adapter field order.
    assert.equal(unit.layers[0].id, "grok-week");
    assert.equal(unit.layers[0].shortLabel, "7d");
    assert.equal(unit.layers[0].percent, 51);
    assert.equal(unit.layers[1].id, "grok-month");
    assert.equal(unit.layers[1].shortLabel, "月");
    assert.equal(unit.layers[1].percent, 73);
    assert.equal(unit.centerLayerId, "grok-week");
    assert.notEqual(unit.centerLayerId, "grok-month");
    assert.equal(isValidRingUnitCenter(unit), true);
    assert.match(unit.ariaLabel, /中心为外圈优先层 7d 51%/);
    assert.doesNotMatch(unit.ariaLabel, /中心为外圈优先层 月/);
    assert.equal(formatRingCenterValue(unit.layers[0].percent), "51%");
  });

  await test("Grok week unknown keeps outer week layer and does not borrow month percent", () => {
    const unit = buildGrokUsageRingUnit({
      hasAccount: true,
      monthly,
      weekly: { usedPercent: Number.NaN, resetsAt: weekly.resetsAt },
      cacheState: "fresh",
    });
    assert.ok(unit);
    assert.equal(unit.layers.length, 2);
    assert.equal(unit.centerLayerId, "grok-week");
    assert.equal(unit.layers[0].id, "grok-week");
    assert.equal(unit.layers[0].percent, null);
    assert.equal(unit.layers[1].percent, 73);
    assert.equal(formatRingCenterValue(unit.layers[0].percent), "—");
    assert.notEqual(formatRingCenterValue(unit.layers[0].percent), "73%");
    assert.match(unit.ariaLabel, /中心为外圈优先层 7d —/);
  });

  await test("Grok only-month / only-week single-layer centers match the available window", () => {
    const onlyMonth = buildGrokUsageRingUnit({
      hasAccount: true,
      monthly,
      weekly: null,
      cacheState: "live",
    });
    assert.ok(onlyMonth);
    assert.equal(onlyMonth.layers.length, 1);
    assert.equal(onlyMonth.centerLayerId, "grok-month");
    assert.equal(onlyMonth.layers[0].shortLabel, "月");

    const onlyWeek = buildGrokUsageRingUnit({
      hasAccount: true,
      monthly: null,
      weekly,
      cacheState: "live",
    });
    assert.ok(onlyWeek);
    assert.equal(onlyWeek.layers.length, 1);
    assert.equal(onlyWeek.centerLayerId, "grok-week");
    assert.equal(onlyWeek.layers[0].shortLabel, "7d");

    // Candidate builder emits only present windows; projector decides radial order.
    // Month-first input still projects week outer when both exist.
    const dualFromMonthFirst = buildGrokUsageRingUnit({
      hasAccount: true,
      monthly,
      weekly,
      cacheState: "live",
    });
    assert.deepEqual(dualFromMonthFirst.layers.map((layer) => layer.id), ["grok-week", "grok-month"]);
    assert.equal(dualFromMonthFirst.centerLayerId, "grok-week");
  });

  await test("Grok stale trusted values keep layers with warning risk; reauth without quota uses fallback", () => {
    const staleProjection = buildGrokUsageAggregateProjection({
      hasAccount: true,
      accountsLoading: false,
      accountsError: null,
      refreshing: false,
      quotaLoading: false,
      quota: {
        kind: "grok_subscription_quota",
        schemaVersion: 1,
        success: true,
        provider: "grok-cli",
        accountId: "acct-secret-should-not-leak",
        monthly,
        weekly,
        cache: { state: "stale", queriedAt: "2026-07-16T00:00:00.000Z", ageMs: 999_999 },
        reauthRequired: false,
      },
    });
    assert.equal(staleProjection.risk, "warning");
    assert.ok(staleProjection.ringUnit);
    assert.equal(staleProjection.ringUnit.centerLayerId, "grok-week");
    assert.match(staleProjection.ringUnit.layers[0].title, /缓存已过期/);
    assert.match(staleProjection.title, /缓存已过期/);
    assert.equal(staleProjection.fallback, null);

    const reauthProjection = buildGrokUsageAggregateProjection({
      hasAccount: true,
      accountsLoading: false,
      accountsError: null,
      refreshing: false,
      quotaLoading: false,
      quota: {
        kind: "grok_subscription_quota",
        schemaVersion: 1,
        success: false,
        provider: "grok-cli",
        accountId: "acct-secret-should-not-leak",
        cache: { state: "none", queriedAt: null, ageMs: null },
        reauthRequired: true,
        error: { code: "unauthorized", message: "token dead raw path /secret", retryable: false },
      },
    });
    assert.equal(reauthProjection.ringUnit, null);
    assert.equal(reauthProjection.fallback, "需登录");
    assert.equal(reauthProjection.risk, "danger");

    const serialized = JSON.stringify(staleProjection) + JSON.stringify(reauthProjection);
    for (const field of PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS) {
      assert.doesNotMatch(serialized, new RegExp(field));
    }
    assert.doesNotMatch(serialized, /acct-secret-should-not-leak/);
    assert.doesNotMatch(serialized, /token dead raw path/);
  });

  await test("Grok panel source: ringUnit path, aggregate presentation, no text summary chips", () => {
    const panel = read("components/GrokUsagePanel.tsx");
    const projection = read("components/GrokUsageProjection.ts");
    assert.match(projection, /export function buildGrokUsageRingUnit/);
    assert.match(projection, /export function buildGrokUsageWindowCandidates/);
    assert.match(projection, /export function buildGrokUsageAggregateProjection/);
    assert.match(projection, /projectProviderUsageWindows/);
    assert.match(projection, /id: "grok-month"/);
    assert.match(projection, /id: "grok-week"/);
    assert.match(projection, /durationEvidence: "weekly"/);
    assert.match(projection, /durationEvidence: "monthly"/);
    // Adapter must not assign center or fixed week→month layer order.
    assert.doesNotMatch(projection, /centerLayerId\s*=\s*["']grok-/);
    assert.doesNotMatch(projection, /layers\.push\([\s\S]*layers\.push/);
    assert.match(panel, /from "\.\/GrokUsageProjection"/);
    assert.match(panel, /buildGrokUsageRingUnit|buildGrokUsageAggregateProjection/);
    assert.match(panel, /presentationMode\?: GrokUsagePresentationMode/);
    assert.match(panel, /presentationMode = "standalone"/);
    assert.match(panel, /presentationMode === "aggregate"/);
    assert.match(panel, /ringUnit=\{aggregateProjection\.ringUnit\}/);
    assert.match(panel, /onProjectionChange/);
    // Standalone still click-toggles its own dialog.
    assert.match(panel, /setOpen/);
    // Compact/full normal quota no longer uses text summary chips.
    assert.doesNotMatch(panel, /compactSummaries/);
    assert.doesNotMatch(panel, /ProviderUsageCompactSummary/);
    assert.doesNotMatch(panel, /ProviderUsageRingItem/);
    // Forbidden secrets must not be rendered as projection fields.
    assert.doesNotMatch(panel, /profileArn|clientSecret|access_token|refresh_token/);
    assert.doesNotMatch(projection, /profileArn|clientSecret|access_token|refresh_token/);
  });
} finally {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  await rm(agentDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll grok usage panel config checks passed.");
