import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializeYpiStudioAgents } from "./ypi-studio-agents";
import { readPiWebConfigForApi } from "./pi-web-config";
import { resolveYpiStudioMemberPolicy, type ResolvedYpiStudioMemberPolicy } from "./ypi-studio-policy";
import {
  archiveYpiStudioTask,
  claimYpiStudioImplementationSubtask,
  createYpiStudioTask,
  getCurrentYpiStudioTaskDetail,
  getNextYpiStudioImplementationSubtask,
  getYpiStudioKnowledgeContextForPrompt,
  getYpiStudioTaskContextForPrompt,
  getYpiStudioTaskDetail,
  listYpiStudioTasks,
  recordYpiStudioSubagentRun,
  recordYpiStudioUserApproval,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioImplementationSubtask,
  updateYpiStudioTaskArtifact,
} from "./ypi-studio-tasks";
import { initializeYpiStudioWorkflows, readYpiStudioWorkflow } from "./ypi-studio-workflows";
import {
  appendYpiStudioSubagentTranscriptItem,
  createYpiStudioSubagentTranscript,
  finalizeYpiStudioSubagentTranscript,
  previewYpiStudioTranscriptText,
  type YpiStudioSubagentTranscriptWriter,
} from "./ypi-studio-transcripts";
import { registerYpiStudioChildRun, unregisterYpiStudioChildRun } from "./ypi-studio-subagent-runtime";
import type { YpiStudioImplementationLocalReviewStatus, YpiStudioImplementationSubtaskStatus, YpiStudioSubagentCurrentTool, YpiStudioSubagentRunPhase, YpiStudioSubagentRunProgress, YpiStudioSubagentTranscriptItem, YpiStudioSubagentTranscriptRef, YpiStudioTaskScope, YpiStudioTaskSubagentRun } from "./ypi-studio-types";

type JsonObject = Record<string, unknown>;
type TextContent = { type: "text"; text: string };
interface PiToolResult {
  content: TextContent[];
  details: unknown;
  isError?: boolean;
}

type ToolUpdateCallback = (result: PiToolResult) => void;

interface PiExtensionContext {
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
  };
  model?: { id?: string; provider?: string };
  ui?: { notify?: (msg: string, type?: "info" | "warning" | "error") => void };
}
interface StudioTaskToolInput {
  action?: "init_workflows" | "create" | "current" | "get" | "transition" | "update_artifact" | "archive" | "update_implementation_plan" | "implementation_next" | "claim_implementation_subtask" | "update_implementation_subtask";
  title?: string;
  workflowId?: string;
  taskId?: string;
  to?: string;
  reason?: string;
  artifact?: string;
  content?: string;
  override?: boolean;
  scope?: YpiStudioTaskScope;
  tags?: string[];
  knowledgeSummary?: string;
  knowledgeMarkdown?: string;
  implementationPlan?: Record<string, unknown>;
  subtaskId?: string;
  status?: YpiStudioImplementationSubtaskStatus;
  runId?: string;
  validation?: string[];
  blockedReason?: string;
  skippedReason?: string;
  localReview?: { status?: YpiStudioImplementationLocalReviewStatus; runId?: string; summary?: string };
}
interface StudioSubagentInput {
  member?: string;
  prompt?: string;
  taskId?: string;
  model?: string;
  thinking?: string;
  subtaskId?: string;
}

export interface YpiStudioSlashCommandDefinition {
  name: string;
  description: string;
  argumentHint?: string;
}

export const YPI_STUDIO_SLASH_COMMANDS: YpiStudioSlashCommandDefinition[] = [
  { name: "studio-init", description: "Initialize or backfill YPI Studio members and workflows" },
  { name: "studio-start", description: "Start a structured YPI Studio workflow task", argumentHint: "[goal]" },
  { name: "studio-feature", description: "Start a YPI Studio feature development task", argumentHint: "[goal]" },
  { name: "studio-bugfix", description: "Start a YPI Studio bugfix task", argumentHint: "[bug]" },
  { name: "studio-ui", description: "Start a YPI Studio UI-change task", argumentHint: "[goal]" },
  { name: "studio-continue", description: "Continue the active YPI Studio task" },
  { name: "studio-check", description: "Ask the YPI Studio checker to review the active task or diff", argumentHint: "[focus]" },
  { name: "studio-archive", description: "Archive the completed active YPI Studio task and distill reusable knowledge", argumentHint: "[reason]" },
];

const FIRST_REPLY_NOTICE = `<ypi-studio-first-reply>
First visible reply after this extension loads: say briefly in Chinese that YPI Studio workflow context is loaded, then answer directly.
This notice is one-shot: do not repeat it after the first assistant reply in the same session.
</ypi-studio-first-reply>`;

function isObj(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function readText(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function oneLine(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function findRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".ypi")) || existsSync(join(current, ".pi")) || existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function callStr(callback: (() => string | undefined) | undefined): string | null {
  if (!callback) return null;
  try {
    return str(callback());
  } catch {
    return null;
  }
}

function lookupStr(data: unknown, keys: string[]): string | null {
  if (!isObj(data)) return null;
  for (const key of keys) {
    const value = str(data[key]);
    if (value) return value;
  }
  for (const nestedKey of ["input", "properties", "event", "hook_input", "hookInput"]) {
    const nested = data[nestedKey];
    const value = lookupStr(nested, keys);
    if (value) return value;
  }
  return null;
}

function sanitizeContextId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) || hash(value);
}

