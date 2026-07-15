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
import {
  formatTokens,
  formatTokensCompact,
  formatTokensLabel,
  formatTokensM,
} from "@/lib/token-format";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";
import { SelectDropdown, type SelectDropdownOption } from "./SelectDropdown";
import { UsageLedgerHeaderIcon } from "./UsageLedgerIcon";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UsageProviderModelTableProps {
  cwd?: string | null;
  onClose: () => void;
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

type ChartMetric = "tokens" | "cost";

/** Distinct palette for model series (stacked bars + multi-line trend). */
const MODEL_CHART_PALETTE = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#14b8a6",
  "#6366f1", "#e11d48", "#0ea5e9", "#a855f7", "#65a30d",
];

function modelKeyOf(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function modelColor(modelKey: string, index: number): string {
  return MODEL_CHART_PALETTE[index % MODEL_CHART_PALETTE.length];
}

type ChartModelSeries = {
  key: string;
  provider: string;
  model: string;
  color: string;
  totalTokens: number;
  totalCost: number;
};

type ChartHoverPayload = {
  x: number;
  y: number;
  date: string;
  modelKey: string;
  provider: string;
  model: string;
  color: string;
  value: number;
  tokens: number;
  cost: number;
  calls: number;
  dayTotal: number;
  pct: number;
};

function collectChartModelSeries(result: LlmUsageQueryResult | null): ChartModelSeries[] {
  if (!result) return [];
  const map = new Map<string, ChartModelSeries>();
  for (const day of result.byDayModel ?? []) {
    for (const m of day.models) {
      const key = modelKeyOf(m.provider, m.model);
      const existing = map.get(key);
      if (existing) {
        existing.totalTokens += m.tokens;
        existing.totalCost += m.cost;
      } else {
        map.set(key, {
          key,
          provider: m.provider,
          model: m.model,
          color: "",
          totalTokens: m.tokens,
          totalCost: m.cost,
        });
      }
    }
  }
  const series = [...map.values()].sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    if (b.totalCost !== a.totalCost) return b.totalCost - a.totalCost;
    return a.key.localeCompare(b.key);
  });
  return series.map((item, index) => ({
    ...item,
    color: modelColor(item.key, index),
  }));
}

// ---------------------------------------------------------------------------
// Inline styles (reusing project modal density conventions)
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

