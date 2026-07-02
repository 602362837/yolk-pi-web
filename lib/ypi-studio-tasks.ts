import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { canonicalizeCwd } from "./cwd";
import {
  findYpiStudioTransition,
  getYpiStudioWorkflowOrDefault,
  readYpiStudioWorkflow,
} from "./ypi-studio-workflows";
import type {
  YpiStudioTaskArtifactUpdateBody,
  YpiStudioTaskCreateBody,
  YpiStudioTaskDetail,
  YpiStudioTaskDocument,
  YpiStudioTaskEvent,
  YpiStudioTaskProgress,
  YpiStudioTaskRecord,
  YpiStudioTaskSubagentRun,
  YpiStudioSubagentTranscriptRef,
  YpiStudioTaskSummary,
  YpiStudioTasksResponse,
  YpiStudioTaskTransitionBody,
  YpiStudioWorkflowFile,
} from "./ypi-studio-types";

const TASKS_DIR = path.join(".ypi", "tasks");
const RUNTIME_SESSIONS_DIR = path.join(".ypi", ".runtime", "sessions");
const TASK_JSON = "task.json";
const EVENTS_JSONL = "events.jsonl";
const DOC_MAX_BYTES = 256 * 1024;
const EVENTS_MAX_BYTES = 512 * 1024;

const DEFAULT_ARTIFACTS: Record<string, string> = {
  brief: "brief.md",
  prd: "prd.md",
  ui: "ui.md",
  design: "design.md",
  implement: "implement.md",
  checks: "checks.md",
  handoff: "handoff.md",
  review: "review.md",
  summary: "summary.md",
};

interface TaskContext {
  cwd: string;
  workspaceRoot: string;
  tasksRoot: string;
  runtimeSessionsRoot: string;
}

interface TaskRecordOnDisk {
  key: string;
  id: string;
  dirPath: string;
  pathLabel: string;
  raw: YpiStudioTaskRecord | null;
  readError?: string;
  modifiedMs: number;
}

export class YpiStudioTaskSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YpiStudioTaskSecurityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeTranscriptRef(value: unknown): YpiStudioSubagentTranscriptRef | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 1 || value.format !== "ypi-studio-subagent-transcript") return undefined;
  const runId = optionalString(value.runId);
  const taskId = optionalString(value.taskId);
  const member = optionalString(value.member);
  const pathLabel = optionalString(value.pathLabel);
  const status = value.status === "running" || value.status === "succeeded" || value.status === "failed" || value.status === "cancelled" ? value.status : undefined;
  const startedAt = optionalString(value.startedAt);
  const updatedAt = optionalString(value.updatedAt);
  if (!runId || !taskId || !member || !pathLabel || !status || !startedAt || !updatedAt) return undefined;
  return {
    schemaVersion: 1,
    format: "ypi-studio-subagent-transcript",
    runId,
    taskId,
    member,
    pathLabel,
    status,
    startedAt,
    finishedAt: optionalString(value.finishedAt),
    updatedAt,
    itemCount: typeof value.itemCount === "number" ? value.itemCount : 0,
    messageCount: typeof value.messageCount === "number" ? value.messageCount : 0,
    toolCallCount: typeof value.toolCallCount === "number" ? value.toolCallCount : 0,
    stderrBytes: typeof value.stderrBytes === "number" ? value.stderrBytes : 0,
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
    truncated: value.truncated === true,
  };
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
    throw new YpiStudioTaskSecurityError(`Path escapes workspace: ${relativeLabel(workspaceRoot, target)}`);
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
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${target}`);
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
  if (stat.size <= maxBytes) return { content: readFileSync(filePath, "utf8"), truncated: false };

  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return { content: buffer.subarray(0, bytesRead).toString("utf8"), truncated: true };
  } finally {
    closeSync(fd);
  }
}

function createContext(cwd: string): TaskContext {
  const workspaceRoot = canonicalizeCwd(cwd);
  const stat = statSync(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${cwd}`);
  return {
    cwd: workspaceRoot,
    workspaceRoot,
    tasksRoot: path.join(workspaceRoot, TASKS_DIR),
    runtimeSessionsRoot: path.join(workspaceRoot, RUNTIME_SESSIONS_DIR),
  };
}

