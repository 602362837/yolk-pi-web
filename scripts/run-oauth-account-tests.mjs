#!/usr/bin/env node
/**
 * Runner for OAuth account-store and OpenAI quota storage-identity tests.
 *
 * Uses jiti so TypeScript sources load under plain Node.  Each test file
 * manages its own PI_CODING_AGENT_DIR to a temporary path.
 *
 * Run: node scripts/run-oauth-account-tests.mjs
 */

import { accessSync } from "node:fs";
import { createJiti } from "jiti";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": root,
  },
});

const tests = [
  "lib/oauth-account-storage.test.ts",
  "lib/oauth-account-grok.test.ts",
  "lib/oauth-account-kiro.test.ts",
  "lib/kiro-account-token.test.ts",
  "lib/oauth-account-antigravity.test.ts",
  "lib/antigravity-account-token.test.ts",
  "lib/subscription-quota-storage-id.test.ts",
];

let failures = 0;
for (const testPath of tests) {
  const fullPath = join(root, testPath);
  try { accessSync(fullPath); } catch { continue; }
  console.log(`\n▶ Running ${testPath} …`);
  try {
    const testModule = await jiti.import(pathToFileURL(fullPath).href);
    // Some TypeScript test modules intentionally launch an async completion
    // promise instead of using top-level await (which jiti may transpile to
    // CommonJS). Await it before the next test changes PI_CODING_AGENT_DIR.
    const completions = Object.values(testModule ?? {}).filter(
      (value) => value && typeof value === "object" && typeof value.then === "function",
    );
    await Promise.all(completions);
    console.log(`✓ ${testPath} PASSED`);
  } catch (error) {
    console.error(`✗ ${testPath} FAILED:`, error instanceof Error ? error.message : String(error));
    console.error(error);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll OAuth account tests passed");
