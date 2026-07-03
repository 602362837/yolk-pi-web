# review

## Check Complete

### Findings Fixed

1. 同步 `ypi_studio_subagent` 启动现在也走 implementation 门禁。
   - `lib/ypi-studio-extension.ts` 在 sync/async 共用入口先校验 `taskDetail.status === "implementing"`；sync 模式要求 subtask 已是 `queued/running`，不会再从 `ready` 或非 implementing 状态直接写 `running`。
   - `lib/ypi-studio-tasks.ts` 的 `recordYpiStudioSubagentRun(...)` 也补了 `assertTaskStatusForImplementationMutation(...)`，对 implementation subtask 持久化再次兜底。

2. `runtime_lost` 现在会在 poll/collect 和 run GET 路径统一收敛。
   - `lib/ypi-studio-extension.ts` 的 `poll`/`collect` 都先调用 `reconcileYpiStudioRuntimeLostSubagentRun(...)`。
   - `app/api/studio/tasks/[taskKey]/subagents/[runId]/route.ts` 的 GET 也会先 reconcile，再返回更新后的 task/run 投影。

3. 两个上一轮非阻塞问题已合理处理。
   - `attempts`：`recordYpiStudioSubagentRun(...running...)` 仅在从非 running 且未记录该 runId 的情况下递增，避免 async 首次启动双加。
   - reset-to-`ready`：`updateYpiStudioImplementationSubtask(...)` 会清理 `blockedBy`、`blockedReason`、`terminationReason`、`currentRunId`、`queuedAt`、`claimedAt`、`claimedByContextId` 等陈旧元数据。

### Remaining Findings

- None.

### Verification

- `npm run lint` — Pass
- `node_modules/.bin/tsc --noEmit` — Pass
- `npm run test:studio-policy` — Pass
- `npm run test:studio-dag` — Pass
- Targeted source inspection — Pass

### Verdict

- Pass — 本轮复审关注的两个 blocking finding 均已修复，相关非阻塞清理也已到位；自动验证通过。剩余仅是计划内的手工 UI/rollout 验收，不阻塞本任务收口。
