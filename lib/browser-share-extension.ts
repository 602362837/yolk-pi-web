import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBrowserShareManager } from "./browser-share-manager";
import type { BrowserShareCommand, BrowserShareCommandStatus, BrowserShareCommandType, BrowserSharePageSnapshot } from "./browser-share-types";

type PiToolResult = AgentToolResult<unknown>;
type ToolUpdateCallback = (result: PiToolResult) => void;

const COMMAND_WAIT_TIMEOUT_MS = 90_000;
const DEFAULT_SCROLL_DELTA_Y = 600;

function sessionIdFromContext(ctx?: ExtensionContext): string {
  const sessionId = ctx?.sessionManager?.getSessionId?.();
  if (!sessionId) throw new Error("Browser Share tools require a ypi web session context");
  return sessionId;
}

function textResult(details: unknown): PiToolResult {
  return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isToolUpdateCallback(value: unknown): value is ToolUpdateCallback {
  return typeof value === "function";
}

function commandStatusMessage(status: BrowserShareCommandStatus): string {
  if (status === "pending_approval") return "Browser Share command is waiting for one-time user approval.";
  if (status === "queued") return "Browser Share command is queued for the Chrome extension.";
  if (status === "running") return "Browser Share command is running in the shared Chrome tab.";
  if (status === "succeeded") return "Browser Share command succeeded.";
  if (status === "failed") return "Browser Share command failed.";
  if (status === "rejected") return "Browser Share command was rejected by the user.";
  return "Browser Share command timed out before completion.";
}

function emitCommandUpdate(onUpdate: unknown, command: BrowserShareCommand): void {
  if (!isToolUpdateCallback(onUpdate)) return;
  onUpdate(textResult({
    phase: "browser_share_command",
    commandId: command.commandId,
    type: command.type,
    status: command.status,
    message: command.result?.message ?? commandStatusMessage(command.status),
  }));
}

function preview(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function summarizeSnapshot(snapshot?: BrowserSharePageSnapshot): unknown {
  if (!snapshot) return undefined;
  return {
    capturedAt: snapshot.capturedAt,
    url: snapshot.tab.url,
    title: snapshot.tab.title,
    visibleTextPreview: preview(snapshot.visibleText, 800),
    selectionPreview: preview(snapshot.selection, 300),
    focusedElementId: snapshot.focusedElementId,
    captureMode: snapshot.captureMode,
    viewport: snapshot.viewport,
    debugger: snapshot.debugger,
    screenshot: snapshot.screenshot ? {
      mimeType: snapshot.screenshot.mimeType,
      byteLength: snapshot.screenshot.byteLength,
      capturedAt: snapshot.screenshot.capturedAt,
      truncated: snapshot.screenshot.truncated,
      available: Boolean(snapshot.screenshot.data),
      error: snapshot.screenshot.error,
    } : undefined,
    elementCount: snapshot.elements.length,
    elements: snapshot.elements.slice(0, 8).map((element) => ({
      elementId: element.elementId,
      tagName: element.tagName,
      role: element.role,
      axRole: element.axRole,
      axName: preview(element.axName, 160),
      label: preview(element.label, 160),
      text: preview(element.text, 160),
      inputType: element.inputType,
      bounds: element.bounds,
      selector: preview(element.selector, 200),
      frameId: element.frameId,
      isSensitive: element.isSensitive === true || undefined,
    })),
    warnings: snapshot.warnings?.slice(0, 5),
  };
}

function compactCommandResult(command: BrowserShareCommand): unknown {
  const state = getBrowserShareManager().getSessionState(command.sessionId);
  const snapshot = command.result?.snapshot ?? state.snapshot;
  return {
    commandId: command.commandId,
    type: command.type,
    status: command.status,
    message: command.result?.message ?? commandStatusMessage(command.status),
    error: command.result?.ok === false ? command.result.message ?? commandStatusMessage(command.status) : undefined,
    tab: snapshot?.tab ?? state.tab,
    lastSnapshotAt: state.lastSnapshotAt ?? snapshot?.capturedAt,
    captureMode: command.result?.captureMode ?? snapshot?.captureMode ?? state.captureMode,
    debugger: command.result?.debugger ?? snapshot?.debugger ?? state.debugger,
    screenshot: command.result?.screenshot ?? snapshot?.screenshot ?? state.screenshot,
    source: state.source,
    snapshot: summarizeSnapshot(snapshot),
  };
}

function validateNavigateUrl(value: unknown): string {
  const url = str(value);
  if (!url) throw new Error("browser_share_navigate requires a non-empty http(s) url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("browser_share_navigate requires a valid http(s) url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("browser_share_navigate only allows http:// or https:// URLs");
  }
  return parsed.toString();
}

function buildCommandPayload(type: BrowserShareCommandType, input: Record<string, unknown>): Partial<BrowserShareCommand> {
  const reason = str(input.reason);
  if (type === "click") {
    const elementId = str(input.elementId);
    if (!elementId) throw new Error("browser_share_click requires elementId from the latest Browser Share snapshot");
    return { elementId, reason };
  }
  if (type === "type") {
    const elementId = str(input.elementId);
    const text = textInput(input.text);
    if (!elementId) throw new Error("browser_share_type requires elementId from the latest Browser Share snapshot");
    if (!text) throw new Error("browser_share_type requires non-empty text");
    return { elementId, text, reason };
  }
  if (type === "scroll") {
    const deltaX = num(input.deltaX);
    const deltaY = num(input.deltaY) ?? DEFAULT_SCROLL_DELTA_Y;
    if (input.deltaX !== undefined && deltaX === undefined) throw new Error("browser_share_scroll deltaX must be a finite number");
    if (input.deltaY !== undefined && num(input.deltaY) === undefined) throw new Error("browser_share_scroll deltaY must be a finite number");
    return { deltaX, deltaY, reason };
  }
  return { url: validateNavigateUrl(input.url), reason };
}

function commandParameters(type: BrowserShareCommandType): Record<string, unknown> {
  const reason = { type: "string", description: "Short reason shown to the user for risky actions." };
  if (type === "click") {
    return {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id from browser_share_snapshot." },
        reason,
      },
      required: ["elementId"],
    };
  }
  if (type === "type") {
    return {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Input element id from browser_share_snapshot." },
        text: { type: "string", description: "Text to type into the element." },
        reason,
      },
      required: ["elementId", "text"],
    };
  }
  if (type === "scroll") {
    return {
      type: "object",
      properties: {
        deltaX: { type: "number", description: "Horizontal scroll delta in pixels." },
        deltaY: { type: "number", description: `Vertical scroll delta in pixels. Defaults to ${DEFAULT_SCROLL_DELTA_Y}.` },
        reason,
      },
    };
  }
  return {
    type: "object",
    properties: {
      url: { type: "string", description: "Destination http:// or https:// URL." },
      reason,
    },
    required: ["url"],
  };
}

