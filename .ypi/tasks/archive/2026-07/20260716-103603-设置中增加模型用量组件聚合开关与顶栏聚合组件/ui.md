# UI 设计交付：模型用量组件聚合

> 状态：**UI v6 聚合与 N-ring 设计已完成，原型就绪，可供主会话与用户审批。**
> 
> 本轮（v6）根据用户最新反馈，全面实现了 **统一多环、层身份笔触区别、最内层中心锁、used arc CSS 流光与非手风琴分栏面板**。取代了原有的手风琴、单主环与 Click-primary 弹窗触发。

## v6 核心设计规范与特性

1. **同心嵌套多环架构 (Concentric Multi-Ring Geometry)**
   - 每个安全可展示窗口占一层：1 window = 1 layer (单环)，N windows = N concentric layers (同心环)，外层为较长周期窗口，内层为较短周期窗口。
   - **明显的层身份与笔触 (Layer Stroke Identity)**：为使多层在同时警告 (warning/danger) 时仍然可清晰辨别健康状况，我们设计了明确的笔触风格：
     - **最外层 (Outer layer / Layer 0)**：Solid 实线。
     - **中层 (Middle layer / Layer 1)**：Dashed 长虚线。
     - **最内层 (Innermost layer / Layer 2)**：Dotted 短虚线。
   - 每层 percent 独立 clamp `[0, 100]`，`>=95` 红色 (danger)，`>=80` 黄色 (warning)，其余按层分配颜色 (Outer: 青色 Cyan，Middle: 紫色 Violet，Inner: 粉色 Pink)。

2. **最内层中心规则 (Innermost Center Value & Unknowns)**
   - **中心主摘要 (Center Summary & Value)**：中心一律锁定 **最内层可用层 (Innermost available layer)** 的短标识与百分比。
   - **各提供商具体表现**：
     - **GPT**：双层时，外周内5h，最内层为 `5h`，中心固定显示 `5h` 及其百分比；单层时自适应显示实际层。
     - **Grok**：双层时，外月内周，最内层为 `周 (Week)`，中心固定显示 `周` 及其百分比（v6 废弃了 v5 锁外月的设计）；单层时自适应显示实际层。
     - **Kiro**：取消 primary 默认 single 特例，多个安全且可靠排序的窗口全部进入同心环，中心一律显示最内层。
   - **Unknown 未知百分比**：若某层 percent 为 `null` (如缺失或拉取失败)，该层在多环中显示为灰色 empty track，中心若属于此层则显示 `—`，**绝不借用其他外层/相邻层的百分比数值**，避免误导。

3. **已使用弧段流光 (Subtle CSS-only Used Arc Flow)**
   - 每一个可信且 `percent > 0` 的 used arc 在其上增加微妙的 CSS-only 流光动画 (`sheen-flow`)。
   - **高光限制 (Mask Clipping)**：通过 SVG 剪裁路径 (`clipPath`)，将流光高光精确裁切在已使用弧段的范围内流动，不会溢出到未使用的灰色 empty track 部分。0% 或 null 时完全无流光。
   - **减弱动画支持 (prefers-reduced-motion)**：完美响应 `@media (prefers-reduced-motion: reduce)` 规范与 `.reduced-motion` 辅助类，在减弱动效时，流光高光完全静止或静默隐藏。

4. **聚合交互与 Grace 延时 (Hover/Focus Life Cycle & Grace Timer)**
   - **Hover / keyboard focus 触发**：顶栏聚合 trigger pill 移去了 click-primary 要求，当 pointer hover 或键盘 Tab 聚焦 trigger 时平滑打开面板。
   - **220ms Grace 延时关闭**：trigger 与 panel 组成同一个逻辑交互区域。鼠标移动跨越 trigger 与 panel 之间的间隙或键盘 Tab 移出时，启动 220ms grace 关闭计时器，允许在 220ms 内移回重新激活面板，防止频繁瞬断闪退。
   - **Escape 防重开抑制 (Escape Focus Suppression)**：按 Escape 键可直接关闭面板并把 focus 归还给顶栏 trigger 按钮。此时，临时开启 `escapeSuppressed` 状态锁，防止 focus 重置事件导致面板被二次自动唤起。只有当 trigger blur (失去焦点) 或有全新的明确 pointerenter 移入时，状态锁才解除。

