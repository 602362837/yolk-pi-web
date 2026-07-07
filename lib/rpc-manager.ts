import { createHash } from "crypto";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { cleanupSessionResources } from "@earendil-works/pi-ai";
import { cacheSessionPath } from "./session-reader";
import { recordSessionFileChangeEvent } from "./session-file-changes";
import { canonicalizeCwd } from "./cwd";
import { createYpiStudioExtension } from "./ypi-studio-extension";
import { createBrowserShareExtension } from "./browser-share-extension";
import {
  abortYpiStudioChildRunsForSession,
  countActiveYpiStudioChildRunsForSession,
  registerYpiStudioSessionContinuation,
  unregisterYpiStudioSessionContinuation,
  type YpiStudioChildRunContinuationPayload,
} from "./ypi-studio-subagent-runtime";
import { attemptChatGptAccountFailover, getActiveOpenAICodexAccountId, type ChatGptAccountFailoverTurnBudget } from "./chatgpt-account-failover";
import type { AgentSessionLike, ToolInfo } from "./pi-types";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

const ABORT_WAIT_TIMEOUT_MS = 3_000;
const STUDIO_CONTINUATION_RETRY_MS = 2_000;
const STUDIO_FOLLOW_UP_RETRY_MS = 2_000;
const STUDIO_FOLLOW_UP_MAX_RETRIES = 10;

function sanitizeYpiStudioContextId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) || "session";
}

