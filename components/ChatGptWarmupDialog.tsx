"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatQuotaQueriedAt, formatResetCountdown, knownQuotaTiers, QUOTA_TIER_LABELS } from "@/lib/quota-display";
import type { OAuthAccountSummary } from "@/lib/oauth-accounts";
import type { OpenAICodexWarmupResponse, OpenAICodexWarmupResult } from "@/lib/openai-codex-warmup";
import type { OpenAICodexWarmupHistory, OpenAICodexWarmupHistoryRun } from "@/lib/openai-codex-warmup-history";
import type { PiWebChatGptConfig, PiWebChatGptWarmupConfig, PiWebConfig } from "@/lib/pi-web-config";

interface Props {
  accounts: OAuthAccountSummary[];
  onClose: () => void;
  onComplete?: () => void | Promise<void>;
}

interface WebConfigResponse {
  config?: PiWebConfig;
  error?: string;
}

const DEFAULT_WARMUP_SCHEDULE: PiWebChatGptWarmupConfig = {
  enabled: false,
  accountIds: [],
  times: ["07:00", "13:00"],
};

function defaultSelectedAccountIds(accounts: OAuthAccountSummary[]): string[] {
  const activeIds = accounts.filter((account) => account.active).map((account) => account.accountId);
  if (activeIds.length > 0) return activeIds;
  return accounts[0] ? [accounts[0].accountId] : [];
}

function normalizeDailyTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function accountQuotaText(account: OAuthAccountSummary): string {
  const quotaCache = account.quotaCache;
  if (!quotaCache) return "Quota not refreshed yet";
  if (quotaCache.error) return quotaCache.error;
  const knownTiers = knownQuotaTiers(quotaCache.tiers);
  if (knownTiers.length === 0) return "Reset time unknown";
  const resetParts = knownTiers.map((tier) => {
    const label = QUOTA_TIER_LABELS[tier.name] ?? tier.name;
    const countdown = formatResetCountdown(tier.resetsAt);
    return `${label}: ${countdown ? `resets in ${countdown}` : "reset unknown"}`;
  });
  const queriedAt = quotaCache.queriedAt ? ` · ${formatQuotaQueriedAt(quotaCache.queriedAt)}` : "";
  return `${resetParts.join(" · ")}${queriedAt}`;
}

function resultText(result: OpenAICodexWarmupResult | undefined): { text: string; color: string } {
  if (!result) return { text: "Ready", color: "var(--text-dim)" };
  if (!result.success) return { text: result.error ?? "Warmup failed", color: "#f87171" };
  if (!result.quotaRefreshSuccess) return { text: result.quotaError ? `Warmed · quota refresh failed: ${result.quotaError}` : "Warmed · quota refresh unavailable", color: "#fb923c" };
  return { text: `Warmed${result.latencyMs !== null ? ` · ${result.latencyMs}ms` : ""} · quota refreshed`, color: "#34d399" };
}

function schedulesEqual(a: PiWebChatGptWarmupConfig, b: PiWebChatGptWarmupConfig): boolean {
  return a.enabled === b.enabled
    && JSON.stringify([...a.accountIds].sort()) === JSON.stringify([...b.accountIds].sort())
    && JSON.stringify([...a.times].sort()) === JSON.stringify([...b.times].sort());
}

function runSummary(run: OpenAICodexWarmupHistoryRun): string {
  const successCount = run.results.filter((result) => result.success).length;
  return `${successCount}/${run.results.length} warmed`;
}

function formatRunTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

