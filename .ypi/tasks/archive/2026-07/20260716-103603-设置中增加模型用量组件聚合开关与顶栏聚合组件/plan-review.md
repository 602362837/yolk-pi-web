# 计划审批书：模型用量组件聚合（v6 多环 / 流光 / 焦点分栏）

> **审批状态：可再次审批。** 用户反馈已全部吸收，PRD / Design / Implement / Checks 与 **UI v6 HTML 原型** 已就绪。请审阅后明确批准或提出修改；批准前不得进入实现。

## 本轮已写死决策

1. **统一 N-ring**：1 个安全窗口=1环，N 个安全且可可靠排序窗口=N 个同心环；外长内短。
2. **中心一律最内层**：`centerLayerId = layers[layers.length - 1]`。GPT 中心 `5h`；Grok 双层中心改为 `周`；最内层 unknown 显示 `—`，不借外圈值。
3. **Kiro 与 GPT/Grok 同规则**：只有一种=一圈，多种=多圈；remaining 不换算 percent；不安全 metadata 仍禁止猜测。
4. **层身份明显**：内外层固定可区分色相/stroke（solid / dashed / dotted 等），不能只靠透明度；warning/danger 作为本层第二通道叠加。
5. **used arc 流光**：只在已使用弧内做 subtle CSS flow，不改变弧长；`prefers-reduced-motion` 完全停止。
6. **聚合 hover/focus 打开**：点击不是 primary toggle；trigger/panel 共用 hover/focus 生命周期，离开两者后固定 **220ms** grace 关闭；Escape 关闭并防 focus 立刻重开。
7. **面板按 provider 分栏**：所有 enabled provider 同时展示，**不再 accordion**；窄屏响应式列数，不隐藏 provider。
8. **standalone 保持 click**：Full/Compact 仍点击打开各自 detail。
9. **已认可边界**：aggregate 默认关闭、Compact disabled 但保值、无总环/总百分比、无新 API、无刷新全部。

## 审阅材料

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI 说明（v6 已完成）](./ui.md)
- [HTML 交互原型（v6）](./model-usage-aggregate-prototype.html)
- [Design](./design.md)
- [Implement：7 项 schemaVersion 2 DAG](./implement.md)
- [Checks](./checks.md)

## PRD / Design 摘要

- 共享 `ProviderUsageRingUnit.layers` 按 outer→inner 排列；primitive 校验中心必须命中最后一层。
- layer identity 与 threshold tone 分离；unknown 为空弧；flow overlay 只裁剪在 used arc。
- aggregate shell 只消费 projection/detail slot，不 fetch、不解释 schema。
- hover/focus open reason 来自 trigger/panel 联集；全部离开后 220ms grace，重入取消。
- Escape 关闭后 suppression 防止 focus restore 立即重开。
- provider columns 同时在 DOM；Desktop 1–3 列，窄屏堆叠。

## Implement 摘要

仍为 7 项、`maxConcurrency=3`：

1. 配置与 Settings；
2. shared N-ring、层色/流光、aggregate hover/focus 分栏壳；
3. GPT `[周,5h]` + 中心最内层；
4. Grok `[月,周]` + 中心最内层（周）；
5. Kiro 统一 1/N 安全窗口；
6. AppShell 互斥 + 契约测试；
7. 文档与 UI v6 浏览器验收。

完整 DAG 见 [Implement](./implement.md)。主会话已保存/将刷新 machine-readable implementationPlan。

## Checks 摘要

- 自动：配置、1/2/N layers、innermost invariant、层 identity/tone、flow/reduced-motion、adapters、互斥挂载、安全 projection。
- 交互：hover bridge、220ms grace、focusout、Escape suppression、standalone click。
- 视觉：明显层色、独立 warning/danger、unknown、流光静态降级。
- 浏览器：Desktop/640/375/320，1/2/3 provider，Network 无双轮询。

## 原型已覆盖（v6）

- 多环几何 + solid/dashed/dotted 层身份；
- used-arc sheen + reduced-motion 开关；
- 中心 = 最内层（Grok 中心周）；
- 聚合 hover/focus + 220ms grace + Escape；
- 分栏 columns 替代 accordion；
- 1/2/3 provider 与多视口。

## 请用户重点确认

1. 中心周期文字 **始终以最内圈为基准**；
2. **外长内短** 同心多环；
3. **1 种=1圈，多种=多圈**（含 Kiro）；
4. 内外环 **固定可区分层色/笔触** + used arc **流光**（reduced-motion 可关）；
5. 聚合：**hover/focus 打开**，面板 **分栏同时展示**（非 accordion、非 click-primary）；
6. standalone 仍 click；默认关聚合、Compact 保值、无总环。

明确回复「批准 / 同意 / 开始实现」后进入实现；如有修改意见请直接说明。
