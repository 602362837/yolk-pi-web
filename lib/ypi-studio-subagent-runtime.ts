import type {
  YpiStudioSubagentRunProgress,
  YpiStudioSubagentRunStatus,
  YpiStudioSubagentRunner,
  YpiStudioTaskSubagentRun,
} from "./ypi-studio-types";
import {
  isBudgetExpired,
  type DiagnosticBudget,
  type DiagnosticLimits,
  type StudioRuntimeDiagnostic,
} from "./memory-diagnostics-types";

export type YpiStudioChildRunRegistryStatus = YpiStudioSubagentRunStatus | "runtime_lost";

export interface YpiStudioRuntimeLostProjection {
  runId: string;
  taskId: string;
  subtaskId?: string;
  member: string;
  status: "runtime_lost";
  reason: string;
  detectedAt: string;
}

export interface YpiStudioChildRunHandle {
  runId: string;
  taskId: string;
  subtaskId?: string;
  member: string;
  cwd: string;
  parentSessionId?: string;
  pid?: number;
  runner?: YpiStudioSubagentRunner;
  childSessionId?: string;
  childSessionFile?: string;
  startedAt: string;
  status: YpiStudioChildRunRegistryStatus;
  progress?: YpiStudioSubagentRunProgress;
  promise?: Promise<unknown>;
  result?: unknown;
  abort: (reason: string) => void;
  onAbortPersist?: (reason: string) => void;
}

export interface YpiStudioChildRunContinuationPayload {
  runId: string;
  taskId: string;
  subtaskId?: string;
  member: string;
  cwd: string;
  parentSessionId: string;
  status: YpiStudioSubagentRunStatus;
  summary?: string;
  finishedAt?: string;
  continuationKey: string;
}

export type YpiStudioSessionContinuationCallback = (payload: YpiStudioChildRunContinuationPayload) => boolean | void | Promise<boolean | void>;

interface PendingYpiStudioContinuation {
  payload: YpiStudioChildRunContinuationPayload;
  attempts: number;
}

const CONTINUATION_DELIVERY_RETRY_MS = 5_000;
const CONTINUATION_DELIVERY_MAX_RETRIES = 30;

declare global {
  var __ypiStudioSubagentChildRuns: Map<string, YpiStudioChildRunHandle> | undefined;
  var __ypiStudioSessionContinuations: Map<string, YpiStudioSessionContinuationCallback> | undefined;
  var __ypiStudioTerminalContinuationKeys: Set<string> | undefined;
  var __ypiStudioPendingContinuations: Map<string, PendingYpiStudioContinuation> | undefined;
}

function registry(): Map<string, YpiStudioChildRunHandle> {
  if (!globalThis.__ypiStudioSubagentChildRuns) {
    globalThis.__ypiStudioSubagentChildRuns = new Map();
  }
  return globalThis.__ypiStudioSubagentChildRuns;
}

function continuationRegistry(): Map<string, YpiStudioSessionContinuationCallback> {
  if (!globalThis.__ypiStudioSessionContinuations) {
    globalThis.__ypiStudioSessionContinuations = new Map();
  }
  return globalThis.__ypiStudioSessionContinuations;
}

function terminalContinuationKeys(): Set<string> {
  if (!globalThis.__ypiStudioTerminalContinuationKeys) {
    globalThis.__ypiStudioTerminalContinuationKeys = new Set();
  }
  return globalThis.__ypiStudioTerminalContinuationKeys;
}

function pendingContinuations(): Map<string, PendingYpiStudioContinuation> {
  if (!globalThis.__ypiStudioPendingContinuations) {
    globalThis.__ypiStudioPendingContinuations = new Map();
  }
  return globalThis.__ypiStudioPendingContinuations;
}

function continuationKeyFor(payload: Pick<YpiStudioChildRunContinuationPayload, "parentSessionId" | "taskId" | "runId">): string {
  return `${payload.parentSessionId}:${payload.taskId}:${payload.runId}`;
}

function persistPendingContinuation(payload: YpiStudioChildRunContinuationPayload, attempts = 0): void {
  pendingContinuations().set(payload.continuationKey, { payload, attempts });
}

