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

export type YpiStudioSessionContinuationCallback = (payload: YpiStudioChildRunContinuationPayload) => void | Promise<void>;

declare global {
  var __ypiStudioSubagentChildRuns: Map<string, YpiStudioChildRunHandle> | undefined;
  var __ypiStudioSessionContinuations: Map<string, YpiStudioSessionContinuationCallback> | undefined;
  var __ypiStudioTerminalContinuationKeys: Set<string> | undefined;
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
}

export function unregisterYpiStudioSessionContinuation(parentSessionId: string): void {
  continuationRegistry().delete(parentSessionId);
}

export function scheduleYpiStudioChildRunContinuation(payload: Omit<YpiStudioChildRunContinuationPayload, "continuationKey">): boolean {
  const continuationKey = `${payload.parentSessionId}:${payload.taskId}:${payload.runId}`;
  const delivered = terminalContinuationKeys();
  if (delivered.has(continuationKey)) return false;
  const callback = continuationRegistry().get(payload.parentSessionId);
  if (!callback) return false;
  delivered.add(continuationKey);
  setTimeout(() => {
    try {
      Promise.resolve(callback({ ...payload, continuationKey })).catch(() => {
        // Continuation is best-effort. The terminal run is already persisted and can
        // still be collected manually if the parent session is busy or unavailable.
      });
    } catch {
      // Continuation is best-effort. The terminal run is already persisted and can
      // still be collected manually if the parent session is busy or unavailable.
    }
  }, 0);
  return true;
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
