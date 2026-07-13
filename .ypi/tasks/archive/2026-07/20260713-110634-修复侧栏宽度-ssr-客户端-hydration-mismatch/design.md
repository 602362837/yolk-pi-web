# Design

## 方案摘要

在 `AppShell.tsx` 中为持久化布局值建立 `useSyncExternalStore` 适配。每项状态提供：

- `getServerSnapshot`：返回确定默认值（sidebar 260、right panel 300、explorer height null、explorer open true）。
- `getSnapshot`：安全读取 localStorage，复用现有解析、默认及 clamp 规则。
- `subscribe`：订阅模块内通知，并处理匹配 key 的 `storage` 事件。
- setter/写入函数：更新 localStorage 后主动通知当前标签页订阅者；浏览器原生 `storage` 事件仅负责其他标签页。

React hydration 首帧采用 server snapshot；挂载后 React 比较 client snapshot 并应用持久值，避免首帧 HTML/style/条件子树不一致。

## 范围决策

推荐一次修复四项：`sidebarWidth`、`rightPanelWidth`、`explorerHeight`、`explorerOpen`。四者位于同一文件、使用相同反模式；尤其 `explorerOpen` 会改变条件渲染子树，比单一 style mismatch 风险更高。

## 影响模块

- `components/AppShell.tsx`：初始化、持久化 setter、resize/展开调用点。
- 可选新增 `hooks/usePersistentLayoutValue.ts` 或 `lib` 小工具：仅当能保持类型与 key 逻辑清晰时抽取。推荐先保持 AppShell 内部的窄作用域 helper，避免过度泛化。
- `docs/modules/frontend.md`：记录 AppShell 持久化布局使用 hydration-safe external store。

不修改 `app/layout.tsx` 和 `hooks/useTheme.ts`；后者仅作为模式参考。

## 数据流与契约

1. SSR 调用 `getServerSnapshot`，输出稳定默认布局。
2. hydration 首帧继续使用该快照，DOM 与服务端一致。
3. hydration 后调用 `getSnapshot` 读取 localStorage，并触发必要更新。
4. 用户操作调用 store setter：规范化值 → 写 key → 通知订阅者。
5. 其他标签页更改对应 key 时，`storage` listener 通知并重读。

现有 key、值格式和默认值均保持兼容。legacy explorer height 的迁移必须在客户端安全读取路径中执行；迁移写入应避免渲染期无界通知，且所有 storage 操作置于 try/catch。

## 方案比较

### 推荐：useSyncExternalStore

优点：React 官方 SSR external-state 模型；明确 server snapshot；避免 hydration mismatch；可统一同标签/跨标签通知；与 `useTheme` 思路一致。

注意：subscribe/getSnapshot 函数引用应稳定；数值/布尔/null 快照天然可比较。不能让 render 中迁移触发同步 React 更新循环。

### 备选：useState(default) + useEffect

服务端与 hydration 首帧都用默认值，effect 再读 localStorage，因此也可消除 mismatch，改动更小。但会形成“读取 effect + 持久化 effect”的时序陷阱：首次持久化 effect 可能先把默认值覆盖用户值，必须加 hydrated guard；跨标签同步也需另做。四项状态下重复逻辑较多，故不推荐。

### 不采用

- `suppressHydrationWarning`：只隐藏症状。
- layout blocking script：要同步多个布局状态与 React store，复杂且会扩大 head 脚本职责。
- 禁用 SSR/dynamic import：牺牲首屏 SSR，范围过大。

## 风险与缓解

- **默认值被首次 effect 覆盖**：移除“state 变化即无条件持久化”的初始化路径，写入只发生在用户 setter/明确校正路径。
- **localStorage 异常**：所有读写/迁移捕获异常并回退默认。
- **窗口尺寸变化**：保留 right panel resize clamp；通过 store setter 写回规范值。
- **迁移副作用**：legacy key 迁移保持幂等，不在 render 中广播递归通知。
- **闭包/订阅泄漏**：稳定 subscribe，cleanup `storage` listener。

## 回滚

回滚 external-store helper及四项调用点，恢复原 `useState(getInitial*)` 与 effects；存储格式未迁移破坏，回滚无需数据恢复。
