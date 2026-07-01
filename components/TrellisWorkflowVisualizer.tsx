"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import type {
  TrellisWorkflowPhase,
  TrellisWorkflowAssistResponse,
  TrellisWorkflowProjection,
  TrellisWorkflowResponse,
  TrellisWorkflowStateBlock,
  TrellisWorkflowStep,
  TrellisWorkflowWarning,
} from "@/lib/trellis-workflow-types";

interface Props {
  cwd: string | null;
  onClose: () => void;
}

interface WorkflowApiResponse extends TrellisWorkflowResponse {
  error?: string;
}

type SelectedNode =
  | { kind: "phase"; id: string; phase: TrellisWorkflowPhase }
  | { kind: "step"; id: string; phase: TrellisWorkflowPhase; step: TrellisWorkflowStep }
  | { kind: "state"; id: string; state: TrellisWorkflowStateBlock };

function severityColor(severity: TrellisWorkflowWarning["severity"]): string {
  if (severity === "error") return "#f87171";
  if (severity === "warning") return "#f59e0b";
  return "#60a5fa";
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sourceRange(lineStart?: number, lineEnd?: number): string {
  if (!lineStart) return "—";
  if (!lineEnd || lineEnd === lineStart) return `L${lineStart}`;
  return `L${lineStart}–L${lineEnd}`;
}

function trimBody(body: string, max = 900): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}\n…`;
}

function nodeWarnings(warnings: TrellisWorkflowWarning[], nodeId?: string): TrellisWorkflowWarning[] {
  if (!nodeId) return [];
  return warnings.filter((warning) => warning.nodeId === nodeId);
}

function buildWorkflowOverviewBody(workflow: TrellisWorkflowProjection): string {
  const phaseText = workflow.phases.map((phase) => {
    const steps = phase.steps.map((step) => `  - ${step.stepNumber ?? "Step"} ${step.title}`).join("\n");
    return `## ${phase.title}\n${phase.summary ?? ""}${steps ? `\n${steps}` : ""}`;
  }).join("\n\n");
  const states = workflow.states.map((state) => `- ${state.status}: ${state.body.split(/\r?\n/).slice(0, 4).join(" ")}`).join("\n");
  return `# ${workflow.title ?? "Trellis Workflow"}\n\n## Phases and steps\n${phaseText}\n\n## Workflow states\n${states}`.slice(0, 30000);
}

