/**
 * github-automation-scheduler — durable job scheduler for GitHub Issue Analysis (GIA).
 *
 * Responsibilities:
 * - Wake / poll queued, retry_due, and stale-running `kind=issue_analysis` jobs only.
 * - Per-job filesystem lease so multiple processes do not run the same effect twice.
 * - Concurrency caps from config (`analysis.maxConcurrency`, default 2).
 * - Never runs model/Git work inline on the webhook request thread; webhook only enqueues.
 * - Honor explicit job disposition (progressed/waiting/retry_due/blocked/terminal);
 *   no-progress must not park immediately as runnable queued; lease heartbeat + fencing;
 *   attempt remains scheduler lease-run count.
 *
 * Production handler is the single-purpose issue analysis runner. The retired claim /
 * unattended / publisher graph is never loaded from this module.
 */

import { randomUUID } from "node:crypto";

import { readGithubAutomationConfig } from "./github-automation-config";
import type {
  GithubAutomationConfigV2,
  GithubAutomationJobDisposition,
} from "./github-automation-types";
import {
  classifyGithubAutomationRetryability,
} from "./github-automation-types";
import {
  getGithubAutomationEvaluatedProvenance,
} from "./github-automation-provenance";
import {
  appendGithubAutomationSafeEvent,
  GITHUB_AUTOMATION_LEASE_HEARTBEAT_MS,
  isGithubIssueAnalysisJobSchedulable,
  isLegacyGithubAutomationJob,
  listGithubAutomationJobs,
  readGithubAutomationJob,
  withGithubAutomationJobLease,
  writeGithubAutomationJob,
  writeGithubAutomationJobWithFencing,
  type GithubAutomationJobRecord,
  type GithubAutomationJobStatus,
  type GithubAutomationLeaseHandle,
} from "./github-automation-store";

/** @deprecated Alias for live schema v2 config. */
type GithubAutomationConfigV1 = GithubAutomationConfigV2;

// ─── Handler registry ────────────────────────────────────────────────────────

export type GithubAutomationJobHandlerResult = {
  job: GithubAutomationJobRecord;
  /**
   * When true, scheduler will re-check queue soon (e.g. more work available).
   * Default false. singleStep may set this only after real checkpoint progress.
   */
  wakeAgain?: boolean;
  /**
   * Explicit lease disposition (GHA-CLOSE-02). When absent, scheduler derives a
   * conservative disposition from job status/progressRevision change.
   */
  disposition?: GithubAutomationJobDisposition;
};

/**
 * Job handler runs under job lease. GHA-02 default is a no-op advance to a safe
 * waiting checkpoint so webhook→enqueue→scheduler path is testable without GHA-03.
 *
 * Context includes the active lease handle so long handlers can heartbeat / fence.
 */
export type GithubAutomationJobHandler = (
  job: GithubAutomationJobRecord,
  context: {
    config: GithubAutomationConfigV1;
    ownerId: string;
    lease?: GithubAutomationLeaseHandle;
  },
) => Promise<GithubAutomationJobHandlerResult>;

/**
 * Live registry kind. Analysis production registers as `custom` (or explicit `default`
 * for isolation tests). The retired `github_issue_triage` kind is no longer accepted.
 */
export type GithubAutomationHandlerKind =
  | "none"
  | "default"
  | "custom";

export type GithubAutomationHandlerRegistration =
  | { kind: "none"; generation: 0; handler: null }
  | {
      kind: "default";
      generation: number;
      handler: GithubAutomationJobHandler;
    }
  | {
      kind: "custom";
      generation: number;
      handler: GithubAutomationJobHandler;
    };

interface HandlerRegistryState {
  registration: GithubAutomationHandlerRegistration;
  /** Monotonic generation bumped on every set (including null restore). */
  generationCounter: number;
  /**
   * When true, tick/ensure will NOT auto-load the full triage handler.
   * Used only by explicit GHA-02 isolation tests that exercise defaultJobHandler.
   */
  productionReadinessDisabled: boolean;
}

declare global {
  var __piGithubAutomationHandlerRegistry: HandlerRegistryState | undefined;
}

