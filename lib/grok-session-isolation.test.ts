/**
 * grok-session-isolation — session-account binding and token refresh tests
 *
 * Tests the core invariants of Grok session-account pinning without importing
 * the pi SDK.  The binding registry, header persistence, single-flight token
 * resolution, and multi-session isolation are validated against synthetic
 * file-system state in a temporary agent directory.
 *
 * Because the project uses moduleResolution "bundler" (Next.js) and tsx
 * cannot resolve ESM packages through CJS, this test inlines the pure
 * logic paths rather than importing the full module tree.
 *
 * Usage:
 *   npx tsx lib/grok-session-isolation.test.ts
 */

import { randomUUID } from "node:crypto";
import { rejects, strictEqual } from "node:assert";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We avoid importing from modules that transitively require the pi SDK.
// The binding registry and header read/write logic uses only Node built-ins.
// Import only the types module (no pi SDK dependency).
import type { SessionHeader } from "./types";

// ============================================================================
// Inline: session binding registry (from grok-session-account.ts)
// ============================================================================

const sessionBindings = new Map<string, string>();

function bindGrokSessionAccount(sessionId: string, storageId: string): void {
  if (!storageId.trim()) return;
  sessionBindings.set(sessionId, storageId);
}

function unbindGrokSessionAccount(sessionId: string): void {
  sessionBindings.delete(sessionId);
}

function getGrokSessionAccount(sessionId: string): string | undefined {
  return sessionBindings.get(sessionId);
}

// ============================================================================
// Inline: session header persistence (from grok-session-account.ts)
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";

function readSessionHeaderFromFile(filePath: string): SessionHeader | null {
  try {
    const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
    const header = JSON.parse(firstLine) as SessionHeader;
    return header?.type === "session" ? header : null;
  } catch {
    return null;
  }
}

function readGrokSessionAccountFromHeader(filePath: string): string | undefined {
  if (!filePath) return undefined;
  const header = readSessionHeaderFromFile(filePath);
  const id = header?.grokAccountStorageId?.trim();
  return id || undefined;
}

function writeGrokAccountToHeaderFile(filePath: string, storageId: string): void {
  const content = readFileSync(filePath, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
  const rest = newlineIndex >= 0 ? content.slice(newlineIndex) : "\n";
  const header = JSON.parse(firstLine) as SessionHeader;
  if (header.type !== "session") return;
  header.grokAccountStorageId = storageId;
  writeFileSync(filePath, `${JSON.stringify(header)}${rest}`, "utf8");
}

function bindAndPersist(sessionId: string, storageId: string, sessionFile?: string): void {
  bindGrokSessionAccount(sessionId, storageId);
  if (sessionFile) writeGrokAccountToHeaderFile(sessionFile, storageId);
}

function restoreGrokSessionAccountBinding(sessionId: string, sessionFile?: string): void {
  if (!sessionFile) return;
  const storageId = readGrokSessionAccountFromHeader(sessionFile);
  if (storageId) {
    sessionBindings.set(sessionId, storageId);
  }
}

// ============================================================================
// Inline: single-flight token resolution (from grok-account-token.ts)
// ============================================================================

const inflightRefreshes = new Map<string, Promise<{ accessToken: string; refreshed: boolean; expiresAt: number }>>();

function flightKey(storageId: string): string {
  return `grok-cli:${storageId}`;
}

async function getGrokAccessTokenImpl(
  storageId: string,
  agentDir: string,
  credFileName: string,
  opts: { minValidityMs?: number; signal?: AbortSignal } = {},
): Promise<{ accessToken: string; refreshed: boolean; expiresAt: number }> {
  const { minValidityMs = 120_000, signal } = opts;

  if (!storageId.trim()) throw new Error("grokAccountStorageId is required");

  const key = flightKey(storageId);
  const inflight = inflightRefreshes.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const credPath = join(agentDir, credFileName);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(credPath, "utf8"));
      } catch {
        throw new Error(`Grok saved account not found: ${storageId}`);
      }

      if (typeof raw !== "object" || raw === null) {
        throw new Error(`Grok saved account credential is invalid: ${storageId}`);
      }

      const cred = raw as Record<string, unknown>;
      const access = typeof cred.access === "string" ? cred.access.trim() : "";
      const expires = typeof cred.expires === "number" ? cred.expires : 0;
      const needsRefresh = !access || Date.now() >= expires - minValidityMs;

      if (!needsRefresh) {
        return { accessToken: access, refreshed: false, expiresAt: expires };
      }

      signal?.throwIfAborted();

      // Refresh simulation: use refresh token to derive a new access token.
      const refresh = typeof cred.refresh === "string" ? cred.refresh.trim() : "";
      if (!refresh) {
        throw new Error("Grok OAuth access token expired and no refresh token is available.");
      }

      // In real code this calls pi-ai's getOAuthApiKey. We simulate the
      // outcome: a 500ms delay then a new token derived from the refresh.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const newAccess = `refreshed_${refresh.slice(0, 8)}_${Date.now()}`;
      const newExpires = Date.now() + 3600_000;

      // Write updated credential back
      await writeFile(
        credPath,
        JSON.stringify({ ...cred, access: newAccess, expires: newExpires }),
        { mode: 0o600 },
      );

      return { accessToken: newAccess, refreshed: true, expiresAt: newExpires };
    } finally {
      inflightRefreshes.delete(key);
    }
  })();

  inflightRefreshes.set(key, promise);
  return promise;
}

