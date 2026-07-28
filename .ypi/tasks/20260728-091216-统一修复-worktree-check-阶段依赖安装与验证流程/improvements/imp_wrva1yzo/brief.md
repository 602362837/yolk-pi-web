# IMP-002 Brief — GitHub 自动化异常分流、标签与用户沟通

## 反馈与现状证据

Issue #22 attempt 907 中，implementer 已给出 `blocked_manual_ui_approval` / 需要用户决定的非成功结果，但 runner 仅按 child `status === "succeeded"` 推进 `checking`。随后 checker 的旧/失败状态可覆盖真实原因，Issue 也没有可理解的标签或中文说明。

已核对：

- `lib/github-automation-runner.ts` 在 implementer 结束后直接写 `checkpoint: "checking"`；checker 分支独立持久化 `checkerReasonCode` 与 `reasonCode`。
- `lib/github-automation-comments.ts` 已有带稳定 marker 的 `automation_status` 幂等 upsert；`lib/github-automation-labels.ts` 已有受控 lifecycle / decision / risk 标签与添加 API。
- `blocked_manual_ui_approval` 已是 policy reason，retryability 为 `operator_after_change`，但尚不是 implementer terminal disposition 的权威输入。

## 目标

为 GitHub unattended runner 建立单一、持久化、fail-closed 的 terminal disposition：非成功 implementer 绝不进入 checker、validation、publish；安全地给 Issue 同步标签与中文状态评论；通知失败本身也成为可观察的 operator blocker。

## 范围

仅 GitHub automation runner、其 durable state/job projection、安全事件、App labels/comments、focused runner tests 和相关运维文档。

## 非目标

不改普通 Chat/UI、Studio 审批体验、Pi/provider retry、WorkTree Check 协议、Issue 自由文本权限、发布器业务或自动重试需要用户决定的结果。
