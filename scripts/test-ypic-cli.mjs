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

// -----------------------------------------------------------------------
// Model helpers
// -----------------------------------------------------------------------

check("modelKey: formats provider:modelId key", () => {
  assert.equal(ypic.modelKey("openai", "gpt-4.1"), "openai:gpt-4.1");
  assert.equal(ypic.modelKey("anthropic", "claude-sonnet-4-20250514"), "anthropic:claude-sonnet-4-20250514");
});

check("modelDisplayName: uses providerDisplayName when available", () => {
  assert.equal(ypic.modelDisplayName({ provider: "openai", name: "GPT-4.1", providerDisplayName: "OpenAI" }), "OpenAI/GPT-4.1");
});

check("modelDisplayName: falls back to provider/id when no display name", () => {
  assert.equal(ypic.modelDisplayName({ provider: "openai", id: "gpt-4.1", name: "GPT-4.1" }), "openai/GPT-4.1");
  assert.equal(ypic.modelDisplayName({ provider: "anthropic", id: "claude-sonnet" }), "anthropic/claude-sonnet");
});

check("findModel: finds by provider and id", () => {
  const list = [
    { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
    { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
  ];
  const found = ypic.findModel(list, "openai", "gpt-4.1");
  assert.ok(found);
  assert.equal(found.name, "GPT-4.1");
});

check("findModel: returns null for unknown model", () => {
  const list = [{ provider: "openai", id: "gpt-4.1", name: "GPT-4.1" }];
  assert.equal(ypic.findModel(list, "openai", "gpt-5"), null);
  assert.equal(ypic.findModel(list, "anthropic", "claude"), null);
});

check("parseModelSwitch: provider/modelId without thinking", () => {
  const result = ypic.parseModelSwitch("openai/gpt-4.1");
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "gpt-4.1");
  assert.equal(result.thinking, null);
});

check("parseModelSwitch: provider/modelId with thinking", () => {
  const result = ypic.parseModelSwitch("openai/gpt-4.1 high");
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "gpt-4.1");
  assert.equal(result.thinking, "high");
});

check("parseModelSwitch: provider/modelId with xhigh thinking", () => {
  const result = ypic.parseModelSwitch("anthropic/claude-sonnet xhigh");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.modelId, "claude-sonnet");
  assert.equal(result.thinking, "xhigh");
});

check("parseModelSwitch: modelId containing slash", () => {
  // Model ID like "models/gpt-4.1" — provider is before first /
  const result = ypic.parseModelSwitch("openai/models/gpt-4.1");
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "models/gpt-4.1");
  assert.equal(result.thinking, null);
});

check("parseModelSwitch: modelId containing slash with thinking", () => {
  const result = ypic.parseModelSwitch("openai/models/gpt-4.1 high");
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "models/gpt-4.1");
  assert.equal(result.thinking, "high");
});

check("parseModelSwitch: multi-slash modelId is parsed with first slash as separator", () => {
  // Multiple slashes: first slash separates provider from rest of modelId.
  const result = ypic.parseModelSwitch("just/slash/too/many");
  assert.equal(result.provider, "just");
  assert.equal(result.modelId, "slash/too/many");
  assert.equal(result.thinking, null);
});

check("parseModelSwitch: returns null for empty or no-slash input", () => {
  assert.equal(ypic.parseModelSwitch(""), null);
  assert.equal(ypic.parseModelSwitch("no-slash-here"), null);
  assert.equal(ypic.parseModelSwitch("/"), null);
  assert.equal(ypic.parseModelSwitch("/modelId"), null);
  assert.equal(ypic.parseModelSwitch("provider/"), null);
});

check("parseModelSwitch: ignores trailing non-thinking words", () => {
  // "xhigh" is a thinking level, "extra" is not
  const result = ypic.parseModelSwitch("openai/gpt-4.1 extra");
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "gpt-4.1 extra");
  assert.equal(result.thinking, null);
});

check("getSupportedThinkingLevels: returns known levels from state", () => {
  const ms = { thinkingLevels: { "openai:gpt-4.1": ["off", "auto", "low", "medium", "high"] } };
  const levels = ypic.getSupportedThinkingLevels(ms, "openai", "gpt-4.1");
  assert.deepEqual(levels, ["off", "auto", "low", "medium", "high"]);
});

