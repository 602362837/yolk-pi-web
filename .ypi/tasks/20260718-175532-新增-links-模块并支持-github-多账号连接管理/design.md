# Design：Links GitHub OAuth Device Flow、多账号存储与授权状态机

## 方案摘要

新增与 LLM 认证完全隔离的 Links domain。P0 使用 **产品方 GitHub OAuth App 的 Device Flow**：用户点击连接后，服务端请求设备码，UI 展示 GitHub user code 与官方验证页，服务端独立轮询 access token，验证 `/user` 身份后把 OAuth credential 保存到 `~/.pi/agent/links/`。

上一版把“不要求用户创建 OAuth App”错误理解为“不用 OAuth”。正确边界是：**OAuth App/GitHub App 是产品应用身份；OAuth token 是用户批准后发给服务端的凭据。终端用户既不创建应用身份，也不粘贴 token。**

P0 完全移除 PAT UX。GitHub OAuth App client id 由产品持有并在 server-only 环境注入；Device Flow 不需要 client secret。若 client id 未配置，后端 fail closed，UI 显示配置缺失，不回退 PAT。

## 候选方案比较与结论

| 方案 | 优点 | 主要问题 | P0 结论 |
| --- | --- | --- | --- |
| A. OAuth App Authorization Code + loopback/redirect | 标准浏览器“批准后自动返回”；现有 `/api/auth/login` 已有 SSE + manual paste UX 可借鉴 | GitHub web flow token exchange要求 client secret；需 state + PKCE S256；本机 callback 需固定 `127.0.0.1`，远程浏览器无法回到服务机，必须保留粘贴 callback URL；端口/浏览器环境复杂 | Future。若实现，必须在 `/api/links/**` 独立实现，secret 仅服务端，callback 仅 loopback，远程浏览器保留 manual paste |
| **B. OAuth App Device Flow** | GitHub 官方支持；只需 client id、不需 client secret；无 callback、state/PKCE/loopback；同机/远程浏览器均可；非常适合本机 Next/CLI 式产品 | 用户需输入一次短码；服务端需正确轮询 pending/slow_down/expiry；OAuth App 必须开启 Device Flow | **P0 选择** |
| C. GitHub App 安装/授权 | fine-grained repository permissions、installation 范围清晰、短期 token，适合未来 repo/automation | 安装与 repository selection 明显超出“连接 only”；应用私钥/installation token 生命周期更复杂 | Future，等 repo 权限引擎立项后再评估 |
| D. `gh auth login` / 导入 gh credential | 可借用用户已有 CLI 登录 | 依赖 `gh` 可执行文件和其内部存储/active-account 语义；导出 token 增加进程与日志泄漏面；跨平台/多账号/host 行为不稳定；不再是产品自己的授权体验 | 不选 |

### PKCE、loopback 与远程浏览器兼容结论

- P0 Device Flow **没有 redirect URI**，因此不需要 PKCE verifier/challenge、OAuth `state`、callback listener 或 `127.0.0.1` 端口。
- GitHub verification URI 可在同机或另一台设备打开，远程浏览器不需要粘贴 callback URL。
- 若未来改用 A，必须使用随机 `state` + PKCE S256；listener 只绑定 `127.0.0.1`/`::1`，不得绑定 `0.0.0.0`；继续提供现有模型 OAuth 类似的手工粘贴 redirect URL fallback。GitHub web token exchange所需 client secret只能在服务端配置，绝不进入 `NEXT_PUBLIC_*`、浏览器 bundle 或仓库明文。

## OAuth App 归属与配置

### 拍板

- 应用身份归 **yolk pi web 产品方**，不是每个终端用户。
- 产品方创建 GitHub OAuth App 并启用 Device Flow。
- P0 backend 从 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 读取 client id。官方构建/部署提供产品-owned id；源码开发/自托管可在 server 环境覆盖自己的 id。
- 不在 Settings 增加 client id/secret 表单，不写 `pi-web.json`，不让普通用户一次性配置 App。
- Device Flow 官方契约只要求 client id；P0 不持有 client secret。

