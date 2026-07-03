"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody";
import type { ToolExecutionProgress } from "@/hooks/useAgentSession";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import type {
  YpiStudioSubagentCurrentTool,
  YpiStudioSubagentPolicyDiagnostics,
  YpiStudioSubagentRunPhase,
  YpiStudioSubagentTranscriptItem,
  YpiStudioSubagentTranscriptRef,
  YpiStudioSubagentTranscriptResponse,
} from "@/lib/ypi-studio-types";

interface Props {
  block: ToolCallContent;
  result?: ToolResultMessage;
  progress?: ToolExecutionProgress;
  duration?: number;
  cwd?: string;
}

type StudioRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "waiting_for_user" | "unavailable";

interface StudioRunDisplayLimits {
  recentLimit?: number;
  previewTruncated?: boolean;
  finalOutputTruncated?: boolean;
  transcriptItemTruncated?: boolean;
  transcriptCaptureLimited?: boolean;
  apiProjectionLimited?: boolean;
}

interface StudioRunProgress {
  schemaVersion?: 1;
  phase?: YpiStudioSubagentRunPhase;
  startedAt?: string;
  updatedAt?: string;
  eventCount?: number;
  lastTextPreview?: string;
  itemsPreview?: YpiStudioSubagentTranscriptItem[];
  warnings?: string[];
  outputChars?: number;
  tokens?: number;
  tokenSource?: "estimated_chars" | "usage";
  tps?: number;
  firstTokenAt?: string;
  lastTokenAt?: string;
  currentTool?: YpiStudioSubagentCurrentTool;
  display?: StudioRunDisplayLimits;
  terminationReason?: string;
}

interface StudioRunProjection {
  id?: string;
  member?: string;
  status?: StudioRunStatus;
  taskId?: string;
  taskKey?: string;
  subtaskId?: string;
  action?: string;
  mode?: string;
  transcript?: YpiStudioSubagentTranscriptRef;
  progress?: StudioRunProgress;
  model?: string;
  thinking?: string;
  modelSource?: string;
  thinkingSource?: string;
  policy?: YpiStudioSubagentPolicyDiagnostics;
  summary?: string;
  error?: string;
  terminationReason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resultText(result?: ToolResultMessage): string {
  if (!result) return "";
  return result.content.filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("\n");
}

function normalizeStatus(value: unknown): StudioRunStatus | undefined {
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "waiting_for_user") return value;
  return undefined;
}

function normalizeTranscriptStatus(value: unknown): YpiStudioSubagentTranscriptRef["status"] | undefined {
  if (value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "waiting_for_user") return value;
  return undefined;
}

function normalizeTranscriptRef(value: unknown): YpiStudioSubagentTranscriptRef | undefined {
  if (!isRecord(value) || value.format !== "ypi-studio-subagent-transcript" || value.schemaVersion !== 1) return undefined;
  const runId = asString(value.runId);
  const taskId = asString(value.taskId);
  const member = asString(value.member);
  const pathLabel = asString(value.pathLabel);
  const status = normalizeTranscriptStatus(value.status);
  const startedAt = asString(value.startedAt);
  const updatedAt = asString(value.updatedAt);
  if (!runId || !taskId || !member || !pathLabel || !status || !startedAt || !updatedAt) return undefined;
  return {
    schemaVersion: 1,
    format: "ypi-studio-subagent-transcript",
    runId,
    taskId,
    member,
    pathLabel,
    status,
    startedAt,
    finishedAt: asString(value.finishedAt),
    updatedAt,
    itemCount: typeof value.itemCount === "number" ? value.itemCount : 0,
    messageCount: typeof value.messageCount === "number" ? value.messageCount : 0,
    toolCallCount: typeof value.toolCallCount === "number" ? value.toolCallCount : 0,
    stderrBytes: typeof value.stderrBytes === "number" ? value.stderrBytes : 0,
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
    truncated: value.truncated === true,
    truncation: isRecord(value.truncation) ? {
      itemTruncated: value.truncation.itemTruncated === true,
      captureLimited: value.truncation.captureLimited === true,
      bytesLimit: typeof value.truncation.bytesLimit === "number" ? value.truncation.bytesLimit : undefined,
      itemBytesLimit: typeof value.truncation.itemBytesLimit === "number" ? value.truncation.itemBytesLimit : undefined,
    } : undefined,
  };
}