function contextKey(input?: unknown, ctx?: PiExtensionContext): string | null {
  const sessionId = callStr(ctx?.sessionManager?.getSessionId) ?? lookupStr(input, ["session_id", "sessionId", "sessionID"]);
  if (sessionId) return `pi_${sanitizeContextId(sessionId)}`;
  const transcriptPath = callStr(ctx?.sessionManager?.getSessionFile) ?? lookupStr(input, ["transcript_path", "transcriptPath", "transcript"]);
  if (transcriptPath) return `pi_transcript_${hash(transcriptPath)}`;
  const envKey = str(process.env.YPI_STUDIO_CONTEXT_ID);
  if (envKey) return sanitizeContextId(envKey);
  const envSessionId = str(process.env.PI_SESSION_ID);
  if (envSessionId) return `pi_${sanitizeContextId(envSessionId)}`;
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function bashHasStudioContext(command: string): boolean {
  const trimmed = command.trimStart();
  return /^export\s+YPI_STUDIO_CONTEXT_ID=/.test(trimmed) || /^YPI_STUDIO_CONTEXT_ID=/.test(trimmed) || /^env\s+.*YPI_STUDIO_CONTEXT_ID=/.test(trimmed);
}

function summarizeWorkflowTriggers(root: string): string {
  try {
    const tasks = listYpiStudioTasks(root);
    if (tasks.tasks.length > 0) return `Existing Studio tasks: ${tasks.tasks.slice(0, 5).map((task) => `${task.id}(${task.status})`).join(", ")}`;
  } catch {
    // Ignore no-task discovery failures; the no-task breadcrumb is still useful.
  }
  return "No active Studio task is bound to this chat session.";
}

function hasRecordedApprovalGrant(task: { meta?: unknown }, key: string | null): boolean {
  if (!key || !isObj(task.meta)) return false;
  const grant = isObj(task.meta.approvalGrant) ? task.meta.approvalGrant : null;
  if (!grant) return false;
  const contextId = str(grant.contextId);
  const source = str(grant.source);
  const approvedAt = str(grant.approvedAt);
  if (contextId !== key || source !== "user-input" || !approvedAt) return false;
  const gate = isObj(task.meta.approvalGate) ? task.meta.approvalGate : null;
  const enteredAt = str(gate?.enteredAt);
  if (!enteredAt) return true;
  const approvedMs = Date.parse(approvedAt);
  const enteredMs = Date.parse(enteredAt);
  return Number.isFinite(approvedMs) && Number.isFinite(enteredMs) ? approvedMs > enteredMs : true;
}

function buildStudioState(root: string, key: string | null, query = ""): string {
  const current = key ? getCurrentYpiStudioTaskDetail(root, key) : null;
  if (!current) {
    const knowledge = getYpiStudioKnowledgeContextForPrompt(root, query || "recent studio task knowledge", { maxEntries: 3, maxTotalChars: 2200 });
    return [
      "<ypi-studio-state>",
      "Status: no_task",
      summarizeWorkflowTriggers(root),
      "If the user asks for non-trivial development work, or says phrases like 用工作室做 / 走工作室流程 / 让架构师先设计 / 让检查员 review:",
      "1. Do not jump directly into implementation.",
      "2. Ask for permission to create a YPI Studio task and enter the intake state.",
      "3. After approval, call ypi_studio_task(action=create).",
      "4. Role work must be assigned with ypi_studio_subagent; the main session is the orchestrator.",
      "</ypi-studio-state>",
      knowledge,
    ].filter(Boolean).join("\n");
  }

  const workflow = readYpiStudioWorkflow(root, current.workflowId);
  const state = workflow?.states[current.status];
  const approvalGranted = current.status === "awaiting_approval" && hasRecordedApprovalGrant(current, key);
  const knowledge = getYpiStudioKnowledgeContextForPrompt(root, [current.title, current.workflowId, current.status, query].join(" "), { maxEntries: 3, maxTotalChars: 2600 });
  return [
    "<ypi-studio-state>",
    `Task: ${current.id} (${current.status})`,
    `Title: ${current.title}`,
    `Workflow: ${workflow?.name ?? current.workflowId}`,
    `Current state: ${current.progress.label}`,
    `Progress: ${current.progress.percent}%`,
    `Owner: ${current.progress.owner}`,
    `Required artifacts: ${current.progress.requiredArtifacts.join(", ") || "none"}`,
    `Missing artifacts: ${current.progress.missingArtifacts.join(", ") || "none"}`,
    state?.instruction ? `State instruction: ${state.instruction}` : "",
    state?.requiresSubagent ? "The next owner must be dispatched through ypi_studio_subagent." : "The main session may handle orchestration for this state.",
    current.implementationPlan ? `Implementation subtasks: ${current.implementation?.done ?? 0}/${current.implementation?.total ?? current.implementationPlan.subtasks.length} done; active=${current.implementation?.activeTitle ?? current.implementation?.activeSubtaskId ?? "none"}; next=${current.implementation?.nextTitle ?? current.implementation?.nextSubtaskId ?? "none"}; blocked=${current.implementation?.blocked ?? 0}.` : "Implementation plan: not saved yet.",
    current.status === "planning" ? "When planning/design artifacts are complete, save implementationPlan with ypi_studio_task(action=update_implementation_plan), transition only to awaiting_approval, and then stop this turn to ask the user for confirmation; do not dispatch implementer in the same turn." : "",
    current.status === "implementing" && current.implementationPlan ? "Implementing with a plan: first call ypi_studio_task(action=claim_implementation_subtask) to claim exactly one ready subtask, then call ypi_studio_subagent(member=implementer, subtaskId=<claimed id>). Do not delegate the whole implementation at once." : "",
    current.status === "awaiting_approval" && approvalGranted ? "The user has explicitly approved the plan in this chat session. You may now transition to implementing in this turn and then dispatch implementer work if needed." : "",
    current.status === "awaiting_approval" && !approvalGranted ? "Current task is awaiting approval: summarize the plan/artifacts and ask for explicit approval or change requests. Do not transition to implementing until a later user input explicitly says 确认/批准/开始实现/approve/go ahead." : "",
    state?.requiresUserApproval && !approvalGranted ? "This state requires explicit user approval before moving forward." : "",
    "Never enter implementing from awaiting_approval unless a server-recorded user approval grant exists.",
    "</ypi-studio-state>",
    knowledge,
  ].filter(Boolean).join("\n");
}

function startupContext(root: string): string {
  const knowledge = getYpiStudioKnowledgeContextForPrompt(root, "recent studio task knowledge", { maxEntries: 3, maxTotalChars: 2200 });
  return [
    "<ypi-studio-context>",
    "YPI Studio workflow context is available. Studio tasks are structured under .ypi/tasks and workflows under .ypi/workflows.",
    "The main session is the orchestrator. Use ypi_studio_task for task lifecycle and ypi_studio_subagent for role delegation.",
    "Design/planning must stop at awaiting_approval for user confirmation; implementation may start only after a later explicit user approval.",
    "</ypi-studio-context>",
    knowledge,
    FIRST_REPLY_NOTICE,
    `Workspace: ${root}`,
  ].filter(Boolean).join("\n");
}

function currentTaskIdOrThrow(root: string, key: string | null, requested?: string): string {
  if (requested) return requested;
  const current = key ? getCurrentYpiStudioTaskDetail(root, key) : null;
  if (!current) throw new Error("No active YPI Studio task is bound to this session. Create or bind one first.");
  return current.id;
}

function isLocalReviewStatus(value: unknown): value is YpiStudioImplementationLocalReviewStatus {
  return value === "not_requested" || value === "requested" || value === "running" || value === "passed" || value === "failed" || value === "skipped";
}

function normalizeTaskToolInput(value: unknown): StudioTaskToolInput {
  const raw = isObj(value) ? value : {};
  const action = raw.action === "init_workflows" || raw.action === "create" || raw.action === "current" || raw.action === "get" || raw.action === "transition" || raw.action === "update_artifact" || raw.action === "archive" || raw.action === "update_implementation_plan" || raw.action === "implementation_next" || raw.action === "claim_implementation_subtask" || raw.action === "update_implementation_subtask" ? raw.action : undefined;
  const scope = raw.scope === "active" || raw.scope === "archived" || raw.scope === "all" ? raw.scope : undefined;
  return {
    action,
    title: str(raw.title) ?? undefined,
    workflowId: str(raw.workflowId) ?? undefined,
    taskId: str(raw.taskId) ?? undefined,
    to: str(raw.to) ?? undefined,
    reason: str(raw.reason) ?? undefined,
    artifact: str(raw.artifact) ?? undefined,
    content: typeof raw.content === "string" ? raw.content : undefined,
    override: raw.override === true,
    scope,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    knowledgeSummary: typeof raw.knowledgeSummary === "string" ? raw.knowledgeSummary : undefined,
    knowledgeMarkdown: typeof raw.knowledgeMarkdown === "string" ? raw.knowledgeMarkdown : undefined,
    implementationPlan: isObj(raw.implementationPlan) ? raw.implementationPlan : undefined,
    subtaskId: str(raw.subtaskId) ?? undefined,
    status: raw.status === "pending" || raw.status === "ready" || raw.status === "running" || raw.status === "blocked" || raw.status === "done" || raw.status === "skipped" ? raw.status : undefined,
    runId: str(raw.runId) ?? undefined,
    validation: Array.isArray(raw.validation) ? raw.validation.filter((item): item is string => typeof item === "string") : undefined,
    blockedReason: str(raw.blockedReason) ?? undefined,
    skippedReason: str(raw.skippedReason) ?? undefined,
    localReview: isObj(raw.localReview) ? { status: isLocalReviewStatus(raw.localReview.status) ? raw.localReview.status : undefined, runId: str(raw.localReview.runId) ?? undefined, summary: str(raw.localReview.summary) ?? undefined } : undefined,
  };
}

function normalizeSubagentInput(value: unknown): StudioSubagentInput {
  const raw = isObj(value) ? value : {};
  return {
    member: str(raw.member) ?? undefined,
    prompt: str(raw.prompt) ?? undefined,
    taskId: str(raw.taskId) ?? undefined,
    model: str(raw.model) ?? undefined,
    thinking: str(raw.thinking) ?? undefined,
    subtaskId: str(raw.subtaskId) ?? undefined,
  };
}

function currentThinking(pi: Pick<ExtensionAPI, "getThinkingLevel">): string | undefined {
  try {
    return pi.getThinkingLevel();
  } catch {
    return undefined;
  }
}

function memberFile(member: string): string {
  const normalized = member.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) throw new Error("Invalid Studio member id");
  return `${normalized}.md`;
}

