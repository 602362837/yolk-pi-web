/**
 * SCI L1 extension behavior tests (checks.md E1–E6).
 *
 * Boots createYpiStudioExtension via jiti (parameter properties in deps),
 * drives a lightweight fake pi API, and asserts:
 * - E1 input → continue without transform / no studio state appended
 * - E2 awaiting_approval + approval text still records grant
 * - E3 before_agent_start injects state and uses event.prompt as knowledge query
 * - E4 startup first-reply once; second turn omits first-reply
 * - E5 startup has no second knowledge block (source + runtime)
 * - E6 YPI_STUDIO_SUBAGENT_CHILD=1 skips main extension registration
 *
 * Manual residual (documented for checker): full pi SDK agent loop / real chat UAT.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": root },
  interopDefault: true,
  tryNative: false,
});

const extensionMod = await jiti.import(pathToFileURL(join(root, "lib/ypi-studio-extension.ts")).href);
const tasksMod = await jiti.import(pathToFileURL(join(root, "lib/ypi-studio-tasks.ts")).href);

const { createYpiStudioExtension } = extensionMod;
const {
  createYpiStudioTask,
  getYpiStudioTaskDetail,
  recordYpiStudioUserApproval,
  transitionYpiStudioTask,
} = tasksMod;

let passed = 0;
function test(name, fn) {
  const result = fn();
  if (result && typeof result.then === "function") {
    throw new Error(`test("${name}") returned a Promise; keep SCI harness sync`);
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

function createFakePi() {
  /** @type {Map<string, Function[]>} */
  const handlers = new Map();
  return {
    handlers,
    registerTool() {},
    registerCommand() {},
    sendUserMessage() {},
    getThinkingLevel() {
      return "off";
    },
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    emit(name, event, ctx = {}) {
      const list = handlers.get(name) ?? [];
      let last;
      for (const handler of list) {
        last = handler(event, ctx);
      }
      return last;
    },
  };
}

function withTempWorkspace(fn) {
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-extension-sci-"));
  mkdirSync(join(cwd, ".ypi"), { recursive: true });
  const prevChild = process.env.YPI_STUDIO_SUBAGENT_CHILD;
  try {
    delete process.env.YPI_STUDIO_SUBAGENT_CHILD;
    return fn(cwd);
  } finally {
    if (prevChild === undefined) delete process.env.YPI_STUDIO_SUBAGENT_CHILD;
    else process.env.YPI_STUDIO_SUBAGENT_CHILD = prevChild;
    rmSync(cwd, { recursive: true, force: true });
  }
}

function writePlanReview(cwd, taskId) {
  const dir = join(cwd, ".ypi", "tasks", taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plan-review.md"),
    "# Plan Review\n\nMeaningful SCI approval plan content for harness tests.\n",
    "utf8",
  );
}

