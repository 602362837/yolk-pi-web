# 计划审批书 — GitHub 自动化 retry 空跑修复

> **审批目标：**批准规划后再实现；本任务必须最终由 30142 真实生产形态验收。用户明确批准前不得进入 implementing。

## 结论摘要

生产 #22 并非“测试遗漏一个断言”，而是两条真实断链叠加：

1. Settings retry/resume 只 wake scheduler，重启后没有 webhook 时可能未注册完整 triage/unattended handler；planning job 落入 default handler，成为 `runner_no_progress`。
2. 真正进入 Session bootstrap 后，raw SDK/jiti/fs error 先被折叠为 `Internal GitHub automation error`，再从 generic 文案判断 transient；已知失败又没有显式 disposition，因此可能继续被 scheduler 覆盖。

推荐修复：scheduler registry/readiness 单一权威 + typed bootstrap error + known-outcome explicit disposition + 30142 单次真实 retry。

## 用户硬约束（本计划全部接受）

- 这不是“测试绿了就算修好”；生产 #22 已在 `studio_task_ready / runner_no_progress / attempt≈900 / Session 不存在` 多次证明旧口径无效。
- 最终验收必须在 **http://localhost:30142**，使用真实 #22 或同形态生产 job。
- 禁止只靠 `npm run test:github-automation` / fixture 结案。
- Issue #22 的业务功能不在本任务实现范围；只修自动化闭环/可观测性/retry。
- 失败、无 Session、provenance 不匹配时不得宣称修复。

## 现场与代码证据

- 真实 job：`job_1278854433_22_g1_01a6cdde`，generation 1，attempt 900。
- g1 WorkTree/branch/task/space仍保留，Session null。
- 标准 retry 事件出现 `retry_wake → job_started → job_no_progress_backoff`，没有完整 handler 事件。
- 后续诊断路径出现 `unattended_implementing → unattended_session_bootstrap_failed`，但 meta 仅为 `Internal GitHub automation error`。
- 源码确认 handler ensure 只在 webhook accept；Settings action 直接 scheduler wake。

详见 [brief.md](brief.md)。

## PRD 摘要

| 目标 | 验收 |
| --- | --- |
| handler 单一权威入口 | webhook/action/ensure/tick 全覆盖；cold retry无需webhook |
| handler失败可见 | `handler_not_ready`；无lease attempt；无runner_no_progress |
| bootstrap失败可见 | typed stage/code/retryability；safe event；reason不被覆盖 |
| attempt语义保持 | scheduler lease runs不变；Agent/meaningful独立 |
| #22同generation恢复 | g1/WT/branch/task/history保留；不跳policy |
| 30142真实证明 | 一次retry后Session created；失败即不通过 |

完整需求与 R1–R11： [prd.md](prd.md)。

## Design 摘要

### Handler readiness

- scheduler registry 记录 handler kind/generation，不再信任 runtime 私有布尔值。
- process-global single-flight 动态加载/注册/verify完整 handler。
- tick 自身做最终 readiness gate；未来 server boot 也只能调用同一入口。
- handler未就绪时不取得业务lease、不增加attempt，输出 `handler_not_ready` safe event/status。
- default handler只保留隔离测试；不能静默处理生产 planning job。

### Bootstrap observability

- 在 sanitize 前按 typed error/Node code/stage 分类。
- 主 reason 保持 `session_bootstrap_failed|transient`；safe event meta 给 allowlisted `bootstrapCode/stage/retryable/fixed message`。
- `MODULE_NOT_FOUND` 不泄漏模块名/路径。
- known failure 显式返回 `blocked|retry_due` disposition，scheduler不得折叠成 no-progress。
- 成功新增 safe Session-created 证据并推进独立计数。

完整边界、数据流、兼容与回滚： [design.md](design.md)。

## UI 门禁

**不触发 UI HTML 原型门禁。** 不改组件、布局、交互、确认流程、wire状态结构或文案；复用现有 Jobs 卡的：

- Session 失败/不存在
- blocked layer：Session启动/调度
- stable reason
- 调度尝试 / Agent启动 / meaningful progress

