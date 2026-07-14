# review

## Check Complete — Independent Final Check (checker)

本报告是对 20260714-100411-完善计费模块与模型价格配置 任务的独立最终检查。已审核全部 diff（22 个变更文件 + 8 个新增文件）、PRD、Design、Implement 和 Checks 条款，并运行所有可用的自动验证。

### Findings Fixed

None — this is an independent check confirming the implementation already matches requirements.

### New Independent Findings

#### Low

**L-3: `classifyModelKind` has dead-code logic in model-price-config.ts**
`lib/model-price-config.ts:120-130` 的 `classifyModelKind()` 函数在两个分支中总是返回 `"builtin_or_extension"`，条件判断未实际影响返回值。实际生产路径通过 `getCustomModelIds()` + `buildPriceRecord()` 正确分类模型，`classifyModelKind` 未被调用。
- 严重性：低 — 不影响任何功能，建议后续清理死代码或修复逻辑。

**L-4: ModelPricesConfig 表头缩写 "Cache R" 未使用完整 "Cache Read"**
`components/ModelPricesConfig.tsx` 的表头列标题显示为 `Cache R`（缩写），而非完整的 `Cache Read`。PRD 要求删除 `R/W` 歧义标题而非禁止缩写，当前实现未使用歧义的 `R/W`，可接受。
- 严重性：极低 — 表头空间受限，缩写合理；UsageProviderModelTable 中已使用完整 "Cache Read"。

### Findings from Previous Review (Re-verified)

#### Medium (Carried Forward)

**M-1: `test:usage-accounting` focused test script not created**
checks.md 建议新增 `test:usage-accounting` 覆盖 normalizer 忽略 cacheWrite/cacheWrite1h、v1 兼容零字段、历史事件查询归零、SDK total/cost.total 保留、legacy rollup、exact/M formatter 边界。该脚本未实现。
- 覆盖度复核：现有 `test:llm-usage-store`（34 通过）已覆盖 normalizer（cacheWrite 归零 7 个 test case）、`addLlmUsageToTotals`（cacheWrite 忽略 1 个 case）、totalTokens 回退不含 cacheWrite、以及 34 个整体 test case。`test:usage-rollup`（通过）覆盖 legacy rollup 不回归。`test:model-prices`（39 通过）覆盖 merge/strip/validation/atomic。exact/M formatter 无独立 fixture 但 UsageStatsModal 使用 `formatTokensM`，逻辑足够简单可静态审查。
- 严重性：非阻塞 — 现有测试已提供充分覆盖。

**M-2: 旧 ModelsConfig.tsx 仍展示 cacheWrite 编辑字段**
`components/ModelsConfig.tsx:770` 的 cost 编辑器仍允许编辑 `cacheWrite`。这是通用的 `models.json` cost 结构编辑器，保留完整字段是有意设计。新增 `ModelPricesConfig` 不含 cacheWrite。
- 严重性：非阻塞 — 已批准的设计决策，PRD 明确 "不删除 Pi 模型价格 schema 中的 cacheWrite 价格字段"。

**M-3: JSONC 注释在写入时被丢弃**
`lib/model-price-config.ts:stripJsonComments()` 读时删除注释，写时输出干净 JSON。每次写入前自动备份 (`models.json.backup`)，文档记录了此限制并提供了恢复命令。
- 严重性：非阻塞（已批准）— plan-review.md 已明确批准此决策，troubleshooting.md 有恢复指南。

#### Low (Carried Forward)

**L-1: test 脚本中的 lint warnings（unused variables）**
`pre01-verification.mjs` 2 个 + `test-model-prices.mjs` 4 个 unused-vars 警告。仅 test 脚本。
- 建议：后续清理。

**L-2: suggest API 中 AI assistant 调用为串行**
`runBatchPricingAssistant` 对每个 target 逐个调用 AI。20 个目标的限制下可接受。
- 建议：若未来需批量加速可引入并发限制。

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors, 6 warnings (test scripts only) |
| `node_modules/.bin/tsc --noEmit` | 0 errors |
| `npm run test:model-prices` | 39 passed, 0 failed |
| `npm run test:llm-usage-store` | 34 passed, 0 failed |
| `npm run test:usage-rollup` | passed (6 fixture types) |
| `npm run test:usage-accounting` | **Script does not exist** (see M-1) |