function writeKnowledge(cwd, { id, title, summary, tags = [] }) {
  const knowledgeDir = join(cwd, ".ypi", "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  const knowledgePath = `.ypi/knowledge/${id}.md`;
  writeFileSync(join(cwd, knowledgePath), `# ${title}\n\n${summary}\n`, "utf8");
  const index = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    entries: [
      {
        id,
        title,
        taskId: id,
        taskKey: `archived:test:${id}`,
        workflowId: "feature-dev",
        summary,
        tags,
        sourceTaskPath: `.ypi/tasks/archive/test/${id}`,
        knowledgePath,
        createdAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
        sourceArtifacts: ["handoff.md"],
      },
    ],
  };
  writeFileSync(join(knowledgeDir, "index.json"), JSON.stringify(index, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Source-level contracts (cheap, stable)
// ---------------------------------------------------------------------------

const extensionSource = readFileSync(join(root, "lib/ypi-studio-extension.ts"), "utf8");

test("source: input handler has no transform action", () => {
  // Isolate the input handler body.
  const inputIdx = extensionSource.indexOf('pi.on?.("input"');
  assert.ok(inputIdx >= 0, "input handler present");
  const beforeIdx = extensionSource.indexOf('pi.on?.("before_agent_start"', inputIdx);
  assert.ok(beforeIdx > inputIdx, "before_agent_start after input");
  const inputBody = extensionSource.slice(inputIdx, beforeIdx);
  assert.ok(inputBody.includes('action: "continue"'), "input returns continue");
  assert.ok(!inputBody.includes("transform"), "input body must not transform");
  assert.ok(!inputBody.includes("buildStudioState"), "input must not buildStudioState");
  assert.ok(inputBody.includes("recordYpiStudioUserApproval"), "approval side effect retained");
});

test("source: before_agent_start uses event.prompt and buildStudioState", () => {
  const start = extensionSource.indexOf('pi.on?.("before_agent_start"');
  assert.ok(start >= 0);
  const end = extensionSource.indexOf('pi.on?.("context"', start);
  const body = extensionSource.slice(start, end > start ? end : start + 1200);
  assert.ok(body.includes("event.prompt") || body.includes("prompt"), "reads prompt");
  assert.ok(body.includes("buildStudioState(root, key, prompt)"), "prompt query path");
  assert.ok(body.includes("systemPrompt"), "returns systemPrompt");
  assert.ok(body.includes("startupContext"), "one-shot startup still present");
});

test("source: startupContext does not fetch knowledge (E5)", () => {
  const start = extensionSource.indexOf("function startupContext");
  assert.ok(start >= 0);
  const end = extensionSource.indexOf("\nfunction ", start + 1);
  const body = extensionSource.slice(start, end > start ? end : start + 1500);
  assert.ok(body.includes("ypi-studio-context"), "keeps studio context");
  assert.ok(body.includes("FIRST_REPLY_NOTICE") || body.includes("ypi-studio-first-reply"), "keeps first-reply");
  assert.ok(!body.includes("getYpiStudioKnowledgeContextForPrompt"), "no knowledge in startup");
  assert.ok(!body.includes("ypi-studio-knowledge"), "no knowledge tag in startup");
});

test("source: child env early-return still present (E6)", () => {
  assert.ok(
    extensionSource.includes('process.env.YPI_STUDIO_SUBAGENT_CHILD === "1"'),
    "child guard present",
  );
});

// ---------------------------------------------------------------------------
// Runtime harness
// ---------------------------------------------------------------------------

test("E1: input returns continue and does not append studio state", () => {
  withTempWorkspace((cwd) => {
    const sessionId = "sci-e1-clean-input";
    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId })(pi);

    const userText = "请用工作室做功能：SCI 回归";
    const result = pi.emit("input", { text: userText }, {});
    assert.deepEqual(result, { action: "continue" });
    assert.equal(typeof result.text, "undefined");
    // No transform payload means user JSONL stays clean.
    assert.ok(!JSON.stringify(result).includes("ypi-studio-state"));
    assert.ok(!JSON.stringify(result).includes(userText + "\n\n"));
  });
});

test("E1b: empty / whitespace input continues without approval path crash", () => {
  withTempWorkspace((cwd) => {
    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId: "sci-e1-empty" })(pi);
    assert.deepEqual(pi.emit("input", { text: "" }, {}), { action: "continue" });
    assert.deepEqual(pi.emit("input", { text: "   " }, {}), { action: "continue" });
    assert.deepEqual(pi.emit("input", {}, {}), { action: "continue" });
  });
});

test("E2: approval text still records grant via input handler", () => {
  withTempWorkspace((cwd) => {
    const sessionId = "sci-e2-approval";
    const contextId = `pi_${sessionId}`;
    const task = createYpiStudioTask({
      cwd,
      title: "SCI approval grant",
      workflowId: "feature-dev",
      contextId,
    });
    writePlanReview(cwd, task.id);
    transitionYpiStudioTask(task.id, {
      cwd,
      to: "awaiting_approval",
      override: true,
      contextId,
    });

    // Sanity: helper still works in isolation.
    assert.equal(
      getYpiStudioTaskDetail(cwd, task.id)?.meta?.approvalGrant,
      undefined,
      "precondition: no grant",
    );

    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId })(pi);

    const approvalText = "确认，开始实现";
    const result = pi.emit("input", { text: approvalText }, {});
    assert.deepEqual(result, { action: "continue" });
    assert.ok(!JSON.stringify(result).includes("ypi-studio-state"), "no transform state on approval path");

    const after = getYpiStudioTaskDetail(cwd, task.id);
    assert.ok(after?.meta?.approvalGrant, "approvalGrant written by input side effect");
    assert.equal(after.meta.approvalGrant.contextId, contextId);
    assert.equal(after.meta.approvalGrant.source, "user-input");
  });
});

test("E2b: non-approval text does not invent a grant (spy path)", () => {
  withTempWorkspace((cwd) => {
    const sessionId = "sci-e2-non-approval";
    const contextId = `pi_${sessionId}`;
    const task = createYpiStudioTask({
      cwd,
      title: "SCI non approval",
      workflowId: "feature-dev",
      contextId,
    });
    writePlanReview(cwd, task.id);
    transitionYpiStudioTask(task.id, {
      cwd,
      to: "awaiting_approval",
      override: true,
      contextId,
    });

    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId })(pi);
    pi.emit("input", { text: "我再想想，先不批准" }, {});

    const after = getYpiStudioTaskDetail(cwd, task.id);
    assert.equal(after?.meta?.approvalGrant, undefined);
    // Direct helper parity
    assert.equal(recordYpiStudioUserApproval(cwd, contextId, "随便聊聊"), null);
  });
});

