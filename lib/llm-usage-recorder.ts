/**
 * llm-usage-recorder — Call lifecycle management for LLM usage events.
 *
 * Responsibilities:
 * - Track in-flight calls: create a call record before completion starts,
 *   finalize it exactly once when the completion resolves (success/error/aborted).
 * - Workspace hashing: accept a canonical path, store only a deterministic hash.
 * - Source classification: map call origin to the standard LlmUsageSourceKind.
 * - Write-once guarantee: forward to the atomic store; write failures never
 *   throw back to the caller — they are logged and surfaced via diagnostics.
 * - Bounded retry: failed writes enter an in-process retry queue (exponential
 *   backoff, max attempts). After exhaustion the event is dropped but the LLM
 *   call is NOT affected.
 *
 * Privacy:
 * - The workspace path is hashed immediately and the raw path is never stored
 *   or retained in the event.
 * - All other privacy rules are enforced by the normalizer.
 */

import { createHash } from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai/compat";
import { normalizeProvider, normalizeModel, normalizeSdkUsage } from "./llm-usage-normalize";
import { writeLlmUsageEvent, generateCallId, generateEventId, backfillEventId } from "./llm-usage-store";
import type {
  LlmUsageEventV1,
  LlmUsageSourceKind,
  LlmUsageInvocation,
  LlmUsageStatus,
  LlmUsageWriteResult,
} from "./llm-usage-types";

// ---------------------------------------------------------------------------
// Module-level enable/disable gate
// ---------------------------------------------------------------------------

/**
 * Whether the recorder is currently enabled.
 *
 * Ledger recording is always on by default. `setRecorderEnabled(false)` remains
 * available for diagnostics/tests only; retired `usage.statsSource` no longer
 * gates writes (including old `"legacy"` values on disk).
 */
let recorderEnabled = true;

/** Enable or disable the entire usage recorder at runtime. */
export function setRecorderEnabled(enabled: boolean): void {
  recorderEnabled = enabled;
}

/** Query whether the recorder is currently enabled. */
export function isRecorderEnabled(): boolean {
  return recorderEnabled;
}

// ---------------------------------------------------------------------------
// In-flight call tracking
// ---------------------------------------------------------------------------

interface PendingCall {
  callId: string;
  occurredAt: string;
  finalized: boolean;
}

/** In-process map of callId → PendingCall. */
const pendingCalls = new Map<string, PendingCall>();

// ---------------------------------------------------------------------------
// Retry diagnostics (bounded in-process queue)
// ---------------------------------------------------------------------------

interface RetryEntry {
  event: LlmUsageEventV1;
  attempts: number;
  nextRetryMs: number;
}

const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_MS = 100;
const MAX_RETRY_MS = 5000;

const retryQueue: RetryEntry[] = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Exported for diagnostics: counts of dropped events after exhausting retries. */
export const recorderDiagnostics = {
  totalWrites: 0,
  successfulWrites: 0,
  idempotentSkips: 0,
  writeFailures: 0,
  retriedWrites: 0,
  droppedAfterRetries: 0,
};

function scheduleRetryFlush(): void {
  if (retryTimer !== null || retryQueue.length === 0) return;
  const nextMs = Math.min(...retryQueue.map((e) => e.nextRetryMs));
  const delay = Math.max(0, nextMs - Date.now());
  retryTimer = setTimeout(flushRetryQueue, Math.min(delay, 5000));
}

function flushRetryQueue(): void {
  retryTimer = null;
  const now = Date.now();
  const remaining: RetryEntry[] = [];

  for (const entry of retryQueue) {
    if (entry.nextRetryMs > now) {
      remaining.push(entry);
      continue;
    }

    if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
      recorderDiagnostics.droppedAfterRetries += 1;
      console.error(
        `[llm-usage-recorder] dropped event ${entry.event.eventId} after ${entry.attempts} retries`,
      );
      continue;
    }

    const result = writeLlmUsageEvent(entry.event);
    if (result.written || result.existingEventId) {
      if (result.written) recorderDiagnostics.retriedWrites += 1;
      continue;
    }

    // Exponential backoff with jitter
    const nextDelay = Math.min(
      BASE_RETRY_MS * Math.pow(2, entry.attempts) + Math.random() * 100,
      MAX_RETRY_MS,
    );
    remaining.push({
      event: entry.event,
      attempts: entry.attempts + 1,
      nextRetryMs: now + nextDelay,
    });
  }

  if (remaining.length > 0) {
    retryQueue.length = 0;
    retryQueue.push(...remaining);
  } else {
    retryQueue.length = 0;
  }

  scheduleRetryFlush();
}

function enqueueRetry(event: LlmUsageEventV1): void {
  retryQueue.push({
    event,
    attempts: 0,
    nextRetryMs: Date.now() + BASE_RETRY_MS,
  });
  scheduleRetryFlush();
}

// ---------------------------------------------------------------------------
// Workspace hash
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic, one-way hash of a canonical workspace path.
 * The raw path is never stored or returned in any event.
 *
 * @param canonicalPath Resolved, canonical absolute filesystem path.
 * @returns Hex-encoded SHA-256 truncated to 24 chars.
 */
