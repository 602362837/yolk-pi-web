// MODEL-PIN-1/2: pure resolve / equal / should-pin / display helpers.
//
// Run:
//   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-session-model-pin.mjs

import assert from "node:assert/strict";
import { join } from "node:path";
import { createJiti } from "jiti";
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

// ---- MCR-07: actual AgentSessionWrapper / reloadRpcModelsConfigState behavior ----
//
// These cases exercise the real wrapper + registry path (not source regex / pure
// helpers). Loading uses the same jiti + `@` alias pattern as other focused suites
// because createRuntimeJiti alone cannot resolve `@/lib/...` imports inside rpc-manager.

const root = process.cwd();
const rpcJiti = createJiti(join(root, "package.json"), {
  interopDefault: true,
  alias: { "@": root },
});

async function loadRpcManager() {
  return rpcJiti.import(join(root, "lib/rpc-manager.ts"));
}

function createSideEffectCounters() {
  return {
    reloadConfig: 0,
    setModel: 0,
    modelChange: 0,
    defaultModel: 0,
    defaultThinking: 0,
    getModelCalls: [],
  };
}

function createFakeAgentSession({
  sessionId,
  currentModel,
  catalog,
  counters,
  failReload = false,
  afterReload,
}) {
  const models = new Map(
    Object.entries(catalog).map(([key, value]) => [key, { ...value }]),
  );
  const agentState = {
    systemPrompt: "",
    thinkingLevel: "off",
    model: currentModel ? { ...currentModel } : undefined,
  };
  const settingsManager = {
    setDefaultModelAndProvider() {
      counters.defaultModel += 1;
    },
    setDefaultThinkingLevel() {
      counters.defaultThinking += 1;
    },
  };
  const sessionManager = {
    getBranch() {
      return [];
    },
    getEntries() {
      return [];
    },
    isPersisted() {
      return false;
    },
  };

  return {
    sessionId,
    sessionFile: `/tmp/mcr07-${sessionId}.jsonl`,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    get model() {
      return agentState.model;
    },
    modelRuntime: {
      getModel(provider, modelId) {
        counters.getModelCalls.push({ provider, modelId });
        return models.get(`${provider}/${modelId}`);
      },
      async refresh() {
        return undefined;
      },
      async reloadConfig() {
        counters.reloadConfig += 1;
        if (failReload) throw new Error("reloadConfig failed");
        if (typeof afterReload === "function") afterReload(models);
        return undefined;
      },
    },
    sessionManager,
    settingsManager,
    agent: { state: agentState },
    extensionRunner: { getRegisteredCommands() { return []; } },
    promptTemplates: [],
    resourceLoader: { getSkills() { return { skills: [] }; } },
    subscribe() {
      return () => {};
    },
    async prompt() {},
    async abort() {},
    async setModel(model) {
      counters.setModel += 1;
      // Mirror SDK setModel side effects that Chat must isolate:
      // settings defaults + exactly one session model_change.
      settingsManager.setDefaultModelAndProvider(model.provider, model.id);
      settingsManager.setDefaultThinkingLevel("high");
      agentState.model = model;
      counters.modelChange += 1;
    },
    async navigateTree() {
      return { cancelled: true };
    },
    setThinkingLevel() {},
    async compact() {
      return null;
    },
    setSessionName() {},
    getSessionStats() {
      return {
        sessionId,
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      };
    },
    getLastAssistantText() {
      return undefined;
    },
    setAutoCompactionEnabled() {},
    setAutoRetryEnabled() {},
    async steer() {},
    async followUp() {},
    getAllTools() {
      return [];
    },
    getActiveToolNames() {
      return [];
    },
    setActiveToolsByName() {},
    abortCompaction() {},
    getContextUsage() {
      return undefined;
    },
    dispose() {},
  };
}

async function withIsolatedPiSessions(fn) {
  const previous = globalThis.__piSessions;
  const registry = new Map();
  globalThis.__piSessions = registry;
  const wrappers = [];
  try {
    return await fn({
      registry,
      track(wrapper) {
        wrappers.push(wrapper);
        return wrapper;
      },
    });
  } finally {
    for (const wrapper of wrappers) {
      try {
        wrapper.destroy();
      } catch {
        // Destroy is best-effort so later restores still run.
      }
    }
    for (const wrapper of registry.values()) {
      try {
        wrapper.destroy();
      } catch {
        // Ignore duplicate destroy.
      }
    }
    registry.clear();
    if (previous === undefined) delete globalThis.__piSessions;
    else globalThis.__piSessions = previous;
  }
}

