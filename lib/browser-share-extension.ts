import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBrowserShareManager } from "./browser-share-manager";
import type { BrowserShareCommandType } from "./browser-share-types";

type PiToolResult = AgentToolResult<unknown>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function registerCommandTool(pi: Pick<ExtensionAPI, "registerTool">, name: string, type: BrowserShareCommandType, description: string) {
  pi.registerTool?.({
    name,
    label: name,
    description,
    promptSnippet: `${name}: enqueue a Browser Share ${type} command for the current ypi session only.`,
    promptGuidelines: [
      "Use Browser Share command tools only after checking browser_share_status/snapshot.",
      "These tools never accept shareId; the current ypi session binding is used to prevent cross-session access.",
      "Type and navigation commands require user approval before the Chrome extension can execute them.",
    ],
    parameters: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        text: { type: "string" },
        url: { type: "string" },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        reason: { type: "string" },
      },
    },
    execute: async (_id: string, inputValue: { elementId?: unknown; text?: unknown; url?: unknown; deltaX?: unknown; deltaY?: unknown; reason?: unknown }, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: ExtensionContext): Promise<PiToolResult> => {
      const input = isRecord(inputValue) ? inputValue : {};
      const command = getBrowserShareManager().enqueueCommand(sessionIdFromContext(ctx), type, {
        elementId: str(input.elementId),
        text: str(input.text),
        url: str(input.url),
        deltaX: num(input.deltaX),
        deltaY: num(input.deltaY),
        reason: str(input.reason),
      });
      return textResult(command);
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
        if (!state.bound || !state.snapshot) throw new Error("No browser snapshot is available for this session");
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

    registerCommandTool(pi, "browser_share_click", "click", "Queue a click command for a shared Chrome elementId.");
    registerCommandTool(pi, "browser_share_type", "type", "Queue a type command for a shared Chrome elementId; requires approval before execution.");
    registerCommandTool(pi, "browser_share_scroll", "scroll", "Queue a scroll command for the shared Chrome page.");
    registerCommandTool(pi, "browser_share_navigate", "navigate", "Queue a navigation command for the shared Chrome tab; requires approval before execution.");
  };
}
