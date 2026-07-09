// Lightweight smoke tests for `ypic` CLI pure helpers.
//
// `bin/ypic.js` exports a small set of pure helpers (arg parsing, URL
// construction, SSE event parsing, plan-review path resolution, hint
// truncation) when required as a module (its `main()` only runs under
// `require.main === module`). This script imports those helpers and asserts
// the CLI contract without starting a chat or contacting a server.
//
// Run with:
//   node scripts/test-ypic-cli.mjs
//
// This complements (not replaces) the manual smoke checklist in
// docs/deployment/README.md and the ypic task plan.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// bin/ypic.js is CommonJS and only depends on Node built-ins. Use createRequire
// to load module.exports directly (its main() only runs under require.main).
const require = createRequire(import.meta.url);
const ypic = require(fileURLToPath(new URL("../bin/ypic.js", import.meta.url)));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("ypic CLI smoke tests");

check("parseCliArgs: defaults come from env when flags absent", () => {
  const prevPort = process.env.PI_WEB_PORT;
  const prevHost = process.env.PI_WEB_HOST;
  process.env.PI_WEB_PORT = "7777";
  process.env.PI_WEB_HOST = "10.0.0.1";
  try {
    const a = ypic.parseCliArgs([]);
    assert.equal(a.port, "7777");
    assert.equal(a.hostname, "10.0.0.1");
    assert.equal(a.continue, false);
    assert.equal(a.resume, null);
    assert.equal(a.help, false);
    assert.equal(a.message, null);
  } finally {
    if (prevPort === undefined) delete process.env.PI_WEB_PORT;
    else process.env.PI_WEB_PORT = prevPort;
    if (prevHost === undefined) delete process.env.PI_WEB_HOST;
    else process.env.PI_WEB_HOST = prevHost;
  }
});

check("parseCliArgs: flags + positional message", () => {
  const a = ypic.parseCliArgs(["--port", "9999", "-H", "1.2.3.4", "-c", "hello", "world"]);
  assert.equal(a.port, "9999");
  assert.equal(a.hostname, "1.2.3.4");
  assert.equal(a.continue, true);
  assert.equal(a.resume, null);
  assert.equal(a.help, false);
  assert.equal(a.message, "hello world");
});

check("parseCliArgs: --resume captures a session id", () => {
  const a = ypic.parseCliArgs(["--resume", "sess_123"]);
  assert.equal(a.resume, "sess_123");
  assert.equal(a.continue, false);
});

check("parseCliArgs: --help short-circuits to help=true", () => {
  const a = ypic.parseCliArgs(["-h", "ignored message"]);
  assert.equal(a.help, true);
  // message is still captured but caller should treat help as authoritative.
  assert.equal(a.message, "ignored message");
});

check("buildBaseUrl: uses default port/host when unset", () => {
  const url = ypic.buildBaseUrl({ port: null, hostname: null });
  assert.equal(url, "http://127.0.0.1:30141");
});

check("buildBaseUrl: respects provided port/host", () => {
  const url = ypic.buildBaseUrl({ port: "8080", hostname: "example.local" });
  assert.equal(url, "http://example.local:8080");
});

check("buildSessionWebUrl: points at fixed session URL", () => {
  const url = ypic.buildSessionWebUrl("http://127.0.0.1:30142", "sess abc");
  assert.equal(url, "http://127.0.0.1:30142/?session=sess%20abc");
});

check("buildResumeCommand: includes connection flags and session id", () => {
  const cmd = ypic.buildResumeCommand({ port: "30142", hostname: "127.0.0.1" }, "sess_123");
  assert.equal(cmd, "ypic --port 30142 --hostname 127.0.0.1 --resume sess_123");
});

check("oneLineTrunc: collapses whitespace and truncates with ellipsis", () => {
  assert.equal(ypic.oneLineTrunc("a  b\n c", 100), "a b c");
  assert.equal(ypic.oneLineTrunc("0123456789", 5), "0123…");
  assert.equal(ypic.oneLineTrunc(null), "");
});

function sseParse(rawEvent) {
  let ev = null;
  ypic.handleRawEvent(rawEvent, (e) => { ev = e; });
  return ev;
}

check("handleRawEvent: parses single-line JSON data", () => {
  const ev = sseParse("data: {\"type\":\"agent_end\"}\n");
  assert.deepEqual(ev, { type: "agent_end" });
});

check("handleRawEvent: joins multi-line data fields with newline", () => {
  const raw = "data: {\"type\":\"text\",\ndata:  \"value\":\"a\\nb\"}\n";
  const ev = sseParse(raw);
  assert.deepEqual(ev, { type: "text", value: "a\nb" });
});

check("handleRawEvent: ignores comments and non-data lines", () => {
  const raw = ": heartbeat\nevent: foo\ndata: {\"type\":\"ok\"}\n\n";
  const ev = sseParse(raw);
  assert.deepEqual(ev, { type: "ok" });
});

check("handleRawEvent: no data lines yields no event (does not throw)", () => {
  assert.equal(sseParse(": comment only\n"), null);
  assert.equal(sseParse(""), null);
});

check("handleRawEvent: non-JSON payload is ignored (does not throw)", () => {
  assert.equal(sseParse("data: not-json\n"), null);
});

check("planReviewPathForTask: prefers artifacts.files['plan-review'].path", () => {
  const task = { artifacts: { files: { "plan-review": { path: ".ypi/tasks/abc/plan-review.md" } } } };
  assert.equal(ypic.planReviewPathForTask(task), ".ypi/tasks/abc/plan-review.md");
});

check("planReviewPathForTask: falls back to pathLabel + filename", () => {
  const task = { pathLabel: ".ypi/tasks/abc" };
  assert.equal(ypic.planReviewPathForTask(task), ".ypi/tasks/abc/plan-review.md");
});

check("planReviewPathForTask: tolerates null/odd payloads", () => {
  assert.equal(ypic.planReviewPathForTask(null), null);
  assert.equal(ypic.planReviewPathForTask({ artifacts: { files: {} } }), null);
});

check("shortToolHint: shows first known arg key", () => {
  assert.equal(ypic.shortToolHint("read", { path: "/a/b/c.txt" }), " path=/a/b/c.txt");
  assert.equal(ypic.shortToolHint("bash", { command: "ls -la" }), " command=ls -la");
  // Long values are truncated.
  const long = "x".repeat(80);
  const hinted = ypic.shortToolHint("read", { path: long });
  assert.match(hinted, /^ path=x{57}…$/);
});

check("shortToolHint: empty for missing args", () => {
  assert.equal(ypic.shortToolHint("tool", null), "");
  assert.equal(ypic.shortToolHint("tool", { other: "x" }), "");
});

console.log(`\n${passed} checks passed`);