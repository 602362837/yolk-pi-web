# Handoff：Kiro provider规划

## 已完成

- 验证 `pi-kiro-provider@0.2.2` npm发布物、OAuth凭据 shape、jiti/external要求、metering与错误 metadata。
- 验证 Kiro真实额度数据源：AWS官方 `AmazonCodeWhispererService.GetUsageLimits`；同作者 `pi-multi-auth`已有实现证据。
- 完成 `brief.md`、`prd.md`、`design.md`、`implement.md`、`checks.md`。
- `implement.md`包含8项 schemaVersion 2 DAG机器计划，`maxConcurrency=3`。
- `ui.md`包含 UI设计员可直接执行的 HTML原型契约。
- `plan-review.md`已填充规划摘要，但明确标为“暂不可审批”。

## 关键决策

- Kiro与 Grok统一 jiti动态 provider bootstrap；所有 registry入口必须审计。
- OAuth复用 opaque saved-account store，Kiro token refresh单独实现 CAS。
- quota使用官方 GetUsageLimits，不用 per-turn metering估算。
- Kiro自动切号为独立 Path B；unknown/stale候选 fail-closed。
- 顶部简要模式为全局开关，只压缩 trigger，详细 popover保留。

## 阻塞

当前 delegated architect会话没有 `ypi_studio_subagent`、implementation-plan update或 transition工具，无法：

1. 合法派发 `ui-designer`；
2. 保存 task-level `implementationPlan`；
3. transition到 `awaiting_approval`。

未直接编辑 `task.json`，未伪造 HTML原型或用户审批。主会话需完成上述三步；原型和用户批准前禁止实现。

## 主会话下一步

1. 派发 `ui-designer`，要求读取本任务 `ui.md`、现有 GPT/Grok panel和 Models/Settings源码。
2. 收到 `kiro-provider-usage-compact-prototype.html` 后更新 `ui.md` 与 `plan-review.md`链接。
3. 保存 `implement.md` 中 JSON implementation plan。
4. 向用户请求原型/计划审批，仅 transition到 `awaiting_approval`，不要进入 implementing。
