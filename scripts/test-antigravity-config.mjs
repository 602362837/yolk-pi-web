#!/usr/bin/env node
/**
 * Antigravity + global compact/aggregate usage config checks (AG-03).
 *
 * Covers:
 * - antigravity.usagePanelEnabled / antigravity.autoFailover defaults (off)
 * - Grok/Kiro-aligned budgets/cooldown/freshness defaults
 * - missing-field normalize compatibility on old pi-web.json
 * - strict validate rejects non-boolean flags
 * - partial antigravity/usage patches preserve unrelated fields
 * - Settings left-nav Antigravity section + Usage compact/aggregate copy
 *
 * Run:
 *   npm run test:antigravity-config
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
const agentDir = await mkdtemp(join(tmpdir(), "ypi-antigravity-config-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

try {
  const {
    DEFAULT_PI_WEB_CONFIG,
    PiWebConfigValidationError,
    readPiWebConfig,
    validatePiWebAntigravityConfig,
    validatePiWebUsageConfig,
    writePiWebConfigPatch,
  } = await import("../lib/pi-web-config.ts");

  await test("DEFAULT antigravity panel/failover are disabled with Grok/Kiro-aligned budgets", () => {
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.usagePanelEnabled, false);
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover.enabled, false);
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover.maxAttemptsPerTurn, 1);
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover.maxAccountSwitchesPerTurn, 1);
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover.quotaCacheMaxAgeMs, 5 * 60 * 1000);
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover.exhaustedCooldownMs, 30 * 60 * 1000);
    assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover.minSwitchIntervalMs, 10 * 1000);
  });

  await test("old pi-web.json without antigravity normalizes safely", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        usage: { includeArchived: false },
        grok: {
          usagePanelEnabled: true,
          autoFailover: {
            enabled: true,
            maxAttemptsPerTurn: 1,
            maxAccountSwitchesPerTurn: 1,
            quotaCacheMaxAgeMs: 300000,
            exhaustedCooldownMs: 1800000,
            minSwitchIntervalMs: 10000,
          },
        },
        kiro: {
          usagePanelEnabled: true,
          autoFailover: {
            enabled: false,
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
    assert.equal(config.usage.includeArchived, false);
    assert.equal(config.usage.providerPanelsCompact, false);
    assert.equal(config.usage.providerPanelsAggregated, false);
    assert.equal(config.antigravity.usagePanelEnabled, false);
    assert.equal(config.antigravity.autoFailover.enabled, false);
    assert.equal(config.grok.usagePanelEnabled, true);
    assert.equal(config.kiro.usagePanelEnabled, true);
  });

  await test("validate rejects non-boolean antigravity.usagePanelEnabled", () => {
    assert.throws(
      () => validatePiWebAntigravityConfig({
        usagePanelEnabled: "yes",
        autoFailover: DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover,
      }),
      (error) => error instanceof PiWebConfigValidationError
        && String(error.message).includes("antigravity.usagePanelEnabled"),
    );
  });

  await test("validate rejects non-boolean usage compact/aggregate", () => {
    assert.throws(
      () => validatePiWebUsageConfig({
        ...DEFAULT_PI_WEB_CONFIG.usage,
        providerPanelsCompact: "yes",
      }),
      (error) => error instanceof PiWebConfigValidationError
        && String(error.message).includes("usage.providerPanelsCompact"),
    );
    assert.throws(
      () => validatePiWebUsageConfig({
        ...DEFAULT_PI_WEB_CONFIG.usage,
        providerPanelsAggregated: "yes",
      }),
      (error) => error instanceof PiWebConfigValidationError
        && String(error.message).includes("usage.providerPanelsAggregated"),
    );
  });

  await test("partial antigravity usagePanelEnabled patch preserves autoFailover", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        antigravity: {
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
      antigravity: { usagePanelEnabled: true },
    });
    assert.equal(result.config.antigravity.usagePanelEnabled, true);
    assert.equal(result.config.antigravity.autoFailover.enabled, true);
    assert.equal(result.config.antigravity.autoFailover.maxAttemptsPerTurn, 1);
  });

  await test("partial antigravity patch preserves unrelated provider sections", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        usage: {
          includeArchived: false,
          providerPanelsCompact: true,
          providerPanelsAggregated: false,
        },
        chatgpt: { usagePanelEnabled: true },
        grok: { usagePanelEnabled: true },
        kiro: { usagePanelEnabled: true },
        antigravity: {
          usagePanelEnabled: false,
          autoFailover: DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover,
        },
      }),
      "utf8",
    );

    const result = writePiWebConfigPatch({
      antigravity: {
        usagePanelEnabled: true,
        autoFailover: {
          ...DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover,
          enabled: true,
        },
      },
    });
    assert.equal(result.config.antigravity.usagePanelEnabled, true);
    assert.equal(result.config.antigravity.autoFailover.enabled, true);
    assert.equal(result.config.usage.includeArchived, false);
    assert.equal(result.config.usage.providerPanelsCompact, true);
    assert.equal(result.config.chatgpt.usagePanelEnabled, true);
    assert.equal(result.config.grok.usagePanelEnabled, true);
    assert.equal(result.config.kiro.usagePanelEnabled, true);
  });

  await test("save/reload preserves antigravity and unrelated settings", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        usage: {
          includeArchived: true,
          providerPanelsCompact: false,
          providerPanelsAggregated: false,
        },
        chatgpt: { usagePanelEnabled: true },
        grok: { usagePanelEnabled: true },
        kiro: { usagePanelEnabled: false },
        antigravity: {
          usagePanelEnabled: false,
          autoFailover: DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover,
        },
      }),
      "utf8",
    );

    writePiWebConfigPatch({
      usage: {
        providerPanelsCompact: true,
        providerPanelsAggregated: true,
      },
      antigravity: {
        usagePanelEnabled: true,
        autoFailover: {
          ...DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover,
          enabled: true,
        },
      },
    });

    const reloaded = readPiWebConfig();
    assert.equal(reloaded.usage.providerPanelsCompact, true);
    assert.equal(reloaded.usage.providerPanelsAggregated, true);
    assert.equal(reloaded.usage.includeArchived, true);
    assert.equal(reloaded.antigravity.usagePanelEnabled, true);
    assert.equal(reloaded.antigravity.autoFailover.enabled, true);
    assert.equal(reloaded.chatgpt.usagePanelEnabled, true);
    assert.equal(reloaded.grok.usagePanelEnabled, true);
    assert.equal(reloaded.kiro.usagePanelEnabled, false);
  });

  await test("Settings places Antigravity as left-nav peer and expands Usage compact/aggregate copy", () => {
    const settings = read("components/SettingsConfig.tsx");
    const config = read("lib/pi-web-config.ts");
    const route = read("app/api/web-config/route.ts");

    assert.match(config, /antigravity:\s*\{[\s\S]*usagePanelEnabled:\s*false/);
    assert.match(config, /"antigravity\.usagePanelEnabled"/);
    assert.match(config, /"antigravity\.autoFailover\.enabled"/);
    assert.match(route, /antigravity\?: unknown/);

    assert.match(settings, /renderSectionButton\("antigravity", "Antigravity"/);
    assert.match(settings, /section === "antigravity"/);
    assert.match(settings, /显示 Antigravity 用量悬浮面板/);
    assert.match(settings, /明确限额或限流时自动切换可用账号/);
    assert.match(settings, /Model-aware|模型感知/);
    assert.match(settings, /fail-closed|Fail-closed/);
    assert.match(settings, /cloud-platform/);
    assert.match(settings, /updateAntigravity/);
    assert.match(settings, /GPT \/ Grok \/ Kiro \/ Antigravity/);
    assert.match(settings, /GPT、Grok、Kiro、Antigravity/);
    assert.match(settings, /kiro,\s*antigravity,\s*editor|antigravity,\s*editor/);

    // Compact/aggregate must live in the Usage section, not be duplicated under Antigravity.
    const usageSectionStart = settings.indexOf('section === "usage"');
    const antigravitySectionStart = settings.indexOf('section === "antigravity"');
    assert.ok(usageSectionStart > 0, "usage section missing");
    assert.ok(antigravitySectionStart > usageSectionStart, "antigravity section should follow usage section");
    const usageSection = settings.slice(usageSectionStart, antigravitySectionStart);
    const antigravitySection = settings.slice(
      antigravitySectionStart,
      settings.indexOf('section === "editor"', antigravitySectionStart),
    );
    assert.match(usageSection, /providerPanelsCompact/);
    assert.match(usageSection, /providerPanelsAggregated/);
    assert.match(usageSection, /模型用量组件聚合/);
    assert.match(usageSection, /Antigravity/);
    assert.doesNotMatch(antigravitySection, /providerPanelsCompact/);
    assert.doesNotMatch(antigravitySection, /providerPanelsAggregated/);
    assert.match(antigravitySection, /显示 Antigravity 用量悬浮面板/);
    assert.match(antigravitySection, /autoFailover/);
    assert.match(antigravitySection, /remainingFraction/);
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

console.log("\nAll antigravity config checks passed.");
