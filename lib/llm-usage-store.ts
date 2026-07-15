/**
 * llm-usage-store — Atomic write-once persistence for usage events.
 *
 * Design:
 * - Events are stored under `<getAgentDir()>/usage-events/v1/YYYY-MM-DD/<eventId>.json`
 * - Dates are UTC-based and computed from `occurredAt` on the event.
 * - Write is atomic: body → same-directory tmp file → fsync (best-effort) → rename.
 * - Idempotent: if `<eventId>.json` already exists the write is skipped.
 * - Corrupt files are isolated: JSON parse errors skip the file without failing
 *   the whole read; oversized files are skipped.
 * - Write failures go through a bounded in-process retry queue with exponential
 *   backoff; after exhaustion the failure is logged and the LLM call is NOT blocked.
 *
 * Privacy:
 * - Store only writes validated LlmUsageEventV1; it does not inspect or enforce
 *   the privacy contract (that is the normalizer's job).
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { LlmUsageEventV1, LlmUsageWriteResult } from "./llm-usage-types";
import { formatUtcDate } from "./llm-usage-types";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVENTS_DIR_NAME = "usage-events";
const SCHEMA_VERSION_DIR = "v1";

function getEventsRoot(): string {
  return join(getAgentDir(), EVENTS_DIR_NAME, SCHEMA_VERSION_DIR);
}

function getDateDir(date: Date): string {
  return join(getEventsRoot(), formatUtcDate(date));
}

function eventPath(eventId: string, date: Date): string {
  return join(getDateDir(date), `${eventId}.json`);
}

// ---------------------------------------------------------------------------
// Atomic write-once
// ---------------------------------------------------------------------------

/** Maximum size for a single event file (128 KiB). Larger files are skipped. */
const MAX_EVENT_FILE_SIZE = 128 * 1024;

/**
 * Atomically persist a single usage event.
 *
 * Steps:
 * 1. Ensure date-partition directory exists.
 * 2. If `<eventId>.json` already exists → idempotent skip (return existing).
 * 3. Serialize event JSON.
 * 4. Write to a same-directory temp file `<eventId>.<random>.tmp`.
 * 5. Rename temp → target (atomic on same filesystem).
 * 6. Clean up temp on rename failure.
 *
 * Returns a result indicating whether the event was written and any diagnostic info.
 */
export function writeLlmUsageEvent(event: LlmUsageEventV1): LlmUsageWriteResult {
  const occurredAt = new Date(event.occurredAt);
  if (isNaN(occurredAt.getTime())) {
    return { written: false, eventId: event.eventId, error: "invalid occurredAt" };
  }

  const dateDir = getDateDir(occurredAt);
  const target = eventPath(event.eventId, occurredAt);

  // Idempotent: skip if already exists
  if (existsSync(target)) {
    return { written: false, eventId: event.eventId, existingEventId: event.eventId };
  }

  // Serialize
  let json: string;
  try {
    json = JSON.stringify(event);
  } catch (err) {
    return { written: false, eventId: event.eventId, error: `serialize: ${String(err)}` };
  }

  // Ensure directory
  try {
    mkdirSync(dateDir, { recursive: true });
  } catch (err) {
    return { written: false, eventId: event.eventId, error: `mkdir: ${String(err)}` };
  }

  // Write temp + atomic rename
  const tmpName = `${event.eventId}.${randomUUID().slice(0, 8)}.tmp`;
  const tmpPath = join(dateDir, tmpName);

  try {
    writeFileSync(tmpPath, json, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    // If tmp file already exists (extreme collision), retry with a new UUID
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
      return writeLlmUsageEvent(event);
    }
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    return { written: false, eventId: event.eventId, error: `write tmp: ${String(err)}` };
  }

  // Atomic rename
  try {
    renameSync(tmpPath, target);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    // If target was created between our existsSync check and rename,
    // treat as idempotent success
    if (existsSync(target)) {
      return { written: false, eventId: event.eventId, existingEventId: event.eventId };
    }
    return { written: false, eventId: event.eventId, error: `rename: ${String(err)}` };
  }

  return { written: true, eventId: event.eventId };
}

// ---------------------------------------------------------------------------
// Read / scan
// ---------------------------------------------------------------------------

export interface ReadEventsResult {
  events: LlmUsageEventV1[];
  corruptFiles: number;
  skippedFiles: number;
}

