import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializeYpiStudioAgents } from "./ypi-studio-agents";
import {
  createYpiStudioTask,
  getCurrentYpiStudioTaskDetail,
  getYpiStudioTaskContextForPrompt,
  getYpiStudioTaskDetail,
  listYpiStudioTasks,
  recordYpiStudioSubagentRun,
  transitionYpiStudioTask,
  updateYpiStudioTaskArtifact,
} from "./ypi-studio-tasks";
import { initializeYpiStudioWorkflows, readYpiStudioWorkflow } from "./ypi-studio-workflows";
import type { YpiStudioTaskSubagentRun } from "./ypi-studio-types";

type JsonObject = Record<string, unknown>;
type TextContent = { type: "text"; text: string };
interface PiToolResult {
  content: TextContent[];
  details: unknown;
  isError?: boolean;
}
interface PiExtensionContext {
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
  };
  model?: { id?: string; provider?: string };
  ui?: { notify?: (msg: string, type?: "info" | "warning" | "error") => void };
}
interface StudioTaskToolInput {
  action?: "init_workflows" | "create" | "current" | "get" | "transition" | "update_artifact";
  title?: string;
  workflowId?: string;
  taskId?: string;
  to?: string;
  reason?: string;
  artifact?: string;
  content?: string;
  override?: boolean;
}
interface StudioSubagentInput {
  member?: string;
  prompt?: string;
  taskId?: string;
  model?: string;
  thinking?: string;
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

function contextKey(input?: unknown, ctx?: PiExtensionContext): string | null {
  const envKey = str(process.env.YPI_STUDIO_CONTEXT_ID);
  if (envKey) return envKey.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) || hash(envKey);
  const sessionId = callStr(ctx?.sessionManager?.getSessionId) ?? str(process.env.PI_SESSION_ID) ?? lookupStr(input, ["session_id", "sessionId", "sessionID"]);
  if (sessionId) return `pi_${sessionId.replace(/[^A-Za-z0-9._-]+/g, "_") || hash(sessionId)}`;
  const transcriptPath = callStr(ctx?.sessionManager?.getSessionFile) ?? lookupStr(input, ["transcript_path", "transcriptPath", "transcript"]);
  if (transcriptPath) return `pi_transcript_${hash(transcriptPath)}`;
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

function buildStudioState(root: string, key: string | null): string {
  const current = key ? getCurrentYpiStudioTaskDetail(root, key) : null;
  if (!current) {
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
    ].join("\n");
  }

  const workflow = readYpiStudioWorkflow(root, current.workflowId);
  const state = workflow?.states[current.status];
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
    state?.requiresUserApproval ? "This state requires explicit user approval before moving forward." : "",
    "Never enter implementing from awaiting_approval unless the user has approved the plan.",
    "</ypi-studio-state>",
  ].filter(Boolean).join("\n");
}

function startupContext(root: string): string {
  return [
    "<ypi-studio-context>",
    "YPI Studio workflow context is available. Studio tasks are structured under .ypi/tasks and workflows under .ypi/workflows.",
    "The main session is the orchestrator. Use ypi_studio_task for task lifecycle and ypi_studio_subagent for role delegation.",
    "</ypi-studio-context>",
    FIRST_REPLY_NOTICE,
    `Workspace: ${root}`,
  ].join("\n");
}

function currentTaskIdOrThrow(root: string, key: string | null, requested?: string): string {
  if (requested) return requested;
  const current = key ? getCurrentYpiStudioTaskDetail(root, key) : null;
  if (!current) throw new Error("No active YPI Studio task is bound to this session. Create or bind one first.");
  return current.id;
}

function normalizeTaskToolInput(value: unknown): StudioTaskToolInput {
  const raw = isObj(value) ? value : {};
  const action = raw.action === "init_workflows" || raw.action === "create" || raw.action === "current" || raw.action === "get" || raw.action === "transition" || raw.action === "update_artifact" ? raw.action : undefined;
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
  };
}

function memberFile(member: string): string {
  const normalized = member.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) throw new Error("Invalid Studio member id");
  return `${normalized}.md`;
}

function extractAssistantText(stdout: string, stderr: string): string {
  let finalText = "";
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as unknown;
      const message = isObj(event) && isObj(event.message) ? event.message : null;
      if (message?.role === "assistant") {
        const content = message.content;
        if (typeof content === "string") finalText = content;
        else if (Array.isArray(content)) {
          finalText = content.map((block) => isObj(block) && block.type === "text" && typeof block.text === "string" ? block.text : "").join("");
        }
      }
    } catch {
      // Non-JSON output is handled by the fallback below.
    }
  }
  return finalText.trim() || stdout.trim() || stderr.trim();
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

function buildPiArgs(input: StudioSubagentInput): string[] {
  const args = ["--mode", "json", "-p", "--no-session"];
  const model = str(input.model);
  const thinking = str(input.thinking);
  if (model) args.push("--model", thinking && thinking !== "off" && !model.includes(":") ? `${model}:${thinking}` : model);
  else if (thinking && thinking !== "off") args.push("--thinking", thinking);
  return args;
}

