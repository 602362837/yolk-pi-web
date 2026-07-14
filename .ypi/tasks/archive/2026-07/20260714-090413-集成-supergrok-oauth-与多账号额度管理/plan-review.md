# 计划审批书：集成 SuperGrok OAuth 与多账号额度管理

## 当前结论

已完成架构调查、额度接口核验和 HTML UI 原型；本次仅提交计划与原型审批，**尚未修改生产代码**。

## 方案摘要

1. 固定集成 `pi-grok-cli@0.4.1`，统一注入 provider bootstrap，使主 Chat、Studio child、Models API 和 Auth API 都能发现 `grok-cli`。
2. 将 OAuth saved-account 存储抽象为 provider adapter；Grok 账号使用 opaque storage id、独立 secret 文件、0600/0700 权限和 active credential mirror。
3. 新会话绑定当前 active Grok 账号；已有会话、恢复、fork 和 Studio child 保持原账号，避免切换账号造成并发串号。
4. 接入 Grok `/billing`：读取 monthly used/limit/remaining/reset，以及可选 weekly usage/reset；采用 60 秒 fresh、24 小时 stale、single-flight、超时和一次 refresh retry。
5. 在现有 Models 设置中加入 Browser OAuth、Device Code、账号管理、额度卡、刷新/失效/错误状态和删除保护；完整遵循 HTML 原型。
6. 增加隔离测试、安全脱敏测试和文档，最后由 checker 审查。

## 额度能力与边界

`pi-grok-cli` 当前实现使用 OAuth Bearer Token 请求 `/billing` 和 `/billing?format=credits`。月度字段包括 `monthlyLimit`、`used`、`billingPeriodEnd`；周额度可能缺失。该接口属于非公开 CLI 后端，字段可能变化，因此 Web 侧严格解析、缓存并在失败时保留 stale 数据或显示不可用，不让额度失败阻断聊天。Grok OAuth 不提供 OpenAI Codex 的 reset-credit 消费能力，本任务不实现额度充值/重置。

## 产品决策待审批

- Active 账号只作为新会话默认；已有会话固定原账号。
- v1 接受 `pi-grok-cli` 完整扩展能力（Cursor tools、Vision、Imagine 等），而不是仅 provider 子模块。
- v1 仅支持 OAuth 登录新增账号，暂不支持原始 OAuth JSON 导入。
- 额度缓存采用 fresh 60 秒、stale 最长 24 小时。

## 审批材料

- [PRD / 需求范围](./prd.md)
- [Design / 架构设计](./design.md)
- [Implement / 实现计划](./implement.md)
- [Checks / 检查与验收](./checks.md)
- [UI / 原型说明](./ui.md)
- [HTML UI 原型](./supergrok-oauth-accounts-prototype.html)

## 实施门禁

用户批准本计划与 HTML 原型后，才进入 implementing；随后按 7 个 DAG 子任务执行，先完成 provider bootstrap，再完成账号核心、session pin/quota、UI、测试和文档验收。