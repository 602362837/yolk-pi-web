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
  /model       Manage model and thinking level.
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

let debugTimingEnabled = false;
function debugTiming(label, startMs) {
  if (!debugTimingEnabled) return;
  const elapsed = Date.now() - startMs;
  console.error(`[ypic:timing] ${label} (${elapsed}ms)`);
}

// Write a status/diagnostic line that is always visible, even when stdout is
// fully buffered (e.g. pipe / non-TTY). Uses stderr so it cannot be swallowed
// by libc stdio buffering.
function ypicInfo(text) {
  console.error(text);
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
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, init);
    debugTiming(`HTTP ${init?.method ?? "GET"} ${url} status=${res.status}`, t0);
  } catch (error) {
    debugTiming(`HTTP ${init?.method ?? "GET"} ${url} FAILED: ${error instanceof Error ? error.message : String(error)}`, t0);
    throw error;
  }
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
  const controller = new AbortController();
  // Longer timeout for prompt commands which involve model preflight;
  // abort/steer/follow_up resolve quickly.
  const timeoutMs = command.type === "prompt" ? 120_000 : 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { ok, status, body } = await fetchJson(
      `${baseUrl}/api/agent/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
        signal: controller.signal,
      },
    );
    if (!ok) {
      const errMsg = body?.error ?? `HTTP ${status}`;
      const hint = categorizeAgentError(errMsg);
      const err = new Error(errMsg);
      err.hint = hint;
      throw err;
    }
    return body?.data;
  } catch (error) {
    if (error.name === "AbortError" || controller.signal.aborted) {
      const err = new Error(`Request timed out after ${timeoutMs / 1000}s`);
      err.hint = "The server may be stuck loading a model or waiting for auth. Try /config to check your model/auth setup, or restart the ypi server.";
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function categorizeAgentError(msg) {
  if (/auth|401|403|unauthorized|api.key|token/i.test(msg)) return "Authentication or API key issue. Run /config to open the Web page and configure your model provider credentials.";
  if (/model|provider|no.*model|not found/i.test(msg)) return "Model configuration issue. Run /config to open the Web page and select a valid model.";
  if (/preflight/i.test(msg)) return "Server preflight failed. This may be a temporary issue — try again, or run /config to check your setup.";
  if (/already.*running/i.test(msg)) return "Another turn is already running. Wait for it to finish or use /abort.";
  return null;
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
// Model helpers
// ---------------------------------------------------------------------------

const THINKING_LEVELS = ["off", "auto", "low", "medium", "high", "xhigh"];

function modelKey(provider, modelId) {
  return `${provider}:${modelId}`;
}

function modelDisplayName(m) {
  const pd = m.providerDisplayName || m.provider;
  return `${pd}/${m.name || m.id}`;
}

function findModel(list, provider, modelId) {
  return list.find((m) => m.provider === provider && m.id === modelId) || null;
}

function getSupportedThinkingLevels(modelState, provider, modelId) {
  const key = modelKey(provider, modelId);
  const levels = modelState.thinkingLevels?.[key];
  if (Array.isArray(levels) && levels.length > 0) return levels;
  return ["off", "auto"];
}

/**
 * Parse "/model <provider>/<modelId> [<thinking>]" input.
 * The provider is everything before the first "/"; modelId is the rest,
 * minus an optional trailing thinking-level keyword.
 * Returns { provider, modelId, thinking } or null if not a valid model switch.
 */
function parseModelSwitch(rest) {
  const trimmed = rest.trim();
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx <= 0) return null;
  const provider = trimmed.slice(0, slashIdx);
  const afterSlash = trimmed.slice(slashIdx + 1).trim();
  if (!afterSlash) return null;
  const parts = afterSlash.split(" ");
  const lastWord = parts[parts.length - 1].toLowerCase();
  if (parts.length > 1 && THINKING_LEVELS.includes(lastWord)) {
    return {
      provider,
      modelId: parts.slice(0, -1).join(" "),
      thinking: lastWord,
    };
  }
  return { provider, modelId: afterSlash, thinking: null };
}

async function fetchModels(baseUrl) {
  const { ok, status, body } = await fetchJson(`${baseUrl}/api/models`);
  if (!ok) throw new Error(`Failed to load models: ${body?.error ?? `HTTP ${status}`}`);
  return body;
}

function resolveCurrentModel(agentState, modelList) {
  if (!agentState?.state?.model) return null;
  const m = agentState.state.model;
  if (!m || typeof m.provider !== "string" || typeof m.id !== "string") return null;
  const match = findModel(modelList, m.provider, m.id);
  return {
    provider: m.provider,
    modelId: m.id,
    displayName: match ? modelDisplayName(match) : `${m.provider}/${m.id}`,
    thinkingLevel: typeof agentState.state.thinkingLevel === "string"
      ? agentState.state.thinkingLevel
      : "off",
  };
}

function formatModelSummary(m) {
  if (!m) return "No model configured. Use /config to set up a model in the Web UI.";
  return `${m.displayName} · thinking: ${m.thinkingLevel}`;
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
// Terminal Frame — TTY bottom-input-area and status bar
// ---------------------------------------------------------------------------

/**
 * Create a frame abstraction for rendering output and accepting input.
 *
 * TerminalFrame (TTY): manages a fixed bottom area (separator, status bar,
 * input line) via the alternate screen buffer. Output scrolls in the history
 * region above; the bottom three rows stay pinned. Handles SIGINT / resize.
 *
 * PlainFrame (non-TTY / NO_COLOR / YPIC_PLAIN): thin wrapper around the
 * classic readline REPL — writes go directly to stdout, status messages use
 * "[YPIC:info]" on stderr, and no ANSI escape sequences are emitted.
 */

const ANSI = {
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  GRAY: "\x1b[90m",
  homeClear: "\x1b[H\x1b[J",     // cursor home + erase to end
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
};

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Visual width of a string (crude: CJK ≈ 2 columns, ASCII ≈ 1).
// Used only for positioning approximations; off-by-one is tolerable.
function visualWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    // CJK, fullwidth forms, etc.
    if (
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul
      cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/**
 * TerminalFrame — TTY alternate-screen rendering with fixed bottom bar.
 *
 * Layout:
 *   rows 1 .. rows-3   history area (scrollable output)
 *   row  rows-2        separator "───…" (gray)
 *   row  rows-1        status bar: ● {idle|RUNNING|ERROR} … model-info
 *   row  rows          input line: > {user text}_
 *
 * The frame redraws the terminal on every output event, throttled to ~60 Hz.
 * It reads raw keyboard input with basic line-editing (Backspace, Enter,
 * Ctrl-C/D, printable characters). Arrow keys and IME composition are not
 * explicitly handled; `YPIC_PLAIN=1` is the recommended fallback when the
 * terminal or input method is incompatible.
 */
function createTerminalFrame() {
  const frame = {
    kind: "tty",
    stdin: process.stdin,
    stdout: process.stdout,
    rows: Math.max(process.stdout.rows || 24, 10),
    cols: Math.max(process.stdout.columns || 80, 40),
    bottomReserved: 3, // separator + status + input = 3 rows

    // Output buffer
    _lines: [],         // completed history lines (ring buffer)
    _partial: "",       // current streaming partial line
    _maxLines: 2000,    // cap to avoid unbounded growth

    // Status
    _statusDot: "idle",   // "idle" | "busy" | "error"
    _statusText: "",
    _modelText: "",

    // Input
    _inputChars: [],     // array of code-points (for correct cursor movement)
    _inputCursor: 0,     // index into _inputChars
    _prompt: "> ",
    _hint: "",            // dim placeholder when input is empty

    // Callbacks
    _onLine: null,
    _onSigint: null,
    _onAbort: null,       // first Ctrl-C during running → abort

    _exiting: false,
    _dirty: false,
    _redrawTimer: null,
    _sigintCount: 0,
    _sigintResetTimer: null,
  };

  function historyHeight() {
    return Math.max(frame.rows - frame.bottomReserved, 1);
  }

  // ── public API ──────────────────────────────────────────────

  function start(onLine, onSigint, onAbort) {
    frame._onLine = onLine;
    frame._onSigint = onSigint;
    frame._onAbort = onAbort || onSigint;

    // Enter alternate screen
    frame.stdout.write(ANSI.altScreenOn);
    frame.stdout.write(ANSI.hideCursor);

    // Raw-mode input
    frame.stdin.setRawMode(true);
    frame.stdin.resume();
    frame.stdin.setEncoding("utf8");
    frame.stdin.on("data", _onData);
    frame.stdout.on("resize", _onResize);

    _redraw();
  }

  function destroy() {
    frame._exiting = true;
    if (frame._redrawTimer) { clearTimeout(frame._redrawTimer); frame._redrawTimer = null; }
    if (frame._sigintResetTimer) { clearTimeout(frame._sigintResetTimer); frame._sigintResetTimer = null; }
    frame.stdin.setRawMode(false);
    frame.stdin.pause();
    frame.stdin.removeAllListeners("data");
    frame.stdout.removeAllListeners("resize");
    // Restore terminal
    frame.stdout.write(ANSI.altScreenOff);
    frame.stdout.write(ANSI.showCursor);
  }

  function write(text) {
    if (frame._exiting || !text) return;
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast && seg === "") {
        // trailing newline → finalize partial
        frame._lines.push(frame._partial);
        frame._partial = "";
      } else if (isLast) {
        frame._partial += seg;
      } else {
        frame._lines.push(frame._partial + seg);
        frame._partial = "";
      }
    }
    // Ring-buffer cap
    while (frame._lines.length > frame._maxLines) frame._lines.shift();
    _scheduleRedraw();
  }

  // Convenience: write text followed by a newline.
  function writeLine(text) {
    write(text + "\n");
  }

  // Write an info/diagnostic line (same as writeLine in TTY mode).
  function info(text) {
    writeLine(text);
  }

  function setStatusDot(dot) {
    frame._statusDot = dot;
    _scheduleRedraw();
  }

  function setStatusText(text) {
    frame._statusText = text;
    _scheduleRedraw();
  }

  function setModelText(text) {
    frame._modelText = text;
    _scheduleRedraw();
  }

  function setInputHint(hint) {
    frame._hint = hint;
    _scheduleRedraw();
  }

  function setPrompt(text) {
    frame._prompt = text;
    _scheduleRedraw();
  }

  // Always-on in TTY mode; input is never disabled (steer during running).
  function enableInput() { /* no-op */ }
  function disableInput() { /* no-op */ }

  // ── internal helpers ───────────────────────────────────────

  function _scheduleRedraw() {
    frame._dirty = true;
    if (!frame._redrawTimer) {
      frame._redrawTimer = setTimeout(() => {
        frame._redrawTimer = null;
        if (frame._dirty && !frame._exiting) _redraw();
      }, 16); // ~60 Hz throttle
    }
  }

  function _redraw() {
    if (frame._exiting) return;
    frame._dirty = false;

    const histH = historyHeight();
    const allLines = frame._lines.concat(frame._partial || []);
    // Show last histH non-empty lines (at least one line so partial has a home)
    const visible = allLines.slice(-Math.max(histH, 1));

    const parts = [];

    // Clear + home
    parts.push(ANSI.homeClear);

    // History lines
    for (const ln of visible) {
      // Clip each line to terminal width to avoid wrapping artefacts
      parts.push(ln.length > frame.cols ? ln.slice(0, frame.cols - 1) + "…" : ln);
      parts.push("\r\n");
    }

    // Pad remaining rows in history area so separator always sits at the same row
    const filled = Math.min(visible.length, histH);
    for (let i = filled; i < histH; i++) {
      parts.push("\r\n");
    }

    // Separator (row rows-2)
    parts.push(ANSI.GRAY + "─".repeat(frame.cols) + ANSI.RESET + "\r\n");

    // Status line (row rows-1)
    parts.push(_statusLine());
    parts.push("\r\n");

    // Input line (row rows)
    parts.push(_inputLine());

    // Position cursor on input line after prompt + cursor offset
    // +1 for 1-based terminal column
    const promptWidth = visualWidth(frame._prompt);
    const cursorChars = frame._inputChars.slice(0, frame._inputCursor);
    const cursorVisualOffset = visualWidth(cursorChars.join(""));
    const col = promptWidth + cursorVisualOffset + 1;
    parts.push(`\x1b[${frame.rows};${Math.max(col, 1)}H`);
    parts.push(ANSI.showCursor);

    frame.stdout.write(parts.join(""));
  }

  function _statusLine() {
    const dotColors = { idle: ANSI.GRAY, busy: ANSI.YELLOW, error: ANSI.RED };
    const dc = dotColors[frame._statusDot] || ANSI.GRAY;

    let left = dc + "●" + ANSI.RESET + " ";
    if (frame._statusDot === "busy") left += ANSI.YELLOW + "RUNNING" + ANSI.RESET + " ";
    else if (frame._statusDot === "error") left += ANSI.RED + "ERROR" + ANSI.RESET + " ";
    else left += ANSI.GRAY + "idle" + ANSI.RESET + " ";

    if (frame._statusText) left += ANSI.GRAY + frame._statusText + ANSI.RESET + " ";

    const right = frame._modelText ? ANSI.CYAN + frame._modelText + ANSI.RESET : "";

    const leftLen = visualWidth(stripAnsi(left));
    const rightLen = visualWidth(stripAnsi(right));
    const pad = Math.max(1, frame.cols - leftLen - rightLen);

    return left + " ".repeat(pad) + right;
  }

  function _inputLine() {
    const prompt = ANSI.GREEN + frame._prompt + ANSI.RESET;
    if (frame._inputChars.length === 0 && frame._hint) {
      return prompt + ANSI.GRAY + frame._hint + ANSI.RESET;
    }
    return prompt + frame._inputChars.join("");
  }

  // ── keyboard input ─────────────────────────────────────────

  function _onData(data) {
    if (frame._exiting) return;

    const cp = data.codePointAt(0);

    // Ctrl-C (0x03)
    if (cp === 0x03) {
      frame._sigintCount += 1;
      if (frame._sigintResetTimer) clearTimeout(frame._sigintResetTimer);
      frame._sigintResetTimer = setTimeout(() => { frame._sigintCount = 0; }, 1500);
      if (frame._sigintCount === 1 && frame._onAbort) {
        frame._onAbort();
        return;
      }
      if (frame._onSigint) frame._onSigint();
      return;
    }

    // Ctrl-D (0x04) on empty line → exit
    if (cp === 0x04) {
      if (frame._inputChars.length === 0) {
        if (frame._onSigint) frame._onSigint();
      }
      return;
    }

    // Enter / CR (0x0d) — submit line
    if (cp === 0x0d || cp === 0x0a) {
      const line = frame._inputChars.join("");
      // Echo submitted line into history
      frame._lines.push(frame._prompt + line);
      frame._inputChars = [];
      frame._inputCursor = 0;
      _redraw();
      if (frame._onLine) frame._onLine(line);
      return;
    }

    // Backspace (0x7f) or Ctrl-H (0x08)
    if (cp === 0x7f || cp === 0x08) {
      if (frame._inputCursor > 0) {
        frame._inputChars.splice(frame._inputCursor - 1, 1);
        frame._inputCursor -= 1;
        _scheduleRedraw();
      }
      return;
    }

    // Ctrl-L (0x0c) — repaint
    if (cp === 0x0c) {
      _redraw();
      return;
    }

    // Escape sequence (arrow keys, etc.) — ignore for now
    if (cp === 0x1b) return;

    // Printable character (including multi-byte / composed)
    // Treat the whole data string as a single code-point insertion
    if (data && data.length > 0) {
      frame._inputChars.splice(frame._inputCursor, 0, data);
      frame._inputCursor += 1;
      _scheduleRedraw();
    }
  }

  // ── resize ─────────────────────────────────────────────────

  function _onResize() {
    frame.rows = Math.max(process.stdout.rows || 24, 10);
    frame.cols = Math.max(process.stdout.columns || 80, 40);
    _redraw();
  }

  // ── expose public methods ──────────────────────────────────

  frame.start = start;
  frame.destroy = destroy;
  frame.write = write;
  frame.writeLine = writeLine;
  frame.info = info;
  frame.setStatusDot = setStatusDot;
  frame.setStatusText = setStatusText;
  frame.setModelText = setModelText;
  frame.setInputHint = setInputHint;
  frame.setPrompt = setPrompt;
  frame.enableInput = enableInput;
  frame.disableInput = disableInput;

  return frame;
}

/**
 * PlainFrame — non-TTY / NO_COLOR / YPIC_PLAIN fallback.
 *
 * Delegates to a user-supplied readline interface. Output goes directly to
 * stdout; status messages use "[YPIC:info]" on stderr. No ANSI escapes are
 * emitted, making it safe for pipes, CI logs, and non-TTY environments.
 */
function createPlainFrame(rl) {
  const frame = {
    kind: "plain",
    _rl: rl,
    _exiting: false,
  };

  function start(onLine, onSigint, onAbort, onClose) {
    frame._rl.on("line", (line) => { if (!frame._exiting) onLine(line); });
    frame._rl.on("SIGINT", () => {
      if (onAbort) onAbort(); else onSigint();
    });
    frame._rl.on("close", () => {
      if (frame._exiting) return;
      if (onClose) onClose(); else onSigint();
    });
  }

  function destroy() {
    frame._exiting = true;
    // rl is owned by the caller (main), not managed here
  }

  function write(text) {
    process.stdout.write(text);
  }

  function writeLine(text) {
    process.stdout.write(text + "\n");
  }

  function info(text) {
    console.error(`[YPIC:info] ${text}`);
  }

  function setStatusDot() { /* no-op — no status bar in plain mode */ }
  function setStatusText() { /* no-op */ }
  function setModelText() { /* no-op */ }
  function setInputHint() { /* no-op */ }

  function setPrompt(text) {
    if (!frame._rl.closed) frame._rl.setPrompt(text);
  }

  function enableInput() {
    if (!frame._exiting && !frame._rl.closed) frame._rl.prompt();
  }

  function disableInput() { /* no-op — input is always available in plain mode */ }

  frame.start = start;
  frame.destroy = destroy;
  frame.write = write;
  frame.writeLine = writeLine;
  frame.info = info;
  frame.setStatusDot = setStatusDot;
  frame.setStatusText = setStatusText;
  frame.setModelText = setModelText;
  frame.setInputHint = setInputHint;
  frame.setPrompt = setPrompt;
  frame.enableInput = enableInput;
  frame.disableInput = disableInput;

  return frame;
}

/**
 * Factory: pick TerminalFrame or PlainFrame based on the environment.
 *
 * TerminalFrame is used when:
 *   - stdout is a TTY
 *   - NO_COLOR is NOT set
 *   - YPIC_PLAIN is NOT set
 *   - stdin is a TTY (needed for raw-mode input)
 *
 * Otherwise PlainFrame with a readline interface is used.
 */
function createFrame(rl) {
  const useTty =
    process.stdout.isTTY &&
    process.stdin.isTTY &&
    !process.env.NO_COLOR &&
    !process.env.YPIC_PLAIN;
  if (useTty) return createTerminalFrame();
  return createPlainFrame(rl);
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
  const state = {
    closed: false,
    connected: false,
    everConnected: false,
    connectionError: null,
    controller: new AbortController(),
  };

  let resolveConnected;
  let rejectConnected;
  const connectedPromise = new Promise((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  // Wrap onEvent to track connection state and resolve the connected promise.
  const wrappedOnEvent = (event) => {
    if (event.type === "connected") {
      state.connected = true;
      state.everConnected = true;
      resolveConnected(true);
      debug("SSE connected");
    }
    if (event.type === "_sse_error" && !state.connected) {
      // Only capture pre-connected errors as connection failures.
      // Post-connected _sse_error means the stream hit an issue mid-flight
      // — it goes to the renderer for display, not the connection gate.
      state.connectionError = event.error;
      ypicInfo(`  ✗ SSE connection failed: ${event.error}`);
      rejectConnected(new Error(event.error));
    }
    onEvent(event);
  };

  const decoder = new TextDecoder();
  let buffer = "";

  debug("SSE: connecting to", url);
  (async () => {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, { signal: state.controller.signal, headers: { Accept: "text/event-stream" } });
      debugTiming(`SSE connect ${url} status=${res.status}`, t0);
    } catch (error) {
      if (!state.closed) wrappedOnEvent({ type: "_sse_error", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!res.ok || !res.body) {
      if (!state.closed) wrappedOnEvent({ type: "_sse_error", error: `SSE connect failed: HTTP ${res.status}` });
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
          handleRawEvent(rawEvent, wrappedOnEvent);
        }
      }
    } catch (error) {
      if (!state.closed) wrappedOnEvent({ type: "_sse_error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      state.closed = true;
      wrappedOnEvent({ type: "_sse_closed" });
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
    isConnected() {
      return state.connected;
    },
    isEverConnected() {
      return state.everConnected;
    },
    getConnectionError() {
      return state.connectionError;
    },
    connected: connectedPromise,
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
function createRenderer(frame) {
  const renderer = {
    running: false,
    printedTextLen: 0,        // cumulative assistant text already printed this message
    pendingNewline: false,    // assistant text was printed without trailing newline
    toolNamesById: new Map(), // toolCallId -> toolName (for end markers)
    approvalPrompted: false,  // dedupe plan-review prompt within one turn
    lastWaitSig: null,        // last ypi_studio_wait update signature (dedupe)
    lastWaitPrintAt: 0,       // last ypi_studio_wait update print time (throttle)
    baseUrl: null,            // server base url, for approval/open hints
    frame: frame,             // rendering target
  };

  function ensureNewline() {
    if (renderer.pendingNewline) {
      frame.write("\n");
      renderer.pendingNewline = false;
    }
  }

  function writeAssistantDelta(text) {
    if (text.length > renderer.printedTextLen) {
      const delta = text.slice(renderer.printedTextLen);
      frame.write(delta);
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
          if (name === "ypi_studio_task") frame.writeLine(`  ${summarizeStudioTaskStart(event.args)}`);
          else if (name === "ypi_studio_subagent") frame.writeLine(`  ${summarizeStudioSubagentStart(event.args)}`);
          else if (name === "ypi_studio_wait") frame.writeLine(`  ${summarizeStudioWaitStart(event.args)}`);
        } else {
          const hint = shortToolHint(name, event.args);
          frame.writeLine(`  ⚒ ${name}${hint}`);
        }
        break;
      }
      case "tool_execution_update": {
        // Only ypi_studio_wait streams useful compact poll progress; all other
        // tool updates are intentionally ignored to keep the terminal clean.
        const updateName = event.toolName || renderer.toolNamesById.get(event.toolCallId) || "";
        if (updateName === "ypi_studio_wait") {
          const line = summarizeStudioWaitUpdate(event, renderer);
          if (line) { ensureNewline(); frame.writeLine(line); }
        }
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId;
        const name = renderer.toolNamesById.get(id) || event.toolName || "tool";
        renderer.toolNamesById.delete(id);
        if (STUDIO_TOOLS.has(name)) {
          ensureNewline();
          if (name === "ypi_studio_task") frame.writeLine(summarizeStudioTaskEnd(event, renderer, renderer.baseUrl));
          else if (name === "ypi_studio_subagent") frame.writeLine(summarizeStudioSubagentEnd(event));
          else if (name === "ypi_studio_wait") frame.writeLine(summarizeStudioWaitEnd(event));
        } else {
          const mark = event.isError ? "✗" : "✓";
          frame.writeLine(`  ${mark} ${name}`);
        }
        break;
      }
      case "agent_end": {
        ensureNewline();
        const childRuns = typeof event.studioChildRunCount === "number" ? event.studioChildRunCount : 0;
        if (childRuns > 0) {
          frame.writeLine(`  … Studio 子任务仍在后台运行 (${childRuns})，主会话会在结束后自动续跑。`);
        }
        renderer.running = false;
        renderer.printedTextLen = 0;
        renderer.toolNamesById.clear();
        break;
      }
      case "agent_error":
        ensureNewline();
        frame.writeLine(`  ✗ agent error: ${event.errorMessage || "agent failed to start"}`);
        renderer.running = false;
        renderer.printedTextLen = 0;
        break;
      case "auto_retry_start":
        frame.writeLine(`  ↻ retry ${event.attempt}/${event.maxAttempts}${event.errorMessage ? `: ${event.errorMessage}` : ""}`);
        break;
      case "auto_retry_end":
        break;
      case "chatgpt_account_failover":
        frame.writeLine(`  ↻ ChatGPT 账号切换: ${event.status}`);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        frame.writeLine("  ⚙ compacting context…");
        break;
      case "auto_compaction_end":
      case "compaction_end":
        if (event.errorMessage) frame.writeLine(`  ✗ compaction failed: ${event.errorMessage}`);
        else frame.writeLine("  ✓ context compacted");
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
        frame.writeLine(`  ✗ stream error: ${event.error}`);
        break;
      case "_sse_closed":
        // Stream closed (server stop / network). Caller may reconnect.
        if (!renderer.running) {
          debug("SSE stream closed while idle");
        }
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

  // Enable debug timing when YPIC_DEBUG is set.
  debugTimingEnabled = Boolean(process.env.YPIC_DEBUG);

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

  // Create readline (used by PlainFrame or for non-TTY fallback only).
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY,
    prompt: "> ",
  });

  // Frame: TTY bottom-bar rendering or plain readline fallback.
  const frame = createFrame(rl);

  // ── helpers that depend on frame ──────────────────────────

  let currentModel = null;
  let modelState = { list: [], defaultModel: null, thinkingLevels: {}, thinkingLevelMaps: {} };

  function updateFrameModel() {
    if (currentModel) {
      frame.setModelText(`${currentModel.displayName} · ${currentModel.thinkingLevel}`);
    } else {
      frame.setModelText("no model");
    }
  }

  // ── startup output through frame ──────────────────────────

  frame.writeLine(`YPI CLI chat · cwd: ${cwd}`);
  frame.writeLine(`Using local ypi server: ${baseUrl} (v${health.body.version})`);
  frame.writeLine(`Type /help for commands, /config to open Web settings, /oweb to open this session in Web, /quit to exit.`);
  frame.write("\n");

  let sessionId;
  let projectContext = null;

  if (opts.resume) {
    sessionId = opts.resume;
    frame.writeLine(`Resuming session: ${sessionId}`);
  } else if (opts.continue) {
    const recent = await findRecentSessionForCwd(baseUrl, cwd);
    if (recent) {
      sessionId = recent.id;
      projectContext = recent.projectId && recent.spaceId
        ? { projectId: recent.projectId, spaceId: recent.spaceId }
        : null;
      frame.writeLine(`Continuing session: ${sessionId}`);
    } else {
      frame.writeLine(`No existing session for this cwd; creating a new one.`);
    }
  }

  if (!sessionId) {
    try {
      projectContext = await resolveProjectContext(baseUrl, cwd);
    } catch (error) {
      frame.writeLine(`  ! project context skipped: ${error instanceof Error ? error.message : String(error)}`);
      projectContext = null;
    }
    sessionId = await draftSession(baseUrl, cwd, projectContext);
    frame.writeLine(`Session created: ${sessionId}`);
  }

  // Resume awareness: check whether the session is already running.
  const agentState = await getAgentState(baseUrl, sessionId);
  if (!agentState) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const initiallyRunning = Boolean(agentState?.running);

  // Load models and resolve current model state.
  try {
    const loaded = await fetchModels(baseUrl);
    modelState = {
      list: loaded.modelList || [],
      defaultModel: loaded.defaultModel || null,
      thinkingLevels: loaded.thinkingLevels || {},
      thinkingLevelMaps: loaded.thinkingLevelMaps || {},
    };
  } catch (error) {
    debug("Failed to load models:", error instanceof Error ? error.message : String(error));
  }

  // Resolve current model from agent state + model list.
  currentModel = resolveCurrentModel(agentState, modelState.list);

  // If no model is set but a default exists and the session is not running, set it.
  if (!currentModel && modelState.defaultModel && !initiallyRunning) {
    const dm = modelState.defaultModel;
    try {
      await sendAgentCommand(baseUrl, sessionId, { type: "set_model", provider: dm.provider, modelId: dm.modelId });
      const match = findModel(modelState.list, dm.provider, dm.modelId);
      currentModel = {
        provider: dm.provider,
        modelId: dm.modelId,
        displayName: match ? modelDisplayName(match) : `${dm.provider}/${dm.modelId}`,
        thinkingLevel: "off",
      };
    } catch (error) {
      debug("Failed to set default model:", error instanceof Error ? error.message : String(error));
    }
  }

  // Display model info and sync to frame status bar.
  if (currentModel) {
    frame.writeLine(`Model: ${formatModelSummary(currentModel)}`);
  } else {
    frame.writeLine("Model: not configured — use /config to open Web settings and set up a model.");
  }
  frame.write("\n");
  updateFrameModel();

  // ── renderer ──────────────────────────────────────────────

  const renderer = createRenderer(frame);
  renderer.baseUrl = baseUrl;

  let exiting = false;
  let sseReconnectAttempted = false;
  let sse = null;
  let reconnectTimer = null;
  let sigintCount = 0;
  let sigintResetTimer = null;

  // Guard against prompting when finished.
  function safePrompt() {
    if (frame.kind === "plain" && !exiting && !rl.closed) rl.prompt();
    // TTY frame is always accepting input; no explicit prompt needed.
  }

  // If the stream dies while the agent is running, attempt ONE reconnect.
  const handleSseClosed = () => {
    if (exiting || !sse?.isClosed()) return;
    if (reconnectTimer) return;
    if (!renderer.running) {
      debug("SSE stream closed while idle");
      return;
    }
    if (sseReconnectAttempted) {
      frame.writeLine("  ✗ SSE stream lost again after reconnect. The agent may not respond. Try /abort or /quit and restart.");
      return;
    }
    sseReconnectAttempted = true;
    frame.writeLine("  ⚡ SSE stream disconnected. Reconnecting (one attempt)…");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (exiting) return;
      debug("reconnecting SSE");
      sse = connectSse(baseUrl, sessionId, (event) => renderer.handleEvent(event));
      sse.connected.then(() => {
        frame.writeLine("  ✓ SSE reconnected");
      }).catch((err) => {
        frame.writeLine(`  ✗ SSE reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 1000);
  };

  // Wrap the renderer's handler so we can also drive reconnect and approval.
  const originalHandle = renderer.handleEvent;
  renderer.handleEvent = (event) => {
    originalHandle(event);
    if (event.type === "agent_end") {
      void maybePromptStudioApproval();
      if (opts.message && !process.stdin.isTTY && !exiting) {
        void quit();
      }
    }
    if (event.type === "_sse_closed") handleSseClosed();
  };
  sse = connectSse(baseUrl, sessionId, (event) => renderer.handleEvent(event));

  // Backup detection: when a turn ends with the bound Studio task in
  // awaiting_approval, fetch the session's studio task and print the
  // plan-review prompt once. Never auto-approves.
  async function maybePromptStudioApproval() {
    if (renderer.approvalPrompted || exiting) return;
    try {
      const body = await getStudioTask(baseUrl, sessionId);
      const task = body && body.task;
      if (task && task.status === "awaiting_approval") {
        renderer.approvalPrompted = true;
        renderer.ensureNewline();
        frame.write(approvalPromptText(task, baseUrl));
      }
    } catch (error) {
      debug("studio approval backup check failed:", error instanceof Error ? error.message : String(error));
    }
  }

  if (initiallyRunning) {
    renderer.running = true;
  }

  // ── quit ──────────────────────────────────────────────────

  async function quit() {
    if (exiting) return;
    exiting = true;
    sse?.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const sessionWebUrl = buildSessionWebUrl(baseUrl, sessionId);
    const resumeCommand = buildResumeCommand(opts, sessionId);

    // Destroy the frame (restores terminal for TTY mode).
    frame.destroy();

    // Light Studio exit protection.
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
    }
    process.stdout.write(
      `\nResume this session with:\n  ${resumeCommand}\n` +
      `Open it in Web:\n  ${sessionWebUrl}\n`,
    );
    rl.close();
    process.exit(0);
  }

  // ── SIGINT / abort handling ───────────────────────────────

  function onSigintAbort() {
    sigintCount += 1;
    if (sigintResetTimer) clearTimeout(sigintResetTimer);
    sigintResetTimer = setTimeout(() => { sigintCount = 0; }, 1500);
    if (renderer.running && sigintCount === 1) {
      frame.writeLine("  ⏹ aborting… (Ctrl-C again to quit)");
      sendAgentCommand(baseUrl, sessionId, { type: "abort" }).catch(() => {});
      // Keep accepting input; don't change status.
      if (frame.kind === "plain") safePrompt();
      return;
    }
    void quit();
  }

  // ── help ──────────────────────────────────────────────────

  function printHelp() {
    frame.writeLine("In-session commands:");
    frame.writeLine("  /help          show this help");
    frame.writeLine("  /model         manage model and thinking level");
    frame.writeLine("  /config /open  open ypi Web in your browser");
    frame.writeLine("  /oweb          open this exact session in the Web UI");
    frame.writeLine("  /status        show current agent state");
    frame.writeLine("  /abort         abort a running turn");
    frame.writeLine("  /steer <text>  steer a running agent");
    frame.writeLine("  /follow <text> queue a follow-up message");
    frame.writeLine("  /quit          exit (Ctrl-C also works)");
  }

  // ── input handler ─────────────────────────────────────────

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
      frame.writeLine(`Opened ${baseUrl} in your browser.`);
      frame.writeLine("Use Settings for models, auth, Studio member policy, terminal, usage, and editor configuration.");
      safePrompt();
      return;
    }
    if (trimmed === "/oweb") {
      const sessionWebUrl = buildSessionWebUrl(baseUrl, sessionId);
      openBrowser(sessionWebUrl);
      frame.writeLine(`Opened ${sessionWebUrl} in your browser.`);
      safePrompt();
      return;
    }
    if (trimmed === "/status") {
      const state = await getAgentState(baseUrl, sessionId);
      if (!state) {
        frame.writeLine("No agent state available.");
      } else if (state.running) {
        frame.writeLine("Agent running.");
      } else {
        frame.writeLine("Agent idle.");
      }
      safePrompt();
      return;
    }
    if (trimmed === "/abort") {
      if (!renderer.running) {
        frame.writeLine("Nothing to abort (agent is idle).");
        safePrompt();
        return;
      }
      await sendAgentCommand(baseUrl, sessionId, { type: "abort" }).catch((e) => {
        frame.writeLine(`abort failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      safePrompt();
      return;
    }
    if (trimmed.startsWith("/steer ")) {
      const text = trimmed.slice("/steer ".length).trim();
      if (!text) { frame.writeLine("Usage: /steer <text>"); safePrompt(); return; }
      await sendAgentCommand(baseUrl, sessionId, { type: "steer", message: text }).catch((e) => {
        frame.writeLine(`steer failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      safePrompt();
      return;
    }
    if (trimmed.startsWith("/follow ")) {
      const text = trimmed.slice("/follow ".length).trim();
      if (!text) { frame.writeLine("Usage: /follow <text>"); safePrompt(); return; }
      await sendAgentCommand(baseUrl, sessionId, { type: "follow_up", message: text }).catch((e) => {
        frame.writeLine(`follow_up failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      safePrompt();
      return;
    }
    // --- /model command ---
    if (trimmed === "/model" || trimmed.startsWith("/model ")) {
      const rest = trimmed === "/model" ? "" : trimmed.slice("/model ".length).trim();

      if (rest === "" || rest === "help") {
        frame.writeLine("Model selection commands:");
        frame.writeLine("  /model current            Show current model and thinking level");
        frame.writeLine("  /model list [provider]    List available models");
        frame.writeLine("  /model <provider>/<modelId> [<thinking>]  Switch model");
        frame.writeLine("  /model thinking <level>   Switch thinking (off/auto/low/medium/high/xhigh)");
        frame.write("\n");
        if (currentModel) {
          frame.writeLine(`  Current: ${formatModelSummary(currentModel)}`);
        } else {
          frame.writeLine("  No model configured.");
        }
        frame.write("\n");
        safePrompt();
        return;
      }

      if (rest === "current") {
        if (currentModel) {
          frame.writeLine(`Current model: ${formatModelSummary(currentModel)}`);
          const levels = getSupportedThinkingLevels(modelState, currentModel.provider, currentModel.modelId);
          frame.writeLine(`Supported thinking levels: ${levels.join(", ")}`);
        } else {
          frame.writeLine("No model configured. Use /config to open Web settings.");
        }
        safePrompt();
        return;
      }

      if (rest === "list" || rest.startsWith("list ")) {
        const filterProvider = rest.startsWith("list ") ? rest.slice("list ".length).trim() : null;
        if (modelState.list.length === 0) {
          frame.writeLine("No models available. Check your server configuration and ensure at least one model provider is set up.");
          safePrompt();
          return;
        }
        const groups = new Map();
        for (const m of modelState.list) {
          if (filterProvider && m.provider !== filterProvider) continue;
          const key = m.providerDisplayName || m.provider;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        }
        if (groups.size === 0) {
          frame.writeLine(`No models found for provider "${filterProvider}".`);
          safePrompt();
          return;
        }
        for (const [pd, models] of groups) {
          frame.writeLine(`${pd}:`);
          for (const m of models) {
            const marker = currentModel && currentModel.provider === m.provider && currentModel.modelId === m.id ? " *" : "  ";
            frame.writeLine(`${marker} ${m.provider}/${m.id}  ${m.name}`);
          }
        }
        frame.writeLine("  * = current model. Switch with /model <provider>/<modelId>");
        safePrompt();
        return;
      }

      if (rest.startsWith("thinking ")) {
        const level = rest.slice("thinking ".length).trim().toLowerCase();
        if (!THINKING_LEVELS.includes(level)) {
          frame.writeLine(`Invalid thinking level: "${level}". Supported: ${THINKING_LEVELS.join(", ")}`);
          safePrompt();
          return;
        }
        if (renderer.running) {
          frame.writeLine("Agent is running. Use /abort first to stop the current turn before switching models.");
          safePrompt();
          return;
        }
        if (!currentModel) {
          frame.writeLine("No model configured. Use /config to set up a model first.");
          safePrompt();
          return;
        }
        const supported = getSupportedThinkingLevels(modelState, currentModel.provider, currentModel.modelId);
        if (!supported.includes(level)) {
          frame.writeLine(`Thinking level "${level}" is not supported for ${currentModel.displayName}. Supported: ${supported.join(", ")}`);
          safePrompt();
          return;
        }
        try {
          await sendAgentCommand(baseUrl, sessionId, { type: "set_thinking_level", level });
          currentModel.thinkingLevel = level;
          frame.writeLine(`Thinking level set to "${level}" for ${currentModel.displayName}.`);
          updateFrameModel();
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          frame.writeLine(`Failed to set thinking level: ${msg}`);
        }
        safePrompt();
        return;
      }

      // Parse as provider/modelId [thinking]
      const parsed = parseModelSwitch(rest);
      if (!parsed) {
        frame.writeLine("Invalid /model syntax. Use /model for help.");
        safePrompt();
        return;
      }

      if (renderer.running) {
        frame.writeLine("Agent is running. Use /abort first to stop the current turn before switching models.");
        safePrompt();
        return;
      }

      const { provider, modelId, thinking: parsedThinking } = parsed;
      const model = findModel(modelState.list, provider, modelId);
      if (!model) {
        frame.writeLine(`Model not found: ${provider}/${modelId}. Use /model list to see available models.`);
        safePrompt();
        return;
      }

      try {
        await sendAgentCommand(baseUrl, sessionId, { type: "set_model", provider, modelId });
        currentModel = {
          provider,
          modelId,
          displayName: modelDisplayName(model),
          thinkingLevel: currentModel?.thinkingLevel ?? "off",
        };
        frame.writeLine(`Model switched to ${currentModel.displayName}.`);
        updateFrameModel();

        if (parsedThinking) {
          const supported = getSupportedThinkingLevels(modelState, provider, modelId);
          if (!supported.includes(parsedThinking)) {
            frame.writeLine(`Warning: thinking level "${parsedThinking}" is not supported for ${currentModel.displayName}. Supported: ${supported.join(", ")}. Thinking level unchanged.`);
          } else {
            try {
              await sendAgentCommand(baseUrl, sessionId, { type: "set_thinking_level", level: parsedThinking });
              currentModel.thinkingLevel = parsedThinking;
              frame.writeLine(`Thinking level set to "${parsedThinking}".`);
              updateFrameModel();
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              frame.writeLine(`Warning: failed to set thinking level: ${msg}`);
            }
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        frame.writeLine(`Failed to switch model: ${msg}`);
      }
      safePrompt();
      return;
    }
    // --- end /model ---

    if (trimmed.startsWith("/")) {
      // Unknown slash command — send it through as a chat prompt so existing
      // Studio slash commands (e.g. /studio-feature) work transparently.
    }

    // Regular chat input.
    try {
      if (renderer.running) {
        await sendAgentCommand(baseUrl, sessionId, { type: "steer", message: trimmed });
      } else {
        frame.writeLine("Sending…");
        if (frame.kind === "tty") frame.setStatusDot("busy");
        renderer.running = true;
        renderer.resetMessage();
        await sendAgentCommand(baseUrl, sessionId, { type: "prompt", message: trimmed });
        // POST returned — server accepted the prompt. Check SSE status.
        if (!sse?.isConnected()) {
          const connErr = sse?.getConnectionError();
          if (connErr) {
            frame.writeLine(`  ✗ SSE connection failed earlier: ${connErr}`);
            frame.writeLine("  hint: The agent may not stream output. Check your server or restart with /quit and try again.");
          } else {
            frame.writeLine("  ⚡ Waiting for SSE connection…");
            try {
              await Promise.race([
                sse?.connected,
                new Promise((_, reject) => setTimeout(() => reject(new Error("SSE connect timeout")), 10_000)),
              ]);
              frame.writeLine("  ✓ SSE connected");
            } catch (sseErr) {
              if (sseErr instanceof Error && sseErr.message === "SSE connect timeout") {
                frame.writeLine("  ⚠ SSE not connected after 10s. The agent may still respond; if no output appears, check the server or restart.");
              } else {
                frame.writeLine(`  ✗ SSE connection error: ${sseErr instanceof Error ? sseErr.message : String(sseErr)}`);
                frame.writeLine("  hint: The server may be unreachable for SSE. Check your network or restart the server.");
              }
              debug("SSE connect gate failed:", sseErr instanceof Error ? sseErr.message : String(sseErr));
            }
          }
        }
        frame.writeLine("Waiting for model response…");
        if (frame.kind === "tty") frame.setInputHint("(Running… Enter to steer, Ctrl-C to abort)");
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message;
      renderer.ensureNewline();
      frame.writeLine(`  ✗ send failed: ${msg}`);
      if (err.hint) {
        frame.writeLine(`  hint: ${err.hint}`);
      } else if (/auth|provider|model|401|403|no.*model/i.test(msg)) {
        frame.writeLine("  hint: run /config to open the Web page and configure models/auth.");
      }
      renderer.running = false;
      if (frame.kind === "tty") { frame.setStatusDot("idle"); frame.setInputHint(""); }
    }
    safePrompt();
  }

  // ── wire frame input / lifecycle ──────────────────────────

  // The frame.start() wires its own input handling.
  // For TTY: raw-mode keyboard input → handleLine
  // For Plain: readline 'line' event → handleLine
  // Ctrl-C is handled by onSigintAbort.
  frame.start(
    (line) => { void handleLine(line); },
    () => { void quit(); },        // onSigint (quit on idle / second Ctrl-C)
    onSigintAbort,                 // onAbort  (first Ctrl-C when running)
    () => {
      // In one-shot mode with non-TTY stdin, EOF should not tear down the
      // process before the positional message finishes streaming.
      if (!exiting && !opts.message) void quit();
    },
  );

  // ── status synchronisation ────────────────────────────────

  // Sync frame status dot when renderer running state changes.
  const originalAgentEnd = renderer.handleEvent;
  renderer.handleEvent = (event) => {
    originalAgentEnd(event);
    // After event processing, sync the status dot.
    if (event.type === "agent_start") {
      if (frame.kind === "tty") { frame.setStatusDot("busy"); frame.setInputHint("(Running… Enter to steer, Ctrl-C to abort)"); }
    } else if (event.type === "agent_end" || event.type === "agent_error") {
      if (frame.kind === "tty") { frame.setStatusDot("idle"); frame.setInputHint(""); }
    } else if (event.type === "_sse_error" && !renderer.running) {
      if (frame.kind === "tty") { frame.setStatusDot("error"); frame.setInputHint(""); }
    } else if (event.type === "_sse_closed" && !renderer.running) {
      if (frame.kind === "tty") { frame.setStatusDot("idle"); frame.setInputHint(""); }
    }
  };

  // ── initial state ──────────────────────────────────────────

  if (initiallyRunning) {
    renderer.running = true;
    if (frame.kind === "tty") { frame.setStatusDot("busy"); frame.setInputHint("(Running… Enter to steer, Ctrl-C to abort)"); }
  }

  // Send the initial positional message (if any) as the first prompt.
  if (opts.message) {
    if (!sse.isConnected()) {
      try {
        await Promise.race([
          sse.connected,
          new Promise((_, reject) => setTimeout(() => reject(new Error("connect timeout")), 5_000)),
        ]);
      } catch {
        debug("SSE not connected before positional message; proceeding");
      }
    }
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
  // Model helpers (exported for tests)
  THINKING_LEVELS,
  modelKey,
  modelDisplayName,
  findModel,
  parseModelSwitch,
  getSupportedThinkingLevels,
  resolveCurrentModel,
  formatModelSummary,
  // Frame helpers (exported for tests)
  ANSI,
  stripAnsi,
  visualWidth,
  createFrame,
  createTerminalFrame,
  createPlainFrame,
};
