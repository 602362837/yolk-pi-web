"use client";

import type { KiroQuotaBucket, KiroQuotaResultV1 } from "@/lib/kiro-subscription-quota";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";

/** Minimal account badge fields used by the shared Kiro quota card. */
export interface KiroQuotaAccountBadge {
  displayName: string;
  maskedAccountId: string;
  active: boolean;
  label?: string;
}

export type KiroQuotaCacheState = KiroQuotaResultV1["cache"]["state"];
export type KiroQuotaErrorCode = NonNullable<KiroQuotaResultV1["error"]>["code"];

const CACHE_DOT: Record<KiroQuotaCacheState, string> = {
  live: "#4ade80",
  fresh: "#4ade80",
  stale: "#eab308",
  none: "var(--text-dim)",
};

const CACHE_LABEL: Record<KiroQuotaCacheState, string> = {
  live: "实时",
  fresh: "缓存新鲜",
  stale: "缓存已过期",
  none: "无缓存",
};

/** Fixed Chinese error copy keyed by allowlisted Kiro quota error codes. */
export function kiroQuotaErrorMessage(
  code: KiroQuotaErrorCode | undefined | null,
  options?: { hasBuckets?: boolean },
): string {
  switch (code) {
    case "network":
      return options?.hasBuckets
        ? "无法连接额度服务，正在展示上次成功数据。"
        : "无法连接额度服务，且没有可用缓存。请检查网络后重试。";
    case "rate_limited":
      return "额度服务暂时限流。请稍后重试。";
    case "unauthorized":
      return "Kiro 登录已失效，需要重新登录。";
    case "access_denied":
      return "当前账号无权查询额度，或凭证权限不足。";
    case "upstream":
      return options?.hasBuckets
        ? "额度服务暂时不可用，正在展示上次成功数据。"
        : "额度服务暂时不可用。请稍后重试。";
    case "invalid_payload":
      return "额度服务返回了无法识别的数据。请稍后重试。";
    case "unsupported_region":
      return "当前账号 Region 不受支持，无法查询 AWS GetUsageLimits 额度。";
    default:
      return options?.hasBuckets
        ? "额度刷新失败，正在展示上次成功数据。"
        : "额度暂不可用。请稍后重试。";
  }
}

export function kiroCacheStateLabel(state: KiroQuotaCacheState | string | null | undefined): string {
  if (!state) return "无缓存";
  return CACHE_LABEL[state as KiroQuotaCacheState] ?? String(state);
}

export function kiroCacheStateDot(state: KiroQuotaCacheState | string | null | undefined): string {
  if (!state) return "var(--text-dim)";
  return CACHE_DOT[state as KiroQuotaCacheState] ?? "var(--text-dim)";
}

export function formatKiroQuotaTime(iso: string | null | undefined): string {
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

export function kiroUtilizationColor(pct: number): string {
  if (!Number.isFinite(pct)) return "var(--accent)";
  if (pct >= 95) return "#ef4444";
  if (pct >= 80) return "#eab308";
  return "var(--accent)";
}

function formatAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatUtilization(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return `${Math.round(Math.min(Math.max(value, 0), 100))}%`;
}

function orderedBuckets(quota: KiroQuotaResultV1 | null): KiroQuotaBucket[] {
  if (!quota?.buckets?.length) return [];
  const buckets = [...quota.buckets];
  if (!quota.primaryBucketId) return buckets;
  const primaryIndex = buckets.findIndex((bucket) => bucket.id === quota.primaryBucketId);
  if (primaryIndex <= 0) return buckets;
  const [primary] = buckets.splice(primaryIndex, 1);
  return [primary, ...buckets];
}

/**
 * Shared Kiro subscription quota card (dynamic AWS GetUsageLimits buckets)
 * with cache, reauth, and fixed Chinese error projections. Pure presentational;
 * no network and no secret/raw payload display.
 */
export function KiroQuotaView({
  quota,
  loading,
  account,
  onRefresh,
}: {
  quota: KiroQuotaResultV1 | null;
  loading: boolean;
  account: KiroQuotaAccountBadge | null;
  onRefresh: () => void;
}) {
  if (!quota && !loading && !account) return null;

  const buckets = orderedBuckets(quota);
  const hasBuckets = buckets.length > 0;
  const safeError = quota?.error
    ? kiroQuotaErrorMessage(quota.error.code, { hasBuckets })
    : null;
  const subscriptionTitle = quota?.subscription?.title?.trim() || null;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>
            当前活跃账号额度指标 (GetUsageLimits)
          </span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {loading
              ? "正在刷新…"
              : quota?.cache.queriedAt
                ? `更新于 ${formatKiroQuotaTime(quota.cache.queriedAt)}`
                : "暂无数据"}
          </span>
          {subscriptionTitle && (
            <span title={subscriptionTitle} style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              订阅：{subscriptionTitle}
            </span>
          )}
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
          需要重新登录。{kiroQuotaErrorMessage("unauthorized")}
        </div>
      )}

      {quota?.error && !quota.reauthRequired && (!quota.success || quota.cache.state === "stale" || !hasBuckets) && safeError && (
        <div style={{ fontSize: 12, color: quota.cache.state === "stale" || hasBuckets ? "#eab308" : "#fb923c", lineHeight: 1.5, padding: "8px 10px", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 5 }}>
          {quota.cache.state === "stale" || hasBuckets
            ? "缓存已过期。"
            : quota.error.code === "unsupported_region"
              ? "额度信息不可用。"
              : "额度加载失败。"}{" "}
          {safeError}
        </div>
      )}

      {loading && !hasBuckets && (
        <div style={{ textAlign: "center", padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
          正在向 AWS 请求实时额度数据...
        </div>
      )}

      {!loading && !hasBuckets && !quota?.reauthRequired && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          额度暂不可用。账号管理与对话仍可继续使用；不会把未知数值显示为 0%。
        </div>
      )}

      {buckets.map((bucket) => {
        const utilization = Number.isFinite(bucket.utilization) ? bucket.utilization : null;
        const color = utilization === null ? "var(--accent)" : kiroUtilizationColor(utilization);
        const unit = bucket.unit?.trim() ? ` ${bucket.unit}` : "";
        const isPrimary = quota?.primaryBucketId === bucket.id;
        return (
          <div key={bucket.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {bucket.label}{isPrimary ? " · 主额度" : ""}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color, flexShrink: 0 }}>
                {formatAmount(bucket.used)}
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>
                  {" "}/ {formatAmount(bucket.limit)}{unit}
                </span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={bucket.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={utilization === null ? undefined : Math.round(Math.min(Math.max(utilization, 0), 100))}
              style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
            >
              <div style={{ height: "100%", width: utilization === null ? "0%" : `${Math.min(Math.max(utilization, 0), 100)}%`, background: color, borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
              剩余 {formatAmount(bucket.remaining)}{unit}
              {" · "}使用率 {formatUtilization(utilization)}
              {" · "}重置于 {formatKiroQuotaTime(bucket.resetsAt)}
            </div>
          </div>
        );
      })}

      {quota && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: kiroCacheStateDot(quota.cache.state), flexShrink: 0 }} aria-hidden="true" />
          <span>
            {kiroCacheStateLabel(quota.cache.state)}
            {quota.cache.ageMs !== null ? ` · ${Math.round(quota.cache.ageMs / 1000)} 秒前` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