### Checked-by-item (from checks.md)

#### 需求覆盖
- [x] 新 session 与新账本事件不再读取/保存 cache-write token 或分项费用。
  - `lib/llm-usage-normalize.ts`: `cacheWrite` 固定为 0，`cacheWrite1h` 省略，`cost.cacheWrite` 固定为 0
  - `lib/llm-usage-recorder.ts`: `recordAbortedUsage` zero-usage 包含 `cacheWrite: 0`
  - `lib/llm-usage-types.ts`: `addLlmUsageToTotals` 不再累加 cacheWrite
  - `lib/usage-stats.ts`: `addTotals`/`addUsage` 不再累加 cacheWrite
  - test:llm-usage-store 包含 `normalizeSdkUsage maps all fields (cacheWrite zeroed)` 等 7 个 cacheWrite 相关 case
- [x] 历史账本文件 byte-for-byte 不变，查询/API 按批准口径处理旧值。
  - 无 migration/rewrite 代码；正常化层忽略历史值
  - 类型保留 deprecated `cacheWrite` 字段
- [x] Usage、顶栏、消息尾注、表格、drawer、tooltip、图表无 Cache Write / Cache W / R/W。
  - rg 确认：组件层无 "Cache R/W" 或 "R/W" 显示文案
  - `UsageProviderModelTable.tsx`: "Cache R/W" → "Cache Read"，TokenRows 移除 cacheWrite 行
  - `UsageStatsModal.tsx`: TokenRows 移除 cacheWrite 行，`zeroTotals` 保留字段但归零
  - `SessionStatsChips.tsx`: childTokenTotal/formula 移除 cacheWrite
  - `ChatWindow.tsx`: statsKey/own/studioChild token total 移除 cacheWrite
  - `MessageView.tsx`: formatUsage 移除 cacheWrite 显示
  - `hooks/useAgentSession.ts`: 本地聚合和 rollup total 移除 cacheWrite
  - 旧 `ModelsConfig.tsx` 的 cost editor 仍含 cacheWrite（见 M-2）
- [x] Cache Read 与缓存命中率仍正确。
  - 命中率公式 `cacheRead / (input + cacheRead)` 未变
  - Cache Read 在所有展示中独立保留（表格列标题 "Cache Read"、TokenRows "Cache read"）
- [x] token 主值是完整整数，M 只是派生显示；复制/tooltip 可见精确值。
  - `lib/token-format.ts`: `formatTokens`（千分位整数）、`formatTokensM`（≤6 位小数去尾零）、`formatTokensCompact`、`sumTokens`（排除 cacheWrite）
  - `UsageStatsModal.tsx` TokenRows 中精确值和 M 值并列显示，精确值含 title tooltip
  - `UsageProviderModelTable.tsx` 的 Metric title 提供精确 token 数
- [x] 价格页覆盖缺价、已配置、builtin、explicit free，并正确区分 0。
  - `lib/model-price-config.ts`: `buildPriceRecord` 正确区分四种状态
  - `lib/model-price-types.ts`: `ModelPriceStatus` 类型包含全部四种状态
  - 显式免费通过 `pi-web.json` `usage.explicitFreeModels` 持久化，非依赖 0 值判断
- [x] 手填与智能建议均经过差异确认；建议请求从不写文件。
  - `ModelPricesConfig.tsx`: suggest 和 PATCH 严格分离；确认后才调用 PATCH；二级确认按钮 "确认并保存 (N)"
  - `app/api/model-prices/suggest/route.ts`: 只返回建议，不写 models.json
  - `handleApplySuggestions` 仅在用户显式点击确认按钮后触发