function hashYpiStudioContext(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function ypiStudioContinuationKeys(sessionId: string, sessionFile?: string): string[] {
  return [
    sessionId,
    `pi_${sanitizeYpiStudioContextId(sessionId)}`,
    sessionFile ? `pi_transcript_${hashYpiStudioContext(sessionFile)}` : "",
  ].filter(Boolean);
}

function buildYpiStudioReadyContinuationPrompt(input: { taskId: string; readySubtaskCount?: number; availableSlots?: number; completionReady?: boolean; checkingReady?: boolean; checkerRunId?: string; checkerStatus?: string; checkerSummary?: string; reason?: string }): string {
  if (input.checkingReady) {
    return [
      "YPI Studio checker 子代理已结束，请继续自动收口，不要等待用户输入。",
      "",
      `- taskId: ${input.taskId}`,
      input.checkerRunId ? `- checkerRunId: ${input.checkerRunId}` : undefined,
      input.checkerStatus ? `- checkerStatus: ${input.checkerStatus}` : undefined,
      input.checkerSummary ? `- checkerSummary: ${input.checkerSummary}` : undefined,
      input.reason ? `- reason: ${input.reason}` : undefined,
      "",
      "请按现有 Studio 状态机继续：先调用 ypi_studio_subagent(action=collect, runId=<checkerRunId>) 幂等收集 checker 结果，再读取 ypi_studio_task(action=current) 的默认 compact 摘要。若 checker 通过且无 remaining/needs-work 项，transition 到 completed 并总结；若 checker 指出 needs work / blocker / remaining findings，不要假装完成，说明需要处理的问题并按工作流回到 implementing 或请求用户决策。不要为了收口读取 full detail。",
    ].filter(Boolean).join("\n");
  }
  return [
    input.completionReady
      ? "YPI Studio implementationPlan 子任务已全部完成且没有活跃 run，请继续自动收口，不要等待用户输入。"
      : "YPI Studio implementationPlan 仍有 ready 子任务且存在空闲并发槽，请继续自动推进，不要等待用户输入。",
    "",
    `- taskId: ${input.taskId}`,
    typeof input.readySubtaskCount === "number" ? `- readySubtaskCount: ${input.readySubtaskCount}` : undefined,
    typeof input.availableSlots === "number" ? `- availableSlots: ${input.availableSlots}` : undefined,
    input.completionReady ? "- completionReady: true" : undefined,
    input.reason ? `- reason: ${input.reason}` : undefined,
    "",
    input.completionReady
      ? "请按现有 Studio 状态机继续：优先使用注入摘要和 ypi_studio_task(action=current) 的默认 compact 摘要确认状态；若 task 仍是 implementing 且全部 implementation subtasks 都 done/skipped、无 active run，自动 transition 到 checking，并派发 checker；检查完成后按工作流完成或说明需要用户处理。不要为了收口读取 full detail。"
      : "请按现有 Studio 状态机继续：先调用 ypi_studio_task(action=current) 或 ypi_studio_task(action=get, taskId=<上面的 taskId>) 获取默认 compact 摘要；若 task 仍是 implementing，调用 implementation_next(limit=<available slots>)，claim ready 子任务，并为每个 claimed subtaskId 启动一个 async implementer，直到 maxConcurrency 填满或无 ready。每个 implementer run 只处理一个 subtaskId。只有 compact 摘要不足时才请求 full detail。",
  ].filter(Boolean).join("\n");
}

function buildYpiStudioChildContinuationPrompt(payload: YpiStudioChildRunContinuationPayload): string {
  return [
    "YPI Studio 并行子任务已结束，请继续推进当前 Studio implementationPlan。",
    "",
    `- taskId: ${payload.taskId}`,
    `- runId: ${payload.runId}`,
    payload.subtaskId ? `- subtaskId: ${payload.subtaskId}` : undefined,
    `- member: ${payload.member}`,
    `- status: ${payload.status}`,
    payload.summary ? `- summary: ${payload.summary}` : undefined,
    "",
    "请按现有 Studio 状态机继续，不要停下来等用户输入：",
    "1. 先调用 ypi_studio_subagent(action=collect, runId=<上面的 runId>) 刷新/确认结果；如当前 task 还有其他 terminal async run，也一并 collect。",
    "2. 重新读取当前 task / implementationProgress 的默认 compact 摘要。若出现 failed、cancelled、waiting_for_user、blocked 或需要产品/人工决策的结果，停止派发新子任务并用人话说明需要用户处理；只有 compact 摘要不足时才请求 full detail。",
    "3. 若 task 仍是 implementing，必须按 maxConcurrency 补足所有空闲并发槽：计算 availableSlots=maxConcurrency-(running+queued)，调用 ypi_studio_task(action=implementation_next, limit=availableSlots) 查看 ready batch；若返回多个 ready，使用 ypi_studio_task(action=claim_implementation_subtask, limit=availableSlots, status=running) 或对这些 ready id 连续 claim，随后为每个 claimed subtaskId 各启动一个 ypi_studio_subagent(action=start, mode=async, member=implementer, subtaskId=<该子任务id>)，直到槽位满或无 ready。每个 implementer run 只处理一个 subtaskId，但同一轮必须派发多个 run 来填满并发槽。不要重复 claim/dispatch already queued/running/done 的子任务。",
    "4. 若全部 implementation subtasks 都 done/skipped 且无 active run，自动将任务 transition 到 checking，并派发 checker；检查完成后按现有工作流完成/请求用户处理。",
    "5. 严格遵守 awaiting_approval -> implementing 的服务器 approval gate；如果 task 未处于 implementing，不要 claim 或派发 implementer。",
  ].filter(Boolean).join("\n");
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private studioAutoContinueKeys = new Map<string, number>();
  private _alive = true;

  constructor(public readonly inner: AgentSessionLike, public readonly cwd: string) {
    this.patchChatGptAccountFailover();
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  private emitEvent(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private patchChatGptAccountFailover(): void {
    const inner = this.inner as AgentSessionLike & {
      _handlePostAgentRun?: () => Promise<boolean>;
      _runAgentPrompt?: (...args: unknown[]) => Promise<void>;
      _lastAssistantMessage?: unknown;
      _piWebChatGptFailoverPatched?: boolean;
    };
    const innerAny = inner as unknown as {
      agent?: { state?: { messages?: unknown[] } };
      model?: { provider?: string };
    };
    if (inner._piWebChatGptFailoverPatched || typeof inner._handlePostAgentRun !== "function") return;
    inner._piWebChatGptFailoverPatched = true;
    const original = inner._handlePostAgentRun.bind(inner);
    const originalRunAgentPrompt = typeof inner._runAgentPrompt === "function" ? inner._runAgentPrompt.bind(inner) : null;
    const budget: ChatGptAccountFailoverTurnBudget = { attempts: 0, switches: 0 };
    let runTriggerAccountId: string | null = null;

    if (originalRunAgentPrompt) {
      inner._runAgentPrompt = async (...args: unknown[]) => {
        runTriggerAccountId = innerAny.model?.provider === "openai-codex"
          ? await getActiveOpenAICodexAccountId().catch(() => null)
          : null;
        try {
          await originalRunAgentPrompt(...args);
        } finally {
          runTriggerAccountId = null;
        }
      };
    }

    inner._handlePostAgentRun = async () => {
      const assistantMessage = inner._lastAssistantMessage as { role?: string; stopReason?: string } | undefined;
      const shouldContinue = await original();
      if (shouldContinue) return true;

      if (assistantMessage?.role === "assistant" && assistantMessage.stopReason === "error") {
        const result = await attemptChatGptAccountFailover({
          provider: innerAny.model?.provider,
          message: assistantMessage,
          budget,
          reloadAuthState: reloadRpcAuthState,
          triggerAccountId: runTriggerAccountId,
        });
        if (result.status !== "not_openai_codex" && result.status !== "not_quota_error" && result.status !== "disabled") {
          this.emitEvent({ type: "chatgpt_account_failover", sessionId: this.sessionId, ...result });
        }
        if (result.retry) {
          const messages = innerAny.agent?.state?.messages;
          if (Array.isArray(messages) && messages[messages.length - 1] === assistantMessage && innerAny.agent?.state) {
            innerAny.agent.state.messages = messages.slice(0, -1);
          }
          return true;
        }
      }

      if (assistantMessage?.stopReason && assistantMessage.stopReason !== "error") {
        budget.attempts = 0;
        budget.switches = 0;
      }
      return false;
    };
  }

  start(): void {
    for (const key of ypiStudioContinuationKeys(this.sessionId, this.sessionFile)) {
      registerYpiStudioSessionContinuation(key, (payload) => this.scheduleStudioChildContinuation(payload));
    }
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      let fileChangeUpdate: AgentEvent | null = null;
      try {
        const result = recordSessionFileChangeEvent({
          sessionId: this.sessionId,
          sessionFile: this.sessionFile,
          cwd: this.cwd,
          event,
        });
        if (result.changed && event.type === "tool_execution_end") {
          fileChangeUpdate = {
            type: "session_file_changes_update",
            sessionId: this.sessionId,
            fileCount: result.fileCount,
          };
        }
      } catch {
        // File-change projection must never interrupt normal agent event delivery.
      }
      const deliveredEvent = event.type === "agent_end"
        ? { ...event, studioChildRunCount: countActiveYpiStudioChildRunsForSession(this.sessionId) }
        : event;
      for (const l of this.listeners) l(deliveredEvent);
      if (fileChangeUpdate) {
        for (const l of this.listeners) l(fileChangeUpdate);
      }
    });
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.handleIdleTimeout(), 10 * 60 * 1000);
  }

  private handleIdleTimeout(): void {
    if (!this._alive) return;
    if (countActiveYpiStudioChildRunsForSession(this.sessionId) > 0) {
      this.resetIdleTimer();
      return;
    }
    this.destroy();
  }

  private async scheduleStudioFollowUp(prompt: string, attempt = 0): Promise<boolean> {
    if (!this._alive) return false;
    this.resetIdleTimer();
    if (this.inner.isStreaming) {
      if (attempt >= STUDIO_FOLLOW_UP_MAX_RETRIES) {
        this.emitEvent({ type: "studio_continuation_failed", sessionId: this.sessionId });
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, STUDIO_CONTINUATION_RETRY_MS));
      return this.scheduleStudioFollowUp(prompt, attempt + 1);
    }
    try {
      // Use a normal prompt for Studio auto-continuation. Some pi followUp()
      // paths can report acceptance without appending a new turn when the
      // wrapper was restored outside the original run; prompt() gives us the
      // same durable user-message path as explicit user input.
      await this.inner.prompt(prompt);
      return true;
    } catch {
      if (attempt >= STUDIO_FOLLOW_UP_MAX_RETRIES) {
        this.emitEvent({ type: "studio_continuation_failed", sessionId: this.sessionId });
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, STUDIO_FOLLOW_UP_RETRY_MS));
      return this.scheduleStudioFollowUp(prompt, attempt + 1);
    }
  }

  private scheduleStudioChildContinuation(payload: YpiStudioChildRunContinuationPayload): Promise<boolean> | boolean {
    if (!this._alive || !ypiStudioContinuationKeys(this.sessionId, this.sessionFile).includes(payload.parentSessionId)) return false;
    return this.scheduleStudioFollowUp(buildYpiStudioChildContinuationPrompt(payload));
  }

  private scheduleStudioReadyContinuation(input: { taskId: string; readySubtaskCount?: number; availableSlots?: number; completionReady?: boolean; checkingReady?: boolean; checkerRunId?: string; checkerStatus?: string; checkerSummary?: string; stateKey?: string; reason?: string }): { queued: boolean; skippedReason?: string } {
    if (!this._alive) return { queued: false, skippedReason: "session_not_alive" };
    this.resetIdleTimer();
    const key = `${input.taskId}:${input.stateKey ?? "ready"}`;
    const now = Date.now();
    const last = this.studioAutoContinueKeys.get(key) ?? 0;
    if (now - last < 30_000) return { queued: false, skippedReason: "recently_queued" };
    this.studioAutoContinueKeys.set(key, now);
    this.scheduleStudioFollowUp(buildYpiStudioReadyContinuationPrompt(input));
    return { queued: true };
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.inner.prompt(command.message as string, promptImages?.length ? { images: promptImages } : undefined).catch(() => {});
        return null;
      }

      case "abort": {
        const abortedChildren = abortYpiStudioChildRunsForSession(this.sessionId, "parent_abort");
        const abortResult = await Promise.race([
          this.inner.abort().then(() => ({ timedOut: false as const }), (error: unknown) => ({ timedOut: false as const, error })),
          new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), ABORT_WAIT_TIMEOUT_MS)),
        ]);
        if ("error" in abortResult) throw abortResult.error;
        return { abortedChildren, abortTimedOut: abortResult.timedOut };
      }

      case "studio_autocontinue": {
        const taskId = typeof command.taskId === "string" ? command.taskId : "";
        if (!taskId) throw new Error("taskId is required");
        return this.scheduleStudioReadyContinuation({
          taskId,
          readySubtaskCount: typeof command.readySubtaskCount === "number" ? command.readySubtaskCount : undefined,
          availableSlots: typeof command.availableSlots === "number" ? command.availableSlots : undefined,
          completionReady: command.completionReady === true,
          checkingReady: command.checkingReady === true,
          checkerRunId: typeof command.checkerRunId === "string" ? command.checkerRunId : undefined,
          checkerStatus: typeof command.checkerStatus === "string" ? command.checkerStatus : undefined,
          checkerSummary: typeof command.checkerSummary === "string" ? command.checkerSummary : undefined,
          stateKey: typeof command.stateKey === "string" ? command.stateKey : undefined,
          reason: typeof command.reason === "string" ? command.reason : undefined,
        });
      }

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          studioChildRunCount: countActiveYpiStudioChildRunsForSession(this.sessionId),
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: 0,
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        // pi's compact() does not guard against empty messagesToSummarize — use findCutPoint
        // to pre-check and throw a clean error instead of generating a useless empty summary.
        const { findCutPoint, DEFAULT_COMPACTION_SETTINGS } = await import("@earendil-works/pi-coding-agent");
        const pathEntries = this.inner.sessionManager.getBranch() as Array<{ type: string }>;
        const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...this.inner.settingsManager.getCompactionSettings() };
        let prevCompactionIndex = -1;
        for (let i = pathEntries.length - 1; i >= 0; i--) {
          if (pathEntries[i].type === "compaction") { prevCompactionIndex = i; break; }
        }
        const boundaryStart = prevCompactionIndex + 1;
        const cutPoint = findCutPoint(pathEntries as never, boundaryStart, pathEntries.length, settings.keepRecentTokens);
        const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
        if (historyEnd <= boundaryStart) {
          throw new Error("Conversation too short to compact");
        }
        const result = await this.inner.compact(command.customInstructions as string | undefined);
        return result;
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "set_tools": {
        this.inner.setActiveToolsByName(command.toolNames as string[]);
        return null;
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const key of ypiStudioContinuationKeys(this.sessionId, this.sessionFile)) {
      unregisterYpiStudioSessionContinuation(key);
    }
    abortYpiStudioChildRunsForSession(this.sessionId, "session_destroy");
    this.unsubscribe?.();
    try {
      this.inner.dispose?.();
    } catch {
      // Dispose is best-effort; registry cleanup must still run.
    }
    this.onDestroyCallback?.();
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function reloadRpcAuthState(): number {
  let count = 0;
  for (const wrapper of getRegistry().values()) {
    if (!wrapper.isAlive()) continue;
    try {
      wrapper.inner.modelRegistry.authStorage?.reload?.();
      wrapper.inner.modelRegistry.refresh?.();
      count += 1;
    } catch {
      // Keep account activation best-effort for live wrappers; new requests/sessions
      // still read the updated auth.json through fresh AuthStorage instances.
    }
  }

  try {
    // OpenAI Codex keeps reusable WebSockets keyed by session id. After account
    // activation, old sessions must reconnect so the new token/account headers apply.
    cleanupSessionResources();
  } catch {
    // Auth reload should remain best-effort; stale resources expire on their own.
  }

  return count;
}

