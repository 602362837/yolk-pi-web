# Design

## 方案摘要

以 Pi Model Registry 的 resolved 模型为读侧，以 `~/.pi/agent/models.json` 为唯一价格写侧；新增独立价格服务/API/UI。Usage 采用兼容退役策略：停止复制和聚合 cache-write，用 deprecated 零字段维持 v1 wire shape，历史账本文件保持不可变。智能填写采用“受控来源抓取 -> 确定性匹配 -> AI 结构化辅助 -> 用户确认 -> 最小 merge 保存”。

## 影响模块

### Usage/账本

- `lib/llm-usage-types.ts`：标记 cacheWrite 字段 deprecated；兼容期保留数字字段。
- `lib/llm-usage-normalize.ts`：新事件不读取 SDK cache-write，字段归零，不输出 `cacheWrite1h`；保留 SDK `totalTokens`、`cost.total`。
- `lib/llm-usage-query.ts`：忽略历史 cache-write 聚合；coverage 增加口径说明。
- `lib/usage-stats.ts`：legacy 聚合不累加 cache-write；wire 字段固定 0。
- `hooks/useAgentSession.ts`、`MessageView.tsx`、`SessionStatsChips.tsx`、`UsageStatsModal.tsx`、`UsageProviderModelTable.tsx`、`ChatWindow.tsx`：删除 cache-write 参与的本地 fallback/展示/key，保留兼容类型。
- 新增共享 `lib/token-format.ts`：exact、M、compact 格式化，确保 UI 不各自舍入。

### 价格配置

建议新增：

- `lib/model-price-types.ts`：只含公开 wire contracts。
- `lib/model-price-config.ts`：读取 resolved models、定位写入方式、校验价格、原子最小 merge、revision。
- `lib/model-price-sources.ts`：固定来源适配器、抓取预算、来源证据。
- `lib/model-price-assistant.ts`：调用配置的 AI policy，对受控证据做结构化匹配；无证据时禁止生成价格。
- `app/api/model-prices/route.ts`：GET 列表，PATCH/PUT 应用已确认的单个/批次价格。
- `app/api/model-prices/suggest/route.ts`：POST 智能建议，不写配置。
- `components/ModelPricesConfig.tsx`：设置页主体。
- `SettingsConfig.tsx`：导航与 AI pricing policy 配置；建议在 `usage.pricingAssistant` / `usage.pricingAssistantFallback` 中复用 `PiWebSubagentRunPolicy`。

## 数据模型

```ts
interface ModelPriceRecord {
  provider: string;
  model: string;
  displayName?: string;
  modelKind: "builtin_or_extension" | "custom";
  status: "missing" | "configured" | "builtin" | "free";
  resolved: { input: number; output: number; cacheRead: number };
  override?: { input?: number; output?: number; cacheRead?: number };
  source: "builtin" | "models_json_override" | "custom_model" | "explicit_free";
  revision: string;
}

interface ModelPriceSuggestion {
  provider: string;
  model: string;
  prices: { input?: number; output?: number; cacheRead?: number };
  currency: "USD";
  unit: "per_1m_tokens";
  confidence: "high" | "medium" | "low";
  matchMethod: "exact" | "alias" | "ai_assisted";
  evidence: Array<{ url: string; title: string; fetchedAt: string; excerptHash: string }>;
  warnings: string[];
}
```

`models.json` 持久化建议：

- 内置/扩展：`providers[p].modelOverrides[m].cost.{input,output,cacheRead}`。
- 自定义：定位 `providers[p].models` 中 id 精确匹配并 merge `cost`。
- 显式免费：需要用户可区分的项目自有元数据。推荐写 `providers[p].modelOverrides[m].metadata.yolkPrice = { free: true, source: "user", updatedAt }` **前需验证 Pi schema 是否允许未知 metadata**。若不允许，应在 `pi-web.json` 保存仅用于 UI 的 `usage.explicitFreeModels[]`，实际 `cost` 仍写 0。此项是实现前 schema spike。
- 不删除/归零已有 `cost.cacheWrite` 或 `cost.tiers`；本页不展示也不改写它们。

