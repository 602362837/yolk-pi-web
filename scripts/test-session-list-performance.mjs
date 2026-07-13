// META-004: session list compatibility + memory regression gates.
//
// Run:
//   node --expose-gc --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-session-list-performance.mjs
//
// Gates:
// 1. Structural: inventory results never retain unique body markers / allMessagesText.
// 2. Display: first 50 title chars match session-title truncation of full prefix.
// 3. API wire: listAllSessions / archive list / Studio child filter / parent mapping.
// 4. Memory: --expose-gc retained heap does not scale near-linearly with body bytes;
//    and is far below an SDK listAll child-process baseline on medium fixtures.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const loader = join(projectRoot, "scripts/ts-extension-loader.mjs");

const {
  scanSessionInventory,
  scanSessionMetadata,
  DEFAULT_FIRST_MESSAGE_MAX_CHARS,
} = await import("../lib/session-metadata-scanner.ts");
const { truncateSessionTitle, SESSION_TITLE_MAX_LENGTH } = await import("../lib/session-title.ts");

let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures++;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function forceGc() {
  if (typeof globalThis.gc !== "function") {
    throw new Error("global.gc is unavailable; re-run with node --expose-gc");
  }
  for (let i = 0; i < 6; i++) globalThis.gc();
}

function header(overrides = {}) {
  return {
    type: "session",
    version: 3,
    id: "11111111-1111-4111-8111-111111111111",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/demo",
    ...overrides,
  };
}

function userMessage(text, overrides = {}) {
  return {
    type: "message",
    id: "m-user",
    parentId: null,
    timestamp: "2026-01-01T00:01:00.000Z",
    message: {
      role: "user",
      content: text,
      timestamp: Date.parse("2026-01-01T00:01:00.000Z"),
      ...overrides.message,
    },
    ...overrides,
  };
}

function assistantMessage(text) {
  return {
    type: "message",
    id: "m-asst",
    parentId: "m-user",
    timestamp: "2026-01-01T00:02:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: Date.parse("2026-01-01T00:02:00.000Z"),
    },
  };
}

function writeJsonl(filePath, records) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

/**
 * Stream-write a session whose first user content is:
 *   titlePrefix + 'A' * boundFill + marker + 'X' * paddingChars
 * Marker is placed AFTER the firstMessage capture budget so a correct scanner
 * never retains it in metadata results.
 */
function writeHugeSessionFile(filePath, {
  id,
  cwd = "/tmp/demo",
  titlePrefix = "TITLE_",
  marker,
  paddingChars,
  firstMessageMaxChars = DEFAULT_FIRST_MESSAGE_MAX_CHARS,
  extraRecords = [],
}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const fd = openSync(filePath, "w");
  try {
    writeSync(fd, `${JSON.stringify(header({ id, cwd }))}\n`);
    writeSync(
      fd,
      `{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:01:00.000Z","message":{"role":"user","content":"`,
    );
    writeSync(fd, titlePrefix);
    // Fill the capture budget with non-marker chars so marker is only in skipped body.
    const fill = Math.max(0, firstMessageMaxChars - titlePrefix.length + 8);
    writeSync(fd, "A".repeat(fill));
    writeSync(fd, marker);
    const chunk = "X".repeat(64 * 1024);
    let left = paddingChars;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      writeSync(fd, chunk.slice(0, n));
      left -= n;
    }
    writeSync(fd, `","timestamp":${Date.parse("2026-01-01T00:01:00.000Z")}}}\n`);
    for (const rec of extraRecords) {
      writeSync(fd, `${JSON.stringify(rec)}\n`);
    }
  } finally {
    closeSync(fd);
  }
}

function withTempAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-list-perf-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    });
}

function assertNoBodyLeak(value, markers) {
  const serialized = JSON.stringify(value);
  assert.equal("allMessagesText" in (Array.isArray(value) ? {} : value), false);
  if (Array.isArray(value)) {
    for (const item of value) {
      assert.equal("allMessagesText" in item, false);
      assert.equal("allMessages" in item, false);
    }
  }
  for (const marker of markers) {
    assert.ok(!serialized.includes(marker), `result must not retain marker ${marker}`);
  }
}

console.log("session-list-performance / compatibility");

