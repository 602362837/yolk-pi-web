"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KiroQuotaBucket, KiroQuotaErrorCode, KiroQuotaResultV1 } from "@/lib/kiro-subscription-quota";
import { formatTokensCompact } from "@/lib/token-format";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";
import {
  ProviderUsageTrigger,
  type ProviderUsageCompactSummary,
  type ProviderUsageDisplayMode,
  type ProviderUsageRingItem,
  type ProviderUsageTriggerTone,
} from "./ProviderUsageTrigger";

const ACCOUNT_CACHE_POLL_INTERVAL_MS = 30_000;
const KIRO_PROVIDER_ID = "kiro";

interface KiroOAuthAccountSummary {
  accountId: string;
  label?: string;
  extraInfo?: string;
  displayName: string;
  maskedAccountId: string;
  active: boolean;
}

interface KiroOAuthAccountsResponse {
  provider?: string;
  activeAccountId?: string | null;
  accounts?: KiroOAuthAccountSummary[];
  error?: string;
}

const CACHE_DOT: Record<KiroQuotaResultV1["cache"]["state"], string> = {
  live: "#4ade80",
  fresh: "#4ade80",
  stale: "#eab308",
  none: "var(--text-dim)",
};

const CACHE_LABEL: Record<KiroQuotaResultV1["cache"]["state"], string> = {
  live: "实时",
  fresh: "缓存新鲜",
  stale: "缓存已过期",
  none: "无缓存",
};

function isKiroQuotaResult(value: unknown): value is KiroQuotaResultV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === "kiro_subscription_quota" && record.schemaVersion === 1 && typeof record.success === "boolean";
}

