import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "fs";
import path from "path";
import { canonicalizeCwd } from "./cwd";
import type {
  TrellisDocument,
  TrellisTaskArtifacts,
  TrellisTaskDetail,
  TrellisTaskProgress,
  TrellisTaskProgressStage,
  TrellisTaskReadError,
  TrellisTaskSummary,
  TrellisTasksResponse,
} from "./trellis-types";

const TASK_JSON = "task.json";
const ARCHIVE_DIR = "archive";
const DOC_MAX_BYTES = 256 * 1024;
const MANIFEST_MAX_BYTES = 512 * 1024;

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  review: 1,
  planning: 2,
  completed: 3,
  done: 3,
};

export class TrellisReaderSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrellisReaderSecurityError";
  }
}

interface TaskRecord {
  key: string;
  dirName: string;
  archiveMonth?: string;
  isArchived: boolean;
  dirPath: string;
  pathLabel: string;
  raw: Record<string, unknown> | null;
  readError?: string;
  modifiedMs: number;
}

interface ManifestCounts {
  implementCount: number;
  checkCount: number;
}

interface ReaderContext {
  cwd: string;
  workspaceRoot: string;
  tasksRoot: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return optionalString(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function relativeLabel(root: string, target: string): string {
  const rel = path.relative(root, target) || ".";
  return rel.split(path.sep).join("/");
}

function pathIsInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSep);
}

function safeRealPath(target: string, workspaceRoot: string): string {
  const real = realpathSync.native(target);
  if (!pathIsInside(workspaceRoot, real)) {
    throw new TrellisReaderSecurityError(`Path escapes workspace: ${relativeLabel(workspaceRoot, target)}`);
  }
  return real;
}

function assertDirectoryWithinWorkspace(target: string, workspaceRoot: string): void {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    const real = safeRealPath(target, workspaceRoot);
    if (!statSync(real).isDirectory()) throw new Error(`Not a directory: ${target}`);
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${target}`);
  }
  safeRealPath(target, workspaceRoot);
}

function safeStatFile(filePath: string, workspaceRoot: string) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    const real = safeRealPath(filePath, workspaceRoot);
    const realStat = statSync(real);
    return realStat.isFile() ? realStat : null;
  }
  if (!stat.isFile()) return null;
  safeRealPath(filePath, workspaceRoot);
  return stat;
}

function safeFileExists(filePath: string, workspaceRoot: string): boolean {
  try {
    return !!safeStatFile(filePath, workspaceRoot);
  } catch {
    return false;
  }
}

function readFileWithLimit(filePath: string, maxBytes: number): { content: string; truncated: boolean } {
  const stat = statSync(filePath);
  if (stat.size <= maxBytes) {
    return { content: readFileSync(filePath, "utf8"), truncated: false };
  }

  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return { content: buffer.subarray(0, bytesRead).toString("utf8"), truncated: true };
  } finally {
    closeSync(fd);
  }
}

function parseTaskJson(taskJsonPath: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(taskJsonPath, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("task.json root must be an object");
  return parsed;
}

function createContext(cwd: string): ReaderContext {
  const workspaceRoot = canonicalizeCwd(cwd);
  const stat = statSync(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${cwd}`);
  return {
    cwd: workspaceRoot,
    workspaceRoot,
    tasksRoot: path.join(workspaceRoot, ".trellis", "tasks"),
  };
}

