/**
 * antigravity-model-quota — fixed 0.3.0 public-model ↔ quota-key compatibility
 *
 * Web maintains a static mapping audited against
 * `@yofriadi/pi-antigravity-oauth@0.3.0` catalog + request-time routing.
 * Production code must never runtime-import package private `src/**` mapping.
 *
 * ## Rules
 *
 * - Every public catalog model id is either mapped to one or more accepted
 *   quota keys, or explicitly marked failover-unsupported.
 * - Failover candidate selection only accepts a fresh/live quota entry whose
 *   key is in the current public model's accepted key set.
 * - Quota for other models never proves the current model is usable.
 * - Default project id is irrelevant here; health evidence is live matching
 *   quota only (enforced by callers).
 */

/** Locked package version this table is compatible with. */
export const ANTIGRAVITY_MODEL_QUOTA_PACKAGE_VERSION = "0.3.0";

/** Maximum public ids attached to one quota window on the wire. */
export const MAX_PUBLIC_MODEL_IDS_PER_WINDOW = 8;

/** Bounded key / label lengths for wire projection. */
export const MAX_QUOTA_MODEL_KEY_LEN = 96;
export const MAX_QUOTA_MODEL_LABEL_LEN = 80;

/**
 * Public catalog model ids from `@yofriadi/pi-antigravity-oauth@0.3.0`.
 * Order is stable for contract tests; not a ranking for UI or failover.
 */
export const ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0 = [
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro",
  "gemini-3.5-flash",
  "gpt-oss-120b",
  "tab_flash_lite_preview",
  "tab_jump_flash_lite_preview",
] as const;

export type AntigravityPublicModelId0_3_0 =
  (typeof ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0)[number];

export interface AntigravityPublicModelCatalogEntry {
  id: AntigravityPublicModelId0_3_0;
  /** Safe display label derived from the 0.3.0 catalog name. */
  label: string;
  /**
   * Accepted quota / request model keys for this public id.
   * Empty means explicitly unsupported for model-aware failover.
   */
  acceptedQuotaKeys: readonly string[];
  /** When false, failover must fail closed for this public id. */
  failoverSupported: boolean;
}

/**
 * Fixed 0.3.0 compatibility table.
 *
 * Accepted keys include:
 * - the public catalog id itself when quota may report it under that key
 * - request-time routing ids used by the package stream adapter
 *
 * Keys are unique per public model for reverse projection; a shared request
 * id (e.g. gemini-3-flash-agent) may appear under multiple public models.
 */
export const ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0: readonly AntigravityPublicModelCatalogEntry[] =
  [
    {
      id: "claude-opus-4-5",
      label: "Claude Opus 4.5",
      acceptedQuotaKeys: ["claude-opus-4-5", "claude-opus-4-5-thinking"],
      failoverSupported: true,
    },
    {
      id: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      acceptedQuotaKeys: ["claude-opus-4-6", "claude-opus-4-6-thinking"],
      failoverSupported: true,
    },
    {
      id: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      acceptedQuotaKeys: ["claude-sonnet-4-5", "claude-sonnet-4-5-thinking"],
      failoverSupported: true,
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      acceptedQuotaKeys: ["claude-sonnet-4-6"],
      failoverSupported: true,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      acceptedQuotaKeys: ["gemini-2.5-flash", "gemini-2.5-flash-thinking"],
      failoverSupported: true,
    },
    {
      id: "gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash Lite",
      acceptedQuotaKeys: ["gemini-2.5-flash-lite"],
      failoverSupported: true,
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      acceptedQuotaKeys: ["gemini-2.5-pro"],
      failoverSupported: true,
    },
    {
      id: "gemini-3-flash",
      label: "Gemini 3 Flash",
      acceptedQuotaKeys: [
        "gemini-3-flash",
        "gemini-3-flash-agent",
        "gemini-3.5-flash-extra-low",
        "gemini-3.5-flash-low",
      ],
      failoverSupported: true,
    },
    {
      id: "gemini-3-pro",
      label: "Gemini 3 Pro",
      acceptedQuotaKeys: ["gemini-3-pro", "gemini-3-pro-low", "gemini-3-pro-high"],
      failoverSupported: true,
    },
    {
      id: "gemini-3.1-flash-image",
      label: "Gemini 3.1 Flash Image",
      acceptedQuotaKeys: ["gemini-3.1-flash-image"],
      failoverSupported: true,
    },
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash Lite",
      acceptedQuotaKeys: ["gemini-3.1-flash-lite"],
      failoverSupported: true,
    },
    {
      id: "gemini-3.1-pro",
      label: "Gemini 3.1 Pro",
      acceptedQuotaKeys: [
        "gemini-3.1-pro",
        "gemini-3.1-pro-low",
        "gemini-pro-agent",
      ],
      failoverSupported: true,
    },
    {
      id: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      acceptedQuotaKeys: [
        "gemini-3.5-flash",
        "gemini-3.5-flash-extra-low",
        "gemini-3.5-flash-low",
        "gemini-3-flash-agent",
      ],
      failoverSupported: true,
    },
    {
      id: "gpt-oss-120b",
      label: "GPT-OSS 120B",
      acceptedQuotaKeys: ["gpt-oss-120b", "gpt-oss-120b-medium"],
      failoverSupported: true,
    },
    {
      id: "tab_flash_lite_preview",
      label: "tab_flash_lite_preview",
      acceptedQuotaKeys: ["tab_flash_lite_preview"],
      failoverSupported: true,
    },
    {
      id: "tab_jump_flash_lite_preview",
      label: "tab_jump_flash_lite_preview",
      acceptedQuotaKeys: ["tab_jump_flash_lite_preview"],
      failoverSupported: true,
    },
  ] as const;

