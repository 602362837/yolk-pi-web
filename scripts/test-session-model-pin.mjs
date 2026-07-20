// MODEL-PIN-1/2: pure resolve / equal / should-pin / display helpers.
//
// Run:
//   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-session-model-pin.mjs

import assert from "node:assert/strict";
import {
  clampThinkingLevelToSupported,
  normalizeSessionModelRef,
  resolveChatDisplayModel,
  resolveColdStartModelPreference,
  resolveDesiredSessionModel,
  resolveYolkColdStartModel,
  sessionModelsEqual,
  shouldPinSessionModel,
  withSessionScopedSettingsDefaults,
} from "../lib/session-model-pin.ts";

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

const grok = { provider: "grok-cli", modelId: "grok-4.5" };
const gpt = { provider: "openai-codex", modelId: "gpt-5.6" };

test("sessionModelsEqual matches provider+modelId", () => {
  assert.equal(sessionModelsEqual(grok, { ...grok }), true);
  assert.equal(sessionModelsEqual(grok, gpt), false);
  assert.equal(sessionModelsEqual(null, grok), false);
  assert.equal(sessionModelsEqual(undefined, undefined), false);
});

test("normalizeSessionModelRef accepts modelId or get_state id", () => {
  assert.deepEqual(
    normalizeSessionModelRef({ provider: "grok-cli", modelId: "grok-4.5" }),
    grok,
  );
  assert.deepEqual(
    normalizeSessionModelRef({ provider: "grok-cli", id: "grok-4.5" }),
    grok,
  );
  assert.equal(normalizeSessionModelRef({ provider: "grok-cli" }), null);
  assert.equal(normalizeSessionModelRef(null), null);
});

test("resolveDesiredSessionModel prefers override > newSession > pending > live > context", () => {
  assert.deepEqual(
    resolveDesiredSessionModel({
      override: grok,
      newSession: gpt,
      pending: gpt,
      live: gpt,
      context: gpt,
    }),
    grok,
  );
  assert.deepEqual(
    resolveDesiredSessionModel({
      override: null,
      newSession: grok,
      pending: gpt,
      live: gpt,
      context: gpt,
    }),
    grok,
  );
  assert.deepEqual(
    resolveDesiredSessionModel({
      pending: grok,
      live: gpt,
      context: gpt,
    }),
    grok,
  );
  assert.deepEqual(
    resolveDesiredSessionModel({
      live: grok,
      context: gpt,
    }),
    grok,
  );
  assert.deepEqual(
    resolveDesiredSessionModel({
      context: gpt,
    }),
    gpt,
  );
  assert.equal(resolveDesiredSessionModel({}), null);
});

test("resolveChatDisplayModel prefers override/pending/live over path context", () => {
  assert.deepEqual(
    resolveChatDisplayModel({
      override: grok,
      pending: gpt,
      live: gpt,
      context: gpt,
    }),
    grok,
  );
  assert.deepEqual(
    resolveChatDisplayModel({
      override: null,
      pending: grok,
      live: gpt,
      context: gpt,
    }),
    grok,
  );
  // After agent_end: override cleared only if not set; live Grok beats path GPT.
  assert.deepEqual(
    resolveChatDisplayModel({
      override: null,
      pending: null,
      live: grok,
      context: gpt,
    }),
    grok,
  );
  // Historical assistant path alone is last resort (reload without live agent).
  assert.deepEqual(
    resolveChatDisplayModel({
      context: gpt,
    }),
    gpt,
  );
  // Explicit override must not be clobbered by path context after reload.
  assert.deepEqual(
    resolveChatDisplayModel({
      override: grok,
      context: gpt,
    }),
    grok,
  );
});

test("shouldPinSessionModel when desired differs from last pin", () => {
  assert.equal(shouldPinSessionModel(grok, null), true);
  assert.equal(shouldPinSessionModel(grok, gpt), true);
  assert.equal(shouldPinSessionModel(grok, grok), false);
  assert.equal(shouldPinSessionModel(null, grok), false);
  assert.equal(shouldPinSessionModel({ provider: "", modelId: "x" }, null), false);
});

test("serial pin decision: switch then send still needs pin until lastPinned updates", () => {
  let lastPinned = gpt;
  const ui = grok;
  assert.equal(shouldPinSessionModel(ui, lastPinned), true, "before set_model completes");
  // simulate successful pin
  lastPinned = ui;
  assert.equal(shouldPinSessionModel(ui, lastPinned), false, "after set_model completes");
});

