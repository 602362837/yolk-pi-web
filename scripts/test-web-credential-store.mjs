#!/usr/bin/env node
/**
 * Focused tests for Web CredentialStore foundation (SDK-01).
 *
 * Always runs against a temporary directory — never touches ~/.pi/agent.
 *
 * Run: npm run test:web-credential-store
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function loadModules() {
  const storeMod = await jiti.import(join(root, "lib/web-credential-store.ts"));
  const configMod = await jiti.import(join(root, "lib/web-auth-config-value.ts"));
  return { storeMod, configMod };
}

async function main() {
  console.log("\n=== web-credential-store foundation ===\n");
  const { storeMod, configMod } = await loadModules();
  const {
    createWebCredentialStore,
    getWebCredentialStore,
    createInMemoryWebCredentialStore,
    readRawStoredCredential,
    __webCredentialStoreUsesFsLockForTests,
    __resetWebCredentialStoreCacheForTests,
  } = storeMod;
  const { resolveConfigValue, isCommandConfigValue, clearConfigValueCache } = configMod;

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-web-cred-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  __resetWebCredentialStoreCacheForTests();
  clearConfigValueCache();

  const authPath = join(agentDir, "auth.json");
  const SECRET_A = `secret-a-${randomBytes(8).toString("hex")}`;
  const SECRET_B = `secret-b-${randomBytes(8).toString("hex")}`;
  const OAUTH_ACCESS = `oauth-access-${randomBytes(6).toString("hex")}`;

  try {
    await test("uses fs mkdir lock primitives (no proper-lockfile)", () => {
      assert.equal(__webCredentialStoreUsesFsLockForTests(), true);
    });

    await test("missing auth.json read/list return empty", async () => {
      const store = await createWebCredentialStore({ authPath });
      assert.equal(await store.read("openai"), undefined);
      assert.deepEqual(await store.list(), []);
    });

    await test("modify creates 0700 dir and 0600 auth.json", async () => {
      const store = await createWebCredentialStore({ authPath });
      await store.modify("openai", async () => ({ type: "api_key", key: SECRET_A }));
      const fileStat = await stat(authPath);
      const dirStat = await stat(agentDir);
      assert.equal(fileStat.mode & 0o777, 0o600, "auth.json mode 0600");
      // Some platforms mask directory sticky bits; require owner rwx at minimum.
      assert.ok((dirStat.mode & 0o700) === 0o700, "agent dir owner rwx");
      const raw = JSON.parse(await readFile(authPath, "utf8"));
      assert.equal(raw.openai.key, SECRET_A);
    });

    await test("modify(undefined) does not delete existing credential", async () => {
      const store = await createWebCredentialStore({ authPath });
      const result = await store.modify("openai", async () => undefined);
      assert.equal(result?.type, "api_key");
      assert.equal(result?.key, SECRET_A);
      const raw = JSON.parse(await readFile(authPath, "utf8"));
      assert.equal(raw.openai.key, SECRET_A);
    });

    await test("OAuth provider-specific fields are preserved", async () => {
      const store = await createWebCredentialStore({ authPath });
      await store.modify("grok-cli", async () => ({
        type: "oauth",
        access: OAUTH_ACCESS,
        refresh: "refresh-token-value",
        expires: Date.now() + 60_000,
        email: "user@example.com",
        extraProviderField: { nested: true, id: "x" },
      }));
      const raw = await readRawStoredCredential("grok-cli", authPath);
      assert.equal(raw?.type, "oauth");
      assert.equal(raw?.access, OAUTH_ACCESS);
      assert.equal(raw?.email, "user@example.com");
      assert.deepEqual(raw?.extraProviderField, { nested: true, id: "x" });
      const resolved = await store.read("grok-cli");
      assert.equal(resolved?.access, OAUTH_ACCESS);
      assert.deepEqual(resolved?.extraProviderField, { nested: true, id: "x" });
    });

    await test("concurrent different-provider writes preserve both", async () => {
      const store = await createWebCredentialStore({ authPath });
      await Promise.all([
        store.modify("provider-a", async () => ({ type: "api_key", key: SECRET_A })),
        store.modify("provider-b", async () => ({ type: "api_key", key: SECRET_B })),
      ]);
      const raw = JSON.parse(await readFile(authPath, "utf8"));
      assert.equal(raw["provider-a"].key, SECRET_A);
      assert.equal(raw["provider-b"].key, SECRET_B);
      // openai + grok-cli from earlier tests must still be present
      assert.equal(raw.openai?.key, SECRET_A);
      assert.equal(raw["grok-cli"]?.type, "oauth");
    });

    await test("same-provider concurrent modify serializes", async () => {
      const store = await createWebCredentialStore({ authPath });
      const order = [];
      await Promise.all([
        store.modify("serial", async (current) => {
          order.push("a-start");
          await new Promise((r) => setTimeout(r, 30));
          order.push("a-end");
          return { type: "api_key", key: `a-${current?.key ?? "none"}` };
        }),
        store.modify("serial", async (current) => {
          order.push("b-start");
          await new Promise((r) => setTimeout(r, 5));
          order.push("b-end");
          return { type: "api_key", key: `b-${current?.key ?? "none"}` };
        }),
      ]);
      // Strict serial queue: second starts only after first fully completes.
      assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
      const final = await store.read("serial");
      assert.ok(final?.key?.startsWith("b-"));
    });

    await test("delete removes only the target provider", async () => {
      const store = await createWebCredentialStore({ authPath });
      await store.delete("provider-a");
      const raw = JSON.parse(await readFile(authPath, "utf8"));
      assert.equal(raw["provider-a"], undefined);
      assert.equal(raw["provider-b"].key, SECRET_B);
    });

    await test("malformed JSON fail-closed and leaves file bytes unchanged", async () => {
      const brokenPath = join(agentDir, "broken-auth.json");
      const broken = "{ not-json ";
      await writeFile(brokenPath, broken, { mode: 0o600 });
      const before = await readFile(brokenPath);
      const store = await createWebCredentialStore({ authPath: brokenPath });
      await assert.rejects(
        () => store.modify("x", async () => ({ type: "api_key", key: "nope" })),
        /malformed JSON|not a JSON object/,
      );
      const after = await readFile(brokenPath);
      assert.deepEqual(after, before, "broken file must not be rewritten");
      await assert.rejects(() => store.read("x"), /malformed JSON|not a JSON object/);
      await assert.rejects(() => store.list(), /malformed JSON|not a JSON object/);
    });

    await test("API key literal / env / escape / command resolution", async () => {
      clearConfigValueCache();
      process.env.YPI_WEB_CRED_TEST_KEY = "from-env-value";
      assert.equal(resolveConfigValue("literal-key"), "literal-key");
      assert.equal(resolveConfigValue("$YPI_WEB_CRED_TEST_KEY"), "from-env-value");
      assert.equal(resolveConfigValue("${YPI_WEB_CRED_TEST_KEY}"), "from-env-value");
      assert.equal(resolveConfigValue("pre-${YPI_WEB_CRED_TEST_KEY}-post"), "pre-from-env-value-post");
      assert.equal(resolveConfigValue("$$not-env"), "$not-env");
      assert.equal(resolveConfigValue("$!not-cmd"), "!not-cmd");
      assert.equal(isCommandConfigValue("!printf hello"), true);
      assert.equal(resolveConfigValue("!printf 'cmd-out'"), "cmd-out");

      const store = await createWebCredentialStore({ authPath });
      await store.modify("env-key", async () => ({
        type: "api_key",
        key: "$YPI_WEB_CRED_TEST_KEY",
      }));
      await store.modify("cmd-key", async () => ({
        type: "api_key",
        key: "!printf 'cmd-secret'",
      }));
      const envResolved = await store.read("env-key");
      assert.equal(envResolved?.key, "from-env-value");
      const cmdResolved = await store.read("cmd-key");
      assert.equal(cmdResolved?.key, "cmd-secret");

      // list() must not execute commands or expose secrets
      const listed = await store.list();
      const listedText = JSON.stringify(listed);
      assert.ok(!listedText.includes("from-env-value"));
      assert.ok(!listedText.includes("cmd-secret"));
      assert.ok(!listedText.includes(SECRET_A));
      assert.ok(listed.some((c) => c.providerId === "cmd-key" && c.type === "api_key"));
    });

    await test("errors and list metadata never include secrets", async () => {
      const store = await createWebCredentialStore({ authPath });
      try {
        await store.modify("err-provider", async () => {
          throw new Error(`boom ${SECRET_A}`);
        });
        assert.fail("expected modify callback error");
      } catch (err) {
        // Callback errors propagate as-is (caller owned); storage wrapper errors must not.
        assert.ok(err instanceof Error);
      }
      const listText = JSON.stringify(await store.list());
      assert.ok(!listText.includes(SECRET_A), `list leaked ${fingerprint(SECRET_A)}`);
      assert.ok(!listText.includes(SECRET_B));
      assert.ok(!listText.includes(OAUTH_ACCESS));
    });

    await test("getWebCredentialStore reuses coordinator by path", async () => {
      __resetWebCredentialStoreCacheForTests();
      const a = await getWebCredentialStore({ authPath });
      const b = await getWebCredentialStore({ authPath });
      assert.equal(a, b);
      assert.equal(a.authPath, authPath);
    });

    await test("in-memory store is isolated from auth.json", async () => {
      const mem = createInMemoryWebCredentialStore({
        temp: { type: "api_key", key: "mem-only" },
      });
      assert.equal((await mem.read("temp"))?.key, "mem-only");
      await mem.modify("temp2", async () => ({ type: "api_key", key: "mem2" }));
      const fileStore = await createWebCredentialStore({ authPath });
      assert.equal(await fileStore.read("temp"), undefined);
      assert.equal(await fileStore.read("temp2"), undefined);
    });

    await test("cross-process lock serializes writers", async () => {
      const childScript = `
        const { createJiti } = require("jiti");
        const { join } = require("path");
        const root = ${JSON.stringify(root)};
        const authPath = ${JSON.stringify(authPath)};
        const jiti = createJiti(join(root, "package.json"), { interopDefault: true });
        (async () => {
          const mod = await jiti.import(join(root, "lib/web-credential-store.ts"));
          const store = await mod.createWebCredentialStore({ authPath });
          await store.modify("cross-proc", async (current) => {
            await new Promise((r) => setTimeout(r, 80));
            return { type: "api_key", key: "child-" + (current?.key ?? "none") };
          });
          process.stdout.write("ok");
        })().catch((err) => {
          console.error(err);
          process.exit(1);
        });
      `;
      const store = await createWebCredentialStore({ authPath });
      const parent = store.modify("cross-proc", async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { type: "api_key", key: "parent" };
      });
      const child = await new Promise((resolveChild, rejectChild) => {
        const proc = spawn(process.execPath, ["-e", childScript], {
          cwd: root,
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        proc.stdout.on("data", (d) => {
          out += d;
        });
        proc.stderr.on("data", (d) => {
          err += d;
        });
        proc.on("exit", (code) => {
          if (code === 0) resolveChild(out);
          else rejectChild(new Error(`child failed (${code}): ${err}`));
        });
      });
      await parent;
      assert.equal(child, "ok");
      const final = await store.read("cross-proc");
      // Whichever finished last wins, but both must have run under lock so the
      // file remains valid JSON with a single credential entry.
      assert.equal(final?.type, "api_key");
      assert.ok(final?.key === "parent" || final?.key?.startsWith("child-"));
      JSON.parse(await readFile(authPath, "utf8"));
    });
  } finally {
    __resetWebCredentialStoreCacheForTests();
    clearConfigValueCache();
    delete process.env.YPI_WEB_CRED_TEST_KEY;
    await rm(agentDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
