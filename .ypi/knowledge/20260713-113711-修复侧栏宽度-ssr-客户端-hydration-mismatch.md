# 修复侧栏宽度 SSR/客户端 hydration mismatch

- Task: 20260713-110634-修复侧栏宽度-ssr-客户端-hydration-mismatch
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260713-110634-修复侧栏宽度-ssr-客户端-hydration-mismatch
- Archived at: 2026-07-13T03:37:11.744Z
- Tags: studio, feature-dev

## Summary
修复 AppShell 侧栏/右面板/Explorer 布局 localStorage 状态的 SSR hydration mismatch：用 createPersistentLayoutStore + useSyncExternalStore 提供稳定 getServerSnapshot，显式 setValue 持久化，禁止 mount 时默认值抢写。

## Reusable knowledge
# 修复侧栏宽度 SSR/客户端 hydration mismatch

## 问题
GitHub Issue #1：`getInitialSidebarWidth()` 等在 `typeof window` 分支导致 SSR 默认值与客户端 localStorage 首帧不一致。

## 修复
- `createPersistentLayoutStore` + `useSyncExternalStore`
- 四项：sidebarWidth / rightPanelWidth / explorerHeight / explorerOpen
- 稳定 server snapshot；hydration 后读 localStorage
- 删除无条件 persist effects；拖拽走 setValue

## 验证
lint、tsc、checker Pass；用户验收通过。

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
