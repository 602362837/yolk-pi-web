#!/usr/bin/env node
"use strict";

// `ypic` — terminal chat entrypoint for yolk pi web.
//
// Design contract (see docs/architecture/overview.md and the ypic task plan):
//   - `ypic` does NOT self-start a server. On launch it performs a single
//     `GET /api/cli/health` against the configured host:port. If the check
//     fails or the responder is not yolk-pi-web, it prints guidance telling
//     the user to manually start `ypi` / the Web server and exits.
//   - Chat is driven entirely over the existing HTTP/SSE API:
//       POST /api/agent/draft   -> create an empty session bound to cwd
//       GET  /api/agent/:id/events  -> SSE stream of agent events
//       POST /api/agent/:id     -> prompt / steer / follow_up / abort / get_state
//     This keeps Studio extension injection, approval gate, JSONL, usage
//     accounting and tool-call normalization identical to Web sessions.
//   - The current directory (process.cwd()) is the workspace. If it is not
//     already a known project/space, `ypic` registers it through the existing
//     Project Registry API (idempotent by canonical pathKey) so the Web/Studio
//     side treats it as a normal project space.
//
// This file is CommonJS and only depends on Node built-ins plus the shared
// `bin/server-runner.js` `openBrowser` helper. It MUST NOT import project
// TypeScript (lib/**) so the npm-published package can execute it directly.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require("readline");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverRunner = require("./server-runner");

const { openBrowser } = serverRunner;

const DEFAULT_PORT = "30141";

const HELP_TEXT = `ypic — terminal chat for yolk pi web

Usage:
  ypic [options] [message]        Start a chat session in the current directory.
                                  If [message] is given it is sent as the first
                                  prompt, then the chat loop continues.

Options:
  -p, --port <port>               ypi Web server port (default: ${DEFAULT_PORT})
  -H, --hostname <host>           ypi Web server host (default: 127.0.0.1)
  -c, --continue                  Continue the most recent session for this cwd
                                  instead of creating a new one.
      --resume <sessionId>        Resume a specific session id directly.
  -h, --help                      Show this help and exit.

Environment:
  PI_WEB_PORT / PORT              Fallback for --port.
  PI_WEB_HOST / HOSTNAME          Fallback for --hostname.
  YPIC_DEBUG=1                    Print raw SSE event types for debugging.

ypic does not start a server. Run \`ypi\` (or start the Web server) first, then
run \`ypic\` in the project directory you want to chat in.

In-session commands:
  /help        Show in-session commands.
  /config      Open the ypi Web page in your browser.
  /open        Alias for /config.
  /oweb        Open this exact session in the Web UI.
  /status      Show the current agent state.
  /abort       Abort a running agent turn.
  /steer <text>  Steer a running agent with a mid-turn instruction.
  /follow <text> Queue a follow-up message for after the current turn.
  /quit        Exit the chat (Ctrl-C also aborts / exits).
`;

function debug(...args) {
  if (process.env.YPIC_DEBUG) console.error("[ypic:debug]", ...args);
}

/**
 * Parse CLI args. Returns { port, hostname, continue, resume, help, message }.
 */
function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      port: { type: "string", short: "p" },
      hostname: { type: "string", short: "H" },
      continue: { type: "boolean", short: "c" },
      resume: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });
  return {
    port: values.port ?? process.env.PI_WEB_PORT ?? process.env.PORT ?? null,
    hostname: values.hostname ?? process.env.PI_WEB_HOST ?? process.env.HOSTNAME ?? null,
    continue: Boolean(values.continue),
    resume: values.resume ?? null,
    help: Boolean(values.help),
    message: positionals.length > 0 ? positionals.join(" ") : null,
  };
}

function buildBaseUrl(opts) {
  const port = opts.port ?? DEFAULT_PORT;
  const hostname = opts.hostname ?? "127.0.0.1";
  return `http://${hostname}:${port}`;
}

function buildSessionWebUrl(baseUrl, sessionId) {
  return `${baseUrl}/?session=${encodeURIComponent(sessionId)}`;
}

function resolveCanonicalPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Health-check the configured server. Returns the parsed health body on
 * success, or null with a reason string on failure.
 */