const MAX_CHILD_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_CHILD_STDERR_BYTES = 1 * 1024 * 1024;
const MAX_CHILD_STDOUT_LINE_BYTES = 1 * 1024 * 1024;
const MAX_CHILD_FINAL_OUTPUT_BYTES = 256 * 1024;
const MAX_CHILD_LIVE_PREVIEW_BYTES = 4 * 1024;
const MAX_CHILD_TAIL_BYTES = 64 * 1024;
const CHILD_NO_FIRST_EVENT_WARN_MS = 60_000;
const CHILD_IDLE_TIMEOUT_MS = 10 * 60_000;
const CHILD_MAX_RUNTIME_MS = 60 * 60_000;
const CHILD_KILL_GRACE_MS = 2_000;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateBytes(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (byteLength(value) <= maxBytes) return { text: value, truncated: false };
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1;
  return { text: `${value.slice(0, Math.max(0, end - 1))}…`, truncated: true };
}

function boundedAppendTail(current: string, addition: string, maxBytes: number): string {
  const combined = `${current}${addition}`;
  if (byteLength(combined) <= maxBytes) return combined;
  let start = Math.max(0, combined.length - maxBytes);
  while (start < combined.length && byteLength(combined.slice(start)) > maxBytes) start += 1;
  return combined.slice(start);
}