const chartSwitchBtn = (active: boolean): React.CSSProperties => ({
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: active ? "var(--bg-selected)" : "var(--bg)",
  padding: "3px 6px",
  color: active ? "var(--text)" : "var(--text-muted)",
  fontSize: 10,
  fontWeight: active ? 600 : 400,
  whiteSpace: "nowrap",
  cursor: "pointer",
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UsageProviderModelTable({ cwd, onClose }: UsageProviderModelTableProps) {
  const defaults = useMemo(() => getDefaultInputRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [sourceFilter, setSourceFilter] = useState<LlmUsageSourceKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<LlmUsageStatus | "all">("all");
  // FR-3: first open and reset always default to "all", even when cwd is present.
  const [workspaceFilter, setWorkspaceFilter] = useState<"all" | "cwd">("all");
  const [result, setResult] = useState<LlmUsageQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [chartMetric, setChartMetric] = useState<ChartMetric>("tokens");
  const [selectedModel, setSelectedModel] = useState<{
    provider: string;
    model: string;
    totals: LlmUsageTotals;
  } | null>(null);
  const [chartTooltip, setChartTooltip] = useState<ChartHoverPayload | null>(null);
  const chartSeries = useMemo(() => collectChartModelSeries(result), [result]);

  const activeCwd = workspaceFilter === "cwd" ? cwd ?? undefined : undefined;

  const sourceOptions = useMemo<SelectDropdownOption[]>(
    () => [
      { value: "all", label: "所有来源" },
      ...LLM_USAGE_SOURCE_KINDS.map((k) => ({ value: k, label: sourceLabel(k) })),
    ],
    [],
  );

  const statusOptions = useMemo<SelectDropdownOption[]>(
    () => [
      { value: "all", label: "所有状态" },
      { value: "success", label: "成功" },
      { value: "error", label: "失败" },
      { value: "aborted", label: "已中断" },
    ],
    [],
  );

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
    setWorkspaceFilter("all");
  }, []);

  const t = result?.totals;
  const rangeInvalid = Boolean(from && to && from > to);

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
            <UsageLedgerHeaderIcon />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                LLM 调用账本 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(Usage Ledger)</span>
              </div>
              <div style={{ marginTop: 1, fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                独立 append-only 调用日志 · 不依赖 session 生命周期
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => void loadData()} disabled={loading} {...iconFlowAttrs(loading ? "off" : "interactive")} style={iconButtonStyle} title="刷新" aria-label="刷新">
              <ActionFlowIcon width={13} height={13} strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </ActionFlowIcon>
            </button>
            <button type="button" onClick={onClose} style={iconButtonStyle} title="关闭" aria-label="关闭">
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

          <div role="group" aria-label="工作区" style={{ display: "flex", height: 26, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
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
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {item === "all" ? "全部" : "当前"}
                </button>
              );
            })}
          </div>

          <SelectDropdown
            value={sourceFilter}
            options={sourceOptions}
            onChange={(value) => setSourceFilter(value as LlmUsageSourceKind | "all")}
            size="toolbar"
            ariaLabel="来源"
            title="来源"
            minWidth={128}
          />

          <SelectDropdown
            value={statusFilter}
            options={statusOptions}
            onChange={(value) => setStatusFilter(value as LlmUsageStatus | "all")}
            size="toolbar"
            ariaLabel="状态"
            title="状态"
            minWidth={110}
          />

          <button
            type="button"
            onClick={resetFilters}
            style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 10, gap: 4, display: "flex", alignItems: "center" }}
            title="重置筛选"
          >
            ↺ 重置
          </button>

          {rangeInvalid && (
            <div role="alert" style={{ width: "100%", color: "#ef4444", fontSize: 10 }}>
              结束日期不能早于开始日期，请修正日期范围。
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: 14 }}>
          {error || rangeInvalid ? (
            <div style={{ color: "#ef4444", fontSize: 12, padding: 14, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 7, background: "rgba(239,68,68,0.06)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <div style={{ fontWeight: 600 }}>{rangeInvalid ? "日期范围无效" : "读取账本事件失败"}</div>
              <div style={{ color: "var(--text-muted)", maxWidth: 400, lineHeight: 1.5 }}>
                {rangeInvalid ? "结束日期不能早于开始日期。请修正日期范围后重试。" : error}
              </div>
              {!rangeInvalid && (
                <button type="button" onClick={() => void loadData()} style={{ ...iconButtonStyle, width: "auto", padding: "0 14px" }}>
                  重试
                </button>
              )}
            </div>
          ) : loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, color: "var(--text-muted)", gap: 12 }}>
              <div style={{ width: 26, height: 26, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12 }}>正在读取调用账本…</span>
            </div>
          ) : result ? (
            <>
              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
                <Metric
                  label="预估费用"
                  value={formatCost(t?.cost ?? 0)}
                  highlight
                  title="预估费用 = 各模型调用量 × 对应单价"
                />
                <Metric
                  label="总 Token"
                  value={formatTokensM(t?.totalTokens ?? 0)}
                  sub={formatTokensLabel(t?.totalTokens ?? 0)}
                  title={formatTokensLabel(t?.totalTokens ?? 0)}
                />
                <Metric
                  label="调用次数"
                  value={formatTokens(t?.calls ?? 0)}
                  sub={`成功 ${formatTokens(t?.successCalls ?? 0)} · 失败 ${formatTokens(t?.errorCalls ?? 0)} · 中断 ${formatTokens(t?.abortedCalls ?? 0)}`}
                  title={`成功 ${formatTokens(t?.successCalls ?? 0)} / 失败 ${formatTokens(t?.errorCalls ?? 0)} / 中断 ${formatTokens(t?.abortedCalls ?? 0)}`}
                />
                <Metric
                  label="成功率"
                  value={t ? successRate(t) : "--"}
                  success={t ? t.successCalls / Math.max(1, t.calls) >= 0.95 : false}
                  title={`${formatTokens(t?.successCalls ?? 0)} / ${formatTokens(t?.calls ?? 0)}`}
                />
              </div>

              {/* Daily charts: line + bars side by side */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
                <section style={panelStyle} className="usage-daily-chart" onMouseLeave={() => setChartTooltip(null)}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>
                      {result.byDay.length === 1 ? "模型占比" : "折线趋势"}
                    </div>
                    <div className="usage-chart-controls" style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div className="usage-chart-title-range" style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                        {result.range.from} — {result.range.to}
                        {result.byDay.length === 1 ? " · 单日饼图" : ""}
                      </div>
                      <div role="group" aria-label="图表指标" style={{ display: "flex", gap: 3 }}>
                        <button type="button" style={chartSwitchBtn(chartMetric === "tokens")} onClick={() => setChartMetric("tokens")}>
                          使用量
                        </button>
                        <button type="button" style={chartSwitchBtn(chartMetric === "cost")} onClick={() => setChartMetric("cost")}>
                          费用
                        </button>
                      </div>
                    </div>
                  </div>

                  {result.byDay.length === 0 ? (
                    <EmptyState />
                  ) : result.byDay.length === 1 ? (
                    <DailyPieChart
                      day={result.byDay[0]}
                      byDayModel={result.byDayModel}
                      series={chartSeries}
                      metric={chartMetric}
                      onSliceHover={(payload) => setChartTooltip(payload)}
                      onSliceLeave={() => setChartTooltip(null)}
                    />
                  ) : (
                    <DailyLineChart
                      days={result.byDay}
                      byDayModel={result.byDayModel}
                      series={chartSeries}
                      metric={chartMetric}
                      onPointHover={(payload) => setChartTooltip(payload)}
                      onPointLeave={() => setChartTooltip(null)}
                    />
                  )}

                  {chartTooltip && (
                    <UsageChartTooltip
                      tooltip={chartTooltip}
                      metric={chartMetric}
                    />
                  )}

                  {chartSeries.length > 1 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
                      {chartSeries.map((item) => (
                        <span
                          key={`line-legend-${item.key}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              background: item.color,
                              flexShrink: 0,
                            }}
                          />
                          {item.provider !== "unknown" ? `${item.provider}/` : ""}{item.model}
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section style={panelStyle} className="usage-daily-chart" onMouseLeave={() => setChartTooltip(null)}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>柱状占比</div>
                    <div className="usage-chart-title-range" style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                      {chartMetric === "cost" ? "费用" : "使用量"} · {result.range.from} — {result.range.to}
                    </div>
                  </div>

                  {result.byDay.length === 0 ? (
                    <EmptyState />
                  ) : (
                    <DailyBarChart
                      days={result.byDay}
                      byDayModel={result.byDayModel}
                      series={chartSeries}
                      metric={chartMetric}
                      onBarHover={(payload) => setChartTooltip(payload)}
                      onBarLeave={() => setChartTooltip(null)}
                    />
                  )}

                  {chartSeries.length > 1 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
                      {chartSeries.map((item) => (
                        <span
                          key={`bar-legend-${item.key}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: item.color,
                              flexShrink: 0,
                            }}
                          />
                          {item.provider !== "unknown" ? `${item.provider}/` : ""}{item.model}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Token breakdown on its own row so dual charts can share the width */}
              <section style={{ ...panelStyle, marginBottom: 12 }}>
                <SectionTitle title="Token 拆分" right="M · exact" />
                <TokenRows totals={t ?? zeroTotals} />
              </section>

              {/* Provider / Model table */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "auto", marginBottom: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 11, minWidth: 660 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle }}>提供商 / 模型</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Calls</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">成功率</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">Input</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">Output</th>
                      <th style={{ ...thStyle, textAlign: "right" }} className="hide-mobile">Cache Read</th>
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
                  <tfoot>
                    <tr>
                      <td colSpan={9} style={{ padding: "10px 12px", background: "var(--bg-panel)", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--border)" }}>
                        点击模型行查看详细过滤细分 · {result.byProvider.reduce((sum, p) => sum + p.models.length, 0)} 个模型
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* By Source / By Status */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12 }}>
                <BreakdownTable title="按来源" rows={result.bySource.map((s) => ({ label: sourceLabel(s.source), totals: s.totals }))} />
                <BreakdownTable title="按状态" rows={result.byStatus.map((s) => ({ label: statusLabel(s.status), totals: s.totals }))} />
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
              <span style={{ fontSize: 24 }}>∅</span>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>此范围内无调用记录</div>
              <div style={{ fontSize: 11, maxWidth: 320 }}>调整日期或筛选条件后重试。</div>
            </div>
          )}
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
  padding: "8px 10px",
  fontWeight: 600,
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  userSelect: "none",
};