async function checkHealth(baseUrl) {
  try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  let res;
  try {
    res = await fetch(`${baseUrl}/api/cli/health`, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, reason: `health check returned HTTP ${res.status}` };
  const body = await res.json().catch(() => null);
  if (!body || body.ok !== true || body.app !== "yolk-pi-web") {
    return { ok: false, reason: "port is held by another service (not yolk-pi-web)" };
  }
  return { ok: true, body };
  } catch (error) {
    return { ok: false, reason: `cannot reach server: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Resolve a project/space context for cwd using the Project Registry API.
 * Reuses an existing space whose path matches cwd; only registers a new
 * project when cwd is not already a known space (idempotent by pathKey).
 */
async function resolveProjectContext(baseUrl, cwd) {
  const canonical = resolveCanonicalPath(cwd);

  // 1. Look for an existing non-archived space matching this cwd.
  try {
    const { ok, body } = await fetchJson(`${baseUrl}/api/projects`);
    if (ok && body && Array.isArray(body.projects)) {
      for (const project of body.projects) {
        if (!project || project.archived) continue;
        const spaces = project.spaces;
        if (!spaces || typeof spaces !== "object") continue;
        for (const space of Object.values(spaces)) {
          if (!space || space.archived) continue;
          if (space.path === cwd || space.path === canonical || space.realPath === canonical) {
            return { projectId: project.id, spaceId: space.id };
          }
        }
      }
    }
  } catch (error) {
    debug("list projects failed:", error instanceof Error ? error.message : String(error));
  }

  // 2. Not found — register cwd as a project (idempotent by pathKey).
  const { ok, status, body } = await fetchJson(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: cwd }),
  });
  if (!ok || !body || !body.project) {
    throw new Error(`Failed to register project for cwd (${status}): ${body?.error ?? "unknown error"}`);
  }
  const project = body.project;
  // Find the space matching cwd (main space for a fresh registration).
  const spaces = project.spaces && typeof project.spaces === "object" ? Object.values(project.spaces) : [];
  const match = spaces.find(
    (s) => s && !s.archived && (s.path === cwd || s.path === canonical || s.realPath === canonical),
  );
  if (match) return { projectId: project.id, spaceId: match.id };
  // Fall back to the main space if present.
  if (spaces.find((s) => s && s.id === "main")) return { projectId: project.id, spaceId: "main" };
  // Last resort: still create the session without project context — pi will
  // bind by cwd. This keeps chat working even if registry shape surprises us.
  debug("no matching space found after registration; proceeding without project context");
  return null;
}

/**
 * Find the most recent non-child, non-archived session for cwd.
 */
async function findRecentSessionForCwd(baseUrl, cwd) {
  const canonical = resolveCanonicalPath(cwd);
  const { ok, body } = await fetchJson(`${baseUrl}/api/sessions`);
  if (!ok || !body || !Array.isArray(body.sessions)) return null;
  const candidates = body.sessions.filter(
    (s) => s && !s.studioChild && !s.archived && (s.cwd === cwd || s.cwd === canonical),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  return candidates[0];
}

/**
 * Create an empty session via /api/agent/draft bound to cwd + project context.
 */
async function draftSession(baseUrl, cwd, projectContext) {
  const payload = { cwd, ...(projectContext ? { projectId: projectContext.projectId, spaceId: projectContext.spaceId } : {}) };
  const { ok, status, body } = await fetchJson(`${baseUrl}/api/agent/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!ok || !body || !body.sessionId) {
    throw new Error(`Failed to create session (${status}): ${body?.error ?? "unknown error"}`);
  }
  return body.sessionId;
}

async function sendAgentCommand(baseUrl, sessionId, command) {
  const { ok, status, body } = await fetchJson(`${baseUrl}/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!ok) {
    throw new Error(body?.error ?? `HTTP ${status}`);
  }
  return body?.data;
}

async function getAgentState(baseUrl, sessionId) {
  const { ok, body } = await fetchJson(`${baseUrl}/api/agent/${encodeURIComponent(sessionId)}`);
  if (!ok) return null;
  return body;
}

async function getStudioTask(baseUrl, sessionId) {
  const { ok, body } = await fetchJson(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/studio-task`);
  if (!ok) return null;
  return body;
}

function buildResumeCommand(opts, sessionId) {
  const parts = ["ypic"];
  if (opts.port) parts.push("--port", String(opts.port));
  if (opts.hostname) parts.push("--hostname", String(opts.hostname));
  parts.push("--resume", sessionId);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// YPI Studio compact summaries
// ---------------------------------------------------------------------------
//
// The CLI never reimplements Studio logic — it only renders compact summaries
// from the `args` on tool_execution_start and the `result.details` on
// tool_execution_end / tool_execution_update for the three Studio tools:
//   - ypi_studio_task      : lifecycle / state machine (create/transition/...)
//   - ypi_studio_subagent  : member delegation (architect/implementer/...)
//   - ypi_studio_wait      : wait for async child runs
// All extractors are defensive: missing/oddly-shaped payloads degrade to a
// short hint and never throw, so the CLI keeps streaming regardless of payload
// drift in the Studio extension.

const STUDIO_TOOLS = new Set(["ypi_studio_task", "ypi_studio_subagent", "ypi_studio_wait"]);

function oneLineTrunc(value, max = 120) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function asArgs(args) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function resultDetails(result) {
  if (!result || typeof result !== "object") return null;
  const d = result.details;
  return d && typeof d === "object" && !Array.isArray(d) ? d : null;
}

function taskFromResult(result) {
  const d = resultDetails(result);
  if (!d) return null;
  const t = d.task;
  return t && typeof t === "object" ? t : null;
}

function runsFromResult(result) {
  const d = resultDetails(result);
  if (!d) return [];
  const runs = d.runs || d.run;
  if (Array.isArray(runs)) return runs.filter((r) => r && typeof r === "object");
  if (runs && typeof runs === "object") return [runs];
  return [];
}

/**
 * Resolve the plan-review.md display path for a task payload.
 * The tool result exposes `artifacts.files["plan-review"].path`; the
 * studio-task API widget projection only exposes `pathLabel` and artifact name
 * arrays, so we fall back to `<pathLabel>/plan-review.md`.
 */
function planReviewPathForTask(task) {
  if (!task || typeof task !== "object") return null;
  const files = task.artifacts && typeof task.artifacts === "object" ? task.artifacts.files : null;
  if (files && files["plan-review"] && typeof files["plan-review"].path === "string") {
    return files["plan-review"].path;
  }
  const label = typeof task.pathLabel === "string" && task.pathLabel ? task.pathLabel : null;
  return label ? `${label}/plan-review.md` : null;
}

function approvalPromptText(task, baseUrl) {
  const id = task && typeof task.id === "string" ? task.id : "?";
  const pr = planReviewPathForTask(task);
  const lines = ["\n  ▣ Studio task awaiting approval", `    task:   ${id}`];
  if (pr) lines.push(`    plan:   ${pr}`);
  if (baseUrl) lines.push(`    review: /open  →  ${baseUrl}`);
  lines.push("    To approve, reply with 确认/批准/开始实现 in chat. The CLI will not auto-approve.");
  lines.push("    Full task details, artifacts and member config are in the Web Studio panel.");
  return lines.join("\n") + "\n";
}

function summarizeStudioTaskStart(args) {
  const a = asArgs(args);
  const parts = ["⚑ studio task"];
  const action = typeof a.action === "string" ? a.action : "current";
  parts.push(action);
  if (typeof a.to === "string") parts.push(`→ ${a.to}`);
  if (typeof a.title === "string") parts.push(oneLineTrunc(a.title, 60));
  return parts.join(" ");
}

function summarizeStudioSubagentStart(args) {
  const a = asArgs(args);
  const parts = ["⚑ studio subagent"];
  const action = typeof a.action === "string" ? a.action : "start";
  parts.push(action);
  if (typeof a.member === "string") parts.push(a.member);
  if (typeof a.mode === "string") parts.push(`mode=${a.mode}`);
  if (typeof a.subtaskId === "string") parts.push(`subtask=${oneLineTrunc(a.subtaskId, 48)}`);
  return parts.join(" ");
}

function summarizeStudioWaitStart(args) {
  const a = asArgs(args);
  const parts = ["⚑ studio wait"];
  const runIds = Array.isArray(a.runIds) ? a.runIds.filter((x) => typeof x === "string") : typeof a.runId === "string" ? [a.runId] : [];
  if (runIds.length) parts.push(runIds.slice(0, 3).join(",") + (runIds.length > 3 ? `,+${runIds.length - 3}` : ""));
  if (typeof a.until === "string") parts.push(`until=${a.until}`);
  return parts.join(" ");
}

function runStatusLine(run) {
  const id = typeof run.runId === "string" ? run.runId : typeof run.id === "string" ? run.id : "?";
  const member = typeof run.member === "string" ? run.member : "";
  const status = typeof run.status === "string" ? run.status : "";
  const subtask = typeof run.subtaskId === "string" ? ` subtask=${oneLineTrunc(run.subtaskId, 40)}` : "";
  const p = run.progress && typeof run.progress === "object" ? run.progress : null;
  const phase = p && typeof p.phase === "string" ? ` · ${p.phase}` : "";
  const tps = p && typeof p.tps === "number" ? ` · ${p.tps.toFixed(1)}tps` : "";
  return `⚑ studio subagent ${id} · ${member} · ${status}${subtask}${phase}${tps}`;
}

function summarizeStudioTaskEnd(event, renderer, baseUrl) {
  const task = taskFromResult(event.result);
  const head = "⚑ studio task";
  if (event.isError && !task) {
    const d = resultDetails(event.result);
    const msg = d && typeof d.error === "string" ? d.error : event.errorMessage || "task tool failed";
    return `  ${head} ✗ ${oneLineTrunc(msg, 200)}`;
  }
  const parts = ["  " + head];
  if (task) {
    if (typeof task.id === "string") parts.push(task.id);
    if (typeof task.status === "string") parts.push("·", task.status);
  } else {
    parts.push("ok");
  }
  let out = parts.join(" ");
  if (task && task.status === "awaiting_approval" && !renderer.approvalPrompted) {
    renderer.approvalPrompted = true;
    out += "\n" + approvalPromptText(task, baseUrl);
  }
  return out;
}

function summarizeStudioSubagentEnd(event) {
  const runs = runsFromResult(event.result);
  const lines = [];
  if (event.isError) {
    const d = resultDetails(event.result);
    const msg = d && typeof d.error === "string" ? d.error : event.errorMessage || "subagent tool failed";
    lines.push(`  ⚑ studio subagent ✗ ${oneLineTrunc(msg, 200)}`);
  }
  if (runs.length > 0) {
    const shown = runs.slice(0, 3);
    for (const run of shown) lines.push("  " + runStatusLine(run));
    if (runs.length > shown.length) lines.push(`  ⚑ studio subagent +${runs.length - shown.length} more run(s)`);
  } else if (!event.isError) {
    const d = resultDetails(event.result);
    const status = d && typeof d.status === "string" ? d.status : "ok";
    lines.push(`  ⚑ studio subagent ${status}`);
  }
  return lines.join("\n");
}

function summarizeStudioWaitEnd(event) {
  const d = resultDetails(event.result);
  const runs = runsFromResult(event.result);
  if (event.isError) {
    const msg = d && typeof d.error === "string" ? d.error : event.errorMessage || "wait tool failed";
    return `  ⚑ studio wait ✗ ${oneLineTrunc(msg, 200)}`;
  }
  const status = d && typeof d.status === "string" ? d.status : "finished";
  const parts = ["  ⚑ studio wait", status];
  if (runs.length) {
    const summary = runs.slice(0, 4).map((r) => `${typeof r.runId === "string" ? r.runId : "?"}=${typeof r.status === "string" ? r.status : "?"}`).join(",");
    parts.push(`(${summary}` + (runs.length > 4 ? `,+${runs.length - 4}` : "") + ")");
  }
  const next = d && typeof d.nextRecommendedAction === "string" ? d.nextRecommendedAction : null;
  let out = parts.join(" ");
  if (next) out += `\n    next: ${oneLineTrunc(next, 160)}`;
  return out;
}

/**
 * Compact printf helper for wait onUpdate progress. Deduped by a signature of
 * run statuses/phases so the terminal isn't flooded by every poll tick.
 */
function summarizeStudioWaitUpdate(event, renderer) {
  const d = resultDetails(event.partialResult);
  if (!d) return null;
  const runs = Array.isArray(d.runs) ? d.runs : d.run ? [d.run] : [];
  const sig = runs.map((r) => `${r && typeof r.runId === "string" ? r.runId : "?"}=${r && typeof r.status === "string" ? r.status : "?"}:${r && r.progress && typeof r.progress.phase === "string" ? r.progress.phase : ""}`).join("|") + `::${typeof d.status === "string" ? d.status : ""}`;
  if (sig === renderer.lastWaitSig) return null;
  const now = Date.now();
  if (renderer.lastWaitPrintAt && now - renderer.lastWaitPrintAt < 1200) return null;
  renderer.lastWaitSig = sig;
  renderer.lastWaitPrintAt = now;
  const summary = runs.slice(0, 4).map((r) => `${typeof r.runId === "string" ? r.runId : "?"}=${typeof r.status === "string" ? r.status : "?"}`).join(",");
  return `  ◷ studio wait ${typeof d.status === "string" ? d.status : "…"} (${summary || "-"})`;
}

// ---------------------------------------------------------------------------
// SSE streaming + rendering
// ---------------------------------------------------------------------------

/**
 * Connect to /api/agent/:id/events and dispatch parsed events to onEvent.
 * Returns a controller with abort() and isClosed().
 *
 * Node has no EventSource; we parse the text/event-stream manually from a
 * fetch response body reader, handling chunk boundaries, multi-line `data:`
 * fields, comments (heartbeats), and partial events.
 */
function connectSse(baseUrl, sessionId, onEvent) {
  const url = `${baseUrl}/api/agent/${encodeURIComponent(sessionId)}/events`;
  const state = { closed: false, controller: new AbortController() };

  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    let res;
    try {
      res = await fetch(url, { signal: state.controller.signal, headers: { Accept: "text/event-stream" } });
    } catch (error) {
      if (!state.closed) onEvent({ type: "_sse_error", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!res.ok || !res.body) {
      if (!state.closed) onEvent({ type: "_sse_error", error: `SSE connect failed: HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by a blank line.
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          handleRawEvent(rawEvent, onEvent);
        }
      }
    } catch (error) {
      if (!state.closed) onEvent({ type: "_sse_error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      state.closed = true;
      onEvent({ type: "_sse_closed" });
    }
  })();

  return {
    abort() {
      state.closed = true;
      state.controller.abort();
    },
    isClosed() {
      return state.closed;
    },
  };
}

function handleRawEvent(rawEvent, onEvent) {
  // Collect all `data:` lines into one payload; ignore comments/other fields.
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === "" || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return;
  const payload = dataLines.join("\n");
  try {
    onEvent(JSON.parse(payload));
  } catch {
    debug("non-JSON SSE payload ignored:", payload.slice(0, 120));
  }
}

// Extract the full assistant text from a message content array (cumulative).
function assistantText(message) {
  if (!message || message.role !== "assistant") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

function shortToolHint(name, args) {
  if (!args || typeof args !== "object") return "";
  const candidates = ["path", "command", "file", "pattern", "url", "query", "taskId", "goal"];
  for (const key of candidates) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) {
      const shown = v.length > 60 ? v.slice(0, 57) + "…" : v;
      return ` ${key}=${shown}`;
    }
  }
  return "";
}

/**
 * Build the chat renderer. Returns handlers used by the main loop.
 * Keeps track of running state, streaming assistant text deltas, and open
 * tool calls, printing compact progress to stdout.
 */
function createRenderer() {
  const renderer = {
    running: false,
    printedTextLen: 0,        // cumulative assistant text already printed this message
    pendingNewline: false,    // assistant text was printed without trailing newline
    toolNamesById: new Map(), // toolCallId -> toolName (for end markers)
    approvalPrompted: false,  // dedupe plan-review prompt within one turn
    lastWaitSig: null,        // last ypi_studio_wait update signature (dedupe)
    lastWaitPrintAt: 0,       // last ypi_studio_wait update print time (throttle)
    baseUrl: null,            // server base url, for approval/open hints
  };

  function ensureNewline() {
    if (renderer.pendingNewline) {
      process.stdout.write("\n");
      renderer.pendingNewline = false;
    }
  }

  function writeAssistantDelta(text) {
    if (text.length > renderer.printedTextLen) {
      const delta = text.slice(renderer.printedTextLen);
      process.stdout.write(delta);
      renderer.printedTextLen = text.length;
      renderer.pendingNewline = !text.endsWith("\n");
    }
  }

  function handleEvent(event) {
    debug("event", event.type);
    switch (event.type) {
      case "connected":
        // Stream is connected; nothing to render.
        break;
      case "agent_start":
        renderer.running = true;
        renderer.printedTextLen = 0;
        renderer.toolNamesById.clear();
        renderer.approvalPrompted = false;
        renderer.lastWaitSig = null;
        renderer.lastWaitPrintAt = 0;
        break;
      case "message_start":
        renderer.printedTextLen = 0;
        if (event.message && event.message.role === "assistant") {
          writeAssistantDelta(assistantText(event.message));
        }
        break;
      case "message_update": {
        const msg = event.message;
        if (msg && msg.role === "assistant") {
          writeAssistantDelta(assistantText(msg));
        }
        break;
      }
      case "message_end":
        ensureNewline();
        renderer.printedTextLen = 0;
        break;
      case "tool_execution_start": {
        ensureNewline();
        const id = event.toolCallId;
        const name = event.toolName || "tool";
        renderer.toolNamesById.set(id, name);
        if (STUDIO_TOOLS.has(name)) {
          if (name === "ypi_studio_task") process.stdout.write(`  ${summarizeStudioTaskStart(event.args)}\n`);
          else if (name === "ypi_studio_subagent") process.stdout.write(`  ${summarizeStudioSubagentStart(event.args)}\n`);
          else if (name === "ypi_studio_wait") process.stdout.write(`  ${summarizeStudioWaitStart(event.args)}\n`);
        } else {
          const hint = shortToolHint(name, event.args);
          process.stdout.write(`  ⚒ ${name}${hint}\n`);
        }
        break;
      }
      case "tool_execution_update": {
        // Only ypi_studio_wait streams useful compact poll progress; all other
        // tool updates are intentionally ignored to keep the terminal clean.
        const updateName = event.toolName || renderer.toolNamesById.get(event.toolCallId) || "";
        if (updateName === "ypi_studio_wait") {
          const line = summarizeStudioWaitUpdate(event, renderer);
          if (line) { ensureNewline(); process.stdout.write(line + "\n"); }
        }
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId;
        const name = renderer.toolNamesById.get(id) || event.toolName || "tool";
        renderer.toolNamesById.delete(id);
        if (STUDIO_TOOLS.has(name)) {
          ensureNewline();
          if (name === "ypi_studio_task") process.stdout.write(summarizeStudioTaskEnd(event, renderer, renderer.baseUrl) + "\n");
          else if (name === "ypi_studio_subagent") process.stdout.write(summarizeStudioSubagentEnd(event) + "\n");
          else if (name === "ypi_studio_wait") process.stdout.write(summarizeStudioWaitEnd(event) + "\n");
        } else {
          const mark = event.isError ? "✗" : "✓";
          process.stdout.write(`  ${mark} ${name}\n`);
        }
        break;
      }
      case "agent_end": {
        ensureNewline();
        const childRuns = typeof event.studioChildRunCount === "number" ? event.studioChildRunCount : 0;
        if (childRuns > 0) {
          process.stdout.write(`  … Studio 子任务仍在后台运行 (${childRuns})，主会话会在结束后自动续跑。\n`);
        }
        renderer.running = false;
        renderer.printedTextLen = 0;
        renderer.toolNamesById.clear();
        break;
      }
      case "agent_error":
        ensureNewline();
        process.stdout.write(`  ✗ agent error: ${event.errorMessage || "agent failed to start"}\n`);
        renderer.running = false;
        renderer.printedTextLen = 0;
        break;
      case "auto_retry_start":
        process.stdout.write(`  ↻ retry ${event.attempt}/${event.maxAttempts}${event.errorMessage ? `: ${event.errorMessage}` : ""}\n`);
        break;
      case "auto_retry_end":
        break;
      case "chatgpt_account_failover":
        process.stdout.write(`  ↻ ChatGPT 账号切换: ${event.status}\n`);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        process.stdout.write("  ⚙ compacting context…\n");
        break;
      case "auto_compaction_end":
      case "compaction_end":
        if (event.errorMessage) process.stdout.write(`  ✗ compaction failed: ${event.errorMessage}\n`);
        else process.stdout.write("  ✓ context compacted\n");
        break;
      case "session_file_changes_update":
        // File-change sidecars are a Web overlay concern; not rendered in CLI.
        break;
      case "studio_child_audit_changed":
      case "studio_child_audit_end":
        // Studio child audit streams are not the chat we drive; ignore safely.
        break;
      case "_sse_error":
        ensureNewline();
        process.stdout.write(`  ✗ stream error: ${event.error}\n`);
        break;
      case "_sse_closed":
        // Stream closed (server stop / network). Caller may reconnect.
        break;
      default:
        debug("unhandled event type:", event.type);
    }
  }

  // Expose the state object itself so handlers and the main loop share one
  // object (e.g. baseUrl/approvalPrompted set from main are visible inside
  // the event handlers that read the closure `renderer`).
  renderer.handleEvent = handleEvent;
  renderer.resetMessage = () => {
    renderer.printedTextLen = 0;
  };
  renderer.ensureNewline = ensureNewline;
  return renderer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const baseUrl = buildBaseUrl(opts);
  const cwd = process.cwd();

  // Health check — never self-start a server.
  const health = await checkHealth(baseUrl);
  if (!health.ok) {
    process.stderr.write(
      `ypic: cannot find a yolk-pi-web server at ${baseUrl}.\n` +
      `       ${health.reason}\n` +
      `       Start it first with \`ypi\` (or run the Web server), then run \`ypic\` again.\n` +
      `       Use --port / --hostname to point at a different server.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`YPI CLI chat · cwd: ${cwd}\n`);
  process.stdout.write(`Using local ypi server: ${baseUrl} (v${health.body.version})\n`);
  process.stdout.write(`Type /help for commands, /config to open Web settings, /oweb to open this session in Web, /quit to exit.\n\n`);

  let sessionId;
  let projectContext = null;

  if (opts.resume) {
    sessionId = opts.resume;
    process.stdout.write(`Resuming session: ${sessionId}\n`);
  } else if (opts.continue) {
    const recent = await findRecentSessionForCwd(baseUrl, cwd);
    if (recent) {
      sessionId = recent.id;
      projectContext = recent.projectId && recent.spaceId
        ? { projectId: recent.projectId, spaceId: recent.spaceId }
        : null;
      process.stdout.write(`Continuing session: ${sessionId}\n`);
    } else {
      process.stdout.write(`No existing session for this cwd; creating a new one.\n`);
    }
  }

  if (!sessionId) {
    // Ensure the cwd is a known project/space, then create an empty session.
    try {
      projectContext = await resolveProjectContext(baseUrl, cwd);
    } catch (error) {
      process.stdout.write(`  ! project context skipped: ${error instanceof Error ? error.message : String(error)}\n`);
      projectContext = null;
    }
    sessionId = await draftSession(baseUrl, cwd, projectContext);
    process.stdout.write(`Session created: ${sessionId}\n`);
  }

  // Resume awareness: check whether the session is already running.
  const agentState = await getAgentState(baseUrl, sessionId);
  if (!agentState) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const initiallyRunning = Boolean(agentState?.running);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY,
    prompt: "> ",
  });

  let exiting = false;

  // Guard against calling rl.prompt() after stdin closed (pipe/EOF).
  function safePrompt() {
    if (!exiting && !rl.closed) rl.prompt();
  }

  const renderer = createRenderer();
  renderer.baseUrl = baseUrl;
  let sse = null;
  let reconnectTimer = null;

  // If the stream dies while the agent is running, attempt one reconnect.
  const handleSseClosed = () => {
    if (exiting || !renderer.running || !sse?.isClosed()) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (exiting || !renderer.running) return;
      debug("reconnecting SSE");
      sse = connectSse(baseUrl, sessionId, (event) => renderer.handleEvent(event));
    }, 1000);
  };

  // Wrap the renderer's handler so we can also drive reconnect logic on
  // stream close, and run a light Studio approval backup check on agent_end.
  // Connect the SSE stream once, after wrapping.
  const originalHandle = renderer.handleEvent;
  renderer.handleEvent = (event) => {
    originalHandle(event);
    if (event.type === "agent_end") {
      void maybePromptStudioApproval();
      // In one-shot mode with non-TTY stdin, exit after the turn finishes.
      if (opts.message && !process.stdin.isTTY && !exiting) {
        void quit();
      }
    }
    if (event.type === "_sse_closed") handleSseClosed();
  };
  sse = connectSse(baseUrl, sessionId, (event) => renderer.handleEvent(event));

  // Backup detection: when a turn ends with the bound Studio task in
  // awaiting_approval (e.g. the transition happened outside a ypi_studio_task
  // tool result), fetch the session's studio task and print the plan-review
  // prompt once. Never auto-approves.
  async function maybePromptStudioApproval() {
    if (renderer.approvalPrompted || exiting) return;
    try {
      const body = await getStudioTask(baseUrl, sessionId);
      const task = body && body.task;
      if (task && task.status === "awaiting_approval") {
        renderer.approvalPrompted = true;
        renderer.ensureNewline();
        process.stdout.write(approvalPromptText(task, baseUrl));
      }
    } catch (error) {
      debug("studio approval backup check failed:", error instanceof Error ? error.message : String(error));
    }
  }

  if (initiallyRunning) {
    renderer.running = true;
  }

  let sigintCount = 0;
  let sigintResetTimer = null;

  async function quit() {
    if (exiting) return;
    exiting = true;
    sse?.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const sessionWebUrl = buildSessionWebUrl(baseUrl, sessionId);
    const resumeCommand = buildResumeCommand(opts, sessionId);
    // Light Studio exit protection: the CLI never owns the server lifecycle; if
    // Studio child runs are still active or the task awaits the user, just point
    // the user to the Web panel instead of killing background work.
    try {
      const taskBody = await getStudioTask(baseUrl, sessionId);
      const task = taskBody?.task;
      const subagents = Array.isArray(task?.subagents) ? task.subagents : [];
      const activeRuns = subagents.filter(
        (r) => r && (r.status === "running" || r.status === "queued" || r.status === "waiting_for_user"),
      ).length;
      const counts = task?.implementationProjection?.statusCounts;
      const activeSubtasks = (counts?.running ?? 0) + (counts?.queued ?? 0);
      if (task && task.status === "awaiting_approval") {
        const pr = planReviewPathForTask(task);
        process.stdout.write(
          `\nStudio task ${task.id} is awaiting approval (plan: ${pr ?? "plan-review.md"}).\n` +
          `Approve in this chat, or continue in the Web Studio panel: ${sessionWebUrl}\n`,
        );
      } else if (task && (activeRuns > 0 || activeSubtasks > 0)) {
        process.stdout.write(
          `\nStudio task ${task.id} (${task.status}) still has ${activeRuns} running/queued child run(s)` +
          (activeSubtasks ? ` and ${activeSubtasks} active subtask(s)` : "") + ".\n" +
          `The local ypi server is left running. Continue viewing in the Web Studio panel: ${sessionWebUrl}\n`,
        );
      } else if (renderer.running) {
        process.stdout.write("\nAgent still running; aborting before exit.\n");
        await sendAgentCommand(baseUrl, sessionId, { type: "abort" }).catch(() => {});
      }
    } catch (error) {
      debug("studio-task check failed:", error instanceof Error ? error.message : String(error));
      // Non-Studio sessions and transient fetch errors must not block exit.
    }
    process.stdout.write(
      `\nResume this session with:\n  ${resumeCommand}\n` +
      `Open it in Web:\n  ${sessionWebUrl}\n`,
    );
    rl.close();
    process.exit(0);
  }

  function printHelp() {
    process.stdout.write(
      "In-session commands:\n" +
      "  /help          show this help\n" +
      "  /config /open  open ypi Web in your browser\n" +
      "  /oweb          open this exact session in the Web UI\n" +
      "  /status        show current agent state\n" +
      "  /abort         abort a running turn\n" +
      "  /steer <text>  steer a running agent\n" +
      "  /follow <text> queue a follow-up message\n" +
      "  /quit          exit (Ctrl-C also works)\n",
    );
  }

  async function handleLine(line) {
    const input = String(line ?? "");
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      if (!renderer.running) safePrompt();
      return;
    }

    if (trimmed === "/help") {
      printHelp();
      safePrompt();
      return;
    }
    if (trimmed === "/quit" || trimmed === "/exit") {
      void quit();
      return;
    }
    if (trimmed === "/config" || trimmed === "/open") {
      openBrowser(baseUrl);
      process.stdout.write(`Opened ${baseUrl} in your browser.\nUse Settings for models, auth, Studio member policy, terminal, usage, and editor configuration.\n`);
      safePrompt();
      return;
    }
    if (trimmed === "/oweb") {
      const sessionWebUrl = buildSessionWebUrl(baseUrl, sessionId);
      openBrowser(sessionWebUrl);
      process.stdout.write(`Opened ${sessionWebUrl} in your browser.\n`);
      safePrompt();
      return;
    }
    if (trimmed === "/status") {
      const state = await getAgentState(baseUrl, sessionId);
      if (!state) {
        process.stdout.write("No agent state available.\n");
      } else if (state.running) {
        process.stdout.write(`Agent running.\n`);
      } else {
        process.stdout.write(`Agent idle.\n`);
      }
      safePrompt();
      return;
    }
    if (trimmed === "/abort") {
      if (!renderer.running) {
        process.stdout.write("Nothing to abort (agent is idle).\n");
        safePrompt();
        return;
      }
      await sendAgentCommand(baseUrl, sessionId, { type: "abort" }).catch((e) => {
        process.stdout.write(`abort failed: ${e instanceof Error ? e.message : String(e)}\n`);
      });
      safePrompt();
      return;
    }
    if (trimmed.startsWith("/steer ")) {
      const text = trimmed.slice("/steer ".length).trim();
      if (!text) { process.stdout.write("Usage: /steer <text>\n"); safePrompt(); return; }
      await sendAgentCommand(baseUrl, sessionId, { type: "steer", message: text }).catch((e) => {
        process.stdout.write(`steer failed: ${e instanceof Error ? e.message : String(e)}\n`);
      });
      safePrompt();
      return;
    }
    if (trimmed.startsWith("/follow ")) {
      const text = trimmed.slice("/follow ".length).trim();
      if (!text) { process.stdout.write("Usage: /follow <text>\n"); safePrompt(); return; }
      await sendAgentCommand(baseUrl, sessionId, { type: "follow_up", message: text }).catch((e) => {
        process.stdout.write(`follow_up failed: ${e instanceof Error ? e.message : String(e)}\n`);
      });
      safePrompt();
      return;
    }
    if (trimmed.startsWith("/")) {
      // Unknown slash command — send it through as a chat prompt so existing
      // Studio slash commands (e.g. /studio-feature) work transparently.
    }

    // Regular chat input.
    try {
      if (renderer.running) {
        // Mid-turn input defaults to steer (keeps the turn going with a new
        // instruction). Use /follow to queue a post-turn follow-up instead.
        await sendAgentCommand(baseUrl, sessionId, { type: "steer", message: trimmed });
      } else {
        renderer.running = true;
        renderer.resetMessage();
        await sendAgentCommand(baseUrl, sessionId, { type: "prompt", message: trimmed });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      renderer.ensureNewline();
      process.stdout.write(`  ✗ send failed: ${msg}\n`);
      if (/auth|provider|model|401|403|no.*model/i.test(msg)) {
        process.stdout.write(`  hint: run /config to open the Web page and configure models/auth.\n`);
      }
      renderer.running = false;
    }
    safePrompt();
  }

  // SIGINT handling: first Ctrl-C aborts a running turn; a second Ctrl-C
  // (or Ctrl-C while idle) exits.
  rl.on("SIGINT", () => {
    sigintCount += 1;
    if (sigintResetTimer) clearTimeout(sigintResetTimer);
    sigintResetTimer = setTimeout(() => { sigintCount = 0; }, 1500);
    if (renderer.running && sigintCount === 1) {
      process.stdout.write("\n  ⏹ aborting… (Ctrl-C again to quit)\n");
      sendAgentCommand(baseUrl, sessionId, { type: "abort" }).catch(() => {});
      return;
    }
    void quit();
  });

  rl.on("line", (line) => { void handleLine(line); });
  rl.on("close", () => {
    // In one-shot mode (ypic "message" with non-TTY stdin), wait for the
    // agent turn to finish instead of aborting on EOF. Interactive TTY
    // sessions exit immediately on Ctrl-D / close.
    if (!exiting && !opts.message) void quit();
  });

  // Send the initial positional message (if any) as the first prompt.
  if (opts.message) {
    void handleLine(opts.message);
  } else {
    safePrompt();
  }
}

// Only auto-run the chat loop when executed directly (`node bin/ypic.js` / `ypic`).
// Exporting pure helpers lets `scripts/test-ypic-cli.mjs` unit-test arg
// parsing, URL construction, and SSE parsing without starting a chat.
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`ypic: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseCliArgs,
  buildBaseUrl,
  buildSessionWebUrl,
  buildResumeCommand,
  resolveCanonicalPath,
  handleRawEvent,
  oneLineTrunc,
  planReviewPathForTask,
  shortToolHint,
};
