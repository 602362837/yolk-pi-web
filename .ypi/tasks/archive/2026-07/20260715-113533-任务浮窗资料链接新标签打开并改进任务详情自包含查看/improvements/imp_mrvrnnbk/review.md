# Review — IMP-003 任务浮窗主任务用户验收

## Verdict

**Pass（主会话检查）** — 建议进入 `waiting_user_acceptance`。

## Scope checked

- MAIN-ACCEPT-1：`canAcceptMainTask` 纯函数 + projection `canAcceptMain` + 类型
- MAIN-ACCEPT-2：`YpiStudioSessionWidget` 按钮、AppPrompt、PATCH `to:completed` + `contextId`/`reason`、样式区分
- MAIN-ACCEPT-3：`docs/modules/frontend.md` + lint/tsc

## Acceptance

| 项 | 结论 |
| --- | --- |
| 仅 `user_acceptance` 且无未解决改进显示 | Pass（projection gate） |
| 二次确认后 PATCH completed | Pass |
| 与改进验收文案/视觉区分 | Pass |
| 不自动归档、不写 grant、不乐观改状态 | Pass |
| lint / tsc | Pass（0 errors / tsc_exit=0） |

## 用户验收点

1. 主任务 `user_acceptance` 时浮窗出现「确认主任务已验收完成」  
2. 取消确认不写状态  
3. 确认后 → `completed`，widget/drawer 刷新  
4. 有未解决改进时不显示主任务按钮（只显示改进验收）  

## Recommendation

`checking` → `waiting_user_acceptance`