function registerCommandTool(pi: Pick<ExtensionAPI, "registerTool">, name: string, type: BrowserShareCommandType, description: string) {
  pi.registerTool?.({
    name,
    label: name,
    description,
    promptSnippet: `${name}: operate on the Browser Share tab for the current ypi session only and wait for the terminal result.`,
    promptGuidelines: [
      "Use Browser Share command tools only after checking browser_share_status/snapshot.",
      "These tools never accept shareId; the current ypi session binding is used to prevent cross-session access.",
      "Readonly mode requires approval for all actions; interactive mode still requires approval for type and navigate.",
      "Action results are compact. Use browser_share_snapshot when you need the full latest sanitized page snapshot.",
    ],
    parameters: commandParameters(type),
    execute: async (_id: string, inputValue: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: ExtensionContext): Promise<PiToolResult> => {
      const input = isRecord(inputValue) ? inputValue : {};
      const sessionId = sessionIdFromContext(ctx);
      const manager = getBrowserShareManager();
      const state = manager.getSessionState(sessionId);
      if (!state.bound) throw new Error("No Browser Share is bound to this session. Bind Browser Share before using action tools.");

      const command = manager.enqueueCommand(sessionId, type, buildCommandPayload(type, input));
      emitCommandUpdate(onUpdate, command);

      const terminalCommand = await manager.waitForCommand(command.commandId, {
        timeoutMs: COMMAND_WAIT_TIMEOUT_MS,
        signal,
        onChange: (updatedCommand) => emitCommandUpdate(onUpdate, updatedCommand),
      });
      emitCommandUpdate(onUpdate, terminalCommand);
      return textResult(compactCommandResult(terminalCommand));
    },
  });
}

