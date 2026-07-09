# design

## 方案摘要

推荐方案：**新增应用自管的 API-key 多账号存储层，并把当前 active key 镜像回 `auth.json`，从而复用现有 pi SDK / `AuthStorage` 运行时读取链路。**

核心思路：

1. 新增一个可复用但默认只给 `opencode-go` 开启的 `lib/api-key-accounts.ts`；
2. 多账号记录保存在独立目录中，而不是改写上游 `auth.json` 为数组结构；
3. 当前 active 账号的 credential 继续写回 `auth.json` 的 `opencode-go` provider entry；
4. 激活 / 删除 / 替换 active 时统一调用 `reloadRpcAuthState()`；
5. 所有列表类接口默认只返回脱敏数据；明文只允许通过单账号 reveal 接口获取；
6. UI 只对 `opencode-go` 启用多账号管理，其它 API-key provider 暂不改。

这条路线的最大优点是：**不要求修改上游 SDK 的 provider/auth 契约，也不需要让 `ModelRegistry` 理解“一个 provider 有多个 key”**。运行时仍然只看到一个 active key；多账号能力完全留在 web app 自己的管理层。

---

## 影响模块与边界

### 前端

- `components/ModelsConfig.tsx`
  - 当前 `ApiKeyDetail` 是单输入框；
  - 需改为：当 provider 支持 managed accounts 时，渲染账号列表管理视图；
  - `opencode-go` 走新视图，其它 provider 继续现状。
- `components/ModelsConfig.tsx` 内部 `ApiKeyProvider` 类型
  - 建议扩展 `authMode: "single" | "managed_accounts"`；
  - 可选扩展 `accountCount`、`activeAccountDisplayName`，供左侧 provider 行和详情头部展示。

### API routes

- `app/api/auth/all-providers/route.ts`
  - 增加 provider 是否启用 managed accounts 的投影字段；
- `app/api/auth/api-key/[provider]/route.ts`
  - 从“单 key CRUD 路由”演进为“provider summary + legacy compatibility route”；
- 新增 `opencode-go` 多账号管理路由；
- `app/api/auth/accounts/[provider]/activate/route.ts`
  - 不改 OAuth 行为，但其“activate -> reload runtime auth”的模式将被 API-key 多账号复用。

### Library

- 新增 `lib/api-key-accounts.ts`
  - 负责 provider-scoped 多账号记录、legacy import、active mirror、reveal、删除、掩码/指纹、权限模式；
- `lib/rpc-manager.ts`
  - 不改接口，只继续复用 `reloadRpcAuthState()`；
- 可选新增 `lib/api-key-accounts-types.ts`
  - 如果实现中路由/组件共享类型较多，建议拆类型文件；
- `lib/oauth-accounts.ts`
  - 只作为产品模式参考，不直接复用数据结构。

### 上游 pi SDK

- **不改** `AuthStorage` / `ModelRegistry` / provider auth；
- 继续让上游只读取 `auth.json` 中的当前 `opencode-go` credential。

---

## 数据存储设计

### 推荐目录

建议新增应用自管目录：

```text
~/.pi/agent/auth-api-key-accounts/opencode-go/
```

目录权限遵循当前项目已有 secret 存储习惯：

- 目录：`0700`
- 文件：`0600`

### 推荐文件结构

#### 1) 元数据文件 `accounts.json`

```json
{
  "version": 1,
  "provider": "opencode-go",
  "activeAccountId": "ak_123",
  "accounts": [
    {
      "accountId": "ak_123",
      "displayName": "主账号",
      "description": "日常调用",
      "maskedKeyPreview": "op_****_9f2d",
      "keyFingerprint": "sha256:...",
      "createdAt": "2026-07-09T09:00:00.000Z",
      "updatedAt": "2026-07-09T09:00:00.000Z",
      "lastActivatedAt": "2026-07-09T09:00:00.000Z",
      "importedFromLegacyAt": null
    }
  ]
}
```

说明：

