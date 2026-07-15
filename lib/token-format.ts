/**
 * token-format — authoritative, project-wide token display formatters.
 *
 * All Usage, topbar, message footer, and chart token rendering MUST use these
 * helpers so that exact-integer, M-derived, and compact representations are
 * always consistent across the codebase.
 *
 * Rules:
 * - Exact: full integer with locale grouping, e.g. "1,234,567 tokens".
 *         Secondary/detail unit for Usage ledger token volumes; still used for
 *         non-volume counts and full-precision tooltips.
 * - M:    tokens / 1_000_000, at most 2 decimal places, trailing zeros stripped.
 *         0 → "0 M". Primary visual unit for Usage ledger token volumes.
 *         Never used as storage or aggregation input.
 * - Compact: for tight spaces (chart axis, chip). Uses M with 1 decimal when
 *   ≥1M, k when ≥1k, falls back to exact integer.
 *   Tooltip MUST show exact value when compact is used.
 */

/**
 * Format token count as a full integer with locale grouping.
 *
 * @param value Non-negative token count.
 * @returns Locale-grouped integer as a string, e.g. "1,234,567".
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return Math.round(value).toLocaleString();
}

/**
 * Format token count as "tokens" with locale grouping suffix.
 *
 * @param value Non-negative token count.
 * @returns e.g. "1,234,567 tokens".
 */
export function formatTokensLabel(value: number): string {
  return `${formatTokens(value)} tokens`;
}

/**
 * Format token count as millions (M) with up to 2 decimal places and
 * trailing zeros stripped. Returns "0 M" for zero.
 *
 * @param value Non-negative token count.
 * @returns e.g. "1.23 M", "0 M", "1 M".
 */
export function formatTokensM(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0 M";
  if (value === 0) return "0 M";
  const m = value / 1_000_000;
  // Round to 2 decimal places max, strip trailing zeros
  const fixed = m.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return `${trimmed} M`;
}

/**
 * Compact token display for tight spaces (chips, chart axis).
 *
 * Thresholds:
 * - ≥ 1,000,000 → "1.2M" (1 decimal)
 * - ≥ 1,000     → "1k" (no decimals)
 * - Otherwise    → exact locale integer
 *
 * @param value Non-negative token count.
 * @returns Compact token string. Caller MUST also present the exact value
 *          in a tooltip or secondary text.
 */
export function formatTokensCompact(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${k.toFixed(0)}k`;
  }
  return Math.round(value).toLocaleString();
}

/**
 * Sum input, output, and cacheRead tokens.
 * cacheWrite is intentionally excluded per the cache-write removal decision.
 *
 * @param tokens Object containing input, output, cacheRead, and cacheWrite tokens.
 * @returns Sum of input + output + cacheRead.
 */
export function sumTokens(tokens: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite?: number;
}): number {
  return (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0);
}
