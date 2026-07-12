/**
 * Memory diagnostic snapshot orchestration and persistence.
 *
 * This module is the single entry point that composes a bounded, read-only
 * memory diagnostic snapshot (schema v1) from owner projections, applies a
 * cooperative time budget and a final JSON size budget, atomically persists
 * the result to `<getAgentDir()>/diagnostics/`, and exposes a process-global
 * single-flight trigger used by `POST /api/diagnostics/memory-snapshot`.
 *
 * Strict read-only boundary: this module never calls abort/destroy/cleanup/
 * reset/GC, never starts sessions, never lists/scans sessions, and never reads
 * or copies message content, tool args/results, system prompts, response ids,
 * terminal buffers, browser snapshots, or credentials. All runtime projection
 * helpers are owned by their respective modules and are expected to return
 * counts/aggregates and bounded id/path/timestamp/numeric/boolean samples only.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  isBudgetExpired,
  type BrowserShareDiagnostic,
  type CacheDiagnostic,
  type DiagnosticBudget,
  type DiagnosticLimits,
  type DiagnosticSectionError,
  type RpcRuntimeDiagnostic,
  type SessionFileChangesDiagnostic,
  type StudioRuntimeDiagnostic,
  type TerminalDiagnostic,
} from "./memory-diagnostics-types";

// Runtime owner projections are imported DYNAMICLY inside `collectRuntimeSections`.
// This keeps `lib/memory-diagnostics.ts` a lightweight, type-strip-safe module
// (it only depends on the compiled pi-coding-agent SDK and `node:v8`), so it
// can be imported directly by focused tests without forcing the Node native
// TypeScript stripper to parse owner modules that use unsupported syntax such
// as constructor parameter properties. In production (Next/SWC) the dynamic
// imports resolve to already-cached hot modules.

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

export const MEMORY_DIAGNOSTIC_KIND = "yolk-pi-memory-diagnostic";
export const MEMORY_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DEFAULT_DEADLINE_MS = 5_000;
export const MAX_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024; // 5 MiB hard cap

export const DEFAULT_LIMITS: DiagnosticLimits = {
  maxSessions: 100,
  maxBranchEntriesPerSession: 2_000,
  maxMessagesPerSession: 2_000,
  maxContentBlocksPerMessage: 100,
  maxChildRunSamples: 200,
  maxPendingContinuationSamples: 200,
  maxPathCacheSamples: 100,
  maxTerminalSamples: 100,
  maxSessionFileChangeSessions: 100,
  sessionFileChangeMaxStatBytes: 256 * 1024,
};

const MiB = 1024 * 1024;
const GiB = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Snapshot contract (schema v1)
// ---------------------------------------------------------------------------

export interface ProcessDiagnostic {
  pid: number;
  ppid: number;
  nodeVersion: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  startedAt: string;
  memoryUsage: NodeJS.MemoryUsage;
  memoryUsageBeforeCapture: NodeJS.MemoryUsage;
  memoryUsageAfterCapture: NodeJS.MemoryUsage;
  memoryDelta: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  resourceUsage?: NodeJS.ResourceUsage;
  heapStatistics?: Record<string, number>;
  error?: string;
}

export interface MemoryDiagnosticFinding {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  evidence: Record<string, number | string | boolean | null>;
}

/** Per-section sample truncation metadata recorded in `snapshot.truncation`. */
export interface DiagnosticTruncation {
  section: string;
  field: string;
  total: number;
  sampled: number;
  truncated: number;
}

export interface MemoryDiagnosticSnapshotV1 {
  kind: typeof MEMORY_DIAGNOSTIC_KIND;
  schemaVersion: typeof MEMORY_DIAGNOSTIC_SCHEMA_VERSION;
  snapshotId: string;
  capturedAt: string;
  completedAt: string;
  durationMs: number;
  partial: boolean;
  compacted: boolean;
  privacy: {
    includesLocalPaths: true;
    excludes: string[];
    sharingWarning: string;
  };
  limits: DiagnosticLimits;
  process: ProcessDiagnostic | { error: string };
  runtime: {
    agentSessions?: RpcRuntimeDiagnostic;
    studio?: StudioRuntimeDiagnostic;
    sessionPathCache?: CacheDiagnostic;
    browserShare?: BrowserShareDiagnostic;
    terminals?: TerminalDiagnostic;
    sessionFileChanges?: SessionFileChangesDiagnostic;
  };
  findings: MemoryDiagnosticFinding[];
  errors: DiagnosticSectionError[];
  truncation: DiagnosticTruncation[];
}

