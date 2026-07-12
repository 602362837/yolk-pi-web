// Content-safe, bounded stage timing for session-list requests.
//
// PERF-001 (measure phase): this module is intentionally read-only and side
// effect free. It only records stage durations (ms) and integer counts. It
// MUST NEVER store or log session titles, first messages, tool content,
// prompt bodies, file contents, absolute session paths beyond a derived
// space path-free stage label, or any credential material. The goal is to
// let a slow request be attributed to its dominant stage (registry,
// active inventory, header parse, Studio projection, archive scan, or
// filter/serialize) without leaking user data.
//
// The collector has no global state and no I/O. Arrays/maps are bounded by
// the small fixed set of known stage names; counts are unbounded integers
// but only accumulate scalar numbers. Leaving the optional `timing`
// parameter unset on `listAllSessions` and the route keeps production
// overhead at essentially zero (one extra argument that is `undefined`).

export interface SessionListStageRecord {
  /** Accumulated wall-clock duration in milliseconds. */
  ms: number;
  /** Number of times `start`/`stop` (or measure) ran for this stage. */
  count: number;
}

export interface SessionListTimingSnapshot {
  stages: Record<string, SessionListStageRecord>;
  counts: Record<string, number>;
  totalMs: number;
}

const knownStages = [
  "registry",
  "inventory",
  "header",
  "studioProjection",
  "archive",
  "filter",
  "serialize",
] as const;

/**
 * Bounded, content-safe timing collector for a single session-list request.
 *
 * Stores only scalar durations and counts keyed by a fixed set of stage
 * names plus arbitrary scalar count names. It never retains session
 * content, titles, paths, or tool output.
 */
export class SessionListTimingCollector {
  private readonly stages = new Map<string, SessionListStageRecord>();
  private readonly marks = new Map<string, number>();
  private readonly counts = new Map<string, number>();

  markKnown(): void {
    for (const stage of knownStages) {
      if (!this.stages.has(stage)) this.stages.set(stage, { ms: 0, count: 0 });
    }
  }

  start(stage: string): void {
    this.marks.set(stage, nowMs());
  }

  stop(stage: string): void {
    const t = this.marks.get(stage);
    if (t == null) return;
    const record = this.stages.get(stage) ?? { ms: 0, count: 0 };
    record.ms += nowMs() - t;
    record.count += 1;
    this.stages.set(stage, record);
    this.marks.delete(stage);
  }

  /** Measure sync or async work without forcing callers to wrap sync functions. */
  async measureAsync<T>(stage: string, fn: () => T | Promise<T>): Promise<T> {
    this.start(stage);
    try {
      return await fn();
    } finally {
      this.stop(stage);
    }
  }

  measureSync<T>(stage: string, fn: () => T): T {
    this.start(stage);
    try {
      return fn();
    } finally {
      this.stop(stage);
    }
  }

  addCount(name: string, n = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + n);
  }

  getCount(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  snapshot(): SessionListTimingSnapshot {
    const stages: Record<string, SessionListStageRecord> = {};
    for (const [name, record] of this.stages) {
      stages[name] = { ms: roundMs(record.ms), count: record.count };
    }
    const counts: Record<string, number> = {};
    for (const [name, value] of this.counts) {
      counts[name] = value;
    }
    return { stages, counts, totalMs: roundMs(this.totalMsRaw()) };
  }

  private totalMsRaw(): number {
    // Nested reader stages (for example inventory/header inside listAll) must
    // not be summed twice. The route stages are sequential, so use the largest
    // measured stage as a conservative request total until explicit spans are
    // added.
    return Math.max(0, ...[...this.stages.values()].map((record) => record.ms));
  }
}

function nowMs(): number {
  // `performance` is available globally in Node 18+ and the browser.
  const perf = (globalThis as { performance?: { now: () => number } }).performance;
  return perf ? perf.now() : Date.now();
}

function roundMs(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Logging gate: only emit timing logs on a slow-request threshold or an
// explicit debug switch so normal requests stay silent and content-free.
// ---------------------------------------------------------------------------

const TIMING_DEBUG_ENV = "PI_WEB_SESSION_LIST_TIMING_DEBUG";
const TIMING_THRESHOLD_ENV = "PI_WEB_SESSION_LIST_TIMING_THRESHOLD_MS";
const DEFAULT_SLOW_THRESHOLD_MS = 1500;

export function sessionListTimingDebugEnabled(): boolean {
  return process.env[TIMING_DEBUG_ENV] === "1" || process.env[TIMING_DEBUG_ENV] === "true";
}

export function sessionListTimingSlowThresholdMs(): number {
  const raw = Number(process.env[TIMING_THRESHOLD_ENV]);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SLOW_THRESHOLD_MS;
  return raw;
}

export function shouldLogSessionListTiming(totalMs: number): boolean {
  if (sessionListTimingDebugEnabled()) return true;
  return totalMs >= sessionListTimingSlowThresholdMs();
}

/**
 * Format a content-safe, bounded one-line log string from a timing snapshot.
 * Only includes stage durations, scalar counts, and the request's derived
 * projectId/spaceId identifiers (these are opaque registry ids, not user
 * content; pass empty strings if you do not want even those). Never includes
 * titles, messages, paths, or tool content.
 */
export function formatSessionListTimingLog(
  snapshot: SessionListTimingSnapshot,
  context?: { projectId?: string; spaceId?: string },
): string {
  const stageParts: string[] = [];
  for (const stage of knownStages) {
    const record = snapshot.stages[stage];
    if (record) stageParts.push(`${stage}=${formatMs(record.ms)}(${record.count})`);
  }
  const countParts: string[] = [];
  for (const [name, value] of Object.entries(snapshot.counts)) {
    countParts.push(`${name}=${value}`);
  }
  const ctx = context?.projectId || context?.spaceId
    ? ` project=${context.projectId ?? ""} space=${context.spaceId ?? ""}`
    : "";
  return `[session-list-timing] total=${formatMs(snapshot.totalMs)} stages[${stageParts.join(" ")}] counts[${countParts.join(" ")}]${ctx}`;
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}