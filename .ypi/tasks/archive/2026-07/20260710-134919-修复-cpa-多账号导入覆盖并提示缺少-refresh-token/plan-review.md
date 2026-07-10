# 计划审批书

本文件是进入实现前的用户审阅入口。用户已于 2026-07-10 06:00:48 与 06:01:31 在 `events.jsonl` 明确批准计划、UI 原型及进入实现；当前已完成实现并处于检查阶段。

## 相关材料

- 背景与定位：[`brief.md`](brief.md)
- PRD：[`prd.md`](prd.md)
- UI 说明：[`ui.md`](ui.md)
- UI HTML 原型：[`cpa-refresh-token-risk-prototype.html`](cpa-refresh-token-risk-prototype.html)
- 技术设计：[`design.md`](design.md)
- 实施计划：[`implement.md`](implement.md)
- 检查清单：[`checks.md`](checks.md)

## 方案摘要

修复 CPA 多账号因共享真实 ChatGPT account id 而覆盖的问题，同时让无 refresh token 但当前 access token 可用的 CPA 凭据可导入/使用，并清楚提示“过期后无法自动刷新”的风险。

采用双标识：

- `storageId`：独立 opaque 唯一存储 ID，用于文件名、metadata、API 操作、active、配额缓存、暖机和轮换；
- credential 内真实 `accountId`：继续用于 Pi Codex transport 及 OpenAI 请求头/配额请求。

旧账号按旧 ID 兼容读取；无 refresh token 的有效 CPA 转为 `refresh: ""` 并产生结构化非阻断 warning，仍验证 access/expires。完全相同 credential 默认也不覆盖，按独立导入项保存。

## UI 原型

原型位于 [`cpa-refresh-token-risk-prototype.html`](cpa-refresh-token-risk-prototype.html)，覆盖有/无 refresh token 两种状态。无 refresh token 仅提示：当前 access token 有效期间仍可导入和使用，但过期后无法自动刷新；保存按钮保持可用。缺 access token 或 expires 无效仍为阻断错误。

## 审批记录

用户已明确确认：

1. 批准 storageId/真实 ChatGPT id 双标识与旧数据兼容方案。
2. 批准无 refresh token 的非阻断风险提示文案、位置和交互原型。
3. 确认相同真实 ChatGPT id 的多个 CPA 账号均独立保存，完全相同 credential 默认也不覆盖。
4. 批准按 [`implement.md`](implement.md) 进入实现并执行 [`checks.md`](checks.md) 中的验证。

证据：`events.jsonl` 记录两次 `User approved Studio plan`，以及随后“用户明确批准：确认，开始实现”的状态转换。