"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ToolExecutionProgress } from "@/hooks/useAgentSession";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import type {
  YpiStudioSubagentCurrentTool,
  YpiStudioSubagentRunPhase,
  YpiStudioSubagentRunStatus,
  YpiStudioSubagentTranscriptItem,
} from "@/lib/ypi-studio-types";

interface Props {
  block: ToolCallContent;
  result?: ToolResultMessage;
  progress?: ToolExecutionProgress;
  duration?: number;
}

type WaitStatus = "waiting" | "terminal" | "still_running" | "no_active_runs" | "cancelled" | "unknown";

type WaitRunStatus = YpiStudioSubagentRunStatus | "runtime_lost" | "unknown";

interface WaitRunProjection {
  runId: string;
  taskId?: string;
  taskKey?: string;
  subtaskId?: string;
  member?: string;
  taskTitle?: string;
  subtaskTitle?: string;
  status: WaitRunStatus;
  registryStatus?: string;
  registryActive?: boolean;
  progress?: {
    phase?: YpiStudioSubagentRunPhase;
    updatedAt?: string;
    eventCount?: number;
    lastTextPreview?: string;
    itemsPreview?: YpiStudioSubagentTranscriptItem[];
    warnings?: string[];
    tokens?: number;
    tps?: number;
    currentTool?: YpiStudioSubagentCurrentTool;
    display?: {
      recentLimit?: number;
      previewTruncated?: boolean;
      finalOutputTruncated?: boolean;
      transcriptItemTruncated?: boolean;
      transcriptCaptureLimited?: boolean;
      apiProjectionLimited?: boolean;
    };
    terminationReason?: string;
  };
  transcriptPreview?: { items?: YpiStudioSubagentTranscriptItem[] } | unknown;
  summary?: string;
  error?: string;
  terminationReason?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface WaitProjection {
  status: WaitStatus;
  task?: { id?: string; key?: string; title?: string; status?: string; workflowId?: string };
  runs: WaitRunProjection[];
  run?: WaitRunProjection;
  timeoutMs?: number;
  nextRecommendedAction?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRunStatus(value: unknown): WaitRunStatus {
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "waiting_for_user" || value === "runtime_lost") return value;
  return "unknown";
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

function normalizeItems(value: unknown): YpiStudioSubagentTranscriptItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is YpiStudioSubagentTranscriptItem => isRecord(item) && typeof item.kind === "string" && typeof item.at === "string");
}

function normalizeProgress(value: unknown): WaitRunProjection["progress"] | undefined {
  if (!isRecord(value)) return undefined;
  const display = isRecord(value.display) ? {
    recentLimit: asNumber(value.display.recentLimit),
    previewTruncated: value.display.previewTruncated === true,
    finalOutputTruncated: value.display.finalOutputTruncated === true,
    transcriptItemTruncated: value.display.transcriptItemTruncated === true,
    transcriptCaptureLimited: value.display.transcriptCaptureLimited === true,
    apiProjectionLimited: value.display.apiProjectionLimited === true,
  } : undefined;
  return {
    phase: normalizePhase(value.phase),
    updatedAt: asString(value.updatedAt),
    eventCount: asNumber(value.eventCount),
    lastTextPreview: asString(value.lastTextPreview),
    itemsPreview: normalizeItems(value.itemsPreview),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : undefined,
    tokens: asNumber(value.tokens),
    tps: asNumber(value.tps),
    currentTool: normalizeCurrentTool(value.currentTool),
    display,
    terminationReason: asString(value.terminationReason),
  };
}

function normalizeRun(value: unknown): WaitRunProjection | undefined {
  if (!isRecord(value)) return undefined;
  const runId = asString(value.runId) ?? asString(value.id);
  if (!runId) return undefined;
  return {
    runId,
    taskId: asString(value.taskId),
    taskKey: asString(value.taskKey),
    subtaskId: asString(value.subtaskId),
    member: asString(value.member),
    taskTitle: asString(value.taskTitle),
    subtaskTitle: asString(value.subtaskTitle),
    status: normalizeRunStatus(value.status),
    registryStatus: asString(value.registryStatus),
    registryActive: value.registryActive === true,
    progress: normalizeProgress(value.progress),
    transcriptPreview: value.transcriptPreview,
    summary: asString(value.summary),
    error: asString(value.error),
    terminationReason: asString(value.terminationReason),
    startedAt: asString(value.startedAt),
    finishedAt: asString(value.finishedAt),
  };
}

function normalizeWaitStatus(value: unknown): WaitStatus {
  if (value === "waiting" || value === "terminal" || value === "still_running" || value === "no_active_runs" || value === "cancelled") return value;
  return "unknown";
}

