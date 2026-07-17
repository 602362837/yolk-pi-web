# PRD：IMP-001 按模型组聚合 Antigravity 额度与双独立圆环

## 背景

主任务已接入 Antigravity。验收中：

- 聚合/Compact 多模型无 duration → 「多模型」detail-only。
- 详情扁平列出大量近义变体。
- 用户要 Flash / Opus 两组重点额度。
- **纠正**：共享 N-ring **内外层 = 不同周期**，不能把两个模型组画成同心内外环。

## 用户价值

- 一眼看到 **两个独立圆环**：Gemini 3 Flash 组、Claude Opus 组。
- 详情按组折叠，展开变体，不再重复刷屏。
- 切号仍按 **当前请求模型**，不因同组其他变体误切。

## 范围内

### R1 固定模型组映射

- Web 固定 `quotaKey → groupId` 表，对齐 0.3.0 catalog/routing。
- 优先组（顶栏双独立环）：`gemini-3-flash`、`claude-opus`（标签强调 Opus 4.6）。
- 详情组序：Flash → Opus → Sonnet → Gemini Pro → Gemini 2.5 → Other。
- 未知 key → Other。

### R2 组内去重与保守聚合

- wire 仍 flat `models[]`。
- 同组 `window.id` 去重。
- `groupUsedPercent = max(used)`；`groupRemainingFraction = min(remaining)`。
- 禁止 avg/sum/挑「好看」代表。
- `resetsAt` 仅文案；**不是** duration / 排序证据。

### R3 顶栏：两组 = 两独立环

**正确：**

```text
[ Flash 单环 ]  [ Opus 单环 ]
```

**错误（禁止）：**

```text
同一 ringUnit: outer=Flash, inner=Opus
```

规则：

- Flash 与 Opus 均有安全数据 → **两个 single-layer ringUnit** 并排。
- 仅一组 → 只画一个独立环。
- 两组皆无、其他组有 → 无环，fallback「多模型」；详情仍分组。
- loading / 登录 / reauth / 不可用 → 沿用安全文案。
- Full / Compact / Aggregate **同源**；不双挂载、不双轮询。
- 每个环 center = **该组** 保守 used%；无跨组中心。
- 若未来单组具备可信 5h/7d duration 证据，可在 **该组自己的 ringUnit** 内做周期 N-ring；**不得**与另一模型组混层。

### R4 详情按组

- UsagePanel + Models QuotaView 同源分组 accordion。
- 折叠：组名 + 保守 used%。
- 展开：变体 key、used/remaining、reset 文案。
- 账号切换 generation/abort 清旧。

### R5 Failover 边界

- Path B **不** group-aware。
- 候选：当前 public model accepted keys 上 fresh/live remaining>0。
- 「组还有额度但当前模型 key 耗尽」→ 不切号。

### R6 测试 / 文档 / 回滚

- 契约：禁止 Flash/Opus 作为同一 unit outer/inner。
- 文档写明：独立环 vs 周期 N-ring。
- 回滚：去掉 multi independent rings，恢复扁平 detail-only。

## 范围外

- 不伪造 5h/7d bucket（上游无证据）。
- 不改 GPT/Grok/Kiro 周期 N-ring 语义。
- 不新增 per-variant 刷新 API。

## 验收标准

| ID | 标准 |
| --- | --- |
| A1 | 固定映射覆盖 0.3.0 keys；未知→other |
| A2 | 组聚合 = max(used)/min(remaining)；无 avg/sum |
| A3 | Flash+Opus 有数据时顶栏 **并排 2 独立环**，非同心内外 |
| A4 | 源码/测试禁止 outer=Flash&inner=Opus 构造 |
| A5 | 详情按组折叠，变体可展开，无重复刷屏 |
| A6 | Aggregate 第四列同源；无跨 provider 总% |
| A7 | Failover 回归：group remaining 不改变候选 |
| A8 | resetTime 不进 durationMs/durationEvidence |

## 风险

- 用户可能把两个环误读为「两个精确单 key」→ 文案标明组保守聚合。
- Trigger 现偏 single `ringUnit` → 需 multi-slot 或等价布局（Design）。
