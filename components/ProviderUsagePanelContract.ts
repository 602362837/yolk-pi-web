/**
 * Safe presentation contracts for provider usage rings and aggregate shell.
 *
 * Providers own accounts/quota/race state and project allowlisted fields only.
 * Aggregate shell and shared N-ring primitive must never see accountId,
 * credentials, profileArn, or raw error/response payloads.
 *
 * Window layout: provider adapters emit unordered safe candidates; the shared
 * projector filters, resolves trusted durations, sorts short→long, and locks
 * centerLayerId to the final outermost (shortest comparable) layer.
 */

/** Visual tone for a single ring layer (independent of nesting identity). */
export type ProviderUsageRingTone = "normal" | "warning" | "danger" | "muted";

/** One safe quota window layer (outer → inner after shared projection). */
export interface ProviderUsageRingLayer {
  /** Stable layer id within the unit (e.g. "gpt-week", "gpt-5h"). */
  id: string;
  /** Short center/segment label (e.g. "5h", "周", "Daily"). */
  shortLabel: string;
  /** Full accessible label (e.g. "5 小时额度"). */
  fullLabel: string;
  /** Utilization percent in [0,100], or null when unknown (not 0%). */
  percent: number | null;
  /** Allowlisted tooltip / title text; never raw upstream payloads. */
  title: string;
  /**
   * Normalized safe order evidence for adapters/tests only.
   * Must never be rendered raw in the UI.
   */
  orderEvidence?: string;
}

/**
 * Shared N-ring unit: 1 safe window = 1 layer, N = N concentric rings.
 * layers[0] is outer/shortest (priority); layers[n-1] is inner/longest.
 */
export interface ProviderUsageRingUnit {
  layers: readonly [ProviderUsageRingLayer, ...ProviderUsageRingLayer[]];
  /**
   * Must equal layers[0].id (outer priority-short layer).
   * Invalid values fail development assertions / tests; no silent fallback.
   */
  centerLayerId: string;
  /**
   * Optional safe short value when the center (outer) percent is unknown
   * (e.g. same-bucket remaining). Must never borrow an inner layer value.
   */
  unknownCenterValue?: string | null;
  /** Optional short auxiliary value (e.g. Kiro remaining) shown beside the unit. */
  shortValue?: string | null;
  /** Complete accessible name listing every layer outer→inner and center source. */
  ariaLabel: string;
}

/**
 * Unordered safe window candidate from a provider adapter.
 * Adapters must not assign layer index, outer/inner, or center.
 */
export interface ProviderUsageWindowCandidate {
  id: string;
  shortLabel: string;
  fullLabel: string;
  percent: number | null;
  title: string;
  /** True only when the window actually exists in allowlisted upstream data. */
  present: boolean;
  /** True only after allowlist / numeric boundary checks passed. */
  trusted: boolean;
  /**
   * Explicit positive duration in ms when upstream provides one.
   * Null means unknown unless durationEvidence / token / label resolves.
   */
  durationMs: number | null;
  /**
   * Safe canonical period token for shared resolver (e.g. "seven_day", "weekly", "90m").
   * Never render raw in UI.
   */
  durationEvidence?: string;
  /**
   * Same-bucket safe center fallback when this candidate is center and percent is null.
   * Never borrow another candidate's value.
   */
  unknownCenterValue?: string | null;
}

/** How the shared projector chose ring layers (tests/debug; never raw-rendered). */
export type ProviderUsageWindowProjectionMode =
  | "empty"
  | "single"
  | "ordered-multi"
  | "degraded-single"
  | "detail-only";

/** Shared projector result: ring + detail-only leftovers. */
export interface ProviderUsageWindowProjection {
  ringUnit: ProviderUsageRingUnit | null;
  detailOnlyCandidateIds: string[];
  /** Fixed safe note when some windows stay detail-only; never raw evidence. */
  detailNote: string | null;
  mode: ProviderUsageWindowProjectionMode;
}

/** Fixed safe copy when some windows cannot join radial layout. */
export const PROVIDER_USAGE_DETAIL_ONLY_NOTE = "另有窗口仅在详情展示";

/** Short safe fallback when multi-window projection yields no ring. */
export const PROVIDER_USAGE_DETAIL_ONLY_FALLBACK = "详情";

