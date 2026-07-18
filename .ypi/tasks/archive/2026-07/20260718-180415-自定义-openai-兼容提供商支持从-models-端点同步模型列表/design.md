# Design：OpenAI-compatible `/models` 发现与安全 merge

## 方案摘要

新增一个仅接受 `providerId` 的 Models 同步 API。服务端从 `~/.pi/agent/models.json` 读取目标 provider，完成资格判定、凭据解析、候选端点拼接和远端列表规范化；预览结果以短期 opaque `previewId` 保存。用户确认时提交 `previewId + revision + selectedModelIds`，服务端在 models.json 写锁内重新读取并校验 revision，再只向目标 provider 的 `models[]` 追加不存在的 `{ id }`。

同步必须与现有 ModelsConfig PUT 和模型价格 PATCH 共用同一 models.json 存储协调层，不能建立互相覆盖的独立写路径。

## 现有边界

- `components/ModelsConfig.tsx` 把 `models.json.providers` 当作左侧 custom provider 列表，并以 provider 级 `api` 表示默认协议。
- OpenAI-compatible API allowlist 固定为：
  - `openai-completions`
  - `openai-responses`
- `app/api/models-config/route.ts` 当前整文件 PUT；缺少 revision、锁和原子写。
- `lib/model-price-config.ts` 已有 JSONC strip、revision、备份、原子写、写后 runtime 验证，但当前逻辑与 ModelsConfig route 未共享锁。
- Pi 允许 built-in provider 出现在 `models.json` 中做 override，因此不能用“provider 位于 models.json”单独判定 custom。

## 模块设计

### 1. `lib/models-config-store.ts`（新增共享服务）

职责：

- `getModelsJsonPath()`；
- JSONC 安全读取并返回 `{ raw, parsed, revision, exists, parseError }`；
- SHA-256 opaque revision；
- 同一 models.json 的进程队列 + 跨进程 mkdir lock；
- 同目录临时文件 + rename 原子写、最佳努力 `0600`；
- 可选 pre-write backup；
- lock 内 `read → validate revision → mutate → write`；
- 不记录 raw 配置、路径以外的 secret 内容或变更对象。

迁移策略：

- `lib/model-price-config.ts` 改用共享 store；保留现有导出 wrapper，避免测试/调用方一次性破坏。
- `app/api/models-config/route.ts` 改用共享 store；GET body 继续是原配置，revision 放在 `ETag`/响应 header，保持旧客户端兼容；PUT 可选读取 `If-Match`，ModelsConfig 新客户端必须发送。
- sync apply 与 model-price patch 共用写锁，避免同步新增模型时覆盖并发 cost 更新。

### 2. `lib/models-config-sync-types.ts`（新增 client-safe 合约）

定义：

- OpenAI-compatible API 常量；
- preview/apply 请求与响应；
- `ModelsSyncErrorCode`；
- 最大限制常量；
- 不包含 baseUrl、headers、apiKey、文件路径或远端原始 body。

### 3. `lib/models-config-sync.ts`（新增 server-only 服务）

职责：

- provider 资格判定；
- endpoint candidate 生成；
- 配置值/凭据/header 解析；
- 有界 fetch 与安全错误映射；
- OpenAI list payload 解析；
- preview cache；
- selected id 校验和最小 merge；
- 写后 runtime 验证与必要的 live runtime reload。

## Provider 资格判定

服务端每次 preview 和 apply 都重新判定，不信任客户端 UI。

```text
eligible =
  provider exists in saved models.json.providers
  AND provider id not in builtinProviders().map(id)
  AND provider id not in FIXED_EXTENSION_PROVIDER_IDS
  AND provider.api in {openai-completions, openai-responses}
  AND provider.baseUrl is non-empty valid http(s) URL
```

固定扩展 denylist 至少包括：

```text
grok-cli
kiro
google-antigravity
```

说明：

- built-in id 即使定义 `models[]` 也属于 built-in override/merge，不在本功能范围。
- provider 级 `api` 必须明确；不根据 model-level API 猜测 provider 协议。
- `api` 缺失时 fail closed，UI 引导先选择并保存协议。
- 不加载 cwd-local extensions 来扩大资格；Models 行政路径仍保持 fixedProvidersOnly 边界。

## Base URL 规范化与路径拼接

输入只来自已保存 provider `baseUrl`。

1. 使用 `new URL(baseUrl.trim())`；只允许 `http:` / `https:`。
2. 删除 query/hash；保留 origin 和已有 path prefix。
3. pathname 去除末尾 `/` 后按以下规则生成候选：

| 已保存 pathname | 候选 |
| --- | --- |
| 以 `/v1/models` 结尾 | 当前 URL，仅一次 |
| 以 `/models` 结尾 | 当前 URL，仅一次 |
| 以 `/v1` 结尾 | `<path>/models`，即 `/v1/models` |
| 其他（含空 path、`/api`） | 先 `<path>/models`，再 `<path>/v1/models` |

示例：

