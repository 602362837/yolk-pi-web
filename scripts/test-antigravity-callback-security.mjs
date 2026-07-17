#!/usr/bin/env node
/**
 * antigravity-callback-security — OAuth callback loopback policy tests
 *
 * Validates that Antigravity OAuth callback binding is forced to 127.0.0.1
 * before the package's import-time CALLBACK_HOST capture, and that unset or
 * non-loopback PI_OAUTH_CALLBACK_HOST values cannot widen the listener.
 *
 * Run: node scripts/test-antigravity-callback-security.mjs
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const root = process.cwd();

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
      failed++;
    });
}

function assertIncludes(source, needle, label) {
  assert.ok(source.includes(needle), `${label}: expected to include ${JSON.stringify(needle)}`);
}

async function loadWebProviderExtensionsModule() {
  // Load via jiti so TypeScript path aliases are not required.
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  return jiti.import(join(root, "lib/pi-provider-extensions.ts"));
}

function readAddressHost(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`unexpected server address: ${String(address)}`);
  }
  // Node reports IPv6 loopback as '::1' and IPv4 as '127.0.0.1'.
  return address.address;
}

async function listenAndGetHost(host) {
  const server = createServer((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    if (host === undefined) server.listen(0, resolve);
    else server.listen(0, host, resolve);
  });
  try {
    return readAddressHost(server);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

// ============================================================================
// 1. Source policy contracts
// ============================================================================

console.log("\n=== Source policy ===");

await test("resolveAntigravityOAuthCallbackHost always returns 127.0.0.1", async () => {
  const mod = await loadWebProviderExtensionsModule();
  assert.strictEqual(mod.ANTIGRAVITY_OAUTH_CALLBACK_HOST, "127.0.0.1");
  assert.strictEqual(mod.ANTIGRAVITY_OAUTH_CALLBACK_HOST_ENV, "PI_OAUTH_CALLBACK_HOST");
  assert.strictEqual(mod.resolveAntigravityOAuthCallbackHost(undefined), "127.0.0.1");
  assert.strictEqual(mod.resolveAntigravityOAuthCallbackHost(""), "127.0.0.1");
  assert.strictEqual(mod.resolveAntigravityOAuthCallbackHost("0.0.0.0"), "127.0.0.1");
  assert.strictEqual(mod.resolveAntigravityOAuthCallbackHost("::"), "127.0.0.1");
  assert.strictEqual(mod.resolveAntigravityOAuthCallbackHost("192.168.1.10"), "127.0.0.1");
  assert.strictEqual(mod.resolveAntigravityOAuthCallbackHost("127.0.0.1"), "127.0.0.1");
});

await test("loader source forces env before jiti import and restores afterwards", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(join(root, "lib/pi-provider-extensions.ts"), "utf8");
  assertIncludes(source, "process.env[envKey] = resolveAntigravityOAuthCallbackHost(previous)", "forces env");
  assertIncludes(source, "createJiti(join(process.cwd(), \"package.json\"), { interopDefault: true })", "jiti anchored at app package root");
  assertIncludes(source, "antigravityJitiImportCandidates", "candidate import fallbacks");
  assertIncludes(source, "if (previous === undefined) delete process.env[envKey];", "restores unset");
  assertIncludes(source, "else process.env[envKey] = previous;", "restores previous");
  assertIncludes(source, "_antigravityFactoryPromise", "single-flight promise");
});

// ============================================================================
// 2. Actual loopback listen policy
// ============================================================================

console.log("\n=== Actual listener bind policy ===");

await test("Node listen(host=127.0.0.1) reports loopback address", async () => {
  const host = await listenAndGetHost("127.0.0.1");
  assert.ok(host === "127.0.0.1" || host === "::ffff:127.0.0.1", `got ${host}`);
});

await test("Web host policy rejects non-loopback values used for listen()", async () => {
  const mod = await loadWebProviderExtensionsModule();
  // Simulate what would happen if we trusted env: non-loopback must be rejected
  // by policy before listen is called.
  for (const bad of ["0.0.0.0", "::", "192.168.0.1", "10.0.0.5", "example.com"]) {
    const forced = mod.resolveAntigravityOAuthCallbackHost(bad);
    assert.strictEqual(forced, "127.0.0.1", `policy must force loopback for ${bad}`);
    const host = await listenAndGetHost(forced);
    assert.ok(host === "127.0.0.1" || host === "::ffff:127.0.0.1", `listen host was ${host}`);
  }
});

// ============================================================================
// 3. Package import-time capture under forced env
// ============================================================================

console.log("\n=== Package import-time CALLBACK_HOST capture ===");

await test("loading public extension under forced loopback does not throw", async () => {
  const mod = await loadWebProviderExtensionsModule();
  const previous = process.env.PI_OAUTH_CALLBACK_HOST;
  process.env.PI_OAUTH_CALLBACK_HOST = "0.0.0.0";
  try {
    // The Web loader must ignore the malicious env and force loopback.
    const factory = await mod.loadAntigravityExtensionFactory();
    assert.strictEqual(typeof factory, "function", "default export is a factory");
  } finally {
    if (previous === undefined) delete process.env.PI_OAUTH_CALLBACK_HOST;
    else process.env.PI_OAUTH_CALLBACK_HOST = previous;
  }
});

await test("package CALLBACK_HOST captured after Web loader is loopback", async () => {
  // Import the shared oauth utils through the same public package entry tree
  // after the Web loader has forced loopback. The module constant is set once.
  const pkgJsonPath = require.resolve("@yofriadi/pi-antigravity-oauth/package.json");
  const utilsPath = join(dirname(pkgJsonPath), "src/google-oauth-utils.ts");
  const jiti = createJiti(import.meta.url, { interopDefault: true });

  // Ensure loader path ran first (single-flight) with forced host.
  const mod = await loadWebProviderExtensionsModule();
  await mod.loadAntigravityExtensionFactory();

  const utils = await jiti.import(utilsPath);
  // If the package module was first imported through the Web loader, CALLBACK_HOST
  // is the forced loopback. If another process path imported it earlier without
  // the loader, this assertion documents that AG-01 requires loader-first import.
  assert.strictEqual(
    utils.CALLBACK_HOST,
    "127.0.0.1",
    `package CALLBACK_HOST must be loopback after Web loader (got ${String(utils.CALLBACK_HOST)})`,
  );
});

await test("startCallbackServer with forced host binds only loopback", async () => {
  const pkgJsonPath = require.resolve("@yofriadi/pi-antigravity-oauth/package.json");
  const utilsPath = join(dirname(pkgJsonPath), "src/google-oauth-utils.ts");
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const mod = await loadWebProviderExtensionsModule();
  await mod.loadAntigravityExtensionFactory();
  const utils = await jiti.import(utilsPath);

  // Use an ephemeral high port far from production 51121 to avoid collisions.
  const port = 51121 + 1000 + Math.floor(Math.random() * 1000);
  let info;
  try {
    info = await utils.startCallbackServer(port, "/oauth-callback", `http://127.0.0.1:${port}`);
    const host = readAddressHost(info.server);
    assert.ok(
      host === "127.0.0.1" || host === "::ffff:127.0.0.1" || host === "::1",
      `callback server bound non-loopback host: ${host}`,
    );
  } finally {
    if (info?.server) {
      try {
        info.cancelWait?.();
      } catch {
        /* ignore */
      }
      await new Promise((resolve) => info.server.close(() => resolve()));
    }
  }
});

// ============================================================================
// 4. Factory registers google-antigravity when invoked with a stub API
// ============================================================================

console.log("\n=== Extension factory registration ===");

await test("default factory registers provider id google-antigravity", async () => {
  const mod = await loadWebProviderExtensionsModule();
  const factory = await mod.loadAntigravityExtensionFactory();
  const registered = [];
  const stubApi = {
    registerProvider(id, config) {
      registered.push({ id, name: config?.name, hasOauth: Boolean(config?.oauth), modelCount: Array.isArray(config?.models) ? config.models.length : 0 });
    },
  };
  await factory(stubApi);
  assert.ok(registered.some((r) => r.id === "google-antigravity"), `registered providers: ${JSON.stringify(registered)}`);
  const entry = registered.find((r) => r.id === "google-antigravity");
  assert.ok(entry.hasOauth, "oauth config present");
  assert.ok(entry.modelCount > 0, "models catalog present");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
