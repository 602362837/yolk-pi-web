"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GrokQuotaResultV1 } from "@/lib/grok-subscription-quota";
import { ActionFlowIcon } from "./ActionFlowIcon";
import {
  formatGrokQuotaTime,
  grokCacheStateDot,
  grokCacheStateLabel,
  grokQuotaErrorMessage,
  grokUtilizationColor,
  type GrokQuotaErrorCode,
} from "./GrokQuotaView";
import { iconFlowAttrs } from "./iconFlow";
import {
  buildGrokUsageAggregateProjection,
  type GrokUsagePresentationMode,
} from "./GrokUsageProjection";
import type { ProviderUsageAggregateProjection } from "./ProviderUsagePanelContract";
import {
  ProviderUsageTrigger,
  type ProviderUsageDisplayMode,
} from "./ProviderUsageTrigger";

export {
  buildGrokUsageAggregateProjection,
  buildGrokUsageRingLayers,
  buildGrokUsageRingUnit,
  buildGrokUsageWindowCandidates,
  type GrokUsagePresentationMode,
  type GrokUsageProjectionState,
  type GrokUsageRingProjectionInput,
} from "./GrokUsageProjection";

const ACCOUNT_CACHE_POLL_INTERVAL_MS = 30_000;
const GROK_PROVIDER_ID = "grok-cli";

interface GrokOAuthAccountSummary {
  accountId: string;
  label?: string;
  extraInfo?: string;
  displayName: string;
  maskedAccountId: string;
  active: boolean;
}

interface GrokOAuthAccountsResponse {
  provider?: string;
  activeAccountId?: string | null;
  accounts?: GrokOAuthAccountSummary[];
  error?: string;
}

function isGrokQuotaResult(value: unknown): value is GrokQuotaResultV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === "grok_subscription_quota" && record.schemaVersion === 1 && typeof record.success === "boolean";
}

function selectActiveAccount(data: GrokOAuthAccountsResponse): GrokOAuthAccountSummary | null {
  const accounts = data.accounts ?? [];
  return accounts.find((account) => account.active)
    ?? accounts.find((account) => account.accountId === data.activeAccountId)
    ?? null;
}

