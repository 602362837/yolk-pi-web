/**
 * llm-usage-types — Independent LLM call event schema and wire types.
 *
 * This module defines the canonical v1 event schema for the usage ledger.
 * Events are written once at completion finalization and never mutated.
 *
 * Privacy contract:
 * - No prompt, output, thinking, tool args/results, artifacts, credentials,
 *   account IDs, response IDs, or absolute filesystem paths.
 * - Workspace is stored only as a deterministic one-way hash.
 * - All numeric fields must be finite and non-negative.
 * - Unknown provider/model values are recorded as "unknown", never dropped.
 */

// ---------------------------------------------------------------------------
// Source / status / provenance unions
// ---------------------------------------------------------------------------

/** Who/what triggered this LLM call. */
export const LLM_USAGE_SOURCE_KINDS = [
  "chat",
  "studio_sdk",
  "studio_cli",
  "terminal_env_assist",
  "trellis_workflow_assist",
  "model_test",
  "warmup",
  "compaction",
  "branch_summary",
  "legacy_session_backfill",
] as const;

export type LlmUsageSourceKind = (typeof LLM_USAGE_SOURCE_KINDS)[number];

/** Finer-grain invocation classification. */
export type LlmUsageInvocation = "agent_turn" | "direct_completion" | "maintenance";

/** Terminal status of a single completion. */
export type LlmUsageStatus = "success" | "error" | "aborted";

/** Whether usage was recorded natively or recovered from history. */
export type LlmUsageProvenanceMode = "native" | "backfilled";

/** Visibility of SDK internal attempts in this event. */
export type LlmUsageAttemptVisibility = "finalized_completion_only";

// ---------------------------------------------------------------------------
// Core event schema v1
// ---------------------------------------------------------------------------

export interface LlmUsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface LlmUsageTokens {
  /** Prompt / input tokens. */
  input: number;
  /** Completion / output tokens. */
  output: number;
  /** Cache-read tokens (served from cache, billed at cache-read rate). */
  cacheRead: number;
  /** Cache-write tokens (written to cache, billed at cache-write rate). */
  cacheWrite: number;
  /**
   * Subset of `cacheWrite` written with 1h retention (Anthropic only).
   * Optional — only present when the provider exposes this split.
   */
  cacheWrite1h?: number;
  /**
   * Reasoning / thinking tokens. This is a subset of `output`:
   * `output` already includes these tokens. Do NOT add to total.
   * Set to a number (possibly 0) when the provider reports reasoning;
   * left undefined when the provider does not expose reasoning separately.
   */
  reasoning?: number;
  /** Total tokens as reported by the SDK. Preferred over manual sum. */
  totalTokens: number;
  /** SDK-computed cost for this call (NOT recalculated from current prices). */
  cost: LlmUsageCost;
}

export interface LlmUsageSource {
  kind: LlmUsageSourceKind;
  invocation?: LlmUsageInvocation;
}

export interface LlmUsageScope {
  sessionId?: string;
  parentSessionId?: string;
  studioRunId?: string;
  taskId?: string;
  /** Deterministic one-way hash of the canonical workspace path. */
  workspaceKey?: string;
}

export interface LlmUsageProvenance {
  mode: LlmUsageProvenanceMode;
  /** Always "sdk" — source of token/cost data. */
  usageSource: "sdk";
  attemptVisibility: LlmUsageAttemptVisibility;
}

export interface LlmUsageEventV1 {
  kind: "yolk-llm-usage-event";
  schemaVersion: 1;
  /** Globally unique, deterministic event id for dedup. */
  eventId: string;
  /** Call-scoped id connecting this event to its originating completion. */
  callId: string;
  /** ISO-8601 timestamp of when the completion was initiated. */
  occurredAt: string;
  /** ISO-8601 timestamp of when the completion finalized. */
  completedAt: string;
  status: LlmUsageStatus;
  provider: string;
  requestedModel: string;
  responseModel?: string;
  api?: string;
  usage: LlmUsageTokens;
  source: LlmUsageSource;
  scope?: LlmUsageScope;
  provenance: LlmUsageProvenance;
}

