# Checks：IMP-001

## 阻断项

1. 源码/测试中 **不得** 存在将 Flash 与 Opus 放入同一 `ProviderUsageRingUnit.layers` 的构造。  
2. 顶栏在两组均有数据时必须出现 **两个** ring 实例（并排），不是一层 Flash 一层 Opus 的同心环。  
3. `resetTime` 不得进入 `durationMs` / `durationEvidence`。  
4. Failover 候选不读取 group remaining。  
5. 组聚合为 max(used)/min(remaining)；无 avg/sum。  
6. token/projectId 不出 DOM。

## 自动

- `test:antigravity-quota-groups`（新建）  
- `test:antigravity-usage-panel` 扩展 multi independent rings  
- `test:provider-usage-aggregate` 扩展 Antigravity 列  
- lint / tsc  
- 既有 antigravity failover / model-quota 回归  

## 人工

- Full/Compact/Aggregate：双独立环、单环、多模型 fallback  
- 详情 accordion 去重  
- 320/375/640 + 键盘 Escape  

## 非目标验证

- 不要求伪造 5h/7d 双周期环（无上游证据）。  
