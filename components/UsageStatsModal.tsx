"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageStatsResult, UsageTotals } from "@/lib/usage-stats";
import type { PiWebConfig } from "@/lib/pi-web-config";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";
import { UsageProviderModelTable } from "./UsageProviderModelTable";

interface UsageStatsModalProps {
  cwd?: string | null;
  onClose: () => void;
}

type UsageView = "legacy" | "ledger";

type UsageScope = "all" | "cwd";

/**
 * Read the pi-web config's usage.statsSource to determine the default view.
 * Defaults to "legacy" when config is unavailable (SSR / fetch failure).
 */
async function resolveDefaultUsageView(): Promise<UsageView> {
  try {
    const res = await fetch("/api/web-config");
    const data = (await res.json()) as { config?: PiWebConfig } | undefined;
    const source = data?.config?.usage?.statsSource;
    if (source === "ledger") return "ledger";
  } catch { /* fetch may fail; keep legacy */ }
  return "legacy";
}

/**
 * 将日期对象格式化为日期输入框需要的本地日期字符串。
 *
 * @param date 需要格式化的日期对象。
 * @returns `YYYY-MM-DD` 格式的本地日期。
 */
function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 生成默认的统计日期范围。
 *
 * @returns 默认近 7 天的日期输入框值。
 */
function getDefaultInputRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

/**
 * 格式化美元费用，保留小额费用的可读性。
 *
 * @param value 需要格式化的费用数字。
 * @returns 美元格式字符串。
 */