function retryPendingContinuation(payload: YpiStudioChildRunContinuationPayload, attempts: number): void {
  persistPendingContinuation(payload, attempts);
  if (attempts >= CONTINUATION_DELIVERY_MAX_RETRIES) return;
  setTimeout(() => {
    const pending = pendingContinuations().get(payload.continuationKey);
    if (!pending || terminalContinuationKeys().has(payload.continuationKey)) return;
    tryDeliverYpiStudioContinuation(pending.payload, pending.attempts);
  }, CONTINUATION_DELIVERY_RETRY_MS);
}

function tryDeliverYpiStudioContinuation(payload: YpiStudioChildRunContinuationPayload, attempts = 0): boolean {
  const delivered = terminalContinuationKeys();
  if (delivered.has(payload.continuationKey)) return false;
  const callback = continuationRegistry().get(payload.parentSessionId);
  if (!callback) {
    persistPendingContinuation(payload, attempts);
    return false;
  }
  persistPendingContinuation(payload, attempts);
  setTimeout(() => {
    try {
      Promise.resolve(callback(payload)).then((accepted) => {
        if (accepted === false) {
          retryPendingContinuation(payload, attempts + 1);
          return;
        }
        pendingContinuations().delete(payload.continuationKey);
        delivered.add(payload.continuationKey);
      }).catch(() => {
        retryPendingContinuation(payload, attempts + 1);
      });
    } catch {
      retryPendingContinuation(payload, attempts + 1);
    }
  }, 0);
  return true;
}

export function registerYpiStudioChildRun(handle: YpiStudioChildRunHandle): void {
  registry().set(handle.runId, handle);
}

export function updateYpiStudioChildRun(
  runId: string,
  patch: Partial<Pick<YpiStudioChildRunHandle, "status" | "progress" | "promise" | "result" | "pid" | "runner" | "childSessionId" | "childSessionFile">>,
): YpiStudioChildRunHandle | undefined {
  const handle = registry().get(runId);
  if (!handle) return undefined;
  Object.assign(handle, patch);
  return handle;
}

export function getYpiStudioChildRun(runId: string): YpiStudioChildRunHandle | undefined {
  return registry().get(runId);
}

export function unregisterYpiStudioChildRun(runId: string): void {
  registry().delete(runId);
}

export function registerYpiStudioSessionContinuation(
  parentSessionId: string,
  callback: YpiStudioSessionContinuationCallback,
): void {
  continuationRegistry().set(parentSessionId, callback);
  for (const pending of pendingContinuations().values()) {
    if (pending.payload.parentSessionId === parentSessionId) {
      tryDeliverYpiStudioContinuation(pending.payload, pending.attempts);
    }
  }
}

export function unregisterYpiStudioSessionContinuation(parentSessionId: string): void {
  continuationRegistry().delete(parentSessionId);
}

export function scheduleYpiStudioChildRunContinuation(payload: Omit<YpiStudioChildRunContinuationPayload, "continuationKey">): boolean {
  const continuation = { ...payload, continuationKey: continuationKeyFor(payload) };
  if (terminalContinuationKeys().has(continuation.continuationKey)) return false;
  if (pendingContinuations().has(continuation.continuationKey)) return false;
  return tryDeliverYpiStudioContinuation(continuation);
}

export function abortYpiStudioChildRun(runId: string, reason = "abort"): boolean {
  const handle = registry().get(runId);
  if (!handle) return false;
  handle.status = "cancelled";
  handle.onAbortPersist?.(reason);
  handle.abort(reason);
  return true;
}

export function abortYpiStudioChildRunsForSession(parentSessionId: string, reason = "parent_abort"): number {
  let count = 0;
  for (const handle of registry().values()) {
    if (handle.parentSessionId !== parentSessionId) continue;
    handle.status = "cancelled";
    handle.onAbortPersist?.(reason);
    handle.abort(reason);
    count += 1;
  }
  return count;
}

export function listYpiStudioChildRuns(): YpiStudioChildRunHandle[] {
  return Array.from(registry().values());
}

export function countActiveYpiStudioChildRunsForSession(parentSessionId: string): number {
  let count = 0;
  for (const handle of registry().values()) {
    if (handle.parentSessionId !== parentSessionId) continue;
    if (handle.status === "queued" || handle.status === "running") count += 1;
  }
  return count;
}

