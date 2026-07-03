# ui

## 是否需要 UI 设计员

不需要单独 UI 设计员。本轮是稳定性 bugfix，UI 变化以已有组件增量状态展示和操作入口为主。

## 页面 / 组件 / 状态

### `components/YpiStudioSubagentTranscript.tsx`

- 在 header/meta 中展示：`truncated`、`cancelled`、`failed`、`waiting_for_user`、timeout/output-limit warning。
- raw/debug 区继续默认折叠，并保证 raw 内容来自已截断 result/progress。
- final output 若被截断，显示醒目 warning：例如 “Output truncated to 256 KiB; see transcript preview / rerun with narrower prompt”。
- 对 cancelled/failed run 展示恢复建议文案：重试此成员、让主 session 从当前阶段继续、必要时标记任务 blocked/cancelled。

### `components/YpiStudioSessionWidget.tsx`

- 对 live overlay 中的 cancelled/failed/waiting_for_user/stale 显示不同颜色和短标签。
- 对长时间无更新的 running run，可显示 “stale?” 或 “无进展 Xm”，但不要自动变更任务状态。

### 可选后续操作入口

MVP 可先不加按钮，只在文案里提示用户通过主 chat 发送“重试/终止/从当前阶段继续”。如要做按钮，建议后续增加：

- Retry：把同一 member/prompt 插入 ChatInput 或触发主 session 生成重试指令。
- Mark failed：调用新的 run patch API，把孤儿 running run 标记 failed。
- Continue phase：插入 `/studio-continue` 或中文继续指令。

## 需要原型化的问题

无需原型。沿用现有 transcript card、warning chip、widget row 样式即可。
