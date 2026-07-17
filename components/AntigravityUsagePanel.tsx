"use client";

/**
 * Antigravity top-bar usage panel (standalone Full/Compact + aggregate detail).
 *
 * Owns accounts/quota/race state for google-antigravity only. Projects allowlisted
 * fields into ProviderUsageTrigger / aggregate shell. Never renders GCP project
 * identifiers, tokens, refresh secrets, raw upstream errors, or a cross-model total percent.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  AntigravityQuotaErrorCode,
  AntigravityQuotaResultV1,
} from "@/lib/antigravity-subscription-quota";
import {
  ANTIGRAVITY_MULTI_MODEL_FALLBACK,
  buildAntigravityUsageAggregateProjection,
  formatAntigravityRemainingFraction,
  formatAntigravityUsedPercent,
  isSafeAntigravityModelWindow,
  projectAntigravityRingUnit,
} from "@/lib/antigravity-usage-ring";
import type {
  AntigravityQuotaGroupAggregate,
  AntigravityQuotaGroupVariant,
} from "@/lib/antigravity-quota-groups";
// Client-safe provider id. Do not import the server-only OAuth adapter module here:
// it depends on node:crypto and would be bundled into this client component.
const ANTIGRAVITY_PROVIDER_ID = "google-antigravity";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";
import type { ProviderUsageAggregateProjection } from "./ProviderUsagePanelContract";
import {
  ProviderUsageTrigger,
  type ProviderUsageDisplayMode,
  type ProviderUsageTriggerTone,
} from "./ProviderUsageTrigger";

/** Background auto revalidation floor: 5 minutes. Manual refresh still force-refreshes. */
const ACCOUNT_CACHE_POLL_INTERVAL_MS = 5 * 60_000;

/** Aggregate presentation mode for AppShell mutual exclusion. */
export type AntigravityUsagePresentation = "standalone" | "aggregate";

// Re-export pure projection helpers for tests that import from the panel.
export {
  ANTIGRAVITY_MULTI_MODEL_FALLBACK,
  ANTIGRAVITY_USAGE_ORDER,
  buildAntigravityUsageAggregateProjection,
  buildAntigravityUsageWindowCandidate,
  formatAntigravityRemainingFraction,
  formatAntigravityUsedPercent,
  isSafeAntigravityModelWindow,
  projectAntigravityRingUnit,
} from "@/lib/antigravity-usage-ring";

interface AntigravityOAuthAccountSummary {
  accountId: string;
  label?: string;
  extraInfo?: string;
  displayName: string;
  maskedAccountId: string;
  active: boolean;
}

interface AntigravityOAuthAccountsResponse {
  provider?: string;
  activeAccountId?: string | null;
  accounts?: AntigravityOAuthAccountSummary[];
  error?: string;
}

const CACHE_DOT: Record<AntigravityQuotaResultV1["cache"]["state"], string> = {
  live: "var(--usage-dot-success, #4ade80)",
  fresh: "var(--usage-dot-success, #4ade80)",
  stale: "var(--usage-dot-warning, #eab308)",
  none: "var(--usage-dot-muted, var(--text-dim))",
};

const CACHE_LABEL: Record<AntigravityQuotaResultV1["cache"]["state"], string> = {
  live: "实时",
  fresh: "缓存新鲜",
  stale: "缓存已过期",
  none: "无缓存",
};

function isAntigravityQuotaResult(value: unknown): value is AntigravityQuotaResultV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "antigravity_subscription_quota"
    && record.schemaVersion === 1
    && typeof record.success === "boolean"
  );
}

function selectActiveAccount(
  data: AntigravityOAuthAccountsResponse,
): AntigravityOAuthAccountSummary | null {
  const accounts = data.accounts ?? [];
  return accounts.find((account) => account.active)
    ?? accounts.find((account) => account.accountId === data.activeAccountId)
    ?? null;
}

