/**
 * Pure Grok usage ring/projection helpers (no React).
 * Shared by GrokUsagePanel and unit tests.
 *
 * Adapter only emits unordered safe candidates for windows that actually exist.
 * Shared projector owns short→long order, unknown/tie detail-only, and center.
 */

import type { GrokQuotaResultV1 } from "@/lib/grok-subscription-quota";
import {
  projectProviderUsageWindows,
  toneForUsagePercent,
  type ProviderUsageAggregateProjection,
  type ProviderUsageRisk,
  type ProviderUsageRingUnit,
  type ProviderUsageWindowCandidate,
} from "./ProviderUsagePanelContract";

/** Standalone = own click trigger/dialog; aggregate = detail body only for the shell. */
export type GrokUsagePresentationMode = "standalone" | "aggregate";

export interface GrokUsageRingProjectionInput {
  /** True when an Active account is selected (masks are already safe). */
  hasAccount: boolean;
  monthly?: GrokQuotaResultV1["monthly"] | null;
  weekly?: GrokQuotaResultV1["weekly"] | null;
  /** Cache state for warning context on stale trusted values. */
  cacheState?: GrokQuotaResultV1["cache"]["state"] | null;
  reauthRequired?: boolean;
}

/**
 * Emit unordered safe Grok window candidates from optional typed fields.
 * Presence = object presence; missing windows are never synthesized.
 * Does not assign layer index, outer/inner, or center.
 */
export function buildGrokUsageWindowCandidates(
  input: GrokUsageRingProjectionInput,
): ProviderUsageWindowCandidate[] {
  if (!input.hasAccount) return [];

  const candidates: ProviderUsageWindowCandidate[] = [];
  const staleHint = input.cacheState === "stale" ? " · 缓存已过期" : "";

  // Optional typed windows only — no fixed week→month push order.
  if (input.weekly) {
    const percent = Number.isFinite(input.weekly.usedPercent)
      ? input.weekly.usedPercent
      : null;
    candidates.push({
      id: "grok-week",
      shortLabel: "7d",
      fullLabel: "周额度",
      percent,
      title: percent === null
        ? `周度用量未知${staleHint}`
        : `周度已使用 ${Math.round(percent)}%${staleHint}`,
      present: true,
      trusted: true,
      durationMs: null,
      durationEvidence: "weekly",
    });
  }

  if (input.monthly) {
    const percent = Number.isFinite(input.monthly.utilization)
      ? input.monthly.utilization
      : null;
    candidates.push({
      id: "grok-month",
      shortLabel: "月",
      fullLabel: "月度额度",
      percent,
      title: percent === null
        ? `月度用量未知${staleHint}`
        : `月度已使用 ${Math.round(percent)}%${staleHint}`,
      present: true,
      trusted: true,
      durationMs: null,
      durationEvidence: "monthly",
    });
  }

  return candidates;
}

/**
 * @deprecated Prefer buildGrokUsageWindowCandidates + projectProviderUsageWindows.
 * Kept as a thin candidate mapper for re-exports/tests that still mention layers.
 */
export function buildGrokUsageRingLayers(
  input: GrokUsageRingProjectionInput,
) {
  return buildGrokUsageRingUnit(input)?.layers.slice() ?? [];
}

/**
 * Build the shared N-ring unit for Grok via the common projector.
 * Dual windows → outer week (shorter), inner month (longer), center = outer week.
 * Only-month / only-week → single layer with matching center.
 * Outermost unknown percent keeps the layer and center value "—" (never borrows inner).
 */
export function buildGrokUsageRingUnit(
  input: GrokUsageRingProjectionInput,
): ProviderUsageRingUnit | null {
  const candidates = buildGrokUsageWindowCandidates(input);
  if (candidates.length === 0) return null;
  const projected = projectProviderUsageWindows(candidates, { providerLabel: "Grok" });
  return projected.ringUnit;
}

export interface GrokUsageProjectionState {
  hasAccount: boolean;
  accountsLoading: boolean;
  accountsError: string | null;
  refreshing: boolean;
  quotaLoading: boolean;
  quota: GrokQuotaResultV1 | null;
}

function resolveGrokProjectionRisk(state: GrokUsageProjectionState): ProviderUsageRisk {
  const { hasAccount, accountsError, quota, refreshing, accountsLoading, quotaLoading } = state;
  if (refreshing || (accountsLoading && !hasAccount && !quota) || (quotaLoading && !quota?.monthly && hasAccount)) {
    return "muted";
  }
  if (accountsError && !hasAccount) return "danger";
  if (!hasAccount) return "muted";
  if (quota?.reauthRequired) return "danger";
  if (quota && !quota.success && !quota.monthly) return "danger";
  if (quota?.cache.state === "stale" && quota.monthly) return "warning";

  const unit = buildGrokUsageRingUnit({
    hasAccount,
    monthly: quota?.monthly,
    weekly: quota?.weekly,
    cacheState: quota?.cache.state,
    reauthRequired: quota?.reauthRequired,
  });
  if (!unit) return "muted";

  let worst: ProviderUsageRisk = "normal";
  for (const layer of unit.layers) {
    const tone = toneForUsagePercent(layer.percent);
    if (tone === "danger") return "danger";
    if (tone === "warning") worst = "warning";
    if (tone === "muted" && worst === "normal") worst = "muted";
  }
  return worst;
}

/**
 * Allowlisted aggregate / trigger projection for Grok.
 * Never includes accountId, credentials, or raw upstream payloads.
 */
export function buildGrokUsageAggregateProjection(
  state: GrokUsageProjectionState,
): ProviderUsageAggregateProjection {
  const {
    hasAccount,
    accountsLoading,
    accountsError,
    refreshing,
    quotaLoading,
    quota,
  } = state;

  const loading = Boolean(
    refreshing
    || (accountsLoading && !hasAccount && !quota)
    || (quotaLoading && !quota?.monthly && hasAccount),
  );

  let fallback: string | null = null;
  let ringUnit: ProviderUsageRingUnit | null = null;
  let title = "Grok 用量";

  if (loading) {
    fallback = "加载中";
    title = "Grok 用量 · 加载中";
  } else if (accountsError && !hasAccount) {
    fallback = "错误";
    title = "Grok 用量 · 错误";
  } else if (!hasAccount) {
    fallback = "登录";
    title = "Grok 用量 · 未登录";
  } else if (quota?.reauthRequired && !quota.monthly) {
    // Reauth with no trusted quota → short fallback, no forged rings.
    fallback = "需登录";
    title = "Grok 用量 · 需重新登录";
  } else if (quota && !quota.success && !quota.monthly) {
    fallback = "错误";
    title = "Grok 用量 · 暂不可用";
  } else {
    ringUnit = buildGrokUsageRingUnit({
      hasAccount,
      monthly: quota?.monthly,
      weekly: quota?.weekly,
      cacheState: quota?.cache.state,
      reauthRequired: quota?.reauthRequired,
    });
    if (!ringUnit) {
      fallback = "额度未知";
      title = "Grok 用量 · 额度未知";
    } else if (quota?.reauthRequired) {
      title = "Grok 用量 · 需重新登录";
    } else if (quota?.cache.state === "stale") {
      title = "Grok 用量 · 缓存已过期";
    } else {
      title = ringUnit.ariaLabel;
    }
  }

  return {
    key: "grok",
    label: "Grok",
    order: 1,
    risk: resolveGrokProjectionRisk(state),
    loading,
    ringUnit,
    fallback,
    title,
  };
}