function Metric({
  label,
  value,
  sub,
  highlight,
  success,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  success?: boolean;
  title?: string;
}) {
  return (
    <div style={panelStyle} title={title}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>{label}</div>
      <div style={{
        marginTop: 5,
        fontSize: highlight ? 21 : 19,
        lineHeight: 1.15,
        fontWeight: 600,
        color: success === false ? "var(--text-muted)" : highlight ? "var(--accent)" : "var(--text)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
        {sub && (
          <span style={{ display: "block", marginTop: 4, color: "var(--text-dim)", fontSize: 10, fontWeight: 400 }}>
            {sub}
          </span>
        )}
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

function TokenCell({ value }: { value: number }) {
  return (
    <span title={formatTokensLabel(value)} style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatTokensM(value)}
      <small style={{ color: "var(--text-dim)", marginLeft: 4, fontWeight: 400 }}>
        · {formatTokens(value)}
      </small>
    </span>
  );
}

function TokenRows({ totals }: { totals: LlmUsageTotals }) {
  const rows = [
    ["Input", totals.input],
    ["Output", totals.output],
    ["Cache Read", totals.cacheRead],
  ] as const;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            gap: 10,
            alignItems: "center",
            padding: "7px 0",
            borderTop: "1px solid var(--border)",
            fontSize: 12,
          }}
          title={formatTokensLabel(value)}
        >
          <span style={{ color: "var(--text-muted)" }}>{label}</span>
          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokensM(value)}</span>
          <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(value)}</span>
        </div>
      ))}
      {totals.reasoning !== undefined && totals.reasoning > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            gap: 10,
            alignItems: "center",
            padding: "7px 0",
            borderTop: "1px dashed var(--border)",
            fontSize: 12,
          }}
          title={`${formatTokensLabel(totals.reasoning)} (已含于 Output)`}
        >
          <span style={{ color: "var(--text-muted)" }}>🧠 Reasoning</span>
          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokensM(totals.reasoning)}</span>
          <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(totals.reasoning)}</span>
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
            {provider.models.length} 个模型 · {formatTokens(provider.totals.calls)} 次调用
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
              <td style={{ ...tdStyle, textAlign: "right" }} className="hide-mobile">
                <TokenCell value={m.totals.input} />
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }} className="hide-mobile">
                <TokenCell value={m.totals.output} />
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }} className="hide-mobile">
                <TokenCell value={m.totals.cacheRead} />
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
  padding: "10px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
  color: "var(--text)",
  fontSize: 11,
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
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 65px 65px", gap: 8, alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 11 }}>
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
// Daily charts — byDayModel stacked bars + multi-model line series
// ---------------------------------------------------------------------------