function resolvePiCli(): { command: string; args: string[] } {
  const candidates: string[] = [];
  for (const arg of process.argv) {
    if (/pi-coding-agent[\\/]dist[\\/]cli\.js$/i.test(arg)) candidates.push(resolve(arg));
  }
  const prefix = str(process.env.npm_config_prefix) ?? str(process.env.NPM_CONFIG_PREFIX);
  if (prefix) {
    candidates.push(join(prefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"));
    candidates.push(join(prefix, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: process.execPath, args: [candidate] };
  }
  return { command: "pi", args: [] };
}

function buildPiArgs(policy: ResolvedYpiStudioMemberPolicy): string[] {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (policy.modelArg) args.push("--model", policy.modelArg);
  if (policy.thinkingArg) args.push("--thinking", policy.thinkingArg);
  return args;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (!isObj(block)) return "";
    if (block.type === "text" && typeof block.text === "string") return block.text;
    if (block.type === "thinking" && typeof block.thinking === "string") return "";
    return "";
  }).join("");
}

function resultText(result: unknown): string {
  if (!isObj(result)) return "";
  return contentText(result.content);
}

function eventMessageText(event: unknown): string {
  if (!isObj(event) || !isObj(event.message)) return "";
  return contentText(event.message.content);
}

function eventAssistantDeltaText(event: unknown): string {
  if (!isObj(event) || !isObj(event.assistantMessageEvent)) return "";
  const delta = event.assistantMessageEvent;
  if (typeof delta.delta === "string") return delta.delta;
  if (typeof delta.content === "string") return delta.content;
  return "";
}

function isBlockingExtensionUiRequest(event: unknown): boolean {
  if (!isObj(event) || event.type !== "extension_ui_request") return false;
  return event.method === "select" || event.method === "confirm" || event.method === "input" || event.method === "editor";
}

function extensionUiRequestText(event: unknown): string {
  if (!isObj(event)) return "Child requested user input.";
  const method = str(event.method) ?? "input";
  const title = str(event.title);
  const message = str(event.message);
  const placeholder = str(event.placeholder);
  const options = Array.isArray(event.options) ? event.options.filter((item): item is string => typeof item === "string").join(", ") : undefined;
  return [
    `Child Studio member is waiting for user ${method} input.`,
    title ? `Title: ${title}` : undefined,
    message ? `Message: ${message}` : undefined,
    placeholder ? `Placeholder: ${placeholder}` : undefined,
    options ? `Options: ${options}` : undefined,
  ].filter(Boolean).join("\n");
}

interface ChildRunMeta {
  runId: string;
  taskId: string;
  member: string;
  startedAt: string;
  parentSessionId?: string;
}


interface ChildPiResult {
  output: string;
  status: YpiStudioTaskSubagentRun["status"];
  transcript?: YpiStudioSubagentTranscriptRef;
  warnings: string[];
  progress: YpiStudioSubagentRunProgress;
}

function runChildPi(
  root: string,
  prompt: string,
  policy: ResolvedYpiStudioMemberPolicy,
  meta: ChildRunMeta,
  writer: YpiStudioSubagentTranscriptWriter | null,
  signal?: AbortSignal,
  onUpdate?: ToolUpdateCallback,
): Promise<ChildPiResult> {
  return new Promise((resolveResult) => {
    const inv = resolvePiCli();
    const child = spawn(inv.command, [...inv.args, ...buildPiArgs(policy)], {
      cwd: root,
      env: { ...process.env, YPI_STUDIO_SUBAGENT_CHILD: "1", TRELLIS_SUBAGENT_CHILD: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const decoder = new StringDecoder("utf8");
    const recentItems: YpiStudioSubagentTranscriptItem[] = [];
    const warnings: string[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTail = "";
    let stderrTail = "";
    let eventCount = 0;
    let phase: YpiStudioSubagentRunPhase = "starting";
    let outputChars = 0;
    let tokens: number | undefined;
    let tokenSource: YpiStudioSubagentRunProgress["tokenSource"] | undefined;
    let firstTokenAt: string | undefined;
    let lastTokenAt: string | undefined;
    let currentTool: YpiStudioSubagentCurrentTool | undefined;
    let lastMessageTextTail = "";
    let lastTextPreview = "Child Pi process started. Waiting for first JSON event…";
    let finalAssistantOutput = "";
    let status: YpiStudioTaskSubagentRun["status"] = "running";
    let terminationReason: string | undefined;
    let settled = false;
    let terminating = false;
    let lastUpdateAt = 0;
    let lastActivityAt = Date.now();
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const markActivity = (): void => {
      lastActivityAt = Date.now();
    };

    const addWarning = (warning: string): void => {
      if (!warnings.includes(warning)) warnings.push(warning);
    };

    const boundedText = (value: string, maxBytes = MAX_CHILD_LIVE_PREVIEW_BYTES): string => truncateBytes(value, maxBytes).text;

    const schedule = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
      return timer;
    };

    const killChild = (signalName: NodeJS.Signals = "SIGTERM"): void => {
      if (!child.pid) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signalName);
        else child.kill(signalName);
      } catch {
        try { child.kill(signalName); } catch {}
      }
    };

    const forceKillWindows = (): void => {
      if (process.platform !== "win32" || !child.pid) return;
      try {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => {});
      } catch {}
    };

    const appendItem = (item: YpiStudioSubagentTranscriptItem): void => {
      let stored = item;
      if (writer) {
        try {
          stored = appendYpiStudioSubagentTranscriptItem(writer, item);
        } catch (error) {
          addWarning(`Transcript write failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      recentItems.push(stored);
      if (recentItems.length > 24) recentItems.shift();
    };

    const safeRecentItems = (): YpiStudioSubagentTranscriptItem[] => recentItems.slice(-12).map((item) => {
      if (item.kind === "tool_call") {
        const preview = truncateBytes(item.inputPreview, MAX_CHILD_LIVE_PREVIEW_BYTES);
        return { ...item, inputPreview: preview.text, truncated: item.truncated || preview.truncated };
      }
      if ("text" in item) {
        const preview = truncateBytes(item.text, MAX_CHILD_LIVE_PREVIEW_BYTES);
        return { ...item, text: preview.text, truncated: ("truncated" in item ? item.truncated : false) || preview.truncated } as YpiStudioSubagentTranscriptItem;
      }
      return item;
    });

    const progressSnapshot = (): YpiStudioSubagentRunProgress => {
      const updatedAt = new Date().toISOString();
      const elapsedSeconds = firstTokenAt && lastTokenAt ? Math.max(0.001, (Date.parse(lastTokenAt) - Date.parse(firstTokenAt)) / 1000) : undefined;
      return {
        schemaVersion: 1,
        phase,
        startedAt: meta.startedAt,
        updatedAt,
        eventCount,
        lastTextPreview: boundedText(lastTextPreview),
        itemsPreview: safeRecentItems(),
        warnings: warnings.length ? warnings.slice(-8) : undefined,
        outputChars,
        tokens,
        tokenSource,
        tps: tokens !== undefined && elapsedSeconds ? Number((tokens / elapsedSeconds).toFixed(2)) : undefined,
        firstTokenAt,
        lastTokenAt,
        currentTool,
      };
    };

    const progressPayload = (): PiToolResult => {
      const progress = progressSnapshot();
      const transcript = writer ? { ...writer.ref } : undefined;
      return {
        content: [{ type: "text", text: `${meta.member} ${status} · model: ${policy.modelLabel} · thinking: ${policy.thinkingLabel} · ${eventCount} events · ${oneLine(progress.lastTextPreview, 140)}` }],
        details: {
          run: {
            id: meta.runId,
            member: meta.member,
            status,
            taskId: meta.taskId,
            model: policy.modelLabel,
            thinking: policy.thinkingLabel,
            modelSource: policy.modelSource,
            thinkingSource: policy.thinkingSource,
            policy: policy.diagnostics,
            transcript,
            progress,
          },
        },
      };
    };

    const emitProgress = (force = false): void => {
      if (!onUpdate) return;
      const now = Date.now();
      const send = () => {
        lastUpdateAt = Date.now();
        updateTimer = null;
        try {
          onUpdate(progressPayload());
        } catch (error) {
          addWarning(`Progress update failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      if (force || now - lastUpdateAt >= 450) {
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = null;
        }
        send();
      } else if (!updateTimer) {
        updateTimer = setTimeout(send, 450 - (now - lastUpdateAt));
      }
    };

    const terminateChild = (reason: string, nextStatus: YpiStudioTaskSubagentRun["status"] = "failed"): void => {
      if (settled) return;
      terminationReason ??= reason;
      if (status === "running") status = nextStatus;
      phase = status === "waiting_for_user" ? "waiting_for_user" : "finished";
      currentTool = undefined;
      const text = reason === "parent_abort" || reason === "session_destroy" || reason === "abort_signal"
        ? "Child Pi run cancelled by parent session."
        : `Child Pi run terminated: ${reason}.`;
      lastTextPreview = text;
      addWarning(text);
      appendItem({ kind: nextStatus === "failed" ? "error" : "status", at: new Date().toISOString(), text });
      emitProgress(true);
      if (!terminating) {
        terminating = true;
        killChild("SIGTERM");
        schedule(() => {
          if (settled) return;
          if (process.platform === "win32") forceKillWindows();
          killChild("SIGKILL");
        }, CHILD_KILL_GRACE_MS);
        schedule(() => {
          if (settled) return;
          addWarning("Child Pi process did not emit close after termination; resolving parent run with the recorded cancellation/failure state.");
          finish(null);
        }, CHILD_KILL_GRACE_MS + 5_000);
      }
    };

    const noteOutput = (text: string, at: string): void => {
      if (!text) return;
      outputChars += text.length;
      tokens = Math.max(tokens ?? 0, Math.ceil(outputChars / 4));
      tokenSource = tokenSource === "usage" ? "usage" : "estimated_chars";
      firstTokenAt ??= at;
      lastTokenAt = at;
    };

    const usageOutputTokens = (event: unknown): number | undefined => {
      if (!isObj(event)) return undefined;
      const usage = isObj(event.usage) ? event.usage : isObj(event.message) && isObj(event.message.usage) ? event.message.usage : undefined;
      const value = usage ? usage.outputTokens ?? usage.output_tokens ?? usage.output ?? usage.completion_tokens : undefined;
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
    };

    const rememberAssistantOutput = (text: string): string => {
      const truncated = truncateBytes(text, MAX_CHILD_FINAL_OUTPUT_BYTES);
      if (truncated.truncated) addWarning(`Assistant output exceeded ${MAX_CHILD_FINAL_OUTPUT_BYTES} bytes and was truncated.`);
      finalAssistantOutput = truncated.text;
      return truncated.text;
    };

    const parseLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      markActivity();
      const at = new Date().toISOString();
      let event: unknown;
      try {
        event = JSON.parse(trimmed) as unknown;
      } catch {
        const preview = boundedText(trimmed);
        lastTextPreview = preview;
        appendItem({ kind: "status", at, text: `Non-JSON stdout: ${preview}`, truncated: preview.length < trimmed.length });
        emitProgress();
        return;
      }
      eventCount += 1;
      const eventType = isObj(event) && typeof event.type === "string" ? event.type : "json";
      if (eventType === "agent_start") {
        phase = "waiting_model";
        lastTextPreview = "Agent started.";
        appendItem({ kind: "status", at, text: "Child Pi agent started." });
      } else if (eventType === "agent_end") {
        phase = "finished";
        lastTextPreview = "Agent finished.";
        appendItem({ kind: "status", at, text: "Child Pi agent finished." });
      } else if (eventType === "message_update") {
        phase = "streaming";
        const delta = eventAssistantDeltaText(event);
        const text = delta || eventMessageText(event);
        if (text) {
          const addition = delta || (text.startsWith(lastMessageTextTail) ? text.slice(lastMessageTextTail.length) : text);
          lastMessageTextTail = boundedAppendTail("", text, MAX_CHILD_TAIL_BYTES);
          noteOutput(addition, at);
          lastTextPreview = boundedText(addition || text);
        }
      } else if (eventType === "message_end") {
        const text = eventMessageText(event).trim();
        const role = isObj(event) && isObj(event.message) && typeof event.message.role === "string" ? event.message.role : undefined;
        if (role === "assistant" && text) {
          phase = "waiting_model";
          const output = rememberAssistantOutput(text);
          lastTextPreview = output;
          outputChars = Math.max(outputChars, text.length);
          const usageTokens = usageOutputTokens(event);
          if (usageTokens !== undefined) {
            tokens = usageTokens;
            tokenSource = "usage";
          } else {
            tokens = Math.max(tokens ?? 0, Math.ceil(outputChars / 4));
            tokenSource = tokenSource ?? "estimated_chars";
          }
          lastMessageTextTail = boundedAppendTail("", text, MAX_CHILD_TAIL_BYTES);
          appendItem({ kind: "assistant", at, text: output, model: policy.modelLabel, truncated: output.length < text.length });
        }
      } else if (eventType === "tool_execution_start") {
        const ev = isObj(event) ? event : {};
        const toolCallId = str(ev.toolCallId) ?? `tool-${eventCount}`;
        const toolName = str(ev.toolName) ?? "tool";
        const preview = previewYpiStudioTranscriptText(ev.args).text;
        phase = "running_tool";
        currentTool = { toolCallId, toolName, startedAt: at };
        lastTextPreview = `Running tool ${toolName}`;
        appendItem({ kind: "tool_call", at, toolCallId, toolName, inputPreview: preview });
      } else if (eventType === "tool_execution_update") {
        phase = "running_tool";
        const text = resultText(isObj(event) ? event.partialResult : undefined).trim();
        if (text) lastTextPreview = boundedText(text);
      } else if (eventType === "tool_execution_end" || eventType === "tool_result_end") {
        const ev = isObj(event) ? event : {};
        const toolCallId = str(ev.toolCallId) ?? `tool-${eventCount}`;
        const toolName = str(ev.toolName) ?? undefined;
        const rawText = resultText(ev.result).trim() || resultText(ev.message).trim() || "(no output)";
        const text = boundedText(rawText, MAX_CHILD_FINAL_OUTPUT_BYTES);
        const isError = ev.isError === true;
        phase = "waiting_model";
        currentTool = undefined;
        lastTextPreview = `${toolName ?? "Tool"} ${isError ? "failed" : "completed"}`;
        appendItem({ kind: "tool_result", at, toolCallId, toolName, text, isError, truncated: text.length < rawText.length });
      } else if (eventType === "extension_ui_request" && isBlockingExtensionUiRequest(event)) {
        const text = extensionUiRequestText(event);
        status = "waiting_for_user";
        phase = "waiting_for_user";
        rememberAssistantOutput(text);
        lastTextPreview = text;
        addWarning("Child Studio member requested interactive user input; surfaced to parent session instead of waiting indefinitely.");
        appendItem({ kind: "assistant", at, text, model: policy.modelLabel });
        emitProgress(true);
        terminateChild("waiting_for_user", "waiting_for_user");
      } else if (eventType === "extension_error") {
        const message = isObj(event) && typeof event.error === "string" ? event.error : safeJson(event);
        lastTextPreview = boundedText(message);
        appendItem({ kind: "error", at, text: boundedText(message, MAX_CHILD_FINAL_OUTPUT_BYTES) });
      } else if (eventType !== "response") {
        lastTextPreview = `Received ${eventType}.`;
      }
      emitProgress();
    };

    const flushStdoutLines = (chunk: Buffer): void => {
      if (settled) return;
      markActivity();
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CHILD_STDOUT_BYTES) {
        terminateChild("stdout_output_limit", "failed");
        return;
      }
      const text = decoder.write(chunk);
      stdoutTail = boundedAppendTail(stdoutTail, text, MAX_CHILD_TAIL_BYTES);
      stdoutBuffer += text;
      if (byteLength(stdoutBuffer) > MAX_CHILD_STDOUT_LINE_BYTES) {
        stdoutBuffer = "";
        terminateChild("stdout_line_limit", "failed");
        return;
      }
      while (true) {
        const idx = stdoutBuffer.indexOf("\n");
        if (idx < 0) break;
        const line = stdoutBuffer.slice(0, idx).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        parseLine(line);
      }
    };

    const finish = (code: number | null, errorMessage?: string) => {
      if (settled) return;
      settled = true;
      unregisterYpiStudioChildRun(meta.runId);
      if (updateTimer) clearTimeout(updateTimer);
      if (idleTimer) clearTimeout(idleTimer);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      signal?.removeEventListener("abort", abort);
      const tail = decoder.end();
      if (tail) stdoutBuffer += tail;
      if (stdoutBuffer.trim() && byteLength(stdoutBuffer) <= MAX_CHILD_STDOUT_LINE_BYTES) parseLine(stdoutBuffer);
      stdoutBuffer = "";
      if (errorMessage) {
        status = "failed";
        phase = "finished";
        appendItem({ kind: "error", at: new Date().toISOString(), text: boundedText(errorMessage, MAX_CHILD_FINAL_OUTPUT_BYTES) });
      } else if (status !== "cancelled" && status !== "waiting_for_user" && status !== "failed") {
        status = code === 0 ? "succeeded" : "failed";
      }
      phase = status === "waiting_for_user" ? "waiting_for_user" : "finished";
      currentTool = undefined;
      const fallbackOutput = stdoutTail.trim() || stderrTail.trim();
      const output = (finalAssistantOutput.trim() || boundedText(fallbackOutput, MAX_CHILD_FINAL_OUTPUT_BYTES).trim() || (status === "cancelled" ? "cancelled" : "(no output)"));
      if (terminationReason) {
        const reason = terminationReason;
        if (!warnings.some((warning) => warning.includes(reason))) addWarning(`Termination reason: ${reason}`);
      }
      if (output && !finalAssistantOutput.trim()) {
        appendItem({ kind: status === "failed" ? "error" : "assistant", at: new Date().toISOString(), text: output });
      }
      let transcript: YpiStudioSubagentTranscriptRef | undefined;
      if (writer) {
        try {
          transcript = finalizeYpiStudioSubagentTranscript(writer, status);
        } catch (error) {
          addWarning(`Transcript finalize failed: ${error instanceof Error ? error.message : String(error)}`);
          transcript = { ...writer.ref, status };
        }
      }
      lastTextPreview = output;
      if (output && outputChars === 0) {
        outputChars = output.length;
        tokens = Math.ceil(outputChars / 4);
        tokenSource = "estimated_chars";
      }
      emitProgress(true);
      resolveResult({ output, status, transcript, warnings, progress: progressSnapshot() });
    };

    const abort = () => terminateChild("abort_signal", "cancelled");

    registerYpiStudioChildRun({
      runId: meta.runId,
      taskId: meta.taskId,
      member: meta.member,
      cwd: root,
      parentSessionId: meta.parentSessionId,
      pid: child.pid,
      startedAt: meta.startedAt,
      abort: (reason) => terminateChild(reason, "cancelled"),
    });

    signal?.addEventListener("abort", abort, { once: true });
    appendItem({ kind: "status", at: meta.startedAt, text: "Child Pi process starting." });
    emitProgress(true);
    child.stdout?.on("data", flushStdoutLines);
    child.stderr?.on("data", (chunk: Buffer) => {
      if (settled) return;
      markActivity();
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CHILD_STDERR_BYTES) {
        stderrTail = boundedAppendTail(stderrTail, chunk.toString("utf8"), MAX_CHILD_TAIL_BYTES);
        terminateChild("stderr_output_limit", "failed");
        return;
      }
      const text = chunk.toString("utf8");
      stderrTail = boundedAppendTail(stderrTail, text, MAX_CHILD_TAIL_BYTES);
      lastTextPreview = boundedText(text.trim() || `${stderrBytes} stderr bytes`);
      appendItem({ kind: "stderr", at: new Date().toISOString(), text: boundedText(text, MAX_CHILD_FINAL_OUTPUT_BYTES), truncated: byteLength(text) > MAX_CHILD_FINAL_OUTPUT_BYTES });
      emitProgress();
    });
    child.on("error", (error) => finish(1, error instanceof Error ? error.message : String(error)));
    child.on("close", (code) => finish(code));

    schedule(() => {
      if (settled || eventCount > 0) return;
      addWarning("Child Pi produced no JSON events for 60 seconds.");
      lastTextPreview = "Child Pi has not produced JSON events yet.";
      appendItem({ kind: "status", at: new Date().toISOString(), text: lastTextPreview });
      emitProgress(true);
    }, CHILD_NO_FIRST_EVENT_WARN_MS);
    schedule(() => terminateChild("max_runtime", "failed"), CHILD_MAX_RUNTIME_MS);
    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (Date.now() - lastActivityAt >= CHILD_IDLE_TIMEOUT_MS) terminateChild("idle_timeout", "failed");
        else resetIdleTimer();
      }, CHILD_IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();

    child.stdin?.end(prompt);
  });
}