function normalizeItems(value: unknown): YpiStudioSubagentTranscriptItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is YpiStudioSubagentTranscriptItem => isRecord(item) && typeof item.kind === "string" && typeof item.at === "string");
}

function normalizePhase(value: unknown): YpiStudioSubagentRunPhase | undefined {
  return value === "starting" || value === "waiting_model" || value === "streaming" || value === "running_tool" || value === "waiting_for_user" || value === "finished" ? value : undefined;
}

function normalizeCurrentTool(value: unknown): YpiStudioSubagentCurrentTool | undefined {
  if (!isRecord(value)) return undefined;
  const toolCallId = asString(value.toolCallId);
  const toolName = asString(value.toolName);
  if (!toolCallId || !toolName) return undefined;
  return { toolCallId, toolName, startedAt: asString(value.startedAt) };
}

function normalizeDisplayLimits(value: unknown): StudioRunDisplayLimits | undefined {
  if (!isRecord(value)) return undefined;
  return {
    recentLimit: typeof value.recentLimit === "number" ? value.recentLimit : undefined,
    previewTruncated: value.previewTruncated === true,
    finalOutputTruncated: value.finalOutputTruncated === true,
    transcriptItemTruncated: value.transcriptItemTruncated === true,
    transcriptCaptureLimited: value.transcriptCaptureLimited === true,
    apiProjectionLimited: value.apiProjectionLimited === true,
  };
}

function normalizePolicy(value: unknown): YpiStudioSubagentPolicyDiagnostics | undefined {
  return isRecord(value) && value.schemaVersion === 1 ? value as unknown as YpiStudioSubagentPolicyDiagnostics : undefined;
}

function normalizeProgress(value: unknown): StudioRunProgress | undefined {
  if (!isRecord(value)) return undefined;
  return {
    schemaVersion: value.schemaVersion === 1 ? 1 : undefined,
    phase: normalizePhase(value.phase),
    startedAt: asString(value.startedAt),
    updatedAt: asString(value.updatedAt),
    eventCount: typeof value.eventCount === "number" ? value.eventCount : undefined,
    lastTextPreview: asString(value.lastTextPreview),
    itemsPreview: normalizeItems(value.itemsPreview),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : undefined,
    outputChars: typeof value.outputChars === "number" ? value.outputChars : undefined,
    tokens: typeof value.tokens === "number" ? value.tokens : undefined,
    tokenSource: value.tokenSource === "estimated_chars" || value.tokenSource === "usage" ? value.tokenSource : undefined,
    tps: typeof value.tps === "number" ? value.tps : undefined,
    firstTokenAt: asString(value.firstTokenAt),
    lastTokenAt: asString(value.lastTokenAt),
    currentTool: normalizeCurrentTool(value.currentTool),
    display: normalizeDisplayLimits(value.display),
    terminationReason: asString(value.terminationReason),
  };
}

function normalizeRun(value: unknown): StudioRunProjection | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    member: asString(value.member),
    status: normalizeStatus(value.status),
    taskId: asString(value.taskId),
    taskKey: asString(value.taskKey),
    subtaskId: asString(value.subtaskId),
    transcript: normalizeTranscriptRef(value.transcript),
    progress: normalizeProgress(value.progress),
    model: asString(value.model),
    thinking: asString(value.thinking),
    modelSource: asString(value.modelSource),
    thinkingSource: asString(value.thinkingSource),
    policy: normalizePolicy(value.policy),
    summary: asString(value.summary),
    error: asString(value.error),
    terminationReason: asString(value.terminationReason),
  };
}

function runFromDetails(details: unknown): StudioRunProjection | undefined {
  if (!isRecord(details)) return undefined;
  return normalizeRun(details.run);
}

function mergeRunProjections(...runs: (StudioRunProjection | undefined)[]): StudioRunProjection {
  return runs.reduce<StudioRunProjection>((acc, run) => {
    if (!run) return acc;
    return {
      id: run.id ?? acc.id,
      member: run.member ?? acc.member,
      status: run.status ?? acc.status,
      taskId: run.taskId ?? acc.taskId,
      taskKey: run.taskKey ?? acc.taskKey,
      subtaskId: run.subtaskId ?? acc.subtaskId,
      action: run.action ?? acc.action,
      mode: run.mode ?? acc.mode,
      transcript: run.transcript ?? acc.transcript,
      progress: run.progress ?? acc.progress,
      model: run.model ?? acc.model,
      thinking: run.thinking ?? acc.thinking,
      modelSource: run.modelSource ?? acc.modelSource,
      thinkingSource: run.thinkingSource ?? acc.thinkingSource,
      policy: run.policy ?? acc.policy,
      summary: run.summary ?? acc.summary,
      error: run.error ?? acc.error,
      terminationReason: run.terminationReason ?? acc.terminationReason,
    };
  }, {});
}

