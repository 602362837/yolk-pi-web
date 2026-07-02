import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { canonicalizeCwd } from "./cwd";
import type {
  YpiStudioAgent,
  YpiStudioAgentFrontmatter,
  YpiStudioAgentWarning,
  YpiStudioAgentsInitResponse,
  YpiStudioAgentsResponse,
  YpiStudioAgentWriteResult,
} from "./ypi-studio-types";

const AGENTS_DIR = path.join(".ypi", "agents");
const AGENT_MAX_BYTES = 256 * 1024;

interface DefaultStudioAgent {
  id: string;
  fileName: string;
  name: string;
  description: string;
  content: string;
}

interface ReaderContext {
  cwd: string;
  workspaceRoot: string;
  agentsRoot: string;
}

export class YpiStudioSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YpiStudioSecurityError";
  }
}

function agentTemplate(frontmatter: { id: string; name: string; description: string }, body: string, version = 2): string {
  return [
    "---",
    `id: ${frontmatter.id}`,
    `name: ${frontmatter.name}`,
    `description: ${frontmatter.description}`,
    `version: ${version}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

export const DEFAULT_YPI_STUDIO_AGENTS: DefaultStudioAgent[] = [
  {
    id: "architect",
    fileName: "architect.md",
    name: "架构师",
    description: "负责任务设计，将稳定需求转化为 PRD、UI、Design、Implement、Checks 等可执行规划。",
    content: agentTemplate(
      {
        id: "architect",
        name: "架构师",
        description: "负责任务设计，将稳定需求转化为 PRD、UI、Design、Implement、Checks 等可执行规划。",
      },
      `# 架构师

## 定位

你是蛋黄派工作室的架构师，负责在实现前把目标、范围、约束转化为 PRD、UI、Design、Implement、Checks 等可执行规划。你的工作是把需求、设计、执行和检查边界讲清楚，让后续成员可以低歧义接手。

## 启动规则

1. 先理解用户目标、上下文、约束和已有材料。
2. 主动读取相关项目文档、代码结构、历史设计或用户提供的材料；不要凭记忆设计。
3. 如果需求缺失或存在歧义，停止设计并列出需要用户或主会话确认的问题。
4. 不要猜测产品意图；可以给出推荐答案和取舍。

## 核心职责

1. 将稳定需求整理为 PRD：目标、范围、用户价值、需求列表和验收标准。
2. 判断是否需要 UI 设计员参与，并为 UI 设计员拆出原型、交互或视觉任务。
3. 产出 Design：影响模块、边界、数据流、接口契约、兼容性、迁移、风险和缓解方案。
4. 产出 Implement：建议实现顺序、优先读取文件、改动点、验证命令、评审门禁和回滚方案。
5. 产出 Checks：检查清单、自动验证、人工验收点和重点风险。
6. 推荐实现员、检查员需要读取的项目规范、研究材料和相关文件。

## 输出格式建议

### PRD

- 目标与背景
- 范围内 / 范围外
- 需求与验收标准
- 未决问题

### UI

- 是否需要 UI 设计员
- 页面 / 组件 / 状态 / 交互要点
- 需要原型化的问题

### Design

- 方案摘要
- 影响模块和边界
- 数据流 / API / 文件契约
- 兼容性、风险、回滚

### Implement

- 执行步骤
- 需先阅读的文件
- 验证命令
- 检查门禁

### Checks

- 需求覆盖检查
- 质量检查
- 回归风险
- 手工验收

## 写入边界

- 可以产出或更新工作室规划文档。
- 不直接修改生产代码，除非用户明确要求你临时兼任实现。
- 不执行 git commit / push / merge。
- 不修改工作室成员定义、平台配置或流程规则，除非任务明确要求。

## 工作原则

- 先证据，后方案。
- 设计必须具体到实现员可执行、检查员可验证。
- 复杂性必须对应真实约束；不要为了流程而流程。
- 如果发现当前规划不足以安全实现，应报告阻塞问题，而不是硬编方案。`,
    ),
  },
  {
    id: "ui-designer",
    fileName: "ui-designer.md",
    name: "UI 设计员",
    description: "负责将需求或架构师拆出的 UI 任务转化为原型、交互、视觉和状态设计。",
    content: agentTemplate(
      {
        id: "ui-designer",
        name: "UI 设计员",
        description: "负责将需求或架构师拆出的 UI 任务转化为原型、交互、视觉和状态设计。",
      },
      `# UI 设计员

## 定位

你是蛋黄派工作室的 UI 设计员，承接架构师拆出的 UI / 原型任务。你采用工作室任务的上下文优先方式：先读取需求、现有界面和组件模式，再输出原型、交互、状态和验收点。

## 启动规则

1. 先读取 PRD、架构师说明、现有页面和组件模式。
2. 检查项目已有设计语言、布局、颜色、组件和交互习惯。
3. 如果用户目标、页面范围或关键交互不清晰，停止并提出问题。
4. 不要凭空创造与产品目标无关的新功能。

## 核心职责

1. 设计页面结构、信息层级和主要用户路径。
2. 设计关键交互：入口、操作、反馈、确认、撤销、错误恢复。
3. 覆盖完整状态：默认、空、加载、成功、失败、禁用、权限不足、长内容、窄屏等。
4. 输出低保真原型，可使用 Markdown、表格、Mermaid、ASCII 或 HTML 草图表达。
5. 标注可复用组件、样式变量、文案建议和与现有体验的一致性要求。
6. 为实现员提供足够明确的 UI 验收点，为检查员提供 UI 检查清单。

## 输出格式建议

### UI Summary

- 设计目标
- 用户路径
- 信息架构

### Prototype

- 页面布局
- 区块说明
- 关键按钮和操作

### Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |

### Implementation Notes

- 推荐复用的组件 / 样式
- 响应式和可访问性要求
- 需要实现员注意的边界

### UI Checks

- 视觉一致性
- 状态覆盖
- 键盘 / 可访问性
- 错误和空状态

## 写入边界

- 可以产出 UI 方案和原型说明。
- 不直接实现生产代码，除非用户明确要求你临时兼任。
- 不修改需求范围、技术方案或质量门禁。
- 不执行 git commit / push / merge。

## 工作原则

- UI 方案必须能被实现员直接执行。
- 每个交互都要有状态反馈。
- 优先贴合项目现有设计，不引入不必要的新视觉体系。
- 不确定时返回问题给架构师或用户。`,
    ),
  },
  {
    id: "implementer",
    fileName: "implementer.md",
    name: "实现员",
    description: "理解需求、设计和项目规范后完成具体实现，不负责 git 提交。",
    content: agentTemplate(
      {
        id: "implementer",
        name: "实现员",
        description: "理解需求、设计和项目规范后完成具体实现，不负责 git 提交。",
      },
      `# 实现员

## 定位

你是蛋黄派工作室的实现员。你先加载任务材料和项目规范，再按计划实现，最后验证并汇报。被派发时只依赖工作室任务上下文、用户提供材料和项目文件；如果上下文不足，先报告阻塞。

## 启动规则

1. 先读取用户任务、PRD、Design、Implement、UI 方案和 Checks；如果存在指定材料，优先读取。
2. 主动读取相关项目规范、相邻代码、测试和已有模式。
3. 如果没有足够上下文，先询问或报告缺失，不要猜测实现范围。
4. 如果已经是被派发的实现员，不再派发新的实现员或检查员；需要并行时只提出建议。

## 核心职责

1. 理解任务需求和验收标准。
2. 按 Design / Implement 计划定位文件和实现路径。
3. 使用项目已有模式完成代码、文档或配置改动。
4. 保持改动范围聚焦，不回滚无关用户修改。
5. 修根因，不用临时掩盖方式绕过问题。
6. 运行相关 lint、type-check、测试或手工验证步骤。
7. 汇报变更文件、验证结果和剩余风险。

## 工作规则

- 编辑前先读相邻代码和调用方。
- 优先复用现有 helper、组件、类型和平台模式。
- 保持类型安全，动态边界需要明确校验。
- 新增 API、配置字段、事件种类或共享常量时，搜索并更新所有消费者。
- 遇到设计与代码现实冲突时，停止扩大改动并反馈。

## 禁止操作

- 不执行 git commit。
- 不执行 git push。
- 不执行 git merge。
- 不私自扩大需求范围。
- 不跳过项目要求的验证步骤。

## 输出格式建议

### Implementation Complete

#### Files Changed

- \`path\` — 改动摘要

#### Verification

- \`command\` — 结果

#### Notes / Risks

- 剩余风险或需要检查员关注的点；没有则写 None。`,
    ),
  },
  {
    id: "checker",
    fileName: "checker.md",
    name: "检查员",
    description: "审查改动是否满足需求、设计和项目规范，可修复范围内小问题并执行验证。",
    content: agentTemplate(
      {
        id: "checker",
        name: "检查员",
        description: "审查改动是否满足需求、设计和项目规范，可修复范围内小问题并执行验证。",
      },
      `# 检查员

## 定位

你是蛋黄派工作室的检查员，负责按需求、设计、实现报告和改动证据进行质量门禁，运行验证，必要时修复范围内低风险小问题并报告结论。被派发时只依赖工作室任务上下文和项目材料；如果上下文不足，先报告缺失。

## 启动规则

1. 先读取 PRD、Design、Implement、UI 方案、Checks 和实现员报告。
2. 检查当前改动、相关调用方、项目规范和验证命令。
3. 如果没有足够上下文，先报告缺失，不要用猜测替代验收标准。
4. 如果已经是被派发的检查员，不再派发新的检查员或实现员；需要返工时只提出建议。

## 核心职责

1. 检查当前 diff 是否完整覆盖需求和验收标准。
2. 对照设计审查边界、数据流、接口契约、兼容性和回滚风险。
3. 对照 UI 方案检查交互、状态、空态、错误态、窄屏和可访问性。
4. 审查代码质量：类型安全、错误处理、路径/权限边界、复用、命名和可维护性。
5. 运行相关 lint、type-check、测试或手工验证。
6. 修复范围内明确且低风险的小问题。
7. 对超出检查范围或需要重新设计的问题，明确交回架构师、UI 设计员或实现员。

## Review Priorities

- 行为回归和遗漏需求。
- 项目规范或平台契约违规。
- 缺失或薄弱的测试 / 验证。
- 路径、权限、跨平台、编码和并发假设。
- 用户可见体验和错误恢复。

## 禁止操作

- 不重新设计功能。
- 不引入新需求。
- 不做大规模重构。
- 不执行 git commit / push / merge。
- 不用“验证无法运行”掩盖可通过静态阅读发现的问题。

## 输出格式建议

### Check Complete

#### Findings Fixed

- 已修复问题；没有则写 None。

#### Remaining Findings

- 阻塞 / 非阻塞问题；没有则写 None。

#### Verification

- \`command\` — 结果

#### Verdict

- Pass / Needs work，并说明原因。`,
    ),
  },
];