function sendStudioStartPrompt(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  args: string,
  workflowId?: "feature-dev" | "bugfix" | "ui-change",
): void {
  const goal = args.trim() || "请根据我接下来的说明创建工作室任务。";
  const workflowLine = workflowId
    ? `1. 如无 active Studio task，调用 ypi_studio_task(action=create, workflowId=${workflowId}) 创建任务。`
    : "1. 如无 active Studio task，调用 ypi_studio_task(action=create) 创建任务；根据目标选择 feature-dev / bugfix / ui-change / review-only。";
  pi.sendUserMessage([
    "启动蛋黄派工作室流程。",
    "",
    `目标：${goal}`,
    "",
    "请按 YPI Studio 状态机执行：",
    workflowLine,
    "2. 接单和设计阶段使用 ypi_studio_subagent(member=architect) 指派架构师。",
    "3. 涉及界面时使用 ypi_studio_subagent(member=ui-designer)。",
    "4. 方案稳定后只切到 awaiting_approval；本轮必须停止，向我展示 PRD/Design/Implement/Checks 摘要并请求确认或修改意见。",
    "5. 未收到后续用户明确确认前，不得进入 implementing，不得调用 implementer；确认后先领取一个 ready implementation subtask，再通过 ypi_studio_subagent(member=implementer, subtaskId=...) 逐项指派。"
  ].join("\n"));
}

