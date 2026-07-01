"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { earliestResetCreditExpiration, formatQuotaQueriedAt, formatResetCountdown, knownQuotaTiers, quotaColor, QUOTA_TIER_LABELS, type CodexResetCreditDisplay, type QuotaDisplayTier } from "@/lib/quota-display";

type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";

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

function UsagePie({ tier, label, size = 18 }: { tier: QuotaDisplayTier | null; label?: string; size?: number }) {
  const utilization = tier ? Math.min(Math.max(tier.utilization, 0), 100) : 0;
  const color = tier ? quotaColor(utilization) : "var(--text-dim)";
  const background = tier
    ? `conic-gradient(${color} ${utilization * 3.6}deg, rgba(148,163,184,0.18) 0deg)`
    : "conic-gradient(rgba(148,163,184,0.25) 0deg, rgba(148,163,184,0.25) 360deg)";

  return (
    <span title={tier ? `${label ?? tier.name} ${Math.round(utilization)}% used` : "Unknown usage"} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ width: size, height: size, borderRadius: "50%", background, border: "1px solid rgba(148,163,184,0.35)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
        <span style={{ width: Math.max(6, Math.floor(size * 0.48)), height: Math.max(6, Math.floor(size * 0.48)), borderRadius: "50%", background: "var(--bg-panel)", opacity: 0.92 }} />
      </span>
      {label && <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 700 }}>{label}</span>}
    </span>
  );
}

function selectActiveAccount(data: OAuthAccountsResponse): OAuthAccountSummary | null {
  return data.accounts.find((account) => account.active) ?? data.accounts.find((account) => account.accountId === data.activeAccountId) ?? null;
}

function accountQuotaSummary(account: OAuthAccountSummary): string {
  const cache = account.quotaCache;
  if (!cache?.queriedAt) return "No quota cache";
  if (cache.error) return cache.error;
  const resetCreditsText = typeof cache.resetCreditsAvailableCount === "number" ? `Credits ${cache.resetCreditsAvailableCount}` : null;
  const tiers = knownQuotaTiers(cache.tiers ?? []);
  if (tiers.length === 0) return resetCreditsText ? `${formatQuotaQueriedAt(cache.queriedAt)} · ${resetCreditsText}` : formatQuotaQueriedAt(cache.queriedAt);
  const tiersText = tiers.map((tier) => `${QUOTA_TIER_LABELS[tier.name]} ${Math.round(tier.utilization)}%`).join(" · ");
  return resetCreditsText ? `${tiersText} · ${resetCreditsText}` : tiersText;
}

