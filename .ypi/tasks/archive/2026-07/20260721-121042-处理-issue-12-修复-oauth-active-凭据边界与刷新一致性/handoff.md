# Handoff：Issue #12 架构设计阶段

## 已完成

- 阅读 Issue #12 全部评论、当前 main、PR #13实现与测试、已关闭PR #14 diff（仅作意图对照）。
- 阅读 `AGENTS.md`、architecture/API/library/integration/style docs及全部相关OAuth routes/callers。
- 产出：
  - `brief.md`
  - `prd.md`
  - `ui.md`
  - `design.md`
  - `implement.md`
  - `implementation-plan.json`
  - `checks.md`
  - `plan-review.md`
- 未修改生产代码；未commit/push/merge。

## 关键决策

- 当前 main `3b8285c` / PR #13 `88d9756`为不可回退基线。
- 不复用PR #14旧分支；只参考四个显式API命名。
- list对所有provider变为zero-write/zero-network、metadata-first投影。
- bootstrap只兼容legacy auth-only；adopt只用于成功login/canonical refresh；clear在provider lock内包裹runtime logout。
- Grok mirror repair只增量复用PR #13 transaction，在valid-token路径做slot→mirror收敛，不再次refresh。
- UI gate不适用，无HTML原型。

## 验证

- 规划JSON可解析，schemaVersion=2，6个稳定子任务，DAG依赖有效，`maxConcurrency=2`。
- `implement.md`机器计划块与`implementation-plan.json`一致。
- 对未跟踪规划文件逐一执行 `git diff --no-index --check`，空白检查通过。
- 未运行lint/tsc/生产测试：本阶段无生产代码改动，且当前工作树没有`node_modules`。

## 主会话下一步

1. 通过Studio正式保存`implementation-plan.json`为task implementationPlan。
2. 将任务从`intake`切到`awaiting_approval`。
3. 向用户展示`plan-review.md`并等待明确批准。
4. 批准前不要实现；批准后按OAUTH-01开始。

## 剩余风险

- cross-file提交不是数据库事务；实现必须保持错误不虚报和可重试。
- list移除remote label backfill后，遗留未持久化label可能使用masked fallback。
- 实现员最容易误用adopt或整体覆盖PR #13 Grok resolver；OAUTH-01/OAUTH-03设为强local review。

## 需要主会话决策

仅需批准/要求修改本计划；无额外产品问题阻塞。