function scanTaskDirectory(ctx: ReaderContext, dirPath: string, isArchived: boolean, archiveMonth?: string): TaskRecord {
  const dirName = path.basename(dirPath);
  const key = isArchived ? `archive:${archiveMonth}:${dirName}` : `active:${dirName}`;
  const pathLabel = relativeLabel(ctx.workspaceRoot, dirPath);
  let modifiedMs = 0;
  try {
    const stat = lstatSync(dirPath);
    modifiedMs = stat.mtimeMs;
    assertDirectoryWithinWorkspace(dirPath, ctx.workspaceRoot);
  } catch (error) {
    if (error instanceof TrellisReaderSecurityError) throw error;
    return {
      key,
      dirName,
      archiveMonth,
      isArchived,
      dirPath,
      pathLabel,
      raw: null,
      modifiedMs,
      readError: error instanceof Error ? error.message : String(error),
    };
  }

  const taskJsonPath = path.join(dirPath, TASK_JSON);
  try {
    safeStatFile(taskJsonPath, ctx.workspaceRoot);
    return {
      key,
      dirName,
      archiveMonth,
      isArchived,
      dirPath,
      pathLabel,
      raw: parseTaskJson(taskJsonPath),
      modifiedMs,
    };
  } catch (error) {
    if (error instanceof TrellisReaderSecurityError) throw error;
    return {
      key,
      dirName,
      archiveMonth,
      isArchived,
      dirPath,
      pathLabel,
      raw: null,
      modifiedMs,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function scanTaskRecords(ctx: ReaderContext, includeArchived: boolean): { exists: boolean; records: TaskRecord[]; archivedCount: number; errors: TrellisTaskReadError[] } {
  if (!existsSync(ctx.tasksRoot)) {
    return { exists: false, records: [], archivedCount: 0, errors: [] };
  }

  assertDirectoryWithinWorkspace(ctx.tasksRoot, ctx.workspaceRoot);

  const records: TaskRecord[] = [];
  const errors: TrellisTaskReadError[] = [];
  let archivedCount = 0;

  for (const entry of readdirSync(ctx.tasksRoot, { withFileTypes: true })) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name === ARCHIVE_DIR) continue;
    const record = scanTaskDirectory(ctx, path.join(ctx.tasksRoot, entry.name), false);
    records.push(record);
    if (record.readError) errors.push({ key: record.key, pathLabel: record.pathLabel, message: record.readError });
  }

  const archiveRoot = path.join(ctx.tasksRoot, ARCHIVE_DIR);
  if (existsSync(archiveRoot)) {
    assertDirectoryWithinWorkspace(archiveRoot, ctx.workspaceRoot);
    for (const monthEntry of readdirSync(archiveRoot, { withFileTypes: true })) {
      if (!monthEntry.isDirectory() && !monthEntry.isSymbolicLink()) continue;
      const month = monthEntry.name;
      const monthPath = path.join(archiveRoot, month);
      assertDirectoryWithinWorkspace(monthPath, ctx.workspaceRoot);
      for (const taskEntry of readdirSync(monthPath, { withFileTypes: true })) {
        if (!taskEntry.isDirectory() && !taskEntry.isSymbolicLink()) continue;
        archivedCount += 1;
        if (!includeArchived) continue;
        const record = scanTaskDirectory(ctx, path.join(monthPath, taskEntry.name), true, month);
        records.push(record);
        if (record.readError) errors.push({ key: record.key, pathLabel: record.pathLabel, message: record.readError });
      }
    }
  }

  return { exists: true, records, archivedCount, errors };
}

function countManifestEntries(filePath: string, workspaceRoot: string): number {
  if (!safeFileExists(filePath, workspaceRoot)) return 0;
  const { content } = readFileWithLimit(filePath, MANIFEST_MAX_BYTES);
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed) && Object.keys(parsed).length === 1 && typeof parsed._example === "string") continue;
      count += 1;
    } catch {
      count += 1;
    }
  }
  return count;
}

function getManifestCounts(record: TaskRecord, workspaceRoot: string): ManifestCounts {
  return {
    implementCount: countManifestEntries(path.join(record.dirPath, "implement.jsonl"), workspaceRoot),
    checkCount: countManifestEntries(path.join(record.dirPath, "check.jsonl"), workspaceRoot),
  };
}

function getArtifacts(record: TaskRecord, workspaceRoot: string, manifests: ManifestCounts): TrellisTaskArtifacts {
  return {
    prd: safeFileExists(path.join(record.dirPath, "prd.md"), workspaceRoot),
    design: safeFileExists(path.join(record.dirPath, "design.md"), workspaceRoot),
    implement: safeFileExists(path.join(record.dirPath, "implement.md"), workspaceRoot),
    implementContext: manifests.implementCount > 0,
    checkContext: manifests.checkCount > 0,
  };
}

function isCompletedStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "completed" || normalized === "done" || normalized === "complete";
}

function isReviewStatus(status: string): boolean {
  return status.toLowerCase() === "review";
}

function isInProgressStatus(status: string): boolean {
  return status.toLowerCase() === "in_progress";
}

