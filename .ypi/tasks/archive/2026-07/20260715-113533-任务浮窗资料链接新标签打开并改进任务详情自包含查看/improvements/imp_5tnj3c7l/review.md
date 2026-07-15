# Review — IMP-001 滚动修复

## Verdict

**Pass（主会话检查）** — 建议进入 `waiting_user_acceptance`。

## Scope checked

- `app/globals.css` `.ypi-studio-task-document-*` height chain / sole scroller
- `components/YpiStudioPanel.tsx` `TaskDetailShell.lockScroll` + TasksTab document overflow lock
- `components/YpiStudioTaskDocumentView.tsx` body `tabIndex={0}`
- `docs/modules/frontend.md` sole scroller note
- `handoff.md`

## Acceptance

| 项 | 结论 |
| --- | --- |
| Page 100dvh flex + body sole scroller | Pass（代码） |
| Embedded document 打开时外层不抢滚 | Pass（代码） |
| 关闭文档后 shell 恢复 auto | Pass（条件分支） |
| 不改打开策略/API/grant | Pass |
| lint / tsc | Pass（0 errors / tsc_exit=0） |

## Remaining

- 浏览器人工滚轮验收交用户（page + embedded，不先点正文）

## Recommendation

`checking` → `waiting_user_acceptance`