function buildMemberPrompt(root: string, taskId: string, member: string, delegatedPrompt: string, subtaskId?: string): string {
  const definition = readText(join(root, ".ypi", "agents", memberFile(member)));
  if (!definition.trim()) throw new Error(`Studio member definition not found: .ypi/agents/${memberFile(member)}`);
  const taskContext = getYpiStudioTaskContextForPrompt(root, taskId);
  const knowledge = getYpiStudioKnowledgeContextForPrompt(root, [taskContext.slice(0, 1200), member, delegatedPrompt].join(" "), { maxEntries: 3, maxTotalChars: 2600 });
  const detail = getYpiStudioTaskDetail(root, taskId);
  const selectedPlan = subtaskId && detail?.implementationPlan ? detail.implementationPlan.subtasks.find((item) => item.id === subtaskId) : null;
  const selectedProgress = subtaskId ? detail?.implementationProgress?.subtasks[subtaskId] : undefined;
  const implementationBlock = detail?.implementationPlan ? [
    "## Implementation Plan Boundary",
    `Plan summary: ${detail.implementationPlan.summary ?? "(no summary)"}`,
    `Progress: ${detail.implementation?.done ?? 0}/${detail.implementation?.total ?? detail.implementationPlan.subtasks.length} done; active=${detail.implementation?.activeSubtaskId ?? "none"}; next=${detail.implementation?.nextSubtaskId ?? "none"}; blocked=${detail.implementation?.blocked ?? 0}`,
    subtaskId ? `Assigned subtaskId: ${subtaskId}` : "Assigned subtaskId: none",
    selectedPlan ? `Selected subtask JSON:\n${safeJson({ plan: selectedPlan, progress: selectedProgress })}` : "No selected subtask was found in the plan.",
    member === "implementer" && subtaskId ? "Implementer rule: execute only the selected subtask boundary. Do not implement unrelated subtasks." : "",
    member === "implementer" && !subtaskId ? "Implementer rule: because this task has an implementation plan but no subtaskId was assigned, do not implement the full task. Report blocked and ask the parent session to claim/select one subtask." : "",
    member === "checker" && subtaskId ? "Checker rule: perform a local review for the selected subtask first, then report verdict and evidence." : "",
  ].filter(Boolean).join("\n") : "## Implementation Plan Boundary\nNo implementation plan is saved for this task.";
  return [
    "# YPI Studio Member Delegation",
    "You are already running as the delegated YPI Studio member below. Do not dispatch another Studio member or subagent unless the parent explicitly asks.",
    "Do not commit, push, or merge. Respect the active task state and report blockers instead of guessing product decisions.",
    "YPI Studio member mode only: ignore Trellis workflow-state, Trellis SessionStart context, task.py current instructions, or Trellis task constraints unless the parent explicitly asks for Trellis.",
    "",
    "## Member Definition",
    definition,
    "",
    taskContext,
    "",
    implementationBlock,
    "",
    knowledge,
    knowledge ? "" : "",
    "## Delegated Task",
    delegatedPrompt,
    "",
    "Return a concise handoff with files changed or artifacts produced, validation run, remaining risks, and decisions needed from the main session.",
  ].join("\n");
}