// ============================================================================
// Helpers
// ============================================================================

let failures = 0;
let passed = 0;

function check(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failures++;
  } else {
    passed++;
  }
}

function summary(): void {
  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

async function createTempAgentDir(): Promise<string> {
  const dir = join(tmpdir(), `grok-session-isolation-${randomUUID()}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const agentDir = await createTempAgentDir();

  console.log(`Test agent dir: ${agentDir}`);

  try {
    // -------------------------------------------------------------------------
    // 1. Session binding registry: bind / get / unbind
    // -------------------------------------------------------------------------
    console.log("\n--- Session binding registry ---");

    bindGrokSessionAccount("s1", "acct_aaa");
    check(getGrokSessionAccount("s1") === "acct_aaa", "bind stores storage id");
    check(getGrokSessionAccount("s2") === undefined, "unknown session returns undefined");

    bindGrokSessionAccount("s1", "acct_bbb");
    check(getGrokSessionAccount("s1") === "acct_bbb", "re-bind overwrites");

    unbindGrokSessionAccount("s1");
    check(getGrokSessionAccount("s1") === undefined, "unbind removes entry");

    // -------------------------------------------------------------------------
    // 2. Session header read/write
    // -------------------------------------------------------------------------
    console.log("\n--- Session header persistence ---");

    const headerPath = join(agentDir, "session.jsonl");
    {
      const header = JSON.stringify({
        type: "session",
        id: "h1",
        timestamp: new Date().toISOString(),
        cwd: "/tmp",
        grokAccountStorageId: "acct_from_header",
      });
      await writeFile(headerPath, `${header}\n{"type":"message"}\n`, "utf8");

      const restored = readGrokSessionAccountFromHeader(headerPath);
      check(restored === "acct_from_header", "reads binding from JSONL header");

      bindAndPersist("h1", restored!, headerPath);
      const content = await readFile(headerPath, "utf8");
      check(content.includes("grokAccountStorageId"), "writes binding into session file header");
    }

    // Header without grok field
    {
      const noBinding = join(agentDir, "no-binding.jsonl");
      await writeFile(
        noBinding,
        `${JSON.stringify({ type: "session", id: "n1", timestamp: new Date().toISOString(), cwd: "/tmp" })}\n`,
        "utf8",
      );
      check(
        readGrokSessionAccountFromHeader(noBinding) === undefined,
        "returns undefined when header has no grokAccountStorageId",
      );
    }

    // Non-existent file
    check(
      readGrokSessionAccountFromHeader("/nope/not-a-file") === undefined,
      "returns undefined for non-existent file",
    );

    // -------------------------------------------------------------------------
    // 3. Restore from session file
    // -------------------------------------------------------------------------
    console.log("\n--- Restore binding ---");

    restoreGrokSessionAccountBinding("r1", headerPath);
    check(getGrokSessionAccount("r1") === "acct_from_header", "restore reads from file and registers");

    restoreGrokSessionAccountBinding("r2", "/nope");
    check(getGrokSessionAccount("r2") === undefined, "restore with no file is no-op");

    restoreGrokSessionAccountBinding("r3");
    check(getGrokSessionAccount("r3") === undefined, "restore with undefined file is no-op");

    unbindGrokSessionAccount("r1");

    // -------------------------------------------------------------------------
    // 4. Token resolver: missing account
    // -------------------------------------------------------------------------
    console.log("\n--- Token resolver: missing account ---");

    await rejects(
      () => getGrokAccessTokenImpl("nonexistent", agentDir, "nonexistent.json"),
      /not found/i,
      "throws for missing account",
    );

    // -------------------------------------------------------------------------
    // 5. Token resolver: valid credential (no refresh needed)
    // -------------------------------------------------------------------------
    console.log("\n--- Token resolver: valid credential ---");

    {
      const storageId = "acct_valid";
      const now = Date.now();
      const credPath = join(agentDir, `${storageId}.json`);
      await writeFile(
        credPath,
        JSON.stringify({ access: "tok_valid", refresh: "rt_valid", expires: now + 3600_000 }),
        { mode: 0o600 },
      );

      const token = await getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`);
      strictEqual(token.accessToken, "tok_valid", "returns access token when not expired");
      strictEqual(token.refreshed, false, "refreshed is false when token is valid");
      strictEqual(token.expiresAt, now + 3600_000, "expiresAt matches stored value");
    }

    // -------------------------------------------------------------------------
    // 6. Token resolver: expired credential triggers refresh
    // -------------------------------------------------------------------------
    console.log("\n--- Token resolver: expired credential (refresh) ---");

    {
      const storageId = "acct_expired";
      const credPath = join(agentDir, `${storageId}.json`);
      await writeFile(
        credPath,
        JSON.stringify({ access: "tok_old", refresh: "rt_expired_xxx", expires: Date.now() - 3600_000 }),
        { mode: 0o600 },
      );

      const token = await getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`, { minValidityMs: 120_000 });
      check(token.refreshed === true, "refreshed is true when token is expired");
      check(token.accessToken.startsWith("refreshed_rt_expi"), "refresh generates new access token");
      check(token.expiresAt > Date.now(), "new token has future expiry");

      // Verify the file was updated
      const content = JSON.parse(await readFile(credPath, "utf8")) as Record<string, unknown>;
      strictEqual(content.access, token.accessToken, "credential file updated with new access token");
    }

    // -------------------------------------------------------------------------
    // 7. Token resolver: no refresh token → error
    // -------------------------------------------------------------------------
    console.log("\n--- Token resolver: no refresh token ---");

    {
      const storageId = "acct_no_refresh";
      const credPath = join(agentDir, `${storageId}.json`);
      await writeFile(
        credPath,
        JSON.stringify({ access: "tok_old", refresh: "", expires: Date.now() - 3600_000 }),
        { mode: 0o600 },
      );

      await rejects(
        () => getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
        /no refresh token/i,
        "throws when refresh token is missing",
      );
    }

    // -------------------------------------------------------------------------
    // 8. Single-flight: concurrent calls for same storageId share one flight
    // -------------------------------------------------------------------------
    console.log("\n--- Single-flight concurrency ---");

    {
      const storageId = "acct_flight";
      const credPath = join(agentDir, `${storageId}.json`);
      const now = Date.now();
      // Use an expired credential to force refresh, so we can verify single-flight
      await writeFile(
        credPath,
        JSON.stringify({ access: "tok_old", refresh: "rt_flight", expires: now - 3600_000 }),
        { mode: 0o600 },
      );

      const results = await Promise.all([
        getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
        getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
        getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
        getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
        getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
      ]);

      // All should have the same refreshed token (single-flight)
      const allSame = results.every((r) => r.accessToken === results[0].accessToken);
      check(allSame, "concurrent same-account calls share single-flight refresh");
      check(results.every((r) => r.refreshed), "all results are refreshed");
      check(results.length === 5, "all concurrent calls completed");
    }

    // -------------------------------------------------------------------------
    // 9. Different storageIds are independent
    // -------------------------------------------------------------------------
    console.log("\n--- Different accounts independent ---");

    {
      const now = Date.now();
      await writeFile(
        join(agentDir, "acct_A.json"),
        JSON.stringify({ access: "tok_A", refresh: "rt_A", expires: now + 3600_000 }),
        { mode: 0o600 },
      );
      await writeFile(
        join(agentDir, "acct_B.json"),
        JSON.stringify({ access: "tok_B", refresh: "rt_B", expires: now + 3600_000 }),
        { mode: 0o600 },
      );

      const [resultA, resultB] = await Promise.all([
        getGrokAccessTokenImpl("acct_A", agentDir, "acct_A.json"),
        getGrokAccessTokenImpl("acct_B", agentDir, "acct_B.json"),
      ]);

      strictEqual(resultA.accessToken, "tok_A", "account A gets its own token");
      strictEqual(resultB.accessToken, "tok_B", "account B gets its own token");
      check((resultA.accessToken as string) !== (resultB.accessToken as string), "different accounts return different tokens");
    }

    // -------------------------------------------------------------------------
    // 10. Multi-session account isolation
    // -------------------------------------------------------------------------
    console.log("\n--- Multi-session account isolation ---");

    bindGrokSessionAccount("session_alpha", "acct_alpha");
    bindGrokSessionAccount("session_beta", "acct_beta");

    strictEqual(getGrokSessionAccount("session_alpha"), "acct_alpha");
    strictEqual(getGrokSessionAccount("session_beta"), "acct_beta");

    // Active switch simulation: change beta's account
    bindGrokSessionAccount("session_beta", "acct_beta_v2");
    strictEqual(getGrokSessionAccount("session_beta"), "acct_beta_v2");
    // Alpha unaffected
    strictEqual(getGrokSessionAccount("session_alpha"), "acct_alpha");

    unbindGrokSessionAccount("session_alpha");
    check(getGrokSessionAccount("session_alpha") === undefined, "unbound session returns undefined");
    check(getGrokSessionAccount("session_beta") === "acct_beta_v2", "other session unaffected by unbind");

    unbindGrokSessionAccount("session_beta");

    // -------------------------------------------------------------------------
    // 11. Fork inheritance (header-based)
    // -------------------------------------------------------------------------
    console.log("\n--- Fork inheritance ---");

    {
      const parentPath = join(agentDir, "fork-parent.jsonl");
      const parentHeader = {
        type: "session",
        id: "fp1",
        timestamp: new Date().toISOString(),
        cwd: "/tmp",
        grokAccountStorageId: "acct_parent",
      };
      await writeFile(parentPath, `${JSON.stringify(parentHeader)}\n{"type":"message"}\n`, "utf8");

      const inherited = readGrokSessionAccountFromHeader(parentPath);
      strictEqual(inherited, "acct_parent", "reads parent binding from header");

      // Simulate fork: create child with inherited binding
      const childPath = join(agentDir, "fork-child.jsonl");
      const childHeader = {
        type: "session",
        id: "fc1",
        timestamp: new Date().toISOString(),
        cwd: "/tmp",
        parentSession: parentPath,
        grokAccountStorageId: "acct_parent",
      };
      await writeFile(childPath, `${JSON.stringify(childHeader)}\n{"type":"message"}\n`, "utf8");

      bindAndPersist("fc1", "acct_parent", childPath);
      strictEqual(getGrokSessionAccount("fc1"), "acct_parent", "fork child inherits parent binding");

      const reRead = readGrokSessionAccountFromHeader(childPath);
      strictEqual(reRead, "acct_parent", "forked header contains inherited binding");
    }

    // -------------------------------------------------------------------------
    // 12. Reject empty storage id
    // -------------------------------------------------------------------------
    console.log("\n--- Reject empty storage id ---");

    await rejects(
      () => getGrokAccessTokenImpl("", agentDir, ".json"),
      /required/i,
      "rejects empty storage id",
    );

    await rejects(
      () => getGrokAccessTokenImpl("   ", agentDir, ".json"),
      /required/i,
      "rejects whitespace storage id",
    );

    // -------------------------------------------------------------------------
    // 13. bind with empty storage id is no-op
    // -------------------------------------------------------------------------
    console.log("\n--- bind empty storage id is no-op ---");

    bindGrokSessionAccount("empty_test", "");
    check(getGrokSessionAccount("empty_test") === undefined, "bind with empty string is no-op");

    bindGrokSessionAccount("empty_test", "   ");
    check(getGrokSessionAccount("empty_test") === undefined, "bind with whitespace is no-op");

    // -------------------------------------------------------------------------
    // 14. Atomic credential file update preserves existing fields
    // -------------------------------------------------------------------------
    console.log("\n--- Atomic credential update ---");

    {
      const storageId = "acct_atomic";
      const credPath = join(agentDir, `${storageId}.json`);
      const now = Date.now();
      const extraField = "should-survive";
      await writeFile(
        credPath,
        JSON.stringify({ access: "tok_old", refresh: "rt_atomic", expires: now - 3600_000, extraField, idToken: "jwt.payload.sig" }),
        { mode: 0o600 },
      );

      const token = await getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`);
      check(token.refreshed, "token was refreshed");
      check(token.accessToken.startsWith("refreshed_"), "new token synthesized");

      const updated = JSON.parse(await readFile(credPath, "utf8")) as Record<string, unknown>;
      strictEqual(updated.extraField, extraField, "extra fields preserved after refresh");
      strictEqual(updated.idToken, "jwt.payload.sig", "idToken preserved after refresh");
      strictEqual(updated.refresh, "rt_atomic", "refresh token preserved");
    }

    // -------------------------------------------------------------------------
    // 15. Invalid credential JSON → error
    // -------------------------------------------------------------------------
    console.log("\n--- Invalid credential ---");

    {
      const storageId = "acct_bad_json";
      await writeFile(join(agentDir, `${storageId}.json`), "not json", { mode: 0o600 });

      await rejects(
        () => getGrokAccessTokenImpl(storageId, agentDir, `${storageId}.json`),
        /not found|invalid/i,
        "throws for invalid credential JSON",
      );
    }

    console.log("\nAll tests completed.");
  } finally {
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }

  summary();
}

main().catch((err: unknown) => {
  console.error("Test harness error:", err);
  process.exit(2);
});
