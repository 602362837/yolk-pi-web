# Design

## 方案摘要

在既有 `WorkflowRail` 末端渲染层增加纯表现型 `is-flowing` class：它只附着于当前活动阶段的下一段连线。CSS 用伪元素的背景渐变 `background-position` keyframe 形成单向 shimmer；不引入 SVG、JS timer、额外状态或数据契约。

## 状态边界

`workflowRailActiveStage()`、`workflowStageForStep()`、完成证据和 station state 的现有逻辑保持原样。新增一个本地 presentation predicate，仅在以下全部成立时输出 `is-flowing`：

1. station state 是 `current`；
2. 当前 station 不是 Review（存在下一条连线）；
3. task 处于 intake/planning/implementing/checking 的活动 workflow 阶段；
4. runtime 不是 `needs_user` 或 `waiting_for_studio_children`，且当前 station 不为 attention/failed/blocked。

因此 awaiting_approval 虽仍映射为 Design，但它的线静止；failed/blocked 的 attention 定位也不被动画掩盖。该 predicate 不改变状态本身、DOM 信息文本或 ARIA 标签。

## 影响模块与边界

| 文件 | 改动 |
| --- | --- |
| `components/YpiStudioSessionWidget.tsx` | 在既有 line class 旁追加受限的 `is-flowing` 表现 class；不修改 props、任务 projection、排序、点击或拖拽生命周期。 |
| `app/globals.css` | 轨道 line 的定位/裁切、shimmer 伪元素与 keyframe；在 panel `.is-dragging` 和 reduced-motion 下停止动画。 |
| `docs/modules/frontend.md` | 实施完成后补充 widget 的活动连线与静态降级约束。 |

无 API、类型、task.json、localStorage 或迁移变更。

## 动效隔离与兼容性

- 渐变仅在 line 伪元素上位移；不对 draggable `aside`/ball shell 写 `transform`。
- expanded panel 已以 `.ypi-studio-widget-panel-visual.is-dragging` 表示拖动：该祖先状态需使其内部 `.is-flowing::after` 静止。移动 bottom sheet 无拖拽但共享同一卡片轨道。
- 现有 `@media (prefers-reduced-motion: reduce)` 选择器扩大到轨道 line 伪元素与必要 transition，确保表现静态而非隐藏状态色。
- 每个 `TaskCard` 从自身 task 推导 class，不共享动画状态，故多任务独立；drawer focused、Detail-only 和收纳球路径不接触此 DOM。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| shimmer 误示等待/异常为运行 | 严格以现有 station/runtime/status 派生 predicate 限制，仅 current 活动阶段启用。 |
| 360px 轨道出现亮带溢出 | line `overflow: hidden`，保持既有 flex/min-width 与标签布局。 |
| 拖动出现抖动或合成压力 | 不动画 shell transform；拖动期间冻结伪元素；单条细线、低频约 2.8s。 |
| 动效造成不适 | reduced-motion 硬禁用；静止状态无循环动画。 |

## 回滚

删除 `is-flowing` class、对应 CSS/keyframe 与文档说明即可恢复当前静态轨道；无需数据回滚。