export function hashWorkspace(canonicalPath: string): string {
  return createHash("sha256")
    .update(`ws:${canonicalPath}`)
    .digest("hex")
    .slice(0, 24);
}

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------

export interface CreateCallOptions {
  sourceKind: LlmUsageSourceKind;
  invocation?: LlmUsageInvocation;
  /** Canonical workspace path (will be hashed; raw path NOT stored). */
  workspacePath?: string;
  sessionId?: string;
  parentSessionId?: string;
  studioRunId?: string;
  taskId?: string;
}

export interface RecordUsageOptions extends CreateCallOptions {
  /** If true, the call was aborted before receiving a final message. */
  aborted?: boolean;
  /** Provider as resolved by the agent (not "unknown"). */
  provider?: string;
  /** Requested model as resolved by the agent (not "unknown"). */
  requestedModel?: string;
  /** Response model as returned by the API. */
  responseModel?: string;
  /** API variant if known (e.g., "chat", "responses"). */
  api?: string;
}

/**
 * Create a pending call record and return its `callId`.
 *
 * Call BEFORE the completion starts. The caller must then pass this `callId`
 * to `recordFinalUsage()` (or `recordAbortedUsage()`) when the completion
 * finalizes.
 *
 * Each call must be finalized exactly once; double-finalize is a no-op that
 * logs a warning.
 */
export function createCall(options: CreateCallOptions): string {
  if (!recorderEnabled) return "";
  void options; // retain signature for future source-tagging expansion
  const callId = generateCallId();
  pendingCalls.set(callId, {
    callId,
    occurredAt: new Date().toISOString(),
    finalized: false,
  });
  return callId;
}

/**
 * Record the final usage of a successfully completed LLM call.
 *
 * @param callId The callId returned by `createCall()`.
 * @param usage Raw SDK Usage from the final AssistantMessage.
 * @param options Call metadata (must match the original `createCall()` source).
 * @returns Write result for diagnostics.
 */
export function recordFinalUsage(
  callId: string,
  usage: Usage,
  options: RecordUsageOptions,
): LlmUsageWriteResult {
  if (!recorderEnabled) return { written: false, eventId: "", error: "recorder disabled" };
  const pending = pendingCalls.get(callId);
  if (!pending) {
    return { written: false, eventId: "", error: `unknown callId: ${callId}` };
  }
  if (pending.finalized) {
    console.warn(`[llm-usage-recorder] duplicate finalize for callId ${callId}`);
    return { written: false, eventId: "", error: "already finalized" };
  }
  pending.finalized = true;

  return recordUsageInternal(callId, pending.occurredAt, usage, "success", options);
}

/**
 * Record an aborted or errored call that produced no final usage.
 *
 * @param callId The callId returned by `createCall()`.
 * @param status "error" or "aborted".
 * @param options Call metadata.
 * @returns Write result for diagnostics.
 */
export function recordAbortedUsage(
  callId: string,
  status: "error" | "aborted",
  options: RecordUsageOptions,
): LlmUsageWriteResult {
  if (!recorderEnabled) return { written: false, eventId: "", error: "recorder disabled" };
  const pending = pendingCalls.get(callId);
  if (!pending) {
    return { written: false, eventId: "", error: `unknown callId: ${callId}` };
  }
  if (pending.finalized) {
    console.warn(`[llm-usage-recorder] duplicate finalize for callId ${callId}`);
    return { written: false, eventId: "", error: "already finalized" };
  }
  pending.finalized = true;

  // Zero usage for aborted/error
  const zeroUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return recordUsageInternal(callId, pending.occurredAt, zeroUsage, status, options);
}

/**
 * Record usage for an error call that still returned partial usage
 * (e.g., context overflow with token report).
 */
export function recordErrorUsage(
  callId: string,
  usage: Usage,
  options: RecordUsageOptions,
): LlmUsageWriteResult {
  if (!recorderEnabled) return { written: false, eventId: "", error: "recorder disabled" };
  const pending = pendingCalls.get(callId);
  if (!pending) {
    return { written: false, eventId: "", error: `unknown callId: ${callId}` };
  }
  if (pending.finalized) {
    console.warn(`[llm-usage-recorder] duplicate finalize for callId ${callId}`);
    return { written: false, eventId: "", error: "already finalized" };
  }
  pending.finalized = true;

  return recordUsageInternal(callId, pending.occurredAt, usage, "error", options);
}

// ---------------------------------------------------------------------------
// Session backfill entry
// ---------------------------------------------------------------------------

export interface BackfillUsageOptions {
  sessionId: string;
  entryId: string;
  occurredAt: string;
  provider: string;
  model: string;
  /** Canonical workspace path (hashed). */
  workspacePath?: string;
  /** ISO timestamp of the entry's parent session header. */
  sessionCreatedAt?: string;
}

/**
 * Create a backfill event from a historical session JSONL assistant entry.
 *
 * Uses a deterministic eventId so repeated backfills are idempotent.
 * The result is written atomically to the ledger; write failures follow
 * the same retry path as live events.
 *
 * @param usage Raw SDK Usage from the persisted assistant message.
 * @param options Session/entry metadata.
 * @returns Write result for diagnostics.
 */
