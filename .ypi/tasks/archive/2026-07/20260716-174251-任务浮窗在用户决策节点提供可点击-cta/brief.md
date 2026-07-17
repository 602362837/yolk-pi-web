# Brief：任务浮窗在用户决策节点提供可点击 CTA

## 用户目标

把 `components/YpiStudioSessionWidget.tsx` 从“状态显示器 + 局部验收器”升级为“用户决策台”：真正需要用户决定时直接给出明确、可点击、可审计的 CTA；普通执行阶段仍只展示状态，不制造伪“继续”按钮。

## 已确认原则

1. CTA 只来自服务端识别的用户门禁；前端不自行猜状态机。
2. 点击表达显式用户意图，必须经过现有绑定、审批、revision 与状态迁移校验。
3. 计划/原型预览继续只读；预览行为不写 grant，决策按钮独立呈现。
4. 每个任务卡最多一项主操作和一项次操作；危险或会启动执行的动作需要确认。
5. 保留 `contextId = pi_<sessionId>`、可审计 grant、`override` 不可绕过 approval、task-local 预览安全边界。
6. 不在 `YpiStudioPlanReviewModal` 或文档预览页中加入批准按钮。

## 现状证据

- `lib/ypi-studio-session-link.ts` 已集中构造浮窗投影，但当前只投影 `quickPreviews`、验收便利字段和改进摘要，没有统一 `userActions`。
- `components/YpiStudioSessionWidget.tsx` 已具备确认框、共享写入忙碌锁、失败后刷新、改进结果验收与主任务验收模式，可复用交互骨架。
- 主计划批准目前只由 `lib/ypi-studio-extension.ts` 的用户输入 hook 调用 `recordYpiStudioUserApproval()`；grant 的 `source` 仅允许 `user-input`。
- 改进计划已有 `recordYpiStudioImprovementApproval()` 与 `waiting_plan_approval -> implementing` gate，但浮窗没有入口。
- `GET /api/sessions/[id]/studio-task` 已能在主任务进入 `implementing` 且有 ready 子任务时触发 `studio_autocontinue`；改进计划通过 UI 后仍需补齐同等的继续编排语义。
- 计划/HTML 预览 API 已是只读安全边界，不应承担决策写入。

## 默认交付范围

本任务只交付 **Phase 1**：

- 主任务 `awaiting_approval`：`批准并开始实现`（主 CTA）与 `需要修改`（次 CTA）。
- 改进项 `waiting_plan_approval`：`批准该改进计划`（主 CTA，精确绑定 improvement id/revision）。
- 服务端 `userActions[]` 投影、显式 action 写路径、审计来源、并发/陈旧 revision 防护、浮窗确认/忙碌/错误状态、主/改进执行续推。

后续另立任务：验收阶段**新建**改进反馈、失败/取消改进的“接受不处理”、completed 卡**独立**归档入口、blocked/clarification/waiting_for_user 的聊天聚焦弱操作。

**硬约束：范围外 ≠ 删除现有。** 当前浮窗已具备且必须完整保留的能力（详见 PRD「现有能力保全清单」）：

- 多任务绑定壳层、WorkflowRail、详情入口、状态/产物/子任务元信息
- `quickPreviews` 只读计划审批书 / HTML 原型 / 改进计划（不写 grant）
- 改进摘要（blocker / nextAction）与改进**结果**验收按钮
- 主任务**结果**验收 + 确认并归档；归档只读徽章
- runtime / compact 子任务 / live runs；共享写锁与失败刷新
- 聊天 `user-input` 批准路径

本任务只在资料区之后**叠加** `userActions` 决策区，禁止重写卡时把上述区块弄没。

## 推荐默认决定

- `需要修改` 必须填写非空修改说明；成功后退回 `planning`，清除旧 grant、提升 plan revision，并持久化审计事件。
- UI action 带 `expectedRevision`；状态或 revision 已变化时服务端返回冲突，前端刷新，不使用乐观成功。
- 同一任务卡最多投影 2 个 action。多个改进同时等待计划批准时，只投影第一项主 CTA，其余仍可从详情查看，避免按钮墙。
- UI 确认与聊天明确批准具有同等强度，但审计来源区分为 `user-widget` 与 `user-input`。

## 当前门禁

这是用户可见交互与审批体验变更，已触发 UI 原型硬门禁。当前 delegated member 环境未暴露 `ypi_studio_subagent` / `ypi_studio_wait` 工具，架构师无法真实派发 `ui-designer`，因此不能伪造其 HTML 交付，也不能安全进入 `awaiting_approval`。主会话需补派 UI 设计员后再完成审批状态迁移。