function runChildPi(root: string, prompt: string, input: StudioSubagentInput, signal?: AbortSignal): Promise<{ output: string; failed: boolean }> {
  return new Promise((resolveResult) => {
    const inv = resolvePiCli();
    const child = spawn(inv.command, [...inv.args, ...buildPiArgs(input)], {
      cwd: root,
      env: { ...process.env, YPI_STUDIO_SUBAGENT_CHILD: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (output: string, failed: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolveResult({ output, failed });
    };
    const abort = () => {
      child.kill();
      finish("cancelled", true);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => finish(error instanceof Error ? error.message : String(error), true));
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      finish(extractAssistantText(out, err), code !== 0);
    });
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
    "4. 方案稳定后切到 awaiting_approval，并等待我确认后才进入 implementing。",
    "5. 实现和检查分别通过 ypi_studio_subagent(member=implementer) 与 ypi_studio_subagent(member=checker) 指派。",
  ].join("\n"));
}

function buildMemberPrompt(root: string, taskId: string, member: string, delegatedPrompt: string): string {
  const definition = readText(join(root, ".ypi", "agents", memberFile(member)));
  if (!definition.trim()) throw new Error(`Studio member definition not found: .ypi/agents/${memberFile(member)}`);
  const taskContext = getYpiStudioTaskContextForPrompt(root, taskId);
  return [
    "# YPI Studio Member Delegation",
    "You are already running as the delegated YPI Studio member below. Do not dispatch another Studio member or subagent unless the parent explicitly asks.",
    "Do not commit, push, or merge. Respect the active task state and report blockers instead of guessing product decisions.",
    "",
    "## Member Definition",
    definition,
    "",
    taskContext,
    "",
    "## Delegated Task",
    delegatedPrompt,
    "",
    "Return a concise handoff with files changed or artifacts produced, validation run, remaining risks, and decisions needed from the main session.",
  ].join("\n");
}

export function createYpiStudioExtension(workspaceRoot: string) {
  return function ypiStudioExtension(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand" | "sendUserMessage" | "on">): void {
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
      ctx.ui.notify?.(`YPI Studio initialized: ${agents.created.length} members, ${workflows.created.length} workflows created.`, "info");
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

  pi.registerTool?.({
    name: "ypi_studio_task",
    label: "YPI Studio Task",
    description: "Manage structured YPI Studio workflows and tasks for the current project.",
    promptSnippet: "Use ypi_studio_task to initialize workflows, create/bind/read Studio tasks, transition states, and update artifacts.",
    promptGuidelines: [
      "Use ypi_studio_task before doing non-trivial YPI Studio work; do not invent task state outside .ypi/tasks/task.json.",
      "Do not transition from awaiting_approval to implementing unless the user approved the plan.",
    ],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["init_workflows", "create", "current", "get", "transition", "update_artifact"] },
        title: { type: "string" },
        workflowId: { type: "string" },
        taskId: { type: "string" },
        to: { type: "string" },
        reason: { type: "string" },
        artifact: { type: "string" },
        content: { type: "string" },
        override: { type: "boolean" },
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
        const current = getCurrentYpiStudioTaskDetail(root, key);
        const payload = current ? { task: current } : { task: null, tasks: listYpiStudioTasks(root).tasks.slice(0, 8) };
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
    ],
    parameters: {
      type: "object",
      properties: {
        member: { type: "string", description: "architect, ui-designer, implementer, checker, or a custom .ypi/agents member id" },
        prompt: { type: "string" },
        taskId: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh"] },
      },
      required: ["member", "prompt"],
    },
    execute: async (_id: string, inputValue: unknown, signal?: AbortSignal, _onUpdate?: unknown, ctx?: PiExtensionContext): Promise<PiToolResult> => {
      const input = normalizeSubagentInput(inputValue);
      const key = getKey(input, ctx);
      const member = str(input.member);
      const prompt = str(input.prompt);
      if (!member || !prompt) return { content: [{ type: "text", text: "member and prompt are required" }], details: { error: "member and prompt are required" }, isError: true };
      try {
        const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
        const startedAt = new Date().toISOString();
        const runId = `${member}-${hash(`${taskId}:${startedAt}:${prompt}`)}`;
        const childPrompt = buildMemberPrompt(root, taskId, member, prompt);
        const result = await runChildPi(root, childPrompt, input, signal);
        const finishedAt = new Date().toISOString();
        const run: YpiStudioTaskSubagentRun = {
          id: runId,
          member,
          status: result.failed ? "failed" : "succeeded",
          startedAt,
          finishedAt,
          prompt: oneLine(prompt, 240),
          summary: oneLine(result.output, 1000),
          model: str(input.model) ?? undefined,
          thinking: str(input.thinking) ?? undefined,
          error: result.failed ? oneLine(result.output, 1000) : undefined,
        };
        const task = recordYpiStudioSubagentRun(root, taskId, run);
        return { content: [{ type: "text", text: result.output }], details: { task, run }, isError: result.failed };
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
    const injection = buildStudioState(root, key);
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