export type ProviderUsageKey = "gpt" | "grok" | "kiro" | "antigravity";

/** Aggregate risk channel (not a composite percent). */
export type ProviderUsageRisk = "danger" | "warning" | "normal" | "muted";

/**
 * Allowlisted aggregate projection for one enabled provider.
 * Shell consumes this + a detail slot; it never fetches or interprets schema.
 */
export interface ProviderUsageAggregateProjection {
  key: ProviderUsageKey;
  label: "GPT" | "Grok" | "Kiro" | "Antigravity";
  /** Display order among enabled providers (lower first; GPT→Grok→Kiro→Antigravity). */
  order: number;
  risk: ProviderUsageRisk;
  loading: boolean;
  ringUnit: ProviderUsageRingUnit | null;
  /**
   * Optional independent side-by-side ring units (model groups, not periods).
   * When length > 1, Trigger/Aggregate render each unit separately — never pack
   * them as concentric layers of one ProviderUsageRingUnit.
   * Prefer this over ringUnit for multi-group providers (e.g. Antigravity Flash|Opus).
   * Single-unit providers may omit this and keep ringUnit only.
   */
  ringUnits?: readonly ProviderUsageRingUnit[] | null;
  /** Short fallback when ringUnit/ringUnits are empty (login / reauth / error / unknown). */
  fallback: string | null;
  /** Safe trigger segment title. */
  title: string;
}

/**
 * Resolve independent ring units from an aggregate projection.
 * Prefer ringUnits when present; fall back to single ringUnit for legacy adapters.
 */
export function resolveAggregateRingUnits(
  projection: Pick<ProviderUsageAggregateProjection, "ringUnit" | "ringUnits">,
): ProviderUsageRingUnit[] {
  if (projection.ringUnits && projection.ringUnits.length > 0) {
    return [...projection.ringUnits];
  }
  return projection.ringUnit ? [projection.ringUnit] : [];
}

/** Fixed grace delay before aggregate hover/focus close (ms). */
export const PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS = 220;

/** Nesting index → stable layer identity token (not risk tone). */
export type ProviderUsageLayerIdentity = "layer-0" | "layer-1" | "layer-2";

export function layerIdentityForIndex(index: number): ProviderUsageLayerIdentity {
  if (index <= 0) return "layer-0";
  if (index === 1) return "layer-1";
  return "layer-2";
}

/** Clamp a known percent into [0, 100]; null stays null (never coerced to 0). */
export function clampUsagePercent(percent: number | null | undefined): number | null {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return null;
  return Math.min(100, Math.max(0, percent));
}

/** Independent per-layer tone from clamped percent. */
export function toneForUsagePercent(percent: number | null | undefined): ProviderUsageRingTone {
  const value = clampUsagePercent(percent);
  if (value === null) return "muted";
  if (value >= 95) return "danger";
  if (value >= 80) return "warning";
  return "normal";
}

/** Format center value line; unknown never becomes "0%". */
export function formatRingCenterValue(
  percent: number | null | undefined,
  unknownCenterValue?: string | null,
): string {
  const value = clampUsagePercent(percent);
  if (value === null) return unknownCenterValue?.trim() || "—";
  return `${Math.round(value)}%`;
}

/**
 * Development/test invariant: center must be the outermost priority-short layer (layers[0]).
 * Returns true when valid; false when invalid (callers must not silent-fallback).
 */
export function isValidRingUnitCenter(unit: ProviderUsageRingUnit): boolean {
  if (!unit.layers.length) return false;
  const outermost = unit.layers[0];
  return Boolean(outermost && unit.centerLayerId === outermost.id);
}

/** Assert center invariant; throws in development/tests when broken. */
export function assertRingUnitCenterInvariant(unit: ProviderUsageRingUnit): void {
  if (!isValidRingUnitCenter(unit)) {
    const outermost = unit.layers[0];
    throw new Error(
      `ProviderUsageRingUnit centerLayerId must equal outermost layer id ` +
        `(expected ${outermost?.id ?? "<missing>"}, got ${unit.centerLayerId})`,
    );
  }
}

/**
 * Resolve the center layer by centerLayerId.
 * Fails loud when missing or not the outermost layer — never silent-falls back.
 */
