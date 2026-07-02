"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody";
import type { ToolExecutionProgress } from "@/hooks/useAgentSession";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import type {
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

type StudioRunStatus = "running" | "succeeded" | "failed" | "cancelled" | "unavailable";

interface StudioRunProgress {
  startedAt?: string;
  updatedAt?: string;
  eventCount?: number;
  lastTextPreview?: string;
  itemsPreview?: YpiStudioSubagentTranscriptItem[];
  warnings?: string[];
}

interface StudioRunProjection {
  id?: string;
  member?: string;
  status?: StudioRunStatus;
  taskId?: string;
  transcript?: YpiStudioSubagentTranscriptRef;
  progress?: StudioRunProgress;
  model?: string;
  thinking?: string;
  summary?: string;
  error?: string;
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
  if (value === "running" || value === "succeeded" || value === "failed" || value === "cancelled") return value;
  return undefined;
}

function normalizeTranscriptStatus(value: unknown): YpiStudioSubagentTranscriptRef["status"] | undefined {
  if (value === "running" || value === "succeeded" || value === "failed" || value === "cancelled") return value;
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
  };
}

function normalizeItems(value: unknown): YpiStudioSubagentTranscriptItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is YpiStudioSubagentTranscriptItem => isRecord(item) && typeof item.kind === "string" && typeof item.at === "string");
}

function normalizeProgress(value: unknown): StudioRunProgress | undefined {
  if (!isRecord(value)) return undefined;
  return {
    startedAt: asString(value.startedAt),
    updatedAt: asString(value.updatedAt),
    eventCount: typeof value.eventCount === "number" ? value.eventCount : undefined,
    lastTextPreview: asString(value.lastTextPreview),
    itemsPreview: normalizeItems(value.itemsPreview),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : undefined,
  };
}

function normalizeRun(value: unknown): StudioRunProjection | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    member: asString(value.member),
    status: normalizeStatus(value.status),
    taskId: asString(value.taskId),
    transcript: normalizeTranscriptRef(value.transcript),
    progress: normalizeProgress(value.progress),
    model: asString(value.model),
    thinking: asString(value.thinking),
    summary: asString(value.summary),
    error: asString(value.error),
  };
}

function runFromDetails(details: unknown): StudioRunProjection | undefined {
  if (!isRecord(details)) return undefined;
  return normalizeRun(details.run);
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
  if (status === "unavailable") return "Transcript unavailable";
  return "Running";
}

function statusColor(status: StudioRunStatus): string {
  if (status === "succeeded") return "#16a34a";
  if (status === "failed" || status === "cancelled") return "#f87171";
  if (status === "unavailable") return "var(--text-dim)";
  return "var(--accent)";
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

function previewText(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function YpiStudioSubagentTranscript({ block, result, progress, duration, cwd }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [finalExpanded, setFinalExpanded] = useState(false);
  const [apiResponse, setApiResponse] = useState<YpiStudioSubagentTranscriptResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const inputRun = useMemo<StudioRunProjection>(() => ({
    member: inputString(block.input, "member"),
    taskId: inputString(block.input, "taskId"),
    model: inputString(block.input, "model"),
    thinking: inputString(block.input, "thinking"),
  }), [block.input]);

  const progressRun = runFromDetails(progress?.partialResult?.details);
  const finalRun = runFromDetails(result?.details);
  const run = { ...inputRun, ...progressRun, ...finalRun };
  const transcript = apiResponse?.transcript ?? run.transcript;
  const status: StudioRunStatus = run.status ?? (progress?.running ? "running" : result ? (result.isError ? "failed" : "succeeded") : "running");
  const finalText = resultText(result);
  const progressItems = run.progress?.itemsPreview ?? [];
  const items = apiResponse?.items ?? progressItems;
  const warnings = [...(run.progress?.warnings ?? []), ...(apiResponse?.warnings ?? [])];
  const elapsed = formatElapsed(run.progress?.startedAt ?? transcript?.startedAt, transcript?.finishedAt, duration);
  const lastPreview = run.progress?.lastTextPreview ?? run.summary ?? run.error ?? previewText(finalText || "Waiting for Studio member output…");
  const taskId = transcript?.taskId ?? run.taskId ?? inputRun.taskId;
  const runId = transcript?.runId ?? run.id;
  const effectiveCwd = cwd ?? (isRecord(result?.details) && isRecord(result.details.task) ? asString(result.details.task.cwd) : undefined);

  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!expanded || !transcript || !taskId || !runId || !effectiveCwd || status === "running") return;
    let cancelled = false;
    setApiError(null);
    const url = `/api/studio/tasks/${encodeURIComponent(taskId)}/subagents/${encodeURIComponent(runId)}/transcript?cwd=${encodeURIComponent(effectiveCwd)}&limit=300`;
    fetch(url)
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        return body as YpiStudioSubagentTranscriptResponse;
      })
      .then((body) => { if (!cancelled) setApiResponse(body); })
      .catch((error) => { if (!cancelled) setApiError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [effectiveCwd, expanded, runId, status, taskId, transcript]);

  const headerPreview = `${run.member ?? "member"} · ${statusLabel(status)}${elapsed ? ` · ${elapsed}` : ""} · ${previewText(lastPreview, 120)}`;
  void tick;

  return (
    <div
      style={{
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 12,
        border: `1px solid ${status === "failed" || status === "cancelled" ? "rgba(248,113,113,0.45)" : "rgba(34,197,94,0.25)"}`,
        background: status === "failed" || status === "cancelled" ? "rgba(248,113,113,0.05)" : "rgba(34,197,94,0.04)",
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
            <Meta label="Task" value={taskId ?? "unknown"} />
            <Meta label="Run" value={runId ?? "pending"} />
            <Meta label="Model" value={run.model ?? "default"} />
            <Meta label="Thinking" value={run.thinking ?? "default"} />
            <Meta label="Elapsed" value={elapsed ?? "—"} />
            <Meta label="Updated" value={run.progress?.updatedAt ? new Date(run.progress.updatedAt).toLocaleTimeString() : "—"} />
          </div>

          <SectionHeader title="Delegated input" right={<button onClick={() => setInputExpanded((value) => !value)} style={plainButtonStyle}>{inputExpanded ? "Hide" : "Show"}</button>} />
          {inputExpanded && <pre style={preStyle}>{safeJson(block.input)}</pre>}

          <SectionHeader title="Child transcript" right={transcript?.pathLabel ? <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{transcript.pathLabel}</span> : null} />
          <div style={{ maxHeight: "min(560px, 65vh)", overflow: "auto", background: "var(--bg)", padding: "8px 10px" }}>
            {status === "running" && items.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>Child Pi process started. Waiting for first JSON event…</div>
            )}
            {!transcript && status !== "running" && (
              <Warning text="This Studio member run was created before transcript capture, or transcript capture failed; showing final output only." />
            )}
            {apiError && <Warning text={`Transcript unavailable: ${apiError}. Showing cached preview/final output instead.`} />}
            {warnings.map((warning, index) => <Warning key={`${index}-${warning}`} text={warning} />)}
            {items.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((item, index) => <TranscriptItem key={`${item.at}-${item.kind}-${index}`} item={item} />)}
              </div>
            ) : finalText ? (
              <MarkdownBody>{finalText}</MarkdownBody>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>(no transcript output yet)</div>
            )}
          </div>

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

function Meta({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 12, color: color ?? "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>{value}</div>
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

function TranscriptItem({ item }: { item: YpiStudioSubagentTranscriptItem }) {
  const text = itemText(item);
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
