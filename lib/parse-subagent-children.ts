import { readFileSync } from "fs";
import type { SubagentRun } from "@/hooks/useAgentSession";

/**
 * Parse a subagent's session JSONL file to extract its own subagent tool calls.
 * Returns an array of SubagentRun entries for nested children.
 */
export function parseSubagentChildren(sessionFile: string): SubagentRun[] {
  let content: string;
  try {
    content = readFileSync(sessionFile, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n").filter(Boolean);
  const children: SubagentRun[] = [];

  // First pass: collect assistant messages with subagent/trellis_subagent tool calls
  // Each tool call is paired with a subsequent tool result by toolCallId
  interface PendingToolCall {
    id: string;
    agent: string;
    task: string;
    lineIndex: number;
  }

  const pendingCalls: Map<string, PendingToolCall> = new Map();
  const now = Date.now();

  for (let i = 0; i < lines.length; i++) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type !== "message") continue;

    const msg = parsed.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg !== "object") continue;

    // Assistant messages: look for toolCall content blocks with subagent tools
    if (msg.role === "assistant") {
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type !== "toolCall" && b.type !== "tool_use") continue;

        const toolName = (b.name ?? b.toolName ?? "") as string;
        if (toolName !== "subagent" && toolName !== "trellis_subagent") continue;

        const input = (b.input ?? b.arguments ?? {}) as Record<string, unknown>;
        if (!input || typeof input !== "object") continue;

        // Skip management actions
        if ("action" in input) continue;

        // Extract agent and task from the tool call
        const agent = (input.agent ?? input.prompt ?? "") as string;
        if (!agent) continue;
        const task = (input.task ?? input.prompt ?? "") as string;

        const callId = (b.id ?? b.toolCallId ?? "") as string;
        if (callId) {
          pendingCalls.set(callId, { id: callId, agent: String(agent), task: String(task).slice(0, 200), lineIndex: i });
        }
      }
    }

    // Tool result messages: look for subagent tool results with sessionFile
    if (msg.role === "toolResult") {
      const callId = (msg.toolCallId ?? "") as string;
      const toolName = (msg.toolName ?? "") as string;
      if (toolName !== "subagent" && toolName !== "trellis_subagent") continue;

      const pending = pendingCalls.get(callId);
      if (!pending) continue;
      pendingCalls.delete(callId);

      // Extract result text
      const resultContent = msg.content;
      let resultText = "";
      if (Array.isArray(resultContent)) {
        resultText = resultContent
          .filter((c): c is { type?: string; text?: string } => typeof c === "object" && c !== null)
          .map((c) => c.text ?? "")
          .join("");
      }

      // Extract sessionFile from details.results
      const details = msg.details as { results?: { sessionFile?: string }[] } | undefined;
      let childSessionFile: string | undefined;
      if (details?.results?.length === 1) {
        childSessionFile = details.results[0]?.sessionFile;
      }

      const isError = !!msg.isError;

      children.push({
        id: callId,
        agent: pending.agent,
        task: pending.task,
        status: isError ? "failed" : "completed",
        partialOutput: "",
        result: resultText || undefined,
        startedAt: now + children.length,
        depth: 1,
        parentId: undefined,
        sessionFile: childSessionFile,
      });
    }
  }

  return children;
}