export function resolveRingUnitCenterLayer(
  unit: ProviderUsageRingUnit,
): ProviderUsageRingLayer {
  assertRingUnitCenterInvariant(unit);
  const center = unit.layers.find((layer) => layer.id === unit.centerLayerId);
  if (!center) {
    throw new Error(
      `ProviderUsageRingUnit centerLayerId ${unit.centerLayerId} not found in layers`,
    );
  }
  return center;
}

/** Build outer→inner aria/title text for a unit. */
export function buildRingUnitAriaLabel(
  layers: readonly ProviderUsageRingLayer[],
  options?: { unknownCenterValue?: string | null; providerLabel?: string },
): string {
  const parts = layers.map((layer) => {
    const value = clampUsagePercent(layer.percent);
    const percentText = value === null ? "未知" : `${Math.round(value)}%`;
    return `${layer.fullLabel} ${percentText}`;
  });
  const outermost = layers[0];
  const centerValue = formatRingCenterValue(outermost?.percent ?? null, options?.unknownCenterValue);
  const centerText = outermost
    ? `中心为外圈优先层 ${outermost.shortLabel} ${centerValue}`
    : "中心未知";
  const prefix = options?.providerLabel ? `${options.providerLabel} ` : "";
  return `${prefix}${parts.join("，")}；${centerText}`;
}

/**
 * Construct a ring unit and lock center to outermost.
 * Adapters/projector should use this so centerLayerId cannot drift.
 */
export function createProviderUsageRingUnit(input: {
  layers: readonly [ProviderUsageRingLayer, ...ProviderUsageRingLayer[]];
  unknownCenterValue?: string | null;
  shortValue?: string | null;
  providerLabel?: string;
  ariaLabel?: string;
}): ProviderUsageRingUnit {
  const outermost = input.layers[0];
  const unit: ProviderUsageRingUnit = {
    layers: input.layers,
    centerLayerId: outermost.id,
    unknownCenterValue: input.unknownCenterValue ?? null,
    shortValue: input.shortValue ?? null,
    ariaLabel:
      input.ariaLabel ??
      buildRingUnitAriaLabel(input.layers, {
        unknownCenterValue: input.unknownCenterValue,
        providerLabel: input.providerLabel,
      }),
  };
  assertRingUnitCenterInvariant(unit);
  return unit;
}

// ---------------------------------------------------------------------------
// Shared duration resolver + window projector
// ---------------------------------------------------------------------------

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MS_WEEK = 7 * MS_DAY;
/** Stable month rank only — not a precise billing duration. */
const MS_MONTH_RANK = 30 * MS_DAY;
/** Stable year rank only — not a precise billing duration. */
const MS_YEAR_RANK = 365 * MS_DAY;

/** Texts that must never become duration evidence on their own. */
const FORBIDDEN_DURATION_TEXT =
  /^(limits?|quota|quota envelope|subscription limits?|remaining|reset|resets? at|resource type|resourceType|provider|gpt|grok|kiro)$/i;

interface ResolvedUsageDuration {
  durationMs: number;
  evidence: string;
}

function normalizeDurationToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Parse a strict numeric period like "90m", "2h", "7d", "1w", "3mo", "1y".
 * Rejects bare numbers and non-period units.
 */
function parseNumericPeriodToken(raw: string): ResolvedUsageDuration | null {
  const token = raw.trim().toLowerCase().replace(/\s+/g, "");
  const match = token.match(/^(\d+(?:\.\d+)?)(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|month|months|y|yr|yrs|year|years)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]!.toLowerCase();
  let durationMs: number;
  let evidenceUnit: string;
  if (unit === "m" || unit.startsWith("min")) {
    durationMs = amount * MS_MINUTE;
    evidenceUnit = "m";
  } else if (unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")) {
    durationMs = amount * MS_HOUR;
    evidenceUnit = "h";
  } else if (unit === "d" || unit.startsWith("day")) {
    durationMs = amount * MS_DAY;
    evidenceUnit = "d";
  } else if (unit === "w" || unit.startsWith("wk") || unit.startsWith("week")) {
    durationMs = amount * MS_WEEK;
    evidenceUnit = "w";
  } else if (unit === "mo" || unit.startsWith("mon") || unit.startsWith("month")) {
    durationMs = amount * MS_MONTH_RANK;
    evidenceUnit = "mo";
  } else {
    durationMs = amount * MS_YEAR_RANK;
    evidenceUnit = "y";
  }
  return { durationMs, evidence: `numeric:${amount}${evidenceUnit}` };
}