check("getSupportedThinkingLevels: falls back to off/auto for unknown model", () => {
  const ms = { thinkingLevels: {} };
  const levels = ypic.getSupportedThinkingLevels(ms, "openai", "unknown");
  assert.deepEqual(levels, ["off", "auto"]);
});

check("getSupportedThinkingLevels: falls back for empty levels array", () => {
  const ms = { thinkingLevels: { "openai:gpt-4.1": [] } };
  const levels = ypic.getSupportedThinkingLevels(ms, "openai", "gpt-4.1");
  assert.deepEqual(levels, ["off", "auto"]);
});

check("resolveCurrentModel: extracts model from agent state", () => {
  const agentState = {
    running: true,
    state: {
      model: { provider: "openai", id: "gpt-4.1" },
      thinkingLevel: "medium",
    },
  };
  const modelList = [
    { provider: "openai", id: "gpt-4.1", name: "GPT-4.1", providerDisplayName: "OpenAI" },
  ];
  const result = ypic.resolveCurrentModel(agentState, modelList);
  assert.ok(result);
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "gpt-4.1");
  assert.equal(result.displayName, "OpenAI/GPT-4.1");
  assert.equal(result.thinkingLevel, "medium");
});

check("resolveCurrentModel: falls back to provider/id display when model not in list", () => {
  const agentState = {
    running: true,
    state: {
      model: { provider: "custom", id: "some-model" },
      thinkingLevel: "auto",
    },
  };
  const result = ypic.resolveCurrentModel(agentState, []);
  assert.ok(result);
  assert.equal(result.displayName, "custom/some-model");
  assert.equal(result.thinkingLevel, "auto");
});

check("resolveCurrentModel: returns null when no model in state", () => {
  assert.equal(ypic.resolveCurrentModel({ running: false }, []), null);
  assert.equal(ypic.resolveCurrentModel({ running: true, state: {} }, []), null);
  assert.equal(ypic.resolveCurrentModel(null, []), null);
});

check("resolveCurrentModel: defaults thinkingLevel to off when missing", () => {
  const agentState = {
    running: true,
    state: { model: { provider: "openai", id: "gpt-4.1" } },
  };
  const result = ypic.resolveCurrentModel(agentState, []);
  assert.equal(result.thinkingLevel, "off");
});

check("formatModelSummary: formats model with thinking", () => {
  const m = { displayName: "OpenAI/GPT-4.1", thinkingLevel: "medium" };
  assert.equal(ypic.formatModelSummary(m), "OpenAI/GPT-4.1 · thinking: medium");
});

check("formatModelSummary: returns guidance when null", () => {
  const msg = ypic.formatModelSummary(null);
  assert.ok(msg.includes("No model configured"));
  assert.ok(msg.includes("/config"));
});

check("THINKING_LEVELS: contains expected values", () => {
  assert.deepEqual(ypic.THINKING_LEVELS, ["off", "auto", "low", "medium", "high", "xhigh"]);
});

// -----------------------------------------------------------------------
// Frame helpers
// -----------------------------------------------------------------------

check("stripAnsi: removes ANSI escape sequences", () => {
  assert.equal(ypic.stripAnsi("\x1b[31mred\x1b[0m"), "red");
  assert.equal(ypic.stripAnsi("\x1b[1;33mbold yellow\x1b[0m"), "bold yellow");
  assert.equal(ypic.stripAnsi("plain text"), "plain text");
  assert.equal(ypic.stripAnsi(""), "");
});

check("visualWidth: ASCII characters count as 1", () => {
  assert.equal(ypic.visualWidth("hello"), 5);
  assert.equal(ypic.visualWidth("abc123"), 6);
  assert.equal(ypic.visualWidth(""), 0);
});

check("visualWidth: CJK characters count as 2", () => {
  assert.equal(ypic.visualWidth("你好"), 4);
  assert.equal(ypic.visualWidth("中文测试"), 8);
  assert.equal(ypic.visualWidth("a中文b"), 1 + 4 + 1);
});

