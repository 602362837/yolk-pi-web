# 修复 CPA 多账号导入覆盖并提示缺少 refresh token

- Task: 20260710-134919-修复-cpa-多账号导入覆盖并提示缺少-refresh-token
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260710-134919-修复-cpa-多账号导入覆盖并提示缺少-refresh-token
- Archived at: 2026-07-10T06:44:10.863Z
- Tags: studio, feature-dev

## Summary
## 已完成 已完成 bugfix 规划与根因定位，未修改生产代码： - [`brief.md`](brief.md)：根因、目标、推荐决策。 - [`prd.md`](prd.md)：范围、验收标准、未决产品选择。 - [`design.md`](design.md)：storageId/真实 ChatGPT id 分层、旧文件兼容、数据流与风险。 - [`ui.md`](ui.md)：UI 设计员派发说明、原型要求与审批门禁。 - [`implement.md`](implement.md)：阅读顺序、DAG 实施计划、验证与回滚。 - [`checks.md`](checks.md)：自动/人工/兼容性检查。 - [`plan-review.md`](plan-review.md)：用户审批入口。 ## 关键结论 当前覆盖根因是同一 `accountId` 被同时当作真实 ChatGPT id 和存储主键/文件名使用。修复应使用独立 opaque storage id 进行保存与 API 操作，保留 credential 的真实 `accountId` 给 Pi/OpenAI 请求及显式 quota/reset header。 CPA 无 `refresh_token` 应转为 `refresh: ""` + 非阻断风险，而非转换失败；仍要求 `access` 与有效 `expires`。 ## 验证 仅进行静态源码/依赖链审查和规划 artifact JSON 格式检查；未运行 lint/typecheck（无生产代码改动）。 ## 阻塞与主会话动作 1. 必须实际派发 `ui-designer`，在任务目录生成 `cpa-refresh-token-risk-prototype.html`，并更新 `ui.md`/`plan-review.md` 链接。 2. 必须由用户审批 HTML 原型、双标识设计及重复 credential 导入策略。 3. 之后主会话保存 `implement.md` 中的 implementation plan，并把任务转为 `a…

## Reusable knowledge
### handoff.md

# handoff

## 已完成

已完成 bugfix 规划与根因定位，未修改生产代码：

- [`brief.md`](brief.md)：根因、目标、推荐决策。
- [`prd.md`](prd.md)：范围、验收标准、未决产品选择。
- [`design.md`](design.md)：storageId/真实 ChatGPT id 分层、旧文件兼容、数据流与风险。
- [`ui.md`](ui.md)：UI 设计员派发说明、原型要求与审批门禁。
- [`implement.md`](implement.md)：阅读顺序、DAG 实施计划、验证与回滚。
- [`checks.md`](checks.md)：自动/人工/兼容性检查。
- [`plan-review.md`](plan-review.md)：用户审批入口。

## 关键结论

当前覆盖根因是同一 `accountId` 被同时当作真实 ChatGPT id 和存储主键/文件名使用。修复应使用独立 opaque storage id 进行保存与 API 操作，保留 credential 的真实 `accountId` 给 Pi/OpenAI 请求及显式 quota/reset header。

CPA 无 `refresh_token` 应转为 `refresh: ""` + 非阻断风险，而非转换失败；仍要求 `access` 与有效 `expires`。

## 验证

仅进行静态源码/依赖链审查和规划 artifact JSON 格式检查；未运行 lint/typecheck（无生产代码改动）。

## 阻塞与主会话动作

1. 必须实际派发 `ui-designer`，在任务目录生成 `cpa-refresh-token-risk-prototype.html`，并更新 `ui.md`/`plan-review.md` 链接。
2. 必须由用户审批 HTML 原型、双标识设计及重复 credential 导入策略。
3. 之后主会话保存 `implement.md` 中的 implementation plan，并把任务转为 `awaiting_approval`；本子会话无 Studio 生命周期/派发工具，未擅自修改 `task.json`。

在这些动作完成前不可进入实现。

### review.md

# review

## 检查结论

代码静态审查、`npm run lint`、`node_modules/.bin/tsc --noEmit` 与 converter smoke test 已通过。

定向 OAuth 测试因当前环境缺少可用 `tsx`/Node loader 无法加载 Pi SDK package exports，未能执行；该问题属于测试环境限制，不代表功能失败。

## 用户人工验收

用户已在真实运行环境人工验证并明确反馈：**没问题**。

人工验收覆盖本任务核心目标：

- 相同真实 ChatGPT account id 的多个 CPA 账号可同时保留，不互相覆盖；
- 缺少 refresh token 的账号可导入并显示风险提示；
- access token 仍可用；
- 无 refresh token 不会被直接阻止；
- 账号相关功能符合预期。

## 最终结论

基于自动静态验证和用户人工验收，任务可以归档。

### checks.md

# checks

## 自动验证

实施后至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

新增/扩展 OAuth account 的定向脚本或测试后也必须运行它；若引入 package script，应记录在 `package.json` 和本文件。不可用真实 token 进行自动测试。

## 行为检查

