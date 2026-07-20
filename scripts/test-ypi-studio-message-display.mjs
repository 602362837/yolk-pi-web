/**
 * Unit tests for lib/ypi-studio-message-display.ts (SCI L0 strip/parse/tag + IMP-001 blocks).
 * Covers checks.md U1–U14 and B1–B10 boundaries.
 */
import assert from "node:assert/strict";
import {
  formatYpiStudioInjectionPreview,
  formatYpiStudioMessageTag,
  parseYpiStudioUserMessage,
  stripYpiStudioInjections,
  YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS,
  YPI_STUDIO_INJECTION_TAGS,
} from "../lib/ypi-studio-message-display.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// U1 — no tags pure text
test("U1: no tags", () => {
  const raw = "请帮我改一下登录页";
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.displayText, raw);
  assert.equal(parsed.rawText, raw);
  assert.equal(parsed.hadInjection, false);
  assert.equal(parsed.studioStatus, null);
  assert.equal(parsed.stripConfidence, "none");
  assert.equal(formatYpiStudioMessageTag(parsed.studioStatus), "");
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
});

// U2 — state block after user sentence
test("U2: user text + state block", () => {
  const raw = [
    "确认，开始实现",
    "",
    "<ypi-studio-state>",
    "Status: no_task",
    "No active Studio task.",
    "</ypi-studio-state>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.displayText, "确认，开始实现");
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.studioStatus, "no_task");
  assert.equal(parsed.stripConfidence, "full");
  assert.equal(formatYpiStudioMessageTag(parsed.studioStatus), "Studio · no_task");
  assert.ok(!parsed.displayText.includes("ypi-studio-state"));
  assert.equal(parsed.injectionBlocks.length, 1);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
  assert.match(parsed.injectionBlocks[0].raw, /^<ypi-studio-state>/);
  assert.match(parsed.injectionBlocks[0].raw, /<\/ypi-studio-state>$/);
  assert.equal(parsed.injectionText, parsed.injectionBlocks[0].raw);
});

// U3 — state + knowledge adjacent
test("U3: state + knowledge", () => {
  const raw = [
    "继续任务",
    "<ypi-studio-state>",
    "Task: 20260718-demo (implementing)",
    "Title: Demo",
    "</ypi-studio-state>",
    "<ypi-studio-knowledge>",
    "Reusable knowledge…",
    "</ypi-studio-knowledge>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.displayText, "继续任务");
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.studioStatus, "implementing");
  assert.equal(parsed.stripConfidence, "full");
  assert.ok(!parsed.displayText.includes("ypi-studio-knowledge"));
  assert.equal(parsed.injectionBlocks.length, 2);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
  assert.equal(parsed.injectionBlocks[1].tag, "ypi-studio-knowledge");
  assert.ok(parsed.injectionText.includes("<ypi-studio-state>"));
  assert.ok(parsed.injectionText.includes("<ypi-studio-knowledge>"));
});

// U4 — multi state blocks
test("U4: multi-block state", () => {
  const raw = [
    "hello",
    "<ypi-studio-state>",
    "Status: planning",
    "</ypi-studio-state>",
    "middle kept",
    "<ypi-studio-state>",
    "Status: implementing",
    "</ypi-studio-state>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.stripConfidence, "full");
  assert.match(parsed.displayText, /hello/);
  assert.match(parsed.displayText, /middle kept/);
  assert.ok(!parsed.displayText.includes("<ypi-studio-state>"));
  // First state status wins
  assert.equal(parsed.studioStatus, "planning");
  assert.equal(parsed.injectionBlocks.length, 2);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
  assert.equal(parsed.injectionBlocks[1].tag, "ypi-studio-state");
  assert.match(parsed.injectionBlocks[0].body, /planning/);
  assert.match(parsed.injectionBlocks[1].body, /implementing/);
});

// U5 — half-open tag: keep body, partial confidence
test("U5: half-open tag without close", () => {
  const raw = [
    "用户关键句必须保留",
    "<ypi-studio-state>",
    "Status: implementing",
    "没有闭合标签",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, false);
  assert.equal(parsed.stripConfidence, "partial");
  assert.equal(parsed.studioStatus, null);
  assert.match(parsed.displayText, /用户关键句必须保留/);
  assert.match(parsed.displayText, /没有闭合标签/);
  // incomplete open remains (fail-open on user text)
  assert.match(parsed.displayText, /<ypi-studio-state>/);
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
});

// U6 — code-like mention without a complete closed injection structure
test("U6: fenced mention of tag name without closed injection", () => {
  const raw = "文档里写了 `ypi-studio-state` 标签，但没有完整闭合注入结构";
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, false);
  assert.equal(parsed.stripConfidence, "none");
  assert.equal(parsed.displayText, raw);
  assert.deepEqual(parsed.injectionBlocks, []);
});

