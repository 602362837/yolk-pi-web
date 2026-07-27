# Plan Review：GitHub 无人值守 planning 空转完整修复

## 一眼结论

#22 的“running/planning/第 N 次但无 Session”由**两次连续故障 + 两个潜在断链**造成，不是改一个正则就结束：

```text
旧版 empty plan → blocked_uncertain
  → 修复后 retry 回 studio_task_ready
  → 已处理 adoption comment 每轮 idempotent replay 提前 return
  → unattended runner 永远不执行
  → scheduler 把 running park queued，2 秒后再取 lease
  → attempt 暴涨，但 task/session/checkpoint 无进展
```

同时，越过自旋后仍会遇到：

- runner 有 `projectId` 但没有 WorkTree `spaceId`，parent Session bootstrap 会失败；
- 长 Agent lease 无 heartbeat/fencing，存在重复 owner 风险；
- GitHub Agent path 删除共享 `process.env`，可能破坏同进程 publisher credentials；
- UI 没有 Session/Agent/progress/build 事实，只能误用 phase/status/attempt。

## 为什么用户看不到 Session

这是现场真实状态，不是 Sidebar 漏数据：

- policy gate/command replay 都发生在 `implementing` 之前；
- Session bootstrap 代码只在 implementing checkpoint 后运行；
- runner sidecar 的 `sessionId/contextId/sessionFile` 全为 null；
- WorkTree `.ypi/sessions/index.v1.json` 为 `{}`；
- 全局 sessions 也没有对应 WorkTree encoded dir；
- Studio task 仍 `intake`，artifacts 占位，无 member run。

所以当前正确 UI 文案应是：**“策略/调度阻塞 · 尚未启动 Agent · Session 不存在”**，而不是“running / 第 279 次”。

## 关于“模型”误报与运行版本

- 当前及初始版本的 `PLAN_SECRET_HINT_RE` 都不含“模型”；“模型”不是本次 secret/auth 命中原因。
- 初始 09:49 的 `blocked_uncertain` 来自旧代码对 `stage=plan + files=[]` 的 uncertain fallback。
- 10:27 commit `6b00e82` 已修复 empty plan；当前 PID 6140、global/repo `0.8.3`、Next `BUILD_ID=vziMzrCcBQbWku2WiMwNN` bundle 均包含修复。
- 当前 10:38 之后没有新 policy block event，只有 `job_started`；证明现在卡在 command replay → scheduler spin，而不是继续跑旧 gate。
- 产品仍缺少运行 build/policy provenance，因此本方案会把版本/重启闭环加入安全 status projection。

## 完整修复路径

### 1. Policy / Gate

- pre/plan/final 使用不同事实来源。
- `issueTitlePreview` 不再复制成 `planText`；title 仅作带 source 的 advisory hint。
- pre/plan 空 files 显式 deferred；final empty 继续 block。
- final 只信 actual diff + structured small-bugfix/validation evidence，title 不覆盖实际安全 diff。
- “模型”不命中 secret；明确 UI/secret/release scope 仍 fail closed。
- 保留 docs-and-small-bugfix 与 UI HTML/manual approval gate；不硬编码 `uiGate=pass`。

### 2. Runner / Scheduler / Lease

- delivery audit 与 pending command work item 分离；exact comment/version 只消费一次。
- remote_confirmed replay 对 active unattended job 必须 fall through 到 runner continuation。
- handler 每次返回 progressed/waiting/retry_due/blocked/terminal；无进展不能 park queued。
- deterministic block 存 fingerprint，条件未变不重跑；recoverable error 指数退避。
- `attempt` 兼容定义为 scheduler runs；新增 Agent runs/有效进展/无进展次数。
- lease 增 heartbeat、live owner、fencing；singleStep/pause/global pause/concurrency 有明确语义。

### 3. Session / Studio / Env

