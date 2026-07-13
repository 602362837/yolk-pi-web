# REV-01 最终任务级评审

## Verdict

**CHANGES_REQUESTED** — 计划/HTML 原型审批、静态审查、数据契约、文档和自动验证均已通过；但真实应用浏览器验收仍因本 worktree 无法启动而没有证据。该项是最终验收 blocker，原型检查不能替代实际组件检查。

## Findings Fixed

- 当前 Studio session 已明确批准计划和 HTML 原型的视觉、互斥交互、移动策略与 unknown/unavailable 降级；已同步到 `plan-review.md`、`ui.md`、`checks.md`。未补造日期或外部审批证据。
- DOC-01 已完成：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md` 已覆盖 `SessionStatsChips` 与 additive `childSessions[].contextUsage` 的来源、availability、隐私、响应式和 reduced-motion 规则。

## Remaining Findings

### Blocker — 真实应用浏览器验收不可执行

- 30141 的监听进程 cwd 为 `/Volumes/01/ExternalStorage/Projects/gitProjects/pi-agnet-web`，不是当前 worktree，不能作为本改动的证据。
- 当前 worktree 的 `node_modules` 是指向上述目录的外部符号链接。尝试 `node_modules/.bin/next dev -p 30142` 后，Next/Turbopack 报错：`Symlink [project]/node_modules is invalid, it points out of the filesystem root`；页面请求返回 502。
- 因此尚未在实际组件上验证 hover、键盘、outside click、375/640px、明暗主题、reduced-motion，以及 parent/standalone/studio_child 三种场景。已有原型浏览器检查和静态阅读不替代这些证据。

## Passed Review Points

- **费用口径：** parent 使用 rollup，且仅真实 child usage 时显示 `incl. Studio`；standalone 使用自身；studio_child 使用 `selectedSessionTotals` 自身，并仅在浮窗附父级参考。聚焦回归覆盖三类口径。
- **上下文真实性：** child context 仅由 SDK child `AgentSession.getContextUsage()` 的 runtime snapshot 投影；无样本为 null-valued `unavailable`，不把 lifetime usage/progress token 当作 occupancy。
- **隐私与兼容：** child 投影仅有 id、member/subtask/status 和数值 snapshot/source/capturedAt；无 transcript、prompt、output、tool result、artifact 或路径。字段 additive，hook 的 AbortController/effective-session-id stale guard 和 local fallback 保持不变。
- **交互和响应式（静态）：** 两个互斥 button popover 使用 portal/fixed clamp、Escape、外部 pointerdown、hover/focus/click 和内部 child 滚动；`≤640px` 隐藏 token chips、保留费用/上下文；reduced-motion 禁用动画/transition。

## Verification

- `npm run lint` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-usage-stats-rollup.mjs` — pass
- `git diff --check` — pass

## Required Follow-up

在 node_modules 位于 worktree 内、或可启动当前分支的环境中运行真实浏览器矩阵，并将实际组件截图/结果写回 `checks.md`。完成前不要标记 APPROVED。