function AssistResultCard({ result }: { result: TrellisWorkflowAssistResponse }) {
  const [mode, setMode] = useState<"markdown" | "source">("markdown");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>辅助阅读结果</div>
        <div style={{ display: "flex", padding: 2, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
          {(["markdown", "source"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "none",
                background: mode === item ? "var(--bg-selected)" : "transparent",
                color: mode === item ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {item === "markdown" ? "MD 模式" : "原文"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ color: "var(--text)", fontSize: 12, lineHeight: 1.55 }}><strong>总结：</strong>{result.summary}</div>
      <div>
        <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>中文解释</div>
        {mode === "markdown" ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
            <MarkdownBody>{result.translation}</MarkdownBody>
          </div>
        ) : (
          <pre style={{ margin: 0, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 520 }}>
            {result.translation}
          </pre>
        )}
      </div>
      {result.keyActions.length > 0 && (
        <div>
          <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>关键动作</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{result.keyActions.map((item, index) => <li key={`action-${index}`}>{item}</li>)}</ul>
        </div>
      )}
      {result.cautions.length > 0 && (
        <div>
          <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>注意事项</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{result.cautions.map((item, index) => <li key={`caution-${index}`}>{item}</li>)}</ul>
        </div>
      )}
      {result.model && <code style={{ color: "var(--text-dim)", fontSize: 10 }}>model: {result.model.provider}/{result.model.modelId}</code>}
    </div>
  );
}

function WorkflowWarnings({ warnings, onSelectNode }: { warnings: TrellisWorkflowWarning[]; onSelectNode: (id: string) => void }) {
  if (warnings.length === 0) {
    return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>没有解析警告。</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {warnings.map((warning, index) => (
        <button
          key={`${warning.code}-${warning.lineStart ?? index}-${index}`}
          type="button"
          onClick={() => warning.nodeId && onSelectNode(warning.nodeId)}
          disabled={!warning.nodeId}
          style={{
            textAlign: "left",
            padding: 9,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            cursor: warning.nodeId ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <span style={{ color: severityColor(warning.severity), fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{warning.severity}</span>
            <code style={{ color: "var(--text-dim)", fontSize: 10 }}>{sourceRange(warning.lineStart, warning.lineEnd)}</code>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.45 }}>{warning.message}</div>
          <code style={{ display: "block", marginTop: 5, color: "var(--text-dim)", fontSize: 10 }}>{warning.code}</code>
        </button>
      ))}
    </div>
  );
}

function DetailPane({ selected, warnings, cwd }: { selected: SelectedNode | null; warnings: TrellisWorkflowWarning[]; cwd: string | null }) {
  const [contentMode, setContentMode] = useState<"markdown" | "source">("markdown");
  const [assistResults, setAssistResults] = useState<Record<string, TrellisWorkflowAssistResponse>>({});
  const [assistLoadingId, setAssistLoadingId] = useState<string | null>(null);
  const [assistStartedAt, setAssistStartedAt] = useState<number | null>(null);
  const [assistNow, setAssistNow] = useState(Date.now());
  const [assistError, setAssistError] = useState<string | null>(null);

  useEffect(() => {
    if (!assistLoadingId) return;
    setAssistNow(Date.now());
    const timer = window.setInterval(() => setAssistNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [assistLoadingId]);

  useEffect(() => {
    setAssistError(null);
  }, [selected?.id]);

  if (!selected) {
    return (
      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12 }}>
        选择一个阶段、步骤或状态块查看源码位置和详情。
      </div>
    );
  }

  const title = selected.kind === "phase"
    ? selected.phase.title
    : selected.kind === "step"
      ? `${selected.step.stepNumber ?? "Step"} ${selected.step.title}`
      : `[workflow-state:${selected.state.status}]`;
  const lineStart = selected.kind === "phase" ? selected.phase.lineStart : selected.kind === "step" ? selected.step.lineStart : selected.state.lineStart;
  const lineEnd = selected.kind === "phase" ? selected.phase.lineEnd : selected.kind === "step" ? selected.step.lineEnd : selected.state.lineEnd;
  const body = selected.kind === "state" ? selected.state.body : selected.kind === "phase" ? selected.phase.body ?? selected.phase.summary : selected.step.body;
  const relatedWarnings = nodeWarnings(warnings, selected.id);
  const assistResult = assistResults[selected.id];
  const assistElapsedSeconds = assistStartedAt ? Math.max(0, Math.round((assistNow - assistStartedAt) / 1000)) : 0;

  const runAssist = async () => {
    if (!cwd || !body || assistLoadingId) return;
    setAssistLoadingId(selected.id);
    setAssistStartedAt(Date.now());
    setAssistNow(Date.now());
    setAssistError(null);
    try {
      const res = await fetch("/api/trellis/workflow/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          node: { id: selected.id, kind: selected.kind, title, lineStart, lineEnd, body },
        }),
      });
      const data = await res.json() as TrellisWorkflowAssistResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAssistResults((prev) => ({ ...prev, [selected.id]: data }));
    } catch (error) {
      setAssistError(error instanceof Error ? error.message : String(error));
    } finally {
      setAssistLoadingId(null);
      setAssistStartedAt(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
      <div>
        <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 800 }}>{title}</div>
        <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11 }}>
          {selected.kind} · {sourceRange(lineStart, lineEnd)} · read-only
        </div>
      </div>
      {selected.kind === "step" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {selected.step.required && <Badge label="required" />}
          {selected.step.once && <Badge label="once" />}
          {selected.step.repeatable && <Badge label="repeatable" />}
        </div>
      )}
      {body && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>{selected.kind === "state" ? "每轮引导内容" : "节点引导内容"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => void runAssist()}
                disabled={!cwd || !body || !!assistLoadingId}
                style={{ padding: "5px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: cwd && body ? "var(--accent)" : "var(--text-dim)", cursor: cwd && body && !assistLoadingId ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 800 }}
              >
                {assistLoadingId === selected.id ? `辅助阅读中 ${assistElapsedSeconds}s` : assistResult ? "重新辅助阅读" : "辅助阅读"}
              </button>
              <div style={{ display: "flex", padding: 2, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
              {(["markdown", "source"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setContentMode(mode)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "none",
                    background: contentMode === mode ? "var(--bg-selected)" : "transparent",
                    color: contentMode === mode ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {mode === "markdown" ? "MD 模式" : "原文"}
                </button>
              ))}
              </div>
            </div>
          </div>
          {contentMode === "markdown" ? (
            <div style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55, overflow: "auto", maxHeight: 520 }}>
              <MarkdownBody>{body}</MarkdownBody>
            </div>
          ) : (
            <pre style={{ margin: 0, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 520 }}>
              {trimBody(body, 4000)}
            </pre>
          )}
        </div>
      )}
      {assistLoadingId === selected.id && (
        <div style={{ padding: 9, borderRadius: 8, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 12, lineHeight: 1.5 }}>
          正在调用流程辅助阅读模型，已等待 {assistElapsedSeconds} 秒。主模型约 15 秒无结构化结果会尝试回退模型；普通中文解释会优先使用回退模型。
        </div>
      )}
      {assistError && (
        <div style={{ padding: 9, borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{assistError}</div>
      )}
      {assistResult && <AssistResultCard result={assistResult} />}
      {relatedWarnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>相关警告</div>
          {relatedWarnings.map((warning, index) => (
            <div key={`${warning.code}-${index}`} style={{ color: severityColor(warning.severity), fontSize: 12 }}>{warning.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return <span style={{ padding: "2px 7px", borderRadius: 999, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, fontWeight: 700 }}>{label}</span>;
}

export function TrellisWorkflowVisualizer({ cwd, onClose }: Props) {
  const [data, setData] = useState<TrellisWorkflowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [overviewAssist, setOverviewAssist] = useState<TrellisWorkflowAssistResponse | null>(null);
  const [overviewAssistLoading, setOverviewAssistLoading] = useState(false);
  const [overviewAssistError, setOverviewAssistError] = useState<string | null>(null);

  const loadWorkflow = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setData(null);
      setError("未选择工作区。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trellis/workflow?cwd=${encodeURIComponent(cwd)}`, { signal });
      const body = await res.json() as WorkflowApiResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
      setSelectedId((current) => current ?? body.workflow?.phases[0]?.id ?? body.workflow?.states[0]?.id ?? null);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkflow(controller.signal);
    return () => controller.abort();
  }, [loadWorkflow, refreshKey]);

  const selected = useMemo<SelectedNode | null>(() => {
    if (!data?.workflow || !selectedId) return null;
    for (const phase of data.workflow.phases) {
      if (phase.id === selectedId) return { kind: "phase", id: phase.id, phase };
      const step = phase.steps.find((item) => item.id === selectedId);
      if (step) return { kind: "step", id: step.id, phase, step };
    }
    const state = data.workflow.states.find((item) => item.id === selectedId);
    return state ? { kind: "state", id: state.id, state } : null;
  }, [data, selectedId]);

  const warningCounts = useMemo(() => {
    const warnings = data?.warnings ?? [];
    return {
      errors: warnings.filter((warning) => warning.severity === "error").length,
      warnings: warnings.filter((warning) => warning.severity === "warning").length,
      infos: warnings.filter((warning) => warning.severity === "info").length,
    };
  }, [data]);

  const runOverviewAssist = useCallback(async () => {
    if (!cwd || !data?.workflow || overviewAssistLoading) return;
    setOverviewAssistLoading(true);
    setOverviewAssistError(null);
    try {
      const body = buildWorkflowOverviewBody(data.workflow);
      const res = await fetch("/api/trellis/workflow/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          node: {
            id: "workflow-overview",
            kind: "workflow",
            title: data.workflow.title ?? "Trellis workflow overview",
            lineStart: 1,
            lineEnd: data.workflow.rawLineCount,
            body,
          },
        }),
      });
      const result = await res.json() as TrellisWorkflowAssistResponse & { error?: string };
      if (!res.ok || result.error) throw new Error(result.error ?? `HTTP ${res.status}`);
      setOverviewAssist(result);
    } catch (error) {
      setOverviewAssistError(error instanceof Error ? error.message : String(error));
    } finally {
      setOverviewAssistLoading(false);
    }
  }, [cwd, data, overviewAssistLoading]);

  return (
    <div className="pi-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: fullscreen ? 0 : 24 }}>
      <div className="pi-modal-panel trellis-workflow-modal" style={{ width: fullscreen ? "100vw" : "min(1180px, calc(100vw - 48px))", height: fullscreen ? "100vh" : "min(820px, calc(100vh - 48px))", background: "var(--bg-panel)", border: fullscreen ? "none" : "1px solid var(--border)", borderRadius: fullscreen ? 0 : 14, boxShadow: fullscreen ? "none" : "0 20px 70px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontSize: 16, fontWeight: 900 }}>Trellis 流程设计</div>
            <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cwd ? <code style={{ fontFamily: "var(--font-mono)" }}>{cwd}/.trellis/workflow.md</code> : "未选择工作区"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {data?.exists && <Badge label={`更新于 ${formatDateTime(data.modifiedAt)}`} />}
            {data && <Badge label={`${warningCounts.errors} errors · ${warningCounts.warnings} warnings · ${warningCounts.infos} info`} />}
            <button type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={!cwd || loading} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: !cwd || loading ? "not-allowed" : "pointer", fontSize: 12 }}>{loading ? "读取中…" : "刷新"}</button>
            <button type="button" onClick={() => setFullscreen((value) => !value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>{fullscreen ? "退出全屏" : "全屏"}</button>
            <button type="button" onClick={onClose} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>关闭</button>
          </div>
        </div>

        <div className="mobile-stack-grid trellis-workflow-body" style={{ flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "minmax(420px, 1.45fr) minmax(280px, 0.9fr)", gap: 0 }}>
          <div style={{ overflow: "auto", padding: 16, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 14 }}>
            {error && <div style={{ padding: 12, borderRadius: 10, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12 }}>{error}</div>}
            {loading && !data && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>正在读取 workflow.md…</div>}
            {data && !data.exists && (
              <div style={{ padding: 16, borderRadius: 12, border: "1px dashed var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                当前工作区还没有 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>.trellis/workflow.md</code>。请先在 Settings → Trellis 中初始化或更新 Trellis。
              </div>
            )}
            {data?.workflow && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 900 }}>{data.workflow.title ?? "Workflow"}</div>
                    <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 3 }}>{data.workflow.rawLineCount} lines · {data.workflow.phases.length} phases · {data.workflow.states.length} states</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {data.truncated && <Badge label="truncated" />}
                    <button
                      type="button"
                      onClick={() => void runOverviewAssist()}
                      disabled={overviewAssistLoading}
                      style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--accent)", cursor: overviewAssistLoading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 800 }}
                    >
                      {overviewAssistLoading ? "流程解读中…" : overviewAssist ? "重新流程解读" : "流程解读"}
                    </button>
                  </div>
                </div>
                {overviewAssistLoading && <div style={{ padding: 9, borderRadius: 8, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 12 }}>正在使用流程辅助阅读模型总结整个 workflow，主模型无结果会自动尝试回退模型。</div>}
                {overviewAssistError && <div style={{ padding: 9, borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{overviewAssistError}</div>}
                <div style={{ display: "flex", gap: 12, alignItems: "stretch", overflowX: "auto", paddingBottom: 4, flexShrink: 0, minHeight: 190 }}>
                  {data.workflow.phases.map((phase, index) => (
                    <div key={phase.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(phase.id)}
                        style={{ minWidth: 230, maxWidth: 280, textAlign: "left", padding: 12, borderRadius: 12, border: selectedId === phase.id ? "1px solid var(--accent)" : "1px solid var(--border)", background: selectedId === phase.id ? "var(--bg-selected)" : "var(--bg-subtle)", color: "var(--text)", cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 900 }}>{phase.title}</div>
                        <div style={{ color: "var(--text-dim)", fontSize: 10, marginTop: 4 }}>{sourceRange(phase.lineStart, phase.lineEnd)}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                          {phase.steps.slice(0, 7).map((step) => (
                            <span key={step.id} onClick={(event) => { event.stopPropagation(); setSelectedId(step.id); }} style={{ padding: "5px 7px", borderRadius: 7, border: selectedId === step.id ? "1px solid var(--accent)" : "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
                              {step.stepNumber} {step.title.replace(/\s*`?\[[^\]]+\]`?\s*/g, "")}
                            </span>
                          ))}
                          {phase.steps.length > 7 && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>+{phase.steps.length - 7} more steps</span>}
                        </div>
                      </button>
                      {index < data.workflow!.phases.length - 1 && <div style={{ color: "var(--text-dim)", fontSize: 20 }}>→</div>}
                    </div>
                  ))}
                </div>
                {overviewAssist && (
                  <div style={{ flexShrink: 0, maxHeight: 420, overflow: "auto" }}>
                    <AssistResultCard result={overviewAssist} />
                  </div>
                )}
                <div style={{ padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-subtle)", flexShrink: 0 }}>
                  <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Workflow states</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {data.workflow.states.map((state) => (
                      <button key={state.id} type="button" onClick={() => setSelectedId(state.id)} style={{ padding: "6px 9px", borderRadius: 999, border: selectedId === state.id ? "1px solid var(--accent)" : "1px solid var(--border)", background: selectedId === state.id ? "var(--bg-selected)" : "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                        {state.status}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
                  <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800, marginBottom: 8 }}>解析健康</div>
                  <WorkflowWarnings warnings={data.warnings} onSelectNode={setSelectedId} />
                </div>
              </>
            )}
          </div>
          <div style={{ overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <DetailPane selected={selected} warnings={data?.warnings ?? []} cwd={cwd} />
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.55 }}>
              当前版本只读取并展示 workflow.md，不提供编辑、保存或 agent 辅助改写。节点保留稳定 id 和源码行号，方便后续扩展为真正的流程编辑器。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
