// Run: npm run test:models-config-visibility

import assert from "node:assert/strict";
import {
  isOverrideOnlyProviderEntry,
  visibleModelsConfigProviders,
} from "../lib/models-config-visibility.ts";

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL- ${name}`);
    console.error(error);
  }
}

console.log("models-config visibility");

await test("hides an entry containing only object modelOverrides", () => {
  assert.equal(isOverrideOnlyProviderEntry({ modelOverrides: { "model-a": { cost: { input: 1 } } } }), true);
  assert.equal(isOverrideOnlyProviderEntry({ modelOverrides: {} }), true);
});

await test("fails visible for provider configuration and unknown fields", () => {
  for (const entry of [
    { modelOverrides: {}, models: [] },
    { modelOverrides: {}, baseUrl: "https://example.test" },
    { modelOverrides: {}, api: "openai-completions" },
    { modelOverrides: {}, futureProviderField: true },
  ]) {
    assert.equal(isOverrideOnlyProviderEntry(entry), false);
  }
});

await test("fails visible for malformed provider entries and overrides", () => {
  for (const entry of [
    null,
    undefined,
    "provider",
    [],
    {},
    { modelOverrides: null },
    { modelOverrides: [] },
    { modelOverrides: "invalid" },
    { modelOverrides: 0 },
  ]) {
    assert.equal(isOverrideOnlyProviderEntry(entry), false);
  }
});

await test("fails visible when an enumerable symbol field is present", () => {
  const extraField = Symbol("future");
  const entry = { modelOverrides: {} };
  entry[extraField] = true;
  assert.equal(isOverrideOnlyProviderEntry(entry), false);
});

await test("filters only the display projection and preserves source data", () => {
  const providers = {
    hidden: { modelOverrides: { "keep-me": { temperature: 0.2 } } },
    custom: { models: [{ id: "custom-model" }] },
    future: { modelOverrides: {}, futureProviderField: { enabled: true } },
  };
  const before = structuredClone(providers);

  assert.deepEqual(
    visibleModelsConfigProviders(providers).map(([id]) => id),
    ["custom", "future"],
  );
  assert.deepEqual(providers, before);
  assert.deepEqual(JSON.parse(JSON.stringify(providers)), before);
});

await test("fails visible when dynamic inspection throws", () => {
  const entry = new Proxy({}, {
    ownKeys() {
      throw new Error("uninspectable");
    },
  });
  assert.equal(isOverrideOnlyProviderEntry(entry), false);
});

if (failures > 0) {
  console.error(`\n${failures} models-config visibility test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nmodels-config visibility tests passed.");
}
