"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatQuotaQueriedAt, formatResetCountdown, knownQuotaTiers, quotaColor, QUOTA_TIER_LABELS, type QuotaDisplayTier } from "@/lib/quota-display";

type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";

interface OAuthAccountQuotaCache {
  success: boolean;
  tiers: QuotaDisplayTier[];
  error: string | null;
  queriedAt: number | null;
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
}

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

export function ChatGptUsagePanel() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<OAuthAccountSummary | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [quotaResult, setQuotaResult] = useState<SubscriptionQuota | null>(null);

  const loadAccounts = useCallback(async (signal?: AbortSignal) => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const res = await fetch("/api/auth/accounts/openai-codex", { signal });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccount(selectActiveAccount(data));
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setAccountsError(error instanceof Error ? error.message : String(error));
      setAccount(null);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccounts(controller.signal);
    return () => controller.abort();
  }, [loadAccounts]);

  const refreshQuota = useCallback(async () => {
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
      });
    } finally {
      setRefreshing(false);
    }
  }, [loadAccounts]);

  const quotaCache = account?.quotaCache ?? null;
  const knownTiers = useMemo(() => knownQuotaTiers(quotaCache?.tiers ?? []), [quotaCache?.tiers]);
  const refreshText = quotaCache?.queriedAt ? formatQuotaQueriedAt(quotaCache.queriedAt) : "Unknown";
  const compactStatus = accountsLoading ? "Loading" : accountsError ? "Error" : !account ? "No account" : quotaCache?.error ? "Error" : refreshText;

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
            width: 310,
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
            <button
              type="button"
              onClick={refreshQuota}
              disabled={refreshing}
              title="Refresh usage"
              aria-label="Refresh usage"
              style={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: refreshing ? "var(--text-dim)" : "var(--accent)", cursor: refreshing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
                <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
                <path d="M3 4v8h8" />
                <path d="M21 20v-8h-8" />
              </svg>
            </button>
          </div>

          {accountsLoading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading cached account…</div>
          ) : accountsError ? (
            <div style={{ color: "#f87171", fontSize: 12, lineHeight: 1.45 }}>{accountsError}</div>
          ) : !account ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>No active ChatGPT/Codex saved account. Add or activate one in Models.</div>
          ) : (
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

              {quotaResult && !quotaResult.success && (
                <div style={{ color: quotaResult.credentialStatus === "expired" ? "#fb923c" : "#f87171", fontSize: 12, lineHeight: 1.45 }}>{quotaResult.error ?? quotaResult.credentialMessage ?? "Usage query failed."}</div>
              )}

              {quotaCache?.error && <div style={{ color: "#fb923c", fontSize: 12, lineHeight: 1.45 }}>{quotaCache.error}</div>}

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
        </div>
      )}
    </div>
  );
}
