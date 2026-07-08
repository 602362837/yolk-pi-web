# ui

## 是否需要 UI 设计员

本次不建议立即另派 UI 设计员：4 个修复主要是现有控件的语义、搜索匹配和 Studio 文案/门禁强化，没有新增页面布局或复杂视觉方案。受本 delegated member 约束，本次也不 dispatch 其他成员。

但第 2 项本身必须把以下规则写入未来架构流程门禁：凡涉及页面变更、前端功能新增、交互变化或审批体验变化，架构师必须指派 UI 设计员，UI 设计员必须基于现有项目产出 HTML 格式原型并交给用户审批；未审批前不得进入实现。

## 当前 UI / 交互要点

### 项目下拉

- “Choose project folder…” 文案可保留，但行为必须是“添加项目”。
- 新项目创建成功：关闭下拉，选中新项目主空间。
- 重复项目：不切换，保留当前项目，内联提示“Project already exists. Select it from the list to switch.”。

### Tab 标题

- 用户可见规则：`项目名(空间名)` 优先。
- fallback（目录名/分支）只用于没有项目上下文或未登记 workspace。

### 模型选择下拉

- 搜索提示文案建议从“支持实时模糊跳跃搜索，例如 gpt4、sonnet、dsr1”扩展为“支持模型、provider / 提供商名称搜索”。
- 选项 detail 可展示 provider display name + `provider/modelId`，但 value 不变。

## 未来 UI 原型门禁声明

- 架构师判断任务触发 UI 门禁的条件：页面变更、前端功能新增、已有交互变化、审批/确认体验变化、用户可见信息结构变化。
- UI 设计员交付：`ui.md` 中包含自包含 HTML prototype（fenced `html` 或 `.html` 文件路径）、交互状态表、实现注意点、UI 检查清单。
- 用户审批：架构师/主会话在 `awaiting_approval` 前明确要求用户审阅 HTML 原型；未确认时不得派实现员。