type DayPoint = LlmUsageQueryResult["byDay"][number];
type DayModelPoint = LlmUsageQueryResult["byDayModel"][number];

function dayMetricValue(day: DayPoint, metric: ChartMetric): number {
  return metric === "cost" ? day.totals.cost : day.totals.totalTokens;
}

function modelMetricValue(entry: { tokens: number; cost: number }, metric: ChartMetric): number {
  return metric === "cost" ? entry.cost : entry.tokens;
}

function formatAxisTick(value: number, metric: ChartMetric): string {
  if (metric === "cost") {
    if (value <= 0) return "$0";
    if (value < 0.01) return "<$0.01";
    if (value >= 10) return `$${value.toFixed(0)}`;
    return `$${value.toFixed(1)}`;
  }
  return formatTokensCompact(value);
}

function formatMetricPrimary(value: number, metric: ChartMetric): string {
  if (metric === "cost") return formatCost(value);
  return `${formatTokensM(value)} · ${formatTokens(value)}`;
}

function dayModelsForDate(
  byDayModel: DayModelPoint[] | undefined,
  date: string,
): DayModelPoint["models"] {
  return byDayModel?.find((item) => item.date === date)?.models ?? [];
}

function colorMapFromSeries(series: ChartModelSeries[]): Map<string, string> {
  return new Map(series.map((item) => [item.key, item.color]));
}

