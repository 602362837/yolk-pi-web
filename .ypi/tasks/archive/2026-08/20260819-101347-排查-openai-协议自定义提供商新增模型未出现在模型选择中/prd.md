# PRD — 自定义 OpenAI provider/model 保存后可靠进入模型选择器

## 目标与背景

用户通过 Models 为现有 OpenAI-compatible provider 增加模型，或新增整个 custom provider 后，保存成功但模型选择器不显示；新建会话也不能恢复。目标是让**语义合法且已配置 auth** 的 custom provider/model 在同一服务进程中可靠可见、可选，并阻止无效配置或 runtime composition 错误被误报为成功 catalog。

## 用户价值

- 给现有 provider 增加 model 后无需重启即可选择；
- 新增完整 custom provider 后无需重启即可出现整个 provider 分组；
- 新会话与已打开会话都遵循同一份已提交配置；
- 保存成功不再掩盖 Pi schema/composition 失败；
- catalog 构建失败时保留 last-good，不把 partial/empty 当成功。

## 范围内

1. custom provider 的完整链路：Models draft → PUT → `models.json` → `ModelConfig`/provider composition → admin catalog → browser selector；
2. 现有 provider 增 model、全新 provider 两类变更；
3. direct PUT 候选配置的 fresh runtime 语义验证；
4. admin runtime config generation/eviction 与 catalog epoch 协调；
5. fresh/new session runtime 与 existing live session runtime 的行为；
6. `set_model` stale-runtime exact miss 自愈；
7. direct PUT、sync apply、model-price writer 的统一 success-only commit contract；
8. catalog runtime error 的非 2xx fail-closed 与 browser last-good；
9. auth configured/unconfigured 对照测试与文档澄清。

## 范围外

- 改变 Pi 的 available-model auth 规则；
- 让没有 auth 的 custom provider 出现在可选择模型中；
- 新增 provider 注册 UI、手动 reload、toast/banner 或可用性说明；
- 改变 `ModelSelect` 搜索、分组、键盘、视觉；
- 外部文件 watcher、跨进程广播、任意外部编辑自动热推送；
- 自动选择新增模型、修改默认模型/thinking 或写额外 `model_change`；
- 修改 Pi SDK/private deep import 或数据迁移。

## 需求与验收标准

### R1 — 现有 provider 新增模型即时可见

管理 catalog 已预热时，direct PUT 为一个合法、已配置 auth 的 custom provider 追加 model；下一次 `/api/models` 必须包含 exact provider/model。

**验收：** 不重启、不使用 test reset；Models 关闭后的既有 browser force refresh 可见新增 model。

### R2 — 新增整个 provider 即时可见

管理 catalog 已预热时，direct PUT 新增一个具备 `baseUrl`、受支持 `api`、至少一个 model、可解析 auth 的 custom provider；下一次 catalog 必须包含该 provider 分组与 models。

**验收：** provider/model exact identity 在 server wire 和 Chat selector 都存在。

### R3 — 新会话语义明确

fresh session runtime 必须从当前 `models.json` 加载新 provider/model；但新会话选择器继续使用共享 `/api/models`，不得假定创建会话会刷新 admin catalog。

**验收：** 测试同时断言 fresh session runtime 已加载、shared selector catalog 也已由 commit contract 刷新。

### R4 — auth availability 不被绕过

无 key、未解析 env key、无 stored credential 时，provider/model 可以存在于 `getModels()`，但不得进入 `getAvailableSnapshot()`；配置 auth 后应进入 available。

**验收：** no-auth / missing-env / literal-or-stored-key 三组对照符合 Pi 0.80.10。

### R5 — 保存成功必须语义可加载

Direct PUT 在写盘前必须用 fresh、固定 provider aware、无模型网络的临时 runtime 验证整个候选配置。Pi schema/composition error 或预期 custom model 缺失时返回安全 422；不得写盘、备份覆盖、失效或 live reload。

**验收：** missing baseUrl、空 id、非法 cost/compat 等失败场景保留旧 revision 和旧配置。

### R6 — refresh 与 reloadConfig 分工正确

Auth-only 变化继续 `refresh({allowNetwork:false})`；`models.json` 结构变化使用 fresh runtime 或 `reloadConfig()`，不能只清 catalog epoch。

**验收：** contract test 证明 `refresh()` 对新增 provider/model仍 stale，fresh runtime/`reloadConfig()` 可见。

### R7 — admin generation race 安全

成功 commit 后，定向推进 `agentDir + modelsPath` config generation 并淘汰旧 resolved/pending/refresh slots；旧 generation 晚到不得回填，新请求不得加入旧 flight。

**验收：** late-old init/refresh 与 fresh-new 并发测试通过，不同 key 不互相污染。

### R8 — catalog 错误 fail closed

若 admin runtime `getError()` 表示 config/composition/availability 失败，`/api/models` 返回现有 500 safe code，不返回 200 partial/empty catalog。

**验收：** browser 保留 last-good；初始无 last-good 时进入既有 error 状态；响应不含配置、路径、key、baseUrl 或 SDK 原文。

### R9 — existing live session 可切换

已打开 session 在配置提交后能 exact resolve 并切换新增 model。首次 exact miss 只做一次 `reloadConfig()` + exact retry；仍 miss 返回既有 `Model not found`。

**验收：** 不 fuzzy、不 fallback、不循环；eventual `setModel` 仍由 `withSessionScopedSettingsDefaults` 包裹。

### R10 — 当前模型稳定

若当前 provider/id 在新配置仍存在，只替换内存 descriptor，不调用 `setModel()`，不写 `model_change`，不改 defaults/thinking；若删除，不猜替代模型。

**验收：** descriptor、settings、JSONL spy 测试通过。

### R11 — 所有 writer success-only 一致

Direct PUT、verified sync apply、successful model-price write 统一触发 admin config invalidation + catalog invalidation + best-effort live config reload。stale/parse/semantic invalid/rollback/skip/no-write 不触发。

**验收：** writer gating 与 sync actual model presence 测试通过；`runtimeReload:"ok"` 不得只代表函数未抛。

### R12 — 前端 wire 与性能不回退

`/api/models` success wire、`useModelCatalog`、`ChatInput`、`ModelSelect` 值语义不变；普通 warm reads 保持 burst cache/admin runtime 复用。

**验收：** client、performance、read-purity tests 通过；无前端生产文件改动。

## 非功能要求

- TypeScript strict；
- admin/catalog 和候选配置验证不访问模型端点；live `reloadConfig()` 使用 Pi 公开 API，不发 inference 请求；
- 不记录或返回 key、headers、baseUrl、配置正文或 operator 路径；
- 原子写、revision、backup、file mode 语义保持；
- 不 deep-import Pi 私有模块；
- 用户批准前不改生产代码，不 commit/push/merge。

## 未决决策

无阻塞产品歧义。建议批准系统性方案，而非仅在前端重复 fetch。需要主会话确认：

1. semantic invalid direct PUT 采用现有错误槽显示固定 422，不新增 UI；
2. 无 auth provider 继续不进入选择器；
3. 外部编辑自动推送/跨进程广播继续范围外。
