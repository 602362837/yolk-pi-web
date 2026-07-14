/**
 * Model price source adapters — curated HTTPS allowlist fetchers for
 * public pricing data.
 *
 * Design contract (from design.md):
 * - Only fixed HTTPS allowlist URLs are contacted; no arbitrary URL injection.
 * - Redirects are only followed to hosts on the same allowlist.
 * - Response size, MIME type, and timeout are strictly enforced.
 * - Fetched content is trimmed to a bounded excerpt; full page bodies are never
 *   returned, logged, or passed to the AI.
 * - No API keys, session tokens, or user credentials are sent.
 * - Partial or total failure is handled gracefully; callers always get either
 *   evidence or a structured error.
 *
 * Source priorities (from design.md):
 * 1. OpenRouter public model catalog (deterministic exact/alias match)
 * 2. Provider official pricing pages (future adapters)
 * 3. No result (unresolved)
 */

import { createHash } from "crypto";
import type {
  ModelPriceSuggestionEvidence,
  PriceRates,
} from "./model-price-types";
import {
  normalizeModelIdentity,
  scoreCatalogMatch,
  stripModelNoise,
} from "./model-price-identity";

// ── Allowlist ─────────────────────────────────────────────────────────────────

/**
 * HTTPS-only, path-locked allowlist for pricing sources.
 *
 * Each entry is the full URL origin + path prefix that may be fetched.
 * Redirects are only followed to hosts listed in ALLOWED_SOURCE_HOSTS.
 */
const ALLOWLIST_URLS = [
  "https://openrouter.ai/api/v1/models",
] as const;

/** Hosts that are permitted for source fetching. */
const ALLOWED_SOURCE_HOSTS: ReadonlySet<string> = new Set([
  "openrouter.ai",
]);

/** Maximum redirects to follow. */
const MAX_REDIRECTS = 3;

/**
 * Maximum response body size in bytes.
 * OpenRouter's public models catalog is larger than 512KB (~500-700KB).
 * This limit only applies to fixed allowlisted pricing sources.
 */
const MAX_RESPONSE_SIZE = 4 * 1024 * 1024;

/** Timeout for each source fetch in milliseconds. */
const FETCH_TIMEOUT_MS = 15_000;

/** Maximum excerpt length passed to AI (characters). */
const MAX_EXCERPT_LENGTH = 8_000;

// ── Error types ───────────────────────────────────────────────────────────────

export class SourceFetchError extends Error {
  readonly code: "timeout" | "size" | "redirect" | "mime" | "http" | "network";
  readonly status?: number;

  constructor(
    message: string,
    code: "timeout" | "size" | "redirect" | "mime" | "http" | "network",
    status?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
    this.code = code;
    this.status = status;
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch a URL from the allowlist with strict safety constraints.
 *
 * @returns The trimmed response text (never the full raw body if oversized).
 * @throws {SourceFetchError} on any safety or network failure.
 */
async function fetchAllowlisted(url: string): Promise<string> {
  if (!ALLOWLIST_URLS.includes(url as (typeof ALLOWLIST_URLS)[number])) {
    throw new SourceFetchError(`URL not in allowlist`, "network");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "YolkPi/1.0 model-price-suggest",
      },
      redirect: "manual",
      signal: controller.signal,
    });

    // Handle redirects manually with allowlist check
    let currentResponse = response;
    let redirects = 0;