function ensureTaskRoots(ctx: TaskContext): void {
  const ypiRoot = path.join(ctx.workspaceRoot, ".ypi");
  if (existsSync(ypiRoot)) assertDirectoryWithinWorkspace(ypiRoot, ctx.workspaceRoot);
  else mkdirSync(ypiRoot);

  if (existsSync(ctx.tasksRoot)) assertDirectoryWithinWorkspace(ctx.tasksRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.tasksRoot);

  const runtimeRoot = path.join(ctx.workspaceRoot, ".ypi", ".runtime");
  if (existsSync(runtimeRoot)) assertDirectoryWithinWorkspace(runtimeRoot, ctx.workspaceRoot);
  else mkdirSync(runtimeRoot);

  if (existsSync(ctx.runtimeSessionsRoot)) assertDirectoryWithinWorkspace(ctx.runtimeSessionsRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.runtimeSessionsRoot);
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "studio-task";
}

function createTaskId(title: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${slugify(title)}`;
}

function taskKey(id: string): string {
  return `active:${id}`;
}

function idFromKey(taskKeyOrId: string): string {
  return taskKeyOrId.startsWith("active:") ? taskKeyOrId.slice("active:".length) : taskKeyOrId;
}

function isSafeTaskId(id: string): boolean {
  return /^[^/\\:]+$/.test(id) && id !== "." && id !== "..";
}

function taskDir(ctx: TaskContext, taskIdOrKey: string): string {
  const id = idFromKey(taskIdOrKey);
  if (!isSafeTaskId(id)) throw new YpiStudioTaskSecurityError("Invalid task id");
  return path.join(ctx.tasksRoot, id);
}

function normalizeTaskRecord(value: unknown, fallbackId: string, ctx: TaskContext): YpiStudioTaskRecord {
  if (!isRecord(value)) throw new Error("task.json root must be an object");
  const id = optionalString(value.id) ?? fallbackId;
  const title = optionalString(value.title) ?? id;
  const workflowId = optionalString(value.workflowId) ?? "feature-dev";
  const status = optionalString(value.status) ?? "intake";
  const artifacts = isRecord(value.artifacts)
    ? Object.fromEntries(Object.entries(value.artifacts).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : { ...DEFAULT_ARTIFACTS };
  const subagents = Array.isArray(value.subagents)
    ? value.subagents.filter(isRecord).map((run): YpiStudioTaskSubagentRun => ({
        id: optionalString(run.id) ?? `run-${Date.now()}`,
        member: optionalString(run.member) ?? "unknown",
        status: run.status === "running" || run.status === "succeeded" || run.status === "failed" || run.status === "cancelled" ? run.status : "failed",
        startedAt: optionalString(run.startedAt) ?? nowIso(),
        finishedAt: optionalString(run.finishedAt),
        prompt: optionalString(run.prompt),
        summary: optionalString(run.summary),
        model: optionalString(run.model),
        thinking: optionalString(run.thinking),
        modelSource: optionalString(run.modelSource),
        thinkingSource: optionalString(run.thinkingSource),
        error: optionalString(run.error),
        transcript: normalizeTranscriptRef(run.transcript),
      }))
    : [];
  return {
    schemaVersion: 1,
    id,
    title,
    workflowId,
    status,
    cwd: optionalString(value.cwd) ?? ctx.cwd,
    createdAt: optionalString(value.createdAt) ?? nowIso(),
    updatedAt: optionalString(value.updatedAt) ?? nowIso(),
    completedAt: value.completedAt === null ? null : optionalString(value.completedAt),
    contextIds: stringArray(value.contextIds),
    currentMember: optionalString(value.currentMember),
    artifacts,
    subagents,
    meta: isRecord(value.meta) ? value.meta : {},
  };
}

function readTaskJson(ctx: TaskContext, dirPath: string): YpiStudioTaskRecord {
  const taskJsonPath = path.join(dirPath, TASK_JSON);
  safeStatFile(taskJsonPath, ctx.workspaceRoot);
  const parsed = JSON.parse(readFileSync(taskJsonPath, "utf8")) as unknown;
  return normalizeTaskRecord(parsed, path.basename(dirPath), ctx);
}

function writeTaskJson(dirPath: string, task: YpiStudioTaskRecord): void {
  writeFileSync(path.join(dirPath, TASK_JSON), `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

function appendTaskEvent(dirPath: string, event: YpiStudioTaskEvent): void {
  appendFileSync(path.join(dirPath, EVENTS_JSONL), `${JSON.stringify(event)}\n`, "utf8");
}

function scanTaskDirectory(ctx: TaskContext, dirPath: string): TaskRecordOnDisk {
  const id = path.basename(dirPath);
  const key = taskKey(id);
  const pathLabel = relativeLabel(ctx.workspaceRoot, dirPath);
  let modifiedMs = 0;
  try {
    const stat = lstatSync(dirPath);
    modifiedMs = stat.mtimeMs;
    assertDirectoryWithinWorkspace(dirPath, ctx.workspaceRoot);
    return {
      key,
      id,
      dirPath,
      pathLabel,
      raw: readTaskJson(ctx, dirPath),
      modifiedMs,
    };
  } catch (error) {
    if (error instanceof YpiStudioTaskSecurityError) throw error;
    return {
      key,
      id,
      dirPath,
      pathLabel,
      raw: null,
      modifiedMs,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function scanTaskRecords(ctx: TaskContext): { exists: boolean; records: TaskRecordOnDisk[]; errors: YpiStudioTasksResponse["errors"] } {
  if (!existsSync(ctx.tasksRoot)) return { exists: false, records: [], errors: [] };
  assertDirectoryWithinWorkspace(ctx.tasksRoot, ctx.workspaceRoot);
  const records: TaskRecordOnDisk[] = [];
  const errors: YpiStudioTasksResponse["errors"] = [];
  for (const entry of readdirSync(ctx.tasksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const record = scanTaskDirectory(ctx, path.join(ctx.tasksRoot, entry.name));
    records.push(record);
    if (record.readError) errors.push({ key: record.key, pathLabel: record.pathLabel, message: record.readError });
  }
  return { exists: true, records, errors };
}

function artifactFileName(task: YpiStudioTaskRecord, artifact: string): string | null {
  if (task.artifacts[artifact]) return task.artifacts[artifact];
  const match = Object.values(task.artifacts).find((fileName) => fileName === artifact);
  return match ?? null;
}

function isSafeArtifactFileName(fileName: string): boolean {
  return /^[A-Za-z0-9._-]+\.md$/.test(fileName);
}

function artifactPath(dirPath: string, task: YpiStudioTaskRecord, artifact: string): string {
  const fileName = artifactFileName(task, artifact);
  if (!fileName || !isSafeArtifactFileName(fileName)) throw new YpiStudioTaskSecurityError("Invalid artifact");
  return path.join(dirPath, fileName);
}

function artifactCompleted(dirPath: string, task: YpiStudioTaskRecord, artifactFile: string, workspaceRoot: string): boolean {
  const fileName = artifactFileName(task, artifactFile) ?? artifactFile;
  if (!isSafeArtifactFileName(fileName)) return false;
  const filePath = path.join(dirPath, fileName);
  if (!safeFileExists(filePath, workspaceRoot)) return false;
  const content = readFileSync(filePath, "utf8").trim();
  return content.length > 0 && !/\bTBD\b|待填写|YPI Studio workflow/i.test(content);
}

function progressForTask(record: TaskRecordOnDisk, workflow: YpiStudioWorkflowFile | null, workspaceRoot: string): YpiStudioTaskProgress {
  const task = record.raw;
  const status = task?.status ?? "unknown";
  const state = workflow?.states[status];
  const requiredArtifacts = state?.requiredArtifacts ?? [];
  const optionalArtifacts = state?.optionalArtifacts ?? [];
  const completedArtifacts = task
    ? [...requiredArtifacts, ...optionalArtifacts].filter((artifact) => artifactCompleted(record.dirPath, task, artifact, workspaceRoot))
    : [];
  const missingArtifacts = requiredArtifacts.filter((artifact) => !completedArtifacts.includes(artifact));
  return {
    status,
    label: state?.label ?? status,
    percent: state?.progress ?? (status === "completed" || status === "archived" ? 100 : 0),
    owner: state?.owner ?? "main",
    requiredArtifacts,
    optionalArtifacts,
    completedArtifacts,
    missingArtifacts,
  };
}

function workflowForTask(cwd: string, task: YpiStudioTaskRecord | null): YpiStudioWorkflowFile | null {
  if (!task) return null;
  return readYpiStudioWorkflow(cwd, task.workflowId) ?? null;
}

function recordToSummary(ctx: TaskContext, record: TaskRecordOnDisk): YpiStudioTaskSummary {
  const workflow = workflowForTask(ctx.cwd, record.raw);
  const progress = progressForTask(record, workflow, ctx.workspaceRoot);
  const task = record.raw;
  return {
    key: record.key,
    id: task?.id ?? record.id,
    title: task?.title ?? record.id,
    workflowId: task?.workflowId ?? "unknown",
    workflowName: workflow?.name,
    status: task?.status ?? "unknown",
    cwd: task?.cwd ?? ctx.cwd,
    pathLabel: record.pathLabel,
    createdAt: task?.createdAt ?? "",
    updatedAt: task?.updatedAt ?? new Date(record.modifiedMs).toISOString(),
    completedAt: task?.completedAt,
    currentMember: task?.currentMember ?? progress.owner,
    contextIds: task?.contextIds ?? [],
    progress,
    readError: record.readError,
  };
}

function sortTasks(a: YpiStudioTaskSummary, b: YpiStudioTaskSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title);
}

function isTaskEventType(value: string): value is YpiStudioTaskEvent["type"] {
  return value === "created" || value === "transition" || value === "artifact" || value === "subagent" || value === "note";
}

function readEvents(dirPath: string): YpiStudioTaskEvent[] {
  const filePath = path.join(dirPath, EVENTS_JSONL);
  if (!existsSync(filePath)) return [];
  const { content } = readFileWithLimit(filePath, EVENTS_MAX_BYTES);
  const events: YpiStudioTaskEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isRecord(parsed)) continue;
      const type = optionalString(parsed.type);
      const at = optionalString(parsed.at);
      const taskId = optionalString(parsed.taskId);
      if (!type || !isTaskEventType(type) || !at || !taskId) continue;
      events.push({
        type,
        at,
        taskId,
        message: optionalString(parsed.message),
        from: optionalString(parsed.from),
        to: optionalString(parsed.to),
        member: optionalString(parsed.member),
        artifact: optionalString(parsed.artifact),
        data: isRecord(parsed.data) ? parsed.data : undefined,
      });
    } catch {
      // Ignore malformed event rows in the compact detail projection.
    }
  }
  return events;
}

function readTaskDocument(ctx: TaskContext, record: TaskRecordOnDisk, task: YpiStudioTaskRecord, artifact: string): YpiStudioTaskDocument | undefined {
  const fileName = artifactFileName(task, artifact);
  if (!fileName || !isSafeArtifactFileName(fileName)) return undefined;
  const filePath = path.join(record.dirPath, fileName);
  if (!existsSync(filePath)) return undefined;
  const stat = safeStatFile(filePath, ctx.workspaceRoot);
  if (!stat) return undefined;
  const { content, truncated } = readFileWithLimit(filePath, DOC_MAX_BYTES);
  return { artifact, fileName, content, truncated };
}

function recordToDetail(ctx: TaskContext, record: TaskRecordOnDisk): YpiStudioTaskDetail | null {
  if (!record.raw) return null;
  const summary = recordToSummary(ctx, record);
  const documents: Record<string, YpiStudioTaskDocument> = {};
  for (const artifact of Object.keys(record.raw.artifacts)) {
    const document = readTaskDocument(ctx, record, record.raw, artifact);
    if (document) documents[artifact] = document;
  }
  return {
    ...summary,
    artifacts: record.raw.artifacts,
    documents,
    subagents: record.raw.subagents,
    meta: record.raw.meta,
    events: readEvents(record.dirPath),
  };
}

function loadTaskRecord(ctx: TaskContext, taskIdOrKey: string): TaskRecordOnDisk | null {
  const dirPath = taskDir(ctx, taskIdOrKey);
  if (!existsSync(dirPath)) return null;
  return scanTaskDirectory(ctx, dirPath);
}

function writeRuntimePointer(ctx: TaskContext, contextId: string, taskId: string): void {
  if (!contextId.trim()) return;
  ensureTaskRoots(ctx);
  const safeContext = contextId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  if (!safeContext) return;
  writeFileSync(path.join(ctx.runtimeSessionsRoot, `${safeContext}.json`), `${JSON.stringify({ currentTask: taskId, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

function readRuntimePointer(ctx: TaskContext, contextId: string): string | null {
  const safeContext = contextId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  if (!safeContext) return null;
  const filePath = path.join(ctx.runtimeSessionsRoot, `${safeContext}.json`);
  if (!existsSync(filePath)) return null;
  safeStatFile(filePath, ctx.workspaceRoot);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? optionalString(parsed.currentTask) ?? null : null;
  } catch {
    return null;
  }
}

function placeholderContent(fileName: string): string {
  const title = fileName.replace(/\.md$/i, "").replace(/-/g, " ");
  return `# ${title}\n\n_TBD by YPI Studio workflow._\n`;
}

function createArtifactFiles(dirPath: string, artifacts: Record<string, string>): void {
  for (const fileName of Object.values(artifacts)) {
    if (!isSafeArtifactFileName(fileName)) continue;
    const filePath = path.join(dirPath, fileName);
    if (!existsSync(filePath)) writeFileSync(filePath, placeholderContent(fileName), { encoding: "utf8", flag: "wx" });
  }
}

export function listYpiStudioTasks(cwd: string): YpiStudioTasksResponse {
  const ctx = createContext(cwd);
  const scanned = scanTaskRecords(ctx);
  if (!scanned.exists) {
    return { cwd: ctx.cwd, exists: false, pathLabel: TASKS_DIR, tasks: [], statusCounts: {}, errors: [] };
  }
  const tasks = scanned.records.map((record) => recordToSummary(ctx, record)).sort(sortTasks);
  const statusCounts: Record<string, number> = {};
  for (const task of tasks) statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
  return { cwd: ctx.cwd, exists: true, pathLabel: TASKS_DIR, tasks, statusCounts, errors: scanned.errors };
}

export function getYpiStudioTaskDetail(cwd: string, taskIdOrKey: string): YpiStudioTaskDetail | null {
  const ctx = createContext(cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  return record ? recordToDetail(ctx, record) : null;
}

export function getCurrentYpiStudioTaskDetail(cwd: string, contextId: string): YpiStudioTaskDetail | null {
  const ctx = createContext(cwd);
  const taskId = readRuntimePointer(ctx, contextId);
  return taskId ? getYpiStudioTaskDetail(ctx.cwd, taskId) : null;
}

export function createYpiStudioTask(body: YpiStudioTaskCreateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  ensureTaskRoots(ctx);
  const workflow = getYpiStudioWorkflowOrDefault(ctx.cwd, body.workflowId);
  let id = createTaskId(body.title);
  let dirPath = path.join(ctx.tasksRoot, id);
  if (existsSync(dirPath)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
    dirPath = path.join(ctx.tasksRoot, id);
  }
  mkdirSync(dirPath, { recursive: false });
  assertDirectoryWithinWorkspace(dirPath, ctx.workspaceRoot);
  const createdAt = nowIso();
  const contextIds = body.contextId ? [body.contextId] : [];
  const initialState = workflow.states[workflow.initialStatus];
  const task: YpiStudioTaskRecord = {
    schemaVersion: 1,
    id,
    title: body.title,
    workflowId: workflow.id,
    status: workflow.initialStatus,
    cwd: ctx.cwd,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    contextIds,
    currentMember: initialState?.owner,
    artifacts: { ...DEFAULT_ARTIFACTS },
    subagents: [],
    meta: {},
  };
  writeTaskJson(dirPath, task);
  writeFileSync(path.join(dirPath, EVENTS_JSONL), "", { encoding: "utf8", flag: "wx" });
  createArtifactFiles(dirPath, task.artifacts);
  appendTaskEvent(dirPath, { type: "created", at: createdAt, taskId: id, message: `Created YPI Studio task '${body.title}'`, data: { workflowId: workflow.id } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, id);
  if (!detail) throw new Error("Created task could not be read");
  return detail;
}

export function bindYpiStudioTaskToContext(cwd: string, taskIdOrKey: string, contextId: string): YpiStudioTaskDetail {
  const ctx = createContext(cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  if (!record.raw.contextIds.includes(contextId)) {
    record.raw.contextIds.push(contextId);
    record.raw.updatedAt = nowIso();
    writeTaskJson(record.dirPath, record.raw);
    appendTaskEvent(record.dirPath, { type: "note", at: record.raw.updatedAt, taskId: record.raw.id, message: "Bound task to Studio context", data: { contextId } });
  }
  writeRuntimePointer(ctx, contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after binding");
  return detail;
}

export function transitionYpiStudioTask(taskIdOrKey: string, body: YpiStudioTaskTransitionBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  const workflow = readYpiStudioWorkflow(ctx.cwd, record.raw.workflowId) ?? getYpiStudioWorkflowOrDefault(ctx.cwd, record.raw.workflowId);
  const from = record.raw.status;
  const transition = findYpiStudioTransition(workflow, from, body.to);
  if (!transition && !body.override) throw new Error(`Invalid Studio transition: ${from} -> ${body.to}`);
  if (transition?.requiresUserApproval && !body.reason && !body.override) {
    throw new Error(`Transition ${from} -> ${body.to} requires user approval reason`);
  }
  if (!workflow.states[body.to]) throw new Error(`Unknown workflow state: ${body.to}`);
  const updatedAt = nowIso();
  record.raw.status = body.to;
  record.raw.updatedAt = updatedAt;
  record.raw.currentMember = workflow.states[body.to]?.owner;
  if (workflow.terminalStatuses.includes(body.to)) record.raw.completedAt = updatedAt;
  if (body.contextId && !record.raw.contextIds.includes(body.contextId)) record.raw.contextIds.push(body.contextId);
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "transition", at: updatedAt, taskId: record.raw.id, from, to: body.to, message: body.reason, data: { override: body.override === true } });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after transition");
  return detail;
}

export function updateYpiStudioTaskArtifact(taskIdOrKey: string, body: YpiStudioTaskArtifactUpdateBody): YpiStudioTaskDetail {
  const ctx = createContext(body.cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  const filePath = artifactPath(record.dirPath, record.raw, body.artifact);
  safeRealPath(record.dirPath, ctx.workspaceRoot);
  writeFileSync(filePath, body.content, "utf8");
  const updatedAt = nowIso();
  record.raw.updatedAt = updatedAt;
  if (body.contextId && !record.raw.contextIds.includes(body.contextId)) record.raw.contextIds.push(body.contextId);
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, { type: "artifact", at: updatedAt, taskId: record.raw.id, artifact: body.artifact, message: `Updated ${body.artifact}` });
  if (body.contextId) writeRuntimePointer(ctx, body.contextId, record.raw.id);
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after artifact update");
  return detail;
}

export function recordYpiStudioSubagentRun(cwd: string, taskIdOrKey: string, run: YpiStudioTaskSubagentRun): YpiStudioTaskDetail {
  const ctx = createContext(cwd);
  const record = loadTaskRecord(ctx, taskIdOrKey);
  if (!record?.raw) throw new Error("Task not found");
  const updatedAt = nowIso();
  record.raw.subagents = [...record.raw.subagents.filter((existing) => existing.id !== run.id), run];
  record.raw.updatedAt = updatedAt;
  record.raw.currentMember = run.member;
  writeTaskJson(record.dirPath, record.raw);
  appendTaskEvent(record.dirPath, {
    type: "subagent",
    at: updatedAt,
    taskId: record.raw.id,
    member: run.member,
    message: run.summary ?? run.error ?? `${run.member} ${run.status}`,
    data: { runId: run.id, status: run.status, transcript: run.transcript },
  });
  const detail = getYpiStudioTaskDetail(ctx.cwd, record.raw.id);
  if (!detail) throw new Error("Task not found after subagent update");
  return detail;
}

export function getYpiStudioTaskContextForPrompt(cwd: string, taskIdOrKey: string): string {
  const detail = getYpiStudioTaskDetail(cwd, taskIdOrKey);
  if (!detail) return "No active YPI Studio task.";
  const workflow = readYpiStudioWorkflow(cwd, detail.workflowId);
  const docs = Object.values(detail.documents)
    .map((document) => `## ${document.fileName}\n\n${document.content}`)
    .join("\n\n---\n\n");
  return [
    "# YPI Studio Task Context",
    `Task: ${detail.id}`,
    `Title: ${detail.title}`,
    `Workflow: ${workflow?.name ?? detail.workflowId}`,
    `Status: ${detail.status} (${detail.progress.label})`,
    `Owner: ${detail.progress.owner}`,
    `Progress: ${detail.progress.percent}%`,
    `Required artifacts: ${detail.progress.requiredArtifacts.join(", ") || "none"}`,
    `Missing artifacts: ${detail.progress.missingArtifacts.join(", ") || "none"}`,
    docs ? `\n${docs}` : "",
  ].filter(Boolean).join("\n");
}

export function isYpiStudioTaskCreateBody(value: unknown): value is YpiStudioTaskCreateBody {
  return isRecord(value) && typeof value.cwd === "string" && typeof value.title === "string" && value.title.trim().length > 0;
}

export function isYpiStudioTaskTransitionBody(value: unknown): value is YpiStudioTaskTransitionBody {
  return isRecord(value) && typeof value.cwd === "string" && typeof value.to === "string" && value.to.trim().length > 0;
}

export function isYpiStudioTaskArtifactUpdateBody(value: unknown): value is YpiStudioTaskArtifactUpdateBody {
  return isRecord(value) && typeof value.cwd === "string" && typeof value.artifact === "string" && typeof value.content === "string";
}
