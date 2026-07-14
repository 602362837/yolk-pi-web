/**
 * Model price types — wire contracts for the model price configuration service.
 *
 * These types are intentionally stripped of secrets, absolute paths, API keys,
 * and complete models.json content. Only public projection fields are included.
 */

// ── Price status ──────────────────────────────────────────────────────────────

export type ModelPriceStatus = "missing" | "configured" | "builtin" | "free";

export type ModelPriceSource =
  | "builtin"                      // Price came from Pi built-in model definition
  | "models_json_override"         // Price came from models.json modelOverrides
  | "custom_model"                 // Price came from models.json custom model cost
  | "explicit_free";              // User marked this model as explicitly free

export type ModelPriceKind = "builtin_or_extension" | "custom";

// ── Price rates ───────────────────────────────────────────────────────────────

export interface PriceRates {
  input: number;
  output: number;
  cacheRead: number;
}

// ── Model price record (sanitized projection) ─────────────────────────────────

export interface ModelPriceRecord {
  provider: string;
  model: string;
  displayName?: string;
  providerDisplayName?: string;
  modelKind: ModelPriceKind;
  status: ModelPriceStatus;
  resolved: PriceRates;
  /** User-configured override (if any). Present only when status is "configured" or "free". */
  override?: Partial<PriceRates>;
  source: ModelPriceSource;
  /** Opaque revision for concurrency control; not a file path. */
  revision: string;
}

// ── API contracts ─────────────────────────────────────────────────────────────

export interface ModelPriceListResponse {
  schemaVersion: 1;
  /** Opaque revision token for the current models.json state. */
  revision: string;
  models: ModelPriceRecord[];
  explicitFreeModels: Array<{ provider: string; model: string }>;
}

export interface ModelPricePatchChange {
  provider: string;
  model: string;
  prices: Partial<PriceRates>;
  /** When true, marks the model as explicitly free (writes cost=0 and records in pi-web.json). */
  explicitFree?: boolean;
}

export interface ModelPricePatchRequest {
  revision: string;
  changes: ModelPricePatchChange[];
}

export interface ModelPricePatchResultEntry {
  provider: string;
  model: string;
  success: boolean;
  error?: string;
  resolved?: PriceRates;
}

export interface ModelPricePatchResponse {
  schemaVersion: 1;
  revision: string;
  results: ModelPricePatchResultEntry[];
}

// ── Validation ────────────────────────────────────────────────────────────────

// ── Suggestion types ─────────────────────────────────────────────────────────

export interface ModelPriceSuggestionTarget {
  provider: string;
  model: string;
}

export interface ModelPriceSuggestionEvidence {
  url: string;
  title: string;
  fetchedAt: string;
  /** SHA-256 hex of the excerpt used for the match (first 16 chars). */
  excerptHash: string;
}

export type ModelPriceSuggestionConfidence = "high" | "medium" | "low";
export type ModelPriceSuggestionMatchMethod = "exact" | "alias" | "ai_assisted";

export interface ModelPriceSuggestion {
  provider: string;
  model: string;
  prices: Partial<PriceRates>;
  currency: "USD";
  unit: "per_1m_tokens";
  confidence: ModelPriceSuggestionConfidence;
  matchMethod: ModelPriceSuggestionMatchMethod;
  evidence: ModelPriceSuggestionEvidence[];
  warnings: string[];
  /** Catalog id that was matched, e.g. anthropic/claude-opus-4. */
  matchedId?: string;
  /** Normalized identity label used for matching, e.g. anthropic/claude-opus-4-6. */
  normalizedLabel?: string;
}

export interface ModelPriceSuggestRequest {
  targets: ModelPriceSuggestionTarget[];
  cwd?: string;
}

export interface ModelPriceSuggestResponse {
  schemaVersion: 1;
  suggestions: ModelPriceSuggestion[];
  unresolved: ModelPriceSuggestionTarget[];
  warnings: string[];
  generatedAt: string;
}

/** Hard limit on the number of price suggestion targets per request. */
export const MODEL_PRICE_SUGGEST_TARGETS_MAX = 20;

// ── Constraints ──────────────────────────────────────────────────────────────

/** Maximum batch size for PATCH requests. */
export const MODEL_PRICE_PATCH_BATCH_MAX = 50;

/** Maximum price value in USD per 1M tokens. */
export const MODEL_PRICE_MAX_VALUE = 1_000_000;

/**
 * Validate a single price value: must be a finite number, non-negative,
 * and not exceed the maximum allowed value.
 */
export function isValidPriceValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MODEL_PRICE_MAX_VALUE
  );
}

/**
 * Validate a price rates object. Returns validated, trimmed rates
 * or an array of field-level error messages.
 */
export function validatePriceRates(
  rates: unknown,
): { valid: false; errors: string[] } | { valid: true; rates: PriceRates } {
  if (typeof rates !== "object" || rates === null || Array.isArray(rates)) {
    return { valid: false, errors: ["prices must be an object"] };
  }

  const obj = rates as Record<string, unknown>;
  const errors: string[] = [];
  const result: PriceRates = { input: 0, output: 0, cacheRead: 0 };

  for (const field of ["input", "output", "cacheRead"] as const) {
    if (field in obj && obj[field] !== undefined) {
      if (!isValidPriceValue(obj[field])) {
        errors.push(
          `${field} must be a non-negative finite number ≤ ${MODEL_PRICE_MAX_VALUE}`,
        );
      } else {
        result[field] = obj[field] as number;
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, rates: result };
}

/**
 * Validate a batch of price changes. Returns validated changes or errors.
 * Rejects: empty batch, over-size batch, duplicate targets, invalid provider/model strings.
 */
export function validatePricePatchChanges(
  changes: unknown,
): { valid: false; errors: string[] } | { valid: true; changes: ModelPricePatchChange[] } {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { valid: false, errors: ["changes must be a non-empty array"] };
  }
  if (changes.length > MODEL_PRICE_PATCH_BATCH_MAX) {
    return {
      valid: false,
      errors: [`batch size ${changes.length} exceeds maximum ${MODEL_PRICE_PATCH_BATCH_MAX}`],
    };
  }

  const result: ModelPricePatchChange[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (let i = 0; i < changes.length; i++) {
    const item = changes[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`changes[${i}] must be an object`);
      continue;
    }
    const obj = item as Record<string, unknown>;

    const provider = typeof obj.provider === "string" ? obj.provider.trim() : "";
    const model = typeof obj.model === "string" ? obj.model.trim() : "";
    if (!provider || !model) {
      errors.push(`changes[${i}]: provider and model must be non-empty strings`);
      continue;
    }

    const key = `${provider}:${model}`;
    if (seen.has(key)) {
      errors.push(`changes[${i}]: duplicate target ${key}`);
      continue;
    }
    seen.add(key);

    const explicitFree =
      "explicitFree" in obj ? Boolean(obj.explicitFree) : undefined;

    const priceResult = validatePriceRates(obj.prices);
    if (!priceResult.valid) {
      errors.push(
        `changes[${i}] (${key}): ${priceResult.errors.join("; ")}`,
      );
      continue;
    }

    result.push({
      provider,
      model,
      prices: priceResult.rates,
      explicitFree,
    });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, changes: result };
}
