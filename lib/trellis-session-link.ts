import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import path from "path";
import type { SessionEntry } from "./types";
import { listTrellisTasks } from "./trellis-reader";
import type { TrellisSessionTaskLinkResult, TrellisSessionTaskLinkSource, TrellisTaskSummary } from "./trellis-types";

interface Evidence {
  dirName: string;
  archiveMonth?: string;
  kind: "lifecycle" | "path" | "runtime";
  source: TrellisSessionTaskLinkSource;
  order: number;
}

interface ResolveOptions {
  cwd: string;
  sessionId: string;
  sessionFilePath: string;
  entries: SessionEntry[];
}

const TASK_DIR_RE = /(?:^|[\s"'`/])(?:\.\/)?\.trellis\/tasks\/(?:archive\/(\d{4}-\d{2})\/)?([^\s"'`<>|]+?)(?=[\s"'`<>|]|$)/g;
const SHORT_TASK_DIR_RE = /(?:^|[\s"'`])tasks\/(?:archive\/(\d{4}-\d{2})\/)?([^\s"'`<>|]+?)(?=[\s"'`<>|]|$)/g;
const ACTIVE_TASK_RE = /Active task:\s*(?:\.\/)?(?:\.trellis\/)?tasks\/(?:archive\/(\d{4}-\d{2})\/)?([^\s"'`<>|]+)/gi;
const CREATED_TASK_RE = /Created task:\s*([A-Za-z0-9._-]+)/gi;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function sanitizePiSessionId(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "_");
  return safe || hash(value);
}

function exactRuntimeKeys(sessionId: string, sessionFilePath: string): string[] {
  return [
    `pi_${sanitizePiSessionId(sessionId)}`,
    `pi_transcript_${hash(sessionFilePath)}`,
  ];
}

function normalizeDirName(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, "/").replace(/[),.;:]+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  const dirName = parts[0] ?? "";
  return /^[A-Za-z0-9._-]+$/.test(dirName) ? dirName : null;
}

function addEvidence(evidence: Evidence[], rawDirName: string, kind: Evidence["kind"], source: TrellisSessionTaskLinkSource, order: number, archiveMonth?: string): void {
  const dirName = normalizeDirName(rawDirName);
  if (!dirName) return;
  evidence.push({ dirName, archiveMonth, kind, source, order });
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "command", "message", "task", "prompt", "arguments", "input"]) {
      if (key in record) collectStrings(record[key], output, depth + 1);
    }
  }
}

function entryTexts(entry: SessionEntry): string[] {
  const texts: string[] = [];
  if (entry.type === "message") {
    collectStrings((entry as { message?: unknown }).message, texts);
  } else if (entry.type === "custom_message") {
    collectStrings((entry as { content?: unknown; details?: unknown }).content, texts);
    collectStrings((entry as { details?: unknown }).details, texts);
  } else if (entry.type === "custom") {
    collectStrings((entry as { data?: unknown }).data, texts);
  }
  return texts;
}

function collectTranscriptEvidence(entries: SessionEntry[]): Evidence[] {
  const evidence: Evidence[] = [];
  entries.forEach((entry, index) => {
    for (const text of entryTexts(entry)) {
      for (const match of text.matchAll(ACTIVE_TASK_RE)) {
        addEvidence(evidence, match[2] ?? "", "lifecycle", "session-transcript", index, match[1]);
      }
      for (const match of text.matchAll(CREATED_TASK_RE)) {
        addEvidence(evidence, match[1] ?? "", "lifecycle", "session-transcript", index);
      }
      for (const match of text.matchAll(TASK_DIR_RE)) {
        addEvidence(evidence, match[2] ?? "", "path", "session-transcript", index, match[1]);
      }
      for (const match of text.matchAll(SHORT_TASK_DIR_RE)) {
        addEvidence(evidence, match[2] ?? "", "path", "session-transcript", index, match[1]);
      }
    }
  });
  return evidence;
}

function safeReadRuntimeTaskRef(cwd: string, key: string): string | null {
  if (key.startsWith("pi_process_")) return null;
  const filePath = path.join(cwd, ".trellis", ".runtime", "sessions", `${key}.json`);
  try {
    if (!existsSync(filePath)) return null;
    if (lstatSync(filePath).isSymbolicLink()) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const currentTask = (parsed as { current_task?: unknown }).current_task;
    return typeof currentTask === "string" && currentTask.trim() ? currentTask.trim() : null;
  } catch {
    return null;
  }
}

function collectRuntimeEvidence(cwd: string, sessionId: string, sessionFilePath: string): Evidence[] {
  const evidence: Evidence[] = [];
  exactRuntimeKeys(sessionId, sessionFilePath).forEach((key, index) => {
    const ref = safeReadRuntimeTaskRef(cwd, key);
    if (!ref) return;
    const normalized = ref.replace(/\\/g, "/");
    const activeMatch = normalized.match(/(?:^|\/)\.trellis\/tasks\/(?:archive\/(\d{4}-\d{2})\/)?([^/]+)$/)
      ?? normalized.match(/(?:^|\/)tasks\/(?:archive\/(\d{4}-\d{2})\/)?([^/]+)$/);
    if (activeMatch) {
      addEvidence(evidence, activeMatch[2] ?? "", "runtime", "session-runtime", index, activeMatch[1]);
      return;
    }
    addEvidence(evidence, path.basename(normalized), "runtime", "session-runtime", index);
  });
  return evidence;
}