function formatTime(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function ChatGptUsagePanel() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<OAuthAccountSummary | null>(null);
  const [accounts, setAccounts] = useState<OAuthAccountSummary[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);
  const [quotaResult, setQuotaResult] = useState<SubscriptionQuota | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [repairingLock, setRepairingLock] = useState(false);

  const loadAccounts = useCallback(async (signal?: AbortSignal, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setAccountsLoading(true);
      setAccountsError(null);
    }
    try {
      const res = await fetch("/api/auth/accounts/openai-codex", { signal });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccountsError(null);
      setAccounts(data.accounts ?? []);
      setAccount(selectActiveAccount(data));
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      if (!silent) {
        setAccountsError(error instanceof Error ? error.message : String(error));
        setAccounts([]);
        setAccount(null);
      }
    } finally {
      if (!silent) setAccountsLoading(false);
    }
  }, []);

  const loadSchedulerStatus = useCallback(async (signal?: AbortSignal) => {
    setSchedulerError(null);
    try {
      const res = await fetch("/api/chatgpt/usage-refresh/status", { signal });
      const data = await res.json().catch(() => ({})) as SchedulerStatus;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSchedulerStatus(data);
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setSchedulerError(error instanceof Error ? error.message : String(error));
      setSchedulerStatus(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccounts(controller.signal);
    return () => controller.abort();
  }, [loadAccounts]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const refreshSilently = () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      void loadAccounts(controller.signal, { silent: true });
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
    void loadAccounts(controller.signal);
    void loadSchedulerStatus(controller.signal);
    return () => controller.abort();
  }, [open, loadAccounts, loadSchedulerStatus]);

  const refreshQuota = useCallback(async () => {
    if (resetting) return;
    setRefreshing(true);
    setQuotaResult(null);
    try {
      const res = await fetch("/api/auth/quota/openai-codex");
      const data = await res.json() as SubscriptionQuota;
      setQuotaResult(data);
      await loadAccounts();
    } catch (error) {
      setQuotaResult({
        tool: "openai-codex",
        credentialStatus: "valid",
        credentialMessage: error instanceof Error ? error.message : String(error),
        success: false,
        tiers: [],
        error: error instanceof Error ? error.message : "Usage query failed",
        queriedAt: Date.now(),
        resetCreditsAvailableCount: null,
        resetCredits: [],
        resetCreditsError: null,
      });
    } finally {
      setRefreshing(false);
    }
  }, [loadAccounts, resetting]);

  const resetQuota = useCallback(async () => {
    if (!account || resetting) return;
    const ok = window.confirm("将消耗一次 Codex 重置机会，确认继续？");
    if (!ok) return;

    setResetting(true);
    setQuotaResult(null);
    try {
      const res = await fetch("/api/auth/quota/openai-codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.accountId }),
      });
      const data = await res.json().catch(() => ({})) as SubscriptionQuota & { error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? data.credentialMessage ?? `HTTP ${res.status}`);
      setQuotaResult(data);
      await loadAccounts();
    } catch (error) {
      setQuotaResult({
        tool: "openai-codex",
        credentialStatus: "valid",
        credentialMessage: error instanceof Error ? error.message : String(error),
        success: false,
        tiers: [],
        error: error instanceof Error ? error.message : "Reset failed",
        queriedAt: Date.now(),
        resetCreditsAvailableCount: null,
        resetCredits: [],
        resetCreditsError: null,
      });
    } finally {
      setResetting(false);
    }
  }, [account, loadAccounts, resetting]);

  const activateAccount = useCallback(async (accountId: string) => {
    setActivatingAccountId(accountId);
    setAccountsError(null);
    try {
      const res = await fetch("/api/auth/accounts/openai-codex/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setAccount(selectActiveAccount(data));
      setQuotaResult(null);
    } catch (error) {
      setAccountsError(error instanceof Error ? error.message : String(error));
    } finally {
      setActivatingAccountId(null);
    }
  }, []);

  const repairLock = useCallback(async () => {
    const ok = window.confirm("风险提示：修复会删除当前 ChatGPT 自动刷新锁。如果另一个健康的 yolk pi web 进程仍在运行，可能短时间产生重复刷新。确认只在刷新器明显卡住或锁文件 stale 时继续？");
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
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSchedulerStatus(data);
    } catch (error) {
      setSchedulerError(error instanceof Error ? error.message : String(error));
    } finally {
      setRepairingLock(false);
    }
  }, []);

  const quotaCache = account?.quotaCache ?? null;
  const displayedQuota = quotaResult?.success ? quotaResult : quotaCache;
  const knownTiers = useMemo(() => knownQuotaTiers(displayedQuota?.tiers ?? []), [displayedQuota?.tiers]);
  const refreshText = displayedQuota?.queriedAt ? formatQuotaQueriedAt(displayedQuota.queriedAt) : "Unknown";
  const compactStatus = accountsLoading ? "Loading" : accountsError ? "Error" : !account ? "No account" : displayedQuota?.error ? "Error" : refreshText;
  const resetCreditsAvailableCount = displayedQuota?.resetCreditsAvailableCount ?? null;
  const resetCredits = displayedQuota?.resetCredits ?? [];
  const resetCreditsError = displayedQuota?.resetCreditsError ?? null;
  const resetExpiresAt = earliestResetCreditExpiration(resetCredits);
  const resetExpiresCountdown = formatResetCountdown(resetExpiresAt);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", height: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="ChatGPT usage"
        aria-label="ChatGPT usage"
        aria-expanded={open}
        style={{
          height: 26,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 9px",
          borderRadius: 999,
          border: "1px solid rgba(148,163,184,0.28)",
          background: "rgba(15,23,42,0.10)",
          backdropFilter: "blur(10px)",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--text)" }}>GPT</span>
        <span>{compactStatus}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {knownTiers.length > 0 ? knownTiers.map((tier) => (
            <UsagePie key={tier.name} tier={tier} label={QUOTA_TIER_LABELS[tier.name]} />
          )) : <UsagePie tier={null} />}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 31,
            right: 0,
            zIndex: 550,
            width: 380,
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
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>ChatGPT usage</div>
              <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11 }}>Updated: {refreshText}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {account && (resetCreditsAvailableCount ?? 0) > 0 && (
                <button type="button" onClick={resetQuota} disabled={refreshing || resetting} title={resetExpiresCountdown ? `Consumes one reset credit. Earliest expires in ${resetExpiresCountdown}` : "Consumes one Codex reset credit"} style={{ height: 30, padding: "0 9px", border: "1px solid rgba(34,197,94,0.45)", borderRadius: 7, background: "var(--bg)", color: refreshing || resetting ? "var(--text-dim)" : "#22c55e", cursor: refreshing || resetting ? "default" : "pointer", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                  {resetting ? "Resetting…" : "Reset limit"}
                </button>
              )}
              <button type="button" onClick={refreshQuota} disabled={refreshing || resetting} title="Refresh active account usage" aria-label="Refresh active account usage" style={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: refreshing || resetting ? "var(--text-dim)" : "var(--accent)", cursor: refreshing || resetting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" /><path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" /><path d="M3 4v8h8" /><path d="M21 20v-8h-8" /></svg>
              </button>
            </div>
          </div>

          {accountsLoading ? <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading cached accounts…</div> : accountsError ? <div style={{ color: "#f87171", fontSize: 12, lineHeight: 1.45 }}>{accountsError}</div> : !account ? <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>No active ChatGPT/Codex saved account. Add or activate one in Models.</div> : (
            <>
              <div style={{ padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.08)", display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span>
                  <span style={{ color: "#22c55e", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>Active</span>
                </div>
                <code style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{account.maskedAccountId}</code>
                {account.label && <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>备注：{account.label}</div>}
                {account.extraInfo && <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{account.extraInfo}</div>}
              </div>

              {quotaResult && !quotaResult.success && <div style={{ color: quotaResult.credentialStatus === "expired" ? "#fb923c" : "#f87171", fontSize: 12, lineHeight: 1.45 }}>{quotaResult.error ?? quotaResult.credentialMessage ?? "Usage query failed."}</div>}
              {quotaCache?.error && <div style={{ color: "#fb923c", fontSize: 12, lineHeight: 1.45 }}>{quotaCache.error}</div>}
              {resetCreditsAvailableCount !== null && (
                <div style={{ padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.08)", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>Reset credits: {resetCreditsAvailableCount}</span>
                  <span style={{ color: resetCreditsError ? "#fb923c" : "var(--text-dim)", fontSize: 10, lineHeight: 1.4 }}>
                    {resetCreditsError ? resetCreditsError : resetExpiresCountdown ? `Earliest expires in ${resetExpiresCountdown}` : resetExpiresAt ? `Earliest expires ${new Date(resetExpiresAt).toLocaleDateString()}` : "No credit expiration details"}
                  </span>
                </div>
              )}

              {knownTiers.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 9, background: "rgba(148,163,184,0.08)", border: "1px solid var(--border)" }}>
                  <UsagePie tier={null} size={34} />
                  <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>Usage unknown. Click refresh to query the active account.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {knownTiers.map((tier) => {
                    const utilization = Math.min(Math.max(tier.utilization, 0), 100);
                    const color = quotaColor(utilization);
                    const countdown = formatResetCountdown(tier.resetsAt);
                    return (
                      <div key={tier.name} style={{ display: "grid", gridTemplateColumns: "42px 1fr auto", alignItems: "center", gap: 10, padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.08)" }}>
                        <UsagePie tier={tier} label={QUOTA_TIER_LABELS[tier.name]} size={30} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>{QUOTA_TIER_LABELS[tier.name]} window</span>
                          <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{countdown ? `Resets in ${countdown}` : "Reset time unknown"}</span>
                        </div>
                        <span style={{ color, fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{Math.round(utilization)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
            <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>Accounts</div>
            {accounts.length === 0 && !accountsLoading ? <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No saved accounts.</div> : accounts.map((item) => (
              <div key={item.accountId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 8, borderRadius: 8, border: item.active ? "1px solid rgba(34,197,94,0.45)" : "1px solid var(--border)", background: item.active ? "rgba(34,197,94,0.08)" : "rgba(148,163,184,0.06)" }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.displayName}</span>
                  <code style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.maskedAccountId}</code>
                  <span style={{ color: item.quotaCache?.error ? "#fb923c" : "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountQuotaSummary(item)}</span>
                </div>
                {item.active ? <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 800 }}>active</span> : (
                  <button type="button" onClick={() => void activateAccount(item.accountId)} disabled={Boolean(activatingAccountId)} style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: activatingAccountId === item.accountId ? "var(--text-dim)" : "var(--accent)", cursor: activatingAccountId ? "default" : "pointer", fontSize: 11, fontWeight: 700 }}>
                    {activatingAccountId === item.accountId ? "Switching…" : "Activate"}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ padding: 9, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(148,163,184,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>Auto refresh</span>
              <button type="button" onClick={() => void loadSchedulerStatus()} style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, padding: "4px 7px" }}>Reload</button>
            </div>
            {schedulerError && <div style={{ color: "#f87171", fontSize: 11, lineHeight: 1.45 }}>{schedulerError}</div>}
            {schedulerStatus ? (
              <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.55 }}>
                <div>Enabled: {schedulerStatus.enabled ? "yes" : "no"} · Running: {schedulerStatus.running ? "yes" : "no"} · Lock: {schedulerStatus.lockOwned ? "owned" : schedulerStatus.lock.stale ? "stale" : schedulerStatus.lock.exists ? "held" : "none"}</div>
                <div>Next: {formatTime(schedulerStatus.nextRunAt)} · Last: {formatTime(schedulerStatus.lastRunFinishedAt)}</div>
                {schedulerStatus.lastError && <div style={{ color: "#f87171" }}>Last error: {schedulerStatus.lastError}</div>}
                {schedulerStatus.lastAccountError && <div style={{ color: "#fb923c" }}>Account error: {schedulerStatus.lastAccountError}</div>}
              </div>
            ) : <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Scheduler status unavailable.</div>}
            <button type="button" onClick={() => void repairLock()} disabled={repairingLock} style={{ alignSelf: "flex-start", padding: "5px 9px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.35)", background: "transparent", color: repairingLock ? "var(--text-dim)" : "#f87171", cursor: repairingLock ? "default" : "pointer", fontSize: 11, fontWeight: 700 }}>
              {repairingLock ? "Repairing…" : "故障处理：修复刷新锁"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
