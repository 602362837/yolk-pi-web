# UI

## 原型门禁

本任务改变任务浮窗和审批材料查看体验，**已触发 UI 原型硬门禁**。架构师已明确派发 UI 设计员；UI 设计员已基于现有 `YpiStudioSessionWidget`、任务详情审批预览、主题变量和 Markdown 样式交付自包含 HTML 原型。

- [HTML 原型：ui-prototype.html](./ui-prototype.html)
- [UI 设计员说明与状态矩阵](./ui-designer-notes.md)

当前状态：**等待用户/主会话审批 HTML 原型**。未获明确批准前不得进入实现。

## 页面与组件

### 浮窗卡片入口

- 主任务仅在 `awaiting_approval` 显示紧凑次级按钮「计划审批书」。
- 每个 `waiting_plan_approval` 改进项显示「计划审批书 · IMP-xxx」。
- 入口置于状态元信息之后的独立 action row，允许换行；不占顶行详情箭头，不改变 360px 宽度。
- 按钮使用 amber waiting 语义，但仍是“查看”而非“批准”主操作。

### 预览弹窗

- 桌面：居中 modal，宽度建议 `min(760px, calc(100vw - 32px))`，最大高度约 `82dvh`。
- 移动：从现有 Studio bottom sheet 进入，预览为接近全屏的底部 modal，并保留 safe-area。
- Header 展示只读类型、任务标题、文件名/改进编号和关闭按钮。
- 固定提示：「预览不会自动批准计划，仍需在绑定聊天中明确回复确认或提出修改。」
- 正文使用 `MarkdownBody`，独立滚动；header、只读提示和 footer 不随正文滚走。

## 用户路径

1. 用户在浮窗看到任务/改进项处于等待计划审批。
2. 点击对应「计划审批书」入口。
3. 弹窗进入 loading，并按需读取对应 `plan-review.md`。
4. 成功后渲染 Markdown；相对链接按 task-local 规则打开。
5. 用户关闭弹窗，仍停留在当前聊天；随后在绑定聊天中明确批准或提出修改。

## 状态要点

| 状态 | 展示 | 操作 |
| --- | --- | --- |
| Loading | spinner + 正在读取 | 关闭 |
| Success | 只读提示 + Markdown | 链接、源文件、关闭 |
| Empty/TBD | 尚未准备好 | 重新读取、关闭 |
| Error/403/404/网络失败 | 可理解错误，不泄露绝对路径 | 重试、关闭 |
| 长内容 | header 固定，正文滚动 | 滚轮/触控/键盘 |
| 多改进项 | 每项独立按钮和 improvementId | 分别打开 |
| 非审批态 | 无入口 | 详情箭头保持原行为 |

## 可访问性

- `role="dialog"`、`aria-modal="true"`、可访问标题。
- 打开后聚焦关闭按钮并限制焦点在弹窗内；关闭后返回触发按钮。
- 支持 Escape、遮罩和关闭按钮；内部点击不关闭。
- loading/error 使用 `aria-live="polite"`；错误信息不只依赖颜色。
- 入口 aria-label 包含任务标题；改进项还包含 `IMP-xxx`。
- 支持 reduced-motion，保持浅/深色对比度。

## 用户审批请求

请审批以下 UI 决策：

1. 入口位于状态元信息后的独立 action row；
2. 改进项文案为「计划审批书 · IMP-xxx」；
3. 弹窗为只读，不提供批准按钮；
4. 桌面居中 modal、移动端底部近全屏 modal。

批准本原型仅代表可以按该 UI 实现；真正进入 `implementing` 仍需主任务审批门禁记录到用户在绑定聊天中的明确批准。
