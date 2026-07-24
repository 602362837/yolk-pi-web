import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "fs";
import path from "path";
import { canonicalizeCwd } from "./cwd";
import type {
  YpiStudioWorkflow,
  YpiStudioWorkflowFile,
  YpiStudioWorkflowState,
  YpiStudioWorkflowTransition,
  YpiStudioWorkflowWriteResult,
  YpiStudioWorkflowsInitResponse,
  YpiStudioWorkflowsResponse,
} from "./ypi-studio-types";
export { buildYpiStudioWorkflowFlow, getYpiStudioWorkflowBranchTransitions, orderYpiStudioWorkflowStates } from "./ypi-studio-workflow-flow";

const WORKFLOWS_DIR = path.join(".ypi", "workflows");

interface WorkflowContext {
  cwd: string;
  workspaceRoot: string;
  workflowsRoot: string;
}

export class YpiStudioWorkflowSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YpiStudioWorkflowSecurityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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
    throw new YpiStudioWorkflowSecurityError(`Path escapes workspace: ${relativeLabel(workspaceRoot, target)}`);
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

function createContext(cwd: string): WorkflowContext {
  const workspaceRoot = canonicalizeCwd(cwd);
  const stat = statSync(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${cwd}`);
  return {
    cwd: workspaceRoot,
    workspaceRoot,
    workflowsRoot: path.join(workspaceRoot, WORKFLOWS_DIR),
  };
}

function state(
  id: string,
  label: string,
  owner: YpiStudioWorkflowState["owner"],
  progress: number,
  instruction: string,
  requiredArtifacts: string[] = [],
  optionalArtifacts: string[] = [],
  extra: Pick<YpiStudioWorkflowState, "requiresSubagent" | "requiresUserApproval"> = {},
): YpiStudioWorkflowState {
  return { id, label, owner, progress, instruction, requiredArtifacts, optionalArtifacts, ...extra };
}

const BASE_TRANSITIONS: YpiStudioWorkflowTransition[] = [
  { from: "intake", to: "planning" },
  { from: "planning", to: "awaiting_approval" },
  // Interactive: requires user-input/user-widget approvalGrant.
  // github_unattended: same edge, but authorization is internal policyGrant + complete claim (not interactive grant; override still cannot bypass).
  { from: "awaiting_approval", to: "implementing", requiresUserApproval: true },
  { from: "implementing", to: "checking" },
  { from: "checking", to: "ready" },
  { from: "checking", to: "changes_requested" },
  { from: "changes_requested", to: "implementing" },
  { from: "changes_requested", to: "planning" },
  { from: "ready", to: "completed" },
  { from: "checking", to: "review" },
  { from: "review", to: "user_acceptance" },
  { from: "user_acceptance", to: "completed", requiresUserApproval: true },
  { from: "user_acceptance", to: "waiting_for_improvements" },
  { from: "waiting_for_improvements", to: "review" },
  { from: "intake", to: "blocked", overrideAllowed: true },
  { from: "planning", to: "blocked", overrideAllowed: true },
  { from: "implementing", to: "blocked", overrideAllowed: true },
  { from: "checking", to: "blocked", overrideAllowed: true },
  { from: "waiting_for_improvements", to: "blocked", overrideAllowed: true },
  { from: "blocked", to: "intake", overrideAllowed: true },
  { from: "blocked", to: "planning", overrideAllowed: true },
  { from: "blocked", to: "implementing", overrideAllowed: true },
  { from: "blocked", to: "waiting_for_improvements", overrideAllowed: true },
  { from: "intake", to: "cancelled", overrideAllowed: true },
  { from: "planning", to: "cancelled", overrideAllowed: true },
  { from: "awaiting_approval", to: "cancelled", overrideAllowed: true },
  { from: "waiting_for_improvements", to: "cancelled", overrideAllowed: true },
  { from: "completed", to: "user_acceptance" },
  { from: "completed", to: "archived" },
];

const STANDARD_STATES: Record<string, YpiStudioWorkflowState> = {
  intake: state("intake", "接单", "architect", 10, "理解目标、范围、约束和已有材料；需求不清楚时先问问题。", ["brief.md"], [], { requiresSubagent: true }),
  planning: state("planning", "设计", "architect", 35, "产出 PRD、Design、Implement、Checks 和 plan-review.md 计划审批书；计划审批书是等待用户确认时的主审阅入口，应使用 Markdown 相对链接引用关键产物。若涉及页面变更、前端功能新增、交互变化、审批体验变化或用户可见信息结构变化，必须派发 UI 设计员产出 HTML 原型并请求用户审批。", ["plan-review.md", "prd.md", "design.md", "implement.md", "checks.md"], ["ui.md"], { requiresSubagent: true }),
  awaiting_approval: state("awaiting_approval", "等待确认", "main", 45, "等待用户确认 plan-review.md 计划审批书。计划审批书必须链接 PRD/Design/Implement/Checks 等关键产物；涉及 UI 原型门禁时必须同时链接 HTML 原型和用户审批请求；未确认前禁止进入实现阶段。", ["plan-review.md", "prd.md", "design.md", "implement.md", "checks.md"], ["ui.md"], { requiresUserApproval: true }),
  implementing: state("implementing", "制作", "implementer", 70, "主 session 必须通过 ypi_studio_subagent 指派实现员完成实现。", ["handoff.md"], [], { requiresSubagent: true }),
  checking: state("checking", "检查", "checker", 90, "主 session 必须通过 ypi_studio_subagent 指派检查员审查 diff、运行验证并修复低风险小问题。", ["review.md"], [], { requiresSubagent: true }),
  changes_requested: state("changes_requested", "请求修改", "main", 78, "检查未通过。主 session 需要决定退回实现员修复，还是退回架构师重新设计。"),
  ready: state("ready", "待收尾", "main", 95, "检查通过，等待主 session 汇总、提交计划或收尾。"),
  review: state("review", "审核", "main", 95, "检查通过，等待主 session 请求用户验收。"),
  user_acceptance: state("user_acceptance", "用户验收", "main", 97, "等待用户确认验收。无问题则完成；有问题则创建改进项进入等待改进完成。", [], [], { requiresUserApproval: true }),
  waiting_for_improvements: state("waiting_for_improvements", "等待改进完成", "main", 96, "改进项处理中，全部完成后返回 review 再次请求用户验收。"),
  completed: state("completed", "完成", "main", 100, "任务已完成。"),
  blocked: state("blocked", "阻塞", "main", 50, "等待用户、外部条件或设计决策。"),
  cancelled: state("cancelled", "取消", "main", 100, "任务已取消。"),
  archived: state("archived", "归档", "main", 100, "任务已归档。"),
};

export const DEFAULT_YPI_STUDIO_WORKFLOWS: YpiStudioWorkflow[] = [
  {
    schemaVersion: 1,
    id: "feature-dev",
    name: "功能开发",
    description: "从需求接单、设计、实现、检查到收尾的标准工作室流程。",
    triggers: {
      slash: ["studio-start", "studio-feature"],
      natural: ["用工作室做", "走工作室流程", "让蛋黄派工作室处理", "先让架构师设计"],
    },
    initialStatus: "intake",
    terminalStatuses: ["completed", "cancelled", "archived"],
    states: STANDARD_STATES,
    transitions: BASE_TRANSITIONS,
  },
  {
    schemaVersion: 1,
    id: "bugfix",
    name: "Bug 修复",
    description: "先复现和定位，再设计修复、实现、回归检查的缺陷修复流程。",
    triggers: {
      slash: ["studio-bugfix"],
      natural: ["用工作室修 bug", "让工作室排查", "走 bugfix 流程"],
    },
    initialStatus: "intake",
    terminalStatuses: ["completed", "cancelled", "archived"],
    states: {
      ...STANDARD_STATES,
      intake: state("intake", "复现接单", "architect", 10, "收集报错、复现步骤、期望行为和影响范围。", ["brief.md"], [], { requiresSubagent: true }),
      planning: state("planning", "修复设计", "architect", 35, "定位根因，产出修复方案、验证计划、回归风险和 plan-review.md 计划审批书；计划审批书是等待用户确认时的主审阅入口，应使用 Markdown 相对链接引用关键产物。若修复涉及页面变更、前端功能新增、交互变化、审批体验变化或用户可见信息结构变化，必须派发 UI 设计员产出 HTML 原型并请求用户审批。", ["plan-review.md", "prd.md", "design.md", "implement.md", "checks.md"], ["ui.md"], { requiresSubagent: true }),
    },
    transitions: BASE_TRANSITIONS,
  },
  {
    schemaVersion: 1,
    id: "ui-change",
    name: "UI 改动",
    description: "强调 UI 设计、交互状态和视觉一致性的界面改动流程。",
    triggers: {
      slash: ["studio-ui"],
      natural: ["让 UI 设计员", "走 UI 流程", "用工作室设计界面"],
    },
    initialStatus: "intake",
    terminalStatuses: ["completed", "cancelled", "archived"],
    states: {
      ...STANDARD_STATES,
      planning: state("planning", "UI + 技术设计", "architect", 35, "架构师产出技术计划和 plan-review.md 计划审批书，并必须派发 UI 设计员基于现有项目产出 HTML 原型；计划审批书应链接 ui.md 与 HTML 原型；ui.md 可承载原型或链接，但不能用纯 Markdown 替代。", ["plan-review.md", "prd.md", "ui.md", "design.md", "implement.md", "checks.md"], [], { requiresSubagent: true }),
      awaiting_approval: state("awaiting_approval", "等待确认", "main", 45, "等待用户确认 plan-review.md 计划审批书、方案和 HTML 原型。计划审批书应链接 ui.md 与 HTML 原型；未确认前禁止进入实现阶段。", ["plan-review.md", "prd.md", "ui.md", "design.md", "implement.md", "checks.md"], [], { requiresUserApproval: true }),
    },
    transitions: BASE_TRANSITIONS,
  },
  {
    schemaVersion: 1,
    id: "review-only",
    name: "只检查",
    description: "不执行实现，只由检查员审查当前改动并给出结论。",
    triggers: {
      slash: ["studio-check"],
      natural: ["让检查员 review", "工作室检查一下", "只走检查流程"],
    },
    initialStatus: "checking",
    terminalStatuses: ["completed", "cancelled", "archived"],
    states: {
      checking: STANDARD_STATES.checking,
      changes_requested: STANDARD_STATES.changes_requested,
      ready: STANDARD_STATES.ready,
      completed: STANDARD_STATES.completed,
      blocked: STANDARD_STATES.blocked,
      cancelled: STANDARD_STATES.cancelled,
      archived: STANDARD_STATES.archived,
    },
    transitions: [
      { from: "checking", to: "ready" },
      { from: "checking", to: "changes_requested" },
      { from: "changes_requested", to: "checking" },
      { from: "ready", to: "completed" },
      { from: "checking", to: "blocked", overrideAllowed: true },
      { from: "blocked", to: "checking", overrideAllowed: true },
      { from: "checking", to: "cancelled", overrideAllowed: true },
      { from: "completed", to: "archived" },
    ],
  },
];

const DEFAULT_WORKFLOW_BY_FILE = new Map(DEFAULT_YPI_STUDIO_WORKFLOWS.map((workflow) => [`${workflow.id}.json`, workflow]));
const DEFAULT_WORKFLOW_ORDER = new Map(DEFAULT_YPI_STUDIO_WORKFLOWS.map((workflow, index) => [`${workflow.id}.json`, index]));

function workflowFileName(workflow: Pick<YpiStudioWorkflow, "id">): string {
  return `${workflow.id}.json`;
}

function normalizeWorkflowState(id: string, value: unknown): YpiStudioWorkflowState {
  if (!isRecord(value)) throw new Error(`Workflow state ${id} must be an object`);
  return {
    id,
    label: optionalString(value.label) ?? id,
    owner: optionalString(value.owner) ?? "main",
    progress: typeof value.progress === "number" && Number.isFinite(value.progress) ? value.progress : 0,
    instruction: optionalString(value.instruction),
    requiredArtifacts: stringArray(value.requiredArtifacts),
    optionalArtifacts: stringArray(value.optionalArtifacts),
    requiresSubagent: value.requiresSubagent === true,
    requiresUserApproval: value.requiresUserApproval === true,
  };
}

function normalizeWorkflow(raw: unknown, fallback?: YpiStudioWorkflow): YpiStudioWorkflow {
  if (!isRecord(raw)) throw new Error("Workflow root must be an object");
  const id = optionalString(raw.id) ?? fallback?.id;
  if (!id) throw new Error("Workflow id is required");
  const rawStates = isRecord(raw.states) ? raw.states : fallback?.states;
  if (!rawStates) throw new Error("Workflow states are required");
  const states: Record<string, YpiStudioWorkflowState> = {};
  for (const [stateId, stateValue] of Object.entries(rawStates)) {
    states[stateId] = normalizeWorkflowState(stateId, stateValue);
  }
  const rawTransitions = Array.isArray(raw.transitions) ? raw.transitions : fallback?.transitions ?? [];
  const transitions: YpiStudioWorkflowTransition[] = rawTransitions.filter(isRecord).map((transition) => ({
    from: optionalString(transition.from) ?? "",
    to: optionalString(transition.to) ?? "",
    label: optionalString(transition.label),
    requiresUserApproval: transition.requiresUserApproval === true,
    overrideAllowed: transition.overrideAllowed === true,
  })).filter((transition) => transition.from && transition.to);
  const triggers = isRecord(raw.triggers) ? raw.triggers : {};
  return {
    schemaVersion: 1,
    id,
    name: optionalString(raw.name) ?? fallback?.name ?? id,
    description: optionalString(raw.description) ?? fallback?.description ?? "YPI Studio workflow.",
    triggers: {
      slash: stringArray(triggers.slash),
      natural: stringArray(triggers.natural),
    },
    initialStatus: optionalString(raw.initialStatus) ?? fallback?.initialStatus ?? Object.keys(states)[0] ?? "intake",
    terminalStatuses: stringArray(raw.terminalStatuses).length > 0 ? stringArray(raw.terminalStatuses) : fallback?.terminalStatuses ?? ["completed", "cancelled", "archived"],
    states,
    transitions,
  };
}

function readWorkflowFile(ctx: WorkflowContext, fileName: string): YpiStudioWorkflowFile {
  const filePath = path.join(ctx.workflowsRoot, fileName);
  const pathLabel = relativeLabel(ctx.workspaceRoot, filePath);
  const fallback = DEFAULT_WORKFLOW_BY_FILE.get(fileName);
  try {
    const stat = safeStatFile(filePath, ctx.workspaceRoot);
    if (!stat) throw new Error(`Not a file: ${pathLabel}`);
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const workflow = normalizeWorkflow(raw, fallback);
    return {
      ...workflow,
      key: workflow.id,
      fileName,
      pathLabel,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  } catch (error) {
    const workflow = fallback ?? DEFAULT_YPI_STUDIO_WORKFLOWS[0];
    return {
      ...workflow,
      key: fallback?.id ?? fileName.replace(/\.json$/i, ""),
      fileName,
      pathLabel,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function sortWorkflows(a: YpiStudioWorkflowFile, b: YpiStudioWorkflowFile): number {
  const aOrder = DEFAULT_WORKFLOW_ORDER.get(a.fileName) ?? Number.MAX_SAFE_INTEGER;
  const bOrder = DEFAULT_WORKFLOW_ORDER.get(b.fileName) ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.name.localeCompare(b.name);
}

function ensureWorkflowRoot(ctx: WorkflowContext): void {
  const ypiRoot = path.join(ctx.workspaceRoot, ".ypi");
  if (existsSync(ypiRoot)) assertDirectoryWithinWorkspace(ypiRoot, ctx.workspaceRoot);
  else mkdirSync(ypiRoot);

  if (existsSync(ctx.workflowsRoot)) assertDirectoryWithinWorkspace(ctx.workflowsRoot, ctx.workspaceRoot);
  else mkdirSync(ctx.workflowsRoot);
}

function writeDefaultWorkflow(ctx: WorkflowContext, workflow: YpiStudioWorkflow, options: { overwriteDefaults?: boolean } = {}): YpiStudioWorkflowWriteResult {
  const fileName = workflowFileName(workflow);
  const filePath = path.join(ctx.workflowsRoot, fileName);
  const pathLabel = relativeLabel(ctx.workspaceRoot, filePath);
  if (existsSync(filePath)) {
    if (!safeStatFile(filePath, ctx.workspaceRoot)) throw new Error(`Existing workflow path is not a file: ${pathLabel}`);
    if (options.overwriteDefaults) {
      const content = `${JSON.stringify(workflow, null, 2)}\n`;
      if (readFileSync(filePath, "utf8") !== content) {
        writeFileSync(filePath, content, { encoding: "utf8" });
        safeStatFile(filePath, ctx.workspaceRoot);
        return { id: workflow.id, fileName, pathLabel, status: "updated" };
      }
    }
    return { id: workflow.id, fileName, pathLabel, status: "skipped" };
  }
  writeFileSync(filePath, `${JSON.stringify(workflow, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  safeStatFile(filePath, ctx.workspaceRoot);
  return { id: workflow.id, fileName, pathLabel, status: "created" };
}

export function initializeYpiStudioWorkflows(cwd: string, options: { overwriteDefaults?: boolean } = {}): YpiStudioWorkflowsInitResponse {
  const ctx = createContext(cwd);
  ensureWorkflowRoot(ctx);
  const created: YpiStudioWorkflowWriteResult[] = [];
  const updated: YpiStudioWorkflowWriteResult[] = [];
  const skipped: YpiStudioWorkflowWriteResult[] = [];
  for (const workflow of DEFAULT_YPI_STUDIO_WORKFLOWS) {
    const result = writeDefaultWorkflow(ctx, workflow, options);
    if (result.status === "created") created.push(result);
    else if (result.status === "updated") updated.push(result);
    else skipped.push(result);
  }
  return {
    cwd: ctx.cwd,
    pathLabel: WORKFLOWS_DIR,
    created,
    updated,
    skipped,
    workflows: listYpiStudioWorkflows(ctx.cwd),
  };
}

export function listYpiStudioWorkflows(cwd: string): YpiStudioWorkflowsResponse {
  const ctx = createContext(cwd);
  const base = { cwd: ctx.cwd, pathLabel: WORKFLOWS_DIR };
  if (!existsSync(ctx.workflowsRoot)) {
    return {
      ...base,
      exists: false,
      workflows: [],
      missingDefaultWorkflows: DEFAULT_YPI_STUDIO_WORKFLOWS.map(workflowFileName),
      errors: [],
    };
  }
  assertDirectoryWithinWorkspace(ctx.workflowsRoot, ctx.workspaceRoot);
  const workflows: YpiStudioWorkflowFile[] = [];
  const errors: YpiStudioWorkflowsResponse["errors"] = [];
  for (const entry of readdirSync(ctx.workflowsRoot, { withFileTypes: true })) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.toLowerCase().endsWith(".json")) continue;
    const workflow = readWorkflowFile(ctx, entry.name);
    workflows.push(workflow);
    if (workflow.readError) errors.push({ fileName: entry.name, pathLabel: workflow.pathLabel, message: workflow.readError });
  }
  const present = new Set(workflows.map((workflow) => workflow.fileName));
  return {
    ...base,
    exists: true,
    workflows: workflows.sort(sortWorkflows),
    missingDefaultWorkflows: DEFAULT_YPI_STUDIO_WORKFLOWS.filter((workflow) => !present.has(workflowFileName(workflow))).map(workflowFileName),
    errors,
  };
}

export function readYpiStudioWorkflow(cwd: string, workflowId: string): YpiStudioWorkflowFile | null {
  const workflows = listYpiStudioWorkflows(cwd);
  return workflows.workflows.find((workflow) => workflow.id === workflowId || workflow.key === workflowId) ?? null;
}

export function getYpiStudioWorkflowOrDefault(cwd: string, workflowId?: string): YpiStudioWorkflowFile {
  const initialized = initializeYpiStudioWorkflows(cwd).workflows;
  const requested = workflowId ? initialized.workflows.find((workflow) => workflow.id === workflowId || workflow.key === workflowId) : undefined;
  const first = initialized.workflows[0];
  if (!requested && !first) throw new Error("No YPI Studio workflows available");
  return requested ?? first;
}

export function findYpiStudioTransition(workflow: YpiStudioWorkflow, from: string, to: string): YpiStudioWorkflowTransition | null {
  return workflow.transitions.find((transition) => transition.from === from && transition.to === to) ?? null;
}
