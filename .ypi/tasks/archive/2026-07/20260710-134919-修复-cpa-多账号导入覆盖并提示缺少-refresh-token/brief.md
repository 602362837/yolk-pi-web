# brief

## 问题

`lib/oauth-accounts.ts` 目前把 OAuth 账号的业务 `accountId` 同时用于凭据文件名、metadata 主键、API 操作参数、活跃账号和配额缓存键。CPA 转换又把 `account_id` / `chatgpt_account_id` 写入该字段。因此多个 CPA 凭据具有相同真实 ChatGPT account id 时，后导入的凭据会写入同一 `<accountId>.json`，覆盖前一个账号。

同时，`convertCpaCredentialToRaw()` 把缺少 `refresh_token` 作为转换失败；这阻止了已有可用 `access_token`、但无法在过期后刷新的一次性凭据导入。

## 已确认目标

1. 多条 CPA 凭据即使共享真实 `chatgpt_account_id` 也必须各自保存，不能相互覆盖。
2. OpenAI/Codex 请求和配额请求仍使用真实 ChatGPT account id；稳定存储 id 不得替代请求头值。
3. OAuth 账号文件、现有路由参数、激活、配额/重置、刷新、暖机和自动轮换必须保持可用，并兼容旧存储。
4. CPA 缺少 `refresh_token` 时可导入；UI 必须明确提示其只能在当前 access token 有效期间使用，过期后不能自动刷新，且不得把风险提示变成导入/使用阻断。

## 证据与根因

- `lib/oauth-account-converters.ts`：CPA 的 `account_id` 被写到 raw OAuth 的 `accountId`；该转换要求非空 `refresh_token`。
- `lib/oauth-accounts.ts`：`credentialPath()`、metadata 的 `accountId`、`activeAccountId` 与所有 CRUD/缓存操作都以同一个 `accountId` 定位数据，导入循环调用 `saveOAuthAccountCredential()`，故同 ID 覆写。
- `lib/subscription-quota.ts`：配额与重置请求把传入 `accountId` 写为 `ChatGPT-Account-Id`；解耦后必须改为凭据内的真实 ChatGPT id。
- 已安装 pi-ai 的 Codex transport 从 access JWT 的 `chatgpt_account_id` 生成实际 `chatgpt-account-id` 请求头；本修复不得用存储 id 改写 JWT/凭据语义。

## 建议决策（待审批）

采用 **opaque `storageId`** 作为保存、API 操作、active 标记、缓存、轮换和 UI row key；在凭据中保留 `accountId` 作为真实 ChatGPT account id（旧字段名不迁移，以维持 Pi OAuth 兼容）。新导入每个逻辑账号生成不可预测且稳定的 storage id；旧文件按原 accountId 作为 legacy storage id 读取，并在首次写入 metadata 时兼容归一化。

未决：相同 token 对的重复导入是应新建副本，还是按 token fingerprint 幂等更新。推荐首版按“每个 CPA 项均保留”为准，不因共享 ChatGPT id 合并；是否对完全相同的 credential 做幂等去重需用户确认。
