import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializeYpiStudioAgents } from "./ypi-studio-agents";
import { readPiWebConfigForApi, type PiWebStudioSubagentRunner } from "./pi-web-config";
import { resolveYpiStudioMemberPolicy, type ResolvedYpiStudioMemberPolicy } from "./ypi-studio-policy";
import {
  archiveYpiStudioTask,
  claimYpiStudioImprovementSubtask,
  claimYpiStudioImplementationSubtask,
  createYpiStudioImprovement,
  createYpiStudioTask,
  getCurrentYpiStudioTaskDetail,
  getNextYpiStudioImplementationSubtask,
  getYpiStudioKnowledgeContextForPrompt,
  getYpiStudioTaskContextForPrompt,
  getYpiStudioTaskDetail,
  implementationCounts,
  listYpiStudioTasks,
  recordYpiStudioImprovementApproval,
  recordYpiStudioSubagentRun,
  recordYpiStudioUserApproval,
  reconcileYpiStudioImprovements,
  reconcileYpiStudioRuntimeLostSubagentRun,
  resolveYpiStudioImprovementDisposition,
  reviseYpiStudioImprovementPlan,
  transitionYpiStudioImprovement,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioImplementationSubtask,
  updateYpiStudioImprovementArtifact,
  updateYpiStudioImprovementPlan,
  updateYpiStudioTaskArtifact,
} from "./ypi-studio-tasks";
import { initializeYpiStudioWorkflows, readYpiStudioWorkflow } from "./ypi-studio-workflows";
import {
  appendYpiStudioSubagentTranscriptItem,
  createYpiStudioSubagentTranscript,
  finalizeYpiStudioSubagentTranscript,
  previewYpiStudioTranscriptText,
  readYpiStudioSubagentTranscriptPreview,
  type YpiStudioSubagentTranscriptWriter,
} from "./ypi-studio-transcripts";
import { abortYpiStudioChildRun, getYpiStudioChildRun, registerYpiStudioChildRun, scheduleYpiStudioChildRunContinuation, unregisterYpiStudioChildRun, updateYpiStudioChildRun } from "./ypi-studio-subagent-runtime";
import { runYpiStudioSdkChildSession } from "./ypi-studio-child-session-runner";
import type { YpiStudioImplementationLocalReviewStatus, YpiStudioImplementationSubtaskStatus, YpiStudioImprovementDisposition, YpiStudioImprovementStatus, YpiStudioSubagentCurrentTool, YpiStudioSubagentRunPhase, YpiStudioSubagentRunProgress, YpiStudioSubagentToolAction, YpiStudioSubagentToolMode, YpiStudioSubagentTranscriptItem, YpiStudioSubagentTranscriptRef, YpiStudioTaskDetail, YpiStudioTaskEvent, YpiStudioTaskScope, YpiStudioTaskSubagentRun } from "./ypi-studio-types";

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
  action?: "init_workflows" | "create" | "current" | "get" | "transition" | "update_artifact" | "archive" | "update_implementation_plan" | "implementation_next" | "claim_implementation_subtask" | "claim_improvement_subtask" | "update_implementation_subtask"
    | "create_improvement" | "get_improvement" | "transition_improvement" | "resolve_improvement_disposition" | "update_improvement_artifact" | "update_improvement_plan" | "record_improvement_approval" | "revise_improvement_plan" | "reconcile_improvements";
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
  subtaskIds?: string[];
  limit?: number;
  includeWaitingReasons?: boolean;
  status?: YpiStudioImplementationSubtaskStatus;
  runId?: string;
  runIds?: string[];
  validation?: string[];
  blockedBy?: string[];
  blockedReason?: string;
  skippedReason?: string;
  terminationReason?: string;
  localReview?: { status?: YpiStudioImplementationLocalReviewStatus; runId?: string; summary?: string };
  detail?: "compact" | "full";
  includeFullDetail?: boolean;
  // Improvement-specific fields
  improvementId?: string;
  feedback?: string;
  owner?: string;
  inputText?: string;
  artifactUpdates?: Record<string, unknown>;
}
interface StudioSubagentInput {
  /** Omitted action/mode preserves the existing synchronous delegation behavior. */
  action?: YpiStudioSubagentToolAction;
  mode?: YpiStudioSubagentToolMode;
  member?: string;
  prompt?: string;
  taskId?: string;
  model?: string;
  thinking?: string;
  subtaskId?: string;
  improvementId?: string;
  runId?: string;
  runIds?: string[];
  cancelReason?: string;
}

interface StudioWaitInput {
  taskId?: string;
  runId?: string;
  runIds?: string[];
  until?: "child_terminal" | "next_orchestration_step";
  timeoutMs?: number;
  pollIntervalMs?: number;
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

const UI_PROTOTYPE_GATE_PROMPT = "UI prototype gate: if a task changes pages, adds frontend functionality, changes existing interactions, changes approval/confirmation experience, or changes user-visible information structure, the architect MUST dispatch ui-designer to produce an HTML prototype based on the existing project, request user approval for that prototype, and avoid implementation until approval is recorded. ui.md may carry the HTML or link to an .html file, but plain Markdown alone is not acceptable.";
const PLAN_REVIEW_PROMPT = "Plan approval book: before transitioning to awaiting_approval, the architect MUST write meaningful plan-review.md content. It is the user-facing approval entry and should use Markdown relative links to PRD, Design, Implement, Checks, ui.md, and any HTML prototype. Empty/TBD plan-review.md blocks awaiting_approval.";

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

function buildImprovementStateInjection(task: YpiStudioTaskDetail): string {
  const improvements = task.improvements;
  if (!improvements?.instances?.length) return "";
  const unresolved = improvements.instances.filter((inst) =>
    !["accepted", "accepted_not_doing"].includes(inst.status)
  );
  const lines: string[] = [];
  lines.push(`Improvements: ${unresolved.length} unresolved of ${improvements.instances.length} total.`);
  for (const inst of improvements.instances) {
    const resolved = !["accepted", "accepted_not_doing"].includes(inst.status) ? "unresolved" : "resolved";
    lines.push(`- ${inst.displayId} "${inst.title}": ${inst.status} (owner: ${inst.owner}, ${resolved})`);
  }
  if (unresolved.length > 0) {
    const first = unresolved[0];
    lines.push("Improvement workflow: dispatch improver for analysis; then plan approval; then implementer/checker; then user acceptance. Only after all improvements are resolved can the main task return to review and request re-acceptance.");
    if (first.status === "analysis") {
      lines.push(`Next improvement action: dispatch improver via ypi_studio_subagent(member=improver) to analyze ${first.displayId} and produce a plan.`);
    } else if (first.status === "waiting_plan_approval") {
      lines.push(`Next improvement action: ask the user to review and approve ${first.displayId} plan. Use ypi_studio_task(action=record_improvement_approval) after explicit user approval, then transition to implementing.`);
    } else if (first.status === "implementing" || first.status === "checking") {
      lines.push(`Next improvement action for ${first.displayId}: inspect ready instance subtasks with ypi_studio_task(action=implementation_next, improvementId=${first.id}, limit=<available slots>), claim them with ypi_studio_task(action=claim_improvement_subtask, improvementId=${first.id}, subtaskId=<id>, status=running), then start one async ${first.owner} per claimed subtaskId with ypi_studio_subagent(action=start, mode=async, member=${first.owner}, improvementId=${first.id}, subtaskId=<claimed id>). While the main task waits for improvements, do NOT claim or start main-plan subtasks. Call ypi_studio_wait(runIds=<started run ids>) to await results; action=poll or action=collect with runId remains available.`);
    }
  }
  return lines.join("\n");
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
    current.status === "planning" ? UI_PROTOTYPE_GATE_PROMPT : "",
    current.status === "planning" ? PLAN_REVIEW_PROMPT : "",
    current.status === "planning" ? "When planning/design artifacts are complete, write plan-review.md with links to the review artifacts, save implementationPlan with ypi_studio_task(action=update_implementation_plan), transition only to awaiting_approval, and then stop this turn to ask the user for confirmation; do not dispatch implementer in the same turn." : "",
    current.status === "implementing" && current.implementationPlan ? "Implementing with a plan: fill available concurrency slots, not just one. First inspect ready work with ypi_studio_task(action=implementation_next, limit=<available slots>). Then claim ready subtask(s) up to maxConcurrency with ypi_studio_task(action=claim_implementation_subtask, limit=<available slots>, status=running) or explicit subtaskIds, and start one ypi_studio_subagent(action=start, mode=async, member=implementer, subtaskId=<claimed id>) per claimed subtask. Each implementer run handles exactly one subtaskId, but a single orchestration turn should launch multiple async runs when multiple ready subtasks and free slots exist. After launching async run(s), call ypi_studio_wait(runIds=<started run ids>) so this main chat waits for terminal results and continues from the tool result. Do not delegate the whole implementation at once." : "",
    current.status === "waiting_for_improvements" ? buildImprovementStateInjection(current) : "",
    current.status === "review" && current.improvements?.parentStatus === "review_ready" && current.improvements.instances.length > 0 ? "All improvements have been resolved. The main task is back in review — ask the user to re-accept the main task before completing it." : "",
    current.status === "awaiting_approval" && approvalGranted ? "The user has explicitly approved the plan in this chat session. You may now transition to implementing in this turn and then dispatch implementer work if needed." : "",
    current.status === "awaiting_approval" && !approvalGranted ? "Current task is awaiting approval: direct the user to review plan-review.md, summarize the plan/artifacts, and ask for explicit approval or change requests. Do not transition to implementing until a later user input explicitly says 确认/批准/开始实现/approve/go ahead." : "",
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
    "The main session is the orchestrator. Use ypi_studio_task for task lifecycle, ypi_studio_subagent for role delegation, and ypi_studio_wait after async delegation so the main chat waits for child results as a real tool call.",
    "Design/planning must stop at awaiting_approval for user confirmation; implementation may start only after a later explicit user approval.",
    PLAN_REVIEW_PROMPT,
    UI_PROTOTYPE_GATE_PROMPT,
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

function isFullTaskDetailRequested(input: StudioTaskToolInput): boolean {
  return input.detail === "full" || input.includeFullDetail === true;
}

function isTaskEvent(value: unknown): value is YpiStudioTaskEvent {
  if (!isObj(value)) return false;
  const type = value.type;
  return (type === "created" || type === "transition" || type === "artifact" || type === "subagent" || type === "note" || type === "archive" || type === "improvement") && typeof value.at === "string" && typeof value.taskId === "string";
}

function countNonEmptyJsonlLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  const stat = statSync(filePath);
  if (stat.size <= 0) return 0;
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    let count = 0;
    let sawNonWhitespace = false;
    let currentLineHasText = false;
    while (position < stat.size) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (bytesRead <= 0) break;
      for (let i = 0; i < bytesRead; i += 1) {
        const byte = buffer[i];
        if (byte === 10) {
          if (currentLineHasText) count += 1;
          currentLineHasText = false;
        } else if (byte !== 13 && byte !== 32 && byte !== 9) {
          sawNonWhitespace = true;
          currentLineHasText = true;
        }
      }
      position += bytesRead;
    }
    if (currentLineHasText) count += 1;
    return sawNonWhitespace ? count : 0;
  } catch {
    return 0;
  } finally {
    closeSync(fd);
  }
}

function readRecentTaskEvents(root: string, task: YpiStudioTaskDetail, limit = 10): { totalCount: number; recentLimit: number; recent: YpiStudioTaskEvent[]; path: string; tailTruncated: boolean } {
  const eventPath = join(root, task.pathLabel, "events.jsonl");
  if (!existsSync(eventPath)) return { totalCount: 0, recentLimit: limit, recent: [], path: `${task.pathLabel}/events.jsonl`, tailTruncated: false };
  let totalCount = 0;
  try {
    totalCount = countNonEmptyJsonlLines(eventPath);
    const stat = statSync(eventPath);
    const fd = openSync(eventPath, "r");
    try {
      const maxTailBytes = Math.min(stat.size, 1024 * 1024);
      let tailBytes = Math.min(stat.size, 64 * 1024);
      let recent: YpiStudioTaskEvent[] = [];
      while (tailBytes <= maxTailBytes) {
        const buffer = Buffer.alloc(tailBytes);
        readSync(fd, buffer, 0, tailBytes, stat.size - tailBytes);
        recent = buffer.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-limit).flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            return isTaskEvent(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        });
        if (recent.length >= Math.min(limit, totalCount) || tailBytes === maxTailBytes) break;
        tailBytes = Math.min(maxTailBytes, tailBytes * 2);
      }
      return { totalCount, recentLimit: limit, recent, path: `${task.pathLabel}/events.jsonl`, tailTruncated: stat.size > maxTailBytes };
    } finally {
      closeSync(fd);
    }
  } catch {
    return { totalCount, recentLimit: limit, recent: task.events.slice(-limit), path: `${task.pathLabel}/events.jsonl`, tailTruncated: false };
  }
}

