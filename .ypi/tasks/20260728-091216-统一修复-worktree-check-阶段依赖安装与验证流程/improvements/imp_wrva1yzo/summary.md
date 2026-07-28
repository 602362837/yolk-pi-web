# IMP-002 Summary

规划将 GitHub unattended 的 child status 判定收敛为 disposition-first durable gate：implementer 的 UI/manual/needs-user 等非成功结果先安全落盘、通知 Issue，且永不进入 checker。计划复用既有 allowlisted labels 与 canonical `automation_status` 评论，实现幂等中文沟通；标签/评论失败转为独立、可观察的 operator notification state，恢复时只补通知。

未实现生产代码、未改普通 Chat/UI、未 commit/push/merge。等待主会话审批 `plan-review.md` 的决策。