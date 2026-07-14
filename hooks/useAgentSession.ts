"use client";

import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import type { PiWebThinkingLevel, PiWebToolPreset } from "@/lib/pi-web-config";
import type { AgentMessage, AssistantMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { SessionContextUsageSnapshot, UsageSessionRollupResult, UsageTotals } from "@/lib/usage-stats";
import { normalizeToolCalls } from "@/lib/normalize";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ToolEntry } from "@/components/ToolPanel";
import type { TrellisTaskChatContext } from "@/lib/trellis-chat-context";
import { sessionTitleSeedFromUserMessage } from "@/lib/session-title";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

const AUTO_SCROLL_BOTTOM_THRESHOLD = 96;
const STUDIO_CHILD_AUDIT_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "runtime_lost"]);

function isStudioChildAuditActive(session: SessionInfo | null): boolean {
  const child = session?.studioChild;
  if (!child) return false;
  if (child.finishedAt) return false;
  return !child.status || !STUDIO_CHILD_AUDIT_TERMINAL_STATUSES.has(child.status);
}

function isNearScrollBottom(container: HTMLDivElement): boolean {
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface SubagentRun {
  id: string;
  agent: string;
  task: string;
  status: "running" | "completed" | "failed";
  partialOutput: string;
  result?: string;
  startedAt: number;
  depth: number;
  parentId?: string;
  routing?: {
    source?: string;
    model?: string;
    thinking?: string;
    modality?: string;
    tier?: string;
    routerModel?: string;
    confidence?: number;
    fallbackReason?: string;
  };
  /** Path to this subagent's own session JSONL (for recursive child lookup) */
  sessionFile?: string;
  /** Lazily-loaded nested children */
  children?: SubagentRun[];
  loaded?: boolean;
}

type SubagentResultMetadata = {
  agent?: string;
  sessionFile?: string;
  routing?: SubagentRun["routing"];
  model?: string;
  thinking?: string;
  thinkingLevel?: string;
};

function routingFromResult(result: SubagentResultMetadata | undefined): SubagentRun["routing"] | undefined {
  if (!result) return undefined;
  if (result.routing) return result.routing;
  if (!result.model && !result.thinking && !result.thinkingLevel) return undefined;
  return {
    source: "result",
    model: result.model,
    thinking: result.thinking ?? result.thinkingLevel,
  };
}

function resultIndexForRun(runId: string, toolCallId: string): number | null {
  if (runId === toolCallId) return 0;
  if (runId.startsWith(toolCallId + "-c")) {
    const idx = parseInt(runId.slice(toolCallId.length + 2), 10);
    return Number.isNaN(idx) ? null : idx;
  }
  if (runId.startsWith(toolCallId + "-")) {
    const idx = parseInt(runId.slice(toolCallId.length + 1), 10);
    return Number.isNaN(idx) ? null : idx;
  }
  return null;
}

export type AgentRuntimeStatus =
  | "idle"
  | "waiting_model"
  | "running_tools"
  | "waiting_for_studio_children";

/** Lightweight, display-safe failover notice for the chat input area. */
export interface OpencodeGoFailoverNotice {
  status: string;
  reason?: "quota_exhausted" | "account_unusable";
  message: string;
  /** When true, guidance about re-enabling a disabled account in Settings should be shown. */
  showEnableGuidance: boolean;
}

/** Display-safe Grok global Active failover notice (no account ids / tokens). */
export interface GrokFailoverNotice {
  status: string;
  reason?: "quota_exhausted" | "rate_limited";
  message: string;
  /** When true, the banner may say "Retrying"; terminal statuses must not. */
  retrying: boolean;
}

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | { kind: "waiting_for_studio_children"; activeRunCount: number; message?: string }
  | null;

export interface ToolExecutionProgress {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  partialResult?: {
    content?: unknown[];
    details?: unknown;
    isError?: boolean;
  };
  result?: {
    content?: unknown[];
    details?: unknown;
    isError?: boolean;
  };
  updatedAt: number;
  running: boolean;
}

/**
 * 顶栏费用展示口径（由主会话确认，见 lib/usage-stats.ts UsageSessionRollupResult）：
 *
 * - `parent`：compact 显示 parent rollup（parent own + Studio children），存在真实 child usage 时追加 `incl. Studio`；
 *   `selectedSessionKind === "parent"`。
 * - `standalone`：compact 显示该 session 自身 usage，无 child 标记。
 * - `studio_child`：compact 只显示该 child 自身 usage，不再显示 parent rollup / `+child` 占位；
 *   tooltip 可附带 parent rollup。
 *
 * `cost` / `tokens` 字段为 compact 展示值；`own` / `studioChild` 为 parent rollup 拆分（仅 parent 场景有意义）。
 * `selectedSessionTotals` / `parentRollupTotals` 为 additive 透传字段，供 child compact 与 parent/child tooltip 复用。
 * `childSessions` 为 additive Studio child 摘要（含 optional contextUsage），仅 rollup 源提供；local fallback 无此字段。
 */
export interface SessionUsageChildTopbarSummary {
  sessionId: string;
  member?: string;
  subtaskId?: string;
  status?: string;
  totals: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number };
  /** Authoritative context snapshot when available; unavailable ≠ 0%. Never lifetime usage. */
  contextUsage?: SessionContextUsageSnapshot;
}

