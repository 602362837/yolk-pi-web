# Design — custom provider/model 配置提交与 catalog 新鲜度契约

## 1. 方案摘要

修复拆成四个独立但串联的正确性边界：

1. **Candidate validity：** direct PUT 成功前，用 fresh temporary `ModelRuntime` 验证候选完整配置能被 Pi 0.80.10 schema + provider composer 接受；
2. **Config freshness：** durable commit 后推进定向 admin runtime config generation，不能把 catalog epoch 当作 runtime reload；
3. **Catalog health：** server 只发布无 runtime error 的 available snapshot；错误返回现有 500，让 browser last-good 生效；
4. **Session convergence：** fresh/new session 天然读取当前文件；existing live session 使用 `reloadConfig()` + exact descriptor replacement，并在 `set_model` miss 时一次自愈。

## 2. 修订后的根因模型

### 2.1 AS-IS：有效配置仍被旧 admin runtime 隐藏

```text
ModelsConfig saves valid provider/model
  -> PUT atomic writes models.json
  -> invalidateWebModelCatalog(models_config)
       catalogEpoch++ only
  -> browser refreshModelCatalog(force)
  -> GET /api/models
  -> cached getWebModelRuntime()
       runtime.refresh(allowNetwork:false)
       # no ModelConfig.load
  -> old provider map + old model snapshot
  -> selector has neither new model nor new provider
```

### 2.2 为什么新会话仍显示旧列表

```text
New Chat selector
  -> module-shared useModelCatalog
  -> server admin runtime

Draft / first send (later)
  -> createWebAgentSessionServices
  -> fresh isolated session ModelRuntime
```

两者不是同一 runtime。新 session runtime 可以已包含 provider，而选择器仍忠实显示 admin snapshot。

### 2.3 AS-IS：无效候选被误报为成功

```text
PUT accepts arbitrary object + cost normalization
  -> writes invalid/semantically incomplete config
  -> 200 success
  -> ModelRuntime.create/reloadConfig
       may return runtime with getError()
       may remove one provider or reject whole models config
  -> /api/models ignores getError
  -> 200 partial/empty
  -> browser replaces last-good
```

## 3. custom provider 与固定 extension provider 边界

| 类型 | 加载方式 | 本任务行为 |
| --- | --- | --- |
| OpenAI-compatible custom provider | `models.json` → `ModelConfig` → `composeModelProvider` | 不手工 `registerProvider`；验证/重载配置即可 |
| Pi builtin provider overlay | builtin + models config compose | 保留 merge/override 语义 |
| Grok/Kiro/Antigravity/AnyRouter | Web extension factory 注册到 target runtime | same-runtime `reloadConfig` 保留注册；fresh admin runtime 必须重跑固定注册 |
| cwd project extensions | session services only | 不进入 admin catalog，边界不变 |

Pi 0.80.10 已验证：`reloadConfig()` 重读 `modelsPath`、rebuild providers，并保留 `extensionProviders`；`refresh()` 只刷新已装载 provider/model/auth snapshot。

## 4. TO-BE 数据流

```text
Direct PUT candidate
  -> normalize
  -> verifyWebModelsConfigCandidate(candidate)
       private temp modelsPath (0600)
       createTemporaryWebModelRuntimeServices(fixedProvidersOnly, allowModelNetwork:false)
       runtime.getError must be empty
       every candidate provider.models[].id must exact resolve
  -> revision-gated atomic commit
  -> notifyModelsConfigCommitted(models_config)
       1. invalidate admin runtime config key/generation
       2. invalidate server catalog epoch
       3. best-effort reload live wrappers
  -> 200 success

GET /api/models
  -> fresh/new-generation admin runtime
  -> fixed provider registration
  -> offline refresh
  -> runtime.getError? throw safe catalog unavailable
  -> getAvailableSnapshot
  -> unchanged success wire

Existing session set_model(provider,id)
  -> exact getModel
  -> miss: one reloadConfig + exact retry
  -> withSessionScopedSettingsDefaults(setModel)
```

## 5. 模块变化

| 模块 | 责任变化 |
| --- | --- |
| `lib/web-model-runtime.ts` | production config invalidation API；per-key generation；old pending 禁止回填；temporary verification runtime 初始加载强制 offline |
| `lib/model-catalog-service.ts` | catalog build 检查 runtime health；config commit 与 auth invalidate 语义分离 |
| 新增建议 `lib/models-config-runtime.ts` | 候选语义验证 + unified commit notification；命名可按附近风格调整 |
| `app/api/models-config/route.ts` | normalized candidate preflight；422 safe failure；written success 才通知 |
| `lib/rpc-manager.ts` | models-config reload path、结果摘要、exact descriptor replacement、`set_model` miss retry；auth path 仍 refresh |
| `lib/models-config-sync.ts` | sync `ok` 绑定实际 admin/live config freshness，不再以 refresh 未抛代表成功 |
| `lib/model-price-config.ts` | successful written 后复用 config commit notification |
| `hooks/useModelCatalog.ts` / `ChatInput` / `ModelSelect` | 不改生产逻辑；测试确认 wire consumption |

## 6. Candidate semantic verification

建议公开项目内接口：

```ts
verifyWebModelsConfigCandidate(options: {
  candidate: Record<string, unknown>;
  agentDir?: string;
}): Promise<void>;
```

约束：

1. candidate 必须是 direct PUT 将写入的 normalized object；
2. 写入私有临时目录/文件，完成后无条件清理；
3. temporary services 固定 provider aware，但不加载 cwd extensions；
4. initial model catalog refresh `allowModelNetwork:false`；验证不发 inference；
5. `runtime.getError()` 非空即失败，但 wire 只返回固定 `models_config_invalid`，不透出 SDK 原文/path/config；
6. 对 `providers.*.models[]` 的非空 id 做 exact `getModel(provider,id)` presence check；
7. **不要求 available/auth**：无 auth 是合法配置，只是不进入 selector；
8. `modelOverrides` 的 unknown id 按 Pi 语义可忽略，不误判；
9. 验证失败发生在 durable write 前，所以旧文件/revision/backup/cache/live state均不变。

