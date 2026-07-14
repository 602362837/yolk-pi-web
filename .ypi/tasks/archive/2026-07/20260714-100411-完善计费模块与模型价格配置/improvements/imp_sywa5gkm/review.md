# IMP-001 检查报告 (MODEL-MATCH-01)

**检查日期**: 2026-07-14  
**检查员**: 检查员 (checker)  
**子任务**: MODEL-MATCH-01 — 按模型名称标准化并扩展智能查价  
**改进**: IMP-001 "增强第三方模型名称识别与智能查价"

## 接受标准对照

| # | 标准 | 结果 | 证据 |
|---|------|------|------|
| 1 | 第三方别名可生成候选 | ✅ PASS | `normalizeModelId` 去日期后缀/版本标记；`PROVIDER_TO_OR_PREFIX` 映射 provider→OpenRouter 前缀；三级匹配策略 (exact → provider-prefixed → alias)；`tryDeterministicMatch` 实现完整管线 (`lib/model-price-sources.ts:224-275`) |
| 2 | 大响应不阻断定向查询 | ✅ PASS | `MAX_RESPONSE_SIZE = 512 * 1024` 限制；超限抛出 `SourceFetchError("size")`；`suggest/route.ts` 中 catalog 抓取失败仅加警告，AI 辅助阶段继续 (`app/api/model-prices/suggest/route.ts:188-191`) |
| 3 | 无证据不报价 | ✅ PASS | AI assistant 硬守卫: `excerpts.length === 0 → return null` (`lib/model-price-assistant.ts:169`)；AI 返回 `found: false` → null；无证据目标 → `unresolved` (`suggest/route.ts:239-241`) |
| 4 | 测试通过 | ✅ PASS | `test:model-prices`: 39/39 通过；`test:llm-usage-store`: 34/34 通过 (含 cacheWrite 清零更新) |

## 设计合约审查

### HTTP 安全
- ✅ 仅允许列表 HTTPS URL（`https://openrouter.ai/api/v1/models`）— `lib/model-price-sources.ts:57-59`
- ✅ 重定向仅跟到同允许列表主机，最多 3 次 (`MAX_REDIRECTS = 3`)
- ✅ 响应大小上限 512KB，MIME 验证，超时 (`FETCH_TIMEOUT_MS = 15_000`)
- ✅ 无 API key / session token / 用户凭据外发
- ✅ AI 仅接收预取、裁剪后的证据摘录（最多 8000 字符），无网络/文件/工具访问

### 数据安全
- ✅ GET `/api/model-prices` 脱敏：从不暴露 `apiKey`、`baseUrl`、`headers`、绝对路径、原始 `models.json` 全部内容
- ✅ 响应 `Cache-Control: no-store`（GET / PATCH / POST suggest 三类路由均设置）
- ✅ suggest 请求明确拒绝 `url`/`prompt`/`path`/`file`/`apiKey`/`key`/`token`/`secret` 字段
- ✅ 错误消息剥离绝对路径
- ✅ PATCH body 仅接受 `provider`/`model`/`prices`/`explicitFree`，`validatePricePatchChanges` 校验

### 写路径原子性
- ✅ `applyPricePatch`: 读当前状态 → 检查 revision → 备份 → 合并（纯函数，克隆输入）→ 原子写 (`tmp + rename`) → 更新 pi-web.json explicitFreeModels
- ✅ 并发控制: revision hash 不匹配 → 409；UI 保留用户草稿、提示重载
- ✅ 备份: 写前自动备份到 `models.json.pi-price-backup`
- ✅ 保存后通过 fresh ModelRegistry reload 验证有效成本（`verifyResolvedPrices`）
- ✅ 配置字段隔离：写操作不触碰 `apiKey`/`baseUrl`/`headers`/`compat`/`tiers`/`cost.cacheWrite`
- ✅ 批量限制：`MODEL_PRICE_PATCH_BATCH_MAX = 50`，`MODEL_PRICE_SUGGEST_TARGETS_MAX = 20`