/**
 * Parse canonical period tokens / labels into a stable sort rank.
 * Accepts only explicit period vocabulary — never Limits/quota/remaining/reset.
 */
function parseCanonicalPeriodToken(raw: string): ResolvedUsageDuration | null {
  const normalized = normalizeDurationToken(raw);
  if (!normalized || FORBIDDEN_DURATION_TEXT.test(normalized)) return null;

  // Prefer explicit numeric forms first (90m, 2h, 7d, 5h).
  const numeric = parseNumericPeriodToken(normalized.replace(/\s+/g, ""));
  if (numeric) return numeric;
  // Also allow spaced "5 h" / "7 day".
  const spacedNumeric = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|month|months|y|yr|yrs|year|years)$/i,
  );
  if (spacedNumeric) {
    return parseNumericPeriodToken(`${spacedNumeric[1]}${spacedNumeric[2]}`);
  }

  const canonical: Array<{ re: RegExp; durationMs: number; evidence: string }> = [
    { re: /^(five[_\s-]?hour|5\s*h|5h)$/, durationMs: 5 * MS_HOUR, evidence: "token:five_hour" },
    { re: /^(seven[_\s-]?day|7\s*d|7d)$/, durationMs: 7 * MS_DAY, evidence: "token:seven_day" },
    { re: /^(minute|minutely|min|mins|分钟|分鐘)$/, durationMs: MS_MINUTE, evidence: "token:minute" },
    { re: /^(hour|hourly|hr|hrs|小时|時)$/, durationMs: MS_HOUR, evidence: "token:hour" },
    { re: /^(day|daily|日度|每日|日)$/, durationMs: MS_DAY, evidence: "token:day" },
    { re: /^(week|weekly|wk|周度|每周|周)$/, durationMs: MS_WEEK, evidence: "token:week" },
    { re: /^(month|monthly|mo|月度|每月|月)$/, durationMs: MS_MONTH_RANK, evidence: "token:month" },
    { re: /^(year|yearly|annual|annually|yr|年)$/, durationMs: MS_YEAR_RANK, evidence: "token:year" },
  ];
  for (const rule of canonical) {
    if (rule.re.test(normalized)) {
      return { durationMs: rule.durationMs, evidence: rule.evidence };
    }
  }

  // Reject remaining/reset/resourceType/Limits/quota when they lead the text.
  // Labels like "周额度" keep period words and are handled by embedded rules below.
  if (
    FORBIDDEN_DURATION_TEXT.test(normalized)
    || /^(remaining\b|reset\b|resets?\b|resource\s*type\b|limits?\b|quota\b)/i.test(normalized)
  ) {
    return null;
  }

  // Word-boundary / CJK period detection for longer display labels.
  // Avoid \b around CJK (JS word boundaries are ASCII-oriented).
  const embedded: Array<{ re: RegExp; durationMs: number; evidence: string }> = [
    { re: /(?:^|\s)90\s*m(?:\s|$)|\b90m\b/, durationMs: 90 * MS_MINUTE, evidence: "label:90m" },
    { re: /(?:^|\s)2\s*h(?:\s|$)|\b2h\b/, durationMs: 2 * MS_HOUR, evidence: "label:2h" },
    { re: /(?:^|\s)5\s*h(?:\s|$)|\b5h\b|five[_\s-]?hour/, durationMs: 5 * MS_HOUR, evidence: "label:5h" },
    { re: /(?:^|\s)7\s*d(?:\s|$)|\b7d\b|seven[_\s-]?day/, durationMs: 7 * MS_DAY, evidence: "label:7d" },
    { re: /\b(minute|minutely)\b|分钟|分鐘/, durationMs: MS_MINUTE, evidence: "label:minute" },
    { re: /\b(hour|hourly)\b|小时|時/, durationMs: MS_HOUR, evidence: "label:hour" },
    { re: /\b(day|daily)\b|日度|每日/, durationMs: MS_DAY, evidence: "label:day" },
    { re: /\b(week|weekly)\b|周度|每周|周/, durationMs: MS_WEEK, evidence: "label:week" },
    { re: /\b(month|monthly)\b|月度|每月|月/, durationMs: MS_MONTH_RANK, evidence: "label:month" },
    { re: /\b(year|yearly|annual|annually)\b|年/, durationMs: MS_YEAR_RANK, evidence: "label:year" },
  ];
  for (const rule of embedded) {
    if (rule.re.test(normalized) || rule.re.test(raw)) {
      // Reject when the only "match" is a forbidden generic envelope.
      if (/^(limits?|quota|quota envelope|subscription limits?)$/i.test(normalized)) {
        return null;
      }
      return { durationMs: rule.durationMs, evidence: rule.evidence };
    }
  }
  return null;
}

