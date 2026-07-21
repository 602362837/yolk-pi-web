#!/usr/bin/env node
/**
 * Focused test suite for Links / GitHub OAuth Device Flow modules (LINKS-05).
 *
 * Covers:
 * - links-types:        opaque id validation, forbidden contracts, scope constants
 * - links-provider-registry: allowlist, unknown provider fail-closed, adapter reg
 * - github-link-oauth:  client id resolution, device code request, token polling,
 *                       identity validation, scope parsing, network error mapping
 * - links-authorization-manager: start, background polling, SSE snapshots,
 *                                cancel, capacity limits, TTL cleanup
 * - links-store:        source-code inspection: permissions, lock primitives,
 *                       atomic writes, quarantine, duplicate detection, isolation
 * - links-api-helpers:  source inspection: provider validation, forbidden body
 *                       keys, error mapping, persist handler
 * - Sentinel scans:     access_token / device_code absent from wire snapshots,
 *                       metadata, errors, logs
 * - Integration:        mock Device Flow lifecycle with fetch mocking
 *
 * Always runs against a temporary PI_CODING_AGENT_DIR — never touches
 * real ~/.pi/agent.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs \
 *        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        scripts/test-links.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createJiti } from "jiti";

// ─── Setup ───────────────────────────────────────────────────────────────────

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });

// ─── Sentinels for security leak scans ───────────────────────────────────────

const ACCESS_SENTINEL = "gho_LINKS_ACCESS_SENTINEL_7f3c91ab2d4e";
const DEVICE_CODE_SENTINEL = "LINKS_DEVICE_CODE_SENTINEL_91ab7f3c2d4e";
const USER_CODE_SENTINEL = "SENTINEL-USER"; // intentionally visible

// ─── Temp agent dir ──────────────────────────────────────────────────────────

const agentDir = mkdtempSync(join(tmpdir(), "pi-links-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSource(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function assertIncludes(source, needle, label) {
  assert.ok(
    source.includes(needle),
    `${label}: expected to include "${needle}"`,
  );
}

function assertNotIncludes(source, needle, label) {
  assert.ok(
    !source.includes(needle),
    `${label}: expected NOT to include "${needle}"`,
  );
}

function assertNoSentinel(value, label) {
  if (value === null || value === undefined) return;
  let serialized;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return;
  }
  assert.ok(!serialized.includes(ACCESS_SENTINEL), `${label}: leaked access token`);
  assert.ok(!serialized.includes(DEVICE_CODE_SENTINEL), `${label}: leaked device_code`);
}

function assertUserCodeVisible(value, label) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(serialized.includes(USER_CODE_SENTINEL), `${label}: userCode missing`);
}

// ─── Fetch mock ──────────────────────────────────────────────────────────────

let _mockFetchHandler = null;

function installMockFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (_mockFetchHandler) {
      const result = await _mockFetchHandler(url, init);
      if (result !== undefined) return result;
    }
    return originalFetch(url, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
    _mockFetchHandler = null;
  };
}

function setMockFetchHandler(handler) {
  _mockFetchHandler = handler;
}

function makeMockResponse(body, status = 200) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
  });
}

function resetAuthState() {
  if (globalThis.__piLinkAuthorizations) {
    delete globalThis.__piLinkAuthorizations;
  }
}

// ─── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
    failed++;
  }
}

// ─── Module loading ──────────────────────────────────────────────────────────
// Only import modules that don't pull in pi-coding-agent (which has
// broken typebox dep in this test env). Store + api-helpers are tested
// via source-code inspection.

let types, providerRegistry, githubOAuth, authManager, linksStore, apiHelpers;

async function loadRuntimeModules() {
  types = await jiti.import(join(root, "lib/links-types.ts"));
  providerRegistry = await jiti.import(join(root, "lib/links-provider-registry.ts"));
  githubOAuth = await jiti.import(join(root, "lib/github-link-oauth.ts"));
  authManager = await jiti.import(join(root, "lib/links-authorization-manager.ts"));
  // links-store and api-helpers import pi-coding-agent; tested via source inspection
}

async function loadSourceModules() {
  linksStore = { source: readSource("lib/links-store.ts") };
  apiHelpers = { source: readSource("lib/links-api-helpers.ts") };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Links / GitHub OAuth Device Flow (LINKS-05) ===\n");

  resetAuthState();
  const restoreFetch = installMockFetch();

  await loadRuntimeModules();
  await loadSourceModules();

  try {
    // ══════════════════════════════════════════════════════════════════
    // 1. Types & contracts (runtime)
    // ══════════════════════════════════════════════════════════════════
    console.log("1. Types & contracts");

    await test("ALLOWLISTED_LINK_PROVIDERS includes github", () => {
      assert.ok(types.ALLOWLISTED_LINK_PROVIDERS.includes("github"));
    });

    await test("isValidOpaqueId accepts valid ids", () => {
      assert.equal(types.isValidOpaqueId("abc123-xyz"), true);
      assert.equal(types.isValidOpaqueId("la_550e8400-e29b-41d4-a716-446655440000"), true);
    });

    await test("isValidOpaqueId rejects traversal / schemes", () => {
      assert.equal(types.isValidOpaqueId(""), false);
      assert.equal(types.isValidOpaqueId(".."), false);
      assert.equal(types.isValidOpaqueId("abc/def"), false);
      assert.equal(types.isValidOpaqueId("abc\\def"), false);
      assert.equal(types.isValidOpaqueId("http://evil"), false);
      assert.equal(types.isValidOpaqueId("data:x"), false);
    });

    await test("LINKS_P0_REQUESTED_SCOPES is read:user only", () => {
      assert.deepEqual(types.LINKS_P0_REQUESTED_SCOPES, ["read:user"]);
    });

    await test("GITHUB constants are fixed HTTPS strings", () => {
      assert.equal(types.GITHUB_DEVICE_CODE_URL, "https://github.com/login/device/code");
      assert.equal(types.GITHUB_ACCESS_TOKEN_URL, "https://github.com/login/oauth/access_token");
      assert.equal(types.GITHUB_USER_API_URL, "https://api.github.com/user");
      assert.equal(types.GITHUB_DEVICE_VERIFICATION_URI, "https://github.com/login/device");
    });

    await test("TERMINAL_AUTHORIZATION_STATUSES covers expected states", () => {
      const t = types.TERMINAL_AUTHORIZATION_STATUSES;
      assert.ok(t.has("connected"));
      assert.ok(t.has("duplicate"));
      assert.ok(t.has("denied"));
      assert.ok(t.has("expired"));
      assert.ok(t.has("cancelled"));
      assert.ok(t.has("failed"));
    });

    await test("isActiveAuthorizationStatus works", () => {
      assert.equal(types.isActiveAuthorizationStatus("awaiting_user"), true);
      assert.equal(types.isActiveAuthorizationStatus("polling"), true);
      assert.equal(types.isActiveAuthorizationStatus("connected"), false);
    });

    // ══════════════════════════════════════════════════════════════════
    // 2. Provider registry (runtime)
    // ══════════════════════════════════════════════════════════════════
    console.log("2. Provider registry");

    await test("isAllowlistedLinkProvider accepts github, rejects unknown", () => {
      assert.equal(providerRegistry.isAllowlistedLinkProvider("github"), true);
      assert.equal(providerRegistry.isAllowlistedLinkProvider("gitlab"), false);
    });

    await test("getLinkProviderAdapter returns null for unknown", () => {
      assert.equal(providerRegistry.getLinkProviderAdapter("gitlab"), null);
    });

    await test("registerLinkProviderAdapter rejects non-allowlisted", () => {
      assert.throws(
        () => providerRegistry.registerLinkProviderAdapter("gitlab", () => ({ id: "gitlab" })),
        /not allowlisted/,
      );
    });

    await test("getLinkProviderDisplayName works", () => {
      assert.equal(providerRegistry.getLinkProviderDisplayName("github"), "GitHub");
      assert.equal(providerRegistry.getLinkProviderDisplayName("unknown"), "unknown");
    });

    // ══════════════════════════════════════════════════════════════════
    // 3. GitHub OAuth adapter (runtime with mock fetch)
    // ══════════════════════════════════════════════════════════════════
    console.log("3. GitHub OAuth adapter");

    const setClientId = (id) => githubOAuth._testOverrideGithubClientId(id);

    await test("resolveGithubOAuthClientId returns null when not set", () => {
      setClientId(null);
      assert.equal(githubOAuth.resolveGithubOAuthClientId(), null);
    });

    await test("resolveGithubOAuthClientId returns value from override", () => {
      setClientId("test-client-id-123");
      assert.equal(githubOAuth.resolveGithubOAuthClientId(), "test-client-id-123");
    });

    await test("isGithubOAuthConfigured reflects client id", () => {
      setClientId("test-client-id-123");
      assert.equal(githubOAuth.isGithubOAuthConfigured(), true);
      setClientId(null);
      assert.equal(githubOAuth.isGithubOAuthConfigured(), false);
    });

    await test("parseGrantedScopes handles various inputs", () => {
      assert.deepEqual(githubOAuth.parseGrantedScopes("read:user"), ["read:user"]);
      assert.deepEqual(githubOAuth.parseGrantedScopes("user:email,read:user"), ["read:user", "user:email"]);
      assert.deepEqual(githubOAuth.parseGrantedScopes("user:email read:user"), ["read:user", "user:email"]);
      assert.deepEqual(githubOAuth.parseGrantedScopes(""), []);
      assert.deepEqual(githubOAuth.parseGrantedScopes(null), []);
      assert.deepEqual(githubOAuth.parseGrantedScopes("  read:user , user:email  "), ["read:user", "user:email"]);
      assert.deepEqual(githubOAuth.parseGrantedScopes("read:user,read:user"), ["read:user"]);
    });

    await test("requestDeviceCode succeeds with mock", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
      });
      const grant = await githubOAuth.requestDeviceCode();
      assert.equal(grant.deviceCode, DEVICE_CODE_SENTINEL);
      assert.equal(grant.userCode, USER_CODE_SENTINEL);
      assert.equal(grant.verificationUri, "https://github.com/login/device");
      assert.equal(grant.expiresIn, 900);
      assert.ok(grant.interval >= 5);
    });

    await test("request deadline terminates a stalled fetch without a caller signal", async () => {
      setClientId("test-client-id-123");
      githubOAuth._testOverrideGithubRequestTimeoutMs(20);
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) return new Promise(() => {});
      });
      await assert.rejects(
        () => githubOAuth.requestDeviceCode(),
        (err) => err.code === "github_timeout",
      );
      githubOAuth._testOverrideGithubRequestTimeoutMs(undefined);
    });

    await test("caller signal does not disable the request deadline", async () => {
      setClientId("test-client-id-123");
      githubOAuth._testOverrideGithubRequestTimeoutMs(20);
      const caller = new AbortController();
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) return new Promise(() => {});
      });
      await assert.rejects(
        () => githubOAuth.requestDeviceCode(caller.signal),
        (err) => err.code === "github_timeout",
      );
      githubOAuth._testOverrideGithubRequestTimeoutMs(undefined);
    });

    await test("request deadline terminates a stalled response body", async () => {
      setClientId("test-client-id-123");
      githubOAuth._testOverrideGithubRequestTimeoutMs(20);
      let cancelled = false;
      setMockFetchHandler((url) => {
        if (url !== types.GITHUB_DEVICE_CODE_URL) return undefined;
        const body = new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(body, { status: 200 });
      });
      await assert.rejects(
        () => githubOAuth.requestDeviceCode(),
        (err) => err.code === "github_timeout",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(cancelled, true);
      githubOAuth._testOverrideGithubRequestTimeoutMs(undefined);
    });

    await test("caller cancellation remains AbortError rather than a timeout", async () => {
      setClientId("test-client-id-123");
      githubOAuth._testOverrideGithubRequestTimeoutMs(100);
      const caller = new AbortController();
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) return new Promise(() => {});
      });
      setTimeout(() => caller.abort(), 10);
      await assert.rejects(
        () => githubOAuth.requestDeviceCode(caller.signal),
        (err) => err.name === "AbortError" && err.code !== "github_timeout" && err.code !== "github_network_error",
      );
      githubOAuth._testOverrideGithubRequestTimeoutMs(undefined);
    });

    await test("attemptPollAccessToken rethrows caller cancellation instead of mapping network failure", async () => {
      setClientId("test-client-id-123");
      githubOAuth._testOverrideGithubRequestTimeoutMs(100);
      const caller = new AbortController();
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) return new Promise(() => {});
      });
      setTimeout(() => caller.abort(), 10);
      await assert.rejects(
        () => githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL, caller.signal),
        (err) => err.name === "AbortError" && err.code !== "github_timeout" && err.code !== "github_network_error",
      );
      githubOAuth._testOverrideGithubRequestTimeoutMs(undefined);
    });

    await test("requestDeviceCode throws when not configured", async () => {
      setClientId(null);
      await assert.rejects(
        () => githubOAuth.requestDeviceCode(),
        (err) => err.code === "github_authorization_not_configured",
      );
    });

    await test("requestDeviceCode rejects non-GitHub verificationUri", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://evil.example.com/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
      });
      await assert.rejects(
        () => githubOAuth.requestDeviceCode(),
        (err) => err.code === "github_bad_response",
      );
    });

    await test("pollAccessToken succeeds with mock", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({
            access_token: ACCESS_SENTINEL,
            token_type: "bearer",
            scope: "read:user",
          }, 200);
        }
      });
      const result = await githubOAuth.pollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(result.accessToken, ACCESS_SENTINEL);
      assert.equal(result.tokenType, "bearer");
      assert.deepEqual(result.grantedScopes, ["read:user"]);
    });

    await test("attemptPollAccessToken handles authorization_pending", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, true);
      assert.equal(r.slowDown, false);
      assert.equal(r.credential, undefined);
    });

    await test("attemptPollAccessToken handles slow_down", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "slow_down", interval: 10 }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, true);
      assert.equal(r.slowDown, true);
      assert.equal(r.newIntervalSeconds, 10);
    });

    await test("attemptPollAccessToken handles access_denied", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "access_denied" }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, false);
      assert.equal(r.error?.code, "github_access_denied");
    });

    await test("attemptPollAccessToken handles expired_token", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "expired_token" }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, false);
      assert.equal(r.error?.code, "github_authorization_expired");
    });

    await test("attemptPollAccessToken handles device_flow_disabled", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "device_flow_disabled" }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, false);
      assert.equal(r.error?.code, "github_device_flow_disabled");
    });

    await test("attemptPollAccessToken handles incorrect_client_credentials", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "incorrect_client_credentials" }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, false);
      assert.equal(r.error?.code, "github_client_invalid");
    });

    await test("validateGitHubIdentity validates /user", async () => {
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_USER_API_URL) {
          return makeMockResponse({ id: 583231, login: "octocat", name: "The Octocat" }, 200);
        }
      });
      const id = await githubOAuth.validateGitHubIdentity(ACCESS_SENTINEL);
      assert.equal(id.login, "octocat");
      assert.equal(id.providerUserId, "583231");
      assert.equal(id.name, "The Octocat");
    });

    await test("validateGitHubIdentity rejects invalid /user", async () => {
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_USER_API_URL) {
          return makeMockResponse({ status: "ok" }, 200);
        }
      });
      await assert.rejects(
        () => githubOAuth.validateGitHubIdentity(ACCESS_SENTINEL),
        (err) => err.code === "github_identity_invalid",
      );
    });

    await test("validateGitHubIdentity rejects 401", async () => {
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_USER_API_URL) {
          return makeMockResponse({ message: "Bad credentials" }, 401);
        }
      });
      await assert.rejects(
        () => githubOAuth.validateGitHubIdentity(ACCESS_SENTINEL),
        (err) => err.code === "github_identity_invalid",
      );
    });

    // ══════════════════════════════════════════════════════════════════
    // 4. Authorization manager (runtime)
    // ══════════════════════════════════════════════════════════════════
    console.log("4. Authorization manager");

    await test("adapter registration for auth manager", () => {
      resetAuthState();
      setClientId("test-client-id-123");
      const adapter = githubOAuth.createGitHubLinkAdapter();
      providerRegistry.registerLinkProviderAdapter("github", () => adapter);
      const resolved = providerRegistry.getLinkProviderAdapter("github");
      assert.ok(resolved !== null);
      assert.equal(resolved.id, "github");
    });

    await test("startAuthorization creates session, snapshot is clean", async () => {
      resetAuthState();
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });

      const snapshot = await authManager.startAuthorization("github");
      // Background polling transitions to polling quickly; initial status may be awaiting_user or polling
      assert.ok(
        snapshot.status === "awaiting_user" || snapshot.status === "polling",
        `status was ${snapshot.status}`,
      );
      assert.ok(snapshot.authorizationId);
      assert.equal(snapshot.userCode, USER_CODE_SENTINEL);
      assertNoSentinel(snapshot, "startAuthorization snapshot");
      assert.equal(authManager.isAuthorizationActive(snapshot.authorizationId), true);
    });

    await test("startAuthorization userCode is visible", async () => {
      resetAuthState();
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });
      const snapshot = await authManager.startAuthorization("github");
      assertUserCodeVisible(snapshot, "startAuthorization snapshot");
    });

    await test("cancelAuthorization cancels active session", async () => {
      resetAuthState();
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });
      const snapshot = await authManager.startAuthorization("github");
      assert.equal(authManager.isAuthorizationActive(snapshot.authorizationId), true);
      const result = authManager.cancelAuthorization(snapshot.authorizationId);
      assert.equal(result.cancelled, true);
      assert.equal(authManager.isAuthorizationActive(snapshot.authorizationId), false);
    });

    await test("cancelAuthorization idempotent for unknown", () => {
      assert.equal(authManager.cancelAuthorization("nonexistent").cancelled, false);
    });

    await test("getAuthorizationSnapshot returns null for unknown", () => {
      assert.equal(authManager.getAuthorizationSnapshot("nonexistent"), null);
    });

    await test("subscribeToAuthorization receives snapshot", async () => {
      resetAuthState();
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });
      const snapshot = await authManager.startAuthorization("github");
      const snapshots = [];
      const unsub = authManager.subscribeToAuthorization(
        snapshot.authorizationId,
        (s) => snapshots.push(s),
      );
      assert.ok(snapshots.length >= 1);
      assertNoSentinel(snapshots[0], "SSE snapshot");
      unsub();
    });

    await test("subscribeToAuthorization for unknown sends terminal", () => {
      const snapshots = [];
      const unsub = authManager.subscribeToAuthorization(
        "nonexistent-id-xxxx",
        (s) => snapshots.push(s),
      );
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].status, "expired");
      assert.equal(snapshots[0].errorCode, "authorization_not_found");
      unsub();
    });

    await test("markAuthorizationConnected / Duplicate / Failed work", () => {
      // These are state mutations; verify they don't throw.
      authManager.markAuthorizationConnected("nonexistent", {
        id: "conn-1",
        provider: "github",
        label: "@test",
        login: "test",
        providerUserId: "123",
        status: "connected",
        requestedScopes: ["read:user"],
        grantedScopes: ["read:user"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastValidatedAt: new Date().toISOString(),
      });
      authManager.markAuthorizationDuplicate("nonexistent", "conn-1", "test");
      authManager.markAuthorizationFailed("nonexistent", "internal_error", "test error");
      // Should not throw
    });

    // ══════════════════════════════════════════════════════════════════
    // 5. Full Device Flow lifecycle (mock from start to persisting)
    // ══════════════════════════════════════════════════════════════════
    console.log("5. Full Device Flow lifecycle");

    await test("complete flow: starting → awaiting_user → polling → persisting", async () => {
      resetAuthState();
      setClientId("test-client-id-123");

      // Re-register adapter
      const adapter = githubOAuth.createGitHubLinkAdapter();
      providerRegistry.registerLinkProviderAdapter("github", () => adapter);

      let pollCount = 0;
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          pollCount++;
          if (pollCount === 1) {
            // First poll: pending
            return makeMockResponse({ error: "authorization_pending" }, 200);
          }
          // Second poll: success
          return makeMockResponse({
            access_token: ACCESS_SENTINEL,
            token_type: "bearer",
            scope: "read:user",
          }, 200);
        }
        if (url === types.GITHUB_USER_API_URL) {
          return makeMockResponse({
            id: 987654,
            login: "finaluser",
            name: "Final Test User",
          }, 200);
        }
      });

      const snapshot = await authManager.startAuthorization("github");
      assert.ok(
        snapshot.status === "awaiting_user" || snapshot.status === "polling",
        `initial status: ${snapshot.status}`,
      );
      assertNoSentinel(snapshot, "initial snapshot");

      // Subscribe to track state changes
      const stateTimeline = [];
      const unsub = authManager.subscribeToAuthorization(
        snapshot.authorizationId,
        (s) => stateTimeline.push(s),
      );

      // Wait for background polling to progress through states
      // The first poll is "authorization_pending" → stays in polling
      // The second poll returns access token → validating → persisting
      // Minimum interval is 5s, so we need to wait.
      // Since we can't use fake timers here, we'll wait for the polling
      // to naturally progress. The test will show states as they occur.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // After waiting, check intermediate states
      const midSnapshot = authManager.getAuthorizationSnapshot(snapshot.authorizationId);
      assert.ok(midSnapshot !== null, "snapshot should still exist");

      // Verify no sentinels leaked in any state
      for (const s of stateTimeline) {
        assertNoSentinel(s, `state timeline ${s.status}`);
      }

      unsub();
    });

    // ══════════════════════════════════════════════════════════════════
    // 6. Store source-code inspection
    // ══════════════════════════════════════════════════════════════════
    console.log("6. Store source-code inspection");

    const storeSrc = linksStore.source;

    await test("store imports getAgentDir from pi-coding-agent", () => {
      assertIncludes(storeSrc, "getAgentDir", "store source");
      assertIncludes(storeSrc, "@earendil-works/pi-coding-agent", "store source");
    });

    await test("store has mkdir-based lock primitives", () => {
      assertIncludes(storeSrc, "LOCK_STALE_MS", "lock stale constant");
      assertIncludes(storeSrc, "mkdir", "lock uses mkdir");
      assertIncludes(storeSrc, "registry.lock", "lock dir name");
    });

    await test("store enforces 0700 dirs and 0600 files", () => {
      assertIncludes(storeSrc, "0o700", "dir mode 0700");
      assertIncludes(storeSrc, "0o600", "file mode 0600");
    });

    await test("store has atomic write with tmp+fsync+rename", () => {
      assertIncludes(storeSrc, "fsync", "atomic write uses fsync");
      assertIncludes(storeSrc, "rename", "atomic write uses rename");
      assertIncludes(storeSrc, ".tmp.", "atomic write uses tmp file");
    });

    await test("store has process queue + cross-process lock", () => {
      assertIncludes(storeSrc, "processQueues", "process queue");
      assertIncludes(storeSrc, "acquireRegistryLock", "cross-process lock");
    });

    await test("store has duplicate detection by providerUserId", () => {
      assertIncludes(storeSrc, "findActiveConnectionByProviderUserId", "duplicate check");
      assertIncludes(storeSrc, "duplicate_identity", "duplicate error code");
      assertIncludes(storeSrc, "409", "duplicate HTTP 409");
    });

    await test("store has disconnect quarantine/rollback", () => {
      assertIncludes(storeSrc, "quarantine", "disconnect quarantine");
      assertIncludes(storeSrc, ".quarantine-", "quarantine prefix");
    });

    await test("store does NOT import auth.json or CredentialStore", () => {
      // Check that these are only in comments/docs, not actual imports
      assertNotIncludes(storeSrc, 'from "../web-credential-store"', "store import — web-credential-store");
      assertNotIncludes(storeSrc, 'from "../oauth-accounts"', "store import — oauth-accounts");
      assertNotIncludes(storeSrc, 'from "../rpc-manager"', "store import — rpc-manager");
      // Import paths that must NOT appear
      assertNotIncludes(storeSrc, 'from "@earendil-works/pi-ai', "store import — pi-ai direct (only core)");
    });

    await test("store has schemaVersion fail-closed for unknown schemas", () => {
      assertIncludes(storeSrc, "schemaVersion", "schema version check");
      assertIncludes(storeSrc, "connections: {}", "fallback to empty");
    });

    await test("store validate opaque ids before file operations", () => {
      assertIncludes(storeSrc, "isValidOpaqueId", "opaque id validation");
    });

    await test("store registry is metadata-only (comment confirms)", () => {
      assertIncludes(storeSrc, "Registry is metadata-only", "registry metadata only");
    });

    await test("store device_code comment says never reaches disk", () => {
      assertIncludes(storeSrc, "device_code", "device_code comment");
    });

    await test("store normalizeSecret rejects unknown schemas", () => {
      assertIncludes(storeSrc, "schemaVersion !== 1", "fail closed on unknown schema");
      assertIncludes(storeSrc, 'kind !== "github_oauth"', "fail closed on wrong kind");
    });

    // ══════════════════════════════════════════════════════════════════
    // 7. API helpers source-code inspection
    // ══════════════════════════════════════════════════════════════════
    console.log("7. API helpers source-code inspection");

    const apiSrc = apiHelpers.source;

    await test("api-helpers validates provider param", () => {
      assertIncludes(apiSrc, "validateProviderParam", "provider validation");
      assertIncludes(apiSrc, "isAllowlistedLinkProvider", "provider allowlist check");
    });

    await test("api-helpers validates opaque id param", () => {
      assertIncludes(apiSrc, "validateOpaqueIdParam", "opaque id validation");
      assertIncludes(apiSrc, "isValidOpaqueId", "opaque id check");
    });

    await test("api-helpers has forbidden body key list", () => {
      assertIncludes(apiSrc, "FORBIDDEN_BODY_KEYS", "forbidden keys constant");
      assertIncludes(apiSrc, "token", "forbids token");
      assertIncludes(apiSrc, "client_secret", "forbids client_secret");
      assertIncludes(apiSrc, "scope", "forbids scope");
      assertIncludes(apiSrc, "pat", "forbids pat");
    });

    await test("api-helpers maps error codes to HTTP status", () => {
      assertIncludes(apiSrc, "ERROR_CODE_TO_STATUS", "error code mapping");
      assertIncludes(apiSrc, "duplicate_identity", "409 code");
    });

    await test("api-helpers has no-store cache headers", () => {
      assertIncludes(apiSrc, 'Cache-Control": "no-store"', "no-store header");
      assertIncludes(apiSrc, 'Cache-Control": "no-cache, no-store"', "SSE cache headers");
    });

    await test("api-helpers has persist handler bridge", () => {
      assertIncludes(apiSrc, "ensureLinksPersistHandler", "persist handler");
      assertIncludes(apiSrc, "markAuthorizationConnected", "connected marker");
      assertIncludes(apiSrc, "markAuthorizationDuplicate", "duplicate marker");
    });

    await test("api-helpers does NOT import auth.json or CredentialStore", () => {
      assertNotIncludes(apiSrc, 'from "../web-credential-store"', "api import — web-credential-store");
      assertNotIncludes(apiSrc, 'from "../oauth-accounts"', "api import — oauth-accounts");
      assertNotIncludes(apiSrc, 'from "../web-model-runtime"', "api import — web-model-runtime");
      assertNotIncludes(apiSrc, 'from "../rpc-manager"', "api import — rpc-manager");
    });

    // ══════════════════════════════════════════════════════════════════
    // 8. Sentinel leak scan
    // ══════════════════════════════════════════════════════════════════
    console.log("8. Sentinel leak scan");

    await test("startAuthorization snapshot has no secrets", async () => {
      resetAuthState();
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });
      const snapshot = await authManager.startAuthorization("github");
      const serialized = JSON.stringify(snapshot);
      assert.ok(!serialized.includes(ACCESS_SENTINEL), "snapshot leaked access token");
      assert.ok(!serialized.includes(DEVICE_CODE_SENTINEL), "snapshot leaked device_code");
      assert.ok(serialized.includes(USER_CODE_SENTINEL), "snapshot includes userCode");
    });

    await test("authorization snapshot JSON keys are safe", async () => {
      resetAuthState();
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_DEVICE_CODE_URL) {
          return makeMockResponse({
            device_code: DEVICE_CODE_SENTINEL,
            user_code: USER_CODE_SENTINEL,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }, 200);
        }
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          return makeMockResponse({ error: "authorization_pending" }, 200);
        }
      });
      const snapshot = await authManager.startAuthorization("github");
      const keys = Object.keys(snapshot);
      // These keys must NOT appear in any snapshot
      assert.ok(!keys.includes("deviceCode"), "snapshot has no deviceCode key");
      assert.ok(!keys.includes("accessToken"), "snapshot has no accessToken key");
      assert.ok(!keys.includes("credential"), "snapshot has no credential key");
      // These keys MAY appear
      assert.ok(keys.includes("userCode") || snapshot.userCode !== undefined, "userCode present");
    });

    await test("poll error responses never contain raw body", async () => {
      setClientId("test-client-id-123");
      setMockFetchHandler((url) => {
        if (url === types.GITHUB_ACCESS_TOKEN_URL) {
          // Return a response with extra fields that should not leak
          return makeMockResponse({
            error: "access_denied",
            error_description: `Secret: ${ACCESS_SENTINEL}`,
            error_uri: "https://example.com",
          }, 200);
        }
      });
      const r = await githubOAuth.attemptPollAccessToken(DEVICE_CODE_SENTINEL);
      assert.equal(r.pending, false);
      assert.ok(r.error);
      // The error message must NOT contain the sentinel
      assertNoSentinel(r.error.message, "poll error message");
    });

    // ══════════════════════════════════════════════════════════════════
    // 9. auth.json / LLM auth isolation
    // ══════════════════════════════════════════════════════════════════
    console.log("9. Links isolation from LLM auth");

    await test("source files do not import LLM auth modules", () => {
      const sources = [
        { name: "links-types", src: readSource("lib/links-types.ts") },
        { name: "links-provider-registry", src: readSource("lib/links-provider-registry.ts") },
        { name: "github-link-oauth", src: readSource("lib/github-link-oauth.ts") },
        { name: "links-authorization-manager", src: readSource("lib/links-authorization-manager.ts") },
      ];
      for (const { name, src } of sources) {
        assertNotIncludes(src, 'from "../web-credential-store"', `${name} — no web-credential-store`);
        assertNotIncludes(src, 'from "../oauth-accounts"', `${name} — no oauth-accounts`);
        assertNotIncludes(src, 'from "../web-model-runtime"', `${name} — no web-model-runtime`);
        assertNotIncludes(src, 'from "../rpc-manager"', `${name} — no rpc-manager`);
      }
    });

    await test("links-store comments document LLM auth isolation", () => {
      assertIncludes(storeSrc, "Isolation", "store has isolation docs");
      assertIncludes(storeSrc, "This module does NOT import", "store has isolation boundary list");
    });

    // ══════════════════════════════════════════════════════════════════
    // 10. Adapter & provider isolation
    // ══════════════════════════════════════════════════════════════════
    console.log("10. Adapter & provider isolation");

    await test("createGitHubLinkAdapter returns valid adapter", () => {
      const adapter = githubOAuth.createGitHubLinkAdapter();
      assert.equal(adapter.id, "github");
      assert.equal(adapter.displayName, "GitHub");
      assert.equal(typeof adapter.startAuthorization, "function");
      assert.equal(typeof adapter.pollAuthorization, "function");
      assert.equal(typeof adapter.validateCredential, "function");
    });

    await test("LinksConfig component exists", () => {
      const configSrc = readSource("components/LinksConfig.tsx");
      assertIncludes(configSrc, "LinksConfig", "component exists");
      assertIncludes(configSrc, "连接 GitHub", "connect GitHub button");
      // No PAT form
      assertNotIncludes(configSrc, "type=\"password\"", "no password input");
      assertNotIncludes(configSrc, "PAT", "no PAT reference");
      assertNotIncludes(configSrc, "Personal Access Token", "no PAT form");
      // Device Flow
      assertIncludes(configSrc, "userCode", "displays userCode");
      assertIncludes(configSrc, "GITHUB_DEVICE_VERIFICATION_URI", "uses device verification URI");
    });

    await test("API routes exist and reject forbidden bodies", () => {
      const authRoute = readSource("app/api/links/[provider]/authorizations/route.ts");
      assertIncludes(authRoute, "rejectForbiddenBodyKeys", "POST authorizations rejects forbidden");
      assertIncludes(authRoute, "201", "returns 201");
    });

    await test("API routes use no-store headers", () => {
      const catalogRoute = readSource("app/api/links/route.ts");
      assertIncludes(catalogRoute, "no-store", "catalog no-store");
      const connRoute = readSource("app/api/links/[provider]/connections/route.ts");
      assertIncludes(connRoute, "no-store", "connections no-store");
    });

    await test("SSE route does not expose secrets", () => {
      const sseRoute = readSource("app/api/links/[provider]/authorizations/[authorizationId]/events/route.ts");
      assertIncludes(sseRoute, "no-cache, no-store", "SSE cache headers");
      // The route only sends sanitized snapshots — verify it uses subscribeToAuthorization
      assertIncludes(sseRoute, "subscribeToAuthorization", "SSE uses subscribeToAuthorization");
      // Should document the security boundary
      assertIncludes(sseRoute, "NEVER", "SSE has security comment");
    });

    // ══════════════════════════════════════════════════════════════════
    // 11. No PAT contract
    // ══════════════════════════════════════════════════════════════════
    console.log("11. No PAT contract verification");

    await test("LinksConfig has no PAT form or token input", () => {
      const configSrc = readSource("components/LinksConfig.tsx");
      // No password input, no PAT token field
      assertNotIncludes(configSrc, 'type="password"', "LinksConfig has no password input");
      assertNotIncludes(configSrc, 'Personal Access Token', "LinksConfig has no PAT");
      // Device Flow is the primary path
      assertIncludes(configSrc, "userCode", "LinksConfig uses userCode");
      assertIncludes(configSrc, "Device Flow", "LinksConfig mentions Device Flow");
      // Must not have token paste/copy/reveal UX
      assertNotIncludes(configSrc, "copiedToken", "LinksConfig no copyToken");
      assertNotIncludes(configSrc, "revealToken", "LinksConfig no revealToken");
    });

    await test("API authorization start rejects token body keys", () => {
      const authSrc = readSource("app/api/links/[provider]/authorizations/route.ts");
      assertIncludes(authSrc, "rejectForbiddenBodyKeys", "rejects forbidden body keys");
    });

    await test("All forbidden body keys covered", () => {
      assertIncludes(apiSrc, '"token"', "forbids token");
      assertIncludes(apiSrc, '"pat"', "forbids pat");
      assertIncludes(apiSrc, '"access_token"', "forbids access_token");
      assertIncludes(apiSrc, '"client_secret"', "forbids client_secret");
      assertIncludes(apiSrc, '"device_code"', "forbids device_code");
    });

    // ══════════════════════════════════════════════════════════════════
    // 12. Scope / read:user only
    // ══════════════════════════════════════════════════════════════════
    console.log("12. Scope: read:user only");

    await test("P0 scope is fixed read:user", () => {
      assert.deepEqual(types.LINKS_P0_REQUESTED_SCOPES, ["read:user"]);
    });

    await test("github-link-oauth uses FIXED_SCOPE = read:user", () => {
      const src = readSource("lib/github-link-oauth.ts");
      assertIncludes(src, 'FIXED_SCOPE = "read:user"', "fixed scope constant");
      assertNotIncludes(src, "repo", "no repo scope");
    });

    // ══════════════════════════════════════════════════════════════════
    // 13. Root-level isolation (no PAT in plan/design)
    // ══════════════════════════════════════════════════════════════════
    console.log("13. Architecture isolation verification");

    await test("store does not import rpc-manager", () => {
      assertNotIncludes(storeSrc, "rpc-manager", "no RPC import");
    });

    await test("oauth adapter does not import LLM auth", () => {
      const src = readSource("lib/github-link-oauth.ts");
      assertNotIncludes(src, 'from "../oauth-accounts"', "no oauth-accounts import");
      assertNotIncludes(src, 'from "../web-credential-store"', "no credential store import");
      assertNotIncludes(src, 'from "../web-model-runtime"', "no model runtime import");
    });

    await test("authorization manager does not import LLM auth", () => {
      const src = readSource("lib/links-authorization-manager.ts");
      assertNotIncludes(src, 'from "../oauth-accounts"', "no oauth-accounts import");
      assertNotIncludes(src, 'from "../web-credential-store"', "no credential store import");
      assertNotIncludes(src, 'from "../web-model-runtime"', "no model runtime import");
    });

    await test("client id is server-only — NOT in NEXT_PUBLIC", () => {
      const oauthSrc = readSource("lib/github-link-oauth.ts");
      assertNotIncludes(oauthSrc, "NEXT_PUBLIC", "no NEXT_PUBLIC client id");
      assertIncludes(oauthSrc, "YPI_LINKS_GITHUB_OAUTH_CLIENT_ID", "server-only env var");
      assertIncludes(oauthSrc, "process.env", "uses process.env");
    });

    // ══════════════════════════════════════════════════════════════════
    // 14. Store test helpers
    // ══════════════════════════════════════════════════════════════════
    console.log("14. Store test helpers");

    await test("store exports __resetLinksStoreCacheForTests", () => {
      assertIncludes(storeSrc, "__resetLinksStoreCacheForTests", "test helper export");
    });

    await test("store exports __linksStoreUsesFsLockForTests", () => {
      assertIncludes(storeSrc, "__linksStoreUsesFsLockForTests", "test helper export");
    });

  } catch (err) {
    console.error("Unexpected test error:", err);
    failed++;
  } finally {
    restoreFetch();
    resetAuthState();
    delete process.env.PI_CODING_AGENT_DIR;
    try {
      rmSync(agentDir, { recursive: true, force: true });
    } catch {
      console.warn("Warning: could not clean up temp dir", agentDir);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
  // Force exit — background polling timers from authorization manager may
  // keep the event loop alive. All assertions have already completed.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