// U7 — bare literal without angle brackets
test("U7: bare ypi-studio-state literal", () => {
  const raw = "please do not strip ypi-studio-state from this sentence";
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.displayText, raw);
  assert.equal(parsed.hadInjection, false);
  assert.equal(parsed.stripConfidence, "none");
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
});

// U8 — Status: no_task
test("U8: Status no_task", () => {
  const raw = "<ypi-studio-state>\nStatus: no_task\n</ypi-studio-state>\nping";
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.studioStatus, "no_task");
  assert.equal(formatYpiStudioMessageTag(parsed.studioStatus), "Studio · no_task");
  assert.equal(parsed.displayText, "ping");
  assert.equal(parsed.injectionBlocks.length, 1);
});

// U9 — Task: x (implementing)
test("U9: Task id (implementing)", () => {
  const raw =
    "ok\n<ypi-studio-state>\nTask: 20260718-195741-demo (implementing)\nTitle: X\n</ypi-studio-state>";
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.studioStatus, "implementing");
  assert.equal(formatYpiStudioMessageTag(parsed.studioStatus), "Studio · implementing");
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
});

// U10 — knowledge only → context
test("U10: knowledge only → context", () => {
  const raw = [
    "问题",
    "<ypi-studio-knowledge>",
    "Reusable YPI Studio knowledge",
    "</ypi-studio-knowledge>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.studioStatus, "context");
  assert.equal(formatYpiStudioMessageTag(parsed.studioStatus), "Studio · context");
  assert.equal(parsed.displayText, "问题");
  assert.equal(parsed.injectionBlocks.length, 1);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-knowledge");
});

// U11 — excess blank lines tidied
test("U11: tidy blank lines", () => {
  const raw = [
    "line1",
    "",
    "",
    "",
    "<ypi-studio-state>",
    "Status: intake",
    "</ypi-studio-state>",
    "",
    "",
    "line2",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.displayText, "line1\n\nline2");
  assert.equal(parsed.studioStatus, "intake");
  assert.equal(parsed.injectionBlocks.length, 1);
});

// U12 — empty string
test("U12: empty string", () => {
  const parsed = parseYpiStudioUserMessage("");
  assert.equal(parsed.displayText, "");
  assert.equal(parsed.rawText, "");
  assert.equal(parsed.hadInjection, false);
  assert.equal(parsed.studioStatus, null);
  assert.equal(parsed.stripConfidence, "none");
  assert.equal(stripYpiStudioInjections(""), "");
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
});

// U13 — formatYpiStudioMessageTag(null)
test("U13: format null/undefined", () => {
  assert.equal(formatYpiStudioMessageTag(null), "");
  assert.equal(formatYpiStudioMessageTag(undefined), "");
});

// U14 — first-reply / context tags strip
test("U14: first-reply and context tags", () => {
  const raw = [
    "hi",
    "<ypi-studio-context>",
    "YPI Studio workflow context is available.",
    "</ypi-studio-context>",
    "<ypi-studio-first-reply>",
    "First visible reply…",
    "</ypi-studio-first-reply>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.stripConfidence, "full");
  assert.equal(parsed.studioStatus, "context");
  assert.equal(parsed.displayText, "hi");
  assert.equal(parsed.injectionBlocks.length, 2);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-context");
  assert.equal(parsed.injectionBlocks[1].tag, "ypi-studio-first-reply");
});

// Mixed: complete state + residual half knowledge open → partial, state status kept
test("mixed complete + residual open → partial", () => {
  const raw = [
    "body",
    "<ypi-studio-state>",
    "Task: t1 (awaiting_approval)",
    "</ypi-studio-state>",
    "<ypi-studio-knowledge>",
    "unclosed knowledge",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.stripConfidence, "partial");
  assert.equal(parsed.studioStatus, "awaiting_approval");
  assert.match(parsed.displayText, /body/);
  assert.match(parsed.displayText, /unclosed knowledge/);
  // B5: only complete blocks listed
  assert.equal(parsed.injectionBlocks.length, 1);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
  assert.ok(!parsed.injectionText.includes("unclosed knowledge"));
});

// stripYpiStudioInjections convenience
test("stripYpiStudioInjections convenience", () => {
  const raw = "x\n<ypi-studio-state>\nStatus: completed\n</ypi-studio-state>";
  assert.equal(stripYpiStudioInjections(raw), "x");
});

// known tag constant surface
test("exports known injection tags", () => {
  assert.deepEqual([...YPI_STUDIO_INJECTION_TAGS], [
    "ypi-studio-state",
    "ypi-studio-knowledge",
    "ypi-studio-context",
    "ypi-studio-first-reply",
  ]);
});

// awaiting_approval status + tag
test("awaiting_approval status parse", () => {
  const raw =
    "确认\n<ypi-studio-state>\nTask: abc (awaiting_approval)\n</ypi-studio-state>";
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.studioStatus, "awaiting_approval");
  assert.equal(formatYpiStudioMessageTag(parsed.studioStatus), "Studio · awaiting_approval");
});

// U6b — complete closed forged injection IS stripped (documented edge; full-block rule)
test("U6b: complete forged closed injection is stripped by full-block rule", () => {
  const raw = [
    "示例：",
    "<ypi-studio-state>",
    "Status: failed",
    "</ypi-studio-state>",
    "上面是示例标签",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.hadInjection, true);
  assert.equal(parsed.studioStatus, "failed");
  assert.equal(parsed.displayText, "示例：\n\n上面是示例标签");
  assert.equal(parsed.injectionBlocks.length, 1);
});

// completed / cancelled / unknown status tokens
test("status tokens: completed cancelled unknown", () => {
  const completed = parseYpiStudioUserMessage(
    "x\n<ypi-studio-state>\nStatus: completed\n</ypi-studio-state>",
  );
  assert.equal(completed.studioStatus, "completed");
  assert.equal(formatYpiStudioMessageTag(completed.studioStatus), "Studio · completed");

  const cancelled = parseYpiStudioUserMessage(
    "x\n<ypi-studio-state>\nTask: t (cancelled)\n</ypi-studio-state>",
  );
  assert.equal(cancelled.studioStatus, "cancelled");

  const blocked = parseYpiStudioUserMessage(
    "x\n<ypi-studio-state>\nStatus: blocked\n</ypi-studio-state>",
  );
  assert.equal(blocked.studioStatus, "unknown");
  assert.equal(formatYpiStudioMessageTag(blocked.studioStatus), "Studio · unknown");
});

// non-string coercion safety
test("non-string input coerces safely", () => {
  // @ts-expect-error intentional runtime guard
  const parsed = parseYpiStudioUserMessage(null);
  assert.equal(parsed.displayText, "");
  assert.equal(parsed.hadInjection, false);
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
});

// ─── IMP-001 B cases (injectionBlocks / injectionText / preview) ───

// B1 — no tags → empty blocks (also covered by U1)
test("B1: no tags → empty injectionBlocks and injectionText", () => {
  const parsed = parseYpiStudioUserMessage("plain user text only");
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
  assert.equal(parsed.hadInjection, false);
});

// B2 — user + state block details
test("B2: user + state → one block with tag/body/raw/start/end", () => {
  const open = "<ypi-studio-state>";
  const body = "\nStatus: implementing\n";
  const close = "</ypi-studio-state>";
  const blockRaw = `${open}${body}${close}`;
  const prefix = "确认实现\n\n";
  const raw = `${prefix}${blockRaw}`;
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.displayText, "确认实现");
  assert.equal(parsed.injectionBlocks.length, 1);
  const b = parsed.injectionBlocks[0];
  assert.equal(b.tag, "ypi-studio-state");
  assert.equal(b.body, body);
  assert.equal(b.raw, blockRaw);
  assert.equal(b.start, prefix.length);
  assert.equal(b.end, prefix.length + blockRaw.length);
  assert.equal(parsed.injectionText, blockRaw);
  assert.equal(raw.slice(b.start, b.end), b.raw);
});

