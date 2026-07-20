# Brief：为 Grok CLI 增加重新登录功能

## 任务目标

让用户在 Grok CLI 已保存账号的 OAuth 凭据失效后，能够从现有账号管理界面明确识别问题，并对**指定账号槽位**重新完成 OAuth 授权，而不是只能“添加账号”并产生新的重复账号记录。

## 当前证据

### 账号添加

- `components/ModelsConfig.tsx` 的 Grok managed-account 分支只提供“添加账号”；`handleGrokLoginMethod()` 最终固定调用 `handleLogin("add")`。
- `GET /api/auth/login/grok-cli?accountMode=add` 使用内存 `CredentialStore` 完成 OAuth，成功后调用 `saveOAuthAccountCredential()` 分配新的 `acct_*` storage id，因此每次都会新建账号槽位。
- Grok 登录方式来自 `pi-grok-cli@0.5.0`：Browser PKCE、Device Code、读取官方 `~/.grok/auth.json`。上游方法 id 实际为 `browser | device | existing`。
- 当前 Grok 登录方式按钮没有像 Kiro 一样预选并自动回答上游 `select_request`，用户可能再次看到方法选择。

### 登录失效展示

- `lib/grok-subscription-quota.ts` 在 token 不可用或 billing 返回 401/403 且刷新失败时投影 `reauthRequired: true` 和 allowlisted `unauthorized`。
- `components/GrokQuotaView.tsx` 与 `components/GrokUsagePanel.tsx` 已显示“需要重新登录/在 Models → Grok 重新登录”。
- 但 `ModelsConfig` 的 Grok quota 加载、quota 卡片渲染和自动 effect 仍以 `provider.loggedIn` 为门槛；当 runtime `checkAuth()` 已失败但 saved accounts 仍存在时，Models 可能不再加载 quota，也无法稳定显示恢复入口。
- `ModelsConfig` 左侧 active OAuth 列表只包含 `loggedIn === true` 的 provider。managed accounts 尚在但 Active 凭据无效时，Grok 可能退回“可添加 provider”路径，弱化了“已有账号待恢复”的语义。

### 账号管理

- `GET /api/auth/accounts/grok-cli` 返回 opaque account id、显示名、备注、Active 状态等安全摘要。
- `POST .../activate` 会保持 opaque id 并把目标凭据镜像到 `auth.json`，然后 reload live RPC auth。
- 账号行已有查看、备注、详情、启用、删除、quota 刷新，但没有“重新登录”。
- `saveOAuthAccountCredential(..., { storageId })` 已具备按原 storage id 写回的基础能力，但目前没有面向重新登录的受约束服务/API，也没有解决 OAuth refresh、Activate、重新登录并发覆盖和旧 quota cache 串用的问题。

## 核心问题

1. “重新登录”与“添加账号”当前没有不同的持久化语义。
2. 无效 Active 凭据会让 Models 过度依赖 `loggedIn`，已有账号的恢复路径不稳定。
3. 直接复用 `accountMode=add` 会创建重复槽位；直接复用 provider-wide login 只能模糊覆盖 Active，不能安全指定非 Active 账号。
4. 同一 storage id 重新授权后可能对应新的 refresh token，旧 in-flight refresh 或旧 quota cache 不能覆盖/污染新凭据。
5. xAI/Grok OAuth credential 没有可依赖的稳定公开用户 id；refresh-token hash 会在重新授权后变化，无法可靠证明浏览器里登录的仍是同一个 xAI 身份。

## 推荐产品定义

- P0 仅支持 `grok-cli` 的**指定账号原位重新授权**。
- 重新登录成功后：保留 opaque `accountId`、备注、补充信息、创建时间和 Active 状态；替换 secret credential，并更新安全诊断显示 hash。
- 非 Active 账号重新登录不得改变全局 Active 或 `auth.json`。
- Active 账号重新登录成功后更新 Active mirror，并让普通运行中/新会话的后续请求使用新凭据；已发出的请求不切换 token。
- 失败、取消、目标账号在授权期间被删除时，原凭据和 Active 状态不变。
- 由于无法严格验证同一 xAI 身份，UI 必须明确：该操作替换所选账号槽位的授权，请在浏览器确认使用正确账号；不做虚假的“同身份校验”。
- Top-bar Grok 用量面板只深链到 Models → Grok 的目标账号和恢复 CTA，不在悬浮面板内直接启动 OAuth。

## 范围

### 范围内

- Grok saved-account 原位 reauth 服务与受约束 API mode。
- Active/non-Active 写回、reload、缓存失效和并发保护。
- Models 中保留失效 managed provider、展示 reauth 状态和账号级入口。
- Grok 登录方式预选、确认、进行中、成功、失败、取消状态。
- Top-bar `reauthRequired` 到 Models → Grok 的聚焦恢复路径。
- 自动测试、手工验收和项目文档更新。

### 范围外

- Kiro、Antigravity、ChatGPT 的重新登录统一化。
- OAuth credential JSON 导入。
- xAI 远端账号身份强校验或账号合并/去重。
- 删除历史账号、迁移 storage id、重写 Session JSONL。
- 改变 Grok auto-failover、配额算法、模型目录或环境变量 token bypass 语义。

## 当前阻塞

本任务改变账号行操作、失效恢复 CTA、确认与 OAuth 状态体验，触发 UI 原型硬门禁。当前成员会话没有可用的 Studio member delegation 工具，无法实际派发 `ui-designer`。已在 [ui.md](./ui.md) 写出 UI 设计委派契约；主会话需派发 UI 设计员并补交 HTML 原型，之后才可请求用户审批并进入实现。