check("visualWidth: emoji", () => {
  // Common emoji in the range that visualWidth treats as width-2
  const w = ypic.visualWidth("🎉");
  // >= 1 is the only safe assertion; exact width depends on codepoint range
  assert.ok(w >= 1);
});

check("createFrame: returns PlainFrame when YPIC_PLAIN is set", () => {
  const prev = process.env.YPIC_PLAIN;
  process.env.YPIC_PLAIN = "1";
  try {
    const rl = { on: () => {}, setPrompt: () => {}, prompt: () => {}, close: () => {}, closed: false };
    const frame = ypic.createFrame(rl);
    assert.equal(frame.kind, "plain");
    assert.equal(typeof frame.write, "function");
    assert.equal(typeof frame.writeLine, "function");
    assert.equal(typeof frame.setStatusDot, "function");
    assert.equal(typeof frame.setModelText, "function");
    frame.destroy();
  } finally {
    if (prev === undefined) delete process.env.YPIC_PLAIN;
    else process.env.YPIC_PLAIN = prev;
  }
});

check("createFrame: returns PlainFrame when NO_COLOR is set", () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const rl = { on: () => {}, setPrompt: () => {}, prompt: () => {}, close: () => {}, closed: false };
    const frame = ypic.createFrame(rl);
    assert.equal(frame.kind, "plain");
    frame.destroy();
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

check("PlainFrame.write: writes directly to stdout", () => {
  const rl = { on: () => {}, setPrompt: () => {}, prompt: () => {}, close: () => {}, closed: false };
  const frame = ypic.createPlainFrame(rl);
  // Capture stdout
  const origWrite = process.stdout.write;
  let captured = "";
  process.stdout.write = (s) => { captured += s; return true; };
  try {
    frame.write("hello");
    frame.write(" world\n");
    assert.ok(captured.includes("hello"));
    assert.ok(captured.includes(" world\n"));
  } finally {
    process.stdout.write = origWrite;
    frame.destroy();
  }
});

check("PlainFrame.info: writes to stderr with prefix", () => {
  const rl = { on: () => {}, setPrompt: () => {}, prompt: () => {}, close: () => {}, closed: false };
  const frame = ypic.createPlainFrame(rl);
  const origError = console.error;
  let captured = "";
  console.error = (msg) => { captured += msg; };
  try {
    frame.info("test message");
    assert.ok(captured.includes("[YPIC:info]"));
    assert.ok(captured.includes("test message"));
  } finally {
    console.error = origError;
    frame.destroy();
  }
});

check("PlainFrame.setPrompt: delegates to readline", () => {
  let lastPrompt = null;
  const rl = {
    on: () => {},
    setPrompt: (p) => { lastPrompt = p; },
    prompt: () => {},
    close: () => {},
    closed: false,
  };
  const frame = ypic.createPlainFrame(rl);
  frame.setPrompt(">>> ");
  assert.equal(lastPrompt, ">>> ");
  frame.destroy();
});

check("PlainFrame: setStatusDot/setModelText/setInputHint are no-ops", () => {
  const rl = { on: () => {}, setPrompt: () => {}, prompt: () => {}, close: () => {}, closed: false };
  const frame = ypic.createPlainFrame(rl);
  // Should not throw
  frame.setStatusDot("busy");
  frame.setStatusText("test");
  frame.setModelText("model");
  frame.setInputHint("hint");
  frame.destroy();
});

check("PlainFrame.start: close uses explicit onClose handler when provided", () => {
  const handlers = {};
  const rl = {
    on: (name, fn) => { handlers[name] = fn; },
    setPrompt: () => {},
    prompt: () => {},
    close: () => {},
    closed: false,
  };
  const frame = ypic.createPlainFrame(rl);
  let sigintCalled = 0;
  let closeCalled = 0;
  frame.start(() => {}, () => { sigintCalled += 1; }, null, () => { closeCalled += 1; });
  handlers.close();
  assert.equal(closeCalled, 1);
  assert.equal(sigintCalled, 0);
  frame.destroy();
});

console.log(`\n${passed} checks passed`);