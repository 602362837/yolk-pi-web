import { createHash } from "crypto";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { cleanupSessionResources } from "@earendil-works/pi-ai";
import { cacheSessionPath } from "./session-reader";
import { readSessionHeaderFromFile, writeSessionProjectLink } from "./session-project-link";
import { upsertProjectSessionIndexEntry } from "./project-session-index";
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
import { attemptOpencodeGoAccountFailover, getActiveOpencodeGoAccountId, type OpencodeGoFailoverTurnBudget } from "./opencode-go-account-failover";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
import {
  isBudgetExpired,
  type AgentSessionDiagnosticSample,
  type DiagnosticBudget,
  type DiagnosticLimits,
  type OpenAICodexStatsDiagnostic,
  type RpcRuntimeDiagnostic,
} from "./memory-diagnostics-types";
import { getOpenAICodexWebSocketDebugStats } from "@earendil-works/pi-ai/api/openai-codex-responses";

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

// ---------------------------------------------------------------------------
// Memory diagnostic projection helpers (read-only, bounded, no content copy)
// ---------------------------------------------------------------------------

interface ContentTallyState {
  totalChars: number;
  totalBytes: number;
  maxLen: number;
  truncated: boolean;
}

/**
 * Tally role/content-type counts and string length/byte estimates for one
 * agent message without copying its content. Only `.text` / `.thinking`
 * string lengths are measured (for a retained-content estimate); tool call
 * inputs, image data/urls and tool result objects are never copied or
 * serialized into the projection.
 *
 * Content-block scan caps are enforced **per message** (not across the
 * whole session): at most `limits.maxContentBlocksPerMessage` blocks are
 * inspected for each message, matching the diagnostic design contract.
 */
function tallyMessageContent(
  message: unknown,
  limits: DiagnosticLimits,
  roleCounts: Record<string, number>,
  contentTypeCounts: Record<string, number>,
  state: ContentTallyState,
): void {
  if (!message || typeof message !== "object") return;
  const role = (message as { role?: unknown }).role;
  if (typeof role === "string") roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    contentTypeCounts["text"] = (contentTypeCounts["text"] ?? 0) + 1;
    state.totalChars += content.length;
    state.totalBytes += Buffer.byteLength(content, "utf8");
    state.maxLen = Math.max(state.maxLen, content.length);
    return;
  }
  if (!Array.isArray(content)) return;
  // Per-message block counter: reset for every message so a large early
  // message cannot starve later messages of length estimates.
  let blocksScanned = 0;
  for (const block of content) {
    if (blocksScanned >= limits.maxContentBlocksPerMessage) {
      state.truncated = true;
      break;
    }
    blocksScanned += 1;
    if (!block || typeof block !== "object") {
      contentTypeCounts["unknown"] = (contentTypeCounts["unknown"] ?? 0) + 1;
      continue;
    }
    const type = (block as { type?: unknown }).type;
    const typeKey = typeof type === "string" ? type : "unknown";
    contentTypeCounts[typeKey] = (contentTypeCounts[typeKey] ?? 0) + 1;
    // Only measure string payloads for length estimates; never read tool
    // input/result objects, image data/url fields, or other nested content.
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string") {
      state.totalChars += text.length;
      state.totalBytes += Buffer.byteLength(text, "utf8");
      state.maxLen = Math.max(state.maxLen, text.length);
    }
    const thinking = (block as { thinking?: unknown }).thinking;
    if (typeof thinking === "string") {
      state.totalChars += thinking.length;
      state.totalBytes += Buffer.byteLength(thinking, "utf8");
      state.maxLen = Math.max(state.maxLen, thinking.length);
    }
  }
}

/**
 * Project the public OpenAI Codex WebSocket debug stats for a known active
 * session id into a numeric/boolean-only shape. `lastPreviousResponseId` and
 * `lastWebSocketError` are intentionally omitted (response id / error strings
 * are not safe to persist). This is a known-session projection, not an
 * enumeration of the SDK's private WebSocket cache.
 */