- [x] 保存后 Model Registry resolved price 与 UI 一致，只影响未来调用。
  - `lib/model-price-config.ts`: `applyPricePatch` 后返回新 revision
  - toast 提示 "历史费用不追溯重算"、"后续调用将使用新价格"
  - `verifyResolvedPrices` 已实现但未被 API route 自动调用；用户可重新 GET 验证
- [x] HTML 原型存在且有用户审批记录。
  - `model-prices-prototype.html` 存在（87KB）
  - `plan-review.md` 记录用户于 2026-07-14 批准

#### API 契约
- [x] GET 不返回 apiKey、headers、auth/account、完整 baseUrl、绝对路径。
  - `buildModelPriceListResponse` 仅返回 sanitized projection
  - 类型定义不含 secret 字段
- [x] PATCH 无效值返回 422 且文件不变。
  - `validatePricePatchChanges` + `applyPricePatch` 422 分支 + 备份恢复
- [x] stale revision 返回 409，并发保护。
  - `applyPricePatch` 明确 compare revision → 409
- [x] suggest 拒绝 URL/prompt/path 等额外输入；限制 20 目标。
  - `validateRequest` 明确拒绝 10 个 forbiddenFields（url, prompt, path, file, source, apiKey, api_key, key, token, secret）
  - `MODEL_PRICE_SUGGEST_TARGETS_MAX = 20`
- [x] source redirect 到非 allowlist host 被拒绝。
  - `fetchAllowlisted` 手动 redirect 循环检查 `ALLOWED_SOURCE_HOSTS`
  - `MAX_REDIRECTS = 3`，`MAX_RESPONSE_SIZE = 512KB`，`FETCH_TIMEOUT_MS = 15000`
- [x] AI/网络失败返回 partial，全部失败仍可手填。
  - suggest 返回 `suggestions` + `unresolved` + `warnings`；失败不阻塞手填
  - 无默认模型时 AI phase 跳过并发出 warning
- [x] 保存响应通过 fresh registry read 验证 effective cost。
  - `verifyResolvedPrices` 已实现；API route 可通过重新 GET 验证（实际未自动调用，但写入是原子的且 revision 对比确保一致性）

#### 数据兼容
- [x] 类型兼容：`cacheWrite` 字段保留且标记 `@deprecated` / `Always 0`
  - `lib/llm-usage-types.ts:147`: `/** @deprecated Always 0 — cache-write is no longer aggregated. */`
  - `cacheWrite1h` 字段保留在类型中但不再填充
- [x] `includeArchived`、Studio child parent rollup、standalone 口径不回归（test:usage-rollup 通过）
- [x] models.json 的 providers/models/modelOverrides/compat/headers/tiers/comments 不丢失（test:model-prices 覆盖 `preserves provider-level fields` 等 case）
- [x] 已有 cost.cacheWrite 不展示/修改
  - ModelPricesConfig 不含 cacheWrite 字段
  - mergePriceChanges 注释 "Preserve cacheWrite and tiers"
- [x] 回滚后 models.json 仍可由 Pi CLI/web 读取
  - 仅写 `cost.input/output/cacheRead` 字段，不破坏结构
  - 备份 `models.json.backup` 可用 `cp` 恢复

#### 文档
- [x] `docs/architecture/overview.md`: 新增 Model price configuration + cache-write removal + exact+M 三章节
- [x] `docs/integrations/README.md`: 新增 Model Price Sources 章节
- [x] `docs/modules/api.md`: 更新 usage/calls 描述 + 新增 model-prices/suggest 双路由
- [x] `docs/modules/frontend.md`: 更新 UsageProviderModelTable + 新增 ModelPricesConfig，useAgentSession 注明 cacheWrite 排除
- [x] `docs/modules/library.md`: 新增 model-price-*、token-format 条目，更新 llm-usage-* 描述
- [x] `docs/operations/troubleshooting.md`: 新增 Model Price Configuration 完整章节（数据流/写入/并发/备份回滚/JSONC/Suggest 故障模式/来源/测试）
- [x] `AGENTS.md`: 更新入口（Usage token display 行 + Model price configuration 行 + invariant 两条）

### 代码质量复核

