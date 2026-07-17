/**
 * Safe Antigravity top-bar ring projection (group-aware dual-independent rings).
 *
 * Pure helpers only — no React, no network, no credentials.
 *
 * Hard boundaries (IMP-001 / AG-G02):
 * - Model **groups** are independent side-by-side rings (Flash | Opus), never
 *   concentric outer/inner layers of one ProviderUsageRingUnit.
 * - Concentric multi-layer N-ring remains **period-only** (5h / 7d). Antigravity
 *   currently has no trusted dual-period evidence, so each group is 1 layer.
 * - resetTime is title/detail only — never durationMs, durationEvidence, radial
 *   order, or ranking evidence.
 * - Group aggregation is conservative max(used) / min(remaining) via
 *   antigravity-quota-groups; never avg/sum/composite total percent.
 * - Failover stays model-key aware and does not read these group projections.
 */

import type { AntigravityQuotaModelWindow, AntigravityQuotaResultV1 } from "@/lib/antigravity-subscription-quota";
import {
  ANTIGRAVITY_PRIORITY_RING_GROUP_IDS,
  groupByAntigravityQuotaWindows,
  isSafeAntigravityQuotaGroupWindow,
  type AntigravityQuotaGroupAggregate,
  type AntigravityQuotaGroupId,
} from "@/lib/antigravity-quota-groups";
import {
  createProviderUsageRingUnit,
  PROVIDER_USAGE_DETAIL_ONLY_FALLBACK,
  PROVIDER_USAGE_DETAIL_ONLY_NOTE,
  toneForUsagePercent,
  type ProviderUsageAggregateProjection,
  type ProviderUsageRisk,
  type ProviderUsageRingUnit,
} from "@/components/ProviderUsagePanelContract";

/** Fixed safe copy when multi-model / non-priority windows cannot join radial layout. */
export const ANTIGRAVITY_EXTRA_WINDOWS_DETAIL_NOTE = PROVIDER_USAGE_DETAIL_ONLY_NOTE;

/** Compact / aggregate fallback when detail-only applies (no priority group rings). */
export const ANTIGRAVITY_MULTI_MODEL_FALLBACK = "多模型";

/** Aggregate display order: GPT 0, Grok 1, Kiro 2, Antigravity 3. */
export const ANTIGRAVITY_USAGE_ORDER = 3;

/** Priority group ids that may become independent top-bar ring slots. */
export type AntigravityPriorityRingGroupId = (typeof ANTIGRAVITY_PRIORITY_RING_GROUP_IDS)[number];

/**
 * How Antigravity chose top-bar rings (tests/debug; never raw-rendered).
 * dual-independent = Flash + Opus as two side-by-side single-layer units.
 */
export type AntigravityRingProjectionMode =
  | "dual-independent"
  | "single"
  | "detail-only"
  | "empty";

/** One independent ring slot for a priority model group. */
export interface AntigravityRingSlot {
  groupId: AntigravityPriorityRingGroupId;
  label: string;
  shortLabel: string;
  /** Always a single-layer unit for the group (never Flash+Opus layers). */
  ringUnit: ProviderUsageRingUnit;
}

export interface AntigravityRingProjectionResult {
  /**
   * Independent rings for priority groups with data; order Flash then Opus.
   * Length 0 / 1 / 2 — never invents a missing priority group as 0%.
   */
  ringSlots: AntigravityRingSlot[];
  /**
   * Legacy single-unit field for callers that only read one unit.
   * - dual-independent → null (must use ringSlots / ringUnits; never pack both groups)
   * - single → that slot's unit
   * - detail-only / empty → null
   */
  ringUnit: ProviderUsageRingUnit | null;
  /** Model / variant ids that stay detail-only (all variants when detail-only). */
  detailOnlyModelIds: string[];
  /** Fixed safe note when windows stay detail-only. */
  detailNote: string | null;
  /** How the projection was chosen (tests/debug; never raw-rendered). */
  mode: AntigravityRingProjectionMode;
  /** Number of safe model windows considered. */
  safeModelCount: number;
  /** Group aggregates present (priority + detail groups); empty when none safe. */
  groups: AntigravityQuotaGroupAggregate[];
}

/** Safe model window: finite remainingFraction in [0,1] and finite usedPercent. */
export function isSafeAntigravityModelWindow(
  model: AntigravityQuotaModelWindow | null | undefined,
): model is AntigravityQuotaModelWindow {
  return isSafeAntigravityQuotaGroupWindow(model);
}