const DEFAULT_AGENT_BY_FILE = new Map(DEFAULT_YPI_STUDIO_AGENTS.map((agent) => [agent.fileName, agent]));
const DEFAULT_AGENT_ORDER = new Map(DEFAULT_YPI_STUDIO_AGENTS.map((agent, index) => [agent.fileName, index]));
const OLD_DEFAULT_AGENT_HASHES = new Map<string, string>([
  ["architect.md", "197c251f41768e628e4751bb1327b937869c0f64847e46f8bf05945188a293f9"],
  ["ui-designer.md", "d728c01f248087c6e5196cd0cbef84a2464027cf30e0ff5f69aabed627990a56"],
  ["implementer.md", "c30369447547a9ef80273a17abab0fd398f287c668e3cdb990729c443338b8b7"],
  ["checker.md", "cac89b291d61f596c0c4ace30c8bd604915c31d1ef5a47ea223fbfc4a0f3f1e3"],
]);
const INTERNAL_REFERENCE_MARKERS = [
  "trel" + "lis",
  "task" + ".py",
  "active" + " task",
  "jsonl" + " manifest",
  "check" + ".jsonl",
];

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function containsInternalReference(content: string): boolean {
  const normalized = content.toLowerCase();
  return INTERNAL_REFERENCE_MARKERS.some((marker) => normalized.includes(marker));
}

