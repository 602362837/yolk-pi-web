import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { ResolvedYpiStudioMemberPolicy } from "./ypi-studio-policy";
import { readSessionHeaderFromFile } from "./session-project-link";
import { createYpiStudioChildGuardExtension } from "./ypi-studio-child-guard";
import {
  appendYpiStudioSubagentTranscriptItem,
  finalizeYpiStudioSubagentTranscript,
  previewYpiStudioTranscriptText,
  type YpiStudioSubagentTranscriptWriter,
} from "./ypi-studio-transcripts";
import { registerYpiStudioChildRun, scheduleYpiStudioChildRunContinuation, unregisterYpiStudioChildRun, updateYpiStudioChildRun } from "./ypi-studio-subagent-runtime";
import type { SessionHeader, StudioChildSessionInfo } from "./types";
import type {
  YpiStudioSubagentCurrentTool,
  YpiStudioSubagentRunProgress,
  YpiStudioSubagentRunPhase,
  YpiStudioSubagentTranscriptItem,
  YpiStudioSubagentTranscriptStatus,
  YpiStudioTaskSubagentRun,
} from "./ypi-studio-types";

type JsonObject = Record<string, unknown>;
type ToolUpdateCallback = (result: { content: { type: "text"; text: string }[]; details: unknown; isError?: boolean }) => void;

export interface StudioSdkChildRunMeta {
  runId: string;
  taskId: string;
  member: string;
  startedAt: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  subtaskId?: string;
  continuationOnFinal?: boolean;
}

export interface StudioSdkChildRunResult {
  output: string;
  status: YpiStudioTaskSubagentRun["status"];
  transcript?: YpiStudioTaskSubagentRun["transcript"];
  warnings: string[];
  progress: YpiStudioSubagentRunProgress;
  terminationReason?: string;
  runner: "sdk";
  childSessionId?: string;
  childSessionFile?: string;
  requestAffinity?: YpiStudioTaskSubagentRun["requestAffinity"];
}

export interface StudioSdkChildRunCallbacks {
  onProgress?: (run: YpiStudioTaskSubagentRun) => void;
  onFinal?: (run: YpiStudioTaskSubagentRun, result: StudioSdkChildRunResult) => void;
}

export interface StudioSdkChildRunOptions {
  root: string;
  prompt: string;
  policy: ResolvedYpiStudioMemberPolicy;
  meta: StudioSdkChildRunMeta;
  writer: YpiStudioSubagentTranscriptWriter | null;
  signal?: AbortSignal;
  onUpdate?: ToolUpdateCallback;
  persistence?: StudioSdkChildRunCallbacks;
}

const CHILD_RECENT_PROGRESS_LIMIT = 5;
const MAX_CHILD_LIVE_PREVIEW_BYTES = 16 * 1024;
const MAX_CHILD_FINAL_OUTPUT_BYTES = 128 * 1024;
const EXCLUDED_CHILD_TOOLS = [
  "ypi_studio_task",
  "ypi_studio_subagent",
  "ypi_studio_wait",
  "browser_share_click",
  "browser_share_type",
  "browser_share_scroll",
  "browser_share_navigate",
  "trellis_subagent",
  "subagent",
];

function isObj(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateBytes(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (byteLength(value) <= maxBytes) return { text: value, truncated: false };
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1;
  return { text: `${value.slice(0, Math.max(0, end - 1))}…`, truncated: true };
}

function oneLine(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function boundedAppendTail(previous: string, addition: string, maxBytes: number): string {
  const combined = `${previous}${addition}`;
  if (byteLength(combined) <= maxBytes) return combined;
  let start = Math.max(0, combined.length - maxBytes);
  while (start < combined.length && byteLength(combined.slice(start)) > maxBytes) start += 1;
  return combined.slice(start);
}

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(resultText).filter(Boolean).join("\n");
  if (isObj(value)) {
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.content)) return value.content.map(resultText).filter(Boolean).join("\n");
    if (typeof value.message === "string") return value.message;
  }
  return value == null ? "" : safeJson(value);
}

function eventMessageText(event: unknown): string {
  if (!isObj(event)) return "";
  const message = isObj(event.message) ? event.message : event;
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content.map((part) => isObj(part) && part.type === "text" && typeof part.text === "string" ? part.text : "").join("");
  return "";
}