function formatRelativeAge(ageMs: number | null | undefined, queriedAt: string | null | undefined): string | null {
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

function buildLocalNetworkError(accountId: string): GrokQuotaResultV1 {
  return {
    kind: "grok_subscription_quota",
    schemaVersion: 1,
    success: false,
    provider: "grok-cli",
    accountId,
    cache: { state: "none", queriedAt: null, ageMs: null },
    reauthRequired: false,
    error: {
      code: "network",
      message: "network_failure",
      retryable: true,
    },
  };
}

export function GrokUsagePanel({
  onOpenModels,
  displayMode = "full",
  presentationMode = "standalone",
  onProjectionChange,
}: {
  /** Optional hook so AppShell can open Models → Grok without hard coupling.
   * Pass an optional accountId to focus a specific account (e.g. reauthRequired target). */
  onOpenModels?: (options?: { accountId?: string | null }) => void;
  /** Global top-bar density from usage.providerPanelsCompact. */
  displayMode?: ProviderUsageDisplayMode;
  /**
   * standalone (default): own click trigger + dialog + outside/Escape handlers.
   * aggregate: detail body only; no self trigger/dialog/outside handler.
   */
  presentationMode?: GrokUsagePresentationMode;
  /** Emits allowlisted projection for the aggregate shell (USAGE-AGG-06). */
  onProjectionChange?: (projection: ProviderUsageAggregateProjection) => void;
} = {}) {
  const isAggregate = presentationMode === "aggregate";
  const panelDomId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const accountsRequestGen = useRef(0);
  const quotaRequestGen = useRef(0);
  const accountsAbortRef = useRef<AbortController | null>(null);
  const quotaAbortRef = useRef<AbortController | null>(null);

  const [open, setOpen] = useState(false);
  const escapeSuppressedRef = useRef(false);
  const [accounts, setAccounts] = useState<GrokOAuthAccountSummary[]>([]);
  const [account, setAccount] = useState<GrokOAuthAccountSummary | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [quota, setQuota] = useState<GrokQuotaResultV1 | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  // Viewport-clamped fixed coordinates so the expanded panel never overflows narrow screens.
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
    const url = `/api/auth/quota/${encodeURIComponent(GROK_PROVIDER_ID)}${query ? `?${query}` : ""}`;

    try {
      const res = await fetch(url, { signal: options?.signal, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (generation !== quotaRequestGen.current) return null;
      if (isGrokQuotaResult(data)) {
        // Ignore responses that no longer match the requested account when one was specified.
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
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(GROK_PROVIDER_ID)}`, {
        signal: options?.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({})) as GrokOAuthAccountsResponse;
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
            // Force refresh always shows loading; otherwise inherit accounts silent mode
            // so mount/initial loads keep the loading skeleton while poll/expand stay quiet.
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
        setAccountsError("无法加载 Grok 账号列表。请稍后重试。");
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

  // Initial mount load.
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

  // Foreground 30s light revalidation (no refresh=1).
  useEffect(() => {
    let controller: AbortController | null = null;
    const refreshSilently = () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      void loadAccounts({
        silent: true,
        signal: controller.signal,
        refreshQuota: true,
        forceQuota: false,
      });
    };

    const interval = window.setInterval(refreshSilently, ACCOUNT_CACHE_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshSilently();
    };
    window.addEventListener("focus", refreshSilently);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshSilently);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controller?.abort();
    };
  }, [loadAccounts]);

  // Revalidate on expand (standalone only; aggregate shell owns open lifecycle).
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

  // Keep the expanded panel inside the viewport (8px side gutters, width <= 100vw-16).
  useEffect(() => {
    if (isAggregate || !open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(392, Math.max(0, window.innerWidth - 16));
      // Prefer aligning the panel's right edge with the trigger, then clamp to [8, vw-8].
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
    // Topbar may scroll horizontally on narrow screens; reclamp while open.
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isAggregate, open]);

  // Outside click + Escape close (standalone only; aggregate shell owns hover/focus/Escape).
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
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(GROK_PROVIDER_ID)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({})) as GrokOAuthAccountsResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Abort any in-flight quota for the previous Active before applying new state.
      quotaAbortRef.current?.abort();
      const controller = new AbortController();
      quotaAbortRef.current = controller;

      const nextAccounts = data.accounts ?? [];
      const nextActive = selectActiveAccount(data);
      setAccounts(nextAccounts);
      setAccount(nextActive);
      setAccountsError(null);

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
      // Fail closed: keep existing Active and already-shown quota.
      setActivateError("切换全局 Active 失败，已保留当前账号。请稍后重试。");
    } finally {
      setActivatingAccountId(null);
    }
  }, [activatingAccountId, loadQuota, refreshing]);

  const openModels = useCallback((accountId?: string | null) => {
    // Close standalone dialog before Models; aggregate parent also closes via onOpenModels.
    if (!isAggregate) setOpen(false);
    onOpenModels?.({ accountId });
  }, [isAggregate, onOpenModels]);

  const fullStatus = useMemo(() => {
    if (refreshing) {
      return { status: "正在刷新…", tone: "muted" as const, showSpinner: true };
    }
    if (accountsLoading && !account && !quota) {
      return { status: "加载中", tone: "muted" as const, showSpinner: true };
    }
    if (accountsError && !account) {
      return { status: "错误", tone: "danger" as const, showSpinner: false };
    }
    if (!account) {
      return { status: "登录", tone: "muted" as const, showSpinner: false };
    }
    if (quota?.reauthRequired) {
      return { status: "重新登录", tone: "danger" as const, showSpinner: false };
    }
    if (quota?.cache.state === "stale" && quota.monthly) {
      return { status: "缓存过期", tone: "warning" as const, showSpinner: false };
    }
    if (quota && !quota.success && !quota.monthly) {
      return { status: "错误", tone: "danger" as const, showSpinner: false };
    }
    if (quota?.cache.state === "live") {
      const age = formatRelativeAge(quota.cache.ageMs, quota.cache.queriedAt);
      return {
        status: age && age !== "刚刚" ? `实时 · ${age}` : "实时",
        tone: "success" as const,
        showSpinner: false,
      };
    }
    if (quota?.cache.state === "fresh") {
      const age = formatRelativeAge(quota.cache.ageMs, quota.cache.queriedAt);
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
  }, [account, accountsError, accountsLoading, quota, quotaLoading, refreshing]);

  const aggregateProjection = useMemo(
    () => buildGrokUsageAggregateProjection({
      hasAccount: Boolean(account),
      accountsLoading,
      accountsError,
      refreshing,
      quotaLoading,
      quota,
    }),
    [account, accountsError, accountsLoading, quota, quotaLoading, refreshing],
  );

  // Publish allowlisted projection for aggregate shell consumers.
  useEffect(() => {
    onProjectionChange?.(aggregateProjection);
  }, [aggregateProjection, onProjectionChange]);

  const cacheLabel = quota ? grokCacheStateLabel(quota.cache.state) : accountsLoading ? "加载中" : "无缓存";
  const queriedLabel = (() => {
    if (accountsLoading && !quota) return "正在读取…";
    if (!quota?.cache.queriedAt) return "从未更新";
    const age = formatRelativeAge(quota.cache.ageMs, quota.cache.queriedAt);
    if (age === "刚刚") return "刚刚";
    if (age) return `${age}前`;
    return formatGrokQuotaTime(quota.cache.queriedAt);
  })();

  const hasMonthly = Boolean(quota?.monthly);
  const errorCode = (quota?.error?.code ?? null) as GrokQuotaErrorCode | null;
  const safeErrorText = errorCode
    ? grokQuotaErrorMessage(errorCode, { hasMonthly })
    : accountsError;

  const detailBody = (
    <div
      className={isAggregate ? "grok-usage-panel__detail grok-usage-panel__detail--aggregate" : "grok-usage-panel__detail"}
      style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}
    >
      {!isAggregate && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>Grok 用量</div>
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", color: "var(--text-dim)", fontSize: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: quota ? grokCacheStateDot(quota.cache.state) : "var(--text-dim)",
                  }}
                />
                <span>{quota?.reauthRequired ? "缓存过期 · 需重新登录" : cacheLabel}</span>
              </span>
              <span>更新时间：{queriedLabel}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              disabled={refreshing || Boolean(activatingAccountId) || !account || accountsLoading}
              {...iconFlowAttrs(refreshing || Boolean(activatingAccountId) ? "off" : "interactive")}
              title="强制刷新当前 Active 账号 quota"
              aria-label="刷新当前 Active Grok 账号 quota"
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
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="关闭 Grok 用量面板"
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", color: "var(--text-dim)", fontSize: 11, minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: quota ? grokCacheStateDot(quota.cache.state) : "var(--text-dim)",
                }}
              />
              <span>{quota?.reauthRequired ? "缓存过期 · 需重新登录" : cacheLabel}</span>
            </span>
            <span>更新时间：{queriedLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            disabled={refreshing || Boolean(activatingAccountId) || !account || accountsLoading}
            {...iconFlowAttrs(refreshing || Boolean(activatingAccountId) ? "off" : "interactive")}
            title="强制刷新当前 Active 账号 quota"
            aria-label="刷新当前 Active Grok 账号 quota"
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

      {accountsLoading && !account && !quota ? (
        <div className="provider-usage-detail-card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10 }} aria-busy="true">
          <div style={{ height: 10, width: "54%", borderRadius: 4, background: "rgba(148,163,184,0.18)" }} />
          <div style={{ height: 10, width: "78%", borderRadius: 4, background: "rgba(148,163,184,0.14)" }} />
          <div style={{ height: 72, borderRadius: 8, background: "rgba(148,163,184,0.10)" }} />
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>正在加载已保存账号与缓存 quota…</span>
        </div>
      ) : !account ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="provider-usage-detail-card" style={{ padding: 10, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>
            <strong style={{ display: "block", color: "var(--text)", marginBottom: 3 }}>无 Active Grok 账号</strong>
            请先在 Models → Grok 登录或激活一个账号。面板不会为未登录状态伪造额度。
            {accountsError && <div style={{ marginTop: 6, color: "var(--usage-status-danger-fg, #b91c1c)" }}>{accountsError}</div>}
          </div>
          <button
            type="button"
            onClick={() => openModels()}
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
            打开 Models → Grok
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

          {quota?.reauthRequired && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>需要重新登录。</strong> {grokQuotaErrorMessage("unauthorized")}
            </div>
          )}

          {!quota?.reauthRequired && quota?.cache.state === "stale" && hasMonthly && (
            <div className="provider-usage-status-banner" data-tone="warning" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>缓存已过期。</strong> {safeErrorText ?? "正在展示上次成功数据。"}
            </div>
          )}

          {!quota?.reauthRequired && quota && !quota.success && !hasMonthly && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              <strong>额度暂不可用。</strong> {safeErrorText ?? "请稍后重试。"}
            </div>
          )}

          {activateError && (
            <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {activateError}
            </div>
          )}

          {quota?.monthly ? (
            <div className="grok-usage-quota-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="provider-usage-detail-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700 }}>月度额度</div>
                <div style={{ color: grokUtilizationColor(quota.monthly.utilization), fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                  {quota.monthly.used.toLocaleString()} <small style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 500 }}>/ {quota.monthly.limit.toLocaleString()}</small>
                </div>
                <div
                  role="progressbar"
                  aria-label="月度额度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(Math.max(quota.monthly.utilization, 0), 100))}
                  style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
                >
                  <div style={{ height: "100%", width: `${Math.min(quota.monthly.utilization, 100)}%`, background: grokUtilizationColor(quota.monthly.utilization), borderRadius: 99 }} />
                </div>
                <div style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
                  剩余 {quota.monthly.remaining.toLocaleString()} · 重置时间 {formatGrokQuotaTime(quota.monthly.resetsAt)}
                </div>
              </div>

              {quota.weekly ? (
                <div className="provider-usage-detail-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700 }}>周额度</div>
                  <div style={{ color: grokUtilizationColor(quota.weekly.usedPercent), fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(quota.weekly.usedPercent)}<small style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 500 }}>% 已使用</small>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="周额度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(Math.min(Math.max(quota.weekly.usedPercent, 0), 100))}
                    style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
                  >
                    <div style={{ height: "100%", width: `${Math.min(quota.weekly.usedPercent, 100)}%`, background: grokUtilizationColor(quota.weekly.usedPercent), borderRadius: 99 }} />
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
                    重置时间 {formatGrokQuotaTime(quota.weekly.resetsAt)}
                  </div>
                </div>
              ) : (
                <div className="provider-usage-detail-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                  <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700 }}>周额度</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>当前 API 未提供周额度。</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>不推断为 0%、不限额或订阅权益缺失。</div>
                </div>
              )}
            </div>
          ) : !quota?.error && !quotaLoading ? (
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
              “设为 Active”会切换全局 Active Grok 账号，影响当前与新建会话的后续请求。
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
                  border: item.active ? "1px solid var(--usage-status-success-border)" : "1px solid var(--usage-panel-border, var(--border))",
                  background: item.active ? "var(--usage-status-success-bg)" : "var(--usage-card-bg, rgba(148,163,184,0.06))",
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
              onClick={() => openModels(account?.accountId)}
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
              {quota?.reauthRequired ? "在 Models → Grok 重新登录" : "在 Models → Grok 管理"}
            </button>
            <span style={{ color: "var(--text-dim)", fontSize: 10 }}>页面可见时每 30 秒刷新</span>
          </div>
        </>
      )}
    </div>
  );

  if (isAggregate) {
    return (
      <div className="grok-usage-panel grok-usage-panel--aggregate" style={{ display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
        {detailBody}
      </div>
    );
  }

  return (
    <div className="grok-usage-panel" onMouseLeave={() => setOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }} style={{ position: "relative", display: "flex", alignItems: "center", height: "100%", flexShrink: 0 }}>
      <ProviderUsageTrigger
        buttonRef={triggerRef}
        className="grok-usage-panel__trigger"
        providerLabel="Grok"
        open={open}
        displayMode={displayMode}
        tone={fullStatus.tone}
        statusText={fullStatus.status}
        loading={fullStatus.showSpinner || aggregateProjection.loading}
        ringUnit={aggregateProjection.ringUnit}
        compactFallback={aggregateProjection.fallback}
        onFocus={() => { if (escapeSuppressedRef.current) { escapeSuppressedRef.current = false; return; } setOpen(true); }}
        onMouseEnter={() => { escapeSuppressedRef.current = false; setOpen(true); }}
        title={aggregateProjection.title}
        aria-label={aggregateProjection.ringUnit?.ariaLabel ?? "Grok 用量"}
        aria-controls={panelDomId}
      />

      {open && (
        <section
          ref={panelRef}
          id={panelDomId}
          role="dialog"
          aria-label="Grok 用量"
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