// B3 — state + knowledge order and injectionText join
test("B3: state + knowledge order and injectionText join", () => {
  const state = "<ypi-studio-state>\nTask: t (planning)\n</ypi-studio-state>";
  const knowledge = "<ypi-studio-knowledge>\nK\n</ypi-studio-knowledge>";
  const raw = `继续\n${state}\n${knowledge}`;
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.injectionBlocks.length, 2);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
  assert.equal(parsed.injectionBlocks[1].tag, "ypi-studio-knowledge");
  assert.equal(parsed.injectionText, `${state}\n\n${knowledge}`);
  assert.ok(parsed.injectionText.indexOf("ypi-studio-state") < parsed.injectionText.indexOf("ypi-studio-knowledge"));
});

// B4 — multi state both present; first status wins
test("B4: multi state both in blocks; status from first", () => {
  const raw = [
    "hello",
    "<ypi-studio-state>",
    "Status: planning",
    "</ypi-studio-state>",
    "middle",
    "<ypi-studio-state>",
    "Status: implementing",
    "</ypi-studio-state>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.injectionBlocks.length, 2);
  assert.equal(parsed.studioStatus, "planning");
  assert.match(parsed.injectionBlocks[0].raw, /planning/);
  assert.match(parsed.injectionBlocks[1].raw, /implementing/);
});

// B5 — half-open not complete; complete sibling only
test("B5: half-open not listed; complete sibling only", () => {
  const raw = [
    "body",
    "<ypi-studio-state>",
    "Status: intake",
    "</ypi-studio-state>",
    "<ypi-studio-knowledge>",
    "half open only",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.stripConfidence, "partial");
  assert.equal(parsed.injectionBlocks.length, 1);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-state");
  assert.ok(!parsed.injectionBlocks.some((b) => b.tag === "ypi-studio-knowledge"));
});

// B6 — bare literal without angle brackets
test("B6: bare ypi-studio-state without brackets → empty blocks", () => {
  const parsed = parseYpiStudioUserMessage("mention ypi-studio-state literally");
  assert.deepEqual(parsed.injectionBlocks, []);
  assert.equal(parsed.injectionText, "");
});

// B7 — first-reply / context tags enter blocks
test("B7: first-reply / context enter blocks", () => {
  const raw = [
    "hi",
    "<ypi-studio-context>",
    "ctx body",
    "</ypi-studio-context>",
    "<ypi-studio-first-reply>",
    "reply body",
    "</ypi-studio-first-reply>",
  ].join("\n");
  const parsed = parseYpiStudioUserMessage(raw);
  assert.equal(parsed.injectionBlocks.length, 2);
  assert.equal(parsed.injectionBlocks[0].tag, "ypi-studio-context");
  assert.equal(parsed.injectionBlocks[0].body, "\nctx body\n");
  assert.equal(parsed.injectionBlocks[1].tag, "ypi-studio-first-reply");
  assert.equal(parsed.injectionBlocks[1].body, "\nreply body\n");
});

// B8 — short preview not truncated
test("B8: formatYpiStudioInjectionPreview short text", () => {
  const short = "<ypi-studio-state>\nStatus: x\n</ypi-studio-state>";
  const preview = formatYpiStudioInjectionPreview(short);
  assert.equal(preview.truncated, false);
  assert.equal(preview.text, short);
});

// B9 — preview > 64KiB truncated
test("B9: formatYpiStudioInjectionPreview > 64KiB truncated", () => {
  const huge = "A".repeat(YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS + 100);
  const preview = formatYpiStudioInjectionPreview(huge);
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.length, YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS + 2); // + "\n…"
  assert.ok(preview.text.endsWith("\n…"));
  assert.equal(preview.text.slice(0, YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS), huge.slice(0, YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS));
  assert.equal(YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS, 64 * 1024);
});

// B10 — empty injectionText preview
test("B10: empty injectionText preview", () => {
  const preview = formatYpiStudioInjectionPreview("");
  assert.equal(preview.truncated, false);
  assert.equal(preview.text, "");
});

console.log(`\n${passed} tests passed`);