function formatRelativeAge(
  ageMs: number | null | undefined,
  queriedAt: string | null | undefined,
): string | null {
  if (typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs >= 0) {
    if (ageMs < 5_000) return "刚刚";
    if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1000))} 秒`;
    if (ageMs < 3_600_000) return `${Math.max(1, Math.round(ageMs / 60_000))} 分钟`;
    if (ageMs < 86_400_000) return `${Math.max(1, Math.round(ageMs / 3_600_000))} 小时`;
    return `${Math.max(1, Math.round(ageMs / 86_400_000))} 天`;
  }
  if (!queriedAt) return null;
  const timestamp = Date.parse(queriedAt);
  if (!Number.isFinite(timestamp)) return null;
  return formatRelativeAge(Date.now() - timestamp, null);
}

function formatAntigravityQuotaTime(iso: string | null | undefined): string {
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

function antigravityUtilizationColor(pct: number): string {
  if (pct >= 95) return "var(--usage-status-danger-fg, #b91c1c)";
  if (pct >= 80) return "var(--usage-status-warning-fg, #b45309)";
  return "var(--accent)";
}

function antigravityGroupHeaderTitle(group: AntigravityQuotaGroupAggregate): string {
  const used = formatAntigravityUsedPercent(group.usedPercent);
  const remaining = formatAntigravityRemainingFraction(group.remainingFraction);
  return `${group.label}（保守）：组内变体取最紧额度 · 已用 ${used} · 剩余 ${remaining}`;
}

function AntigravityUsageGroupVariantRow({
  variant,
}: {
  variant: AntigravityQuotaGroupVariant;
}) {
  const usedKnown = Number.isFinite(variant.usedPercent);
  const remainingKnown = Number.isFinite(variant.remainingFraction);
  const color = !usedKnown
    ? "var(--text-dim)"
    : remainingKnown && variant.remainingFraction === 0
      ? "var(--usage-status-danger-fg, #b91c1c)"
      : antigravityUtilizationColor(variant.usedPercent);
  const displayLabel = variant.label?.trim() || variant.id;

  return (
    <div
      className="antigravity-usage-quota-group-variant"
      data-variant-id={variant.id}
      style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          title={displayLabel}
          style={{
            color: "var(--text-dim)",
            fontSize: 11,
            fontWeight: 600,
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
            color,
            fontSize: 12,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {formatAntigravityUsedPercent(variant.usedPercent)}
          <span style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 500 }}>
            {" "}已用 / 剩余 {formatAntigravityRemainingFraction(variant.remainingFraction)}
          </span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${displayLabel} 已使用`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(usedKnown
          ? { "aria-valuenow": Math.round(Math.min(Math.max(variant.usedPercent, 0), 100)) }
          : {})}
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
            width: usedKnown
              ? `${Math.min(Math.max(variant.usedPercent, 0), 100)}%`
              : "0%",
            background: color,
            borderRadius: 99,
          }}
        />
      </div>
      <div
        style={{
          color: "var(--text-dim)",
          fontSize: 10,
          lineHeight: 1.4,
          overflowWrap: "anywhere",
        }}
      >
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{variant.id}</code>
        {variant.resetsAt
          ? ` · 重置 ${formatAntigravityQuotaTime(variant.resetsAt)}`
          : ""}
      </div>
    </div>
  );
}

/**
 * Group-first accordion for detail body (default collapsed).
 * Conservative headers; expand shows variants only — no variant-level refresh control.
 */
