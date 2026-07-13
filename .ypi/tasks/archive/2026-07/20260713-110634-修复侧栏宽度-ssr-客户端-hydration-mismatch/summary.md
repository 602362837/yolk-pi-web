# Summary

## 问题
GitHub Issue #1：`AppShell` 侧栏宽度等布局状态在 SSR 与客户端 hydration 首帧不一致，触发 React hydration mismatch。

## 修复
- 在 `components/AppShell.tsx` 引入 `createPersistentLayoutStore` + `useSyncExternalStore`
- SSR / hydration 首帧使用稳定 server snapshot；hydration 后读 localStorage 恢复偏好
- 同批迁移：`sidebarWidth`、`rightPanelWidth`、`explorerHeight`、`explorerOpen`
- 删除 `getInitial*` 与无条件 persist effects；拖拽/toggle 走显式 `setValue`
- 文档：`docs/modules/frontend.md`

## 验证
- lint / tsc：Pass
- Checker review：**Pass**（无阻塞）

## 提交注意
勿夹带无关 `package-lock.json`（`pi-ai` bin 路径）变更。