function summarizeStudioEvent(event: YpiStudioTaskEvent): Record<string, unknown> {
  return {
    type: event.type,
    at: event.at,
    taskId: event.taskId,
    message: event.message ? oneLine(event.message, 300) : undefined,
    from: event.from,
    to: event.to,
    member: event.member,
    artifact: event.artifact,
  };
}

function summarizeStudioTimelineItem(item: { id: string; title: string; status: string; displayStatus?: string; member?: string; runId?: string; runStatus?: string; reason?: string; summary?: string; updatedAt: string }): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    displayStatus: item.displayStatus,
    member: item.member,
    runId: item.runId,
    runStatus: item.runStatus,
    reason: item.reason ? oneLine(item.reason, 240) : undefined,
    summary: item.summary ? oneLine(item.summary, 240) : undefined,
    updatedAt: item.updatedAt,
  };
}

function summarizeStudioSubagentRun(run: YpiStudioTaskSubagentRun): Record<string, unknown> {
  const currentTool = run.progress?.currentTool ? { toolName: run.progress.currentTool.toolName, startedAt: run.progress.currentTool.startedAt } : undefined;
  return {
    id: run.id,
    member: run.member,
    subtaskId: run.subtaskId,
    improvementId: run.improvementId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary ? oneLine(run.summary, 300) : undefined,
    error: run.error ? oneLine(run.error, 300) : undefined,
    terminationReason: run.terminationReason,
    model: run.model,
    thinking: run.thinking,
    phase: run.progress?.phase,
    tokens: run.progress?.tokens,
    tps: run.progress?.tps,
    currentTool,
  };
}

function buildNextStudioTaskAction(task: YpiStudioTaskDetail): string {
  const summary = task.implementation;
  if (task.status === "waiting_for_improvements") {
    const unresolved = task.improvements?.instances?.filter((inst) =>
      !["accepted", "accepted_not_doing"].includes(inst.status)
    ) ?? [];
    if (unresolved.length > 0) {
      const first = unresolved[0];
      const displayIds = unresolved.map((inst) => inst.displayId).join(", ");
      return `Task is waiting for ${unresolved.length} improvement(s) to complete: ${displayIds}. Next: ${first.status === "analysis" || first.status === "waiting_clarification" ? "dispatch improver with ypi_studio_subagent to analyze feedback and create an improvement plan" : first.status === "waiting_plan_approval" ? "ask the user to review and approve the improvement plan" : first.status === "implementing" || first.status === "checking" ? "call ypi_studio_wait or ypi_studio_subagent(action=collect) to check child progress; then advance the improvement workflow" : first.status === "waiting_user_acceptance" ? "ask the user to accept or reject the improvement change" : first.status === "cancelled" || first.status === "failed" ? "ask the user to accept-not-doing or retry the improvement" : "check the improvement status in task detail"}.`;
    }
    return "All improvements are resolved; transition the task to review and request user re-acceptance.";
  }
  if (task.status === "awaiting_approval") return "Point the user to plan-review.md, summarize the saved plan/artifacts, and ask for explicit approval; do not transition to implementing without a server-recorded approval grant.";
  if (task.status === "planning") return "Finish design/planning artifacts and write meaningful plan-review.md with Markdown links to review materials. If the work triggers the UI prototype gate, dispatch ui-designer for an HTML prototype and request user approval. Save implementationPlan if applicable, then transition only to awaiting_approval and stop for user confirmation.";
  if (task.status === "implementing" && summary) {
    const active = summary.running + summary.queued;
    const unfinished = summary.ready + summary.waiting + summary.pending + summary.blocked + summary.failed + active;
    if (summary.failed > 0 || summary.blocked > 0) return "Inspect failed/blocked implementation subtasks and report the blocker before dispatching more work.";
    if (unfinished === 0 && summary.total > 0) return "Implementation subtasks are complete and no active run remains: transition the task to checking and dispatch the checker.";
    if (summary.ready > 0) return "Call ypi_studio_task(action=implementation_next, limit=<available slots>), claim ready subtasks, then start one async implementer per claimed subtaskId.";
    if (active > 0) return "Poll or collect active Studio subagent runs with ypi_studio_subagent before claiming more work.";
  }
  if (task.status === "checking") {
    const activeChecker = task.subagents.find((run) => run.member === "checker" && (run.status === "queued" || run.status === "running"));
    if (activeChecker) return `Checker is still ${activeChecker.status}: poll or collect run ${activeChecker.id} instead of dispatching another checker.`;
    const terminalChecker = task.subagents.filter((run) => run.member === "checker" && run.finishedAt).sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt))[0];
    if (terminalChecker) return `Checker finished with status ${terminalChecker.status}: collect run ${terminalChecker.id}, then complete the task only if the checker verdict has no needs-work/blocker findings; otherwise report the remaining work or return to implementing.`;
    return "Dispatch checker work via ypi_studio_subagent, then transition according to the workflow result.";
  }
  if (task.status === "completed") return "Task is completed; archive only when the user asks or the workflow calls for durable knowledge capture.";
  return "Use the task status/progress summary to choose the next workflow transition; request full detail only if the compact summary is insufficient.";
}

function compactYpiStudioTaskForTool(root: string, task: YpiStudioTaskDetail): Record<string, unknown> {
  const recentEvents = readRecentTaskEvents(root, task, 10);
  const documentIndex = Object.fromEntries(Object.entries(task.artifacts).map(([artifact, fileName]) => {
    const document = task.documents[artifact];
    return [artifact, {
      fileName,
      path: `${task.pathLabel}/${fileName}`,
      available: !!document,
      truncated: document?.truncated ?? false,
      chars: document?.content.length ?? 0,
    }];
  }));
  const subagentStatusCounts = task.subagents.reduce<Record<string, number>>((counts, run) => {
    counts[run.status] = (counts[run.status] ?? 0) + 1;
    return counts;
  }, {});
  const activeSubagents = task.subagents.filter((run) => run.status === "queued" || run.status === "running" || run.status === "waiting_for_user").map(summarizeStudioSubagentRun);
  const recentSubagents = task.subagents.slice(-5).map(summarizeStudioSubagentRun);
  const projection = task.implementationProjection;
  const compactProjection = projection ? {
    maxConcurrency: projection.maxConcurrency,
    statusCounts: projection.statusCounts,
    activeSubtaskIds: projection.activeSubtaskIds,
    queuedSubtaskIds: projection.queuedSubtaskIds,
    nextSubtaskIds: projection.nextSubtaskIds,
    nonTerminalSubtasks: projection.nonTerminalSubtasks.map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      status: subtask.status,
      displayStatus: subtask.displayStatus,
      waitingOn: subtask.waitingOn,
      blockedBy: subtask.blockedBy,
      blockedReason: subtask.blockedReason,
      summary: subtask.summary ? oneLine(subtask.summary, 240) : undefined,
    })),
    compactTimeline: projection.compactTimeline.slice(-10).map(summarizeStudioTimelineItem),
    sessionRuntime: projection.sessionRuntime ? {
      status: projection.sessionRuntime.status,
      message: projection.sessionRuntime.message,
      activeRunCount: projection.sessionRuntime.activeRunCount,
      queuedRunCount: projection.sessionRuntime.queuedRunCount,
      readySubtaskCount: projection.sessionRuntime.readySubtaskCount,
      blockedSubtaskCount: projection.sessionRuntime.blockedSubtaskCount,
      failedSubtaskCount: projection.sessionRuntime.failedSubtaskCount,
      updatedAt: projection.sessionRuntime.updatedAt,
    } : undefined,
  } : undefined;
  return {
    key: task.key,
    id: task.id,
    title: task.title,
    workflowId: task.workflowId,
    workflowName: task.workflowName,
    status: task.status,
    cwd: task.cwd,
    pathLabel: task.pathLabel,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    currentMember: task.currentMember,
    contextIds: task.contextIds,
    progress: task.progress,
    archived: task.archived,
    archiveMonth: task.archiveMonth,
    archivedAt: task.archivedAt,
    artifacts: {
      required: task.progress.requiredArtifacts,
      optional: task.progress.optionalArtifacts,
      completed: task.progress.completedArtifacts,
      missing: task.progress.missingArtifacts,
      files: documentIndex,
    },
    implementation: task.implementation,
    implementationPlan: task.implementationPlan ? {
      summary: task.implementationPlan.summary,
      strategy: task.implementationPlan.strategy,
      maxConcurrency: task.implementationPlan.maxConcurrency,
      subtaskCount: task.implementationPlan.subtasks.length,
    } : undefined,
    implementationProgress: task.implementationProgress ? {
      updatedAt: task.implementationProgress.updatedAt,
      counts: task.implementationProgress.counts,
      activeSubtaskIds: task.implementationProgress.activeSubtaskIds ?? [],
      queuedSubtaskIds: task.implementationProgress.queuedSubtaskIds ?? [],
      nextSubtaskIds: task.implementationProgress.nextSubtaskIds ?? [],
    } : undefined,
    implementationProjection: compactProjection,
    improvements: task.improvements ? {
      parentStatus: task.improvements.parentStatus,
      total: task.improvements.instances.length,
      unresolved: task.improvements.instances.filter((inst) =>
        !["accepted", "accepted_not_doing"].includes(inst.status)
      ).length,
      instances: task.improvements.instances.map((inst) => ({
        id: inst.id,
        displayId: inst.displayId,
        title: inst.title,
        status: inst.status,
        owner: inst.owner,
        approvalMode: inst.approvalMode,
        updatedAt: inst.updatedAt,
        // Bounded: never include full feedback in the compact tool projection.
        feedbackPreview: inst.feedback ? oneLine(inst.feedback, 120) : undefined,
      })),
    } : undefined,
    subagents: {
      totalCount: task.subagents.length,
      statusCounts: subagentStatusCounts,
      active: activeSubagents,
      recentLimit: 5,
      recent: recentSubagents,
    },
    events: { ...recentEvents, recent: recentEvents.recent.map(summarizeStudioEvent) },
    nextRecommendedAction: buildNextStudioTaskAction(task),
    readHints: [
      `Artifacts live under ${task.pathLabel}; read specific files from the artifacts.files map when their content is needed.`,
      `Events are omitted except the recent ${recentEvents.recentLimit}; totalCount=${recentEvents.totalCount}. Read ${recentEvents.path} manually only if old event history is needed.`,
      "YPI Studio tools never inject complete task JSON into the main chat. detail='full' only adds summary metadata and file paths; read specific task/artifact/event files only when needed."
    ],
  };
}

function taskToolPayload(root: string, task: YpiStudioTaskDetail, input: StudioTaskToolInput): Record<string, unknown> {
  const payload = compactYpiStudioTaskForTool(root, task);
  if (!isFullTaskDetailRequested(input)) return payload;
  return {
    ...payload,
    fullDetail: {
      requested: true,
      returned: "summary_and_paths_only",
      reason: "Full task JSON is intentionally not injected into the main chat context. Read the specific files below only when their content is required.",
      files: {
        taskJson: `${task.pathLabel}/task.json`,
        eventsJsonl: `${task.pathLabel}/events.jsonl`,
        artifactsDirectory: task.pathLabel,
        runtimeDirectory: ".ypi/.runtime/studio-subagents/",
      },
    },
  };
}

function isLocalReviewStatus(value: unknown): value is YpiStudioImplementationLocalReviewStatus {
  return value === "not_requested" || value === "requested" || value === "running" || value === "passed" || value === "failed" || value === "skipped";
}

function normalizeTaskToolInput(value: unknown): StudioTaskToolInput {
  const raw = isObj(value) ? value : {};
  const action = raw.action === "init_workflows" || raw.action === "create" || raw.action === "current" || raw.action === "get" || raw.action === "transition" || raw.action === "update_artifact" || raw.action === "archive" || raw.action === "update_implementation_plan" || raw.action === "implementation_next" || raw.action === "claim_implementation_subtask" || raw.action === "claim_improvement_subtask" || raw.action === "update_implementation_subtask"
    || raw.action === "create_improvement" || raw.action === "get_improvement" || raw.action === "transition_improvement" || raw.action === "resolve_improvement_disposition" || raw.action === "update_improvement_artifact" || raw.action === "update_improvement_plan" || raw.action === "record_improvement_approval" || raw.action === "revise_improvement_plan" || raw.action === "reconcile_improvements"
    ? raw.action : undefined;
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
    subtaskIds: Array.isArray(raw.subtaskIds) ? raw.subtaskIds.filter((item): item is string => typeof item === "string") : undefined,
    limit: typeof raw.limit === "number" && Number.isFinite(raw.limit) ? Math.max(1, Math.floor(raw.limit)) : undefined,
    includeWaitingReasons: raw.includeWaitingReasons === true,
    status: raw.status === "pending" || raw.status === "waiting" || raw.status === "ready" || raw.status === "queued" || raw.status === "running" || raw.status === "blocked" || raw.status === "failed" || raw.status === "done" || raw.status === "skipped" ? raw.status : undefined,
    runId: str(raw.runId) ?? undefined,
    runIds: Array.isArray(raw.runIds) ? raw.runIds.filter((item): item is string => typeof item === "string") : undefined,
    validation: Array.isArray(raw.validation) ? raw.validation.filter((item): item is string => typeof item === "string") : undefined,
    blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy.filter((item): item is string => typeof item === "string") : undefined,
    blockedReason: str(raw.blockedReason) ?? undefined,
    skippedReason: str(raw.skippedReason) ?? undefined,
    terminationReason: str(raw.terminationReason) ?? undefined,
    localReview: isObj(raw.localReview) ? { status: isLocalReviewStatus(raw.localReview.status) ? raw.localReview.status : undefined, runId: str(raw.localReview.runId) ?? undefined, summary: str(raw.localReview.summary) ?? undefined } : undefined,
    detail: raw.detail === "full" ? "full" : raw.detail === "compact" ? "compact" : undefined,
    includeFullDetail: raw.includeFullDetail === true,
    improvementId: str(raw.improvementId) ?? undefined,
    feedback: str(raw.feedback) ?? undefined,
    owner: str(raw.owner) ?? undefined,
    inputText: str(raw.inputText) ?? undefined,
    artifactUpdates: isObj(raw.artifactUpdates) ? raw.artifactUpdates : undefined,
  };
}