function AntigravityUsageGroupAccordion({
  groups,
}: {
  groups: AntigravityQuotaGroupAggregate[];
}) {
  if (groups.length === 0) return null;

  return (
    <div
      className="antigravity-usage-quota-groups antigravity-usage-quota-grid"
      data-group-count={groups.length}
      style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
    >
      {groups.map((group) => {
        const usedKnown = Number.isFinite(group.usedPercent);
        const remainingKnown = Number.isFinite(group.remainingFraction);
        const color = remainingKnown && group.remainingFraction === 0
          ? "var(--usage-status-danger-fg, #b91c1c)"
          : usedKnown
            ? antigravityUtilizationColor(group.usedPercent)
            : "var(--text-dim)";
        const usedPct = usedKnown
          ? Math.min(Math.max(group.usedPercent, 0), 100)
          : null;
        return (
          <details
            key={group.groupId}
            className="antigravity-usage-quota-group"
            data-group-id={group.groupId}
            data-priority-ring={group.priorityRing ? "true" : "false"}
            style={{
              border: group.priorityRing
                ? "1px solid rgba(96, 165, 250, 0.4)"
                : "1px solid var(--usage-panel-border, var(--border))",
              borderRadius: 9,
              background: "var(--usage-card-bg, rgba(148, 163, 184, 0.06))",
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            <summary
              className="antigravity-usage-quota-group-summary"
              title={antigravityGroupHeaderTitle(group)}
              style={{
                cursor: "pointer",
                listStyle: "none",
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <span
                className="antigravity-usage-quota-group-heading"
                style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}
              >
                <span
                  className="antigravity-usage-quota-group-title"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {group.label}
                  <span
                    className="antigravity-usage-quota-group-badge"
                    style={{ fontWeight: 500, color: "var(--text-dim)", marginLeft: 6, fontSize: 11 }}
                  >
                    组（保守）
                  </span>
                </span>
                <span
                  className="antigravity-usage-quota-group-sub"
                  style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.35 }}
                >
                  {group.variants.length} 个变体 · 组内取最紧额度
                  {group.priorityRing ? " · 顶栏独立环" : ""}
                </span>
                <div
                  role="progressbar"
                  aria-label={`${group.label} 组已使用`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  {...(usedPct !== null ? { "aria-valuenow": Math.round(usedPct) } : {})}
                  style={{
                    marginTop: 4,
                    height: 5,
                    borderRadius: 99,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                    maxWidth: 220,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: usedPct !== null ? `${usedPct}%` : "0%",
                      background: color,
                      borderRadius: 99,
                    }}
                  />
                </div>
              </span>
              <span
                className="antigravity-usage-quota-group-meta"
                style={{
                  color,
                  fontSize: 12,
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                  textAlign: "right",
                  lineHeight: 1.35,
                }}
              >
                <span style={{ display: "block" }}>
                  已用 {formatAntigravityUsedPercent(group.usedPercent)}
                </span>
                <span
                  className="antigravity-usage-quota-group-meta-remaining"
                  style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}
                >
                  剩余 {formatAntigravityRemainingFraction(group.remainingFraction)}
                </span>
              </span>
            </summary>
            <div
              className="antigravity-usage-quota-group-variants"
              style={{
                padding: "10px 12px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minWidth: 0,
                borderTop: "1px solid var(--usage-panel-border, var(--border))",
              }}
            >
              {group.variants.map((variant) => (
                <AntigravityUsageGroupVariantRow key={variant.id} variant={variant} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function antigravityCacheStateLabel(
  state: AntigravityQuotaResultV1["cache"]["state"] | string | null | undefined,
): string {
  if (!state) return "无缓存";
  return CACHE_LABEL[state as AntigravityQuotaResultV1["cache"]["state"]] ?? String(state);
}

function antigravityCacheStateDot(
  state: AntigravityQuotaResultV1["cache"]["state"] | string | null | undefined,
): string {
  if (!state) return "var(--text-dim)";
  return CACHE_DOT[state as AntigravityQuotaResultV1["cache"]["state"]] ?? "var(--text-dim)";
}

/** Fixed Chinese error copy; never interpolates raw upstream messages. */
function antigravityQuotaErrorMessage(
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
      return "当前账号无权查询额度。请确认项目权限或在 Models → Antigravity 重新登录。";
    case "invalid_project":
      return "当前账号的 GCP 项目不可用，额度暂不可用。请在 Models → Antigravity 重新登录。";
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

function buildLocalNetworkError(accountId: string): AntigravityQuotaResultV1 {
  return {
    kind: "antigravity_subscription_quota",
    schemaVersion: 1,
    success: false,
    provider: "google-antigravity",
    accountId,
    models: [],
    cache: { state: "none", queriedAt: null, ageMs: null },
    reauthRequired: false,
    error: {
      code: "network",
      message: "network_failure",
      retryable: true,
    },
  };
}

export function AntigravityUsagePanel({
  onOpenModels,
  displayMode = "full",
  presentation = "standalone",
  onAggregateProjectionChange,
}: {
  /** Optional hook so AppShell can open Models → Antigravity without hard coupling. */
  onOpenModels?: () => void;
  /** Global top-bar density from usage.providerPanelsCompact. */
  displayMode?: ProviderUsageDisplayMode;
  /**
   * standalone (default): owns click trigger + dialog + outside handlers.
   * aggregate: no self trigger/dialog/outside handler; reuses the same detail body.
   */
  presentation?: AntigravityUsagePresentation;
  /** Aggregate shell consumes allowlisted projection only (no secrets). */
  onAggregateProjectionChange?: (projection: ProviderUsageAggregateProjection) => void;
} = {}) {
  const isAggregate = presentation === "aggregate";
  const panelDomId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const accountsRequestGen = useRef(0);
  const quotaRequestGen = useRef(0);
  const accountsAbortRef = useRef<AbortController | null>(null);
  const quotaAbortRef = useRef<AbortController | null>(null);

  const [open, setOpen] = useState(false);
  const escapeSuppressedRef = useRef(false);
  const [accounts, setAccounts] = useState<AntigravityOAuthAccountSummary[]>([]);
  const [account, setAccount] = useState<AntigravityOAuthAccountSummary | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [quota, setQuota] = useState<AntigravityQuotaResultV1 | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number }>({ top: 35, right: 8 });

  const loadQuota = useCallback(async (options?: {
    accountId?: string | null;
    force?: boolean;
    silent?: boolean;
    signal?: AbortSignal;
  }) => {
    const force = options?.force === true;
    const silent = options?.silent === true;
    const accountId = options?.accountId ?? null;
    const generation = ++quotaRequestGen.current;

    if (!silent) setQuotaLoading(true);

    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (force) params.set("refresh", "1");
    const query = params.toString();
    const url = `/api/auth/quota/${encodeURIComponent(ANTIGRAVITY_PROVIDER_ID)}${query ? `?${query}` : ""}`;

    try {
      const res = await fetch(url, { signal: options?.signal, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (generation !== quotaRequestGen.current) return null;
      if (isAntigravityQuotaResult(data)) {
        // Ignore stale responses that no longer match the requested Active account.
        if (accountId && data.accountId && data.accountId !== accountId) return null;
        setQuota(data);
        return data;
      }
      const fallback = buildLocalNetworkError(accountId ?? "");
      setQuota(fallback);
      return fallback;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return null;
      if (generation !== quotaRequestGen.current) return null;
      const fallback = buildLocalNetworkError(accountId ?? "");
      setQuota(fallback);
      return fallback;
    } finally {
      if (generation === quotaRequestGen.current && !silent) {
        setQuotaLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadAccounts = useCallback(async (options?: {
    silent?: boolean;
    signal?: AbortSignal;
    refreshQuota?: boolean;
    forceQuota?: boolean;
  }) => {
    const silent = options?.silent === true;
    const generation = ++accountsRequestGen.current;
    if (!silent) {
      setAccountsLoading(true);
      setAccountsError(null);
    }

    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(ANTIGRAVITY_PROVIDER_ID)}`, {
        signal: options?.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({})) as AntigravityOAuthAccountsResponse;
      if (generation !== accountsRequestGen.current) return null;
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const nextAccounts = data.accounts ?? [];
      const nextActive = selectActiveAccount(data);
      setAccounts(nextAccounts);
      setAccount(nextActive);
      setAccountsError(null);

      if (options?.refreshQuota !== false) {
        if (nextActive) {
          await loadQuota({
            accountId: nextActive.accountId,
            force: options?.forceQuota === true,
            silent: options?.forceQuota === true ? false : silent,
            signal: options?.signal,
          });
        } else {
          setQuota(null);
        }
      }
      return { accounts: nextAccounts, active: nextActive };
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return null;
      if (generation !== accountsRequestGen.current) return null;
      if (!silent) {
        setAccountsError("无法加载 Antigravity 账号列表。请稍后重试。");
        setAccounts([]);
        setAccount(null);
        setQuota(null);
      }
      return null;
    } finally {
      if (generation === accountsRequestGen.current && !silent) {
        setAccountsLoading(false);
      }
    }
  }, [loadQuota]);

  useEffect(() => {
    const controller = new AbortController();
    accountsAbortRef.current = controller;
    void loadAccounts({ signal: controller.signal, refreshQuota: true });
    return () => {
      controller.abort();
      accountsAbortRef.current?.abort();
      quotaAbortRef.current?.abort();
      accountsRequestGen.current += 1;
      quotaRequestGen.current += 1;
    };
  }, [loadAccounts]);

  // Foreground light revalidation only (no refresh=1). Floor is 5 minutes so
  // Antigravity is not polled aggressively; user-click forceQuota remains immediate.
  useEffect(() => {
    let controller: AbortController | null = null;
    let lastSilentAt = 0;
    const refreshSilently = (reason: "interval" | "focus" | "visible") => {
      if (document.hidden) return;
      const now = Date.now();
      // focus/visibility may fire often; still respect the 5-minute floor.
      if (reason !== "interval" && now - lastSilentAt < ACCOUNT_CACHE_POLL_INTERVAL_MS) return;
      lastSilentAt = now;
      controller?.abort();
      controller = new AbortController();
      void loadAccounts({
        silent: true,
        signal: controller.signal,
        refreshQuota: true,
        forceQuota: false,
      });
    };

    const interval = window.setInterval(() => refreshSilently("interval"), ACCOUNT_CACHE_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshSilently("visible");
    };
    const handleFocus = () => refreshSilently("focus");
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controller?.abort();
    };
  }, [loadAccounts]);

  // Aggregate never owns a self dialog; still refresh silently when mounted.
  useEffect(() => {
    if (isAggregate || !open) return;
    const controller = new AbortController();
    void loadAccounts({
      silent: true,
      signal: controller.signal,
      refreshQuota: true,
      forceQuota: false,
    });
    return () => controller.abort();
  }, [isAggregate, open, loadAccounts]);

  useEffect(() => {
    if (isAggregate || !open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(392, Math.max(0, window.innerWidth - 16));
      const preferredRight = Math.max(8, window.innerWidth - rect.right);
      const leftIfPreferred = window.innerWidth - preferredRight - width;
      const right = leftIfPreferred < 8 ? 8 : preferredRight;
      setPanelPos({
        top: Math.max(8, Math.round(rect.bottom + 5)),
        right: Math.round(right),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isAggregate, open]);

  useEffect(() => {
    if (isAggregate || !open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        escapeSuppressedRef.current = true;
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isAggregate, open]);

  const handleManualRefresh = useCallback(async () => {
    if (refreshing || activatingAccountId || !account) return;
    setRefreshing(true);
    setActivateError(null);
    const controller = new AbortController();
    quotaAbortRef.current?.abort();
    quotaAbortRef.current = controller;
    await loadQuota({
      accountId: account.accountId,
      force: true,
      silent: false,
      signal: controller.signal,
    });
    await loadAccounts({
      silent: true,
      refreshQuota: false,
    });
  }, [account, activatingAccountId, loadAccounts, loadQuota, refreshing]);

  const handleActivate = useCallback(async (accountId: string) => {
    if (activatingAccountId || refreshing) return;
    setActivatingAccountId(accountId);
    setActivateError(null);
    try {
      const res = await fetch(
        `/api/auth/accounts/${encodeURIComponent(ANTIGRAVITY_PROVIDER_ID)}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        },
      );
      const data = await res.json().catch(() => ({})) as AntigravityOAuthAccountsResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Abort in-flight quota for previous Active before applying new state.
      quotaAbortRef.current?.abort();
      const controller = new AbortController();
      quotaAbortRef.current = controller;

      const nextAccounts = data.accounts ?? [];
      const nextActive = selectActiveAccount(data);
      setAccounts(nextAccounts);
      setAccount(nextActive);
      setAccountsError(null);

      // Clear previous account quota immediately so UI cannot flash old numbers.
      setQuota(null);

      if (nextActive) {
        setRefreshing(true);
        await loadQuota({
          accountId: nextActive.accountId,
          force: true,
          silent: false,
          signal: controller.signal,
        });
      } else {
        setQuota(null);
      }
    } catch {
      setActivateError("切换全局 Active 失败，已保留当前账号。请稍后重试。");
    } finally {
      setActivatingAccountId(null);
    }
  }, [activatingAccountId, loadQuota, refreshing]);

  const openModels = useCallback(() => {
    setOpen(false);
    onOpenModels?.();
  }, [onOpenModels]);

  // Drop quota that does not match the current Active account (race guard).
  const quotaMatchesAccount = Boolean(
    account
    && quota
    && (!quota.accountId || quota.accountId === account.accountId),
  );
  const safeQuota = quotaMatchesAccount ? quota : null;
  const safeModels = useMemo(
    () => (safeQuota?.models ?? []).filter(isSafeAntigravityModelWindow),
    [safeQuota],
  );
  const hasModels = safeModels.length > 0;

  const ringProjection = useMemo(() => {
    if (!account || !safeQuota || !hasModels) {
      return {
        ringSlots: [] as ReturnType<typeof projectAntigravityRingUnit>["ringSlots"],
        ringUnit: null,
        detailOnlyModelIds: [] as string[],
        detailNote: null as string | null,
        mode: "empty" as const,
        safeModelCount: 0,
        groups: [] as ReturnType<typeof projectAntigravityRingUnit>["groups"],
      };
    }
    return projectAntigravityRingUnit(safeModels);
  }, [account, hasModels, safeModels, safeQuota]);

  const fullStatus = useMemo(() => {
    if (refreshing) {
      return { status: "正在刷新…", tone: "muted" as ProviderUsageTriggerTone, showSpinner: true };
    }
    if (accountsLoading && !account && !safeQuota) {
      return { status: "加载中", tone: "muted" as const, showSpinner: true };
    }
    if (accountsError && !account) {
      return { status: "错误", tone: "danger" as const, showSpinner: false };
    }
    if (!account) {
      return { status: "登录", tone: "muted" as const, showSpinner: false };
    }
    if (safeQuota?.reauthRequired) {
      return { status: "需重新登录", tone: "danger" as const, showSpinner: false };
    }
    if (
      safeQuota?.error?.code === "invalid_project"
      || safeQuota?.error?.code === "access_denied"
    ) {
      return { status: "不可用", tone: "danger" as const, showSpinner: false };
    }
    if (safeQuota?.cache.state === "stale" && hasModels) {
      return { status: "缓存过期", tone: "warning" as const, showSpinner: false };
    }
    if (safeQuota && !safeQuota.success && !hasModels) {
      return { status: "不可用", tone: "warning" as const, showSpinner: false };
    }
    if (
      ringProjection.ringSlots.length === 0
      && !ringProjection.ringUnit
      && ringProjection.mode === "detail-only"
      && ringProjection.safeModelCount >= 1
    ) {
      return {
        status: ANTIGRAVITY_MULTI_MODEL_FALLBACK,
        tone: "success" as const,
        showSpinner: false,
      };
    }
    if (safeQuota?.cache.state === "live") {
      const age = formatRelativeAge(safeQuota.cache.ageMs, safeQuota.cache.queriedAt);
      return {
        status: age && age !== "刚刚" ? `实时 · ${age}` : "实时",
        tone: "success" as const,
        showSpinner: false,
      };
    }
    if (safeQuota?.cache.state === "fresh") {
      const age = formatRelativeAge(safeQuota.cache.ageMs, safeQuota.cache.queriedAt);
      return {
        status: age ? `缓存新鲜 · ${age}` : "缓存新鲜",
        tone: "success" as const,
        showSpinner: false,
      };
    }
    if (quotaLoading) {
      return { status: "加载中", tone: "muted" as const, showSpinner: true };
    }
    return { status: "无缓存", tone: "muted" as const, showSpinner: false };
  }, [
    account,
    accountsError,
    accountsLoading,
    hasModels,
    quotaLoading,
    refreshing,
    ringProjection.mode,
    ringProjection.ringSlots.length,
    ringProjection.ringUnit,
    ringProjection.safeModelCount,
    safeQuota,
  ]);

  const aggregateProjection = useMemo(
    () => buildAntigravityUsageAggregateProjection({
      hasAccount: Boolean(account),
      accountsLoading,
      accountsError,
      refreshing,
      quotaLoading,
      quota: safeQuota,
    }),
    [account, accountsError, accountsLoading, quotaLoading, refreshing, safeQuota],
  );

  useEffect(() => {
    if (!isAggregate) return;
    onAggregateProjectionChange?.(aggregateProjection);
  }, [aggregateProjection, isAggregate, onAggregateProjectionChange]);

  const cacheLabel = safeQuota
    ? antigravityCacheStateLabel(safeQuota.cache.state)
    : accountsLoading
      ? "加载中"
      : "无缓存";
  const queriedLabel = (() => {
    if (accountsLoading && !safeQuota) return "正在读取…";
    if (!safeQuota?.cache.queriedAt) return "从未更新";
    const age = formatRelativeAge(safeQuota.cache.ageMs, safeQuota.cache.queriedAt);
    if (age === "刚刚") return "刚刚";
    if (age) return `${age}前`;
    return formatAntigravityQuotaTime(safeQuota.cache.queriedAt);
  })();

  const errorCode = (safeQuota?.error?.code ?? null) as AntigravityQuotaErrorCode | null;
  const safeErrorText = errorCode
    ? antigravityQuotaErrorMessage(errorCode, { hasModels })
    : accountsError;

  // Groups from the same ring projection (shared mapping/aggregation as Models).
  const quotaGroups = ringProjection.groups;

  const detailBody = (
    <>
      {!isAggregate && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>
              Antigravity 模型额度详情
            </div>
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", color: "var(--text-dim)", fontSize: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: safeQuota ? antigravityCacheStateDot(safeQuota.cache.state) : "var(--text-dim)",
                  }}
                />
                <span>{safeQuota?.reauthRequired ? "缓存过期 · 需重新登录" : cacheLabel}</span>
              </span>
              <span>更新时间：{queriedLabel}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="antigravity-usage-panel__action"
              onClick={() => void handleManualRefresh()}
              disabled={refreshing || Boolean(activatingAccountId) || !account || accountsLoading}
              {...iconFlowAttrs(refreshing || Boolean(activatingAccountId) ? "off" : "interactive")}
              title="强制刷新当前 Active 账号 quota"
              aria-label="刷新当前 Active Antigravity 账号 quota"
              style={{
                width: 30,
                height: 30,
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--bg)",
                color: refreshing || Boolean(activatingAccountId) || !account ? "var(--text-dim)" : "var(--accent)",
                cursor: refreshing || Boolean(activatingAccountId) || !account ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              <ActionFlowIcon width={14} height={14} strokeWidth={2}>
                <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
                <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
                <path d="M3 4v8h8" />
                <path d="M21 20v-8h-8" />
              </ActionFlowIcon>
            </button>
            <button
              type="button"
              className="antigravity-usage-panel__action"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="关闭 Antigravity 用量面板"
              style={{
                width: 30,
                height: 30,
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--bg)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {isAggregate && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0, color: "var(--text-dim)", fontSize: 11 }}>
            Antigravity
            {" · "}
            {safeQuota?.reauthRequired ? "缓存过期 · 需重新登录" : cacheLabel}
            {" · "}
            更新时间：{queriedLabel}
          </div>
          <button
            type="button"
            className="antigravity-usage-panel__action"
            onClick={() => void handleManualRefresh()}
            disabled={refreshing || Boolean(activatingAccountId) || !account || accountsLoading}
            {...iconFlowAttrs(refreshing || Boolean(activatingAccountId) ? "off" : "interactive")}
            title="强制刷新当前 Active 账号 quota"
            aria-label="刷新当前 Active Antigravity 账号 quota"
            style={{
              width: 30,
              height: 30,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              borderRadius: 7,
              color: refreshing || Boolean(activatingAccountId) || !account ? "var(--text-dim)" : "var(--accent)",
              cursor: refreshing || Boolean(activatingAccountId) || !account ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
            }}
          >
            <ActionFlowIcon width={14} height={14} strokeWidth={2}>
              <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
              <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
              <path d="M3 4v8h8" />
              <path d="M21 20v-8h-8" />
            </ActionFlowIcon>
          </button>
        </div>
      )}

      {refreshing && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>正在刷新…</div>
      )}

      {accountsLoading && !account && !safeQuota ? (
        <div
          className="antigravity-usage-panel__skeleton provider-usage-detail-card"
          style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10 }}
          aria-busy="true"
        >
          <div className="antigravity-usage-panel__skeleton-shimmer" style={{ height: 10, width: "54%", borderRadius: 4 }} />
          <div className="antigravity-usage-panel__skeleton-shimmer" style={{ height: 10, width: "78%", borderRadius: 4 }} />
          <div className="antigravity-usage-panel__skeleton-shimmer" style={{ height: 72, borderRadius: 8 }} />
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>正在加载已保存账号与缓存 quota…</span>
        </div>
      ) : !account ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="provider-usage-detail-card" style={{ padding: 10, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>
            <strong style={{ display: "block", color: "var(--text)", marginBottom: 3 }}>无 Active Antigravity 账号</strong>
            请先在 Models → Antigravity 登录或激活一个账号。面板不会为未登录状态伪造额度。
            {accountsError && (
              <div style={{ marginTop: 6, color: "var(--usage-status-danger-fg, #b91c1c)" }}>
                {accountsError}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={openModels}
            style={{
              minHeight: 34,
              borderRadius: 8,
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "var(--bg)",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            打开 Models → Antigravity
          </button>
        </div>
      ) : (
        <>
          <div className="provider-usage-detail-card" style={{ padding: 9, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span title={account.displayName} style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {account.displayName}
              </span>
              <code title={account.maskedAccountId} style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {account.maskedAccountId}
              </code>
            </div>
            <span className="provider-usage-active-badge" style={{ fontSize: 10 }}>Active</span>
          </div>

          {safeQuota?.reauthRequired && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>需要重新登录。</strong> {antigravityQuotaErrorMessage("unauthorized")}
            </div>
          )}

          {!safeQuota?.reauthRequired && safeQuota?.error?.code === "invalid_project" && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>项目不可用。</strong> {antigravityQuotaErrorMessage("invalid_project")}
            </div>
          )}

          {!safeQuota?.reauthRequired && safeQuota?.error?.code === "access_denied" && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>无权访问。</strong> {antigravityQuotaErrorMessage("access_denied")}
            </div>
          )}

          {!safeQuota?.reauthRequired && safeQuota?.cache.state === "stale" && hasModels && (
            <div className="provider-usage-status-banner" data-tone="warning" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>缓存已过期。</strong>{" "}
              {safeErrorText && !/re-authenticate|重新登录|authorization expired|登录已失效/i.test(safeErrorText)
                ? safeErrorText
                : "正在展示上次成功数据。可点刷新重试实时额度。"}
            </div>
          )}

          {!safeQuota?.reauthRequired
            && safeQuota
            && !safeQuota.success
            && !hasModels
            && safeQuota.error?.code !== "invalid_project"
            && safeQuota.error?.code !== "access_denied" && (
            <div className="provider-usage-status-banner" data-tone="warning" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>额度暂不可用。</strong> {safeErrorText ?? "请稍后重试。不会从本地 turn 用量臆造剩余额度。"}
            </div>
          )}

          {activateError && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {activateError}
            </div>
          )}

          {ringProjection.mode === "detail-only" && hasModels && (
            <div
              data-antigravity-detail-note="multi-model"
              className="provider-usage-status-banner"
              data-tone="detail-only"
              style={{ fontSize: 11, lineHeight: 1.45 }}
            >
              多模型额度仅在详情展示，不会求和、平均或伪造总百分比。
            </div>
          )}

          {ringProjection.detailNote && ringProjection.mode !== "detail-only" && hasModels && (
            <div
              data-antigravity-detail-note="extra-windows"
              className="provider-usage-status-banner"
              data-tone="detail-only"
              style={{ fontSize: 11, lineHeight: 1.45 }}
            >
              {ringProjection.detailNote}
            </div>
          )}

          {hasModels && safeQuota && quotaGroups.length > 0 ? (
            <AntigravityUsageGroupAccordion groups={quotaGroups} />
          ) : !safeQuota?.error && !quotaLoading ? (
            <div className="provider-usage-detail-card" style={{ padding: 10, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>
              用量未知。请刷新以查询当前 Active 账号。
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>账号</span>
              <span style={{ color: "var(--text-dim)", fontSize: 9, fontWeight: 600 }}>全局 Active</span>
            </div>
            <div style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(96,165,250,0.25)", background: "rgba(96,165,250,0.06)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45 }}>
              “设为 Active”会切换全局 Active Antigravity 账号，影响当前与新建会话的后续请求。in-flight 请求不换 Token。
            </div>
            {accounts.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>没有已保存账号。</div>
            ) : accounts.map((item) => (
              <div
                key={item.accountId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: 8,
                  borderRadius: 8,
                  border: item.active
                    ? "1px solid var(--usage-status-success-border)"
                    : "1px solid var(--usage-panel-border, var(--border))",
                  background: item.active
                    ? "var(--usage-status-success-bg)"
                    : "var(--usage-card-bg, rgba(148,163,184,0.06))",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span title={item.displayName} style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.displayName}
                  </span>
                  <code title={item.maskedAccountId} style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.maskedAccountId}
                  </code>
                </div>
                {item.active ? (
                  <span className="provider-usage-active-badge" style={{ fontSize: 11 }}>Active</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleActivate(item.accountId)}
                    disabled={Boolean(activatingAccountId) || refreshing}
                    style={{
                      minHeight: 30,
                      padding: "5px 9px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: activatingAccountId === item.accountId ? "var(--text-dim)" : "var(--accent)",
                      cursor: activatingAccountId || refreshing ? "default" : "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {activatingAccountId === item.accountId ? "正在切换…" : "设为 Active"}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", paddingTop: 2 }}>
            <button
              type="button"
              onClick={openModels}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                padding: 0,
                textAlign: "left",
              }}
            >
              {safeQuota?.reauthRequired
                ? "在 Models → Antigravity 重新登录"
                : "在 Models → Antigravity 管理"}
            </button>
            <span style={{ color: "var(--text-dim)", fontSize: 10 }}>自动刷新最少 5 分钟；点刷新可立即更新</span>
          </div>
        </>
      )}
    </>
  );

  if (isAggregate) {
    return (
      <div
        className="antigravity-usage-panel antigravity-usage-panel--aggregate"
        data-presentation="aggregate"
        style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}
      >
        {detailBody}
      </div>
    );
  }

  return (
    <div
      className="antigravity-usage-panel"
      data-presentation="standalone"
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      style={{ position: "relative", display: "flex", alignItems: "center", height: "100%", flexShrink: 0 }}
    >
      <ProviderUsageTrigger
        buttonRef={triggerRef}
        className="antigravity-usage-panel__trigger"
        providerLabel="Antigravity"
        open={open}
        displayMode={displayMode}
        tone={fullStatus.tone}
        statusText={fullStatus.status}
        loading={fullStatus.showSpinner || aggregateProjection.loading}
        ringUnit={aggregateProjection.ringUnit}
        ringUnits={aggregateProjection.ringUnits ?? null}
        compactFallback={aggregateProjection.fallback}
        onFocus={() => {
          if (escapeSuppressedRef.current) {
            escapeSuppressedRef.current = false;
            return;
          }
          setOpen(true);
        }}
        onMouseEnter={() => {
          escapeSuppressedRef.current = false;
          setOpen(true);
        }}
        title={aggregateProjection.title}
        aria-label={
          aggregateProjection.ringUnits && aggregateProjection.ringUnits.length > 1
            ? aggregateProjection.title
            : (aggregateProjection.ringUnit?.ariaLabel
              ?? aggregateProjection.ringUnits?.[0]?.ariaLabel
              ?? "Antigravity 用量")
        }
        aria-controls={panelDomId}
      />

      {open && (
        <section
          ref={panelRef}
          id={panelDomId}
          className="antigravity-usage-panel__popover"
          role="dialog"
          aria-label="Antigravity 模型额度详情"
          aria-live="polite"
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            top: panelPos.top,
            right: panelPos.right,
            zIndex: 550,
            width: "min(392px, calc(100vw - 16px))",
            maxHeight: "min(680px, calc(100vh - 80px))",
            overflow: "auto",
            border: "1px solid rgba(148,163,184,0.30)",
            borderRadius: 12,
            background: "color-mix(in srgb, var(--bg-panel) 86%, transparent)",
            boxShadow: "0 18px 45px rgba(0,0,0,0.28)",
            backdropFilter: "blur(14px)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {detailBody}
        </section>
      )}
    </div>
  );
}