const publicModelById = new Map<string, AntigravityPublicModelCatalogEntry>(
  ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0.map((entry) => [entry.id, entry]),
);

/** Reverse index: quota/request key → public catalog ids that accept it. */
const publicIdsByQuotaKey = new Map<string, string[]>();
for (const entry of ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0) {
  for (const key of entry.acceptedQuotaKeys) {
    const list = publicIdsByQuotaKey.get(key) ?? [];
    if (!list.includes(entry.id)) list.push(entry.id);
    publicIdsByQuotaKey.set(key, list);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Look up the fixed catalog entry for a public model id.
 * Unknown ids return null (fail closed for failover).
 */
export function getAntigravityPublicModelEntry(
  publicModelId: string,
): AntigravityPublicModelCatalogEntry | null {
  if (!isNonEmptyString(publicModelId)) return null;
  return publicModelById.get(publicModelId.trim()) ?? null;
}

/**
 * Accepted quota keys for a public model id.
 * Empty array means unknown or explicitly unsupported — callers must fail closed.
 */
export function getAcceptedAntigravityQuotaKeys(publicModelId: string): readonly string[] {
  const entry = getAntigravityPublicModelEntry(publicModelId);
  if (!entry || !entry.failoverSupported) return [];
  return entry.acceptedQuotaKeys;
}

/**
 * Whether model-aware failover may consider this public model id.
 * Unknown / unmapped / empty-key entries are unsupported.
 */
export function isAntigravityPublicModelFailoverSupported(publicModelId: string): boolean {
  const entry = getAntigravityPublicModelEntry(publicModelId);
  return Boolean(entry && entry.failoverSupported && entry.acceptedQuotaKeys.length > 0);
}

/**
 * Public catalog ids that accept a given quota/request model key.
 * Used when projecting a quota window's `publicModelIds`.
 */
export function getPublicModelIdsForQuotaKey(quotaKey: string): string[] {
  if (!isNonEmptyString(quotaKey)) return [];
  const key = quotaKey.trim();
  const mapped = publicIdsByQuotaKey.get(key);
  if (mapped && mapped.length > 0) {
    return mapped.slice(0, MAX_PUBLIC_MODEL_IDS_PER_WINDOW);
  }
  // Exact public id reported as quota key.
  if (publicModelById.has(key)) return [key];
  return [];
}

/**
 * Safe display label for a quota model key.
 * Prefers the first mapped public catalog label; otherwise a sanitized key.
 */
export function labelForAntigravityQuotaKey(quotaKey: string): string {
  const publicIds = getPublicModelIdsForQuotaKey(quotaKey);
  for (const id of publicIds) {
    const entry = publicModelById.get(id);
    if (entry) return entry.label.slice(0, MAX_QUOTA_MODEL_LABEL_LEN);
  }
  const sanitized = quotaKey
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, MAX_QUOTA_MODEL_LABEL_LEN);
  return sanitized || "Model";
}

/**
 * Resolve the first matching quota window for a public model among normalized
 * model windows. Used by model-aware failover (remainingFraction > 0 check is
 * the caller's responsibility).
 *
 * Fail-closed: unknown public model, unsupported mapping, or no matching
 * window returns null. Does not invent zero remaining.
 */
export function findAntigravityQuotaWindowForPublicModel<
  T extends { id: string; remainingFraction: number },
>(publicModelId: string, windows: readonly T[]): T | null {
  const keys = getAcceptedAntigravityQuotaKeys(publicModelId);
  if (keys.length === 0) return null;
  const keySet = new Set(keys);
  for (const window of windows) {
    if (keySet.has(window.id)) return window;
  }
  return null;
}

/**
 * Contract helper: every 0.3.0 public catalog id must appear exactly once in
 * the fixed table. Used by tests; not a runtime health check.
 */
export function listAntigravityPublicModelIds(): readonly string[] {
  return ANTIGRAVITY_PUBLIC_MODEL_IDS_0_3_0;
}

/**
 * Contract helper: return failover-unsupported public ids (empty accepted keys
 * or failoverSupported=false). Currently none for 0.3.0; kept for explicitness.
 */
export function listAntigravityFailoverUnsupportedPublicModelIds(): string[] {
  return ANTIGRAVITY_PUBLIC_MODEL_QUOTA_TABLE_0_3_0
    .filter((entry) => !entry.failoverSupported || entry.acceptedQuotaKeys.length === 0)
    .map((entry) => entry.id);
}
