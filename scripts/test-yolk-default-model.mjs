// MODEL-PIN-4: yolk.defaultModel validate / legacy thinking compat.
//
// Run:
//   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-yolk-default-model.mjs

import assert from "node:assert/strict";
import {
  DEFAULT_PI_WEB_CONFIG,
  PiWebConfigValidationError,
  validatePiWebYolkConfig,
} from "../lib/pi-web-config.ts";

let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

test("DEFAULT yolk uses piDefault model mode", () => {
  assert.equal(DEFAULT_PI_WEB_CONFIG.yolk.defaultModel.mode, "piDefault");
  assert.equal(DEFAULT_PI_WEB_CONFIG.yolk.defaultThinkingLevel, "auto");
  assert.equal(DEFAULT_PI_WEB_CONFIG.yolk.defaultToolPreset, "default");
});

test("validate specific defaultModel fills thinking from legacy field", () => {
  const yolk = validatePiWebYolkConfig({
    defaultToolPreset: "full",
    defaultModel: { mode: "specific", provider: "grok-cli", modelId: "grok-4.5" },
    defaultThinkingLevel: "medium",
  });
  assert.equal(yolk.defaultToolPreset, "full");
  assert.equal(yolk.defaultModel.mode, "specific");
  assert.equal(yolk.defaultModel.provider, "grok-cli");
  assert.equal(yolk.defaultModel.modelId, "grok-4.5");
  assert.equal(yolk.defaultModel.thinking, "medium");
  assert.equal(yolk.defaultThinkingLevel, "medium");
});

test("validate specific defaultModel.thinking wins over legacy", () => {
  const yolk = validatePiWebYolkConfig({
    defaultToolPreset: "default",
    defaultModel: {
      mode: "specific",
      provider: "openai-codex",
      modelId: "gpt-5.6",
      thinking: "high",
    },
    defaultThinkingLevel: "low",
  });
  assert.equal(yolk.defaultModel.thinking, "high");
  assert.equal(yolk.defaultThinkingLevel, "high");
});

test("validate missing defaultModel becomes piDefault with legacy thinking", () => {
  const yolk = validatePiWebYolkConfig({
    defaultToolPreset: "subagent",
    defaultThinkingLevel: "minimal",
  });
  assert.deepEqual(yolk.defaultModel, { mode: "piDefault" });
  assert.equal(yolk.defaultThinkingLevel, "minimal");
});

test("validate piDefault mode", () => {
  const yolk = validatePiWebYolkConfig({
    defaultToolPreset: "none",
    defaultModel: { mode: "piDefault" },
    defaultThinkingLevel: "auto",
  });
  assert.deepEqual(yolk.defaultModel, { mode: "piDefault" });
  assert.equal(yolk.defaultThinkingLevel, "auto");
});

test("validate rejects incomplete specific model", () => {
  assert.throws(
    () =>
      validatePiWebYolkConfig({
        defaultToolPreset: "default",
        defaultModel: { mode: "specific", provider: "grok-cli" },
      }),
    (err) => err instanceof PiWebConfigValidationError,
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall yolk-default-model tests passed");
