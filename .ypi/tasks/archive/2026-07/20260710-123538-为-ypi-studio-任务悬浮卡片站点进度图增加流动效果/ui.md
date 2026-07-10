# UI

## UI prototype gate：通过，原型已交付

本任务改变已有卡片的可见动态反馈，属于前端交互/视觉变化。
**UI 设计员已在当前任务目录下交付 `ui-prototype.html` 原型文件。**

## 推荐视觉方案

- **当前节点呼吸光圈 (Halo)**：仅在 `current` 的节点上，增加一个 2s 周期的呼吸光圈（低对比度缩放淡出效果），以强化当前节点定位。原型中采用更显眼且克制的 2px 蓝色光圈进行 2s 的脉冲收缩与扩散，实现醒目的定位指示。
- **出站连线流动 (Shimmer)**：在 `current` 且工作流处于 intake、planning、implementing、checking 的非末站**出站连线**上，将线条增粗至 2px，并叠加一条由左向右滑动的低对比度渐变 shimmer 效果，运动周期约为 1.8s。
- **背景底色保持不变**：连线的底色依然保持原状态色（如 `is-current` 或 `is-done` 的色彩），仅用伪元素在表层进行视觉流动叠加。
- **静止状态对照组**：
  - 已完成 (done / ready / completed) 状态的连线与节点均保持静止。
  - 等待审批 (awaiting_approval)、异常/注意 (attention / needs_user / waiting_for_studio_children)、失败 (failed)、阻塞 (blocked) 等状态全部保持静止，不添加 any 动画或渐变位移。
  - 末站 Review 由于没有出站线，虽然节点有呼吸光圈，但连线保持静止。
- **拖拽与性能优化**：卡片在拖拽期间 (`.is-dragging`)，连线流动与节点呼吸动画将自动暂停 (`animation-play-state: paused`)，避免因为频繁合成重绘导致抖动或卡顿。原型中特别提供了可交互的拖动区域以直观验证这一行为。
- **安全降级 (prefers-reduced-motion)**：在开启了系统减少动态的设备上，禁用所有轨道动画，节点光圈以静态半透明环表现，连线以静态实色呈现。原型中提供了顶部全局切换按钮以展示此项可访问性表现。

## UI 设计员 HTML 原型交付

已在任务目录更新并优化了 `ui-prototype.html`，可直接用浏览器打开。原型覆盖并展示了以下场景：

1. **Active States**：Brief/Implement 活动时的一条出站 shimmer 与节点 Halo 效果，并且动效强度已根据反馈显著增强、显眼可见；
2. **Static Reference States**：awaiting approval、attention、failed/blocked、completed 四种静止对照；
3. **Multi-task Stack**：两张卡的多任务堆栈，各自状态独立无串扰；
4. **Mobile Bottom Sheet**：≤640px bottom sheet 中同一轨道的窄宽自适应布局；
5. **Reduced Motion & Dragging**：演示了拖拽时的动画暂停以及减少动态时的静态降级方案，加入了实时的 JavaScript 控制和模拟拖动行为。

## 审批请求

请用户确认：「活动节点有克制的呼吸光圈；仅活动阶段的出站连线有低对比度向前流动效果；等待、关注、异常、已完成等状态完全静止；在拖拽卡片与减少动态偏好下无动画。」

HTML 原型交付后，主会话可保存计划并转入 `awaiting_approval` 以取得上述用户确认。确认前不得修改生产代码。
