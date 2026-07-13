// META-001/META-004: bounded streaming session metadata scanner tests.
//
// Run:
//   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-session-metadata-scanner.mjs
//
// Companion memory/API gates: scripts/test-session-list-performance.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const {
  scanSessionMetadata,
  scanSessionMetadataFromChunks,
  scanSessionInventory,
  DEFAULT_FIRST_MESSAGE_MAX_CHARS,
} = await import("../lib/session-metadata-scanner.ts");
const { truncateSessionTitle, SESSION_TITLE_MAX_LENGTH } = await import("../lib/session-title.ts");

const tmpRoot = mkdtempSync(join(tmpdir(), "pi-meta-scan-"));
let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures++;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

function header(overrides = {}) {
  return {
    type: "session",
    version: 1,
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

function assistantMessage(text, overrides = {}) {
  return {
    type: "message",
    id: "m-asst",
    parentId: "m-user",
    timestamp: "2026-01-01T00:02:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: Date.parse("2026-01-01T00:02:00.000Z"),
      ...overrides.message,
    },
    ...overrides,
  };
}

function writeJsonl(filePath, records) {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function chunksOf(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function randomChunks(text, seed = 1) {
  const out = [];
  let i = 0;
  let s = seed;
  while (i < text.length) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = (s % 17) + 1;
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

function scanText(text, opts = {}) {
  return scanSessionMetadataFromChunks(chunksOf(text, opts.chunkSize ?? 64), {
    path: opts.path ?? "/tmp/x.jsonl",
    mtime: opts.mtime ?? new Date("2026-01-03T00:00:00.000Z"),
  }, opts);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

console.log("session-metadata-scanner");

await test("basic header + user/assistant metadata", async () => {
  const text = [
    JSON.stringify(header()),
    JSON.stringify(userMessage("Hello world from user")),
    JSON.stringify(assistantMessage("Hi there")),
  ].join("\n");
  const meta = scanText(text);
  assert.ok(meta);
  assert.equal(meta.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(meta.cwd, "/tmp/demo");
  assert.equal(meta.messageCount, 2);
  assert.equal(meta.firstMessage, "Hello world from user");
  assert.equal(meta.created.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(meta.modified.toISOString(), "2026-01-01T00:02:00.000Z");
  assert.equal("allMessagesText" in meta, false);
  assert.equal("allMessages" in meta, false);
});

await test("content text blocks join like SDK", async () => {
  const rec = {
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-01-01T00:01:00.000Z",
    message: {
      role: "user",
      content: [
        { type: "text", text: "partA" },
        { type: "image", url: "x" },
        { type: "text", text: "partB" },
      ],
      timestamp: 1,
    },
  };
  const meta = scanText([JSON.stringify(header()), JSON.stringify(rec)].join("\n"));
  assert.equal(meta.firstMessage, "partA partB");
});

await test("first user after assistant; toolResult counts message but not title", async () => {
  const records = [
    header(),
    {
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: "2026-01-01T00:01:00.000Z",
      message: { role: "assistant", content: "boot", timestamp: 1000 },
    },
    {
      type: "message",
      id: "t1",
      parentId: "a1",
      timestamp: "2026-01-01T00:01:30.000Z",
      message: { role: "toolResult", content: "tool body MARKER_TOOL", toolCallId: "x" },
    },
    userMessage("Real title here"),
  ];
  const meta = scanText(records.map((r) => JSON.stringify(r)).join("\n"));
  assert.equal(meta.messageCount, 3);
  assert.equal(meta.firstMessage, "Real title here");
  assert.ok(!JSON.stringify(meta).includes("MARKER_TOOL"));
});

await test("session_info latest name and explicit clear", async () => {
  const records = [
    header(),
    { type: "session_info", name: "First" },
    userMessage("msg"),
    { type: "session_info", name: "Second" },
    { type: "session_info", name: "   " },
  ];
  const meta = scanText(records.map((r) => JSON.stringify(r)).join("\n"));
  assert.equal(meta.name, undefined);
  assert.equal(meta.firstMessage, "msg");
});

await test("field order independence inside records", async () => {
  const headerReordered = {
    cwd: "/tmp/order",
    timestamp: "2026-02-01T00:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
    type: "session",
    parentSession: "/path/to/parent.jsonl",
    version: 1,
  };
  const msgReordered = {
    message: {
      content: "Order independent title",
      timestamp: 5000,
      role: "user",
    },
    timestamp: "2026-02-01T00:05:00.000Z",
    type: "message",
    id: "m",
    parentId: null,
  };
  const meta = scanText([JSON.stringify(headerReordered), JSON.stringify(msgReordered)].join("\n"));
  assert.equal(meta.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(meta.cwd, "/tmp/order");
  assert.equal(meta.parentSessionPath, "/path/to/parent.jsonl");
  assert.equal(meta.firstMessage, "Order independent title");
  assert.equal(meta.modified.toISOString(), new Date(5000).toISOString());
});

await test("escape sequences and unicode", async () => {
  const body = "line1\\nline2\\t\\\"quoted\\\" and \\u4e2d\\u6587";
  // Build raw JSON line with escapes preserved
  const line = `{"type":"message","id":"m","parentId":null,"timestamp":"2026-01-01T00:01:00.000Z","message":{"role":"user","content":"${body}","timestamp":1}}`;
  const meta = scanText([JSON.stringify(header()), line].join("\n"));
  assert.equal(meta.firstMessage, "line1\nline2\t\"quoted\" and 中文");
});

await test("chunk size 1 and random chunks match", async () => {
  const records = [
    header({ projectId: "p1", spaceId: "main", studioChild: { kind: "ypi-studio-child-session", taskId: "t", runId: "r", member: "implementer" } }),
    { type: "session_info", name: "Named" },
    userMessage("Title from chunks"),
    assistantMessage("reply"),
  ];
  const text = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const a = scanSessionMetadataFromChunks(chunksOf(text, 1), { path: "a", mtime: new Date(1) });
  const b = scanSessionMetadataFromChunks(randomChunks(text, 42), { path: "b", mtime: new Date(1) });
  const c = scanSessionMetadataFromChunks([text], { path: "c", mtime: new Date(1) });
  assert.deepEqual(
    { id: a.id, cwd: a.cwd, name: a.name, firstMessage: a.firstMessage, messageCount: a.messageCount, modified: a.modified.toISOString() },
    { id: b.id, cwd: b.cwd, name: b.name, firstMessage: b.firstMessage, messageCount: b.messageCount, modified: b.modified.toISOString() },
  );
  assert.deepEqual(
    { id: a.id, name: a.name, firstMessage: a.firstMessage, messageCount: a.messageCount },
    { id: c.id, name: c.name, firstMessage: c.firstMessage, messageCount: c.messageCount },
  );
  assert.equal(a.name, "Named");
  assert.equal(a.firstMessage, "Title from chunks");
});

await test("orphan and malformed isolation", async () => {
  const orphan = scanText(JSON.stringify({ type: "message", message: { role: "user", content: "x" } }));
  assert.equal(orphan, null);

  const malformed = scanText("{not-json\n");
  assert.equal(malformed, null);

  // Truncated after valid header still returns header metadata.
  const partial = scanText(JSON.stringify(header()) + "\n{\"type\":\"message\"");
  assert.ok(partial);
  assert.equal(partial.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(partial.messageCount, 0);
});

await test("firstMessage is bounded; huge content not retained", async () => {
  const marker = "HUGE_MARKER_SHOULD_NOT_LEAK";
  const huge = `${"A".repeat(200)}${marker}${"B".repeat(300_000)}`;
  // Build JSON without JSON.stringify of the huge string through a second buffer if possible.
  // JSON.stringify is fine for fixture construction; the scanner must not keep the body.
  const records = [header(), userMessage(huge), assistantMessage("ok")];
  const text = records.map((r) => JSON.stringify(r)).join("\n");
  assert.ok(text.length > 300_000);

  const meta = scanSessionMetadataFromChunks(chunksOf(text, 1024), {
    path: "/tmp/huge.jsonl",
    mtime: new Date(),
  }, { firstMessageMaxChars: 100 });

  assert.ok(meta);
  assert.equal(meta.firstMessage.length, 100);
  assert.equal(meta.firstMessage, "A".repeat(100));
  const serialized = JSON.stringify(meta);
  assert.ok(!serialized.includes(marker));
  assert.ok(!serialized.includes("B".repeat(50)));
  assert.equal(meta.messageCount, 2);
  assert.equal("allMessagesText" in meta, false);
});

await test("display first 50 chars stable under bound >= 50", async () => {
  const title = "一二三四五六七八九十".repeat(5) + "EXTRA_TAIL_SHOULD_CLIP";
  const meta = scanText(
    [JSON.stringify(header()), JSON.stringify(userMessage(title))].join("\n"),
    { firstMessageMaxChars: DEFAULT_FIRST_MESSAGE_MAX_CHARS },
  );
  // Collapse whitespace like session-title and take 50 chars.
  const normalized = meta.firstMessage.replace(/\s+/g, " ").trim();
  const display = normalized.length > 50 ? normalized.slice(0, 50) : normalized;
  assert.equal(display, title.replace(/\s+/g, " ").trim().slice(0, 50));
});

await test("modified prefers message.timestamp over entry/header/mtime", async () => {
  const msg = {
    type: "message",
    id: "m",
    parentId: null,
    timestamp: "2026-01-01T00:01:00.000Z",
    message: {
      role: "user",
      content: "x",
      timestamp: Date.parse("2026-06-01T12:00:00.000Z"),
    },
  };
  const meta = scanText([JSON.stringify(header()), JSON.stringify(msg)].join("\n"), {
    mtime: new Date("2020-01-01T00:00:00.000Z"),
  });
  assert.equal(meta.modified.toISOString(), "2026-06-01T12:00:00.000Z");
});

await test("file + inventory APIs", async () => {
  const dir = join(tmpRoot, "sessions", "--tmp-demo--");
  mkdirSync(dir, { recursive: true });
  const fileA = join(dir, "2026-01-01T00-00-00_aaaa.jsonl");
  const fileB = join(dir, "2026-01-01T00-00-01_bbbb.jsonl");
  writeJsonl(fileA, [header({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), userMessage("Alpha title")]);
  writeJsonl(fileB, [
    header({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/other" }),
    userMessage("Beta title"),
    assistantMessage("reply"),
  ]);

  const one = await scanSessionMetadata(fileA, { readChunkSize: 7 });
  assert.ok(one);
  assert.equal(one.firstMessage, "Alpha title");

  const all = await scanSessionInventory({ rootDir: join(tmpRoot, "sessions"), concurrency: 2 });
  assert.equal(all.length, 2);
  assert.ok(all.every((s) => !("allMessagesText" in s)));
  const ids = new Set(all.map((s) => s.id));
  assert.ok(ids.has("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  assert.ok(ids.has("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
});

await test("CRLF and no trailing newline", async () => {
  const text = `${JSON.stringify(header())}\r\n${JSON.stringify(userMessage("crlf title"))}`;
  const meta = scanText(text, { chunkSize: 3 });
  assert.equal(meta.firstMessage, "crlf title");
});

await test("surrogate pairs and nested unknown fields ignored", async () => {
  const title = "emoji 🚀 rocket and 👍";
  const records = [
    {
      ...header(),
      projectId: "proj-a",
      spaceId: "main",
      extraNested: { deep: { arr: [1, { x: "skip" }] }, keep: false },
    },
    {
      type: "custom",
      customType: "noise",
      data: { huge: "SHOULD_NOT_BE_TITLE", nested: [{ a: 1 }] },
    },
    {
      type: "compaction",
      summary: "SUMMARY_MUST_NOT_LEAK",
      firstKeptEntryId: "m",
      tokensBefore: 1,
    },
    userMessage(title),
    assistantMessage("ok"),
  ];
  const meta = scanText(records.map((r) => JSON.stringify(r)).join("\n"), { chunkSize: 1 });
  assert.equal(meta.firstMessage, title);
  assert.equal(meta.messageCount, 2);
  const serialized = JSON.stringify(meta);
  assert.ok(!serialized.includes("SHOULD_NOT_BE_TITLE"));
  assert.ok(!serialized.includes("SUMMARY_MUST_NOT_LEAK"));
});

await test("no messages yields SDK-compatible firstMessage placeholder", async () => {
  const meta = scanText(JSON.stringify(header({ id: "33333333-3333-4333-8333-333333333333" })));
  assert.ok(meta);
  assert.equal(meta.messageCount, 0);
  // Matches SessionManager.buildSessionInfo: firstMessage || "(no messages)".
  assert.equal(meta.firstMessage, "(no messages)");
  assert.equal(meta.name, undefined);
});

await test("SDK metadata differential on small fixtures (firstMessage prefix-compatible)", async () => {
  const dir = join(tmpRoot, "sdk-diff");
  mkdirSync(dir, { recursive: true });

  const fixtures = [
    {
      file: join(dir, "basic.jsonl"),
      records: [
        header({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/a" }),
        { type: "session_info", name: "Alpha" },
        userMessage("Hello alpha user"),
        assistantMessage("Alpha reply"),
      ],
    },
    {
      file: join(dir, "blocks.jsonl"),
      records: [
        header({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/b", parentSession: "/tmp/parent.jsonl" }),
        {
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-03-01T00:00:00.000Z",
          message: {
            role: "user",
            content: [
              { type: "text", text: "Block" },
              { type: "image", url: "x" },
              { type: "text", text: "Title" },
            ],
            timestamp: Date.parse("2026-03-01T00:00:00.000Z"),
          },
        },
        assistantMessage("b-reply"),
        { type: "session_info", name: "  " },
      ],
    },
    {
      file: join(dir, "order.jsonl"),
      records: [
        {
          cwd: "/tmp/c",
          parentSession: "/old/parent.jsonl",
          timestamp: "2026-04-01T00:00:00.000Z",
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          type: "session",
          version: 3,
        },
        {
          message: { content: "Reordered fields title", timestamp: 9_000, role: "user" },
          timestamp: "2026-04-01T00:01:00.000Z",
          type: "message",
          id: "m",
          parentId: null,
        },
      ],
    },
    {
      file: join(dir, "tool-then-user.jsonl"),
      records: [
        header({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", cwd: "/tmp/d" }),
        {
          type: "message",
          id: "a1",
          parentId: null,
          timestamp: "2026-01-01T00:00:10.000Z",
          message: { role: "assistant", content: "boot", timestamp: 10 },
        },
        {
          type: "message",
          id: "t1",
          parentId: "a1",
          timestamp: "2026-01-01T00:00:20.000Z",
          message: { role: "toolResult", content: "tool", toolCallId: "x" },
        },
        userMessage("After tool title"),
      ],
    },
  ];

  for (const fixture of fixtures) writeJsonl(fixture.file, fixture.records);

  const sdkList = await SessionManager.listAll(dir);
  const lightList = await scanSessionInventory({ rootDir: dir, concurrency: 2 });
  assert.equal(lightList.length, fixtures.length);
  assert.equal(sdkList.length, fixtures.length);

  const byIdSdk = new Map(sdkList.map((s) => [s.id, s]));
  for (const light of lightList) {
    const sdk = byIdSdk.get(light.id);
    assert.ok(sdk, `missing sdk session ${light.id}`);
    assert.equal(light.cwd, sdk.cwd);
    assert.equal(light.name, sdk.name);
    assert.equal(light.messageCount, sdk.messageCount);
    assert.equal(light.parentSessionPath, sdk.parentSessionPath);
    assert.equal(light.created.toISOString(), new Date(sdk.created).toISOString());
    assert.equal(light.modified.toISOString(), new Date(sdk.modified).toISOString());

    // firstMessage: light is bounded; under the bound it must equal SDK (SDK uses "(no messages)" placeholder).
    const sdkFirst = sdk.firstMessage === "(no messages)" ? "" : sdk.firstMessage;
    if (sdkFirst.length <= DEFAULT_FIRST_MESSAGE_MAX_CHARS) {
      assert.equal(light.firstMessage, sdkFirst);
    } else {
      assert.equal(light.firstMessage, sdkFirst.slice(0, DEFAULT_FIRST_MESSAGE_MAX_CHARS));
    }

    assert.equal("allMessagesText" in light, false);
    assert.equal(typeof sdk.allMessagesText, "string");

    // Display title first 50 chars must match full-prefix truncation.
    const displayLight = truncateSessionTitle(light.firstMessage || "");
    const displaySdk = truncateSessionTitle(sdkFirst);
    assert.equal(displayLight, displaySdk);
    assert.ok(displayLight.length <= SESSION_TITLE_MAX_LENGTH);
  }
});

await test("mid-file malformed line does not poison later valid records in isolation", async () => {
  // Single-file: truncated/malformed after header still returns header metadata (already covered).
  // Inventory isolation: one bad file must not drop siblings.
  const dir = join(tmpRoot, "isolate");
  mkdirSync(dir, { recursive: true });
  writeJsonl(join(dir, "good.jsonl"), [header({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }), userMessage("good")]);
  writeFileSync(join(dir, "bad.jsonl"), "{not valid jsonl\n{\"type\":", "utf8");
  writeJsonl(join(dir, "also-good.jsonl"), [
    header({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", cwd: "/tmp/z" }),
    userMessage("also good"),
  ]);

  const all = await scanSessionInventory({ rootDir: dir, concurrency: 3 });
  assert.equal(all.length, 2);
  const ids = new Set(all.map((s) => s.id));
  assert.ok(ids.has("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"));
  assert.ok(ids.has("ffffffff-ffff-4fff-8fff-ffffffffffff"));
});

// Cleanup
try {
  rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  // ignore
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
