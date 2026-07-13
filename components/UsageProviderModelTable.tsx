"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LlmUsageQueryResult,
  LlmUsageTotals,
  LlmUsageSourceKind,
  LlmUsageStatus,
  LlmUsageProviderSummary,
} from "@/lib/llm-usage-types";
import { LLM_USAGE_SOURCE_KINDS } from "@/lib/llm-usage-types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UsageProviderModelTableProps {
  cwd?: string | null;
  onClose: () => void;
  /** Callback to switch back to the legacy Session-stats view. */
  onSwitchToLegacy?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultInputRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function formatCost(value: number): string {
  if (value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  return value.toLocaleString();
}

function formatPct(value: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Cache-hit rate = cacheRead / (input + cacheRead).
 * Returns "—" when the denominator is zero.
 */
function cacheHitRate(t: LlmUsageTotals): string {
  const denom = t.input + t.cacheRead;
  if (denom <= 0) return "—";
  return `${((t.cacheRead / denom) * 100).toFixed(1)}%`;
}

/** The exact numeric value for tooltip display. */
function cacheHitRateExact(t: LlmUsageTotals): string {
  const denom = t.input + t.cacheRead;
  if (denom <= 0) return "—";
  return `${formatTokens(t.cacheRead)} / ${formatTokens(denom)} = ${cacheHitRate(t)}`;
}

function successRate(t: LlmUsageTotals): string {
  if (t.calls <= 0) return "--";
  return `${((t.successCalls / t.calls) * 100).toFixed(1)}%`;
}

function sourceLabel(kind: LlmUsageSourceKind): string {
  const labels: Record<LlmUsageSourceKind, string> = {
    chat: "Chat",
    studio_sdk: "Studio SDK",
    studio_cli: "Studio CLI",
    terminal_env_assist: "Env Assist",
    trellis_workflow_assist: "Trellis Assist",
    model_test: "Model Test",
    warmup: "Warmup",
    compaction: "Compaction",
    branch_summary: "Branch Summary",
    legacy_session_backfill: "Backfill",
  };
  return labels[kind] ?? kind;
}

function statusLabel(s: LlmUsageStatus): string {
  return s === "success" ? "成功" : s === "error" ? "失败" : "已中断";
}

/** Distinct palette for model segments in the stacked daily chart. */
const MODEL_CHART_PALETTE = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#14b8a6",
  "#6366f1", "#e11d48", "#0ea5e9", "#a855f7", "#65a30d",
];

/** Assign a stable color to a model key (provider::model). */
function modelColor(modelKey: string, index: number): string {
  return MODEL_CHART_PALETTE[index % MODEL_CHART_PALETTE.length];
}

type ChartMode = "tokens" | "cost";

// ---------------------------------------------------------------------------
// Inline styles (reusing project convention from UsageStatsModal)
// ---------------------------------------------------------------------------

const dateInputStyle: React.CSSProperties = {
  height: 26,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 11,
  padding: "0 6px",
};

const iconButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 26,
  padding: 0,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: 10,
  background: "var(--bg-panel)",
  minWidth: 0,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UsageProviderModelTable({ cwd, onClose, onSwitchToLegacy }: UsageProviderModelTableProps) {
  const defaults = useMemo(() => getDefaultInputRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [sourceFilter, setSourceFilter] = useState<LlmUsageSourceKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<LlmUsageStatus | "all">("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<"all" | "cwd">(cwd ? "cwd" : "all");
  const [result, setResult] = useState<LlmUsageQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [chartMode, setChartMode] = useState<ChartMode>("tokens");
  const [selectedModel, setSelectedModel] = useState<{
    provider: string;
    model: string;
    totals: LlmUsageTotals;
  } | null>(null);
  const [chartTooltip, setChartTooltip] = useState<{
    x: number;
    y: number;
    date: string;
    modelKey: string;
    provider: string;
    model: string;
    value: number;
    pct: number;
    dayTotal: number;
    calls: number;
    color: string;
  } | null>(null);

  const activeCwd = workspaceFilter === "cwd" ? cwd : undefined;
  const largestDailyCost = Math.max(0, ...(result?.byDay.map((d) => d.totals.cost) ?? []));
  const largestDailyTokens = Math.max(0, ...(result?.byDay.map((d) => d.totals.totalTokens) ?? []));
  const chartMax = chartMode === "cost" ? largestDailyCost : largestDailyTokens;

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ from, to });
        if (activeCwd) params.set("cwd", activeCwd);
        if (sourceFilter !== "all") params.set("source", sourceFilter);
        if (statusFilter !== "all") params.set("status", statusFilter);
        const res = await fetch(`/api/usage/calls?${params.toString()}`, { signal });
        const data = (await res.json()) as LlmUsageQueryResult & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setResult(data);
      } catch (err) {
        if (signal?.aborted) return;
        setResult(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [activeCwd, from, to, sourceFilter, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    if (!cwd && workspaceFilter === "cwd") setWorkspaceFilter("all");
  }, [cwd, workspaceFilter]);

  const toggleProvider = useCallback((provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    const d = getDefaultInputRange();
    setFrom(d.from);
    setTo(d.to);
    setSourceFilter("all");
    setStatusFilter("all");
    setWorkspaceFilter(cwd ? "cwd" : "all");
  }, [cwd]);

  const t = result?.totals;

  return (
    <div
      className="pi-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="LLM Usage Ledger"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(0,0,0,0.44)",
      }}
    >
      <div
        className="pi-modal-panel usage-modal-panel"
        style={{
          width: "min(980px, 100%)",
          maxHeight: "min(760px, calc(100dvh - 36px))",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 22px 70px rgba(0,0,0,0.34)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                LLM 调用账本 (Usage Ledger)
              </div>
              <div style={{ marginTop: 1, fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                独立 append-only 调用日志 — 不依赖 session 生命周期
              </div>
            </div>
          </div>

          {/* View toggle — bidirectional: switch back to legacy Session-stats */}
          {onSwitchToLegacy && (
            <div style={{ display: "flex", height: 26, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
              <button
                type="button"
                onClick={onSwitchToLegacy}
                style={{
                  padding: "0 10px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                Session 统计
              </button>
              <button
                type="button"
                disabled
                style={{
                  padding: "0 10px",
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  background: "var(--bg-selected)",
                  color: "var(--text)",
                  cursor: "default",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                调用账本
              </button>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => void loadData()} disabled={loading} style={iconButtonStyle} title="刷新">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </button>
            <button type="button" onClick={onClose} style={iconButtonStyle} title="关闭">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
            从
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInputStyle} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
            至
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateInputStyle} />
          </label>

          <div style={{ display: "flex", height: 26, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {(["all", "cwd"] as const).map((item) => {
              const disabled = item === "cwd" && !cwd;
              const active = workspaceFilter === item;
              return (
                <button
                  key={item}
                  type="button"
                  disabled={disabled}
                  onClick={() => setWorkspaceFilter(item)}
                  style={{
                    padding: "0 9px",
                    border: "none",
                    borderLeft: item === "cwd" ? "1px solid var(--border)" : "none",
                    background: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    opacity: disabled ? 0.35 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontSize: 11,
                  }}
                >
                  {item === "all" ? "全部" : "当前"}
                </button>
              );
            })}
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as LlmUsageSourceKind | "all")}
            style={{
              height: 26, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              color: "var(--text)", fontSize: 11, padding: "0 6px",
            }}
            title="来源"
          >
            <option value="all">所有来源</option>
            {LLM_USAGE_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>{sourceLabel(k)}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LlmUsageStatus | "all")}
            style={{
              height: 26, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              color: "var(--text)", fontSize: 11, padding: "0 6px",
            }}
            title="状态"
          >
            <option value="all">所有状态</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
            <option value="aborted">已中断</option>
          </select>

          <button type="button" onClick={resetFilters} style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 10, gap: 4, display: "flex", alignItems: "center" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            重置
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: 14 }}>
          {error ? (
            <div style={{ color: "#ef4444", fontSize: 12, padding: 12, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 7, background: "rgba(239,68,68,0.06)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 600 }}>读取账本事件失败</div>
              <div style={{ color: "var(--text-muted)", maxWidth: 400, textAlign: "center", lineHeight: 1.5 }}>{error}</div>
              <button type="button" onClick={() => void loadData()} style={{ ...iconButtonStyle, width: "auto", padding: "0 14px" }}>重试</button>
            </div>
          ) : loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, color: "var(--text-muted)", gap: 12 }}>
              <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12 }}>正在读取调用账本...</span>
            </div>
          ) : result ? (
            <>
              {/* Coverage banner */}
              {result.coverage.knownGaps.length > 0 && (
                <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", fontSize: 11, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    ⚠️ 覆盖率声明 (Ledger Coverage)
                  </div>
                  {result.coverage.nativeSince ? (
                    <div style={{ color: "var(--text-muted)" }}>
                      自 <strong>{result.coverage.nativeSince}</strong> 起实时捕获。
                      {result.coverage.backfill.completed && " 已执行历史 backfill。"}
                    </div>
                  ) : <div style={{ color: "var(--text-muted)" }}>尚无实时捕获数据。</div>}
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {result.coverage.knownGaps.map((gap, i) => (
                      <div key={i} style={{ color: "var(--text-dim)" }}>• {gap}</div>
                    ))}
                  </div>
                  {(result.coverage.corruptEvents > 0 || result.coverage.skippedEvents > 0) && (
                    <div style={{ marginTop: 4, color: "#ef4444" }}>
                      已隔离 {result.coverage.corruptEvents} 个损坏文件，跳过 {result.coverage.skippedEvents} 个异常文件。
                    </div>
                  )}
                </div>
              )}

              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
                <Metric label="预估费用" value={formatCost(t?.cost ?? 0)} highlight title="预估费用 = 各模型调用量 × 对应单价" />
                <Metric label="调用次数" value={formatTokens(t?.calls ?? 0)} title={`成功 ${formatTokens(t?.successCalls ?? 0)} / 失败 ${formatTokens(t?.errorCalls ?? 0)} / 中断 ${formatTokens(t?.abortedCalls ?? 0)}`} />
                <Metric label="总 Token" value={formatTokens(t?.totalTokens ?? 0)} title={`Input: ${formatTokens(t?.input ?? 0)} / Output: ${formatTokens(t?.output ?? 0)} / Cache R: ${formatTokens(t?.cacheRead ?? 0)} / Cache W: ${formatTokens(t?.cacheWrite ?? 0)}`} />
                <Metric label="成功率" value={t ? successRate(t) : "--"} success={t ? t.successCalls / Math.max(1, t.calls) >= 0.95 : false} title={`${formatTokens(t?.successCalls ?? 0)} / ${formatTokens(t?.calls ?? 0)}`} />
              </div>

              {/* Daily chart — stacked bar with model segments */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
                <section style={panelStyle}>
                  <SectionTitle
                    title={chartMode === "cost" ? "每日费用占比" : "每日使用量占比"}
                    right={result ? `${result.range.from} — ${result.range.to}` : ""}
                  />
                  {/* Toggle */}
                  <div style={{ display: "flex", height: 24, border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden", marginBottom: 10, width: "fit-content" }}>
                    {(["tokens", "cost"] as ChartMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setChartMode(mode)}
                        style={{
                          padding: "0 10px",
                          border: "none",
                          borderLeft: mode === "cost" ? "1px solid var(--border)" : "none",
                          background: chartMode === mode ? "var(--bg-selected)" : "transparent",
                          color: chartMode === mode ? "var(--text)" : "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {mode === "tokens" ? "使用量" : "费用"}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {result.byDay.length === 0 ? (
                      <EmptyState />
                    ) : result.byDay.map((day) => {
                      const dayTotal = chartMode === "cost" ? day.totals.cost : day.totals.totalTokens;
                      const barWidth = chartMax > 0 ? Math.max(3, (dayTotal / chartMax) * 100) : 0;
                      // Find corresponding day-model entries
                      const dayModel = result.byDayModel?.find((dm) => dm.date === day.date);
                      const models = dayModel?.models ?? [];
                      const hasCostData = models.some((m) => m.cost > 0);
                      return (
                        <div key={day.date} style={{ display: "grid", gridTemplateColumns: "82px minmax(0, 1fr) 72px", alignItems: "center", gap: 8, fontSize: 11 }}>
                          <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{day.date.slice(5)}</span>
                          <div
                            data-chart-bar
                            style={{
                              height: 12,
                              background: "var(--bg)",
                              border: "1px solid var(--border)",
                              borderRadius: 999,
                              overflow: "hidden",
                              display: "flex",
                              position: "relative",
                              width: `${barWidth}%`,
                              minWidth: barWidth > 0 ? 3 : 0,
                            }}
                            onMouseLeave={() => setChartTooltip(null)}
                          >
                            {chartMode === "cost" && !hasCostData && dayTotal <= 0 ? (
                              <span style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "var(--text-dim)", position: "absolute", inset: 0 }}>
                                无费用数据
                              </span>
                            ) : (
                              models.map((m, i) => {
                                const modelVal = chartMode === "cost" ? m.cost : m.tokens;
                                const pct = dayTotal > 0 ? Math.max(0, (modelVal / dayTotal) * 100) : 0;
                                if (pct <= 0) return null;
                                const mk = `${m.provider}::${m.model}`;
                                const color = modelColor(mk, i);
                                return (
                                  <div
                                    key={mk}
                                    style={{
                                      width: `${pct}%`,
                                      height: "100%",
                                      background: color,
                                      flexShrink: 0,
                                      cursor: "pointer",
                                    }}
                                    onMouseEnter={(e) => {
                                      const rect = (e.target as HTMLElement).closest("[data-chart-bar]")?.getBoundingClientRect();
                                      setChartTooltip({
                                        x: e.clientX,
                                        y: (rect ?? e.currentTarget.getBoundingClientRect()).top,
                                        date: day.date,
                                        modelKey: mk,
                                        provider: m.provider,
                                        model: m.model,
                                        value: modelVal,
                                        pct,
                                        dayTotal,
                                        calls: m.calls,
                                        color,
                                      });
                                    }}
                                    onMouseMove={(e) => {
                                      setChartTooltip((prev) => prev ? { ...prev, x: e.clientX } : null);
                                    }}
                                  />
                                );
                              })
                            )}
                          </div>
                          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {chartMode === "cost" ? formatCost(dayTotal) : formatTokens(dayTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Chart tooltip */}
                  {chartTooltip && (
                    <UsageChartTooltip
                      tooltip={chartTooltip}
                      mode={chartMode}
                    />
                  )}

                  {/* Legend */}
                  {(result.byDayModel ?? []).length > 0 && (() => {
                    const allModels = new Map<string, { provider: string; model: string }>();
                    for (const dm of result.byDayModel ?? []) {
                      for (const m of dm.models) {
                        const key = `${m.provider}::${m.model}`;
                        if (!allModels.has(key)) allModels.set(key, { provider: m.provider, model: m.model });
                      }
                    }
                    if (allModels.size <= 1) return null;
                    const entries = [...allModels.values()];
                    return (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
                        {entries.map((e, i) => (
                          <span key={`${e.provider}::${e.model}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: modelColor(`${e.provider}::${e.model}`, i), flexShrink: 0 }} />
                            {e.provider !== "unknown" ? `${e.provider}/` : ""}{e.model}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </section>

                {/* Token breakdown */}
                <section style={panelStyle}>
                  <SectionTitle title="Token 拆分" />
                  <TokenRows totals={t ?? zeroTotals} />
                </section>
              </div>

              {/* Provider / Model table */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle }}>提供商 / 模型</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Calls</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">成功率</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">Input</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">Output</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">Cache R/W</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">缓存命中率</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>费用</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.byProvider.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 20, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
                          此范围内无调用记录
                        </td>
                      </tr>
                    ) : (
                      result.byProvider.map((prov) => {
                        const isExpanded = expandedProviders.has(prov.provider);
                        return (
                          <ProviderRow
                            key={prov.provider}
                            provider={prov}
                            expanded={isExpanded}
                            totalCost={t?.cost ?? 0}
                            onToggle={() => toggleProvider(prov.provider)}
                            onModelClick={(model, mt) =>
                              setSelectedModel({ provider: prov.provider, model, totals: mt })
                            }
                          />
                        );
                      })
                    )}
                  </tbody>
                </table>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-panel)", fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
                  <span>* 点击模型行可查看详细过滤细分</span>
                  <span>
                    共 {result.byProvider.length} 个提供商，{" "}
                    {result.byProvider.reduce((sum, p) => sum + p.models.length, 0)} 个模型，
                    隔离 {result.coverage.corruptEvents} 个损坏文件
                  </span>
                </div>
              </div>

              {/* By Source / By Status */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12 }}>
                <BreakdownTable title="按来源 (Source)" rows={result.bySource.map((s) => ({ label: sourceLabel(s.source), totals: s.totals }))} />
                <BreakdownTable title="按状态 (Status)" rows={result.byStatus.map((s) => ({ label: statusLabel(s.status), totals: s.totals }))} />
              </div>

              {/* Model detail drawer */}
              {selectedModel && (
                <ModelDetailDrawer
                  provider={selectedModel.provider}
                  model={selectedModel.model}
                  totals={selectedModel.totals}
                  onClose={() => setSelectedModel(null)}
                />
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, color: "var(--text-dim)", gap: 10, textAlign: "center" }}>
              <span style={{ fontSize: 24 }}>📁</span>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>无调用数据</div>
              <div style={{ fontSize: 11, maxWidth: 320 }}>在此时间段或过滤条件下未找到任何 LLM 调用记录。若为首次使用，系统会自动从 session 历史 backfill。</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", fontSize: 10, color: "var(--text-dim)", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            兼容提示: 聊天顶栏 Session rollup 仍由旧 JSONL 扫描提供，与本账本在 compaction/branch 统计上有口径差异。
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const zeroTotals: LlmUsageTotals = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  totalTokens: 0, cost: 0, calls: 0,
  successCalls: 0, errorCalls: 0, abortedCalls: 0,
};

const thStyle: React.CSSProperties = {
  background: "var(--bg-panel)",
  padding: "8px 12px",
  fontWeight: 600,
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  userSelect: "none",
};

function Metric({ label, value, highlight, success, title }: { label: string; value: string; highlight?: boolean; success?: boolean; title?: string }) {
  return (
    <div style={panelStyle} title={title}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>{label}</div>
      <div style={{
        marginTop: 4, fontSize: highlight ? 20 : 18, lineHeight: 1.1,
        fontWeight: highlight ? 700 : 600,
        color: success === false ? "var(--text-muted)" : highlight ? "var(--accent)" : "var(--text)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
      <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{title}</div>
      {right && <div style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{right}</div>}
    </div>
  );
}

function TokenRows({ totals }: { totals: LlmUsageTotals }) {
  const rows = [
    ["Input", totals.input],
    ["Output", totals.output],
    ["Cache Read", totals.cacheRead],
    ["Cache Write", totals.cacheWrite],
  ] as const;
  const sum = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px 54px", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>{label}</span>
          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(value)}</span>
          <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {sum > 0 ? formatPct(value, sum) : "--"}
          </span>
        </div>
      ))}
      {totals.reasoning !== undefined && totals.reasoning > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px 54px", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px dashed var(--border)", fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>🧠 Reasoning</span>
          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(totals.reasoning)}</span>
          <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>(已含于 Output)</span>
        </div>
      )}
    </div>
  );
}

function ProviderRow({
  provider,
  expanded,
  totalCost,
  onToggle,
  onModelClick,
}: {
  provider: LlmUsageProviderSummary;
  expanded: boolean;
  totalCost: number;
  onToggle: () => void;
  onModelClick: (model: string, totals: LlmUsageTotals) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: "pointer", userSelect: "none", background: "var(--bg-subtle)", fontWeight: 600 }}
        className="row-provider"
      >
        <td style={{ ...tdStyle }} colSpan={9}>
          <span style={{ display: "inline-block", width: 12, transition: "transform 0.2s", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--text-muted)", marginRight: 6 }}>▼</span>
          {provider.provider}
          <span style={{ fontWeight: "normal", fontSize: 10, color: "var(--text-dim)", marginLeft: 8 }}>
            ({provider.models.length} 个模型，{provider.totals.calls} 次调用)
          </span>
        </td>
      </tr>
      {expanded &&
        provider.models.map((m) => {
          const chRate = cacheHitRate(m.totals);
          const chRateExact = cacheHitRateExact(m.totals);
          const successRateVal = successRate(m.totals);
          return (
          <tr
            key={m.model}
            onClick={() => onModelClick(m.model, m.totals)}
            style={{ cursor: "pointer", background: "var(--bg)" }}
            className="row-model"
          >
            <td style={{ ...tdStyle, paddingLeft: 28 }}>
              {m.model}
              {provider.provider === "unknown" && (
                <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, border: "1px solid var(--text-dim)", color: "var(--text-dim)", marginLeft: 6, textTransform: "uppercase" }}>Unknown</span>
              )}
              {m.totals.cost <= 0 && m.totals.calls > 0 && (
                <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, border: "1px solid #10b981", color: "#10b981", background: "rgba(16,185,129,0.1)", marginLeft: 6, textTransform: "uppercase" }}>Zero Cost</span>
              )}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={`共 ${formatTokens(m.totals.calls)} 次调用`}>
              {formatTokens(m.totals.calls)}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="hide-mobile" title={`成功 ${formatTokens(m.totals.successCalls)} / 失败 ${formatTokens(m.totals.errorCalls)} / 中断 ${formatTokens(m.totals.abortedCalls)}`}>
              <span style={{ color: m.totals.calls > 0 && m.totals.successCalls / m.totals.calls >= 0.95 ? "#10b981" : m.totals.errorCalls > 0 ? "#ef4444" : "var(--text-muted)" }}>
                {successRateVal}
              </span>
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="hide-mobile" title={`Input: ${formatTokens(m.totals.input)} tokens`}>
              {formatTokens(m.totals.input)}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="hide-mobile" title={`Output: ${formatTokens(m.totals.output)} tokens`}>
              {formatTokens(m.totals.output)}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="hide-mobile" title={`Cache Read: ${formatTokens(m.totals.cacheRead)} / Cache Write: ${formatTokens(m.totals.cacheWrite)} tokens`}>
              {formatTokens(m.totals.cacheRead)} / {formatTokens(m.totals.cacheWrite)}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="hide-mobile" title={chRateExact}>
              <span style={{ color: m.totals.cacheRead > 0 ? "#10b981" : "var(--text-muted)" }}>
                {chRate}
              </span>
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }} title={formatCost(m.totals.cost)}>
              {formatCost(m.totals.cost)}
            </td>
            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="hide-mobile" title={formatPct(m.totals.cost, totalCost)}>
              {formatPct(m.totals.cost, totalCost)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
  color: "var(--text)",
  fontSize: 12,
};

function BreakdownTable({ title, rows }: { title: string; rows: { label: string; totals: LlmUsageTotals }[] }) {
  return (
    <section style={panelStyle}>
      <SectionTitle title={title} />
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 72px 72px", gap: 8, alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 11 }}>
              <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
              <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={`${formatTokens(row.totals.calls)} 次调用`}>{formatTokens(row.totals.calls)}</span>
              <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCost(row.totals.cost)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return <div style={{ padding: "14px 0", color: "var(--text-dim)", fontSize: 12 }}>暂无数据</div>;
}

// ---------------------------------------------------------------------------
// Chart tooltip — positioned near cursor, constrained to viewport
// ---------------------------------------------------------------------------

function UsageChartTooltip({
  tooltip,
  mode,
}: {
  tooltip: {
    x: number;
    y: number;
    date: string;
    modelKey: string;
    provider: string;
    model: string;
    value: number;
    pct: number;
    dayTotal: number;
    calls: number;
    color: string;
  };
  mode: ChartMode;
}) {
  // Measure on first render to adjust position so the tooltip doesn't overflow
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = 0;
    let top = 0;
    // Horizontal: prefer right of cursor, flip left if it would overflow
    if (tooltip.x + rect.width + 14 > vw) {
      left = tooltip.x - rect.width - 14;
    } else {
      left = tooltip.x + 14;
    }
    // Clamp left so the tooltip stays fully visible
    if (left < 8) left = 8;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;

    // Vertical: prefer above the bar, drop below if it would overflow top
    const preferredTop = tooltip.y - rect.height - 10;
    if (preferredTop < 8) {
      top = tooltip.y + 22;
    } else {
      top = preferredTop;
    }
    if (top < 8) top = 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;

    setOffset({ left, top });
  }, [el, tooltip]);

  const valueLabel = mode === "cost" ? formatCost(tooltip.value) : formatTokens(tooltip.value);
  const totalLabel = mode === "cost" ? formatCost(tooltip.dayTotal) : formatTokens(tooltip.dayTotal);
  const pctLabel = tooltip.dayTotal > 0 ? `${tooltip.pct.toFixed(1)}%` : "—";

  return (
    <div
      ref={setEl}
      className="usage-chart-tooltip"
      style={{
        position: "fixed",
        left: offset.left,
        top: offset.top,
        zIndex: 1200,
        pointerEvents: "none",
        fontSize: 11,
        maxWidth: 260,
        // @ts-expect-error CSS custom property
        "--tooltip-accent": tooltip.color,
      }}
    >
      <div className="usage-chart-tooltip-date">{tooltip.date}</div>
      <div className="usage-chart-tooltip-model">
        <span className="usage-chart-tooltip-model-dot" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tooltip.provider !== "unknown" ? `${tooltip.provider}/` : ""}{tooltip.model}
        </span>
      </div>
      <div className="usage-chart-tooltip-divider" />
      <div className="usage-chart-tooltip-row">
        <span className="usage-chart-tooltip-label">{mode === "cost" ? "费用" : "使用量"}</span>
        <span className="usage-chart-tooltip-value">{tooltip.value > 0 ? valueLabel : (mode === "cost" ? "无费用数据" : valueLabel)}</span>
      </div>
      <div className="usage-chart-tooltip-row">
        <span className="usage-chart-tooltip-label">占当日</span>
        <span className="usage-chart-tooltip-value">{pctLabel}</span>
      </div>
      <div className="usage-chart-tooltip-divider" />
      <div className="usage-chart-tooltip-row usage-chart-tooltip-total">
        <span className="usage-chart-tooltip-label">当日合计</span>
        <span className="usage-chart-tooltip-value">{totalLabel}</span>
      </div>
      <div className="usage-chart-tooltip-calls">
        {tooltip.calls} 次调用
      </div>
    </div>
  );
}

function ModelDetailDrawer({
  provider,
  model,
  totals,
  onClose,
}: {
  provider: string;
  model: string;
  totals: LlmUsageTotals;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", right: 0, top: 0, bottom: 0, width: 320,
        background: "var(--bg)", borderLeft: "1px solid var(--border)",
        boxShadow: "-10px 0 30px rgba(0,0,0,0.15)", zIndex: 901,
        display: "flex", flexDirection: "column", color: "var(--text)",
      }}
      role="dialog"
      aria-label={`${provider}/${model} 详情`}
    >
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>模型详情</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>
      <div style={{ padding: 18, overflow: "auto", display: "flex", flexDirection: "column", gap: 14, fontSize: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>基本属性</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 8, background: "var(--bg-panel)", borderRadius: 6, padding: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>提供商</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{provider}</span>
            <span style={{ color: "var(--text-muted)" }}>模型</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{model}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>汇总指标</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 8, background: "var(--bg-panel)", borderRadius: 6, padding: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>调用次数</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(totals.calls)}</span>
            <span style={{ color: "var(--text-muted)" }}>费用</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCost(totals.cost)}</span>
            <span style={{ color: "var(--text-muted)" }}>Token</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={`${formatTokens(totals.totalTokens)} tokens`}>{formatTokens(totals.totalTokens)}</span>
            <span style={{ color: "var(--text-muted)" }}>成功率</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{successRate(totals)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Token 拆分</div>
          <TokenRows totals={totals} />
        </div>
      </div>
    </div>
  );
}
