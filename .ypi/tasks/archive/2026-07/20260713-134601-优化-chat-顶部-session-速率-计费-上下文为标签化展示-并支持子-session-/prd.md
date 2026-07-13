# PRD：Chat 顶部 Session 指标标签化与子 Session 上下文浮窗

## 目标与用户价值

让用户在不打开统计页的情况下快速分辨当前 Session 的输入、输出、缓存、费用与上下文压力，并在悬停上下文指标时同时看到父/本体 Session 和 Studio children 的上下文状态，提前识别接近窗口上限的会话。

## 用户故事

- 作为普通 Session 用户，我能从顶栏 chip 快速读取 token、费用和上下文占用。
- 作为 Studio 父 Session 用户，我能在上下文浮窗中区分父会话与每个 child 的压力。
- 作为 child audit Session 用户，我看到的 compact 费用只属于该 child，同时可在浮窗识别其父级关系。
- 作为键盘、触屏或 reduced-motion 用户，我仍能访问信息且不会被动画干扰。

## 功能需求与验收标准

### R1：统一指标 chips

- input、output、cache-read、费用、上下文采用同一圆角 chip 体系。
- 数字使用 tabular nums；图标、标签/tooltip 提供语义，不仅依赖箭头。
- 值为 0 的 token 项沿用当前隐藏策略；上下文存在窗口信息时可显示未知占用。
- 顶栏高度不变，chip 不能挤压核心导航和操作。

### R2：费用入口与口径不变

- 费用 chip 单独触发计费组成浮窗。
- parent compact = parent own + Studio children；只有 child token/cost > 0 才显示 `incl. Studio`。
- standalone compact = 自身 usage，无 child 标记。
- studio_child compact = 该 child 的 `selectedSessionTotals`；浮窗可附 parent rollup 与 parent id。
- local fallback 按 standalone 展示。

### R3：上下文浮窗

- 上下文 chip 单独触发浮窗，标题为“上下文占用”。
- 首区展示当前选中 Session：角色标识、本体/child、百分比、已用 tokens、context window、状态。
- 父 Session 存在 Studio children 时，第二部分按占用风险优先、再按最近状态/稳定名称排序列出 children。
- 每个 child 行至少显示 member/step 可读标签、状态、上下文占用；值不可用时显示“暂无上下文数据”，可附 lifetime token/cost 作为明确标注的次要信息，但不得混为上下文。
- 多于可视数量时浮窗内部滚动，不撑出 viewport。

### R4：颜色与动效

- 建议阈值：正常 `<70%`、关注 `70–89%`、告警 `≥90%`、未知 neutral。
- 状态同时由百分比/文案/色彩表达。
- chip 数值更新允许短暂淡入或边框高亮；关注/告警可有低频、有限次数提示，不允许持续抢眼抖动。
- `prefers-reduced-motion: reduce` 禁用非必要动画。

### R5：响应式与交互

- 桌面支持 hover 与 focus 打开，鼠标从 trigger 移到 popover 不闪退。
- `Escape`、焦点离开和外部点击关闭；触屏点击切换。
- 建议保留优先级：上下文、费用 > input/output > cache；低宽度下允许隐藏次要 chip 或收进“更多”chip，具体以 HTML 原型审批为准。
- `≤640px` 当前整体隐藏 `.app-top-stats` 的行为不能被无意改变；若原型要求移动端可见，必须明确空间预算和关闭方式。

### R6：数据真实性

- 当前 Session 复用现有 `contextUsage`。
- child context 必须来自可审计的 context snapshot，不得用 `UsageTotals` 累计数推算百分比。
- 数据源暂不可得时返回/显示 explicit unavailable，不阻塞 parent 数据显示。
- 不返回 child 内容、prompt、output 或 artifact。

## 范围外

见 [brief.md](brief.md)：不变更计费逻辑、Studio 生命周期、JSONL header、全局 Usage 报表或整个顶栏布局。

## 成功指标

- 用户能在一次 hover/focus 内识别父/本体及 children 的 context 风险。
- 三种 Session 费用口径回归零变化。
- 无顶栏高度增长、无窄屏页面溢出、无 reduced-motion 违规。
- unavailable 数据不会被误呈现为 0% 或正常。

## 未决问题

1. child context snapshot 的准确来源尚不存在：批准“增加最小遥测/只读 API，未知时降级”，还是 MVP 先仅列 child 元数据与 lifetime usage 并明确无上下文数据？推荐前者。
2. `≤640px` 是继续隐藏整组 Session chips，还是保留“上下文 + 费用”两个关键 chip？需由 HTML 原型给出并经用户确认。
3. cache-write 是否继续不显示（当前只显示 cache-read）？推荐保持当前行为，避免范围扩大。