- `maskedKeyPreview`：列表展示用，不必每次读取明文 secret 文件；
- `keyFingerprint`：用于幂等导入、去重、active mirror 对齐；建议 `sha256`；
- 元数据文件绝不存明文 key。

#### 2) 账号 secret 文件 `<accountId>.json`

```json
{
  "type": "api_key",
  "key": "real-api-key"
}
```

说明：

- v1 `opencode-go` 只需要 `key`；
- 若后续扩到 Cloudflare 等 provider，可兼容 `env` 字段，直接沿用上游 `ApiKeyCredential` 结构；
- reveal / activate 时再读取该文件。

### 为什么不直接把多条 key 放进 `auth.json`

因为当前上游 `AuthStorage` 的核心契约就是：

```ts
Record<string, AuthCredential>
```

即一 provider 一条 credential。若直接把 `auth.json` 改成数组结构，会牵涉：

- 上游 `AuthStorage` 解析；
- `ModelRegistry` auth status；
- 现有 provider auth 读取；
- 所有直接 `AuthStorage.create()` 的调用点。

该改造超出本任务边界，且风险显著高于“应用自管多账号 + active mirror”。

---

## 关键流程设计

### 1. 首次进入多账号管理页：legacy read-through import

触发点：

- `GET /api/auth/api-key/opencode-go/accounts`
- 以及所有 mutate 路由的前置 ensure helper

流程：

1. 读取 `auth.json` 中 `opencode-go` 的当前 credential；
2. 若是 `type: "api_key"` 且多账号元数据中还没有同 `keyFingerprint` 的记录：
   - 新建一条账号记录；
   - `displayName` 默认：`Imported key`；
   - `description` 默认：`Imported from legacy single-key config`；
   - `importedFromLegacyAt = now`；
   - `activeAccountId` 指向该条记录；
   - secret 写入 `<accountId>.json`；
3. 若已有相同 `keyFingerprint` 记录，则只对齐 `activeAccountId`；
4. **不删除** `auth.json` 中现有 active key。

边界：

- 该导入是本地幂等迁移，只发生在多账号管理入口；
- provider summary 路由可保持纯读，不强制触发迁移。

### 2. 新增账号

请求建议：

```http
POST /api/auth/api-key/opencode-go/accounts
Content-Type: application/json

{
  "displayName": "备用账号",
  "description": "配额快满时切换",
  "apiKey": "...",
  "activate": true
}
```

流程：

1. 校验 provider 当前是否允许 managed accounts；
2. 校验 `displayName`、`description`、`apiKey`；
3. 生成 `accountId`、`maskedKeyPreview`、`keyFingerprint`；
4. 写 metadata + secret；
5. 若 `activate !== false`：
   - 更新 `activeAccountId`；
   - 调 `AuthStorage.set(provider, credential)` 镜像到 `auth.json`；
   - 调 `reloadRpcAuthState()`；
6. 返回列表摘要，不返回明文。

### 3. 激活账号

请求建议：

```http
POST /api/auth/api-key/opencode-go/accounts/{accountId}/activate
```

流程：

1. 读取账号 secret；
2. 更新 `activeAccountId` 与 `lastActivatedAt`；
3. `AuthStorage.set("opencode-go", { type: "api_key", key })`；
4. `reloadRpcAuthState()`；
5. 返回新列表摘要或精简激活结果。

### 4. reveal / copy

请求建议：

```http
POST /api/auth/api-key/opencode-go/accounts/{accountId}/reveal
```

响应建议：

```json
{
  "accountId": "ak_123",
  "apiKey": "real-api-key"
}
```

安全边界：

- 只允许单账号 reveal；
- 响应头加 `Cache-Control: no-store`；
- 服务器日志、错误文本、列表返回都不得包含明文；
- 前端 reveal 状态不持久化。

复制策略：

- 前端可在 reveal 后复制；
- 或点击 copy 时即时调用 reveal 接口，写入剪贴板后立即丢弃内存中的明文；
- 无论哪种，复制都必须是显式用户动作。