function matchEvidence(evidence: Evidence, tasks: TrellisTaskSummary[]): TrellisTaskSummary | null | "ambiguous" {
  if (evidence.archiveMonth) {
    return tasks.find((task) => task.key === `archive:${evidence.archiveMonth}:${evidence.dirName}`) ?? null;
  }

  const active = tasks.filter((task) => !task.isArchived && task.dirName === evidence.dirName);
  if (active.length === 1) return active[0];
  if (active.length > 1) return "ambiguous";

  const all = tasks.filter((task) => task.dirName === evidence.dirName);
  if (all.length === 1) return all[0];
  if (all.length > 1) return "ambiguous";
  return null;
}

function resolveLatestUnambiguous(evidence: Evidence[], tasks: TrellisTaskSummary[]): { task: TrellisTaskSummary; source: TrellisSessionTaskLinkSource } | TrellisSessionTaskLinkResult {
  const sorted = [...evidence].sort((a, b) => b.order - a.order);
  for (const item of sorted) {
    const matched = matchEvidence(item, tasks);
    if (matched === "ambiguous") return { task: null, reason: "ambiguous" };
    if (matched) return { task: matched, source: item.source };
  }
  return evidence.length > 0 ? { task: null, reason: "task-not-found" } : { task: null, reason: "no-evidence" };
}

function resolveUniqueEvidence(evidence: Evidence[], tasks: TrellisTaskSummary[]): { task: TrellisTaskSummary; source: TrellisSessionTaskLinkSource } | TrellisSessionTaskLinkResult {
  const matches: { task: TrellisTaskSummary; source: TrellisSessionTaskLinkSource; order: number }[] = [];
  for (const item of evidence) {
    const matched = matchEvidence(item, tasks);
    if (matched === "ambiguous") return { task: null, reason: "ambiguous" };
    if (matched) matches.push({ task: matched, source: item.source, order: item.order });
  }
  if (matches.length === 0) {
    return evidence.length > 0 ? { task: null, reason: "task-not-found" } : { task: null, reason: "no-evidence" };
  }

  const keys = new Set(matches.map((match) => match.task.key));
  if (keys.size > 1) return { task: null, reason: "ambiguous" };

  const latest = matches.sort((a, b) => b.order - a.order)[0];
  return { task: latest.task, source: latest.source };
}

function sameTask(a: TrellisTaskSummary, b: TrellisTaskSummary): boolean {
  return a.key === b.key;
}

function promoteToAvailableParent(task: TrellisTaskSummary, tasks: TrellisTaskSummary[]): TrellisTaskSummary {
  const byDir = new Map(tasks.map((item) => [item.dirName, item]));
  const seen = new Set<string>([task.dirName]);
  let current = task;

  while (current.parent) {
    const parent = byDir.get(current.parent);
    if (!parent || seen.has(parent.dirName)) return current;
    seen.add(parent.dirName);
    current = parent;
  }

  return current;
}

function promoteResolved<T extends { task: TrellisTaskSummary; source: TrellisSessionTaskLinkSource }>(resolved: T, tasks: TrellisTaskSummary[]): T {
  return { ...resolved, task: promoteToAvailableParent(resolved.task, tasks) };
}

export function resolveTrellisTaskForSession(options: ResolveOptions): TrellisSessionTaskLinkResult {
  const tasksResponse = listTrellisTasks(options.cwd, true);
  if (!tasksResponse.exists) return { task: null, reason: "no-evidence" };

  const transcriptEvidence = collectTranscriptEvidence(options.entries);
  const runtimeEvidence = collectRuntimeEvidence(options.cwd, options.sessionId, options.sessionFilePath);
  const lifecycleEvidence = transcriptEvidence.filter((item) => item.kind === "lifecycle");
  const pathEvidence = transcriptEvidence.filter((item) => item.kind === "path");

  const runtimeResolved = runtimeEvidence.length > 0
    ? resolveUniqueEvidence(runtimeEvidence, tasksResponse.tasks)
    : null;

  const transcriptResolved = lifecycleEvidence.length > 0
    ? resolveLatestUnambiguous(lifecycleEvidence, tasksResponse.tasks)
    : pathEvidence.length > 0
      ? resolveUniqueEvidence(pathEvidence, tasksResponse.tasks)
      : null;

  const promotedTranscript = transcriptResolved?.task
    ? promoteResolved(transcriptResolved, tasksResponse.tasks)
    : transcriptResolved;
  const promotedRuntime = runtimeResolved?.task
    ? promoteResolved(runtimeResolved, tasksResponse.tasks)
    : runtimeResolved;

  if (promotedTranscript?.task && promotedRuntime?.task && !sameTask(promotedTranscript.task, promotedRuntime.task)) {
    return { task: null, reason: "ambiguous" };
  }

  const resolved = promotedTranscript?.task ? promotedTranscript : promotedRuntime;
  if (resolved?.task) {
    return { task: resolved.task, source: resolved.source, confidence: "high" };
  }

  if (transcriptResolved?.task === null && transcriptResolved.reason === "ambiguous") return transcriptResolved;
  if (runtimeResolved?.task === null && runtimeResolved.reason === "ambiguous") return runtimeResolved;
  if (transcriptResolved?.task === null && transcriptResolved.reason === "task-not-found") return transcriptResolved;
  if (runtimeResolved?.task === null && runtimeResolved.reason === "task-not-found") return runtimeResolved;
  return { task: null, reason: "no-evidence" };
}
