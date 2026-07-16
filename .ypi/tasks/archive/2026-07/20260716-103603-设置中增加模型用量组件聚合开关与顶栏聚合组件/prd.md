# PRD：模型用量组件聚合（v6 多环、流光与焦点分栏版）

## 目标与背景

多个 provider 用量组件同时启用时，Chat 顶栏会随 GPT、Grok、Kiro trigger 数量横向增长。本功能新增默认关闭的聚合模式，并统一 quota trigger 的表达：**1 个安全窗口 = 1 个环，N 个安全窗口 = N 个同心环；外层为较长窗口、内层为较短窗口；中心一律显示最内圈。**

聚合入口改为 hover / keyboard focus 触发，展开后按 provider 分栏同时展示，不再使用一次只展开一家的 accordion。

## 用户价值

- 多 provider 时减少顶栏入口数量，同时保留每家的独立语义和操作。
- 多窗口在一个同心单元中比较；稳定层色/笔触让内外环明显可辨。
- used arc 的轻微流动提示“已使用区间”，reduced-motion 用户获得等价静态信息。
- 中心规则统一为最内圈，减少 GPT/Grok/Kiro 认知分裂。
- hover 可快速浏览，键盘 focus 可完整到达，不要求额外点击。

## 范围内需求与验收标准

### FR-1 配置与默认值

- Settings → Usage 新增「模型用量组件聚合」toggle。
- 保存为 `usage.providerPanelsAggregated`；default/missing=`false`，仅接受 boolean。
- partial usage patch 保留其他 usage 字段。

**验收：** 新安装、旧配置、恢复默认值均关闭；保存/重载稳定；不新增配置文件。

### FR-2 Standalone Full / Compact

- aggregate=false 时仍按 GPT → Grok → Kiro 独立挂载；provider enable、弹层、操作、host/padding 不变。
- Full/Compact 正常 quota 均使用共享 N-ring primitive；Compact 不再用常态文字 summary chips。
- standalone Full/Compact **继续 click 打开/关闭各自 detail**，保持现有可发现性与兼容性；本期 hover/focus-primary 只用于 aggregate。
- 无可信 quota 时仍显示 loading/login/reauth/error 短 fallback。

**验收：** standalone 点击、焦点恢复和 provider 操作无回归；多窗口不再并排为多个独立单元。

### FR-3 统一多环、层身份与中心规则

- 每个可安全展示且可可靠排序的窗口占一层：1 window=single ring，N windows=N concentric rings。
- `layers` 顺序固定为 outer → inner，即长 → 短；primitive 不根据 label、percent、reset 或 provider 名猜顺序。
- GPT：周在外、5h 在内；Grok：月/更长窗口在外、周在内。
- Kiro 与 GPT/Grok 逻辑一致：所有安全可投影且能由 normalized metadata 可靠排序的窗口都显示为多环；不能安全展示或排序的窗口不得硬塞入多环，并保留在详情。
- **centerLayerId 始终等于 innermost available layer（`layers[layers.length - 1]`）**。窗口存在但 percent unknown 时仍是 available layer，中心显示该层 label + `—`；只有该窗口不存在/被安全过滤时才退到下一内层。
- 每层具有稳定、明显可区分的 layer identity（固定色相 token 或明确 stroke 风格），不能只靠微弱透明度。
- 每层 percent 独立 clamp `[0,100]`，`>=95` danger、`>=80` warning、其余 normal；warning/danger 作为本层第二视觉通道叠加，不能抹掉层身份或形成 composite percent。
- `percent:null` 显示 muted empty arc，不等于 0%，无 `aria-valuenow=0`。

**验收：** 几何、中心、title/aria 口径一致；GPT 中心 5h，Grok 双层中心改为周；N 层时中心永远是最内层。

### FR-4 Used arc 流动效果

- 每个可信且 `percent>0` 的 used arc 显示 subtle flowing / sheen animation；动画只覆盖已使用弧，不改变弧长、percent、tone 或层身份。
- unknown/0% 不制造流动 used arc；loading spinner 与 used-arc animation 分离。
- `prefers-reduced-motion: reduce` 时 used arc、面板过渡及非必要 spinner 装饰停止；静态弧、文字与状态仍完整。
- 动画优先 CSS/mask 实现，不使用持续 JS timer，不引发数据刷新或布局抖动。

**验收：** 流动不会看起来像 percent 增长；多环动画不遮盖相邻层；reduced-motion 下无流光。

