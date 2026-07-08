# Design — 计划审批书预览与产物去重

## 方案摘要

采用结构化 artifact 而非 Chat 路径识别：新增 `plan-review.md` 作为 YPI Studio 审批阶段的主入口，在任务详情中新增“审批书/计划审批”预览 Tab。该 Tab 渲染计划审批书 Markdown，并拦截其中的相对链接，将链接解析为当前任务目录内文件后打开。产物 Tab 改为 canonical artifact item 列表，按文件名/映射去重，避免 `prd` 与 `prd.md` 重复。

核心原则：

- 审批书是任务目录内的标准产物：`plan-review` -> `plan-review.md`。
- Markdown 链接只允许当前任务目录内的相对路径。
- 审批预览不改变审批门禁；用户仍需在绑定上下文中明确批准。
- UI 原型门禁必须先由 UI 设计员产出 HTML 原型并取得用户确认。

## 影响模块和边界

### 后端 / shared lib

- `lib/ypi-studio-tasks.ts`
  - `DEFAULT_ARTIFACTS` 增加 `"plan-review": "plan-review.md"`。
  - 新任务创建时生成 `plan-review.md` 占位文件。
  - 任务 record normalization 对旧任务做兼容：读取时补齐默认 artifact 映射，确保旧任务也能通过 artifact API 写入 `plan-review.md`。
  - `transitionYpiStudioTask(... to: "awaiting_approval")` 增加校验：`plan-review.md` 必须存在且非 TBD/空内容；若当前 workflow 需要 UI 原型，还应在审批书中能看到 UI 原型说明/链接（强校验 HTML 文件存在可作为增强，不作为 MVP 必需，避免误伤非 UI 流程）。
  - 新增纯函数用于 artifact 解析/去重，供前端或 route projection 复用时优先放在 shared lib/types；若只在组件内使用，可先局部实现。

- `lib/ypi-studio-workflows.ts`
  - `planning` / `awaiting_approval` 的 requiredArtifacts 增加 `plan-review.md`。
  - 保持 `ui-change` workflow 对 `ui.md` / HTML 原型的要求不变，并在 state instruction 中提示审批书应链接 HTML 原型。

- `lib/ypi-studio-extension.ts`
  - 更新 Studio prompt/工具提示：架构师在转入 `awaiting_approval` 前必须写 `plan-review.md`，且 UI 变化必须等待 UI designer HTML 原型。
  - 不改变 approvalGrant 记录逻辑。

- 可选新增 route：`app/api/studio/tasks/[taskKey]/files/route.ts`
  - 用于安全读取/预览当前任务目录下相对文件。
  - 入参：`cwd`、`path`、`mode=meta|read|preview`。
  - 服务端通过 taskKey 定位 task dir，再解析 `path`，拒绝绝对路径、URL、`..`、符号链接逃逸。
  - `preview` 仅用于 `.html` 等安全白名单；返回 CSP/sandbox 头，阻断外部网络、表单、top navigation，允许必要的 inline style/script 以支持静态原型。
  - 若不新增 route，MVP 可先用现有 `onOpenFile` + FileViewer 打开文件；HTML 新窗口预览后续增强。

### 前端

- `components/YpiStudioPanel.tsx`
  - `TaskDetailTab` 增加 `"approval"`。
  - 任务详情 tab bar 增加“审批书”Tab；当 status 为 `planning` / `awaiting_approval` / `changes_requested` 或存在 `plan-review.md` 时优先显示，可默认选中 awaiting_approval 任务的审批书 Tab。
  - 新增 `TaskApprovalTab`：展示计划审批书、审批 gate 状态、快捷打开关键产物、缺失提示。
  - `MarkdownBody` 增加可选 link override，或新增 `TaskMarkdownPreview` 专用于审批书相对链接拦截。
  - `TaskArtifactsTab` 改为 canonical item 列表，不再直接 `new Set([...values, ...keys, ...required, ...documents])`。

- `components/MarkdownBody.tsx`
  - 推荐增加可选 prop：`onLinkClick?: (href: string, label: string, event: MouseEvent) => void | boolean`。
  - 默认行为不变，避免影响 Chat Markdown。
  - YPI Studio 审批书预览传入 link handler；普通 Chat 不启用。

- `components/FileViewer.tsx`
  - 可选增强：打开 HTML 文件时支持初始预览模式（例如 `initialPreviewMode`），这样从审批书点击 HTML 原型可以直接看到渲染效果。
  - 若不改 FileViewer，则审批 Tab 可提供“打开文件”和“新窗口预览”两个按钮。

## 数据流 / API / 文件契约

### 计划审批书 artifact 契约

```json
{
  "artifacts": {
    "plan-review": "plan-review.md",
    "brief": "brief.md",
    "prd": "prd.md",
    "ui": "ui.md",
    "design": "design.md",
    "implement": "implement.md",
    "checks": "checks.md"
  }
}
```

推荐 `plan-review.md` 内容结构：

```md
# 蛋黄派计划审批书

## 审批请求
请审阅本任务方案。确认后回复“确认/批准/开始实现”。

## 任务概览
- 目标：...
- 范围外：...

## 必读产物
- [PRD](./prd.md)
- [Design](./design.md)
- [Implementation Plan](./implement.md)
- [Checks](./checks.md)

## UI / 原型
- UI 门禁：已触发 / 未触发
- [HTML 原型](./ui-prototype.html)
- [UI 说明](./ui.md)

## 关键风险与需要用户确认的决定
1. ...
```