export interface SessionUsageTopbarStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost?: number;
  source: "local" | "rollup";
  parentSessionId?: string;
  selectedSessionKind?: UsageSessionRollupResult["selectedSessionKind"];
  parentFound?: boolean;
  own?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number };
  studioChild?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number };
  studioChildSessionCount: number;
  /** 选中 session 自身 totals（additive）。studio_child 场景作为 compact 展示值。 */
  selectedSessionTotals?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number };
  /** Parent rollup totals（additive），供 studio_child tooltip 与 parent compact 复用。 */
  parentRollupTotals?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number };
  /** Studio children for context popover (additive). Present only when source is rollup. */
  childSessions?: SessionUsageChildTopbarSummary[];
}

export type OnSubagentChange = (runs: SubagentRun[]) => void;

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  newSessionProjectContext?: { projectId: string; spaceId: string } | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSubagentChange?: OnSubagentChange;
  autoScrollEnabled?: boolean;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
  setToolPreset?: (preset: PiWebToolPreset) => void;
  defaultToolPreset?: PiWebToolPreset;
  defaultThinkingLevel?: PiWebThinkingLevel;
}

export type ThinkingLevelOption = PiWebThinkingLevel;

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  addTrellisTaskContext: (context: TrellisTaskChatContext) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

/** Extract SubagentRun(s) from a subagent tool call's args.
 *  Handles single-agent, parallel (tasks[]), and chain modes. */