test("E3: before_agent_start injects state and uses event.prompt as knowledge query", () => {
  withTempWorkspace((cwd) => {
    const uniqueToken = "sci_prompt_query_token_xyzzy";
    writeKnowledge(cwd, {
      id: "20260718-sci-prompt-query",
      title: `Knowledge about ${uniqueToken}`,
      summary: `Reusable note keyed by ${uniqueToken} for SCI prompt-query parity.`,
      tags: [uniqueToken, "sci"],
    });

    const sessionId = "sci-e3-prompt-query";
    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId })(pi);

    const prompt = `Please recall ${uniqueToken} knowledge while orchestrating.`;
    const result = pi.emit(
      "before_agent_start",
      { systemPrompt: "BASE_SYSTEM", prompt },
      {},
    );

    assert.ok(result?.systemPrompt, "returns systemPrompt");
    assert.match(result.systemPrompt, /BASE_SYSTEM/);
    assert.match(result.systemPrompt, /<ypi-studio-state>/);
    assert.match(result.systemPrompt, /Status: no_task/);
    assert.match(result.systemPrompt, /YPI Studio rule: the main session must orchestrate/);
    // Knowledge block should prefer prompt-token hit over unrelated entries.
    assert.match(result.systemPrompt, /<ypi-studio-knowledge>/);
    assert.match(result.systemPrompt, new RegExp(uniqueToken));
  });
});

test("E3b: active task state uses Task line + prompt in knowledge haystack", () => {
  withTempWorkspace((cwd) => {
    const uniqueToken = "sci_task_bound_knowledge_token";
    writeKnowledge(cwd, {
      id: "20260718-sci-task-bound",
      title: `Bound ${uniqueToken}`,
      summary: `Task-bound knowledge ${uniqueToken}`,
      tags: [uniqueToken],
    });

    const sessionId = "sci-e3-bound";
    const contextId = `pi_${sessionId}`;
    const task = createYpiStudioTask({
      cwd,
      title: "SCI bound task",
      workflowId: "feature-dev",
      contextId,
    });
    writePlanReview(cwd, task.id);
    transitionYpiStudioTask(task.id, {
      cwd,
      to: "awaiting_approval",
      override: true,
      contextId,
    });
    recordYpiStudioUserApproval(cwd, contextId, "确认，开始实现");
    transitionYpiStudioTask(task.id, {
      cwd,
      to: "implementing",
      override: true,
      contextId,
    });

    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId })(pi);
    const result = pi.emit(
      "before_agent_start",
      { systemPrompt: "", prompt: uniqueToken },
      {},
    );
    assert.match(result.systemPrompt, new RegExp(`Task: ${task.id} \\(implementing\\)`));
    assert.match(result.systemPrompt, new RegExp(uniqueToken));
  });
});

test("E4: startup first-reply only on first before_agent_start for key", () => {
  withTempWorkspace((cwd) => {
    const sessionId = "sci-e4-startup-once";
    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId })(pi);

    const first = pi.emit("before_agent_start", { systemPrompt: "S", prompt: "hi" }, {});
    assert.match(first.systemPrompt, /<ypi-studio-first-reply>/);
    assert.match(first.systemPrompt, /<ypi-studio-context>/);

    const second = pi.emit("before_agent_start", { systemPrompt: "S", prompt: "again" }, {});
    assert.ok(!second.systemPrompt.includes("<ypi-studio-first-reply>"), "no second first-reply");
    assert.ok(!second.systemPrompt.includes("<ypi-studio-context>"), "no second startup context");
    // Per-turn state still present.
    assert.match(second.systemPrompt, /<ypi-studio-state>/);
  });
});

test("E5 runtime: first systemPrompt has at most one knowledge block (from buildStudioState)", () => {
  withTempWorkspace((cwd) => {
    writeKnowledge(cwd, {
      id: "20260718-sci-startup-dedupe",
      title: "startup dedupe knowledge",
      summary: "Should appear once per turn via buildStudioState only.",
      tags: ["startup", "dedupe"],
    });
    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId: "sci-e5-dedupe" })(pi);
    const result = pi.emit(
      "before_agent_start",
      { systemPrompt: "", prompt: "startup dedupe knowledge" },
      {},
    );
    const matches = result.systemPrompt.match(/<ypi-studio-knowledge>/g) ?? [];
    assert.ok(matches.length <= 1, `expected ≤1 knowledge block, got ${matches.length}`);
    // first-reply present, knowledge not nested inside a second startup copy
    assert.match(result.systemPrompt, /<ypi-studio-first-reply>/);
  });
});

test("E6: child env skips handler registration", () => {
  withTempWorkspace((cwd) => {
    process.env.YPI_STUDIO_SUBAGENT_CHILD = "1";
    const pi = createFakePi();
    createYpiStudioExtension(cwd, { sessionId: "sci-e6-child" })(pi);
    assert.equal(pi.handlers.size, 0, "child must not register pi.on handlers");
    // No tools/commands either — registerTool/Command are no-ops but handlers map empty is the SCI signal.
  });
});

console.log(`\n${passed} tests passed`);
