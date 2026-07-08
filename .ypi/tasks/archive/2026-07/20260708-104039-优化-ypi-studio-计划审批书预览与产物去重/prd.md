# PRD — YPI Studio 计划审批书预览与产物去重

## 目标与背景

YPI Studio 任务进入 `awaiting_approval` 时，用户需要审阅 PRD、设计、实现计划、检查清单以及 UI HTML 原型。当前 Chat 主要展示文件路径，用户需要手动打开多个文件；任务详情“产物”Tab 又会把同一产物的 artifact key、文件名、requiredArtifacts 和 documents 展示成多个重复项。

本任务目标是在不改变 `awaiting_approval -> implementing` 硬门禁的前提下，引入标准 `plan-review.md`（显示名：计划审批书）作为审批阶段的主审阅入口，并在任务详情提供专用预览 Tab，支持计划审批书中的 Markdown 相对链接打开本任务目录内的产物或 HTML 原型，同时修复产物 Tab 去重与排序。

## 范围内

1. **计划审批书 artifact**
   - 新增标准 artifact：`plan-review` -> `plan-review.md`。
   - `plan-review.md` 是 `awaiting_approval` 前必须生成/补齐的审批入口文件。
   - 文件内容使用标准 Markdown 链接引用同一任务目录内的 `prd.md`、`design.md`、`implement.md`、`checks.md`、`ui.md`、HTML 原型等。

2. **任务详情审批预览入口**
   - 在 YPI Studio 任务详情新增“审批书/计划审批”专用入口或 Tab。
   - 优先展示 `plan-review.md`；缺失时展示明确的待补齐提示和已有关键产物快捷入口。
   - 支持点击 Markdown 相对链接，并限制链接只能解析到当前任务目录内部文件。

3. **链接打开方式**
   - `.md`、源码、图片等文件优先通过现有项目 FileViewer 打开。
   - `.html` UI 原型可通过 FileViewer 预览，或通过受限的 Studio task preview API + `window.open` 打开独立预览页。
   - 禁止把普通 Chat Markdown 中的任意路径自动识别为文件预览入口。

4. **产物 Tab 去重**
   - 修复 `TaskArtifactsTab` 中 artifact key / 文件名 / workflow requiredArtifacts / documents 组合导致的重复展示。
   - 统一 canonical artifact item、排序与完成状态计算。

5. **UI 原型门禁**
   - 本任务改变前端交互、审批体验和用户可见信息结构，必须由 UI 设计员基于当前项目产出 HTML 原型，并在用户确认后才能实现。

## 范围外

- 不改变 `awaiting_approval -> implementing` 的 `approvalGate` / `approvalGrant` 语义。
- 不允许 `override` 绕过用户审批。
- 不做全局 Chat 文本路径自动识别。
- 不把任务目录外文件作为计划审批书链接目标。
- 不在本规划阶段实现生产代码。

## 需求与验收标准

### R1. 标准计划审批书

- 需求：新任务默认包含 `plan-review.md` artifact；架构师进入 `awaiting_approval` 前必须写入有意义内容。
- 验收：新建 Studio 任务目录中包含 `plan-review.md`；任务转入 `awaiting_approval` 时该文件不是 TBD/空内容。

### R2. 专用审批预览入口

- 需求：任务详情提供“审批书/计划审批”入口，展示 `plan-review.md` 的 Markdown 预览。
- 验收：用户打开 awaiting_approval 任务时，无需从 Chat 手工复制路径即可看到计划审批书。

### R3. Markdown 相对链接

- 需求：计划审批书中的 `[UI 原型](./ui-prototype.html)`、`[设计](./design.md)` 等相对链接可点击。
- 验收：合法相对链接能打开当前任务目录内文件；绝对路径、URL scheme、`..` 逃逸、跨任务目录链接被拒绝并给出提示。

### R4. HTML 原型打开

- 需求：HTML 原型链接可通过项目内预览或新窗口安全打开。
- 验收：点击 `.html` 链接能看到渲染后的 HTML 原型；预览 API/iframe 使用受限 CSP/sandbox，不开放任务目录外文件读取。

### R5. 产物去重

- 需求：产物 Tab 中同一文件只展示一次。
- 验收：`prd`、`prd.md`、requiredArtifacts 中的 `prd.md`、documents 中的 `prd.md` 合并成一个 Tab；显示完成/必需/可选状态正确。

### R6. 排序与展示

- 需求：审批书优先，其次 requiredArtifacts 顺序、optionalArtifacts 顺序、剩余 artifact 映射、额外 documents。
- 验收：`plan-review.md` 位于审批相关入口最前；常规产物顺序稳定，不因对象枚举来源重复而跳动。

### R7. 门禁保持不变

- 需求：审批预览只是审阅入口，不授予实现权限。
- 验收：未记录当前 bound context 的显式用户批准时，`awaiting_approval -> implementing` 仍失败。

## 未决问题

1. UI 原型的最终交互样式需 UI 设计员给出 HTML 原型并由用户确认。
2. HTML 独立预览是否首版必须 `window.open`，还是 FileViewer 内预览即可作为 MVP，需要主会话/用户确认；推荐首版同时支持 FileViewer，HTML 新窗口作为增强。