/** Format used percent for shortValue / title (unknown never becomes 0%). */
export function formatAntigravityUsedPercent(usedPercent: number | null | undefined): string {
  if (usedPercent === null || usedPercent === undefined || !Number.isFinite(usedPercent)) {
    return "未知";
  }
  const clamped = Math.min(100, Math.max(0, usedPercent));
  return `${Math.round(clamped)}%`;
}

/** Format remaining fraction as a short remaining percent for detail copy. */
export function formatAntigravityRemainingFraction(
  remainingFraction: number | null | undefined,
): string {
  if (
    remainingFraction === null
    || remainingFraction === undefined
    || !Number.isFinite(remainingFraction)
    || remainingFraction < 0
    || remainingFraction > 1
  ) {
    return "未知";
  }
  return `${Math.round(remainingFraction * 100)}%`;
}

/**
 * @deprecated Prefer group-based projectAntigravityRingUnit. Kept for tests that
 * assert resetTime is never duration evidence on a candidate-like shape.
 * Intentionally omits durationMs / durationEvidence.
 */
export function buildAntigravityUsageWindowCandidate(
  model: AntigravityQuotaModelWindow,
): {
  id: string;
  shortLabel: string;
  fullLabel: string;
  percent: number | null;
  title: string;
  present: true;
  trusted: true;
  durationMs: null;
  durationEvidence: undefined;
  unknownCenterValue: string | null;
} {
  const label = (model.label ?? "").trim() || model.id;
  const shortLabel = label.length <= 10 ? label : `${label.slice(0, 9)}…`;
  const percent = Number.isFinite(model.usedPercent) ? model.usedPercent : null;
  const percentText = formatAntigravityUsedPercent(percent);
  const remainingText = formatAntigravityRemainingFraction(model.remainingFraction);
  const resetHint = model.resetsAt ? ` · 重置 ${model.resetsAt}` : "";
  return {
    id: model.id,
    shortLabel,
    fullLabel: label,
    percent,
    title: `${label} 已使用 ${percentText} · 剩余 ${remainingText}${resetHint}`,
    present: true,
    trusted: true,
    // resetTime is display-only — never duration / order evidence.
    durationMs: null,
    durationEvidence: undefined,
    unknownCenterValue: percent === null ? remainingText : null,
  };
}

function isPriorityRingGroupId(
  groupId: AntigravityQuotaGroupId,
): groupId is AntigravityPriorityRingGroupId {
  return groupId === "gemini-3-flash" || groupId === "claude-opus";
}

/**
 * Build a single-layer ring unit for one priority group.
 * NEVER pack Flash and Opus as layers of the same unit.
 */
export function buildAntigravityGroupRingUnit(
  group: AntigravityQuotaGroupAggregate,
): ProviderUsageRingUnit {
  const percentText = formatAntigravityUsedPercent(group.usedPercent);
  const remainingText = formatAntigravityRemainingFraction(group.remainingFraction);
  const resetHint = group.resetsAt ? ` · 重置 ${group.resetsAt}` : "";
  // Single layer only — group identity is the slot, not concentric layers.
  return createProviderUsageRingUnit({
    layers: [
      {
        id: `antigravity-group-${group.groupId}`,
        shortLabel: group.shortLabel,
        fullLabel: group.label,
        percent: group.usedPercent,
        title: `${group.label}（保守）已使用 ${percentText} · 剩余 ${remainingText}${resetHint}`,
      },
    ],
    providerLabel: "Antigravity",
    ariaLabel: `Antigravity ${group.shortLabel} 组（保守）已使用 ${percentText} · 剩余 ${remainingText}`,
  });
}

/**
 * Project safe Antigravity model windows into independent priority-group rings.
 *
 * - 0 safe → empty
 * - Flash + Opus present → dual-independent (two single-layer ringSlots)
 * - only one priority group → single independent ring (no fake 0% sibling)
 * - no priority groups but other groups present → detail-only + 多模型
 *
 * Never packs Flash/Opus into one unit's layers. Never fabricates duration from
 * resetTime. Never avg/sum across groups.
 */
