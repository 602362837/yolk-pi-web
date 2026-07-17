# 计划审批书：IMP-001 按模型组聚合 Antigravity 额度与双独立圆环

> **状态：已根据用户反馈修订 — 两组额度 = 两个独立圆环（非内外环）。等待用户审批。**  
> 批准前不修改生产代码、不派发实现员。

## 规划材料

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI](./ui.md)
- [HTML 原型（本地打开）](./antigravity-grouped-quota-prototype.html)
- [Design](./design.md)
- [Implement：AG-G01…AG-G05](./implement.md)
- [Checks](./checks.md)

## 用户纠正（已吸收）

共享 N-ring 的 **内外环** 语义是 **不同计费/重置周期**（如 5h 外、7d 内），**不是**不同模型组。

因此 **禁止** 把：

- outer = Gemini Flash  
- inner = Claude Opus  

塞进 **同一个** `ProviderUsageRingUnit`。

正确语义：

| 组 | 顶栏呈现 |
| --- | --- |
| Gemini 3 Flash 组 | **独立圆环 A**（单层 unit，或该组未来有可信周期时才用组内 N-ring） |
| Claude Opus 4.6 组 | **独立圆环 B**（同上） |

两个圆环 **并排**，各自有标签、used%、title；**不是**同心双层。

参考其他平台：组内可有「5 小时 / 周」多周期条；当前 Antigravity `fetchAvailableModels` 仅暴露 per-key `remainingFraction` + `resetTime`，**没有**可证明的 5h/7d 双 bucket 证据 → **本改进不伪造周期**；组内周期条仅在详情用 reset 文案展示，不把 resetTime 当 duration。

## 目标摘要

1. 按固定模型组聚合（去重重复变体）。  
2. 顶栏/聚合：**两个独立圆环** = Flash 组 + Opus 组。  
3. 详情按组 accordion，展开变体。  
4. Failover 仍 public-model accepted keys，不 group-aware。

## 必须批准的技术决策

| 决策 | 选择 |
| --- | --- |
| 组 vs 周期 | **组 = 独立 ring 实例**；周期仍只属于同一 ring 的 layers |
| 双环几何 | **并排两个 single-layer ringUnit**（或 trigger 的 multi-ring slots）；**禁止** Flash/Opus 作 outer/inner |
| 中心数字 | 每个环各自 center = 该组保守 used%；**无**「外环中心代表 Opus」 |
| 聚合算法 | `max(used)` / `min(remaining)` 保守 |
| 映射 | 固定 0.3.0 quotaKey→group 表；未知→other |
| 仅一组有数据 | 只画 1 个独立环；另一组不画假 0% |
| 两组皆无、其他组有 | 无环 +「多模型/详情」；详情仍分组 |
| Failover | 不读 group remaining |

## 实现 DAG

AG-G01 映射/聚合 → AG-G02 **multi independent rings** 投影 → AG-G03/04 UI → AG-G05 回归文档。  
`maxConcurrency=2`。

## 审批请求

请确认：**两组额度 = 两个独立圆环（并排），不是内外周期环。**  
明确批准后进入实现。
