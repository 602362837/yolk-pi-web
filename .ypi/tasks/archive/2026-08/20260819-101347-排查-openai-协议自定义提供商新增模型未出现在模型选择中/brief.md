# Brief — OpenAI 兼容自定义 provider/model 未进入模型选择器

## 修订结论

用户补充的两个现象都已纳入复查：

1. 打开新会话后，新增模型仍不在选择器；
2. 新增整个 OpenAI 协议自定义提供商后，整个 provider 也不在选择器。

**原先“只修 runtime 热重载”不足以覆盖全部可靠性边界。** 复查得到两个已证实的产品缺陷，以及一个必须保留的 SDK 可用性规则：

- **主缺陷 A — 管理 runtime 配置过期：** `models.json` 成功写入只推进 catalog epoch；复用的 admin `ModelRuntime` 仅执行 `refresh()`，不会重读配置。它既看不到新增 model，也看不到新增 provider。
- **次缺陷 B — 保存与 catalog 错误降级会制造“假成功”：** direct PUT 不做 Pi `ModelRuntime` 语义验证；Pi 可在 `ModelRuntime.create()` 不抛异常的情况下通过 `runtime.getError()` 报 schema/composition 错误并移除 provider，`/api/models` 当前仍返回 200 partial/empty catalog，浏览器会把它当成功结果覆盖 last-good。
- **保留规则 C — 选择器只显示 available models：** provider/model 即使已被 Pi 正确加载，只要没有可解析的 auth，仍不会进入 `getAvailableSnapshot()`。这是 Pi 0.80.10 的既定语义，不应通过伪造可用性绕过。

因此修复应同时覆盖：**候选配置语义验证、成功提交后的 admin config generation、catalog fail-closed、live session reload/self-heal，以及所有 models.json writer 的统一提交通知**。

## 为什么“新会话仍看不到”不否定主缺陷 A

新会话的选择器不是从该会话新建的 runtime 读取模型，而是所有 Chat/Settings 共用：

```text
ChatInput
  <- useModelCatalog module singleton
  <- GET /api/models
  <- model-catalog-service
  <- cached admin ModelRuntime.getAvailableSnapshot()
```

新会话只在 draft/首次发送时创建独立 session `ModelRuntime`。因此“新建会话”不会替换浏览器共享 catalog，也不会替换服务端 admin runtime。

隔离复查结果：

```json
{
  "beforeBeta": false,
  "afterEpochOnlyBeta": false,
  "freshSessionRuntimeBeta": true,
  "freshSessionAvailableBeta": true,
  "afterAdminReloadBeta": true
}
```

这证明：有效的新 provider 已被 fresh session runtime 正确加载，但选择器仍可因 stale admin runtime 看不到它。

## 自定义 provider 的真实加载/注册链

OpenAI-compatible custom provider **不是扩展 provider，不需要 Web 手工调用 `registerProvider()`**：

```text
models.json
  -> ModelConfig.load(modelsPath)
  -> ModelRuntime.configure/rebuildProviders
  -> composeModelProvider
  -> provider + models 进入 runtime.getProviders/getModels
  -> auth availability refresh
  -> getAvailableSnapshot
```

`webExtensionFactories()` 注册的是 Grok/Kiro/Antigravity/AnyRouter 等固定扩展。Pi 0.80.10 的 `reloadConfig()` 会保留 `extensionProviders` 并重新 compose；fresh admin runtime 则必须重新执行现有固定 provider 注册流程。

隔离验证：有效的全新 provider 在 fresh runtime 中 `provider=true / model=true / available=true / error=null`；`reloadConfig()` 后固定扩展注册仍保留。

## 配置与 auth 门槛

一个 custom provider 要进入当前模型选择器，至少满足：

1. `models.json` schema 合法；
2. 对非 builtin provider，model 最终能解析到 `baseUrl` 与 `api`；
3. 至少有一个合法 model id；
4. provider auth 已配置：literal/command/resolved env `apiKey`，或 `auth.json` stored credential；
5. admin runtime 已读取当前配置，availability refresh 完成；
6. `/api/models` 成功投影，浏览器新 generation 接收该结果。

无 auth 的对照实测：

```json
{
  "nokey": {"provider": true, "model": true, "configured": false, "available": false},
  "missingEnv": {"provider": true, "model": true, "configured": false, "available": false},
  "literal": {"provider": true, "model": true, "configured": true, "available": true}
}
```

所以“provider 不在选择器”可能是 stale admin、无 auth、或配置被 Pi 拒绝；修复与检查必须明确区分三者。

## 已证实的假成功/错误降级缺陷

使用缺少 `baseUrl` 的 custom provider 调 direct PUT，当前行为实测：

```json
{
  "putStatus": 200,
  "putSuccess": true,
  "diskHasBroken": true,
  "runtimeHasError": true,
  "runtimeHasBroken": false,
  "catalogStatus": 200,
  "catalogError": null,
  "catalogHasBroken": false
}
```

另一个高风险场景是空 model id：Pi schema 校验失败时会把整个 `models.json` 视为无 provider，其他本来有效的 custom provider 也一起消失。当前 route 仍可先返回保存成功。

因此只增加 `reloadConfig()` 仍可能得到“成功重载了一个被 Pi 拒绝的配置”，不能完整解决用户问题。

## 前端结论

- `ModelsConfig.handleSave` 确实发送完整 draft 并处理 revision；
- Models 关闭时确实执行 `refreshModelCatalog({ force:true })`；
- `ChatInput` 直接将 `modelList` 映射为 options；
- `ModelSelect` 不排除 custom provider/model；
- browser generation、abort 与 last-good 机制本身正确，但依赖 server 非 2xx 表达失败。

因此不修改前端生产逻辑；复用现有保存错误槽和 catalog last-good 行为即可。

## 推荐修复范围

1. direct PUT 在持久化前，用私有临时 `modelsPath` + fresh fixed-provider runtime 离线验证候选完整配置；semantic invalid 返回安全 422，不写盘、不失效；
2. 成功提交推进定向 admin runtime config generation，旧 pending 不得回填；
3. `/api/models` 发现 `runtime.getError()` 时 fail closed 为现有 500 `model_catalog_unavailable`，让浏览器保留 last-good；
4. live session 使用公开 `reloadConfig()`，exact provider/id 替换 descriptor；`set_model` miss 一次 reload 后 exact retry；
5. direct PUT、sync apply、model-price 三个 writer 统一 success-only commit notification；
6. 测试同时覆盖“新增 model”“新增整个 provider”“无 auth control”“semantic invalid false-success”“新会话共享 catalog”。

## UI 门禁

计划不新增页面、按钮、文案区块、状态或交互；invalid save 复用现有 `saveError` 区域，catalog 失败复用现有 last-good/error 状态。**不触发 HTML 原型门禁。** 若实现需要新增 warning/toast/banner、可用性说明或手动 reload 操作，必须退回 planning 并安排 ui-designer。
