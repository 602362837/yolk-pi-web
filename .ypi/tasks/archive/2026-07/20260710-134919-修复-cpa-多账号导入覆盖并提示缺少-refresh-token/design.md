# design

## 方案摘要

把“可被用户操作的保存账号”与“发给 OpenAI 的 ChatGPT 账号”明确分层：

- `storageId`：内部/对外账号管理操作的稳定 opaque id；用于凭据文件名、metadata 主键、`activeAccountId`、quota cache、UI key、所有 `accountId` API 参数和轮换候选。
- `credential.accountId`：真实 `chatgpt_account_id`，保留给 Pi OAuth credential 与配额/重置/label HTTP 请求头。不可用 `storageId` 填充或覆盖它。

为 API 兼容，`OAuthAccountSummary.accountId` 继续存在，但其语义改为“保存账号 id（storageId）”；新增只读 `chatgptAccountId`（可 masked）仅用于展示/诊断时按安全需要使用。旧记录将其原有 `accountId` 同时视为 legacy `storageId` 与真实 credential id，因而无须批量重命名。

## 数据与迁移

### 新记录

```ts
// credential file: <storageId>.json
{
  type: "oauth",
  access: "…",
  refresh: "" | "…",
  expires: 1780000000000,
  accountId: "real-chatgpt-account-id"
}

// accounts.json (additive migration)
{
  version: 2,
  activeAccountId: "acct_<opaque-storage-id>",
  accounts: [{ accountId: "acct_<opaque-storage-id>", chatgptAccountId: "real-chatgpt-account-id", ... }]
}
```

`accountId` 在 metadata/API 中保留名称以避免路由和客户端破坏；代码内部应使用 `storageId` 局部变量避免再次混淆。生成 id 应使用 `randomUUID()`（带现有安全 fallback），不得来源于真实 account id、email、access 或 refresh token。

### 旧记录

- version 1 metadata 与 `<legacy accountId>.json` 保持可读；在内存投影为 `storageId = legacy accountId`。
- 不在 list 时重命名文件，避免活跃 auth mirror、外部自动化和中断时半迁移风险。
- 当旧条目 refresh/保存时，必须保留其 legacy storage id；不可重新根据真实 account id 推导并写入新路径。
- metadata normalizer 应接受 v1/v2，去除丢失文件的条目时仍以 storage id 判断。

## 数据流与接口契约

```text
CPA source(s)
  -> converter: raw OAuth { access, refresh: "" allowed, expires, accountId: real }
  -> import: validate all items, allocate one storageId per item
  -> credential <storageId>.json + metadata key <storageId>
  -> list summary accountId=<storageId>
  -> UI/API activation/quota/warmup/failover pass storageId
  -> read credential -> real credential.accountId
  -> quota/reset/label headers use credential.accountId
```

1. **Converter/validation**：CPA converter 接受单对象和数组；`refresh_token` 缺失/空转为 `refresh: ""` 并携带结构化 risk（不要把风险只编码成中文 error）。raw 的 `refresh` 仍须是 string，但允许空字符串。
2. **Import atomicity**：先转换和验证整个数组，再开始写入；避免第 N 项失败留下半批保存。文件/metadata 写入应使用现有权限策略；如无法实现真正事务，至少预先验证并在 metadata commit 前清理本批新建文件。
3. **Read/save**：`readOAuthAccountCredential(provider, storageId)` 按 storage id 找文件；返回 credential 并附带 storage id（建议 wrapper 而不是污染 SDK credential）。`saveOAuthAccountCredential` 接收/保留明确 storage id，刷新回写原路径。
4. **Active auth**：激活时把 credential 原样写入 `AuthStorage`，因此 Pi transport 可继续从 access JWT 提取真实 `chatgpt_account_id`；活跃 metadata 记录 storage id。
5. **Quota/reset/label**：lookup 用 storage id；发请求时使用 credential 的真实 `accountId`。所有 cache 写回用 storage id，而非真实 ChatGPT id。
6. **Failover/scheduler/warmup**：遍历和选择 summary 的 storage id；调用已有 OAuth operations 时传 storage id，避免相同真实 ChatGPT id 造成候选折叠。

## UI

详见 [`ui.md`](ui.md)。这是用户可见风险提示，触发 HTML 原型门禁。UI 设计员交付并获得用户确认前，不得实现。

## 兼容性与风险

| 风险 | 缓解 |
| --- | --- |
| 把 storage id 传为 OpenAI header | 类型/命名分层；所有 header builder 输入只取 `credential.accountId`；增加 header 参数测试。 |
| refresh 回写丢失 storage id | refresh save API 必须显式传原 storage id；测试刷新后路径/metadata 不变。 |
| 旧 active metadata 无法解析 | v1 normalizer 把现有 accountId 作为 legacy storage id；不做 list-time rename。 |
| 无 refresh token 在过期时失败 | 明确 warn；保留当前可用路径；在 token unavailable/refresh failed 时使用现有可重登录错误。 |
| 同批导入部分落盘 | 转换/验证前置、写入失败补偿和测试。 |
| 无意泄露 token | summary 和提示只描述风险/数量，绝不展示 token 值。 |

## 回滚

该变更是 additive。发生异常时可回退代码继续读取 legacy v1 文件；新 v2 文件需要回退兼容读取（实施前应保证 reader 接受 metadata version 2 与 opaque filenames），否则不能发布。无需修改 Pi 的 `auth.json` 格式或 JWT。