| baseUrl | 候选 |
| --- | --- |
| `https://host` | `https://host/models` → 404/405 时 `https://host/v1/models` |
| `https://host/v1` | `https://host/v1/models` |
| `https://host/api` | `https://host/api/models` → 404/405 时 `https://host/api/v1/models` |
| `http://localhost:11434/v1/` | `http://localhost:11434/v1/models` |
| `https://host/v1/models` | 原 URL |

回退规则：

- 只有 404/405 才尝试下一个候选；
- 401/403、429、5xx、timeout、network、跨源 redirect 或 2xx 无效 payload 直接分类返回，不用第二路径掩盖真实错误；
- 候选始终同 origin，不接受客户端路径覆盖。

## 凭据与 headers

解析顺序应贴近 Pi models.json 语义：

1. 通过 Web `CredentialStore` 读取 provider 的已保存 `api_key` credential；其 key 优先。
2. 若没有已保存 key，使用 `resolveConfigValue(provider.apiKey, credential.env)` 解析 models.json fallback。
3. provider `headers` 的每个值使用同一 `resolveConfigValue` 和 provider env 解析。
4. 默认增加：
   - `Accept: application/json`
   - 若未配置大小写不敏感的 `Authorization` 且有 key：`Authorization: Bearer <key>`
5. 已配置 header 可覆盖默认 Authorization；拒绝/剥离 hop-by-hop 与自动管理 header（如 `host`、`content-length`、`connection`）。
6. custom provider 若无法解析 key，返回 `credential_unavailable`；用户可配置 dummy key 支持无鉴权本地服务，与 Pi 模型可用性规则一致。
7. 不支持把 OAuth credential 当作 generic custom provider token；返回稳定 `unsupported_auth`，避免误用固定扩展/OAuth 语义。

所有 secret 仅存在于请求内存；不得写入 preview cache、响应、错误 detail 或日志。

## 网络安全边界

- `redirect: "manual"`；最多 3 次同 origin redirect，跨 origin 拒绝。
- 默认超时 10 秒，AbortSignal 清理定时器。
- 响应体最大建议 1 MiB；流式累计，超过即中止。
- 模型条目上限建议 2,000；单 id UTF-8 长度上限 256；拒绝控制字符和空 id。
- 只接受 JSON；标准 shape 为 `{ data: Array<{ id: string, owned_by?: string }> }`。
- `owned_by` 仅可作为有界预览信息，不写入 models.json；其他远端字段全部丢弃。
- API 设置 `Cache-Control: no-store`。
- 安全错误只含 provider id、稳定 code 和固定 message，不含 endpoint、secret、headers、raw body、DNS/IP 或绝对路径。

## Preview API 合约

建议路由：`POST /api/models-config/sync`

### Preview request

```json
{
  "action": "preview",
  "providerId": "local-openai"
}
```

只允许上述字段。出现 `url`、`baseUrl`、`headers`、`apiKey`、`path` 等额外字段返回 `400 invalid_request`。

### Preview response

```json
{
  "kind": "models_config_sync_preview",
  "providerId": "local-openai",
  "previewId": "opaque-random-id",
  "revision": "opaque-models-json-revision",
  "expiresAt": "2026-07-18T10:15:00.000Z",
  "totals": {
    "remote": 42,
    "new": 12,
    "existing": 30
  },
  "models": [
    { "id": "model-a", "status": "new", "ownedBy": "vendor" },
    { "id": "model-b", "status": "existing" }
  ]
}
```

不返回实际 endpoint、apiKey、headers 或 raw payload。

## Preview cache

- 使用 `globalThis` 保存 bounded in-memory cache，适配 Next 热重载。
- `previewId` 使用高熵随机值；TTL 建议 5 分钟。
- 最多保留 20 个 preview，超限按最早过期/创建时间清理。
- cache 仅保存：providerId、revision、provider 配置 fingerprint、远端规范化 id 顺序、已有 id set、过期时间。
- provider fingerprint 是 secret-bearing config 的单向 hash，不能保存或投影 secret 原文。
- 进程重启导致 preview 失效是可恢复行为：UI 重新预览。

## Apply API 合约

### Apply request

```json
{
  "action": "apply",
  "providerId": "local-openai",
  "previewId": "opaque-random-id",
  "revision": "opaque-models-json-revision",
  "modelIds": ["model-a", "model-c"]
}
```

约束：

- `modelIds` 非空、去重、数量有上限；
- 每个 id 必须属于对应 preview 的远端列表；
- providerId/revision 必须与 preview 一致；
- preview 未过期；
- 当前 provider fingerprint 与 preview 一致。

### Apply response

```json
{
  "kind": "models_config_sync_apply",
  "providerId": "local-openai",
  "addedIds": ["model-a", "model-c"],
  "skippedExistingIds": [],
  "totalModels": 14,
  "revision": "new-opaque-revision",
  "runtimeReload": "ok"
}
```

`runtimeReload` 可为 `ok | partial`；partial 只返回固定 warning，不回滚已验证的磁盘写入。