function eventAssistantDeltaText(event: unknown): string {
  if (!isObj(event)) return "";
  const delta = event.delta;
  if (typeof delta === "string") return delta;
  if (isObj(delta) && typeof delta.text === "string") return delta.text;
  if (typeof event.text === "string") return event.text;
  return "";
}

function usageOutputTokens(event: unknown): number | undefined {
  if (!isObj(event)) return undefined;
  const usage = isObj(event.usage) ? event.usage : isObj(event.message) && isObj(event.message.usage) ? event.message.usage : undefined;
  const value = usage ? usage.outputTokens ?? usage.output_tokens ?? usage.output ?? usage.completion_tokens : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function writeSessionHeader(filePath: string, patch: Partial<SessionHeader>): SessionHeader | null {
  const content = readFileSync(filePath, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
  const rest = newlineIndex >= 0 ? content.slice(newlineIndex) : "\n";
  const header = JSON.parse(firstLine) as SessionHeader;
  if (header.type !== "session") return null;
  const next = { ...header, ...patch } as SessionHeader;
  writeFileSync(filePath, `${JSON.stringify(next)}${rest}`, "utf8");
  return next;
}

function updateStudioChildHeader(filePath: string | undefined, patch: Partial<StudioChildSessionInfo>): void {
  if (!filePath) return;
  try {
    const header = readSessionHeaderFromFile(filePath);
    if (!header?.studioChild) return;
    writeSessionHeader(filePath, { studioChild: { ...header.studioChild, ...patch } });
  } catch {
    // Header updates are audit-only; task.json remains the status source of truth.
  }
}

function modelFromPolicyArg(policy: ResolvedYpiStudioMemberPolicy, modelRegistry: { find?: (provider: string, modelId: string) => unknown }, warnings: string[]): unknown {
  const arg = policy.modelArg;
  if (!arg) return undefined;
  const slash = arg.indexOf("/");
  if (slash <= 0 || slash === arg.length - 1) return undefined;
  const provider = arg.slice(0, slash);
  const modelId = arg.slice(slash + 1);
  const model = modelRegistry.find?.(provider, modelId);
  if (!model) warnings.push(`Configured Studio child model ${arg} was not found; using Pi default model.`);
  return model;
}

export async function runYpiStudioSdkChildSession(options: StudioSdkChildRunOptions): Promise<StudioSdkChildRunResult> {
  const { root, prompt, policy, meta, writer, signal, onUpdate, persistence } = options;
  const warnings: string[] = [];
  const recentItems: YpiStudioSubagentTranscriptItem[] = [];
  let eventCount = 0;
  let phase: YpiStudioSubagentRunPhase = "starting";
  let outputChars = 0;
  let tokens: number | undefined;
  let tokenSource: YpiStudioSubagentRunProgress["tokenSource"] | undefined;
  let firstTokenAt: string | undefined;
  let lastTokenAt: string | undefined;
  let currentTool: YpiStudioSubagentCurrentTool | undefined;
  let lastMessageTextTail = "";
  let lastTextPreview = "SDK child session starting.";
  let finalAssistantOutput = "";
  let previewTruncated = false;
  let finalOutputTruncated = false;
  let status: YpiStudioTaskSubagentRun["status"] = "running";
  let terminationReason: string | undefined;
  let childSessionId: string | undefined;
  let childSessionFile: string | undefined;
  let session: { prompt: (text: string, options?: unknown) => Promise<void>; abort: () => Promise<void>; dispose: () => void; subscribe?: (listener: (event: unknown) => void) => () => void; sessionId?: string; sessionFile?: string; messages?: unknown[] } | undefined;
  let unsubscribe: (() => void) | undefined;
  let promptStarted = false;
  let settled = false;

  const addWarning = (warning: string): void => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  const boundedText = (value: string, maxBytes = MAX_CHILD_LIVE_PREVIEW_BYTES): string => truncateBytes(value, maxBytes).text;
  const transcriptStatus = (runStatus: YpiStudioTaskSubagentRun["status"]): YpiStudioSubagentTranscriptStatus => runStatus === "queued" ? "running" : runStatus;
  const requestAffinity = (): YpiStudioTaskSubagentRun["requestAffinity"] | undefined => childSessionId ? {
    schemaVersion: 1,
    providerSessionIdSource: "childSessionId",
    parentSessionId: meta.parentSessionId,
    childSessionId,
    model: policy.modelLabel,
    modelSource: policy.modelSource,
    thinking: policy.thinkingLabel,
    thinkingSource: policy.thinkingSource,
    note: "Studio SDK child runs use the same Pi SDK/provider/auth/model-registry path as the parent chat, but provider request affinity is keyed by the independent child session id rather than reusing the parent session id.",
  } : undefined;

  const appendItem = (item: YpiStudioSubagentTranscriptItem): void => {
    let stored = item;
    if (writer) {
      try { stored = appendYpiStudioSubagentTranscriptItem(writer, item); }
      catch (error) { addWarning(`Transcript write failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    recentItems.push(stored);
    while (recentItems.length > CHILD_RECENT_PROGRESS_LIMIT) recentItems.shift();
  };

  const safeRecentItems = (): YpiStudioSubagentTranscriptItem[] => recentItems.slice(-CHILD_RECENT_PROGRESS_LIMIT).map((item) => {
    if (item.kind === "tool_call") {
      const preview = truncateBytes(item.inputPreview, MAX_CHILD_LIVE_PREVIEW_BYTES);
      if (preview.truncated) previewTruncated = true;
      return { ...item, inputPreview: preview.text, truncated: item.truncated || preview.truncated };
    }
    if ("text" in item) {
      const preview = truncateBytes(item.text, MAX_CHILD_LIVE_PREVIEW_BYTES);
      if (preview.truncated) previewTruncated = true;
      return { ...item, text: preview.text, truncated: ("truncated" in item ? item.truncated : false) || preview.truncated } as YpiStudioSubagentTranscriptItem;
    }
    return item;
  });

  const progressSnapshot = (): YpiStudioSubagentRunProgress => {
    const updatedAt = new Date().toISOString();
    const elapsedSeconds = firstTokenAt && lastTokenAt ? Math.max(0.001, (Date.parse(lastTokenAt) - Date.parse(firstTokenAt)) / 1000) : undefined;
    return {
      schemaVersion: 1,
      phase,
      startedAt: meta.startedAt,
      updatedAt,
      eventCount,
      lastTextPreview: boundedText(lastTextPreview),
      itemsPreview: safeRecentItems(),
      warnings: warnings.length ? warnings.slice(-8) : undefined,
      outputChars,
      tokens,
      tokenSource,
      tps: tokens !== undefined && elapsedSeconds ? Number((tokens / elapsedSeconds).toFixed(2)) : undefined,
      firstTokenAt,
      lastTokenAt,
      currentTool,
      display: {
        recentLimit: CHILD_RECENT_PROGRESS_LIMIT,
        previewTruncated,
        finalOutputTruncated,
        transcriptItemTruncated: writer?.ref.truncation?.itemTruncated === true,
        transcriptCaptureLimited: writer?.ref.truncation?.captureLimited === true,
      },
      terminationReason,
    };
  };

  const runSnapshot = (runStatus: YpiStudioTaskSubagentRun["status"], summary?: string): YpiStudioTaskSubagentRun => ({
    id: meta.runId,
    member: meta.member,
    subtaskId: meta.subtaskId,
    status: runStatus,
    startedAt: meta.startedAt,
    runner: "sdk",
    childSessionId,
    childSessionFile,
    requestAffinity: requestAffinity(),
    prompt: undefined,
    summary: summary ?? oneLine(lastTextPreview, 1000),
    model: policy.modelLabel,
    thinking: policy.thinkingLabel,
    modelSource: policy.modelSource,
    thinkingSource: policy.thinkingSource,
    policy: policy.diagnostics,
    progress: progressSnapshot(),
    terminationReason,
    error: runStatus === "failed" || runStatus === "cancelled" ? oneLine(summary ?? lastTextPreview, 1000) : undefined,
    transcript: writer ? { ...writer.ref, runner: "sdk" as const, childSessionId, childSessionFile, status: transcriptStatus(runStatus) } : undefined,
  });

  const emitProgress = (force = false): void => {
    void force;
    const progress = progressSnapshot();
    updateYpiStudioChildRun(meta.runId, { status, progress, childSessionId, childSessionFile });
    const run = runSnapshot(status);
    try { persistence?.onProgress?.(run); } catch (error) { addWarning(`Progress persistence failed: ${error instanceof Error ? error.message : String(error)}`); }
    try {
      onUpdate?.({
        content: [{ type: "text", text: `${meta.member} ${status} · sdk child · model: ${policy.modelLabel} · thinking: ${policy.thinkingLabel} · ${eventCount} events · ${oneLine(progress.lastTextPreview, 140)}` }],
        details: { run: { id: meta.runId, member: meta.member, status, taskId: meta.taskId, runner: "sdk", childSessionId, childSessionFile, requestAffinity: requestAffinity(), model: policy.modelLabel, thinking: policy.thinkingLabel, modelSource: policy.modelSource, thinkingSource: policy.thinkingSource, policy: policy.diagnostics, transcript: writer ? { ...writer.ref } : undefined, progress, terminationReason } },
      });
    } catch (error) { addWarning(`Progress update failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const noteOutput = (text: string, at: string): void => {
    if (!text) return;
    outputChars += text.length;
    tokens = Math.max(tokens ?? 0, Math.ceil(outputChars / 4));
    tokenSource = tokenSource === "usage" ? "usage" : "estimated_chars";
    firstTokenAt ??= at;
    lastTokenAt = at;
  };
  const rememberAssistantOutput = (text: string): string => {
    const truncated = truncateBytes(text, MAX_CHILD_FINAL_OUTPUT_BYTES);
    if (truncated.truncated) {
      finalOutputTruncated = true;
      addWarning(`Display note: final assistant output was clipped to ${MAX_CHILD_FINAL_OUTPUT_BYTES} bytes for the parent result; the member run status is unchanged.`);
    }
    finalAssistantOutput = truncated.text;
    return truncated.text;
  };

  const handleEvent = (event: unknown, at = new Date().toISOString()): void => {
    eventCount += 1;
    const eventType = isObj(event) && typeof event.type === "string" ? event.type : "json";
    if (eventType === "agent_start") {
      phase = "waiting_model";
      lastTextPreview = "SDK child agent started.";
      appendItem({ kind: "status", at, text: "SDK child Pi agent started." });
    } else if (eventType === "agent_end") {
      phase = "finished";
      lastTextPreview = "SDK child agent finished.";
      appendItem({ kind: "status", at, text: "SDK child Pi agent finished." });
    } else if (eventType === "message_update") {
      phase = "streaming";
      const delta = eventAssistantDeltaText(event);
      const text = delta || eventMessageText(event);
      if (text) {
        const addition = delta || (text.startsWith(lastMessageTextTail) ? text.slice(lastMessageTextTail.length) : text);
        lastMessageTextTail = boundedAppendTail("", text, MAX_CHILD_FINAL_OUTPUT_BYTES);
        noteOutput(addition, at);
        lastTextPreview = boundedText(addition || text);
      }
    } else if (eventType === "message_end") {
      const text = eventMessageText(event).trim();
      const role = isObj(event) && isObj(event.message) && typeof event.message.role === "string" ? event.message.role : undefined;
      if ((!role || role === "assistant") && text) {
        phase = "waiting_model";
        const output = rememberAssistantOutput(text);
        lastTextPreview = output;
        outputChars = Math.max(outputChars, text.length);
        const usageTokens = usageOutputTokens(event);
        if (usageTokens !== undefined) { tokens = usageTokens; tokenSource = "usage"; }
        else { tokens = Math.max(tokens ?? 0, Math.ceil(outputChars / 4)); tokenSource = tokenSource ?? "estimated_chars"; }
        appendItem({ kind: "assistant", at, text: output, model: policy.modelLabel, truncated: output.length < text.length });
      }
    } else if (eventType === "tool_execution_start") {
      const ev = isObj(event) ? event : {};
      const toolCallId = str(ev.toolCallId) ?? `tool-${eventCount}`;
      const toolName = str(ev.toolName) ?? "tool";
      const preview = previewYpiStudioTranscriptText(ev.args ?? ev.input).text;
      phase = "running_tool";
      currentTool = { toolCallId, toolName, startedAt: at };
      lastTextPreview = `Running tool ${toolName}`;
      appendItem({ kind: "tool_call", at, toolCallId, toolName, inputPreview: preview });
    } else if (eventType === "tool_execution_update") {
      phase = "running_tool";
      const text = resultText(isObj(event) ? event.partialResult : undefined).trim();
      if (text) lastTextPreview = boundedText(text);
    } else if (eventType === "tool_execution_end" || eventType === "tool_result_end") {
      const ev = isObj(event) ? event : {};
      const toolCallId = str(ev.toolCallId) ?? `tool-${eventCount}`;
      const toolName = str(ev.toolName);
      const rawText = resultText(ev.result).trim() || resultText(ev.message).trim() || "(no output)";
      const text = boundedText(rawText, MAX_CHILD_FINAL_OUTPUT_BYTES);
      const isError = ev.isError === true;
      phase = "waiting_model";
      currentTool = undefined;
      lastTextPreview = `${toolName ?? "Tool"} ${isError ? "failed" : "completed"}`;
      appendItem({ kind: "tool_result", at, toolCallId, toolName, text, isError, truncated: text.length < rawText.length });
    } else if (eventType === "extension_error") {
      const message = isObj(event) && typeof event.error === "string" ? event.error : safeJson(event);
      lastTextPreview = boundedText(message);
      appendItem({ kind: "error", at, text: boundedText(message, MAX_CHILD_FINAL_OUTPUT_BYTES) });
    } else {
      lastTextPreview = `Received ${eventType}.`;
    }
    emitProgress();
  };

  const finish = (nextStatus: YpiStudioTaskSubagentRun["status"], outputText?: string): StudioSdkChildRunResult => {
    if (settled) nextStatus = status;
    settled = true;
    status = nextStatus;
    phase = status === "waiting_for_user" ? "waiting_for_user" : "finished";
    currentTool = undefined;
    const output = (outputText ?? finalAssistantOutput).trim() || (status === "cancelled" ? "cancelled" : "SDK child run finished without a captured final assistant message.");
    if (output && !finalAssistantOutput.trim()) appendItem({ kind: status === "failed" ? "error" : "assistant", at: new Date().toISOString(), text: output });
    let transcript = writer ? { ...writer.ref, runner: "sdk" as const, childSessionId, childSessionFile, status: transcriptStatus(status) } : undefined;
    if (writer) {
      try { transcript = { ...finalizeYpiStudioSubagentTranscript(writer, transcriptStatus(status)), runner: "sdk" as const, childSessionId, childSessionFile }; }
      catch (error) { addWarning(`Transcript finalize failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    lastTextPreview = output;
    if (output && outputChars === 0) { outputChars = output.length; tokens = Math.ceil(outputChars / 4); tokenSource = "estimated_chars"; }
    updateStudioChildHeader(childSessionFile, { status, finishedAt: new Date().toISOString(), terminationReason });
    const result: StudioSdkChildRunResult = { output, status, transcript, warnings, progress: progressSnapshot(), terminationReason, runner: "sdk", childSessionId, childSessionFile, requestAffinity: requestAffinity() };
    const finalRun = runSnapshot(status, output);
    finalRun.finishedAt = new Date().toISOString();
    finalRun.progress = result.progress;
    finalRun.transcript = transcript;
    updateYpiStudioChildRun(meta.runId, { status, progress: result.progress, result, childSessionId, childSessionFile });
    try { persistence?.onFinal?.(finalRun, result); } catch (error) { addWarning(`Final run persistence failed: ${error instanceof Error ? error.message : String(error)}`); }
    if (meta.continuationOnFinal && meta.parentSessionId) {
      scheduleYpiStudioChildRunContinuation({ runId: meta.runId, taskId: meta.taskId, subtaskId: meta.subtaskId, member: meta.member, cwd: root, parentSessionId: meta.parentSessionId, status, summary: finalRun.summary, finishedAt: finalRun.finishedAt });
    }
    unregisterYpiStudioChildRun(meta.runId);
    try { unsubscribe?.(); } catch {}
    try { session?.dispose(); } catch {}
    return result;
  };

  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    const agentDir = pi.getAgentDir();
    const sessionManager = pi.SessionManager.create(root, undefined, meta.parentSessionFile ? { parentSession: meta.parentSessionFile } : undefined);
    childSessionId = sessionManager.getSessionId();
    childSessionFile = sessionManager.getSessionFile() ?? undefined;
    const parentHeader = meta.parentSessionFile ? readSessionHeaderFromFile(meta.parentSessionFile) : null;
    const studioChild: StudioChildSessionInfo = {
      schemaVersion: 1,
      kind: "ypi-studio-child-session",
      runner: "sdk",
      visibility: "child",
      status: "running",
      parentSessionId: meta.parentSessionId,
      parentSessionFile: meta.parentSessionFile,
      contextId: meta.parentSessionId ? `pi_${meta.parentSessionId}` : undefined,
      taskId: meta.taskId,
      runId: meta.runId,
      member: meta.member,
      subtaskId: meta.subtaskId,
      createdAt: meta.startedAt,
    };
    if (childSessionFile) {
      writeSessionHeader(childSessionFile, { projectId: parentHeader?.projectId, spaceId: parentHeader?.spaceId, studioChild });
    }
    try { sessionManager.appendSessionInfo(`YPI Studio ${meta.member} · ${basename(meta.taskId)} · ${meta.runId.slice(0, 8)}`); } catch {}
    if (writer) {
      writer.ref.runner = "sdk";
      writer.ref.childSessionId = childSessionId;
      writer.ref.childSessionFile = childSessionFile;
    }

    const services = await pi.createAgentSessionServices({
      cwd: root,
      agentDir,
      resourceLoaderOptions: {
        extensionFactories: [createYpiStudioChildGuardExtension({ workspaceRoot: root, blockTaskJsonWrites: true })],
      },
    });
    for (const diagnostic of services.diagnostics ?? []) {
      if (diagnostic.type === "warning" || diagnostic.type === "error") addWarning(diagnostic.message);
    }
    const model = modelFromPolicyArg(policy, services.modelRegistry, warnings);
    const result = await pi.createAgentSessionFromServices({
      services,
      sessionManager,
      model: model as never,
      thinkingLevel: policy.thinkingArg as never,
      excludeTools: EXCLUDED_CHILD_TOOLS,
    });
    session = result.session as typeof session;
    if (result.modelFallbackMessage) addWarning(result.modelFallbackMessage);
    unsubscribe = session?.subscribe?.((event: unknown) => handleEvent(event));
    registerYpiStudioChildRun({
      runId: meta.runId,
      taskId: meta.taskId,
      subtaskId: meta.subtaskId,
      member: meta.member,
      cwd: root,
      parentSessionId: meta.parentSessionId,
      runner: "sdk",
      childSessionId,
      childSessionFile,
      startedAt: meta.startedAt,
      status: "running",
      abort: (reason) => {
        terminationReason = reason;
        status = "cancelled";
        void session?.abort();
      },
      onAbortPersist: (reason) => {
        terminationReason = reason;
        const cancelledRun = runSnapshot("cancelled", `SDK child run cancelled: ${reason}`);
        cancelledRun.finishedAt = new Date().toISOString();
        cancelledRun.terminationReason = reason;
        try { persistence?.onFinal?.(cancelledRun, { output: cancelledRun.summary ?? "cancelled", status: "cancelled", transcript: cancelledRun.transcript, warnings, progress: cancelledRun.progress!, terminationReason: reason, runner: "sdk", childSessionId, childSessionFile, requestAffinity: requestAffinity() }); } catch {}
      },
    });
    appendItem({ kind: "status", at: meta.startedAt, text: `SDK child session created: ${childSessionId}` });
    emitProgress(true);

    const abort = () => { terminationReason = "abort_signal"; status = "cancelled"; void session?.abort(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      promptStarted = true;
      await session!.prompt(prompt, { source: "rpc" });
      signal?.removeEventListener("abort", abort);
      if ((status as YpiStudioTaskSubagentRun["status"]) === "cancelled") return finish("cancelled", "SDK child run cancelled by parent session.");
      return finish("succeeded");
    } catch (error) {
      signal?.removeEventListener("abort", abort);
      const message = error instanceof Error ? error.message : String(error);
      if ((status as YpiStudioTaskSubagentRun["status"]) === "cancelled" || signal?.aborted) {
        terminationReason ??= "abort_signal";
        return finish("cancelled", "SDK child run cancelled by parent session.");
      }
      terminationReason = promptStarted ? "sdk_prompt_error" : "sdk_preflight_error";
      appendItem({ kind: "error", at: new Date().toISOString(), text: message });
      return finish("failed", message);
    }
  } catch (error) {
    try { unsubscribe?.(); } catch {}
    try { session?.dispose(); } catch {}
    unregisterYpiStudioChildRun(meta.runId);
    const message = error instanceof Error ? error.message : String(error);
    const preflight = new Error(`SDK child runner preflight failed before prompt execution: ${message}`);
    (preflight as Error & { preflight: true }).preflight = true;
    throw preflight;
  }
}
