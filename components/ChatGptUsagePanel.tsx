"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  earliestResetCreditExpiration,
  formatGptQuotaRelativeAge,
  formatGptResetCountdown,
  GPT_QUOTA_TIER_COMPACT_LABELS,
  GPT_QUOTA_TIER_PANEL_LABELS,
  isKnownQuotaTier,
  knownQuotaTiers,
  quotaColor,
  QUOTA_TIER_LABELS,
  type CodexResetCreditDisplay,
  type QuotaDisplayTier,
} from "@/lib/quota-display";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";
import { usePrompt } from "./AppPromptProvider";
import {
  clampUsagePercent,
  projectProviderUsageWindows,
  resolveOverallProviderUsageRisk,
  resolveUsageWindowDuration,
  type ProviderUsageAggregateProjection,
  type ProviderUsageRingUnit,
  type ProviderUsageRisk,
  type ProviderUsageWindowCandidate,
} from "./ProviderUsagePanelContract";
import {
  ProviderUsageTrigger,
  type ProviderUsageDisplayMode,
} from "./ProviderUsageTrigger";

/** Standalone owns trigger+dialog; aggregate reuses detail only for the shell column. */
export type ChatGptUsagePresentation = "standalone" | "aggregate";

type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";
type ChatGptQuotaSource = "live" | "cached" | "page_fallback" | "none";

interface OAuthAccountQuotaCache {
  success: boolean;
  tiers: QuotaDisplayTier[];
  error: string | null;
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexResetCreditDisplay[];
  resetCreditsError: string | null;
}

interface OAuthAccountSummary {
  accountId: string;
  label?: string;
  extraInfo?: string;
  quotaCache?: OAuthAccountQuotaCache;
  displayName: string;
  maskedAccountId: string;
  active: boolean;
}

interface OAuthAccountsResponse {
  provider: string;
  activeAccountId: string | null;
  accounts: OAuthAccountSummary[];
  error?: string;
}

interface SubscriptionQuota {
  tool: string;
  credentialStatus: CredentialStatus;
  credentialMessage: string | null;
  success: boolean;
  tiers: QuotaDisplayTier[];
  error: string | null;
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexResetCreditDisplay[];
  resetCreditsError: string | null;
  accountId?: string | null;
}

interface SuccessfulQuotaSnapshot {
  accountId: string;
  tiers: QuotaDisplayTier[];
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexResetCreditDisplay[];
  credentialStatus: CredentialStatus;
}

interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  lockOwned: boolean;
  nextRunAt: number | null;
  lastRunStartedAt: number | null;
  lastRunFinishedAt: number | null;
  lastError: string | null;
  lastAccountId: string | null;
  lastAccountError: string | null;
  lock: {
    path: string;
    exists: boolean;
    ownedByCurrentProcess: boolean;
    stale: boolean;
    staleAfterMs: number;
    ageMs: number | null;
    error?: string;
  };
  error?: string;
}

const ACCOUNT_CACHE_POLL_INTERVAL_MS = 30_000;
const GPT_PROVIDER_ID = "openai-codex";

const SAFE_MESSAGES = {
  accountsLoadFailed: "无法加载 ChatGPT 账号列表，请稍后重试。",
  quotaFetchFailed: "无法获取额度，请检查网络后重试。",
  quotaPageFallback: "刷新失败，正在展示本页上次成功数据。",
  activateFailed: "切换 Active 账号失败，已保留当前账号。",
  activateQuotaFailed: "账号已切换，额度刷新失败。",
  resetFailed: "Reset credits 消耗失败，未更新当前额度。",
  schedulerLoadFailed: "无法读取后台自动刷新状态。",
  schedulerLastError: "最近一次后台刷新失败。",
  schedulerAccountError: "最近一次账号刷新失败。",
  repairFailed: "修复刷新锁失败，请确认没有健康进程占用后重试。",
  credentialExpired: "登录已失效，需要重新登录。",
  credentialNotFound: "未找到 OAuth 凭据，请在 Models → ChatGPT 重新登录。",
  credentialParseError: "无法读取 OAuth 凭据，请在 Models → ChatGPT 重新登录。",
} as const;

function selectActiveAccount(data: OAuthAccountsResponse): OAuthAccountSummary | null {
  return data.accounts.find((account) => account.active)
    ?? data.accounts.find((account) => account.accountId === data.activeAccountId)
    ?? null;
}

function credentialStatusMessage(status: CredentialStatus | null | undefined): string | null {
  if (status === "expired") return SAFE_MESSAGES.credentialExpired;
  if (status === "not_found") return SAFE_MESSAGES.credentialNotFound;
  if (status === "parse_error") return SAFE_MESSAGES.credentialParseError;
  return null;
}

function snapshotFromQuota(accountId: string, quota: SubscriptionQuota): SuccessfulQuotaSnapshot | null {
  if (!quota.success) return null;
  return {
    accountId,
    tiers: quota.tiers ?? [],
    queriedAt: quota.queriedAt,
    resetCreditsAvailableCount: quota.resetCreditsAvailableCount,
    resetCredits: quota.resetCredits ?? [],
    credentialStatus: quota.credentialStatus,
  };
}

function snapshotFromCache(accountId: string, cache: OAuthAccountQuotaCache | undefined): SuccessfulQuotaSnapshot | null {
  if (!cache || cache.success !== true) return null;
  return {
    accountId,
    tiers: cache.tiers ?? [],
    queriedAt: cache.queriedAt,
    resetCreditsAvailableCount: cache.resetCreditsAvailableCount,
    resetCredits: cache.resetCredits ?? [],
    credentialStatus: "valid",
  };
}