function internalReferenceWarning(fileName: string, pathLabel: string): YpiStudioAgentWarning {
  return {
    fileName,
    pathLabel,
    message: "该自定义成员仍含内部引用，已跳过覆盖。",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new YpiStudioSecurityError(`Path escapes workspace: ${relativeLabel(workspaceRoot, target)}`);
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

function readFileWithLimit(filePath: string, maxBytes: number): { content: string; truncated: boolean } {
  const stat = statSync(filePath);
  if (stat.size <= maxBytes) {
    return { content: readFileSync(filePath, "utf8"), truncated: false };
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

function createContext(cwd: string): ReaderContext {
  const workspaceRoot = canonicalizeCwd(cwd);
  const stat = statSync(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${cwd}`);
  return {
    cwd: workspaceRoot,
    workspaceRoot,
    agentsRoot: path.join(workspaceRoot, AGENTS_DIR),
  };
}

function parseFrontmatter(content: string): { frontmatter: YpiStudioAgentFrontmatter; body: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }

  const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const marker = `${newline}---${newline}`;
  const end = content.indexOf(marker, 3);
  if (end === -1) return { frontmatter: {}, body: content };

  const raw = content.slice(3 + newline.length, end);
  const frontmatter: YpiStudioAgentFrontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "id" || key === "name" || key === "description" || key === "version") {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: content.slice(end + marker.length) };
}

function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

function readAgentFile(ctx: ReaderContext, fileName: string): YpiStudioAgent {
  const filePath = path.join(ctx.agentsRoot, fileName);
  const pathLabel = relativeLabel(ctx.workspaceRoot, filePath);
  const fallback = DEFAULT_AGENT_BY_FILE.get(fileName);
  try {
    const stat = safeStatFile(filePath, ctx.workspaceRoot);
    if (!stat) throw new Error(`Not a file: ${pathLabel}`);
    const { content, truncated } = readFileWithLimit(filePath, AGENT_MAX_BYTES);
    const { frontmatter, body } = parseFrontmatter(content);
    const stem = fileName.replace(/\.md$/i, "");
    const id = normalizeAgentId(frontmatter.id ?? fallback?.id ?? stem);
    const parsedVersion = frontmatter.version ? Number(frontmatter.version) : undefined;
    return {
      key: fileName,
      id,
      fileName,
      name: frontmatter.name?.trim() || fallback?.name || stem,
      description: frontmatter.description?.trim() || fallback?.description || "项目自定义工作室成员。",
      version: Number.isFinite(parsedVersion) ? parsedVersion : undefined,
      pathLabel,
      content: body,
      truncated,
      isDefault: DEFAULT_AGENT_BY_FILE.has(fileName),
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      frontmatter,
    };
  } catch (error) {
    return {
      key: fileName,
      id: normalizeAgentId(fallback?.id ?? fileName.replace(/\.md$/i, "")),
      fileName,
      name: fallback?.name ?? fileName,
      description: fallback?.description ?? "读取该工作室成员失败。",
      pathLabel,
      content: "",
      truncated: false,
      isDefault: DEFAULT_AGENT_BY_FILE.has(fileName),
      frontmatter: {},
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function sortAgents(a: YpiStudioAgent, b: YpiStudioAgent): number {
  const aOrder = DEFAULT_AGENT_ORDER.get(a.fileName) ?? Number.MAX_SAFE_INTEGER;
  const bOrder = DEFAULT_AGENT_ORDER.get(b.fileName) ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.fileName.localeCompare(b.fileName);
}

function isOldDefaultAgent(ctx: ReaderContext, fileName: string): boolean {
  const expectedHash = OLD_DEFAULT_AGENT_HASHES.get(fileName);
  if (!expectedHash) return false;
  const filePath = path.join(ctx.agentsRoot, fileName);
  try {
    if (!safeStatFile(filePath, ctx.workspaceRoot)) return false;
    return sha256Text(readFileSync(filePath, "utf8")) === expectedHash;
  } catch {
    return false;
  }
}

export function listYpiStudioAgents(cwd: string): YpiStudioAgentsResponse {
  const ctx = createContext(cwd);
  const baseResponse = {
    cwd: ctx.cwd,
    pathLabel: AGENTS_DIR,
  };

  if (!existsSync(ctx.agentsRoot)) {
    return {
      ...baseResponse,
      exists: false,
      agents: [],
      missingDefaultAgents: DEFAULT_YPI_STUDIO_AGENTS.map((agent) => agent.fileName),
      outdatedDefaultAgents: [],
      errors: [],
    };
  }

  assertDirectoryWithinWorkspace(ctx.agentsRoot, ctx.workspaceRoot);

  const agents: YpiStudioAgent[] = [];
  const errors: YpiStudioAgentsResponse["errors"] = [];
  for (const entry of readdirSync(ctx.agentsRoot, { withFileTypes: true })) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.toLowerCase().endsWith(".md")) continue;
    const agent = readAgentFile(ctx, entry.name);
    agents.push(agent);
    if (agent.readError) errors.push({ fileName: entry.name, pathLabel: agent.pathLabel, message: agent.readError });
  }

  const present = new Set(agents.map((agent) => agent.fileName));
  const missingDefaultAgents = DEFAULT_YPI_STUDIO_AGENTS
    .filter((agent) => !present.has(agent.fileName))
    .map((agent) => agent.fileName);
  const outdatedDefaultAgents = DEFAULT_YPI_STUDIO_AGENTS
    .filter((agent) => present.has(agent.fileName) && isOldDefaultAgent(ctx, agent.fileName))
    .map((agent) => agent.fileName);

  return {
    ...baseResponse,
    exists: true,
    agents: agents.sort(sortAgents),
    missingDefaultAgents,
    outdatedDefaultAgents,
    errors,
  };
}

function ensureWritableAgentsRoot(ctx: ReaderContext): void {
  const ypiRoot = path.join(ctx.workspaceRoot, ".ypi");
  if (existsSync(ypiRoot)) {
    assertDirectoryWithinWorkspace(ypiRoot, ctx.workspaceRoot);
  } else {
    mkdirSync(ypiRoot);
  }

  if (existsSync(ctx.agentsRoot)) {
    assertDirectoryWithinWorkspace(ctx.agentsRoot, ctx.workspaceRoot);
  } else {
    mkdirSync(ctx.agentsRoot);
  }
}

interface AgentWriteOutcome {
  result: YpiStudioAgentWriteResult;
  warning?: YpiStudioAgentWarning;
}

function writeDefaultAgent(ctx: ReaderContext, agent: DefaultStudioAgent): AgentWriteOutcome {
  const filePath = path.join(ctx.agentsRoot, agent.fileName);
  const pathLabel = relativeLabel(ctx.workspaceRoot, filePath);
  if (existsSync(filePath)) {
    if (!safeStatFile(filePath, ctx.workspaceRoot)) throw new Error(`Existing agent path is not a file: ${pathLabel}`);
    const existingContent = readFileSync(filePath, "utf8");
    if (OLD_DEFAULT_AGENT_HASHES.get(agent.fileName) === sha256Text(existingContent)) {
      writeFileSync(filePath, agent.content, { encoding: "utf8" });
      safeStatFile(filePath, ctx.workspaceRoot);
      return { result: { id: agent.id, fileName: agent.fileName, pathLabel, status: "updated" } };
    }
    const warning = containsInternalReference(existingContent) ? internalReferenceWarning(agent.fileName, pathLabel) : undefined;
    return { result: { id: agent.id, fileName: agent.fileName, pathLabel, status: "skipped" }, warning };
  }
  writeFileSync(filePath, agent.content, { encoding: "utf8", flag: "wx" });
  safeStatFile(filePath, ctx.workspaceRoot);
  return { result: { id: agent.id, fileName: agent.fileName, pathLabel, status: "created" } };
}

function collectCustomReferenceWarnings(ctx: ReaderContext, knownWarnings: Set<string>): YpiStudioAgentWarning[] {
  const warnings: YpiStudioAgentWarning[] = [];
  for (const entry of readdirSync(ctx.agentsRoot, { withFileTypes: true })) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.toLowerCase().endsWith(".md")) continue;
    if (DEFAULT_AGENT_BY_FILE.has(entry.name) || knownWarnings.has(entry.name)) continue;
    const filePath = path.join(ctx.agentsRoot, entry.name);
    const pathLabel = relativeLabel(ctx.workspaceRoot, filePath);
    try {
      if (!safeStatFile(filePath, ctx.workspaceRoot)) continue;
      const content = readFileSync(filePath, "utf8");
      if (containsInternalReference(content)) warnings.push(internalReferenceWarning(entry.name, pathLabel));
    } catch {
      // Read errors are reported by listYpiStudioAgents; warning detection should not block initialization.
    }
  }
  return warnings;
}

export function initializeYpiStudioAgents(cwd: string): YpiStudioAgentsInitResponse {
  const ctx = createContext(cwd);
  ensureWritableAgentsRoot(ctx);

  const created: YpiStudioAgentWriteResult[] = [];
  const updated: YpiStudioAgentWriteResult[] = [];
  const skipped: YpiStudioAgentWriteResult[] = [];
  const warnings: YpiStudioAgentWarning[] = [];
  for (const agent of DEFAULT_YPI_STUDIO_AGENTS) {
    const { result, warning } = writeDefaultAgent(ctx, agent);
    if (result.status === "created") created.push(result);
    else if (result.status === "updated") updated.push(result);
    else skipped.push(result);
    if (warning) warnings.push(warning);
  }
  warnings.push(...collectCustomReferenceWarnings(ctx, new Set(warnings.map((warning) => warning.fileName))));

  const agents = listYpiStudioAgents(ctx.cwd);
  return {
    cwd: ctx.cwd,
    pathLabel: AGENTS_DIR,
    created,
    updated,
    skipped,
    warnings,
    agents,
  };
}

export function isYpiStudioAgentsInitBody(value: unknown): value is { cwd: string } {
  return isRecord(value) && typeof value.cwd === "string" && value.cwd.trim().length > 0;
}
