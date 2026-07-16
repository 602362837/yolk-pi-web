# Brief：模型用量组件聚合（v6 规划修订）

## 背景与目标

Chat 顶栏当前按 GPT → Grok → Kiro 独立挂载 provider 用量 trigger。本功能新增默认关闭的 `usage.providerPanelsAggregated`，开启后用一个聚合入口承载所有 enabled provider；关闭时保留 standalone 结构。

本轮根据用户新反馈统一多窗口与聚合交互：

- 一个安全可展示窗口对应一个环，多个窗口对应多个同心环，外长内短；GPT、Grok、Kiro 使用同一规则。
- 中心始终读取最内圈的周期短标签与百分比；最内圈百分比未知时显示 `—`，不借用外圈值。
- 各层用固定可区分色相或 stroke 风格表达层身份，warning/danger 再按本层阈值叠加。
- used arc 有轻微流光；`prefers-reduced-motion: reduce` 时完全静止。
- 聚合面板不再是 click-primary accordion：hover 或键盘 focus 打开，并按 provider 分栏同时展示；Escape 可关闭。

## 稳定决策

- aggregate 默认关闭；开启时 Compact toggle disabled 但保值；无跨 provider 总环/总百分比。
- standalone Full/Compact 仍点击打开原 provider detail，兼容现有行为。
- aggregate trigger 通过 hover/focus 打开；点击只因取得焦点而打开，不作为必需的 toggle 手势。
- 聚合面板与 trigger 组成同一交互区域：指针或焦点仍在任一区域时保持打开；离开两者后延迟关闭，避免跨越间隙闪退。
- Kiro 不再有“默认单环”特例；所有能安全投影且可靠排序的窗口都进入同心环。仍禁止根据 remaining、reset、单位、数组顺序或产品常识猜百分比/长短。
- provider 状态与操作保持单实例；无新 quota API、刷新全部或账号联动。

## 代码证据

- `components/ProviderUsageTrigger.tsx` 当前 full 用独立 conic rings、Compact 用文字 summaries，且 trigger 是 click button；需升级为共享 N-ring primitive，但 standalone click 语义可保留。
- `components/AppShell.tsx` 负责 GPT → Grok → Kiro 挂载和顶栏 host；聚合与 standalone 必须 JSX 互斥，不能 CSS 隐藏。
- GPT 已有 5h/week，Grok 已有 month/optional week，Kiro 有 primary/other buckets 与 safe utilization；adapter 应只投影安全窗口并给出可靠的外长内短顺序。

## UI v6 门禁

现有 `ui.md` 与 `model-usage-aggregate-prototype.html` 是 v5 accordion/旧配色与中心规则，已失效。主会话必须指派 UI 设计员交付 v6 HTML 原型，至少覆盖：

1. 2–N 层固定可区分层色/stroke 与逐层 warning/danger；
2. used arc 流光和 reduced-motion 静态版本；
3. 中心始终最内圈；GPT 外周内5h、Grok 外月内周、Kiro 多窗口同规则；
4. hover/focus 打开、跨 trigger/panel 延迟关闭、Escape 与焦点抑制重开；
5. 非 accordion 的 provider 分栏，Desktop/640/375/320 与 1/2/3 provider。

v6 原型和用户审批前不得实现。