export function projectAntigravityRingUnit(
  models: readonly AntigravityQuotaModelWindow[],
): AntigravityRingProjectionResult {
  const safe = models.filter(isSafeAntigravityModelWindow);
  if (safe.length === 0) {
    return {
      ringSlots: [],
      ringUnit: null,
      detailOnlyModelIds: [],
      detailNote: null,
      mode: "empty",
      safeModelCount: 0,
      groups: [],
    };
  }

  const groups = groupByAntigravityQuotaWindows(safe);
  const priorityGroups = groups.filter(
    (group): group is AntigravityQuotaGroupAggregate & { groupId: AntigravityPriorityRingGroupId } =>
      isPriorityRingGroupId(group.groupId),
  );

  // Preserve fixed priority order Flash → Opus even if group map order drifts.
  const orderedPriority: AntigravityQuotaGroupAggregate[] = [];
  for (const id of ANTIGRAVITY_PRIORITY_RING_GROUP_IDS) {
    const found = priorityGroups.find((group) => group.groupId === id);
    if (found) orderedPriority.push(found);
  }

  if (orderedPriority.length === 0) {
    // Other groups only — honest detail-only, no composite ring / fake priority.
    return {
      ringSlots: [],
      ringUnit: null,
      detailOnlyModelIds: safe.map((model) => model.id),
      detailNote: ANTIGRAVITY_EXTRA_WINDOWS_DETAIL_NOTE,
      mode: "detail-only",
      safeModelCount: safe.length,
      groups,
    };
  }

  const ringSlots: AntigravityRingSlot[] = orderedPriority.map((group) => ({
    groupId: group.groupId as AntigravityPriorityRingGroupId,
    label: group.label,
    shortLabel: group.shortLabel,
    ringUnit: buildAntigravityGroupRingUnit(group),
  }));

  // Hard invariant: every slot is single-layer; never Flash+Opus concentric.
  for (const slot of ringSlots) {
    if (slot.ringUnit.layers.length !== 1) {
      throw new Error(
        `Antigravity group ring must be single-layer (group=${slot.groupId}, layers=${slot.ringUnit.layers.length})`,
      );
    }
  }

  if (ringSlots.length >= 2) {
    return {
      ringSlots,
      // Dual: legacy ringUnit stays null so callers cannot treat Flash/Opus as one unit.
      ringUnit: null,
      detailOnlyModelIds: [],
      detailNote: null,
      mode: "dual-independent",
      safeModelCount: safe.length,
      groups,
    };
  }

  // Exactly one priority group present.
  return {
    ringSlots,
    ringUnit: ringSlots[0]?.ringUnit ?? null,
    detailOnlyModelIds: [],
    detailNote: null,
    mode: "single",
    safeModelCount: safe.length,
    groups,
  };
}

/** Flatten independent ring slots to ringUnits for Trigger / Aggregate. */
export function ringUnitsFromAntigravityProjection(
  projection: Pick<AntigravityRingProjectionResult, "ringSlots" | "ringUnit">,
): ProviderUsageRingUnit[] {
  if (projection.ringSlots.length > 0) {
    return projection.ringSlots.map((slot) => slot.ringUnit);
  }
  return projection.ringUnit ? [projection.ringUnit] : [];
}

export interface AntigravityUsageProjectionState {
  hasAccount: boolean;
  accountsLoading: boolean;
  accountsError: string | null;
  refreshing: boolean;
  quotaLoading: boolean;
  quota: AntigravityQuotaResultV1 | null;
}

function riskFromRingUnits(
  units: readonly ProviderUsageRingUnit[],
  context: {
    reauth?: boolean;
    invalidProject?: boolean;
    stale?: boolean;
    muted?: boolean;
  },
): ProviderUsageRisk {
  if (context.reauth || context.invalidProject) return "danger";
  if (context.muted || units.length === 0) {
    if (context.stale) return "warning";
    return "muted";
  }
  let best: ProviderUsageRisk = context.stale ? "warning" : "normal";
  for (const unit of units) {
    for (const layer of unit.layers) {
      const tone = toneForUsagePercent(layer.percent);
      if (tone === "danger") return "danger";
      if (tone === "warning") best = "warning";
    }
  }
  return best;
}

/**
 * Allowlisted aggregate / trigger projection for Antigravity.
 * Never includes accountId, projectId, credentials, or raw upstream payloads.
 *
 * Dual priority groups → ringUnits with two independent single-layer units
 * (never one unit with Flash outer + Opus inner).
 */
