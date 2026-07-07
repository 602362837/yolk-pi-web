"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PiWebThinkingLevel, PiWebToolPreset } from "@/lib/pi-web-config";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { YpiStudioLiveRunOverlay } from "@/lib/ypi-studio-types";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { useAgentSession, type AgentPhase, type SessionUsageTopbarStats } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useDragDrop } from "@/hooks/useDragDrop";
import { SessionChangesFloatingPanel } from "./SessionChangesFloatingPanel";

interface Props {
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
  onSubagentChange?: (runs: import("@/hooks/useAgentSession").SubagentRun[]) => void;
  onSessionStatsChange?: (stats: SessionUsageTopbarStats | null) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onStudioToolProgressChange?: (snapshot: { agentRunning: boolean; overlays: YpiStudioLiveRunOverlay[] }) => void;
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

export function ChatWindow({ session, newSessionCwd, newSessionProjectContext, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSubagentChange, onSessionStatsChange, onContextUsageChange, onStudioToolProgressChange, defaultToolPreset, defaultThinkingLevel }: Props) {
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
    session, newSessionCwd, newSessionProjectContext, onAgentEnd, onSessionCreated, onSessionForked,
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
    ? [
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.cost ?? 0,
      sessionStats.source,
      sessionStats.parentSessionId ?? "",
      sessionStats.studioChildSessionCount,
      sessionStats.own?.cost ?? 0,
      sessionStats.studioChild?.cost ?? 0,
    ].join("|")
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
        optionalString(run?.id) ?? optionalString(run?.runId) ?? optionalString(progress.args?.runId) ?? "",
        optionalString(task?.status) ?? optionalString(run?.status) ?? "",
        optionalString(runProgress?.phase) ?? "",
        optionalNumber(runProgress?.tokens) ?? "",
        optionalNumber(runProgress?.tps) ?? "",
        optionalString(run?.subtaskId) ?? "",
        optionalString(task?.title) ?? optionalString(run?.taskTitle) ?? "",
        optionalString(run?.subtaskTitle) ?? "",
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
          taskTitle: optionalString(task?.title) ?? optionalString(run?.taskTitle),
          runId: optionalString(run?.id) ?? optionalString(run?.runId) ?? optionalString(progress.args?.runId),
          member: optionalString(run?.member) ?? optionalString(progress.args?.member),
          subtaskId: optionalString(run?.subtaskId),
          subtaskTitle: optionalString(run?.subtaskTitle),
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
  const isStudioChildAudit = !!session?.studioChild;

  const studioChildBannerElement = isStudioChildAudit ? (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "8px 14px",
      background: "rgba(37,99,235,0.08)",
      borderBottom: "1px solid rgba(37,99,235,0.2)",
      color: "var(--text-muted)",
      fontSize: 12,
      flexShrink: 0,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--accent)" }} />
      <span>这是 YPI Studio child session 审计视图（{session?.studioChild?.member} · {session?.studioChild?.status ?? "audit"}）。请回到父 Chat 继续编排。</span>
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

  const chatInputElement = isArchived || isStudioChildAudit ? (
    <div style={{ padding: "12px 14px", textAlign: "center", color: "var(--text-dim)", fontSize: 12, flexShrink: 0 }}>
      {isArchived ? "已归档的会话不可发送新消息。" : "Studio child session 为只读审计视图；请回到父 Chat 继续编排。"}
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
      {studioChildBannerElement}
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