# Brief：IMP-001 按模型组聚合 Antigravity 额度并显示双独立圆环

## 反馈摘要

1. 聚合模式显示「多模型」，无可用 ring。  
2. 详情堆满重复变体。  
3. 要 **Gemini 3 Flash** 与 **Claude Opus 4.6** 两组重点展示。  
4. **用户纠正**：内外环表述的是不同周期；两组额度应是 **2 个独立圆环**，不是同一 N-ring 的 outer/inner。

## 目标

1. 固定 `quotaKey → groupId` 映射，组内去重。  
2. 组头/环代表值：`max(usedPercent)` / `min(remainingFraction)`（保守）。  
3. 顶栏 Full / Compact / Aggregate：Flash 组与 Opus 组各渲染 **一个独立 single-layer ring**（并排）。  
4. 详情与 Models：组折叠 + 展开变体。  
5. Failover **不** group-aware。

## 非目标

- 不把 Flash/Opus 塞进同一 `ringUnit.layers` 作内外环。  
- 不把 `resetTime` 伪造为 5h/7d duration 证据。  
- 不改 GPT/Grok/Kiro 周期 N-ring 语义。  
- 不引入 rotator；不改 wire 扁平 models[]。  
- 本会话改计划 artifacts + 原型；批准前不改生产代码。

## 关键决策

| 项 | 决策 |
| --- | --- |
| 双环含义 | **2 groups → 2 independent rings** |
| N-ring 内外层 | **仅周期**；Antigravity 组级顶栏默认 1 layer/组 |
| 若未来有可信 5h/7d | 可在 **单组内部** 再做 N-ring；与另一组无关 |
| 触发器 UI | 需支持 provider 挂 **多个 ringUnit** 或等价并排 slots（见 Design） |

## 门禁

- HTML 原型已按「双独立环」修订。  
- 需用户批准 plan-review 后实现。