client id 本身不是 secret，但仍按 server configuration 管理，避免 UI 配置与 domain 污染。缺失/格式非法时 `POST authorizations` 返回 `503 github_authorization_not_configured`。实现/UAT 前产品 owner 必须提供真实 client id，这是发布 blocker。

### 最小权限

固定请求 `read:user`，不允许客户端传 scope。P0 只读取 `/user` 身份，不申请 `repo`、`workflow`、`admin:org` 等能力。token endpoint 返回的 `scope` 规范化为 `grantedScopes`；UI 同时展示固定 `requestedScopes` 和 GitHub 返回的 granted scopes，不从 token prefix 或其他 header 推断权限。

## 模块边界

### 新增共享模块

- `lib/links-types.ts`：provider/connection/authorization wire contracts，稳定错误 code。
- `lib/links-provider-registry.ts`：Links-only adapter registry，首个 allowlisted provider `github`；未知 provider fail closed。
- `lib/github-link-oauth.ts`：server-only OAuth client 配置、device code 请求、token polling、scope parser、`/user` 验证、安全错误映射。
- `lib/links-authorization-manager.ts`：进程内短期授权状态机、TTL/数量上限、订阅/SSE snapshot、cancel/cleanup。
- `lib/links-store.ts`：metadata/secret 分离、多账号、provider lock、原子写、duplicate/disconnect transaction。

这些模块不得导入 `oauth-accounts.ts`、`oauth-account-providers.ts`、`web-credential-store.ts`、`web-model-runtime.ts`、`rpc-manager.ts`。可以借鉴模式，不可复用其 store 或 provider 语义。

### API

- `GET /api/links`
- `GET /api/links/github/connections`
- `POST /api/links/github/authorizations`
- `GET /api/links/github/authorizations/[authorizationId]/events`
- `DELETE /api/links/github/authorizations/[authorizationId]`
- `DELETE /api/links/github/connections/[connectionId]`

P0 不提供 `POST /connections { token }`。

### 前端

- `components/LinksConfig.tsx`：provider list、授权状态、活动连接与断开 owner。
- `components/SettingsTreeNavigation.tsx`：新增稳定 root leaf `links`，位于 Studio 后、模型与用量前。
- `components/SettingsConfig.tsx`：渲染 Links view；不依赖 cwd，不参与 web-config dirty/save。
- `app/globals.css`：设备码面板、连接卡片、错误/窄屏/focus/reduced motion。
- `AppPromptProvider`：断开确认。

## Provider adapter 契约

```ts
interface LinkProviderAdapter {
  id: "github";
  displayName: "GitHub";
  startAuthorization(input: { signal?: AbortSignal }): Promise<DeviceAuthorizationGrant>;
  pollAuthorization(input: {
    deviceCode: string;
    intervalSeconds: number;
    expiresAt: string;
    signal?: AbortSignal;
  }): Promise<OAuthCredentialResult>;
  validateCredential(input: {
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<ValidatedLinkIdentity>;
}
```

`DeviceAuthorizationGrant` 内部含 `deviceCode`；wire projector 只返回 `userCode/verificationUri/expiresAt/interval/requestedScopes`。`OAuthCredentialResult` 内含 access token，仅传给 validation/store，不可序列化到 generic event/error。

## 授权状态机

```text
starting
  → awaiting_user
      ├─ authorization_pending → awaiting_user
      ├─ slow_down → awaiting_user (interval += GitHub response / at least 5s)
      ├─ access_denied → denied
      ├─ expired_token / TTL → expired
      ├─ local cancel → cancelled
      ├─ network/timeout/bad response → failed
      └─ access token
           → validating_identity
              ├─ invalid token/bad /user → failed
              └─ valid identity
                   → persisting
                      ├─ duplicate → duplicate
                      ├─ store failure → failed
                      └─ connected
```

`globalThis.__piLinkAuthorizations` 保存短期 session：opaque authorization id、provider、userCode、deviceCode、interval、expiresAt、状态、sanitized result/error、AbortController、subscriber set。约束：