### 5. 更新账号

请求建议：

```http
PATCH /api/auth/api-key/opencode-go/accounts/{accountId}
```

支持字段：

- `displayName`
- `description`
- `apiKey?`（可选，用于替换/轮换 key）

若替换的是 active 账号的 key，则需同步镜像 `auth.json` 并 reload runtime auth。

### 6. 删除账号

请求建议：

```http
DELETE /api/auth/api-key/opencode-go/accounts/{accountId}
```

推荐语义：

- 删除非 active：直接删；
- 删除 active 且仍有剩余记录：自动挑选 fallback（按 `lastActivatedAt desc`，其次 `updatedAt desc`）并激活；
- 删除最后一条：清空 `auth.json` 中该 provider credential，并 `reloadRpcAuthState()`。

这样能保持“有保存账号时尽量总有 active”的简单模型。

---

## API 契约建议

### A. 演进现有 `/api/auth/api-key/[provider]`

#### `GET /api/auth/api-key/[provider]`

从当前：

```json
{ "provider", "displayName", "configured", "source", "models" }
```

演进为兼容扩展：

```json
{
  "provider": "opencode-go",
  "displayName": "OpenCode Zen Go",
  "configured": true,
  "source": "stored",
  "models": 12,
  "authMode": "managed_accounts",
  "accountCount": 3,
  "activeAccountId": "ak_123",
  "activeAccountDisplayName": "主账号"
}
```

要求：

- 明文 key 仍然不返回；
- 对非 `opencode-go` provider，`authMode` 仍可为 `single`。

#### `POST /api/auth/api-key/[provider]`

兼容策略：

- 保留旧 body：`{ apiKey }`；
- 对 `opencode-go`：**继续保留旧“替换当前 active key”语义**，而不是创建一条新账号；
- 实现方式：
  - 若已有 managed active account，则更新该账号 secret；
  - 若尚未迁移，则创建一条默认账号并设为 active；
- 新 UI 不再依赖此路由新增账号，但旧调用不会坏。

#### `DELETE /api/auth/api-key/[provider]`

推荐策略：

- 对尚未进入 managed accounts 的 legacy 单 key 状态：仍可直接清掉 `auth.json`；
- 一旦 `opencode-go` 已启用 managed accounts：返回 `409 managed_accounts_enabled`，提示使用按账号删除接口；
- 避免把旧 `DELETE` 粗暴定义成“删除全部账号”，以免误伤。

### B. 新增多账号路由

推荐新增：

- `GET /api/auth/api-key/[provider]/accounts`
- `POST /api/auth/api-key/[provider]/accounts`
- `PATCH /api/auth/api-key/[provider]/accounts/[accountId]`
- `DELETE /api/auth/api-key/[provider]/accounts/[accountId]`
- `POST /api/auth/api-key/[provider]/accounts/[accountId]/activate`
- `POST /api/auth/api-key/[provider]/accounts/[accountId]/reveal`

建议返回结构：

```json
{
  "provider": "opencode-go",
  "activeAccountId": "ak_123",
  "accounts": [
    {
      "accountId": "ak_123",
      "displayName": "主账号",
      "description": "日常调用",
      "maskedKeyPreview": "op_****_9f2d",
      "active": true,
      "createdAt": "...",
      "updatedAt": "...",
      "lastActivatedAt": "...",
      "importedFromLegacyAt": null
    }
  ]
}
```

列表接口不返回 `keyFingerprint` 与明文 key。

---

## 前端交互设计要点（供 UI 原型与实现使用）

> 本任务触发 UI 原型门禁；此处只定义交互契约，不替代 HTML 原型。

### `ModelsConfig` 中 `opencode-go` 的详情区

建议结构：

1. 顶部摘要
   - Provider 名称；
   - 当前 active 账号；
   - 已保存账号数；
   - 配置状态。
2. 操作区
   - `Add API Key` 按钮；
   - 可选 `Delete all keys` 风险操作（非 MVP 必须项）。
