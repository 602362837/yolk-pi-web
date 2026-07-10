# PRD

## 规划状态

最新 [HTML 原型](./ui-prototype.html) 已获用户认可，UI prototype gate 已满足；本文件将该方向固化为需求。**这不等同于生产实现批准**：主会话仍须以 [plan-review.md](./plan-review.md) 发起最终计划审批后才能开始实现。

## 目标与用户价值

让当前会话的 YPI Studio 任务入口在最小化后可靠地收纳为可恢复、可拖动的任务球，不会因右侧 drawer 或任务 focus 消失；让用户在单任务、多任务和移动端快速读懂任务 workflow 进度，并只通过明确的 Detail 按钮打开详情，避免误触。

## 范围内需求与验收

### R1 展示态与隐藏态分离

- 展示态仅为持久化的 `expanded | collapsed`；`collapsed` 必须渲染任务球，轻点（未超过拖动阈值）恢复展开面板。
- `hidden` 不是收纳的同义词：仅在没有 bound task、Chat 容器不显示或组件卸载时不渲染。
- drawer 打开、drawer 关闭、focused task 命中、轮询刷新、任务数量增减和重新挂载均不得写回、推断或吞掉展示态。
- 沿用既有全局 localStorage 展示偏好和独立的球/面板位置；刷新后恢复并 clamp 到可见视口。

验收：单任务和多任务可反复“展开 → 收纳球 → 展开”；Studio drawer 聚焦绑定任务时，面板和球都仍存在且可操作；首次从初始展开态收纳时球位置正确。

### R2 任务球与无障碍动效

- 收纳/展开采用约 160–200ms 的短促淡入、淡出或轻微缩放，不造成布局跳变。
- running 可使用低对比、约 2.4s 的 halo；needs_user、failed、blocked 只在状态切换时有限次数 ring pulse，随后静止。
- 拖动位移由外壳负责；动画只能作用于内部视觉层，拖动中禁用会竞争 `transform` 的动效。
- `prefers-reduced-motion: reduce` 下取消非必要过渡、halo、pulse，仍以状态文字、badge、颜色和可访问名称表达状态。

验收：球拖动时没有跳动或抢夺位移；动效不持续强闪；reduced-motion 下仍能辨认任务数、状态和打开入口。

### R3 Detail-only 交互

- 卡片本体是只读信息区，点击标题、进度、workflow 连线、meta、空白区，以及卡片本体的 Enter/Space，均不得打开 drawer。
- 每张卡右上提供唯一的圆形毛玻璃 Detail 按钮，带可见 hover/focus、tooltip 和可访问名称（例如“打开《任务名》详情”）；仅该按钮调用对应 task 的打开详情回调。
- 桌面端仅 header/drag handle 可拖动面板；卡片 body、滚动区、文字选择和 Detail 按钮不能触发拖动。按钮 pointer/click 需隔离事件。

验收：单任务和多任务的每个 Detail 按钮均只打开正确 task；长标题不遮挡按钮；鼠标、触摸和键盘操作互不误触。

### R4 站点连线式 workflow 进度

- 展开卡片必须保留一眼可见的“站点连线式”路线，而非只显示百分比或运行文案。
- 每卡展示 `Brief → Design → Implement → Checks → Review` 五站：已完成、当前/运行、等待用户、失败/阻塞和未到达状态有可区分的节点、连线与文本/tooltip 表达。
- 路线使用现有任务的 workflow、artifact 完成情况、implementation projection 和运行状态做只读展示；数据不足时显示中性/未知，不得虚构阶段已完成，也不得新增或改变 API/任务状态机契约。
- 多任务卡片各自渲染自己的路线；移动端 bottom sheet 卡片同步保留该路线。收纳球/移动入口至少保留任务数和最高紧急状态，不承担完整路线。

验收：在 360px 桌面悬浮卡及窄屏 bottom sheet 中五站不与标题/Detail 按钮重叠，当前或阻塞站一眼可见；单任务、多任务和 drawer focused 下路线不丢失。

### R5 响应式与 drawer 一致性

- 桌面端 drawer focus 最多施加非破坏性的视觉避让；不得 `return null`、不得降低到不可操作，任务球保持正常可见和可操作。
- 移动端保持底部入口加 bottom sheet 模式；drawer focus 不得导致入口或 sheet 中的卡片消失，Detail-only 和 workflow 路线规则与桌面一致。
- 不改变 session-bound 多任务 resolver、排序语义、Studio approval gate、任务状态机、API 响应或右侧 drawer 布局。

## 范围外

- 新增 workflow/stage 后端数据模型或修改 API 契约。
- 每 task/session 单独保存展示偏好。
- 改造移动端整体导航、任务排序或绑定逻辑。

## 已确认与最终审批边界

- 已确认：HTML 原型中的任务球不消失、Detail-only、毛玻璃圆形按钮、站点连线进度、多任务/移动端呈现及动效降级方向可行。
- 待最终审批：按本 PRD、[Design](./design.md)、[Implement](./implement.md) 和 [Checks](./checks.md) 进入生产实现的完整范围与风险控制。