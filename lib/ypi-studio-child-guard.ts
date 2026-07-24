import path from "path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RECURSIVE_TOOL_NAMES = new Set([
  "ypi_studio_task",
  "ypi_studio_subagent",
  "ypi_studio_wait",
  "trellis_subagent",
  "subagent",
]);

const BROWSER_SHARE_ACTION_TOOL_NAMES = new Set([
  "browser_share_click",
  "browser_share_type",
  "browser_share_scroll",
  "browser_share_navigate",
]);

const TASK_JSON_MUTATING_COMMAND_RE = /\b(?:cat\s*>|tee(?:\s+-a)?|cp|mv|rm|unlink|truncate|sed\s+-i|perl\s+-i|python(?:3)?|node|jq|ed|ex)\b|(?:^|\s)(?:>|>>)\s*/i;
const TASK_JSON_PATH_RE = /(?:^|[\s'"`])(?:\.\/)?\.ypi\/tasks\/(?:archive\/[^\s'"`;&|<>]+\/)?[^\s'"`;&|<>]+\/task\.json(?:$|[\s'"`;)|&<>])/;

export interface YpiStudioChildGuardOptions {
  workspaceRoot?: string;
  blockTaskJsonWrites?: boolean;
  /**
   * GitHub unattended full-agent children still block recursive Studio tools and
   * direct task.json mutation. This flag documents that bash/network/file tools
   * remain available — restricted tools are not a launch hard gate (GHA-06).
   */
  fullAgent?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toolInputPath(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  return stringValue(input.path)
    ?? stringValue(input.filePath)
    ?? stringValue(input.file)
    ?? stringValue(input.targetPath)
    ?? stringValue(input.target);
}

export function isYpiStudioChildBlockedTool(toolName: string): boolean {
  return RECURSIVE_TOOL_NAMES.has(toolName) || BROWSER_SHARE_ACTION_TOOL_NAMES.has(toolName);
}

export function isYpiStudioTaskJsonPath(candidate: string, workspaceRoot?: string): boolean {
  const normalized = candidate.replace(/\\/g, "/");
  if (/(^|\/)\.ypi\/tasks\/(?:archive\/[^/]+\/)?[^/]+\/task\.json$/.test(normalized)) return true;
  if (!workspaceRoot || !path.isAbsolute(candidate)) return false;
  const relative = path.relative(workspaceRoot, candidate).replace(/\\/g, "/");
  return !relative.startsWith("../") && relative !== ".." && /(^|\/)\.ypi\/tasks\/(?:archive\/[^/]+\/)?[^/]+\/task\.json$/.test(relative);
}

export function isYpiStudioTaskJsonMutatingBash(command: string, workspaceRoot?: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  const rootRelativeMatch = TASK_JSON_PATH_RE.test(normalized);
  const absoluteMatch = workspaceRoot
    ? normalized.includes(`${path.resolve(workspaceRoot).replace(/\\/g, "/")}/.ypi/tasks/`) && /\/task\.json(?:$|[\s'"`;)|&<>])/.test(normalized)
    : false;
  return (rootRelativeMatch || absoluteMatch) && TASK_JSON_MUTATING_COMMAND_RE.test(normalized);
}

export function createYpiStudioChildGuardExtension(options: YpiStudioChildGuardOptions = {}) {
  // fullAgent is informational: we still only block recursive/browser tools.
  void options.fullAgent;
  return function ypiStudioChildGuardExtension(pi: Pick<ExtensionAPI, "on">): void {
    pi.on?.("tool_call", async (event) => {
      const toolName = typeof event.toolName === "string" ? event.toolName : "";
      if (isYpiStudioChildBlockedTool(toolName)) {
        return {
          block: true,
          reason: `YPI Studio child sessions cannot call recursive orchestration or browser action tool '${toolName}'. Return your result to the parent Studio session instead.`,
        };
      }

      if (options.blockTaskJsonWrites === false) return undefined;
      if (toolName === "write" || toolName === "edit") {
        const targetPath = toolInputPath(event.input);
        if (targetPath && isYpiStudioTaskJsonPath(targetPath, options.workspaceRoot)) {
          return {
            block: true,
            reason: "YPI Studio child sessions may not edit .ypi/tasks/**/task.json directly. Report the desired task update to the parent session so it can use the Studio tools and approval gate.",
          };
        }
      }

      if (toolName === "bash" && isObject(event.input)) {
        const command = stringValue((event.input as Record<string, unknown>)["command"]);
        if (command && isYpiStudioTaskJsonMutatingBash(command, options.workspaceRoot)) {
          return {
            block: true,
            reason: "YPI Studio child sessions may not mutate .ypi/tasks/**/task.json via shell commands. Report the desired task update to the parent session.",
          };
        }
      }

      return undefined;
    });
  };
}