- WorkTree create/reuse 解析并持久化 `projectId+spaceId`。
- entering implementing 后 parent Session bootstrap 必须成功或进入可见 blocker；不再把失败视为非致命。
- child Session 继承 WorkTree project/space 并写对应本地 index；main space 不显示。
- GitHub unattended SDK full-agent 放到隔离 child host/等价 per-run env，传 scrubbed env 副本；禁止删除共享 Next `process.env`。
- 继续保留 full-agent 非沙箱残余风险、不注入 App/machine secrets、Agent 无 server publisher、不 push/PR、App publisher 不 auto-merge。

### 4. 可观测性 / UI

服务端投影 schedulerState、agentExecutionState、sessionAvailability、blockedAtLayer、checkpoint、retry/backoff、last meaningful progress、Agent/no-progress counts、safe workspace label、runtime/evaluated build+policy provenance。UI：

- Agent 与 scheduler 双层状态；
- 无 Session 明确“尚未启动 Agent”；
- “第 N 次”改为“调度尝试 N”；
- 展开一眼看到卡在 policy/Studio/Session/Agent/validation/publisher 哪层；
- stale 快照禁用 mutation；
- 只复用 retry/pause/resume，不新增“跳过策略”。

### 5. #22 恢复

1. 修复前 per-job pause 止血（必要时 global pause）。
2. 部署完整修复并完整重启，确认新 build/policy provenance。
3. 幂等 reconcile：consume 旧 command、解析 spaceId、保留 legacy attempt、恢复 `studio_task_ready`。
4. operator 单次 retry；复用原 g1 WorkTree/branch/task，不建 g2、不删历史。
5. 只允许有限结果：stable policy/manual block，或 implementing + WorkTree Session + child run。
6. 若真实 scope 是 UI/high-risk，稳定 manual block 是正确结果；不手工跳 gate。

## 交付物

- [Brief / 证据与根因链](brief.md)
- [PRD / R1–R18 与验收](prd.md)
- [UI 方案与状态文案](ui.md)
- [HTML 原型（必须先审批）](github-unattended-job-observability-prototype.html)
- [Design / 状态机、契约、迁移、风险](design.md)
- [Implement / 子任务 DAG 与回滚](implement.md)
- [机器可读 Implementation Plan](implementation-plan.json)
- [Checks / 自动与人工验收](checks.md)
- [Architect Handoff](handoff.md)

## 实现 DAG 摘要

| 顺序 | 子任务 | 依赖 |
| --- | --- | --- |
| 1 | GHA-CLOSE-01 契约冻结 | — |
| 2 | GHA-CLOSE-02 command/scheduler/lease | 01 |
| 2 | GHA-CLOSE-03 Session/space/env | 01（可与 02 并行分析） |
| 3 | GHA-CLOSE-04 safe projection/provenance | 02,03 |
| 4 | GHA-CLOSE-05 legacy/#22 recovery | 04 |
| 5 | GHA-CLOSE-06 Jobs UI | 04,05 + **HTML 用户批准** |
| 6 | GHA-CLOSE-07 跨层回归 | 06 |
| 7 | GHA-CLOSE-08 文档/checker | 07 |

## 当前验证

- `npm run test:github-publish-policy`：**24 passed / 0 failed**。
- `npm run test:github-unattended`：**18 passed / 1 failed**；`permission_missing and installation_missing…` 实际得到 `implementer_error`，已列为实现前必须解决的红灯。
- 只读 status 现场：#22 `planning/queued/attempt=279/studio_task_ready/retry_wake`，pause available，retry unavailable。
- UI 设计员已完成自包含 HTML/JS 语法自检。

## 审批请求（当前不可进入实现）

请用户明确确认两件事：

1. **批准 HTML 原型**：双层状态、“尚未启动 Agent”、调度/Agent/无进展次数拆分、详情密度与窄屏布局。
2. **批准完整方案**：policy + command/state machine + lease + Session/space/env + projection/UI + recovery/tests 一次闭合。

推荐一并确认的产品取舍：

- policy gate 前不创建伪 Session；无 Session 时如实显示尚未启动；
- deterministic policy block 条件/版本未变时不允许盲 retry；
- 本次只显示 Session availability，不新增打开 Session 深链；
- 使用隔离 SDK host，而非临时删除/恢复共享 `process.env`。

**等待用户审批。批准前不得 transition 到 implementing，也不得修改生产代码。**
