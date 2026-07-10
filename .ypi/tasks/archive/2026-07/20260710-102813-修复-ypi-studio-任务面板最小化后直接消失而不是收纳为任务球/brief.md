# brief

## 目标

修复 YPI Studio 当前会话任务面板点击“收纳”后视觉上直接消失的问题：收纳必须稳定显示为可恢复、可拖动的任务球。并将任务详情打开从“点击任务卡片/面板本体”改为每张任务卡的显式圆形 Detail 按钮。

## 已核实证据

阅读了 `components/YpiStudioSessionWidget.tsx`、`components/AppShell.tsx`、`app/globals.css`、Studio session-link/API 与模块文档；当前多任务 widget 已完成卡片堆叠、展开/收纳 state、球/面板独立位置持久化及 clamp。

- 收纳按钮仅执行 `setExpanded(false)`；理论上会进入 ball 分支，并非显式 hide。
- 但 widget 在 `hiddenWhenFocusedTaskKey` 命中时计算 `isDimmed` 后直接 `return null`。`AppShell` 在右侧 Studio drawer 打开且聚焦任一绑定任务时传入该值。因此 drawer/focus 条件可覆盖收纳态，使任务球消失；注释称“dim”，实现实际是 hide。
- 任务球的 `ResizeObserver` 初始化 effect 不依赖 `expanded`：首次以展开态挂载时 `ballRef` 为空；随后收纳不会重新执行该 effect。球仍可能渲染，但未取得/修正位置，属于需验证的次要可见性风险。
- 当前 `TaskCard` 整卡带 `role="button"` 和 click/keyboard handler，任何点击都会打开详情；不符合新增显式 Detail 入口需求。
- 当前 attention pulse 在外层球上动画 `transform`，会与拖动时外层 inline `transform` 竞争；动画方案须隔离拖动位移层与视觉层。

## 规划结论

1. **收纳（collapsed）与隐藏（hidden）必须是不同概念。**
   - `collapsed`：任务存在且入口必渲染为任务球，点击可展开；持久化为用户展示偏好。
   - `hidden`：仅允许在没有可展示的 bound task、当前不显示 Chat 容器或组件卸载时发生；drawer 打开/任务聚焦不得作为隐藏条件。
2. 右侧 drawer 打开不能重置或覆盖 `expanded/collapsed`；推荐保持用户最后选择的展示态。若需降低重复感，只做非破坏性弱化/避让，不能 `return null`。
3. 任务卡片本体只承担阅读状态；只有卡片右上角毛玻璃圆形 Detail 按钮打开右侧详情。拖动仅由面板 header/drag handle 承担。
4. 本任务涉及可见交互、信息结构和确认体验变化，**触发 UI prototype gate**。旧任务的卡片堆叠原型不覆盖新增 Detail 按钮与动画状态，不能替代本任务原型。

## 范围

- 单/多 bound task 的收纳、刷新恢复、拖动与 drawer 打开状态一致性。
- 任务球克制动画、reduced-motion 降级。
- 任务卡显式 Detail 按钮及多任务位置、点击优先级、拖动冲突处理。

不包含：Studio 任务状态机、session-link/API 数据契约、任务绑定/排序语义、右侧 drawer 布局改造。

## 当前阻塞

请 UI 设计员基于当前项目提供本任务的 HTML 原型，并由主会话/用户确认。未取得该原型和明确用户审批前，不能进入实现。