# IMP-002 PRD — GitHub 自动化异常闭环

## R1 — 权威终态分流

`runGithubFullAgentMember(implementer)` 必须返回或被 runner 归一为 server-validated `GithubImplementerDisposition`，而不是仅由 child status 决定。枚举至少区分：`succeeded`、`needs_user_decision`、`policy_blocked`（含 `blocked_manual_ui_approval`）、`provider_transport_failure`、`check_failure`（不得由 implementer伪造）、`cancelled`、`paused`、`runtime_failed`。

只有 `succeeded` 且无 terminal reason/provenance 冲突时才可原子推进 `implementing → checking`。其余结果先持久化终态；checker/operator validation/final policy/publisher 均为零调用。

## R2 — 安全 reason 与 provenance

持久化 allowlisted `reasonCode`、`dispositionKind`、`blockedAtLayer`、`retryability`、generation、run id/fence 的 hash/ordinal、发生阶段和稳定 notification revision。不得保存 prompt、child output、Issue/comment 原文、路径、token 或 provider 原始错误。

终态写入采用 generation/run-fence compare-and-set：旧 checker 的 `checkerReasonCode`、迟到 child、resume 或 scheduler tick 不得覆盖较新的 implementer terminal disposition。只有显式、授权的 operator retry 在同 generation 创建新 run fence 后，才可清除该 terminal fence。

## R3 — 标签映射

复用现有 allowlisted catalog，不接受 Issue/task 指定标签：

| disposition | labels to ensure | retryability |
| --- | --- | --- |
| needs_user_decision / manual UI approval | `ypi:blocked`, `ypi:decision-needs-info`, `ypi:risk-high` | operator_after_change |
| policy/risk block | `ypi:blocked`, `ypi:risk-high` | operator_after_change |
| provider transport retry_due | `ypi:blocked` | automatic only when IMP-001 provenance qualifies |
| checker/validation failure | `ypi:blocked` | existing policy |
| cancelled/paused | no new risk/decision label; preserve unrelated labels | external/operator |
| succeeded / PR opened | existing lifecycle behavior | n/a |

Only Bot-managed labels may be removed, only after a newer successful lifecycle transition; never delete user labels or use a new arbitrary label.

## R4 — 中文幂等沟通

用 `automation_status` canonical marker upsert 一条中文状态评论，内容固定模板且只含：原因的中文安全文案、阻塞阶段、用户/操作者下一步、可重试性。相同 notification revision 必须 noop；同一 marker 内容变化更新既有评论，未知写结果 re-list reconcile，禁止盲写/重复评论。

`blocked_manual_ui_approval` 的动作必须明确为“需要人工 UI/HTML 设计与审批后再由操作者重试”，不是自动 retry。

## R5 — 通知副作用失败

labels/comment 任一失败不得吞掉原业务 disposition，也不得推进 checker。持久化 `notification_pending|notification_failed`、安全 channel/operation/retryability provenance，写 safe event，并进入 `blockedAtLayer: "operator_notification"` 的可观察 operator 状态。恢复仅重放缺失 notification，不能重跑 implementer/checker/publisher；未知写结果先 reconciliation。

## R6 — 兼容与安全

历史 state 无 disposition/provenance 时 fail closed 为 operator review，不能根据 `status=succeeded` 猜测通过。Issue/comment 文本不能修改 reason、label、评论模板、阶段、retry 或权限。safe Jobs projection 只新增 allowlisted状态字段。
