# review

## Verdict

**Pass** — 实现覆盖 PRD R1–R4、Design/Implement 推荐方案与 Checks 门禁；无阻塞问题。主会话可进入 review。

## Scope checked

- `components/AppShell.tsx`（相对 HEAD 的完整 diff + 当前实现）
- `docs/modules/frontend.md` 相关段落
- 对照：`prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` / implementer `handoff.md`
- 自动验证：`npm run lint`、`node_modules/.bin/tsc --noEmit`
- 浏览器：依赖 IMP-5 handoff 记录 + 当前 `http://localhost:30141` 可访问；本次未重复全套 agent-browser 手工矩阵

## Requirements coverage

| ID | 标准 | 结果 |
| --- | --- | --- |
| R1 | SSR / hydration 首帧稳定默认快照，四项无首帧 localStorage 反模式 | Pass |
| R2 | hydration 后恢复合法偏好；clamp / legacy migrate 保留 | Pass |
| R3 | 显式 setter 持久化；读写容错；snapshot 可比较 primitive/null | Pass |
| R4 | 无 UI 结构/文案/交互回归；允许 hydration 后一次布局校正 | Pass |
| UI 门禁 | 无结构变更，跳过 ui-designer / HTML 原型 | Pass（与 `ui.md` / `plan-review.md` 一致） |

## Code review (checks.md)

| Check | Result |
| --- | --- |
| 四项均 `useSyncExternalStore` + `getServerSnapshot` | Pass — `sidebarWidth` / `rightPanelWidth` / `explorerHeight` / `explorerOpen` |
| 无 `useState(getInitial*)` / 客户端 lazy init 读 localStorage | Pass — 旧 `getInitial*` 已删除 |
| 无 mount 无条件 persist effect 覆盖用户偏好 | Pass — 旧 width/open/height persist effects 已删；写入仅 `setValue`（拖拽/toggle/viewport clamp） |
| `getSnapshot` 返回 primitive/null + 缓存 | Pass — `hasCache` / `cachedSnapshot` |
| 同标签 `setValue` 通知；`storage` 过滤 key/clear 并 cleanup | Pass — 首个订阅挂 listener，末个退订移除 |
| explorer legacy 迁移在 client `read`，不 notify | Pass — `watchKeys` 含 legacy key；migrate 写 try/catch |
| 无 `suppressHydrationWarning` / blocking layout script / 服务端偏好 | Pass |
| keys / 默认 / 边界语义 | Pass — `pi-web-sidebar-width` 260/220–520；右栏 `pi-web:right-panel-width` server 300 + viewport clamp；explorer height min 120 + legacy；open 默认 true |
| docs 与实现一致 | Pass — `docs/modules/frontend.md` AppShell 表 + 专节 |

### Design alignment notes

- 采用 Design 推荐的 `createPersistentLayoutStore`（AppShell 内窄作用域 helper，未过度抽到通用 hooks）。
- 模式对齐 `hooks/useTheme.ts` 的 `useSyncExternalStore` + 稳定 server snapshot，但不改 theme。
- 拖拽 handler 在 pointerdown 捕获 `store.getSnapshot()`，避免依赖陈旧闭包；resize callback 依赖已去掉 width state。

## Findings Fixed

None（检查员未改生产代码）。

## Remaining Findings

### Non-blocking

1. **工作区噪声 `package-lock.json`**：仅 `pi-ai` bin 路径 `dist/cli.js` → `./dist/cli.js`，与本任务无关。合并/提交时应排除或单独说明，避免混入 hydration 修复。
2. **Post-hydration 布局校正**（设计内）：首屏仍为 server 默认（260/300/`null`/true），随后切到 localStorage 偏好；`explorerOpen=false` 用户可能短暂看到展开再收起。PRD/Design 已接受，非 mismatch。
3. **Invalid raw storage 不在 read 路径回写**：渲染用 clamp/fallback，非法字符串可能仍留在 key 中，直到用户拖拽写入。符合“禁止 mount 覆写”设计；与旧行为一致可接受。
4. **跨标签双页手工矩阵**：代码已实现 filtered `storage`；IMP-5 未做双标签完整实操。风险低，可选后续 smoke。

### Blocking

None.

## Verification

| Command / evidence | Result |
| --- | --- |
| `npm run lint` | Pass (exit 0) |
| `node_modules/.bin/tsc --noEmit` | Pass (exit 0) |
| Static diff vs plan | Pass — IMP-1…4 落地；无反模式残留 |
| Browser hard-refresh matrix | Accept IMP-5 handoff（无相关 hydration 控制台错误、偏好恢复、clamp、legacy migrate、localStorage 抛错不崩）；checker 确认 dev server `localhost:30141` HTTP 200 |

## Risks / residual

- 右面板 window `resize` 仍会 `setValue` 写回 clamp 宽度（既有产品行为，非回归）。
- legacy explorer 迁移在 `getSnapshot`→`read` 中写 storage（幂等、不 notify）；与旧 `getInitial*` 副作用位置同类，Design 允许。

## Decisions needed from main session

1. 采纳 **Pass**，任务进入 review / 收尾。
2. 提交时勿夹带无关 `package-lock.json` 变更（除非有意同步 bin 路径）。
3. 无需返工实现员；无需 UI 设计员或架构重开。
