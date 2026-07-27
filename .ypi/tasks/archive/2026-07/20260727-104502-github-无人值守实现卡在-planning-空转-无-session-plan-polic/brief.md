# Brief：GitHub 无人值守 planning 空转闭环修复

## 结论

#22 不是单点正则问题，而是四段缺陷串联：

1. **旧版本 plan gate 把“尚无 diff”判为 `blocked_uncertain`**，在 Agent 创建前阻断。
2. 修复版把 blocked job 回滚到 `studio_task_ready` 后，**已处理的 Owner adoption delivery 被每轮重复读取**；`owner_command` 的 idempotent replay 提前返回，真正的 unattended runner 永远没有机会继续。
3. scheduler 把该返回值重新停成 `queued`，约 2 秒后再次取 lease；`attempt` 每次 lease 都加一，所以 queued/running 抖动并从 8 涨到 279+，但 checkpoint、task、session 均无进展。
4. 即使越过上述阻塞，当前 Session 链仍有潜在硬故障：runner 只持久化 `projectId`，没有 WorkTree `spaceId`，却调用要求二者同时存在的 `createConfiguredEmptyAgentSession()`；bootstrap 会失败，child session 也无法继承 WorkTree space/index。

因此必须同时修复 policy、command consumption、scheduler/lease、Session/space、safe projection/UI、恢复与回归，不能只改一个正则或手工改 job JSON。

## 已交叉验证的现场证据

| 证据 | 现场值 | 结论 |
| --- | --- | --- |
| Job | `phase=planning`、`status=queued/running`、`checkpoint=studio_task_ready`、`reasonCode=retry_wake`、attempt 从 8 增至 279+ | scheduler 在重复取 lease，不代表 Agent 执行 |
| Runner sidecar | `taskId=20260727-094902-…`；`sessionId/contextId/sessionFile=null` | Agent/parent Session 从未启动 |
| Events | 09:49 `unattended_studio_task_ready` 后立即 `unattended_plan_policy_blocked/blocked_uncertain`；10:38 后只有大量 `job_started`，无 `unattended_implementing` | 初始 policy block 与后续 scheduler spin 是两个连续根因 |
| Studio task | `status=intake`，artifacts 仍为占位；无 subagent run | 未进入真正 planning artifact/implementing |
| WorkTree session index | `sessions={}` | WorkTree space 没有任何可见 Session |
| 全局 Session | 无对应 WorkTree encoded dir | 不只是 Sidebar index 漏列，而是确实未创建 |
| 运行版本 | 当前进程 PID 6140 于 10:37 启动；global package/repo 均 `0.8.3`，Next `BUILD_ID=vziMzrCcBQbWku2WiMwNN`；bundle 含 empty-plan 修复 | 当前 spin 不是仍在执行旧 empty-plan 代码，而是 command replay 截断 continuation |
| 初始阻塞版本 | 事件 owner PID 89892；`6b00e82` 在 10:27 才修复 empty plan | 初始 block 确实由旧运行代码造成；需要在产品中暴露 build/policy provenance |
| 当前 risk regex | `PLAN_SECRET_HINT_RE` 只含 secret/token/oauth/API key/private key/凭据/密钥，不含“模型” | “模型”误命中 secret 的嫌疑被源码否定；真正初因是 plan empty-diff |
| Handler 源码 | `runOwnerIntentIfPresent()` 对已 `remote_confirmed` command 返回当前 `running` job；runner continuation 位于其后 | 每轮都被 idempotent replay 提前截断 |
| Scheduler 源码 | 每次 lease 先 `attempt+1`；handler 后仍 running 则 park queued；finally 总会安排下一 tick | queued → running → queued 自旋闭环 |
| Session bootstrap 源码 | `projectId` 与 `spaceId` 必须成对；runner 只传 `projectId` | 越过当前 spin 后仍可能没有 parent Session |
| Lease 源码 | dir lease 60 秒即视为 stale，无 heartbeat/live-PID/fencing；job stale-running 5 分钟 | 长 full-agent run 存在重复执行/竞态风险，需一并闭合 |
| Env scrub 源码 | GitHub session/member path 会从共享 `process.env` 删除 secret env | 会影响同进程 publisher/effective credentials；需改成隔离子进程或等价 per-run env，不能全局删除 |

## 用户价值

- 用户能明确知道：scheduler 是否只是在调度、policy 是否阻塞、Agent 是否真实创建 Session、最近是否有有效进展。
- WorkTree 的 Session 只归属对应 WorkTree space，不落到 main，也不会“全局有但这里看不到”。
- block/retry 有稳定语义与退避；不会用持续增长的数字制造“系统正在工作”的错觉。
- operator 可以安全恢复 #22，保留原 generation、WorkTree、branch、task 与审计，不跳过 policy、不删历史。

## 立即止血（不等于修复）

1. **先对 #22 执行 per-job pause**；若 action race 导致无法稳定暂停，再使用 Settings 的 global `paused=true`。
2. 不再反复 retry，不手工把 checkpoint 改成 implementing，不删除 job/events/task/worktree。
3. 部署完整修复并**完整重启** `ypi`，确认运行 build/policy provenance 已更新。
4. 运行幂等 reconcile，随后 operator 单次 retry；复用 g1 WorkTree/branch/task。
5. 若修复后的明确 scope/UI gate 仍判定为 UI/高风险，正确结果应是稳定 manual block，而不是强行启动或发布。

## 边界

- 保留 `executionProfile=full-agent` 与非沙箱 residual risk；仍建议低权限 OS 用户/容器。
- App/machine secrets 不主动注入 Agent；不能以“最终 diff gate”声称撤销过往 host side effects。
- Agent 不拥有 server publisher，不 push/开 PR；仍由 App publisher 开同仓 PR，绝不 auto-merge/main direct push。
- Issue/comment 自由文本不能改变 branch、remote、validation、policy、credentials 或 global pause。
- 本任务只产出规划与 UI 原型；未修改生产代码，未 commit/push/merge。