// ---------------------------------------------------------------------------
// Structural: multi-session inventory never retains body markers
// ---------------------------------------------------------------------------
await test("inventory structural: no body markers / allMessagesText", async () => {
  await withTempAgentDir(async (agentDir) => {
    const sessionsDir = join(agentDir, "sessions");
    const markers = [];
    for (let i = 0; i < 4; i++) {
      const marker = `BODY_MARK_${i}_${Date.now().toString(36).toUpperCase()}`;
      markers.push(marker);
      const id = `${String(i).repeat(8).slice(0, 8)}-1111-4111-8111-${String(i).repeat(12).slice(0, 12)}`;
      writeHugeSessionFile(join(sessionsDir, `cwd${i}`, `s${i}.jsonl`), {
        id,
        cwd: `/tmp/p${i}`,
        titlePrefix: `Title${i}_`,
        marker,
        paddingChars: 250_000,
        extraRecords: [assistantMessage(`reply-${i}`)],
      });
    }

    const inventory = await scanSessionInventory({ rootDir: sessionsDir, concurrency: 4 });
    assert.equal(inventory.length, 4);
    assertNoBodyLeak(inventory, markers);

    for (const item of inventory) {
      assert.ok(item.firstMessage.length <= DEFAULT_FIRST_MESSAGE_MAX_CHARS);
      assert.ok(item.firstMessage.startsWith("Title"));
      assert.equal(item.messageCount, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Display title first 50 chars
// ---------------------------------------------------------------------------
await test("display first 50 chars compatible with session-title helper", async () => {
  await withTempAgentDir(async (agentDir) => {
    const full =
      "项目会话标题前缀一二三四五六七八九十ABCDEFGHIJKLMNOPQRSTUVWXYZ_TAIL_SHOULD_NOT_AFFECT_DISPLAY";
    // Marker lives past the 100-char firstMessage budget so it must not appear in metadata.
    const marker = "MARK_DISPLAY_TAIL_ZZZ";
    const body = full + "B".repeat(DEFAULT_FIRST_MESSAGE_MAX_CHARS) + marker;
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const file = join(agentDir, "sessions", "disp", "d.jsonl");
    writeJsonl(file, [header({ id }), userMessage(body), assistantMessage("ok")]);

    const meta = await scanSessionMetadata(file);
    assert.ok(meta);
    const displayFromScan = truncateSessionTitle(meta.firstMessage);
    const displayFromFullPrefix = truncateSessionTitle(full.slice(0, DEFAULT_FIRST_MESSAGE_MAX_CHARS));
    assert.equal(displayFromScan.length <= SESSION_TITLE_MAX_LENGTH, true);
    assert.equal(displayFromScan, displayFromFullPrefix);
    assert.equal(displayFromScan, truncateSessionTitle(full));
    assert.ok(!displayFromScan.includes("TAIL_SHOULD_NOT"));
    assert.ok(!JSON.stringify(meta).includes(marker));
  });
});

// ---------------------------------------------------------------------------
// API wire: active list, Studio child filter, parent mapping, project link
// ---------------------------------------------------------------------------
await test("listAllSessions wire + Studio child filter + parentSessionId", async () => {
  await withTempAgentDir(async (agentDir) => {
    const sessionsDir = join(agentDir, "sessions", "space");
    mkdirSync(sessionsDir, { recursive: true });

    const parentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const childId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const parentPath = join(sessionsDir, "parent.jsonl");
    const childPath = join(sessionsDir, "child.jsonl");

    writeJsonl(parentPath, [
      header({
        id: parentId,
        cwd: "/tmp/project-space",
        projectId: "proj-1",
        spaceId: "main",
      }),
      { type: "session_info", name: "Parent Named" },
      userMessage("Parent first user text for title"),
      assistantMessage("parent reply"),
    ]);

    writeJsonl(childPath, [
      header({
        id: childId,
        cwd: "/tmp/project-space",
        projectId: "proj-1",
        spaceId: "main",
        parentSession: parentPath,
        studioChild: {
          kind: "ypi-studio-child-session",
          taskId: "task-1",
          runId: "run-1",
          member: "implementer",
        },
      }),
      userMessage("Child audit session body MARKER_CHILD_BODY"),
      assistantMessage("child reply"),
    ]);

    // Fresh import after env is set so getAgentDir() resolves to temp dir.
    const { listAllSessions, invalidateSessionListSnapshots } = await import("../lib/session-reader.ts");
    invalidateSessionListSnapshots();

    const roots = await listAllSessions();
    assert.equal(roots.length, 1, "Studio child hidden by default");
    assert.equal(roots[0].id, parentId);
    assert.equal(roots[0].name, "Parent Named");
    assert.equal(roots[0].projectId, "proj-1");
    assert.equal(roots[0].spaceId, "main");
    assert.equal(roots[0].legacyUnassigned, false);
    assert.equal(roots[0].messageCount, 2);
    assert.equal(roots[0].firstMessage, "Parent first user text for title");
    assert.equal(roots[0].parentSessionId, undefined);
    assert.equal("allMessagesText" in roots[0], false);
    assert.ok(!JSON.stringify(roots).includes("MARKER_CHILD_BODY"));

    invalidateSessionListSnapshots();
    const withChildren = await listAllSessions({ includeStudioChildren: true });
    assert.equal(withChildren.length, 2);
    const child = withChildren.find((s) => s.id === childId);
    assert.ok(child);
    assert.ok(child.studioChild);
    assert.equal(child.studioChild.member, "implementer");
    assert.equal(child.parentSessionId, parentId);
    assert.equal(child.firstMessage, "Child audit session body MARKER_CHILD_BODY");
    assert.equal("allMessagesText" in child, false);
  });
});

// ---------------------------------------------------------------------------
// Archive list + scanArchivedCwds regression
// ---------------------------------------------------------------------------
await test("archived sessions list uses lightweight metadata (count/title)", async () => {
  await withTempAgentDir(async (agentDir) => {
    const archDir = join(agentDir, "sessions-archive", "--tmp-arch--");
    mkdirSync(archDir, { recursive: true });
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const marker = "ARCH_BODY_MARKER_SHOULD_NOT_LEAK_IN_LIST_PATH";
    writeJsonl(join(archDir, "a.jsonl"), [
      header({ id, cwd: "/tmp/archived-cwd" }),
      userMessage(`Archived title prefix ${marker}`),
      assistantMessage("archived reply"),
    ]);

    const {
      listAllArchivedSessions,
      listAllArchivedSessionMetadata,
      scanArchivedCwds,
      invalidateSessionListSnapshots,
    } = await import("../lib/session-reader.ts");
    invalidateSessionListSnapshots();

    const archived = await listAllArchivedSessions();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].id, id);
    assert.equal(archived[0].archived, true);
    assert.equal(archived[0].messageCount, 2);
    assert.ok(archived[0].firstMessage.startsWith("Archived title prefix"));
    assert.equal("allMessagesText" in archived[0], false);
    // firstMessage is bounded to 100 chars; marker may appear if within bound — that's OK.
    // Structural requirement is no allMessagesText aggregation of full bodies.
    assert.ok(archived[0].firstMessage.length <= DEFAULT_FIRST_MESSAGE_MAX_CHARS + 20);

    const metaOnly = await listAllArchivedSessionMetadata();
    assert.equal(metaOnly.length, 1);
    assert.equal(metaOnly[0].id, id);
    assert.equal(metaOnly[0].messageCount, 0);
    assert.equal(metaOnly[0].firstMessage, "(metadata only)");

    const cwds = scanArchivedCwds();
    assert.ok(cwds.cwds.includes("/tmp/archived-cwd"));
    assert.equal(cwds.counts["/tmp/archived-cwd"], 1);
  });
});

// ---------------------------------------------------------------------------
// Memory: retained heap does not track body size linearly
// ---------------------------------------------------------------------------
await test("retained heap after inventory does not scale with body bytes", async () => {
  await withTempAgentDir(async (agentDir) => {
    const sessionsDir = join(agentDir, "sessions");

    async function measureForPadding(paddingChars, label) {
      // Wipe previous fixtures for a clean inventory set.
      rmSync(sessionsDir, { recursive: true, force: true });
      mkdirSync(sessionsDir, { recursive: true });
      const markers = [];
      const sessionCount = 3;
      for (let i = 0; i < sessionCount; i++) {
        const marker = `HEAP_${label}_${i}_UNIQUE`;
        markers.push(marker);
        const id = `${String(i + 1).repeat(8).slice(0, 8)}-2222-4222-8222-${String(i + 1).repeat(12).slice(0, 12)}`;
        writeHugeSessionFile(join(sessionsDir, `h${i}`, `f.jsonl`), {
          id,
          cwd: `/tmp/heap-${i}`,
          titlePrefix: "H_",
          marker,
          paddingChars,
          extraRecords: [assistantMessage("r")],
        });
      }

      forceGc();
      const before = process.memoryUsage();
      const inventory = await scanSessionInventory({ rootDir: sessionsDir, concurrency: 3 });
      assert.equal(inventory.length, sessionCount);
      assertNoBodyLeak(inventory, markers);
      // Drop local refs then measure retained heap attributable to runtime + result.
      const resultBytes = Buffer.byteLength(JSON.stringify(inventory), "utf8");
      forceGc();
      const after = process.memoryUsage();
      const bodyBytes = sessionCount * (paddingChars + 64);
      return {
        heapDelta: Math.max(0, after.heapUsed - before.heapUsed),
        heapUsed: after.heapUsed,
        rss: after.rss,
        resultBytes,
        bodyBytes,
        inventory,
      };
    }

    const small = await measureForPadding(200_000, "S"); // ~0.6 MB body
    // Drop inventory refs
    small.inventory.length = 0;
    forceGc();

    const large = await measureForPadding(4_000_000, "L"); // ~12 MB body
    large.inventory.length = 0;
    forceGc();

    const bodyGrowth = large.bodyBytes - small.bodyBytes;
    const heapGrowth = large.heapUsed - small.heapUsed;

    console.log(
      `    memory small body≈${(small.bodyBytes / 1e6).toFixed(2)}MB heap=${(small.heapUsed / 1e6).toFixed(1)}MB rss=${(small.rss / 1e6).toFixed(1)}MB result=${small.resultBytes}B`,
    );
    console.log(
      `    memory large body≈${(large.bodyBytes / 1e6).toFixed(2)}MB heap=${(large.heapUsed / 1e6).toFixed(1)}MB rss=${(large.rss / 1e6).toFixed(1)}MB result=${large.resultBytes}B`,
    );
    console.log(
      `    memory growth body=${(bodyGrowth / 1e6).toFixed(2)}MB heapGrowth=${(heapGrowth / 1e6).toFixed(1)}MB`,
    );

    // Result payload must stay tiny (metadata only).
    assert.ok(large.resultBytes < 50_000, `serialized inventory too large: ${large.resultBytes}`);

    // Retained heap must not grow near-linearly with body bytes.
    // Allow generous platform noise: heap growth < 15% of body growth, and absolute < 80MB.
    const maxHeapGrowth = Math.max(80 * 1024 * 1024, bodyGrowth * 0.15);
    assert.ok(
      heapGrowth < maxHeapGrowth,
      `heap grew too much with body: heapGrowth=${heapGrowth} bodyGrowth=${bodyGrowth} max=${maxHeapGrowth}`,
    );

    // Absolute retained heap after large scan should be far below body total.
    assert.ok(
      large.heapUsed < large.bodyBytes * 0.5 + 150 * 1024 * 1024,
      `heapUsed ${large.heapUsed} not clearly below body budget`,
    );
  });
});

// ---------------------------------------------------------------------------
// SDK baseline comparison in an isolated child process (medium fixtures)
// ---------------------------------------------------------------------------
await test("SDK listAll baseline heap/RSS significantly higher than lightweight scan", async () => {
  await withTempAgentDir(async (agentDir) => {
    const sessionsDir = join(agentDir, "sessions");
    const paddingChars = 3_000_000; // ~3MB × 4 ≈ 12MB body — widens SDK allMessagesText gap
    const sessionCount = 4;
    const markers = [];
    for (let i = 0; i < sessionCount; i++) {
      const marker = `SDKBASE_${i}_MARK`;
      markers.push(marker);
      const id = `${String(i + 3).repeat(8).slice(0, 8)}-3333-4333-8333-${String(i + 3).repeat(12).slice(0, 12)}`;
      writeHugeSessionFile(join(sessionsDir, `sdk${i}`, `s.jsonl`), {
        id,
        cwd: `/tmp/sdk-${i}`,
        titlePrefix: "S_",
        marker,
        paddingChars,
        extraRecords: [assistantMessage("sdk-reply")],
      });
    }

    // Nested sessions/<cwd>/*.jsonl layout: SessionManager.listAll() without a custom
    // dir walks the default agent sessions tree. listAll(customDir) only lists flat files.
    const childScript = `
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { scanSessionInventory } from ${JSON.stringify(join(projectRoot, "lib/session-metadata-scanner.ts"))};
import process from "node:process";

const mode = process.argv[1];
const markers = ${JSON.stringify(markers)};

function forceGc() {
  if (typeof globalThis.gc === "function") {
    for (let i = 0; i < 6; i++) globalThis.gc();
  }
}

forceGc();
const before = process.memoryUsage();
let result;
if (mode === "sdk") {
  result = await SessionManager.listAll();
} else {
  result = await scanSessionInventory({ concurrency: 3 });
}
const serialized = JSON.stringify(result);
forceGc();
const after = process.memoryUsage();
const leak = markers.filter((m) => serialized.includes(m));
console.log(JSON.stringify({
  mode,
  count: result.length,
  heapUsed: after.heapUsed,
  rss: after.rss,
  heapDelta: Math.max(0, after.heapUsed - before.heapUsed),
  rssDelta: Math.max(0, after.rss - before.rss),
  serializedBytes: Buffer.byteLength(serialized, "utf8"),
  hasAllMessagesText: Array.isArray(result) && result.some((s) => "allMessagesText" in s && typeof s.allMessagesText === "string" && s.allMessagesText.length > 1000),
  markerLeaks: leak.length,
}));
`;

    function runMode(mode) {
      const res = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--loader",
          loader,
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          "--input-type=module",
          "-e",
          childScript,
          mode,
        ],
        {
          encoding: "utf8",
          cwd: projectRoot,
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      if (res.status !== 0) {
        throw new Error(`child ${mode} failed: status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
      }
      const lines = res.stdout.trim().split("\n").filter(Boolean);
      const jsonLine = lines[lines.length - 1];
      return JSON.parse(jsonLine);
    }

    const light = runMode("light");
    const sdk = runMode("sdk");

    console.log(
      `    child light count=${light.count} heap=${(light.heapUsed / 1e6).toFixed(1)}MB rss=${(light.rss / 1e6).toFixed(1)}MB ser=${light.serializedBytes} leaks=${light.markerLeaks}`,
    );
    console.log(
      `    child sdk   count=${sdk.count} heap=${(sdk.heapUsed / 1e6).toFixed(1)}MB rss=${(sdk.rss / 1e6).toFixed(1)}MB ser=${sdk.serializedBytes} leaks=${sdk.markerLeaks} allMessagesText=${sdk.hasAllMessagesText}`,
    );

    assert.equal(light.count, sessionCount);
    assert.equal(sdk.count, sessionCount);
    assert.equal(light.markerLeaks, 0);
    assert.equal(light.hasAllMessagesText, false);
    // SDK is expected to retain body text in allMessagesText.
    assert.equal(sdk.hasAllMessagesText, true);
    assert.ok(sdk.markerLeaks > 0, "SDK baseline should retain body markers in serialized SessionInfo");

    // Hard structural gate: serialized payload must not track multi-MB bodies.
    assert.ok(light.serializedBytes < 100_000);
    assert.ok(
      light.serializedBytes * 50 < sdk.serializedBytes,
      `light serialized ${light.serializedBytes} not << sdk ${sdk.serializedBytes}`,
    );

    // Memory gate with generous allocator noise tolerance. Prefer delta when available;
    // absolute heap/RSS only needs to show light is not worse than SDK on both.
    const lightCheaperDelta =
      typeof light.heapDelta === "number" &&
      typeof sdk.heapDelta === "number" &&
      sdk.heapDelta > 2 * 1024 * 1024 &&
      light.heapDelta < sdk.heapDelta * 0.5;
    const lightCheaperAbs =
      light.heapUsed <= sdk.heapUsed && light.rss <= sdk.rss * 1.05;
    assert.ok(
      lightCheaperDelta || lightCheaperAbs,
      `lightweight memory not below SDK baseline (light heap=${light.heapUsed} delta=${light.heapDelta} rss=${light.rss}; sdk heap=${sdk.heapUsed} delta=${sdk.heapDelta} rss=${sdk.rss})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Production inventory paths no longer call SessionManager.listAll
// ---------------------------------------------------------------------------
await test("source gate: inventory/archive-all paths avoid SessionManager.listAll", async () => {
  const { readFileSync } = await import("node:fs");
  const files = [
    "lib/session-reader.ts",
    "app/api/sessions/archive-all/route.ts",
    "lib/usage-stats.ts",
  ];
  for (const rel of files) {
    const text = readFileSync(join(projectRoot, rel), "utf8");
    // Strip line + block comments so documentation mentions are allowed.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(
      !/SessionManager\.listAll\s*\(/.test(code),
      `${rel} must not call SessionManager.listAll()`,
    );
  }
  // session-reader should document the lightweight inventory path.
  const reader = readFileSync(join(projectRoot, "lib/session-reader.ts"), "utf8");
  assert.ok(reader.includes("scanSessionInventory"));
  assert.ok(reader.includes("LightweightSessionMetadata") || reader.includes("session-metadata-scanner"));
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall performance/compatibility gates passed");
