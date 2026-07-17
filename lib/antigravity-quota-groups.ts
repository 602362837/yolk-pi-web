/**
 * antigravity-quota-groups — fixed 0.3.0 quotaKey → model-group mapping
 * and conservative group aggregation for display only.
 *
 * Pure helpers only: no React, network, fs, or package private src paths.
 *
 * ## Rules
 *
 * - Every known 0.3.0 public id and acceptedQuotaKey has deterministic membership.
 * - Shared routing keys (e.g. gemini-3-flash-agent) belong to exactly one group.
 * - Unknown keys map to `other`.
 * - Group used = max(variants.usedPercent); remaining = min(variants.remainingFraction).
 * - Never average/sum across variants or groups.
 * - `resetsAt` is earliest parseable ISO for display copy only — never duration.
 * - Aggregation is for UsagePanel / Models UI only; failover stays model-key aware.
 */

import type { AntigravityQuotaModelWindow } from "@/lib/antigravity-subscription-quota";
import {
  ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0,
  labelForAntigravityQuotaKey,
} from "@/lib/antigravity-model-quota";

/** Fixed display groups. Order is the accordion / detail order. */
export type AntigravityQuotaGroupId =
  | "gemini-3-flash"
  | "claude-opus"
  | "claude-sonnet"
  | "gemini-pro"
  | "gemini-2.5"
  | "other";

/** Stable group order: Flash → Opus → Sonnet → Pro → 2.5 → Other. */
export const ANTIGRAVITY_QUOTA_GROUP_ORDER: readonly AntigravityQuotaGroupId[] = [
  "gemini-3-flash",
  "claude-opus",
  "claude-sonnet",
  "gemini-pro",
  "gemini-2.5",
  "other",
] as const;

/**
 * Priority groups that may become independent top-bar ring slots (AG-G02).
 * Order: Flash then Opus. Never concentric layers of one unit.
 */
export const ANTIGRAVITY_PRIORITY_RING_GROUP_IDS: readonly AntigravityQuotaGroupId[] = [
  "gemini-3-flash",
  "claude-opus",
] as const;

export interface AntigravityQuotaGroupMeta {
  id: AntigravityQuotaGroupId;
  /** Full group label for accordion / title. */
  label: string;
  /** Compact ring / chip label. */
  shortLabel: string;
  /** Whether this group is a top-bar independent ring candidate. */
  priorityRing: boolean;
  /** Index in ANTIGRAVITY_QUOTA_GROUP_ORDER. */
  order: number;
}

const GROUP_META: Record<AntigravityQuotaGroupId, AntigravityQuotaGroupMeta> = {
  "gemini-3-flash": {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash 组",
    shortLabel: "G",
    priorityRing: true,
    order: 0,
  },
  "claude-opus": {
    id: "claude-opus",
    label: "Claude Opus 组",
    shortLabel: "A",
    priorityRing: true,
    order: 1,
  },
  "claude-sonnet": {
    id: "claude-sonnet",
    label: "Claude Sonnet 组",
    shortLabel: "Sonnet",
    priorityRing: false,
    order: 2,
  },
  "gemini-pro": {
    id: "gemini-pro",
    label: "Gemini Pro 组",
    shortLabel: "Pro",
    priorityRing: false,
    order: 3,
  },
  "gemini-2.5": {
    id: "gemini-2.5",
    label: "Gemini 2.5 组",
    shortLabel: "2.5",
    priorityRing: false,
    order: 4,
  },
  other: {
    id: "other",
    label: "其他模型",
    shortLabel: "其他",
    priorityRing: false,
    order: 5,
  },
};

/**
 * Fixed quotaKey / public-id → groupId table for 0.3.0.
 *
 * Covers every public catalog id and every acceptedQuotaKey from
 * `ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0`. Shared routing keys appear once.
 *
 * Flash family (including gemini-3.5-flash variants) → gemini-3-flash priority group.
 * Opus 4.5 / 4.6 (+ thinking) → claude-opus (label emphasizes Opus; ring short = Opus).
 */
export const ANTIGRAVITY_QUOTA_KEY_TO_GROUP_0_3_0: Readonly<
  Record<string, AntigravityQuotaGroupId>
