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
  GithubAutomationJobHandler,
  GithubAutomationJobHandlerResult,
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
} from "./github-automation-store";
import { githubIssueAnalysisJobHandler } from "./github-issue-analysis-runner";

/** @deprecated Alias for live schema v2 config. */
type GithubAutomationConfigV1 = GithubAutomationConfigV2;

// Re-export leaf handler contract so existing importers keep working.
export type {
  GithubAutomationJobHandler,
  GithubAutomationJobHandlerResult,
} from "./github-automation-types";

// ─── Handler registry (test override only) ───────────────────────────────────

/**
 * Live registry kind.
 * - `production`: static binding of the single analysis handler (default).
 * - `custom`: explicit test override via set/register helpers.
 * - `default` / `none`: test-only isolation; never selected by production ticks.
 */
export type GithubAutomationHandlerKind =
  | "none"
  | "default"
  | "custom"
  | "production";

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
    }
  | {
      kind: "production";
      generation: number;
      handler: GithubAutomationJobHandler;
    };

interface HandlerRegistryState {
  registration: GithubAutomationHandlerRegistration;
  /** Monotonic generation bumped on every set (including null restore). */
  generationCounter: number;
  /**
   * When true, production path will not select the real analysis handler and
   * will refuse business leases. Used only by focused isolation tests.
   */
  productionReadinessDisabled: boolean;
}

declare global {
  var __piGithubAutomationHandlerRegistry: HandlerRegistryState | undefined;
}

function getHandlerRegistry(): HandlerRegistryState {
  if (!globalThis.__piGithubAutomationHandlerRegistry) {
    globalThis.__piGithubAutomationHandlerRegistry = {
      registration: {
        kind: "production",
        generation: 0,
        handler: githubIssueAnalysisJobHandler,
      },
      generationCounter: 0,
      productionReadinessDisabled: false,
    };
  }
  return globalThis.__piGithubAutomationHandlerRegistry;
}

/** True when this bundle's statically imported analysis handler is callable. */
function isLocalStaticAnalysisHandlerAvailable(): boolean {
  return typeof githubIssueAnalysisJobHandler === "function";
}

/** Live registry snapshot (authoritative for readiness / test override state). */
export function getGithubAutomationJobHandlerRegistration(): GithubAutomationHandlerRegistration {
  return getHandlerRegistry().registration;
}

/**
 * Production readiness across Next multi-entry bundles.
 *
 * Next may compile instrumentation and route entries into separate scheduler
 * modules that share `globalThis` registry state but hold distinct function
 * object identities for the same source handler. Readiness therefore uses the
 * stable registration `kind` plus this bundle's statically imported handler
 * availability — never strict equality against `registration.handler`.
 *
 * Execution still selects the current bundle's static analysis handler via
 * {@link getGithubAutomationJobHandler}; registry production handler references
 * are mode metadata only (custom overrides remain the sole shared callables).
 */
export function isGithubAutomationProductionHandlerReady(): boolean {
  const registry = getHandlerRegistry();
  if (registry.productionReadinessDisabled) return false;
  const reg = registry.registration;
  // custom is an explicit shared override: ready only when the override is callable.
  // Do not fall through to the local static production handler when kind is custom.
  if (reg.kind === "custom") {
    return typeof reg.handler === "function";
  }
  // production / default / none: mode token is cross-bundle stable; do not
  // compare registry.handler identity to this module's static import.
  if (reg.kind === "production" || reg.kind === "none" || reg.kind === "default") {
    return isLocalStaticAnalysisHandlerAvailable();
  }
  return false;
}

/**
 * Explicit handler injection for focused tests only.
 * - Pass a function to override the production analysis handler (kind `custom`).
 * - Pass null to clear the override; production ticks return to the static handler.
 * - `{ kind: "default" }` keeps a parking stub reachable only when readiness is disabled.
 */