## Merge 算法

在共享 models.json 写锁内：

1. 重读文件并验证 parse 成功。
2. 当前 revision 必须等于 request/preview revision，否则 `409 stale_revision`。
3. 重新执行 provider 资格判定和 fingerprint 校验。
4. 取得 `provider.models`；不是数组则视为空数组。
5. 构建现有合法 string id set，但**不整理、不去重、不重写**原数组。
6. 按 preview 远端顺序筛选用户选中的 id。
7. 已存在 id 记入 skipped；新 id 追加 `{ id }`。
8. 只创建新的目标 provider 对象和新的 `models` 数组；其他 provider/top-level 对象保持业务值不变。
9. 保存 pre-write backup，原子写 clean JSON。
10. 使用 fresh provider-aware `ModelRuntime` 验证 models.json 可加载，且新增 id 可在目标 provider 找到；失败则原子回滚 backup。
11. 计算新 revision，清除该 preview。

关键不变量：

- 现有模型对象不 merge 远端字段；因此 cost、compat、reasoning、thinkingLevelMap、input、contextWindow、maxTokens、api 和未知字段都保留。
- `modelOverrides` 不参与同步。
- 远端缺失模型不删除。
- 新模型只写 `{ id }`，继承 provider 级 api/baseUrl/compat。

## UI 数据流

```text
ModelsConfig clean saved draft
  └─ provider detail “从端点同步模型”
       └─ POST sync preview {providerId}
            └─ preview modal: search/select/status/counts
                 ├─ 写入所选 → AppPrompt confirm
                 └─ 全部新增并写入 → AppPrompt confirm
                      └─ POST sync apply {providerId, previewId, revision, modelIds}
                           └─ success summary
                                └─ GET /api/models-config + read ETag
                                     └─ replace draft/persisted snapshot, keep provider selection
```

ModelsConfig 需要保存 `persistedConfig + revision` 并派生 dirty：

- dirty 时不允许启动同步，提示“请先保存当前更改”；
- apply 成功后重新读取全配置，不在旧 React draft 上手工 patch；
- PUT Save 发送 `If-Match`，409 时提示配置已变化并要求重新载入，避免覆盖同步/模型价格写入。

## 错误分类

建议稳定 code：

- `invalid_request`
- `provider_not_found`
- `provider_not_custom`
- `unsupported_protocol`
- `invalid_base_url`
- `credential_unavailable`
- `unsupported_auth`
- `auth_failed`（401/403）
- `endpoint_not_found`（候选均 404/405）
- `rate_limited`
- `upstream_unavailable`
- `timeout`
- `network_error`
- `redirect_blocked`
- `response_too_large`
- `invalid_response`
- `too_many_models`
- `preview_expired`
- `preview_mismatch`
- `stale_revision`
- `models_config_invalid`
- `write_failed`
- `verification_failed`

UI 用 code 映射固定文案，不展示 raw upstream error。

## 兼容性

- `GET /api/models-config` body 不改；revision 走 header。
- PUT response 只增加 revision；旧客户端继续可读 success。
- 旧 PUT 不带 `If-Match` 可暂时兼容，但本项目 ModelsConfig 必须发送；后续再决定是否收紧所有调用方。
- 不迁移历史 models.json；首次同步只追加。
- JSONC 注释在任何现有 clean-JSON 写路径中都会丢失；沿用现状并保留 backup，不在本功能承诺注释保真。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| ModelsConfig PUT、价格 PATCH、同步 apply 并发互相覆盖 | 共享 store/write lock + revision；不新增孤立 writer。 |
| built-in override 被误判 custom | 使用 `builtinProviders()` id 集合 + 固定扩展 denylist，服务端 fail closed。 |
| baseUrl 拼接出 `/v1/v1/models` | 规范化规则和纯函数测试覆盖。 |
| redirect 泄露 Authorization | manual redirect，仅同 origin，次数上限。 |
| 远端恶意/超大 payload | 超时、字节、条目、id 长度、JSON schema 上限。 |
| stale UI Save 覆盖同步结果 | 全局 dirty gate、ETag/If-Match、apply 后全量 reload。 |
| 自动覆盖 cost/手工字段 | existing id 永远 skip；新项只写 `{ id }`。 |
| preview 被伪造或过期 | opaque previewId、TTL、revision、fingerprint、selected subset 校验。 |
| 写后配置让 Pi runtime 拒绝 | fresh ModelRuntime 验证，失败回滚。 |
| UI 原型未审批即实现 | UI-04 子任务不可 claim；任务不得进入 implementing。 |

## 回滚

1. UI 先隐藏同步入口；现有手工 Models 编辑继续可用。
2. 删除 `/api/models-config/sync` 路由和 preview cache；不改已写入模型。
3. 共享 store 若稳定可保留；如需完全回滚，恢复原 ModelsConfig/model-price writer，但不得删除 backup 或用户模型。
4. 同步只追加 `{ id }`，用户可在现有 Models UI 手工删除不需要的新增项；不提供自动逆向删除。