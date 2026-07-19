# PRD：Links / GitHub 多账号交互式授权连接

## 目标与背景

本任务为 yolk pi web 新增独立 Links domain，P0 只解决“把多个 GitHub 身份通过正式授权流程连接到本机应用”。用户不应被要求理解、创建或复制 PAT；主流程必须是点击连接后进入 GitHub 官方授权页面，服务端自动取得并保存凭据。

上一版把用户所说“这个阶段不需要 OAuth App”误读成“不使用 OAuth”。本版明确纠正：

- **OAuth App / GitHub App 是应用身份**，用于告诉 GitHub“哪个产品在请求授权”。
- **OAuth access token 是用户批准后 GitHub 发给服务端的凭据**。
- 本期“不让用户创建 OAuth App”指终端用户无需配置应用身份，不代表产品不使用 OAuth。

P0 选择 **GitHub OAuth App Device Flow**，由产品提供 OAuth App client id。Device Flow 不需要 client secret、回调 URL、loopback listener 或用户粘贴回调；适合本机服务、远程浏览器和终端式产品。

## 用户价值

1. 点击一次“连接 GitHub”即可进入可信的 GitHub 官方授权体验。
2. 不手工创建、复制或保管 PAT，浏览器也看不到最终 access token。
3. 一个本机实例可保存多个不同 GitHub 身份。
4. 能查看最近验证身份与最小 scopes，并明确本机断开和 GitHub 远端撤销的区别。

## 产品决策

| 决策 | P0 选择 |
| --- | --- |
| 授权主路径 | B. GitHub OAuth Device Flow |
| 应用身份 | 产品方拥有的 GitHub OAuth App，启用 Device Flow |
| client 配置 | server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`；官方构建/部署注入，开发者可覆盖 |
| client secret | 不需要、不配置、不进入仓库或浏览器 |
| scopes | 仅 `read:user`；不申请 repo/workflow/org 管理权限 |
| PAT | 完全移出 P0 |
| 重复 identity | 409 拒绝，不静默替换现有本机凭据 |
| 断开 | 删除本机 secret、soft-delete metadata；不自动撤销 GitHub 远端授权 |

## 范围内

- Settings tree 增加 root-level `Links` leaf，页面不参与 `pi-web.json` dirty/save。
- Provider registry 首期只 allowlist `github`。
- “连接 GitHub”启动 Device Flow。
- 显示 GitHub 官方 verification URI、短期 user code、过期时间、等待/成功/拒绝/过期/网络失败状态。
- 服务端保存 device_code 并轮询 token endpoint；device_code 不返回浏览器、不落持久化文件。
- token 成功后调用固定 `GET https://api.github.com/user` 验证身份，再在 provider lock 下保存。
- 多账号列表展示安全摘要，支持独立断开。
- 连接页与所有 API 使用稳定、安全、no-store 错误投影。

## 范围外 / Future

- PAT 输入、导入、reveal、copy、masked preview。
- OAuth Authorization Code callback、PKCE/loopback listener、粘贴 redirect URL。
- GitHub App installation flow、repository selection、installation token。
- `gh auth login`、`gh auth token` 导入或复用 gh config。
- clone、repo/organization 列表、PR、Issue、Actions、权限引擎、自动化、Chat/GitPanel runtime 消费、默认账号/failover。
- 自动撤销 GitHub 远端 OAuth grant。

## 主用户流程

1. 用户打开 Settings → Links。
2. 点击“连接 GitHub”。
3. 后端确认产品 OAuth client 已配置，向 GitHub `POST /login/device/code` 请求设备授权。
4. 页面显示短期 user code、GitHub 官方验证页链接、剩余时间，并自动新开 GitHub 页面。用户可复制 user code，但不会看到 device_code 或 access token。
5. 后端按 GitHub 返回的最小 interval 轮询 `POST /login/oauth/access_token`；处理 `authorization_pending`、`slow_down`、`access_denied`、`expired_token`。
6. GitHub 返回 access token 后，服务端请求 `/user`，解析 numeric id/login，记录 granted scopes。
7. 在 provider mutation lock 内执行重复检查与安全持久化。成功后 SSE 只发送 sanitized connection summary。
8. UI 刷新活动列表；用户可继续连接另一个身份。
9. 用户断开时确认“只删除本机凭据，不撤销 GitHub 远端授权”，完成后目标卡片移除。