/**
 * Bounded read-only projection of the YPI Studio runtime containers: child
 * run registry, session continuation callbacks, terminal continuation keys,
 * and pending continuations. Only ids/status/runner/member/timestamps/age and
 * aggregate counts are returned. `result`, `promise`, `abort`, `callback`,
 * `summary`, and progress text/items are deliberately omitted. Mutates nothing.
 */
export function projectYpiStudioRuntime(
  budget: DiagnosticBudget,
  limits: DiagnosticLimits,
): StudioRuntimeDiagnostic {
  const childByStatus: Record<string, number> = {};
  const childByRunner: Record<string, number> = {};
  const childByMember: Record<string, number> = {};
  const childSamples: StudioRuntimeDiagnostic["childRuns"]["samples"] = [];
  let childTruncated = false;
  let childTotal = 0;
  try {
    const now = budget.now;
    for (const handle of registry().values()) {
      if (isBudgetExpired(budget)) { childTruncated = true; break; }
      childTotal += 1;
      childByStatus[handle.status] = (childByStatus[handle.status] ?? 0) + 1;
      const runnerKey = handle.runner ?? "unknown";
      childByRunner[runnerKey] = (childByRunner[runnerKey] ?? 0) + 1;
      childByMember[handle.member] = (childByMember[handle.member] ?? 0) + 1;
      if (childSamples.length >= limits.maxChildRunSamples) { childTruncated = true; continue; }
      const startedMs = Date.parse(handle.startedAt);
      childSamples.push({
        runId: handle.runId,
        taskId: handle.taskId,
        subtaskId: handle.subtaskId,
        member: handle.member,
        status: handle.status,
        runner: handle.runner,
        startedAt: handle.startedAt,
        parentSessionId: handle.parentSessionId,
        ageMs: Number.isFinite(startedMs) ? Math.max(0, now - startedMs) : undefined,
      });
    }
  } catch {
    // best-effort projection
  }

  const pendingSamples: StudioRuntimeDiagnostic["pendingContinuations"]["samples"] = [];
  let pendingTruncated = false;
  let pendingTotal = 0;
  try {
    for (const pending of pendingContinuations().values()) {
      if (isBudgetExpired(budget)) { pendingTruncated = true; break; }
      pendingTotal += 1;
      if (pendingSamples.length >= limits.maxPendingContinuationSamples) { pendingTruncated = true; continue; }
      pendingSamples.push({
        continuationKey: pending.payload.continuationKey,
        parentSessionId: pending.payload.parentSessionId,
        taskId: pending.payload.taskId,
        runId: pending.payload.runId,
        attempts: pending.attempts,
      });
    }
  } catch {
    // best-effort projection
  }

  let continuationCallbackCount = 0;
  let terminalContinuationKeyCount = 0;
  try {
    continuationCallbackCount = continuationRegistry().size;
  } catch {
    // best-effort
  }
  try {
    terminalContinuationKeyCount = terminalContinuationKeys().size;
  } catch {
    // best-effort
  }

  return {
    childRunTotal: childTotal,
    childRunByStatus: childByStatus,
    childRunByRunner: childByRunner,
    childRunByMember: childByMember,
    childRuns: {
      total: childTotal,
      sampled: childSamples.length,
      truncated: childTruncated ? (childTotal - childSamples.length) : 0,
      samples: childSamples,
    },
    continuationCallbackCount,
    terminalContinuationKeyCount,
    pendingContinuationTotal: pendingTotal,
    pendingContinuations: {
      total: pendingTotal,
      sampled: pendingSamples.length,
      truncated: pendingTruncated ? (pendingTotal - pendingSamples.length) : 0,
      samples: pendingSamples,
    },
  };
}

export function projectYpiStudioRuntimeLostRun(
  taskId: string,
  run: Pick<YpiStudioTaskSubagentRun, "id" | "subtaskId" | "member" | "status">,
  reason = "runtime registry no longer has an active handle for this run",
): YpiStudioRuntimeLostProjection {
  return {
    runId: run.id,
    taskId,
    subtaskId: run.subtaskId,
    member: run.member,
    status: "runtime_lost",
    reason,
    detectedAt: new Date().toISOString(),
  };
}