Direct PUT 建议错误：HTTP 422，`{ error: "Model configuration is invalid", code: "models_config_invalid" }`。现有前端 `saveError` 可直接显示，不新增 UI。

## 7. Admin runtime generation

建议接口：

```ts
invalidateWebModelRuntimeConfig(options?: {
  agentDir?: string;
  modelsPath?: string;
}): void;
```

每个 canonical `agentDir + modelsPath` 维护 generation，而不是仅 test-only global generation：

1. generation++；
2. 删除该 key 的 resolved、init pending、refresh pending slot；
3. old pending 可完成原 caller，但 settle 时 generation 不匹配，不可回填 cache；
4. invalidation 后的新 caller 不得 join old pending；
5. fresh entry 走现有 `createAdminRuntimeEntry`，固定 providers 重新注册；
6. 普通 warm reads 不变，只有低频 successful config commit 触发冷建；
7. test reset 仍可全清，但生产不得依赖 test reset。

Commit notification 内顺序建议：先 invalid admin config key，再推进 catalog epoch；两者都是同步 generation signal，success response 前完成。

## 8. Catalog health 与错误降级

`buildCatalogBase()` 在 admin offline refresh 后、projection 前检查 `runtime.getError()`：

- 无 error：投影 `getAvailableSnapshot()`；
- 有 config/composition/availability error：抛内部错误；route 继续映射为固定 500 `model_catalog_unavailable`；
- 不返回 200 partial/empty，不返回 SDK 文本；
- browser `useModelCatalog` 保留 last-good；generation/abort guard不变。

Direct app writes已由 candidate validation挡住结构错误；health gate主要覆盖外部损坏、运行时 compose/availability 异常和回滚失败。

## 9. Auth availability 契约

Catalog 继续只投影 `available`，不改为 `getModels()`：

- literal/command key：Pi 可判 configured；
- env interpolation：变量实际可解析才 configured；
- stored credential：configured；
- no key/missing env：provider/model loaded but unavailable；
- `models_json_key` provider 在 `/api/auth/all-providers` 中被过滤以避免 Models 左栏重复 raw provider/API-key card，这不影响 `/api/models` selector。

测试必须同时看 `getModel` 与 `getAvailableSnapshot`，避免把 auth gate误报为 reload失败。

## 10. Live session reload

建议将 auth refresh 与 config reload 抽成共享 descriptor reconciliation 内核：

```ts
reloadRpcModelsConfigState(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}>;
```

约束：

- config path 调 `runtime.reloadConfig()`；auth path仍调 `runtime.refresh({allowNetwork:false})`；
- current provider/id仍存在：替换 `agent.state.model` descriptor，不调用 `setModel()`；
- current model被删除：不自动换模型；
- provider session resources cleanup 保留；
- 单 wrapper失败隔离并计入 summary；
- `set_model` 首次 exact miss时 reload一次后 exact retry；
- eventual `setModel()` 仍 session-scoped；
- Pi 0.80.10 的 `reloadConfig()` 无 options 参数，live reload沿用该 session runtime既有 model-catalog network policy；不得发 inference 请求，也不得私有 deep import。自动化验证设置 `PI_OFFLINE=1`/network guard。

## 11. Unified commit notification

建议：

```ts
notifyModelsConfigCommitted(reason): Promise<{
  live: { attempted: number; succeeded: number; failed: number };
}>;
```

调用点与 gate：

| writer | 触发条件 | 不触发 |
| --- | --- | --- |
| direct PUT | candidate verified + `outcome.written` | 422/409/parse/write fail/no-write |
| sync apply | write + fresh verification成功 | preview、skip、verification fail、rollback |
| model-price | valid patch + `outcome.written` | 422/409/500/no-write |

Disk 是 durable truth；个别 live wrapper reload失败不回滚已验证 commit。Sync `runtimeReload:"ok"` 仅在 admin generation signal完成且 live summary无失败时成立，否则 `partial` + 既有 safe warning。Direct PUT/price response wire保持现状。

## 12. API / wire /兼容性

- `models.json` schema/path/revision/backup/atomic write不变；
- `/api/models` success body不变；
- `/api/models` error仍为既有 500 fixed code；
- `/api/models-config` success body不变；新增 semantic invalid 422 safe body；
- sync wire `ok|partial`不变，只收紧语义；
- no JSONL/schema/data migration；
- frontend selector值仍为 exact provider + model id。

## 13. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 旧 admin pending 回填 | per-key generation + identity-checked finally |
| candidate temp 泄露 secrets | 0700 dir/0600 file、finally cleanup、fixed errors、无日志 |
| 固定 provider重建丢失 | fresh entry复用固定注册；same runtime reload retention测试 |
| 无 auth被误判 reload失败 | loaded vs available对照测试 |
| runtime error导致 selector清空 | server 500 + browser last-good |
| live reload写 model_change/defaults | exact descriptor replacement，不 setModel |
| sync 假 `ok` | summary failure count + actual model presence |
| reloadConfig model-catalog network | 保持 session既有策略；测试/verification离线；不发 inference |
| config validation增加保存延迟 | 低频操作、offline、性能预算与定时测试 |

## 14. 回滚

回滚 candidate verifier、config generation、health gate、live reload 与 writer coordinator 代码即可。无数据迁移；已保存的合法 provider/model 保留。代码回滚后的临时恢复仍可重启服务。不得删除用户 `models.json`、auth 或 session 文件。
