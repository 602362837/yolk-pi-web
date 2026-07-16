# UI 设计说明：聚合用量浮窗动态窗口、主题与环尺寸修复

自包含 HTML 原型：[`usage-aggregate-theme-priority-prototype.html`](./usage-aggregate-theme-priority-prototype.html)

## UI Summary

- 外圈与中心不是 provider 固定窗口，而是公共 projector 对当前账号实际候选排序后得到的最短可信周期。
- 单窗口只显示单圈：原型包含 GPT only-7d 和 Grok only-week。
- mixed-window 使用乱序、非固定窗口输入，展示通用短→长结果。
- unknown-duration 展示安全降级：单个 unknown 可单圈；多窗口 unknown 不参与径向排序，留在详情；全部 unknown 且不止一个时不伪造 ring。
- 聚合浮窗消费全局 light/dark tokens；trigger 30px，浮窗 column header 40px（实现最低 38px）。
- 保留 provider 分栏、hover/focus + 220ms、Escape、层身份笔触、流光/reduced-motion 与无总环。

## 圈与中心契约

| 最终 projected layers | 渲染 | 中心 |
| --- | --- | --- |
| 1 层 | 单圈 Solid | 唯一实际窗口；duration 可未知 |
| 2 层 | 外 Solid / 内 Dashed | 外圈最短可信周期 |
| 3+ 层 | 外 Solid / 中间 Dashed / 内层 Dotted 身份延伸 | `layers[0]` |
| 0 层（多窗口全 unknown/tie） | 固定安全 fallback，无伪造 ring | 无 center |

当外圈 percent=`null` 时，中心保持该层 label 与 `—`，不得借用内圈。Kiro 等 provider 若显示 remaining，只能取同一中心 bucket 的 allowlisted 值。

## duration 与详情降级

- 原型的窗口数据携带 `durationMs` 仅用于模拟公共 projector，不由 provider preset 决定 layers 顺序。
- 仅有一个安全候选时无需排序，直接单圈。
- 多候选时，unknown duration 与重复 duration rank 的冲突窗口不进入圈，使用“另有窗口仅在详情展示”提示并继续显示详情卡片。
- 多候选全部不可比较时，列头显示“详情”fallback；不得按输入顺序、id 或 provider 经验挑一个中心。

## 原型场景

1. **动态正常**：实际候选经公共排序显示。
2. **only-7d**：GPT 无 5h，仅 7d 单圈。
3. **only-week**：Grok 无 month，仅 week 单圈。
4. **mixed-window**：每家输入窗口与顺序不同，最终均外短内长。
5. **unknown-duration**：覆盖 single unknown、known+unknown、all unknown multi。
6. **outer unknown percent**：外圈 `—`，不借内圈。
7. **warning / danger**：任一层独立风险。

所有场景可切换 light/dark、Desktop/640/375/320、provider enable 与 reduced-motion。

## Theme tokens

- 移除固定 `rgba(11,15,25,.98)` / `#1e293b`；panel、close、column、cards、center、status 均使用 `:root` / `html.dark` 的 usage semantic tokens或现有 `--bg* / --text* / --border`。
- 浅色 warning/danger 正文使用较深语义前景；深色使用较亮前景。弧色与正文色分开。
- center label 使用高对比 `--text`，value 至少使用可读的 usage center value token。
- `focus-visible` 不能只靠颜色微差表达。

## 响应式与可访问性

- Desktop 1–3 列；640px 最多 2 列；375/320px 单列。
- panel 宽度 clamp 到 `100vw - 16px`，内部滚动；长账号 ellipsis；ring `flex-shrink:0`。
- N-ring accessible name 按最终 outer→inner 列出层，并说明中心为外圈最短可比较窗口。
- detail-only/fallback 需有文本，不只靠空环或颜色；unknown 不产生虚假 `aria-valuenow=0`。

## UI 实现约束

1. adapter 不传预排序 index；公共 projector 产出 layers 与 `centerLayerId`。
2. used arc 流光继续使用 SVG `<mask>`，`prefers-reduced-motion` 静态降级。
3. 保持 openReason 与 220ms grace；Escape 防重开规则不变。
4. aggregate shell 不读取 provider schema、不 fetch、不展示 secret/raw evidence。

## Review Checklist

- [ ] only-7d / only-week 是否各只有一个圈且中心正确？
- [ ] mixed-window 是否不受候选输入顺序和 provider 影响，始终外短内长？
- [ ] single unknown 是否单圈；known+unknown 是否有详情提示；all unknown multi 是否无伪造 ring？
- [ ] 外圈 percent unknown 是否中心 `—` 且不借内圈？
- [ ] light/dark 的 panel、按钮、文字、状态和 fallback 是否清晰？
- [ ] panel 环是否为 40px/至少 38px，320px 是否无横向溢出？
- [ ] hover/focus/Escape、流光/reduced-motion 与非 accordion 分栏是否保留？

## 审批请求

请主会话/用户审批修订后的动态窗口策略与 HTML 原型。审批前不得进入实现。