function createProgress(
  status: string,
  isArchived: boolean,
  completedAt: string | null | undefined,
  commit: string | null | undefined,
  prUrl: string | null | undefined,
  artifacts: TrellisTaskArtifacts,
  manifests: ManifestCounts,
): TrellisTaskProgress {
  const finished = isArchived || isCompletedStatus(status) || !!completedAt || !!commit || !!prUrl;
  const planning = status.toLowerCase() === "planning";
  const inProgress = isInProgressStatus(status);
  const review = isReviewStatus(status);
  const planReady = artifacts.prd || artifacts.design || artifacts.implement || artifacts.implementContext;

  const stages: TrellisTaskProgressStage[] = [
    {
      id: "plan",
      label: "规划",
      status: finished || review || inProgress || (!planning && planReady) || artifacts.implement ? "done" : "active",
      details: [
        artifacts.prd ? "PRD 已存在" : "缺少 PRD",
        artifacts.design ? "Design 已存在" : "没有 Design",
        artifacts.implement ? "Implement 已存在" : "没有 Implement",
      ],
    },
    {
      id: "execute",
      label: "执行",
      status: finished || review ? "done" : inProgress ? "active" : "pending",
      details: [inProgress ? "任务正在执行" : finished || review ? "执行阶段已通过" : "等待任务开始"],
    },
    {
      id: "check",
      label: "检查",
      status: finished ? "done" : review ? "active" : "pending",
      details: [
        manifests.checkCount > 0 ? `${manifests.checkCount} 条 check context` : "没有 check context",
      ],
    },
    {
      id: "finish",
      label: "完成",
      status: finished ? "done" : "pending",
      details: [
        isArchived ? "已归档" : completedAt ? `完成于 ${completedAt}` : isCompletedStatus(status) ? "状态已完成" : "尚未完成",
        commit ? `Commit ${commit}` : "没有记录 Commit",
        prUrl ? "已记录 PR URL" : "没有记录 PR URL",
      ],
    },
  ];

  if (stages[0].status === "active" && !planning && !planReady) stages[0].status = "pending";

  const activeStage = stages.find((stage) => stage.status === "active");
  const doneStages = stages.filter((stage) => stage.status === "done").length;
  let phase = activeStage?.id ?? (finished ? "finish" : stages.find((stage) => stage.status === "pending")?.id ?? "plan");
  let percent = Math.min(doneStages * 25, 100);
  if (activeStage) {
    if (activeStage.id === "plan") percent = Math.max(percent, artifacts.implement || artifacts.design ? 25 : artifacts.prd ? 18 : 12);
    else percent = Math.max(percent, (doneStages + 1) * 25);
  }
  if (finished) {
    phase = "finish";
    percent = 100;
  }

  const labelByPhase: Record<typeof phase, string> = {
    plan: stages[0].status === "active" ? "规划中" : "等待规划",
    execute: "执行中",
    check: "检查中",
    finish: finished ? "已完成" : "等待完成",
  };

  return {
    phase,
    label: labelByPhase[phase],
    percent,
    stages,
  };
}

function completedChildren(children: string[], summariesByDir: Map<string, TrellisTaskSummary>): number {
  return children.filter((child) => {
    const summary = summariesByDir.get(child);
    if (!summary) return true;
    return summary.isArchived || isCompletedStatus(summary.status);
  }).length;
}

function recordToSummary(record: TaskRecord, workspaceRoot: string): TrellisTaskSummary {
  const raw = record.raw ?? {};
  const manifests = getManifestCounts(record, workspaceRoot);
  const artifacts = getArtifacts(record, workspaceRoot, manifests);
  const id = optionalString(raw.id) ?? optionalString(raw.name) ?? record.dirName;
  const name = optionalString(raw.name) ?? id;
  const title = optionalString(raw.title) ?? name ?? record.dirName;
  const status = optionalString(raw.status) ?? (record.readError ? "unknown" : "planning");
  const children = stringArray(raw.children);
  const completedAt = nullableString(raw.completedAt);
  const commit = nullableString(raw.commit);
  const prUrl = nullableString(raw.pr_url);

  return {
    key: record.key,
    dirName: record.dirName,
    archiveMonth: record.archiveMonth,
    isArchived: record.isArchived,
    id,
    name,
    title,
    description: optionalString(raw.description),
    status,
    priority: optionalString(raw.priority),
    assignee: optionalString(raw.assignee),
    creator: optionalString(raw.creator),
    createdAt: optionalString(raw.createdAt),
    completedAt,
    branch: nullableString(raw.branch),
    baseBranch: nullableString(raw.base_branch),
    worktreePath: nullableString(raw.worktree_path),
    commit,
    prUrl,
    parent: nullableString(raw.parent),
    children,
    subtasks: stringArray(raw.subtasks),
    childProgress: { total: children.length, completed: 0 },
    progress: createProgress(status, record.isArchived, completedAt, commit, prUrl, artifacts, manifests),
    hasArtifacts: artifacts,
    readError: record.readError,
  };
}