await testAsync("MCR-07: reloadRpcModelsConfigState replaces same-id descriptor without setModel side effects", async () => {
  process.env.PI_OFFLINE = "1";
  const { AgentSessionWrapper, reloadRpcModelsConfigState } = await loadRpcManager();

  await withIsolatedPiSessions(async ({ registry, track }) => {
    const counters = createSideEffectCounters();
    const oldDescriptor = { id: "model-a", provider: "alpha", name: "old-a" };
    const inner = createFakeAgentSession({
      sessionId: "mcr07-reload-ok",
      currentModel: oldDescriptor,
      catalog: { "alpha/model-a": oldDescriptor },
      counters,
      afterReload(models) {
        models.set("alpha/model-a", { id: "model-a", provider: "alpha", name: "new-a" });
      },
    });
    const wrapper = track(new AgentSessionWrapper(inner, "/tmp/mcr07-cwd"));
    registry.set(wrapper.sessionId, wrapper);

    const beforeRef = wrapper.inner.agent.state.model;
    const summary = await reloadRpcModelsConfigState();
    const afterRef = wrapper.inner.agent.state.model;

    assert.deepEqual(summary, { attempted: 1, succeeded: 1, failed: 0 });
    assert.equal(counters.reloadConfig, 1);
    assert.notEqual(afterRef, beforeRef, "descriptor reference must be replaced");
    assert.deepEqual(
      { id: afterRef.id, provider: afterRef.provider, name: afterRef.name },
      { id: "model-a", provider: "alpha", name: "new-a" },
    );
    assert.equal(counters.setModel, 0, "config reload must not call setModel");
    assert.equal(counters.modelChange, 0, "config reload must not append model_change");
    assert.equal(counters.defaultModel, 0, "config reload must not write default model");
    assert.equal(counters.defaultThinking, 0, "config reload must not write default thinking");
  });
});

await testAsync("MCR-07: deleted current model does not fallback or call setModel", async () => {
  process.env.PI_OFFLINE = "1";
  const { AgentSessionWrapper, reloadRpcModelsConfigState } = await loadRpcManager();

  await withIsolatedPiSessions(async ({ registry, track }) => {
    const counters = createSideEffectCounters();
    const current = { id: "model-a", provider: "alpha", name: "keep-me" };
    const inner = createFakeAgentSession({
      sessionId: "mcr07-reload-deleted",
      currentModel: current,
      catalog: { "alpha/model-a": current },
      counters,
      afterReload(models) {
        models.delete("alpha/model-a");
      },
    });
    const wrapper = track(new AgentSessionWrapper(inner, "/tmp/mcr07-cwd"));
    registry.set(wrapper.sessionId, wrapper);

    const beforeRef = wrapper.inner.agent.state.model;
    const summary = await reloadRpcModelsConfigState();

    assert.deepEqual(summary, { attempted: 1, succeeded: 1, failed: 0 });
    assert.equal(wrapper.inner.agent.state.model, beforeRef, "deleted current stays put");
    assert.equal(wrapper.inner.agent.state.model.name, "keep-me");
    assert.equal(counters.setModel, 0);
    assert.equal(counters.modelChange, 0);
    assert.equal(counters.defaultModel, 0);
    assert.equal(counters.defaultThinking, 0);
  });
});

await testAsync("MCR-07: reloadRpcModelsConfigState isolates per-wrapper failures in summary", async () => {
  process.env.PI_OFFLINE = "1";
  const { AgentSessionWrapper, reloadRpcModelsConfigState } = await loadRpcManager();

  await withIsolatedPiSessions(async ({ registry, track }) => {
    const okCounters = createSideEffectCounters();
    const badCounters = createSideEffectCounters();
    const okCurrent = { id: "model-a", provider: "alpha", name: "ok-old" };
    const badCurrent = { id: "model-x", provider: "alpha", name: "bad-old" };

    const okInner = createFakeAgentSession({
      sessionId: "mcr07-reload-ok-2",
      currentModel: okCurrent,
      catalog: { "alpha/model-a": okCurrent },
      counters: okCounters,
      afterReload(models) {
        models.set("alpha/model-a", { id: "model-a", provider: "alpha", name: "ok-new" });
      },
    });
    const badInner = createFakeAgentSession({
      sessionId: "mcr07-reload-bad",
      currentModel: badCurrent,
      catalog: { "alpha/model-x": badCurrent },
      counters: badCounters,
      failReload: true,
    });

    const okWrapper = track(new AgentSessionWrapper(okInner, "/tmp/mcr07-cwd"));
    const badWrapper = track(new AgentSessionWrapper(badInner, "/tmp/mcr07-cwd"));
    registry.set(okWrapper.sessionId, okWrapper);
    registry.set(badWrapper.sessionId, badWrapper);

    const summary = await reloadRpcModelsConfigState();
    assert.deepEqual(summary, { attempted: 2, succeeded: 1, failed: 1 });
    assert.equal(okCounters.reloadConfig, 1);
    assert.equal(badCounters.reloadConfig, 1);
    assert.equal(okWrapper.inner.agent.state.model.name, "ok-new");
    assert.equal(badWrapper.inner.agent.state.model.name, "bad-old");
    assert.equal(okCounters.setModel, 0);
    assert.equal(badCounters.setModel, 0);
  });
});