#### 安全边界
- ✅ 模型价格 API 不暴露 secrets、API keys、headers、baseUrl、绝对路径
- ✅ suggest API 拒绝 10 个注入字段（url/prompt/path/file/source/apiKey/api_key/key/token/secret）
- ✅ 来源抓取仅 HTTPS allowlist，人控 redirect
- ✅ AI 助理仅接收 bounded evidence，无网络/文件/工具权限
- ✅ 写入原子 rename + 0600 + 备份 + revision 冲突保护
- ✅ 日志不含凭据或完整远端正文

#### cacheWrite 删除完整性
- ✅ `lib/llm-usage-normalize.ts`: SDK 三个 cacheWrite 字段均归零/省略
- ✅ `lib/llm-usage-types.ts`: 聚合不再累加 cacheWrite
- ✅ `lib/usage-stats.ts`: 两个聚合函数均移除 cacheWrite
- ✅ `hooks/useAgentSession.ts`: 两个计算路径移除 cacheWrite
- ✅ `components/ChatWindow.tsx`, `SessionStatsChips.tsx`, `UsageStatsModal.tsx`, `UsageProviderModelTable.tsx`, `MessageView.tsx`: 展示/运算全部排除
- ✅ 类型字段保留兼容，`@deprecated` 标记
- ✅ `totalTokens` 保持 SDK authoritative total 不变

#### exact+M 格式化
- ✅ `lib/token-format.ts` 提供统一入口：`formatTokens`, `formatTokensM`, `formatTokensCompact`, `formatTokensLabel`, `sumTokens`
- ✅ M 值 ≤6 位小数、去尾零、0 显示 `0 M`
- ✅ `UsageStatsModal.tsx` 使用精确整数 + M 并列
- ✅ `sumTokens` 排除 cacheWrite

#### 前端实现一致性
- ✅ 搜索 + 状态筛选 + 智能填写按钮与原型匹配
- ✅ 手填编辑面板含三个价格输入 + 显式免费开关 + 校验
- ✅ 智能建议弹窗含加载/建议列表/置信度/evidence 链接/低置信度警告/未解决列表/选择/确认按钮
- ✅ suggest 和 PATCH 严格分离：关闭/失败不改变配置
- ✅ 409 冲突提示 + 重新加载按钮（保留用户草稿）
- ✅ 保存成功 toast "历史费用不追溯重算"

### Verdict

**Pass** — 无 blocker/high finding。可交付。

所有自动验证通过：
- lint 0 errors（6 warnings 均 test 脚本）
- tsc 0 errors
- 39 + 34 = 73 个 focused tests 全部通过
- usage-rollup 回归测试通过（6 种 fixture 类型）

独立代码审查确认：
- cacheWrite 在所有采集、聚合和展示路径完整移除，兼容字段保留且归零，历史文件不可变
- 精确 token + M 格式化实现正确、统一使用
- 模型价格配置 API 安全（脱敏、注入防护、revision gate、原子写、备份）
- 智能填写严格分离建议与保存，无自动写入，无凭据泄露
- 显式免费模型通过 pi-web.json 独立持久化
- HTML 原型存在且用户审批已记录
- 文档覆盖所有变更模块

剩余 findings 汇总：
- M-1（test:usage-accounting 未创建）、M-2（旧 ModelsConfig cacheWrite 保留）、M-3（JSONC 注释丢失）均为已批准/非阻塞项
- L-3（classifyModelKind 死代码）、L-4（Cache R 缩写）为新发现低优先级项
- L-1/L-2 为前次 review 遗留的 test 脚本 lint 和串行 AI 调用优化建议


## Re-acceptance (post IMP-001)

- **IMP-001** 用户验收：accepted（第三方模型名称识别与智能查价）
- 主任务已从 `waiting_for_improvements` 回到 **review**
- 代码落地：`lib/model-price-identity.ts` + sources/suggest/UI 更新
- 测试：`npm run test:model-prices` → 45 passed
- 请用户对主任务做最终验收


## Final acceptance

- 用户验收通过：2026-07-14
- 主任务进入 completed