export function ChatGptWarmupDialog({ accounts, onClose, onComplete }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => defaultSelectedAccountIds(accounts));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, OpenAICodexWarmupResult>>({});
  const [chatgptConfig, setChatgptConfig] = useState<PiWebChatGptConfig | null>(null);
  const [schedule, setSchedule] = useState<PiWebChatGptWarmupConfig>(DEFAULT_WARMUP_SCHEDULE);
  const [savedSchedule, setSavedSchedule] = useState<PiWebChatGptWarmupConfig>(DEFAULT_WARMUP_SCHEDULE);
  const [newTime, setNewTime] = useState("07:00");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [history, setHistory] = useState<OpenAICodexWarmupHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = selectedIds.length;
  const resultList = Object.values(results);
  const successCount = resultList.filter((result) => result.success).length;
  const scheduleAccountSet = useMemo(() => new Set(schedule.accountIds), [schedule.accountIds]);
  const scheduleDirty = !schedulesEqual(schedule, savedSchedule);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistoryError(null);
    try {
      const res = await fetch("/api/auth/warmup/openai-codex", { signal });
      const data = await res.json().catch(() => ({})) as OpenAICodexWarmupHistory & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setHistory(data);
    } catch (loadError) {
      if ((loadError as { name?: string }).name === "AbortError") return;
      setHistoryError(loadError instanceof Error ? loadError.message : "Failed to load warmup history");
    }
  }, []);

  const loadConfig = useCallback(async (signal?: AbortSignal) => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetch("/api/web-config", { signal });
      const data = await res.json().catch(() => ({})) as WebConfigResponse;
      if (!res.ok || data.error || !data.config) throw new Error(data.error ?? `HTTP ${res.status}`);
      setChatgptConfig(data.config.chatgpt);
      setSchedule(data.config.chatgpt.warmup);
      setSavedSchedule(data.config.chatgpt.warmup);
    } catch (loadError) {
      if ((loadError as { name?: string }).name === "AbortError") return;
      setConfigError(loadError instanceof Error ? loadError.message : "Failed to load warmup schedule");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadConfig(controller.signal);
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadConfig, loadHistory]);

  const toggleAccount = useCallback((accountId: string) => {
    setSelectedIds((prev) => prev.includes(accountId)
      ? prev.filter((id) => id !== accountId)
      : [...prev, accountId]);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(accounts.map((account) => account.accountId));
  }, [accounts]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const toggleScheduleAccount = useCallback((accountId: string) => {
    setSchedule((prev) => ({
      ...prev,
      accountIds: prev.accountIds.includes(accountId)
        ? prev.accountIds.filter((id) => id !== accountId)
        : [...prev.accountIds, accountId],
    }));
  }, []);

  const addScheduleTime = useCallback(() => {
    const normalized = normalizeDailyTime(newTime);
    if (!normalized) {
      setConfigError("Schedule time must be HH:mm, for example 07:00.");
      return;
    }
    setConfigError(null);
    setSchedule((prev) => prev.times.includes(normalized) ? prev : { ...prev, times: [...prev.times, normalized].sort() });
  }, [newTime]);

  const removeScheduleTime = useCallback((time: string) => {
    setSchedule((prev) => {
      const nextTimes = prev.times.filter((item) => item !== time);
      return { ...prev, times: nextTimes.length > 0 ? nextTimes : prev.times };
    });
  }, []);

  const saveSchedule = useCallback(async () => {
    if (!chatgptConfig || scheduleSaving) return;
    setScheduleSaving(true);
    setConfigError(null);
    try {
      const nextChatgpt: PiWebChatGptConfig = { ...chatgptConfig, warmup: schedule };
      const res = await fetch("/api/web-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatgpt: nextChatgpt }),
      });
      const data = await res.json().catch(() => ({})) as WebConfigResponse;
      if (!res.ok || data.error || !data.config) throw new Error(data.error ?? `HTTP ${res.status}`);
      setChatgptConfig(data.config.chatgpt);
      setSchedule(data.config.chatgpt.warmup);
      setSavedSchedule(data.config.chatgpt.warmup);
      await loadHistory();
    } catch (saveError) {
      setConfigError(saveError instanceof Error ? saveError.message : "Failed to save warmup schedule");
    } finally {
      setScheduleSaving(false);
    }
  }, [chatgptConfig, loadHistory, schedule, scheduleSaving]);

  const runWarmup = useCallback(async () => {
    if (running || selectedIds.length === 0) return;
    setRunning(true);
    setError(null);
    setResults({});
    try {
      const res = await fetch("/api/auth/warmup/openai-codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: selectedIds }),
      });
      const data = await res.json().catch(() => ({})) as OpenAICodexWarmupResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(Object.fromEntries(data.results.map((result) => [result.accountId, result])));
      await onComplete?.();
      await loadHistory();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Warmup failed");
    } finally {
      setRunning(false);
    }
  }, [loadHistory, onComplete, running, selectedIds]);

  return (
    <div
      className="pi-modal-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(event) => { if (event.target === event.currentTarget && !running && !scheduleSaving) onClose(); }}
    >
      <div className="pi-modal-panel" style={{ width: 760, maxWidth: "calc(100vw - 32px)", maxHeight: "min(88vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>ChatGPT account warmup</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>Manual warmup now, or save a local daily schedule for selected accounts.</div>
          </div>
          <button type="button" disabled={running || scheduleSaving} onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: running || scheduleSaving ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        <div className="mobile-stack-grid" style={{ padding: 14, overflow: "auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.85fr)", gap: 14 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
              Warmup sends a tiny real Codex request using a fixed low-cost model. Tokens stay server-side; this dialog only receives per-account results.
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Manual warmup</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={running || accounts.length === 0} onClick={selectAll} style={{ padding: "5px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: running || accounts.length === 0 ? "var(--text-dim)" : "var(--text-muted)", cursor: running || accounts.length === 0 ? "not-allowed" : "pointer", fontSize: 12 }}>Select all</button>
                <button type="button" disabled={running || selectedCount === 0} onClick={clearSelection} style={{ padding: "5px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: running || selectedCount === 0 ? "var(--text-dim)" : "var(--text-muted)", cursor: running || selectedCount === 0 ? "not-allowed" : "pointer", fontSize: 12 }}>Clear</button>
              </div>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {accounts.length} saved · {selectedCount} selected{resultList.length > 0 ? ` · ${successCount}/${resultList.length} warmed` : ""}
            </div>

            {accounts.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>No saved ChatGPT/Codex accounts yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {accounts.map((account) => {
                  const checked = selectedSet.has(account.accountId);
                  const result = results[account.accountId];
                  const status = resultText(result);
                  return (
                    <label key={account.accountId} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "9px 10px", border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, background: checked ? "rgba(59,130,246,0.10)" : "var(--bg-panel)", cursor: running ? "default" : "pointer" }}>
                      <input type="checkbox" checked={checked} disabled={running} onChange={() => toggleAccount(account.accountId)} style={{ marginTop: 2 }} />
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                          <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span>
                          {account.active && <span style={{ color: "#4ade80", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>active</span>}
                        </span>
                        <code style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{account.maskedAccountId}</code>
                        {account.extraInfo && <span style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.extraInfo}</span>}
                        <span style={{ color: account.quotaCache?.error ? "#fb923c" : "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>{accountQuotaText(account)}</span>
                        <span style={{ color: status.color, fontSize: 11, lineHeight: 1.4 }}>{running && checked && !result ? "Warming sequentially…" : status.text}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {error && <div style={{ color: "#f87171", fontSize: 12, lineHeight: 1.5 }}>{error}</div>}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 800 }}>Scheduled warmup</div>
                <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>Uses local server time and only runs while yolk pi web is running.</div>
              </div>

              {configLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading schedule…</div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={scheduleSaving}
                    onClick={() => setSchedule((prev) => ({ ...prev, enabled: !prev.enabled }))}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: scheduleSaving ? "not-allowed" : "pointer", textAlign: "left" }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>Enable daily scheduled warmup</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{schedule.enabled ? "Enabled" : "Disabled"}</span>
                    </span>
                    <span style={{ width: 38, height: 21, borderRadius: 999, background: schedule.enabled ? "var(--accent)" : "var(--border)", position: "relative", flexShrink: 0 }}>
                      <span style={{ position: "absolute", top: 3, left: schedule.enabled ? 20 : 3, width: 15, height: 15, borderRadius: "50%", background: "white", transition: "left 0.12s" }} />
                    </span>
                  </button>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>Schedule accounts</div>
                    {accounts.length === 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No accounts available.</div>
                    ) : accounts.map((account) => (
                      <label key={account.accountId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 7px", border: "1px solid var(--border)", borderRadius: 6, background: scheduleAccountSet.has(account.accountId) ? "rgba(59,130,246,0.10)" : "var(--bg)", cursor: scheduleSaving ? "default" : "pointer" }}>
                        <input type="checkbox" checked={scheduleAccountSet.has(account.accountId)} disabled={scheduleSaving} onChange={() => toggleScheduleAccount(account.accountId)} />
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span>
                          <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{account.maskedAccountId}</span>
                        </span>
                      </label>
                    ))}
                    <button type="button" disabled={scheduleSaving || selectedIds.length === 0} onClick={() => setSchedule((prev) => ({ ...prev, accountIds: selectedIds }))} style={{ alignSelf: "flex-start", padding: "5px 8px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: scheduleSaving || selectedIds.length === 0 ? "var(--text-dim)" : "var(--accent)", cursor: scheduleSaving || selectedIds.length === 0 ? "not-allowed" : "pointer", fontSize: 11 }}>Use manual selection</button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>Daily local times</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {schedule.times.map((time) => (
                        <span key={time} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                          {time}
                          <button type="button" disabled={scheduleSaving || schedule.times.length <= 1} onClick={() => removeScheduleTime(time)} style={{ border: "none", background: "none", color: scheduleSaving || schedule.times.length <= 1 ? "var(--text-dim)" : "var(--text-muted)", cursor: scheduleSaving || schedule.times.length <= 1 ? "not-allowed" : "pointer", padding: 0, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={newTime} onChange={(event) => setNewTime(event.currentTarget.value)} placeholder="07:00" style={{ minWidth: 0, flex: 1, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none" }} />
                      <button type="button" disabled={scheduleSaving} onClick={addScheduleTime} style={{ padding: "6px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: scheduleSaving ? "var(--text-dim)" : "var(--accent)", cursor: scheduleSaving ? "not-allowed" : "pointer", fontSize: 12 }}>Add</button>
                    </div>
                  </div>

                  {configError && <div style={{ color: "#f87171", fontSize: 12, lineHeight: 1.45 }}>{configError}</div>}

                  <button type="button" disabled={scheduleSaving || !scheduleDirty} onClick={saveSchedule} style={{ padding: "7px 12px", background: !scheduleSaving && scheduleDirty ? "var(--accent)" : "var(--bg-subtle)", border: "none", borderRadius: 7, color: !scheduleSaving && scheduleDirty ? "#fff" : "var(--text-dim)", cursor: !scheduleSaving && scheduleDirty ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 800 }}>{scheduleSaving ? "Saving…" : scheduleDirty ? "Save schedule" : "Schedule saved"}</button>
                </>
              )}
            </div>

            <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 800 }}>Recent runs</div>
                <button type="button" onClick={() => void loadHistory()} style={{ padding: "4px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>Refresh</button>
              </div>
              {historyError ? (
                <div style={{ color: "#f87171", fontSize: 12 }}>{historyError}</div>
              ) : !history ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading history…</div>
              ) : history.runs.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No warmup runs recorded yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {history.runs.slice(0, 6).map((run) => (
                    <div key={run.id} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ color: "var(--text)", fontSize: 11, fontWeight: 700 }}>{run.source === "scheduled" ? "Scheduled" : "Manual"}</span>
                        <span style={{ color: run.results.every((result) => result.success) ? "#34d399" : "#fb923c", fontSize: 11, fontWeight: 700 }}>{runSummary(run)}</span>
                      </div>
                      <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{formatRunTime(run.completedAt)} · {run.accountIds.length} account{run.accountIds.length === 1 ? "" : "s"}</span>
                      {run.scheduledRunKey && <span style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{run.scheduledRunKey}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" disabled={running || scheduleSaving} onClick={onClose} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: running || scheduleSaving ? "var(--text-dim)" : "var(--text-muted)", cursor: running || scheduleSaving ? "not-allowed" : "pointer", fontSize: 12 }}>Close</button>
          <button type="button" disabled={running || selectedCount === 0} onClick={runWarmup} style={{ padding: "6px 14px", background: !running && selectedCount > 0 ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 6, color: !running && selectedCount > 0 ? "#fff" : "var(--text-dim)", cursor: !running && selectedCount > 0 ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 800 }}>{running ? "Warming…" : "Warm selected now"}</button>
        </div>
      </div>
    </div>
  );
}
