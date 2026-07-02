# ui

## UI Summary

### 设计目标

- 保持现有 YPI Studio 右侧面板结构，不新增独立页面或新视觉体系。
- Members tab 中的成员卡片、成员 Markdown 预览、初始化反馈都只呈现“蛋黄派工作室 / YPI Studio”自身语义。
- 安全迁移发生时，让用户明确知道哪些默认成员被创建或更新、哪些自定义成员没有被覆盖，以及是否需要手动处理残留内部引用。

### 用户路径

1. 用户打开右侧“工作室”面板。
2. 未初始化或缺少默认配置时，点击“初始化工作室 / 补齐默认配置”。
3. 系统创建缺失默认成员，或更新可判定为旧版默认模板的成员。
4. 面板顶部用现有 Notice 给出结果；Members tab 继续展示成员卡片与 Markdown 预览。
5. 如自定义成员仍含旧内部引用，提示用户“已跳过覆盖”，用户可通过“打开文件”自行处理。

### 信息架构

- Header：工作室标题、当前 `.ypi/` 路径、初始化/检查按钮、初始化说明、结果 Notice。
- Tabs：成员 / 流程 / 任务，保持当前切换方式。
- Members 列表：成员卡片展示 `name`、`description`、默认/自定义标签、文件路径。
- Member Detail：展示成员 Markdown 正文和“打开文件”入口；不做运行时遮罩或自动替换，内容以文件为准。

## User-Facing Copy Boundary

### Members tab / 成员预览允许出现

- “蛋黄派工作室”“YPI Studio”“工作室任务”“成员”“流程”“任务产物”。
- “需求 / PRD / UI / Design / Implement / Checks / 检查”。
- “项目上下文”“项目规范”“现有页面和组件模式”“实现报告”“验证命令”。
- 通用方法表达：先读取上下文、将需求转化为规划、按计划实现、按证据检查。

### 默认成员模板与新初始化成员不应出现

- `Trellis` / `trellis` / `.trellis`。
- `task.py`、`active task`、`jsonl manifest`、`check.jsonl`。
- `Trellis Design Agent`、`Trellis Implement Agent`、`Trellis Check Agent` 等来源直指。
- “参考某内部系统/代理”的句式；如需表达方法论，改为“采用工作室任务的上下文优先方式”。

### 自定义成员处理边界

- 自定义成员预览仍按文件原文展示，不建议 UI 层隐藏或改写内容，避免用户看到的内容与实际派发提示词不一致。
- 如果初始化检测到自定义成员仍含旧内部引用，只显示 warning，明确“已跳过覆盖”。

## Prototype

```text
┌────────────────────────────────────────────┐
│ 工作室                              [补齐默认配置] │
│ …/project · .ypi/                            │
│ 工作室包含成员、结构化流程和任务状态机。初始化只补齐… │
│ [成员 4] [流程 4] [任务 1]                    │
│ ✅ 已更新 4 个旧版默认成员；自定义成员未覆盖。       │
│ ⚠️ 发现 1 个自定义成员仍含内部引用，已跳过覆盖：x.md │
├────────────────────────────────────────────┤
│ 成员卡片网格                                 │
│ ┌架构师 默认┐ ┌UI 设计员 默认┐ …              │
├────────────────────────────────────────────┤
│ 成员详情                                      │
│ 架构师                                [打开文件] │
│ .ypi/agents/architect.md                     │
│ ┌ MarkdownBody: 纯 YPI Studio 成员说明 ┐       │
└────────────────────────────────────────────┘
```

## Init Feedback Copy

| 场景 | 展示位置 | 推荐文案 |
| --- | --- | --- |
| 创建缺失默认成员/流程 | Header success Notice | `已创建 {createdAgents} 个成员、{createdWorkflows} 个流程；已有自定义文件未覆盖。` |
| 更新旧版默认成员 | Header success Notice | `已更新 {updatedAgents} 个旧版默认成员；自定义成员未覆盖。` |
| 创建与更新同时发生 | Header success Notice | `已创建 {createdAgents} 个成员、{createdWorkflows} 个流程，已更新 {updatedAgents} 个旧版默认成员；自定义成员未覆盖。` |
| 无需变更 | Header success Notice | `默认成员和流程已是最新，没有覆盖自定义内容。` |
| 自定义成员含旧内部引用 | Header warning Notice | `发现 {count} 个自定义成员仍含内部引用，已跳过覆盖：{fileNames}。可打开文件手动清理。` |
| 文件读取/写入失败 | Header error Notice | 沿用现有错误 Notice，展示后端错误信息。 |

