"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PiWebThinkingLevel, PiWebToolPreset } from "@/lib/pi-web-config";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { YpiStudioLiveRunOverlay, YpiStudioTaskWidgetProjection, YpiStudioTaskWidgetSubagentRun, YpiStudioSubagentTranscriptItem } from "@/lib/ypi-studio-types";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { useAgentSession, type AgentPhase } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useDragDrop } from "@/hooks/useDragDrop";
import { SessionChangesFloatingPanel } from "./SessionChangesFloatingPanel";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSubagentChange?: (runs: import("@/hooks/useAgentSession").SubagentRun[]) => void;
  onSessionStatsChange?: (stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onStudioToolProgressChange?: (snapshot: { agentRunning: boolean; overlays: YpiStudioLiveRunOverlay[] }) => void;
  studioTask?: YpiStudioTaskWidgetProjection | null;
  defaultToolPreset?: PiWebToolPreset;
  defaultThinkingLevel?: PiWebThinkingLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function studioPhase(value: unknown): YpiStudioLiveRunOverlay["phase"] | undefined {
  return value === "starting" || value === "waiting_model" || value === "streaming" || value === "running_tool" || value === "waiting_for_user" || value === "finished" ? value : undefined;
}

function studioPolicyWarnings(value: unknown): string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.warnings)) return undefined;
  const warnings = value.warnings
    .map((item) => isRecord(item) && typeof item.message === "string" ? item.message : undefined)
    .filter((item): item is string => !!item);
  return warnings.length ? warnings : undefined;
}

function textFromContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => isRecord(item) && item.type === "text" ? optionalString(item.text) : undefined).filter(Boolean).join(" ").slice(0, 300) || undefined;
}

function studioDisplayStatusLabel(status: string): string {
  if (status === "running") return "运行中";
  if (status === "queued") return "队列中";
  if (status === "ready") return "就绪";
  if (status === "done") return "完成";
  if (status === "failed") return "失败";
  if (status === "blocked") return "阻塞";
  if (status === "skipped") return "跳过";
  return "等待";
}

function studioDisplayStatusColor(status: string): string {
  if (status === "failed" || status === "blocked") return "#f59e0b";
  if (status === "running" || status === "queued") return "var(--accent)";
  if (status === "done" || status === "skipped") return "#22c55e";
  if (status === "ready") return "#38bdf8";
  return "var(--text-dim)";
}

function studioRunStatusColor(status: string): string {
  if (status === "failed" || status === "cancelled") return "#ef4444";
  if (status === "waiting_for_user") return "#f59e0b";
  if (status === "succeeded") return "#22c55e";
  if (status === "queued") return "#38bdf8";
  if (status === "running") return "var(--accent)";
  return "var(--text-dim)";
}

function studioRunPhaseLabel(run: Pick<YpiStudioTaskWidgetSubagentRun, "phase" | "currentTool" | "status">): string {
  if (run.status === "queued") return "排队";
  if (run.phase === "starting") return "启动中";
  if (run.phase === "waiting_model") return "等待模型";
  if (run.phase === "streaming") return "输出中";
  if (run.phase === "running_tool") return `工具 ${run.currentTool?.toolName ?? "运行中"}`;
  if (run.phase === "waiting_for_user") return "等待用户";
  if (run.phase === "finished") return "已结束";
  return run.status === "running" ? "运行中" : run.status;
}

function studioTranscriptItemText(item: YpiStudioSubagentTranscriptItem): string {
  if (item.kind === "tool_call") return `调用 ${item.toolName}`;
  if (item.kind === "tool_result") return `${item.toolName ?? "工具"}${item.isError ? "失败" : "完成"}${item.text ? `：${item.text}` : ""}`;
  if ("text" in item) return item.text;
  return "";
}

function studioRunPreview(run: YpiStudioTaskWidgetSubagentRun): string {
  const activity = run.lastItemsPreview.map(studioTranscriptItemText).filter(Boolean).slice(-2).join(" · ");
  return activity || run.summary || run.error || "等待成员输出…";
}

function studioRunStats(run: YpiStudioTaskWidgetSubagentRun): string | undefined {
  const stats = [
    typeof run.tokens === "number" ? `${run.tokens} tok` : undefined,
    typeof run.tps === "number" ? `${run.tps.toFixed(1)} t/s` : undefined,
  ].filter(Boolean);
  return stats.join(" · ") || undefined;
}