> = {
  // Claude Opus (priority ring)
  "claude-opus-4-5": "claude-opus",
  "claude-opus-4-5-thinking": "claude-opus",
  "claude-opus-4-6": "claude-opus",
  "claude-opus-4-6-thinking": "claude-opus",

  // Claude Sonnet
  "claude-sonnet-4-5": "claude-sonnet",
  "claude-sonnet-4-5-thinking": "claude-sonnet",
  "claude-sonnet-4-6": "claude-sonnet",

  // Gemini 2.5 family
  "gemini-2.5-flash": "gemini-2.5",
  "gemini-2.5-flash-thinking": "gemini-2.5",
  "gemini-2.5-flash-lite": "gemini-2.5",
  "gemini-2.5-pro": "gemini-2.5",

  // Gemini 3 / 3.5 Flash family (priority ring) — shared routing keys once
  "gemini-3-flash": "gemini-3-flash",
  "gemini-3-flash-agent": "gemini-3-flash",
  "gemini-3.5-flash": "gemini-3-flash",
  "gemini-3.5-flash-extra-low": "gemini-3-flash",
  "gemini-3.5-flash-low": "gemini-3-flash",

  // Gemini Pro family (3 / 3.1)
  "gemini-3-pro": "gemini-pro",
  "gemini-3-pro-low": "gemini-pro",
  "gemini-3-pro-high": "gemini-pro",
  "gemini-3.1-pro": "gemini-pro",
  "gemini-3.1-pro-low": "gemini-pro",
  "gemini-pro-agent": "gemini-pro",

  // Other catalog models (detail only)
  "gemini-3.1-flash-image": "other",
  "gemini-3.1-flash-lite": "other",
  "gpt-oss-120b": "other",
  "gpt-oss-120b-medium": "other",
  tab_flash_lite_preview: "other",
  tab_jump_flash_lite_preview: "other",
};

export interface AntigravityQuotaGroupVariant {
  id: string;
  label: string;
  publicModelIds: string[];
  remainingFraction: number;
  usedPercent: number;
  /** ISO reset time when present; display only. */
  resetsAt?: string;
}