- 最大并发/保留数量建议 20；超限返回 429/503 安全错误。
- 终态保留短 TTL（例如 2 分钟）供 SSE 重连，然后清理。
- pending session 不写磁盘；server restart 后丢失，UI 显示“授权会话已失效，请重新连接”。
- POST 启动后后台 polling 独立运行；浏览器关闭/SSE 断开不导致已批准 token 丢失。
- DELETE cancel 终止 polling；不能保证撤销已在 GitHub 批准但尚未处理的远端 grant，文案保持保守。
- SSE 首帧发送当前 snapshot，随后只发送 allowlisted state；heartbeat 不含 credential。

## GitHub 固定网络契约

### 1. 请求设备码

```text
POST https://github.com/login/device/code
Accept: application/json
Content-Type: application/x-www-form-urlencoded
body: client_id=<server-configured>&scope=read%3Auser
```

解析 allowlist：`device_code`, `user_code`, `verification_uri`, `expires_in`, `interval`。`verification_uri` 必须是固定 HTTPS GitHub device verification URL/allowlist。只把 `user_code` 投影到浏览器。

### 2. 轮询 token

```text
POST https://github.com/login/oauth/access_token
Accept: application/json
Content-Type: application/x-www-form-urlencoded
body: client_id=<server-configured>&device_code=<server-memory>&grant_type=urn:ietf:params:oauth:grant-type:device_code
```

严格处理 `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, `incorrect_client_credentials`, `incorrect_device_code`, `device_flow_disabled`。不得把 raw response 或 device_code 放进 Error.message。

### 3. 验证身份

```text
GET https://api.github.com/user
Authorization: Bearer <access-token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: yolk-pi-web/<stable-version>
```

只解析合法 `id`, `login` 与可选安全显示字段。固定 10 秒级超时、64 KiB 级 body cap、redirect rejection。token response `scope` 是 granted scope 的主要证据；`X-Accepted-OAuth-Scopes` 不得当作已授权权限。

## REST / SSE 契约

### `GET /api/links`

返回 provider catalog、配置状态和活动连接计数，不触发 GitHub 网络请求，不读取 secret：

```json
{
  "providers": [
    { "id": "github", "displayName": "GitHub", "authorizationConfigured": true, "connectionCount": 2 }
  ]
}
```

### `POST /api/links/github/authorizations`

不接受 body，或只接受空对象；任何 `token/clientId/clientSecret/scope/redirectUri/url` 字段均拒绝。成功 201：

```json
{
  "authorization": {
    "id": "opaque",
    "status": "awaiting_user",
    "userCode": "ABCD-EFGH",
    "verificationUri": "https://github.com/login/device",
    "expiresAt": "...",
    "intervalSeconds": 5,
    "requestedScopes": ["read:user"]
  }
}
```

### `GET .../authorizations/[id]/events`

SSE snapshot types：`awaiting_user | polling | validating | connected | duplicate | denied | expired | cancelled | error`。`connected` 可带 sanitized connection；`duplicate` 可带现有 connection id/summary 的安全子集以便 UI 聚焦。所有帧禁止 access token/device_code/raw body。

### `DELETE .../authorizations/[id]`

取消本机 pending flow。终态/不存在返回稳定 404 或 idempotent 200；本计划建议 200 `{ cancelledId }` 仅对 active pending，其他 404，避免虚假声明。

### `GET /connections`

只读 registry metadata，不读取 secret、不自动联网。`connected` 表示 `lastValidatedAt` 时成功。

### `DELETE /connections/[connectionId]`

opaque id + provider 双重匹配。成功 200 `{ disconnectedId }`。本机 secret 删除，metadata disconnected；不调用 GitHub remote revoke。

### 稳定错误

- 400 `invalid_request`
- 404 `authorization_not_found`, `connection_not_found`, `provider_not_found`
- 409 `duplicate_identity`
- 429 `authorization_capacity_exceeded`, `github_rate_limited`
- 500 `links_store_error`
- 502 `github_bad_response`
- 503 `github_authorization_not_configured`, `github_unavailable`
- 504 `github_timeout`
- SSE terminal codes：`github_access_denied`, `github_authorization_expired`, `github_device_flow_disabled`, `github_client_invalid`

所有 REST success/error 使用 `Cache-Control: no-store`；SSE 使用 `no-cache, no-store` 和 keep-alive。

## 存储契约

```text
~/.pi/agent/links/
  registry.json
  .locks/
  github/
    <opaque-connection-id>.json
    .quarantine-<opaque-random>.json
