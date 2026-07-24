/**
 * github-automation-scheduler — durable job scheduler for GitHub automation (GHA-02).
 *
 * Responsibilities:
 * - Wake / poll queued, retry_due, and stale-running jobs.
 * - Per-job filesystem lease so multiple processes do not run the same effect twice.
 * - Concurrency caps from config (P0 triage default 2).
 * - Never runs LLM/Git work inline on the webhook request thread; webhook only enqueues.
 *
 * GHA-02 ships orchestration + checkpoint resume hooks. Actual triage/claim effects
 * are registered by later phases via `setGithubAutomationJobHandler`.
 */

import { randomUUID } from "node:crypto";

import { readGithubAutomationConfig } from "./github-automation-config";
import type { GithubAutomationConfigV1 } from "./github-automation-types";
import {
  appendGithubAutomationSafeEvent,
  listGithubAutomationJobs,
  readGithubAutomationJob,
  withGithubAutomationJobLease,
  writeGithubAutomationJob,
  type GithubAutomationJobRecord,
  type GithubAutomationJobStatus,
} from "./github-automation-store";

// ─── Handler registry ────────────────────────────────────────────────────────

export type GithubAutomationJobHandlerResult = {
  job: GithubAutomationJobRecord;
  /**
   * When true, scheduler will re-check queue soon (e.g. more work available).
   * Default false.
   */
  wakeAgain?: boolean;
};

/**
 * Job handler runs under job lease. GHA-02 default is a no-op advance to a safe
 * waiting checkpoint so webhook→enqueue→scheduler path is testable without GHA-03.
 */
export type GithubAutomationJobHandler = (
  job: GithubAutomationJobRecord,
  context: { config: GithubAutomationConfigV1; ownerId: string },
) => Promise<GithubAutomationJobHandlerResult>;

let _jobHandler: GithubAutomationJobHandler | null = null;

/**
 * Register the durable job handler (GHA-03+). Pass null to restore default.
 */
export function setGithubAutomationJobHandler(
  handler: GithubAutomationJobHandler | null,
): void {
  _jobHandler = handler;
}

export function getGithubAutomationJobHandler(): GithubAutomationJobHandler {
  return _jobHandler ?? defaultJobHandler;
}

/**
 * Default handler for GHA-02: mark job as awaiting claim_readiness without
 * performing remote GitHub mutations. GHA-03 replaces this with full claim/triage.
 */
