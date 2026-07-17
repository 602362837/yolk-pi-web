"use client";

import type {
  AntigravityQuotaModelWindow,
  AntigravityQuotaResultV1,
} from "@/lib/antigravity-subscription-quota";
import {
  groupByAntigravityQuotaWindows,
  type AntigravityQuotaGroupAggregate,
  type AntigravityQuotaGroupVariant,
} from "@/lib/antigravity-quota-groups";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";

/** Minimal account badge fields used by the Antigravity quota card. */
export interface AntigravityQuotaAccountBadge {
  displayName: string;
  maskedAccountId: string;
  active: boolean;
  label?: string;
}

export type AntigravityQuotaCacheState = AntigravityQuotaResultV1["cache"]["state"];
export type AntigravityQuotaErrorCode = NonNullable<AntigravityQuotaResultV1["error"]>["code"];

const CACHE_DOT: Record<AntigravityQuotaCacheState, string> = {
  live: "#4ade80",
  fresh: "#4ade80",
  stale: "#eab308",
  none: "var(--text-dim)",
};

const CACHE_LABEL: Record<AntigravityQuotaCacheState, string> = {
  live: "实时",
  fresh: "缓存新鲜",
  stale: "缓存已过期",
  none: "无缓存",
};

/**
 * Fixed Chinese error copy keyed by allowlisted Antigravity quota error codes.
 * Never surface raw upstream bodies, projectId, tokens, or paths.
 */
export function antigravityQuotaErrorMessage(
  code: AntigravityQuotaErrorCode | undefined | null,
  options?: { hasModels?: boolean },
): string {
  switch (code) {
    case "network":
      return options?.hasModels
        ? "无法连接额度服务，正在展示上次成功数据。"
        : "无法连接额度服务，且没有可用缓存。请检查网络后重试。";
    case "rate_limited":
      return "额度服务暂时限流。请稍后重试。";
    case "unauthorized":
      return "Antigravity 登录已失效，需要重新登录。";
    case "access_denied":
      return "当前账号无权查询额度，或凭证权限不足。";
    case "invalid_project":
      return "当前账号的 Google Cloud Code 项目不可用或无访问权限。请重新登录授权。";
    case "upstream":
      return options?.hasModels
        ? "额度服务暂时不可用，正在展示上次成功数据。"
        : "额度服务暂时不可用。请稍后重试。";
    case "invalid_payload":
      return "额度服务返回了无法识别的数据。请稍后重试。";
    default:
      return options?.hasModels
        ? "额度刷新失败，正在展示上次成功数据。"
        : "额度暂不可用。请稍后重试。";
  }
}

export function antigravityCacheStateLabel(
  state: AntigravityQuotaCacheState | string | null | undefined,
): string {
  if (!state) return "无缓存";
  return CACHE_LABEL[state as AntigravityQuotaCacheState] ?? String(state);
}

export function antigravityCacheStateDot(
  state: AntigravityQuotaCacheState | string | null | undefined,
): string {
  if (!state) return "var(--text-dim)";
  return CACHE_DOT[state as AntigravityQuotaCacheState] ?? "var(--text-dim)";
}

export function formatAntigravityQuotaTime(iso: string | null | undefined): string {
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

export function antigravityUtilizationColor(pct: number): string {
  if (!Number.isFinite(pct)) return "var(--accent)";
  if (pct >= 95) return "#ef4444";
  if (pct >= 80) return "#eab308";
  return "var(--accent)";
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return `${Math.round(Math.min(Math.max(value, 0), 100))}%`;
}

function formatRemainingPercent(remainingFraction: number | null | undefined): string {
  if (typeof remainingFraction !== "number" || !Number.isFinite(remainingFraction)) return "未知";
  return formatPercent(remainingFraction * 100);
}

/**
 * Raw windows for grouping. Filtering/safety is owned by
 * `groupByAntigravityQuotaWindows` (shared with top-bar UsagePanel).
 */
function rawModels(quota: AntigravityQuotaResultV1 | null): AntigravityQuotaModelWindow[] {
  if (!quota?.models?.length) return [];
  return quota.models.filter(
    (model) => model && typeof model.id === "string" && model.id.trim().length > 0,
  );
}

function groupHeaderTitle(group: AntigravityQuotaGroupAggregate): string {
  return `${group.label}（保守）：组内变体取最紧额度 · 已用 ${formatPercent(group.usedPercent)} · 剩余 ${formatRemainingPercent(group.remainingFraction)}`;
}

function GroupVariantRow({ variant }: { variant: AntigravityQuotaGroupVariant }) {
  const used = Number.isFinite(variant.usedPercent) ? variant.usedPercent : null;
  const remaining = Number.isFinite(variant.remainingFraction) ? variant.remainingFraction : null;
  const color = used === null
    ? "var(--accent)"
    : remaining === 0
      ? "#ef4444"
      : antigravityUtilizationColor(used);
  const publicIds = Array.isArray(variant.publicModelIds)
    ? variant.publicModelIds.filter((id) => typeof id === "string" && id.trim()).slice(0, 8)
    : [];
  const displayLabel = variant.label?.trim() || variant.id;

  return (
    <div
      className="antigravity-quota-group-variant"
      data-variant-id={variant.id}
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span
          title={displayLabel}
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            fontWeight: 500,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayLabel}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color,
            flexShrink: 0,
          }}
        >
          使用率 {formatPercent(used)}
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>
            {" "}/ 剩余 {formatRemainingPercent(remaining)}
          </span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={displayLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used === null ? undefined : Math.round(Math.min(Math.max(used, 0), 100))}
        style={{
          height: 5,
          borderRadius: 99,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: used === null ? "0%" : `${Math.min(Math.max(used, 0), 100)}%`,
            background: color,
            borderRadius: 99,
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{variant.id}</code>
        {" · 安全重置时间："}
        {formatAntigravityQuotaTime(variant.resetsAt)}
        {publicIds.length > 0 ? ` · 模型：${publicIds.join(", ")}` : ""}
      </div>
    </div>
  );
}