function formatSchedulerTime(value: number | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function lockStateLabel(status: SchedulerStatus): string {
  if (status.lockOwned) return "本进程持有";
  if (status.lock.stale) return "陈旧";
  if (status.lock.exists) return "被占用";
  return "无";
}

function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "muted" }) {
  const color = tone === "success"
    ? "var(--usage-dot-success, #4ade80)"
    : tone === "warning"
      ? "var(--usage-dot-warning, #fbbf24)"
      : tone === "danger"
        ? "var(--usage-dot-danger, #fb7185)"
        : "var(--usage-dot-muted, var(--text-dim))";
  return (
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow:
          tone === "success"
            ? "0 0 8px color-mix(in srgb, var(--usage-dot-success, #4ade80) 48%, transparent)"
            : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function QuotaWindowCard({ tier }: { tier: QuotaDisplayTier }) {
  const utilization = Math.min(Math.max(tier.utilization, 0), 100);
  const color = quotaColor(utilization);
  const countdown = formatGptResetCountdown(tier.resetsAt);
  const label = GPT_QUOTA_TIER_PANEL_LABELS[tier.name] ?? tier.name;

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--usage-card-bg, rgba(148,163,184,0.06))",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700 }}>{label}</div>
      <div style={{ color, fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {Math.round(utilization)}
        <small style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 500 }}>% 已使用</small>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(utilization)}
        style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}
      >
        <div style={{ height: "100%", width: `${utilization}%`, background: color, borderRadius: 99 }} />
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
        {countdown ? `重置倒计时 ${countdown}` : "重置时间未知"}
      </div>
    </div>
  );
}

/** Canonical tier name → stable ring id (display only; not sort order). */
const GPT_TIER_RING_IDS: Record<string, string> = {
  five_hour: "gpt-5h",
  seven_day: "gpt-week",
};

/**
 * Emit unordered safe GPT window candidates from actual allowlisted tiers.
 * Missing tiers are never synthesized; adapter does not assign layer index/center.
 * Accepts known five_hour/seven_day rows and any future tier whose name resolves
 * as a trusted period token via the shared duration resolver.
 */
export function buildChatGptUsageWindowCandidates(
  tiers: readonly QuotaDisplayTier[],
): ProviderUsageWindowCandidate[] {
  const candidates: ProviderUsageWindowCandidate[] = [];
  for (const tier of tiers) {
    if (!tier?.name?.trim()) continue;
    const known = isKnownQuotaTier(tier);
    const resolved = resolveUsageWindowDuration({
      durationEvidence: tier.name,
      token: tier.name,
      label: tier.name,
    });
    // Reject unknown/untrusted names — never invent windows from raw payload noise.
    if (!known && !resolved) continue;

    const percent = clampUsagePercent(
      typeof tier.utilization === "number" && Number.isFinite(tier.utilization)
        ? tier.utilization
        : null,
    );
    const panelLabel =
      GPT_QUOTA_TIER_PANEL_LABELS[tier.name]
      ?? QUOTA_TIER_LABELS[tier.name]
      ?? tier.name;
    const compactLabel =
      GPT_QUOTA_TIER_COMPACT_LABELS[tier.name]
      ?? QUOTA_TIER_LABELS[tier.name]
      ?? tier.name;
    // Prefer short ring labels for known periods (5h / 周).
    const shortLabel =
      tier.name === "five_hour"
        ? "5h"
        : tier.name === "seven_day"
          ? "7d"
          : compactLabel;
    const fullLabel = panelLabel;
    let title: string;
    if (tier.name === "five_hour") {
      title = percent === null ? "5 小时额度未知" : `5 小时已使用 ${Math.round(percent)}%`;
    } else if (tier.name === "seven_day") {
      title = percent === null ? "7 天额度未知" : `周额度已使用 ${Math.round(percent)}%`;
    } else {
      title = percent === null
        ? `${fullLabel}未知`
        : `${fullLabel}已使用 ${Math.round(percent)}%`.replace("额度已使用", "已使用");
    }
    candidates.push({
      id: GPT_TIER_RING_IDS[tier.name] ?? `gpt-${tier.name}`,
      shortLabel,
      fullLabel,
      percent,
      title,
      present: true,
      trusted: true,
      durationMs: null,
      // Canonical tier token is duration evidence for the shared resolver only.
      durationEvidence: tier.name,
    });
  }
  return candidates;
}

/**
 * Project actual GPT tiers through the shared window projector.
 * only-7d / only-5h → single ring; dual → outer shortest (5h) → inner longer (7d).
 * Adapter never pushes fixed [5h,7d] order or fabricates missing windows.
 */
export function buildChatGptUsageRingUnit(
  tiers: readonly QuotaDisplayTier[],
): ProviderUsageRingUnit | null {
  const candidates = buildChatGptUsageWindowCandidates(tiers);
  if (candidates.length === 0) return null;
  const projected = projectProviderUsageWindows(candidates, { providerLabel: "GPT" });
  return projected.ringUnit;
}

function riskFromRingUnit(unit: ProviderUsageRingUnit | null, fallbackRisk: ProviderUsageRisk): ProviderUsageRisk {
  if (!unit) return fallbackRisk;
  const tones = unit.layers.map((layer) => {
    const percent = clampUsagePercent(layer.percent);
    if (percent === null) return "muted" as const;
    if (percent >= 95) return "danger" as const;
    if (percent >= 80) return "warning" as const;
    return "normal" as const;
  });
  // Map layer tones onto aggregate risk channel (danger > warning > normal > muted).
  const risks: ProviderUsageRisk[] = tones.map((tone) => {
    if (tone === "danger") return "danger";
    if (tone === "warning") return "warning";
    if (tone === "muted") return "muted";
    return "normal";
  });
  return resolveOverallProviderUsageRisk(risks);
}