export function setGithubAutomationJobHandler(
  handler: GithubAutomationJobHandler | null,
  options?: { kind?: Exclude<GithubAutomationHandlerKind, "none" | "production"> },
): void {
  const registry = getHandlerRegistry();
  registry.generationCounter += 1;
  const generation = registry.generationCounter;
  if (!handler) {
    registry.registration = {
      kind: "production",
      generation,
      handler: githubIssueAnalysisJobHandler,
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
 * Explicit test/tooling registration for the analysis handler.
 * Production no longer needs this: the scheduler statically binds the handler.
 * When called with no args, rebinds the static production handler.
 */
export function registerGithubIssueAnalysisJobHandler(
  handler?: GithubAutomationJobHandler,
): void {
  if (handler) {
    setGithubAutomationJobHandler(handler, { kind: "custom" });
    return;
  }
  setGithubAutomationJobHandler(githubIssueAnalysisJobHandler, {
    kind: "custom",
  });
  // Normalize kind back to production when binding the real export.
  const registry = getHandlerRegistry();
  registry.registration = {
    kind: "production",
    generation: registry.generationCounter,
    handler: githubIssueAnalysisJobHandler,
  };
}

/**
 * Resolve the handler for the next lease-run.
 * Production path always returns the statically bound analysis handler unless
 * an explicit test override is active. The parking default is never selected
 * by ordinary production ticks.
 */
export function getGithubAutomationJobHandler(): GithubAutomationJobHandler {
  const registry = getHandlerRegistry();
  if (registry.productionReadinessDisabled) {
    const reg = registry.registration;
    if (reg.kind === "custom" && reg.handler) return reg.handler;
    if (reg.kind === "default" && reg.handler) return reg.handler;
    return defaultJobHandler;
  }
  const reg = registry.registration;
  if (reg.kind === "custom" && typeof reg.handler === "function") {
    return reg.handler;
  }
  return githubIssueAnalysisJobHandler;
}

/**
 * Test-only: disable the production analysis handler so isolation suites can
 * exercise zero-lease readiness behavior. Production must never call this.
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
 * Parking stub retained only for isolation tests that disable production
 * readiness. Ordinary production ticks never select this handler; readiness is
 * resolved before any business lease so attempt is not consumed.
 */
const defaultJobHandler: GithubAutomationJobHandler = async (job) => {
  // Isolation tests may leave the job untouched so they can assert registry state.
  if (getHandlerRegistry().productionReadinessDisabled) {
    return { job, wakeAgain: false };
  }

  // Should be unreachable on the production path after HNR-01. Keep a safe
  // no-op return without writing handler_not_ready / consuming another attempt
  // if a future regression reaches here under lease.
  return {
    job,
    wakeAgain: false,
    disposition: {
      kind: "waiting",
      wakeOn: "timer",
    },
  };
};

// ─── Runtime state (process-local) ───────────────────────────────────────────

/**
 * Injectable clock/timer boundary for durable scheduling.
 * Production uses real Date/timers; focused tests inject a fake clock.
 */
export interface GithubAutomationSchedulerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultSchedulerClock: GithubAutomationSchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => {
    if (handle != null) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface SchedulerState {
  ownerId: string;
  timer: unknown | null;
  /** Absolute epoch ms for the currently armed wake; null when idle. */
  nextWakeAtMs: number | null;
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
  /**
   * When config is paused/disabled but non-terminal analysis jobs remain,
   * arm a low-frequency config recheck (never a business lease interval).
   */
  configRecheckIntervalMs: number;
  clock: GithubAutomationSchedulerClock;
  /** Coalesce concurrent durable-queue rescans. */
  rescheduleInFlight: Promise<void> | null;
}

declare global {
  var __piGithubAutomationScheduler: SchedulerState | undefined;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Low-frequency config recheck while paused/disabled with pending jobs (HNR-03). */
const DEFAULT_CONFIG_RECHECK_INTERVAL_MS = 30_000;
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
      nextWakeAtMs: null,
      running: false,
      inFlight: new Set(),
      wakeGeneration: 0,
      lastTickAt: null,
      lastError: null,
      started: false,
      autoSchedule: true,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      configRecheckIntervalMs: DEFAULT_CONFIG_RECHECK_INTERVAL_MS,
      clock: defaultSchedulerClock,
      rescheduleInFlight: null,
    };
  }
  return globalThis.__piGithubAutomationScheduler;
}

function schedulerNowMs(): number {
  return getState().clock.now();
}

function clearArmedTimer(state: SchedulerState = getState()): void {
  if (state.timer != null) {
    state.clock.clearTimeout(state.timer);
    state.timer = null;
  }
  state.nextWakeAtMs = null;
}

/** Test-only controls. */
export function _testGetGithubAutomationSchedulerState(): SchedulerState {
  return getState();
}

/** Absolute armed wake deadline (ms epoch), or null when no timer is armed. */
export function _testGetGithubAutomationSchedulerNextWakeAtMs(): number | null {
  return getState().nextWakeAtMs;
}

/**
 * Inject a fake clock/timer for focused scheduler tests. Pass null to restore
 * the production Date/setTimeout boundary.
 */
export function _testSetGithubAutomationSchedulerClock(
  clock: GithubAutomationSchedulerClock | null,
): void {
  const state = getState();
  clearArmedTimer(state);
  state.clock = clock ?? defaultSchedulerClock;
}

export function _testResetGithubAutomationScheduler(): void {
  const state = getState();
  clearArmedTimer(state);
  state.running = false;
  state.inFlight.clear();
  state.wakeGeneration = 0;
  state.lastTickAt = null;
  state.lastError = null;
  state.started = false;
  state.autoSchedule = true;
  state.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  state.configRecheckIntervalMs = DEFAULT_CONFIG_RECHECK_INTERVAL_MS;
  state.clock = defaultSchedulerClock;
  state.rescheduleInFlight = null;
  // Drop global so next getState recreates clean owner id if desired.
  globalThis.__piGithubAutomationScheduler = undefined;
  // Handler registry is independent; tests that need a clean registry call
  // _testResetGithubAutomationHandlerRegistry() and/or setGithubAutomationJobHandler(null).
}

export function _testSetGithubAutomationSchedulerAuto(auto: boolean): void {
  const state = getState();
  state.autoSchedule = auto;
  if (!auto) {
    clearArmedTimer(state);
  }
}

export function _testSetGithubAutomationSchedulerPollIntervalMs(ms: number): void {
  getState().pollIntervalMs = Math.max(10, ms);
}

/** Test-only: bound the paused/disabled config recheck interval. */
export function _testSetGithubAutomationSchedulerConfigRecheckIntervalMs(
  ms: number,
): void {
  getState().configRecheckIntervalMs = Math.max(10, ms);
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
  const nowMs = schedulerNowMs();
  if (!Number.isFinite(updated) || nowMs - updated < STALE_RUNNING_MS) {
    return job;
  }
  const nowIso = new Date(nowMs).toISOString();
  const next: GithubAutomationJobRecord = {
    ...job,
    status: "retry_due",
    nextRetryAt: nowIso,
    reasonCode: "stale_running_reconcile",
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseFencingToken: null,
    leaseHeartbeatAt: null,
    updatedAt: nowIso,
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
        nextRetryAt:
          after.nextRetryAt ??
          new Date(schedulerNowMs() + 15_000).toISOString(),
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
    const nextRetryAt = new Date(schedulerNowMs() + delayMs).toISOString();
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
              new Date(
                schedulerNowMs() + DEFAULT_POLL_INTERVAL_MS * 5,
              ).toISOString()
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
      const delay = Math.max(
        0,
        Date.parse(disposition.nextRetryAt) - schedulerNowMs(),
      );
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
  /** Absolute epoch ms of the earliest pending durable deadline after this tick. */
  nextWakeAtMs: number | null;
}

/**
 * Compute the next absolute wake deadline from durable job truth.
 * - queued (or due retry / stale running): now
 * - future retry_due: nextRetryAt
 * - active running (not process-local inFlight): stale threshold
 * - terminal / paused / non-schedulable: ignored
 */
function computeJobWakeDeadlineMs(
  job: GithubAutomationJobRecord,
  nowMs: number,
  inFlight: Set<string>,
): number | null {
  if (isLegacyGithubAutomationJob(job) || !isGithubIssueAnalysisJobSchedulable(job)) {
    return null;
  }
  if (isTerminalStatus(job.status) || job.status === "paused") {
    return null;
  }

  // Process-local inFlight: the lease is owned by this process. Settlement will
  // rescan. Honor only a durable future/past nextRetryAt already written under
  // the lease (handler finished writing before finally()); never treat the
  // pre-lease queued snapshot as immediately due while still inFlight — that
  // armed a now-timer which raced with the real retry deadline.
  if (inFlight.has(job.jobId)) {
    if (job.status === "retry_due" && job.nextRetryAt) {
      const t = Date.parse(job.nextRetryAt);
      if (Number.isFinite(t)) return Math.max(nowMs, t);
    }
    return null;
  }

  if (job.status === "queued") {
    return nowMs;
  }

  if (job.status === "retry_due") {
    if (!job.nextRetryAt) return nowMs;
    const t = Date.parse(job.nextRetryAt);
    if (!Number.isFinite(t)) return nowMs;
    return Math.max(nowMs, t);
  }

  if (job.status === "running") {
    const updated = Date.parse(job.updatedAt);
    if (!Number.isFinite(updated)) return nowMs;
    const staleAt = updated + STALE_RUNNING_MS;
    return Math.max(nowMs, staleAt);
  }

  return null;
}

function earliestWakeDeadlineMs(
  jobs: GithubAutomationJobRecord[],
  nowMs: number,
  inFlight: Set<string>,
): number | null {
  let earliest: number | null = null;
  for (const job of jobs) {
    const deadline = computeJobWakeDeadlineMs(job, nowMs, inFlight);
    if (deadline == null) continue;
    if (earliest == null || deadline < earliest) {
      earliest = deadline;
    }
  }
  return earliest;
}

/**
 * True when a durable schema-v2 analysis job is non-terminal and may still need
 * scheduling after config recovery (queued / retry_due / running / job-level paused).
 * Terminal statuses and legacy jobs do not keep the process alive.
 */
function isPendingAnalysisJob(job: GithubAutomationJobRecord): boolean {
  if (isLegacyGithubAutomationJob(job) || !isGithubIssueAnalysisJobSchedulable(job)) {
    return false;
  }
  if (isTerminalStatus(job.status)) return false;
  // Job-level "paused" is still a non-terminal durable state for startup recheck.
  return (
    job.status === "queued" ||
    job.status === "retry_due" ||
    job.status === "running" ||
    job.status === "paused"
  );
}

function hasPendingAnalysisJobs(jobs: GithubAutomationJobRecord[]): boolean {
  for (const job of jobs) {
    if (isPendingAnalysisJob(job)) return true;
  }
  return false;
}

/**
 * Arm a low-frequency config recheck when automation is paused/disabled but
 * durable pending jobs remain. Never leases work; only re-reads config.
 */
function armPausedConfigRecheck(nowMs: number): void {
  const state = getState();
  if (!state.autoSchedule) {
    clearArmedTimer(state);
    return;
  }
  armDeadline(nowMs + state.configRecheckIntervalMs, { force: true });
}

/**
 * Rescan durable jobs and arm the earliest pending deadline.
 * Used after every tick and after each job settlement so disposition/finally
 * never own competing timers that can drop a future retry.
 */
async function rescheduleFromDurableQueue(reason: string): Promise<void> {
  const state = getState();
  if (!state.autoSchedule) return;

  // Chain behind any in-flight rescan so the latest settlement always wins.
  // (A plain "await previous; return" would drop the newer wake request.)
  const previous = state.rescheduleInFlight;
  const run = (async () => {
    if (previous) {
      try {
        await previous;
      } catch {
        // ignore prior failure; this pass rescans from disk
      }
    }
    try {
      const config = await readGithubAutomationConfig();
      const jobs = await listGithubAutomationJobs();
      const nowMs = schedulerNowMs();

      // HNR-03: paused/disabled never leases, but pending durable jobs keep a
      // bounded low-frequency config recheck so recovery does not require a
      // webhook or status/verify GET side effect.
      if (!config.enabled || config.paused) {
        if (hasPendingAnalysisJobs(jobs) || state.inFlight.size > 0) {
          armPausedConfigRecheck(nowMs);
        } else {
          clearArmedTimer(state);
        }
        return;
      }

      let next = earliestWakeDeadlineMs(jobs, nowMs, state.inFlight);
      // Concurrency-saturated due work: avoid busy spin; settlement will rescan.
      if (
        next != null &&
        next <= nowMs &&
        state.inFlight.size > 0
      ) {
        const maxConcurrency = Math.max(
          1,
          Math.min(8, config.analysis?.maxConcurrency ?? 2),
        );
        if (state.inFlight.size >= maxConcurrency) {
          next = nowMs + state.pollIntervalMs;
        }
      }
      if (next == null) {
        if (state.inFlight.size > 0) {
          // Still executing; do not wipe a deadline another rescan may have armed.
          // Arm a short fallback only when nothing is scheduled.
          if (state.timer == null) {
            armDeadline(nowMs + state.pollIntervalMs, { force: true });
          }
          return;
        }
        clearArmedTimer(state);
        return;
      }
      armDeadline(next, { force: true });
    } catch {
      // Best-effort: fall back to a short poll so durable work is not abandoned.
      armDeadline(schedulerNowMs() + state.pollIntervalMs, { force: false });
      void reason;
    }
  })();

  state.rescheduleInFlight = run;
  try {
    await run;
  } finally {
    if (state.rescheduleInFlight === run) {
      state.rescheduleInFlight = null;
    }
  }
}

/**
 * Single scheduler tick: reconcile + start up to concurrency limit.
 * Safe to call from webhook after enqueue (fire-and-forget) or timer.
 *
 * Final defensive gate (GHR-01): ensure full triage handler readiness BEFORE
 * any business lease/attempt. When not ready, never process production jobs
 * through defaultJobHandler (that became runner_no_progress on #22).
 *
 * HNR-02: after every tick, recompute the next wake from durable queue truth
 * so early ticks cannot drop a future retry_due deadline.
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
      nextWakeAtMs: state.nextWakeAtMs,
    };
  }
  state.running = true;
  state.started = true;
  let scanned = 0;
  let started = 0;
  let skipped = 0;
  let errors = 0;
  let nextWakeAtMs: number | null = state.nextWakeAtMs;

  try {
    const config = await readGithubAutomationConfig();
    // Schema v2: enabled + paused only (no mode/unattended).
    // HNR-03: paused/disabled takes zero business leases. If durable pending
    // jobs remain, keep a low-frequency config recheck; otherwise stop timer.
    if (!config.enabled || config.paused) {
      state.lastTickAt = new Date(schedulerNowMs()).toISOString();
      if (state.autoSchedule) {
        await rescheduleFromDurableQueue("tick_paused");
        nextWakeAtMs = state.nextWakeAtMs;
      } else {
        clearArmedTimer(state);
        nextWakeAtMs = null;
      }
      return {
        scanned: 0,
        started: 0,
        skipped: 0,
        errors: 0,
        inFlight: state.inFlight.size,
        nextWakeAtMs,
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

    // HNR-01: production analysis handler readiness is resolved BEFORE any
    // business lease or attempt increment. Isolation tests that disable
    // readiness get zero leases; ordinary production always uses the static
    // analysis handler (never default_handler_defensive_fallback).
    if (!isGithubAutomationProductionHandlerReady()) {
      state.lastTickAt = new Date(schedulerNowMs()).toISOString();
      state.lastError = "analysis_handler_initialization_failed";
      // Do not burn attempts; keep a short recheck so readiness recovery can continue.
      if (state.autoSchedule) {
        armDeadline(schedulerNowMs() + state.pollIntervalMs, { force: true });
        nextWakeAtMs = state.nextWakeAtMs;
      }
      return {
        scanned: 0,
        started: 0,
        skipped: 0,
        errors: 0,
        inFlight: state.inFlight.size,
        nextWakeAtMs,
      };
    }

    const maxConcurrency = Math.max(
      1,
      Math.min(8, config.analysis?.maxConcurrency ?? 2),
    );
    const jobs = await listGithubAutomationJobs();
    scanned = jobs.length;
    const nowMs = schedulerNowMs();

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
      // Re-check readiness immediately before each lease start so a mid-tick
      // isolation flip cannot consume an attempt through the parking stub.
      if (!isGithubAutomationProductionHandlerReady()) {
        skipped += 1;
        continue;
      }
      started += 1;
      state.inFlight.add(job.jobId);
      // Fire-and-forget per job; errors captured in job/event trail.
      void runJobUnderLease(job.jobId, config, state.ownerId)
        .catch(async (err) => {
          errors += 1;
          state.lastError = "job_handler_error";
          try {
            await appendGithubAutomationSafeEvent({
              at: new Date(schedulerNowMs()).toISOString(),
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
          // HNR-02: settlement always rescans durable queue; never a fixed poll
          // that can overwrite a longer retry deadline.
          void rescheduleFromDurableQueue("job_settled");
        });
    }

    // HNR-02: always re-read durable queue truth for the next wake.
    // Never arm from the pre-lease `reconciled` snapshot — a job may already
    // have settled to future retry_due while this tick was still finishing,
    // and using stale "queued" memory would overwrite the real deadline with now.
    if (state.autoSchedule) {
      await rescheduleFromDurableQueue("tick_complete");
      nextWakeAtMs = state.nextWakeAtMs;
    } else {
      // Manual ticks (tests with autoSchedule=false) still report the computed deadline.
      const freshJobs = await listGithubAutomationJobs();
      nextWakeAtMs = earliestWakeDeadlineMs(freshJobs, schedulerNowMs(), state.inFlight);
      if (
        nextWakeAtMs != null &&
        nextWakeAtMs <= schedulerNowMs() &&
        availableSlots === 0 &&
        state.inFlight.size > 0
      ) {
        nextWakeAtMs = schedulerNowMs() + state.pollIntervalMs;
      }
    }

    state.lastTickAt = new Date(schedulerNowMs()).toISOString();
    return {
      scanned,
      started,
      skipped,
      errors,
      inFlight: state.inFlight.size,
      nextWakeAtMs,
    };
  } catch (err) {
    state.lastError = "tick_error";
    state.lastTickAt = new Date(schedulerNowMs()).toISOString();
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
  // HNR-01: resolve production handler BEFORE acquiring a business lease so
  // bootstrap/isolation failure cannot write job_started or increment attempt.
  if (!isGithubAutomationProductionHandlerReady()) {
    return;
  }
  const handler = getGithubAutomationJobHandler();
  if (handler === defaultJobHandler) {
    // Production ticks must never run the parking stub under lease.
    return;
  }

  await withGithubAutomationJobLease(jobId, async (lease) => {
    // Re-check after waiting for the filesystem lease.
    if (!isGithubAutomationProductionHandlerReady()) {
      return;
    }
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
        schedulerNowMs() - heartbeatAt < STALE_RUNNING_MS
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

    const nowMs = schedulerNowMs();
    const now = new Date(nowMs).toISOString();
    const beforeSnapshot: GithubAutomationJobRecord = { ...current };
    const runningJob: GithubAutomationJobRecord = {
      ...current,
      status: "running",
      // `attempt` = scheduler lease run count (never Agent execution count).
      attempt: current.attempt + 1,
      leaseOwner: lease.ownerId,
      leaseExpiresAt: new Date(
        nowMs + Math.max(STALE_RUNNING_MS, GITHUB_AUTOMATION_LEASE_HEARTBEAT_MS * 4),
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
    // Heartbeats use real timers (not the durable schedule clock) so lease
    // keep-alive stays independent of fake-clock tests for retry deadlines.
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
            const hbNow = schedulerNowMs();
            const hbAt = new Date(hbNow).toISOString();
            await writeGithubAutomationJobWithFencing(
              {
                ...latest,
                leaseHeartbeatAt: hbAt,
                leaseExpiresAt: new Date(
                  hbNow +
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
      // Prefer the handler resolved before lease; re-resolve only for explicit test overrides.
      const activeHandler = getGithubAutomationJobHandler();
      if (activeHandler === defaultJobHandler) {
        return;
      }
      const result = await activeHandler(runningJob, {
        config,
        ownerId,
        lease,
      });

      // Prefer disk state after handler writes; fall back to result.job.
      const afterDisk =
        (await readGithubAutomationJob(jobId)) ??
        (result.job as unknown as GithubAutomationJobRecord);

      await applyHandlerDisposition({
        jobId,
        before: beforeSnapshot,
        after: afterDisk,
        result,
        fencingToken: lease.fencingToken,
        ownerId: lease.ownerId,
      });
      // HNR-02: durable queue is the only timer authority after settlement.
      // Disposition delayMs is retained on the job record; rescan arms nextWakeAt.
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  });
}

// ─── Wake / ensure ───────────────────────────────────────────────────────────

/**
 * Arm a single deadline-aware timer.
 * - Later requests never replace an earlier armed deadline.
 * - Explicit force/immediate wake may pull the deadline forward.
 * - Timer fire clears handle + deadline atomically before running the tick.
 */
function armDeadline(
  absoluteMs: number,
  options?: { force?: boolean },
): void {
  const state = getState();
  if (!state.autoSchedule) return;

  const nowMs = schedulerNowMs();
  const target = Math.max(nowMs, absoluteMs);
  const force = options?.force === true;

  if (
    !force &&
    state.nextWakeAtMs != null &&
    state.timer != null &&
    state.nextWakeAtMs <= target
  ) {
    // Keep the earlier wake; later schedule requests must not overwrite it.
    return;
  }

  if (state.timer != null) {
    state.clock.clearTimeout(state.timer);
    state.timer = null;
  }

  const delayMs = Math.max(0, target - nowMs);
  state.nextWakeAtMs = target;
  state.timer = state.clock.setTimeout(() => {
    // Atomic clear on fire so concurrent schedule calls can re-arm cleanly.
    state.timer = null;
    state.nextWakeAtMs = null;
    void tickGithubAutomationScheduler().catch(() => {
      // lastError already set inside tick when possible
    });
  }, delayMs);

  // Do not keep the process alive solely for the scheduler in tests/CLI.
  if (typeof state.timer === "object" && state.timer && "unref" in state.timer) {
    try {
      (state.timer as NodeJS.Timeout).unref();
    } catch {
      // ignore
    }
  }
}

function armTimer(delayMs: number, options?: { force?: boolean }): void {
  armDeadline(schedulerNowMs() + Math.max(0, delayMs), options);
}

/**
 * Schedule a future tick with earliest-deadline semantics.
 * A later request never replaces an earlier armed wake; use wake() to force ASAP.
 */
export function scheduleGithubAutomationScheduler(delayMs?: number): void {
  const state = getState();
  state.started = true;
  armTimer(delayMs ?? state.pollIntervalMs, { force: false });
}

/**
 * Immediate wake: schedule tick ASAP. Safe from webhook after enqueue.
 * Does not block; does not run model/Git in the caller stack beyond a microtask tick.
 * Production analysis handler is statically bound — no sync require prewarm.
 */
export function wakeGithubAutomationScheduler(): void {
  const state = getState();
  state.wakeGeneration += 1;
  state.started = true;
  armTimer(0, { force: true });
}

/**
 * Lazy ensure: start background reconciliation if not already armed.
 * Reconciles durable queued / overdue retry_due / stale-running analysis jobs
 * without requiring an inbound webhook, status/verify GET, or manual Retry.
 *
 * Safe to call from Node server startup (instrumentation) and webhook enqueue.
 * Multi-process: each process may ensure; filesystem job lease + fencing keeps
 * handler side effects single-owner.
 */
export function ensureGithubAutomationScheduler(): void {
  const state = getState();
  // Already armed: nothing to do. If started but idle (no timer), re-scan so a
  // later-arriving overdue job or config unpause can recover without a webhook.
  if (state.started && state.timer != null) return;
  state.started = true;
  // Prefer durable-queue rescan so overdue/future/paused-pending jobs arm correctly.
  void rescheduleFromDurableQueue("ensure").then(() => {
    // If the queue still has no timer (enabled + due work that needs a tick,
    // or rescan raced), force an immediate tick once.
    if (state.timer == null && state.autoSchedule) {
      armTimer(0, { force: true });
    }
  });
}

export function getGithubAutomationSchedulerSnapshot(): {
  ownerId: string;
  started: boolean;
  running: boolean;
  inFlight: number;
  lastTickAt: string | null;
  lastError: string | null;
  wakeGeneration: number;
  nextWakeAtMs: number | null;
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
    nextWakeAtMs: state.nextWakeAtMs,
  };
}
