# 计划审批书：修复侧栏宽度 SSR/客户端 hydration mismatch

## 审批摘要

GitHub Issue #1 的根因已定位：`AppShell` 在 SSR 使用默认侧栏宽度 260px，客户端 hydration 首帧却从 localStorage 读取持久值，造成 `--sidebar-width` 不一致。同文件的右面板宽度、Explorer 高度与展开状态使用相同反模式。

**推荐审批方案：一次修复四项持久化布局状态。** 使用 `useSyncExternalStore` 提供稳定 `getServerSnapshot`，使 SSR 与 hydration 首帧一致；hydration 后再读取 localStorage 并恢复偏好。现有 key、默认值、边界、迁移与交互保持不变。

## 范围与产品影响

- 修复：sidebarWidth、rightPanelWidth、explorerHeight、explorerOpen。
- 不修改视觉结构、文案、拖拽规则、尺寸边界，不新增服务端存储。
- **无 UI 结构变更，跳过 ui-designer**：这是初始化时序 bugfix，不涉及页面信息结构或交互方案变化，因此无需 HTML 原型。
- 允许 hydration 后从稳定默认布局校正到持久偏好；不新增 layout blocking script。

## 技术决策

- 采用 `useSyncExternalStore`，对齐 `hooks/useTheme.ts` 的 SSR external-state 模式。
- 显式 store setter 负责写入并通知当前标签页；匹配 key 的 `storage` 事件支持其他标签页。
- 移除会在首次挂载时无条件写默认值的持久化 effect，避免覆盖用户偏好。
- `useState(default) + useEffect` 虽可修复 mismatch，但需要 hydrated guard 且四项重复逻辑多，作为备选而非推荐。
- 不采用 `suppressHydrationWarning`、禁用 SSR 或新增 head blocking script。

## 实施路线

1. 建立窄作用域、稳定的 localStorage external-store helper。
2. 迁移 sidebar。
3. 迁移 right panel 和 Explorer 两项状态。
4. 更新前端模块文档。
5. 执行 lint、tsc 与浏览器硬刷新复现。

实现 DAG 与机器可读计划见 [Implement](./implement.md)。核心风险是首次默认值抢写、迁移副作用、订阅泄漏和条件子树不一致；对应检查已列入 [Checks](./checks.md)。

## 验收重点

- localStorage 中预置非默认 sidebar 值后硬刷新，控制台不再出现 hydration mismatch。
- 四项偏好在 hydration 后正确恢复，拖拽/展开、clamp 与 legacy migration 无回归。
- localStorage 受限或值异常时页面不崩溃。
- `npm run lint` 与 `node_modules/.bin/tsc --noEmit` 通过。

## 待用户审批

请确认：

1. 是否同意推荐范围——同批修复四项同类状态，而非仅修 sidebar。
2. 是否接受 hydration 后可能出现一次默认布局到本地偏好的非阻塞校正。
3. 是否批准按本计划进入实现。

## 相关产物

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI 门禁结论](./ui.md)
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)
