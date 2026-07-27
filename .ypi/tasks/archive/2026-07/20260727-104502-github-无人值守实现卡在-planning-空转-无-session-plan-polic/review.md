# Review：GitHub 无人值守 planning 空转闭环（GHA-CLOSE-01…08）

**Checker:** 检查员  
**At:** 2026-07-27  
**Scope:** 全计划 8/8 子任务终验（非局部 subtask）  
**Verdict:** **Pass**（可进入 review / 用户验收；不阻塞回 implementing）

---

## Check Complete

### Findings Fixed

- None（本轮仅审查与复跑验证，未改生产代码）

### Remaining Findings

#### 非阻塞

1. **真实浏览器 390px / 明暗主题手工 smoke 未在本机 UI 跑完**  
   证据：GHA-CLOSE-06/07 报告；以源码 + `GHA-CLOSE-07 Jobs UI source` 契约测试替代。建议 operator 在 Settings Jobs 做一次窄屏目视。

2. **#22 现场恢复仍是 operator 动作**  
   代码与 runbook 已具备；本任务边界不自动 pause/retry 生产 job。部署后需：pause → 完整重启 → `runtimeProvenance` → 单次 retry。

3. **env 隔离实现为 scrubbed env copy + bash `spawnHook`，非独立 SDK host 子进程**  
   满足 PRD R13「隔离子进程**或等价** per-run env」；架构文档已写清「非 OS sandbox」。同用户磁盘 residual risk 仍明示。

4. **runner 部分路径仍主要返回 `wakeAgain`，显式 `disposition` 由 scheduler 保守推导**  
   `applyHandlerDisposition` + no-progress 测试覆盖 #22 自旋根因；非必须返工。

#### 阻塞

- **None**

### Root-cause closure matrix

| 根因 | 实现证据 | 测试证据 |
| --- | --- | --- |
| RC-1 空 plan 误拦 / title≠planText | `github-risk-policy` pre/plan empty → `defer`；runner `planText: null` + `issueTitlePreview` 分离 | publish-policy: empty plan defer、「模型」非 secret、UI title block |
| RC-2 remote_confirmed 截断 runner | `runOwnerIntentIfPresent` active phase → `return null` fall-through + `pendingCommand` consumed | GHA-CLOSE-02 fallthrough；CLOSE-05 pre-schema consume once |
| RC-3 scheduler 无进展自旋 | `applyHandlerDisposition`：无 disposition/无 progress → `retry_due`/`runner_no_progress`，禁止立即 queued | GHA-CLOSE-02 no-progress；CLOSE-07 #22 finite ticks |
| RC-4 spaceId / Session 绑定 | worktree ensure 返回 `spaceId`；bootstrap 成对强制；失败可见 blocker | unattended-runner spaceId/bootstrap pair；CLOSE-07 bootstrap projection |
| RC-5 lease / env | lease heartbeat+fencing；scrubbed copy，不删共享 `process.env` | CLOSE-02 fencing；unattended-runner env preserve |
| RC-6 projection/UI 假 active | dual-layer fields + UI「尚未启动 Agent」「调度尝试」 | CLOSE-04 #22 projection；CLOSE-07 UI 契约；组件文案 |

### 需求 / checks.md 抽样

| 项 | 结论 |
| --- | --- |
| R1–R4 policy stage / empty / 模型 / UI gate | Pass |
| R5 command 一次消费 + continuation | Pass |
| R6–R10 disposition / counts / fingerprint / pause / lease | Pass（scheduler 推导 + 测试） |
| R11–R13 Session / WorkTree / env | Pass |
| R14–R16 safe projection / dual-layer UI / provenance | Pass |
| R17 #22 reconcile runbook 不跳 gate | Pass（docs + CLOSE-05/07） |
| R18 publisher / residual risk / no secrets | Pass |
| UI 原型门禁 | Pass：`approvalGrant` 2026-07-27T03:21:41Z `user-widget` 批准计划包（含 HTML 产物）后才 implementing |
| 规划期 `test:github-unattended` 红灯 | Pass：现 19/19，含 permission/installation block |

### Verification（本轮独立复跑）

| Command | Result |
| --- | --- |
| `npm run test:github-publish-policy` | **28 passed / 0 failed** |
| `npm run test:github-unattended` | **19 passed / 0 failed** |
| `npm run test:github-unattended-runner` | **18 passed / 0 failed** |
| `npm run test:github-automation` | **113 passed / 0 failed** |
| `npm run lint` | **0 errors**（11 pre-existing warnings，无关） |
| `node_modules/.bin/tsc --noEmit` | **pass**（exit 0） |
| `git diff --check` | **pass** |

未本轮重跑（GHA-CLOSE-07 已绿且本轮无相关改动）：`test:project-space-session-index`、`test:studio-sdk-runner`。

### Security invariants

- 无 skip-policy 动作；确定性 block 条件未变 → `retry_conditions_unchanged`
- projection forbidden keys / 无 path/body/secret 路径有测试
- Agent 无 server publisher；不 force/main auto-merge
- full-agent residual risk 文案保留
- 共享 `process.env` 不被 GitHub unattended 路径删除

### Verdict

**Pass** — 根因链、契约、测试、文档与 Jobs 双层文案已闭合；可 transition **checking → review**（或 workflow 规定的用户验收态）。  
不要求回 implementing。  
**未** commit / push / merge。  
本 harness **无** `ypi_studio_task`：请主会话写 review 态并关闭计划。

---

## Handoff to main session

### Artifacts produced

- 更新：`.ypi/tasks/20260727-104502-…/review.md`（本文件）

### Production code changed by checker

- None

### Decisions needed

1. Transition 任务到 **review**（或 completed / user_acceptance，按 feature-dev 流程）。
2. Operator：部署修复版 → **完整重启** `ypi` → 确认 `runtimeProvenance` → 对 #22 **单次** retry（复用 g1）。
3. 可选：Settings Jobs 390px 明暗主题目视一次。