    while (
      [301, 302, 303, 307, 308].includes(currentResponse.status) &&
      redirects < MAX_REDIRECTS
    ) {
      const location = currentResponse.headers.get("location");
      if (!location) {
        throw new SourceFetchError("Redirect without Location header", "redirect");
      }

      const redirectUrl = new URL(location, url);
      if (!ALLOWED_SOURCE_HOSTS.has(redirectUrl.hostname)) {
        throw new SourceFetchError(
          `Redirect to non-allowlisted host: ${redirectUrl.hostname}`,
          "redirect",
        );
      }

      redirects++;
      currentResponse = await fetch(redirectUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "YolkPi/1.0 model-price-suggest",
        },
        signal: controller.signal,
      });
    }

    if (!currentResponse.ok) {
      throw new SourceFetchError(
        `HTTP ${currentResponse.status}`,
        "http",
        currentResponse.status,
      );
    }

    // Check Content-Type (must be JSON or text/plain)
    const contentType = currentResponse.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const isText = contentType.includes("text/plain") || contentType.includes("text/html");
    if (!isJson && !isText) {
      throw new SourceFetchError(
        `Unexpected Content-Type: ${contentType}`,
        "mime",
      );
    }

    // Read body with size limit
    const text = await currentResponse.text();
    if (text.length > MAX_RESPONSE_SIZE) {
      throw new SourceFetchError(
        `Response too large (${text.length} > ${MAX_RESPONSE_SIZE})`,
        "size",
      );
    }

    return text;
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SourceFetchError("Request timed out", "timeout");
    }
    if (error instanceof TypeError) {
      throw new SourceFetchError(`Network error: ${error.message}`, "network");
    }
    throw new SourceFetchError(
      error instanceof Error ? error.message : String(error),
      "network",
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ── Evidence helpers ──────────────────────────────────────────────────────────

function hashExcerpt(excerpt: string): string {
  return createHash("sha256").update(excerpt).digest("hex").slice(0, 16);
}

function buildEvidence(url: string, title: string, excerpt: string): ModelPriceSuggestionEvidence {
  return {
    url,
    title,
    fetchedAt: new Date().toISOString(),
    excerptHash: hashExcerpt(excerpt),
  };
}

// ── OpenRouter adapter ────────────────────────────────────────────────────────

/** Shape of a single model entry from OpenRouter's /api/v1/models. */
interface OpenRouterModelEntry {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string;   // USD per 1M tokens as string
    completion?: string;
    image?: string;
    request?: string;
  };
}

/**
 * Parse OpenRouter pricing into USD per 1M tokens.
 * OpenRouter returns per-token USD strings (e.g. "0.000003").
 */
function parseOpenRouterPrice(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const perToken = Number(raw);
  if (!Number.isFinite(perToken) || perToken < 0) return 0;
  // Values already looking like USD/1M stay as-is; typical per-token values are << 1.
  if (perToken >= 0.01) return perToken;
  return perToken * 1_000_000;
}

/**
 * Fetch and parse the OpenRouter public model catalog.
 *
 * This is the primary pricing source. The API is free and returns model
 * pricing information including USD/1M token rates.
 */
async function fetchOpenRouterCatalog(): Promise<Map<string, OpenRouterModelEntry>> {
  const text = await fetchAllowlisted("https://openrouter.ai/api/v1/models");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SourceFetchError("Failed to parse OpenRouter API response as JSON", "network");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SourceFetchError("Unexpected OpenRouter API response structure", "network");
  }

  const data = (parsed as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new SourceFetchError("OpenRouter API response missing data array", "network");
  }

  const map = new Map<string, OpenRouterModelEntry>();
  for (const entry of data) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const model = entry as Record<string, unknown>;
      if (typeof model.id === "string") {
        map.set(model.id, {
          id: model.id,
          name: typeof model.name === "string" ? model.name : undefined,
          pricing: typeof model.pricing === "object" && model.pricing !== null
            ? {
                prompt: typeof (model.pricing as Record<string, unknown>).prompt === "string"
                  ? (model.pricing as Record<string, unknown>).prompt as string
                  : undefined,
                completion: typeof (model.pricing as Record<string, unknown>).completion === "string"
                  ? (model.pricing as Record<string, unknown>).completion as string
                  : undefined,
                image: typeof (model.pricing as Record<string, unknown>).image === "string"
                  ? (model.pricing as Record<string, unknown>).image as string
                  : undefined,
                request: typeof (model.pricing as Record<string, unknown>).request === "string"
                  ? (model.pricing as Record<string, unknown>).request as string
                  : undefined,
              }
            : undefined,
        });
      }
    }
  }

  return map;
}

// ── Deterministic matching ────────────────────────────────────────────────────

/** Provider-to-OpenRouter-id mapping for known provider aliases. */
const PROVIDER_TO_OR_PREFIX: Record<string, string> = {
  openai: "openai/",
  anthropic: "anthropic/",
  google: "google/",
  meta: "meta-llama/",
  deepseek: "deepseek/",
  mistralai: "mistral/",
  cohere: "cohere/",
  qwen: "qwen/",
  xai: "x-ai/",
  "x-ai": "x-ai/",
};

/**
 * Match a provider+model against the OpenRouter catalog.
 *
 * Strategies (in order):
 * 1. Exact match: `provider/model` matches OpenRouter `id` exactly
 * 2. Known official provider prefix
 * 3. Inferred vendor + core model id (third-party aliases)
 * 4. Fuzzy catalog score using normalized model identity
 */
export interface SourceMatchResult {
  prices: Partial<PriceRates>;
  confidence: "high" | "medium" | "low";
  matchMethod: "exact" | "alias";
  evidence: ModelPriceSuggestionEvidence[];
  warnings: string[];
  /** The OpenRouter model id that was matched. */
  matchedId?: string;
  /** Normalized identity summary for UI. */
  normalizedLabel?: string;
}

