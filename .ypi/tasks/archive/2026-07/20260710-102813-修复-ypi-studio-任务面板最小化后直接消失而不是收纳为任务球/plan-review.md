# Plan review

## 当前状态：UI 方向已认可，等待生产实现最终审批

[HTML UI 原型](./ui-prototype.html) 已由用户认可，UI prototype gate 已满足。本审批书是进入生产实现前的唯一用户审阅入口：**原型认可不等同于实现批准**。主会话必须先取得对下述 PRD、设计、实施计划和检查范围的最终批准，才可保存 implementation plan 并将任务推进至 `awaiting_approval`；此前不得改动生产代码。

## 关联产物

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI 设计说明](./ui.md)
- [HTML UI 原型](./ui-prototype.html)（可直接浏览器打开）
- [Design](./design.md)
- [Implement](./implement.md)（含机器可读 `json ypi-implementation-plan`）
- [Checks](./checks.md)

## PRD 摘要（已确认的 UI 方向）

- 最小化是 `collapsed`，必须稳定收纳为可恢复、可拖动的任务球；不能直接消失。
- `collapsed` 与 `hidden` 分离。drawer/focus、刷新、任务刷新和任务数量变化均不得吞掉球或面板、改写展示偏好。
- 卡片本体只读；每卡右上圆形毛玻璃 Detail 按钮是唯一详情入口。
- 展开卡片保留 `Brief → Design → Implement → Checks → Review` 的站点连线进度，使单/多任务悬浮卡一眼可见 workflow 进度；移动 bottom sheet 同步该规则。
- 动效克制且遵循 reduced-motion；拖动、滚动、Detail 点击和键盘交互不可互相误触。

## 设计摘要

- 已在现有代码观察到首要根因：`hiddenWhenFocusedTaskKey` 命中后 widget 实际 `return null`，而 `AppShell` 会在 Studio drawer 聚焦绑定任务时传入该值。实现将删除隐藏语义，drawer focus 最多作为非破坏性视觉上下文。
- ball 条件挂载后必须在实际 ref 出现时初始化位置和 `ResizeObserver`，并在 resize/刷新时 clamp；展示偏好与球/面板位置继续沿用既有 global localStorage。
- Detail-only 通过移除整卡 button/click/keyboard 语义、增加独立可访问 button、header-only drag 和事件隔离实现。
- workflow 路线只消费既有 workflow、artifact、implementation projection 与 runtime 数据；没有可靠阶段证据时中性降级，不新增 API、任务 JSON 或状态机契约。
- 动效放在球内部视觉层，外层只处理 drag position，避免 `transform` 竞争；reduced-motion 静态降级。

## 实施与检查摘要

[Implement](./implement.md) 的机器可读计划包含五个顺序明确的子任务：

1. `WIDGET-STATE`：可见性、drawer focus 与 ball position 生命周期；
2. `WIDGET-CARD-PROGRESS`：Detail-only 和五站 workflow 路线；
3. `WIDGET-RESPONSIVE`：多任务、移动端、drawer focused、drag 边界；
4. `WIDGET-MOTION`：内外动效分层和 reduced-motion；
5. `QA-REGRESSION`：lint、tsc 与完整人工矩阵。

最终验证包括 `npm run lint`、`node_modules/.bin/tsc --noEmit`，以及 [Checks](./checks.md) 中的单/多任务、刷新、拖动、drawer focused、移动端、Detail、workflow 路线与 reduced-motion 矩阵。

## 最终审批请求

请确认可以按本审批书实施，且接受以下边界：

1. drawer 打开详情时保留用户当前 expanded/collapsed 选择，不自动收纳或隐藏；
2. 展示偏好继续为既有全局 localStorage，而不是按 task/session 新增持久化模型；
3. 五站路线为基于现有 projection 的只读展示；自定义 workflow 或 artifact 映射不充分时显示中性状态，而不扩展后端契约；
4. 可按 [Implement](./implement.md) 的五个子任务开始生产实现与回归验证。

获最终审批后，主会话可保存 implementation plan，并将任务从 intake 推进到 planning，再推进到 `awaiting_approval`。