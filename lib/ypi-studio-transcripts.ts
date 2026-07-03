import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  YpiStudioSubagentTranscriptItem,
  YpiStudioSubagentTranscriptRef,
  YpiStudioSubagentTranscriptResponse,
  YpiStudioSubagentTranscriptStatus,
  YpiStudioTaskSubagentRun,
} from "./ypi-studio-types";

const TRANSCRIPTS_DIR = path.join(".ypi", ".runtime", "studio-subagents");
const MAX_ITEM_TEXT_BYTES = 16 * 1024;
const MAX_API_BYTES = 256 * 1024;
const MAX_API_FULL_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
const DEFAULT_API_LIMIT = 200;
const MAX_API_LIMIT = 1000;

export interface YpiStudioSubagentTranscriptWriter {
  root: string;
  taskId: string;
  runId: string;
  member: string;
  filePath: string;
  metaPath: string;
  ref: YpiStudioSubagentTranscriptRef;
}

interface CreateTranscriptOptions {
  runId: string;
  member: string;
  startedAt: string;
}

interface ReadTranscriptOptions {
  cursor?: number;
  limit?: number;
  full?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function safeYpiStudioTranscriptKey(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 180);
  return cleaned || "item";
}

function pathIsInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSep);
}

function ensureDirectoryInsideWorkspace(dirPath: string, workspaceRoot: string): void {
  if (existsSync(dirPath)) {
    const stat = lstatSync(dirPath);
    if (stat.isSymbolicLink()) throw new Error(`Transcript directory cannot be a symlink: ${dirPath}`);
    if (!stat.isDirectory()) throw new Error(`Transcript path is not a directory: ${dirPath}`);
    const real = realpathSync.native(dirPath);
    if (!pathIsInside(workspaceRoot, real)) throw new Error("Transcript directory escapes workspace");
    return;
  }
  mkdirSync(dirPath, { recursive: true });
}

function truncateText(value: string, maxBytes = MAX_ITEM_TEXT_BYTES): { text: string; truncated: boolean } {
  if (byteLength(value) <= maxBytes) return { text: value, truncated: false };
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1;
  return { text: `${value.slice(0, Math.max(0, end - 1))}…`, truncated: true };
}

export function previewYpiStudioTranscriptText(value: unknown, maxBytes = MAX_ITEM_TEXT_BYTES): { text: string; truncated: boolean } {
  const raw = typeof value === "string" ? value : safeJson(value);
  return truncateText(raw, maxBytes);
}