命名规则：

- 存储文件名固定为 ASCII：`plan-review.md`，避免当前 artifact 安全校验不支持中文文件名。
- UI 显示名为“计划审批书”或“蛋黄派计划审批书”。
- 不建议使用 `计划审批书.md` 作为实际文件名；可在文档标题中使用中文。

### 相对链接解析规则

输入：Markdown anchor `href`。

允许：

- `./file.md`
- `file.md`
- `prototype/ui.html`
- `images/mock.png#section`（hash 可保留给打开端，文件解析时剥离）

拒绝：

- `http://...`、`https://...`、`file://...`、`javascript:...`、`data:...`
- `/absolute/path`
- `../other-task/file.md`
- 空路径、目录路径、Windows drive path

解析步骤：

1. `href` 先去掉 query/hash 中用于文件解析的部分，hash 可作为后续锚点信息保存。
2. 使用 POSIX 规则 normalize。
3. 若 normalized 为空、以 `..` 开头、包含 `\0`、以 `/` 开头，拒绝。
4. 拼接 `taskDir = cwd + "/" + task.pathLabel`。
5. 服务端 route 或客户端打开前都再次校验路径仍在 `taskDir` 下；服务端校验为安全边界。

打开策略：

- `.md` / text：`onOpenFile(absPath, basename)` 打开项目 FileViewer。
- `.html`：优先 `window.open(/api/studio/tasks/[taskKey]/files?cwd=...&path=...&mode=preview)`；若 route 未实现，回退 `onOpenFile` 并让 FileViewer 预览。
- image/pdf/audio：使用 FileViewer 现有预览能力。
- 不支持类型：打开源文件或显示错误。

### 产物 canonical item 规则

定义内部显示项：

```ts
interface StudioArtifactItem {
  key: string;          // artifact key，优先 task.artifacts 的 key；虚拟项用 fileName
  fileName: string;     // canonical 去重键
  label: string;        // 计划审批书 / PRD / design.md 等
  required: boolean;
  optional: boolean;
  completed: boolean;
  document?: YpiStudioTaskDocument;
  sourceRefs: string[]; // key/fileName/required/document 来源，供 debug
  order: number;
}
```

去重键：

- 首选 `fileName`，大小写按当前文件系统显示保持，但比较可用 exact string；跨平台保守可同时保存 lowercase key 用于 UI 去重。
- `prd`、`prd.md`、documents 中的 `prd.md` 均 resolve 到 `fileName=prd.md`。
- 同一文件多个 artifact key 时合并，label 优先顺序：特殊显示名（plan-review/PRD/UI）> artifact key > fileName。

排序：

1. `plan-review.md`
2. 当前 workflow `requiredArtifacts` 顺序
3. 当前 workflow `optionalArtifacts` 顺序
4. `DEFAULT_ARTIFACTS` / `task.artifacts` 映射顺序
5. `task.documents` 中额外文件名
6. 字母序兜底

完成状态：

- 若 `progress.completedArtifacts` 中任一 ref resolve 到该 item，则 completed。
- 或对应 document 存在且内容非空、非 `_TBD by YPI Studio workflow._`、不匹配 `TBD|待填写|YPI Studio workflow`。
- 必需/可选状态按 required/optional ref normalize 后判断。

## UI 设计员 HTML 原型要求

本任务触发 UI 原型门禁。主会话应调度 UI 设计员产出 HTML 原型，至少覆盖：

1. 任务详情新增“审批书”Tab 的布局。
2. `awaiting_approval` 任务打开时如何突出“请审阅计划审批书”。
3. 计划审批书 Markdown 预览、链接 hover/click、非法链接错误提示。
4. HTML 原型链接的打开方式：FileViewer 内预览 / 新窗口预览按钮。
5. 缺失 `plan-review.md` 或计划书仍是 TBD 时的空状态与补救提示。
6. 产物 Tab 去重后的排序、完成状态 badge、必需/可选标签。

验收点：HTML 原型必须基于现有 YPI Studio Panel 视觉语言，不得只用 Markdown 说明替代；用户确认原型后才能进入实现。

## 兼容性、风险、回滚

### 兼容性

- 旧任务没有 `plan-review.md` 时，审批 Tab 显示缺失提示；不破坏读取。
- 旧任务若已完成/归档，不强制补计划审批书。
- Workflow requiredArtifacts 增加 `plan-review.md` 后，仍可通过 artifact API 写入补齐。
- 普通 Chat Markdown 行为保持不变。

### 风险与缓解

- **风险：预览 HTML 脚本安全。** 使用 task-bound route、CSP sandbox、禁止外部资源和 top navigation；默认 FileViewer iframe sandbox。
- **风险：链接解析绕过任务目录。** 客户端只做 UX，服务端 route 做最终安全校验；拒绝 URL scheme/absolute/`..`。
- **风险：旧任务产物列表新增 plan-review 导致噪音。** 只在审批相关状态突出；产物 Tab 可显示缺失但不阻塞已完成/归档任务。
- **风险：把审批预览误认为已批准。** UI 文案明确“预览不等于批准”；实现 gate 仍由 server approvalGrant 控制。

### 回滚方案

- 回滚 UI：隐藏/移除 `approval` Tab，保留原 Artifacts Tab。
- 回滚后端 gate：移除 `plan-review.md` requiredArtifacts 与 awaiting transition 校验；已生成的 `plan-review.md` 作为普通文件保留，不影响任务读取。
- 回滚 preview route：链接回退为 FileViewer 打开源文件。