await testAsync("MCR-07: set_model exact miss reloads once, retries same identity, then setModel once", async () => {
  process.env.PI_OFFLINE = "1";
  const { AgentSessionWrapper } = await loadRpcManager();

  await withIsolatedPiSessions(async ({ track }) => {
    const counters = createSideEffectCounters();
    const current = { id: "model-a", provider: "alpha", name: "A" };
    const inner = createFakeAgentSession({
      sessionId: "mcr07-set-model-retry",
      currentModel: current,
      catalog: { "alpha/model-a": current },
      counters,
      afterReload(models) {
        models.set("beta/new-model", { id: "new-model", provider: "beta", name: "Beta New" });
      },
    });
    const wrapper = track(new AgentSessionWrapper(inner, "/tmp/mcr07-cwd"));

    const result = await wrapper.send({
      type: "set_model",
      provider: "beta",
      modelId: "new-model",
    });

    assert.deepEqual(result, { id: "new-model", provider: "beta" });
    assert.equal(counters.reloadConfig, 1, "exact miss reloads config exactly once");
    assert.equal(counters.setModel, 1, "successful hit calls setModel once");
    assert.equal(
      counters.modelChange,
      1,
      "successful set_model may produce exactly one SDK model_change",
    );
    assert.equal(counters.defaultModel, 0, "session-scoped defaults suppress model writes");
    assert.equal(counters.defaultThinking, 0, "session-scoped defaults suppress thinking writes");
    // First miss + one exact retry for the requested identity. An additional
    // getModel(current) may occur inside reconcileLiveModelDescriptor after reload.
    const requestedLookups = counters.getModelCalls.filter(
      (call) => call.provider === "beta" && call.modelId === "new-model",
    );
    assert.equal(requestedLookups.length, 2, "requested provider/id looked up exactly twice");
    assert.deepEqual(requestedLookups[0], { provider: "beta", modelId: "new-model" });
    assert.deepEqual(requestedLookups[1], { provider: "beta", modelId: "new-model" });
    assert.equal(wrapper.inner.model?.provider, "beta");
    assert.equal(wrapper.inner.model?.id, "new-model");
  });
});

await testAsync("MCR-07: set_model unknown after one reload keeps Model not found without writes", async () => {
  process.env.PI_OFFLINE = "1";
  const { AgentSessionWrapper } = await loadRpcManager();

  await withIsolatedPiSessions(async ({ track }) => {
    const counters = createSideEffectCounters();
    const current = { id: "model-a", provider: "alpha", name: "A" };
    const beforeRef = { ...current };
    const inner = createFakeAgentSession({
      sessionId: "mcr07-set-model-unknown",
      currentModel: beforeRef,
      catalog: { "alpha/model-a": beforeRef },
      counters,
      // Reload runs but still does not introduce the requested model.
    });
    const wrapper = track(new AgentSessionWrapper(inner, "/tmp/mcr07-cwd"));

    await assert.rejects(
      () =>
        wrapper.send({
          type: "set_model",
          provider: "beta",
          modelId: "missing",
        }),
      /Model not found: beta\/missing/,
    );

    assert.equal(counters.reloadConfig, 1, "second miss still only reloaded once");
    assert.equal(counters.setModel, 0);
    assert.equal(counters.modelChange, 0);
    assert.equal(counters.defaultModel, 0);
    assert.equal(counters.defaultThinking, 0);
    const requestedLookups = counters.getModelCalls.filter(
      (call) => call.provider === "beta" && call.modelId === "missing",
    );
    assert.equal(requestedLookups.length, 2, "requested provider/id retried once only");
    assert.deepEqual(requestedLookups[0], { provider: "beta", modelId: "missing" });
    assert.deepEqual(requestedLookups[1], { provider: "beta", modelId: "missing" });
    assert.equal(
      counters.getModelCalls.filter((call) => call.provider !== "beta" || call.modelId !== "missing").length <= 1,
      true,
      "no fuzzy/fallback lookups beyond optional current-descriptor reconcile",
    );
    assert.equal(wrapper.inner.model?.provider, "alpha");
    assert.equal(wrapper.inner.model?.id, "model-a");
  });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall session-model-pin tests passed");
process.exit(0);