function normalizeItem(item: YpiStudioSubagentTranscriptItem): YpiStudioSubagentTranscriptItem {
  if (item.kind === "tool_call") {
    const preview = truncateText(item.inputPreview);
    return { ...item, inputPreview: preview.text, truncated: item.truncated || preview.truncated };
  }
  if (item.kind === "tool_result") {
    const preview = truncateText(item.text);
    return { ...item, text: preview.text, truncated: item.truncated || preview.truncated };
  }
  if (item.kind === "assistant") {
    const preview = truncateText(item.text);
    return { ...item, text: preview.text, truncated: item.truncated || preview.truncated };
  }
  if (item.kind === "prompt" || item.kind === "status" || item.kind === "stderr" || item.kind === "error") {
    const preview = truncateText(item.text);
    return { ...item, text: preview.text, truncated: "truncated" in item ? item.truncated || preview.truncated : preview.truncated } as YpiStudioSubagentTranscriptItem;
  }
  return item;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function relativeLabel(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function writeMeta(writer: YpiStudioSubagentTranscriptWriter): void {
  writeFileSync(writer.metaPath, `${JSON.stringify(writer.ref, null, 2)}\n`, "utf8");
}

export function createYpiStudioSubagentTranscript(
  root: string,
  taskId: string,
  options: CreateTranscriptOptions,
): YpiStudioSubagentTranscriptWriter {
  const safeTaskId = safeYpiStudioTranscriptKey(taskId);
  const safeRunId = safeYpiStudioTranscriptKey(options.runId);
  const baseDir = path.join(root, TRANSCRIPTS_DIR);
  ensureDirectoryInsideWorkspace(path.join(root, ".ypi"), root);
  ensureDirectoryInsideWorkspace(path.join(root, ".ypi", ".runtime"), root);
  ensureDirectoryInsideWorkspace(baseDir, root);
  const taskDir = path.join(baseDir, safeTaskId);
  ensureDirectoryInsideWorkspace(taskDir, root);

  const filePath = path.join(taskDir, `${safeRunId}.jsonl`);
  const metaPath = path.join(taskDir, `${safeRunId}.meta.json`);
  const startedAt = options.startedAt;
  const ref: YpiStudioSubagentTranscriptRef = {
    schemaVersion: 1,
    format: "ypi-studio-subagent-transcript",
    runId: options.runId,
    taskId,
    member: options.member,
    pathLabel: relativeLabel(root, filePath),
    status: "running",
    startedAt,
    updatedAt: startedAt,
    itemCount: 0,
    messageCount: 0,
    toolCallCount: 0,
    stderrBytes: 0,
    bytes: 0,
    truncated: false,
  };
  writeFileSync(filePath, "", { encoding: "utf8", flag: "w" });
  const writer = { root, taskId, runId: options.runId, member: options.member, filePath, metaPath, ref };
  writeMeta(writer);
  return writer;
}

export function appendYpiStudioSubagentTranscriptItem(
  writer: YpiStudioSubagentTranscriptWriter,
  item: YpiStudioSubagentTranscriptItem,
): YpiStudioSubagentTranscriptItem {
  if (writer.ref.bytes >= MAX_TRANSCRIPT_BYTES) {
    writer.ref.truncated = true;
    writer.ref.updatedAt = item.at || nowIso();
    writeMeta(writer);
    return { kind: "status", at: item.at || nowIso(), text: "Transcript capture stopped after reaching the 5 MiB safety limit.", truncated: true };
  }
  const normalized = normalizeItem(item);
  const line = `${JSON.stringify(normalized)}\n`;
  const lineBytes = byteLength(line);
  if (writer.ref.bytes + lineBytes > MAX_TRANSCRIPT_BYTES) {
    writer.ref.truncated = true;
    writer.ref.updatedAt = item.at || nowIso();
    const warning: YpiStudioSubagentTranscriptItem = { kind: "status", at: item.at || nowIso(), text: "Transcript capture truncated at the 5 MiB safety limit.", truncated: true };
    const warningLine = `${JSON.stringify(warning)}\n`;
    appendFileSync(writer.filePath, warningLine, "utf8");
    writer.ref.itemCount += 1;
    writer.ref.bytes += byteLength(warningLine);
    writeMeta(writer);
    return warning;
  }
  appendFileSync(writer.filePath, line, "utf8");
  writer.ref.itemCount += 1;
  writer.ref.bytes += lineBytes;
  writer.ref.updatedAt = item.at || nowIso();
  if (normalized.kind === "assistant") writer.ref.messageCount += 1;
  if (normalized.kind === "tool_call") writer.ref.toolCallCount += 1;
  if (normalized.kind === "stderr") writer.ref.stderrBytes += byteLength(normalized.text);
  if ("truncated" in normalized && normalized.truncated) writer.ref.truncated = true;
  writeMeta(writer);
  return normalized;
}

export function finalizeYpiStudioSubagentTranscript(
  writer: YpiStudioSubagentTranscriptWriter,
  status: YpiStudioSubagentTranscriptStatus,
  finishedAt = nowIso(),
): YpiStudioSubagentTranscriptRef {
  writer.ref.status = status;
  writer.ref.finishedAt = finishedAt;
  writer.ref.updatedAt = finishedAt;
  try {
    writer.ref.bytes = statSync(writer.filePath).size;
  } catch {
    // Keep accumulated byte count when stat fails.
  }
  writeMeta(writer);
  return writer.ref;
}

function resolveTranscriptFile(root: string, run: YpiStudioTaskSubagentRun): string {
  if (!run.transcript?.pathLabel) throw new Error("Transcript was not captured for this Studio member run.");
  const target = path.resolve(root, run.transcript.pathLabel);
  const runtimeRoot = path.resolve(root, TRANSCRIPTS_DIR);
  if (!pathIsInside(runtimeRoot, target)) throw new Error("Transcript path is outside the Studio transcript runtime directory.");
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error("Transcript file cannot be a symlink.");
  if (!stat.isFile()) throw new Error("Transcript path is not a file.");
  const real = realpathSync.native(target);
  if (!pathIsInside(runtimeRoot, real)) throw new Error("Transcript file escapes the Studio transcript runtime directory.");
  return target;
}

export function readYpiStudioSubagentTranscriptPreview(
  root: string,
  taskId: string,
  run: YpiStudioTaskSubagentRun,
  options: { limit?: number; maxItemBytes?: number } = {},
): YpiStudioSubagentTranscriptResponse {
  const limit = Math.min(Math.max(1, options.limit ?? 5), 20);
  const response = readYpiStudioSubagentTranscript(root, taskId, run, { limit: MAX_API_LIMIT });
  const maxItemBytes = Math.min(Math.max(64, options.maxItemBytes ?? 300), 2048);
  return {
    ...response,
    items: response.items.slice(-limit).map((item) => normalizeItem(item)).map((item) => {
      if (item.kind === "tool_call") {
        const preview = truncateText(item.inputPreview, maxItemBytes);
        return { ...item, inputPreview: preview.text, truncated: item.truncated || preview.truncated };
      }
      if ("text" in item) {
        const preview = truncateText(item.text, maxItemBytes);
        return { ...item, text: preview.text, truncated: ("truncated" in item ? item.truncated : false) || preview.truncated } as YpiStudioSubagentTranscriptItem;
      }
      return item;
    }),
    nextCursor: undefined,
  };
}

export function readYpiStudioSubagentTranscript(
  root: string,
  _taskId: string,
  run: YpiStudioTaskSubagentRun,
  options: ReadTranscriptOptions = {},
): YpiStudioSubagentTranscriptResponse {
  const transcript = run.transcript;
  if (!transcript) throw new Error("Transcript was not captured for this Studio member run.");
  const filePath = resolveTranscriptFile(root, run);
  const cursor = Math.max(0, options.cursor ?? 0);
  const limit = options.full ? MAX_API_LIMIT : Math.min(Math.max(1, options.limit ?? DEFAULT_API_LIMIT), MAX_API_LIMIT);
  const maxBytes = options.full ? MAX_API_FULL_BYTES : MAX_API_BYTES;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const items: YpiStudioSubagentTranscriptItem[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  let nextCursor: number | undefined;

  for (let i = cursor; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (items.length >= limit || totalBytes >= maxBytes) {
      nextCursor = i;
      warnings.push("Transcript response was truncated by API projection limits.");
      break;
    }
    try {
      const parsed = JSON.parse(line) as YpiStudioSubagentTranscriptItem;
      const normalized = normalizeItem(parsed);
      items.push(normalized);
      totalBytes += byteLength(JSON.stringify(normalized));
    } catch {
      warnings.push(`Skipped malformed transcript row ${i + 1}.`);
    }
  }

  return {
    transcript,
    items,
    nextCursor,
    warnings: warnings.length ? warnings : undefined,
  };
}