5. **非手风琴分栏面板 (Non-Accordion Columns Grid)**
   - 聚合面板取消了 Accordion (折叠手风琴一次只看一家) 的设计。所有 enabled provider (GPT / Grok / Kiro) 的摘要与 quota 信息以 **分栏 Columns Grid** 同时存在于 DOM 与可是区域中。
   - **响应式排布**：
     - **Desktop**：根据启用的 provider 数量自动分栏（1 - 3 列）。
     - **窄屏 (640px/375px/320px)**：自适应响应为 2列、1列纵向卡片，不隐藏任何服务商。
     - 每列包含独立的 Quota 进度条、Active 账号信息、账号切换列表与 [刷新额度] [管理] 按钮。

## HTML 原型交付

已在任务目录交付自包含、高度可交互的 v6 HTML 原型文件（包含 SVG rings 笔触、CSS 裁切流光及 hover/focus 状态机逻辑）：
👉 **[`./model-usage-aggregate-prototype.html`](./model-usage-aggregate-prototype.html)**

### 原型支持的功能与状态模拟：
1. **聚合与独立组件对比**：支持在 Settings 模拟页面实时开关“模型用量组件聚合”，aggregated=true 时禁用 Compact checkbox 并呈现 yellow hint。
2. **多设备视口模拟**：提供 Desktop (最大 1280px / 1-3列)，640px (1-2列)，375px (1列)，320px (1列) 窄屏分栏适配。
3. **v6 同轴 nested-rings 渲染**：完美实现了 1/2/3 环的 SVG Conic 笔触细化展示 (Outer solid, Middle dashed, Inner dotted)。
4. **CSS 流光与 A11y 模拟**：右上角提供 "prefers-reduced-motion" 勾选，验证流光高光瞬间静止，且 0% 或未知时无流光。
5. **多场景状态一键切换**：
   - 三家正常状态（GPT 中心 `5h`/`42%`，Grok 中心 `周`/`51%`，Kiro 双环中心 `Daily`/`20%`）
   - Grok 缓存过期状态（Grok Stale，保留 cached 环并标黄，列内显示 warning banner）
   - Kiro 需登录状态（Kiro Reauth，Kiro 显示为灰色 unknown 环，列内显示 danger banner）
   - GPT 正在刷新状态（GPT Busy，展示 spinner 加载中动画）
   - Grok/Kiro 额度未知状态（Unknown fallback，不设 0% 虚假环，显示 muted 灰环，中心 `—` / `—` 或周期标识 + `—`）
   - Kiro 仅有 remaining 状态（没有 utilization 比例时显示灰色 unknown 环，中心第一行 `Limits`，第二行 `—`）
   - 仅单 Kiro 启用状态（Single Provider aggregate trigger 展现）
   - **GPT 5h 未知, 周正常**：GPT 5h 为 `null` 显示为灰环空弧，周额度 37% 正常填充，中心 `5h`/`—`
   - **Grok 月度未知, 周正常**：Grok 月度为 `null` 显示为灰环空弧，周额度 51% 正常填充，中心 `周`/`51%`
   - **GPT 仅有周额度**：GPT 降级为周单环，中心 `周`/`37%`
   - **Grok 仅有周额度**：Grok 降级为周单环，中心 `周`/`51%`
   - **Kiro 三环嵌套**：Kiro 模拟展示 outer `Limits` + middle `Daily` + inner `Hourly` 的三环超限笔触（中心 `Hourly`/`10%`）
6. **交互保真操作**：指针移入 trigger 瞬间展现 Grid columns 面板，移出后有 220ms grace 关闭防抖；Tab focus 可直接达 Panel 各卡片内部；账号切换与额度刷新操作全局状态联动。

