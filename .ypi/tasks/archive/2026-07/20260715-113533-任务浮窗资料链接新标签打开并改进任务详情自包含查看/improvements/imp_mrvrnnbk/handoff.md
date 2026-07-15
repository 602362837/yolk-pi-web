# Handoff — IMP-003 (`imp_mrvrnnbk`)

**Status:** `analysis` → **`waiting_plan_approval`**  
**Code:** none (plan + HTML prototype only)

## Improvement Analysis

- **反馈：** 改进项已有「确认该改进任务已完成」；主任务在 `user_acceptance`（含改进清空后再次验收）时浮窗缺少对等入口，只能 Chat 口头验收。
- **根因：** projection 仅有 `instances[].canAccept`；widget 写路径只 PATCH `transition_improvement → accepted`；文档写明 widget never completes main task。服务端 `user_acceptance → completed` 门禁已存在但无 UI。
- **方案：** `canAcceptMain` + 浮窗绿按钮 + AppPrompt + PATCH `to=completed` + `contextId` + `reason`；仅 `user_acceptance && unresolved===0 && !archived`。
- **UI 原型：** 需要（已提供）。
- **计划审批：** 需要。
- **等待澄清：** 否。

## Artifacts produced

路径：`.ypi/tasks/20260715-113533-…/improvements/imp_mrvrnnbk/`

| 文件 | 说明 |
| --- | --- |
| `brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` | 改进规划 |
| `plan-review.md` | 用户审批入口 |
| `studio-main-task-accept-prototype.html` | 主任务 vs 改进验收交互原型 |
| 实现计划 | 3 串行子任务 `MAIN-ACCEPT-1..3` |

未改生产代码；未改主任务实现计划。

## Validation

- 源码证据：`YpiStudioSessionWidget` 改进 accept；`buildProjection.canAccept`；`transitionYpiStudioTask` + `requiresUserApproval` + unresolved 阻塞。
- Studio API：artifacts 写入 + `update_improvement_plan` + `transition_improvement → waiting_plan_approval` 成功。
- 状态确认：`IMP-003` = `waiting_plan_approval`。

## Remaining risks

- 用户可能期待 `review`/`review_ready` 直接 completed — 计划明确拒绝，待审批确认。
- 实现时漏 `reason` 会撞 `requiresUserApproval`。
- 与改进按钮并发 in-flight 需互斥。

## Decisions needed from main session

请用户审阅改进 `plan-review.md` + HTML 原型并明确批准，重点确认：

1. 仅 `user_acceptance` 显示主任务验收；  
2. 二次确认后 → `completed`，不自动归档；  
3. 有未解决改进时不显示；与改进验收视觉/文案区分。
