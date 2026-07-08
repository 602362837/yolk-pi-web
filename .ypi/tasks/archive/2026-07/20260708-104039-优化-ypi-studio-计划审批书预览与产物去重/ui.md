# UI 设计说明 — YPI Studio 计划审批书预览与产物去重

本交互与视觉方案设计由 **UI 设计员 (ui-designer)** 完成。我们为本任务设计了完整的 HTML 原型，以确保实现员能够快速还原并满足用户的视觉与交互期望。

## HTML 交互原型

- **原型路径**：[ui-prototype.html](./ui-prototype.html)
- **原型预览命令**：你可以使用浏览器直接打开上述文件。

---

## 交互方案设计重点

### 1. 新增“计划审批书/审阅”入口 (Tab)
- **位置**：在 `YpiStudioPanel.tsx` 任务详情的 Tab 条中，新增 `"approval"` (计划审批书) Tab 作为第一顺位。
- **状态高亮**：
  - 当任务状态为 `awaiting_approval` 时，此 Tab 右上角会有金色呼吸高亮，提示用户优先审阅此处的计划书。
  - 任务详情面板打开时，如果状态为 `awaiting_approval`，应**默认激活并选中**此 Tab。

### 2. 计划审批书 Markdown 预览与链接拦截
- **功能**：通过定制 `MarkdownBody` 的链接行为，为 `TaskApprovalTab` 注入相对链接拦截器。
- **拦截逻辑**：
  - 客户端拦截：识别 Markdown 内所有的 `[Label](path)`。
  - 非法链接拦截：
    - 开头包含 `http`/`https` 的外部 URL 或者是绝对路径时，拒绝点击并提示 `❌ 安全阻止：拒绝访问外部或绝对路径`。
    - 路径中包含 `..` (逃逸字符) 时，拒绝点击并提示 `❌ 安全阻止：路径包含 ".." 越权逃逸风险`。
  - 合法链接处理：
    - 若为 `.md` 等文本文件，拦截后调用 `onOpenFile` 打开 Pi Web App 的 `FileViewer`。
    - 若为 `.html` (如静态交互原型)，呼起专属 Preview API。在 `FileViewer` 中采用 `CSP sandboxed iframe` 预览或独立受限窗口 `window.open` 渲染，隔离脚本权限以确保 Workspace 数据安全。

### 3. 产物 Tab 去重与排序规则
- **去重前问题**：之前的产物 Tab 简单的取了 required, optional, documents 等多个 Set 的并集，导致同一个文件（如 `prd` / `prd.md`）会同时出现，显得冗余混乱。
- **去重规则**：
  - 引入 `buildStudioArtifactItems(task)` 统一将 key 映射到 `fileName` 作为去重键。
  - `prd`, `prd.md`, 以及 required 属性的 `prd` 均去重解析为 `prd.md` canonical 实体。
- **排序规范**：
  - 1. **计划审批书** (`plan-review.md`)：永远排在首位。
  - 2. **必需产物** (`requiredArtifacts` 成员)：由前至后展示。
  - 3. **可选产物/其他产物** (`optionalArtifacts` 及 documents 成员)：排在后续。

### 4. 缺失/空状态与补救提示 (Scenario 2)
- 如果任务仍处于 `planning` 阶段，或未检测到 `plan-review.md` 产物，审批 Tab 将展现**空状态警示**。
- 引导文案提示：“当前任务规划未完成。需要架构师或成员在此任务目录下创建并写入 plan-review.md”。
- 提供“生成计划审批书模板”快捷按钮以便架构师快速补齐。

---

## UI 验收清单 (UI Checks)

1. [ ] 打开 `awaiting_approval` 状态的任务时，默认激活并选中“计划审批书”Tab，且该 Tab 带有金色高亮提示。
2. [ ] 计划审批书中的相对链接 `[PRD](./prd.md)` 点击能呼起系统 FileViewer 打开对应文件。
3. [ ] 计划审批书中包含 `..` 的越权链接 `[非法](../other-task/task.json)` 或外部 URL 点击能被前端拦截并弹出 Error Toast，阻止越权导航。
4. [ ] 计划审批书中的 `.html` 原型链接可选择“独立安全沙箱窗口预览”，且采用 `CSP Sandbox` 策略。
5. [ ] 产物 Tab 中 `prd.md` 与 `prd` 被合并为单一项展示，不存在同名冗余。
6. [ ] 产物排序满足 `plan-review.md -> 必需产物 -> 可选产物` 这一固定结构，不因渲染顺序抖动。