export interface MemorySnapshotApiSuccess {
  ok: true;
  kind: typeof MEMORY_DIAGNOSTIC_KIND;
  schemaVersion: typeof MEMORY_DIAGNOSTIC_SCHEMA_VERSION;
  snapshotId: string;
  capturedAt: string;
  filePath: string;
  fileName: string;
  bytes: number;
  durationMs: number;
  partial: boolean;
  compacted: boolean;
  sectionSummary?: Array<{ name: string; ok: boolean; truncated?: boolean; error?: boolean }>;
  errorCount?: number;
  truncationCount?: number;
}

export interface MemorySnapshotApiError {
  ok: false;
  code: string;
  message: string;
  partial?: boolean;
}

export type MemorySnapshotResult = MemorySnapshotApiSuccess | MemorySnapshotApiError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact UTC timestamp `YYYYMMDDTHHMMSSmmmZ` for stable, input-free filenames. */
export function compactUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

export function createBudget(deadlineMs = DEFAULT_DEADLINE_MS): DiagnosticBudget {
  const now = Date.now();
  return { now, deadline: now + deadlineMs };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// ---------------------------------------------------------------------------
// Process diagnostics
// ---------------------------------------------------------------------------

/** Capture process memory / resource / V8 metrics. Read-only, never throws the snapshot. */
export function collectProcessDiagnostic(
  budget: DiagnosticBudget,
  memoryBefore: NodeJS.MemoryUsage,
): ProcessDiagnostic {
  const after = process.memoryUsage();
  const result: ProcessDiagnostic = {
    pid: process.pid,
    ppid: process.ppid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: toIso(Date.now() - process.uptime() * 1000),
    memoryUsage: after,
    memoryUsageBeforeCapture: memoryBefore,
    memoryUsageAfterCapture: after,
    memoryDelta: {
      rss: after.rss - memoryBefore.rss,
      heapTotal: after.heapTotal - memoryBefore.heapTotal,
      heapUsed: after.heapUsed - memoryBefore.heapUsed,
      external: after.external - memoryBefore.external,
      arrayBuffers: after.arrayBuffers - memoryBefore.arrayBuffers,
    },
  };
  try {
    result.resourceUsage = process.resourceUsage();
  } catch {
    // resourceUsage may be unavailable on some environments; leave undefined.
  }
  if (!isBudgetExpired(budget)) {
    try {
      const heap = getHeapStatistics();
      // Keep only numeric heap-stat fields; drop any non-numeric extras safely.
      const numeric: Record<string, number> = {};
      for (const [key, value] of Object.entries(heap)) {
        if (typeof value === "number" && Number.isFinite(value)) numeric[key] = value;
      }
      result.heapStatistics = numeric;
    } catch {
      // V8 heap statistics unavailable; leave undefined.
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Heuristic findings (pure)
// ---------------------------------------------------------------------------

export interface FindingsInput {
  memoryUsage: NodeJS.MemoryUsage;
  aliveSessionCount: number;
  registrySessionTotal: number;
  startLockCount: number;
  maxSessionContentBytes: number;
  maxListenerCount: number;
  studioChildPinnedSessionCount: number;
  oldestActiveChildAgeMs: number | null;
  pendingContinuationTotal: number;
  maxPendingContinuationAttempts: number | null;
  pathCacheTotal: number;
  terminalSessionCount: number;
  browserShareCount: number;
}

/**
 * Compute heuristic findings from the projected snapshot numbers. Every
 * finding is explicitly labeled heuristic via its `code` and message wording
 * ("may warrant inspection"); none of these claim a confirmed leak or root
 * cause. Pure function for testability.
 */
export function computeFindings(input: FindingsInput): MemoryDiagnosticFinding[] {
  const findings: MemoryDiagnosticFinding[] = [];
  const rss = input.memoryUsage.rss;
  if (rss >= 2 * GiB) {
    findings.push({
      code: "rss_high",
      severity: "critical",
      message: "Process RSS is very high and may warrant inspection.",
      evidence: { rssBytes: rss, rssMiB: Math.round(rss / MiB) },
    });
  } else if (rss >= 1 * GiB) {
    findings.push({
      code: "rss_high",
      severity: "warning",
      message: "Process RSS is elevated and may warrant inspection.",
      evidence: { rssBytes: rss, rssMiB: Math.round(rss / MiB) },
    });
  }
  const heapUsed = input.memoryUsage.heapUsed;
  if (heapUsed >= 768 * MiB) {
    findings.push({
      code: "heap_used_high",
      severity: "warning",
      message: "V8 heap used is high and may warrant inspection.",
      evidence: { heapUsedBytes: heapUsed, heapUsedMiB: Math.round(heapUsed / MiB) },
    });
  }
  if (input.aliveSessionCount >= 10) {
    findings.push({
      code: "many_alive_sessions",
      severity: "warning",
      message: "Many alive AgentSessions are retained and may warrant inspection.",
      evidence: { aliveSessionCount: input.aliveSessionCount, registryTotal: input.registrySessionTotal },
    });
  }
  if (input.maxSessionContentBytes >= 50 * MiB) {
    findings.push({
      code: "large_session_content",
      severity: "warning",
      message: "A single session retains a large estimated content size and may warrant inspection.",
      evidence: { maxSessionContentBytes: input.maxSessionContentBytes, maxSessionContentMiB: Math.round(input.maxSessionContentBytes / MiB) },
    });
  }
  if (input.maxListenerCount >= 10) {
    findings.push({
      code: "many_listeners",
      severity: "info",
      message: "A session has many event listeners and may warrant inspection.",
      evidence: { maxListenerCount: input.maxListenerCount },
    });
  }
  if (input.startLockCount > 0) {
    findings.push({
      code: "start_locks_held",
      severity: "info",
      message: "AgentSession start locks are currently held.",
      evidence: { startLockCount: input.startLockCount },
    });
  }
  if (input.oldestActiveChildAgeMs !== null && input.oldestActiveChildAgeMs >= 30 * 60 * 1000) {
    findings.push({
      code: "long_running_child",
      severity: "warning",
      message: "A Studio child run has been active for a long time and may warrant inspection.",
      evidence: { ageMs: input.oldestActiveChildAgeMs, ageMinutes: Math.round(input.oldestActiveChildAgeMs / 60000) },
    });
  }
  if (input.pendingContinuationTotal >= 20) {
    findings.push({
      code: "many_pending_continuations",
      severity: "warning",
      message: "Many pending Studio continuations are queued and may warrant inspection.",
      evidence: { pendingContinuationTotal: input.pendingContinuationTotal },
    });
  }
  if (input.maxPendingContinuationAttempts !== null && input.maxPendingContinuationAttempts >= 10) {
    findings.push({
      code: "high_continuation_attempts",
      severity: "warning",
      message: "A pending Studio continuation has many delivery attempts and may warrant inspection.",
      evidence: { maxPendingContinuationAttempts: input.maxPendingContinuationAttempts },
    });
  }
  const pathCacheThreshold = Math.max(500, input.aliveSessionCount * 20);
  if (input.pathCacheTotal >= pathCacheThreshold) {
    findings.push({
      code: "large_path_cache",
      severity: "info",
      message: "Session path cache is large relative to alive sessions and may warrant inspection.",
      evidence: { pathCacheTotal: input.pathCacheTotal, aliveSessionCount: input.aliveSessionCount, threshold: pathCacheThreshold },
    });
  }
  if (input.terminalSessionCount >= 50) {
    findings.push({
      code: "many_terminals",
      severity: "info",
      message: "Many terminal sessions are retained and may warrant inspection.",
      evidence: { terminalSessionCount: input.terminalSessionCount },
    });
  }
  if (input.browserShareCount >= 50) {
    findings.push({
      code: "many_browser_shares",
      severity: "info",
      message: "Many browser share records are retained and may warrant inspection.",
      evidence: { browserShareCount: input.browserShareCount },
    });
  }
  if (input.studioChildPinnedSessionCount > 0) {
    findings.push({
      code: "studio_child_pinned_sessions",
      severity: "info",
      message: "Some AgentSessions are pinned by active Studio child runs.",
      evidence: { studioChildPinnedSessionCount: input.studioChildPinnedSessionCount },
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Runtime section collection (calls owner projections under error isolation)
// ---------------------------------------------------------------------------

export interface RuntimeSections {
  runtime: MemoryDiagnosticSnapshotV1["runtime"];
  errors: DiagnosticSectionError[];
  truncation: DiagnosticTruncation[];
  agentSessions?: RpcRuntimeDiagnostic;
  studio?: StudioRuntimeDiagnostic;
  sessionPathCache?: CacheDiagnostic;
  browserShare?: BrowserShareDiagnostic;
  terminals?: TerminalDiagnostic;
  sessionFileChanges?: SessionFileChangesDiagnostic;
}

function pushTruncation(list: DiagnosticTruncation[], t: DiagnosticTruncation): void {
  if (t.truncated > 0 || t.total > t.sampled) list.push(t);
}

/**
 * Call each owner projection under per-section error isolation. Any section
 * that throws is recorded in `errors` with a bounded message and does not
 * abort the other sections. The cooperative deadline is shared across all
 * sections: once expired, remaining expensive sections are skipped and the
 * snapshot is marked `partial` by the caller.
 */
export async function collectRuntimeSections(budget: DiagnosticBudget, limits: DiagnosticLimits): Promise<RuntimeSections> {
  const runtime: MemoryDiagnosticSnapshotV1["runtime"] = {};
  const errors: DiagnosticSectionError[] = [];
  const truncation: DiagnosticTruncation[] = [];

  // Agent sessions (most informative; collected first).
  if (!isBudgetExpired(budget)) {
    try {
      const { projectRpcRuntimeDiagnostic } = await import("./rpc-manager");
      const rpc = projectRpcRuntimeDiagnostic(budget, limits);
      runtime.agentSessions = rpc;
      pushTruncation(truncation, { section: "agentSessions", field: "sessions", total: rpc.sessions.total, sampled: rpc.sessions.sampled, truncated: rpc.sessions.truncated });
    } catch (error) {
      errors.push({ section: "agentSessions", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    errors.push({ section: "agentSessions", message: "deadline_expired_before_section" });
  }

  // Active session ids for the file-change section; derived after RPC so we
  // do not reverse-import rpc-manager from session-file-changes.
  let activeSessionIds: string[] = [];
  if (!isBudgetExpired(budget)) {
    try {
      const { getActiveRpcSessionIds } = await import("./rpc-manager");
      activeSessionIds = getActiveRpcSessionIds();
    } catch {
      // best-effort; file-change section will simply see no active sessions.
    }
  }

  // Studio runtime.
  if (!isBudgetExpired(budget)) {
    try {
      const { projectYpiStudioRuntime } = await import("./ypi-studio-subagent-runtime");
      const studio = projectYpiStudioRuntime(budget, limits);
      runtime.studio = studio;
      pushTruncation(truncation, { section: "studio", field: "childRuns", total: studio.childRuns.total, sampled: studio.childRuns.sampled, truncated: studio.childRuns.truncated });
      pushTruncation(truncation, { section: "studio", field: "pendingContinuations", total: studio.pendingContinuations.total, sampled: studio.pendingContinuations.sampled, truncated: studio.pendingContinuations.truncated });
    } catch (error) {
      errors.push({ section: "studio", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    errors.push({ section: "studio", message: "deadline_expired_before_section" });
  }

  // Session path cache.
  if (!isBudgetExpired(budget)) {
    try {
      const { projectSessionPathCache } = await import("./session-reader");
      const cache = projectSessionPathCache(budget, limits);
      runtime.sessionPathCache = cache;
      pushTruncation(truncation, { section: "sessionPathCache", field: "samples", total: cache.total, sampled: cache.sampled, truncated: cache.truncated });
    } catch (error) {
      errors.push({ section: "sessionPathCache", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    errors.push({ section: "sessionPathCache", message: "deadline_expired_before_section" });
  }

  // Browser Share.
  if (!isBudgetExpired(budget)) {
    try {
      const { projectBrowserShareRuntime } = await import("./browser-share-manager");
      runtime.browserShare = projectBrowserShareRuntime(budget);
    } catch (error) {
      errors.push({ section: "browserShare", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    errors.push({ section: "browserShare", message: "deadline_expired_before_section" });
  }

  // Terminals.
  if (!isBudgetExpired(budget)) {
    try {
      const { projectTerminalRuntime } = await import("./terminal-manager");
      const term = projectTerminalRuntime(budget, limits);
      runtime.terminals = term;
      pushTruncation(truncation, { section: "terminals", field: "sessions", total: term.sessions.total, sampled: term.sessions.sampled, truncated: term.sessions.truncated });
    } catch (error) {
      errors.push({ section: "terminals", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    errors.push({ section: "terminals", message: "deadline_expired_before_section" });
  }

  // Session file changes (active sessions only).
  if (!isBudgetExpired(budget)) {
    try {
      const { projectSessionFileChanges } = await import("./session-file-changes");
      const changes = projectSessionFileChanges(activeSessionIds, budget, limits);
      runtime.sessionFileChanges = changes;
      pushTruncation(truncation, { section: "sessionFileChanges", field: "sessions", total: changes.sessionCount, sampled: changes.sampled, truncated: changes.truncated });
    } catch (error) {
      errors.push({ section: "sessionFileChanges", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    errors.push({ section: "sessionFileChanges", message: "deadline_expired_before_section" });
  }

  return {
    runtime,
    errors,
    truncation,
    agentSessions: runtime.agentSessions,
    studio: runtime.studio,
    sessionPathCache: runtime.sessionPathCache,
    browserShare: runtime.browserShare,
    terminals: runtime.terminals,
    sessionFileChanges: runtime.sessionFileChanges,
  };
}

// ---------------------------------------------------------------------------
// Snapshot composition
// ---------------------------------------------------------------------------

/** Build the full schema v1 snapshot object from collected sections. */
export function buildSnapshot(args: {
  startedAtMs: number;
  completedAtMs: number;
  partial: boolean;
  limits: DiagnosticLimits;
  processDiagnostic: ProcessDiagnostic | { error: string };
  sections: RuntimeSections;
}): MemoryDiagnosticSnapshotV1 {
  const { startedAtMs, completedAtMs, partial, limits, processDiagnostic, sections } = args;
  const agentSessions = sections.agentSessions;
  const studio = sections.studio;
  const pathCache = sections.sessionPathCache;
  const terminals = sections.terminals;
  const browserShare = sections.browserShare;

  const aliveSessionCount = agentSessions?.aliveCount ?? 0;
  const registrySessionTotal = agentSessions?.registryTotal ?? 0;
  const maxSessionContentBytes = agentSessions?.sessions?.samples?.reduce(
    (max, s) => Math.max(max, s.totalContentBytes),
    0,
  ) ?? 0;
  const maxListenerCount = agentSessions?.sessions?.samples?.reduce(
    (max, s) => Math.max(max, s.listenerCount),
    0,
  ) ?? 0;
  const studioChildPinnedSessionCount = agentSessions?.studioChildPinnedSessionCount ?? 0;
  const pendingContinuationTotal = studio?.pendingContinuationTotal ?? 0;
  const maxPendingAttempts = studio?.pendingContinuations?.samples?.reduce(
    (max, s) => Math.max(max, s.attempts),
    0,
  ) ?? 0;
  const oldestActiveChildAgeMs = studio?.childRuns?.samples?.reduce(
    (max, s) => (typeof s.ageMs === "number" ? Math.max(max, s.ageMs) : max),
    -1,
  ) ?? -1;

  const memoryUsage =
    processDiagnostic && "memoryUsage" in processDiagnostic
      ? processDiagnostic.memoryUsageAfterCapture
      : process.memoryUsage();

  const findings = computeFindings({
    memoryUsage,
    aliveSessionCount,
    registrySessionTotal,
    startLockCount: agentSessions?.startLockCount ?? 0,
    maxSessionContentBytes,
    maxListenerCount,
    studioChildPinnedSessionCount,
    oldestActiveChildAgeMs: oldestActiveChildAgeMs < 0 ? null : oldestActiveChildAgeMs,
    pendingContinuationTotal,
    maxPendingContinuationAttempts: maxPendingAttempts > 0 ? maxPendingAttempts : null,
    pathCacheTotal: pathCache?.total ?? 0,
    terminalSessionCount: terminals?.sessionCount ?? 0,
    browserShareCount: browserShare?.shareCount ?? 0,
  });

  return {
    kind: MEMORY_DIAGNOSTIC_KIND,
    schemaVersion: MEMORY_DIAGNOSTIC_SCHEMA_VERSION,
    snapshotId: randomHex(16),
    capturedAt: toIso(startedAtMs),
    completedAt: toIso(completedAtMs),
    durationMs: completedAtMs - startedAtMs,
    partial,
    compacted: false,
    privacy: {
      includesLocalPaths: true,
      excludes: [
        "message content",
        "tool arguments",
        "tool results",
        "system prompt text",
        "provider response ids",
        "debug error strings",
        "terminal buffer text",
        "browser page snapshot/payload",
        "environment variables",
        "api keys / tokens",
        "studio summaries/transcripts",
      ],
      sharingWarning:
        "This file may contain local workspace/session paths and identifiers. It does not contain message content or credentials. Review before sharing with others.",
    },
    limits,
    process: processDiagnostic,
    runtime: sections.runtime,
    findings,
    errors: sections.errors,
    truncation: sections.truncation,
  };
}

// ---------------------------------------------------------------------------
// Size budget & compact fallback
// ---------------------------------------------------------------------------

/**
 * Return a copy of the snapshot with all bounded per-item sample arrays
 * removed while keeping totals/aggregates/errors/findings. The snapshot is
 * marked `compacted: true`. Pure (returns a new object, does not mutate).
 */
export function compactSnapshot(snapshot: MemoryDiagnosticSnapshotV1): MemoryDiagnosticSnapshotV1 {
  const next: MemoryDiagnosticSnapshotV1 = {
    ...snapshot,
    compacted: true,
    runtime: { ...snapshot.runtime },
  };
  if (next.runtime.agentSessions) {
    next.runtime.agentSessions = { ...next.runtime.agentSessions, sessions: { ...next.runtime.agentSessions.sessions, samples: [] } };
  }
  if (next.runtime.studio) {
    next.runtime.studio = {
      ...next.runtime.studio,
      childRuns: { ...next.runtime.studio.childRuns, samples: [] },
      pendingContinuations: { ...next.runtime.studio.pendingContinuations, samples: [] },
    };
  }
  if (next.runtime.sessionPathCache) {
    next.runtime.sessionPathCache = { ...next.runtime.sessionPathCache, samples: [] };
  }
  if (next.runtime.terminals) {
    next.runtime.terminals = { ...next.runtime.terminals, sessions: { ...next.runtime.terminals.sessions, samples: [] } };
  }
  if (next.runtime.sessionFileChanges) {
    next.runtime.sessionFileChanges = { ...next.runtime.sessionFileChanges, sessions: [] };
  }
  return next;
}

/**
 * Serialize the snapshot under the size budget. If the full form exceeds the
 * limit, a compact form (samples removed, totals retained) is tried once. If
 * even the compact form exceeds the limit, returns an error result; the caller
 * must ensure no final file is written and any temp file is cleaned up.
 */
export function serializeSnapshot(snapshot: MemoryDiagnosticSnapshotV1): { ok: true; json: string; compacted: boolean } | { ok: false; code: string; message: string } {
  const full = JSON.stringify(snapshot);
  if (Buffer.byteLength(full, "utf8") <= MAX_SNAPSHOT_JSON_BYTES) {
    return { ok: true, json: full, compacted: false };
  }
  const compact = compactSnapshot(snapshot);
  const compactJson = JSON.stringify(compact);
  if (Buffer.byteLength(compactJson, "utf8") <= MAX_SNAPSHOT_JSON_BYTES) {
    return { ok: true, json: compactJson, compacted: true };
  }
  return { ok: false, code: "snapshot_too_large", message: `Compact snapshot still exceeds ${MAX_SNAPSHOT_JSON_BYTES} bytes.` };
}

// ---------------------------------------------------------------------------
// Atomic persistence
// ---------------------------------------------------------------------------

export interface WriteSnapshotInput {
  capturedAtMs: number;
  json: string;
}

/** Build a safe, input-free filename and absolute path for a snapshot. */
export function buildSnapshotFilePath(capturedAtMs: number): { dir: string; fileName: string; filePath: string } {
  const dir = join(getAgentDir(), "diagnostics");
  const fileName = `memory-${compactUtc(capturedAtMs)}-pid${process.pid}-${randomHex(4)}.json`;
  const filePath = join(dir, fileName);
  return { dir, fileName, filePath };
}

/**
 * Atomically write the snapshot JSON to the diagnostics directory using a
 * same-directory temp file + rename, with best-effort 0700/0600 permissions.
 * On any failure the temp file is removed and an error result is returned; no
 * partial final file is left behind. Synchronous to keep the single-flight
 * window predictable.
 */
export function writeSnapshotAtomic(input: WriteSnapshotInput):
  | { ok: true; filePath: string; fileName: string; bytes: number }
  | { ok: false; code: string; message: string } {
  const { dir, fileName, filePath } = buildSnapshotFilePath(input.capturedAtMs);
  let tmpPath = "";
  try {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      // Directory may already exist (mkdirSync recursive ignores EEXIST in most
      // cases); only fail if it is not a usable directory.
      try {
        const stat = statSync(dir);
        if (!stat.isDirectory()) throw error;
      } catch {
        return { ok: false, code: "diagnostics_dir_unavailable", message: error instanceof Error ? error.message : String(error) };
      }
    }
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Permission best-effort; platform may not support chmod.
    }
    tmpPath = join(dir, `.~${fileName}.${randomHex(4)}.tmp`);
    writeFileSync(tmpPath, input.json, { mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // best-effort
    }
    renameSync(tmpPath, filePath);
    tmpPath = "";
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // best-effort
    }
    const stat = statSync(filePath);
    return { ok: true, filePath, fileName, bytes: stat.size };
  } catch (error) {
    return { ok: false, code: "atomic_write_failed", message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tmpPath) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Temp cleanup is best-effort.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Section summary for API metadata
// ---------------------------------------------------------------------------

function buildSectionSummary(snapshot: MemoryDiagnosticSnapshotV1): MemorySnapshotApiSuccess["sectionSummary"] {
  const summary: NonNullable<MemorySnapshotApiSuccess["sectionSummary"]> = [];
  const setErr = (name: string) => {
    const err = snapshot.errors.find((e) => e.section === name);
    return err ? { error: true } : {};
  };
  if (snapshot.runtime.agentSessions) {
    summary.push({ name: "agentSessions", ok: true, truncated: snapshot.runtime.agentSessions.sessions.truncated > 0, ...setErr("agentSessions") });
  } else {
    summary.push({ name: "agentSessions", ok: false, ...setErr("agentSessions") });
  }
  if (snapshot.runtime.studio) {
    summary.push({
      name: "studio",
      ok: true,
      truncated: snapshot.runtime.studio.childRuns.truncated > 0 || snapshot.runtime.studio.pendingContinuations.truncated > 0,
      ...setErr("studio"),
    });
  } else {
    summary.push({ name: "studio", ok: false, ...setErr("studio") });
  }
  if (snapshot.runtime.sessionPathCache) {
    summary.push({ name: "sessionPathCache", ok: true, truncated: snapshot.runtime.sessionPathCache.truncated > 0, ...setErr("sessionPathCache") });
  } else {
    summary.push({ name: "sessionPathCache", ok: false, ...setErr("sessionPathCache") });
  }
  if (snapshot.runtime.browserShare) {
    summary.push({ name: "browserShare", ok: true, ...setErr("browserShare") });
  } else {
    summary.push({ name: "browserShare", ok: false, ...setErr("browserShare") });
  }
  if (snapshot.runtime.terminals) {
    summary.push({ name: "terminals", ok: true, truncated: snapshot.runtime.terminals.sessions.truncated > 0, ...setErr("terminals") });
  } else {
    summary.push({ name: "terminals", ok: false, ...setErr("terminals") });
  }
  if (snapshot.runtime.sessionFileChanges) {
    summary.push({ name: "sessionFileChanges", ok: true, truncated: snapshot.runtime.sessionFileChanges.truncated > 0, ...setErr("sessionFileChanges") });
  } else {
    summary.push({ name: "sessionFileChanges", ok: false, ...setErr("sessionFileChanges") });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Capture orchestration
// ---------------------------------------------------------------------------

/**
 * Capture one memory diagnostic snapshot synchronously (projections + atomic
 * write). Never throws; returns a structured result. Does NOT enforce the
 * process-global single-flight — the caller (`triggerMemorySnapshot`) does.
 *
 * Read-only: no abort/destroy/cleanup/reset/GC/session-creation.
 */
export interface CaptureMemorySnapshotOptions {
  /**
   * Optional override for the runtime section collector. Used by focused tests
   * to exercise schema/size/atomic-write/lock logic without loading the heavy
   * owner modules (rpc-manager etc.) which use syntax the Node native TS
   * stripper cannot parse. Production callers omit this and the default
   * `collectRuntimeSections` (dynamic owner imports) is used.
   */
  collectRuntime?: (budget: DiagnosticBudget, limits: DiagnosticLimits) => Promise<RuntimeSections> | RuntimeSections;
}

export async function captureMemorySnapshot(options: CaptureMemorySnapshotOptions = {}): Promise<MemorySnapshotResult> {
  const startedAt = Date.now();
  const budget = createBudget(DEFAULT_DEADLINE_MS);
  const limits = DEFAULT_LIMITS;

  const memoryBefore = process.memoryUsage();

  let processDiagnostic: ProcessDiagnostic | { error: string };
  try {
    processDiagnostic = collectProcessDiagnostic(budget, memoryBefore);
  } catch (error) {
    processDiagnostic = { error: error instanceof Error ? error.message : String(error) };
  }

  let sections: RuntimeSections;
  try {
    sections = options.collectRuntime
      ? await options.collectRuntime(budget, limits)
      : await collectRuntimeSections(budget, limits);
  } catch (error) {
    sections = { runtime: {}, errors: [{ section: "runtime", message: error instanceof Error ? error.message : String(error) }], truncation: [] };
  }
  const partial =
    isBudgetExpired(budget) || sections.errors.length > 0 || "error" in processDiagnostic;

  const completedAt = Date.now();
  const snapshot = buildSnapshot({
    startedAtMs: startedAt,
    completedAtMs: completedAt,
    partial,
    limits,
    processDiagnostic,
    sections,
  });

  const serialized = serializeSnapshot(snapshot);
  if (!serialized.ok) {
    return { ok: false, code: serialized.code, message: serialized.message, partial };
  }
  if (serialized.compacted) {
    snapshot.compacted = true;
  }

  const write = writeSnapshotAtomic({ capturedAtMs: startedAt, json: serialized.json });
  if (!write.ok) {
    return { ok: false, code: write.code, message: write.message, partial };
  }

  const result: MemorySnapshotApiSuccess = {
    ok: true,
    kind: MEMORY_DIAGNOSTIC_KIND,
    schemaVersion: MEMORY_DIAGNOSTIC_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    filePath: write.filePath,
    fileName: write.fileName,
    bytes: write.bytes,
    durationMs: snapshot.durationMs,
    partial: snapshot.partial,
    compacted: serialized.compacted,
    sectionSummary: buildSectionSummary(snapshot),
    errorCount: snapshot.errors.length,
    truncationCount: snapshot.truncation.length,
  };
  return result;
}

// ---------------------------------------------------------------------------
// Process-global single-flight trigger (used by the API route)
// ---------------------------------------------------------------------------

declare global {
    var __piMemoryDiagnosticSnapshotInFlight: Promise<MemorySnapshotResult> | null | undefined;
}

function getInFlight(): Promise<MemorySnapshotResult> | null {
  return globalThis.__piMemoryDiagnosticSnapshotInFlight ?? null;
}

function setInFlight(p: Promise<MemorySnapshotResult> | null): void {
  globalThis.__piMemoryDiagnosticSnapshotInFlight = p;
}

/**
 * Trigger a memory diagnostic snapshot with a process-global single-flight
 * guard. If a snapshot is already in flight, returns `snapshot_in_progress`
 * synchronously without performing any work.
 *
 * Implementation note: `captureMemorySnapshot` is synchronous, so to make the
 * in-flight guard observable across overlapping requests, the actual capture
 * is deferred to a microtask. The caller sets the in-flight promise
 * synchronously before that microtask runs, so a second request arriving in
 * the same tick (or before the queued microtask completes) observes the lock
 * and gets a 409 without performing any work.
 */
export async function triggerMemorySnapshot(options: CaptureMemorySnapshotOptions = {}): Promise<MemorySnapshotResult> {
  if (getInFlight()) {
    return { ok: false, code: "snapshot_in_progress", message: "A memory diagnostic snapshot is already being captured. Please retry shortly." };
  }
  // `captureMemorySnapshot` is async (dynamic owner imports / injected
  // collector both yield), so the synchronous assignment below is observed by
  // overlapping requests before the in-flight capture resolves. The finally
  // clears the lock when the capture settles either way.
  const promise = (async () => {
    try {
      return await captureMemorySnapshot(options);
    } finally {
      setInFlight(null);
    }
  })();
  setInFlight(promise);
  return promise;
}