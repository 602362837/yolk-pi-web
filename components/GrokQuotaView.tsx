"use client";

import type { GrokQuotaResultV1 } from "@/lib/grok-subscription-quota";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";

/** Minimal account badge fields used by the shared Grok quota card. */
export interface GrokQuotaAccountBadge {
  displayName: string;
  maskedAccountId: string;
  active: boolean;
  label?: string;
}

export type GrokQuotaCacheState = GrokQuotaResultV1["cache"]["state"];
export type GrokQuotaErrorCode = NonNullable<GrokQuotaResultV1["error"]>["code"];

const CACHE_DOT: Record<GrokQuotaCacheState, string> = {
  live: "var(--usage-dot-success, #4ade80)",
  fresh: "var(--usage-dot-success, #4ade80)",
  stale: "var(--usage-dot-warning, #eab308)",
  none: "var(--usage-dot-muted, var(--text-dim))",
};

const CACHE_LABEL: Record<GrokQuotaCacheState, string> = {
  live: "实时",
  fresh: "缓存新鲜",
  stale: "缓存已过期",
  none: "无缓存",
};

/** Fixed Chinese error copy keyed by allowlisted Grok quota error codes. */
export function grokQuotaErrorMessage(code: GrokQuotaErrorCode | undefined | null, options?: { hasMonthly?: boolean }): string {
  switch (code) {
    case "network":
      return options?.hasMonthly
        ? "无法连接额度服务，正在展示上次成功数据。"
        : "无法连接额度服务，且没有可用缓存。请检查网络后重试。";
    case "rate_limited":
      return "额度服务暂时限流。请稍后重试。";
    case "unauthorized":
      return "Grok 登录已失效，需要重新登录。";
    case "upstream":
      return options?.hasMonthly
        ? "额度服务暂时不可用，正在展示上次成功数据。"
        : "额度服务暂时不可用。请稍后重试。";
    case "invalid_payload":
      return "额度服务返回了无法识别的数据。请稍后重试。";
    default:
      return options?.hasMonthly
        ? "额度刷新失败，正在展示上次成功数据。"
        : "额度暂不可用。请稍后重试。";
  }
}

export function grokCacheStateLabel(state: GrokQuotaCacheState | string | null | undefined): string {
  if (!state) return "无缓存";
  return CACHE_LABEL[state as GrokQuotaCacheState] ?? String(state);
}

export function grokCacheStateDot(state: GrokQuotaCacheState | string | null | undefined): string {
  if (!state) return "var(--text-dim)";
  return CACHE_DOT[state as GrokQuotaCacheState] ?? "var(--text-dim)";
}

export function formatGrokQuotaTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function grokUtilizationColor(pct: number): string {
  if (pct >= 95) return "var(--usage-status-danger-fg, #b91c1c)";
  if (pct >= 80) return "var(--usage-status-warning-fg, #b45309)";
  return "var(--accent)";
}

/**
 * Shared Grok subscription quota card (monthly + optional weekly) with cache,
 * reauth, and fixed Chinese error projections. Pure presentational; no network.
 */
export function GrokQuotaView({
  quota,
  loading,
  account,
  onRefresh,
}: {
  quota: GrokQuotaResultV1 | null;
  loading: boolean;
  account: GrokQuotaAccountBadge | null;
  onRefresh: () => void;
}) {
  if (!quota && !loading && !account) return null;

  const hasMonthly = Boolean(quota?.monthly);
  const safeError = quota?.error
    ? grokQuotaErrorMessage(quota.error.code, { hasMonthly })
    : null;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>用量</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {loading ? "正在刷新…" : quota?.cache.queriedAt ? `更新于 ${formatGrokQuotaTime(quota.cache.queriedAt)}` : "暂无数据"}
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          {...iconFlowAttrs(loading ? "off" : "interactive")}
          title="强制刷新额度"
          aria-label="强制刷新额度"
          style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: loading ? "var(--text-dim)" : "var(--text-muted)", cursor: loading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
        >
          <ActionFlowIcon width={14} height={14} strokeWidth={2}>
            <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
            <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
            <path d="M3 4v8h8" />
            <path d="M21 20v-8h-8" />
          </ActionFlowIcon>
        </button>
      </div>

      {account && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: account.active ? "#4ade80" : "var(--border)", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span title={account.displayName} style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span>
            <span title={account.maskedAccountId} style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.maskedAccountId}</span>
          </div>
          <span style={{ fontSize: 11, color: account.active ? "#4ade80" : "var(--text-dim)", fontWeight: 600, flexShrink: 0 }}>
            {account.active ? "Active / 全局当前" : ""}
          </span>
        </div>
      )}

      {quota?.reauthRequired && (
        <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5, padding: "8px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 5 }}>
          需要重新登录。{grokQuotaErrorMessage("unauthorized")}
        </div>
      )}

      {quota?.error && !quota.reauthRequired && (!quota.success || quota.cache.state === "stale") && safeError && (
        <div style={{ fontSize: 12, color: quota.cache.state === "stale" || hasMonthly ? "#eab308" : "#fb923c", lineHeight: 1.5, padding: "8px 10px", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 5 }}>
          {quota.cache.state === "stale" || hasMonthly ? "缓存已过期。" : "额度加载失败。"} {safeError}
        </div>
      )}

      {quota?.monthly && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}>月度使用额度</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: grokUtilizationColor(quota.monthly.utilization) }}>
                {quota.monthly.used} <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>/ {quota.monthly.limit} 次</span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="月度使用额度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(Math.max(quota.monthly.utilization, 0), 100))}
              style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
            >
              <div style={{ height: "100%", width: `${Math.min(quota.monthly.utilization, 100)}%`, background: grokUtilizationColor(quota.monthly.utilization), borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {quota.monthly.remaining} 剩余 · 重置于 {formatGrokQuotaTime(quota.monthly.resetsAt)}
            </div>
          </div>

          {quota.weekly ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}>周额度使用率</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: quota.weekly.usedPercent > 80 ? "#eab308" : "var(--accent)" }}>
                  {Math.round(quota.weekly.usedPercent)}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="周额度使用率"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(Math.max(quota.weekly.usedPercent, 0), 100))}
                style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
              >
                <div style={{ height: "100%", width: `${Math.min(quota.weekly.usedPercent, 100)}%`, background: quota.weekly.usedPercent > 80 ? "#eab308" : "var(--accent)", borderRadius: 99 }} />
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>重置于 {formatGrokQuotaTime(quota.weekly.resetsAt)}</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-dim)", opacity: 0.7 }}>
              当前 API 未提供周额度。
            </div>
          )}
        </>
      )}

      {quota && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: grokCacheStateDot(quota.cache.state), flexShrink: 0 }} aria-hidden="true" />
          <span>
            {grokCacheStateLabel(quota.cache.state)}
            {quota.cache.ageMs !== null ? ` · ${Math.round(quota.cache.ageMs / 1000)} 秒前` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
