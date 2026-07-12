# Design - 第三版：改进项归属主任务

## 1. 什么是改进流程

改进流程是用户在**主任务验收**时提出、并由 main 确认创建的一条问题处理链。对用户叫“改进项”，对系统叫 `improvement instance`。它有自己的负责人、阶段、产物、运行和验收记录，但永远不能脱离主任务。

每个改进项从出现到结束：

1. 用户说出验收问题，main 复述并确认是否创建改进项。
2. 服务端创建 `IMP-001`（存储 id 如 `imp_<random>`），写入反馈摘要、来源主验收轮次、状态 `analysis`、负责人 `improver`。
3. 改进师产出该项的 brief、prd、design、implement、checks、plan-review；不清楚则转 `blocked` 并请求澄清。
4. 有 UI 变化时，UI 设计员写该项自己的 `ui.md` 和 HTML；范围/行为/UI/风险有变化时等待用户批准计划。已批准范围内的明确小修可记录 `approvalMode=inherit` 及主 revision 依据。
5. 实现员只领取该项 ready 的 implementation subtask；检查员输出通过、返工或阻塞结论。
6. main 请求用户验收该改进项。用户接受则 `accepted`；提出新问题则创建新改进项，不偷改已验收项。
7. 所有改进项都有最终处置后，主任务回 `review`，再请求主任务验收。

## 2. 它保存在哪里

主任务仍是唯一顶层记录：`.ypi/tasks/<task-id>/task.json`。新增 additive `improvements` 字段：

```ts
improvements: {
  schemaVersion: 1,
  parentStatus: "none" | "waiting_for_improvements" | "review_ready",
  instances: [{
    id: "imp_<random>", displayId: "IMP-001", title, feedback,
    status, phase, owner, approvalMode, approval, acceptance,
    disposition, artifacts, implementationPlan, progress, runs, attempts
  }]
}
```

每项的文件只放在 `.ypi/tasks/<task-id>/improvements/<imp-id>/`：`brief.md`、`prd.md`、`ui.md`、`design.md`、`implement.md`、`checks.md`、`plan-review.md`、`review.md`、`summary.md` 和必要的 HTML。`task.json` 的 `artifacts` 只保存相对路径；resolver 以该 instance root 为根，拒绝 `..`、绝对路径、URL 与 symlink escape。

顶层 Tasks 列表、runtime session pointer、archive 和 bind 都只认识主 task key。API/tool 必须显式带主 task key 和 `improvementId`，并验证同 cwd、主任务绑定 context、实例归属和 expected status/revision。子成员 session header 可记录 `improvementId`，但使用量、审计父级仍是主 task。

## 3. 主任务状态和改进项状态

主任务主线：`intake -> planning -> awaiting_approval -> implementing -> checking -> review -> user_acceptance -> completed`。

- 用户无问题：`user_acceptance -> completed`。
- 用户确认创建第一项：`user_acceptance -> waiting_for_improvements`。
- 任一项未解决：保持 `waiting_for_improvements`，拒绝 completed/archive。
- 全部项 `accepted` 或用户明确 `accepted_not_doing`：锁内重算，转 `review`，写“改进完成，请再次验收主任务”通知。

改进项状态使用容易读懂的投影：`分析中`、`等待澄清`、`等待原型`、`等待计划批准`、`实现中`、`检查中`、`等待用户验收`、`已接受`、`已取消`、`失败`、`接受不处理`。底层 transition 必须限制在 improver 分析、计划/原型、实现、检查、验收这条链上；failed/cancelled/rejected/blocked 都是 unresolved，除非用户用明确输入、理由和时间执行 `accepted_not_doing`。

## 4. 角色协作

| 阶段 | 输入 | 负责人 | 输出和状态 | 失败处理 |
| --- | --- | --- | --- | --- |
| 创建 | 用户反馈、主任务验收轮次 | main | 改进项、`分析中` | 反馈不明确则不创建，先问用户 |
| 分析与计划 | 反馈、主任务设计/实现/检查证据 | improver | 范围、非目标、风险、计划、审批建议 | `等待澄清`，不实现 |
| UI 设计 | 计划要求的 UI 变化 | ui-designer | `ui.md` 和 task-local HTML | `等待原型` 或 failed，阻止批准 |
| 实现 | 已准备计划、claimed subtask | implementer | 代码与实现报告，`检查中` | failed，保留原因与 run |
| 检查 | diff、验收项、测试 | checker | pass 或 needs work | needs work 回实现；不能替用户接受 |
| 用户验收 | 改进摘要、review | main 请求，用户决定 | `已接受` 或新反馈 | 拒绝/取消仍未解决，等重试或处置 |

默认 `improver.md` 以“分析用户验收反馈并写改进计划，不直接实现、不递归派发、不修改 task.json”为职责。`DEFAULT_YPI_STUDIO_AGENTS` 与 `.ypi/agents/improver.md` 新增它；默认排序 architect、improver、ui-designer、implementer、checker。`PI_WEB_STUDIO_DEFAULT_MEMBERS`、labels 与默认 `studio.members.improver` 同步新增，推荐默认模型“跟随主会话”、思考强度 `medium`。用户可在 Settings -> Studio 修改为特定模型或任意已有 thinking 级别；仍遵循 tool input > member config > default policy > main > Pi default。

## 5. API、并发、事件与 UI 投影

新增任务 actions：`create_improvement`、`get_improvement`、`revise_improvement_plan`、`transition_improvement`、`update_improvement_artifact`、`update_improvement_plan`、`claim_improvement_subtask`、`record_improvement_acceptance`、`resolve_improvement_disposition`、`mark_notification_read`。subagent start 增加 `improvementId`；改进实现/检查必须同时带 `improvementId` 和 `subtaskId`。

所有实例 mutation 复用主任务 `withTaskMutationLock`：先写 staging、验证 instance 文件、原子 rename、再写 task.json、最后追加 event。每次终态 mutation 重读全部 instances 并 reconcile，避免最后两项并发结束时错误完成主任务。新增有界事件/通知只含 taskId、improvementId、状态和摘要；widget/detail 只取数量、最近项、阻塞和 next action，不带全文反馈或 transcript。

## 6. 审批同步是配套机制

计划或原型变更要成为同一 revision：`revise_plan` / `revise_improvement_plan` 在锁内同步写材料、revision、plan-review hash 与 UI gate 结果，清掉旧 grant。普通 artifact update 在 awaiting approval 拒绝。需要 UI 时，批准前必须有同 revision 的成功 ui-designer run、`ui.md`、安全 HTML 和审批书相对链接。用户修改或拒绝可退回 planning/changes_requested 后重新请求批准；这是保证改进流程材料一致的机制，不是本版产品主线。

## 7. 兼容、风险与回滚

v1 读取时投影为没有改进项，不自动写回；首次 mutation lazy-upgrade。自定义 workflow 若不支持 user_acceptance/improvement，显示 capability 缺失，不覆盖文件。默认模板刷新只更新 exact-default 文件。

主要风险：跨文件失败、并发 reconcile、越权 instance 访问、详情信息膨胀、默认成员更新覆盖用户文件。缓解：主锁/staging/CAS、根路径校验、bounded projection、non-destructive refresh。回滚关闭新 actions/capability，v2 records 只读可见，不删除改进项或审计；管理员只能留下受审计的显式 disposition。
