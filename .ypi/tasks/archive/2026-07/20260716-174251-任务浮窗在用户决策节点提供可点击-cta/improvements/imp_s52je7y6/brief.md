# Brief：IMP-001 review 阶段提供进入用户验收的 CTA

## 反馈摘要

用户验收反馈：主任务有时停在 `review`，而用户下一步其实就是进入 `user_acceptance`；当前浮窗在 `review` 没有可点击入口，只能依赖聊天/主会话推进。希望在 `review` 显示「开始用户验收」，点击后进入**现有** `user_acceptance` 流程；**不要跳过用户验收**，不要破坏现有 8 站 rail、资料预览、改进结果验收、主任务验收/归档与 Phase 1 计划决策 CTA。优先最小改动。

## 现状证据

| 事实 | 证据 |
| --- | --- |
| 工作流已有合法边 `review → user_acceptance` | `lib/ypi-studio-workflows.ts` `BASE_TRANSITIONS`；**无** `requiresUserApproval` |
| 主任务结果验收按钮只在 `user_acceptance` | `canAcceptMainTask()` 硬条件 `status === "user_acceptance"`；`test:studio-main-accept` 明确 `review` / `review_ready` 不得 enable |
| Phase 1 `userActions` 不含 review | `buildWidgetUserActions()` 仅投影 `awaiting_approval` 与第一项 `waiting_plan_approval` |
| `review` 卡现状 | 无 unresolved 时：若 `parentStatus === review_ready` 仅提示「✓ 改进已完成，主任务需要再次验收」；**无写按钮**。首次检查后 `review`（无 improvements）则几乎只有状态 + 资料区 |
| 局部自动推进已存在 | 浮窗验收**最后一个**改进后，会 best-effort `PATCH to: user_acceptance`（IMP-005 遗留路径）。但 checker 直接落到 `review`、自动 reaccept 失败、或主会话停在 `review` 时仍无入口 |
| 通用 transition 已可写 | `transitionYpiStudioTask` + `PATCH { to, contextId, reason }` 已支持该边；本期建议收成显式 widget action，与 Phase 1 决策层一致 |

## 目标（最小）

在服务端识别「主任务处于可进入用户验收的 `review`」时，投影**一个**主 CTA「开始用户验收」；确认后原子进入 `user_acceptance`，之后复用现有主任务结果验收/归档 UI 与写路径。

## 非目标

- 不把 `review` 直接当结果验收；不自动 `completed` / `archived`
- 不放宽 `canAcceptMain` 到 `review` / `review_ready`
- 不新增 Phase 2/3（新建改进反馈、接受不处理、completed 独立归档、blocked 聊天聚焦）
- 不改 plan-review modal / 文档页 / preview 只读语义
- 不改 8 站 WorkflowRail、quickPreviews、改进结果验收列表、Phase 1 批准/需要修改/改进计划批准

## 推荐默认决定

1. 新增固定 action kind：`start_user_acceptance`（主 CTA，确认后写）。
2. 投影条件：`!archived && status === "review" && unresolvedImprovementCount === 0`。
3. 写路径：单锁校验 binding + status + 无 unresolved → `review → user_acceptance`；审计 `source=user-widget`（或等价 event data）；**不**写 plan grant。
4. 信息层级：仍走决策区（资料区之后），文案必须区分「开始用户验收」≠「确认主任务已验收完成」。
5. 保留改进验收后的自动 reaccept；本 CTA 补齐**非自动**停在 `review` 的缺口。

## 当前门禁

- 用户可见交互变更 → 需最小 HTML 原型证据（可复用现有决策区样式，新增 `review` 场景）。
- 本改进停在 `waiting_plan_approval`，用户批准计划/原型前不得实现。