function selectActiveAccount(data: KiroOAuthAccountsResponse): KiroOAuthAccountSummary | null {
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

function formatKiroQuotaTime(iso: string | null | undefined): string {
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

function kiroUtilizationColor(pct: number): string {
  if (pct >= 95) return "#ef4444";
  if (pct >= 80) return "#eab308";
  return "var(--accent)";
}

function kiroCacheStateLabel(state: KiroQuotaResultV1["cache"]["state"] | string | null | undefined): string {
  if (!state) return "无缓存";
  return CACHE_LABEL[state as KiroQuotaResultV1["cache"]["state"]] ?? String(state);
}

function kiroCacheStateDot(state: KiroQuotaResultV1["cache"]["state"] | string | null | undefined): string {
  if (!state) return "var(--text-dim)";
  return CACHE_DOT[state as KiroQuotaResultV1["cache"]["state"]] ?? "var(--text-dim)";
}

/** Fixed Chinese error copy; never interpolates raw upstream messages. */
function kiroQuotaErrorMessage(
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
      return "当前账号无权查询额度。请确认订阅或在 Models → Kiro 重新登录。";
    case "unsupported_region":
      return "当前账号 region 不受支持，额度暂不可用。";
    case "upstream":
      return options?.hasBuckets
        ? "额度服务暂时不可用，正在展示上次成功数据。"
        : "额度服务暂时不可用。请稍后重试。";
    case "invalid_payload":
      return "额度服务返回了无法识别的数据。请稍后重试。";
    default:
      return options?.hasBuckets
        ? "额度刷新失败，正在展示上次成功数据。"
        : "额度暂不可用。请稍后重试。";
  }
}

function formatKiroRemaining(value: number, unit?: string): string {
  if (!Number.isFinite(value) || value < 0) return "未知";
  // Credits/usage volumes can be large; reuse compact token-style formatting for M/k.
  const compact = value >= 1_000 ? formatTokensCompact(value) : Math.round(value).toLocaleString();
  if (unit && unit.trim() && unit.trim().toLowerCase() !== "credit" && unit.trim().toLowerCase() !== "credits") {
    return `${compact} ${unit.trim()}`;
  }
  return compact;
}

function selectPrimaryBucket(quota: KiroQuotaResultV1 | null): KiroQuotaBucket | null {
  if (!quota || quota.buckets.length === 0) return null;
  if (quota.primaryBucketId) {
    const primary = quota.buckets.find((bucket) => bucket.id === quota.primaryBucketId);
    if (primary) return primary;
  }
  return quota.buckets.find((bucket) => bucket.resourceType === "CREDIT") ?? quota.buckets[0] ?? null;
}

function buildLocalNetworkError(accountId: string): KiroQuotaResultV1 {
  return {
    kind: "kiro_subscription_quota",
    schemaVersion: 1,
    success: false,
    provider: "kiro",
    accountId,
    buckets: [],
    cache: { state: "none", queriedAt: null, ageMs: null },
    reauthRequired: false,
    error: {
      code: "network",
      message: "network_failure",
      retryable: true,
    },
  };
}

export function KiroUsagePanel({
  onOpenModels,
  displayMode = "full",
}: {
  /** Optional hook so AppShell can open Models → Kiro without hard coupling. */
  onOpenModels?: () => void;
  /** Global top-bar density from usage.providerPanelsCompact. */
  displayMode?: ProviderUsageDisplayMode;
} = {}) {
  const panelDomId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const accountsRequestGen = useRef(0);
  const quotaRequestGen = useRef(0);
  const accountsAbortRef = useRef<AbortController | null>(null);
  const quotaAbortRef = useRef<AbortController | null>(null);

  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<KiroOAuthAccountSummary[]>([]);
  const [account, setAccount] = useState<KiroOAuthAccountSummary | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [quota, setQuota] = useState<KiroQuotaResultV1 | null>(null);
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
    const url = `/api/auth/quota/${encodeURIComponent(KIRO_PROVIDER_ID)}${query ? `?${query}` : ""}`;

    try {
      const res = await fetch(url, { signal: options?.signal, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (generation !== quotaRequestGen.current) return null;
      if (isKiroQuotaResult(data)) {
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
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(KIRO_PROVIDER_ID)}`, {
        signal: options?.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({})) as KiroOAuthAccountsResponse;
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
        setAccountsError("无法加载 Kiro 账号列表。请稍后重试。");
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

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadAccounts({
      silent: true,
      signal: controller.signal,
      refreshQuota: true,
      forceQuota: false,
    });
    return () => controller.abort();
  }, [open, loadAccounts]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(KIRO_PROVIDER_ID)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({})) as KiroOAuthAccountsResponse;
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
  const safePrimary = useMemo(() => selectPrimaryBucket(safeQuota), [safeQuota]);
  const hasBuckets = Boolean(safeQuota && safeQuota.buckets.length > 0);

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
    if (safeQuota?.cache.state === "stale" && hasBuckets) {
      return { status: "缓存过期", tone: "warning" as const, showSpinner: false };
    }
    if (safeQuota && !safeQuota.success && !hasBuckets) {
      return { status: "不可用", tone: "warning" as const, showSpinner: false };
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
  }, [account, accountsError, accountsLoading, hasBuckets, quotaLoading, refreshing, safeQuota]);

  const compactProjection = useMemo(() => {
    const summaries: ProviderUsageCompactSummary[] = [];
    let fallback: string | null = null;
    let loading = false;

    if (refreshing || (accountsLoading && !account && !safeQuota) || (quotaLoading && !safePrimary)) {
      loading = true;
      fallback = "加载中";
    } else if (accountsError && !account) {
      fallback = "错误";
    } else if (!account) {
      fallback = "登录";
    } else if (safeQuota?.reauthRequired) {
      fallback = "需登录";
    } else if (safeQuota && !safeQuota.success && !hasBuckets) {
      fallback = "不可用";
    } else if (safeQuota?.cache.state === "stale" && hasBuckets) {
      // Prototype compact stale: short status only (fail-closed for auto switch elsewhere).
      fallback = "已缓存";
    } else if (safePrimary) {
      summaries.push({
        label: "剩余",
        value: formatKiroRemaining(safePrimary.remaining, safePrimary.unit),
        title: `${safePrimary.label} 剩余 ${formatKiroRemaining(safePrimary.remaining, safePrimary.unit)}`,
      });
    } else if (account) {
      fallback = "额度未知";
    }

    return { summaries, fallback, loading };
  }, [account, accountsError, accountsLoading, hasBuckets, quotaLoading, refreshing, safePrimary, safeQuota]);

  const rings = useMemo((): ProviderUsageRingItem[] => {
    if (!account || !safePrimary) {
      return [{
        percent: null,
        label: "额度",
        title: account ? "Kiro 额度未知" : "未登录",
      }];
    }
    return [{
      percent: safePrimary.utilization,
      label: safePrimary.resourceType === "CREDIT" ? "Credit" : (safePrimary.label || "额度"),
      title: `${safePrimary.label} 已使用 ${Math.round(safePrimary.utilization)}% · 剩余 ${formatKiroRemaining(safePrimary.remaining, safePrimary.unit)}`,
      color: kiroUtilizationColor(safePrimary.utilization),
    }];
  }, [account, safePrimary]);

  const cacheLabel = safeQuota
    ? kiroCacheStateLabel(safeQuota.cache.state)
    : accountsLoading
      ? "加载中"
      : "无缓存";
  const queriedLabel = (() => {
    if (accountsLoading && !safeQuota) return "正在读取…";
    if (!safeQuota?.cache.queriedAt) return "从未更新";
    const age = formatRelativeAge(safeQuota.cache.ageMs, safeQuota.cache.queriedAt);
    if (age === "刚刚") return "刚刚";
    if (age) return `${age}前`;
    return formatKiroQuotaTime(safeQuota.cache.queriedAt);
  })();

  const errorCode = (safeQuota?.error?.code ?? null) as KiroQuotaErrorCode | null;
  const safeErrorText = errorCode
    ? kiroQuotaErrorMessage(errorCode, { hasBuckets })
    : accountsError;

  const subscriptionTitle = safeQuota?.subscription?.title?.trim() || null;

  return (
    <div
      className="kiro-usage-panel"
      style={{ position: "relative", display: "flex", alignItems: "center", height: "100%", flexShrink: 0 }}
    >
      <ProviderUsageTrigger
        buttonRef={triggerRef}
        className="kiro-usage-panel__trigger"
        providerLabel="Kiro"
        open={open}
        displayMode={displayMode}
        tone={fullStatus.tone}
        statusText={fullStatus.status}
        loading={fullStatus.showSpinner || compactProjection.loading}
        rings={rings}
        compactSummaries={compactProjection.summaries}
        compactFallback={compactProjection.fallback}
        onClick={() => setOpen((value) => !value)}
        title="Kiro 用量"
        aria-label="Kiro 用量"
        aria-controls={panelDomId}
      />

      {open && (
        <section
          ref={panelRef}
          id={panelDomId}
          className="kiro-usage-panel__popover"
          role="dialog"
          aria-label="Kiro 用量"
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
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>
                {subscriptionTitle ? `Kiro · ${subscriptionTitle}` : "Kiro 用量"}
              </div>
              <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", color: "var(--text-dim)", fontSize: 11 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: safeQuota ? kiroCacheStateDot(safeQuota.cache.state) : "var(--text-dim)",
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
                className="kiro-usage-panel__action"
                onClick={() => void handleManualRefresh()}
                disabled={refreshing || Boolean(activatingAccountId) || !account || accountsLoading}
                {...iconFlowAttrs(refreshing || Boolean(activatingAccountId) ? "off" : "interactive")}
                title="强制刷新当前 Active 账号 quota"
                aria-label="刷新当前 Active Kiro 账号 quota"
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
                className="kiro-usage-panel__action"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="关闭 Kiro 用量面板"
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

          {refreshing && (
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>正在刷新…</div>
          )}

          {accountsLoading && !account && !safeQuota ? (
            <div
              className="kiro-usage-panel__skeleton"
              style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.06)" }}
              aria-busy="true"
            >
              <div className="kiro-usage-panel__skeleton-shimmer" style={{ height: 10, width: "54%", borderRadius: 4 }} />
              <div className="kiro-usage-panel__skeleton-shimmer" style={{ height: 10, width: "78%", borderRadius: 4 }} />
              <div className="kiro-usage-panel__skeleton-shimmer" style={{ height: 72, borderRadius: 8 }} />
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>正在加载已保存账号与缓存 quota…</span>
            </div>
          ) : !account ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.06)", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 3 }}>无 Active Kiro 账号</strong>
                请先在 Models → Kiro 登录或激活一个账号。面板不会为未登录状态伪造额度。
                {accountsError && <div style={{ marginTop: 6, color: "#f87171" }}>{accountsError}</div>}
              </div>
              <button
                type="button"
                onClick={openModels}
                style={{
                  minHeight: 34,
                  borderRadius: 8,
                  border: "1px solid var(--accent)",
                  background: "var(--accent)",
                  color: "#0b1220",
                  cursor: "pointer",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                打开 Models → Kiro
              </button>
            </div>
          ) : (
            <>
              <div style={{ padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.08)", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span title={account.displayName} style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {account.displayName}
                  </span>
                  <code title={account.maskedAccountId} style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {account.maskedAccountId}{account.label ? ` · ${account.label}` : ""}
                  </code>
                </div>
                <span style={{ color: "#22c55e", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>Active</span>
              </div>

              {safeQuota?.reauthRequired && (
                <div style={{ padding: 9, borderRadius: 9, border: "1px solid rgba(239,68,68,0.22)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 12, lineHeight: 1.5 }}>
                  <strong>需要重新登录。</strong> {kiroQuotaErrorMessage("unauthorized")}
                </div>
              )}

              {!safeQuota?.reauthRequired && safeQuota?.cache.state === "stale" && hasBuckets && (
                <div style={{ padding: 9, borderRadius: 9, border: "1px solid rgba(251,191,36,0.28)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12, lineHeight: 1.5 }}>
                  <strong>缓存已过期。</strong> {safeErrorText ?? "正在展示上次成功数据。"}
                </div>
              )}

              {!safeQuota?.reauthRequired && safeQuota && !safeQuota.success && !hasBuckets && (
                <div style={{ padding: 9, borderRadius: 9, border: "1px solid rgba(251,191,36,0.28)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12, lineHeight: 1.5 }}>
                  <strong>额度暂不可用。</strong> {safeErrorText ?? "请稍后重试。不会从本地 turn 用量臆造剩余额度。"}
                </div>
              )}

              {activateError && (
                <div style={{ padding: 9, borderRadius: 9, border: "1px solid rgba(239,68,68,0.22)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 12, lineHeight: 1.5 }}>
                  {activateError}
                </div>
              )}

              {hasBuckets && safeQuota ? (
                <div className="kiro-usage-quota-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {safeQuota.buckets.map((bucket) => (
                    <div
                      key={bucket.id}
                      style={{
                        padding: 10,
                        borderRadius: 9,
                        border: bucket.id === safePrimary?.id ? "1px solid rgba(96,165,250,0.40)" : "1px solid var(--border)",
                        background: "rgba(148,163,184,0.06)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        minWidth: 0,
                      }}
                    >
                      <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700 }}>
                        {bucket.label}{bucket.id === safePrimary?.id ? " · 主额度" : ""}
                      </div>
                      <div style={{ color: kiroUtilizationColor(bucket.utilization), fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                        {Number.isFinite(bucket.used) ? bucket.used.toLocaleString() : "—"}{" "}
                        <small style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 500 }}>
                          / {Number.isFinite(bucket.limit) && bucket.limit > 0 ? bucket.limit.toLocaleString() : "—"}
                        </small>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={bucket.label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(Math.min(Math.max(bucket.utilization, 0), 100))}
                        style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
                      >
                        <div style={{ height: "100%", width: `${Math.min(Math.max(bucket.utilization, 0), 100)}%`, background: kiroUtilizationColor(bucket.utilization), borderRadius: 99 }} />
                      </div>
                      <div style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
                        剩余 {formatKiroRemaining(bucket.remaining, bucket.unit)}
                        {bucket.resetsAt ? ` · 重置 ${formatKiroQuotaTime(bucket.resetsAt)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              ) : !safeQuota?.error && !quotaLoading ? (
                <div style={{ padding: 10, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.06)", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>
                  用量未知。请刷新以查询当前 Active 账号。
                </div>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>账号</span>
                  <span style={{ color: "var(--text-dim)", fontSize: 9, fontWeight: 600 }}>全局 Active</span>
                </div>
                <div style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(96,165,250,0.25)", background: "rgba(96,165,250,0.06)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45 }}>
                  “设为 Active”会切换全局 Active Kiro 账号，影响当前与新建会话的后续请求。in-flight 请求不换 Token。
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
                      border: item.active ? "1px solid rgba(34,197,94,0.45)" : "1px solid var(--border)",
                      background: item.active ? "rgba(34,197,94,0.08)" : "rgba(148,163,184,0.06)",
                    }}
                  >
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span title={item.displayName} style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.displayName}
                      </span>
                      <code title={item.maskedAccountId} style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.maskedAccountId}{item.label ? ` · ${item.label}` : ""}
                      </code>
                    </div>
                    {item.active ? (
                      <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 800 }}>Active</span>
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
                  {safeQuota?.reauthRequired ? "在 Models → Kiro 重新登录" : "在 Models → Kiro 管理"}
                </button>
                <span style={{ color: "var(--text-dim)", fontSize: 10 }}>页面可见时每 30 秒刷新</span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
