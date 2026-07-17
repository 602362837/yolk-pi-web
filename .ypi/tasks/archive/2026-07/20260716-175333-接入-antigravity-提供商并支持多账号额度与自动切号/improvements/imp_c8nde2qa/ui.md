# UI：IMP-001 组聚合 + 双独立圆环

## 门禁

- HTML：[`antigravity-grouped-quota-prototype.html`](./antigravity-grouped-quota-prototype.html)
- **已修订**：Flash / Opus 为 **并排独立环**，不是同心内外环。

## 顶栏

### 正确布局

```text
Antigravity   [● Flash 85%]  [● Opus 12%]
               独立环1          独立环2
```

- 每环：short label（Flash / Opus）+ 单层进度环 + 可选中心 used%。
- **禁止** 单环内外两层分别表示 Flash 与 Opus。
- 仅一组有数据：只显示一个环。
- 无优先组：无环 + 「多模型」。

### Aggregate

- 第四列列头：同样并排两 small 独立环（方案 A），或摘要单环 + 列内双环（方案 B，次选）。
- 无跨组 / 跨 provider 总百分比。

### 详情

- 组 accordion：Flash → Opus → Sonnet → Pro → 2.5 → Other。
- 折叠：组名 + 保守 used%。
- 展开：变体；reset 文案可选。
- 组内若未来有 5h/周，用 **列表行** 表达周期，不用 Flash/Opus 当内外环。

## 状态矩阵

| 状态 | 顶栏 |
| --- | --- |
| live_double_independent | 两独立环 |
| live_single_ring | 一独立环 |
| live_other_only | 多模型 |
| loading / reauth / no_account / no_usable | 安全文案 |

## 实现校正

1. 聚合 `max(used)`。  
2. 无 per-variant 刷新。  
3. 禁止 outer=Flash inner=Opus。  
4. 文案标明「组（保守）」。  
5. Failover 不读 group。

## 审批

见 [`plan-review.md`](./plan-review.md)。
