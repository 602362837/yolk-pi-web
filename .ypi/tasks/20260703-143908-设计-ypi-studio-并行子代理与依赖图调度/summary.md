# summary

已完成 YPI Studio 并行 subagent、DAG 子任务依赖调度、异步子代理生命周期与 UI 全量可见能力。

## 主要实现

- `implementationPlan.subtasks[].dependsOn` 作为 DAG 调度真源，支持 schemaVersion 2 校验、ready batch、maxConcurrency、failed/blocked 传播、legacy pending 兼容。
- `ypi_studio_task` 扩展批量 next/claim/update 字段；所有 implementation mutation 继续受 `implementing`/approval gate 保护。
- 修复 approvalGrant 绑定兜底：已绑定 context 的 awaiting_approval task 可在用户明确确认后记录 grant。
- `ypi_studio_subagent` 保持默认同步兼容，新增显式 async start/poll/collect/cancel；runId、transcript、subtask 状态持久化，支持 runtime_lost 降级。
- Studio Panel/Widget/Chat 展示 running/queued/waiting/done/failed/blocked 状态与等待/阻塞原因；display/truncation 不作为失败依据。
- 新增 run GET/cancel API 与 DAG 测试脚本。

## Post-review fixes

Checker 首轮发现两个 blocking：同步子代理可绕过 implementing gate、runtime_lost 只在 collect 收敛。已修复并复审通过：

- 同步 implementation subtask start 必须在 `implementing` 状态且 subtask 已 queued/running；持久化层也增加 mutation gate。
- `runtime_lost` reconcile 共享到 poll、collect 和 subagent run GET。
- 同时修复 attempts 双计数与 ready 重置残留 metadata。

## Validation

最终验证通过：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
npm run test:studio-dag
```

## Remaining risk

浏览器/真实 UI 手工 rollout 未在本轮环境中执行；已在 `docs/operations/troubleshooting.md` 补充手工检查与回滚说明。