3. 列表区
   - 每行显示：`displayName`、`description`、`maskedKeyPreview`、`Active` badge、`lastActivatedAt`；
   - 行内按钮：`Activate`、`Show/Hide`、`Copy`、`Edit`、`Delete`。
4. 表单弹层/内联编辑
   - 字段：`displayName`、`description`、`apiKey`；
   - 默认 `save and activate`；
   - 编辑 active 账号且替换 key 时，提交后立即生效。

### 必须覆盖的状态

- 空状态：无账号；
- 旧单 key 导入后状态；
- 多账号常态；
- reveal 中 / reveal 失败；
- 复制成功；
- 删除 active 且自动切换 fallback；
- 删除最后一条后 provider 断开；
- 请求失败与重试。

---

## 是否做成通用 API-key 多账号层

### 备选 A：只为 `opencode-go` 写特例

优点：

- 改动小；
- 路由和 UI 都简单。

缺点：

- 未来其它 API-key provider 若也需要多账号，会重复建设；
- 存储结构与安全边界容易散落在 `opencode-go` 特例代码里。

### 备选 B：一开始就做全量通用 UI

优点：

- 未来扩展快。

缺点：

- 当前需求只验证在 `opencode-go`；
- 一次性把所有 provider 卷进来，回归面和产品确认面都会大很多。

### 推荐

**底层服务层做泛化，产品开放面只给 `opencode-go`。**

即：

- `lib/api-key-accounts.ts` 用 provider 参数设计；
- 路由层只 allowlist `opencode-go` 进入 managed accounts；
- `/api/auth/all-providers` 用 `authMode` 告诉前端是否启用新 UI；
- 其它 provider 继续单 key 模式。

这样既避免完全写死，又不扩大 v1 产品范围。

---

## 兼容性、风险与回滚

### 兼容性

- 运行时兼容：继续读 `auth.json` active mirror；
- UI 兼容：非 `opencode-go` provider 不变；
- 数据兼容：legacy 单 key 首次管理时幂等导入；
- 回滚兼容：旧版本仍可用当前 active mirror 工作，只是忽略额外保存的账号。

### 主要风险

1. **明文 reveal 安全风险**
   - 若列表接口误带明文、错误 toast 输出明文、或 copy 逻辑打日志，会直接泄漏 secret。
2. **旧路由兼容风险**
   - `DELETE /api/auth/api-key/[provider]` 的旧语义与 managed accounts 冲突，必须显式降级或拦截。
3. **重复导入风险**
   - 若 legacy import 不做 `keyFingerprint` 去重，可能把同一 active key 导入多份。
4. **active mirror 失同步风险**
   - 若 metadata active 已切换但 `auth.json` 未成功写入，会出现 UI 和运行时不一致。
5. **与 `opencode` 关系混淆**
   - 两者都来自 OpenCode 家族、共享环境变量名，但 v1 必须保持 provider 级隔离。

### 缓解

- reveal 仅单账号专用接口，且 `Cache-Control: no-store`；
- metadata 写入与 active mirror 更新要作为单个 helper 流程；
- 对 legacy import 使用 `keyFingerprint` 幂等匹配；
- base `DELETE` 在 managed 模式下返回 `409`，避免误删除；
- UI 和文档明确 `opencode-go` / `opencode` 独立。

### 回滚方案

若实现上线后需要快速回滚：

- 保留 `auth.json` 中当前 active `opencode-go` key；
- 旧版本继续按当前 active key 工作；
- 新增的 `auth-api-key-accounts/` 目录保留，不影响旧版本；
- 若新逻辑出错，可手工删除 managed accounts 目录，仅保留 `auth.json` active key 恢复单-key 模式。

---

## 本阶段阻塞项

本任务已经触发 UI 原型门禁。

当前设计可作为实现依据的前提是：

1. 主会话 / 用户先批准本设计方向；
2. UI 设计员补齐 `ModelsConfig` 的 **HTML 原型**；
3. 用户对原型完成审批。

在这三项完成前，不建议进入实现。