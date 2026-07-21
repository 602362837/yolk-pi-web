# 计划审批书：修复 Grok Active 刷新后的凭据回退

## 审批摘要

本任务当前只完成 Issue #12 的需求、设计、实施和检查规划，**未修改生产代码**。

已确认根因：Active Grok 账号刷新先把新 credential `C1` 写入 saved-account；随后 `listOAuthAccounts()` 隐式读取仍为 `C0` 的 `auth.json` 并把它写回同一 slot；最后才把 `auth.json` 更新为 `C1`。成功调用后可能出现 `slot=C0 / auth=C1`，下一次刷新重新使用已失效的一次性 refresh token。

## 推荐方案

1. 将 Grok managed slot 定义为凭据真相，`auth.json["grok-cli"]` 只作为当前 Active 的派生镜像。
2. 提供无 secret 写副作用的 Active metadata helper；Grok resolver 不再通过账号列表判断 Active。
3. 普通 `listOAuthAccounts()` 取消无条件 `auth.json -> existing slot` secret 回写；legacy auth-only bootstrap、成功 login 和 canonical runtime refresh 改为显式接纳路径。
4. Refresh、Activate、reauth 和显式 Grok Active 接纳共享 provider lock；已持锁路径使用内部无锁投影，避免非重入死锁。
5. Active refresh 先原子保存不可丢的轮换 credential，再复核 Active 并写 mirror；mirror 写失败不回滚旧 token、不返回成功，后续 resolver 用新 credential 重试收敛。
6. 用真实生产路径 fixture 覆盖轮换 refresh token、refresh+list barrier、refresh+Activate、non-Active、single-flight 和部分失败恢复。

## 关键验收

- Active `C0 -> C1` 成功后 slot 和 `auth.json` 均为 `C1`。
- 第二次刷新提交 `C1.refresh`，绝不再次提交一次性 `C0.refresh`。
- 与列表读取并发时，列表不能把旧 mirror 写回 slot。
- 与 Activate B 并发后，B 保持 Active/mirror，A 保留刷新后的 credential。
- Active mirror 失败时保留 C1、返回安全错误，并能在后续 resolver 调用收敛。
- legacy bootstrap/login/logout、API wire、metadata schema、opaque id、Kiro/Antigravity/OpenAI 基础流程不回归。
- 聚焦测试、OAuth/Grok/Kiro/Antigravity 回归、lint、typecheck 通过。

## UI 门禁

本任务无页面、前端功能、交互、确认体验、文案或用户可见信息结构变化，**不触发 HTML 原型门禁**。若范围扩展到任何可见恢复/冲突提示，必须先补 UI 设计员 HTML 原型和用户审批。

## 实施计划

按单并发顺序执行四项：

1. `AUTH-01`：拆分 list、Active metadata 读取与显式凭据接纳；
2. `GROK-01`：实现锁内 refresh/mirror 提交与失败收敛；
3. `TEST-01`：增加生产路径轮换 token 与并发回归；
4. `DOC-01`：更新文档并完成质量门禁。

机器可读 `schemaVersion: 2` 计划见 [Implement](implement.md)。

## 审批决策

请确认以下技术决策：

- 接受 saved-account 为 Grok credential 真相、`auth.json` 为单向 Active 镜像（推荐）。
- 接受普通 list 不再隐式回写 secret，bootstrap/login/runtime refresh 使用显式接纳（推荐）。
- 接受 Active mirror 失败时优先保留轮换后的新 credential、返回安全错误并在后续调用收敛，而不是回滚旧 refresh token（推荐）。
- 接受本 Issue 不提供历史失效 token 的自动修复；受影响账号可能仍需重新登录一次。

## 相关产物

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 门禁判断](ui.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
- [Handoff](handoff.md)

主会话应先保存 `implementationPlan`，再将任务切到 `awaiting_approval` 并等待用户明确批准；批准前不得实现生产代码。
