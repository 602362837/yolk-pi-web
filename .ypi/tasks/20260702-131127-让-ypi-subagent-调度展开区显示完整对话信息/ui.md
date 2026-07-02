# UI

## 是否需要 UI 设计员

不需要单独委派 UI 设计员。本任务是现有 `MessageView` 工具展开区的信息架构增强，交互范围清晰，可由实现员按本设计落地。

## 展示入口

优先入口：主 chat 中 `ypi_studio_subagent` 的工具调用展开区。

不在本任务中默认增强顶部 `Subagents` 面板；若后续需要，可复用 transcript API，但不应让两个入口维护独立状态源。

## 工具块布局

`ToolCallBlock` 检测 `block.toolName === "ypi_studio_subagent"` 后切换为专用渲染：

1. Header（折叠时可见）
   - 工具名：`ypi_studio_subagent`
   - member：`architect` / `implementer` 等
   - 状态：Running / Succeeded / Failed / Cancelled / Transcript unavailable
   - 已耗时或总耗时
   - 模型/thinking（如有）
   - 最近状态短文本：如 `Child Pi running · 12 events · last update 09:41:20`

2. Expanded body
   - `Status` 区：runId、taskId、startedAt/finishedAt、transcript 状态、截断提示。
   - `Delegated input` 区：默认折叠，显示原 `member/prompt/taskId/model/thinking`；替代当前直接铺开的 JSON。
   - `Child transcript` 区：默认展开，使用 chat-like timeline：
     - User / Prompt：delegated prompt 或 member prompt 摘要。
     - Assistant：Markdown 渲染 assistant text。
     - Tool call：单行工具名 + 参数摘要，可展开查看 bounded input preview。
     - Tool result：单行成功/失败 + 输出摘要，可展开查看 bounded output preview。
     - stderr/error/status：用 warning/error 样式突出。
   - `Final output` 区：保留现有 paired result 文本，默认折叠或置于 transcript 后，便于复制主 agent 看到的最终输出。

## 运行中状态

- 在没有子输出前显示：`Child Pi process started. Waiting for first JSON event…`。
- 收到 JSON 事件后显示 event count、message count、tool count、最后更新时间。
- 若 stdout 一直无 JSON 但 stderr 有内容，显示 stderr preview。
- 运行中的 transcript preview 使用 `tool_execution_update.partialResult.details.transcript.preview` 或 hook 中的 active tool progress 替换，不做无限追加。

## 完成 / 失败 / 缺失降级

- 完成且有 transcript：显示 transcript timeline；若 API 尚未加载，先显示 tool result details 内的 preview。
- 历史 run 或 transcript ref 缺失：显示提示 `This Studio member run was created before transcript capture; showing final output only.`。
- transcript 文件不存在/越权/损坏：显示具体原因，并回退到 final output / run summary。
- 超长内容：每个 transcript item 默认显示 preview，提供 `Show more` 或 `Open transcript file`；不把超长文本一次性塞进 DOM。

## 样式原则

- 复用现有 CSS 变量：`--bg-subtle`、`--border`、`--text-muted`、`--accent`、错误色等。
- 保持工具块紧凑；默认展开后高度可滚动，单个 transcript 区建议 `max-height: min(560px, 65vh)`。
- Assistant 文本用 `MarkdownBody`，tool/stderr 用 monospace preview。