function inputString(input: Record<string, unknown>, key: string): string | undefined {
  return asString(input[key]);
}

function formatElapsed(startedAt?: string, finishedAt?: string, fallbackSecs?: number): string | undefined {
  if (fallbackSecs !== undefined) return `${fallbackSecs}s`;
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function statusLabel(status: StudioRunStatus): string {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "waiting_for_user") return "Waiting for user";
  if (status === "queued") return "Queued";
  if (status === "unavailable") return "Transcript unavailable";
  return "Running";
}

function phaseLabel(phase?: YpiStudioSubagentRunPhase, currentTool?: YpiStudioSubagentCurrentTool): string {
  if (phase === "starting") return "Starting child";
  if (phase === "waiting_model") return "Waiting model";
  if (phase === "streaming") return "Streaming";
  if (phase === "running_tool") return `Running tool${currentTool?.toolName ? `: ${currentTool.toolName}` : ""}`;
  if (phase === "waiting_for_user") return "Waiting for user";
  if (phase === "finished") return "Finished";
  return "—";
}

function statsText(progress?: StudioRunProgress): string | undefined {
  if (!progress) return undefined;
  const tokens = typeof progress.tokens === "number" ? `${progress.tokens} tokens` : undefined;
  const tps = typeof progress.tps === "number" ? `${progress.tps.toFixed(1)} t/s` : undefined;
  return [tokens, tps].filter(Boolean).join(" · ") || undefined;
}

function policyWarningMessages(policy?: YpiStudioSubagentPolicyDiagnostics): string[] {
  return policy?.warnings?.map((warning) => warning.message) ?? [];
}

function statusColor(status: StudioRunStatus): string {
  if (status === "succeeded") return "#16a34a";
  if (status === "waiting_for_user") return "#f59e0b";
  if (status === "failed" || status === "cancelled") return "#f87171";
  if (status === "queued") return "#38bdf8";
  if (status === "unavailable") return "var(--text-dim)";
  return "var(--accent)";
}

function statusBorderColor(status: StudioRunStatus): string {
  if (status === "failed" || status === "cancelled") return "rgba(248,113,113,0.45)";
  if (status === "waiting_for_user") return "rgba(245,158,11,0.45)";
  if (status === "queued") return "rgba(56,189,248,0.35)";
  return "rgba(34,197,94,0.25)";
}

function statusBackground(status: StudioRunStatus): string {
  if (status === "failed" || status === "cancelled") return "rgba(248,113,113,0.05)";
  if (status === "waiting_for_user") return "rgba(245,158,11,0.06)";
  return "rgba(34,197,94,0.04)";
}

function itemText(item: YpiStudioSubagentTranscriptItem): string {
  if (item.kind === "tool_call") return item.inputPreview;
  if (item.kind === "tool_result") return item.text;
  return item.text;
}

function itemTitle(item: YpiStudioSubagentTranscriptItem): string {
  if (item.kind === "prompt") return "Prompt";
  if (item.kind === "assistant") return "Assistant";
  if (item.kind === "tool_call") return `Tool call · ${item.toolName}`;
  if (item.kind === "tool_result") return `Tool result${item.toolName ? ` · ${item.toolName}` : ""}`;
  if (item.kind === "stderr") return "stderr";
  if (item.kind === "error") return "Error";
  return "Status";
}

function itemAccent(item: YpiStudioSubagentTranscriptItem): string {
  if (item.kind === "assistant") return "var(--accent)";
  if (item.kind === "stderr" || item.kind === "error" || (item.kind === "tool_result" && item.isError)) return "#f87171";
  if (item.kind === "tool_call" || item.kind === "tool_result") return "#16a34a";
  return "var(--text-muted)";
}

function compactItems(items: YpiStudioSubagentTranscriptItem[], debug: boolean, limit = 5): YpiStudioSubagentTranscriptItem[] {
  if (debug) return items;
  const visible = items.filter((item) => item.kind !== "prompt" && item.kind !== "stderr");
  return visible.slice(-Math.max(1, limit));
}