```

metadata：

```ts
interface LinkConnectionMetadata {
  id: string;
  provider: "github";
  label: string;
  login: string;
  providerUserId: string;
  status: "connected" | "disconnected";
  requestedScopes: string[];
  grantedScopes: string[];
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string;
  deletedAt?: string;
  isDefault?: boolean;
}
```

secret：

```ts
interface GitHubOAuthSecretV1 {
  schemaVersion: 1;
  kind: "github_oauth";
  accessToken: string;
  tokenType: "bearer";
  issuedAt: string;
  expiresAt?: string;
}
```

refresh token若未来出现，必须先设计刷新语义和 secret schema 迁移；P0 不把未知 token response字段原样落盘。

权限、锁、原子写和 disconnect quarantine/rollback 延续上一版：目录 0700、文件 0600、provider-keyed process queue + mkdir cross-process lock、同目录 tmp + fsync/rename。create 在锁内重复检查；secret write成功而 registry write失败必须清理 secret。disconnect 先把 secret rename 到不可读 quarantine，再写 metadata disconnected，失败则恢复；成功后 unlink quarantine。

## 重复 identity 语义

通用“连接 GitHub”完成后若 numeric user id 已存在，返回 409，不静默替换。新 access token不写本机文件；UI提示先断开再重新连接。风险是 GitHub 可能已为同一 app/user/scope签发额外 token，P0因不持有 client secret不做远端 token revoke；检查与文案必须披露可前往 GitHub Settings → Applications → Authorized OAuth Apps 撤销。Future 可设计明确“重新授权此连接”的原子 replacement flow，但不顺手加入 P0。

## UI 数据边界

`LinksConfig` owner：catalog loading、connections loading、activeAuthorization、authorization state、disconnectingId、errors。启动时 POST，然后订阅 SSE；新开 verification URI，显示 user code + copy。用户 code 是为用户输入而设计的短期码，可显示/复制，但切页、终态和过期后从 React state 清除。device_code/access token永不进入浏览器。

Links 操作即时保存，不影响 Settings dirty。全局 Save/Reset在 Links view隐藏或 disabled并有明确“即时操作”说明。断开复用 AppPrompt，取消后恢复焦点。

## 兼容性与迁移

- 新目录/route/section，旧用户为空态；不迁移 PAT 或任何 auth store。
- 上一版只存在规划、无生产数据，因此无需 PAT schema迁移。
- `SettingsSection` 新增 `links`，同步 exhaustive mappings/deep-link tests。
- authorization registry 是进程内 ephemeral；多进程/无状态部署不支持，但 ypi web 当前是本机单服务。若未来横向部署，需共享 state store，不在 P0。

## 风险与缓解

1. **产品 client id 未准备**：作为实现/UAT blocker；缺失 fail closed，不退 PAT。
2. **token/device_code 泄漏**：专用 secret types、safe errors、no raw logs、sentinel全路径扫描。
3. **polling超频**：以 GitHub interval为下限，slow_down动态增加，fake timers测试。
4. **SSE断线丢成功**：后台授权任务独立于订阅；成功先持久化，GET list可恢复。
5. **重复授权产生未保存远端 token**：409不静默覆盖，UI给 GitHub revoke指引；Future再做显式 reauthorize。
6. **scope过度**：固定 `read:user`，客户端不能传 scope。
7. **误耦合 LLM auth**：import/path checker门禁。
8. **断开不等于撤销**：确认框与成功说明明确，避免安全误解。

## 回滚

隐藏 Links leaf并让 authorization start返回 503；保留 `~/.pi/agent/links/` 数据，不自动删除或迁回 `auth.json`。待授权 session仅内存，服务重启自然失效。完整回滚不自动撤销 GitHub远端 app authorization；用户按文档在 GitHub Settings手工撤销。