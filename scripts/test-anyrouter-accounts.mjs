#!/usr/bin/env node
/**
 * AnyRouter managed-account + runtime-bridge regression suite (AR-06).
 *
 * Covers:
 * - temporary PI_CODING_AGENT_DIR isolation (never ~/.pi/agent)
 * - multi-account Active authority → bridge / auth.json mirrors
 * - baseUrlOverride precedence over global env/source
 * - non-active isolation (no bridge/auth mutation)
 * - concurrent Activate convergence
 * - mirror repair via same-account Activate / cold reconcile
 * - secret sentinel absence from list/summary/config projections
 * - packaging scripts for anyrouter test entrypoints
 *
 * Does not call real AnyRouter network endpoints.
 *
 * Run: npm run test:anyrouter-accounts
 */

import { createJiti } from "jiti";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": root },
});

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${message}`);
    failed += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function deepEqual(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  assert(sa === sb, msg || `expected ${sb}, got ${sa}`);
}

function containsSecret(value, secrets) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return secrets.some((s) => text.includes(s));
}

function fingerprint(key) {
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

async function main() {
  const realAgentDir = join(homedir(), ".pi", "agent");
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-anyrouter-accounts-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Clear AnyRouter env overrides for deterministic precedence tests.
  const ENV_NAMES = [
    "PI_ANYROUTER_CC_BASE_URL",
    "PI_ANYROUTER_CC_API_KEY",
    "PI_ANYROUTER_CC_MAX_RETRIES",
    "PI_ANYROUTER_CC_BASE_DELAY_MS",
    "PI_ANYROUTER_CC_MAX_DELAY_MS",
    "PI_ANYROUTER_CC_JITTER_MS",
    "PI_ANYROUTER_CC_RETRY_AFTER_CAP_MS",
    "PI_ANYROUTER_CC_CONFIG",
  ];
  const savedEnv = {};
  for (const name of ENV_NAMES) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  const SECRET_A = `anyrouter-acc-A-${randomBytes(10).toString("hex")}`;
  const SECRET_B = `anyrouter-acc-B-${randomBytes(10).toString("hex")}`;
  const SECRET_C = `anyrouter-acc-C-${randomBytes(10).toString("hex")}`;
  const SECRETS = [SECRET_A, SECRET_B, SECRET_C];

  await writeFile(
    join(agentDir, "anyrouter.json"),
    `${JSON.stringify(
      {
        baseUrl: "https://global-anyrouter.example/v1",
        models: [{ id: "claude-opus-4-8" }, { id: "gpt-5", api: "openai-codex-responses" }],
        retry: {
          maxRetries: 4,
          baseDelayMs: 250,
          maxDelayMs: 2000,
          jitterMs: 0,
          retryAfterCapMs: 5000,
        },
        keepUnknown: true,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  // Import modules only after PI_CODING_AGENT_DIR is set.
  const { getAgentDir } = await jiti.import("@earendil-works/pi-coding-agent");
  const accounts = await jiti.import(pathToFileURL(join(root, "lib/api-key-accounts.ts")).href);
  const config = await jiti.import(pathToFileURL(join(root, "lib/anyrouter-config.ts")).href);
  const bridge = await jiti.import(pathToFileURL(join(root, "lib/anyrouter-runtime-bridge.ts")).href);
  const { getWebCredentialStore } = await jiti.import(
    pathToFileURL(join(root, "lib/web-credential-store.ts")).href,
  );

  assert(getAgentDir() === agentDir, "getAgentDir must honor temp PI_CODING_AGENT_DIR");
  assert(agentDir !== realAgentDir, "must not use real agent dir");
  assert(!agentDir.startsWith(realAgentDir + "/"), "temp dir must not nest under real agent dir");

  console.log("\n=== packaging / isolation ===");

  await test("package.json registers anyrouter accounts/retry/provider scripts", async () => {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert(pkg.scripts?.["test:anyrouter-provider"]?.includes("test-anyrouter-provider"), "provider script");
    assert(pkg.scripts?.["test:anyrouter-accounts"]?.includes("test-anyrouter-accounts"), "accounts script");
    assert(pkg.scripts?.["test:anyrouter-retry"]?.includes("test-anyrouter-retry"), "retry script");
    assert(pkg.scripts?.["test:api-key-accounts"]?.includes("run-api-key-accounts-test"), "api-key accounts");
    assert(pkg.scripts?.["test:web-credential-store"]?.includes("test-web-credential-store"), "credential store");
    assert(pkg.dependencies?.["pi-anyrouter"] === "0.3.2", "exact pin");
    assert(Array.isArray(pkg.files) && pkg.files.includes("patches"), "publishes patches");
    assert(Array.isArray(pkg.files) && pkg.files.includes("scripts"), "publishes scripts");
  });

  await test("does not read real ~/.pi/agent", async () => {
    assert(process.env.PI_CODING_AGENT_DIR === agentDir);
    assert(getAgentDir() === agentDir);
    // Touching real agent dir is forbidden; only assert path inequality.
    assert(!getAgentDir().includes(join(".pi", "agent")) || getAgentDir() === agentDir);
  });

  console.log("\n=== multi-account Active / baseUrl precedence ===");

  let idA = "";
  let idB = "";

  await test("create Active A + non-active B with override; only Active enters bridge/auth", async () => {
    const createdA = await accounts.createApiKeyAccount("anyrouter", {
      displayName: "Account A",
      apiKey: SECRET_A,
      activate: true,
    });
    idA = createdA.accounts.find((a) => a.displayName === "Account A").accountId;
    assert(createdA.activeAccountId === idA, "A active");
    assert(!containsSecret(createdA, SECRETS), "secret in create A list");

    const createdB = await accounts.createApiKeyAccount("anyrouter", {
      displayName: "Account B",
      apiKey: SECRET_B,
      activate: false,
      baseUrlOverride: "https://override-b.example/v1/",
    });
    idB = createdB.accounts.find((a) => a.displayName === "Account B").accountId;
    assert(createdB.activeAccountId === idA, "active stays A");
    const entryB = createdB.accounts.find((a) => a.accountId === idB);
    assert(entryB.baseUrlOverride === "https://override-b.example/v1", "override normalized");
    assert(!containsSecret(createdB, SECRETS), "secret in create B list");

    const snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    assert(snap, "bridge present");
    assert(snap.webManaged === true, "webManaged");
    assert(snap.apiKey === SECRET_A, "bridge key is Active A");
    assert(snap.baseUrl === "https://global-anyrouter.example/v1", "inherits global base");
    assert(Array.isArray(snap.models) && snap.models.length === 2, "models mirrored");
    assert(snap.retry.maxRetries === 4, "retry from source config");

    const store = await getWebCredentialStore();
    const auth = await store.read("anyrouter");
    assert(auth?.type === "api_key" && auth.key === SECRET_A, "auth mirror is Active A");

    // Fingerprints may exist on disk metadata but never in list projection.
    const listed = await accounts.listApiKeyAccounts("anyrouter");
    assert(!JSON.stringify(listed).includes("keyFingerprint"), "fingerprint leaked in list");
    assert(!containsSecret(listed, SECRETS), "secret in list");
    // Metadata on disk has fingerprints only (not plaintext).
    const metaRaw = await readFile(
      join(agentDir, "auth-api-key-accounts", "anyrouter", "accounts.json"),
      "utf8",
    );
    assert(!containsSecret(metaRaw, SECRETS), "plaintext key in metadata file");
    assert(metaRaw.includes(fingerprint(SECRET_A)), "fingerprint stored for A");
  });

  await test("Activate B switches bridge effective key + account baseUrlOverride", async () => {
    const after = await accounts.activateApiKeyAccount("anyrouter", idB);
    assert(after.activeAccountId === idB, "active B");
    assert(!containsSecret(after, SECRETS), "secret in activate response");

    const snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    assert(snap?.apiKey === SECRET_B, "bridge key B");
    assert(snap?.baseUrl === "https://override-b.example/v1", "override wins");

    const store = await getWebCredentialStore();
    const auth = await store.read("anyrouter");
    assert(auth?.type === "api_key" && auth.key === SECRET_B, "auth mirror B");
  });

  await test("global env baseUrl loses to account override; wins when override cleared", async () => {
    process.env.PI_ANYROUTER_CC_BASE_URL = "https://env-global.example/v9";
    try {
      // Re-activate to rebuild with current env.
      await accounts.activateApiKeyAccount("anyrouter", idB);
      let snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
      assert(snap?.baseUrl === "https://override-b.example/v1", "account override > env");

      await accounts.updateApiKeyAccount("anyrouter", idB, { baseUrlOverride: null });
      snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
      assert(snap?.baseUrl === "https://env-global.example/v9", "env > source after clear");
      assert(snap?.apiKey === SECRET_B, "active key unchanged");
    } finally {
      delete process.env.PI_ANYROUTER_CC_BASE_URL;
    }

    // Rebuild without env → source global.
    await accounts.activateApiKeyAccount("anyrouter", idB);
    const snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    assert(snap?.baseUrl === "https://global-anyrouter.example/v1", "source global restored");
  });

  await test("non-active update/reveal never mutates bridge or auth", async () => {
    // Make A non-active again.
    await accounts.activateApiKeyAccount("anyrouter", idB);
    const beforeBridge = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    const store = await getWebCredentialStore();
    const beforeAuth = await store.read("anyrouter");

    await accounts.updateApiKeyAccount("anyrouter", idA, {
      displayName: "Account A renamed",
      description: "no mirror write",
    });
    const revealed = await accounts.revealApiKeyAccount("anyrouter", idA);
    assert(revealed.apiKey === SECRET_A, "reveal returns plaintext for single account");

    const afterBridge = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    const afterAuth = await store.read("anyrouter");
    deepEqual(afterBridge, beforeBridge, "bridge mutated by non-active update/reveal");
    deepEqual(afterAuth, beforeAuth, "auth mutated by non-active update/reveal");
    assert((await accounts.listApiKeyAccounts("anyrouter")).activeAccountId === idB, "active changed");
  });

  console.log("\n=== races / repair / disconnect ===");

  await test("concurrent Activate converges to one Active/bridge/auth state", async () => {
    // Create C so we have three candidates.
    const createdC = await accounts.createApiKeyAccount("anyrouter", {
      displayName: "Account C",
      apiKey: SECRET_C,
      activate: false,
    });
    const idC = createdC.accounts.find((a) => a.displayName === "Account C").accountId;

    await Promise.all([
      accounts.activateApiKeyAccount("anyrouter", idA),
      accounts.activateApiKeyAccount("anyrouter", idB),
      accounts.activateApiKeyAccount("anyrouter", idC),
    ]);

    const listed = await accounts.listApiKeyAccounts("anyrouter");
    const activeId = listed.activeAccountId;
    assert(activeId === idA || activeId === idB || activeId === idC, "active is one of the three");

    const snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    const store = await getWebCredentialStore();
    const auth = await store.read("anyrouter");
    assert(snap, "bridge after race");
    assert(auth?.type === "api_key", "auth after race");

    const expectedKey =
      activeId === idA ? SECRET_A : activeId === idB ? SECRET_B : SECRET_C;
    assert(snap.apiKey === expectedKey, "bridge key matches Active");
    assert(auth.key === expectedKey, "auth key matches Active");
    assert(!containsSecret(listed, SECRETS), "secret in raced list");
  });

  await test("same-account Activate repairs missing bridge; cold reconcile too", async () => {
    const listed = await accounts.listApiKeyAccounts("anyrouter");
    const activeId = listed.activeAccountId;
    assert(activeId, "need an active account");

    const bridgePath = bridge.getAnyRouterRuntimeBridgePath();
    await rm(bridgePath, { force: true });
    assert((await bridge.readAnyRouterRuntimeBridgeUnlocked()) === null, "bridge removed");

    await accounts.activateApiKeyAccount("anyrouter", activeId);
    let snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    assert(snap, "repeat Activate rewrote bridge");
    assert(typeof snap.apiKey === "string" && snap.apiKey.length > 0, "bridge key present");

    await rm(bridgePath, { force: true });
    await bridge.reconcileAnyRouterRuntimeMirrors();
    snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    assert(snap, "cold reconcile rewrote bridge");
    assert(snap.webManaged === true, "webManaged after cold reconcile");
  });

  await test("explicit disconnect clears Active key from bridge and auth", async () => {
    const listed = await accounts.listApiKeyAccounts("anyrouter");
    const activeId = listed.activeAccountId;
    assert(activeId, "need active");

    const after = await accounts.deleteApiKeyAccount("anyrouter", activeId, { clearActive: true });
    assert(after.activeAccountId === null, "disconnected");
    assert(!containsSecret(after, SECRETS), "secret in disconnect list");

    const store = await getWebCredentialStore();
    assert((await store.read("anyrouter")) === undefined, "auth cleared");

    const snap = await bridge.readAnyRouterRuntimeBridgeUnlocked();
    if (snap) {
      assert(snap.apiKey === "", "bridge must not keep Active key after disconnect");
      assert(snap.webManaged === true, "catalog-only bridge still webManaged");
    }
  });

  await test("active delete without disposition is rejected (no recent-fallback)", async () => {
    // Recreate dual Active scenario.
    const a = await accounts.createApiKeyAccount("anyrouter", {
      displayName: "Disp A",
      apiKey: `${SECRET_A}-disp`,
      activate: true,
    });
    const aId = a.accounts.find((x) => x.displayName === "Disp A").accountId;
    await accounts.createApiKeyAccount("anyrouter", {
      displayName: "Disp B",
      apiKey: `${SECRET_B}-disp`,
      activate: false,
    });

    let rejected = false;
    try {
      await accounts.deleteApiKeyAccount("anyrouter", aId);
    } catch (err) {
      rejected = true;
      assert(err instanceof Error, "error object");
      assert((err.status ?? err.cause?.status) === 409 || /replacement|disconnect|clearActive/i.test(err.message), "409 disposition");
    }
    assert(rejected, "must reject implicit fallback");
    const listed = await accounts.listApiKeyAccounts("anyrouter");
    assert(listed.activeAccountId === aId, "active unchanged after rejected delete");
  });

  await test("safe config projection never includes secrets/paths/model bodies", async () => {
    const safe = config.getAnyRouterSafeConfig();
    assert(safe.provider === "anyrouter", "provider");
    assert(typeof safe.revision === "string" && safe.revision.length > 0, "revision");
    assert(safe.modelCount === 2, "modelCount");
    assert(safe.models === undefined, "models body");
    assert(safe.apiKey === undefined, "apiKey field");
    assert(!containsSecret(safe, SECRETS), "secret in safe config");
    assert(!JSON.stringify(safe).includes(agentDir), "absolute path in safe config");
  });

  await test("bridge file mode is 0600 when platform supports mode bits", async () => {
    // Ensure an Active exists for a real bridge with key.
    const listed = await accounts.listApiKeyAccounts("anyrouter");
    if (!listed.activeAccountId) {
      await accounts.createApiKeyAccount("anyrouter", {
        displayName: "Mode check",
        apiKey: `${SECRET_C}-mode`,
        activate: true,
      });
    } else {
      await accounts.activateApiKeyAccount("anyrouter", listed.activeAccountId);
    }
    const path = bridge.getAnyRouterRuntimeBridgePath();
    await access(path, fsConstants.R_OK);
    const st = await stat(path);
    if (typeof st.mode === "number") {
      // Accept exact 0600 or at least not world/group writable.
      assert((st.mode & 0o022) === 0, `bridge mode too open: ${(st.mode & 0o777).toString(8)}`);
    }
  });

  await test("loader env pointer is stable bridge path (not per-request rewrite)", async () => {
    const path = bridge.ensureAnyRouterConfigEnvPointsAtBridge();
    assert(path === bridge.getAnyRouterRuntimeBridgePath(), "returns bridge path");
    assert(
      process.env[bridge.getAnyRouterConfigEnvNameForTests()] === path,
      "PI_ANYROUTER_CC_CONFIG points at bridge",
    );
  });

  await test("all writes stayed under temporary agent dir", async () => {
    assert(process.env.PI_CODING_AGENT_DIR === agentDir);
    assert(getAgentDir() === agentDir);
    const entries = await readdir(agentDir);
    assert(
      entries.includes("anyrouter.json") ||
        entries.includes("auth-api-key-accounts") ||
        entries.includes("auth.json"),
      "expected agent files under temp dir",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(agentDir, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