function projectOpenAICodexStats(sessionId: string): OpenAICodexStatsDiagnostic | undefined {
  try {
    const stats = getOpenAICodexWebSocketDebugStats(sessionId);
    if (!stats) return undefined;
    return {
      requests: stats.requests,
      connectionsCreated: stats.connectionsCreated,
      connectionsReused: stats.connectionsReused,
      cachedContextRequests: stats.cachedContextRequests,
      storeTrueRequests: stats.storeTrueRequests,
      fullContextRequests: stats.fullContextRequests,
      deltaRequests: stats.deltaRequests,
      lastInputItems: stats.lastInputItems,
      lastDeltaInputItems: stats.lastDeltaInputItems,
      websocketFailures: stats.websocketFailures,
      sseFallbacks: stats.sseFallbacks,
      websocketFallbackActive: stats.websocketFallbackActive,
    };
  } catch {
    return undefined;
  }
}

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
    this.patchOpencodeGoAccountFailover();
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
      _piWebOpencodeGoFailoverPatched?: boolean;
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

  private patchOpencodeGoAccountFailover(): void {
    const inner = this.inner as AgentSessionLike & {
      _handlePostAgentRun?: () => Promise<boolean>;
      _runAgentPrompt?: (...args: unknown[]) => Promise<void>;
      _lastAssistantMessage?: unknown;
      _piWebChatGptFailoverPatched?: boolean;
      _piWebOpencodeGoFailoverPatched?: boolean;
    };
    const innerAny = inner as unknown as {
      agent?: { state?: { messages?: unknown[] } };
      model?: { provider?: string };
    };
    if (inner._piWebOpencodeGoFailoverPatched || typeof inner._handlePostAgentRun !== "function") return;
    inner._piWebOpencodeGoFailoverPatched = true;

    // Wrap the current _handlePostAgentRun (which already includes the ChatGPT
    // failover patch if it was applied).  The chain is:
    //   opencode-go → chatgpt → original pi SDK
    const originalPostRun = inner._handlePostAgentRun.bind(inner);
    const originalRunAgentPrompt =
      typeof inner._runAgentPrompt === "function"
        ? inner._runAgentPrompt.bind(inner)
        : null;

    const budget: OpencodeGoFailoverTurnBudget = {
      attempts: 0,
      switches: 0,
      attemptedAccountIds: [],
    };
    let runTriggerAccountId: string | null = null;

    // Capture the active opencode-go account before each run so the failover
    // can later compare against "the account the failing request was bound to".
    if (originalRunAgentPrompt) {
      inner._runAgentPrompt = async (...args: unknown[]) => {
        runTriggerAccountId =
          innerAny.model?.provider === "opencode-go"
            ? await getActiveOpencodeGoAccountId().catch(() => null)
            : null;
        try {
          await originalRunAgentPrompt(...args);
        } finally {
          runTriggerAccountId = null;
        }
      };
    }

    inner._handlePostAgentRun = async () => {
      // Capture the assistant message before the inner chain clears it.
      const assistantMessage = inner._lastAssistantMessage as
        | { role?: string; stopReason?: string }
        | undefined;

      const shouldContinue = await originalPostRun();
      if (shouldContinue) return true;

      // Native retry / compaction / ChatGPT failover already returned false.
      // Only try opencode-go failover when we have an explicit error.
      if (
        assistantMessage?.role === "assistant" &&
        assistantMessage.stopReason === "error"
      ) {
        const result = await attemptOpencodeGoAccountFailover({
          provider: innerAny.model?.provider,
          message: assistantMessage,
          budget,
          reloadAuthState: reloadRpcAuthState,
          triggerAccountId: runTriggerAccountId,
        });

        // Emit events for actionable statuses; skip trivial ones so the
        // UI doesn't get flooded for every non-opencode-go / non-eligible error.
        if (
          result.status !== "not_opencode_go" &&
          result.status !== "not_eligible" &&
          result.status !== "disabled"
        ) {
          this.emitEvent({
            type: "opencode_go_account_failover",
            sessionId: this.sessionId,
            ...result,
          });
        }

        if (result.retry) {
          // Remove the failed assistant message from agent state so pi retries
          // the same turn with the new active account.
          const messages = innerAny.agent?.state?.messages;
          if (
            Array.isArray(messages) &&
            messages[messages.length - 1] === assistantMessage &&
            innerAny.agent?.state
          ) {
            innerAny.agent.state.messages = messages.slice(0, -1);
          }
          return true;
        }
      }

      // Successful turn (non-error stopReason): reset the per-turn budget.
      if (
        assistantMessage?.stopReason &&
        assistantMessage.stopReason !== "error"
      ) {
        budget.attempts = 0;
        budget.switches = 0;
        budget.attemptedAccountIds = [];
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

  /**
   * Bounded, read-only memory diagnostic projection of this wrapper. Only
   * counts/lengths/ids/state flags are returned; message content, tool args /
   * results, system prompt text, and Codex response ids / error strings are
   * never copied into the projection. Mutates nothing.
   */
  projectDiagnostic(budget: DiagnosticBudget, limits: DiagnosticLimits): AgentSessionDiagnosticSample {
    const model = this.inner.model;
    const roleCounts: Record<string, number> = {};
    const contentTypeCounts: Record<string, number> = {};
    const tally: ContentTallyState = {
      totalChars: 0,
      totalBytes: 0,
      maxLen: 0,
      truncated: false,
    };
    let branchEntryCount = 0;
    let agentMessageCount = 0;
    let truncated = false;
    try {
      let entries: unknown[];
      try {
        entries = this.inner.sessionManager.getEntries() as unknown[];
      } catch {
        entries = [];
      }
      for (let i = 0; i < entries.length; i += 1) {
        if (branchEntryCount >= limits.maxBranchEntriesPerSession) { truncated = true; break; }
        if (isBudgetExpired(budget)) { truncated = true; break; }
        branchEntryCount += 1;
        const entry = entries[i] as { type?: unknown; message?: unknown } | null;
        if (!entry || entry.type !== "message") continue;
        if (agentMessageCount >= limits.maxMessagesPerSession) { truncated = true; break; }
        agentMessageCount += 1;
        tallyMessageContent(entry.message, limits, roleCounts, contentTypeCounts, tally);
      }
    } catch {
      // Keep whatever partial counts we have; never throw the whole snapshot.
    }
    const sample: AgentSessionDiagnosticSample = {
      sessionId: this.sessionId,
      cwd: this.cwd,
      sessionFile: this.sessionFile,
      provider: model?.provider,
      model: model?.id,
      alive: this._alive,
      isStreaming: this.inner.isStreaming,
      isCompacting: this.inner.isCompacting,
      listenerCount: this.listeners.length,
      hasIdleTimer: this.idleTimer !== null,
      studioChildCount: countActiveYpiStudioChildRunsForSession(this.sessionId),
      branchEntryCount,
      agentMessageCount,
      roleCounts,
      contentTypeCounts,
      totalContentChars: tally.totalChars,
      totalContentBytes: tally.totalBytes,
      maxSingleContentLength: tally.maxLen,
      systemPromptLength: this.inner.agent.state?.systemPrompt?.length ?? 0,
      activeToolCount: this.inner.getActiveToolNames().length,
      truncated: truncated || tally.truncated,
    };
    if (model?.provider === "openai-codex") {
      const stats = projectOpenAICodexStats(this.sessionId);
      if (stats) sample.openaiCodexStats = stats;
    }
    return sample;
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        // Start the turn asynchronously, but wait for pi's preflight so
        // synchronous failures (missing auth/model, extension input failures,
        // already-running errors) are returned to the caller instead of leaving
        // the UI stuck in "waiting for model".
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        let resolvePreflight: (success: boolean) => void = () => {};
        const preflight = new Promise<boolean>((resolve) => {
          resolvePreflight = resolve;
        });
        const promptPromise = this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          source: "rpc",
          preflightResult: resolvePreflight,
        }).catch((error: unknown) => {
          console.error("Agent prompt failed:", error);
          this.emitEvent({ type: "agent_error", errorMessage: error instanceof Error ? error.message : String(error) });
          this.emitEvent({ type: "agent_end", studioChildRunCount: countActiveYpiStudioChildRunsForSession(this.sessionId) });
          throw error;
        });
        const preflightSuccess = await Promise.race([
          preflight,
          promptPromise.then(() => true),
          promptPromise.catch((error: unknown) => { throw error; }),
        ]);
        if (!preflightSuccess) throw new Error("Agent prompt preflight failed");
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
        const sourceHeader = readSessionHeaderFromFile(currentSessionFile);
        if (sourceHeader?.projectId && sourceHeader.spaceId) {
          writeSessionProjectLink(newSessionFile, { projectId: sourceHeader.projectId, spaceId: sourceHeader.spaceId });
          await upsertProjectSessionIndexEntry({
            sessionId: newSessionId,
            sessionFile: newSessionFile,
            cwd: sessionManager.getCwd(),
            projectId: sourceHeader.projectId,
            spaceId: sourceHeader.spaceId,
          });
        }
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

/**
 * Bounded read-only projection of the AgentSession registry and start locks.
 * Sessions are projected in place (no destroy/abort/reset/cleanup), sorted by
 * estimated retained content bytes descending, then capped to `limits.maxSessions`.
 * Mutates nothing in the runtime.
 */
export function projectRpcRuntimeDiagnostic(
  budget: DiagnosticBudget,
  limits: DiagnosticLimits,
): RpcRuntimeDiagnostic {
  const registry = getRegistry();
  const allSamples: AgentSessionDiagnosticSample[] = [];
  let aliveCount = 0;
  let streamingCount = 0;
  let compactingCount = 0;
  let studioChildPinnedSessionCount = 0;
  try {
    for (const wrapper of registry.values()) {
      if (isBudgetExpired(budget)) break;
      if (wrapper.isAlive()) aliveCount += 1;
      try {
        if (wrapper.inner.isStreaming) streamingCount += 1;
        if (wrapper.inner.isCompacting) compactingCount += 1;
      } catch {
        // Provider/SDK state access is best-effort.
      }
      try {
        if (countActiveYpiStudioChildRunsForSession(wrapper.sessionId) > 0) studioChildPinnedSessionCount += 1;
      } catch {
        // Studio bookkeeping is best-effort.
      }
      let sample: AgentSessionDiagnosticSample;
      try {
        sample = wrapper.projectDiagnostic(budget, limits);
      } catch {
        // Skip a session that cannot be projected; other sessions still produce output.
        continue;
      }
      allSamples.push(sample);
    }
  } catch {
    // Return whatever partial projection we have.
  }
  allSamples.sort((a, b) => b.totalContentBytes - a.totalContentBytes);
  const total = allSamples.length;
  const truncated = Math.max(0, total - limits.maxSessions);
  const samples = allSamples.slice(0, limits.maxSessions);
  return {
    registryTotal: registry.size,
    aliveCount,
    streamingCount,
    compactingCount,
    startLockCount: getLocks().size,
    studioChildPinnedSessionCount,
    sessions: {
      total,
      sampled: samples.length,
      truncated,
      samples,
    },
  };
}

/**
 * Return the session ids that are currently alive in the registry. Used by
 * downstream owner projections (e.g. session-file-changes) that need the set
 * of active sessions without importing the private registry accessor.
 */
export function getActiveRpcSessionIds(): string[] {
  const ids: string[] = [];
  for (const wrapper of getRegistry().values()) {
    if (wrapper.isAlive()) ids.push(wrapper.sessionId);
  }
  return ids;
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