async function defaultJobHandler(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobHandlerResult> {
  const now = new Date().toISOString();
  // Only advance pure "received" jobs once; leave other phases untouched.
  if (job.phase === "received" && job.status === "running") {
    const next: GithubAutomationJobRecord = {
      ...job,
      phase: "claim_readiness",
      status: "queued",
      checkpoint: "claim_readiness",
      updatedAt: now,
      reasonCode: "awaiting_claim_handler",
    };
    await writeGithubAutomationJob(next);
    await appendGithubAutomationSafeEvent({
      at: now,
      kind: "job_checkpoint",
      repositoryId: next.repositoryId,
      issueNumber: next.issueNumber,
      jobId: next.jobId,
      deliveryId: next.deliveryId,
      phase: next.phase,
      reasonCode: next.reasonCode,
      traceId: next.traceId,
      meta: { handler: "default_gha02" },
    });
    return { job: next, wakeAgain: false };
  }
  return { job, wakeAgain: false };
}

// ─── Runtime state (process-local) ───────────────────────────────────────────

interface SchedulerState {
  ownerId: string;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** jobIds currently executing in this process */
  inFlight: Set<string>;
  wakeGeneration: number;
  lastTickAt: string | null;
  lastError: string | null;
  started: boolean;
  /** Test hook: disable auto-timer */
  autoSchedule: boolean;
  pollIntervalMs: number;
}

declare global {
  var __piGithubAutomationScheduler: SchedulerState | undefined;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const STALE_RUNNING_MS = 5 * 60_000;

function getState(): SchedulerState {
  if (!globalThis.__piGithubAutomationScheduler) {
    globalThis.__piGithubAutomationScheduler = {
      ownerId: `gha-sched-${process.pid}-${randomUUID().slice(0, 8)}`,
      timer: null,
      running: false,
      inFlight: new Set(),
      wakeGeneration: 0,
      lastTickAt: null,
      lastError: null,
      started: false,
      autoSchedule: true,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    };
  }
  return globalThis.__piGithubAutomationScheduler;
}

/** Test-only controls. */
export function _testGetGithubAutomationSchedulerState(): SchedulerState {
  return getState();
}

export function _testResetGithubAutomationScheduler(): void {
  const state = getState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.running = false;
  state.inFlight.clear();
  state.wakeGeneration = 0;
  state.lastTickAt = null;
  state.lastError = null;
  state.started = false;
  state.autoSchedule = true;
  state.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  // Drop global so next getState recreates clean owner id if desired.
  globalThis.__piGithubAutomationScheduler = undefined;
}

export function _testSetGithubAutomationSchedulerAuto(auto: boolean): void {
  getState().autoSchedule = auto;
  if (!auto && getState().timer) {
    clearTimeout(getState().timer!);
    getState().timer = null;
  }
}

export function _testSetGithubAutomationSchedulerPollIntervalMs(ms: number): void {
  getState().pollIntervalMs = Math.max(10, ms);
}

// ─── Selection helpers ───────────────────────────────────────────────────────

function isTerminalStatus(status: GithubAutomationJobStatus): boolean {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "ignored" ||
    status === "blocked"
  );
}

function isRunnableNow(
  job: GithubAutomationJobRecord,
  nowMs: number,
): boolean {
  if (isTerminalStatus(job.status)) return false;
  if (job.status === "paused") return false;

  // GHA-02 default handler parks jobs at claim_readiness until GHA-03 registers
  // a real triage handler. Custom handlers may clear this reasonCode.
  if (
    job.reasonCode === "awaiting_claim_handler" &&
    job.phase !== "received" &&
    _jobHandler === null
  ) {
    return false;
  }

  if (job.status === "queued") return true;
  if (job.status === "retry_due") {
    if (!job.nextRetryAt) return true;
    const t = Date.parse(job.nextRetryAt);
    return !Number.isFinite(t) || t <= nowMs;
  }
  if (job.status === "running") {
    // Stale running: lease/process died mid-flight.
    const updated = Date.parse(job.updatedAt);
    if (Number.isFinite(updated) && nowMs - updated >= STALE_RUNNING_MS) {
      return true;
    }
    return false;
  }
  return false;
}

async function markStaleRunningAsRetry(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobRecord> {
  if (job.status !== "running") return job;
  const updated = Date.parse(job.updatedAt);
  if (!Number.isFinite(updated) || Date.now() - updated < STALE_RUNNING_MS) {
    return job;
  }
  const next: GithubAutomationJobRecord = {
    ...job,
    status: "retry_due",
    nextRetryAt: new Date().toISOString(),
    reasonCode: "stale_running_reconcile",
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: new Date().toISOString(),
  };
  await writeGithubAutomationJob(next);
  await appendGithubAutomationSafeEvent({
    at: next.updatedAt,
    kind: "job_stale_reconcile",
    repositoryId: next.repositoryId,
    issueNumber: next.issueNumber,
    jobId: next.jobId,
    deliveryId: next.deliveryId,
    phase: next.phase,
    reasonCode: next.reasonCode,
    traceId: next.traceId,
  });
  return next;
}

// ─── Tick ────────────────────────────────────────────────────────────────────

export interface GithubAutomationSchedulerTickResult {
  scanned: number;
  started: number;
  skipped: number;
  errors: number;
  inFlight: number;
}

/**
 * Single scheduler tick: reconcile + start up to concurrency limit.
 * Safe to call from webhook after enqueue (fire-and-forget) or timer.
 */
export async function tickGithubAutomationScheduler(): Promise<GithubAutomationSchedulerTickResult> {
  const state = getState();
  if (state.running) {
    return {
      scanned: 0,
      started: 0,
      skipped: 0,
      errors: 0,
      inFlight: state.inFlight.size,
    };
  }
  state.running = true;
  state.started = true;
  let scanned = 0;
  let started = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const config = await readGithubAutomationConfig();
    if (!config.enabled || config.mode === "off" || config.paused) {
      state.lastTickAt = new Date().toISOString();
      return {
        scanned: 0,
        started: 0,
        skipped: 0,
        errors: 0,
        inFlight: state.inFlight.size,
      };
    }

    const maxConcurrency = Math.max(1, config.triage.maxConcurrency);
    const jobs = await listGithubAutomationJobs();
    scanned = jobs.length;
    const nowMs = Date.now();

    // Reconcile stale running first.
    const reconciled: GithubAutomationJobRecord[] = [];
    for (const job of jobs) {
      reconciled.push(await markStaleRunningAsRetry(job));
    }

    const candidates = reconciled
      .filter((j) => isRunnableNow(j, nowMs))
      .filter((j) => !state.inFlight.has(j.jobId))
      // FIFO by createdAt then jobId
      .sort((a, b) => {
        const ac = Date.parse(a.createdAt) || 0;
        const bc = Date.parse(b.createdAt) || 0;
        if (ac !== bc) return ac - bc;
        return a.jobId.localeCompare(b.jobId);
      });

    const availableSlots = Math.max(0, maxConcurrency - state.inFlight.size);
    const toStart = candidates.slice(0, availableSlots);
    skipped = Math.max(0, candidates.length - toStart.length);

    for (const job of toStart) {
      started += 1;
      state.inFlight.add(job.jobId);
      // Fire-and-forget per job; errors captured in job/event trail.
      void runJobUnderLease(job.jobId, config, state.ownerId)
        .catch(async (err) => {
          errors += 1;
          state.lastError = "job_handler_error";
          try {
            await appendGithubAutomationSafeEvent({
              at: new Date().toISOString(),
              kind: "job_handler_error",
              repositoryId: job.repositoryId,
              issueNumber: job.issueNumber,
              jobId: job.jobId,
              deliveryId: job.deliveryId,
              phase: job.phase,
              reasonCode: "handler_error",
              traceId: job.traceId,
              meta: {
                message:
                  err instanceof Error
                    ? err.message.slice(0, 120)
                    : "unknown",
              },
            });
          } catch {
            // ignore
          }
        })
        .finally(() => {
          state.inFlight.delete(job.jobId);
          // Schedule follow-up if auto.
          scheduleGithubAutomationScheduler(state.pollIntervalMs);
        });
    }

    state.lastTickAt = new Date().toISOString();
    return {
      scanned,
      started,
      skipped,
      errors,
      inFlight: state.inFlight.size,
    };
  } catch (err) {
    state.lastError = "tick_error";
    state.lastTickAt = new Date().toISOString();
    throw err;
  } finally {
    state.running = false;
  }
}

async function runJobUnderLease(
  jobId: string,
  config: GithubAutomationConfigV1,
  ownerId: string,
): Promise<void> {
  await withGithubAutomationJobLease(jobId, async (lease) => {
    const current = await readGithubAutomationJob(jobId);
    if (!current) return;
    if (isTerminalStatus(current.status) || current.status === "paused") {
      return;
    }

    // Another process may have claimed running recently.
    if (
      current.status === "running" &&
      current.leaseOwner &&
      current.leaseOwner !== lease.ownerId
    ) {
      const updated = Date.parse(current.updatedAt);
      if (Number.isFinite(updated) && Date.now() - updated < STALE_RUNNING_MS) {
        return;
      }
    }

    const now = new Date().toISOString();
    const runningJob: GithubAutomationJobRecord = {
      ...current,
      status: "running",
      attempt: current.attempt + 1,
      leaseOwner: lease.ownerId,
      leaseExpiresAt: new Date(Date.now() + STALE_RUNNING_MS).toISOString(),
      updatedAt: now,
    };
    await writeGithubAutomationJob(runningJob);
    await appendGithubAutomationSafeEvent({
      at: now,
      kind: "job_started",
      repositoryId: runningJob.repositoryId,
      issueNumber: runningJob.issueNumber,
      jobId: runningJob.jobId,
      deliveryId: runningJob.deliveryId,
      phase: runningJob.phase,
      reasonCode: null,
      traceId: runningJob.traceId,
      meta: { attempt: runningJob.attempt, ownerId: lease.ownerId },
    });

    const handler = getGithubAutomationJobHandler();
    const result = await handler(runningJob, { config, ownerId });
    // Handler is responsible for writing next status; if still "running", park as queued.
    const after = await readGithubAutomationJob(jobId);
    if (after && after.status === "running") {
      const parked: GithubAutomationJobRecord = {
        ...after,
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      };
      await writeGithubAutomationJob(parked);
    }
    if (result.wakeAgain) {
      wakeGithubAutomationScheduler();
    }
  });
}

// ─── Wake / ensure ───────────────────────────────────────────────────────────

function armTimer(delayMs: number): void {
  const state = getState();
  if (!state.autoSchedule) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.timer = setTimeout(() => {
    state.timer = null;
    void tickGithubAutomationScheduler().catch(() => {
      // lastError already set inside tick when possible
    });
  }, Math.max(0, delayMs));
  // Do not keep the process alive solely for the scheduler in tests/CLI.
  if (typeof state.timer === "object" && state.timer && "unref" in state.timer) {
    try {
      (state.timer as NodeJS.Timeout).unref();
    } catch {
      // ignore
    }
  }
}

/**
 * Schedule a future tick (debounced). Does not run work synchronously.
 */
export function scheduleGithubAutomationScheduler(delayMs?: number): void {
  const state = getState();
  state.started = true;
  armTimer(delayMs ?? state.pollIntervalMs);
}

/**
 * Immediate wake: schedule tick ASAP. Safe from webhook after enqueue.
 * Does not block; does not run LLM/Git in the caller stack beyond a microtask tick.
 */
export function wakeGithubAutomationScheduler(): void {
  const state = getState();
  state.wakeGeneration += 1;
  state.started = true;
  armTimer(0);
}

/**
 * Lazy ensure: start background polling if not already started.
 * Reconciles queue without requiring an inbound webhook.
 */
export function ensureGithubAutomationScheduler(): void {
  const state = getState();
  if (state.started && state.timer) return;
  state.started = true;
  armTimer(0);
}

export function getGithubAutomationSchedulerSnapshot(): {
  ownerId: string;
  started: boolean;
  running: boolean;
  inFlight: number;
  lastTickAt: string | null;
  lastError: string | null;
  wakeGeneration: number;
} {
  const state = getState();
  return {
    ownerId: state.ownerId,
    started: state.started,
    running: state.running,
    inFlight: state.inFlight.size,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    wakeGeneration: state.wakeGeneration,
  };
}