function isDisplayNote(text: string): boolean {
  return /^Display note:/i.test(text) || /projection limits|bounded preview|clipped|truncated/i.test(text);
}

function previewText(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function YpiStudioSubagentTranscript({ block, result, progress, duration, cwd }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [finalExpanded, setFinalExpanded] = useState(false);
  const [apiResponse, setApiResponse] = useState<YpiStudioSubagentTranscriptResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const inputRun = useMemo<StudioRunProjection>(() => ({
    member: inputString(block.input, "member"),
    taskId: inputString(block.input, "taskId"),
    model: inputString(block.input, "model"),
    thinking: inputString(block.input, "thinking"),
    id: inputString(block.input, "runId"),
    taskKey: inputString(block.input, "taskKey"),
    subtaskId: inputString(block.input, "subtaskId"),
    action: inputString(block.input, "action"),
    mode: inputString(block.input, "mode"),
    modelSource: inputString(block.input, "model") ? "toolInput" : undefined,
    thinkingSource: inputString(block.input, "thinking") ? "toolInput" : undefined,
  }), [block.input]);

  const progressRun = runFromDetails(progress?.partialResult?.details);
  const finalRun = runFromDetails(result?.details);
  const run = mergeRunProjections(inputRun, progressRun, finalRun);
  const transcript = apiResponse?.transcript ?? run.transcript;
  const isAsyncStart = run.mode === "async" && (!run.action || run.action === "start");
  const status: StudioRunStatus = run.status ?? (progress?.running ? "running" : result ? (result.isError ? "failed" : isAsyncStart ? "running" : "succeeded") : isAsyncStart ? "queued" : "running");
  const finalText = resultText(result);
  const progressItems = run.progress?.itemsPreview ?? [];
  const items = apiResponse?.items ?? progressItems;
  const warnings = [...policyWarningMessages(run.policy), ...(run.progress?.warnings ?? []), ...(apiResponse?.warnings ?? [])];
  const elapsed = formatElapsed(run.progress?.startedAt ?? transcript?.startedAt, transcript?.finishedAt, duration);
  const lastPreview = run.progress?.lastTextPreview ?? run.summary ?? run.error ?? previewText(finalText || "Waiting for Studio member output…");
  const taskId = transcript?.taskId ?? run.taskId ?? inputRun.taskId;
  const taskKey = run.taskKey ?? taskId;
  const runId = transcript?.runId ?? run.id;
  const effectiveCwd = cwd ?? (isRecord(result?.details) && isRecord(result.details.task) ? asString(result.details.task.cwd) : undefined);

  useEffect(() => {
    if (status !== "running" && status !== "queued") return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const needsFullTranscript = debugExpanded || rawExpanded;
    if (!needsFullTranscript || !transcript || !taskKey || !runId || !effectiveCwd || status === "running" || status === "queued") return;
    let cancelled = false;
    setApiError(null);
    const url = `/api/studio/tasks/${encodeURIComponent(taskKey)}/subagents/${encodeURIComponent(runId)}/transcript?cwd=${encodeURIComponent(effectiveCwd)}&limit=300`;
    fetch(url)
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        return body as YpiStudioSubagentTranscriptResponse;
      })
      .then((body) => { if (!cancelled) setApiResponse(body); })
      .catch((error) => { if (!cancelled) setApiError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [debugExpanded, effectiveCwd, rawExpanded, runId, status, taskKey, transcript]);

  const modelLabel = run.model ?? "Pi default";
  const thinkingLabel = run.thinking ?? "default";
  const recentLimit = run.progress?.display?.recentLimit ?? 5;
  const displayItems = compactItems(items, debugExpanded, recentLimit);
  const phase = run.progress?.phase ?? (status === "running" ? "waiting_model" : status === "queued" ? "starting" : status === "waiting_for_user" ? "waiting_for_user" : result ? "finished" : undefined);
  const stats = statsText(run.progress);
  const tpsLabel = typeof run.progress?.tps === "number" ? `${run.progress.tps.toFixed(1)} t/s` : undefined;
  const displayNotes = [
    transcript?.truncated ? "Showing a bounded recent/debug preview. Transcript clipping does not by itself mean the member run failed." : undefined,
    run.progress?.display?.finalOutputTruncated ? "Final output was clipped for the parent result; the member run status is unchanged." : undefined,
    run.progress?.display?.previewTruncated ? "Recent activity text is clipped for display safety." : undefined,
    ...warnings.filter(isDisplayNote),
  ].filter((note): note is string => !!note);
  const warningNotes = warnings.filter((warning) => !isDisplayNote(warning));
  const warningTitle = warningNotes.slice(0, 3).join("\n");
  const headerPreview = `${run.member ?? "member"} · ${statusLabel(status)} · ${phaseLabel(phase, run.progress?.currentTool)}${elapsed ? ` · ${elapsed}` : ""} · ${previewText(lastPreview, 120)}`;
  void tick;

  return (
    <div
      style={{
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 12,
        border: `1px solid ${statusBorderColor(status)}`,
        background: statusBackground(status),
      }}
    >
      <button
        onClick={() => setExpanded((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: statusColor(status), fontFamily: "var(--font-mono)", fontWeight: 650, fontSize: 11, flexShrink: 0 }}>ypi_studio_subagent</span>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{headerPreview}</span>
        {tpsLabel && <Chip title={run.progress?.tokenSource === "estimated_chars" ? "estimated from output characters" : "usage tokens"}>{tpsLabel}</Chip>}
        <Chip title={run.modelSource ? `model source: ${run.modelSource}` : undefined}>model: {modelLabel}</Chip>
        <Chip title={run.thinkingSource ? `thinking source: ${run.thinkingSource}` : undefined}>thinking: {thinkingLabel}</Chip>
        {displayNotes.length > 0 && <span title={displayNotes.slice(0, 3).join("\n")} style={{ color: "var(--text-dim)", fontSize: 12, flexShrink: 0 }}>ⓘ {displayNotes.length}</span>}
        {warningNotes.length > 0 && <span title={warningTitle} style={{ color: "#eab308", fontSize: 12, flexShrink: 0 }}>⚠ {warningNotes.length}</span>}
        {run.progress?.eventCount !== undefined && <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{run.progress.eventCount} events</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid rgba(34,197,94,0.16)", background: "var(--bg-subtle)" }}>
          <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, color: "var(--text-muted)", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
            <Meta label="Member" value={run.member ?? "unknown"} />
            <Meta label="Status" value={statusLabel(status)} color={statusColor(status)} />
            <Meta label="Phase" value={phaseLabel(phase, run.progress?.currentTool)} />
            <Meta label="Task" value={taskId ?? "unknown"} />
            <Meta label="Run" value={runId ?? "pending"} />
            <Meta label="Model" value={modelLabel} title={run.modelSource ? `source: ${run.modelSource}` : undefined} />
            <Meta label="Thinking" value={thinkingLabel} title={run.thinkingSource ? `source: ${run.thinkingSource}` : undefined} />
            <Meta label="Elapsed" value={elapsed ?? "—"} />
            <Meta label="Tokens" value={stats ?? "—"} title={run.progress?.tokenSource === "estimated_chars" ? "estimated from output characters" : run.progress?.tokenSource} />
            <Meta label="Updated" value={run.progress?.updatedAt ? new Date(run.progress.updatedAt).toLocaleTimeString() : "—"} />
          </div>

          <SectionHeader title="Delegated prompt" right={<button onClick={() => setInputExpanded((value) => !value)} style={plainButtonStyle}>{inputExpanded ? "Hide prompt" : "Show prompt"}</button>} />
          {inputExpanded && <div style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{asString(block.input.prompt) ?? "(no prompt)"}</div>}

          <SectionHeader title={`Recent activity · last ${recentLimit}`} right={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>{debugExpanded && transcript?.pathLabel ? <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{transcript.pathLabel}</span> : null}<button onClick={() => setDebugExpanded((value) => !value)} style={plainButtonStyle}>{debugExpanded ? "Hide debug" : "Show debug"}</button>{debugExpanded && <button onClick={() => setRawExpanded((value) => !value)} style={plainButtonStyle}>{rawExpanded ? "Hide raw" : "Show raw"}</button>}</div>} />
          <div style={{ maxHeight: "min(360px, 45vh)", overflow: "auto", background: "var(--bg)", padding: "8px 10px" }}>
            {status === "running" && items.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>Child Pi process started. Waiting for first JSON event…</div>
            )}
            {!transcript && status !== "running" && (
              <Warning text="This Studio member run was created before transcript capture, or transcript capture failed; showing final output only." />
            )}
            {apiError && <Warning text={`Transcript unavailable: ${apiError}. Showing cached preview/final output instead.`} />}
            {(status === "failed" || status === "cancelled") && <Warning text={`This member run stopped before completion${run.terminationReason ? ` (${run.terminationReason})` : ""}. You can ask the main session to retry the same member, continue from the current Studio phase, or mark the task blocked/cancelled if the failure is persistent.`} />}
            {displayNotes.map((note, index) => <Info key={`info-${index}-${note}`} text={note} />)}
            {warningNotes.map((warning, index) => <Warning key={`${index}-${warning}`} text={warning} />)}
            {displayItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {displayItems.map((item, index) => <TranscriptItem key={`${item.at}-${item.kind}-${index}`} item={item} compact={!debugExpanded} />)}
              </div>
            ) : finalText ? (
              <MarkdownBody>{finalText}</MarkdownBody>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>(no transcript output yet)</div>
            )}
          </div>

          {debugExpanded && rawExpanded && (
            <>
              <SectionHeader title="Raw debug" />
              <pre style={{ ...preStyle, maxHeight: 420 }}>{safeJson({ input: block.input, progressDetails: progress?.partialResult?.details, resultDetails: result?.details, items })}</pre>
            </>
          )}

          <SectionHeader title="Final output" right={finalText ? <button onClick={() => setFinalExpanded((value) => !value)} style={plainButtonStyle}>{finalExpanded ? "Hide" : "Show"}</button> : null} />
          {finalText ? (
            finalExpanded ? <pre style={{ ...preStyle, maxHeight: 360 }}>{finalText}</pre> : <div style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{previewText(finalText, 260)}</div>
          ) : (
            <div style={{ padding: "8px 10px", color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>Waiting for final output…</div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      style={{
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 180,
        padding: "2px 6px",
        borderRadius: 999,
        border: "1px solid rgba(34,197,94,0.22)",
        background: "rgba(34,197,94,0.08)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Meta({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 12, color: color ?? "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title ?? value}>{value}</div>
    </div>
  );
}

function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 12, fontWeight: 650 }}>
      <span>{title}</span>
      {right}
    </div>
  );
}

function Warning({ text }: { text: string }) {
  return <div style={{ marginBottom: 8, padding: "6px 8px", border: "1px solid rgba(234,179,8,0.28)", borderRadius: 6, background: "rgba(234,179,8,0.08)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{text}</div>;
}

function Info({ text }: { text: string }) {
  return <div style={{ marginBottom: 8, padding: "6px 8px", border: "1px solid rgba(148,163,184,0.24)", borderRadius: 6, background: "rgba(148,163,184,0.07)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{text}</div>;
}

function displayItemText(item: YpiStudioSubagentTranscriptItem, compact: boolean): string {
  if (!compact) return itemText(item);
  if (item.kind === "tool_call") return `Running tool: ${item.toolName}`;
  if (item.kind === "tool_result") return `Tool ${item.isError ? "failed" : "completed"}${item.toolName ? `: ${item.toolName}` : ""}`;
  if (item.kind === "status") return previewText(item.text, 220);
  if (item.kind === "error") return item.text;
  return previewText(itemText(item), 420);
}

function TranscriptItem({ item, compact = false }: { item: YpiStudioSubagentTranscriptItem; compact?: boolean }) {
  const text = displayItemText(item, compact);
  const isMarkdown = item.kind === "assistant" || item.kind === "prompt";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11 }}>
        <span style={{ color: itemAccent(item), fontFamily: "var(--font-mono)", fontWeight: 650 }}>{itemTitle(item)}</span>
        <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{new Date(item.at).toLocaleTimeString()}</span>
        {"truncated" in item && item.truncated && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>truncated</span>}
      </div>
      <div style={{ padding: "7px 8px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
        {isMarkdown ? <MarkdownBody>{text}</MarkdownBody> : <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", color: item.kind === "stderr" || item.kind === "error" ? "#f87171" : "var(--text-muted)" }}>{text}</pre>}
      </div>
    </div>
  );
}

const plainButtonStyle: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--text-dim)",
  cursor: "pointer",
  fontSize: 11,
};

const preStyle: CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  color: "var(--text-muted)",
  fontSize: 12,
  lineHeight: 1.5,
  overflow: "auto",
  background: "var(--bg)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "var(--font-mono)",
};