// ---------------------------------------------------------------------------
// Store-level types
// ---------------------------------------------------------------------------

/** Result of attempting to write a single event. */
export interface LlmUsageWriteResult {
  written: boolean;
  eventId: string;
  /** Non-zero when an existing event blocked the write (idempotent). */
  existingEventId?: string;
  error?: string;
}

/** Aggregated totals compatible with existing UsageTotals. */
export interface LlmUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  /** @deprecated Always 0 — cache-write is no longer aggregated. */
  cacheWrite: number;
  /** Subset of output, only present when reasoning was recorded. */
  reasoning?: number;
  totalTokens: number;
  cost: number;
  calls: number;
  successCalls: number;
  errorCalls: number;
  abortedCalls: number;
}

// ---------------------------------------------------------------------------
// Query / API types (forward-declared for QUERY-01, used as return shapes)
// ---------------------------------------------------------------------------

export interface LlmUsageDaySummary {
  date: string;
  totals: LlmUsageTotals;
}

/** Per-model contribution within a single day, for stacked-breakdown charts. */
export interface LlmUsageDayModelEntry {
  model: string;
  provider: string;
  tokens: number;
  cost: number;
  calls: number;
}

export interface LlmUsageDayModelSummary {
  date: string;
  models: LlmUsageDayModelEntry[];
  totals: LlmUsageTotals;
}

export interface LlmUsageModelSummary {
  provider: string;
  model: string;
  totals: LlmUsageTotals;
}

export interface LlmUsageProviderSummary {
  provider: string;
  totals: LlmUsageTotals;
  models: LlmUsageModelSummary[];
}

export interface LlmUsageSourceSummary {
  source: LlmUsageSourceKind;
  totals: LlmUsageTotals;
}

export interface LlmUsageStatusSummary {
  status: LlmUsageStatus;
  totals: LlmUsageTotals;
}

export interface LlmUsageCoverage {
  /** Earliest native-capture timestamp (null if none yet). */
  nativeSince: string | null;
  /** Whether a backfill was ever run and its checkpoint. */
  backfill: {
    completed: boolean;
    completedAt?: string;
    lastSessionId?: string;
  };
  /** Human-readable descriptions of known gaps. */
  knownGaps: string[];
  /** Count of corrupt events skipped during queries. */
  corruptEvents: number;
  /** Count of events skipped for other reasons (oversized, etc.). */
  skippedEvents: number;
}

export interface LlmUsageQueryResult {
  kind: "llm_usage_stats";
  schemaVersion: 1;
  range: { from: string; to: string; timezone: string };
  filters: Record<string, unknown>;
  totals: LlmUsageTotals;
  byDay: LlmUsageDaySummary[];
  /** Daily breakdown by model — used for stacked charts. */
  byDayModel: LlmUsageDayModelSummary[];
  byProvider: LlmUsageProviderSummary[];
  bySource: LlmUsageSourceSummary[];
  byStatus: LlmUsageStatusSummary[];
  coverage: LlmUsageCoverage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a zeroed totals object. */
export function createLlmUsageTotals(): LlmUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    calls: 0,
    successCalls: 0,
    errorCalls: 0,
    abortedCalls: 0,
  };
}

/** Safely add one event's usage into a running totals object. */
export function addLlmUsageToTotals(
  totals: LlmUsageTotals,
  event: LlmUsageEventV1,
): void {
  const u = event.usage;
  totals.input += u.input;
  totals.output += u.output;
  totals.cacheRead += u.cacheRead;
  // cacheWrite: no longer aggregated (per cw-removal decision).
  // Field stays at 0 for backward compatibility.
  totals.totalTokens += u.totalTokens;
  totals.cost += u.cost.total;
  totals.calls += 1;

  if (event.status === "success") totals.successCalls += 1;
  else if (event.status === "error") totals.errorCalls += 1;
  else if (event.status === "aborted") totals.abortedCalls += 1;

  // reasoning is additive but only across events that reported it
  if (u.reasoning !== undefined) {
    totals.reasoning = (totals.reasoning ?? 0) + u.reasoning;
  }
}

/** Format a UTC date as YYYY-MM-DD. */
export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