### JSONC 处理
- ✅ `stripJsonComments` 去除 `//` 行注释和尾随逗号，保留字符串字面量、转义引号、URL 内双斜线
- ✅ 写出为干净 JSON（无注释）— 已知限制已在排障文档注明

### AI 辅助提取
- ✅ 仅在确定性匹配失败时有证据时才调用 AI
- ✅ 无默认模型配置 → AI 阶段跳过，返回警告
- ✅ AI 失败不阻断：仅返回确定性匹配 + unresolved
- ✅ 严格 JSON schema 输出验证：拒绝幻觉/畸形输出（`parseExtractionResult`）
- ✅ 超时和 per-model 错误隔离

### cacheWrite 移除
- ✅ `normalizeSdkUsage`: cacheWrite/cacheWrite1h/cost.cacheWrite 全部清零/省略
- ✅ `addLlmUsageToTotals`: 不再累加 cacheWrite（字段保持 0 向后兼容）
- ✅ `addTotals` / `addUsage` (usage-stats): 不再累加 cacheWrite
- ✅ `useAgentSession`: local fallback 和 rollup 的 total 计算均排除 cacheWrite
- ✅ Wire 类型保留 `cacheWrite` 字段（标记 `@deprecated`）保持向后兼容
- ✅ UI: UsageProviderModelTable "Cache R/W" 改名 "Cache Read"，移除 cache write 列/提示

## 代码质量

### 通过
- 类型安全、错误处理、路径边界均符合项目规范
- 导出类型和验证函数分离清晰 (`model-price-types` 为纯类型/校验)
- 来源适配器独立于 AI 助手，方便后续扩展新来源
- 测试覆盖全面：stripJsonComments (6)、computeRevision (3)、readModelsJsonRaw (5)、mergePriceChanges (9)、backup/write (4)、applyPricePatch (3)、验证函数 (9) = 39 测试
- Lint: 0 errors / 6 warnings (全部在测试脚本和 .ypi 内)
- TypeScript: `tsc --noEmit` 无错误

### 非阻塞发现

**F1. 死代码 `lib/model-price-config.ts`**
`classifyModelKind`、`resolveModelPriceStatus`、`isCustomOverrideModel`、`getModelOverrideKeys` 四个函数已 export 但未被任何调用方 import。`classifyModelKind` 存在逻辑错误——三元表达式两个分支均返回 `"builtin_or_extension"`（应有一个返回 `"custom"`）——不过因无人调用故无运行时影响。实际分类逻辑在 `buildPriceRecord` 内通过 `customModelIds.has(…)` 完成。建议后续清理。

**F2. `lib/token-format.ts` 未被引用**
新的集中化 token 显示格式化工具（`formatTokens`/`formatTokensM`/`formatTokensCompact`/`formatTokensLabel`/`sumTokens`）实现正确，但尚未接入现有组件。`UsageProviderModelTable.tsx` 和 `UsageStatsModal.tsx` 仍使用本地副本。本地副本已正确排除 cacheWrite，故无行为错误，但未达到文档所述 "所有 Usage/topbar/message footer/chart 渲染必须使用这些工具" 的目标。建议后续迁移。

**F3. PATCH route 未拒绝额外顶层字段**
suggest route 显式拒绝 `url`/`prompt` 等注入字段，PATCH route 仅从 body 取 `revision` 和 `changes`，忽略其余。额外字段无害但建议统一校验风格。

## 验证

| 命令 | 结果 |
|------|------|
| `npm run lint` | 0 errors, 6 warnings (全部在 test/.ypi 脚本) |
| `node_modules/.bin/tsc --noEmit` | 0 errors |
| `npm run test:model-prices` | 39 passed, 0 failed |
| `npm run test:llm-usage-store` | 34 passed, 0 failed |

## 裁决: ✅ PASS

所有 4 条接受标准已满足，设计合约完整，安全边界到位，验证全部通过。发现 3 个非阻塞问题（F1 死代码、F2 未接入集中 token 工具、F3 PATCH 校验风格差异），均不影响功能正确性和安全边界，可在后续清理中处理。
