import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { Type } from "typebox";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { WORKTREE_CHECK_POLICY_ID, WORKTREE_CHECK_POLICY_VERSION, type WorktreeCheckExecutionResult, worktreeCheckSystemGuidance } from "./worktree-check-policy";
import { WorktreeCheckExecutionController, resolveWorktreeCheckPath, type WorktreeCheckExecInput } from "./worktree-check-execution";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: {}, ...(isError ? { isError: true } : {}) };
}

/**
 * Shared custom tools for SDK sessions. The CLI adapter below registers these
 * same definitions, so command policy is owned by one controller rather than
 * by a prompt or a runner-specific implementation.
 */
export function createWorktreeCheckTools(controller: WorktreeCheckExecutionController): ToolDefinition[] {
  const execute = defineTool({
    name: "worktree_check_exec",
    label: "WorkTree check command",
    description: "Run a bounded, server-policy-controlled argv command in the fixed WorkTree.",
    parameters: Type.Object({
      purpose: Type.Union([Type.Literal("probe"), Type.Literal("prepare"), Type.Literal("check")]),
      executable: Type.String({ maxLength: 4096 }),
      args: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 128 }),
      cwd: Type.Optional(Type.String({ maxLength: 4096 })),
      retryOfCommandId: Type.Optional(Type.String({ maxLength: 128 })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal) {
      const result = await controller.execute(params as WorktreeCheckExecInput, signal);
      return textResult(JSON.stringify({ commandId: result.commandId, exitCode: result.exitCode, output: result.output, reasonCode: result.reasonCode, rejected: result.rejected }), result.rejected || result.reasonCode !== null);
    },
  });
  const report = defineTool({
    name: "submit_check_report",
    label: "Submit WorkTree check report",
    description: "Submit the final structured report using command ids observed from worktree_check_exec.",
    parameters: Type.Object({
      environment: Type.Union([Type.Literal("ready"), Type.Literal("not_needed"), Type.Literal("blocked")]),
      verdict: Type.Union([Type.Literal("pass"), Type.Literal("needs_work"), Type.Literal("blocked")]),
      evidenceSummary: Type.String({ maxLength: 1000 }),
      probeCommandIds: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 128 }),
      prepareCommandIds: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 128 }),
      checkCommandIds: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 128 }),
      blockerCode: Type.Optional(Type.String({ maxLength: 128 })),
    }, { additionalProperties: false }),
    async execute(_id, params) {
      const result = controller.submitReport(params);
      return textResult(JSON.stringify(safeProjection(result)), result.status !== "passed");
    },
  });
  return [execute, report];
}

/** CLI extension entry point; caller supplies a fixed server-created controller. */
export function registerWorktreeCheckCliTools(
  pi: { registerTool(tool: ToolDefinition): void },
  controller: WorktreeCheckExecutionController,
): void {
  for (const tool of [...createWorktreeCheckFileTools(controller), ...createWorktreeCheckTools(controller)]) pi.registerTool(tool);
}

/**
 * Contained replacements for Pi's filesystem tools. They retain the familiar
 * schemas while every filesystem operation resolves through the controller's
 * WorkTree containment gate. These guards are not an OS sandbox.
 */
export function createWorktreeCheckFileTools(controller: WorktreeCheckExecutionController): ToolDefinition[] {
  const worktreePath = controller.worktreePath;
  // Pi's built-in file definitions resolve their input against cwd before
  // invoking operations. Convert that internal absolute form back to a
  // contained relative path so callers cannot turn it into an escape hatch.
  const scopedPath = (path: string) => {
    if (!isAbsolute(path)) return path;
    const value = relative(worktreePath, path);
    if (!value || value === ".." || value.startsWith("../")) throw new Error("check_command_rejected");
    return value;
  };
  const readPath = (path: string) => resolveWorktreeCheckPath(worktreePath, scopedPath(path));
  const readBuffer = async (path: string) => {
    const content = await readFile(await readPath(path));
    controller.noteRepositoryEvidenceRead();
    return content;
  };
  const readText = async (path: string) => {
    const content = await readFile(await readPath(path), "utf8");
    controller.noteRepositoryEvidenceRead();
    return content;
  };
  const writePath = (path: string) => resolveWorktreeCheckPath(worktreePath, scopedPath(path), true);
  return [
    createReadToolDefinition(worktreePath, {
      operations: {
        readFile: async (path) => readBuffer(path),
        access: async (path) => { await stat(await readPath(path)); },
      },
    }),
    createGrepToolDefinition(worktreePath, {
      operations: {
        isDirectory: async (path) => (await stat(await readPath(path))).isDirectory(),
        readFile: async (path) => readText(path),
      },
    }),
    createFindToolDefinition(worktreePath, {
      operations: {
        exists: async (path) => stat(await readPath(path)).then(() => true).catch(() => false),
        glob: async (_pattern, path, options) => listContainedFiles(worktreePath, path, options.limit),
      },
    }),
    createLsToolDefinition(worktreePath, {
      operations: {
        exists: async (path) => stat(await readPath(path)).then(() => true).catch(() => false),
        stat: async (path) => stat(await readPath(path)),
        readdir: async (path) => readdir(await readPath(path)),
      },
    }),
    createEditToolDefinition(worktreePath, {
      operations: {
        readFile: async (path) => readFile(await writePath(path)),
        writeFile: async (path, content) => writeFile(await writePath(path), content),
        access: async (path) => { await stat(await writePath(path)); },
      },
    }),
    createWriteToolDefinition(worktreePath, {
      operations: {
        writeFile: async (path, content) => writeFile(await writePath(path), content),
        mkdir: async (path) => { await mkdir(await writePath(path), { recursive: true }); },
      },
    }),
  ] as unknown as ToolDefinition[];
}

async function listContainedFiles(worktreePath: string, requestedPath: string, limit: number): Promise<string[]> {
  const root = await resolveWorktreeCheckPath(worktreePath, requestedPath || ".");
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (found.length >= limit) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (found.length >= limit || entry.name === ".git") continue;
      const child = join(directory, entry.name);
      await resolveWorktreeCheckPath(worktreePath, child.slice(worktreePath.length + 1));
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) found.push(child);
    }
  };
  await visit(root);
  return found;
}

/** Server-owned SDK system injection, deliberately added after task context. */
export function createWorktreeCheckPolicyExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("before_agent_start", (event) => ({
      systemPrompt: `${event.systemPrompt}\n\n${worktreeCheckSystemGuidance()}`,
    }));
  };
}

export function worktreeCheckPolicyHandshake(): string {
  return `${WORKTREE_CHECK_POLICY_ID}@${WORKTREE_CHECK_POLICY_VERSION}`;
}

/** Never expose command arguments, paths, environment or raw command output. */
export function safeProjection(result: WorktreeCheckExecutionResult) {
  return {
    status: result.status,
    reasonCode: result.reasonCode,
    stage: result.stage,
    probeCount: result.probeCount,
    prepareAttempts: result.prepareAttempts,
    checkCount: result.checkCount,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    commandStarted: result.commandStarted,
    retryability: result.retryability,
    reportHash: result.reportHash,
    safeMessage: result.safeMessage,
  };
}