- [ ] 两条 CPA 凭据使用同一个真实 ChatGPT id、不同 access/refresh：定向 storage 测试已编写但当前环境无法执行；需补跑。
- [x] 每条新 summary 的 `accountId` 是稳定保存账号 id；代码审查确认列表行、API、quota/warmup/failover 均沿用该 id。
- [ ] 实际 stored credential 保留真实 `accountId`；定向 quota 测试已编写但当前环境无法执行，header/cache 另有静态审查证据。
- [x] Pi Codex 请求仍从 access JWT 提取真实 `chatgpt_account_id`；本次未修改 Pi transport，显式 quota/reset/label header 均不使用 storage id。
- [ ] 旧 version 1 metadata + `<legacy-id>.json` 的读取和原路径写回由定向 storage 测试覆盖；测试当前无法执行，其余 route/warmup/failover 为静态调用链审查。
- [x] token refresh 回写显式携带 credential 上的非枚举 storage id；原路径、metadata id 和 cache key 不因 refresh 改变（静态审查，未用真实 token 运行）。
- [x] auto failover、warmup、usage scheduler 使用 summary `accountId` 遍历；相同真实 id 不会折叠候选（静态审查，未实际调度）。
- [ ] CPA 缺 refresh/refresh 为空但 access + 可解析 expires 完整：converter smoke 已通过，但完整转换/保存测试当前无法执行；当前 access 有效时不被本层阻止（静态审查）。
- [x] 无 refresh token 的过期 saved/active credential 现在返回“重新导入或登录”导向的错误；未使用真实 token 验证。
- [ ] CPA 缺 access 或 expires 仍阻断；无效批次测试已编写但当前无法执行，需补跑。
- [x] 路由仍使用 `accountId` 请求字段和原 provider 限制；summary/warning 不含 token（静态审查）。

## UI 门禁与人工验收

- [x] ui-designer 已交付 `cpa-refresh-token-risk-prototype.html`，并链接于 `ui.md` / `plan-review.md`。
- [x] 用户已明确批准 HTML 原型和计划；`events.jsonl` 记录 2026-07-10 06:00:48/06:01:31 的批准及 06:01:37 的进入实现。
- [x] warning 使用非错误样式并在转换成功后可见；保存按钮保持可用。
- [x] error 与 warning 可区分，`role`/`aria-live` 已加入；布局使用响应式网格并保留可读文案（未运行浏览器手工验证）。
- [x] 多账号提示没有显示 access/refresh token，且 modal 的 cancel/close/submitting 防护未被代码改动移除。

## 回归重点

- 登录添加账号 (`accountMode=add`) 与普通登录同步 active auth：静态审查通过，未执行真实 OAuth。
- `/api/auth/accounts/[provider]` GET/POST/PATCH/DELETE 与 `/activat

### design.md

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
  -> quota/reset/label headers use credential.acc

### implement.md

# implement

## 前置门禁

1. 主会话派发 UI 设计员并取得 `cpa-refresh-token-risk-prototype.html`。
2. 用户明确批准 HTML 原型、本文计划以及“完全相同 credential 的重复导入策略”。
3. 仅在审批 grant 后进入 implementing；实现员不得自行绕过。

## 先阅读

- `AGENTS.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/standards/code-style.md`
- `lib/oauth-account-converters.ts`、`lib/oauth-accounts.ts`、`lib/subscription-quota.ts`
- `lib/openai-codex-warmup.ts`、`lib/chatgpt-account-failover.ts`、`lib/chatgpt-usage-refresh-scheduler.ts`
- `app/api/auth/accounts/[provider]/route.ts`、`app/api/auth/accounts/[provider]/activate/route.ts`、`app/api/auth/login/[provider]/route.ts`
- `components/ModelsConfig.tsx` 和批准后的 HTML 原型

## 执行顺序

| # | 子任务 | 依赖 | 主要文件 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | UI 原型与用户审批 | — | `ui.md`, `cpa-refresh-token-risk-prototype.html`, `plan-review.md` | 门禁解除，不改生产代码。 |
| 2 | 定义 OAuth storage/real-account 双标识和旧数据 reader | 1 | `lib/oauth-accounts.ts` | 新 opaque id、v1/v2 compatible lookup、刷新同路径回写。 |
| 3 | 修正 CPA 转换、批量验证和无 refresh risk contract | 2 | `lib/oauth-account-converters.ts`, `lib/oauth-accounts.ts` | 多 CPA 不覆盖，缺 refresh 非阻断、无半批写。 |
| 4 | 贯通 operation consumers | 2 | `lib/subscription-quota.ts`, warmup/failover/scheduler, auth routes | lookup/storage cache 使用 storage id，OpenAI header 使用真实 id。 |
| 5 | 依原型实施 UI 提示 | 1,3 | `components/ModelsConfig.tsx` | warning、错误、multi-import feedback/a11y。 |
| 6 | 测试、文档、完整回归 | 2,3,4,5 | targeted test + docs | 有证据覆盖兼容/风险路径。 |

## Implementation Plan

```ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "CPA multi-account storage identity and refresh-token warning",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "ui-prototype-approval",
      "title": "UI designer HTML prototype and user approval",
      "phase": "planning",
      "or

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
