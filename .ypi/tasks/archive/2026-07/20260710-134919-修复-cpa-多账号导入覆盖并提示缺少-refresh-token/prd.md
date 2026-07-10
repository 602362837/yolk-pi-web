# PRD

## 目标与用户价值

让 ChatGPT Plus/Pro 用户可以安全导入多个 CPA OAuth 账号：同一真实 ChatGPT account id 不再导致已有凭据被覆盖；无 refresh token 的短期 access token 仍可立即保存和使用，并被准确告知后续刷新风险。

## 范围内

- CPA（并应保持 raw/SUB2API 共用保存链路）的多账号转换与导入。
- OpenAI Codex OAuth 保存模型的存储标识与真实 ChatGPT 标识解耦。
- 所有以保存账号定位的 API/UI 操作：列表、备注、详情、删除、激活、额度、重置、暖机、调度和自动轮换。
- 旧 OAuth account 文件和 `accounts.json` 的兼容读取/渐进归一化。
- Add Account JSON 对话框中 CPA 无 refresh token 的非阻断风险提示。
- 覆盖上述行为的定向测试及模块文档。

## 范围外

- 不修改 OpenAI access JWT、Pi SDK 的 Codex transport 或 OpenAI 请求协议。
- 不伪造/猜测 access token 的过期时间；仍要求可解析的 `expires`。
- 不把无 refresh token 账号自动禁用、删除或阻止激活。
- 不新增自动重新登录、token 探测或批量刷新策略。

## 需求与验收标准

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 存储标识独立 | 导入两条有相同 `chatgpt_account_id` 的 CPA 凭据，列表有两行、磁盘有两份凭据，任一凭据不被另一条覆盖。 |
| R2 | 保留真实账号标识 | 每份新凭据仍保存原始真实 ChatGPT id；配额、重置、label backfill 等显式 HTTP 请求的 `ChatGPT-Account-Id` 使用该值，不使用 storage id。 |
| R3 | 存量兼容 | 旧 `<accountId>.json` 和 version 1 metadata 可列出、激活、编辑、删除、查询额度、暖机和参与轮换，无人工迁移要求。 |
| R4 | API 兼容 | 现有路由路径与请求字段 `accountId` 不变；列表返回的 `accountId` 成为该条保存账号的稳定可操作 id。对旧条目继续接受旧 id。 |
| R5 | 刷新稳定 | token 刷新回写到同一 storage id，不因 refresh 后的 credential 或真实 ChatGPT id 变化创建/覆盖另一账号。 |
| R6 | 无 refresh CPA | CPA 缺少/为空 `refresh_token` 时，只要 `access_token` 和有效 `expires` 存在即可转换、验证、保存、激活和在 access 有效期内使用。 |
| R7 | 风险可见 | CPA 转换结果/保存前明确显示：无 refresh token，access 过期后无法自动刷新，需要重新导入或登录；该信息不是错误、不会禁用“保存账号”。 |
| R8 | 不泄密 | UI、API summary、错误、日志和风险提示都不回显 access/refresh token；仍采用现有 0700/0600 文件权限。 |

## 未决问题

1. 完全相同 credential 的重复导入要创建独立保存项，还是使用 fingerprint 幂等更新？推荐仅按“相同 storageId”更新；普通导入一律新增，以优先保证不覆盖。
2. 是否需要在列表显示“不可自动刷新”badge，还是仅在导入对话框显示风险？本计划的最低范围为导入对话框；HTML 原型将请求审批是否扩展为列表 badge。
