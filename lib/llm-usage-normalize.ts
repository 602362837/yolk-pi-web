/**
 * llm-usage-normalize — Convert SDK AssistantMessage usage into allowlisted
 * LlmUsageTokens v1 with finite/nonnegative validation.
 *
 * This module is the privacy boundary: it copies only numeric usage fields from
 * the SDK message and never reads or copies prompt, output, thinking, tool
 * calls/results, file paths, account IDs, credentials, response IDs, or
 * artifacts.
 */

import type { Usage } from "@earendil-works/pi-ai/compat";
import type { LlmUsageTokens } from "./llm-usage-types";

/**
 * Map SDK usage fields to the canonical v1 token schema.
 *
 * Rules (per design):
 * - `reasoning` is a subset of `output`; do NOT add it to `totalTokens`.
 * - `totalTokens` is the authoritative total from the SDK (preferred over manual sum).
 * - `cacheWrite1h` is optional (Anthropic-only) and preserved when present.
 * - All numbers must be finite and non-negative; invalid inputs produce a
 *   normalized zero or are clamped.
 *
 * @param usage Raw usage object from a final SDK AssistantMessage.
 * @returns Normalized, validated token breakdown.
 */
export function normalizeSdkUsage(usage: Usage): LlmUsageTokens {
  const input = clampNonNegativeFinite(usage.input);
  const output = clampNonNegativeFinite(usage.output);
  const cacheRead = clampNonNegativeFinite(usage.cacheRead);
  const cacheWrite = clampNonNegativeFinite(usage.cacheWrite);

  // totalTokens: prefer SDK total; fall back to sum when missing/invalid
  let totalTokens: number;
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0) {
    totalTokens = usage.totalTokens;
  } else {
    totalTokens = input + output + cacheRead + cacheWrite;
  }

  const normalized: LlmUsageTokens = {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: clampNonNegativeFinite(usage.cost?.input),
      output: clampNonNegativeFinite(usage.cost?.output),
      cacheRead: clampNonNegativeFinite(usage.cost?.cacheRead),
      cacheWrite: clampNonNegativeFinite(usage.cost?.cacheWrite),
      total: clampNonNegativeFinite(usage.cost?.total),
    },
  };

  // Optional fields: only include when the provider actually reports them
  if (typeof usage.cacheWrite1h === "number" && Number.isFinite(usage.cacheWrite1h) && usage.cacheWrite1h >= 0) {
    normalized.cacheWrite1h = usage.cacheWrite1h;
  }

  if (typeof usage.reasoning === "number" && Number.isFinite(usage.reasoning)) {
    // reasoning can be 0 when provider reports it but none was used
    normalized.reasoning = Math.max(0, usage.reasoning);
  }
  // Note: reasoning is NOT added to totalTokens — it is a subset of output.

  return normalized;
}

/**
 * Normalize a provider string to a trimmed, non-empty value.
 * Falls back to "unknown" for empty/missing/whitespace.
 */
export function normalizeProvider(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0 && trimmed.length <= 256) return trimmed;
  }
  return "unknown";
}

/**
 * Normalize a model id string to a trimmed, non-empty value.
 * Falls back to "unknown" for empty/missing/whitespace.
 */
export function normalizeModel(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0 && trimmed.length <= 256) return trimmed;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampNonNegativeFinite(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return 0;
}
