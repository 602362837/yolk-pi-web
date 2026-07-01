import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createUnifiedDiff } from "./unified-diff";
import type {
  SessionChangedFileSummary,
  SessionFileChangeReason,
  SessionFileChangeSourceKind,
  SessionFileChangeStatus,
  SessionFileDiffResponse,
} from "./types";

const SIDECAR_VERSION = 1;
const MAX_TEXT_FILE_BYTES = 512 * 1024;

type SnapshotKind = "missing" | "text" | "binary" | "too-large" | "unreadable";

interface FileSnapshot {
  kind: SnapshotKind;
  exists: boolean;
  text?: string;
  hash?: string;
  reason?: SessionFileChangeReason;
}

interface PendingToolSnapshot {
  toolCallId: string;
  toolName: SessionFileChangeSourceKind;
  path: string;
  absolutePath: string;
  before: FileSnapshot;
  startedAt: string;
}

interface SessionFileChangeRecord {
  path: string;
  absolutePath?: string;
  status: SessionFileChangeStatus;
  additions: number;
  deletions: number;
  firstChangedAt: string;
  lastChangedAt: string;
  toolCallIds: string[];
  toolNames: SessionFileChangeSourceKind[];
  sourceKinds: SessionFileChangeSourceKind[];
  diffAvailable: boolean;
  diff?: string;
  reason?: SessionFileChangeReason;
  baselineText?: string;
  baselineExists?: boolean;
  baselineHash?: string;
  latestHash?: string;
}

interface SessionFileChangesSidecar {
  version: 1;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  updatedAt: string;
  files: Record<string, SessionFileChangeRecord>;
  pendingTools?: Record<string, PendingToolSnapshot>;
}

interface AgentToolEvent {
  type: string;
  toolCallId?: unknown;
  toolName?: unknown;
  args?: unknown;
  isError?: unknown;
}

export interface SessionFileChangeEventResult {
  changed: boolean;
  fileCount: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function getSessionChangesDir(): string {
  return path.join(getAgentDir(), "session-changes");
}

function getSessionChangesPath(sessionId: string): string {
  return path.join(getSessionChangesDir(), `${encodeURIComponent(sessionId)}.json`);
}

function emptySidecar(sessionId: string, cwd: string, sessionFile?: string): SessionFileChangesSidecar {
  return {
    version: SIDECAR_VERSION,
    sessionId,
    sessionFile,
    cwd,
    updatedAt: new Date().toISOString(),
    files: {},
    pendingTools: {},
  };
}

function readSidecarForWrite(sessionId: string, cwd: string, sessionFile?: string): SessionFileChangesSidecar {
  const filePath = getSessionChangesPath(sessionId);
  if (!existsSync(filePath)) return emptySidecar(sessionId, cwd, sessionFile);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<SessionFileChangesSidecar>;
    if (parsed.version !== SIDECAR_VERSION || parsed.sessionId !== sessionId || !parsed.files) {
      return emptySidecar(sessionId, cwd, sessionFile);
    }
    return {
      version: SIDECAR_VERSION,
      sessionId,
      sessionFile: parsed.sessionFile ?? sessionFile,
      cwd: parsed.cwd ?? cwd,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      files: parsed.files,
      pendingTools: parsed.pendingTools ?? {},
    };
  } catch {
    return emptySidecar(sessionId, cwd, sessionFile);
  }
}

export function readSessionChangesSidecar(sessionId: string): SessionFileChangesSidecar | null {
  const filePath = getSessionChangesPath(sessionId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<SessionFileChangesSidecar>;
    if (parsed.version !== SIDECAR_VERSION || parsed.sessionId !== sessionId || !parsed.files) return null;
    return {
      version: SIDECAR_VERSION,
      sessionId,
      sessionFile: parsed.sessionFile,
      cwd: parsed.cwd ?? "",
      updatedAt: parsed.updatedAt ?? "",
      files: parsed.files,
      pendingTools: parsed.pendingTools ?? {},
    };
  } catch {
    return null;
  }
}