export function createBrowserShareExtension() {
  return function browserShareExtension(pi: Pick<ExtensionAPI, "registerTool">): void {
    pi.registerTool?.({
      name: "browser_share_status",
      label: "Browser Share Status",
      description: "Read the Chrome Browser Share binding state for the current ypi session.",
      promptSnippet: "browser_share_status: check whether the current ypi session has a bound Chrome Browser Share.",
      promptGuidelines: ["Do not ask for or pass shareId. Browser Share tools are scoped to the current ypi session."],
      parameters: { type: "object", properties: {} },
      execute: async (_id: string, _inputValue: Record<string, never>, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: ExtensionContext): Promise<PiToolResult> => {
        return textResult(getBrowserShareManager().getSessionState(sessionIdFromContext(ctx)));
      },
    });

    pi.registerTool?.({
      name: "browser_share_snapshot",
      label: "Browser Share Snapshot",
      description: "Read the latest sanitized page snapshot shared from Chrome for the current ypi session.",
      promptSnippet: "browser_share_snapshot: read the current shared Chrome page URL, title, visible text summary, selection, and safe interactive element summaries.",
      promptGuidelines: [
        "Use this only for the current session's bound Browser Share.",
        "Snapshots are sanitized and should not include password/payment/hidden token values.",
      ],
      parameters: { type: "object", properties: {} },
      execute: async (_id: string, _inputValue: Record<string, never>, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: ExtensionContext): Promise<PiToolResult> => {
        const state = getBrowserShareManager().getSessionState(sessionIdFromContext(ctx));
        if (!state.bound) throw new Error("No Browser Share is bound to this session. Bind Browser Share before requesting a snapshot.");
        if (!state.snapshot) throw new Error("No browser snapshot is available for this session");
        return textResult(state.snapshot);
      },
    });

    pi.registerTool?.({
      name: "browser_share_get_selection",
      label: "Browser Share Selection",
      description: "Read the latest selected text from the Chrome page shared to the current ypi session.",
      promptSnippet: "browser_share_get_selection: read selected text from the current shared Chrome page.",
      promptGuidelines: ["Use after browser_share_status confirms a bound share."],
      parameters: { type: "object", properties: {} },
      execute: async (_id: string, _inputValue: Record<string, never>, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: ExtensionContext): Promise<PiToolResult> => {
        const state = getBrowserShareManager().getSessionState(sessionIdFromContext(ctx));
        return textResult({ selection: state.snapshot?.selection ?? "", tab: state.tab, bound: state.bound });
      },
    });

    registerCommandTool(pi, "browser_share_click", "click", "Click a shared Chrome elementId and wait for the execution result.");
    registerCommandTool(pi, "browser_share_type", "type", "Type into a shared Chrome elementId after approval and wait for the execution result.");
    registerCommandTool(pi, "browser_share_scroll", "scroll", "Scroll the shared Chrome page and wait for the execution result.");
    registerCommandTool(pi, "browser_share_navigate", "navigate", "Navigate the shared Chrome tab to an http(s) URL after approval and wait for the execution result.");
  };
}
