# Brief：任务浮窗决策 CTA 改为 Chat Send 续推并在工作中禁用

## 一句话

把 YPI Studio 会话浮窗的**决策 CTA 续推**从服务端旁路 `inner.prompt` 改成 **PATCH 原子写库 + 当前 Chat `handleSend` 固定引导词**，并在 agent 工作中禁用决策/验收按钮。

## 背景与问题

Phase 1 浮窗决策 CTA（`20260716-174251`）已交付：服务端投影 `userActions[]`、显式 PATCH action、revision/context 绑定、`user-widget` grant。但续推与忙碌态存在三处产品缺陷：

1. **批准类 CTA 落库后 Chat 无工作**：`approve_plan` / `approve_improvement_plan` 只 PATCH，不续推；toast 却写「将继续编排」。
2. **旁路续推模型错位 / 静默失败**：仅 `request_plan_changes` 走 `bestEffortContinueAfterWidgetRequestPlanChanges` → `studio_user_action` → `scheduleStudioFollowUp` → `inner.prompt()`，不经 `handleSend` / `ensureSessionModel`；wrapper idle 销毁或模型未 pin 时失败或模型不对。
3. **工作中仍可点**：决策/验收按钮只看 `acceptWriteBusy` / `decidingActionId`，不看 `agentRunning` / `isStreaming`。

## 用户已确认方案（Hybrid B，不得偏离）

| 原则 | 说明 |
| --- | --- |
| 原子写仍 PATCH | 保留 contextId / expectedRevision / grant / plan-review·UI 证据门禁 |
| 主会话干活走 Chat Send | PATCH 成功后对需要续推的动作调用当前 Chat `handleSend(固定引导词)` |
| 禁止软化审批 | 不得改成「只发引导词、去掉 PATCH」 |
| 工作中禁用 | `agentRunning` 或写 busy 时禁用决策与结果验收 CTA |
| Send 失败不回滚 | PATCH 已成功则不回滚；toast 明确「已落库但未能在 Chat 续推」 |

## 目标用户价值

- 用户点「批准并开始实现 / 需要修改 / 批准该改进计划」后，**Chat transcript 立刻出现用户引导消息**，可见 SSE 流式工作，模型与顶栏一致。
- agent 正在跑时，浮窗不会二次提交决策/验收，降低 409 与交错编排。
- 审批门禁与保全清单 A–F 不回退。

## 范围快照

- **In**：浮窗决策/验收 CTA 接线、busy 定义、引导词模板、server best-effort 降级策略、文档与测试。
- **Out**：改投影 kind 集合、改 grant 算法、改 8 站 rail / quick preview 语义、改主验收归档状态机、引入新的旁路 RPC 主路径。

## 相关材料

- 前序任务：`.ypi/tasks/archive/2026-07/20260716-174251-任务浮窗在用户决策节点提供可点击-cta`
- 知识：`.ypi/knowledge/20260717-093721-任务浮窗在用户决策节点提供可点击-cta.md`
- 关键源码：`components/YpiStudioSessionWidget.tsx`、`components/AppShell.tsx`、`components/ChatWindow.tsx`、`hooks/useAgentSession.ts`、`lib/ypi-studio-session-link.ts`、`lib/rpc-manager.ts`、`app/api/studio/tasks/[taskKey]/route.ts`
