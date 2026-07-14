# brief

## 背景

当前 Usage 同时存在两条路径：

- `/api/usage` 从 session JSONL 聚合，`UsageTotals` 含 `input/output/cacheRead/cacheWrite/cost/calls`。
- `/api/usage/calls` 从不可变 `usage-events/v1` 账本聚合，UI 展示 Cache R/W、总 Token、费用和图表。

模型价格由 Pi Model Registry 决定。项目已有 `ModelsConfig` 可编辑自定义模型 `cost`，但缺少面向“已发现但无价格”模型的集中配置、来源说明、智能建议和确认流程。Pi 官方支持在 `~/.pi/agent/models.json` 中通过 `providers.<provider>.modelOverrides.<model>.cost` 覆盖内置/扩展模型，通过 `providers.<provider>.models[].cost` 配置自定义模型；价格单位为 USD / 1M tokens。

## 目标

1. 停止新数据读取/持久化 cache-write token 用量，并从 Usage、顶栏、消息用量等用户界面移除该项。
2. token 主值始终保留整数最小单位，同时并列显示不替代主值的 M 换算。
3. 新增模型价格设置页，列出缺价与已配置模型，支持手填、智能建议、差异预览和显式确认。
4. 保持历史账本可读、配置可回滚、AI 不自动写配置，且不暴露凭据或允许任意 URL 抓取。

## 关键证据

- `lib/usage-stats.ts`、`hooks/useAgentSession.ts`、`SessionStatsChips.tsx`、`UsageStatsModal.tsx` 均累加或展示 `cacheWrite`。
- `lib/llm-usage-normalize.ts` 把 SDK `cacheWrite/cacheWrite1h/cost.cacheWrite` 写入 v1 账本；`lib/llm-usage-types.ts` 和 `UsageProviderModelTable.tsx` 聚合/展示它。
- `components/ModelsConfig.tsx` 已支持模型 `cost.input/output/cacheRead/cacheWrite`，但 `/api/models` 不返回 resolved cost/source。
- Pi `docs/models.md` 明确 `modelOverrides.cost` 可部分覆盖内置与扩展模型，自定义模型需写模型条目；tiers 是完整费率组。
- 参考项目实际管理中心来自 `router-for-me/Cli-Proxy-API-Management-Center` release asset；截至调研版本源码/`management.html` 未检索到可复用的 `model-prices` 实现，因此仅借鉴“识别 -> 建议 -> 用户确认”，不复制不明契约。

## 推荐决策

- **兼容删除，不破坏形状**：v1 类型/API 暂保留 deprecated `cacheWrite` 数字字段并固定返回 `0`；新事件不再从 SDK 复制 cache-write token 与分项费用。历史事件文件不改写、不删除，查询层忽略历史 cache-write 用量。后续大版本再移除字段。
- **费用口径不重算历史**：保留 SDK 已计算的 `cost.total`；停止展示 cache-write 分项。否则会让历史总费用发生追溯性变化。
- **价格存储复用 `models.json`**：不另建价格真相源，避免配置页价格与真实 SDK 计费脱节。服务端做最小字段 merge、原子写入和并发版本检查。
- **智能填写只产出建议**：固定来源适配器抓取公开定价数据，AI 仅做模型别名匹配和结构化提取；返回逐字段引用、置信度和警告，用户确认后才保存。

## 阻塞项

1. 产品需确认：历史 API 的 `cacheWrite` 是固定归零，还是旧日期仍返回历史值但 UI 隐藏。推荐固定归零，语义最一致。
2. 产品需确认：SDK `totalTokens` 若包含 cache write，是否继续作为账本总 Token。推荐继续采用 provider/SDK authoritative total，并标注拆分项不保证相加等于总数。
3. 产品需确认：智能查价首期来源范围。推荐 OpenRouter 公共模型目录 + 官方 allowlist 页面适配器；不开放任意 URL。
4. UI 门禁尚未满足：主会话必须派发 `ui-designer` 生成并提交 HTML 原型，用户批准后才能实现。
