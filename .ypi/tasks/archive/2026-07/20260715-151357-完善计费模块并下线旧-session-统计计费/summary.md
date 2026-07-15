# summary

任务：完善计费模块并下线旧 session 统计计费  
结果：用户验收通过（2026-07-15）

## 交付摘要

1. **调用账本日期语义**
   - 本地日边界 → UTC 分区候选 → `occurredAt` 精确过滤
   - `byDay` / range / timezone 与本地日口径一致
   - focused query tests 覆盖 UTC+8 跨分区与边界

2. **下线旧全局 Session 统计**
   - 删除 Session 统计 tab / 全局聚合 UI
   - `GET /api/usage` 无 `sessionId` 返回 400，不再扫描 sessions
   - 保留 Chat 顶栏 `session_rollup`（parent / standalone / studio_child）

3. **Usage Ledger UI**
   - 默认/重置工作区 = 全部
   - source/status 统一 `SelectDropdown`
   - token 展示：**M 为主、exact 为辅**（两位小数）
   - 折线 + 柱状左右并排；使用量/费用共用切换
   - 柱状按模型叠色；折线按模型分线；hover 线条=最后一天
   - 单日时左侧折线区退化为模型占比饼图
   - 去掉 coverage / legacy 噪音

4. **文档**
   - AGENTS / architecture / api / frontend / library / troubleshooting 同步 ledger-only 与 session rollup 边界

## 验收后微调（review 阶段）

- 恢复 byDayModel 叠柱 / 多折线
- 折线/柱状并排，取消形态切换
- Token 拆分下移独立一行
- 单日饼图
- 折线命中层优化
- M 主 exact 辅

## 验证

- lint / tsc 通过
- `test:llm-usage-store` / `test:llm-usage-query` / `test:usage-rollup` 通过
- `http://localhost:30142` 浏览器验收通过
