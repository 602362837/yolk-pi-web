# IMP-002 Design — disposition-first runner 与 App 通知 outbox

## 流程

```text
implementer child result
 → server normalize + generation/run-fence CAS
 → durable terminal disposition
 → notification outbox (labels then canonical automation_status comment)
 → terminal operator/retry_due state

only disposition=succeeded
 → clear only matching prior terminal/checker state
 → checking → operator validation → final policy → publisher
```

`status=succeeded` 不是成功证据；当 result 带 `blocked_manual_ui_approval`、needs-user 或任意 non-success disposition 时，runner 以 disposition 为准。checker 入口应显式断言：当前 generation 的 implementer disposition 是 `succeeded`、run fence 对应且没有 unresolved notification failure；否则零 spawn/零 validation/零 publish。

## Durable contract

建议新增 `implementerOutcome` / `terminalDisposition`（名称由实现员与现有 state 收敛）：

```ts
{
 generation, runFence, runOrdinal,
 kind, reasonCode, blockedAtLayer, retryability,
 recordedAt, provenanceHash,
 notificationRevision, notification: {
   labels: "pending"|"confirmed"|"failed",
   comment: "pending"|"confirmed"|"failed",
   lastFailureOperation?: "labels"|"comment"|"reconcile"
 }
}
```

值均由 allowlist/schema 校验；hash 不可反推 child/Issue 内容。写入必须比较 generation+runFence，且在同一 durable mutation 内清空过期 checker fields 或令它们带 generation/fence，避免 `checkerReasonCode` 覆盖新 implementer reason。

## 通知 outbox

建立 server-owned `github-automation-notification` helper，输入只接受 normalized disposition 与 repository identity。它调用现有 `addGithubIssueLabels` / lifecycle helper 和 `upsertGithubAutomationComment(kind="automation_status")`：

- 模板与 label mapping 是代码常量；无自由文本拼接；
- marker identity `kind+repo+issue` 保证一条 canonical 状态评论；notificationRevision 变化才 PATCH；
- label/comment 的远端确认分别落盘；unknown write 先 GET/list reconciliation；
- 任一步明确失败：不回滚业务终态，保存 operation-safe failure，状态转 operator_notification；之后 retry 只 drain outbox。

标签新增使用现有 catalog；本轮不创建 `ypi:*` 新标签。通知成功不等于运行成功，也不得将 needs-user block 改成可自动恢复。

## 评论模板（示意）

```text
<!-- stable automation_status marker -->
自动化已暂停处理此议题。
- 原因：该改动涉及需要人工确认的 UI/交互范围。
- 阻塞阶段：实现前/实现阶段。
- 需要操作：请先完成 UI/HTML 设计与审批；随后由仓库操作者重试。
- 可重试性：需变更或人工确认后重试，不会自动重试。
```

模板不包含模型输出、路径、命令、diff、Issue原文、token 或异常原文。

## 失败与恢复

- non-success → terminal/block/retry_due，先落盘再通知；不进入 checker。
- transport retry 仅继承 IMP-001 已证明的 `before_first_provider_request` 条件；通知不扩大 retry 权限。
- notification failure → `operator_notification`，safe event / Jobs 可见；operator retry/drain 不重启业务 pipeline。
- stale child/checker writes 比对 fence 后忽略并写 safe stale event；不覆盖。
- legacy/invalid state → `automation_state_inconsistent` operator block，不猜测重跑。
