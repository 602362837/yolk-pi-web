# Brief

## 目标

为当前已完成的 `YpiStudioSessionWidget` 悬浮任务卡片中的五站轨道（Brief → Design → Implement → Checks → Review）增加克制的连线流动感；不改变任何阶段、产物或状态含义。

## 已确认事实

- 轨道渲染位于 `components/YpiStudioSessionWidget.tsx` 的 `WorkflowRail`；阶段由既有 workflow/runtime/artifact evidence 推导。
- 连线基础样式位于 `app/globals.css` 的 `.ypi-studio-workflow-rail-line`；现有球体/面板动效已经把动画与拖拽 shell 的 `transform` 隔离，并在 reduced-motion 下关闭。
- 当前工作区已有不属于本任务的未提交改动；本任务实施只能追加轨道表现层改动，不能回退或覆盖它们。

## 范围

- **范围内**：当前进行中阶段的出站连线 shimmer/travel、拖拽与 reduced-motion 降级、五站状态与多任务/移动端回归。
- **范围外**：阶段映射、完成证据、产物计数、API/任务 JSON、任务排序、drawer 焦点规则、Detail 按钮行为、收纳球语义。

## 推荐决策

只在语义为 `current` 且工作流确实处于活动执行状态（intake/planning/implementing/checking）的非末站出站连线上显示低对比度 shimmer；每约 2.8 秒一次连续流动。`done`、unknown、awaiting approval、attention、failed、blocked、completed/ready 与 Review 末站均静止。