#!/usr/bin/env node
/**
 * Kiro + global compact mode config checks (KIRO-03).
 *
 * Covers:
 * - usage.providerPanelsCompact default false
 * - kiro.usagePanelEnabled / kiro.autoFailover defaults
 * - missing-field normalize compatibility on old pi-web.json
 * - strict validate rejects non-boolean flags
 * - partial kiro/usage patches preserve unrelated fields
 * - Settings left-nav Kiro section + Usage compact placement
 *
 * Run:
 *   npm run test:kiro-config
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
const agentDir = await mkdtemp(join(tmpdir(), "ypi-kiro-config-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

try {
  const {
    DEFAULT_PI_WEB_CONFIG,
    PiWebConfigValidationError,
    readPiWebConfig,
    validatePiWebKiroConfig,
    validatePiWebUsageConfig,
    writePiWebConfigPatch,
  } = await import("../lib/pi-web-config.ts");

  await test("DEFAULT usage.providerPanelsCompact is false", () => {
    assert.equal(DEFAULT_PI_WEB_CONFIG.usage.providerPanelsCompact, false);
  });

  await test("DEFAULT kiro panel/failover are disabled with Grok-aligned budgets", () => {
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.usagePanelEnabled, false);
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.autoFailover.enabled, false);
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.autoFailover.maxAttemptsPerTurn, 1);
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.autoFailover.maxAccountSwitchesPerTurn, 1);
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.autoFailover.quotaCacheMaxAgeMs, 5 * 60 * 1000);
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.autoFailover.exhaustedCooldownMs, 30 * 60 * 1000);
    assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.autoFailover.minSwitchIntervalMs, 10 * 1000);
  });

  await test("old pi-web.json without kiro/compact normalizes safely", async () => {
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
      }),
      "utf8",
    );
    const config = readPiWebConfig();
    assert.equal(config.usage.includeArchived, false);
    assert.equal(config.usage.providerPanelsCompact, false);
    assert.equal(config.kiro.usagePanelEnabled, false);
    assert.equal(config.kiro.autoFailover.enabled, false);
    assert.equal(config.grok.usagePanelEnabled, true);
  });

  await test("validate rejects non-boolean providerPanelsCompact", () => {
    assert.throws(
      () => validatePiWebUsageConfig({
        ...DEFAULT_PI_WEB_CONFIG.usage,
        providerPanelsCompact: "yes",
      }),
      (error) => error instanceof PiWebConfigValidationError
        && String(error.message).includes("usage.providerPanelsCompact"),
    );
  });

  await test("validate rejects non-boolean kiro.usagePanelEnabled", () => {
    assert.throws(
      () => validatePiWebKiroConfig({
        usagePanelEnabled: "yes",
        autoFailover: DEFAULT_PI_WEB_CONFIG.kiro.autoFailover,
      }),
      (error) => error instanceof PiWebConfigValidationError
        && String(error.message).includes("kiro.usagePanelEnabled"),
    );
  });

  await test("partial kiro usagePanelEnabled patch preserves autoFailover", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        kiro: {
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
      kiro: { usagePanelEnabled: true },
    });
    assert.equal(result.config.kiro.usagePanelEnabled, true);
    assert.equal(result.config.kiro.autoFailover.enabled, true);
    assert.equal(result.config.kiro.autoFailover.maxAttemptsPerTurn, 1);
  });

  await test("partial usage compact patch preserves includeArchived and free models", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        usage: {
          includeArchived: false,
          providerPanelsCompact: false,
          explicitFreeModels: [{ provider: "openai", model: "gpt-test" }],
        },
      }),
      "utf8",
    );

    const result = writePiWebConfigPatch({
      usage: { providerPanelsCompact: true },
    });
    assert.equal(result.config.usage.providerPanelsCompact, true);
    assert.equal(result.config.usage.includeArchived, false);
    assert.deepEqual(result.config.usage.explicitFreeModels, [{ provider: "openai", model: "gpt-test" }]);
  });

  await test("save/reload preserves all three new settings without dropping unrelated sections", async () => {
    await writeFile(
      join(agentDir, "pi-web.json"),
      JSON.stringify({
        usage: { includeArchived: true, providerPanelsCompact: false },
        chatgpt: { usagePanelEnabled: true },
        grok: { usagePanelEnabled: true },
        kiro: {
          usagePanelEnabled: false,
          autoFailover: DEFAULT_PI_WEB_CONFIG.kiro.autoFailover,
        },
      }),
      "utf8",
    );

    writePiWebConfigPatch({
      usage: { providerPanelsCompact: true },
      kiro: {
        usagePanelEnabled: true,
        autoFailover: {
          ...DEFAULT_PI_WEB_CONFIG.kiro.autoFailover,
          enabled: true,
        },
      },
    });

    const reloaded = readPiWebConfig();
    assert.equal(reloaded.usage.providerPanelsCompact, true);
    assert.equal(reloaded.usage.includeArchived, true);
    assert.equal(reloaded.kiro.usagePanelEnabled, true);
    assert.equal(reloaded.kiro.autoFailover.enabled, true);
    assert.equal(reloaded.chatgpt.usagePanelEnabled, true);
    assert.equal(reloaded.grok.usagePanelEnabled, true);
  });

  await test("Settings places compact only under Usage and Kiro as a left-nav peer", () => {
    const settings = read("components/SettingsConfig.tsx");
    const config = read("lib/pi-web-config.ts");
    const route = read("app/api/web-config/route.ts");

    assert.match(config, /providerPanelsCompact:\s*false/);
    assert.match(config, /"usage\.providerPanelsCompact"/);
    assert.match(config, /kiro:\s*\{[\s\S]*usagePanelEnabled:\s*false/);
    assert.match(config, /"kiro\.usagePanelEnabled"/);
    assert.match(route, /kiro\?: unknown/);

    assert.match(settings, /renderSectionButton\("kiro", "Kiro"/);
    assert.match(settings, /顶部额度组件简要显示 \(Compact Mode\)/);
    assert.match(settings, /Kiro 用量悬浮面板/);
    assert.match(settings, /明确限额或限流时自动切换可用账号/);
    assert.match(settings, /section === "kiro"/);
    assert.match(settings, /providerPanelsCompact/);
    assert.match(settings, /updateKiro/);
    assert.match(settings, /kiro,\s*editor/);

    // Compact must live in the Usage section, not be duplicated under Kiro.
    const usageSectionStart = settings.indexOf('section === "usage"');
    const kiroSectionStart = settings.indexOf('section === "kiro"');
    assert.ok(usageSectionStart > 0, "usage section missing");
    assert.ok(kiroSectionStart > usageSectionStart, "kiro section should follow usage section");
    const usageSection = settings.slice(usageSectionStart, kiroSectionStart);
    const kiroSection = settings.slice(kiroSectionStart, settings.indexOf('section === "editor"', kiroSectionStart));
    assert.match(usageSection, /providerPanelsCompact/);
    assert.doesNotMatch(kiroSection, /providerPanelsCompact/);
    assert.match(kiroSection, /Kiro 用量悬浮面板/);
    assert.match(kiroSection, /autoFailover/);
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

console.log("\nAll kiro config checks passed.");