/**
 * Shared duration resolver.
 *
 * Accepts:
 * - explicit positive finite durationMs
 * - strict canonical period tokens/labels (90m, 2h, 7d, weekly, monthly, …)
 *
 * Rejects:
 * - provider identity, array/field/id order, percent, remaining, resetAt,
 *   resourceType, and bare Limits/quota envelope text
 */
export function resolveUsageWindowDuration(input: {
  durationMs?: number | null;
  durationEvidence?: string | null;
  token?: string | null;
  label?: string | null;
}): ResolvedUsageDuration | null {
  const explicit = input.durationMs;
  if (explicit !== null && explicit !== undefined) {
    if (!Number.isFinite(explicit) || explicit <= 0) return null;
    return {
      durationMs: explicit,
      evidence: input.durationEvidence?.trim() || "explicit:durationMs",
    };
  }

  const sources = [input.durationEvidence, input.token, input.label];
  for (const source of sources) {
    if (!source || !source.trim()) continue;
    const resolved = parseCanonicalPeriodToken(source);
    if (resolved) return resolved;
  }
  return null;
}

function isDisplayableCandidate(candidate: ProviderUsageWindowCandidate): boolean {
  if (!candidate.present || !candidate.trusted) return false;
  if (!candidate.id?.trim()) return false;
  if (!candidate.shortLabel?.trim()) return false;
  if (!candidate.fullLabel?.trim()) return false;
  if (!candidate.title?.trim()) return false;
  return true;
}

function candidateToLayer(
  candidate: ProviderUsageWindowCandidate,
  orderEvidence?: string,
): ProviderUsageRingLayer {
  return {
    id: candidate.id,
    shortLabel: candidate.shortLabel,
    fullLabel: candidate.fullLabel,
    percent: clampUsagePercent(candidate.percent),
    title: candidate.title,
    orderEvidence,
  };
}

function emptyProjection(
  mode: ProviderUsageWindowProjectionMode = "empty",
  detailOnlyCandidateIds: string[] = [],
): ProviderUsageWindowProjection {
  return {
    ringUnit: null,
    detailOnlyCandidateIds,
    detailNote: detailOnlyCandidateIds.length > 0 ? PROVIDER_USAGE_DETAIL_ONLY_NOTE : null,
    mode,
  };
}

/**
 * Pure shared projector: unordered safe candidates → outer-shortest ring unit.
 *
 * - 1 safe candidate → single ring (duration may be unknown)
 * - multi → only unique trusted duration ranks, short→long
 * - unknown duration / duration ties → detail-only (never id/array order)
 * - 0 projected from multi → detail-only (no fabricated ring/center)
 * - centerLayerId always equals final layers[0].id
 * - outer percent unknown uses same-bucket unknownCenterValue only
 *
 * Provider key is intentionally not accepted — output is provider-independent.
 */