function studioRunTimeLabel(run: YpiStudioTaskWidgetSubagentRun): string {
  const updatedAt = run.transcriptMeta?.updatedAt ?? run.finishedAt ?? run.startedAt;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s 前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return "Waiting for model...";
  return "Thinking...";
}

const TYPEWRITER_PHRASES = [
  "ready when you are.",
  "ask me anything.",
  "let's build something cool.",
  "explore your codebase.",
  "draft an email.",
  "summarize that paper.",
  "plan your weekend.",
  "explain it like I'm five.",
  "pair-program with me.",
  "fix that pesky bug.",
  "translate to 中文.",
  "write a haiku.",
  "brainstorm ideas.",
  "review my pull request.",
  "what should we cook tonight?",
  "ship it.",
  "make it pretty.",
  "rubber-duck with me.",
];

function Typewriter({ phrases }: { phrases: string[] }) {
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * phrases.length));
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    const current = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) {
      timeout = setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === "") {
      setDeleting(false);
      setPhraseIdx((i) => (i + 1) % phrases.length);
    } else {
      const next = deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1);
      timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, phraseIdx, phrases]);

  return (
    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {text}
      <span style={{ opacity: caretOn ? 1 : 0, color: "var(--accent)", marginLeft: 1 }}>▍</span>
    </span>
  );
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSubagentChange, onSessionStatsChange, onContextUsageChange, onStudioToolProgressChange, studioTask, defaultToolPreset, defaultThinkingLevel }: Props) {
  const { autoScrollEnabled, onAutoScrollToggle } = useAutoScroll();
  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, displayModel: displayModelValue, sessionStats,
    agentPhase, toolProgressById,
    isNew, effectiveSessionId, ensureBrowserShareSession,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleToolPresetChange, handleThinkingLevelChange, handleAgentEventRef,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSubagentChange,
    autoScrollEnabled, defaultToolPreset, defaultThinkingLevel,
  });

  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Wrap agent event handler to play sound on agent_end
  const origHandler = handleAgentEventRef.current;
  useEffect(() => {
    handleAgentEventRef.current = (event) => {
      if (event.type === "agent_end" && soundEnabledRef.current) {
        playDoneSoundRef.current();
      }
      origHandler?.(event);
    };
  }, [origHandler, handleAgentEventRef]);

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? `${sessionStats.tokens.input}|${sessionStats.tokens.output}|${sessionStats.tokens.cacheRead}|${sessionStats.tokens.cacheWrite}|${sessionStats.cost ?? 0}`
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const studioProgressSignature = Object.values(toolProgressById)
    .filter((progress) => progress.toolName === "ypi_studio_task" || progress.toolName === "ypi_studio_subagent" || progress.toolName === "ypi_studio_wait")
    .map((progress) => {
      const details = (isRecord(progress.result?.details) ? progress.result.details : isRecord(progress.partialResult?.details) ? progress.partialResult.details : {}) as Record<string, unknown>;
      const run = isRecord(details.run) ? details.run : null;
      const task = isRecord(details.task) ? details.task : null;
      const runProgress = isRecord(run?.progress) ? run.progress : null;
      return [
        progress.toolCallId,
        progress.updatedAt,
        progress.running,
        optionalString(task?.id) ?? optionalString(run?.taskId) ?? optionalString(progress.args?.taskId) ?? "",
        optionalString(task?.key) ?? optionalString(run?.taskKey) ?? "",
        optionalString(run?.id) ?? optionalString(progress.args?.runId) ?? "",
        optionalString(task?.status) ?? optionalString(run?.status) ?? "",
        optionalString(runProgress?.phase) ?? "",
        optionalNumber(runProgress?.tokens) ?? "",
        optionalNumber(runProgress?.tps) ?? "",
        optionalString(isRecord(runProgress?.currentTool) ? runProgress.currentTool.toolName : undefined) ?? "",
        Array.isArray(runProgress?.itemsPreview) ? runProgress.itemsPreview.length : "",
        Array.isArray(runProgress?.itemsPreview) ? JSON.stringify(runProgress.itemsPreview.slice(-2).map((item) => isRecord(item) ? [optionalString(item.kind), optionalString(item.at), optionalString(item.text) ?? optionalString(item.inputPreview), item.truncated === true] : null)) : "",
        isRecord(runProgress?.display) ? [
          runProgress.display.recentLimit,
          runProgress.display.previewTruncated === true,
          runProgress.display.finalOutputTruncated === true,
          runProgress.display.transcriptItemTruncated === true,
          runProgress.display.transcriptCaptureLimited === true,
          runProgress.display.apiProjectionLimited === true,
        ].join(",") : "",
      ].join("|");
    })
    .join(";");
  useEffect(() => {
    if (!onStudioToolProgressChange) return;
    const overlays: YpiStudioLiveRunOverlay[] = Object.values(toolProgressById)
      .filter((progress) => progress.toolName === "ypi_studio_task" || progress.toolName === "ypi_studio_subagent" || progress.toolName === "ypi_studio_wait")
      .map((progress) => {
        const details = (isRecord(progress.result?.details) ? progress.result.details : isRecord(progress.partialResult?.details) ? progress.partialResult.details : {}) as Record<string, unknown>;
        const run = isRecord(details.run) ? details.run : null;
        const task = isRecord(details.task) ? details.task : null;
        const runProgress = isRecord(run?.progress) ? run.progress : null;
        const currentTool = isRecord(runProgress?.currentTool) && typeof runProgress.currentTool.toolCallId === "string" && typeof runProgress.currentTool.toolName === "string"
          ? { toolCallId: runProgress.currentTool.toolCallId, toolName: runProgress.currentTool.toolName, startedAt: optionalString(runProgress.currentTool.startedAt) }
          : undefined;
        const status = optionalString(run?.status) ?? (progress.running ? "running" : progress.result?.isError ? "failed" : undefined);
        const safeStatus = status === "queued" || status === "succeeded" || status === "failed" || status === "cancelled" || status === "running" || status === "waiting_for_user" ? status : undefined;
        return {
          toolCallId: progress.toolCallId,
          toolName: progress.toolName as "ypi_studio_task" | "ypi_studio_subagent" | "ypi_studio_wait",
          taskId: optionalString(task?.id) ?? optionalString(run?.taskId) ?? optionalString(progress.args?.taskId),
          taskKey: optionalString(task?.key) ?? optionalString(run?.taskKey),
          runId: optionalString(run?.id) ?? optionalString(progress.args?.runId),
          member: optionalString(run?.member) ?? optionalString(progress.args?.member),
          status: safeStatus,
          model: optionalString(run?.model),
          thinking: optionalString(run?.thinking),
          phase: studioPhase(runProgress?.phase),
          tokens: optionalNumber(runProgress?.tokens),
          tps: optionalNumber(runProgress?.tps),
          currentTool,
          policyWarnings: studioPolicyWarnings(run?.policy),
          lastTextPreview: optionalString(runProgress?.lastTextPreview) ?? textFromContent(progress.partialResult?.content) ?? textFromContent(progress.result?.content) ?? optionalString(run?.summary),
          itemsPreview: Array.isArray(runProgress?.itemsPreview) ? runProgress.itemsPreview as YpiStudioLiveRunOverlay["itemsPreview"] : undefined,
          updatedAt: progress.updatedAt,
          running: progress.running,
        };
      });
    onStudioToolProgressChange({ agentRunning, overlays });
  }, [agentRunning, onStudioToolProgressChange, studioProgressSignature, toolProgressById]);
  useEffect(() => () => { onStudioToolProgressChange?.({ agentRunning: false, overlays: [] }); }, [onStudioToolProgressChange]);

  const onDrop = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const textFiles = files.filter((f) => !f.type.startsWith("image/"));
    if (imageFiles.length > 0) chatInputRef?.current?.addImages(imageFiles);
    if (textFiles.length > 0) chatInputRef?.current?.addFiles(textFiles);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const isArchived = !!session?.archived;
  const studioRuntime = studioTask?.implementationProjection?.sessionRuntime;
  const studioRuntimeCounts = studioTask?.implementationProjection?.statusCounts;
  const studioWaitingTotal = (studioRuntime?.activeRunCount ?? 0) + (studioRuntime?.queuedRunCount ?? 0) || (agentPhase?.kind === "waiting_for_studio_children" ? agentPhase.activeRunCount : 0);
  const studioTimeline = studioRuntime?.timeline.slice(0, 5) ?? [];
  const activeStudioRuns = (studioTask?.subagents ?? [])
    .filter((run) => run.status === "running" || run.status === "queued" || run.status === "waiting_for_user")
    .sort((a, b) => (b.transcriptMeta?.updatedAt ?? b.startedAt).localeCompare(a.transcriptMeta?.updatedAt ?? a.startedAt));
  const activeStudioRunIds = new Set(activeStudioRuns.map((run) => run.id));
  const visibleStudioRuns = [
    ...activeStudioRuns,
    ...(studioTask?.subagents ?? [])
      .filter((run) => !activeStudioRunIds.has(run.id))
      .sort((a, b) => (b.transcriptMeta?.updatedAt ?? b.finishedAt ?? b.startedAt).localeCompare(a.transcriptMeta?.updatedAt ?? a.finishedAt ?? a.startedAt))
      .slice(0, Math.max(0, 4 - activeStudioRuns.length)),
  ].slice(0, 4);
  const showStudioWaitingBanner = !!studioRuntime && (studioRuntime.status === "waiting_for_studio_children" || studioRuntime.status === "needs_user" || agentPhase?.kind === "waiting_for_studio_children");
  const studioWaitingBannerElement = showStudioWaitingBanner && studioRuntime ? (
    <div style={{
      margin: "10px auto 4px",
      maxWidth: 860,
      padding: "11px 12px",
      border: `1px solid ${studioRuntime.status === "needs_user" ? "rgba(245,158,11,0.35)" : "rgba(37,99,235,0.28)"}`,
      borderRadius: 12,
      background: studioRuntime.status === "needs_user" ? "rgba(245,158,11,0.08)" : "rgba(37,99,235,0.07)",
      color: "var(--text-muted)",
      fontSize: 12,
      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", fontWeight: 850 }}>
        <span className={studioRuntime.status === "waiting_for_studio_children" ? "animate-[pulse_1.8s_infinite]" : undefined} style={{ width: 8, height: 8, borderRadius: 999, background: studioRuntime.status === "needs_user" ? "#f59e0b" : "var(--accent)", flexShrink: 0 }} />
        <span>{studioRuntime.status === "needs_user" ? "Studio 需要你处理" : `Studio 后台仍在工作：${studioWaitingTotal} 个子任务活跃`}</span>
        <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10, fontWeight: 700 }}>自动续跑 · 每几秒刷新</span>
      </div>
      <div style={{ marginTop: 5 }}>{studioRuntime.message}</div>
      {studioRuntimeCounts && (
        <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            ["运行中", studioRuntimeCounts.running, "var(--accent)"],
            ["队列", studioRuntimeCounts.queued, "#38bdf8"],
            ["就绪", studioRuntimeCounts.ready, "#38bdf8"],
            ["完成", studioRuntimeCounts.done + studioRuntimeCounts.skipped, "#22c55e"],
            ["等待", studioRuntimeCounts.waiting + studioRuntimeCounts.pending, "var(--text-dim)"],
            ["失败", studioRuntimeCounts.failed, "#ef4444"],
            ["阻塞", studioRuntimeCounts.blocked, "#f59e0b"],
          ].filter(([, count]) => Number(count) > 0).map(([label, count, color]) => (
            <span key={String(label)} style={{ padding: "2px 7px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)", color: color as string, background: "color-mix(in srgb, var(--bg-panel) 72%, transparent)", fontSize: 10, fontWeight: 800 }}>{label} {count}</span>
          ))}
        </div>
      )}
      {visibleStudioRuns.length > 0 && (
        <div style={{ marginTop: 9, display: "grid", gap: 6 }}>
          <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 800 }}>成员运行 · 活跃 {activeStudioRuns.length} · 最近 {visibleStudioRuns.length}</div>
          {visibleStudioRuns.map((run) => {
            const preview = studioRunPreview(run);
            const stats = studioRunStats(run);
            return (
              <div key={run.id} style={{ display: "grid", gridTemplateColumns: "74px 1fr auto", gap: 8, alignItems: "center", padding: "5px 7px", borderRadius: 9, border: "1px solid color-mix(in srgb, var(--border) 55%, transparent)", background: "color-mix(in srgb, var(--bg-panel) 62%, transparent)" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: studioRunStatusColor(run.status), fontSize: 10, fontWeight: 900 }}>{run.member}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--text)", fontWeight: 800 }}>{run.subtaskId ?? run.id}</span>
                  <span> · {studioRunPhaseLabel(run)}</span>
                  {stats && <span> · {stats}</span>}
                  <span> · {preview}</span>
                </span>
                <span title={run.transcriptMeta?.updatedAt ?? run.startedAt} style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 750 }}>{studioRunTimeLabel(run)}</span>
              </div>
            );
          })}
        </div>
      )}
      {visibleStudioRuns.length === 0 && studioTimeline.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          {studioTimeline.map((item) => (
            <div key={item.id} style={{ display: "grid", gridTemplateColumns: "54px 1fr", gap: 8, alignItems: "center" }}>
              <span style={{ color: studioDisplayStatusColor(item.status), fontSize: 10, fontWeight: 900 }}>{studioDisplayStatusLabel(item.displayStatus)}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: "var(--text)", fontWeight: 800 }}>{item.id}</span> · {item.title}{item.summary ? ` · ${item.summary}` : item.reason ? ` · ${item.reason}` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {studioRuntime.status === "waiting_for_studio_children" && <div style={{ marginTop: 7, color: "var(--text-dim)", fontSize: 11 }}>主 Chat 会在子任务结束后自动 collect 并继续派发；你也可以输入“先停一下 / 继续跑 / 重试这个”来干预。</div>}
    </div>
  ) : null;

  const archivedBannerElement = isArchived ? (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "8px 14px",
      background: "rgba(234,179,8,0.08)",
      borderBottom: "1px solid rgba(234,179,8,0.2)",
      color: "var(--text-muted)",
      fontSize: 12,
      flexShrink: 0,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>此会话已归档。取消归档以继续对话。</span>
    </div>
  ) : null;

  const chatInputElement = isArchived ? (
    <div style={{ padding: "12px 14px", textAlign: "center", color: "var(--text-dim)", fontSize: 12, flexShrink: 0 }}>
      已归档的会话不可发送新消息。
    </div>
  ) : (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      cwd={session?.cwd ?? newSessionCwd}
      sessionId={effectiveSessionId ?? null}
      onEnsureBrowserShareSession={ensureBrowserShareSession}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      modelNames={modelNames}
      modelList={modelList}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      autoScrollEnabled={autoScrollEnabled}
      onAutoScrollToggle={onAutoScrollToggle}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading session...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {archivedBannerElement}
      {session?.id && (
        <SessionChangesFloatingPanel sessionId={session.id} agentRunning={agentRunning} />
      )}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-[820px]">
            <div
              className="chat-empty-header mb-3"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginLeft: 16,
                marginRight: 52,
                fontFamily: "var(--font-mono)",
              }}
            >
              <div className="chat-empty-title-row" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, lineHeight: 1.4 }}>
                <Image src="/yolk-pi-logo.png" alt="yolk pi web" width={42} height={42} style={{ flexShrink: 0, borderRadius: 10 }} priority />
                <span style={{ fontSize: 22, color: "var(--text)", fontWeight: 800, letterSpacing: "-0.02em", textTransform: "lowercase" }}>yolk pi web</span>
                <span style={{ fontSize: 14, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                  <Typewriter phrases={TYPEWRITER_PHRASES} />
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                </span>
              </div>
            </div>
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
          <div className="mx-auto max-w-[820px] px-4">
            {studioWaitingBannerElement}

            {(() => {
              const toolResultsMap = new Map<string, import("@/lib/types").ToolResultMessage>();
              for (const msg of messages) {
                if (msg.role === "toolResult") {
                  toolResultsMap.set((msg as import("@/lib/types").ToolResultMessage).toolCallId, msg as import("@/lib/types").ToolResultMessage);
                }
              }
              let lastUserIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user") { lastUserIdx = i; break; }
              }
              let refIdx = 0;
              return messages.map((msg, idx) => {
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                    ? entryIds[idx - 1]
                    : undefined;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = isVisible ? refIdx++ : -1;
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") { showTimestamp = false; break; }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                const view = (
                  <MessageView
                    key={idx}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    entryId={entryIds[idx]}
                    onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                    onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as import("@/lib/types").AgentMessage & { timestamp?: number }).timestamp : undefined}
                    toolProgressById={toolProgressById}
                    cwd={session?.cwd ?? newSessionCwd ?? undefined}
                  />
                );
                if (!isVisible) return view;
                return (
                  <div key={idx} ref={(el) => {
                    messageRefs.current[currentRefIdx] = el;
                    if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                  }}>
                    {view}
                  </div>
                );
              });
            })()}

            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} toolProgressById={toolProgressById} cwd={session?.cwd ?? newSessionCwd ?? undefined} />
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase)}</span>
              </div>
            )}

            {agentRunning && !autoScrollEnabled && (
              <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
        <div className="chat-minimap-wrap">
          <ChatMinimap
            messages={messages}
            streamingMessage={streamState.streamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
          />
        </div>
      </div>

      <div className="relative">
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}