function normalizeSubagentInput(value: unknown): StudioSubagentInput {
  const raw = isObj(value) ? value : {};
  return {
    action: raw.action === "start" || raw.action === "poll" || raw.action === "collect" || raw.action === "cancel" ? raw.action : undefined,
    mode: raw.mode === "sync" || raw.mode === "async" ? raw.mode : undefined,
    member: str(raw.member) ?? undefined,
    prompt: str(raw.prompt) ?? undefined,
    taskId: str(raw.taskId) ?? undefined,
    model: str(raw.model) ?? undefined,
    thinking: str(raw.thinking) ?? undefined,
    subtaskId: str(raw.subtaskId) ?? undefined,
    improvementId: str(raw.improvementId) ?? undefined,
    runId: str(raw.runId) ?? undefined,
    runIds: Array.isArray(raw.runIds) ? raw.runIds.filter((item): item is string => typeof item === "string") : undefined,
    cancelReason: str(raw.cancelReason) ?? undefined,
  };
}

function normalizeWaitInput(value: unknown): StudioWaitInput {
  const raw = isObj(value) ? value : {};
  const timeoutMs = typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
    ? Math.min(60 * 60_000, Math.max(1_000, Math.floor(raw.timeoutMs)))
    : undefined;
  const pollIntervalMs = typeof raw.pollIntervalMs === "number" && Number.isFinite(raw.pollIntervalMs)
    ? Math.min(15_000, Math.max(500, Math.floor(raw.pollIntervalMs)))
    : undefined;
  return {
    taskId: str(raw.taskId) ?? undefined,
    runId: str(raw.runId) ?? undefined,
    runIds: Array.isArray(raw.runIds) ? raw.runIds.filter((item): item is string => typeof item === "string") : undefined,
    until: raw.until === "next_orchestration_step" ? "next_orchestration_step" : raw.until === "child_terminal" ? "child_terminal" : undefined,
    timeoutMs,
    pollIntervalMs,
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

const MAX_CHILD_STDERR_BYTES = 1 * 1024 * 1024;
const MAX_CHILD_STDOUT_LINE_BYTES = 1 * 1024 * 1024;
const MAX_CHILD_FINAL_OUTPUT_BYTES = 256 * 1024;
const MAX_CHILD_LIVE_PREVIEW_BYTES = 4 * 1024;
const CHILD_RECENT_PROGRESS_LIMIT = 5;
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

function resolvePiCodingAgentPackageDir(): string | null {
  try {
    const resolved = import.meta.resolve("@earendil-works/pi-coding-agent");
    const entryPath = resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved;
    return dirname(dirname(entryPath));
  } catch {
    return null;
  }
}

function pushPiCliCandidate(candidates: string[], candidate: string | null | undefined): void {
  if (!candidate) return;
  const resolved = resolve(candidate);
  if (!candidates.includes(resolved)) candidates.push(resolved);
}

function resolvePiCli(): { command: string; args: string[] } {
  const candidates: string[] = [];
  const packageDir = resolvePiCodingAgentPackageDir();
  pushPiCliCandidate(candidates, packageDir ? join(packageDir, "dist", "cli.js") : null);
  pushPiCliCandidate(candidates, join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"));
  for (const arg of process.argv) {
    if (/pi-coding-agent[\\/]dist[\\/]cli\.js$/i.test(arg)) pushPiCliCandidate(candidates, arg);
  }
  const prefix = str(process.env.npm_config_prefix) ?? str(process.env.NPM_CONFIG_PREFIX);
  if (prefix) {
    pushPiCliCandidate(candidates, join(prefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"));
    pushPiCliCandidate(candidates, join(prefix, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"));
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
  if (delta.type !== "text_delta") return "";
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
  parentSessionFile?: string;
  subtaskId?: string;
  improvementId?: string;
  continuationOnFinal?: boolean;
  runner?: YpiStudioTaskSubagentRun["runner"];
  childSessionId?: string;
  childSessionFile?: string;
  requestAffinity?: YpiStudioTaskSubagentRun["requestAffinity"];
}


interface ChildPiResult {
  output: string;
  status: YpiStudioTaskSubagentRun["status"];
  transcript?: YpiStudioSubagentTranscriptRef;
  warnings: string[];
  progress: YpiStudioSubagentRunProgress;
  terminationReason?: string;
  runner?: YpiStudioTaskSubagentRun["runner"];
  childSessionId?: string;
  childSessionFile?: string;
  requestAffinity?: YpiStudioTaskSubagentRun["requestAffinity"];
}

function resolveStudioSubagentRunner(configured: PiWebStudioSubagentRunner): { runner: YpiStudioTaskSubagentRun["runner"]; configured: PiWebStudioSubagentRunner; warnings: string[] } {
  if (configured === "cli") return { runner: "cli", configured, warnings: [] };
  if (configured === "sdk") return { runner: "sdk", configured, warnings: [] };
  return {
    runner: "sdk",
    configured,
    warnings: ["studio.subagents.runner=auto selected the SDK child runner. If SDK setup fails before prompt execution, the run will fall back to the bundled CLI runner."],
  };
}

function buildRequestAffinity(policy: ResolvedYpiStudioMemberPolicy, meta: Pick<ChildRunMeta, "parentSessionId" | "childSessionId" | "requestAffinity">): YpiStudioTaskSubagentRun["requestAffinity"] {
  const childSessionId = meta.requestAffinity?.childSessionId ?? meta.childSessionId;
  if (!childSessionId) return undefined;
  return {
    schemaVersion: 1,
    providerSessionIdSource: "childSessionId",
    parentSessionId: meta.requestAffinity?.parentSessionId ?? meta.parentSessionId,
    childSessionId,
    model: meta.requestAffinity?.model ?? policy.modelLabel,
    modelSource: meta.requestAffinity?.modelSource ?? policy.modelSource,
    thinking: meta.requestAffinity?.thinking ?? policy.thinkingLabel,
    thinkingSource: meta.requestAffinity?.thinkingSource ?? policy.thinkingSource,
    note: meta.requestAffinity?.note ?? "Studio SDK child runs use the same Pi SDK/provider/auth/model-registry path as the parent chat, but provider request affinity is keyed by the independent child session id rather than reusing the parent session id.",
  };
}

interface ChildPiPersistenceCallbacks {
  onProgress?: (run: YpiStudioTaskSubagentRun) => void;
  onFinal?: (run: YpiStudioTaskSubagentRun, result: ChildPiResult) => void;
}

function runChildPi(
  root: string,
  prompt: string,
  policy: ResolvedYpiStudioMemberPolicy,
  meta: ChildRunMeta,
  writer: YpiStudioSubagentTranscriptWriter | null,
  signal?: AbortSignal,
  onUpdate?: ToolUpdateCallback,
  persistence?: ChildPiPersistenceCallbacks,
): Promise<ChildPiResult> {
  const childPromise = new Promise<ChildPiResult>((resolveResult) => {
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
    let stderrBytes = 0;
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
    let previewTruncated = false;
    let finalOutputTruncated = false;
    let status: YpiStudioTaskSubagentRun["status"] = "running";
    let terminationReason: string | undefined;
    const requestAffinity = buildRequestAffinity(policy, meta);
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
      while (recentItems.length > CHILD_RECENT_PROGRESS_LIMIT) recentItems.shift();
    };

    const safeRecentItems = (): YpiStudioSubagentTranscriptItem[] => recentItems.slice(-CHILD_RECENT_PROGRESS_LIMIT).map((item) => {
      if (item.kind === "tool_call") {
        const preview = truncateBytes(item.inputPreview, MAX_CHILD_LIVE_PREVIEW_BYTES);
        if (preview.truncated) previewTruncated = true;
        return { ...item, inputPreview: preview.text, truncated: item.truncated || preview.truncated };
      }
      if ("text" in item) {
        const preview = truncateBytes(item.text, MAX_CHILD_LIVE_PREVIEW_BYTES);
        if (preview.truncated) previewTruncated = true;
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
        display: {
          recentLimit: CHILD_RECENT_PROGRESS_LIMIT,
          previewTruncated,
          finalOutputTruncated,
          transcriptItemTruncated: writer?.ref.truncation?.itemTruncated === true,
          transcriptCaptureLimited: writer?.ref.truncation?.captureLimited === true,
        },
        terminationReason: terminationReason ?? undefined,
      };
    };

    const runSnapshot = (runStatus: YpiStudioTaskSubagentRun["status"], summary?: string): YpiStudioTaskSubagentRun => ({
      id: meta.runId,
      member: meta.member,
      subtaskId: meta.subtaskId,
      improvementId: meta.improvementId,
      status: runStatus,
      startedAt: meta.startedAt,
      runner: meta.runner ?? "cli",
      childSessionId: meta.childSessionId,
      childSessionFile: meta.childSessionFile,
      requestAffinity,
      prompt: undefined,
      summary: summary ?? oneLine(lastTextPreview, 1000),
      model: policy.modelLabel,
      thinking: policy.thinkingLabel,
      modelSource: policy.modelSource,
      thinkingSource: policy.thinkingSource,
      policy: policy.diagnostics,
      progress: progressSnapshot(),
      terminationReason: terminationReason ?? undefined,
      error: runStatus === "failed" || runStatus === "cancelled" ? oneLine(summary ?? lastTextPreview, 1000) : undefined,
      transcript: writer ? { ...writer.ref, status: runStatus === "queued" ? "running" : runStatus } : undefined,
    });

    const progressPayload = (): PiToolResult => {
      const progress = progressSnapshot();
      updateYpiStudioChildRun(meta.runId, { status, progress });
      const transcript = writer ? { ...writer.ref } : undefined;
      return {
        content: [{ type: "text", text: `${meta.member} ${status} · model: ${policy.modelLabel} · thinking: ${policy.thinkingLabel} · ${eventCount} events · ${oneLine(progress.lastTextPreview, 140)}` }],
        details: {
          run: {
            id: meta.runId,
            member: meta.member,
            status,
            taskId: meta.taskId,
            runner: meta.runner ?? "cli",
            childSessionId: meta.childSessionId,
            childSessionFile: meta.childSessionFile,
            requestAffinity,
            model: policy.modelLabel,
            thinking: policy.thinkingLabel,
            modelSource: policy.modelSource,
            thinkingSource: policy.thinkingSource,
            policy: policy.diagnostics,
            transcript,
            progress,
            terminationReason: terminationReason ?? undefined,
          },
        },
      };
    };

    const emitProgress = (force = false): void => {
      if (!onUpdate && !persistence?.onProgress) return;
      const now = Date.now();
      const send = () => {
        lastUpdateAt = Date.now();
        updateTimer = null;
        try {
          const payload = progressPayload();
          onUpdate?.(payload);
          persistence?.onProgress?.(runSnapshot(status));
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
      if (truncated.truncated) {
        finalOutputTruncated = true;
        addWarning(`Display note: final assistant output was clipped to ${MAX_CHILD_FINAL_OUTPUT_BYTES} bytes for the parent result; the member run status is unchanged.`);
      }
      finalAssistantOutput = truncated.text;
      return truncated.text;
    };

    const handleChildEvent = (event: unknown, at = new Date().toISOString()): void => {
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

    const parseLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      markActivity();
      const at = new Date().toISOString();
      let event: unknown;
      try {
        event = JSON.parse(trimmed) as unknown;
      } catch {
        lastTextPreview = "Ignored non-JSON stdout from child process.";
        appendItem({ kind: "status", at, text: lastTextPreview, truncated: true });
        emitProgress();
        return;
      }
      handleChildEvent(event, at);
    };

    const flushStdoutLines = (chunk: Buffer): void => {
      if (settled) return;
      markActivity();
      const text = decoder.write(chunk);
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
      updateYpiStudioChildRun(meta.runId, { status, progress: progressSnapshot() });
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
      const output = finalAssistantOutput.trim()
        || (status === "cancelled" ? "cancelled" : "Child Pi run finished without a captured final assistant message.");
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
      const childResult = { output, status, transcript, warnings, progress: progressSnapshot(), terminationReason: terminationReason ?? undefined, runner: meta.runner ?? "cli", childSessionId: meta.childSessionId, childSessionFile: meta.childSessionFile, requestAffinity } satisfies ChildPiResult;
      const finalRun = runSnapshot(status, output);
      finalRun.finishedAt = new Date().toISOString();
      finalRun.progress = childResult.progress;
      finalRun.terminationReason = childResult.terminationReason;
      finalRun.transcript = transcript;
      updateYpiStudioChildRun(meta.runId, { status, progress: childResult.progress, result: childResult });
      try {
        persistence?.onFinal?.(finalRun, childResult);
      } catch (error) {
        addWarning(`Final run persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (meta.continuationOnFinal && meta.parentSessionId) {
        scheduleYpiStudioChildRunContinuation({
          runId: meta.runId,
          taskId: meta.taskId,
          subtaskId: meta.subtaskId,
          member: meta.member,
          cwd: root,
          parentSessionId: meta.parentSessionId,
          status,
          summary: finalRun.summary,
          finishedAt: finalRun.finishedAt,
        });
      }
      unregisterYpiStudioChildRun(meta.runId);
      resolveResult(childResult);
    };

    const abort = () => terminateChild("abort_signal", "cancelled");

    registerYpiStudioChildRun({
      runId: meta.runId,
      taskId: meta.taskId,
      subtaskId: meta.subtaskId,
      member: meta.member,
      cwd: root,
      parentSessionId: meta.parentSessionId,
      pid: child.pid,
      runner: meta.runner ?? "cli",
      childSessionId: meta.childSessionId,
      childSessionFile: meta.childSessionFile,
      startedAt: meta.startedAt,
      status: "running",
      abort: (reason) => terminateChild(reason, "cancelled"),
      onAbortPersist: (reason) => {
        const cancelledRun = runSnapshot("cancelled", `Child Pi run cancelled: ${reason}`);
        cancelledRun.finishedAt = new Date().toISOString();
        cancelledRun.terminationReason = reason;
        try {
          persistence?.onFinal?.(cancelledRun, { output: cancelledRun.summary ?? "cancelled", status: "cancelled", transcript: cancelledRun.transcript, warnings, progress: cancelledRun.progress!, terminationReason: reason, runner: meta.runner ?? "cli", childSessionId: meta.childSessionId, childSessionFile: meta.childSessionFile, requestAffinity });
        } catch {
          // Best-effort persistence; terminateChild/finish will perform the normal finalizer if the parent tool remains alive.
        }
      },
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
        terminateChild("stderr_output_limit", "failed");
        return;
      }
      lastTextPreview = `Child Pi wrote ${stderrBytes} stderr bytes.`;
      appendItem({ kind: "stderr", at: new Date().toISOString(), text: lastTextPreview, truncated: true });
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
  updateYpiStudioChildRun(meta.runId, { promise: childPromise });
  return childPromise;
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
    "3. 涉及页面变更、前端功能新增、交互变化、审批体验变化或用户可见信息结构变化时，必须使用 ypi_studio_subagent(member=ui-designer) 产出 HTML 原型并请求用户审批；ui.md 不能只有纯 Markdown 说明。",
    "4. 方案稳定后先写入 plan-review.md 计划审批书（用 Markdown 相对链接引用 PRD/Design/Implement/Checks、ui.md 和 HTML 原型），再只切到 awaiting_approval；本轮必须停止，引导我审阅计划审批书并请求确认或修改意见。",
    "5. 未收到后续用户明确确认前，不得进入 implementing，不得调用 implementer；确认后先领取一个 ready implementation subtask，再通过 ypi_studio_subagent(member=implementer, subtaskId=...) 逐项指派。"
  ].join("\n"));
}

interface StudioSubagentRunProjection {
  runId: string;
  taskId: string;
  taskKey?: string;
  subtaskId?: string;
  improvementId?: string;
  member: string;
  taskTitle?: string;
  subtaskTitle?: string;
  status: YpiStudioTaskSubagentRun["status"];
  registryStatus?: string;
  registryActive: boolean;
  runner?: YpiStudioTaskSubagentRun["runner"];
  childSessionId?: string;
  childSessionFile?: string;
  requestAffinity?: YpiStudioTaskSubagentRun["requestAffinity"];
  progress?: YpiStudioSubagentRunProgress;
  transcript?: YpiStudioSubagentTranscriptRef;
  transcriptPreview?: unknown;
  summary?: string;
  error?: string;
  terminationReason?: string;
  model?: string;
  thinking?: string;
  modelSource?: string;
  thinkingSource?: string;
  startedAt: string;
  finishedAt?: string;
}

interface ProjectSubagentRunOptions {
  includeTranscriptPreview?: boolean;
}

function compactYpiStudioTaskIdentity(task: YpiStudioTaskDetail): Record<string, unknown> {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    workflowId: task.workflowId,
  };
}

function compactProgressForLifecycle(progress: YpiStudioSubagentRunProgress | undefined, lastTextMax = 180): Record<string, unknown> | undefined {
  if (!progress) return undefined;
  return {
    phase: progress.phase,
    updatedAt: progress.updatedAt,
    eventCount: progress.eventCount,
    lastTextPreview: progress.lastTextPreview ? oneLine(progress.lastTextPreview, lastTextMax) : undefined,
    warnings: progress.warnings?.slice(-5),
    tokens: progress.tokens,
    tps: progress.tps,
    currentTool: progress.currentTool,
    terminationReason: progress.terminationReason,
  };
}

function compactSubagentRunForAsyncStart(run: StudioSubagentRunProjection): Record<string, unknown> {
  return {
    id: run.runId,
    runId: run.runId,
    taskId: run.taskId,
    taskKey: run.taskKey,
    taskTitle: run.taskTitle,
    subtaskId: run.subtaskId,
    subtaskTitle: run.subtaskTitle,
    improvementId: run.improvementId,
    member: run.member,
    status: run.status,
    model: run.model,
    thinking: run.thinking,
    modelSource: run.modelSource,
    thinkingSource: run.thinkingSource,
    runner: run.runner,
    startedAt: run.startedAt,
    progress: {
      phase: run.progress?.phase ?? "starting",
      startedAt: run.startedAt,
      updatedAt: run.progress?.updatedAt ?? run.startedAt,
      eventCount: run.progress?.eventCount ?? 0,
      lastTextPreview: "Async child Pi process starting.",
    },
  };
}

function compactSubagentRunForLifecycle(run: StudioSubagentRunProjection): Record<string, unknown> {
  return {
    id: run.runId,
    runId: run.runId,
    taskId: run.taskId,
    taskKey: run.taskKey,
    taskTitle: run.taskTitle,
    subtaskId: run.subtaskId,
    subtaskTitle: run.subtaskTitle,
    improvementId: run.improvementId,
    member: run.member,
    status: run.status,
    registryStatus: run.registryStatus,
    registryActive: run.registryActive,
    model: run.model,
    thinking: run.thinking,
    modelSource: run.modelSource,
    thinkingSource: run.thinkingSource,
    runner: run.runner,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    progress: compactProgressForLifecycle(run.progress),
    transcript: run.transcript,
    summary: run.summary ? oneLine(run.summary, 600) : undefined,
    error: run.error ? oneLine(run.error, 800) : undefined,
    terminationReason: run.terminationReason,
  };
}

function projectSubagentRun(root: string, taskId: string, run: YpiStudioTaskSubagentRun, options: ProjectSubagentRunOptions = {}): StudioSubagentRunProjection {
  const { includeTranscriptPreview = true } = options;
  const handle = getYpiStudioChildRun(run.id);
  const detail = getYpiStudioTaskDetail(root, taskId);
  const improvementInstance = run.improvementId ? detail?.improvements?.instances.find((inst) => inst.id === run.improvementId) : undefined;
  const subtaskTitle = run.subtaskId
    ? improvementInstance?.implementationPlan?.subtasks.find((subtask) => subtask.id === run.subtaskId)?.title
      ?? detail?.implementationProjection?.subtasksWithStatus.find((subtask) => subtask.id === run.subtaskId)?.title
      ?? detail?.implementationPlan?.subtasks.find((subtask) => subtask.id === run.subtaskId)?.title
    : undefined;
  let transcriptPreview: unknown;
  if (includeTranscriptPreview) {
    try {
      transcriptPreview = run.transcript ? readYpiStudioSubagentTranscriptPreview(root, taskId, run, { limit: 5, maxItemBytes: 500 }) : undefined;
    } catch (error) {
      transcriptPreview = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    runId: run.id,
    taskId,
    taskKey: detail?.key,
    subtaskId: run.subtaskId,
    improvementId: run.improvementId,
    member: run.member,
    taskTitle: detail?.title,
    subtaskTitle,
    status: handle?.status === "runtime_lost" ? run.status : handle?.status ?? run.status,
    registryStatus: handle?.status,
    registryActive: !!handle,
    runner: handle?.runner ?? run.runner,
    childSessionId: handle?.childSessionId ?? run.childSessionId,
    childSessionFile: handle?.childSessionFile ?? run.childSessionFile,
    requestAffinity: run.requestAffinity,
    progress: handle?.progress ?? run.progress,
    transcript: run.transcript,
    transcriptPreview,
    summary: run.summary,
    error: run.error,
    terminationReason: run.terminationReason,
    model: run.model,
    thinking: run.thinking,
    modelSource: run.modelSource,
    thinkingSource: run.thinkingSource,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function compactSubagentRunProjection(run: StudioSubagentRunProjection): Record<string, unknown> {
  const progress = run.progress ? {
    phase: run.progress.phase,
    updatedAt: run.progress.updatedAt,
    eventCount: run.progress.eventCount,
    lastTextPreview: run.progress.lastTextPreview ? oneLine(run.progress.lastTextPreview, 500) : undefined,
    itemsPreview: run.progress.itemsPreview?.slice(-3).map((item) => "text" in item && typeof item.text === "string" ? { ...item, text: oneLine(item.text, 500) } : item),
    warnings: run.progress.warnings?.slice(-5),
    tokens: run.progress.tokens,
    tps: run.progress.tps,
    currentTool: run.progress.currentTool,
    display: run.progress.display,
    terminationReason: run.progress.terminationReason,
  } : undefined;
  const transcriptPreview = isObj(run.transcriptPreview) && Array.isArray(run.transcriptPreview.items)
    ? { ...run.transcriptPreview, items: run.transcriptPreview.items.slice(-3) }
    : run.transcriptPreview;
  return {
    runId: run.runId,
    taskId: run.taskId,
    subtaskId: run.subtaskId,
    improvementId: run.improvementId,
    member: run.member,
    taskTitle: run.taskTitle,
    subtaskTitle: run.subtaskTitle,
    status: run.status,
    registryStatus: run.registryStatus,
    registryActive: run.registryActive,
    runner: run.runner,
    childSessionId: run.childSessionId,
    childSessionFile: run.childSessionFile,
    requestAffinity: run.requestAffinity,
    progress,
    transcript: run.transcript,
    transcriptPreview,
    summary: run.summary ? oneLine(run.summary, 1000) : undefined,
    error: run.error ? oneLine(run.error, 1000) : undefined,
    terminationReason: run.terminationReason,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function compactYpiStudioTaskForWait(task: YpiStudioTaskDetail): Record<string, unknown> {
  return compactYpiStudioTaskIdentity(task);
}

function compactSubagentRunForWait(run: StudioSubagentRunProjection): Record<string, unknown> {
  const progress = run.progress ? {
    phase: run.progress.phase,
    updatedAt: run.progress.updatedAt,
    warnings: run.progress.warnings?.slice(-5),
    tokens: run.progress.tokens,
    tps: run.progress.tps,
    currentTool: run.progress.currentTool,
    terminationReason: run.progress.terminationReason,
  } : undefined;
  return {
    id: run.runId,
    runId: run.runId,
    taskId: run.taskId,
    taskKey: run.taskKey,
    subtaskId: run.subtaskId,
    improvementId: run.improvementId,
    member: run.member,
    taskTitle: run.taskTitle,
    subtaskTitle: run.subtaskTitle,
    status: run.status,
    progress,
    summary: run.summary ? oneLine(run.summary, 180) : undefined,
    error: run.error ? oneLine(run.error, 240) : undefined,
    terminationReason: run.terminationReason,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function buildMemberPrompt(root: string, taskId: string, member: string, delegatedPrompt: string, subtaskId?: string, improvementId?: string): string {
  const definition = readText(join(root, ".ypi", "agents", memberFile(member)));
  if (!definition.trim()) throw new Error(`Studio member definition not found: .ypi/agents/${memberFile(member)}`);
  const detail = getYpiStudioTaskDetail(root, taskId);
  if (!detail) throw new Error("Task not found");
  let taskContext: string;
  let implementationBlock: string;
  if (improvementId) {
    // Improvement-instance scoped delegation: build context from the instance artifacts/plan/progress
    // only. Never inject the main task implementation plan/progress into an improvement member.
    const instance = detail.improvements?.instances.find((inst) => inst.id === improvementId);
    if (!instance) throw new Error(`Improvement not found: ${improvementId}`);
    if (!instance.implementationPlan || !instance.implementationProgress) throw new Error(`Improvement ${instance.displayId} has no implementation plan/progress to delegate.`);
    const instanceDir = join(root, detail.pathLabel, "improvements", improvementId);
    const docs = Object.entries(instance.artifacts ?? {})
      .map(([artifact, fileName]) => {
        if (typeof fileName !== "string" || !fileName) return "";
        const content = readText(join(instanceDir, fileName));
        return content.trim() ? `## ${artifact} (${fileName})\n\n${content.slice(0, 256 * 1024)}` : "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
    const selectedPlan = subtaskId ? instance.implementationPlan.subtasks.find((item) => item.id === subtaskId) ?? null : null;
    const selectedProgress = subtaskId ? instance.implementationProgress.subtasks[subtaskId] : undefined;
    const counts = implementationCounts(instance.implementationProgress);
    const progressLine = `${counts.done}/${instance.implementationPlan.subtasks.length} done; ready=${counts.ready}; running=${counts.running}; queued=${counts.queued}; blocked=${counts.blocked}; failed=${counts.failed}; active=${instance.implementationProgress.activeSubtaskId ?? "none"}; next=${instance.implementationProgress.nextSubtaskId ?? "none"}`;
    implementationBlock = [
      "## Improvement Instance Boundary",
      `Improvement: ${instance.displayId} "${instance.title}" (status: ${instance.status}, owner: ${instance.owner})`,
      `Scope: IMP ${improvementId}. Resolve subtasks only against this improvement instance plan. Do not read or modify the main task implementation plan/progress or claim main-plan subtasks.`,
      `Plan summary: ${instance.implementationPlan.summary ?? "(no summary)"}`,
      `Progress: ${progressLine}`,
      subtaskId ? `Assigned subtaskId: ${subtaskId}` : "Assigned subtaskId: none",
      selectedPlan ? `Selected subtask JSON:\n${safeJson({ plan: selectedPlan, progress: selectedProgress })}` : "No selected subtask was found in the instance plan.",
      member === "implementer" && subtaskId ? "Implementer rule: execute only the selected instance subtask boundary. Do not implement unrelated subtasks or the main task." : "",
      member === "implementer" && !subtaskId ? "Implementer rule: this improvement instance has a plan but no subtaskId was assigned. Report blocked and ask the parent session to claim/select one instance subtask." : "",
      member === "checker" && subtaskId ? "Checker rule: perform a local review for the selected instance subtask first, then report verdict and evidence." : "",
    ].filter(Boolean).join("\n");
    taskContext = [
      "# YPI Studio Improvement Instance Context",
      `Parent task: ${detail.id}`,
      `Parent task title: ${detail.title}`,
      `Parent task status: ${detail.status} (waiting for improvements)`,
      `Improvement: ${instance.displayId} (${instance.id})`,
      `Improvement status: ${instance.status}`,
      `Owner: ${instance.owner}`,
      docs ? `\n${docs}` : "",
    ].filter(Boolean).join("\n");
  } else {
    taskContext = getYpiStudioTaskContextForPrompt(root, taskId);
    const selectedPlan = subtaskId && detail.implementationPlan ? detail.implementationPlan.subtasks.find((item) => item.id === subtaskId) : null;
    const selectedProgress = subtaskId ? detail.implementationProgress?.subtasks[subtaskId] : undefined;
    implementationBlock = detail.implementationPlan ? [
      "## Implementation Plan Boundary",
      `Plan summary: ${detail.implementationPlan.summary ?? "(no summary)"}`,
      `Progress: ${detail.implementation?.done ?? 0}/${detail.implementation?.total ?? detail.implementationPlan.subtasks.length} done; active=${detail.implementation?.activeSubtaskId ?? "none"}; next=${detail.implementation?.nextSubtaskId ?? "none"}; blocked=${detail.implementation?.blocked ?? 0}`,
      subtaskId ? `Assigned subtaskId: ${subtaskId}` : "Assigned subtaskId: none",
      selectedPlan ? `Selected subtask JSON:\n${safeJson({ plan: selectedPlan, progress: selectedProgress })}` : "No selected subtask was found in the plan.",
      member === "implementer" && subtaskId ? "Implementer rule: execute only the selected subtask boundary. Do not implement unrelated subtasks." : "",
      member === "implementer" && !subtaskId ? "Implementer rule: because this task has an implementation plan but no subtaskId was assigned, do not implement the full task. Report blocked and ask the parent session to claim/select one subtask." : "",
      member === "checker" && subtaskId ? "Checker rule: perform a local review for the selected subtask first, then report verdict and evidence." : "",
    ].filter(Boolean).join("\n") : "## Implementation Plan Boundary\nNo implementation plan is saved for this task.";
  }
  const knowledge = getYpiStudioKnowledgeContextForPrompt(root, [taskContext.slice(0, 1200), member, delegatedPrompt].join(" "), { maxEntries: 3, maxTotalChars: 2600 });
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

export function createYpiStudioExtension(workspaceRoot: string, sessionContext?: { sessionId?: string; sessionFile?: string }) {
  return function ypiStudioExtension(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand" | "sendUserMessage" | "on" | "getThinkingLevel">): void {
  if (process.env.YPI_STUDIO_SUBAGENT_CHILD === "1") return;

  const root = findRoot(workspaceRoot);
  const procKey = `pi_process_${hash([root, process.pid, Date.now(), randomBytes(8).toString("hex")].join(":"))}`;
  let currentKey: string | null = null;
  const startupKeys = new Set<string>();

  const getKey = (input?: unknown, ctx?: PiExtensionContext) => {
    const key = sessionContext?.sessionId
      ? `pi_${sanitizeContextId(sessionContext.sessionId)}`
      : contextKey(input, ctx) ?? currentKey ?? procKey;
    currentKey = key;
    return key;
  };

  const getParentSessionContinuationId = (input?: unknown, ctx?: PiExtensionContext): string | undefined => {
    return sessionContext?.sessionId
      ?? callStr(ctx?.sessionManager?.getSessionId)
      ?? lookupStr(input, ["parentSessionId", "session_id", "sessionId", "sessionID"])
      ?? getKey(input, ctx);
  };

  const getParentSessionFile = (input?: unknown, ctx?: PiExtensionContext): string | undefined => {
    return sessionContext?.sessionFile
      ?? callStr(ctx?.sessionManager?.getSessionFile)
      ?? lookupStr(input, ["parentSessionFile", "transcript_path", "transcriptPath", "transcript"])
      ?? undefined;
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
    promptSnippet: `Use ypi_studio_task to initialize workflows, create/bind/read Studio tasks, transition states, and update artifacts. ${PLAN_REVIEW_PROMPT} ${UI_PROTOTYPE_GATE_PROMPT}`,
    promptGuidelines: [
      "Use ypi_studio_task before doing non-trivial YPI Studio work; do not invent task state outside .ypi/tasks/task.json.",
      PLAN_REVIEW_PROMPT,
      UI_PROTOTYPE_GATE_PROMPT,
      "After design/planning artifacts and plan-review.md are ready, transition only to awaiting_approval, stop, and ask the user to confirm or request changes.",
      "The awaiting_approval -> implementing edge has a server-side approval gate; override cannot bypass it. Do not call implementer until a later explicit user approval has been recorded.",
      "For tasks with implementationPlan, save the plan before awaiting_approval. During implementing, call implementation_next with limit=<available concurrency slots> to inspect the ready batch, then claim all ready subtask(s) that fit the free slots before dispatching one async implementer per claimed subtaskId.",
      "current/get return compact summaries by default, with artifact paths, recent 10 events, event totalCount, and nextRecommendedAction. detail='full' returns summary metadata plus file paths instead of complete task JSON; read specific files only when needed.",
      "Improvement actions (create_improvement, transition_improvement, etc.) operate on the main task's improvement instances. Only create improvements from review or user_acceptance status after confirming with the user.",
      "record_improvement_approval requires the improvement to be in waiting_plan_approval with a meaningful plan-review.md and UI evidence (HTML prototype) when UI changes are needed.",
    ],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["init_workflows", "create", "current", "get", "transition", "update_artifact", "archive", "update_implementation_plan", "implementation_next", "claim_implementation_subtask", "claim_improvement_subtask", "update_implementation_subtask", "create_improvement", "get_improvement", "transition_improvement", "resolve_improvement_disposition", "update_improvement_artifact", "update_improvement_plan", "record_improvement_approval", "revise_improvement_plan", "reconcile_improvements"] },
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
        subtaskIds: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
        includeWaitingReasons: { type: "boolean" },
        status: { type: "string", enum: ["pending", "waiting", "ready", "queued", "running", "blocked", "failed", "done", "skipped"] },
        runId: { type: "string" },
        runIds: { type: "array", items: { type: "string" } },
        validation: { type: "array", items: { type: "string" } },
        blockedBy: { type: "array", items: { type: "string" } },
        blockedReason: { type: "string" },
        skippedReason: { type: "string" },
        terminationReason: { type: "string" },
        localReview: { type: "object" },
        detail: { type: "string", enum: ["compact", "full"], description: "current/get default to compact task summaries. full returns summary metadata and file paths instead of injecting complete task JSON." },
        includeFullDetail: { type: "boolean", description: "Compatibility alias for detail='full'. Defaults to false and does not inject complete task JSON." },
        improvementId: { type: "string", description: "The internal id (imp_…) of the improvement instance to operate on. Required for claim_improvement_subtask; when passed with implementation_next, ready subtasks are resolved against the instance plan only." },
        feedback: { type: "string", description: "User feedback text to attach when creating an improvement." },
        owner: { type: "string", description: "Improvement owner member (defaults to improver)." },
        inputText: { type: "string", description: "Explicit user approval text (required for record_improvement_approval)." },
        artifactUpdates: { type: "object", description: "Map of artifact names to content for revising improvement plans." },
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
          return { content: [{ type: "text", text: `Created YPI Studio task ${task.id} (${task.status}).` }], details: { task: taskToolPayload(root, task, input) } };
        }
        if (action === "get") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const task = getYpiStudioTaskDetail(root, taskId);
          if (!task) throw new Error("Task not found");
          const payload = taskToolPayload(root, task, input);
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: { task: payload } };
        }
        if (action === "transition") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const to = str(input.to);
          if (!to) throw new Error("to is required for transition");
          const task = transitionYpiStudioTask(taskId, { cwd: root, to, reason: str(input.reason) ?? undefined, contextId: key, override: input.override === true });
          return { content: [{ type: "text", text: `Transitioned YPI Studio task ${task.id} to ${task.status}.` }], details: { task: taskToolPayload(root, task, input) } };
        }
        if (action === "update_artifact") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const artifact = str(input.artifact);
          if (!artifact) throw new Error("artifact is required for update_artifact");
          const task = updateYpiStudioTaskArtifact(taskId, { cwd: root, artifact, content: input.content ?? "", contextId: key });
          return { content: [{ type: "text", text: `Updated YPI Studio artifact ${artifact} for ${task.id}.` }], details: { task: taskToolPayload(root, task, input) } };
        }
        if (action === "update_implementation_plan") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          if (!input.implementationPlan) throw new Error("implementationPlan is required for update_implementation_plan");
          const task = updateYpiStudioImplementationPlan(taskId, { cwd: root, action: "update_implementation_plan", implementationPlan: input.implementationPlan, contextId: key });
          return { content: [{ type: "text", text: `Updated implementation plan for ${task.id}: ${task.implementation?.total ?? 0} subtasks.` }], details: { task: taskToolPayload(root, task, input) } };
        }
        if (action === "implementation_next") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId) ?? undefined;
          const result = getNextYpiStudioImplementationSubtask(root, taskId, { limit: input.limit, improvementId });
          const instance = improvementId ? (result.task.improvements?.instances ?? []).find((inst) => inst.id === improvementId) : undefined;
          const waitingProgress = instance?.implementationProgress ?? result.task.implementationProgress;
          const waiting = input.includeWaitingReasons ? Object.values(waitingProgress?.subtasks ?? {}).filter((item) => item.status === "waiting" || item.status === "pending" || item.status === "blocked") : undefined;
          const scopePrefix = improvementId ? `improvement ${instance?.displayId ?? improvementId} ` : "";
          const text = result.subtasks.length > 1
            ? `Ready ${scopePrefix}subtasks: ${result.subtasks.map((subtask) => `${subtask.id} · ${subtask.title}`).join("; ")}`
            : result.subtask ? `Next ${scopePrefix}subtask: ${result.subtask.id} · ${result.subtask.title}` : `No ready ${improvementId ? "improvement" : "implementation"} subtask is available.`;
          return { content: [{ type: "text", text }], details: { ...result, task: taskToolPayload(root, result.task, input), waiting } };
        }
        if (action === "claim_implementation_subtask") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const before = getYpiStudioTaskDetail(root, taskId);
          const beforeNonTerminalIds = new Set([
            ...(before?.implementationProgress?.activeSubtaskIds ?? []),
            ...(before?.implementationProgress?.queuedSubtaskIds ?? []),
          ]);
          const targetStatus = input.status === "queued" || input.status === "running" ? input.status : undefined;
          const task = claimYpiStudioImplementationSubtask(taskId, { cwd: root, action: "claim_implementation_subtask", subtaskId: input.subtaskId, subtaskIds: input.subtaskIds, limit: input.limit, runId: input.runId, runIds: input.runIds, status: targetStatus, message: input.reason, contextId: key });
          const activeSubtaskIds = task.implementationProgress?.activeSubtaskIds ?? [];
          const queuedSubtaskIds = task.implementationProgress?.queuedSubtaskIds ?? [];
          const nonTerminalIds = [...activeSubtaskIds, ...queuedSubtaskIds];
          const newlyClaimedSubtaskIds = nonTerminalIds.filter((id) => !beforeNonTerminalIds.has(id));
          const fallbackClaimedIds = input.subtaskIds?.length ? input.subtaskIds : input.subtaskId ? [input.subtaskId] : [];
          const claimedIds = newlyClaimedSubtaskIds.length ? newlyClaimedSubtaskIds : fallbackClaimedIds;
          return {
            content: [{ type: "text", text: `Claimed implementation subtask(s) ${claimedIds.join(", ") || "unknown"} for ${task.id}. Active=${activeSubtaskIds.join(", ") || "none"}; queued=${queuedSubtaskIds.join(", ") || "none"}. Dispatch one async implementer per newly claimed subtask until maxConcurrency is full.` }],
            details: { task: taskToolPayload(root, task, input), newlyClaimedSubtaskIds, subtaskIds: claimedIds, activeSubtaskIds, queuedSubtaskIds, subtaskId: claimedIds[0] ?? task.implementationProgress?.activeSubtaskId },
          };
        }
        if (action === "claim_improvement_subtask") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId);
          if (!improvementId) throw new Error("improvementId is required for claim_improvement_subtask");
          const before = getYpiStudioTaskDetail(root, taskId);
          const beforeInstance = before?.improvements?.instances.find((inst) => inst.id === improvementId);
          const beforeNonTerminalIds = new Set([
            ...(beforeInstance?.implementationProgress?.activeSubtaskIds ?? []),
            ...(beforeInstance?.implementationProgress?.queuedSubtaskIds ?? []),
          ]);
          const targetStatus = input.status === "queued" || input.status === "running" ? input.status : undefined;
          const task = claimYpiStudioImprovementSubtask(taskId, { cwd: root, action: "claim_improvement_subtask", improvementId, subtaskId: input.subtaskId, subtaskIds: input.subtaskIds, limit: input.limit, runId: input.runId, runIds: input.runIds, status: targetStatus, message: input.reason, contextId: key });
          const instance = task.improvements?.instances.find((inst) => inst.id === improvementId);
          const activeSubtaskIds = instance?.implementationProgress?.activeSubtaskIds ?? [];
          const queuedSubtaskIds = instance?.implementationProgress?.queuedSubtaskIds ?? [];
          const nonTerminalIds = [...activeSubtaskIds, ...queuedSubtaskIds];
          const newlyClaimedSubtaskIds = nonTerminalIds.filter((id) => !beforeNonTerminalIds.has(id));
          const fallbackClaimedIds = input.subtaskIds?.length ? input.subtaskIds : input.subtaskId ? [input.subtaskId] : [];
          const claimedIds = newlyClaimedSubtaskIds.length ? newlyClaimedSubtaskIds : fallbackClaimedIds;
          return {
            content: [{ type: "text", text: `Claimed improvement ${instance?.displayId ?? improvementId} subtask(s) ${claimedIds.join(", ") || "unknown"}. Active=${activeSubtaskIds.join(", ") || "none"}; queued=${queuedSubtaskIds.join(", ") || "none"}. Dispatch one async ${instance?.owner ?? "implementer"} per newly claimed subtaskId with ypi_studio_subagent(improvementId=${improvementId}, subtaskId=<claimed id>).` }],
            details: { task: taskToolPayload(root, task, input), improvementId, displayId: instance?.displayId, newlyClaimedSubtaskIds, subtaskIds: claimedIds, activeSubtaskIds, queuedSubtaskIds, subtaskId: claimedIds[0] ?? instance?.implementationProgress?.activeSubtaskId },
          };
        }
        if (action === "update_implementation_subtask") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const subtaskId = str(input.subtaskId);
          if (!subtaskId || !input.status) throw new Error("subtaskId and status are required for update_implementation_subtask");
          const task = updateYpiStudioImplementationSubtask(taskId, { cwd: root, action: "update_implementation_subtask", subtaskId, status: input.status, runId: input.runId, message: input.reason, validation: input.validation, blockedBy: input.blockedBy, blockedReason: input.blockedReason, skippedReason: input.skippedReason, terminationReason: input.terminationReason, localReview: input.localReview, contextId: key });
          return { content: [{ type: "text", text: `Implementation subtask ${subtaskId} -> ${input.status}.` }], details: { task: taskToolPayload(root, task, input), subtaskId } };
        }
        if (action === "create_improvement") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const title = str(input.title);
          const feedback = str(input.feedback);
          if (!title) throw new Error("title is required for create_improvement");
          if (!feedback) throw new Error("feedback is required for create_improvement");
          const owner = str(input.owner) ?? undefined;
          const task = createYpiStudioImprovement(taskId, {
            cwd: root,
            action: "create_improvement",
            title,
            feedback,
            contextId: key,
            owner,
          });
          const imp = task.improvements?.instances?.at(-1);
          return { content: [{ type: "text", text: `Created improvement ${imp?.displayId ?? "?"}: ${title}` }], details: { task: taskToolPayload(root, task, input), improvement: imp } };
        }
        if (action === "get_improvement") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const task = getYpiStudioTaskDetail(root, taskId);
          if (!task) throw new Error("Task not found");
          const improvementId = str(input.improvementId);
          if (improvementId) {
            const imp = task.improvements?.instances?.find((inst) => inst.id === improvementId);
            if (!imp) throw new Error(`Improvement not found: ${improvementId}`);
            return { content: [{ type: "text", text: JSON.stringify(imp, null, 2) }], details: { task: taskToolPayload(root, task, input), improvement: imp } };
          }
          const improvements = task.improvements?.instances ?? [];
          return { content: [{ type: "text", text: improvements.length > 0 ? JSON.stringify(improvements.map((imp) => ({
            id: imp.id, displayId: imp.displayId, title: imp.title, status: imp.status, owner: imp.owner,
            approvalMode: imp.approvalMode, disposition: imp.disposition, updatedAt: imp.updatedAt,
          })), null, 2) : "No improvements found." }], details: { task: taskToolPayload(root, task, input), improvements } };
        }
        if (action === "transition_improvement") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId);
          const to = str(input.to);
          if (!improvementId) throw new Error("improvementId is required for transition_improvement");
          if (!to) throw new Error("to is required for transition_improvement");
          const reason = str(input.reason) ?? undefined;
          const task = transitionYpiStudioImprovement(taskId, {
            cwd: root,
            action: "transition_improvement",
            improvementId,
            to: to as YpiStudioImprovementStatus,
            contextId: key,
            reason,
          });
          const imp = task.improvements?.instances?.find((inst) => inst.id === improvementId);
          return { content: [{ type: "text", text: `Transitioned improvement ${imp?.displayId ?? improvementId} to ${to}.` }], details: { task: taskToolPayload(root, task, input), improvement: imp } };
        }
        if (action === "resolve_improvement_disposition") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId);
          if (!improvementId) throw new Error("improvementId is required for resolve_improvement_disposition");
          const disposition = str(input.to);
          if (!disposition) throw new Error("disposition (to field) is required for resolve_improvement_disposition");
          const reasonDisp = str(input.reason) ?? undefined;
          const task = resolveYpiStudioImprovementDisposition(taskId, {
            cwd: root,
            action: "resolve_improvement_disposition",
            improvementId,
            disposition: disposition as YpiStudioImprovementDisposition,
            reason: reasonDisp,
            contextId: key,
          });
          const imp = task.improvements?.instances?.find((inst) => inst.id === improvementId);
          return { content: [{ type: "text", text: `Resolved improvement ${imp?.displayId ?? improvementId} disposition to ${disposition}.` }], details: { task: taskToolPayload(root, task, input), improvement: imp } };
        }
        if (action === "update_improvement_artifact") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const artifact = str(input.artifact);
          const improvementId = str(input.improvementId);
          if (!artifact) throw new Error("artifact is required for update_improvement_artifact");
          if (!improvementId) throw new Error("improvementId is required for update_improvement_artifact");
          const task = updateYpiStudioImprovementArtifact(taskId, {
            cwd: root,
            artifact,
            content: input.content ?? "",
            improvementId,
            contextId: key,
          });
          return { content: [{ type: "text", text: `Updated improvement artifact ${artifact}.` }], details: { task: taskToolPayload(root, task, input) } };
        }
        if (action === "update_improvement_plan") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId);
          if (!improvementId) throw new Error("improvementId is required for update_improvement_plan");
          const task = updateYpiStudioImprovementPlan(taskId, {
            cwd: root,
            action: "update_improvement_plan",
            improvementId,
            implementationPlan: isObj(input.implementationPlan) ? input.implementationPlan : undefined,
            override: input.override === true,
            contextId: key,
          });
          return { content: [{ type: "text", text: `Updated improvement implementation plan.` }], details: { task: taskToolPayload(root, task, input) } };
        }
        if (action === "record_improvement_approval") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId);
          const inputText = str(input.inputText);
          if (!improvementId) throw new Error("improvementId is required for record_improvement_approval");
          if (!inputText) throw new Error("inputText is required for record_improvement_approval");
          const task = recordYpiStudioImprovementApproval(root, taskId, improvementId, key, inputText);
          const imp = task.improvements?.instances?.find((inst) => inst.id === improvementId);
          return { content: [{ type: "text", text: `Recorded user approval for improvement ${imp?.displayId ?? improvementId} (revision ${imp?.approval?.revision ?? "?"}).` }], details: { task: taskToolPayload(root, task, input), improvement: imp } };
        }
        if (action === "revise_improvement_plan") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const improvementId = str(input.improvementId);
          if (!improvementId) throw new Error("improvementId is required for revise_improvement_plan");
          const task = reviseYpiStudioImprovementPlan(taskId, {
            cwd: root,
            action: "update_improvement_plan",
            improvementId,
            implementationPlan: isObj(input.implementationPlan) ? input.implementationPlan : undefined,
            artifactUpdates: isObj(input.artifactUpdates) ? input.artifactUpdates as Record<string, string> : undefined,
            contextId: key,
          });
          const imp = task.improvements?.instances?.find((inst) => inst.id === improvementId);
          return { content: [{ type: "text", text: `Revised improvement ${imp?.displayId ?? improvementId} plan to revision ${imp?.approval?.revision ?? "?"}.` }], details: { task: taskToolPayload(root, task, input), improvement: imp } };
        }
        if (action === "reconcile_improvements") {
          const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
          const task = reconcileYpiStudioImprovements(root, taskId);
          return { content: [{ type: "text", text: `Reconciled improvements for task ${task.id}. Parent status: ${task.improvements?.parentStatus ?? "none"}.` }], details: { task: taskToolPayload(root, task, input) } };
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
          return { content: [{ type: "text", text: `Archived YPI Studio task ${result.task.id}. Knowledge: ${result.knowledge.knowledgePath}.${warningText}` }], details: { ...result, task: taskToolPayload(root, result.task, input) } };
        }
        const current = getCurrentYpiStudioTaskDetail(root, key);
        const payload = current ? { task: taskToolPayload(root, current, input) } : { task: null, tasks: listYpiStudioTasks(root, { scope: input.scope ?? "active" }).tasks.slice(0, 8) };
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
    promptSnippet: `Use ypi_studio_subagent to assign Studio role work to architect, improver, ui-designer, implementer, or checker. ${PLAN_REVIEW_PROMPT} ${UI_PROTOTYPE_GATE_PROMPT}`,
    promptGuidelines: [
      "Use ypi_studio_subagent when assigning YPI Studio member work. The main session orchestrates; members execute their role.",
      "For UI prototype gate tasks, architect must dispatch ui-designer before implementation; ui-designer must deliver an HTML prototype and the main session must obtain user approval.",
      "Do not pass model/thinking unless the user explicitly asks to override Studio Settings for this member run.",
      "When dispatching implementer for a task with implementationPlan, each ypi_studio_subagent run must pass exactly one claimed subtaskId; to use parallelism, launch multiple async implementer runs in the same orchestration turn until maxConcurrency is full.",
      "Omitting action/mode preserves the current synchronous behavior. Async orchestration uses action=start with mode=async; immediately call ypi_studio_wait with the returned runId(s) so the main chat waits on a real tool result. Background terminal continuations remain as a fallback. poll/collect/cancel by runId remain available and must be idempotent.",
    ],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "poll", "collect", "cancel"], description: "Omitted for legacy synchronous start." },
        mode: { type: "string", enum: ["sync", "async"], description: "Omitted or sync keeps the existing blocking child run behavior." },
        member: { type: "string", description: "architect, improver, ui-designer, implementer, checker, or a custom .ypi/agents member id" },
        prompt: { type: "string" },
        taskId: { type: "string" },
        subtaskId: { type: "string" },
        improvementId: { type: "string", description: "Improvement instance id (imp_…). When set, subtaskId is resolved against the instance plan only; required for implementer/checker while the main task waits for improvements." },
        runId: { type: "string" },
        runIds: { type: "array", items: { type: "string" } },
        cancelReason: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh"] },
      },
    },
    execute: async (_id: string, inputValue: unknown, signal?: AbortSignal, onUpdate?: ToolUpdateCallback, ctx?: PiExtensionContext): Promise<PiToolResult> => {
      const input = normalizeSubagentInput(inputValue);
      const key = getKey(input, ctx);
      const action = input.action ?? "start";
      const mode = input.mode ?? "sync";
      try {
        const taskId = currentTaskIdOrThrow(root, key, str(input.taskId) ?? undefined);
        const taskDetail = getYpiStudioTaskDetail(root, taskId);
        if (!taskDetail) throw new Error("Task not found");

        if (action === "poll" || action === "collect") {
          const requestedRunIds = input.runIds?.length ? input.runIds : input.runId ? [input.runId] : [];
          if (!requestedRunIds.length) throw new Error("runId or runIds is required for poll/collect");
          const runs = requestedRunIds.map((id) => {
            const persisted = taskDetail.subagents.find((run) => run.id === id);
            if (!persisted) throw new Error(`Studio subagent run not found: ${id}`);
            return reconcileYpiStudioRuntimeLostSubagentRun(root, taskId, persisted);
          });
          const refreshed = getYpiStudioTaskDetail(root, taskId) ?? taskDetail;
          const projected = runs.map((run) => projectSubagentRun(root, taskId, refreshed.subagents.find((item) => item.id === run.id) ?? run, { includeTranscriptPreview: false }));
          const unfinished = projected.filter((run) => run.status === "queued" || run.status === "running").length;
          const compactRuns = projected.map(compactSubagentRunForLifecycle);
          const nextRecommendedAction = action === "collect" && unfinished === 0 ? buildNextStudioTaskAction(refreshed) : undefined;
          return {
            content: [{ type: "text", text: action === "collect" && unfinished === 0 ? `Collected ${projected.length} Studio subagent run(s). Next: ${nextRecommendedAction}` : `${projected.length} Studio subagent run(s): ${projected.map((run) => `${run.runId}=${run.status}`).join(", ")}` }],
            details: {
              action,
              mode,
              projection: "ypi_studio_subagent_lifecycle_v1",
              task: compactYpiStudioTaskIdentity(refreshed),
              runs: compactRuns,
              run: compactRuns[0],
              status: unfinished === 0 ? "terminal" : "running",
              nextRecommendedAction,
            },
          };
        }

        if (action === "cancel") {
          const requestedRunIds = input.runIds?.length ? input.runIds : input.runId ? [input.runId] : [];
          if (!requestedRunIds.length) throw new Error("runId or runIds is required for cancel");
          const reason = input.cancelReason ?? "cancel_requested";
          const cancelledRuns = requestedRunIds.map((id) => {
            const persisted = taskDetail.subagents.find((run) => run.id === id);
            if (!persisted) throw new Error(`Studio subagent run not found: ${id}`);
            const aborted = abortYpiStudioChildRun(id, reason);
            if (aborted) return persisted;
            const finishedAt = new Date().toISOString();
            const cancelled: YpiStudioTaskSubagentRun = {
              ...persisted,
              status: "cancelled",
              finishedAt,
              summary: persisted.summary ?? `Studio subagent run cancelled: ${reason}`,
              error: `Studio subagent run cancelled: ${reason}`,
              terminationReason: reason,
              progress: persisted.progress ? { ...persisted.progress, phase: "finished", updatedAt: finishedAt, terminationReason: reason } : persisted.progress,
              transcript: persisted.transcript ? { ...persisted.transcript, status: "cancelled", finishedAt, updatedAt: finishedAt } : persisted.transcript,
            };
            recordYpiStudioSubagentRun(root, taskId, cancelled);
            return cancelled;
          });
          const refreshed = getYpiStudioTaskDetail(root, taskId) ?? taskDetail;
          const projected = cancelledRuns.map((run) => projectSubagentRun(root, taskId, refreshed.subagents.find((item) => item.id === run.id) ?? run, { includeTranscriptPreview: false }));
          const compactRuns = projected.map(compactSubagentRunForLifecycle);
          return {
            content: [{ type: "text", text: `Cancelled Studio subagent run(s): ${requestedRunIds.join(", ")}.` }],
            details: {
              action,
              mode,
              projection: "ypi_studio_subagent_lifecycle_v1",
              task: compactYpiStudioTaskIdentity(refreshed),
              runs: compactRuns,
              run: compactRuns[0],
              status: "cancelled",
              cancelReason: oneLine(reason, 240),
            },
          };
        }

        const requestedMember = str(input.member);
        const prompt = str(input.prompt);
        if (!requestedMember || !prompt) throw new Error("member and prompt are required for start");
        const configResult = readPiWebConfigForApi();
        const policy = resolveYpiStudioMemberPolicy({ input, configResult, main: { model: ctx?.model, thinking: currentThinking(pi) } });
        const runnerSelection = resolveStudioSubagentRunner(configResult.config.studio.subagents.runner);
        const member = policy.member;
        const startedAt = new Date().toISOString();
        const runId = str(input.runId) ?? `${member}-${hash(`${taskId}:${startedAt}:${prompt}`)}`;
        const subtaskId = str(input.subtaskId) ?? undefined;
        const improvementId = str(input.improvementId) ?? undefined;
        if (improvementId) {
          // Improvement-instance scoped start: subtasks are resolved against the instance plan only.
          if (taskDetail.status !== "waiting_for_improvements") throw new Error(`Improvement-scoped subagent start requires the main task to be waiting_for_improvements; current status is ${taskDetail.status}.`);
          const instance = taskDetail.improvements?.instances.find((inst) => inst.id === improvementId);
          if (!instance) throw new Error(`Improvement not found: ${improvementId}`);
          if (instance.status !== "implementing" && instance.status !== "checking") throw new Error(`Improvement ${instance.displayId} is not executable (status: ${instance.status}); must be implementing or checking to start a member.`);
          const instancePlan = instance.implementationPlan;
          const instanceProgress = instance.implementationProgress;
          if (!instancePlan || !instanceProgress) throw new Error(`Improvement ${instance.displayId} has no implementation plan/progress to dispatch against.`);
          if ((member === "implementer" || member === "checker") && !subtaskId) throw new Error(`Improvement ${instance.displayId} has an implementation plan; ypi_studio_subagent(member=${member}) requires subtaskId together with improvementId.`);
          if (subtaskId && !instancePlan.subtasks.some((item) => item.id === subtaskId)) throw new Error(`Unknown improvement subtask for ${instance.displayId}: ${subtaskId}. Subtask ids are scoped to the instance plan; main-plan ids are not accepted while the task waits for improvements.`);
          if (subtaskId) {
            const current = instanceProgress.subtasks[subtaskId];
            if (!current) throw new Error(`Unknown improvement subtask: ${subtaskId}`);
            if (mode === "async" && current.status === "ready") {
              claimYpiStudioImprovementSubtask(taskId, { cwd: root, action: "claim_improvement_subtask", improvementId, subtaskId, runId, status: "running", message: `Async Studio subagent ${member} started for improvement ${instance.displayId}`, contextId: key });
            } else if (current.status !== "queued" && current.status !== "running") {
              const hint = mode === "async" ? "ready/queued/running" : "queued/running (claim it first with ypi_studio_task(action=claim_improvement_subtask, improvementId))";
              throw new Error(`Improvement subtask ${subtaskId} must be ${hint} before ${mode} start; current status is ${current.status}.`);
            }
          }
        } else {
          // Main-task scoped start. While the task waits for improvements, main-plan subtasks cannot be started.
          if (taskDetail.status === "waiting_for_improvements" && subtaskId) {
            throw new Error("The main task is waiting_for_improvements; main-plan subtasks cannot be started. Pass improvementId to start an improvement-instance subtask.");
          }
          if (subtaskId && taskDetail.implementationPlan && !taskDetail.implementationPlan.subtasks.some((item) => item.id === subtaskId)) {
            throw new Error(`Unknown implementation subtask: ${subtaskId}`);
          }
          if (member === "implementer" && taskDetail.implementationPlan && !subtaskId) {
            throw new Error("This task has an implementationPlan; ypi_studio_subagent(member=implementer) requires subtaskId and must not run the full task.");
          }
          if (subtaskId && taskDetail.implementationPlan) {
            const current = taskDetail.implementationProgress?.subtasks[subtaskId];
            if (!current) throw new Error(`Unknown implementation subtask: ${subtaskId}`);
            if (taskDetail.status !== "implementing") {
              throw new Error("Implementation subagent start requires the main task to be in implementing after user approval.");
            }
            if (mode === "async" && current.status === "ready") {
              claimYpiStudioImplementationSubtask(taskId, { cwd: root, action: "claim_implementation_subtask", subtaskId, runId, status: "running", message: `Async Studio subagent ${member} started`, contextId: key });
            } else if (current.status !== "queued" && current.status !== "running") {
              const hint = mode === "async" ? "ready/queued/running" : "queued/running (claim it first with ypi_studio_task)";
              throw new Error(`Implementation subtask ${subtaskId} must be ${hint} before ${mode} start; current status is ${current.status}.`);
            }
          }
        }

        const childPrompt = buildMemberPrompt(root, taskId, member, prompt, subtaskId, improvementId);
        let writer: YpiStudioSubagentTranscriptWriter | null = null;
        const warnings: string[] = [...runnerSelection.warnings];
        const persistentRunWarnings = new Set<string>([...policy.warnings, ...warnings]);
        const rememberRunWarning = (warning: string): void => {
          if (!warning.trim()) return;
          warnings.push(warning);
          persistentRunWarnings.add(warning);
        };
        try {
          writer = createYpiStudioSubagentTranscript(root, taskId, { runId, member, startedAt });
          writer.ref.runner = runnerSelection.runner;
          appendYpiStudioSubagentTranscriptItem(writer, { kind: "prompt", at: startedAt, text: prompt });
        } catch (error) {
          rememberRunWarning(`Transcript capture unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
        const promptPreview = previewYpiStudioTranscriptText(prompt, MAX_CHILD_LIVE_PREVIEW_BYTES);
        const initialItemsPreview: YpiStudioSubagentTranscriptItem[] = writer ? [{ kind: "prompt", at: startedAt, text: promptPreview.text, truncated: promptPreview.truncated }] : [];
        const initialDisplay = {
          recentLimit: CHILD_RECENT_PROGRESS_LIMIT,
          previewTruncated: promptPreview.truncated || undefined,
          transcriptItemTruncated: writer?.ref.truncation?.itemTruncated === true || undefined,
          transcriptCaptureLimited: writer?.ref.truncation?.captureLimited === true || undefined,
        } satisfies YpiStudioSubagentRunProgress["display"];
        const runningRun: YpiStudioTaskSubagentRun = {
          id: runId,
          member,
          subtaskId,
          improvementId,
          status: "running",
          startedAt,
          runner: runnerSelection.runner,
          prompt: oneLine(prompt, 240),
          summary: mode === "async" ? "Async child Pi process starting." : "Child Pi process starting.",
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
            itemsPreview: initialItemsPreview,
            warnings: [...policy.warnings, ...warnings],
            display: initialDisplay,
          },
          transcript: writer ? { ...writer.ref } : undefined,
        };
        const taskAfterInitialRun = recordYpiStudioSubagentRun(root, taskId, runningRun);
        const persistRunSnapshot = (run: YpiStudioTaskSubagentRun): void => {
          const latestTask = getYpiStudioTaskDetail(root, taskId);
          const existing = latestTask?.subagents.find((item) => item.id === run.id);
          const mergedWarnings = Array.from(new Set([
            ...(existing?.progress?.warnings ?? []),
            ...persistentRunWarnings,
            ...(run.progress?.warnings ?? []),
          ])).slice(-12);
          recordYpiStudioSubagentRun(root, taskId, {
            ...existing,
            ...run,
            improvementId: existing?.improvementId ?? run.improvementId ?? runningRun.improvementId,
            prompt: run.prompt ?? existing?.prompt ?? runningRun.prompt,
            summary: run.summary ?? existing?.summary ?? runningRun.summary,
            transcript: run.transcript ?? existing?.transcript ?? runningRun.transcript,
            progress: run.progress ? { ...run.progress, warnings: mergedWarnings.length ? mergedWarnings : undefined } : run.progress,
          });
        };
        const persistSdkRunnerFailure = (error: unknown): void => {
          const finishedAt = new Date().toISOString();
          const message = error instanceof Error ? error.message : String(error);
          const terminationReason = error && typeof error === "object" && (error as { preflight?: boolean }).preflight === true ? "sdk_preflight_error" : "sdk_runner_error";
          rememberRunWarning(message);
          let transcript: YpiStudioSubagentTranscriptRef | undefined = writer ? { ...writer.ref, status: "failed" } : undefined;
          if (writer) {
            try { appendYpiStudioSubagentTranscriptItem(writer, { kind: "error", at: finishedAt, text: message }); } catch {}
            try { transcript = finalizeYpiStudioSubagentTranscript(writer, "failed", finishedAt); } catch {}
          }
          const failedRun: YpiStudioTaskSubagentRun = {
            ...runningRun,
            status: "failed",
            finishedAt,
            runner: "sdk",
            summary: oneLine(message, 1000),
            error: oneLine(message, 1000),
            terminationReason,
            progress: {
              ...(runningRun.progress ?? { schemaVersion: 1 as const, phase: "finished" as const, startedAt, eventCount: 0, lastTextPreview: "SDK child runner failed before prompt execution.", itemsPreview: [] }),
              phase: "finished",
              updatedAt: finishedAt,
              lastTextPreview: oneLine(message, 1000),
              warnings: Array.from(persistentRunWarnings).slice(-12),
              terminationReason,
            },
            transcript,
          };
          persistRunSnapshot(failedRun);
          updateYpiStudioChildRun(runId, { status: "failed", progress: failedRun.progress, result: { output: message, status: "failed", transcript, warnings: Array.from(persistentRunWarnings), progress: failedRun.progress!, terminationReason, runner: "sdk" } });
          unregisterYpiStudioChildRun(runId);
        };
        const asyncStartRun = compactSubagentRunForAsyncStart(projectSubagentRun(root, taskId, runningRun, { includeTranscriptPreview: false }));
        const asyncStartWaitHint = { tool: "ypi_studio_wait", taskId, taskKey: taskAfterInitialRun.key, runId, runIds: [runId], until: "child_terminal", recommended: true };
        const asyncStartWarnings = [...policy.warnings, ...warnings];
        onUpdate?.({
          content: [{ type: "text", text: mode === "async" ? `${member} running · model: ${policy.modelLabel} · thinking: ${policy.thinkingLabel} · async child process starting; next call ypi_studio_wait(runId=${runId})` : `${member} running · model: ${policy.modelLabel} · thinking: ${policy.thinkingLabel} · child process starting` }],
          details: mode === "async"
            ? { action: "start", mode: "async", projection: "ypi_studio_subagent_async_start_v1", task: compactYpiStudioTaskIdentity(taskAfterInitialRun), run: asyncStartRun, wait: asyncStartWaitHint, warnings: asyncStartWarnings.length ? asyncStartWarnings : undefined }
            : { run: compactSubagentRunProjection(projectSubagentRun(root, taskId, runningRun)) },
        });
        const childMeta: ChildRunMeta = { runId, taskId, member, startedAt, parentSessionId: getParentSessionContinuationId(inputValue, ctx), parentSessionFile: getParentSessionFile(inputValue, ctx), subtaskId, improvementId, continuationOnFinal: false, runner: runnerSelection.runner };
        const childOnUpdate = mode === "async" ? undefined : onUpdate;
        const childPromise = runnerSelection.runner === "sdk"
          ? runYpiStudioSdkChildSession({
            root,
            prompt: childPrompt,
            policy,
            meta: childMeta,
            writer,
            signal,
            onUpdate: childOnUpdate,
            persistence: {
              onProgress: persistRunSnapshot,
              onFinal: (run) => { persistRunSnapshot(run); },
            },
          }).catch((error) => {
            const isPreflight = error && typeof error === "object" && (error as { preflight?: boolean }).preflight === true;
            if (runnerSelection.configured !== "auto" || !isPreflight) {
              persistSdkRunnerFailure(error);
              throw error;
            }
            const fallbackWarning = error instanceof Error ? error.message : String(error);
            const fallbackSummary = `${fallbackWarning}; falling back to bundled CLI runner because studio.subagents.runner=auto and no child prompt was executed.`;
            rememberRunWarning(fallbackSummary);
            if (writer) {
              writer.ref.runner = "cli";
              try { appendYpiStudioSubagentTranscriptItem(writer, { kind: "status", at: new Date().toISOString(), text: fallbackSummary }); } catch {}
            }
            const fallbackRun: YpiStudioTaskSubagentRun = { ...runningRun, runner: "cli", summary: `SDK child runner preflight failed; falling back to CLI child process. ${oneLine(fallbackWarning, 500)}`, progress: runningRun.progress ? { ...runningRun.progress, warnings: Array.from(persistentRunWarnings).slice(-12), lastTextPreview: "SDK preflight failed; CLI fallback starting." } : undefined };
            persistRunSnapshot(fallbackRun);
            return runChildPi(
              root,
              childPrompt,
              policy,
              { ...childMeta, runner: "cli", childSessionId: undefined, childSessionFile: undefined, requestAffinity: undefined },
              writer,
              signal,
              childOnUpdate,
              {
                onProgress: persistRunSnapshot,
                onFinal: (run) => { persistRunSnapshot(run); },
              },
            );
          })
          : runChildPi(
            root,
            childPrompt,
            policy,
            childMeta,
            writer,
            signal,
            childOnUpdate,
            {
              onProgress: persistRunSnapshot,
              onFinal: (run) => { persistRunSnapshot(run); },
            },
          );
        if (runnerSelection.runner === "sdk" && !getYpiStudioChildRun(runId)) {
          registerYpiStudioChildRun({
            runId,
            taskId,
            subtaskId,
            member,
            cwd: root,
            parentSessionId: childMeta.parentSessionId,
            runner: "sdk",
            startedAt,
            status: "running",
            progress: runningRun.progress,
            promise: childPromise,
            abort: () => {},
          });
        }
        if (mode === "async") {
          childPromise.catch(() => {});
          return {
            content: [{ type: "text", text: `Started async YPI Studio subagent ${member} run ${runId}${improvementId ? ` for improvement ${improvementId}` : ""}${subtaskId ? ` subtask ${subtaskId}` : ""}. Next call ypi_studio_wait(runId=${runId}) so the main chat waits for the child result and continues from the tool result; action=poll or action=collect with runId remains available.` }],
            details: { action: "start", mode: "async", projection: "ypi_studio_subagent_async_start_v1", task: compactYpiStudioTaskIdentity(taskAfterInitialRun), run: asyncStartRun, wait: asyncStartWaitHint, warnings: asyncStartWarnings.length ? asyncStartWarnings : undefined },
          };
        }
        const result = await childPromise;
        const finishedAt = new Date().toISOString();
        const allWarnings = [...policy.warnings, ...warnings, ...result.warnings];
        const run: YpiStudioTaskSubagentRun = {
          id: runId,
          member,
          subtaskId,
          improvementId,
          status: result.status,
          startedAt,
          finishedAt,
          runner: result.runner ?? "cli",
          childSessionId: result.childSessionId,
          childSessionFile: result.childSessionFile,
          requestAffinity: result.requestAffinity,
          prompt: oneLine(prompt, 240),
          summary: oneLine(result.output, 1000),
          model: policy.modelLabel,
          thinking: policy.thinkingLabel,
          modelSource: policy.modelSource,
          thinkingSource: policy.thinkingSource,
          policy: policy.diagnostics,
          progress: result.progress,
          terminationReason: result.terminationReason,
          error: result.status === "failed" || result.status === "cancelled" ? oneLine(result.output, 1000) : undefined,
          transcript: result.transcript,
        };
        const task = recordYpiStudioSubagentRun(root, taskId, run);
        return { content: [{ type: "text", text: result.output }], details: { action: "start", mode: "sync", task: compactYpiStudioTaskForTool(root, task), run: compactSubagentRunProjection(projectSubagentRun(root, taskId, run)), warnings: allWarnings.length ? allWarnings : undefined }, isError: result.status === "failed" || result.status === "cancelled" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
      }
    },
  });

  pi.registerTool?.({
    name: "ypi_studio_wait",
    label: "YPI Studio Wait",
    description: "Wait for YPI Studio child runs to reach a terminal state and return a compact result to the main chat.",
    promptSnippet: "Use ypi_studio_wait after starting async YPI Studio subagents so the main chat waits for their results instead of relying on background continuation.",
    promptGuidelines: [
      "After ypi_studio_subagent(action=start, mode=async), call ypi_studio_wait with the returned runId(s) unless you are explicitly only reporting that background work has started.",
      "ypi_studio_wait streams compact progress via onUpdate and returns terminal run summaries; continue orchestration from its result.",
      "If wait returns still_running due to timeout, tell the user Studio is still working or call ypi_studio_wait again with an appropriate timeout.",
    ],
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        runId: { type: "string" },
        runIds: { type: "array", items: { type: "string" } },
        until: { type: "string", enum: ["child_terminal", "next_orchestration_step"], description: "Defaults to child_terminal; next_orchestration_step currently waits for child terminal and returns orchestration hints." },
        timeoutMs: { type: "number", description: "Maximum wait time. Defaults to 30 minutes, capped at 60 minutes." },
        pollIntervalMs: { type: "number", description: "Polling interval. Defaults to 2000ms." },
      },
    },
    execute: async (_id: string, inputValue: unknown, signal?: AbortSignal, onUpdate?: ToolUpdateCallback, ctx?: PiExtensionContext): Promise<PiToolResult> => {
      const input = normalizeWaitInput(inputValue);
      const key = getKey(input, ctx);
      const taskId = currentTaskIdOrThrow(root, key, input.taskId);
      const requestedRunIds = input.runIds?.length ? input.runIds : input.runId ? [input.runId] : [];
      const timeoutMs = input.timeoutMs ?? 30 * 60_000;
      const pollIntervalMs = input.pollIntervalMs ?? 2_000;
      const startedAt = Date.now();
      const terminalStatuses = new Set<YpiStudioTaskSubagentRun["status"]>(["succeeded", "failed", "cancelled", "waiting_for_user"]);
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const resolveRuns = () => {
        const detail = getYpiStudioTaskDetail(root, taskId);
        if (!detail) throw new Error("Task not found");
        const sourceRuns = requestedRunIds.length
          ? requestedRunIds.map((id) => {
            const run = detail.subagents.find((item) => item.id === id);
            if (!run) throw new Error(`Studio subagent run not found: ${id}`);
            return run;
          })
          : detail.subagents.filter((run) => run.status === "queued" || run.status === "running");
        return { detail, runs: sourceRuns };
      };

      while (true) {
        if (signal?.aborted) {
          return { content: [{ type: "text", text: "YPI Studio wait cancelled by parent session." }], details: { taskId, runIds: requestedRunIds, status: "cancelled" }, isError: true };
        }
        const { detail, runs } = resolveRuns();
        const projected = runs.map((run) => projectSubagentRun(root, taskId, run, { includeTranscriptPreview: false }));
        const terminal = projected.filter((run) => terminalStatuses.has(run.status));
        const running = projected.filter((run) => !terminalStatuses.has(run.status));
        const compactRuns = projected.map(compactSubagentRunForWait);
        const firstRun = compactRuns[0];
        const compactTask = compactYpiStudioTaskForWait(detail);
        const statusText = projected.length
          ? projected.map((run) => `${run.runId}=${run.status}`).join(", ")
          : "no active Studio subagent run";
        onUpdate?.({
          content: [{ type: "text", text: `Waiting for YPI Studio run(s): ${statusText}` }],
          details: { action: "wait", task: compactTask, runs: compactRuns, run: firstRun, status: running.length ? "waiting" : "terminal" },
        });
        if (!requestedRunIds.length && projected.length === 0) {
          return {
            content: [{ type: "text", text: "No active YPI Studio subagent run is currently waiting." }],
            details: { action: "wait", task: compactTask, runs: [], status: "no_active_runs", nextRecommendedAction: buildNextStudioTaskAction(detail) },
          };
        }
        if (projected.length > 0 && running.length === 0) {
          const failed = terminal.filter((run) => run.status === "failed" || run.status === "cancelled" || run.status === "waiting_for_user");
          const text = `YPI Studio wait complete: ${statusText}. Next: ${buildNextStudioTaskAction(detail)}`;
          return {
            content: [{ type: "text", text }],
            details: { action: "wait", task: compactTask, runs: compactRuns, run: firstRun, status: "terminal", nextRecommendedAction: buildNextStudioTaskAction(detail) },
            isError: failed.length > 0,
          };
        }
        if (Date.now() - startedAt >= timeoutMs) {
          return {
            content: [{ type: "text", text: `YPI Studio wait timed out; still running: ${statusText}` }],
            details: { action: "wait", task: compactTask, runs: compactRuns, run: firstRun, status: "still_running", timeoutMs },
          };
        }
        await sleep(pollIntervalMs);
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
