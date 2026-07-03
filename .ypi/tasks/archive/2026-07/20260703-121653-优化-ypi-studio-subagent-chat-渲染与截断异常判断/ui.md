# ui

## 是否需要 UI 设计员

不强制需要。该任务是现有工具块的信息架构和状态语义修正，组件级设计即可实现。若后续要做视觉规范化（统一所有工具块状态徽章），可再派 UI 设计员。

## 主 Chat 工具标题

折叠态标题建议结构：

```text
YPI Studio · architect · Running · Streaming · 27.4 t/s · 2m 13s · 正在整理方案…
```

右侧 badge：

- `27.4 t/s`：有 `progress.tps` 时直接显示，颜色中性/强调，不藏在长 preview 内。
- `1234 tok`：可选，空间不足时优先保留 `t/s`。
- `⚠`：只代表 policy/runtime warning；展示截断不使用黄色异常三角，改用 `clipped` / `recent only` 中性 badge。

状态颜色只由 run status 决定：

- running：accent/blue
- succeeded：green
- waiting_for_user：amber
- failed/cancelled：red/dim
- display-only clipping：gray/info，不改变状态颜色

## 展开态默认内容

默认展开后不再以 “Child transcript” 为主，而是：

1. Status strip
   - Member、Status、Phase、Current action、Elapsed、Model、Thinking、Tokens、`t/s`、Updated。
   - Current action 可来自 `phase/currentTool` 的高层文案，如 `Running tool: read`；不展示 args/result。

2. Recent activity
   - 固定最多 5 条，按时间从旧到新或新到旧均可，但必须只展示窗口。
   - 每条显示：时间、类型（assistant/tool/status）、一行摘要。
   - 新进展到来时替换旧列表，不追加无限列表。
   - 若没有进展：显示 `Child Pi process started. Waiting for first event…`。

3. Display notes
   - 展示截断说明使用中性 info：`Showing a bounded recent preview. The member run itself is not marked failed.`
   - 最终输出裁剪：`Final output was clipped for safety; ask the main session to summarize or open debug transcript if needed.`

4. Failure/recovery
   - 仅真实失败时显示红色 failure panel：原因、termination reason、建议 retry/continue/block。

## Debug / Raw 二级入口

- `Show prompt`、`Show transcript`、`Show raw JSON` 全部默认折叠。
- 点击 Debug 后才允许读取 transcript API（当前逻辑已接近这一点）。
- Raw transcript 仍使用 API limit/cursor；不一次性塞入完整 DOM。

## 空间和可读性

- 工具标题要保持单行可裁剪，`t/s` badge 固定可见。
- 展开态 recent activity 最大高度建议 `min(360px, 45vh)`；Debug transcript 可继续使用更高上限。
- 移动端优先显示：member/status/tps/latest preview。
