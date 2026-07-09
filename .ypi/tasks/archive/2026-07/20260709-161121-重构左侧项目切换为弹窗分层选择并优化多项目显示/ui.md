# ui

## UI prototype gate

本任务触发 UI 原型门禁：它改变左侧项目切换入口、已有交互方式和用户可见信息结构。进入实现前必须由主会话/用户审阅 HTML 原型并明确确认。

- HTML 原型：[`project-switch-modal-prototype.html`](project-switch-modal-prototype.html) (具有高可玩性的交互式原型，支持普通/多项目/零项目状态切换、添加与搜索模拟)。
- 设计状态：已由 UI 设计员审查并完善，等待用户最终确认。
- 审批请求：请确认是否接受“左侧顶部切换按钮 + 分层项目/空间弹窗 + 空环境 onboarding”的交互方向与原型细节。

> 注：当前 delegated run 没有实际派发另一个 Studio member 的工具调用；请主会话按 workflow 将本原型交给 `ui-designer` 审阅或直接提交给用户审批。纯 Markdown 不能替代上述 HTML 原型。

## UI Summary

### 设计目标

- 解决项目多时 dropdown 在窄 sidebar 内显示错乱的问题。
- 用更大的 modal 承载复杂选择，保持层级：项目 → 项目空间。
- 让新用户在没有任何项目时也能从左侧顶部入口完成首次添加。

### 用户路径

1. 用户查看左侧顶部当前项目空间按钮。
2. 点击按钮打开“切换项目空间”弹窗。
3. 左侧选择项目，右侧选择该项目下的主空间或 WorkTree 空间。
4. 点击可用空间后立即切换并关闭弹窗。
5. 若没有项目，弹窗直接显示添加第一个项目的引导。

### 信息架构

- Sidebar 顶部按钮：当前项目名、空间名/分支/路径摘要、chevron。
- Modal header：标题、说明、关闭按钮。
- Modal body：
  - 左栏：搜索、项目列表、添加入口。
  - 右栏：所选项目信息、空间列表、空项目/无匹配状态。
- Modal footer：说明“不扫描历史 sessions 合成项目”、刷新/关闭等辅助动作。

## Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 默认已有项目 | 当前项目高亮，右侧列出空间 | 选择项目/空间 | 项目仅改变右侧列表；空间切换 cwd |
| 项目很多 | 左右列表独立滚动，搜索框固定 | 输入关键词 | 过滤项目/空间，保持层级 |
| 空 registry | onboarding 卡片 | 添加文件夹/路径/Git/default | 成功后选中 main 空间 |
| missing 空间 | 行禁用、显示路径缺失 | 点击禁用行 | 不切换，可通过 tooltip/副文案理解原因 |
| WorkTree 空间 | WT badge、branch/base | 右键/点击 | 右键打开 WorkTree 菜单；点击切换 |
| 表单错误 | 错误显示在表单附近 | 修改输入重试 | 错误清除/更新 |
| 关闭 | backdrop/ESC/关闭按钮 | 关闭弹窗 | 清理临时表单，焦点回到触发按钮 |

## Implementation Notes

- 复用现有 CSS 变量：`--bg`、`--bg-panel`、`--bg-hover`、`--bg-selected`、`--border`、`--text`、`--text-muted`、`--text-dim`、`--accent`。
- 复用现有 helper：`displayProjectName`、`displaySpaceName`、`shortenCwd`、`activeProjectSpaces`、`sortProjectsForSidebar`、`WorktreeBadge`。
- 弹窗建议使用 fixed overlay，`z-index` 高于 sidebar menus，最大宽高受 viewport 限制。
- 长文本必须设置 `minWidth: 0`、`overflow: hidden`、`textOverflow: ellipsis`。
- 表单区域沿用现有文案：`Add project folder…`、`Add project path…`、`Add project from Git…`、`Use default directory`。

## UI Checks

- [ ] HTML 原型已被用户或 UI 设计员确认。
- [ ] 入口不是 dropdown；弹窗不受 sidebar 宽度裁切。
- [ ] 分层选择路径在视觉上清晰。
- [ ] 空状态可以完成首次添加项目。
- [ ] 键盘、焦点、Esc、关闭按钮可用。
- [ ] 暗色/亮色变量下对比度可读。
