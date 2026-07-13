# Brief：Chat 顶部 Session 指标标签化与子 Session 上下文浮窗

## 目标与背景

当前 Chat 顶部将 input/output/cache/费用/上下文占用以一行灰字展示，信息层级弱，计费与上下文的悬停入口也绑定在同一个区域。目标是在不显著增加顶栏高度的前提下，将指标改为可辨识的 chip/tag，并让“上下文”成为独立悬停入口，展示当前 Session 与 YPI Studio 子 Session 的上下文情况。

## 范围内

- 将 input、output、cache、费用、上下文指标改为紧凑 chip/tag 视觉。
- 保留现有 token/费用格式与已确认的 parent / standalone / studio_child 计费口径。
- 费用 chip 继续提供计费组成浮窗。
- 上下文 chip 提供独立浮窗：本体 Session 在首行，Studio children 在下方列表。
- 对上下文占用设置正常、关注、告警颜色层级，并提供轻微、非干扰动画。
- 覆盖无数据、未知、加载、无子 Session、多子 Session、长标题、窄屏、键盘与 reduced-motion 状态。
- 必要时以最小增量补充子 Session 上下文数据契约，并更新 `docs/modules/frontend.md`；若 API 契约变化，同时更新 `docs/modules/api.md` 与架构文档。

## 非目标

- 不改变 token 或费用计算规则，不引入新的计费估算。
- 不把 Studio child transcript、prompt、output 或 artifact 注入父 Session。
- 不改变 Session/Studio 生命周期、绑定、审批、归档或 JSONL header。
- 不重做整个顶栏或 ChatGPT usage 组件。
- 不增加费用报表、预算配置、手动刷新或子 Session 操作按钮。
- 不将 lifetime token usage 冒充为当前 context occupancy。

## 约束

- UI 原型门禁已触发：实现前必须由 `ui-designer` 交付 HTML 原型并由用户审批；纯 Markdown 不满足门禁。
- 优先复用 `AppShell`、`sessionStats`、`contextUsage`、`BillingPopover` 与 `ChatGptUsagePanel` 的既有模式。
- 顶栏高度保持不变；桌面紧凑展示，窄屏必须有明确的隐藏/折叠/溢出方案。
- 颜色不能成为唯一状态信号；百分比、文案和图形共同表达状态。
- 动画必须轻微，且在 `prefers-reduced-motion: reduce` 下禁用。
- 保留计费展示口径：parent 显示 parent rollup 且仅在 child 有真实 usage 时标记 `incl. Studio`；standalone 显示自身；studio_child compact 仅显示 child 自身，tooltip 可附 parent rollup。
- 现有 rollup 有 child usage/元数据但没有 child 当前 context occupancy；设计必须明确缺口，不得猜值。

## 验收要点

1. input/output/cache/费用/上下文以统一、紧凑且主题兼容的 chip 展示，不显著拉高顶栏。
2. 费用浮窗保持原有三类 Session 口径与 own/children 拆分。
3. 上下文浮窗明确区分“当前 Session”和“Studio children”，显示百分比、已用 tokens / context window、状态色；未知值明确显示“暂无上下文数据”。
4. 子 Session 不得以累计 usage token 替代上下文占用；数据不可用时诚实降级。
5. 占用阈值建议为 `<70%` 正常、`70–89%` 关注、`≥90%` 告警；最终视觉与动效以获批 HTML 原型为准。
6. 浮窗支持 hover 与键盘 focus，鼠标可移入浮窗，Escape/失焦可关闭；触屏提供点击切换或明确降级。
7. 多子 Session 列表有高度上限和内部滚动；长名称截断但可读完整信息。
8. 窄屏不产生横向页面溢出；关键指标的保留优先级由原型明确。
9. reduced-motion 下无脉冲/流光动画，状态仍可理解。
10. lint、TypeScript 检查通过，并完成桌面、窄屏、明暗主题和 parent/standalone/studio_child 人工回归。

## 当前阻塞

当前委派成员运行环境未暴露 Studio member/subagent 调度工具，架构师无法在本次 child run 内实际派发 `ui-designer`。因此可先完成规划文档，但 HTML 原型门禁仍未满足；主 Session 需派发 UI 设计员后才能请求计划审批或进入实现。