---

## UI Summary

- **设计目标**：优化顶栏用量组件显示，在多个 provider 启用时将散落的多个 Trigger 聚合成单一 Trigger，且不丢失一览性与服务商的隔离操作机制。
- **用户路径**：
  1. Settings → Usage 开启「模型用量组件聚合」；
  2. 顶栏合并为单个「用量」Pill Trigger。右侧展示已启用提供商（GPT/Grok/Kiro）的 **N-ring 同心嵌套用量环**，且环中心两行显示主窗口对应的“周期 + 百分比”，如 `[用量 · GPT ◯ Grok ◯ Kiro ◯ 余125]`。
  3. hover / keyboard focus Trigger 原地唤起固定定位的 `Aggregate Panel` 弹窗；
  4. 弹窗内平铺展示所有已启用的 provider 详情列，每列拥有单独的进度条、切换按钮、刷新按钮等；
  5. 快速点击「设为 Active」切换全局 Active 凭证，或点击「刷新额度」从上游更新状态。
- **信息架构**：
  ```
  [Topbar Trigger (用量 · GPT [Ring (center: 5h/42%)] · Grok [Ring (center: 周/51%)] · Kiro [Ring (center: Daily/20%)] [余125])]
      │
      └──► [Dialog Panel (role="dialog" - hover/focus boundary)]
            ├── Header (Title + Enabled Count + Close Button)
            └── Columns Grid (GPT / Grok / Kiro columns side-by-side)
                  ├── Column Header (Status Dot + Name + Short Summary Value + Mini Ring [Ring (center: innermost)])
                  └── Column Content (Active Account + Quota Progress Bars + Saved Accounts List + Action Buttons)
  ```

## Interaction States

| 场景 | Trigger 展示 | 面板初始状态 | 用户操作与反馈 |
| --- | --- | --- | --- |
| **三家正常** | `用量` + GPT 双环(外周solid/内5h dotted, 中心 5h/42%) + Grok 双环(外月solid/内周dashed, 中心 周/51%) + Kiro 双环(外Limits solid/内Daily dashed, 中心 Daily/20%) + `余 125` | 默认平铺三列分栏展示 | Tab 键可直接切换到第一列、第二列的 Account Selector 或 [刷新额度] 按钮；切换时全局状态同步 |
| **Grok 缓存过期** | Grok segment 保持中心 周/51% (黄色)，呈现警示 | 打开面板直接看到 Grok 列置顶黄色缓存过期 Alert 提示 | 允许点击「刷新额度」或点击「切换」同步消除警示状态 |
| **Kiro 需登录** | Kiro segment 变红 or 显示灰色未知单环 + 中心 Limits/? | 打开面板看到 Kiro 列置顶红色未登录 Alert 提示 | Quota 详情降级为未登录说明，提供「管理 Kiro」按钮跳转 |
| **GPT 刷新中** | GPT segment 双环显示 spinner 动画 | GPT 详情列呈现 Loading spinner 蒙版 | 刷新完成后自动同步新 Quota 并恢复状态 |
| **某家额度未知** | 对应 segment 环为 muted 灰双/单环 + 中心 周期/—，不伪造成 0% | 对应列展示“用量未知”提示，百分比展示为 — | 点击刷新可触发模拟轮询，完成后显示真实值 |
| **仅单家启用** | 仅显示对应服务商段落与主环，例如：`用量 · Kiro ◯ 余 125` | 仅挂载单列，宽度自适应收缩至 320px | 保留聚合壳与一致的 border-radius、对齐样式 |
| **关闭面板** | 失去高亮状态，恢复 border-slate | 销毁 DOM 状态，移除 listener | 按 Esc 键触发，并**还焦**给 Trigger 按钮，开启 220ms focus suppression |

## Responsive / Accessibility (响应式与无障碍)