test("PIN-2: post-run display keeps Grok when live is Grok and path is GPT", () => {
  // Simulates agent_end reload: path context may still show last assistant model (GPT)
  // while live get_state.model is the session-pinned Grok.
  const display = resolveChatDisplayModel({
    override: null,
    pending: null,
    live: grok,
    context: gpt,
  });
  assert.deepEqual(display, grok);
  // And pin baseline should not force re-set_model when last pin was already Grok.
  assert.equal(shouldPinSessionModel(display, grok), false);
});

async function testAsync(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

await testAsync("PIN-3: withSessionScopedSettingsDefaults suppresses default writes", async () => {
  const calls = { model: 0, thinking: 0 };
  const settingsManager = {
    setDefaultModelAndProvider(provider, modelId) {
      calls.model += 1;
      this.lastModel = `${provider}/${modelId}`;
    },
    setDefaultThinkingLevel(level) {
      calls.thinking += 1;
      this.lastThinking = level;
    },
    lastModel: null,
    lastThinking: null,
  };

  // Baseline: unpatched manager records writes.
  settingsManager.setDefaultModelAndProvider("openai-codex", "gpt-5.6");
  settingsManager.setDefaultThinkingLevel("medium");
  assert.equal(calls.model, 1);
  assert.equal(calls.thinking, 1);

  await withSessionScopedSettingsDefaults(settingsManager, async () => {
    // Simulates SDK setModel side effects during Chat set_model.
    settingsManager.setDefaultModelAndProvider("grok-cli", "grok-4.5");
    settingsManager.setDefaultThinkingLevel("high");
    assert.equal(calls.model, 1, "default model write suppressed inside scope");
    assert.equal(calls.thinking, 1, "default thinking write suppressed inside scope");
    assert.equal(settingsManager.lastModel, "openai-codex/gpt-5.6");
    assert.equal(settingsManager.lastThinking, "medium");
  });

  // After scope exit, explicit Settings writers work again.
  settingsManager.setDefaultModelAndProvider("openai-codex", "gpt-5.6");
  settingsManager.setDefaultThinkingLevel("low");
  assert.equal(calls.model, 2);
  assert.equal(calls.thinking, 2);
  assert.equal(settingsManager.lastModel, "openai-codex/gpt-5.6");
  assert.equal(settingsManager.lastThinking, "low");
});

await testAsync("PIN-3: nested scopes restore originals only on outer exit", async () => {
  const calls = { model: 0 };
  const settingsManager = {
    setDefaultModelAndProvider() {
      calls.model += 1;
    },
  };

  await withSessionScopedSettingsDefaults(settingsManager, async () => {
    await withSessionScopedSettingsDefaults(settingsManager, async () => {
      settingsManager.setDefaultModelAndProvider("a", "b");
      assert.equal(calls.model, 0);
    });
    // Still suppressed until outer scope ends.
    settingsManager.setDefaultModelAndProvider("c", "d");
    assert.equal(calls.model, 0);
  });
  settingsManager.setDefaultModelAndProvider("e", "f");
  assert.equal(calls.model, 1);
});

await testAsync("PIN-3: restores original methods after action throws", async () => {
  const calls = { model: 0 };
  const settingsManager = {
    setDefaultModelAndProvider() {
      calls.model += 1;
    },
  };
  await assert.rejects(
    () =>
      withSessionScopedSettingsDefaults(settingsManager, async () => {
        throw new Error("boom");
      }),
    /boom/,
  );
  settingsManager.setDefaultModelAndProvider("x", "y");
  assert.equal(calls.model, 1);
});

test("PIN-4: clampThinkingLevelToSupported keeps current when supported", () => {
  assert.equal(clampThinkingLevelToSupported("high", ["auto", "low", "high"]), "high");
});

test("PIN-4: clampThinkingLevelToSupported prefers medium then auto", () => {
  assert.equal(clampThinkingLevelToSupported("xhigh", ["auto", "off", "medium"]), "medium");
  assert.equal(clampThinkingLevelToSupported("xhigh", ["auto", "off"]), "auto");
});

test("PIN-4: clampThinkingLevelToSupported keeps current when levels unknown", () => {
  assert.equal(clampThinkingLevelToSupported("medium", null), "medium");
  assert.equal(clampThinkingLevelToSupported("medium", []), "medium");
});

// ---- MODEL-PIN-CS-01: liveConfirmed pin semantics ----

test("CS-01: liveConfirmed=false forces pin even when desired==lastPinned", () => {
  // Cold start / idle destroy: lastPinned may still equal desired from a
  // previous live session, but the current wrapper is unconfirmed.
  assert.equal(shouldPinSessionModel(grok, grok, { liveConfirmed: false }), true);
  assert.equal(shouldPinSessionModel(grok, null, { liveConfirmed: false }), true);
  assert.equal(shouldPinSessionModel(grok, gpt, { liveConfirmed: false }), true);
});

test("CS-01: liveConfirmed=true keeps equal-skip behaviour", () => {
  assert.equal(shouldPinSessionModel(grok, grok, { liveConfirmed: true }), false);
  assert.equal(shouldPinSessionModel(grok, null, { liveConfirmed: true }), true);
  assert.equal(shouldPinSessionModel(grok, gpt, { liveConfirmed: true }), true);
});

test("CS-01: liveConfirmed=false still rejects invalid desired", () => {
  assert.equal(shouldPinSessionModel(null, grok, { liveConfirmed: false }), false);
  assert.equal(shouldPinSessionModel({ provider: "", modelId: "x" }, null, { liveConfirmed: false }), false);
  assert.equal(shouldPinSessionModel(undefined, grok, { liveConfirmed: false }), false);
});

test("CS-01: omitted options preserves legacy equal-comparison", () => {
  // Pre-CS callers that do not pass liveConfirmed keep old behaviour.
  assert.equal(shouldPinSessionModel(grok, grok), false);
  assert.equal(shouldPinSessionModel(grok, gpt), true);
  assert.equal(shouldPinSessionModel(grok, null), true);
  assert.equal(shouldPinSessionModel(null, grok), false);
});

// ---- MODEL-PIN-CS-01: yolk cold-start helpers ----

test("CS-01: resolveYolkColdStartModel returns model+thinking for specific", () => {
  const yolk = {
    defaultModel: { mode: "specific", provider: "grok-cli", modelId: "grok-4.5", thinking: "high" },
    defaultThinkingLevel: "auto",
  };
  const result = resolveYolkColdStartModel(yolk);
  assert.deepEqual(result, { provider: "grok-cli", modelId: "grok-4.5", thinking: "high" });
});

test("CS-01: resolveYolkColdStartModel falls back to defaultThinkingLevel", () => {
  const yolk = {
    defaultModel: { mode: "specific", provider: "openai-codex", modelId: "gpt-5.6" },
    defaultThinkingLevel: "medium",
  };
  const result = resolveYolkColdStartModel(yolk);
  assert.deepEqual(result, { provider: "openai-codex", modelId: "gpt-5.6", thinking: "medium" });
});

test("CS-01: resolveYolkColdStartModel returns null for piDefault", () => {
  assert.equal(
    resolveYolkColdStartModel({
      defaultModel: { mode: "piDefault" },
      defaultThinkingLevel: "auto",
    }),
    null,
  );
});

test("CS-01: resolveYolkColdStartModel returns null for missing config", () => {
  assert.equal(resolveYolkColdStartModel(null), null);
  assert.equal(resolveYolkColdStartModel(undefined), null);
  assert.equal(resolveYolkColdStartModel({}), null);
  assert.equal(
    resolveYolkColdStartModel({
      defaultModel: { mode: "specific", provider: "", modelId: "x" },
    }),
    null,
  );
  assert.equal(
    resolveYolkColdStartModel({
      defaultModel: { mode: "specific", provider: "x", modelId: "" },
    }),
    null,
  );
});

test("CS-01: resolveColdStartModelPreference — recoverable > yolk > sdk", () => {
  assert.equal(resolveColdStartModelPreference({ recoverable: true, yolk: true }), "recoverable");
  assert.equal(resolveColdStartModelPreference({ recoverable: true, yolk: false }), "recoverable");
  assert.equal(resolveColdStartModelPreference({ recoverable: false, yolk: true }), "yolk");
  assert.equal(resolveColdStartModelPreference({ recoverable: false, yolk: false }), "sdk");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall session-model-pin tests passed");
