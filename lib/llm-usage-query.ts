/**
 * llm-usage-query — Read, filter, aggregate, and cache usage-event queries.
 *
 * Reads ONLY the usage ledger (immutable one-event-per-file store). Does NOT
 * depend on session-reader, SessionManager, or session inventory.
 *
 * Date semantics:
 * - `from` / `to` are full instants (typically local-day 00:00:00.000 and
 *   23:59:59.999). They define the inclusive event filter.
 * - UTC date partitions are only a candidate scan index for the store.
 * - `byDay` and response `range.from/to` use the same local calendar labels.
 *
 * Concurrency & safety:
 * - Fixed concurrency per scan; date partitions are scanned sequentially.
 * - Corrupt/oversized events are isolated via the store layer.
 * - Short-TTL single-flight cache to avoid repeated filesystem scans for
 *   identical query params within a request burst.
 */

import { createHash } from "node:crypto";
import { canonicalizeCwd } from "@/lib/cwd";
import { formatLocalDate, localTimeZone } from "@/lib/local-date-range";
import { readLlmUsageEvents } from "./llm-usage-store";
import { hashWorkspace } from "./llm-usage-recorder";
import {
  createLlmUsageTotals,
  addLlmUsageToTotals,
  type LlmUsageEventV1,
  type LlmUsageTotals,
  type LlmUsageDaySummary,
  type LlmUsageDayModelSummary,
  type LlmUsageDayModelEntry,
  type LlmUsageProviderSummary,
  type LlmUsageSourceSummary,
  type LlmUsageStatusSummary,
  type LlmUsageCoverage,
  type LlmUsageQueryResult,
  type LlmUsageSourceKind,
  type LlmUsageStatus,
} from "./llm-usage-types";

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export interface LlmUsageQueryOptions {
  /**
   * Inclusive range start instant. Callers should pass local-day start
   * (00:00:00.000) when filtering by calendar day.
   */
  from: Date;
  /**
   * Inclusive range end instant. Callers should pass local-day end
   * (23:59:59.999) when filtering by calendar day.
   */
  to: Date;
  /**
   * Optional original `YYYY-MM-DD` label for `range.from`. When omitted the
   * query layer formats `from` with server-local calendar semantics.
   */
  fromLabel?: string;
  /**
   * Optional original `YYYY-MM-DD` label for `range.to`. When omitted the
   * query layer formats `to` with server-local calendar semantics.
   */
  toLabel?: string;
  /** Filter by workspace hash (derived from cwd). */
  cwd?: string;
  /** Filter by provider (exact match). */
  provider?: string;
  /** Filter by model (exact match, NOT combined with provider). */
  model?: string;
  /** Filter by source kind. */
  source?: LlmUsageSourceKind;
  /** Filter by status. */
  status?: LlmUsageStatus;
  /** Max date range in days (default 366). */
  maxRangeDays?: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  result: LlmUsageQueryResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000; // 5 seconds
const cache = new Map<string, CacheEntry>();

/**
 * Cache key uses full boundary instants (ISO) plus every filter so local-day
 * ranges that cross the same UTC partition labels never collide.
 */
function cacheKey(opts: LlmUsageQueryOptions): string {
  const raw = JSON.stringify({
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    fromLabel: opts.fromLabel ?? "",
    toLabel: opts.toLabel ?? "",
    cwd: opts.cwd ?? "",
    provider: opts.provider ?? "",
    model: opts.model ?? "",
    source: opts.source ?? "",
    status: opts.status ?? "",
    maxRangeDays: opts.maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS,
  });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** In-flight promise map for single-flight dedup. */
const inflight = new Map<string, Promise<LlmUsageQueryResult>>();

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Query the usage ledger within a date range, applying optional filters.
 *
 * Returns an aggregated result with by-day, by-provider, by-source, by-status
 * breakdowns plus coverage diagnostics.
 *
 * @param opts Query filters and range.
 * @returns Versioned query result.
 */
export async function queryLlmUsage(
  opts: LlmUsageQueryOptions,
): Promise<LlmUsageQueryResult> {
  // Validate range
  const maxDays = opts.maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS;
  // Use floor of the exclusive upper bound so a single local day
  // (00:00:00.000 → 23:59:59.999) counts as 1 day, not 2.
  const rangeDays =
    Math.floor((opts.to.getTime() - opts.from.getTime()) / MS_PER_DAY) + 1;
  if (rangeDays > maxDays) {
    throw new QueryValidationError(
      `date range exceeds maximum of ${maxDays} days (${rangeDays} requested)`,
    );
  }
  if (opts.from.getTime() > opts.to.getTime()) {
    throw new QueryValidationError("from must be earlier than or equal to to");
  }

  // Single-flight cache
  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = executeQuery(opts);
  inflight.set(key, promise);

  try {
    const result = await promise;
    cache.set(key, { key, result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } finally {
    inflight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

async function executeQuery(
  opts: LlmUsageQueryOptions,
): Promise<LlmUsageQueryResult> {
  const corruptReasons: string[] = [];
  const workspaceKey = opts.cwd
    ? hashWorkspace(canonicalizeCwd(opts.cwd) ?? opts.cwd)
    : undefined;

  const fromMs = opts.from.getTime();
  const toMs = opts.to.getTime();

  // UTC partitions are a candidate index only — expand to every UTC day that
  // intersects the instant range so timezone-boundary events are readable.
  const { events, corruptFiles, skippedFiles } = readLlmUsageEvents(
    opts.from,
    opts.to,
    (eventId, reason) => {
      corruptReasons.push(`${eventId}: ${reason}`);
    },
  );

  // Event-level filters: full-instant range first, then optional dimensions.
  const filtered = events.filter((event) => {
    const occurredMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredMs)) return false;
    if (occurredMs < fromMs || occurredMs > toMs) return false;
    if (workspaceKey && event.scope?.workspaceKey !== workspaceKey) return false;
    if (opts.provider && event.provider !== opts.provider) return false;
    if (
      opts.model &&
      event.requestedModel !== opts.model &&
      event.responseModel !== opts.model
    ) {
      return false;
    }
    if (opts.source && event.source.kind !== opts.source) return false;
    if (opts.status && event.status !== opts.status) return false;
    return true;
  });

  // Aggregate
  const totals = createLlmUsageTotals();
  const byDayMap = new Map<string, LlmUsageTotals>();
  const byDayModelMap = new Map<string, Map<string, LlmUsageDayModelEntry>>();
  const byProviderMap = new Map<
    string,
    { totals: LlmUsageTotals; models: Map<string, LlmUsageTotals> }
  >();
  const bySourceMap = new Map<LlmUsageSourceKind, LlmUsageTotals>();
  const byStatusMap = new Map<LlmUsageStatus, LlmUsageTotals>();

  for (const event of filtered) {
    addLlmUsageToTotals(totals, event);

    // By local calendar day (same semantics as range labels).
    const occurred = new Date(event.occurredAt);
    const dayKey = formatLocalDate(occurred);
    if (!byDayMap.has(dayKey)) byDayMap.set(dayKey, createLlmUsageTotals());
    addLlmUsageToTotals(byDayMap.get(dayKey)!, event);

    // By day + model (for stacked charts)
    if (!byDayModelMap.has(dayKey)) byDayModelMap.set(dayKey, new Map());
    const dayModels = byDayModelMap.get(dayKey)!;
    const modelKey = `${event.provider}::${event.requestedModel}`;
    if (!dayModels.has(modelKey)) {
      dayModels.set(modelKey, {
        provider: event.provider,
        model: event.requestedModel,
        tokens: 0,
        cost: 0,
        calls: 0,
      });
    }
    const dm = dayModels.get(modelKey)!;
    dm.tokens += event.usage.totalTokens;
    dm.cost += event.usage.cost.total;
    dm.calls += 1;

    // By provider + model
    const provider = event.provider;
    if (!byProviderMap.has(provider)) {
      byProviderMap.set(provider, {
        totals: createLlmUsageTotals(),
        models: new Map(),
      });
    }
    const pGroup = byProviderMap.get(provider)!;
    addLlmUsageToTotals(pGroup.totals, event);

    const model = event.requestedModel;
    if (!pGroup.models.has(model)) {
      pGroup.models.set(model, createLlmUsageTotals());
    }
    addLlmUsageToTotals(pGroup.models.get(model)!, event);

    // By source
    const sourceKind = event.source.kind;
    if (!bySourceMap.has(sourceKind)) {
      bySourceMap.set(sourceKind, createLlmUsageTotals());
    }
    addLlmUsageToTotals(bySourceMap.get(sourceKind)!, event);

    // By status
    const status = event.status;
    if (!byStatusMap.has(status)) {
      byStatusMap.set(status, createLlmUsageTotals());
    }
    addLlmUsageToTotals(byStatusMap.get(status)!, event);
  }

  // Build sorted outputs
  const byDay: LlmUsageDaySummary[] = [...byDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayTotals]) => ({ date, totals: dayTotals }));

  const byDayModel: LlmUsageDayModelSummary[] = [...byDayModelMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, modelMap]) => {
      const dayTotals = byDayMap.get(date) ?? createLlmUsageTotals();
      const models = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);
      return { date, models, totals: dayTotals };
    });

  const byProvider: LlmUsageProviderSummary[] = [...byProviderMap.entries()]
    .sort(([, a], [, b]) => b.totals.cost - a.totals.cost)
    .map(([provider, group]) => ({
      provider,
      totals: group.totals,
      models: [...group.models.entries()]
        .sort(([, a], [, b]) => b.cost - a.cost)
        .map(([model, mt]) => ({ provider, model, totals: mt })),
    }));

  const bySource: LlmUsageSourceSummary[] = [...bySourceMap.entries()]
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([source, st]) => ({ source, totals: st }));

  const byStatus: LlmUsageStatusSummary[] = [...byStatusMap.entries()]
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([status, st]) => ({ status, totals: st }));

  // Coverage
  let nativeSince: string | null = null;
  for (const event of events) {
    if (event.provenance.mode === "native") {
      if (!nativeSince || event.occurredAt < nativeSince) {
        nativeSince = event.occurredAt;
      }
    }
  }

  const coverage: LlmUsageCoverage = {
    nativeSince: nativeSince ? nativeSince.slice(0, 10) : null,
    backfill: {
      completed: events.some((e) => e.provenance.mode === "backfilled"),
      // We cannot determine a precise checkpoint from events alone;
      // this is maintained externally by the backfill module.
    },
    knownGaps: buildKnownGaps(events),
    corruptEvents: corruptFiles,
    skippedEvents: skippedFiles,
  };

  const rangeFrom = opts.fromLabel ?? formatLocalDate(opts.from);
  const rangeTo = opts.toLabel ?? formatLocalDate(opts.to);

  return {
    kind: "llm_usage_stats",
    schemaVersion: 1,
    range: {
      from: rangeFrom,
      to: rangeTo,
      timezone: localTimeZone(opts.from),
    },
    filters: {
      cwd: opts.cwd ?? null,
      provider: opts.provider ?? null,
      model: opts.model ?? null,
      source: opts.source ?? null,
      status: opts.status ?? null,
    },
    totals,
    byDay,
    byDayModel,
    byProvider,
    bySource,
    byStatus,
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Coverage gaps
// ---------------------------------------------------------------------------

function buildKnownGaps(events: LlmUsageEventV1[]): string[] {
  const gaps: string[] = [];

  // Determine if we have native capture or only backfill
  const hasNative = events.some((e) => e.provenance.mode === "native");
  const hasBackfill = events.some((e) => e.provenance.mode === "backfilled");

  if (!hasNative && !hasBackfill) {
    gaps.push("No usage events found in the ledger — coverage is empty.");
    return gaps;
  }

  if (!hasNative) {
    gaps.push(
      "No native (live-capture) events found. All data is from session backfill.",
    );
  }

  // Check which source kinds are covered
  const coveredSources = new Set(events.map((e) => e.source.kind));

  if (
    !coveredSources.has("compaction") &&
    !coveredSources.has("branch_summary")
  ) {
    gaps.push(
      "Compaction and branch summary calls are not captured. These calls use LLM internally but their usage is not exposed by the current SDK version.",
    );
  }

  if (!coveredSources.has("studio_cli")) {
    gaps.push(
      "Studio CLI calls (--no-session) made before native capture was enabled cannot be backfilled. Only sessions with persisted JSONL have usage records.",
    );
  }

  if (
    !coveredSources.has("terminal_env_assist") &&
    !coveredSources.has("trellis_workflow_assist")
  ) {
    gaps.push(
      "Direct completion calls (env assist, workflow assist, model test, warmup) made before native capture was enabled cannot be backfilled. These calls do not produce session JSONL records.",
    );
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Test / diagnostics helpers
// ---------------------------------------------------------------------------

/** Clear query cache and in-flight map (tests only). */
export function clearLlmUsageQueryCacheForTest(): void {
  cache.clear();
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryValidationError";
  }
}
