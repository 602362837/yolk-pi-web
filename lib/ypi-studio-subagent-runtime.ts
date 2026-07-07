import type {
  YpiStudioSubagentRunProgress,
  YpiStudioSubagentRunStatus,
  YpiStudioTaskSubagentRun,
} from "./ypi-studio-types";

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
  patch: Partial<Pick<YpiStudioChildRunHandle, "status" | "progress" | "promise" | "result" | "pid">>,
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
