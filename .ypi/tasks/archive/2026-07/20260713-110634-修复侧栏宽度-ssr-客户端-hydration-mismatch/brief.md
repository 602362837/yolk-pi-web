# Brief

## 问题

GitHub Issue #1 报告：用户拖拽左侧栏后，宽度写入 `localStorage`；刷新页面时 `components/AppShell.tsx` 的服务端输出使用默认 260px，而客户端 hydration 首帧直接读取持久值（如 220px），导致 React hydration mismatch。

同文件的右侧面板宽度、文件浏览器高度和展开状态也采用“SSR 默认值、客户端 lazy initializer 读 localStorage”的模式，具有同类风险。

## 目标

让所有参与 SSR 的持久化布局状态在服务端快照与 hydration 首帧保持一致，hydration 后再无警告地应用本地偏好；不改变拖拽、展开/收起、尺寸边界和存储键。

## 约束

- 对齐 `hooks/useTheme.ts` 的 `useSyncExternalStore` / `getServerSnapshot` 思路。
- 不用 `suppressHydrationWarning` 掩盖组件级问题，不新增 layout blocking script。
- 不修改生产代码于规划阶段，不 commit/push/merge。
- UI 结构和交互不变。

## 推荐范围

同批修复 `sidebarWidth`、`rightPanelWidth`、`explorerHeight`、`explorerOpen`。它们根因相同且集中在一个组件；只修 sidebar 会留下可复现的同类 hydration 风险。实施时应抽取小型 localStorage external-store 适配，避免四套分叉逻辑。