function DailyBarChart({
  days,
  byDayModel,
  series,
  metric,
  onBarHover,
  onBarLeave,
}: {
  days: DayPoint[];
  byDayModel: DayModelPoint[] | undefined;
  series: ChartModelSeries[];
  metric: ChartMetric;
  onBarHover: (payload: ChartHoverPayload) => void;
  onBarLeave: () => void;
}) {
  const max = Math.max(0, ...days.map((d) => dayMetricValue(d, metric)));
  const colors = colorMapFromSeries(series);
  return (
    <div
      className="usage-bar-chart"
      aria-label={metric === "cost" ? "按日模型费用叠柱图" : "按日模型使用量叠柱图"}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {days.map((day) => {
        const dayTotal = dayMetricValue(day, metric);
        const width = max > 0 ? Math.max(3, (dayTotal / max) * 100) : 0;
        const models = dayModelsForDate(byDayModel, day.date);
        const hasCostData = models.some((m) => m.cost > 0);
        return (
          <div
            key={day.date}
            className="usage-bar-row"
            style={{
              display: "grid",
              gridTemplateColumns: "48px minmax(0, 1fr) minmax(92px, auto)",
              gap: 8,
              alignItems: "center",
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{day.date.slice(5)}</span>
            <div
              data-chart-bar
              style={{
                height: 12,
                border: "1px solid var(--border)",
                borderRadius: 999,
                overflow: "hidden",
                background: "var(--bg)",
                display: "flex",
                position: "relative",
                width: `${width}%`,
                minWidth: width > 0 ? 3 : 0,
              }}
              onMouseLeave={onBarLeave}
            >
              {metric === "cost" && !hasCostData && dayTotal <= 0 ? (
                <span
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    color: "var(--text-dim)",
                    position: "absolute",
                    inset: 0,
                  }}
                >
                  无费用数据
                </span>
              ) : (
                models.map((m, index) => {
                  const modelVal = modelMetricValue(m, metric);
                  const pct = dayTotal > 0 ? Math.max(0, (modelVal / dayTotal) * 100) : 0;
                  if (pct <= 0) return null;
                  const mk = modelKeyOf(m.provider, m.model);
                  const color = colors.get(mk) ?? modelColor(mk, index);
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
                      title={`${m.provider !== "unknown" ? `${m.provider}/` : ""}${m.model}: ${formatMetricPrimary(modelVal, metric)}`}
                      onMouseEnter={(e) => {
                        const rect = (e.target as HTMLElement).closest("[data-chart-bar]")?.getBoundingClientRect();
                        onBarHover({
                          x: e.clientX,
                          y: (rect ?? e.currentTarget.getBoundingClientRect()).top,
                          date: day.date,
                          modelKey: mk,
                          provider: m.provider,
                          model: m.model,
                          color,
                          value: modelVal,
                          tokens: m.tokens,
                          cost: m.cost,
                          calls: m.calls,
                          dayTotal,
                          pct,
                        });
                      }}
                      onMouseMove={(e) => {
                        onBarHover({
                          x: e.clientX,
                          y: (e.currentTarget.closest("[data-chart-bar]") as HTMLElement | null)?.getBoundingClientRect().top
                            ?? e.currentTarget.getBoundingClientRect().top,
                          date: day.date,
                          modelKey: mk,
                          provider: m.provider,
                          model: m.model,
                          color,
                          value: modelVal,
                          tokens: m.tokens,
                          cost: m.cost,
                          calls: m.calls,
                          dayTotal,
                          pct,
                        });
                      }}
                    />
                  );
                })
              )}
            </div>
            <span
              style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
              title={metric === "cost" ? formatCost(day.totals.cost) : formatTokensLabel(day.totals.totalTokens)}
            >
              {metric === "cost" ? formatCost(day.totals.cost) : formatTokensCompact(day.totals.totalTokens)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeDonutSlice(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

/** Single-day fallback for the left chart: model share pie/donut. */
function DailyPieChart({
  day,
  byDayModel,
  series,
  metric,
  onSliceHover,
  onSliceLeave,
}: {
  day: DayPoint;
  byDayModel: DayModelPoint[] | undefined;
  series: ChartModelSeries[];
  metric: ChartMetric;
  onSliceHover: (payload: ChartHoverPayload) => void;
  onSliceLeave: () => void;
}) {
  const width = 448;
  const height = 220;
  const cx = 224;
  const cy = 108;
  const outerR = 78;
  const innerR = 42;
  const dayTotal = dayMetricValue(day, metric);
  const colors = colorMapFromSeries(series);
  const models = dayModelsForDate(byDayModel, day.date)
    .map((m, index) => {
      const key = modelKeyOf(m.provider, m.model);
      return {
        ...m,
        key,
        value: modelMetricValue(m, metric),
        color: colors.get(key) ?? modelColor(key, index),
      };
    })
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value);

  if (dayTotal <= 0 || models.length === 0) {
    return (
      <div style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        {metric === "cost" ? "无费用数据" : "暂无数据"}
      </div>
    );
  }

  // Full circle for a single model uses a ring path (arc with zero span is invisible).
  if (models.length === 1) {
    const only = models[0];
    return (
      <svg
        className="usage-pie-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={metric === "cost" ? "单日模型费用占比" : "单日模型使用量占比"}
        style={{ width: "100%", height: 190, display: "block" }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={(outerR + innerR) / 2}
          fill="none"
          stroke={only.color}
          strokeWidth={outerR - innerR}
          style={{ cursor: "pointer" }}
          onMouseEnter={(e) => {
            const rect = (e.target as SVGCircleElement).getBoundingClientRect();
            onSliceHover({
              x: rect.left + rect.width / 2,
              y: rect.top,
              date: day.date,
              modelKey: only.key,
              provider: only.provider,
              model: only.model,
              color: only.color,
              value: only.value,
              tokens: only.tokens,
              cost: only.cost,
              calls: only.calls,
              dayTotal,
              pct: 100,
            });
          }}
          onMouseLeave={onSliceLeave}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text)" fontSize={12} fontWeight={600}>
          {metric === "cost" ? formatCost(dayTotal) : formatTokensCompact(dayTotal)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-dim)" fontSize={9}>
          {day.date.slice(5)} · 100%
        </text>
      </svg>
    );
  }

  let cursor = 0;
  const slices = models.map((m, index) => {
    const pct = (m.value / dayTotal) * 100;
    const start = cursor;
    // Last slice closes the full circle to absorb floating-point remainder.
    const end = index === models.length - 1 ? 360 : cursor + (m.value / dayTotal) * 360;
    cursor = end;
    return { ...m, pct, start, end };
  });

  return (
    <svg
      className="usage-pie-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={metric === "cost" ? "单日模型费用占比" : "单日模型使用量占比"}
      style={{ width: "100%", height: 190, display: "block" }}
    >
      {slices.map((slice) => (
        <path
          key={slice.key}
          d={describeDonutSlice(cx, cy, outerR, innerR, slice.start, slice.end)}
          fill={slice.color}
          stroke="var(--bg)"
          strokeWidth={1}
          style={{ cursor: "pointer" }}
          onMouseEnter={(e) => {
            const rect = (e.target as SVGPathElement).getBoundingClientRect();
            onSliceHover({
              x: rect.left + rect.width / 2,
              y: rect.top,
              date: day.date,
              modelKey: slice.key,
              provider: slice.provider,
              model: slice.model,
              color: slice.color,
              value: slice.value,
              tokens: slice.tokens,
              cost: slice.cost,
              calls: slice.calls,
              dayTotal,
              pct: slice.pct,
            });
          }}
          onMouseLeave={onSliceLeave}
        />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text)" fontSize={12} fontWeight={600}>
        {metric === "cost" ? formatCost(dayTotal) : formatTokensCompact(dayTotal)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-dim)" fontSize={9}>
        {day.date.slice(5)} · {models.length} 模型
      </text>
    </svg>
  );
}

function DailyLineChart({
  days,
  byDayModel,
  series,
  metric,
  onPointHover,
  onPointLeave,
}: {
  days: DayPoint[];
  byDayModel: DayModelPoint[] | undefined;
  series: ChartModelSeries[];
  metric: ChartMetric;
  onPointHover: (payload: ChartHoverPayload) => void;
  onPointLeave: () => void;
}) {
  const width = 448;
  const height = 220;
  const left = 44;
  const right = 420;
  const top = 48;
  const bottom = 190;
  const activeSeries = series.length > 0
    ? series
    : [{ key: "__total__", provider: "unknown", model: "合计", color: "var(--accent)", totalTokens: 0, totalCost: 0 }];

  const valuesBySeries = activeSeries.map((item) =>
    days.map((day) => {
      if (item.key === "__total__") return dayMetricValue(day, metric);
      const entry = dayModelsForDate(byDayModel, day.date).find(
        (m) => modelKeyOf(m.provider, m.model) === item.key,
      );
      return entry ? modelMetricValue(entry, metric) : 0;
    }),
  );
  const max = Math.max(1, ...valuesBySeries.flat());
  const count = Math.max(1, days.length - 1);
  const xs = days.map((_, i) => (days.length === 1 ? (left + right) / 2 : left + ((right - left) * i) / count));
  const yTicks = [1, 2 / 3, 1 / 3, 0].map((ratio) => ({
    y: bottom - ratio * (bottom - top),
    label: formatAxisTick(max * ratio, metric),
  }));
  const labelIndexes = days.length <= 4
    ? days.map((_, i) => i)
    : [0, Math.floor((days.length - 1) / 3), Math.floor(((days.length - 1) * 2) / 3), days.length - 1];

  return (
    <svg
      className="usage-line-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={metric === "cost" ? "每日模型费用折线趋势" : "每日模型 Token 使用量折线趋势"}
      style={{ width: "100%", height: 190, display: "block", overflow: "visible" }}
    >
      {yTicks.map((tick) => (
        <g key={tick.y}>
          <line x1={left} y1={tick.y} x2={right} y2={tick.y} stroke="var(--border)" strokeWidth={1} />
          <text x={5} y={tick.y + 3} fill="var(--text-dim)" fontSize={9}>{tick.label}</text>
        </g>
      ))}
      {activeSeries.map((item, seriesIndex) => {
        const values = valuesBySeries[seriesIndex];
        const ys = values.map((v) => bottom - ((v / max) * (bottom - top)));
        const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
        const pointPayloads = days.map((day, i) => {
          const value = values[i];
          const entry = item.key === "__total__"
            ? null
            : dayModelsForDate(byDayModel, day.date).find(
                (m) => modelKeyOf(m.provider, m.model) === item.key,
              );
          const tokens = entry?.tokens ?? (item.key === "__total__" ? day.totals.totalTokens : 0);
          const cost = entry?.cost ?? (item.key === "__total__" ? day.totals.cost : 0);
          const calls = entry?.calls ?? (item.key === "__total__" ? day.totals.calls : 0);
          const dayTotal = dayMetricValue(day, metric);
          const pct = dayTotal > 0 ? (value / dayTotal) * 100 : 0;
          return {
            day,
            value,
            tokens,
            cost,
            calls,
            dayTotal,
            pct,
          };
        });
        const lastPoint = pointPayloads[pointPayloads.length - 1];

        const emitPointHover = (
          target: Element,
          point: (typeof pointPayloads)[number],
        ) => {
          const rect = target.getBoundingClientRect();
          onPointHover({
            x: rect.left + rect.width / 2,
            y: rect.top,
            date: point.day.date,
            modelKey: item.key,
            provider: item.provider,
            model: item.model,
            color: item.color,
            value: point.value,
            tokens: point.tokens,
            cost: point.cost,
            calls: point.calls,
            dayTotal: point.dayTotal,
            pct: point.pct,
          });
        };

        return (
          <g key={item.key}>
            {/* Wide invisible hit stroke so hovering the line is easy. */}
            <polyline
              points={points}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => {
                if (!lastPoint) return;
                emitPointHover(e.currentTarget, lastPoint);
              }}
              onMouseMove={(e) => {
                if (!lastPoint) return;
                // Keep tooltip near cursor while treating line hover as last-day value.
                onPointHover({
                  x: e.clientX,
                  y: e.clientY - 8,
                  date: lastPoint.day.date,
                  modelKey: item.key,
                  provider: item.provider,
                  model: item.model,
                  color: item.color,
                  value: lastPoint.value,
                  tokens: lastPoint.tokens,
                  cost: lastPoint.cost,
                  calls: lastPoint.calls,
                  dayTotal: lastPoint.dayTotal,
                  pct: lastPoint.pct,
                });
              }}
            />
            <polyline
              points={points}
              fill="none"
              stroke={item.color}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
            {pointPayloads.map((point, i) => {
              const { day, value } = point;
              return (
                <circle
                  key={`${item.key}-${day.date}`}
                  className="usage-line-point"
                  cx={xs[i]}
                  cy={ys[i]}
                  r={3.5}
                  tabIndex={0}
                  fill="var(--bg)"
                  stroke={item.color}
                  strokeWidth={2}
                  style={{ cursor: "pointer" }}
                  aria-label={`${day.date} ${item.provider !== "unknown" ? `${item.provider}/` : ""}${item.model} ${formatMetricPrimary(value, metric)}`}
                  onMouseEnter={(e) => emitPointHover(e.currentTarget, point)}
                  onFocus={(e) => emitPointHover(e.currentTarget, point)}
                  onBlur={onPointLeave}
                />
              );
            })}
          </g>
        );
      })}
      {labelIndexes.map((i) => (
        <text
          key={`label-${days[i].date}`}
          x={xs[i]}
          y={211}
          textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
          fill="var(--text-dim)"
          fontSize={9}
        >
          {days[i].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Chart tooltip — positioned near cursor, constrained to viewport
// ---------------------------------------------------------------------------

function UsageChartTooltip({
  tooltip,
  metric,
}: {
  tooltip: ChartHoverPayload;
  metric: ChartMetric;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = tooltip.x + 14;
    if (left + rect.width > vw - 8) left = tooltip.x - rect.width - 14;
    if (left < 8) left = 8;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;

    let top = tooltip.y - rect.height - 10;
    if (top < 8) top = tooltip.y + 22;
    if (top < 8) top = 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;

    setOffset({ left, top });
  }, [el, tooltip]);

  const primaryIsCost = metric === "cost";
  const valueLabel = primaryIsCost
    ? (tooltip.value > 0 ? formatCost(tooltip.value) : "无费用数据")
    : formatTokensM(tooltip.value);
  const dayTotalLabel = primaryIsCost
    ? formatCost(tooltip.dayTotal)
    : formatTokensM(tooltip.dayTotal);
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
        "--tooltip-accent": tooltip.color || "var(--accent)",
      }}
    >
      <div className="usage-chart-tooltip-date">
        {tooltip.date} · {primaryIsCost ? "费用" : "使用量"}
      </div>
      <div className="usage-chart-tooltip-model">
        <span className="usage-chart-tooltip-model-dot" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tooltip.provider !== "unknown" ? `${tooltip.provider}/` : ""}{tooltip.model}
        </span>
      </div>
      <div className="usage-chart-tooltip-divider" />
      <div className="usage-chart-tooltip-row">
        <span className="usage-chart-tooltip-label">{primaryIsCost ? "费用" : "使用量"}</span>
        <span className="usage-chart-tooltip-value">{valueLabel}</span>
      </div>
      {!primaryIsCost && (
        <div className="usage-chart-tooltip-row">
          <span className="usage-chart-tooltip-label">最小单位</span>
          <span className="usage-chart-tooltip-value">{formatTokensLabel(tooltip.tokens)}</span>
        </div>
      )}
      {primaryIsCost && (
        <div className="usage-chart-tooltip-row">
          <span className="usage-chart-tooltip-label">使用量</span>
          <span className="usage-chart-tooltip-value">{`${formatTokensM(tooltip.tokens)} · ${formatTokensLabel(tooltip.tokens)}`}</span>
        </div>
      )}
      {!primaryIsCost && (
        <div className="usage-chart-tooltip-row">
          <span className="usage-chart-tooltip-label">费用</span>
          <span className="usage-chart-tooltip-value">{formatCost(tooltip.cost)}</span>
        </div>
      )}
      <div className="usage-chart-tooltip-row">
        <span className="usage-chart-tooltip-label">占当日</span>
        <span className="usage-chart-tooltip-value">{pctLabel}</span>
      </div>
      <div className="usage-chart-tooltip-divider" />
      <div className="usage-chart-tooltip-row usage-chart-tooltip-total">
        <span className="usage-chart-tooltip-label">当日合计</span>
        <span className="usage-chart-tooltip-value">{dayTotalLabel}</span>
      </div>
      <div className="usage-chart-tooltip-calls">{tooltip.calls} 次调用</div>
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
        position: "fixed", right: 0, top: 0, bottom: 0, width: "min(320px, 100vw)",
        background: "var(--bg)", borderLeft: "1px solid var(--border)",
        boxShadow: "-10px 0 30px rgba(0,0,0,0.15)", zIndex: 901,
        display: "flex", flexDirection: "column", color: "var(--text)",
      }}
      role="dialog"
      aria-label={`${provider}/${model} 详情`}
    >
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>模型详情</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }} aria-label="关闭">×</button>
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
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={formatTokensLabel(totals.totalTokens)}>
              {formatTokensM(totals.totalTokens)}
              <br />
              <small style={{ color: "var(--text-dim)", fontWeight: 400 }}>{formatTokens(totals.totalTokens)}</small>
            </span>
            <span style={{ color: "var(--text-muted)" }}>成功率</span>
            <span style={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{successRate(totals)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Token 拆分 · M / exact</div>
          <TokenRows totals={totals} />
        </div>
      </div>
    </div>
  );
}