export interface AntigravityQuotaGroupAggregate {
  groupId: AntigravityQuotaGroupId;
  label: string;
  shortLabel: string;
  priorityRing: boolean;
  /** Conservative: max(variant.usedPercent). */
  usedPercent: number;
  /** Conservative: min(variant.remainingFraction). */
  remainingFraction: number;
  /** Earliest parseable resetsAt among variants; display only, never duration. */
  resetsAt?: string;
  /** Deduped variants sorted by id for stable detail. */
  variants: AntigravityQuotaGroupVariant[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Safe window for group aggregation: finite remaining in [0,1] and finite used%.
 * Local copy so this module never depends on usage-ring (avoids cycles).
 */
export function isSafeAntigravityQuotaGroupWindow(
  model: AntigravityQuotaModelWindow | null | undefined,
): model is AntigravityQuotaModelWindow {
  if (!model || typeof model.id !== "string" || !model.id.trim()) return false;
  if (!Number.isFinite(model.remainingFraction)) return false;
  if (model.remainingFraction < 0 || model.remainingFraction > 1) return false;
  if (!Number.isFinite(model.usedPercent)) return false;
  return true;
}

/** Metadata for a group id (unknown falls back to `other`). */
export function getAntigravityQuotaGroupMeta(
  groupId: AntigravityQuotaGroupId | string,
): AntigravityQuotaGroupMeta {
  if (groupId in GROUP_META) {
    return GROUP_META[groupId as AntigravityQuotaGroupId];
  }
  return GROUP_META.other;
}

/** All group metas in fixed display order. */
export function listAntigravityQuotaGroupMetas(): readonly AntigravityQuotaGroupMeta[] {
  return ANTIGRAVITY_QUOTA_GROUP_ORDER.map((id) => GROUP_META[id]);
}

/** Whether the group is a top-bar independent ring candidate. */
export function isAntigravityPriorityRingGroup(
  groupId: AntigravityQuotaGroupId | string,
): boolean {
  return groupId === "gemini-3-flash" || groupId === "claude-opus";
}

/**
 * Resolve quota / public model key to a fixed group.
 * Unknown / empty → `other`. Never invents a new group id.
 */
export function resolveAntigravityQuotaGroupId(
  quotaKey: string | null | undefined,
): AntigravityQuotaGroupId {
  if (!isNonEmptyString(quotaKey)) return "other";
  const key = quotaKey.trim();
  const direct = ANTIGRAVITY_QUOTA_KEY_TO_GROUP_0_3_0[key];
  if (direct) return direct;

  // Live fetchAvailableModels often returns sibling keys not present in the
  // fixed 0.3.0 catalog table (e.g. gemini-3.1-pro-high, gemini-3.1-flash-lite).
  // Map by family so shared quota pools do not explode into many fake groups.
  const lower = key.toLowerCase();
  if (lower.includes("claude-opus")) return "claude-opus";
  if (lower.includes("claude-sonnet")) return "claude-sonnet";
  if (lower.includes("gemini-2.5")) return "gemini-2.5";
  // Flash-lite / flash-image are not the Flash priority ring family.
  if (
    (lower.includes("flash-lite") || lower.includes("flash_image") || lower.includes("flash-image"))
    && lower.includes("gemini")
  ) {
    return "other";
  }
  if (lower.includes("gemini") && lower.includes("flash")) return "gemini-3-flash";
  if (lower.includes("gemini") && (lower.includes("pro") || lower.includes("agent"))) {
    return "gemini-pro";
  }
  return "other";
}

/**
 * Live Antigravity quota often exposes one shared remainingFraction/resetTime
 * across many model keys (one Gemini pool + one Claude/GPT pool). For UI/ring
 * presentation, collapse windows that share the same remaining+reset signature
 * into a single display group so users do not see five groups all at 7%.
 */
export function antigravitySharedQuotaPoolKey(
  window: Pick<AntigravityQuotaModelWindow, "remainingFraction" | "resetsAt">,
): string {
  const remaining = Number.isFinite(window.remainingFraction)
    ? window.remainingFraction.toFixed(6)
    : "unknown";
  const reset = isNonEmptyString(window.resetsAt) ? window.resetsAt.trim() : "none";
  return `${remaining}|${reset}`;
}

function preferredGroupIdAmong(ids: Iterable<AntigravityQuotaGroupId>): AntigravityQuotaGroupId {
  const set = new Set(ids);
  for (const id of ANTIGRAVITY_QUOTA_GROUP_ORDER) {
    if (set.has(id)) return id;
  }
  return "other";
}

/**
 * Every 0.3.0 public id + acceptedQuotaKey that the fixed table must cover.
 * Used by contract tests; not a runtime health check.
 */
export function listKnownAntigravityQuotaKeysForGroups(): string[] {
  const keys = new Set<string>();
  for (const entry of ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0) {
    keys.add(entry.id);
    for (const key of entry.acceptedQuotaKeys) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Parse resetsAt to epoch ms for earliest selection only.
 * Invalid / missing → null (never treated as duration evidence).
 */
function resetsAtEpochMs(resetsAt: string | undefined): number | null {
  if (!isNonEmptyString(resetsAt)) return null;
  const ms = Date.parse(resetsAt.trim());
  return Number.isFinite(ms) ? ms : null;
}

function toVariant(window: AntigravityQuotaModelWindow): AntigravityQuotaGroupVariant {
  const label =
    (typeof window.label === "string" && window.label.trim())
      || labelForAntigravityQuotaKey(window.id);
  const publicModelIds = Array.isArray(window.publicModelIds)
    ? window.publicModelIds.filter((id): id is string => isNonEmptyString(id))
    : [];
  const variant: AntigravityQuotaGroupVariant = {
    id: window.id.trim(),
    label,
    publicModelIds: [...publicModelIds],
    remainingFraction: window.remainingFraction,
    usedPercent: window.usedPercent,
  };
  if (isNonEmptyString(window.resetsAt)) {
    variant.resetsAt = window.resetsAt.trim();
  }
  return variant;
}

/**
 * Merge two safe windows with the same id conservatively:
 * max(used), min(remaining), earliest resetsAt.
 */
function mergeSameIdWindows(
  a: AntigravityQuotaModelWindow,
  b: AntigravityQuotaModelWindow,
): AntigravityQuotaModelWindow {
  const usedPercent = Math.max(a.usedPercent, b.usedPercent);
  const remainingFraction = Math.min(a.remainingFraction, b.remainingFraction);
  const aMs = resetsAtEpochMs(a.resetsAt);
  const bMs = resetsAtEpochMs(b.resetsAt);
  let resetsAt: string | undefined;
  if (aMs !== null && bMs !== null) {
    resetsAt = aMs <= bMs ? a.resetsAt : b.resetsAt;
  } else if (aMs !== null) {
    resetsAt = a.resetsAt;
  } else if (bMs !== null) {
    resetsAt = b.resetsAt;
  } else if (isNonEmptyString(a.resetsAt)) {
    resetsAt = a.resetsAt;
  } else if (isNonEmptyString(b.resetsAt)) {
    resetsAt = b.resetsAt;
  }

  const publicIds = new Set<string>();
  for (const id of a.publicModelIds ?? []) {
    if (isNonEmptyString(id)) publicIds.add(id.trim());
  }
  for (const id of b.publicModelIds ?? []) {
    if (isNonEmptyString(id)) publicIds.add(id.trim());
  }

  const label =
    (typeof a.label === "string" && a.label.trim())
    || (typeof b.label === "string" && b.label.trim())
    || a.id;

  const merged: AntigravityQuotaModelWindow = {
    id: a.id,
    label,
    publicModelIds: [...publicIds],
    remainingFraction,
    usedPercent,
  };
  if (resetsAt) merged.resetsAt = resetsAt;
  return merged;
}

/**
 * Group safe quota windows by fixed quotaKey→group mapping.
 *
 * - Dedupe by window.id (conservative merge if duplicates).
 * - Filter unsafe windows.
 * - Aggregate max(usedPercent) / min(remainingFraction).
 * - Optional earliest resetsAt for display only.
 * - Variants sorted by id; empty groups omitted.
 * - Never average/sum; never use resetTime as duration.
 */
export function groupByAntigravityQuotaWindows(
  windows: readonly AntigravityQuotaModelWindow[] | null | undefined,
): AntigravityQuotaGroupAggregate[] {
  if (!windows || windows.length === 0) return [];

  // Dedupe by id with conservative merge.
  const byId = new Map<string, AntigravityQuotaModelWindow>();
  for (const raw of windows) {
    if (!isSafeAntigravityQuotaGroupWindow(raw)) continue;
    const id = raw.id.trim();
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        label: raw.label,
        publicModelIds: [...(raw.publicModelIds ?? [])],
        remainingFraction: raw.remainingFraction,
        usedPercent: raw.usedPercent,
        ...(isNonEmptyString(raw.resetsAt) ? { resetsAt: raw.resetsAt.trim() } : {}),
      });
      continue;
    }
    byId.set(id, mergeSameIdWindows(existing, { ...raw, id }));
  }

  if (byId.size === 0) return [];

  // Collapse shared live quota pools: many model keys often share the exact same
  // remainingFraction + resetsAt (Gemini pool vs Claude/GPT pool). Assign each
  // shared pool to one preferred group so the UI does not show 5 groups at 7%.
  const poolMembers = new Map<string, AntigravityQuotaModelWindow[]>();
  for (const window of byId.values()) {
    const poolKey = antigravitySharedQuotaPoolKey(window);
    const list = poolMembers.get(poolKey) ?? [];
    list.push(window);
    poolMembers.set(poolKey, list);
  }
  const windowGroupId = new Map<string, AntigravityQuotaGroupId>();
  for (const members of poolMembers.values()) {
    const candidateIds = members.map((window) => resolveAntigravityQuotaGroupId(window.id));
    const groupId = preferredGroupIdAmong(candidateIds);
    for (const window of members) {
      windowGroupId.set(window.id, groupId);
    }
  }

  type Acc = {
    meta: AntigravityQuotaGroupMeta;
    usedPercent: number;
    remainingFraction: number;
    earliestMs: number | null;
    earliestResetsAt: string | undefined;
    variants: AntigravityQuotaGroupVariant[];
  };

  const groups = new Map<AntigravityQuotaGroupId, Acc>();

  for (const window of byId.values()) {
    const groupId = windowGroupId.get(window.id) ?? resolveAntigravityQuotaGroupId(window.id);
    const meta = getAntigravityQuotaGroupMeta(groupId);
    const variant = toVariant(window);
    const existing = groups.get(groupId);
    if (!existing) {
      const ms = resetsAtEpochMs(variant.resetsAt);
      groups.set(groupId, {
        meta,
        usedPercent: variant.usedPercent,
        remainingFraction: variant.remainingFraction,
        earliestMs: ms,
        earliestResetsAt: ms !== null ? variant.resetsAt : undefined,
        variants: [variant],
      });
      continue;
    }

    existing.usedPercent = Math.max(existing.usedPercent, variant.usedPercent);
    existing.remainingFraction = Math.min(
      existing.remainingFraction,
      variant.remainingFraction,
    );
    const ms = resetsAtEpochMs(variant.resetsAt);
    if (ms !== null && (existing.earliestMs === null || ms < existing.earliestMs)) {
      existing.earliestMs = ms;
      existing.earliestResetsAt = variant.resetsAt;
    }
    existing.variants.push(variant);
  }

  const result: AntigravityQuotaGroupAggregate[] = [];
  for (const groupId of ANTIGRAVITY_QUOTA_GROUP_ORDER) {
    const acc = groups.get(groupId);
    if (!acc || acc.variants.length === 0) continue;
    acc.variants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const aggregate: AntigravityQuotaGroupAggregate = {
      groupId,
      label: acc.meta.label,
      shortLabel: acc.meta.shortLabel,
      priorityRing: acc.meta.priorityRing,
      usedPercent: acc.usedPercent,
      remainingFraction: acc.remainingFraction,
      variants: acc.variants,
    };
    if (acc.earliestResetsAt) {
      aggregate.resetsAt = acc.earliestResetsAt;
    }
    result.push(aggregate);
  }
  return result;
}