function getHandlerRegistry(): HandlerRegistryState {
  if (!globalThis.__piGithubAutomationHandlerRegistry) {
    globalThis.__piGithubAutomationHandlerRegistry = {
      registration: { kind: "none", generation: 0, handler: null },
      generationCounter: 0,
      productionReadinessDisabled: false,
    };
  }
  return globalThis.__piGithubAutomationHandlerRegistry;
}

/** Live registry snapshot (authoritative for readiness). */
export function getGithubAutomationJobHandlerRegistration(): GithubAutomationHandlerRegistration {
  return getHandlerRegistry().registration;
}

export function isGithubAutomationProductionHandlerReady(): boolean {
  // Analysis production registers as custom; default is only for isolation tests.
  const kind = getHandlerRegistry().registration.kind;
  return kind === "custom" || kind === "default";
}

/**
 * Register the durable job handler.
 * - Production: `registerGithubIssueAnalysisJobHandler()` (kind `custom`).
 * - Focused tests may pass a custom function (kind becomes `custom`).
 * - Pass null to restore the default parking handler (isolated tests only).
 */
export function setGithubAutomationJobHandler(
  handler: GithubAutomationJobHandler | null,
  options?: { kind?: Exclude<GithubAutomationHandlerKind, "none"> },
): void {
  const registry = getHandlerRegistry();
  registry.generationCounter += 1;
  const generation = registry.generationCounter;
  if (!handler) {
    registry.registration = {
      kind: "default",
      generation,
      handler: defaultJobHandler,
    };
    return;
  }
  const kind = options?.kind ?? "custom";
  if (kind === "default") {
    registry.registration = {
      kind: "default",
      generation,
      handler,
    };
    return;
  }
  registry.registration = {
    kind: "custom",
    generation,
    handler,
  };
}

/**
 * Production registration for the single-purpose issue analysis handler.
 */
export function registerGithubIssueAnalysisJobHandler(
  handler?: GithubAutomationJobHandler,
): void {
  if (handler) {
    setGithubAutomationJobHandler(handler, { kind: "custom" });
    return;
  }
  // Lazy load analysis runner without static import of model/evidence graph at module top.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./github-issue-analysis-runner") as {
      githubIssueAnalysisJobHandler?: GithubAutomationJobHandler;
      handleGithubIssueAnalysisJob?: GithubAutomationJobHandler;
    };
    const h =
      mod.githubIssueAnalysisJobHandler ?? mod.handleGithubIssueAnalysisJob;
    if (h) {
      setGithubAutomationJobHandler(h, { kind: "custom" });
    }
  } catch {
    // Tick will keep default handler; analysis jobs may retry.
  }
}

export function getGithubAutomationJobHandler(): GithubAutomationJobHandler {
  const reg = getHandlerRegistry().registration;
  if (reg.handler) return reg.handler;
  return defaultJobHandler;
}

/**
 * Test-only: allow defaultJobHandler isolation without production readiness gate.
 * Production must never disable readiness.
 */
export function _testSetGithubAutomationProductionHandlerReadinessDisabled(
  disabled: boolean,
): void {
  getHandlerRegistry().productionReadinessDisabled = disabled;
}

/** True only when isolation tests disabled the production readiness gate. */
export function isGithubAutomationProductionHandlerReadinessDisabled(): boolean {
  return getHandlerRegistry().productionReadinessDisabled === true;
}

export function _testResetGithubAutomationHandlerRegistry(): void {
  globalThis.__piGithubAutomationHandlerRegistry = undefined;
}

/**
 * Default parking handler used only when analysis registration has not yet
 * loaded (or isolation tests disable auto-register). Never advances claim /
 * unattended phases — analysis jobs stay at received until the analysis
 * handler is registered.
 */
