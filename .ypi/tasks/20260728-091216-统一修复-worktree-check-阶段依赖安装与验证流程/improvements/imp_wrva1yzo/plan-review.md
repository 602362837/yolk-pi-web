# Plan Review — IMP-002 GitHub 自动化异常分流、标签与用户沟通

> 状态：**规划完成，等待用户/主会话审批；未实现代码。**

## 审阅材料

- [Brief](brief.md)：attempt 907 的 status/disposition 混淆证据
- [PRD](prd.md)：R1–R6、通知失败和安全边界
- [Design](design.md)：disposition-first CAS 与通知 outbox
- [Implement](implement.md)：IMP2-01…04 DAG
- [Checks](checks.md)：真实 runner/App 边界回归矩阵
- [UI](ui.md)：无普通 Chat/UI 改动，不需 HTML 原型

## 推荐方案

1. implementer child 的 `status` 不再单独代表 pipeline 成功；server-validated non-success disposition（尤其 `blocked_manual_ui_approval` / needs-user）先持久化，checker/validation/publish 为零调用。
2. 用 generation + run-fence CAS 保存 allowlisted reason/provenance；旧 checker/late child 不得覆盖新 terminal outcome。
3. 复用现有 `ypi:blocked`、`ypi:decision-needs-info`、`ypi:risk-high` 等批准目录及 `automation_status` marker，幂等 upsert 一条中文固定模板评论。
4. labels/comment 失败不是静默 best-effort：保留业务原因并进入 `operator_notification`；后续只重放 notification，绝不重跑 implementer/checker/publisher。

## 需审批的决策

- **D1：**接受 disposition-first 为唯一下游门禁，child `status=succeeded` 不能覆盖 needs-user/policy result。
- **D2：**本轮复用既有 label catalog，不新增专门异常标签；映射见 PRD R3。
- **D3：**同意 canonical 状态评论可更新既有 Bot marker，而非每次异常追加多条评论。
- **D4：**同意通知失败进入 operator_notification，并且“重试通知”不得重新执行业务 pipeline。
- **D5：**历史/矛盾 provenance fail closed 给 operator，不根据旧 status 推断可进入 checker。

## UI / 审批判断

- 需要 UI 原型：**否**。原因：无 Web UI 结构或交互变化。
- 需要计划审批：**是**。原因：改变 GitHub unattended 行为、用户沟通、标签副作用和 operator recovery。
- 等待澄清：**否**。采用上述保守默认；若主会话希望新增标签或用户可点击审批，应新开范围并先设计。

批准后按 IMP2-01 → IMP2-02/03 → IMP2-04 执行；不得新增自动 retry、普通 Chat 改动或发布行为。