/**
 * Try deterministic matching against the OpenRouter catalog.
 *
 * This is the preferred path before resorting to AI.
 */
export async function tryDeterministicMatch(
  provider: string,
  model: string,
  catalog?: Map<string, OpenRouterModelEntry>,
  displayName?: string,
): Promise<SourceMatchResult | null> {
  if (!provider || !model) return null;

  let entries: Map<string, OpenRouterModelEntry>;
  try {
    entries = catalog ?? (await fetchOpenRouterCatalog());
  } catch {
    return null;
  }

  const identity = normalizeModelIdentity(provider, model, displayName);
  const providerLower = provider.toLowerCase();
  const modelLower = model.toLowerCase();
  const identityWarnings = identity.reasons.map((r) => `identity: ${r}`);

  // Strategy 1: exact match against full OpenRouter id
  const exactKey = `${providerLower}/${modelLower}`;
  if (entries.has(exactKey)) {
    const entry = entries.get(exactKey)!;
    return buildDeterministicResult(
      entry,
      exactKey,
      "exact",
      "high",
      [],
      `${identity.coreModelId}`,
    );
  }

  // Strategy 2: known official provider prefix + raw model id
  const orPrefix = PROVIDER_TO_OR_PREFIX[providerLower];
  if (orPrefix) {
    const prefixedKey = `${orPrefix}${modelLower}`;
    if (entries.has(prefixedKey)) {
      const entry = entries.get(prefixedKey)!;
      return buildDeterministicResult(
        entry,
        prefixedKey,
        "exact",
        "high",
        [],
        identity.coreModelId,
      );
    }
  }

  // Strategy 3: inferred vendor + cleaned core model id
  if (identity.inferredVendor && identity.coreModelId) {
    const vendor = identity.inferredVendor;
    const candidates = [
      `${vendor}/${identity.coreModelId}`,
      `${vendor}/${modelLower}`,
      `${PROVIDER_TO_OR_PREFIX[vendor] ?? `${vendor}/`}${identity.coreModelId}`,
    ];
    for (const key of candidates) {
      const normalizedKey = key.replace(/\/\//g, "/");
      if (entries.has(normalizedKey)) {
        const entry = entries.get(normalizedKey)!;
        return buildDeterministicResult(
          entry,
          normalizedKey,
          "alias",
          providerLower === vendor ? "high" : "medium",
          [
            ...identityWarnings,
            `Matched third-party alias "${provider}/${model}" to catalog "${normalizedKey}".`,
          ],
          `${identity.inferredVendor}/${identity.coreModelId}`,
        );
      }
    }
  }

  // Strategy 4: fuzzy score across catalog using normalized identity
  let best:
    | { entryId: string; entry: OpenRouterModelEntry; score: number }
    | null = null;
  for (const [entryId, entry] of entries) {
    const score = scoreCatalogMatch(identity, entryId, entry.name);
    if (score < 70) continue;
    if (!best || score > best.score) {
      best = { entryId, entry, score };
    }
  }

  if (best) {
    const confidence: "high" | "medium" | "low" =
      best.score >= 120 ? "high" : best.score >= 95 ? "medium" : "low";
    const warnings = [
      ...identityWarnings,
      `Fuzzy-matched "${provider}/${model}" to catalog "${best.entryId}" (score ${best.score}).`,
      `Third-party/router prices may differ from official vendor billing.`,
    ];
    return buildDeterministicResult(
      best.entry,
      best.entryId,
      "alias",
      confidence,
      warnings,
      identity.inferredVendor
        ? `${identity.inferredVendor}/${identity.coreModelId}`
        : identity.coreModelId,
    );
  }

  return null;
}

function buildDeterministicResult(
  entry: OpenRouterModelEntry,
  matchedId: string,
  matchMethod: "exact" | "alias",
  confidence: "high" | "medium" | "low",
  extraWarnings: string[] = [],
  normalizedLabel?: string,
): SourceMatchResult {
  const inputPrice = parseOpenRouterPrice(entry.pricing?.prompt);
  const outputPrice = parseOpenRouterPrice(entry.pricing?.completion);

  if (inputPrice === 0 && outputPrice === 0) {
    return {
      prices: {},
      confidence: "low",
      matchMethod: "alias",
      evidence: [
        buildEvidence(
          "https://openrouter.ai/api/v1/models",
          `OpenRouter model: ${matchedId}`,
          `Matched model "${matchedId}" has no pricing in catalog.`,
        ),
      ],
      warnings: [
        `OpenRouter catalog entry "${matchedId}" has no pricing data.`,
        ...extraWarnings,
      ],
      matchedId,
      normalizedLabel,
    };
  }

  return {
    prices: {
      input: inputPrice,
      output: outputPrice,
    },
    confidence,
    matchMethod,
    evidence: [
      buildEvidence(
        "https://openrouter.ai/api/v1/models",
        `OpenRouter model: ${matchedId}`,
        `Matched: ${matchedId} | Input: ${inputPrice} USD/1M | Output: ${outputPrice} USD/1M`,
      ),
    ],
    warnings: extraWarnings,
    matchedId,
    normalizedLabel,
  };
}

// ── Evidence extraction for AI ────────────────────────────────────────────────

/**
 * Extract a bounded excerpt from the OpenRouter catalog for a specific model
 * match attempt. Used to provide the AI with just enough evidence to reason
 * about pricing.
 */
export function extractModelExcerpt(
  entry: OpenRouterModelEntry,
  matchedId: string,
): string {
  const parts: string[] = [
    `Source: OpenRouter Model Catalog`,
    `URL: https://openrouter.ai/api/v1/models`,
    `Model ID: ${matchedId}`,
  ];

  if (entry.name) {
    parts.push(`Model Name: ${entry.name}`);
  }

  if (entry.pricing) {
    const pricing = entry.pricing;
    if (pricing.prompt !== undefined) parts.push(`Input price (prompt): ${pricing.prompt} USD/1M tokens`);
    if (pricing.completion !== undefined) parts.push(`Output price (completion): ${pricing.completion} USD/1M tokens`);
    if (pricing.image !== undefined) parts.push(`Image price: ${pricing.image} USD/image`);
    if (pricing.request !== undefined) parts.push(`Request price: ${pricing.request} USD/request`);
  } else {
    parts.push(`Pricing: Not available in catalog`);
  }

  const excerpt = parts.join("\n");
  if (excerpt.length > MAX_EXCERPT_LENGTH) {
    return excerpt.slice(0, MAX_EXCERPT_LENGTH) + "\n[...excerpt truncated]";
  }
  return excerpt;
}

/**
 * Fetch all OpenRouter entries that COULD match a given set of targets,
 * for AI-assisted matching.
 *
 * Returns a map of OpenRouter model id -> entry for all entries that
 * share a provider prefix with any of the targets.
 */
export async function fetchRelevantEntries(
  targets: Array<{ provider: string; model: string }>,
  catalogOverride?: Map<string, OpenRouterModelEntry>,
): Promise<Map<string, OpenRouterModelEntry>> {
  let catalog: Map<string, OpenRouterModelEntry>;
  try {
    catalog = catalogOverride ?? (await fetchOpenRouterCatalog());
  } catch {
    return new Map();
  }

  const relevant = new Map<string, OpenRouterModelEntry>();
  const identities = targets.map((t) => normalizeModelIdentity(t.provider, t.model));
  const vendorHints = new Set(
    identities
      .map((id) => id.inferredVendor?.toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );

  for (const [entryId, entry] of catalog) {
    // Keep high-scoring identity matches for third-party aliases.
    for (const identity of identities) {
      if (scoreCatalogMatch(identity, entryId, entry.name) >= 55) {
        relevant.set(entryId, entry);
        break;
      }
    }
    if (relevant.has(entryId)) continue;

    const entryProvider = entryId.split("/")[0]?.toLowerCase() ?? "";
    if (vendorHints.has(entryProvider)) {
      // Bound size: only keep entries that also share model family tokens.
      for (const identity of identities) {
        if (!identity.coreModelId) continue;
        const core = stripModelNoise(entryId.split("/").slice(1).join("/") || entryId).cleaned;
        if (core.includes(identity.coreModelId) || identity.coreModelId.includes(core)) {
          relevant.set(entryId, entry);
          break;
        }
      }
    }
  }

  // Cap AI evidence volume for very broad matches.
  if (relevant.size > 40) {
    const ranked = [...relevant.entries()]
      .map(([entryId, entry]) => {
        const best = Math.max(
          ...identities.map((identity) => scoreCatalogMatch(identity, entryId, entry.name)),
        );
        return { entryId, entry, best };
      })
      .sort((a, b) => b.best - a.best)
      .slice(0, 40);
    return new Map(ranked.map((r) => [r.entryId, r.entry]));
  }

  return relevant;
}

// ── Public API summary ────────────────────────────────────────────────────────

export type { OpenRouterModelEntry };
export { fetchOpenRouterCatalog, PROVIDER_TO_OR_PREFIX };