function normalizeTask(value: unknown): WaitProjection["task"] {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    key: asString(value.key),
    title: asString(value.title),
    status: asString(value.status),
    workflowId: asString(value.workflowId),
  };
}

function normalizeWait(value: unknown): WaitProjection | undefined {
  if (!isRecord(value)) return undefined;
  const runs = Array.isArray(value.runs) ? value.runs.map(normalizeRun).filter((run): run is WaitRunProjection => !!run) : [];
  const singleRun = normalizeRun(value.run);
  return {
    status: normalizeWaitStatus(value.status),
    task: normalizeTask(value.task),
    runs: runs.length ? runs : singleRun ? [singleRun] : [],
    run: singleRun,
    timeoutMs: asNumber(value.timeoutMs),
    nextRecommendedAction: asString(value.nextRecommendedAction),
  };
}

function mergeRun(existing: WaitRunProjection | undefined, incoming: WaitRunProjection): WaitRunProjection {
  return {
    ...existing,
    ...incoming,
    progress: { ...existing?.progress, ...incoming.progress },
  };
}

function mergeWaitProjection(...items: (WaitProjection | undefined)[]): WaitProjection {
  const mergedRuns = new Map<string, WaitRunProjection>();
  let merged: WaitProjection = { status: "unknown", runs: [] };
  for (const item of items) {
    if (!item) continue;
    merged = {
      status: item.status !== "unknown" ? item.status : merged.status,
      task: item.task ?? merged.task,
      runs: merged.runs,
      run: item.run ?? merged.run,
      timeoutMs: item.timeoutMs ?? merged.timeoutMs,
      nextRecommendedAction: item.nextRecommendedAction ?? merged.nextRecommendedAction,
    };
    for (const run of item.runs) mergedRuns.set(run.runId, mergeRun(mergedRuns.get(run.runId), run));
  }
  merged.runs = [...mergedRuns.values()];
  return merged;
}

function contentText(result?: ToolResultMessage): string {
  if (!result) return "";
  return result.content.filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("\n");
}

function requestedRunIds(input: Record<string, unknown>): string[] {
  const ids = Array.isArray(input.runIds) ? input.runIds.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
  const single = asString(input.runId);
  return ids.length ? ids : single ? [single] : [];
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

function runStatusLabel(status: WaitRunStatus): string {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "waiting_for_user") return "Waiting for user";
  if (status === "queued") return "Queued";
  if (status === "runtime_lost") return "Runtime lost";
  if (status === "running") return "Running";
  return "Unknown";
}

function phaseLabel(phase?: YpiStudioSubagentRunPhase, currentTool?: YpiStudioSubagentCurrentTool): string {
  if (phase === "starting") return "Starting child";
  if (phase === "waiting_model") return "Waiting model";
  if (phase === "streaming") return "Streaming";
  if (phase === "running_tool") return `Running tool${currentTool?.toolName ? `: ${currentTool.toolName}` : ""}`;
  if (phase === "waiting_for_user") return "Waiting for user";
  if (phase === "finished") return "Finished";
  return "Waiting for update";
}

function waitStatusLabel(status: WaitStatus): string {
  if (status === "waiting") return "Waiting for Studio children";
  if (status === "terminal") return "Studio children finished";
  if (status === "still_running") return "Still running in background";
  if (status === "no_active_runs") return "No active Studio children";
  if (status === "cancelled") return "Wait cancelled";
  return "YPI Studio wait";
}

function statusColor(status: WaitRunStatus): string {
  if (status === "succeeded") return "#16a34a";
  if (status === "queued") return "#38bdf8";
  if (status === "waiting_for_user") return "#f59e0b";
  if (status === "failed" || status === "cancelled" || status === "runtime_lost") return "#f87171";
  return "var(--accent)";
}

function panelBorder(status: WaitStatus, hasError: boolean): string {
  if (hasError || status === "cancelled") return "rgba(248,113,113,0.45)";
  if (status === "waiting" || status === "still_running") return "rgba(59,130,246,0.38)";
  return "rgba(34,197,94,0.28)";
}

function panelBackground(status: WaitStatus, hasError: boolean): string {
  if (hasError || status === "cancelled") return "rgba(248,113,113,0.05)";
  if (status === "waiting" || status === "still_running") return "rgba(59,130,246,0.05)";
  return "rgba(34,197,94,0.04)";
}