若实现发现必须新增用户可见状态结构或文案，必须停止并补派 UI 设计员，不能顺手扩大范围。详见 [ui.md](ui.md)。

## Implementation Plan 一览

| ID | 标题 | dependsOn | 并行 |
| --- | --- | --- | --- |
| GHR-01 | handler registry/readiness + 全入口闭环 | — | 可与 GHR-02 并行 |
| GHR-02 | typed bootstrap error + explicit disposition + success event | — | 可与 GHR-01 并行 |
| GHR-03 | action/scheduler/bootstrap fault-injection tests | 01,02 | 否 |
| GHR-04 | 30142 验收脚本/证据模板（不执行生产 retry） | 01,02 | 可与 03 并行 |
| GHR-05 | 文档、lint/tsc/focused regression、checker | 03,04 | 否 |
| GHR-06 | **30142 真实 #22 pause→单次retry 验收** | 05 | 独立最终门禁 |

`maxConcurrency=2`。机器可读计划见 [implement.md](implement.md)。

## 30142 最终门禁摘要

1. `npm run build`（禁止直接 `next build`）。
2. 先 pause job；隔离所有共享 agent-dir 的旧 ypi scheduler。
3. `node bin/pi-web.js --port 30142 --no-open`。
4. 用 health/status 核对 PID + runtimeProvenance；不得通过 301/302 redirect 假冒 30142。
5. 记录真实 #22 baseline。
6. 对 30142 **只 POST 一次 retry**。
7. 期望：

```text
unattended_retry_wake
→ job_started
→ unattended_implementing
→ unattended_session_created
```

8. 用 status API、single-job API、safe events、runner sidecar、Session header交叉核对。
9. 必须 Session active/ended、agentRuns≥1、g1/WT/branch/task/history不变。
10. 成功证据齐全后立即 per-job pause，避免继续实现 #22 业务 diff。

若出现 `handler_not_ready`、任何 bootstrap failure、generic internal error、runner_no_progress、无 Session、g2 或错误 provenance：**FAIL，不得宣称修复。**

完整逐条剧本： [checks.md](checks.md)。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| handler动态加载循环/HMR假ready | registry kind+generation verify + direct tick tests |
| readiness失败形成新自旋 | lease前失败；attempt不增；backoff+event去重 |
| bootstrap raw错误泄密 | typed allowlist；path/specifier/stack/sentinel测试 |
| 已知reason仍被覆盖 | 每条known failure显式 disposition |
| 30141/30142竞争导致误归因 | 验收前隔离共享agent-dir旧进程；核对PID/processEpoch |
| #22业务agent继续执行 | Session proof后立即pause；不合并/发布业务diff |
| policy真实阻断 | 不跳过；FAIL并报告，必要时用同形态生产job |

## 规划产物

| Artifact | Link |
| --- | --- |
| Brief | [brief.md](brief.md) |
| PRD | [prd.md](prd.md) |
| UI gate | [ui.md](ui.md) |
| Design | [design.md](design.md) |
| Implement | [implement.md](implement.md) |
| Checks | [checks.md](checks.md) |
| Handoff | [handoff.md](handoff.md) |

## 请求用户批准

请确认以下决策：

- [ ] 批准 GHR-01…06，`maxConcurrency=2`。
- [ ] 同意不改 Jobs UI，复用现有观测结构。
- [ ] 同意真实 #22 优先；如其状态不再适用，可用同形态生产 job，但必须记录 jobId/provenance。
- [ ] 同意 30142 前隔离共享 agent-dir 的其他 ypi scheduler，确保结果可归因。
- [ ] 同意 Session-created 证据后立即 pause，不把 Issue #22 业务实现纳入本任务。
- [ ] 同意任何 handler/bootstrap/no-progress/无Session失败都不得作为“已修复”结论。

批准示例：

```text
确认，按 plan-review 和 GHR-01…06 实施；最终以 30142 真实验收为准
```

修改示例：

```text
需要修改：……
```

---

**当前只请求计划批准；批准后才能进入 implementing。最终完成门禁不是 fixture 绿，而是 30142 真实 Session 证据。**
