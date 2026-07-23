#!/usr/bin/env node
/**
 * Focused AR-04 route contract tests for AnyRouter account/config APIs.
 *
 * Uses a temporary PI_CODING_AGENT_DIR and never touches ~/.pi/agent.
 * Network is not used. Secrets must never appear in ordinary responses.
 *
 * Run: node scripts/test-anyrouter-api-routes.mjs
 */

import { createJiti } from "jiti";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${message}`);
    failed += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function deepHasSecret(value, secret) {
  if (value == null) return false;
  if (typeof value === "string") return value.includes(secret);
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some((v) => deepHasSecret(v, secret));
  if (typeof value === "object") {
    return Object.values(value).some((v) => deepHasSecret(v, secret));
  }
  return false;
}

function params(provider, accountId) {
  if (accountId) return { params: Promise.resolve({ provider, accountId }) };
  return { params: Promise.resolve({ provider }) };
}

async function jsonOf(res) {
  const text = await res.text();
  try {
    return { status: res.status, headers: res.headers, body: JSON.parse(text), text };
  } catch {
    return { status: res.status, headers: res.headers, body: null, text };
  }
}

async function main() {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-anyrouter-api-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  // Prevent accidental real-home leakage if a dependency re-resolves agent dir.
  assert(process.env.PI_CODING_AGENT_DIR === agentDir, "temp agent dir not set");

  // Seed a minimal anyrouter.json without secrets/models path leakage.
  await writeFile(
    join(agentDir, "anyrouter.json"),
    JSON.stringify(
      {
        baseUrl: "https://anyrouter.example/v1",
        models: [{ id: "claude-opus-4-8" }, { id: "gpt-5" }],
        retry: { maxRetries: 3 },
        legacyNote: "keep-me",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );

  // Exercise account/config routes (no full ModelRuntime boot) plus a
  // lightweight all-providers projection via the service layer.

  const accounts = await jiti.import(pathToFileURL(join(root, "lib/api-key-accounts.ts")).href);
  const config = await jiti.import(pathToFileURL(join(root, "lib/anyrouter-config.ts")).href);
  const helpers = await jiti.import(pathToFileURL(join(root, "lib/api-key-route-helpers.ts")).href);

  const configRoute = await jiti.import(
    pathToFileURL(join(root, "app/api/auth/api-key/[provider]/config/route.ts")).href,
  );
  const accountsRoute = await jiti.import(
    pathToFileURL(join(root, "app/api/auth/api-key/[provider]/accounts/route.ts")).href,
  );
  const accountRoute = await jiti.import(
    pathToFileURL(
      join(root, "app/api/auth/api-key/[provider]/accounts/[accountId]/route.ts"),
    ).href,
  );
  const activateRoute = await jiti.import(
    pathToFileURL(
      join(root, "app/api/auth/api-key/[provider]/accounts/[accountId]/activate/route.ts"),
    ).href,
  );
  const revealRoute = await jiti.import(
    pathToFileURL(
      join(root, "app/api/auth/api-key/[provider]/accounts/[accountId]/reveal/route.ts"),
    ).href,
  );

  const SECRET_A = `ar-secret-a-${randomBytes(8).toString("hex")}`;
  const SECRET_B = `ar-secret-b-${randomBytes(8).toString("hex")}`;
  const SENTINELS = [SECRET_A, SECRET_B];

  console.log("AnyRouter AR-04 API route contracts\n");

  await test("config GET is no-store and has no secrets/paths/models bodies", async () => {
    const res = await configRoute.GET(new Request("http://local/api"), params("anyrouter"));
    const { status, headers, body, text } = await jsonOf(res);
    assert(status === 200, `status ${status}`);
    assert(headers.get("cache-control") === "no-store", "missing no-store");
    assert(body.provider === "anyrouter", "provider");
    assert(typeof body.revision === "string" && body.revision.length > 0, "revision");
    assert(body.globalBaseUrl === "https://anyrouter.example/v1", "baseUrl");
    assert(body.modelsConfigured === true, "modelsConfigured");
    assert(body.modelCount === 2, "modelCount");
    assert(body.retry?.effective?.maxRetries === 3, "retry effective");
    assert(body.retry?.source?.maxRetries === "config", "retry source");
    assert(body.apiKey === undefined, "apiKey leaked");
    assert(body.models === undefined, "models body leaked");
    assert(!text.includes(agentDir), "absolute path leaked");
    assert(!text.includes("legacyNote"), "unknown raw field leaked");
    for (const s of SENTINELS) assert(!text.includes(s), "sentinel in config GET");
  });

  await test("config GET rejects non-anyrouter provider", async () => {
    const res = await configRoute.GET(new Request("http://local/api"), params("xai"));
    const { status, body } = await jsonOf(res);
    assert(status === 400, `status ${status}`);
    assert(typeof body.error === "string", "error message");
  });

  await test("config PATCH rejects forbidden fields and stale revision", async () => {
    const getRes = await configRoute.GET(new Request("http://local/api"), params("anyrouter"));
    const { body: before } = await jsonOf(getRes);

    const forbidden = await configRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: before.revision,
          baseUrl: "https://ok.example",
          apiKey: "should-reject",
          models: [{ id: "x" }],
          path: "/etc/passwd",
        }),
      }),
      params("anyrouter"),
    );
    const f = await jsonOf(forbidden);
    assert(f.status === 400, `forbidden status ${f.status}`);
    assert(!deepHasSecret(f.body, "should-reject"), "forbidden key echoed");

    const stale = await configRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: "deadbeefdeadbeef", baseUrl: "https://ok.example" }),
      }),
      params("anyrouter"),
    );
    const s = await jsonOf(stale);
    assert(s.status === 409, `stale status ${s.status}`);
    assert(s.body.code === "stale_revision", "stale code");
  });

  await test("config PATCH updates baseUrl with CAS and preserves models/apiKey/unknown", async () => {
    const getRes = await configRoute.GET(new Request("http://local/api"), params("anyrouter"));
    const { body: before } = await jsonOf(getRes);

    const patchRes = await configRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: before.revision,
          baseUrl: "https://patched.example/v1/",
          retry: { maxRetries: 5 },
        }),
      }),
      params("anyrouter"),
    );
    const p = await jsonOf(patchRes);
    assert(p.status === 200, `status ${p.status}: ${p.text}`);
    assert(p.headers.get("cache-control") === "no-store", "no-store");
    assert(p.body.globalBaseUrl === "https://patched.example/v1", "normalized baseUrl");
    assert(p.body.retry.effective.maxRetries === 5, "retry patch");
    assert(p.body.modelCount === 2, "modelCount preserved");
    assert(p.body.revision !== before.revision, "revision advanced");

    const raw = config.readAnyrouterConfigRaw();
    assert(Array.isArray(raw.models) && raw.models.length === 2, "models preserved on disk");
    assert(raw.parsed.legacyNote === "keep-me", "unknown field preserved");
    assert(raw.apiKey == null || raw.apiKey === null, "no accidental apiKey write");
  });

  let accountA = null;
  let accountB = null;

  await test("create two accounts with baseUrlOverride; list is masked", async () => {
    const createA = await accountsRoute.POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Primary",
          description: "active one",
          apiKey: SECRET_A,
          activate: true,
        }),
      }),
      params("anyrouter"),
    );
    const a = await jsonOf(createA);
    assert(a.status === 200, `create A ${a.status}: ${a.text}`);
    assert(a.body.accountCount === 1, "count 1");
    accountA = a.body.accounts.find((x) => x.active)?.accountId;
    assert(accountA, "active account id");
    for (const s of SENTINELS) assert(!deepHasSecret(a.body, s), "secret in create A");
    assert(!JSON.stringify(a.body).includes("keyFingerprint"), "fingerprint in list");

    const createB = await accountsRoute.POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Secondary",
          apiKey: SECRET_B,
          activate: false,
          baseUrlOverride: "https://override-b.example/v1/",
        }),
      }),
      params("anyrouter"),
    );
    const b = await jsonOf(createB);
    assert(b.status === 200, `create B ${b.status}: ${b.text}`);
    assert(b.body.accountCount === 2, "count 2");
    accountB = b.body.accounts.find((x) => x.accountId !== accountA)?.accountId;
    assert(accountB, "account B");
    const entryB = b.body.accounts.find((x) => x.accountId === accountB);
    assert(entryB.baseUrlOverride === "https://override-b.example/v1", "override normalized");
    assert(b.body.activeAccountId === accountA, "active unchanged");
    for (const s of SENTINELS) assert(!deepHasSecret(b.body, s), "secret in create B");
  });

  await test("create rejects unknown body fields", async () => {
    const res = await accountsRoute.POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "X",
          apiKey: "k",
          headers: { Authorization: "Bearer x" },
        }),
      }),
      params("anyrouter"),
    );
    const r = await jsonOf(res);
    assert(r.status === 400, `status ${r.status}`);
  });

  await test("reveal is no-store and single-account only", async () => {
    const res = await revealRoute.POST(
      new Request("http://local/api", { method: "POST" }),
      params("anyrouter", accountA),
    );
    const r = await jsonOf(res);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.headers.get("cache-control") === "no-store", "no-store");
    assert(r.body.accountId === accountA, "accountId");
    assert(r.body.apiKey === SECRET_A, "key");
    assert(Object.keys(r.body).sort().join(",") === "accountId,apiKey", "allowlisted keys");
  });

  await test("active delete without disposition fails closed", async () => {
    const res = await accountRoute.DELETE(
      new Request("http://local/api", { method: "DELETE" }),
      params("anyrouter", accountA),
    );
    const r = await jsonOf(res);
    assert(r.status === 409, `status ${r.status}`);
    assert(/replacement|disconnect|clearActive/i.test(r.body.error || ""), "message");
    const listed = await accounts.listApiKeyAccounts("anyrouter");
    assert(listed.activeAccountId === accountA, "active unchanged after rejected delete");
  });

  await test("active delete with explicit replacement switches Active", async () => {
    const res = await accountRoute.DELETE(
      new Request("http://local/api", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replacementAccountId: accountB }),
      }),
      params("anyrouter", accountA),
    );
    const r = await jsonOf(res);
    assert(r.status === 200, `status ${r.status}: ${r.text}`);
    assert(r.body.activeAccountId === accountB, "active switched");
    assert(r.body.accountCount === 1, "count 1");
    accountA = null;
    for (const s of SENTINELS) assert(!deepHasSecret(r.body, s), "secret in delete");
  });

  await test("activate re-syncs Active and returns masked list", async () => {
    // Recreate A and activate it.
    const createA = await accountsRoute.POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Primary again",
          apiKey: SECRET_A,
          activate: false,
        }),
      }),
      params("anyrouter"),
    );
    const a = await jsonOf(createA);
    assert(a.status === 200, `recreate A ${a.status}`);
    accountA = a.body.accounts.find((x) => x.displayName === "Primary again")?.accountId;
    assert(accountA, "recreated A");

    const act = await activateRoute.POST(
      new Request("http://local/api", { method: "POST" }),
      params("anyrouter", accountA),
    );
    const r = await jsonOf(act);
    assert(r.status === 200, `activate ${r.status}: ${r.text}`);
    assert(r.body.activeAccountId === accountA, "active");
    for (const s of SENTINELS) assert(!deepHasSecret(r.body, s), "secret in activate");
  });

  await test("active disable requires clearActive or replacement", async () => {
    const bad = await accountRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disable" }),
      }),
      params("anyrouter", accountA),
    );
    const b = await jsonOf(bad);
    assert(b.status === 409, `status ${b.status}`);

    const okRes = await accountRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disable", clearActive: true }),
      }),
      params("anyrouter", accountA),
    );
    const o = await jsonOf(okRes);
    assert(o.status === 200, `status ${o.status}: ${o.text}`);
    assert(o.body.activeAccountId === null, "cleared");
    const entry = o.body.accounts.find((x) => x.accountId === accountA);
    assert(entry?.disabled === true, "disabled");
  });

  await test("PATCH baseUrlOverride allowlist + clear", async () => {
    // re-enable and set override
    const en = await accountRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      }),
      params("anyrouter", accountA),
    );
    assert((await jsonOf(en)).status === 200, "enable");

    const set = await accountRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrlOverride: "https://acc-override.example/v2/" }),
      }),
      params("anyrouter", accountA),
    );
    const s = await jsonOf(set);
    assert(s.status === 200, `set ${s.status}`);
    const entry = s.body.accounts.find((x) => x.accountId === accountA);
    assert(entry.baseUrlOverride === "https://acc-override.example/v2", "override");

    const cleared = await accountRoute.PATCH(
      new Request("http://local/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrlOverride: null }),
      }),
      params("anyrouter", accountA),
    );
    const c = await jsonOf(cleared);
    assert(c.status === 200, "clear");
    const entry2 = c.body.accounts.find((x) => x.accountId === accountA);
    assert(entry2.baseUrlOverride === undefined, "cleared override");
  });

  await test("xAI create still works (wire-compatible, no baseUrlOverride required)", async () => {
    const res = await accountsRoute.POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "xAI key",
          apiKey: `xai-${randomBytes(6).toString("hex")}`,
          activate: true,
        }),
      }),
      params("xai"),
    );
    const r = await jsonOf(res);
    assert(r.status === 200, `status ${r.status}: ${r.text}`);
    assert(r.body.provider === "xai", "provider");
    assert(r.body.authMode === "managed_accounts", "authMode");
    assert(r.body.accountCount === 1, "count");
  });

  await test("helper rejects nested secret-ish body keys", async () => {
    try {
      helpers.assertBodyAllowlist(
        { displayName: "a", headers: { Authorization: "x" } },
        new Set(["displayName", "headers"]),
        "test",
      );
      throw new Error("should have rejected headers");
    } catch (err) {
      assert(err instanceof accounts.ApiKeyAccountStoreError || err?.name === "ApiKeyAccountStoreError", "store error");
    }
  });

  await test("recoverable AnyRouter summary exists with 0 models/no runtime", async () => {
    const summary = await accounts.getApiKeyProviderSummary("anyrouter");
    assert(summary, "summary");
    assert(summary.authMode === "managed_accounts", "authMode");
    assert(summary.accountCount >= 1, "accountCount");
    // Managed accounts exist → configured true even without runtime catalog.
    assert(summary.configured === true, "configured");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await rm(agentDir, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
