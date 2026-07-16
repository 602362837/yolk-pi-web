/**
 * Safe Kiro top-bar N-ring projection.
 *
 * Pure helpers only — no React, no network, no credentials.
 * Adapters emit unordered safe window candidates; shared projector owns
 * duration resolution, short→long order, unknown/tie detail-only, and center.
 * remaining never becomes percent and never participates in window ordering.
 */

import type { KiroQuotaBucket } from "@/lib/kiro-subscription-quota";
import { formatTokensCompact } from "@/lib/token-format";
import {
  PROVIDER_USAGE_DETAIL_ONLY_NOTE,
  projectProviderUsageWindows,
  resolveUsageWindowDuration,
  type ProviderUsageWindowCandidate,
  type ProviderUsageWindowProjectionMode,
  type ProviderUsageRingUnit,
} from "@/components/ProviderUsagePanelContract";

/** Fixed safe copy when some buckets cannot join multi-ring order. */
export const KIRO_EXTRA_WINDOWS_DETAIL_NOTE = PROVIDER_USAGE_DETAIL_ONLY_NOTE;

/** Format remaining for shortValue / unknown center / title (never percent). */
export function formatKiroRemaining(value: number, unit?: string): string {
  if (!Number.isFinite(value) || value < 0) return "未知";
  const compact = value >= 1_000 ? formatTokensCompact(value) : Math.round(value).toLocaleString();
  if (unit && unit.trim() && unit.trim().toLowerCase() !== "credit" && unit.trim().toLowerCase() !== "credits") {
    return `${compact} ${unit.trim()}`;
  }
  return compact;
}

/** Safe bucket: finite limit>0 and finite used; utilization may still be null. */
export function isSafeKiroBucket(bucket: KiroQuotaBucket): boolean {
  return (
    Boolean(bucket?.id)
    && Number.isFinite(bucket.limit)
    && bucket.limit > 0
    && Number.isFinite(bucket.used)
    && bucket.used >= 0
  );
}

/** Map shared duration evidence to a compact center/segment label. */
function shortLabelForKiroEvidence(evidence: string, fallbackLabel: string): string {
  const key = evidence.toLowerCase();
  if (key.includes("minute") || /:\d+m$/.test(key) || key.endsWith("m") && key.includes("numeric")) {
    if (key.includes("numeric:")) {
      const match = key.match(/numeric:([\d.]+m)/);
      if (match) return match[1]!;
    }
    return "Min";
  }
  if (key.includes("hour") || /:\d+h$/.test(key) || key.includes("5h")) {
    if (key.includes("numeric:")) {
      const match = key.match(/numeric:([\d.]+h)/);
      if (match) return match[1]!;
    }
    if (key.includes("5h") || key.includes("five_hour")) return "5h";
    return "Hourly";
  }
  if (key.includes("day") || key.includes("7d") || key.includes("seven_day")) {
    if (key.includes("numeric:")) {
      const match = key.match(/numeric:([\d.]+d)/);
      if (match) return match[1]!;
    }
    if (key.includes("7d") || key.includes("seven_day")) return "7d";
    return "Daily";
  }
  if (key.includes("week")) return "周";
  if (key.includes("month")) return "月";
  if (key.includes("year")) return "年";
  const trimmed = fallbackLabel.trim();
  return trimmed.length <= 8 ? trimmed : trimmed.slice(0, 8);
}

/**
 * Extract trusted duration evidence from allowlisted label text via shared resolver.
 * Never uses remaining, resetsAt, unit, array index, resourceType, or Limits/quota
 * envelope text as duration.
 */
export function extractKiroBucketOrderEvidence(
  bucket: Pick<KiroQuotaBucket, "id" | "label" | "resourceType">,
): { durationMs: number; evidence: string; shortLabel: string; fullLabel: string } | null {
  const label = (bucket.label ?? "").trim();
  if (!label) return null;
  // resourceType is intentionally ignored — never duration evidence.
  void bucket.resourceType;
  void bucket.id;
  const resolved = resolveUsageWindowDuration({ label });
  if (!resolved) return null;
  return {
    durationMs: resolved.durationMs,
    evidence: resolved.evidence,
    shortLabel: shortLabelForKiroEvidence(resolved.evidence, label),
    fullLabel: label,
  };
}

function kiroBucketPercent(bucket: KiroQuotaBucket): number | null {
  if (!Number.isFinite(bucket.utilization)) return null;
  return bucket.utilization;
}

/** Convert a safe bucket into an unordered window candidate (no layer index / center). */
export function buildKiroUsageWindowCandidate(bucket: KiroQuotaBucket): ProviderUsageWindowCandidate {
  const label = (bucket.label ?? "").trim() || bucket.id;
  const order = extractKiroBucketOrderEvidence(bucket);
  const percent = kiroBucketPercent(bucket);
  const remainingText = formatKiroRemaining(bucket.remaining, bucket.unit);
  const shortLabel = order?.shortLabel
    ?? (label.length <= 8 ? label : label.slice(0, 8));
  const fullLabel = order?.fullLabel ?? label;
  const percentText = percent === null ? "未知" : `${Math.round(percent)}%`;
  return {
    id: bucket.id,
    shortLabel,
    fullLabel,
    percent,
    title: `${fullLabel} 已使用 ${percentText} · 剩余 ${remainingText}`,
    present: true,
    trusted: true,
    durationMs: null,
    // Label is the only duration source; remaining/reset/resourceType never participate.
    durationEvidence: order?.evidence,
    unknownCenterValue: remainingText,
  };
}

export interface KiroRingProjectionResult {
  ringUnit: ProviderUsageRingUnit | null;
  /** Buckets excluded from multi-ring because order could not be proven. */
  detailOnlyBucketIds: string[];
  /** Fixed safe note when some windows stay detail-only. */
  detailNote: string | null;
  /** How the projection was chosen (for tests / debugging; never rendered raw). */
  mode: ProviderUsageWindowProjectionMode;
}

/**
 * Project safe Kiro buckets through the shared window projector.
 * 1 safe window = single ring (duration may be unknown).
 * Multi = only unique trusted duration ranks, outer shortest → inner longest.
 * remaining never becomes percent and never participates in ordering.
 * Detail-primary ids are intentionally not accepted — never invent radial order/center.
 */
export function projectKiroRingUnit(
  buckets: readonly KiroQuotaBucket[],
): KiroRingProjectionResult {
  const safe = buckets.filter(isSafeKiroBucket);
  if (safe.length === 0) {
    return { ringUnit: null, detailOnlyBucketIds: [], detailNote: null, mode: "empty" };
  }

  const candidates = safe.map(buildKiroUsageWindowCandidate);
  const projected = projectProviderUsageWindows(candidates, { providerLabel: "Kiro" });

  // shortValue is outermost (center) remaining only — never borrowed across buckets.
  let ringUnit = projected.ringUnit;
  if (ringUnit) {
    const centerId = ringUnit.centerLayerId;
    const centerBucket = safe.find((bucket) => bucket.id === centerId);
    if (centerBucket) {
      const remainingText = formatKiroRemaining(centerBucket.remaining, centerBucket.unit);
      ringUnit = {
        ...ringUnit,
        shortValue: remainingText,
        unknownCenterValue:
          ringUnit.layers[0]?.percent === null ? remainingText : null,
      };
    }
  }

  return {
    ringUnit,
    detailOnlyBucketIds: projected.detailOnlyCandidateIds,
    detailNote: projected.detailNote,
    mode: projected.mode,
  };
}
