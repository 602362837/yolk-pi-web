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