function writeSidecar(sidecar: SessionFileChangesSidecar): void {
  const filePath = getSessionChangesPath(sidecar.sessionId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(sidecar, null, 2));
  renameSync(tmpPath, filePath);
}

export function deleteSessionChangesSidecar(sessionId: string): void {
  try {
    unlinkSync(getSessionChangesPath(sessionId));
  } catch {
    // Best-effort cleanup only.
  }
}

function resolveWorkspacePath(cwd: string, inputPath: string): { absolutePath: string; relativePath: string } | null {
  const cwdResolved = path.resolve(cwd);
  const absolutePath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(cwdResolved, inputPath);
  const relative = path.relative(cwdResolved, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { absolutePath, relativePath: normalizeSlashes(relative) };
}

function readSnapshot(absolutePath: string): FileSnapshot {
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return { kind: "unreadable", exists: true, reason: "unreadable" };
    if (stat.size > MAX_TEXT_FILE_BYTES) return { kind: "too-large", exists: true, reason: "too-large" };
    const buffer = readFileSync(absolutePath);
    const hash = sha256(buffer);
    if (buffer.includes(0)) return { kind: "binary", exists: true, hash, reason: "binary" };
    return { kind: "text", exists: true, text: buffer.toString("utf8"), hash };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing", exists: false };
    return { kind: "unreadable", exists: false, reason: "unreadable" };
  }
}

function getToolPath(args: unknown): string | null {
  if (!isObject(args)) return null;
  return typeof args.path === "string" && args.path.trim() ? args.path : null;
}

function uniquePush<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item];
}

function getStatus(before: FileSnapshot, after: FileSnapshot): SessionFileChangeStatus {
  if (!before.exists && after.exists) return "added";
  if (before.exists && !after.exists) return "deleted";
  if (before.kind === "text" && after.kind === "text") return "modified";
  return "metadata-only";
}

function chooseReason(before: FileSnapshot, after: FileSnapshot): SessionFileChangeReason | undefined {
  return after.reason ?? before.reason;
}

function updateRecord(sidecar: SessionFileChangesSidecar, pending: PendingToolSnapshot, after: FileSnapshot, endedAt: string): boolean {
  const existing = sidecar.files[pending.path];
  const pendingBaselineText = pending.before.kind === "text"
    ? pending.before.text
    : (!pending.before.exists ? "" : undefined);
  const baselineText = existing?.baselineText ?? pendingBaselineText;
  const baselineExists = existing?.baselineExists ?? pending.before.exists;
  const baselineHash = existing?.baselineHash ?? pending.before.hash;
  const latestHash = after.hash;
  const baselineSnapshot: FileSnapshot = existing?.baselineText !== undefined
    ? { kind: "text", exists: existing.baselineExists ?? true, text: existing.baselineText, hash: existing.baselineHash }
    : pending.before;
  const status = getStatus(baselineSnapshot, after);

  if (baselineHash && latestHash && baselineHash === latestHash) {
    if (existing) {
      delete sidecar.files[pending.path];
      return true;
    }
    return false;
  }

  const toolCallIds = uniquePush(existing?.toolCallIds ?? [], pending.toolCallId);
  const toolNames = uniquePush(existing?.toolNames ?? [], pending.toolName);
  const sourceKinds = uniquePush(existing?.sourceKinds ?? [], pending.toolName);
  const firstChangedAt = existing?.firstChangedAt ?? pending.startedAt;

  if (baselineText !== undefined && (after.kind === "text" || !after.exists)) {
    const afterText = after.exists ? after.text ?? "" : "";
    const diffResult = createUnifiedDiff(pending.path, baselineText, afterText);
    if (!diffResult.diff) {
      if (existing) {
        delete sidecar.files[pending.path];
        return true;
      }
      return false;
    }
    sidecar.files[pending.path] = {
      path: pending.path,
      absolutePath: pending.absolutePath,
      status,
      additions: diffResult.additions,
      deletions: diffResult.deletions,
      firstChangedAt,
      lastChangedAt: endedAt,
      toolCallIds,
      toolNames,
      sourceKinds,
      diffAvailable: true,
      diff: diffResult.diff,
      baselineText,
      baselineExists,
      baselineHash,
      latestHash,
    };
    return true;
  }

  const reason = chooseReason(pending.before, after) ?? "unreadable";
  sidecar.files[pending.path] = {
    path: pending.path,
    absolutePath: pending.absolutePath,
    status,
    additions: 0,
    deletions: 0,
    firstChangedAt,
    lastChangedAt: endedAt,
    toolCallIds,
    toolNames,
    sourceKinds,
    diffAvailable: false,
    reason,
    baselineExists,
    baselineHash,
    latestHash,
  };
  return true;
}

