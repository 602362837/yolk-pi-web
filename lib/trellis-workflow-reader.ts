import { closeSync, existsSync, lstatSync, openSync, readSync, realpathSync, statSync } from "fs";
import path from "path";
import { canonicalizeCwd } from "./cwd";
import type {
  TrellisWorkflowCommand,
  TrellisWorkflowPhase,
  TrellisWorkflowProjection,
  TrellisWorkflowResponse,
  TrellisWorkflowRoutingItem,
  TrellisWorkflowStateBlock,
  TrellisWorkflowStep,
  TrellisWorkflowWarning,
} from "./trellis-workflow-types";

const WORKFLOW_MAX_BYTES = 1024 * 1024;
const DEFAULT_STATES = ["no_task", "planning", "in_progress", "completed"];

export class TrellisWorkflowSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrellisWorkflowSecurityError";
  }
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
    throw new TrellisWorkflowSecurityError(`Path escapes workspace: ${path.relative(workspaceRoot, target)}`);
  }
  return real;
}

function safeWorkflowStat(filePath: string, workspaceRoot: string) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    const real = safeRealPath(filePath, workspaceRoot);
    const realStat = statSync(real);
    if (!realStat.isFile()) throw new Error("Trellis workflow path is not a file");
    return realStat;
  }
  if (!stat.isFile()) throw new Error("Trellis workflow path is not a file");
  safeRealPath(filePath, workspaceRoot);
  return stat;
}

function readFileWithLimit(filePath: string, maxBytes: number): { content: string; truncated: boolean } {
  const stat = statSync(filePath);
  if (stat.size <= maxBytes) {
    const fd = openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(stat.size);
      const bytesRead = readSync(fd, buffer, 0, stat.size, 0);
      return { content: buffer.subarray(0, bytesRead).toString("utf8"), truncated: false };
    } finally {
      closeSync(fd);
    }
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

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "node";
}

function lineEndBefore(lines: string[], startIndex: number, matcher: (line: string) => boolean): number {
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (matcher(lines[i])) return i;
  }
  return lines.length;
}

function firstNonEmpty(lines: string[], start: number, end: number): string | undefined {
  for (let i = start; i < end; i += 1) {
    const line = lines[i]?.trim();
    if (line && !line.startsWith("<!--")) return line.slice(0, 220);
  }
  return undefined;
}

function markdownBody(lines: string[], start: number, end: number): string | undefined {
  const body = lines.slice(start, end).join("\n").trim();
  return body || undefined;
}

function parseStateBlocks(lines: string[], warnings: TrellisWorkflowWarning[]): TrellisWorkflowStateBlock[] {
  const states: TrellisWorkflowStateBlock[] = [];
  const startRe = /^\[workflow-state:([A-Za-z0-9_-]+)\]\s*$/;
  const anyEndRe = /^\[\/workflow-state:([A-Za-z0-9_-]+)\]\s*$/;
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i].match(startRe);
    if (!start) continue;
    const status = start[1];
    let endIndex = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const end = lines[j].match(anyEndRe);
      if (!end) continue;
      if (end[1] !== status) {
        warnings.push({ severity: "error", code: "state-tag-mismatch", message: `workflow-state ${status} closes with ${end[1]}`, lineStart: i + 1, lineEnd: j + 1 });
      }
      endIndex = j;
      break;
    }
    if (endIndex === -1) {
      warnings.push({ severity: "error", code: "state-tag-unclosed", message: `workflow-state ${status} is not closed`, lineStart: i + 1 });
      endIndex = i;
    }
    const id = `state-${slug(status)}`;
    states.push({
      status,
      id,
      body: lines.slice(i + 1, endIndex).join("\n").trim(),
      lineStart: i + 1,
      lineEnd: endIndex + 1,
    });
    i = endIndex;
  }
  return states;
}