export function createYpiStudioExtension(workspaceRoot: string) {
  return function ypiStudioExtension(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand" | "sendUserMessage" | "on" | "getThinkingLevel">): void {
  if (process.env.YPI_STUDIO_SUBAGENT_CHILD === "1") return;

  const root = findRoot(workspaceRoot);
  const procKey = `pi_process_${hash([root, process.pid, Date.now(), randomBytes(8).toString("hex")].join(":"))}`;
  let currentKey: string | null = null;
  const startupKeys = new Set<string>();

  const getKey = (input?: unknown, ctx?: PiExtensionContext) => {
    const key = contextKey(input, ctx) ?? currentKey ?? procKey;
    currentKey = key;
    return key;
  };

  pi.registerCommand("studio-init", {
    description: "Initialize or backfill YPI Studio members and workflows",
    handler: async (_args, ctx) => {
      const agents = initializeYpiStudioAgents(root);
      const workflows = initializeYpiStudioWorkflows(root);
      const warningSuffix = agents.warnings.length > 0 ? `, ${agents.warnings.length} custom members need review` : "";
      ctx.ui.notify?.(`YPI Studio initialized: ${agents.created.length} members created, ${agents.updated.length} members updated, ${workflows.created.length} workflows created${warningSuffix}.`, "info");
    },
  });

  pi.registerCommand("studio-start", {
    description: "Start a structured YPI Studio workflow task",
    handler: async (args) => {
      sendStudioStartPrompt(pi, args);
    },
  });

  pi.registerCommand("studio-feature", {
    description: "Start a YPI Studio feature development task",
    handler: async (args) => {
      sendStudioStartPrompt(pi, args, "feature-dev");
    },
  });

  pi.registerCommand("studio-bugfix", {
    description: "Start a YPI Studio bugfix task",
    handler: async (args) => {
      sendStudioStartPrompt(pi, args, "bugfix");
    },
  });

  pi.registerCommand("studio-ui", {
    description: "Start a YPI Studio UI-change task",
    handler: async (args) => {
      sendStudioStartPrompt(pi, args, "ui-change");
    },
  });

  pi.registerCommand("studio-continue", {
    description: "Continue the active YPI Studio task",
    handler: async () => {
      pi.sendUserMessage("继续当前蛋黄派工作室任务。请先调用 ypi_studio_task(action=current) 或读取注入的 <ypi-studio-state>，确认当前 task、workflow、status、owner、缺失产物和下一步。需要成员工作时必须使用 ypi_studio_subagent；等待确认状态不得直接实现。");
    },
  });

  pi.registerCommand("studio-check", {
    description: "Ask the YPI Studio checker to review the active task or diff",
    handler: async (args) => {
      const focus = args.trim() || "需求覆盖、代码质量、验证结果、回归风险";
      pi.sendUserMessage(`让蛋黄派工作室检查员审查当前任务或当前改动。检查重点：${focus}\n\n请先确认当前 Studio task。如果没有任务，询问是否创建 review-only 工作流任务。已有任务时，必要时将状态切到 checking，然后使用 ypi_studio_subagent(member=checker) 指派检查员。`);
    },
  });

  pi.registerCommand("studio-archive", {
    description: "Archive the completed active YPI Studio task and distill reusable knowledge",
    handler: async (args) => {
      const reason = args.trim();
      pi.sendUserMessage([
        "归档当前蛋黄派工作室任务，并沉淀可复用知识。",
        reason ? `归档原因：${reason}` : "归档原因：用户请求归档。",
        "",
        "请严格执行：",
        "1. 调用 ypi_studio_task(action=current) 确认当前绑定任务，只有 status=completed 才能继续；未完成则提示先完成或取消，不要归档。",
        "2. 基于返回的任务 artifacts/documents，用当前 session 模型整理短知识摘要：summary 控制在 1000 字以内，markdown 包含 Summary、Reusable knowledge、Source artifacts。",
        "3. 调用 ypi_studio_task(action=archive, reason, knowledgeSummary, knowledgeMarkdown, tags) 完成持久化。",
        "4. 回复归档任务路径和知识文件路径。",
      ].join("\n"));
    },
  });

  pi.registerTool?.({
    name: "ypi_studio_task",
    label: "YPI Studio Task",
    description: "Manage structured YPI Studio workflows and tasks for the current project.",
    promptSnippet: "Use ypi_studio_task to initialize workflows, create/bind/read Studio tasks, transition states, and update artifacts.",
    promptGuidelines: [
      "Use ypi_studio_task before doing non-trivial YPI Studio work; do not invent task state outside .ypi/tasks/task.json.",
      "After design/planning artifacts are ready, transition only to awaiting_approval, stop, and ask the user to confirm or request changes.",
      "The awaiting_approval -> implementing edge has a server-side approval gate; override cannot bypass it. Do not call implementer until a later explicit user approval has been recorded.",
      "For tasks with implementationPlan, save the plan before awaiting_approval, and during implementing claim exactly one ready subtask before dispatching implementer with subtaskId.",
    ],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["init_workflows", "create", "current", "get", "transition", "update_artifact", "archive", "update_implementation_plan", "implementation_next", "claim_implementation_subtask", "update_implementation_subtask"] },
        title: { type: "string" },
        workflowId: { type: "string" },
        taskId: { type: "string" },
        to: { type: "string" },
        reason: { type: "string" },
        artifact: { type: "string" },
        content: { type: "string" },
        override: { type: "boolean" },
        scope: { type: "string", enum: ["active", "archived", "all"] },
        tags: { type: "array", items: { type: "string" } },
        knowledgeSummary: { type: "string" },
        knowledgeMarkdown: { type: "string" },
        implementationPlan: { type: "object" },
        subtaskId: { type: "string" },
        status: { type: "string", enum: ["pending", "ready", "running", "blocked", "done", "skipped"] },
        runId: { type: "string" },
        validation: { type: "array", items: { type: "string" } },
        blockedReason: { type: "string" },
        skippedReason: { type: "string" },
        localReview: { type: "object" },
      },
    },
    execute: async (_id: string, inputValue: unknown, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: PiExtensionContext): Promise<PiToolResult> => {
      const input = normalizeTaskToolInput(inputValue);
      const key = getKey(input, ctx);
      const action = input.action ?? "current";
      try {
        if (action === "init_workflows") {
          const result = initializeYpiStudioWorkflows(root);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
        }
        if (action === "create") {
          const title = str(input.title);
          if (!title) throw new Error("title is required for create");
          const task = createYpiStudioTask({ cwd: root, title, workflowId: str(input.workflowId) ?? undefined, contextId: key });
          return { content: [{ type: "text", text: `Created YPI Studio task ${task.id} (${task.status}).` }], details: { task } };
        }
        if (action === "get") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const task = getYpiStudioTaskDetail(root, taskId);
          if (!task) throw new Error("Task not found");
          return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }], details: { task } };
        }
        if (action === "transition") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const to = str(input.to);
          if (!to) throw new Error("to is required for transition");
          const task = transitionYpiStudioTask(taskId, { cwd: root, to, reason: str(input.reason) ?? undefined, contextId: key, override: input.override === true });
          return { content: [{ type: "text", text: `Transitioned YPI Studio task ${task.id} to ${task.status}.` }], details: { task } };
        }
        if (action === "update_artifact") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const artifact = str(input.artifact);
          if (!artifact) throw new Error("artifact is required for update_artifact");
          const task = updateYpiStudioTaskArtifact(taskId, { cwd: root, artifact, content: input.content ?? "", contextId: key });
          return { content: [{ type: "text", text: `Updated YPI Studio artifact ${artifact} for ${task.id}.` }], details: { task } };
        }
        if (action === "update_implementation_plan") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          if (!input.implementationPlan) throw new Error("implementationPlan is required for update_implementation_plan");
          const task = updateYpiStudioImplementationPlan(taskId, { cwd: root, action: "update_implementation_plan", implementationPlan: input.implementationPlan, contextId: key });
          return { content: [{ type: "text", text: `Updated implementation plan for ${task.id}: ${task.implementation?.total ?? 0} subtasks.` }], details: { task } };
        }
        if (action === "implementation_next") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const result = getNextYpiStudioImplementationSubtask(root, taskId);
          return { content: [{ type: "text", text: result.subtask ? `Next implementation subtask: ${result.subtask.id} · ${result.subtask.title}` : "No ready implementation subtask is available." }], details: result };
        }
        if (action === "claim_implementation_subtask") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const task = claimYpiStudioImplementationSubtask(taskId, { cwd: root, action: "claim_implementation_subtask", subtaskId: input.subtaskId, runId: input.runId, message: input.reason, contextId: key });
          return { content: [{ type: "text", text: `Claimed implementation subtask ${task.implementationProgress?.activeSubtaskId ?? input.subtaskId ?? "unknown"} for ${task.id}.` }], details: { task, subtaskId: task.implementationProgress?.activeSubtaskId } };
        }
        if (action === "update_implementation_subtask") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const subtaskId = str(input.subtaskId);
          if (!subtaskId || !input.status) throw new Error("subtaskId and status are required for update_implementation_subtask");
          const task = updateYpiStudioImplementationSubtask(taskId, { cwd: root, action: "update_implementation_subtask", subtaskId, status: input.status, runId: input.runId, message: input.reason, validation: input.validation, blockedReason: input.blockedReason, skippedReason: input.skippedReason, localReview: input.localReview, contextId: key });
          return { content: [{ type: "text", text: `Implementation subtask ${subtaskId} -> ${input.status}.` }], details: { task, subtaskId } };
        }
        if (action === "archive") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const result = archiveYpiStudioTask(taskId, {
            cwd: root,
            reason: str(input.reason) ?? undefined,
            contextId: key,
            knowledgeSummary: input.knowledgeSummary,
            knowledgeMarkdown: input.knowledgeMarkdown,
            tags: input.tags,
            allowFallbackKnowledge: !input.knowledgeSummary || !input.knowledgeMarkdown,
          });
          const warningText = result.warnings?.length ? ` Warnings: ${result.warnings.join("; ")}` : "";
          return { content: [{ type: "text", text: `Archived YPI Studio task ${result.task.id}. Knowledge: ${result.knowledge.knowledgePath}.${warningText}` }], details: result };
        }
        const current = getCurrentYpiStudioTaskDetail(root, key);
        const payload = current ? { task: current } : { task: null, tasks: listYpiStudioTasks(root, { scope: input.scope ?? "active" }).tasks.slice(0, 8) };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
      }
    },
  });

  pi.registerTool?.({
    name: "ypi_studio_subagent",
    label: "YPI Studio Subagent",
    description: "Dispatch a YPI Studio member as a child Pi process with the active Studio task context.",
    promptSnippet: "Use ypi_studio_subagent to assign Studio role work to architect, ui-designer, implementer, or checker.",
    promptGuidelines: [
      "Use ypi_studio_subagent when assigning YPI Studio member work. The main session orchestrates; members execute their role.",
      "Do not pass model/thinking unless the user explicitly asks to override Studio Settings for this member run.",
      "When dispatching implementer for a task with implementationPlan, pass subtaskId for exactly one claimed subtask; without subtaskId the implementer must not perform full implementation.",
    ],
    parameters: {
      type: "object",
      properties: {
        member: { type: "string", description: "architect, ui-designer, implementer, checker, or a custom .ypi/agents member id" },
        prompt: { type: "string" },
        taskId: { type: "string" },
        subtaskId: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh"] },
      },
      required: ["member", "prompt"],
    },
    execute: async (_id: string, inputValue: unknown, signal?: AbortSignal, onUpdate?: ToolUpdateCallback, ctx?: PiExtensionContext): Promise<PiToolResult> => {
      const input = normalizeSubagentInput(inputValue);
      const key = getKey(input, ctx);
      const requestedMember = str(input.member);
      const prompt = str(input.prompt);
      if (!requestedMember || !prompt) return { content: [{ type: "text", text: "member and prompt are required" }], details: { error: "member and prompt are required" }, isError: true };
      try {
        const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
        const configResult = readPiWebConfigForApi();
        const policy = resolveYpiStudioMemberPolicy({ input, configResult, main: { model: ctx?.model, thinking: currentThinking(pi) } });
        const member = policy.member;
        const startedAt = new Date().toISOString();
        const runId = `${member}-${hash(`${taskId}:${startedAt}:${prompt}`)}`;
        const subtaskId = str(input.subtaskId) ?? undefined;
        const taskDetail = getYpiStudioTaskDetail(root, taskId);
        if (!taskDetail) throw new Error("Task not found");
        if (subtaskId && taskDetail.implementationPlan && !taskDetail.implementationPlan.subtasks.some((item) => item.id === subtaskId)) {
          throw new Error(`Unknown implementation subtask: ${subtaskId}`);
        }
        const childPrompt = buildMemberPrompt(root, taskId, member, prompt, subtaskId);
        let writer: YpiStudioSubagentTranscriptWriter | null = null;
        const warnings: string[] = [];
        try {
          writer = createYpiStudioSubagentTranscript(root, taskId, { runId, member, startedAt });
          appendYpiStudioSubagentTranscriptItem(writer, { kind: "prompt", at: startedAt, text: prompt });
        } catch (error) {
          warnings.push(`Transcript capture unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
        const runningRun: YpiStudioTaskSubagentRun = {
          id: runId,
          member,
          subtaskId,
          status: "running",
          startedAt,
          prompt: oneLine(prompt, 240),
          summary: "Child Pi process starting.",
          model: policy.modelLabel,
          thinking: policy.thinkingLabel,
          modelSource: policy.modelSource,
          thinkingSource: policy.thinkingSource,
          policy: policy.diagnostics,
          progress: {
            schemaVersion: 1,
            phase: "starting",
            startedAt,
            updatedAt: startedAt,
            eventCount: 0,
            lastTextPreview: "Child Pi process starting.",
            itemsPreview: writer ? [{ kind: "prompt", at: startedAt, text: prompt }] : [],
            warnings: [...policy.warnings, ...warnings],
          },
          transcript: writer ? { ...writer.ref } : undefined,
        };
        recordYpiStudioSubagentRun(root, taskId, runningRun);
        onUpdate?.({
          content: [{ type: "text", text: `${member} running · model: ${policy.modelLabel} · thinking: ${policy.thinkingLabel} · child process starting` }],
          details: {
            run: {
              id: runId,
              member,
              subtaskId,
              status: "running",
              taskId,
              model: policy.modelLabel,
              thinking: policy.thinkingLabel,
              modelSource: policy.modelSource,
              thinkingSource: policy.thinkingSource,
              policy: policy.diagnostics,
              transcript: writer ? { ...writer.ref } : undefined,
              progress: {
                schemaVersion: 1,
                phase: "starting",
                startedAt,
                updatedAt: startedAt,
                eventCount: 0,
                lastTextPreview: "Child Pi process starting.",
                itemsPreview: writer ? [{ kind: "prompt", at: startedAt, text: prompt }] : [],
                warnings: [...policy.warnings, ...warnings],
              } satisfies YpiStudioSubagentRunProgress,
            },
          },
        });
        const result = await runChildPi(root, childPrompt, policy, { runId, taskId, member, startedAt, parentSessionId: callStr(ctx?.sessionManager?.getSessionId) ?? undefined }, writer, signal, onUpdate);
        const finishedAt = new Date().toISOString();
        const allWarnings = [...policy.warnings, ...warnings, ...result.warnings];
        const run: YpiStudioTaskSubagentRun = {
          id: runId,
          member,
          subtaskId,
          status: result.status,
          startedAt,
          finishedAt,
          prompt: oneLine(prompt, 240),
          summary: oneLine(result.output, 1000),
          model: policy.modelLabel,
          thinking: policy.thinkingLabel,
          modelSource: policy.modelSource,
          thinkingSource: policy.thinkingSource,
          policy: policy.diagnostics,
          progress: result.progress,
          error: result.status === "failed" || result.status === "cancelled" ? oneLine(result.output, 1000) : undefined,
          transcript: result.transcript,
        };
        const task = recordYpiStudioSubagentRun(root, taskId, run);
        return { content: [{ type: "text", text: result.output }], details: { task, run, warnings: allWarnings.length ? allWarnings : undefined }, isError: result.status === "failed" || result.status === "cancelled" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
      }
    },
  });

  pi.on?.("session_start", (event, ctx) => {
    getKey(event, ctx);
    ctx?.ui?.notify?.("YPI Studio workflow context is available.", "info");
  });

  pi.on?.("tool_call", (event, ctx) => {
    const key = getKey(event, ctx);
    const ev = event as { toolName?: string; input?: JsonObject };
    if (ev.toolName === "bash" && isObj(ev.input) && typeof ev.input.command === "string" && !bashHasStudioContext(ev.input.command)) {
      ev.input.command = `export YPI_STUDIO_CONTEXT_ID=${shellQuote(key)}; ${ev.input.command}`;
    }
  });

  pi.on?.("input", (event, ctx) => {
    const key = getKey(event, ctx);
    const ev = event as { text?: string };
    if (typeof ev.text !== "string" || !ev.text.trim()) return { action: "continue" };
    try {
      recordYpiStudioUserApproval(root, key, ev.text);
    } catch {
      // Approval recording is best-effort; the injected state still tells the model to wait.
    }
    const injection = buildStudioState(root, key, ev.text);
    return { action: "transform", text: [ev.text, injection].join("\n\n") };
  });

  pi.on?.("before_agent_start", (event, ctx) => {
    const key = getKey(event, ctx);
    const cur = (event as { systemPrompt?: string }).systemPrompt ?? "";
    const startup = startupKeys.has(key) ? "" : startupContext(root);
    startupKeys.add(key);
    return {
      systemPrompt: [
        cur,
        startup,
        buildStudioState(root, key),
        "YPI Studio rule: the main session must orchestrate task state. For member work, call ypi_studio_subagent instead of pretending to be that member.",
      ].filter(Boolean).join("\n\n"),
    };
  });

  pi.on?.("context", (event, ctx) => {
    getKey(event, ctx);
  });
};
}

export default createYpiStudioExtension(process.cwd());
