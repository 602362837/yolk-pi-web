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

declare global {
  var __ypiStudioSubagentChildRuns: Map<string, YpiStudioChildRunHandle> | undefined;
}

function registry(): Map<string, YpiStudioChildRunHandle> {
  if (!globalThis.__ypiStudioSubagentChildRuns) {
    globalThis.__ypiStudioSubagentChildRuns = new Map();
  }
  return globalThis.__ypiStudioSubagentChildRuns;
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