### FR-5 聚合 trigger 与 hover/focus 生命周期

- aggregate=true 且至少一个 provider enabled 时只挂载一个 aggregate trigger；一个 provider 也使用聚合壳，零 provider 时 host 隐藏。
- 按 GPT → Grok → Kiro 显示 enabled provider；每家一个 N-ring unit，无总环。
- pointer hover trigger 或 keyboard focus trigger 时打开；点击不是必需的 primary toggle，pointer click 因 focus 可保持打开。
- trigger 与 panel 是同一交互区域：pointer 或 focus 在任一者内时保持打开；离开两者后固定 **220ms grace delay** 再关闭，重新进入会取消 timer。
- `focusout` 后仅当焦点确实不在 trigger/panel 内才关闭；不得因 portal/relatedTarget 短暂为空立即闪退。
- Escape 关闭。若焦点在 panel 内则回到 trigger，并设置“抑制自动重开”直到 trigger blur 或新的明确 pointer enter；若焦点本就在 trigger 上则保持焦点但抑制重开。
- blur/mouseleave 关闭不把焦点强拉回 trigger；pointer 用户不应被程序抢焦点。

**验收：** 鼠标可跨越 trigger→panel 间隙，键盘可从 trigger Tab 进入 panel；Escape 不产生关闭后立刻重开循环。

### FR-6 聚合面板分栏

- 面板不是 accordion；所有 enabled provider 的摘要与明细入口同时存在。
- Desktop 采用按 provider 的 1–3 列 grid；窄屏可响应式换为两列/单列纵向卡片，但不能隐藏 provider 或退回一次只展示一家。
- 每列拥有 provider 名称、状态、N-ring 摘要、quota/account 操作区或进入完整 Models 的入口；具体密度由 UI v6 审批。
- GPT/Grok/Kiro 原刷新、Active、Models、quota/cache/race 语义不变；GPT Reset/scheduler/lock 保留。
- 打开 Models 前关闭 aggregate；不新增“刷新全部”。

**验收：** 三家可同时浏览；provider 操作仍各自隔离；面板内部滚动且 viewport-clamped。

### FR-7 Aggregate 与 Compact 优先级

- aggregate 优先；aggregated=true 时 Settings 禁用 Compact toggle 但保留其值，并说明关闭聚合后恢复。
- 关闭 aggregate 后恢复用户 Compact 偏好。

### FR-8 Kiro 数据安全

- Kiro percent 只来自每个安全 bucket 的可信 utilization；remaining 不换算百分比，也不参与窗口排序。
- 多 bucket 排序只依据显式、归一化且可靠的 duration/order metadata；禁止根据 reset、remaining、单位、数组顺序或产品常识猜测。
- 无法安全排序时只展示能确定的单层摘要，其他 bucket 留在详情；这属于统一安全前置条件，不是 Kiro 特殊的默认单环产品规则。
- 文案不泄露 accountId、credential、profileArn、raw body/URL/path/error。

### FR-9 可访问性与响应式

- N-ring accessible name/title 按 outer→inner 列出所有层的 full label、percent/unknown，并说明中心为 innermost。
- 装饰 arcs/流光 `aria-hidden`；颜色和动画都不是唯一信息来源。
- aggregate trigger 提供 `aria-haspopup`、`aria-expanded`、`aria-controls`；panel 为非模态可交互 popover/dialog，Tab 顺序可进入每列操作。
- 320/375/640/Desktop 的环尺寸、层宽/间距、列布局、hover bridge 与 panel 宽度由 UI v6 HTML 原型确认。

## 范围外

- 跨 provider 数学聚合、总环、总百分比或单位换算。
- 新 quota API/schema、刷新全部、跨 provider 账号联动。
- 从不完整 metadata 猜窗口长短、Kiro remaining→percent。
- 将 standalone detail 改为 hover-only。
- 修改 Usage ledger、Session rollup、provider failover/enable 语义。

## 非功能要求

- aggregate 每 enabled provider 仅一份状态实例；disabled provider 不挂载。
- 保留 request generation/accountId race guard。
- used-arc animation 不驱动 React state、不增加网络请求。
- aggregate 默认关闭，无磁盘迁移。

## 待审批

本 PRD 已按用户反馈写死行为，但 **UI v6 HTML 原型尚未交付**。必须先由 UI 设计员确认层色/stroke、流光、分栏密度、hover/focus 延迟关闭及 320px 方案，再请求用户对同一 revision 批准。