function QuotaGroupAccordion({ groups }: { groups: AntigravityQuotaGroupAggregate[] }) {
  if (groups.length === 0) return null;

  return (
    <div
      className="antigravity-quota-groups"
      data-group-count={groups.length}
      style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
    >
      {groups.map((group) => {
        const used = group.usedPercent;
        const remaining = group.remainingFraction;
        const color = remaining === 0
          ? "#ef4444"
          : antigravityUtilizationColor(used);
        return (
          <details
            key={group.groupId}
            className="antigravity-quota-group"
            data-group-id={group.groupId}
            data-priority-ring={group.priorityRing ? "true" : "false"}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            <summary
              className="antigravity-quota-group-summary"
              title={groupHeaderTitle(group)}
              style={{
                cursor: "pointer",
                listStyle: "none",
                padding: "8px 10px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {group.label}
                  <span style={{ fontWeight: 400, color: "var(--text-dim)", marginLeft: 6 }}>
                    · 保守聚合
                  </span>
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                  {group.variants.length} 个变体 · 组内取最紧额度
                </span>
              </span>
              <span
                className="antigravity-quota-group-meta"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color,
                  flexShrink: 0,
                  textAlign: "right",
                }}
              >
                已用 {formatPercent(used)}
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>
                  {" "}/ 剩余 {formatRemainingPercent(remaining)}
                </span>
              </span>
            </summary>
            <div
              className="antigravity-quota-group-variants"
              style={{
                padding: "0 10px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minWidth: 0,
              }}
            >
              {group.variants.map((variant) => (
                <GroupVariantRow key={variant.id} variant={variant} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/**
 * Shared Antigravity per-model quota card (fetchAvailableModels windows)
 * grouped by fixed 0.3.0 quotaKey→group mapping with conservative headers.
 * Pure presentational; no network and no secret/raw payload display.
 * Never renders a cross-model total/average; never forges duration from reset.
 */
export function AntigravityQuotaView({
  quota,
  loading,
  account,
  onRefresh,
}: {
  quota: AntigravityQuotaResultV1 | null;
  loading: boolean;
  account: AntigravityQuotaAccountBadge | null;
  onRefresh: () => void;
}) {
  if (!quota && !loading && !account) return null;

  // Pure grouping via shared helpers (same as top-bar); no second mapping table.
  const groups = groupByAntigravityQuotaWindows(rawModels(quota));
  const hasModels = groups.length > 0;
  const safeError = quota?.error
    ? antigravityQuotaErrorMessage(quota.error.code, { hasModels })
    : null;
  const isInvalidProject = quota?.error?.code === "invalid_project";
  const isAccessDenied = quota?.error?.code === "access_denied";

  return (
    <div
      className="antigravity-quota-view"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-panel)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>
            Antigravity 额度指标 (fetchAvailableModels)
          </span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {loading
              ? "正在刷新…"
              : quota?.cache.queriedAt
                ? `更新于 ${formatAntigravityQuotaTime(quota.cache.queriedAt)}`
                : "暂无数据"}
          </span>
          <span style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.4 }}>
            按固定模型组折叠展示；组头为保守聚合（max 已用 / min 剩余）。不求和、不平均，不把 reset 时间当作 duration。
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
          <strong style={{ fontWeight: 700 }}>账号凭证登录失效</strong>
          <div>{antigravityQuotaErrorMessage("unauthorized")}</div>
        </div>
      )}

      {!quota?.reauthRequired && isInvalidProject && (
        <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5, padding: "8px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 5 }}>
          <strong style={{ fontWeight: 700 }}>项目验证失败 / 无访问权限</strong>
          <div>{antigravityQuotaErrorMessage("invalid_project")}</div>
        </div>
      )}

      {!quota?.reauthRequired && isAccessDenied && !isInvalidProject && (
        <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5, padding: "8px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 5 }}>
          <strong style={{ fontWeight: 700 }}>额度访问被拒绝</strong>
          <div>{antigravityQuotaErrorMessage("access_denied")}</div>
        </div>
      )}

      {quota?.error && !quota.reauthRequired && !isInvalidProject && !isAccessDenied && (!quota.success || quota.cache.state === "stale" || !hasModels) && safeError && (
        <div style={{ fontSize: 12, color: quota.cache.state === "stale" || hasModels ? "#eab308" : "#fb923c", lineHeight: 1.5, padding: "8px 10px", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 5 }}>
          {quota.cache.state === "stale" || hasModels
            ? "缓存已过期。"
            : "额度加载失败。"}{" "}
          {safeError}
        </div>
      )}

      {loading && !hasModels && (
        <div style={{ textAlign: "center", padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
          正在连接 Google 鉴权与配额网关…
        </div>
      )}

      {!loading && !hasModels && !quota?.reauthRequired && !isInvalidProject && !isAccessDenied && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          额度暂不可用。账号管理与对话仍可继续使用；不会把未知数值显示为 0%，也不会伪造跨模型总额度。
        </div>
      )}

      {hasModels && <QuotaGroupAccordion groups={groups} />}

      {quota && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: antigravityCacheStateDot(quota.cache.state), flexShrink: 0 }} aria-hidden="true" />
          <span>
            {antigravityCacheStateLabel(quota.cache.state)}
            {quota.cache.ageMs !== null ? ` · ${Math.round(quota.cache.ageMs / 1000)} 秒前` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