1. **响应式约束**：
   - 宽度自适应：在 320px/375px/640px 下，Dialog 宽度被 viewport 夹紧（`width: min(520px, calc(100vw - 16px))`，左右 gutter &ge;8px）。
   - 分栏自适应：面板在宽屏下呈现多列横向 Grid，中窄屏 (640px) 自动呈现最多 2列 Grid，极窄屏 (375px/320px) 自动收缩为单列纵向排列。
   - ellipsis 保护：当账号名称或 ID 过长时，自动采用 CSS text-overflow: ellipsis 截断。
   - 尺寸可读性：因为圆环中心需要容纳两行周期与百分比数据，圆环外径由 14px 增大至 30px（小）/38px（大）以确保中心标签可读。
2. **Accessibility 契约**：
   - **Keyboard Navigation**：整个组件可完全通过 `Tab` 进行焦点导航，Enter/Space 操作。
   - **Aria Roles**：
     - Trigger 包含 `aria-expanded` (true/false) 及 `aria-controls="aggregatePanel"`。
     - Panel 声明 `role="dialog"`，带 `aria-label="模型用量"` 和 `aria-live="polite"`。
     - 进度条与用量环包含标准的 `aria-valuenow` / `aria-valuemin="0"` / `aria-valuemax="100"`，未知状态下不伪造 `valuenow`。
   - **Reduced Motion**：所有的转场、高光流移动效皆有过渡降级，避免闪烁。

## Implementation Notes

- **用量环 SVG 与中心标签**：`UsageRing` 应作为纯展示 SVG primitive，接收 `percent` 参数（`number | null`）和 `centerLabel` / `centerVal`。笔触根据 numLayers 自适应 (solid/dashed/dotted)。
- **状态单实例**：实现时，AppShell 需在 `aggregated=true` 时**互斥挂载**聚合组件，避免与 standalone panels 产生并发轮询与多份状态实例。
- **Kiro 语义**：优先从 `utilization` 字段提取利用率画环，`remaining` 格式化后作辅助文字或 tooltip，不得从 remaining 推导百分比。

## UI Checks

- [x] Settings 中开启聚合时，Compact 选项被置为 disabled 并有警告文本，但原有 Boolean 值在 pi-web.json 中不被冲掉。
- [x] 仅有一个 Provider 被启用时，依然使用聚合壳包装，不降级为 standalone Trigger 结构。
- [x] 外部点击面板、按 Escape 键或点击关闭按钮均能平滑关闭面板，并将 Focus 回传至顶栏的 Trigger 按钮。
- [x] 在 320px-375px 小屏下，Trigger 不会由于过多 Provider 被挤占裁切，面板内容不产生横向滚动条。
- [x] 服务商未知错误 and AWS credential/profileArn 等敏感机密决不能显示在 Trigger text 或 tooltip Projection 中。

---

## 视觉与设计变更历史
- **v6（当前版本）**：引入统一多环 (1环=1 window)，外长内短。最外层 Solid、中层 Dashed、最内层 Dotted 笔触风格独立。中心始终为最内层 (Grok 改为周)。used arc 增加 CSS 流光动画且支持 prefers-reduced-motion。面板完全改成非手风琴 provider columns 分栏。
- **v5**：引入同 provider 双窗口外长内短同心嵌套环架构。GPT 固定中心 `5h` 突出短时间压力；Grok 固定中心 `月` 维护月度口径。如果只有单个窗口则自动回退至单层环。
- **v4**：圆环中心直接体现额度周期/桶（GPT: `5h`/`周`，Grok: `月`/`周`，Kiro: 真实 primary bucket 标识）与百分比的两行结构。圆环尺寸从 v3 的 14px 调整为 30px（小）/36px（大）以确保中心标签可读。
- **v3**：聚合 trigger 改为每 provider 一个主用量环；standalone Compact 改为紧凑用量环；补 Kiro utilization/remaining/unknown 对照。
- **v2（已废止，仅作文字方案对照）**：多 provider 文字摘要 trigger、手风琴、focus 恢复与响应式折盘。
- **v1**：单一服务商面板设计规范。