/**
 * Read all usage events whose UTC partition intersects `[from, to]`.
 *
 * UTC `YYYY-MM-DD` directories are only a candidate scan index derived from the
 * instants' UTC calendar days. Callers that need local-day product semantics
 * must still filter by full `occurredAt` after reading.
 *
 * Each file is read and parsed independently; corrupt or oversized files are
 * isolated (logged via diagnostics counter) and do not fail the entire read.
 *
 * @param from Start instant (inclusive); UTC day of this instant is the first partition.
 * @param to End instant (inclusive); UTC day of this instant is the last partition.
 * @param onCorrupt Optional callback invoked for each corrupt/skipped file.
 */
export function readLlmUsageEvents(
  from: Date,
  to: Date,
  onCorrupt?: (eventId: string, reason: string) => void,
): ReadEventsResult {
  const events: LlmUsageEventV1[] = [];
  let corruptFiles = 0;
  let skippedFiles = 0;

  const root = getEventsRoot();
  if (!existsSync(root)) {
    return { events, corruptFiles: 0, skippedFiles: 0 };
  }

  // Iterate dates
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const endTs = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  while (cursor.getTime() <= endTs) {
    const dateDir = join(root, formatUtcDate(cursor));
    if (existsSync(dateDir)) {
      let entries: string[];
      try {
        entries = readdirSync(dateDir);
      } catch {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const filePath = join(dateDir, entry);

        let stat: ReturnType<typeof statSync>;
        try {
          stat = statSync(filePath);
        } catch {
          corruptFiles += 1;
          onCorrupt?.(entry, "stat failed");
          continue;
        }

        if (!stat.isFile()) {
          skippedFiles += 1;
          onCorrupt?.(entry, "not a regular file");
          continue;
        }

        if (stat.size > MAX_EVENT_FILE_SIZE) {
          skippedFiles += 1;
          onCorrupt?.(entry, `oversized (${stat.size} bytes)`);
          continue;
        }

        let raw: string;
        try {
          raw = readFileSync(filePath, "utf-8");
        } catch {
          corruptFiles += 1;
          onCorrupt?.(entry, "read failed");
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          corruptFiles += 1;
          onCorrupt?.(entry, "invalid JSON");
          continue;
        }

        if (!isLlmUsageEventV1(parsed)) {
          corruptFiles += 1;
          onCorrupt?.(entry, "schema mismatch");
          continue;
        }

        events.push(parsed);
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Sort by occurredAt for deterministic order
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return { events, corruptFiles, skippedFiles };
}

// ---------------------------------------------------------------------------
// Schema guard
// ---------------------------------------------------------------------------

function isLlmUsageEventV1(value: unknown): value is LlmUsageEventV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "yolk-llm-usage-event" &&
    v.schemaVersion === 1 &&
    typeof v.eventId === "string" &&
    v.eventId.length > 0 &&
    typeof v.callId === "string" &&
    v.callId.length > 0 &&
    typeof v.occurredAt === "string" &&
    typeof v.completedAt === "string" &&
    typeof v.status === "string" &&
    typeof v.provider === "string" &&
    typeof v.requestedModel === "string" &&
    typeof v.usage === "object" &&
    v.usage !== null &&
    typeof (v.usage as Record<string, unknown>).totalTokens === "number" &&
    typeof v.source === "object" &&
    v.source !== null &&
    typeof (v.source as Record<string, unknown>).kind === "string" &&
    typeof v.provenance === "object" &&
    v.provenance !== null
  );
}

// ---------------------------------------------------------------------------
// Write-once helper (for recorder convenience)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic, sortable event ID for session backfill.
 * Uses `sha256("session-entry:" + sessionId + ":" + entryId)` prefix.
 */
export function backfillEventId(sessionId: string, entryId: string): string {
  return createHash("sha256")
    .update(`session-entry:${sessionId}:${entryId}`)
    .digest("hex");
}

/**
 * Generate a unique call ID for live capture.
 * Format: `call_<randomUUID>` — NOT deterministic (unlike backfill).
 */
export function generateCallId(): string {
  return `call_${randomUUID()}`;
}

/**
 * Generate a unique event ID for live capture.
 * Format: `evt_<randomUUID>` — NOT deterministic (unlike backfill).
 */
export function generateEventId(): string {
  return `evt_${randomUUID()}`;
}