## 功能需求与验收标准

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| LNK-01 | 独立 Links domain | 不导入/调用 `auth.json`、`auth-accounts`、API-key accounts、CredentialStore、ModelRuntime 或 RPC auth reload；只写 `~/.pi/agent/links/`。 |
| LNK-02 | 产品 OAuth 应用身份 | 后端只从 server-only 配置读取 allowlisted GitHub client id；前端无 client 配置表单；缺失时返回稳定 `github_authorization_not_configured`。 |
| LNK-03 | Device Flow 启动 | 点击连接后服务端固定请求 GitHub device endpoint，响应只投影 `authorizationId/userCode/verificationUri/expiresAt/intervalSeconds/requestedScopes`。 |
| LNK-04 | 凭据边界 | `device_code` 只存在服务端短期内存；access token 只存在上游响应、验证调用和 secret 文件；两者不进入 wire/DOM/log/metadata/task/session。 |
| LNK-05 | 轮询状态机 | 严格遵守 interval；`slow_down` 增加等待；pending 不误报失败；拒绝、过期、取消、网络/超时有稳定状态。 |
| LNK-06 | 身份验证 | token 成功后固定调用 `GET https://api.github.com/user`，只有合法 `id/login` 才持久化。 |
| LNK-07 | 最小权限 | P0 固定请求 `read:user`；UI 展示 requested/granted scopes，不声称 repo 权限；不得动态接受客户端 scope。 |
| LNK-08 | 多账号 | 两个不同 GitHub numeric user id 可同时连接，connection id 与 authorization id 均为随机 opaque id。 |
| LNK-09 | 重复策略 | 同 provider + numeric user id 返回 409 `duplicate_identity`；现有 secret/metadata 不变，新 token 不落盘且错误提示说明可先断开再连接。 |
| LNK-10 | 列表状态 | GET 只读 metadata，展示 `connected` 与 `lastValidatedAt`；文案是“上次验证成功”，不声称实时在线。 |
| LNK-11 | 断开 | metadata soft-delete、活动 OAuth secret 删除、活动列表移除；确认框说明不会撤销 GitHub Authorized OAuth App。 |
| LNK-12 | 文件安全 | links/provider/locks 目录 0700，registry/secret 0600，同目录原子替换、provider queue + cross-process lock、断开 quarantine/rollback。 |
| LNK-13 | Settings UI | 覆盖配置缺失、空态、启动、设备码、等待、slow down、成功、拒绝、过期、网络失败、重复、多账号、断开确认/busy/失败。 |
| LNK-14 | 可访问与响应式 | user code 可键盘复制；外链有明确名称；状态不只靠颜色；确认框 focus trap/restore；≤640px 单列可用。 |
| LNK-15 | no-store 与安全错误 | Links REST/SSE 均 no-store；错误为 allowlist code/message，不含上游 body、token、device_code、绝对路径或 stack。 |

## 安全摘要字段

连接摘要至少包含：

- `id`, `provider: "github"`, `label`。
- `login`, `providerUserId`。
- `status: "connected"`。
- `requestedScopes: ["read:user"]`, `grantedScopes: string[]`。
- `createdAt`, `updatedAt`, `lastValidatedAt`。
- 可选 `isDefault` 仅作为未来 domain 字段；P0 不显示切换，也无业务消费。

授权启动摘要至少包含：

- `authorizationId`: opaque id。
- `status: "awaiting_user"`。
- `userCode`: GitHub 为用户展示的短期码；允许 UI 显示/复制。
- `verificationUri`: 必须严格等于 GitHub allowlisted HTTPS 验证页。
- `expiresAt`, `intervalSeconds`, `requestedScopes`。

不得包含 `device_code`、access/refresh token、client secret、Authorization header 或原始 GitHub payload。

## 非功能要求

- GitHub 三个固定端点均使用超时、response size cap、JSON Accept、redirect rejection/严格固定 host。
- 授权会话有 TTL、数量上限、取消与 server restart 恢复文案；待授权状态不持久化到磁盘。
- 授权 SSE 断线可用同一 authorization id 重连并投影当前状态；成功持久化不能依赖浏览器仍在线。
- 测试在动态 import 前设置临时 `PI_CODING_AGENT_DIR`，不得触碰真实用户目录。
- 缺少产品 client id 是发布/UAT blocker；不得静默显示 PAT fallback。

## 待用户批准

批准本计划表示确认：Device Flow 是 P0 主路径；应用身份归产品而非终端用户；P0 完全不做 PAT；重复 identity 返回 409；断开仅清理本机凭据、远端撤销由用户在 GitHub 完成。