function parsePhases(lines: string[], warnings: TrellisWorkflowWarning[]): TrellisWorkflowPhase[] {
  const phaseRe = /^##\s+Phase\s+([0-9][^\s:]*)\s*:?\s*(.*)$/i;
  const stepRe = /^####\s+([0-9A-Za-z]+(?:[.][0-9A-Za-z]+)*)\s+(.+)$/;
  const phases: TrellisWorkflowPhase[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(phaseRe);
    if (!match) continue;
    const phaseNumber = match[1];
    const suffix = match[2]?.trim();
    const title = suffix ? `Phase ${phaseNumber}: ${suffix}` : `Phase ${phaseNumber}`;
    const lineEnd = lineEndBefore(lines, i, (line) => phaseRe.test(line));
    const steps: TrellisWorkflowStep[] = [];
    for (let j = i + 1; j < lineEnd; j += 1) {
      const step = lines[j].match(stepRe);
      if (!step) continue;
      const stepLineEnd = lineEndBefore(lines.slice(0, lineEnd), j, (line) => stepRe.test(line));
      const stepNumber = step[1];
      const stepTitle = step[2].trim();
      const lower = stepTitle.toLowerCase();
      steps.push({
        id: `phase-${slug(phaseNumber)}-step-${slug(stepNumber)}`,
        stepNumber,
        title: stepTitle,
        lineStart: j + 1,
        lineEnd: stepLineEnd,
        body: markdownBody(lines, j + 1, stepLineEnd),
        required: lower.includes("required"),
        once: lower.includes("once"),
        repeatable: lower.includes("repeatable"),
      });
      j = stepLineEnd - 1;
    }
    const firstStepLine = steps[0]?.lineStart ? steps[0].lineStart - 1 : lineEnd;
    const phase: TrellisWorkflowPhase = {
      id: `phase-${slug(phaseNumber)}`,
      title,
      phaseNumber,
      lineStart: i + 1,
      lineEnd,
      steps,
      summary: firstNonEmpty(lines, i + 1, lineEnd),
      body: markdownBody(lines, i + 1, firstStepLine),
    };
    if (steps.length === 0) {
      warnings.push({ severity: "warning", code: "phase-without-steps", message: `${title} has no parser-shaped #### step headings`, lineStart: phase.lineStart, lineEnd: phase.lineEnd, nodeId: phase.id });
    }
    phases.push(phase);
    i = lineEnd - 1;
  }

  if (phases.length === 0) warnings.push({ severity: "error", code: "no-phases", message: "No `## Phase X` headings found in workflow.md" });
  return phases;
}

function relateStatesToPhases(states: TrellisWorkflowStateBlock[], phases: TrellisWorkflowPhase[]): TrellisWorkflowStateBlock[] {
  return states.map((state) => {
    const phase = phases.find((candidate) => state.lineStart >= candidate.lineStart && state.lineStart <= candidate.lineEnd);
    return phase ? { ...state, relatedPhaseId: phase.id } : state;
  });
}

function parseSkillRouting(lines: string[]): TrellisWorkflowRoutingItem[] {
  const items: TrellisWorkflowRoutingItem[] = [];
  const start = lines.findIndex((line) => /^###\s+Skill Routing\s*$/i.test(line.trim()));
  if (start === -1) return items;
  const end = lineEndBefore(lines, start, (line) => /^###\s+/.test(line));
  for (let i = start + 1; i < end; i += 1) {
    const cells = lines[i].split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2 || cells[0].includes("---") || /^User intent$/i.test(cells[0])) continue;
    items.push({ intent: cells[0], skill: cells[1], lineStart: i + 1, lineEnd: i + 1 });
  }
  return items;
}

function parseTaskCommands(lines: string[]): TrellisWorkflowCommand[] {
  const commands: TrellisWorkflowCommand[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/python\s+\.\/\.trellis\/scripts\/task\.py\s+([a-z-]+)/);
    if (match) commands.push({ name: match[1], lineStart: i + 1, lineEnd: i + 1 });
  }
  return commands;
}

function parseWorkflow(content: string, truncated: boolean): { workflow: TrellisWorkflowProjection; warnings: TrellisWorkflowWarning[] } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const warnings: TrellisWorkflowWarning[] = [];
  if (truncated) warnings.push({ severity: "warning", code: "workflow-truncated", message: "workflow.md was truncated before parsing" });
  const states = parseStateBlocks(lines, warnings);
  const phases = parsePhases(lines, warnings);
  const stateStatuses = new Set(states.map((state) => state.status));
  for (const status of DEFAULT_STATES) {
    if (!stateStatuses.has(status)) warnings.push({ severity: "warning", code: "missing-default-state", message: `Missing default workflow-state block: ${status}` });
  }
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  return {
    warnings,
    workflow: {
      title: titleLine?.replace(/^#\s+/, "").trim(),
      phases,
      states: relateStatesToPhases(states, phases),
      taskCommands: parseTaskCommands(lines),
      skillRouting: parseSkillRouting(lines),
      rawLineCount: lines.length,
    },
  };
}

export function readTrellisWorkflow(cwd: string): TrellisWorkflowResponse {
  const workspaceRoot = canonicalizeCwd(cwd);
  const workspaceStat = statSync(workspaceRoot);
  if (!workspaceStat.isDirectory()) throw new Error(`Workspace is not a directory: ${cwd}`);
  const workflowPath = path.join(workspaceRoot, ".trellis", "workflow.md");
  if (!existsSync(workflowPath)) {
    return {
      cwd: workspaceRoot,
      exists: false,
      pathLabel: ".trellis/workflow.md",
      truncated: false,
      warnings: [{ severity: "info", code: "workflow-missing", message: "No .trellis/workflow.md file exists in this workspace." }],
    };
  }
  const stat = safeWorkflowStat(workflowPath, workspaceRoot);
  const { content, truncated } = readFileWithLimit(workflowPath, WORKFLOW_MAX_BYTES);
  const parsed = parseWorkflow(content, truncated);
  return {
    cwd: workspaceRoot,
    exists: true,
    pathLabel: ".trellis/workflow.md",
    modifiedAt: stat.mtime.toISOString(),
    truncated,
    workflow: parsed.workflow,
    warnings: parsed.warnings,
  };
}