export function ChatGptUsagePanel({
  onOpenModels,
  displayMode = "full",
  presentation = "standalone",
  onAggregateProjectionChange,
}: {
  /** Optional hook so AppShell can open Models → ChatGPT without hard coupling. */
  onOpenModels?: () => void;
  /** Global top-bar density from usage.providerPanelsCompact (standalone only). */
  displayMode?: ProviderUsageDisplayMode;
  /**
   * standalone (default): own click trigger + dialog.
   * aggregate: no trigger/dialog/outside handler; detail body only for shell column.
   */
  presentation?: ChatGptUsagePresentation;
  /** Allowlisted projection for the aggregate shell; never includes secrets. */
  onAggregateProjectionChange?: (projection: ProviderUsageAggregateProjection) => void;
} = {}) {
  const { confirm } = usePrompt();
  const panelDomId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const accountsRequestGen = useRef(0);
  const quotaRequestGen = useRef(0);
  const accountsAbortRef = useRef<AbortController | null>(null);
  const quotaAbortRef = useRef<AbortController | null>(null);
  const pageSnapshotsRef = useRef<Map<string, SuccessfulQuotaSnapshot>>(new Map());
  const liveQuotaAccountIdRef = useRef<string | null>(null);

  const [open, setOpen] = useState(false);
  const escapeSuppressedRef = useRef(false);
  const [accounts, setAccounts] = useState<OAuthAccountSummary[]>([]);
  const [account, setAccount] = useState<OAuthAccountSummary | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);
  const [liveQuota, setLiveQuota] = useState<SubscriptionQuota | null>(null);
  const [liveQuotaAccountId, setLiveQuotaAccountId] = useState<string | null>(null);
  const [pageFallbackActive, setPageFallbackActive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [repairingLock, setRepairingLock] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number }>({ top: 35, right: 8 });
  const isAggregate = presentation === "aggregate";

  const rememberSnapshot = useCallback((snapshot: SuccessfulQuotaSnapshot | null) => {
    if (!snapshot) return;
    const existing = pageSnapshotsRef.current.get(snapshot.accountId);
    // Metadata may lag a just-completed manual GET; do not let it replace the newer page success.
    if (
      existing
      && typeof existing.queriedAt === "number"
      && (!snapshot.queriedAt || snapshot.queriedAt < existing.queriedAt)
    ) {
      return;
    }
    pageSnapshotsRef.current.set(snapshot.accountId, snapshot);
  }, []);

  const setLiveQuotaForAccount = useCallback((accountId: string | null, quota: SubscriptionQuota | null) => {
    liveQuotaAccountIdRef.current = accountId;
    setLiveQuotaAccountId(accountId);
    setLiveQuota(quota);
  }, []);

  const loadAccounts = useCallback(async (options?: {
    silent?: boolean;
    signal?: AbortSignal;
  }) => {
    const silent = options?.silent === true;
    const generation = ++accountsRequestGen.current;
    if (!silent) {
      setAccountsLoading(true);
      setAccountsError(null);
    }

    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(GPT_PROVIDER_ID)}`, {
        signal: options?.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse;
      if (generation !== accountsRequestGen.current) return null;
      if (!res.ok || data.error) {
        throw new Error("accounts_failed");
      }

      const nextAccounts = data.accounts ?? [];
      const nextActive = selectActiveAccount(data);
      setAccounts(nextAccounts);
      setAccount(nextActive);
      setAccountsError(null);

      // Successful metadata cache can seed the per-account page snapshot.
      for (const item of nextAccounts) {
        rememberSnapshot(snapshotFromCache(item.accountId, item.quotaCache));
      }

      // Drop live quota if Active changed out from under us.
      const currentLiveAccountId = liveQuotaAccountIdRef.current;
      if (currentLiveAccountId && nextActive?.accountId !== currentLiveAccountId) {
        setLiveQuotaForAccount(null, null);
        setPageFallbackActive(false);
        // Abort any in-flight quota that belonged to the previous Active.
        quotaAbortRef.current?.abort();
        quotaRequestGen.current += 1;
      }

      return { accounts: nextAccounts, active: nextActive };
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return null;
      if (generation !== accountsRequestGen.current) return null;
      if (!silent) {
        setAccountsError(SAFE_MESSAGES.accountsLoadFailed);
        setAccounts([]);
        setAccount(null);
      }
      return null;
    } finally {
      if (generation === accountsRequestGen.current && !silent) {
        setAccountsLoading(false);
      }
    }
  }, [rememberSnapshot, setLiveQuotaForAccount]);

  const loadSchedulerStatus = useCallback(async (signal?: AbortSignal) => {
    setSchedulerError(null);
    try {
      const res = await fetch("/api/chatgpt/usage-refresh/status", { signal, cache: "no-store" });
      const data = await res.json().catch(() => ({})) as SchedulerStatus;
      if (!res.ok || data.error) throw new Error("scheduler_failed");
      setSchedulerStatus(data);
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setSchedulerError(SAFE_MESSAGES.schedulerLoadFailed);
      setSchedulerStatus(null);
    }
  }, []);

  const loadQuota = useCallback(async (options: {
    accountId: string;
    signal?: AbortSignal;
    silent?: boolean;
  }) => {
    const { accountId, signal, silent = false } = options;
    const generation = ++quotaRequestGen.current;
    if (!silent) setRefreshing(true);

    try {
      const params = new URLSearchParams({ accountId });
      const res = await fetch(
        `/api/auth/quota/${encodeURIComponent(GPT_PROVIDER_ID)}?${params.toString()}`,
        { signal, cache: "no-store" },
      );
      const data = await res.json().catch(() => null) as SubscriptionQuota | null;
      if (generation !== quotaRequestGen.current) return null;

      if (!data || typeof data !== "object") {
        throw new Error("quota_failed");
      }

      // Ignore responses that no longer match the requested account when present.
      if (data.accountId && data.accountId !== accountId) return null;

      if (data.success) {
        const snapshot = snapshotFromQuota(accountId, data);
        rememberSnapshot(snapshot);
        setLiveQuotaForAccount(accountId, data);
        setPageFallbackActive(false);
        setActionError(null);
        setActionWarning(null);
        return data;
      }

      // Failed payload must not wipe a same-account success snapshot.
      const pageSnapshot = pageSnapshotsRef.current.get(accountId) ?? null;
      if (pageSnapshot) {
        // Preserve the failed credential state for recovery guidance while
        // rendering this account's successful page snapshot as the fallback.
        setLiveQuotaForAccount(accountId, data);
        setPageFallbackActive(true);
        setActionWarning(SAFE_MESSAGES.quotaPageFallback);
        setActionError(null);
      } else {
        setLiveQuotaForAccount(accountId, data);
        setPageFallbackActive(false);
        setActionError(credentialStatusMessage(data.credentialStatus) ?? SAFE_MESSAGES.quotaFetchFailed);
        setActionWarning(null);
      }
      return data;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return null;
      if (generation !== quotaRequestGen.current) return null;

      const pageSnapshot = pageSnapshotsRef.current.get(accountId) ?? null;
      if (pageSnapshot) {
        setLiveQuotaForAccount(null, null);
        setPageFallbackActive(true);
        setActionWarning(SAFE_MESSAGES.quotaPageFallback);
        setActionError(null);
      } else {
        setLiveQuotaForAccount(null, null);
        setPageFallbackActive(false);
        setActionError(SAFE_MESSAGES.quotaFetchFailed);
        setActionWarning(null);
      }
      return null;
    } finally {
      if (generation === quotaRequestGen.current && !silent) {
        setRefreshing(false);
      }
    }
  }, [rememberSnapshot, setLiveQuotaForAccount]);

  // Initial mount: accounts metadata only (no quota upstream).
  useEffect(() => {
    const controller = new AbortController();
    accountsAbortRef.current = controller;
    void loadAccounts({ signal: controller.signal });
    return () => {
      controller.abort();
      accountsAbortRef.current?.abort();
      quotaAbortRef.current?.abort();
      accountsRequestGen.current += 1;
      quotaRequestGen.current += 1;
    };
  }, [loadAccounts]);

  // Foreground 30s light revalidation of accounts metadata only.
  useEffect(() => {
    let controller: AbortController | null = null;
    const refreshSilently = () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      void loadAccounts({ silent: true, signal: controller.signal });
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

  // Expand (standalone only): keep existing content, re-read accounts + scheduler.
  // Aggregate detail is always mounted in the shell column; load scheduler lazily
  // only when presentation is standalone and the dialog opens (no extra secondary fetch in aggregate).
  useEffect(() => {
    if (isAggregate || !open) return;
    const controller = new AbortController();
    void loadAccounts({ silent: true, signal: controller.signal });
    void loadSchedulerStatus(controller.signal);
    return () => controller.abort();
  }, [isAggregate, open, loadAccounts, loadSchedulerStatus]);

  // Viewport-clamped fixed coordinates so the expanded panel never overflows narrow screens.
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

  // Outside click + Escape close with focus restore (standalone dialog only).
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

  const operationBusy = refreshing || resetting || activatingAccountId !== null || repairingLock;

  const handleManualRefresh = useCallback(async () => {
    if (operationBusy || !account) return;
    setActionError(null);
    setActionWarning(null);
    const controller = new AbortController();
    quotaAbortRef.current?.abort();
    quotaAbortRef.current = controller;
    await loadQuota({ accountId: account.accountId, signal: controller.signal });
    await loadAccounts({ silent: true });
  }, [account, loadAccounts, loadQuota, operationBusy]);

  const handleActivate = useCallback(async (accountId: string) => {
    if (operationBusy) return;
    setActivatingAccountId(accountId);
    setActionError(null);
    setActionWarning(null);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(GPT_PROVIDER_ID)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse;
      if (!res.ok || data.error) {
        throw new Error("activate_failed");
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
      setLiveQuotaForAccount(null, null);
      setPageFallbackActive(false);

      for (const item of nextAccounts) {
        rememberSnapshot(snapshotFromCache(item.accountId, item.quotaCache));
      }

      if (nextActive) {
        const quota = await loadQuota({
          accountId: nextActive.accountId,
          signal: controller.signal,
        });
        if (!quota || !quota.success) {
          // Activate already succeeded; do not claim rollback.
          setActionError(null);
          setActionWarning(SAFE_MESSAGES.activateQuotaFailed);
        }
      }
    } catch {
      setActionError(SAFE_MESSAGES.activateFailed);
    } finally {
      setActivatingAccountId(null);
    }
  }, [loadQuota, operationBusy, rememberSnapshot, setLiveQuotaForAccount]);

  const handleReset = useCallback(async () => {
    if (!account || operationBusy) return;
    const ok = await confirm({
      title: "确认消耗 Reset credit",
      message: "将消耗一次 Codex Reset credit 以重置额度，确认继续？",
      confirmLabel: "确认继续",
      intent: "danger",
    });
    if (!ok) return;

    setResetting(true);
    setActionError(null);
    setActionWarning(null);
    try {
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(GPT_PROVIDER_ID)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.accountId }),
      });
      const data = await res.json().catch(() => ({})) as SubscriptionQuota & { error?: string };
      if (!res.ok || !data.success) {
        throw new Error("reset_failed");
      }
      rememberSnapshot(snapshotFromQuota(account.accountId, data));
      setLiveQuotaForAccount(account.accountId, data);
      setPageFallbackActive(false);
      await loadAccounts({ silent: true });
    } catch {
      // Keep previous success data; only surface a fixed Chinese error.
      setActionError(SAFE_MESSAGES.resetFailed);
    } finally {
      setResetting(false);
    }
  }, [account, confirm, loadAccounts, operationBusy, rememberSnapshot, setLiveQuotaForAccount]);

  const handleRepairLock = useCallback(async () => {
    if (operationBusy) return;
    const ok = await confirm({
      title: "确认修复刷新锁",
      message: "风险提示：修复会删除当前 ChatGPT 自动刷新锁。如果另一个健康的 yolk pi web 进程仍在运行，可能短时间产生重复刷新。确认只在刷新器明显卡住或锁文件 stale 时继续？",
      confirmLabel: "继续修复",
      intent: "danger",
    });
    if (!ok) return;
    setRepairingLock(true);
    setSchedulerError(null);
    try {
      const res = await fetch("/api/chatgpt/usage-refresh/repair-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({})) as SchedulerStatus;
      if (!res.ok || data.error) throw new Error("repair_failed");
      setSchedulerStatus(data);
    } catch {
      setSchedulerError(SAFE_MESSAGES.repairFailed);
    } finally {
      setRepairingLock(false);
    }
  }, [confirm, operationBusy]);

  const openModels = useCallback(() => {
    // Aggregate shell closes itself before Models; standalone closes own dialog.
    if (!isAggregate) setOpen(false);
    onOpenModels?.();
  }, [isAggregate, onOpenModels]);

  const displayModel = useMemo(() => {
    const accountId = account?.accountId ?? null;
    const liveMatches = Boolean(liveQuota && liveQuotaAccountId && accountId && liveQuotaAccountId === accountId && liveQuota.success);
    const cache = account?.quotaCache;
    const cacheOk = Boolean(cache && cache.success === true);
    const pageSnapshot = accountId ? pageSnapshotsRef.current.get(accountId) ?? null : null;
    const failedCredentialStatus = liveQuota
      && liveQuotaAccountId === accountId
      && !liveQuota.success
      ? liveQuota.credentialStatus
      : null;

    let source: ChatGptQuotaSource = "none";
    let tiers: QuotaDisplayTier[] = [];
    let queriedAt: number | null = null;
    let resetCreditsAvailableCount: number | null = null;
    let resetCredits: CodexResetCreditDisplay[] = [];
    let credentialStatus: CredentialStatus | null = null;

    if (liveMatches && liveQuota) {
      source = "live";
      tiers = liveQuota.tiers ?? [];
      queriedAt = liveQuota.queriedAt;
      resetCreditsAvailableCount = liveQuota.resetCreditsAvailableCount;
      resetCredits = liveQuota.resetCredits ?? [];
      credentialStatus = liveQuota.credentialStatus;
    } else if (pageFallbackActive && pageSnapshot && accountId && pageSnapshot.accountId === accountId) {
      // A failed manual GET must keep this account's last successful page data visible,
      // even when accounts metadata still contains an older successful cache.
      source = "page_fallback";
      tiers = pageSnapshot.tiers;
      queriedAt = pageSnapshot.queriedAt;
      resetCreditsAvailableCount = pageSnapshot.resetCreditsAvailableCount;
      resetCredits = pageSnapshot.resetCredits;
      credentialStatus = pageSnapshot.credentialStatus;
    } else if (cacheOk && cache) {
      source = "cached";
      tiers = cache.tiers ?? [];
      queriedAt = cache.queriedAt;
      resetCreditsAvailableCount = cache.resetCreditsAvailableCount;
      resetCredits = cache.resetCredits ?? [];
      credentialStatus = "valid";
    } else if (pageSnapshot && accountId && pageSnapshot.accountId === accountId) {
      source = "page_fallback";
      tiers = pageSnapshot.tiers;
      queriedAt = pageSnapshot.queriedAt;
      resetCreditsAvailableCount = pageSnapshot.resetCreditsAvailableCount;
      resetCredits = pageSnapshot.resetCredits;
      credentialStatus = pageSnapshot.credentialStatus;
    } else if (liveQuota && liveQuotaAccountId === accountId && !liveQuota.success) {
      source = "none";
      credentialStatus = liveQuota.credentialStatus;
    }


    return {
      source,
      tiers: knownQuotaTiers(tiers),
      queriedAt,
      resetCreditsAvailableCount,
      resetCredits,
      // Keep the fallback cards, but do not hide an expired/missing/invalid
      // credential behind an earlier successful snapshot.
      credentialStatus: failedCredentialStatus ?? credentialStatus,
    };
  }, [account, liveQuota, liveQuotaAccountId, pageFallbackActive]);

  // Detail cards list actual displayModel.tiers; ring projection uses the same
  // tiers array via the shared candidate/projector (no fixed 5h/7d push).

  const fullStatus = useMemo(() => {
    if (refreshing) {
      return { status: "正在刷新…", tone: "muted" as const, showSpinner: true };
    }
    if (resetting) {
      return { status: "正在重置…", tone: "muted" as const, showSpinner: true };
    }
    if (activatingAccountId) {
      return { status: "正在切换…", tone: "muted" as const, showSpinner: true };
    }
    if (accountsLoading && !account) {
      return { status: "加载中", tone: "muted" as const, showSpinner: true };
    }
    if (accountsError && !account) {
      return { status: "错误", tone: "danger" as const, showSpinner: false };
    }
    if (!account) {
      return { status: "登录", tone: "muted" as const, showSpinner: false };
    }
    if (displayModel.credentialStatus && displayModel.credentialStatus !== "valid" && displayModel.source === "none") {
      return { status: "重新登录", tone: "danger" as const, showSpinner: false };
    }
    if (displayModel.source === "live") {
      return { status: "实时", tone: "success" as const, showSpinner: false };
    }
    if (displayModel.source === "cached") {
      const age = formatGptQuotaRelativeAge(displayModel.queriedAt);
      return {
        status: age ? `已缓存 · ${age}` : "已缓存",
        tone: "success" as const,
        showSpinner: false,
      };
    }
    if (displayModel.source === "page_fallback") {
      return { status: "已缓存", tone: "warning" as const, showSpinner: false };
    }
    if (actionError) {
      return { status: "错误", tone: "danger" as const, showSpinner: false };
    }
    return { status: "无缓存", tone: "muted" as const, showSpinner: false };
  }, [
    account,
    accountsError,
    accountsLoading,
    actionError,
    activatingAccountId,
    displayModel.credentialStatus,
    displayModel.queriedAt,
    displayModel.source,
    refreshing,
    resetting,
  ]);

  // Shared N-ring unit for Full / Compact / Aggregate via actual tiers → projector.
  const ringUnit = useMemo((): ProviderUsageRingUnit | null => {
    if (!account) return null;
    // Only project when at least one safe known window exists in the actual tiers.
    if (displayModel.tiers.length === 0) return null;
    return buildChatGptUsageRingUnit(displayModel.tiers);
  }, [account, displayModel.tiers]);

  const compactFallback = useMemo(() => {
    let fallback: string | null = null;
    let loading = false;

    if (refreshing || resetting || activatingAccountId || (accountsLoading && !account)) {
      loading = true;
      fallback = "加载中";
    } else if (accountsError && !account) {
      fallback = "错误";
    } else if (!account) {
      fallback = "登录";
    } else if (displayModel.credentialStatus && displayModel.credentialStatus !== "valid" && displayModel.source === "none") {
      fallback = "需登录";
    } else if (ringUnit) {
      // Normal quota: Compact uses ringUnit only — no text summary chips.
      fallback = null;
    } else if (actionError) {
      fallback = "错误";
    } else if (account) {
      fallback = "额度未知";
    }

    return { fallback, loading };
  }, [
    account,
    accountsError,
    accountsLoading,
    actionError,
    activatingAccountId,
    displayModel.credentialStatus,
    displayModel.source,
    refreshing,
    resetting,
    ringUnit,
  ]);

  const aggregateProjection = useMemo((): ProviderUsageAggregateProjection => {
    const loading =
      refreshing
      || resetting
      || Boolean(activatingAccountId)
      || (accountsLoading && !account)
      || compactFallback.loading;

    let fallback: string | null = null;
    let risk: ProviderUsageRisk = "muted";

    if (loading) {
      fallback = ringUnit ? null : "加载中";
      risk = ringUnit ? riskFromRingUnit(ringUnit, "normal") : "muted";
    } else if (accountsError && !account) {
      fallback = "错误";
      risk = "danger";
    } else if (!account) {
      fallback = "登录";
      risk = "muted";
    } else if (displayModel.credentialStatus && displayModel.credentialStatus !== "valid" && displayModel.source === "none") {
      fallback = "需登录";
      risk = "danger";
    } else if (ringUnit) {
      fallback = null;
      risk = riskFromRingUnit(ringUnit, displayModel.source === "page_fallback" ? "warning" : "normal");
      if (displayModel.source === "page_fallback" && risk === "normal") risk = "warning";
    } else if (actionError) {
      fallback = "错误";
      risk = "danger";
    } else {
      fallback = "额度未知";
      risk = "muted";
    }

    // Allowlisted projection only — never accountId / credentials / raw errors.
    return {
      key: "gpt",
      label: "GPT",
      order: 0,
      risk,
      loading,
      ringUnit,
      fallback,
      title: ringUnit?.ariaLabel ?? (fallback ? `GPT ${fallback}` : "GPT 用量"),
    };
  }, [
    account,
    accountsError,
    accountsLoading,
    actionError,
    activatingAccountId,
    compactFallback.loading,
    displayModel.credentialStatus,
    displayModel.source,
    refreshing,
    resetting,
    ringUnit,
  ]);

  useEffect(() => {
    onAggregateProjectionChange?.(aggregateProjection);
  }, [aggregateProjection, onAggregateProjectionChange]);

  const sourceLabel = (() => {
    if (refreshing) return "正在刷新…";
    if (displayModel.source === "live") return "实时";
    if (displayModel.source === "cached") {
      const age = formatGptQuotaRelativeAge(displayModel.queriedAt);
      return age ? `已缓存 · ${age}` : "已缓存";
    }
    if (displayModel.source === "page_fallback") return "本页上次成功数据";
    if (accountsLoading) return "加载中";
    return "无缓存";
  })();

  const queriedLabel = (() => {
    if (accountsLoading && displayModel.source === "none") return "正在读取…";
    if (!displayModel.queriedAt) return "从未更新";
    const age = formatGptQuotaRelativeAge(displayModel.queriedAt);
    if (age === "刚刚") return "刚刚";
    if (age) return `${age}前`;
    return "已更新";
  })();

  const credentialBanner = credentialStatusMessage(displayModel.credentialStatus);
  const needsReauth = Boolean(credentialBanner);
  const resetCreditsAvailableCount = displayModel.resetCreditsAvailableCount;
  const resetExpiresAt = earliestResetCreditExpiration(displayModel.resetCredits);
  const resetExpiresCountdown = formatGptResetCountdown(resetExpiresAt);
  const hasQuotaWindows = displayModel.tiers.length > 0;

  // Shared detail body for standalone dialog and aggregate column.
  // Aggregate does not render its own trigger/dialog/outside handler.
  const detailBody: ReactNode = (
    <>
      {!isAggregate && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>ChatGPT 用量</div>
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", color: "var(--text-dim)", fontSize: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <StatusDot
                  tone={
                    displayModel.source === "live" || displayModel.source === "cached"
                      ? "success"
                      : displayModel.source === "page_fallback"
                        ? "warning"
                        : needsReauth || actionError
                          ? "danger"
                          : "muted"
                  }
                />
                <span>{sourceLabel}</span>
              </span>
              <span>更新时间：{queriedLabel}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              disabled={operationBusy || !account || accountsLoading}
              {...iconFlowAttrs(operationBusy ? "off" : "interactive")}
              title="刷新当前 Active 账号额度"
              aria-label="刷新当前 Active ChatGPT 账号额度"
              style={{
                width: 30,
                height: 30,
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--bg)",
                color: operationBusy || !account ? "var(--text-dim)" : "var(--accent)",
                cursor: operationBusy || !account ? "default" : "pointer",
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
              aria-label="关闭 ChatGPT 用量面板"
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-dim)", fontSize: 11, minWidth: 0 }}>
            <StatusDot
              tone={
                displayModel.source === "live" || displayModel.source === "cached"
                  ? "success"
                  : displayModel.source === "page_fallback"
                    ? "warning"
                    : needsReauth || actionError
                      ? "danger"
                      : "muted"
              }
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sourceLabel} · {queriedLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            disabled={operationBusy || !account || accountsLoading}
            {...iconFlowAttrs(operationBusy ? "off" : "interactive")}
            title="刷新当前 Active 账号额度"
            aria-label="刷新当前 Active ChatGPT 账号额度"
            style={{
              width: 30,
              height: 30,
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg)",
              color: operationBusy || !account ? "var(--text-dim)" : "var(--accent)",
              cursor: operationBusy || !account ? "default" : "pointer",
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

      {(refreshing || resetting || activatingAccountId) && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
          {refreshing ? "正在刷新…" : resetting ? "正在重置…" : "正在切换…"}
        </div>
      )}

      {accountsLoading && !account ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 10,
                borderRadius: 9,
                border: "1px solid var(--border)",
                background: "var(--usage-card-bg, rgba(148,163,184,0.06))",
              }}
              aria-busy="true"
            >
              <div className="chatgpt-usage-panel__skeleton-shimmer" style={{ height: 10, width: "54%", borderRadius: 4 }} />
              <div className="chatgpt-usage-panel__skeleton-shimmer" style={{ height: 10, width: "78%", borderRadius: 4 }} />
              <div className="chatgpt-usage-panel__skeleton-shimmer" style={{ height: 72, borderRadius: 8 }} />
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>正在加载已保存账号与缓存额度…</span>
            </div>
          ) : !account ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="provider-usage-detail-card" style={{ padding: 10, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 3 }}>无 Active ChatGPT 账号</strong>
                请先在 Models → ChatGPT 登录或激活一个账号。面板不会为未登录状态伪造额度。
                {accountsError && <div style={{ marginTop: 6, color: "var(--usage-status-danger-fg, #b91c1c)" }}>{accountsError}</div>}
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
                打开 Models → ChatGPT
              </button>
            </div>
          ) : (
            <>
              <div className="provider-usage-detail-card" style={{ padding: 9, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span title={account.displayName} style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {account.displayName}
                  </span>
                  {/* Account labels and extra metadata can be user-supplied; keep usage popovers to safe display fields. */}
                  <code title={account.maskedAccountId} style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {account.maskedAccountId}
                  </code>
                </div>
                <span className="provider-usage-active-badge" style={{ fontSize: 10 }}>Active</span>
              </div>

              {needsReauth && (
                <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  <strong>需要重新登录。</strong> {credentialBanner}
                  <div style={{ marginTop: 8 }}>
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
                      }}
                    >
                      打开 Models → ChatGPT
                    </button>
                  </div>
                </div>
              )}

              {actionWarning && (
                <div className="provider-usage-status-banner" data-tone="warning" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {actionWarning}
                </div>
              )}

              {actionError && (
                <div className="provider-usage-status-banner" data-tone="danger" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {actionError}
                </div>
              )}

              {hasQuotaWindows ? (
                <div
                  className="chatgpt-usage-quota-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  {displayModel.tiers.map((tier) => (
                    <QuotaWindowCard key={tier.name} tier={tier} />
                  ))}
                </div>
              ) : !needsReauth ? (
                <div className="provider-usage-detail-card" style={{ padding: 10, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>
                  用量未知。请刷新以查询当前 Active 账号。不会以 0% 表示未知额度。
                </div>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>账号</span>
                  <span style={{ color: "var(--text-dim)", fontSize: 9, fontWeight: 600 }}>全局 Active</span>
                </div>
                <div style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(96,165,250,0.25)", background: "rgba(96,165,250,0.06)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45 }}>
                  “设为 Active”会切换全局 Active ChatGPT/Codex 账号，影响当前与新建会话的后续请求。
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
                        disabled={operationBusy}
                        style={{
                          minHeight: 30,
                          padding: "5px 9px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: activatingAccountId === item.accountId ? "var(--text-dim)" : "var(--accent)",
                          cursor: operationBusy ? "default" : "pointer",
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
                  {needsReauth ? "在 Models → ChatGPT 重新登录" : "在 Models → ChatGPT 管理"}
                </button>
                <span style={{ color: "var(--text-dim)", fontSize: 10 }}>页面可见时每 30 秒重读缓存</span>
              </div>

              {/* GPT-only secondary tools: Reset credits + backend auto-refresh. */}
              <div
                style={{
                  marginTop: 2,
                  paddingTop: 10,
                  borderTop: "1px dashed rgba(148,163,184,0.28)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>
                  GPT 专属工具
                </div>

                <div style={{ padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.05)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>
                      Reset credits{typeof resetCreditsAvailableCount === "number" ? `：${resetCreditsAvailableCount}` : ""}
                    </span>
                    {(resetCreditsAvailableCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleReset()}
                        disabled={operationBusy}
                        title={resetExpiresCountdown ? `消耗一次 Reset credit。最早过期：${resetExpiresCountdown}` : "消耗一次 Codex Reset credit"}
                        style={{
                          minHeight: 28,
                          padding: "4px 9px",
                          border: "1px solid var(--usage-status-success-border)",
                          borderRadius: 7,
                          background: "var(--bg)",
                          color: operationBusy ? "var(--text-dim)" : "var(--usage-active-fg, #15803d)",
                          cursor: operationBusy ? "default" : "pointer",
                          fontSize: 11,
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {resetting ? "正在重置…" : "使用一次"}
                      </button>
                    )}
                  </div>
                  <span style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
                    {typeof resetCreditsAvailableCount !== "number"
                      ? "暂无 Reset credits 信息。"
                      : resetCreditsAvailableCount <= 0
                        ? "当前没有可用的 Reset credit。"
                        : resetExpiresCountdown
                          ? `最早过期倒计时 ${resetExpiresCountdown}`
                          : resetExpiresAt
                            ? `最早过期 ${new Date(resetExpiresAt).toLocaleDateString()}`
                            : "有可用 Reset credit。"}
                  </span>
                </div>

                <div style={{ padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.05)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>后台自动刷新</span>
                    <button
                      type="button"
                      onClick={() => void loadSchedulerStatus()}
                      disabled={repairingLock}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "var(--bg)",
                        color: "var(--text-muted)",
                        cursor: repairingLock ? "default" : "pointer",
                        fontSize: 11,
                        padding: "4px 7px",
                      }}
                    >
                      重载
                    </button>
                  </div>
                  {schedulerError && (
                    <div style={{ color: "var(--usage-status-danger-fg, #b91c1c)", fontSize: 11, lineHeight: 1.45 }}>{schedulerError}</div>
                  )}
                  {schedulerStatus ? (
                    <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.55 }}>
                      <div>
                        启用：{schedulerStatus.enabled ? "是" : "否"}
                        {" · "}
                        运行中：{schedulerStatus.running ? "是" : "否"}
                        {" · "}
                        锁：{lockStateLabel(schedulerStatus)}
                      </div>
                      <div>
                        下次：{formatSchedulerTime(schedulerStatus.nextRunAt)}
                        {" · "}
                        上次：{formatSchedulerTime(schedulerStatus.lastRunFinishedAt)}
                      </div>
                      {schedulerStatus.lastError && (
                        <div style={{ color: "var(--usage-status-danger-fg, #b91c1c)" }}>{SAFE_MESSAGES.schedulerLastError}</div>
                      )}
                      {schedulerStatus.lastAccountError && (
                        <div style={{ color: "#fb923c" }}>{SAFE_MESSAGES.schedulerAccountError}</div>
                      )}
                    </div>
                  ) : (
                    !schedulerError && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>后台刷新状态不可用。</div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleRepairLock()}
                    disabled={operationBusy}
                    style={{
                      alignSelf: "flex-start",
                      padding: "5px 9px",
                      borderRadius: 6,
                      border: "1px solid var(--usage-status-danger-border)",
                      background: "transparent",
                      color: repairingLock ? "var(--text-dim)" : "var(--usage-status-danger-fg, #b91c1c)",
                      cursor: operationBusy ? "default" : "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {repairingLock ? "正在修复…" : "故障处理：修复刷新锁"}
                  </button>
                </div>
              </div>
            </>
          )}
    </>
  );

  if (isAggregate) {
    return (
      <div
        className="chatgpt-usage-panel chatgpt-usage-panel--aggregate"
        data-presentation="aggregate"
        style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}
      >
        <style>{`
          @media (max-width: 420px) {
            .chatgpt-usage-quota-grid { grid-template-columns: 1fr !important; }
          }
          @media (prefers-reduced-motion: reduce) {
            .chatgpt-usage-spinner { animation: none !important; border-top-color: var(--text-dim) !important; }
          }
        `}</style>
        {detailBody}
      </div>
    );
  }

  return (
    <div className="chatgpt-usage-panel" data-presentation="standalone" onMouseLeave={() => setOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }} style={{ position: "relative", display: "flex", alignItems: "center", height: "100%", flexShrink: 0 }}>
      {/* Local layout helpers; GPT-USAGE-02 may promote reduced-motion/spinner rules to globals. */}
      <style>{`
        @media (max-width: 420px) {
          .chatgpt-usage-quota-grid { grid-template-columns: 1fr !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .chatgpt-usage-spinner { animation: none !important; border-top-color: var(--text-dim) !important; }
        }
      `}</style>
      <ProviderUsageTrigger
        buttonRef={triggerRef}
        className="chatgpt-usage-panel__trigger"
        providerLabel="GPT"
        open={open}
        displayMode={displayMode}
        tone={fullStatus.tone}
        statusText={fullStatus.status}
        loading={fullStatus.showSpinner || compactFallback.loading}
        ringUnit={ringUnit}
        compactFallback={compactFallback.fallback}
        onFocus={() => { if (escapeSuppressedRef.current) { escapeSuppressedRef.current = false; return; } setOpen(true); }}
        onMouseEnter={() => { escapeSuppressedRef.current = false; setOpen(true); }}
        title={ringUnit?.ariaLabel ?? "ChatGPT 用量"}
        aria-label={ringUnit?.ariaLabel ?? "ChatGPT 用量"}
        aria-controls={panelDomId}
      />

      {open && (
        <section
          ref={panelRef}
          id={panelDomId}
          role="dialog"
          aria-label="ChatGPT 用量"
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