文案规则：

- `updated` 只用于“完全匹配旧版默认模板并已自动替换”的成员。
- `skipped` 不应让用户误解为失败；只有存在风险内容时才额外显示 warning。
- warning 文件名过多时建议显示前 3 个并追加“等 {count} 个”，避免撑高面板。

## Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 未初始化成员 | `PanelEmpty`：尚未初始化成员 | 点击“初始化工作室” | 创建默认成员，切回 ready，显示 success Notice |
| 缺少部分默认成员 | 按钮为“补齐默认配置” | 点击按钮 | 创建缺失成员；不覆盖自定义文件 |
| 存在旧版默认成员 | Members 仍可预览旧内容，直到用户点击初始化/补齐 | 点击按钮 | 自动更新旧版默认成员，重新加载列表和预览 |
| 自定义成员含旧内部引用 | 成员原文仍可预览 | 点击初始化/补齐 | 不覆盖；显示 warning Notice 和文件名 |
| 初始化中 | 按钮禁用，文案“处理中…” | 无 | 防止重复提交 |
| 初始化成功 | Header success Notice | 可继续切换 Members/Workflows/Tasks | Notice 保留到下次刷新或重新初始化 |
| 初始化失败 | Header error Notice | 用户可重试或打开文件检查 | 不改变现有列表状态 |
| 成员正文过长 | 沿用截断 warning | 打开文件 | 通过文件查看器查看完整内容 |
| 窄屏/右侧抽屉较窄 | 卡片网格自然变为单列，Notice 自动换行 | 滚动查看 | 不新增横向滚动 |

## Implementation Notes

- 复用 `components/YpiStudioPanel.tsx` 现有结构：`Notice`、`TabButton`、`AgentCard`、`AgentDetail`、`MarkdownBody`。
- 不需要新增弹窗、确认框、批量修复入口或新图标体系。
- 如果后端扩展 `YpiStudioAgentsInitResponse`，UI 只需读取 `updated` 和 `warnings`：
  - `updated.length` 参与 success 文案。
  - `warnings` 渲染为 `Notice tone="warning"`，放在 `initMessage` 下方或合并为一条 warning 文案。
- 若 warning 采用结构化数据，推荐字段：`fileName`、`pathLabel`、`message`；UI 展示短文件名，详细路径可通过成员卡片/打开文件获得。
- 成员预览必须来自清理后的 `.ypi/agents/<member>.md`，不要在 UI 层做字符串替换；这样预览与实际派发成员定义保持一致。
- 可访问性：按钮保持原生 `button`，处理中禁用；Notice 使用纯文本，颜色不是唯一信息来源，文案中包含“已更新/发现/失败”等状态词。

## UI Checks

- [ ] Members tab 默认四个成员卡片 description 不出现内部来源直指。
- [ ] 默认四个成员 Markdown 预览不出现 `Trellis`、`.trellis`、`task.py`、`active task`、`jsonl manifest`、`check.jsonl` 等词。
- [ ] 初始化成功文案能同时表达 created、updated、skipped 且不暗示覆盖自定义成员。
- [ ] 自定义成员含旧内部引用时显示 warning，并明确“已跳过覆盖”。
- [ ] 不新增 modal、确认流或新视觉组件；整体仍符合现有工作室面板风格。
- [ ] 窄屏下 Notice、成员卡片和 Markdown 预览不产生横向溢出。
- [ ] “打开文件”仍可用于手动处理自定义成员。

## Decision Needed

- 主会话需决定后端 warning 的返回形态：简单 `string[]` 或结构化 `{ fileName, pathLabel, message }[]`。UI 推荐结构化，方便展示文件名并保留路径。