function extractSubagentRuns(
  toolCallId: string,
  args: Record<string, unknown>,
  fallbackAgent: string,
): SubagentRun[] {
  const depth = (args.parentDepth ?? 0) as number;
  const parentId = (args.parentRunId as string) ?? undefined;
  const now = Date.now();

  // Parallel mode: { tasks: [{ agent, task }, ...] }
  const tasks = args.tasks;
  if (Array.isArray(tasks) && tasks.length > 0) {
    return tasks.map((t: unknown, i: number) => {
      const taskObj = t as Record<string, unknown> | undefined;
      const agent = String(taskObj?.agent ?? "?");
      const task = String(taskObj?.task ?? taskObj?.prompt ?? "");
      return {
        id: `${toolCallId}-${i}`,
        agent,
        task: task.slice(0, 200),
        status: "running" as const,
        partialOutput: "",
        startedAt: now + i,
        depth,
        parentId,
      };
    });
  }

  // Chain mode: { chain: [{ agent, task }, ...] }
  const chain = args.chain;
  if (Array.isArray(chain) && chain.length > 0) {
    return chain.map((t: unknown, i: number) => {
      const step = t as Record<string, unknown> | undefined;
      const agent = String(step?.agent ?? "?");
      const task = String(step?.task ?? step?.prompt ?? "");
      return {
        id: `${toolCallId}-c${i}`,
        agent,
        task: task.slice(0, 200),
        status: "running" as const,
        partialOutput: "",
        startedAt: now + i,
        depth,
        parentId,
      };
    });
  }

  // Single-agent mode: { agent, task/prompt }
  const agent = (args.agent ?? fallbackAgent) as string;
  if (agent) {
    const task = (args.task ?? args.prompt ?? "") as string;
    return [{
      id: toolCallId,
      agent: String(agent),
      task: typeof task === "string" ? task.slice(0, 200) : "",
      status: "running" as const,
      partialOutput: "",
      startedAt: now,
      depth,
      parentId,
    }];
  }

  return [];
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, newSessionProjectContext, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSubagentChange,
    autoScrollEnabled = true,
    defaultToolPreset = "default",
    defaultThinkingLevel = "auto",
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<{ id: string; name: string; provider: string; providerDisplayName?: string }[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [toolPreset, setToolPreset] = useState<PiWebToolPreset>(isNew ? defaultToolPreset : "default");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>(isNew ? defaultThinkingLevel : "auto");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [subagentRuns, setSubagentRuns] = useState<SubagentRun[]>([]);
  const [toolProgressById, setToolProgressById] = useState<Record<string, ToolExecutionProgress>>({});
  const [precreatedSessionId, setPrecreatedSessionId] = useState<string | null>(null);
  const [sessionUsageRollup, setSessionUsageRollup] = useState<{ sessionId: string; rollup: UsageSessionRollupResult } | null>(null);
  const [opencodeGoFailoverNotice, setOpencodeGoFailoverNotice] = useState<OpencodeGoFailoverNotice | null>(null);
  const opencodeGoFailoverNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [grokFailoverNotice, setGrokFailoverNotice] = useState<GrokFailoverNotice | null>(null);
  const grokFailoverNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const effectiveSessionIdRef = useRef<string | null>(null);
  const usageRollupAbortRef = useRef<AbortController | null>(null);
  const precreatedSessionIdRef = useRef<string | null>(null);
  const ensureBrowserShareSessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  const autoScrollStickyRef = useRef(true);
  const toolPresetTouchedRef = useRef(false);
  const thinkingLevelTouchedRef = useRef(false);

  const setNewSessionModel = opts.setNewSessionModel ?? setNewSessionModelState;
  const setToolPresetState = opts.setToolPreset ?? setToolPreset;

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const effectiveSessionId = session?.id ?? precreatedSessionId;
  const displayModel = isNew ? newSessionModel : currentModel;
  effectiveSessionIdRef.current = effectiveSessionId;

  useEffect(() => {
    if (!isNew || toolPresetTouchedRef.current || messages.length > 0 || agentRunning) return;
    setToolPresetState(defaultToolPreset);
  }, [agentRunning, defaultToolPreset, isNew, messages.length, setToolPresetState]);

  useEffect(() => {
    if (!isNew || thinkingLevelTouchedRef.current || messages.length > 0 || agentRunning) return;
    setThinkingLevel(defaultThinkingLevel);
  }, [agentRunning, defaultThinkingLevel, isNew, messages.length]);

  const localSessionStats = (() => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const u = (msg as AssistantMessage).usage;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      // cacheWrite: no longer aggregated (per cw-removal decision).
      // Field stays at 0 in tokens object for backward compatibility.
      cost += u.cost?.total ?? 0;
    }
    // cacheWrite excluded from total per cw-removal decision
    const total = tokens.input + tokens.output + tokens.cacheRead;
    return total > 0 ? { tokens, cost, source: "local" as const, studioChildSessionCount: 0 } : null;
  })();

  const statsFromTotals = (totals: UsageTotals) => ({
    tokens: {
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
    },
    cost: totals.cost,
  });

  const rollupSessionStats = sessionUsageRollup?.sessionId === effectiveSessionId
    ? (() => {
      const base = statsFromTotals(sessionUsageRollup.rollup.totals);
      // cacheWrite excluded per cw-removal decision
      const tokenTotal = base.tokens.input + base.tokens.output + base.tokens.cacheRead;
      return tokenTotal > 0 || base.cost > 0 || sessionUsageRollup.rollup.studioChildSessionCount > 0
        ? {
          ...base,
          source: "rollup" as const,
          parentSessionId: sessionUsageRollup.rollup.parentSessionId,
          selectedSessionKind: sessionUsageRollup.rollup.selectedSessionKind,
          parentFound: sessionUsageRollup.rollup.parentFound,
          own: statsFromTotals(sessionUsageRollup.rollup.ownTotals),
          studioChild: statsFromTotals(sessionUsageRollup.rollup.studioChildTotals),
          studioChildSessionCount: sessionUsageRollup.rollup.studioChildSessionCount,
          // additive：child compact 展示自身费用，tooltip 附带 parent rollup。
          selectedSessionTotals: statsFromTotals(sessionUsageRollup.rollup.selectedSessionTotals),
          parentRollupTotals: statsFromTotals(sessionUsageRollup.rollup.parentRollupTotals),
          // additive：Studio child context summaries for topbar context popover (UI-02).
          childSessions: sessionUsageRollup.rollup.childSessions.map((child) => ({
            sessionId: child.sessionId,
            member: child.studioChild?.member,
            subtaskId: child.studioChild?.subtaskId,
            status: child.studioChild?.status,
            totals: statsFromTotals(child.totals),
            contextUsage: child.contextUsage,
          })),
        }
        : null;
    })()
    : null;

  const sessionStats: SessionUsageTopbarStats | null = rollupSessionStats ?? localSessionStats;

  const fetchSessionUsageRollup = useCallback(async (sid: string) => {
    usageRollupAbortRef.current?.abort();
    const controller = new AbortController();
    usageRollupAbortRef.current = controller;
    try {
      const res = await fetch(`/api/usage?sessionId=${encodeURIComponent(sid)}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rollup = await res.json() as UsageSessionRollupResult;
      if (!controller.signal.aborted && effectiveSessionIdRef.current === sid) {
        setSessionUsageRollup({ sessionId: sid, rollup });
      }
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      if (effectiveSessionIdRef.current === sid) setSessionUsageRollup(null);
    } finally {
      if (usageRollupAbortRef.current === controller) usageRollupAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    setSessionUsageRollup(null);
    if (!effectiveSessionId) usageRollupAbortRef.current?.abort();
  }, [effectiveSessionId]);

  useEffect(() => {
    if (!effectiveSessionId || agentRunning) return;
    void fetchSessionUsageRollup(effectiveSessionId);
  }, [agentRunning, effectiveSessionId, fetchSessionUsageRollup]);

  useEffect(() => {
    if (!effectiveSessionId) return;
    const timer = window.setInterval(() => {
      void fetchSessionUsageRollup(effectiveSessionId);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [effectiveSessionId, fetchSessionUsageRollup]);

  useEffect(() => () => usageRollupAbortRef.current?.abort(), []);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false, suppressError = false) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
        : `/api/sessions/${encodeURIComponent(sid)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: { running: boolean; state?: { isStreaming?: boolean; studioChildRunCount?: number; isCompacting?: boolean; contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string; thinkingLevel?: string } } };
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      // If no live agent state, fall back to thinking level from session file
      if (!d.agentState?.state?.thinkingLevel && d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }
      return d.agentState ?? null;
    } catch (e) {
      if (!suppressError) setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (tools) {
        const { getPresetFromTools } = await import("@/components/ToolPanel");
        setToolPresetState(getPresetFromTools(tools));
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [setToolPresetState]);

  const connectEvents = useCallback((sid: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEventRef.current?.(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      if (eventSourceRef.current === es && agentRunningRef.current) {
        es.close();
        eventSourceRef.current = null;
        setTimeout(() => {
          if (agentRunningRef.current) connectEvents(sid);
        }, 1000);
      }
    };
  }, []);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  // Flush subagent runs upward on every change
  const prevRunsJsonRef = useRef("");
  useEffect(() => {
    const json = JSON.stringify(subagentRuns.map((r) => ({ id: r.id, agent: r.agent, status: r.status })));
    if (json !== prevRunsJsonRef.current) {
      prevRunsJsonRef.current = json;
      onSubagentChange?.(subagentRuns);
    }
  });

  const ensureBrowserShareSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return null;
    if (ensureBrowserShareSessionPromiseRef.current) return ensureBrowserShareSessionPromiseRef.current;

    ensureBrowserShareSessionPromiseRef.current = (async () => {
      try {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL, PRESET_SUBAGENT } = await import("@/components/ToolPanel");
        const toolNames = toolPreset === "none" ? PRESET_NONE : toolPreset === "default" ? PRESET_DEFAULT : toolPreset === "subagent" ? PRESET_SUBAGENT : PRESET_FULL;
        const res = await fetch("/api/agent/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            toolNames,
            ...(newSessionProjectContext ? { projectId: newSessionProjectContext.projectId, spaceId: newSessionProjectContext.spaceId } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
          }),
        });
        const result = await res.json().catch(() => ({})) as { sessionId?: string; error?: string };
        if (!res.ok || !result.sessionId) throw new Error(result.error ?? `HTTP ${res.status}`);
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        precreatedSessionIdRef.current = realId;
        setPrecreatedSessionId(realId);
        const now = new Date().toISOString();
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: now,
          modified: now,
          messageCount: 0,
          firstMessage: "",
          ...(newSessionProjectContext ? { projectId: newSessionProjectContext.projectId, spaceId: newSessionProjectContext.spaceId } : {}),
        });
        return realId;
      } catch (error) {
        console.error("Failed to create Browser Share session:", error);
        setError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        ensureBrowserShareSessionPromiseRef.current = null;
      }
    })();

    return ensureBrowserShareSessionPromiseRef.current;
  }, [isNew, newSessionCwd, newSessionModel, newSessionProjectContext, onSessionCreated, thinkingLevel, toolPreset]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "connected":
        if (event.mode === "studio_child_audit") {
          setAgentRunning(true);
          setAgentPhase(null);
          dispatch({ type: "reset" });
        }
        break;
      case "studio_child_audit_changed": {
        const sid = typeof event.sessionId === "string" ? event.sessionId : sessionIdRef.current;
        if (sid) {
          loadSession(sid, false, false, true).catch((error) => {
            console.warn("Failed to refresh Studio child audit session:", error);
          });
        }
        break;
      }
      case "studio_child_audit_end": {
        const sid = typeof event.sessionId === "string" ? event.sessionId : sessionIdRef.current;
        const finish = () => {
          setAgentRunning(false);
          setAgentPhase(null);
          dispatch({ type: "end" });
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          onAgentEnd?.();
        };
        if (sid) {
          loadSession(sid, false, false, true).finally(finish);
        } else {
          finish();
        }
        break;
      }
      case "agent_start":
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        setSubagentRuns([]);
        setToolProgressById({});
        setOpencodeGoFailoverNotice(null);
        if (opencodeGoFailoverNoticeTimerRef.current) {
          clearTimeout(opencodeGoFailoverNoticeTimerRef.current);
          opencodeGoFailoverNoticeTimerRef.current = null;
        }
        setGrokFailoverNotice(null);
        if (grokFailoverNoticeTimerRef.current) {
          clearTimeout(grokFailoverNoticeTimerRef.current);
          grokFailoverNoticeTimerRef.current = null;
        }
        dispatch({ type: "start" });
        break;
      case "agent_end": {
        const studioChildRunCount = typeof event.studioChildRunCount === "number" ? event.studioChildRunCount : 0;
        if (studioChildRunCount > 0) {
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_for_studio_children", activeRunCount: studioChildRunCount, message: "Studio 子任务仍在后台运行，主会话会在子任务结束后自动续跑。" });
        } else {
          setAgentRunning(false);
          setAgentPhase(null);
        }
        setRetryInfo(null);
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
          fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
            .then((r) => r.json())
            .then((d: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string } }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
            })
            .catch(() => {});
        }
        onAgentEnd?.();
        break;
      }
      case "message_start":
      case "message_update": {
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg?.role === "user") {
          break;
        }
        if (msg) {
          dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        if (completed && completed.role !== "user") {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const args = event.args && typeof event.args === "object" && !Array.isArray(event.args) ? event.args as Record<string, unknown> : undefined;
        setToolProgressById((prev) => ({
          ...prev,
          [id]: { toolCallId: id, toolName: name, args, updatedAt: Date.now(), running: true },
        }));
        const isSubagent = name === "subagent" || name === "trellis_subagent";
        if (isSubagent) {
          // Skip management actions (list, get, doctor, etc.) — only track execution calls
          if (args && !("action" in args)) {
            const runs = extractSubagentRuns(id, args, name);
            if (runs.length > 0) {
              setSubagentRuns((prev) => [...prev, ...runs]);
            }
          }
        }
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        const updateId = event.toolCallId as string;
        const updateName = event.toolName as string;
        const updateArgs = event.args && typeof event.args === "object" && !Array.isArray(event.args) ? event.args as Record<string, unknown> : undefined;
        const partial = event.partialResult as { content?: { text?: string }[]; details?: { routing?: SubagentRun["routing"]; runs?: { routing?: SubagentRun["routing"] }[] } } | undefined;
        setToolProgressById((prev) => ({
          ...prev,
          [updateId]: {
            toolCallId: updateId,
            toolName: updateName || prev[updateId]?.toolName || "tool",
            args: updateArgs ?? prev[updateId]?.args,
            partialResult: event.partialResult as ToolExecutionProgress["partialResult"],
            result: prev[updateId]?.result,
            updatedAt: Date.now(),
            running: true,
          },
        }));
        const text = partial?.content?.map((c) => c.text ?? "").join("") ?? "";
        const routing = partial?.details?.routing ?? partial?.details?.runs?.find((run) => run.routing)?.routing;
        if (text || routing) {
          setSubagentRuns((prev) =>
            prev.map((r) =>
              r.id === updateId || r.id.startsWith(updateId + "-")
                ? { ...r, partialOutput: text ? r.partialOutput + text : r.partialOutput, routing: routing ?? r.routing }
                : r,
            ),
          );
        }
        break;
      }
      case "tool_execution_end": {
        const endId = event.toolCallId as string;
        const endName = event.toolName as string;
        const isError = !!event.isError;
        setToolProgressById((prev) => ({
          ...prev,
          [endId]: {
            toolCallId: endId,
            toolName: endName || prev[endId]?.toolName || "tool",
            args: prev[endId]?.args,
            partialResult: prev[endId]?.partialResult,
            result: event.result as ToolExecutionProgress["result"],
            updatedAt: Date.now(),
            running: false,
          },
        }));
        const resultText =
          (event.result as { content?: { text?: string }[] } | undefined)
            ?.content?.map((c) => c.text ?? "")
            .join("") ?? undefined;
        // Extract sessionFile/routing metadata from subagent tool-call details.
        const details = (event.result as { details?: { results?: SubagentResultMetadata[]; routing?: SubagentRun["routing"]; runs?: { routing?: SubagentRun["routing"] }[] } } | undefined)?.details;
        const fallbackRouting = details?.routing ?? details?.runs?.find((run) => run.routing)?.routing;
        setSubagentRuns((prev) =>
          prev.map((r) => {
            const resultIndex = resultIndexForRun(r.id, endId);
            if (resultIndex !== null) {
              const result = details?.results?.[resultIndex];
              const sessionFile = result?.sessionFile;
              const routing = routingFromResult(result) ?? fallbackRouting;
              return { ...r, status: isError ? "failed" : "completed", result: resultText, partialOutput: "", sessionFile: sessionFile ?? r.sessionFile, routing: routing ?? r.routing };
            }
            return r;
          }),
        );
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== endId);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "agent_error":
        setError(typeof event.errorMessage === "string" ? event.errorMessage : "Agent failed to start");
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
        break;
      case "chatgpt_account_failover":
        setRetryInfo({
          attempt: 1,
          maxAttempts: 1,
          errorMessage: event.status === "switched"
            ? "ChatGPT 额度耗尽，已切换账号并重试…"
            : event.status === "already_switched_by_other_session"
              ? "其他会话已切换 ChatGPT 账号，正在重试…"
              : `ChatGPT 账号自动切换：${String(event.status)}`,
        });
        break;
      case "opencode_go_account_failover": {
        const ogStatus = String(event.status ?? "");
        const ogReason = event.reason === "quota_exhausted" || event.reason === "account_unusable"
          ? event.reason as "quota_exhausted" | "account_unusable"
          : undefined;
        const ogMessage = typeof event.message === "string" && event.message.trim()
          ? event.message.trim()
          : undefined;
        const isAccountUnusable = ogReason === "account_unusable" || ogStatus === "disabled_account";
        const isSwitched = ogStatus === "switched";
        const isAlreadySwitched = ogStatus === "already_switched_by_other_session";
        const isNoUsable = ogStatus === "no_usable_account" || ogStatus === "retry_budget_exhausted";
        const isFailed = ogStatus === "failed" || ogStatus === "no_active_account";

        let message = ogMessage ?? "OpenCode Go account failover.";
        // Enrich with guidance for account_unusable
        if (isAccountUnusable) {
          message = ogMessage ?? "OpenCode Go account disabled due to invalid API key. Switched to another account.";
        } else if (isSwitched) {
          message = ogMessage ?? "OpenCode Go account switched. Retrying…";
        } else if (isAlreadySwitched) {
          message = ogMessage ?? "Another session already switched OpenCode Go account. Retrying with current active account…";
        } else if (isNoUsable) {
          message = ogMessage ?? "No enabled OpenCode Go account is available.";
        } else if (isFailed) {
          message = ogMessage ?? "OpenCode Go account failover failed.";
        }

        setOpencodeGoFailoverNotice({
          status: ogStatus,
          reason: ogReason,
          message,
          showEnableGuidance: isAccountUnusable,
        });

        // Auto-dismiss after 12s so the notice doesn't linger forever
        if (opencodeGoFailoverNoticeTimerRef.current) clearTimeout(opencodeGoFailoverNoticeTimerRef.current);
        opencodeGoFailoverNoticeTimerRef.current = setTimeout(() => {
          setOpencodeGoFailoverNotice(null);
        }, 12_000);
        break;
      }
      case "grok_account_failover": {
        const status = String(event.status ?? "");
        const reason = event.reason === "quota_exhausted" || event.reason === "rate_limited"
          ? event.reason as "quota_exhausted" | "rate_limited"
          : undefined;
        const serverMessage = typeof event.message === "string" && event.message.trim()
          ? event.message.trim()
          : undefined;
        const isSwitched = status === "switched";
        const isAlreadySwitched = status === "already_switched_by_other_session";
        const isNoUsable = status === "no_usable_account";
        const isBudget = status === "retry_budget_exhausted";
        const isBypass = status === "fixed_token_bypass";
        const isFailed = status === "failed" || status === "no_active_account";
        const retrying = isSwitched || isAlreadySwitched;

        let message = serverMessage ?? "Grok 账号自动切换。";
        if (isSwitched) {
          message = serverMessage
            ?? (reason === "rate_limited"
              ? "Grok 明确限流已触发，已切换全局 Active 并重试…"
              : "Grok 明确限额已触发，已切换全局 Active 并重试…");
        } else if (isAlreadySwitched) {
          message = serverMessage ?? "其他会话已切换 Grok 全局 Active，正在用新账号重试…";
        } else if (isNoUsable) {
          message = serverMessage ?? "Grok 限额/限流已触发，但没有可用账号。";
        } else if (isBudget) {
          message = serverMessage ?? "Grok 限额/限流已触发，本 turn 重试预算已用尽。";
        } else if (isBypass) {
          message = serverMessage ?? "Grok 使用了固定环境凭据，无法通过托管账号自动切换。";
        } else if (isFailed) {
          message = serverMessage ?? "Grok 账号自动切换失败。";
        }

        setGrokFailoverNotice({
          status,
          reason,
          message,
          retrying,
        });

        if (retrying) {
          setRetryInfo({
            attempt: 1,
            maxAttempts: 1,
            errorMessage: message,
          });
        }

        if (grokFailoverNoticeTimerRef.current) clearTimeout(grokFailoverNoticeTimerRef.current);
        grokFailoverNoticeTimerRef.current = setTimeout(() => {
          setGrokFailoverNotice(null);
        }, 12_000);
        break;
      }
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
        } else if (!event.aborted) {
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
    }
  }, [loadSession, onAgentEnd]);

  // Cleanup failover notice timer on unmount
  useEffect(() => {
    return () => {
      if (opencodeGoFailoverNoticeTimerRef.current) {
        clearTimeout(opencodeGoFailoverNoticeTimerRef.current);
      }
      if (grokFailoverNoticeTimerRef.current) {
        clearTimeout(grokFailoverNoticeTimerRef.current);
      }
    };
  }, []);

  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (agentRunning) return;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentRunning(true);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      const existingSessionId = sessionIdRef.current;
      if (isNew && newSessionCwd && !existingSessionId) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL, PRESET_SUBAGENT } = await import("@/components/ToolPanel");
        const toolNames = toolPreset === "none" ? PRESET_NONE : toolPreset === "default" ? PRESET_DEFAULT : toolPreset === "subagent" ? PRESET_SUBAGENT : PRESET_FULL;
        const res = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            ...(newSessionProjectContext ? { projectId: newSessionProjectContext.projectId, spaceId: newSessionProjectContext.spaceId } : {}),
            message,
            toolNames,
            ...(piImages?.length ? { images: piImages } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json() as { sessionId: string };
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        connectEvents(realId);
        const now = new Date().toISOString();
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: now,
          modified: now,
          messageCount: 1,
          firstMessage: sessionTitleSeedFromUserMessage(message),
          ...(newSessionProjectContext ? { projectId: newSessionProjectContext.projectId, spaceId: newSessionProjectContext.spaceId } : {}),
        });
      } else {
        const sid = existingSessionId ?? session?.id;
        if (!sid) return;
        const wasPrecreated = !!precreatedSessionIdRef.current && sid === precreatedSessionIdRef.current && messages.length === 0;
        connectEvents(sid);
        if (wasPrecreated) {
          const now = new Date().toISOString();
          onSessionCreated?.({
            id: sid,
            path: session?.path ?? "",
            cwd: session?.cwd ?? newSessionCwd ?? "",
            name: session?.name,
            created: session?.created ?? now,
            modified: now,
            messageCount: 1,
            firstMessage: sessionTitleSeedFromUserMessage(message),
            ...(newSessionProjectContext ? { projectId: newSessionProjectContext.projectId, spaceId: newSessionProjectContext.spaceId } : {}),
          });
          precreatedSessionIdRef.current = null;
          setPrecreatedSessionId(null);
        }
        await sendAgentCommand(sid, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, newSessionProjectContext, toolPreset, thinkingLevel, session, agentRunning, connectEvents, onSessionCreated, messages.length]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      const draftSid = sessionIdRef.current;
      if (!draftSid) return;
      try {
        await sendAgentCommand(draftSid, { type: "set_model", provider, modelId });
        setCurrentModelOverride({ provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew, setNewSessionModel]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    try {
      await sendAgentCommand(sid, { type: "compact" });
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: `[steer] ${message}`, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    thinkingLevelTouchedRef.current = true;
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const handleToolPresetChange = useCallback(async (preset: PiWebToolPreset) => {
    toolPresetTouchedRef.current = true;
    const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL, PRESET_SUBAGENT } = await import("@/components/ToolPanel");
    const toolNames = preset === "none" ? PRESET_NONE : preset === "default" ? PRESET_DEFAULT : preset === "subagent" ? PRESET_SUBAGENT : PRESET_FULL;
    setToolPresetState(preset);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames });
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, [setToolPresetState]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
    autoScrollStickyRef.current = true;
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (session?.id) {
      sessionIdRef.current = session.id;
      if (precreatedSessionId && precreatedSessionId !== session.id) {
        precreatedSessionIdRef.current = null;
        setPrecreatedSessionId(null);
      }
    }
  }, [precreatedSessionId, session?.id]);

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      const shouldTrackStudioChildAudit = isStudioChildAuditActive(session);
      loadSession(session.id, true, true).then((agentState) => {
        if (agentState?.running) {
          if (!session.studioChild) loadTools(session.id);
          const studioChildRunCount = agentState.state?.studioChildRunCount ?? 0;
          if (agentState.state?.isStreaming || studioChildRunCount > 0) {
            setAgentRunning(true);
            setAgentPhase(studioChildRunCount > 0 && !agentState.state?.isStreaming
              ? { kind: "waiting_for_studio_children", activeRunCount: studioChildRunCount, message: "Studio 子任务仍在后台运行，主会话会在子任务结束后自动续跑。" }
              : { kind: "waiting_model" });
            connectEvents(session.id);
          }
        } else if (shouldTrackStudioChildAudit) {
          setAgentRunning(true);
          setAgentPhase(null);
          connectEvents(session.id);
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
        }
      });
    }
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    autoScrollEnabledRef.current = autoScrollEnabled;
    if (!autoScrollEnabled) return;
    autoScrollStickyRef.current = true;
    const frame = requestAnimationFrame(() => scrollToBottom("smooth"));
    return () => cancelAnimationFrame(frame);
  }, [autoScrollEnabled, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (!autoScrollEnabledRef.current) return;
      autoScrollStickyRef.current = isNearScrollBottom(container);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasMessages]);

  useEffect(() => {
    if (!hasMessages) return;

    if (pendingScrollToUserRef.current) {
      pendingScrollToUserRef.current = false;
      initialScrollDoneRef.current = true;
      if (autoScrollEnabledRef.current) {
        autoScrollStickyRef.current = true;
        scrollToBottom("smooth");
      } else {
        scrollUserMsgToTop();
      }
      return;
    }

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom("instant");
      return;
    }

    if (autoScrollEnabledRef.current && autoScrollStickyRef.current) {
      scrollToBottom(agentRunningRef.current ? "auto" : "smooth");
    }
  }, [hasMessages, messages.length, agentRunning, streamState.isStreaming, streamState.streamingMessage, autoScrollEnabled, scrollToBottom, scrollUserMsgToTop]);

  // Load model list
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string; providerDisplayName?: string }[]; defaultModel?: { provider: string; modelId: string } | null; thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>> }) => {
      setModelNames(d.models);
      if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
      if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          const def = d.defaultModel;
          const match = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const selected = match
            ? { provider: match.provider, modelId: match.id }
            : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
        }
      }
    }).catch(() => {});
  }, [isNew, modelsRefreshKey, setNewSessionModel]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, currentModel, displayModel, sessionStats,
    agentPhase, subagentRuns, toolProgressById, opencodeGoFailoverNotice, grokFailoverNotice,
    isNew, precreatedSessionId, effectiveSessionId,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleToolPresetChange, handleThinkingLevelChange, ensureBrowserShareSession, loadTools, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId,
    // Subscriptions
    handleAgentEventRef,
  };
}
