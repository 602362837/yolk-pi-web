# brief

## 目标

在任务浮窗 **Completed**（`status === "completed" && !archived`）补齐两个可操作 CTA：

1. **退回用户验收** → `completed → user_acceptance`
2. **归档** → 主路径通过当前会话 **Chat Send `/studio-archive`**，由当前模型整理 knowledge 后再 archive；禁止以 Panel 的 `allowFallbackKnowledge` 静默服务端归档作为浮窗主路径

## 背景

- 上一任务 Hybrid B 已接通 `agentRunning` / `onComposeSend`、decision region、`userActions` 投影（max 2）。
- 现网 `completed` 无 `userActions`，浮窗无可写按钮；工作流仅有 `completed → archived`。
- Panel 归档仍可 `allowFallbackKnowledge: true`（兜底摘要）；`/studio-archive` extension command 会注入引导词并要求模型调用 `ypi_studio_task(action=archive, knowledgeSummary, knowledgeMarkdown, …)`。

## 约束（用户确认）

- 不改浮窗视觉体系；只复用现有 decision / accept 按钮 class 与 disabled 态。
- 写操作需 `contextId` 绑定、确认框、`agentRunning` 禁用写 CTA。
- 不破坏已归档只读、主验收路径、improvement 流、userActions 上限。

## 成功标准（摘要）

- Completed 卡投影恰好 2 个 CTA：退回 User Acc. + 归档。
- 退回经原子写路径落库到 `user_acceptance`，随后可走既有主验收。
- 归档 CTA 触发与手动输入 `/studio-archive` 等价的 Chat 语义；不直接 silent archive。
- lint / tsc / 相关 studio 单测通过。
