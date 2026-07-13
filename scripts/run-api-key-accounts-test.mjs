#!/usr/bin/env node
/**
 * Runner for lib/api-key-accounts.test.ts.
 *
 * Uses jiti so TypeScript sources (including parameter properties and the
 * `@/*` path alias used by dynamic imports inside api-key-accounts) load under
 * plain Node without touching the user's real agent directory. The test file
 * itself sets PI_CODING_AGENT_DIR to a temporary path before any store I/O.
 *
 * Run: npm run test:api-key-accounts
 */

import { createJiti } from "jiti";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testFile = join(root, "lib", "api-key-accounts.test.ts");

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": root,
  },
});

await jiti.import(pathToFileURL(testFile).href);