export function recordBackfillUsage(
  usage: Usage,
  options: BackfillUsageOptions,
): LlmUsageWriteResult {
  if (!recorderEnabled) return { written: false, eventId: "", error: "recorder disabled" };
  const eventId = backfillEventId(options.sessionId, options.entryId);
  const normalizedUsage = normalizeSdkUsage(usage);

  const event: LlmUsageEventV1 = {
    kind: "yolk-llm-usage-event",
    schemaVersion: 1,
    eventId,
    callId: `backfill_${eventId.slice(0, 16)}`,
    occurredAt: options.occurredAt,
    completedAt: options.occurredAt,
    status: "success",
    provider: normalizeProvider(options.provider),
    requestedModel: normalizeModel(options.model),
    usage: normalizedUsage,
    source: {
      kind: "legacy_session_backfill",
      invocation: "agent_turn",
    },
    scope: {
      sessionId: options.sessionId,
      workspaceKey: options.workspacePath
        ? hashWorkspace(options.workspacePath)
        : undefined,
    },
    provenance: {
      mode: "backfilled",
      usageSource: "sdk",
      attemptVisibility: "finalized_completion_only",
    },
  };

  return writeWithRetry(event);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function recordUsageInternal(
  callId: string,
  occurredAt: string,
  usage: Usage,
  status: LlmUsageStatus,
  options: RecordUsageOptions,
): LlmUsageWriteResult {
  const eventId = generateEventId();
  const normalizedUsage = normalizeSdkUsage(usage);

  const event: LlmUsageEventV1 = {
    kind: "yolk-llm-usage-event",
    schemaVersion: 1,
    eventId,
    callId,
    occurredAt,
    completedAt: new Date().toISOString(),
    status,
    provider: normalizeProvider(options.provider),
    requestedModel: normalizeModel(options.requestedModel),
    responseModel: options.responseModel
      ? normalizeModel(options.responseModel)
      : undefined,
    api: options.api,
    usage: normalizedUsage,
    source: {
      kind: options.sourceKind,
      invocation: options.invocation,
    },
    scope: {
      sessionId: options.sessionId,
      parentSessionId: options.parentSessionId,
      studioRunId: options.studioRunId,
      taskId: options.taskId,
      workspaceKey: options.workspacePath
        ? hashWorkspace(options.workspacePath)
        : undefined,
    },
    provenance: {
      mode: "native",
      usageSource: "sdk",
      attemptVisibility: "finalized_completion_only",
    },
  };

  return writeWithRetry(event);
}

function writeWithRetry(event: LlmUsageEventV1): LlmUsageWriteResult {
  recorderDiagnostics.totalWrites += 1;
  const result = writeLlmUsageEvent(event);

  if (result.written) {
    recorderDiagnostics.successfulWrites += 1;
    return result;
  }

  if (result.existingEventId) {
    recorderDiagnostics.idempotentSkips += 1;
    return result;
  }

  // Write failed — enqueue for retry; do NOT throw
  recorderDiagnostics.writeFailures += 1;
  console.error(
    `[llm-usage-recorder] write failed for event ${event.eventId}: ${result.error}; enqueuing retry`,
  );
  enqueueRetry(event);

  // Return a "written: false" but without error propagation to caller
  return { written: false, eventId: event.eventId, error: result.error };
}

// ---------------------------------------------------------------------------
// Direct observation (no pending call lifecycle)
// ---------------------------------------------------------------------------

/**
 * Record a usage event observed from an AgentSession subscribe handler
 * (message_end) or other passive observer where we don't control call start.
 *
 * Unlike createCall/recordFinalUsage, this generates its own callId and
 * writes immediately. Safe for repeated calls — each write is idempotent
 * by eventId.
 *
 * @param usage Raw SDK Usage from the observed final AssistantMessage.
 * @param options Call metadata. If occurredAt is omitted it defaults to now.
 * @param status Completion status (defaults to "success").
 */
export function recordObservedUsage(
  usage: Usage,
  options: RecordUsageOptions & { occurredAt?: string; status?: LlmUsageStatus },
): LlmUsageWriteResult {
  if (!recorderEnabled) return { written: false, eventId: "", error: "recorder disabled" };
  const callId = generateCallId();
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const status = options.status ?? "success";
  return recordUsageInternal(callId, occurredAt, usage, status, options);
}

// ---------------------------------------------------------------------------
// Cleanup (for tests)
// ---------------------------------------------------------------------------

/**
 * Clear all pending calls and retry queue.
 * ONLY for test teardown — not for production use.
 */
export function resetRecorderForTest(): void {
  pendingCalls.clear();
  retryQueue.length = 0;
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  recorderDiagnostics.totalWrites = 0;
  recorderDiagnostics.successfulWrites = 0;
  recorderDiagnostics.idempotentSkips = 0;
  recorderDiagnostics.writeFailures = 0;
  recorderDiagnostics.retriedWrites = 0;
  recorderDiagnostics.droppedAfterRetries = 0;
}