function previewText(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function itemText(item: YpiStudioSubagentTranscriptItem): string {
  if (item.kind === "tool_call") return `Running tool: ${item.toolName}`;
  if (item.kind === "tool_result") return `Tool ${item.isError ? "failed" : "completed"}${item.toolName ? `: ${item.toolName}` : ""}`;
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

function transcriptPreviewItems(run: WaitRunProjection): YpiStudioSubagentTranscriptItem[] {
  if (run.progress?.itemsPreview?.length) return run.progress.itemsPreview;
  if (isRecord(run.transcriptPreview) && Array.isArray(run.transcriptPreview.items)) return normalizeItems(run.transcriptPreview.items) ?? [];
  return [];
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function YpiStudioWaitPanel({ block, result, progress, duration }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [tick, setTick] = useState(0);

  const partialWait = normalizeWait(progress?.partialResult?.details);
  const finalWait = normalizeWait(result?.details);
  const projection = mergeWaitProjection(partialWait, finalWait);
  const inputRunIds = useMemo(() => requestedRunIds(block.input), [block.input]);
  const resultText = contentText(result);

  const runs: WaitRunProjection[] = projection.runs.length
    ? projection.runs
    : inputRunIds.map((runId): WaitRunProjection => ({ runId, taskId: asString(block.input.taskId), status: "queued" }));

  const waitStatus: WaitStatus = projection.status !== "unknown"
    ? projection.status
    : progress?.running || !result ? "waiting" : result.isError ? "cancelled" : "terminal";
  const hasRunError = runs.some((run) => run.status === "failed" || run.status === "cancelled" || run.status === "waiting_for_user" || run.status === "runtime_lost");
  const hasError = !!result?.isError || hasRunError;
  const activeCount = runs.filter((run) => run.status === "queued" || run.status === "running").length;
  const doneCount = runs.filter((run) => run.status === "succeeded").length;
  const taskLabel = projection.task?.title ?? runs.find((run) => run.taskTitle)?.taskTitle ?? projection.task?.id ?? asString(block.input.taskId) ?? "current Studio task";
  const activeTpsValues = runs
    .filter((run) => run.status === "running" && typeof run.progress?.tps === "number")
    .map((run) => run.progress!.tps!);
  const aggregateTps = activeTpsValues.length ? activeTpsValues.reduce((sum, value) => sum + value, 0) : undefined;
  const elapsed = formatElapsed(runs[0]?.startedAt, undefined, duration);

  useEffect(() => {
    if (waitStatus !== "waiting" && waitStatus !== "still_running") return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [waitStatus]);
  void tick;

  return (
    <div style={{ borderRadius: 8, overflow: "hidden", fontSize: 12, border: `1px solid ${panelBorder(waitStatus, hasError)}`, background: panelBackground(waitStatus, hasError) }}>
      <button onClick={() => setExpanded((value) => !value)} style={headerButtonStyle}>
        <span style={{ color: hasError ? "#f87171" : "var(--accent)", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11, flexShrink: 0 }}>ypi_studio_wait</span>
        <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }}>
          {waitStatusLabel(waitStatus)} · {taskLabel} · {activeCount} active / {doneCount} done / {runs.length} total
        </span>
        {aggregateTps !== undefined && <SpeedChip>{aggregateTps.toFixed(1)} t/s</SpeedChip>}
        {elapsed && <Chip>{elapsed}</Chip>}
        {projection.timeoutMs && <Chip>timeout {Math.round(projection.timeoutMs / 1000)}s</Chip>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
          <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
            <Meta label="Wait status" value={waitStatusLabel(waitStatus)} color={hasError ? "#f87171" : "var(--text-muted)"} />
            <Meta label="Task" value={taskLabel} />
            <Meta label="Runs" value={`${activeCount} active / ${doneCount} done / ${runs.length} total`} />
            <Meta label="Poll" value={`${asNumber(block.input.pollIntervalMs) ?? 2000}ms`} />
            <Meta label="Elapsed" value={elapsed ?? "—"} />
          </div>

          <div style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            {runs.length > 0 ? runs.map((run) => <RunCard key={run.runId} run={run} taskTitle={taskLabel} />) : (
              <div style={{ color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>No matching Studio child run is currently active.</div>
            )}
          </div>

          {projection.nextRecommendedAction && <Info text={`Next: ${projection.nextRecommendedAction}`} />}
          {waitStatus === "still_running" && <Info text="The wait timed out, but Studio child runs are still active. The main chat can call ypi_studio_wait again or continue after the child terminal continuation wakes it." />}
          {resultText && <Info text={previewText(resultText, 320)} />}

          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 10px 8px" }}>
            <button onClick={() => setRawExpanded((value) => !value)} style={plainButtonStyle}>{rawExpanded ? "Hide raw" : "Show raw"}</button>
          </div>
          {rawExpanded && <pre style={preStyle}>{safeJson({ input: block.input, progressDetails: progress?.partialResult?.details, resultDetails: result?.details })}</pre>}
        </div>
      )}
    </div>
  );
}

function RunCard({ run, taskTitle }: { run: WaitRunProjection; taskTitle?: string }) {
  const items = transcriptPreviewItems(run).filter((item) => item.kind !== "prompt" && item.kind !== "stderr").slice(-3);
  const phase = run.progress?.phase ?? (run.status === "queued" ? "starting" : run.status === "running" ? "waiting_model" : run.status === "waiting_for_user" ? "waiting_for_user" : run.status === "succeeded" ? "finished" : undefined);
  const summary = run.progress?.lastTextPreview ?? run.summary ?? run.error ?? (items.length ? itemText(items[items.length - 1]) : "Waiting for child progress…");
  const tokens = typeof run.progress?.tokens === "number" ? `${run.progress.tokens} tokens` : undefined;
  const tpsValue = typeof run.progress?.tps === "number" ? run.progress.tps : undefined;
  const tps = tpsValue !== undefined ? `${tpsValue.toFixed(1)} t/s` : undefined;
  const showPendingTps = run.status === "running" && tpsValue === undefined;
  const updated = run.progress?.updatedAt ? new Date(run.progress.updatedAt).toLocaleTimeString() : undefined;
  const elapsed = formatElapsed(run.startedAt, run.finishedAt);
  return (
    <div style={{ border: `1px solid ${statusColor(run.status)}`, borderRadius: 8, background: "var(--bg)", overflow: "hidden" }}>
      <div style={{ padding: "7px 9px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ color: statusColor(run.status), fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11 }}>{run.member ?? "member"}</span>
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.runId}</span>
          {tps && <SpeedChip>{tps}</SpeedChip>}
          {showPendingTps && <Chip>calculating t/s</Chip>}
          <span style={{ marginLeft: "auto", color: statusColor(run.status), fontSize: 11, flexShrink: 0 }}>{runStatusLabel(run.status)}</span>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.subtaskTitle ?? run.taskTitle ?? taskTitle}>
          {run.subtaskTitle ?? run.taskTitle ?? taskTitle ?? "Studio task"}
        </div>
      </div>
      <div style={{ padding: "8px 9px", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          <Chip>{phaseLabel(phase, run.progress?.currentTool)}</Chip>
          {run.subtaskId && <Chip>subtask {run.subtaskId}</Chip>}
          {tokens && <Chip>{tokens}</Chip>}
          {elapsed && <Chip>{elapsed}</Chip>}
          {updated && <Chip>updated {updated}</Chip>}
        </div>
        <div style={{ color: run.error ? "#f87171" : "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{previewText(summary, 260)}</div>
        {items.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {items.map((item, index) => (
              <div key={`${item.at}-${item.kind}-${index}`} style={{ padding: "5px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>
                <span style={{ color: "var(--text-dim)", marginRight: 6 }}>{new Date(item.at).toLocaleTimeString()}</span>
                {previewText(itemText(item), 180)}
              </div>
            ))}
          </div>
        )}
        {(run.terminationReason || run.progress?.terminationReason) && <Warning text={`Stopped: ${run.terminationReason ?? run.progress?.terminationReason}`} />}
        {run.progress?.display && (run.progress.display.previewTruncated || run.progress.display.apiProjectionLimited || run.progress.display.transcriptCaptureLimited) && <Info text="Preview is bounded/truncated for display safety; this does not by itself mean the child run failed." />}
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span style={{ padding: "2px 6px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.22)", background: "rgba(148,163,184,0.08)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{children}</span>;
}

function SpeedChip({ children }: { children: ReactNode }) {
  return <span style={{ padding: "2px 6px", borderRadius: 999, border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.12)", color: "#16a34a", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 10, flexShrink: 0 }}>{children}</span>;
}

function Meta({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 12, color: color ?? "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>{value}</div>
    </div>
  );
}

function Info({ text }: { text: string }) {
  return <div style={{ margin: "0 10px 8px", padding: "6px 8px", border: "1px solid rgba(148,163,184,0.24)", borderRadius: 6, background: "rgba(148,163,184,0.07)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{text}</div>;
}

function Warning({ text }: { text: string }) {
  return <div style={{ padding: "5px 6px", border: "1px solid rgba(234,179,8,0.28)", borderRadius: 6, background: "rgba(234,179,8,0.08)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>{text}</div>;
}

const headerButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  padding: "7px 10px",
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 12,
  textAlign: "left",
  minWidth: 0,
};

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
  borderTop: "1px solid var(--border)",
  color: "var(--text-muted)",
  fontSize: 12,
  lineHeight: 1.5,
  overflow: "auto",
  maxHeight: 420,
  background: "var(--bg)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "var(--font-mono)",
};
