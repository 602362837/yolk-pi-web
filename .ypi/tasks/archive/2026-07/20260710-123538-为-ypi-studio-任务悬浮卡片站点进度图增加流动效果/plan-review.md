# Plan review

## 当前状态：可开始审阅此方案，等待你确认是否按该原型实现

本任务只增强 YPI Studio 悬浮任务卡片五站连线的视觉流动感，**不改变**现有阶段判断、产物证据、任务状态、数据接口或任何既有 widget 交互。

UI prototype gate **已满足**：HTML 原型已交付，可直接审阅。当前这份审批书就是你确认是否进入实现的入口。

## 关联产物

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI 说明](./ui.md)
- [HTML 原型](./ui-prototype.html)
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)

## 这次要改什么

- 给五站进度图里**当前所处节点**增加克制的 2px 蓝色呼吸脉冲光圈（halo）。
- 仅给活动阶段 `intake / planning / implementing / checking` 的 `current` **出站连线**加 2px 宽的低频向前流动高对比度渐变 shimmer 效果，让流动效果显眼可见。
- `awaiting_approval`、attention（含 needs_user / waiting children）、failed、blocked、done、unknown、ready/completed 都保持静止。
- `Review` 末站没有出站线，因此只保留当前节点光圈，不做连线流动。
- 拖拽卡片时自动挂起并暂停所有轨道动画；`prefers-reduced-motion` 下全部静态降级（动画完全冻结，当前节点保留静态放大半透明环，连线降级为静态状态颜色）。

## 为什么这样设计

- 你希望站点图“有流动效果”，同时又要保持当前 widget 的清晰度和稳定性。
- 因此方案只让**正在推进的那一段**连线动起来，而不是整条轨道都动，避免把等待/异常/完成误读为仍在推进。
- 当前节点增加 halo，可以更快识别“现在卡在哪一站”。
- 动画只放在连线/节点视觉层，不碰拖拽外壳 transform，避免与现有收纳球、面板拖动冲突。

## 实现范围

只涉及前端表现层：
- `components/YpiStudioSessionWidget.tsx`
- `app/globals.css`
- `docs/modules/frontend.md`

**不会改动**：
- API
- session-link / task projection 语义
- task JSON
- localStorage 结构
- Detail 按钮、drawer focused、收纳球、移动端 bottom sheet 的既有规则

## 验收重点

实现后会重点检查：
- 当前节点 halo 是否清晰但不过强
- 只有活动阶段出站连线会流动
- waiting / failed / blocked / completed / review 末站保持静止
- 拖拽时动画暂停
- `prefers-reduced-motion` 下无动画但状态仍可辨认
- 多任务、移动端、drawer focused、Detail-only、收纳球行为无回归

详见 [Checks](./checks.md)。机器可读 implementation plan 见 [Implement](./implement.md)。

## 请你确认的事项

请确认是否接受以下实现边界：

1. **当前节点有克制的 2px 蓝色呼吸脉冲光圈**；
2. **只有活动阶段的出站连线有加宽显眼、向前滑动的渐变流动效果**；
3. **等待、关注、异常、完成状态完全静止**；
4. **拖拽中挂起并暂停动画，系统减少动态偏好下无闪烁、无动画，纯静态呈现**；
5. **不改变现有任务语义与交互，仅做视觉增强**。

如果你确认，我下一步就保存 implementation plan，并把任务推进到 `awaiting_approval` 供你正式批准实现。