export function recordSessionFileChangeEvent(input: {
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  event: AgentToolEvent;
}): SessionFileChangeEventResult {
  const { sessionId, sessionFile, cwd, event } = input;
  if (event.type !== "tool_execution_start" && event.type !== "tool_execution_end") {
    return { changed: false, fileCount: 0 };
  }
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
  const toolName = event.toolName === "edit" || event.toolName === "write" ? event.toolName : null;
  if (!toolCallId || !toolName) return { changed: false, fileCount: 0 };

  const sidecar = readSidecarForWrite(sessionId, cwd, sessionFile);
  sidecar.pendingTools ??= {};

  if (event.type === "tool_execution_start") {
    const requestedPath = getToolPath(event.args);
    if (!requestedPath) return { changed: false, fileCount: Object.keys(sidecar.files).length };
    const resolved = resolveWorkspacePath(cwd, requestedPath);
    if (!resolved) return { changed: false, fileCount: Object.keys(sidecar.files).length };
    sidecar.pendingTools[toolCallId] = {
      toolCallId,
      toolName,
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      before: readSnapshot(resolved.absolutePath),
      startedAt: new Date().toISOString(),
    };
    sidecar.updatedAt = new Date().toISOString();
    writeSidecar(sidecar);
    return { changed: true, fileCount: Object.keys(sidecar.files).length };
  }

  const pending = sidecar.pendingTools[toolCallId];
  if (!pending) return { changed: false, fileCount: Object.keys(sidecar.files).length };
  delete sidecar.pendingTools[toolCallId];

  const after = readSnapshot(pending.absolutePath);
  let changed = false;
  if (!event.isError || pending.before.hash !== after.hash || pending.before.exists !== after.exists) {
    changed = updateRecord(sidecar, pending, after, new Date().toISOString());
  }
  sidecar.updatedAt = new Date().toISOString();
  writeSidecar(sidecar);
  return { changed, fileCount: Object.keys(sidecar.files).length };
}

function toSummary(record: SessionFileChangeRecord): SessionChangedFileSummary {
  return {
    path: record.path,
    status: record.status,
    additions: record.additions,
    deletions: record.deletions,
    toolNames: record.toolNames,
    sourceKinds: record.sourceKinds,
    diffAvailable: record.diffAvailable,
    reason: record.reason,
    firstChangedAt: record.firstChangedAt,
    lastChangedAt: record.lastChangedAt,
  };
}

export function listSessionChangedFiles(sessionId: string): { updatedAt?: string; files: SessionChangedFileSummary[] } {
  const sidecar = readSessionChangesSidecar(sessionId);
  if (!sidecar) return { files: [] };
  const files = Object.values(sidecar.files)
    .map(toSummary)
    .sort((a, b) => a.path.localeCompare(b.path));
  return { updatedAt: sidecar.updatedAt, files };
}

export function getSessionFileDiff(sessionId: string, relativePath: string): SessionFileDiffResponse | null {
  if (!relativePath || relativePath.startsWith("/") || relativePath.startsWith("\\")) return null;
  if (relativePath.split(/[\\/]+/).some((part) => part === "..")) return null;
  const sidecar = readSessionChangesSidecar(sessionId);
  const record = sidecar?.files[normalizeSlashes(relativePath)];
  if (!record) return null;
  return { ...toSummary(record), diff: record.diffAvailable ? record.diff : undefined };
}