export function projectProviderUsageWindows(
  candidates: readonly ProviderUsageWindowCandidate[],
  options?: {
    providerLabel?: string;
    shortValue?: string | null;
  },
): ProviderUsageWindowProjection {
  const safe = candidates.filter(isDisplayableCandidate);
  if (safe.length === 0) {
    return emptyProjection("empty");
  }

  if (safe.length === 1) {
    const only = safe[0]!;
    const resolved = resolveUsageWindowDuration({
      durationMs: only.durationMs,
      durationEvidence: only.durationEvidence,
      label: only.fullLabel || only.shortLabel,
    });
    const layer = candidateToLayer(only, resolved?.evidence);
    const ringUnit = createProviderUsageRingUnit({
      layers: [layer],
      unknownCenterValue: layer.percent === null ? (only.unknownCenterValue ?? null) : null,
      shortValue: options?.shortValue ?? null,
      providerLabel: options?.providerLabel,
    });
    return {
      ringUnit,
      detailOnlyCandidateIds: [],
      detailNote: null,
      mode: "single",
    };
  }

  // Multi-candidate: only unique trusted ranks join radial layout.
  type Ranked = {
    candidate: ProviderUsageWindowCandidate;
    resolved: ResolvedUsageDuration;
  };
  const ranked: Ranked[] = [];
  for (const candidate of safe) {
    const resolved = resolveUsageWindowDuration({
      durationMs: candidate.durationMs,
      durationEvidence: candidate.durationEvidence,
      label: candidate.fullLabel || candidate.shortLabel,
    });
    if (!resolved) continue; // unknown duration stays detail-only via leftoverIds below
    ranked.push({ candidate, resolved });
  }

  // Group by duration rank; any rank with >1 window is a radial tie → all detail-only.
  const byRank = new Map<number, Ranked[]>();
  for (const entry of ranked) {
    const list = byRank.get(entry.resolved.durationMs) ?? [];
    list.push(entry);
    byRank.set(entry.resolved.durationMs, list);
  }

  const uniqueRanked: Ranked[] = [];
  for (const [, group] of byRank) {
    if (group.length === 1) {
      uniqueRanked.push(group[0]!);
    }
    // Tied ranks intentionally omitted — no id/array order to break ties.
  }

  // Sort short → long by duration only (no id / array order).
  uniqueRanked.sort((a, b) => a.resolved.durationMs - b.resolved.durationMs);

  // Detail-only leftovers = unknown duration + tied ranks (any non-projected safe ids).
  // Listing follows safe-candidate membership order only for stable note ids; ring order is duration-only.
  const projectedIdSet = new Set(uniqueRanked.map((entry) => entry.candidate.id));
  const leftoverIds = safe
    .filter((candidate) => !projectedIdSet.has(candidate.id))
    .map((candidate) => candidate.id);

  if (uniqueRanked.length === 0) {
    return emptyProjection("detail-only", leftoverIds);
  }

  const layers = uniqueRanked.map((entry) =>
    candidateToLayer(entry.candidate, entry.resolved.evidence),
  ) as [ProviderUsageRingLayer, ...ProviderUsageRingLayer[]];
  const outermost = uniqueRanked[0]!;
  const outerLayer = layers[0]!;
  const ringUnit = createProviderUsageRingUnit({
    layers,
    unknownCenterValue:
      outerLayer.percent === null ? (outermost.candidate.unknownCenterValue ?? null) : null,
    shortValue: options?.shortValue ?? null,
    providerLabel: options?.providerLabel,
  });

  const mode: ProviderUsageWindowProjectionMode =
    uniqueRanked.length === 1
      ? leftoverIds.length > 0
        ? "degraded-single"
        : "single"
      : "ordered-multi";

  return {
    ringUnit,
    detailOnlyCandidateIds: leftoverIds,
    detailNote: leftoverIds.length > 0 ? PROVIDER_USAGE_DETAIL_ONLY_NOTE : null,
    mode,
  };
}

/** Aggregate risk rank for overall trigger status (danger > warning > normal > muted). */
export function rankProviderUsageRisk(risk: ProviderUsageRisk): number {
  switch (risk) {
    case "danger":
      return 3;
    case "warning":
      return 2;
    case "normal":
      return 1;
    case "muted":
    default:
      return 0;
  }
}

export function resolveOverallProviderUsageRisk(
  risks: readonly ProviderUsageRisk[],
): ProviderUsageRisk {
  if (risks.length === 0) return "muted";
  if (risks.every((risk) => risk === "muted")) return "muted";
  let best: ProviderUsageRisk = "muted";
  for (const risk of risks) {
    if (rankProviderUsageRisk(risk) > rankProviderUsageRisk(best)) {
      best = risk;
    }
  }
  return best === "muted" && risks.some((risk) => risk === "normal") ? "normal" : best;
}

/** Forbidden projection field names — aggregate shell / tests scan for these. */
export const PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS = [
  "accountId",
  "credential",
  "profileArn",
  "clientSecret",
  "access_token",
  "refresh_token",
  "projectId",
  "rawError",
  "rawBody",
  "rawResponse",
] as const;