export function buildAntigravityUsageAggregateProjection(
  state: AntigravityUsageProjectionState,
): ProviderUsageAggregateProjection {
  const {
    hasAccount,
    accountsLoading,
    accountsError,
    refreshing,
    quotaLoading,
    quota,
  } = state;

  const safeModels = (quota?.models ?? []).filter(isSafeAntigravityModelWindow);
  const hasModels = safeModels.length > 0;
  const ringProjection = hasAccount && hasModels
    ? projectAntigravityRingUnit(safeModels)
    : {
        ringSlots: [] as AntigravityRingSlot[],
        ringUnit: null as ProviderUsageRingUnit | null,
        detailOnlyModelIds: [] as string[],
        detailNote: null as string | null,
        mode: "empty" as const,
        safeModelCount: 0,
        groups: [] as AntigravityQuotaGroupAggregate[],
      };

  const ringUnits = ringUnitsFromAntigravityProjection(ringProjection);

  const loading = Boolean(
    refreshing
    || (accountsLoading && !hasAccount && !quota)
    || (quotaLoading && !hasModels && hasAccount),
  );

  const reauth = Boolean(quota?.reauthRequired);
  const invalidProject = quota?.error?.code === "invalid_project"
    || quota?.error?.code === "access_denied";
  const stale = Boolean(quota?.cache.state === "stale" && hasModels);

  let fallback: string | null = null;
  let projectedRingUnit: ProviderUsageRingUnit | null = null;
  let projectedRingUnits: ProviderUsageRingUnit[] | null = null;
  let title = "Antigravity 用量";

  if (loading) {
    fallback = "加载中";
    title = "Antigravity 用量 · 加载中";
  } else if (accountsError && !hasAccount) {
    fallback = "错误";
    title = "Antigravity 用量 · 错误";
  } else if (!hasAccount) {
    fallback = "登录";
    title = "Antigravity 用量 · 未登录";
  } else if (reauth && !hasModels) {
    fallback = "需登录";
    title = "Antigravity 用量 · 需重新登录";
  } else if (invalidProject && !hasModels) {
    fallback = "不可用";
    title = "Antigravity 用量 · 不可用";
  } else if (quota && !quota.success && !hasModels) {
    fallback = "不可用";
    title = "Antigravity 用量 · 暂不可用";
  } else if (reauth && !hasModels) {
    projectedRingUnit = null;
    projectedRingUnits = null;
  } else if (ringUnits.length > 0) {
    projectedRingUnits = ringUnits;
    // Legacy single field: only when exactly one independent ring.
    projectedRingUnit = ringUnits.length === 1 ? ringUnits[0] : null;
    if (reauth) {
      title = "Antigravity 用量 · 需重新登录";
    } else if (stale) {
      title = "Antigravity 用量 · 缓存已过期";
    } else if (ringProjection.mode === "dual-independent") {
      const parts = ringProjection.ringSlots.map((slot) => {
        const pct = formatAntigravityUsedPercent(slot.ringUnit.layers[0]?.percent ?? null);
        return `${slot.shortLabel} ${pct}`;
      });
      title = `Antigravity ${parts.join(" · ")}（组保守）`;
    } else {
      title = ringUnits[0]?.ariaLabel ?? "Antigravity 用量";
    }
  } else if (ringProjection.mode === "detail-only" && ringProjection.safeModelCount >= 1) {
    // Non-priority groups only (or multi without priority) → honest detail-only.
    fallback = ANTIGRAVITY_MULTI_MODEL_FALLBACK;
    title = "Antigravity 模型额度详情";
    if (stale) title += " · 缓存已过期";
    if (ringProjection.detailNote) title += ` · ${ringProjection.detailNote}`;
  } else {
    fallback = PROVIDER_USAGE_DETAIL_ONLY_FALLBACK;
    title = "Antigravity 用量 · 额度未知";
  }

  const risk = riskFromRingUnits(projectedRingUnits ?? [], {
    reauth,
    invalidProject: Boolean(invalidProject && !hasModels),
    stale,
    muted: Boolean(fallback) && !(projectedRingUnits && projectedRingUnits.length > 0),
  });

  // Detail-only still surfaces warning when stale / danger on reauth.
  let finalRisk = risk;
  if (!(projectedRingUnits && projectedRingUnits.length > 0) && reauth) finalRisk = "danger";
  else if (!(projectedRingUnits && projectedRingUnits.length > 0) && invalidProject && !hasModels) {
    finalRisk = "danger";
  } else if (!(projectedRingUnits && projectedRingUnits.length > 0) && stale) {
    finalRisk = "warning";
  } else if (
    !(projectedRingUnits && projectedRingUnits.length > 0)
    && ringProjection.mode === "detail-only"
    && ringProjection.safeModelCount >= 1
  ) {
    // Highest per-model risk as status channel only — never a total percent.
    let worst: ProviderUsageRisk = stale ? "warning" : "normal";
    for (const model of safeModels) {
      const tone = toneForUsagePercent(model.usedPercent);
      if (tone === "danger") {
        worst = "danger";
        break;
      }
      if (tone === "warning") worst = "warning";
    }
    finalRisk = worst;
  }

  return {
    key: "antigravity",
    label: "Antigravity",
    order: ANTIGRAVITY_USAGE_ORDER,
    risk: loading ? "muted" : finalRisk,
    loading,
    ringUnit: projectedRingUnit,
    ringUnits: projectedRingUnits && projectedRingUnits.length > 0 ? projectedRingUnits : null,
    fallback: projectedRingUnits && projectedRingUnits.length > 0 ? null : fallback,
    title,
  };
}