## API 契约

### GET `/api/model-prices`

Query：可选 `cwd`，仅用于创建与当前项目一致的 Model Registry services，必须经过 allowed-root 校验。

返回：`{ schemaVersion: 1, revision, models, assistantPolicy }`。不得返回完整 `models.json`、API key、headers、baseUrl secrets 或绝对路径。

### PATCH `/api/model-prices`

Body：`{ revision, changes: [{ provider, model, prices, explicitFree? }] }`，批次上限 50。

行为：校验 -> 重新读文件并比 revision -> 定位模型 -> 最小 merge -> 临时文件+rename -> registry reload 验证。409 表示并发冲突，422 表示字段/目标无效。响应只返回变更模型的 resolved projection。

### POST `/api/model-prices/suggest`

Body：`{ targets: [{ provider, model }], cwd? }`，上限 20，不接受 URL、prompt、文件路径或凭据。

返回：`{ suggestions, unresolved, warnings, generatedAt }`。始终只建议，不保存。网络/AI 部分失败允许 200 partial；完全不可用使用明确 502/503。

## 数据流

```text
Settings UI
  -> GET model-prices
  -> 用户选择模型
  -> POST suggest
       -> 固定来源 adapter (OpenRouter catalog / official allowlist)
       -> bounded evidence
       -> deterministic exact/alias match
       -> optional configured AI JSON extraction
  <- suggestions + citations + warnings
  -> 用户编辑/勾选/确认
  -> PATCH model-prices(revision, changes)
       -> merge models.json atomically
       -> reload Model Registry and verify
  <- effective records
```

后续新调用由 Pi Registry 使用该 cost 计算 assistant `usage.cost.total`；既有 session/ledger 不重算。

## AI 查价来源与信任边界

- 首期来源优先级：当前 Pi built-in resolved cost（无需 AI）> provider 官方定价适配器 > OpenRouter 公共模型目录（仅同路由或明确标注代理差异）> 无结果。
- AI 输入只包含 provider/model、来源标题、URL 与有长度上限的价格相关片段；输出用严格 JSON schema 校验。
- AI 不能自行访问网络、models/auth 文件或工具；不得把“常识价格”当证据。
- provider 与模型仅别名匹配时降置信度；OpenRouter 的价格不能直接覆盖 direct-provider 价格，除非来源明确等价。
- tier、批量折扣、缓存策略、订阅/免费额度不折算为基础单价，返回 warning 交给用户。

## 兼容与迁移

- 不迁移/改写 `usage-events/v1` 和 session JSONL。
- v1 API cacheWrite 字段保留并归零，文档标记 deprecated；UI 不消费。
- `cost.total` 历史保持记录时值，价格配置仅影响未来调用。
- 旧 `models.json` 无价格配置无需迁移；首次保存按需创建最小节点。
- `models.json` 支持 JSONC，而现有 route 使用 `JSON.parse`。价格写服务必须先解决 JSONC 保真：推荐使用 Pi 已采用的 JSONC parser 读取，写入前备份并原子输出；若无法保留注释，必须在 UI 明示且经产品确认，不能静默损失注释。
- 回滚：隐藏新设置页/停用 suggest route；价格 override 可由 UI 恢复前值，历史数据无需回滚。Cache-write 采集回滚只恢复新事件读取，不修改已产生的零字段事件。

## 风险

- 总 Token 与可见拆分项不相等：SDK authoritative total 可能包含已隐藏的 cache write。UI 必须称“Provider total”，不能承诺等式。
- 价格为 0 无法区分缺失与免费：需完成 explicit-free metadata spike。
- 网关/代理价格不同于底层模型官网价：来源必须 provider-scoped，低置信度默认不应用。
- JSONC 注释丢失与并发覆盖：原子 merge、revision、备份、冲突响应。
- 当前参考项目未找到可审计的智能识别实现：只复用交互思想，不依赖其私有行为。
