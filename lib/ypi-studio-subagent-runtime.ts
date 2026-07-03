export interface YpiStudioChildRunHandle {
  runId: string;
  taskId: string;
  member: string;
  cwd: string;
  parentSessionId?: string;
  pid?: number;
  startedAt: string;
  abort: (reason: string) => void;
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

export function unregisterYpiStudioChildRun(runId: string): void {
  registry().delete(runId);
}

export function abortYpiStudioChildRun(runId: string, reason = "abort"): boolean {
  const handle = registry().get(runId);
  if (!handle) return false;
  handle.abort(reason);
  return true;
}

export function abortYpiStudioChildRunsForSession(parentSessionId: string, reason = "parent_abort"): number {
  let count = 0;
  for (const handle of registry().values()) {
    if (handle.parentSessionId !== parentSessionId) continue;
    handle.abort(reason);
    count += 1;
  }
  return count;
}

export function listYpiStudioChildRuns(): YpiStudioChildRunHandle[] {
  return Array.from(registry().values());
}
