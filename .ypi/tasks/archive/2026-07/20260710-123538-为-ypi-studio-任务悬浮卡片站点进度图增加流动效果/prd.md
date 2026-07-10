# PRD

## 背景与目标

YPI Studio session widget 已用五站轨道表达真实 workflow 进度。用户希望增强其“正在向下一站推进”的视觉感，但现有阶段判断与产物标注已修正，不能因视觉效果重新解释任务状态。

## 用户价值

用户可在不阅读卡片文字的前提下，更快区分「正在执行」与「等待用户/异常/已结束」，同时保留静态状态的可读性。

## 需求

1. 对当前活动工作阶段的**出站**连线显示轻量、低对比度的单向 shimmer/travel；方向固定为 Brief → Review。
2. 动画只可使用现有 UI 推导出的表现状态；不得写入、修改或重新映射 task/workflow/artifact 数据。
3. 下列状态必须静止：已完成、未知、等待审批、需要关注、失败、阻塞、完成/就绪，以及末站 Review（没有出站线）。
4. `prefers-reduced-motion: reduce` 时完全关闭轨道动画并保留当前连线的静态颜色，不以闪烁替代。
5. 动画不得使用或影响拖拽 shell 的 `transform`；expanded panel 拖动中暂停轨道流动。
6. 既有多任务卡片、桌面浮层、移动 pill/bottom sheet、drawer focused、Detail-only 入口及收纳球行为保持不变。

## 验收标准

- 活动的 Brief/Design/Implement/Checks 节点仅有一条正确方向的出站线流动，节点、标签、tooltip 和阶段状态不变。
- awaiting_approval、needs_user/waiting_for_studio_children、failed、blocked 与 completed 示例均无循环轨道运动。
- reduced-motion 下没有轨道关键帧、渐变位移或 transition 残留。
- 拖动 expanded card 时轨道停止流动，位置跟随和点击 Detail 行为未退化。
- 360px 桌面卡、多卡堆栈与 ≤640px bottom sheet 不发生横向溢出、遮挡或状态串扰。

## 范围外

不新增设置开关、动画库、API、数据迁移、task 字段，也不修改既有悬浮球/运行提示动效。

## 未决问题

无产品语义未决项；需要 UI 设计员的 HTML 原型及用户审批后才可实现。