function sortSummaries(a: TrellisTaskSummary, b: TrellisTaskSummary): number {
  if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
  const statusDiff = (STATUS_ORDER[a.status.toLowerCase()] ?? 9) - (STATUS_ORDER[b.status.toLowerCase()] ?? 9);
  if (statusDiff !== 0) return statusDiff;
  const priorityDiff = (PRIORITY_ORDER[a.priority ?? ""] ?? 9) - (PRIORITY_ORDER[b.priority ?? ""] ?? 9);
  if (priorityDiff !== 0) return priorityDiff;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.title.localeCompare(b.title);
}

export function listTrellisTasks(cwd: string, includeArchived: boolean): TrellisTasksResponse {
  const ctx = createContext(cwd);
  const scanned = scanTaskRecords(ctx, includeArchived);
  if (!scanned.exists) {
    return {
      cwd: ctx.cwd,
      exists: false,
      pathLabel: ".trellis/tasks",
      tasks: [],
      statusCounts: {},
      archivedCount: 0,
      errors: [],
    };
  }

  const summaries = scanned.records.map((record) => recordToSummary(record, ctx.workspaceRoot));
  const byDir = new Map(summaries.map((summary) => [summary.dirName, summary]));
  const withChildProgress = summaries.map((summary) => ({
    ...summary,
    childProgress: {
      total: summary.children.length,
      completed: completedChildren(summary.children, byDir),
    },
  }));
  const statusCounts: Record<string, number> = {};
  for (const task of withChildProgress) {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
  }

  return {
    cwd: ctx.cwd,
    exists: true,
    pathLabel: ".trellis/tasks",
    tasks: withChildProgress.sort(sortSummaries),
    statusCounts,
    archivedCount: scanned.archivedCount,
    errors: scanned.errors,
  };
}

function readDocument(record: TaskRecord, workspaceRoot: string, fileName: TrellisDocument["fileName"]): TrellisDocument | undefined {
  const filePath = path.join(record.dirPath, fileName);
  if (!existsSync(filePath)) return undefined;
  const stat = safeStatFile(filePath, workspaceRoot);
  if (!stat) return undefined;
  const { content, truncated } = readFileWithLimit(filePath, DOC_MAX_BYTES);
  return { fileName, content, truncated };
}

export function getTrellisTaskDetail(cwd: string, taskKey: string): TrellisTaskDetail | null {
  const ctx = createContext(cwd);
  const scanned = scanTaskRecords(ctx, true);
  if (!scanned.exists) return null;

  const record = scanned.records.find((candidate) => candidate.key === taskKey);
  if (!record) return null;

  const list = listTrellisTasks(cwd, true);
  const summary = list.tasks.find((task) => task.key === taskKey) ?? recordToSummary(record, ctx.workspaceRoot);
  const raw = record.raw ?? {};
  const documents = {
    prd: readDocument(record, ctx.workspaceRoot, "prd.md"),
    design: readDocument(record, ctx.workspaceRoot, "design.md"),
    implement: readDocument(record, ctx.workspaceRoot, "implement.md"),
  };
  const manifests = getManifestCounts(record, ctx.workspaceRoot);

  return {
    ...summary,
    pathLabel: record.pathLabel,
    relatedFiles: stringArray(raw.relatedFiles),
    notes: optionalString(raw.notes),
    meta: recordValue(raw.meta),
    documents,
    manifests,
  };
}