function formatCost(value: number): string {
  if (value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/**
 * 格式化 token 数量。
 *
 * @param value 需要格式化的 token 数。
 * @returns 带千分位的 token 字符串。
 */
function formatTokens(value: number): string {
  return value.toLocaleString();
}

function formatTokensM(value: number): string {
  if (value <= 0) return "0 M";
  const m = value / 1_000_000;
  const fixed = m.toFixed(6);
  return `${fixed.replace(/\.?0+$/, "")} M`;
}

/**
 * 计算 token 汇总总数（不含 cache-write，已退役）。
 *
 * @param totals token 和费用汇总对象。
 * @returns input + output + cacheRead 的总和。
 */
function totalTokens(totals: UsageTotals): number {
  return totals.input + totals.output + totals.cacheRead;
}

/**
 * 渲染日期范围费用统计弹窗。
 *
 * @param props cwd 为当前项目目录，onClose 用于关闭弹窗。
 * @returns 用于查看费用统计的 React 节点。
 */
export function UsageStatsModal({ cwd, onClose }: UsageStatsModalProps) {
  const [viewMode, setViewMode] = useState<UsageView>("legacy");

  // Resolve the default view from config on mount
  useEffect(() => {
    resolveDefaultUsageView().then((defaultView) => {
      setViewMode(defaultView);
    });
  }, []);

  const defaults = useMemo(() => getDefaultInputRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [scope, setScope] = useState<UsageScope>(cwd ? "cwd" : "all");
  const [stats, setStats] = useState<UsageStatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCwd = scope === "cwd" ? cwd : null;
  const largestDailyCost = Math.max(0, ...(stats?.byDay.map((day) => day.totals.cost) ?? []));
  const parentSessionRows = stats?.byParentSession?.length ? stats.byParentSession : null;
  const sessionRows = parentSessionRows ?? stats?.bySession ?? [];
  const sessionSectionTitle = parentSessionRows ? "Parent sessions" : "Sessions";
  const sessionSectionRight = parentSessionRows
    ? `${stats?.skippedEntries ?? 0} skipped · rolled up`
    : `${stats?.skippedEntries ?? 0} skipped`;

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (activeCwd) params.set("cwd", activeCwd);
      const res = await fetch(`/api/usage?${params.toString()}`, { signal });
      const data = await res.json() as UsageStatsResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStats(data);
    } catch (err) {
      if (signal?.aborted) return;
      setStats(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeCwd, from, to]);

  useEffect(() => {
    if (viewMode !== "legacy") return;
    const controller = new AbortController();
    void loadStats(controller.signal);
    return () => controller.abort();
  }, [loadStats, viewMode]);

  useEffect(() => {
    if (!cwd && scope === "cwd") setScope("all");
  }, [cwd, scope]);

  // Render ledger view via the dedicated component
  if (viewMode === "ledger") {
    return <UsageProviderModelTable cwd={cwd} onClose={onClose} onSwitchToLegacy={() => setViewMode("legacy")} />;
  }

  return (
    <div
      className="pi-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Usage statistics"
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>Usage</div>
              <div style={{ marginTop: 1, fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Includes YPI Studio child sessions when present; children are rolled up to their parent chat.
              </div>
            </div>
          </div>

          {/* View toggle — independent layout space to avoid clipping */}
          <div style={{ display: "flex", height: 26, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
            {(["legacy", "ledger"] as UsageView[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "0 10px",
                  border: "none",
                  borderLeft: mode === "ledger" ? "1px solid var(--border)" : "none",
                  background: viewMode === mode ? "var(--bg-selected)" : "transparent",
                  color: viewMode === mode ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                {mode === "legacy" ? "Session 统计" : "调用账本"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={dateInputStyle}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={dateInputStyle}
              />
            </label>
            <div style={{ display: "flex", height: 26, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              {(["all", "cwd"] as UsageScope[]).map((item) => {
                const disabled = item === "cwd" && !cwd;
                const active = scope === item;
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={disabled}
                    onClick={() => setScope(item)}
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
                    {item === "all" ? "All" : "Cwd"}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => void loadStats()} disabled={loading} {...iconFlowAttrs(loading ? "off" : "interactive")} style={iconButtonStyle} title="Refresh">
              <ActionFlowIcon width={13} height={13} strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </ActionFlowIcon>
            </button>
            <button type="button" onClick={onClose} style={iconButtonStyle} title="Close">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ overflow: "auto", padding: 14 }}>
          {error ? (
            <div style={{ color: "#ef4444", fontSize: 12, padding: 12, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 7, background: "rgba(239,68,68,0.06)" }}>
              {error}
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
                <Metric label="Cost" value={formatCost(stats?.totals.cost ?? 0)} strong />
                <Metric label="Tokens" value={`${formatTokens(totalTokens(stats?.totals ?? zeroTotals))} (${formatTokensM(totalTokens(stats?.totals ?? zeroTotals))})`} />
                <Metric label="Calls" value={formatTokens(stats?.totals.calls ?? 0)} />
                <Metric label="Sessions" value={`${stats?.bySession.length ?? 0}/${stats?.matchedSessions ?? 0}`} />
                <Metric label="Studio children" value={`${stats?.matchedStudioChildSessions ?? 0}/${stats?.scannedStudioChildSessions ?? 0}`} />
                <Metric label="Parent rollups" value={formatTokens(stats?.byParentSession?.length ?? 0)} />
                <Metric label="Scanned active/archive" value={`${stats?.scannedActiveSessions ?? 0}/${stats?.scannedArchivedSessions ?? 0}`} />
                <Metric label="Matched active/archive" value={`${stats?.matchedActiveSessions ?? 0}/${stats?.matchedArchivedSessions ?? 0}`} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12 }}>
                <section style={panelStyle}>
                  <SectionTitle title="Daily" right={loading ? "Loading" : stats ? `${stats.from} - ${stats.to} · ${stats.scope.includeArchived ? "with archive" : "active only"}` : ""} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {(stats?.byDay ?? []).length === 0 ? (
                      <EmptyState />
                    ) : stats!.byDay.map((day) => {
                      const width = largestDailyCost > 0 ? Math.max(3, (day.totals.cost / largestDailyCost) * 100) : 0;
                      return (
                        <div key={day.date} style={{ display: "grid", gridTemplateColumns: "82px minmax(0, 1fr) 72px", alignItems: "center", gap: 8, fontSize: 11 }}>
                          <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{day.date.slice(5)}</span>
                          <div style={{ height: 7, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ width: `${width}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), #22c55e)" }} />
                          </div>
                          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCost(day.totals.cost)}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section style={panelStyle}>
                  <SectionTitle title="Tokens" />
                  <TokenRows totals={stats?.totals ?? zeroTotals} />
                </section>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12, marginTop: 12 }}>
                <Breakdown title="Models" rows={(stats?.byModel ?? []).slice(0, 8).map((row) => ({ label: `${row.provider}/${row.model}`, totals: row.totals }))} />
                <Breakdown title="Providers" rows={(stats?.byProvider ?? []).map((row) => ({ label: row.provider, totals: row.totals }))} />
              </div>

              <section style={{ ...panelStyle, marginTop: 12 }}>
                <SectionTitle title={sessionSectionTitle} right={sessionSectionRight} />
                {parentSessionRows && (
                  <div style={{ marginBottom: 6, fontSize: 10, color: "var(--text-dim)" }}>
                    Totals combine each parent chat with its YPI Studio child sessions; the legacy per-session list remains available in the API response.
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {sessionRows.length === 0 ? (
                    <EmptyState />
                  ) : sessionRows.slice(0, 12).map((session) => {
                    const isParentRollup = "parentSessionId" in session && "ownTotals" in session;
                    const title = session.name || session.firstMessage || (isParentRollup ? session.parentSessionId : session.sessionId);
                    const childCount = isParentRollup ? session.studioChildSessionCount : 0;
                    const childCost = isParentRollup ? session.studioChildTotals.cost : 0;
                    const ownCost = isParentRollup ? session.ownTotals.cost : session.totals.cost;
                    const rowTitle = isParentRollup
                      ? `own ${formatCost(ownCost)} · children ${formatCost(childCost)}${session.parentFound ? "" : " · parent not found"}`
                      : undefined;
                    return (
                      <div key={isParentRollup ? session.parentSessionId : session.sessionId} title={rowTitle} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px 90px", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", alignItems: "center" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {title}
                            </span>
                            {childCount > 0 && (
                              <span style={{ flexShrink: 0, fontSize: 10, color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)", borderRadius: 999, padding: "1px 5px" }}>
                                +{childCount} child
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                            {session.cwd}
                            {isParentRollup && childCount > 0 ? ` · children ${formatCost(childCost)} · own ${formatCost(ownCost)}` : ""}
                            {isParentRollup && !session.parentFound ? " · parent not found" : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(totalTokens(session.totals))}</span>
                        <span style={{ fontSize: 12, color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCost(session.totals.cost)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const zeroTotals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };

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

/**
 * 渲染统计指标块。
 *
 * @param props label 为指标名，value 为指标值，strong 控制高亮样式。
 * @returns 指标块 React 节点。
 */
function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: strong ? 24 : 18, lineHeight: 1.1, fontWeight: strong ? 700 : 600, color: strong ? "var(--text)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

/**
 * 渲染面板标题。
 *
 * @param props title 为左侧标题，right 为右侧辅助文本。
 * @returns 标题 React 节点。
 */
function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
      <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{title}</div>
      {right && <div style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{right}</div>}
    </div>
  );
}

/**
 * 渲染 token 类型拆分行。
 *
 * @param props totals 为 token 汇总对象。
 * @returns token 明细 React 节点。
 */
function TokenRows({ totals }: { totals: UsageTotals }) {
  const rows = [
    ["Input", totals.input],
    ["Output", totals.output],
    ["Cache read", totals.cacheRead],
  ] as const;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px 54px", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>{label}</span>
          <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={`${formatTokens(value)} tokens`}>{formatTokens(value)}</span>
          <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokensM(value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 渲染费用拆分列表。
 *
 * @param props title 为标题，rows 为带汇总数据的拆分行。
 * @returns 拆分面板 React 节点。
 */
function Breakdown({ title, rows }: { title: string; rows: { label: string; totals: UsageTotals }[] }) {
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
              <span style={{ color: "var(--text-dim)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTokens(row.totals.calls)}</span>
              <span style={{ color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCost(row.totals.cost)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 渲染空统计状态。
 *
 * @returns 空状态 React 节点。
 */
function EmptyState() {
  return <div style={{ padding: "14px 0", color: "var(--text-dim)", fontSize: 12 }}>No usage in range</div>;
}