export function destroyRpcSessionsForCwd(cwd: string): string[] {
  const target = canonicalizeCwd(cwd);
  const destroyed: string[] = [];
  for (const [sessionId, wrapper] of getRegistry()) {
    if (canonicalizeCwd(wrapper.cwd) !== target) continue;
    wrapper.destroy();
    destroyed.push(sessionId);
  }
  return destroyed;
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[]
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const { SessionManager, getAgentDir, DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      extensionFactories: [createYpiStudioExtension(cwd, {
        sessionId: sessionManager.getSessionId(),
        sessionFile: sessionManager.getSessionFile() ?? undefined,
      }), createBrowserShareExtension()],
    });
    await resourceLoader.reload();

    // Do NOT pass the `tools` parameter to createAgentSession.
    // The `tools` param acts as a global allowlist that filters out extension
    // tools (e.g. `subagent` from pi-subagents). Instead, let all built-in and
    // extension tools load, then control activation via setActiveToolsByName.
    const { session: inner } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      resourceLoader,
    });

    // If specific tool names were requested (non-empty), narrow active tools now
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(toolNames);
    }

    // When all tools are disabled, deactivate everything and clear system prompt.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // the only way to truly clear it is to call agent.setSystemPrompt directly.
    if (toolNames?.length === 0) {
      inner.setActiveToolsByName([]);
      inner.agent.state.systemPrompt = "";
    }

    const wrapper = new AgentSessionWrapper(inner, cwd);
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
