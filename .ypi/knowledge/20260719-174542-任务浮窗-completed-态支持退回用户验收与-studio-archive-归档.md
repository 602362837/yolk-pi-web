# 任务浮窗 completed 态：退回用户验收与 /studio-archive 归档

## Summary

为 `status===completed && !archived` 的会话浮窗补两个决策按钮（不改浮窗视觉体系）：

1. **退回用户验收**（secondary）：显式 PATCH `return_to_user_acceptance`，工作流边 `completed → user_acceptance`，单锁校验 binding/revision/未解决改进，落库后 `status=user_acceptance`、`completedAt=null`，`source=user-widget`；**不** Chat Send。
2. **归档**（primary）：确认后 `onComposeSend("/studio-archive")`，与手动 slash 同语义（extension command → 模型整理 knowledge → `ypi_studio_task(action=archive, …)`）；**禁止**浮窗 silent `PATCH action=archive` / `allowFallbackKnowledge` 作为主路径。Panel 与主验收「确认并归档」路径本任务未改。

配套：`BASE_TRANSITIONS` + feature-dev/bugfix/ui-change JSON 新边；review-only 不加退回；`agentRunning`/写锁禁用；Hybrid B 的 continue 三 kind 不变（新 kind `needsChatContinue=false`）。Checker Pass；domain/projection/continue 单测补齐。

## Reusable knowledge

- **Completed 不是死胡同**：需要 reopen 时必须有 workflow 边 `completed → user_acceptance`；仅有投影不够，写路径要 `findYpiStudioTransition`，缺边明确失败（现网多映射 400）。
- **双路径矩阵**：状态纠正类动作用原子 PATCH；需要模型产出（knowledge）的归档用 **Chat slash `/studio-archive`**，不要旁路 silent archive 当浮窗主路径。
- **userActions 投影**：`studio_archive` + `return_to_user_acceptance`，max 2，advisory；`supportsReturnToUserAcceptance` 按 workflow 边裁剪；archived → `[]`。
- **return helper 要点**：session-class `contextId`、单锁、revision CAS、清 `completedAt`、不写 approvalGrant、event 可审计。
- **与 Hybrid B 衔接**：复用 `onComposeSend`/`agentRunning`；`ypiStudioWidgetActionNeedsChatContinue` **不要**包含 completed 新 kinds（避免 PATCH 后再发引导词）。
- **视觉**：只复用 `.ypi-decision-btn` disabled/aria；勿按示意 HTML 重画。
- **他仓**：磁盘 workflow 缺边时退回失败、归档仍可用；可用 studio-init overwriteDefaults 或手补边。

## Source artifacts

- brief.md / prd.md / design.md / ui.md / implement.md / checks.md / plan-review.md / review.md
- Task: `20260719-043757-任务浮窗-completed-态支持退回用户验收与-studio-archive-归档`
- Key code: `lib/ypi-studio-workflows.ts`, `lib/ypi-studio-tasks.ts` (`returnYpiStudioToUserAcceptanceFromWidget`), `lib/ypi-studio-session-link.ts` (`buildWidgetUserActions`), `components/YpiStudioSessionWidget.tsx`, `app/api/studio/tasks/[taskKey]/route.ts`, `.ypi/workflows/{feature-dev,bugfix,ui-change}.json`