async function defaultJobHandler(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobHandlerResult> {
  const now = new Date().toISOString();

  // Isolation tests may leave the job untouched so they can assert registry state.
  if (getHandlerRegistry().productionReadinessDisabled) {
    return { job, wakeAgain: false };
  }

  // Defensive: production analysis jobs must not return unchanged
  // (scheduler would classify as runner_no_progress).
  const nextRetryAt = new Date(Date.now() + 5_000).toISOString();
  const next: GithubAutomationJobRecord = {
    ...job,
    status: "retry_due",
    reasonCode: "handler_not_ready",
    blockedAtLayer: "scheduler",
    retryability: "automatic",
    nextRetryAt,
    updatedAt: now,
  };
  await writeGithubAutomationJob(next);
  await appendGithubAutomationSafeEvent({
    at: now,
    kind: "github_automation_handler_not_ready",
    repositoryId: next.repositoryId,
    issueNumber: next.issueNumber,
    jobId: next.jobId,
    deliveryId: next.deliveryId,
    phase: next.phase,
    reasonCode: "handler_not_ready",
    traceId: next.traceId,
    meta: {
      stage: "verify",
      retryability: "automatic",
      handlerKindExpected: "custom",
      diagnosticCode: "default_handler_defensive_fallback",
    },
  });
  return {
    job: next,
    wakeAgain: false,
    disposition: {
      kind: "retry_due",
      reasonCode: "handler_not_ready",
      nextRetryAt,
      retryClass: "runtime",
    },
  };
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
/** Cap for consecutive no-progress lease runs before stable operator block. */
const NO_PROGRESS_BLOCK_THRESHOLD = 8;
/** Base backoff for runner_no_progress (ms); exponential with cap. */
const NO_PROGRESS_BACKOFF_BASE_MS = 5_000;
const NO_PROGRESS_BACKOFF_CAP_MS = 5 * 60_000;

function computeNoProgressBackoffMs(noProgressRunCount: number): number {
  const exp = Math.max(0, Math.min(10, noProgressRunCount - 1));
  const raw = NO_PROGRESS_BACKOFF_BASE_MS * 2 ** exp;
  const capped = Math.min(NO_PROGRESS_BACKOFF_CAP_MS, raw);
  // Small deterministic jitter (±12.5%) without Math.random in hot path tests.
  const jitter = Math.floor(capped * 0.125 * ((noProgressRunCount % 5) - 2) / 2);
  return Math.max(NO_PROGRESS_BACKOFF_BASE_MS, capped + jitter);
}

function progressRevisionOf(job: GithubAutomationJobRecord): number {
  return typeof job.progressRevision === "number" && Number.isFinite(job.progressRevision)
    ? Math.max(0, Math.floor(job.progressRevision))
    : 0;
}

function noProgressCountOf(job: GithubAutomationJobRecord): number {
  return typeof job.noProgressRunCount === "number" && Number.isFinite(job.noProgressRunCount)
    ? Math.max(0, Math.floor(job.noProgressRunCount))
    : 0;
}

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
  // Handler registry is independent; tests that need a clean registry call
  // _testResetGithubAutomationHandlerRegistry() and/or setGithubAutomationJobHandler(null).
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
  // GIA-01 hard gate: only schema v2 kind=issue_analysis may ever be leased.
  // Legacy/v1/closed-loop jobs are permanently non-runnable here.
  if (isLegacyGithubAutomationJob(job) || !isGithubIssueAnalysisJobSchedulable(job)) {
    return false;
  }

  if (isTerminalStatus(job.status)) return false;
  if (job.status === "paused") return false;

  // handler_not_ready: honor nextRetryAt backoff; never immediately re-lease.
  if (job.reasonCode === "handler_not_ready" && job.status === "retry_due") {
    if (!job.nextRetryAt) return true;
    const t = Date.parse(job.nextRetryAt);
    return !Number.isFinite(t) || t <= nowMs;
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
  inFlight: Set<string>,
): Promise<GithubAutomationJobRecord> {
  if (job.status !== "running") return job;
  // GHA-CLOSE-02: never steal a job that is actively running in this process.
  if (inFlight.has(job.jobId)) return job;

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
    leaseFencingToken: null,
    leaseHeartbeatAt: null,
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

/**
 * Apply post-handler disposition. Never parks no-progress work as immediately
 * runnable `queued` (the #22 scheduler spin root cause).
 */
async function applyHandlerDisposition(input: {
  jobId: string;
  before: GithubAutomationJobRecord;
  after: GithubAutomationJobRecord;
  result: GithubAutomationJobHandlerResult;
  fencingToken: string;
  ownerId: string;
}): Promise<{ job: GithubAutomationJobRecord; wakeAgain: boolean; delayMs: number | null }> {
  const { jobId, before, result, fencingToken, ownerId } = input;
  let after = input.after;
  const beforeRev = progressRevisionOf(before);
  const afterRev = progressRevisionOf(after);
  const progressed =
    afterRev > beforeRev ||
    (after.checkpoint != null &&
      before.checkpoint != null &&
      after.checkpoint !== before.checkpoint) ||
    after.phase !== before.phase;

  let disposition = result.disposition;
  if (!disposition) {
    if (isTerminalStatus(after.status)) {
      disposition = {
        kind: "terminal",
        status:
          after.status === "completed" ||
          after.status === "cancelled" ||
          after.status === "ignored"
            ? after.status
            : "completed",
      };
    } else if (after.status === "blocked") {
      disposition = {
        kind: "blocked",
        reasonCode: after.reasonCode ?? "blocked",
        layer: (after.blockedAtLayer as never) ?? "unknown",
        fingerprint: after.blockFingerprint ?? "legacy",
        retryability:
          (after.retryability as never) ??
          classifyGithubAutomationRetryability(after.reasonCode),
      };
    } else if (after.status === "retry_due") {
      disposition = {
        kind: "retry_due",
        reasonCode: after.reasonCode ?? "retry_due",
        nextRetryAt: after.nextRetryAt ?? new Date(Date.now() + 15_000).toISOString(),
        retryClass: "unknown",
      };
    } else if (after.status === "paused") {
      disposition = { kind: "waiting", wakeOn: "external" };
    } else if (progressed) {
      disposition = {
        kind: "progressed",
        progressRevision: afterRev,
        checkpoint: after.checkpoint ?? after.phase,
      };
    } else if (after.status === "running") {
      // Handler left status running without progress — treat as no-progress.
      disposition = undefined;
    } else if (after.status === "queued" && !progressed) {
      // Handler re-queued without progress — still no-progress (prevent spin).
      disposition = undefined;
    } else {
      disposition = { kind: "waiting", wakeOn: "timer" };
    }
  }

  const writeFenced = async (job: GithubAutomationJobRecord) => {
    try {
      return await writeGithubAutomationJobWithFencing(job, {
        fencingToken,
        ownerId,
      });
    } catch {
      // Lease lost: do not overwrite; return last known disk state.
      return (await readGithubAutomationJob(jobId)) ?? job;
    }
  };

  if (!disposition) {
    // runner_no_progress: exponential backoff, then stable block.
    const noProgress = noProgressCountOf(after) + 1;
    const now = new Date().toISOString();
    if (noProgress >= NO_PROGRESS_BLOCK_THRESHOLD) {
      const evaluated = getGithubAutomationEvaluatedProvenance();
      const blocked: GithubAutomationJobRecord = {
        ...after,
        status: "blocked",
        reasonCode: "runner_no_progress",
        blockedAtLayer: after.blockedAtLayer ?? "scheduler",
        retryability: "operator",
        noProgressRunCount: noProgress,
        nextRetryAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseFencingToken: null,
        leaseHeartbeatAt: null,
        evaluatedCodeRevision: evaluated.codeRevision,
        evaluatedPolicyVersion: evaluated.policyVersion,
        updatedAt: now,
      };
      after = await writeFenced(blocked);
      await appendGithubAutomationSafeEvent({
        at: now,
        kind: "job_no_progress_blocked",
        repositoryId: after.repositoryId,
        issueNumber: after.issueNumber,
        jobId: after.jobId,
        deliveryId: after.deliveryId,
        phase: after.phase,
        reasonCode: "runner_no_progress",
        traceId: after.traceId,
        meta: { noProgressRunCount: noProgress },
      });
      return { job: after, wakeAgain: false, delayMs: null };
    }

    const delayMs = computeNoProgressBackoffMs(noProgress);
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    const retrying: GithubAutomationJobRecord = {
      ...after,
      status: "retry_due",
      reasonCode: "runner_no_progress",
      noProgressRunCount: noProgress,
      nextRetryAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseFencingToken: null,
      leaseHeartbeatAt: null,
      updatedAt: now,
    };
    after = await writeFenced(retrying);
    await appendGithubAutomationSafeEvent({
      at: now,
      kind: "job_no_progress_backoff",
      repositoryId: after.repositoryId,
      issueNumber: after.issueNumber,
      jobId: after.jobId,
      deliveryId: after.deliveryId,
      phase: after.phase,
      reasonCode: "runner_no_progress",
      traceId: after.traceId,
      meta: {
        noProgressRunCount: noProgress,
        nextRetryAt,
        delayMs,
      },
    });
    return { job: after, wakeAgain: false, delayMs };
  }

  switch (disposition.kind) {
    case "progressed": {
      const now = new Date().toISOString();
      // Always advance progressRevision so the next lease can detect real progress.
      const nextRev = Math.max(
        afterRev,
        disposition.progressRevision,
        beforeRev + 1,
      );
      const next: GithubAutomationJobRecord = {
        ...after,
        progressRevision: nextRev,
        noProgressRunCount: 0,
        meaningfulProgressCount:
          (typeof after.meaningfulProgressCount === "number"
            ? after.meaningfulProgressCount
            : 0) + 1,
        lastMeaningfulProgressAt: now,
        lastMeaningfulProgressKind: "checkpoint_advanced",
        // If handler left status running, park as queued for next checkpoint.
        status:
          after.status === "running"
            ? "queued"
            : after.status,
        leaseOwner: after.status === "running" ? null : after.leaseOwner,
        leaseExpiresAt: after.status === "running" ? null : after.leaseExpiresAt,
        leaseFencingToken:
          after.status === "running" ? null : after.leaseFencingToken,
        leaseHeartbeatAt:
          after.status === "running" ? null : after.leaseHeartbeatAt,
        updatedAt: now,
      };
      after = await writeFenced(next);
      return {
        job: after,
        wakeAgain: Boolean(result.wakeAgain),
        delayMs: result.wakeAgain ? 0 : null,
      };
    }
    case "waiting": {
      const now = new Date().toISOString();
      // Waiting must not be immediately runnable queued.
      const next: GithubAutomationJobRecord = {
        ...after,
        status:
          after.status === "running" || after.status === "queued"
            ? disposition.wakeOn === "timer"
              ? "retry_due"
              : "paused"
            : after.status,
        reasonCode:
          after.reasonCode && after.reasonCode !== "runner_no_progress"
            ? after.reasonCode
            : disposition.wakeOn === "agent"
              ? "waiting_agent"
              : disposition.wakeOn === "timer"
                ? "waiting_timer"
                : "waiting_external",
        nextRetryAt:
          disposition.wakeOn === "timer"
            ? after.nextRetryAt ??
              new Date(Date.now() + DEFAULT_POLL_INTERVAL_MS * 5).toISOString()
            : after.nextRetryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseFencingToken: null,
        leaseHeartbeatAt: null,
        // waiting is not no-progress failure; do not inflate counter.
        updatedAt: now,
      };
      after = await writeFenced(next);
      return { job: after, wakeAgain: false, delayMs: null };
    }
    case "retry_due": {
      const now = new Date().toISOString();
      const next: GithubAutomationJobRecord = {
        ...after,
        status: "retry_due",
        reasonCode: disposition.reasonCode,
        nextRetryAt: disposition.nextRetryAt,
        retryability: "automatic",
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseFencingToken: null,
        leaseHeartbeatAt: null,
        updatedAt: now,
      };
      after = await writeFenced(next);
      const delay = Math.max(0, Date.parse(disposition.nextRetryAt) - Date.now());
      return {
        job: after,
        wakeAgain: false,
        delayMs: Number.isFinite(delay) ? delay : null,
      };
    }
    case "blocked": {
      const now = new Date().toISOString();
      const evaluated = getGithubAutomationEvaluatedProvenance();
      const next: GithubAutomationJobRecord = {
        ...after,
        status: "blocked",
        reasonCode: disposition.reasonCode,
        blockedAtLayer: disposition.layer,
        blockFingerprint: disposition.fingerprint,
        retryability: disposition.retryability,
        nextRetryAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseFencingToken: null,
        leaseHeartbeatAt: null,
        evaluatedCodeRevision:
          after.evaluatedCodeRevision ?? evaluated.codeRevision,
        evaluatedPolicyVersion:
          after.evaluatedPolicyVersion ?? evaluated.policyVersion,
        updatedAt: now,
      };
      after = await writeFenced(next);
      return { job: after, wakeAgain: false, delayMs: null };
    }
    case "terminal": {
      const now = new Date().toISOString();
      const next: GithubAutomationJobRecord = {
        ...after,
        status: disposition.status,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseFencingToken: null,
        leaseHeartbeatAt: null,
        updatedAt: now,
      };
      after = await writeFenced(next);
      return { job: after, wakeAgain: false, delayMs: null };
    }
    default:
      return { job: after, wakeAgain: Boolean(result.wakeAgain), delayMs: null };
  }
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
 *
 * Final defensive gate (GHR-01): ensure full triage handler readiness BEFORE
 * any business lease/attempt. When not ready, never process production jobs
 * through defaultJobHandler (that became runner_no_progress on #22).
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
    // Schema v2: enabled + paused only (no mode/unattended).
    if (!config.enabled || config.paused) {
      state.lastTickAt = new Date().toISOString();
      return {
        scanned: 0,
        started: 0,
        skipped: 0,
        errors: 0,
        inFlight: state.inFlight.size,
      };
    }

    // Best-effort: write retirement sidecars for any residual non-terminal v1 jobs.
    // Never leases them; original job files remain untouched.
    try {
      const { retireLegacyGithubAutomationJobs } = await import(
        "./github-automation-migration"
      );
      await retireLegacyGithubAutomationJobs();
    } catch {
      // Additive retirement must not block analysis scheduling.
    }

    // GIA-01: handler registry readiness for closed-loop triage is no longer a
    // lease prerequisite. Analysis runner registration lands in GIA-03; until
    // then only schema/kind-gated jobs are candidates and default handler may
    // park them safely without claiming legacy work.

    const maxConcurrency = Math.max(
      1,
      Math.min(8, config.analysis?.maxConcurrency ?? 2),
    );
    const jobs = await listGithubAutomationJobs();
    scanned = jobs.length;
    const nowMs = Date.now();

    // Reconcile stale running first (skip process-local inFlight — GHA-CLOSE-02).
    // Only touch schedulable analysis jobs; never rewrite legacy records.
    const reconciled: GithubAutomationJobRecord[] = [];
    for (const job of jobs) {
      if (!isGithubIssueAnalysisJobSchedulable(job)) {
        reconciled.push(job);
        continue;
      }
      reconciled.push(await markStaleRunningAsRetry(job, state.inFlight));
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

    // Another process may have claimed running recently (fencing-aware).
    if (
      current.status === "running" &&
      current.leaseOwner &&
      current.leaseOwner !== lease.ownerId
    ) {
      const heartbeatAt = current.leaseHeartbeatAt
        ? Date.parse(current.leaseHeartbeatAt)
        : Date.parse(current.updatedAt);
      if (
        Number.isFinite(heartbeatAt) &&
        Date.now() - heartbeatAt < STALE_RUNNING_MS
      ) {
        return;
      }
    }

    // Deterministic block with unchanged fingerprint: do not re-enter handler.
    if (
      current.status === "blocked" &&
      current.blockFingerprint &&
      current.retryability === "operator_after_change"
    ) {
      return;
    }

    const now = new Date().toISOString();
    const beforeSnapshot: GithubAutomationJobRecord = { ...current };
    const runningJob: GithubAutomationJobRecord = {
      ...current,
      status: "running",
      // `attempt` = scheduler lease run count (never Agent execution count).
      attempt: current.attempt + 1,
      leaseOwner: lease.ownerId,
      leaseExpiresAt: new Date(
        Date.now() + Math.max(STALE_RUNNING_MS, GITHUB_AUTOMATION_LEASE_HEARTBEAT_MS * 4),
      ).toISOString(),
      leaseFencingToken: lease.fencingToken,
      leaseHeartbeatAt: now,
      updatedAt: now,
    };
    try {
      await writeGithubAutomationJobWithFencing(runningJob, {
        fencingToken: lease.fencingToken,
        ownerId: lease.ownerId,
      });
    } catch {
      return;
    }
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
      meta: {
        attempt: runningJob.attempt,
        ownerId: lease.ownerId,
        fencingToken: lease.fencingToken.slice(0, 12),
      },
    });

    // Heartbeat loop for long Agent runs (GHA-CLOSE-02).
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const armHeartbeat = () => {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        void (async () => {
          const held = await lease.heartbeat();
          if (!held) return;
          try {
            const latest = await readGithubAutomationJob(jobId);
            if (!latest || latest.leaseFencingToken !== lease.fencingToken) return;
            const hbAt = new Date().toISOString();
            await writeGithubAutomationJobWithFencing(
              {
                ...latest,
                leaseHeartbeatAt: hbAt,
                leaseExpiresAt: new Date(
                  Date.now() +
                    Math.max(STALE_RUNNING_MS, GITHUB_AUTOMATION_LEASE_HEARTBEAT_MS * 4),
                ).toISOString(),
                // Heartbeat is NOT meaningful progress — do not touch progress fields.
                updatedAt: latest.updatedAt,
              },
              {
                fencingToken: lease.fencingToken,
                ownerId: lease.ownerId,
              },
            );
          } catch {
            // lease lost or write race — ignore; handler will fail on next fenced write
          }
        })();
      }, GITHUB_AUTOMATION_LEASE_HEARTBEAT_MS);
      if (
        typeof heartbeatTimer === "object" &&
        heartbeatTimer &&
        "unref" in heartbeatTimer
      ) {
        try {
          (heartbeatTimer as NodeJS.Timeout).unref();
        } catch {
          // ignore
        }
      }
    };
    armHeartbeat();

    try {
      const handler = getGithubAutomationJobHandler();
      const result = await handler(runningJob, {
        config,
        ownerId,
        lease,
      });

      // Prefer disk state after handler writes; fall back to result.job.
      const afterDisk = (await readGithubAutomationJob(jobId)) ?? result.job;

      const applied = await applyHandlerDisposition({
        jobId,
        before: beforeSnapshot,
        after: afterDisk,
        result,
        fencingToken: lease.fencingToken,
        ownerId: lease.ownerId,
      });

      if (applied.wakeAgain) {
        wakeGithubAutomationScheduler();
      } else if (applied.delayMs != null && applied.delayMs >= 0) {
        scheduleGithubAutomationScheduler(
          Math.min(applied.delayMs, NO_PROGRESS_BACKOFF_CAP_MS),
        );
      }
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
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
 * Best-effort pre-warm of the analysis handler.
 * Never loads the retired claim/unattended graph. Never throws into the caller.
 */
function prewarmGithubAutomationHandlerReadiness(): void {
  const registry = getHandlerRegistry();
  if (registry.productionReadinessDisabled) return;
  if (registry.registration.kind === "custom") return;
  try {
    registerGithubIssueAnalysisJobHandler();
  } catch {
    // Tick falls back to default handler disposition.
  }
}

/**
 * Immediate wake: schedule tick ASAP. Safe from webhook after enqueue.
 * Does not block; does not run model/Git in the caller stack beyond a microtask tick.
 * Also pre-warms analysis handler registration so cold Settings retry does not depend on a webhook.
 */
export function wakeGithubAutomationScheduler(): void {
  const state = getState();
  state.wakeGeneration += 1;
  state.started = true;
  prewarmGithubAutomationHandlerReadiness();
  armTimer(0);
}

/**
 * Lazy ensure: start background polling if not already started.
 * Reconciles queue without requiring an inbound webhook.
 */
export function ensureGithubAutomationScheduler(): void {
  const state = getState();
  prewarmGithubAutomationHandlerReadiness();
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
