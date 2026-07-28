# Checks — handler/bootstrap/retry + 30142 真实验收

## 0. 完成判定（硬门禁）

本任务不能以 lint、typecheck 或 GitHub automation fixture 全绿结案。完成必须同时满足：

1. 自动验证全部通过；
2. release candidate 在 **http://localhost:30142** 直接监听；
3. 使用真实 #22 或同形态生产 job；
4. pause → **只发一次 retry**；
5. 同 g1 创建真实 WorkTree Session 并推进；
6. status API、single-job API、safe events、runner、Session header 一致；
7. 失败、无 Session、provenance 不匹配或只靠 fixture 时，**不得宣称修复**。

业务 Issue #22 本身不在本任务实现范围；验收只证明自动化闭环。

## 1. 需求覆盖检查

| ID | 检查项 | 必须证据 |
| --- | --- | --- |
| C1 | handler 单一权威入口 | registry kind/generation + cold retry test |
| C2 | webhook/retry/resume/ensure/tick 全覆盖 | source audit + integration tests |
| C3 | default handler 不处理生产 planning job | fault test 无 `runner_no_progress` |
| C4 | handler_not_ready 可见 | job/event/projection，attempt不增 |
| C5 | bootstrap typed failure | stage/code/retryability + fixed safe message |
| C6 | known failure 显式 disposition | scheduler 后 reason 不被覆盖 |
| C7 | attempt 语义 | retry不重置；lease前失败不增加；Agent独立计数 |
| C8 | same generation | jobId/generation/WT/branch/task/history 保留 |
| C9 | 不跳 policy | 无 skip action；policy block原样停 |
| C10 | UI 结构不变 | 仅现有 fields；无 component/CSS 变更 |
| C11 | 30142 真实验收 | PID/provenance + 一次 retry + Session evidence |

## 2. 自动验证

### 2.1 Handler registration / action chain

- [ ] cold process/reset registry 后，不发送 webhook。
- [ ] 对 planning/studio_task_ready job 调 `applyGithubAutomationJobAction(retry)`。
- [ ] action 在 mutate/wake 前确认 full handler ready。
- [ ] direct `ensureGithubAutomationScheduler` / `tickGithubAutomationScheduler` 同样确认 readiness。
- [ ] 并发 ensure single-flight；handler kind/generation可验证。
- [ ] HMR/reset 后不被旧 `_triageHandlerRegistered` 布尔值骗过。
- [ ] default handler 测试只能通过显式 test override 进入。

### 2.2 Handler failure

- [ ] load/register/verify 三类 fault 至少覆盖两类。
- [ ] reason=`handler_not_ready`，layer=`scheduler`。
- [ ] 没有业务 lease，因此 `attempt` 不增加。
- [ ] 不产生 `runner_no_progress`。
- [ ] safe event 不含 module specifier、绝对路径、stack、token。
- [ ] readiness failure 有 capped backoff/event dedupe，不形成新自旋。

### 2.3 Bootstrap failure and disposition

- [ ] binding missing/mismatch → operator hard block。
- [ ] runtime `MODULE_NOT_FOUND` → `session_runtime_module_missing`，不返回缺失模块名。
- [ ] recoverable runtime/fs fault → `session_bootstrap_transient` + retry_due disposition。
- [ ] unknown hard fault → `session_bootstrap_failed` + blocked disposition。
- [ ] `unattended_session_bootstrap_failed` meta 只有 allowlisted stage/code/retryable/fixed message。
- [ ] scheduler `applyHandlerDisposition` 后 reason/layer仍为 bootstrap，不变成 no-progress。
- [ ] `incomplete_claim`、policy block 同样保持原 reason。

### 2.4 Bootstrap success

- [ ] runner `sessionId/contextId/sessionFile` 写入 server-only sidecar。
- [ ] job `agentRunCount`、`progressRevision`、`meaningfulProgressCount` 前进。
- [ ] `lastMeaningfulProgressKind=session_created`。
- [ ] safe `unattended_session_created` event 存在且不含 path/sessionFile。
- [ ] Session header projectId/spaceId 是 WorkTree space，不是 main。
- [ ] candidate index failure/partial wrapper cleanup 边界有测试。

### 2.5 #22-shape no-spin regression

Fixture 只作为前置回归，必须使用实际 action/readiness/tick/runner 链路：

- [ ] g1、attempt=900、studio_task_ready、remote_confirmed command、spaceId、session null。
- [ ] reconcile 消费 command，不创建 g2，不重置 attempt。
- [ ] retry 后 full handler运行，不注入自定义 no-op handler。
- [ ] finite ticks；没有约 2s attempt 爆炸。
- [ ] success 或明确 typed failure；不得 generic `Internal GitHub automation error`。

### 2.6 Privacy/sentinel

- [ ] API/projection/event 无 PEM/JWT/token/webhook secret。
- [ ] 无 `/Users/...`、`/Volumes/...`、WorkTree path、sessionFile、module specifier、stack。
- [ ] runner sidecar可含server-only path，但不得进入 safe projection。

## 3. 自动命令

```bash
npm run test:github-automation
npm run test:github-unattended
npm run test:github-unattended-runner
npm run test:github-publish-policy
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

若新增 focused script，应加入 `package.json` 并在此补充，例如：

```bash
npm run test:github-handler-runtime
npm run test:github-session-bootstrap
```

自动命令失败即停止；禁止用后面的真实验收掩盖测试失败。

## 4. 30142 真实验收剧本（独立强制 subtask）

> **GHR-04 harness（只读/单次 mutation 门禁脚本）**  
> - 脚本：`scripts/verify-github-automation-30142.mjs`  
> - npm：`npm run verify:github-automation-30142 -- …`  
> - 证据模板：`.ypi/tasks/20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-/evidence-template-30142.md`  
> - 默认 **read-only**；真实 retry 必须显式 `--confirm-single-retry`（GHR-06 才执行）  
> - 拒绝 HTTP 301/302；不跟随 redirect；输出仅 allowlisted 安全字段  
> - 本节手工命令仍是最终 fallback，避免脚本脆弱时无法验收

### 4.1 前置与安全

- [ ] 用户/主会话确认使用真实 #22；若不适合，明确记录同形态生产 jobId。
- [ ] 目标 job 先 per-job pause；必要时 global paused 止血。
- [ ] 记录 baseline：jobId、generation、attempt、phase/checkpoint、runner task/space/session、events最后行号/时间。
- [ ] 确认不创建 g2、不删 history、不手改 JSON。
- [ ] 确认 RC 已完成必要 build；不得直接运行 `next build`。

推荐 release 验证：

```bash
npm run build
```

### 4.2 隔离共享 agent-dir 的其他进程

同一 `PI_CODING_AGENT_DIR` 不能同时由旧 30141 与 RC 30142 抢同一 job，否则不能归因。

```bash
lsof -nP -iTCP:30141 -sTCP:LISTEN
lsof -nP -iTCP:30142 -sTCP:LISTEN
ps -fp <pid>
```

- [ ] 安全停止/隔离旧 ypi scheduler；不要 kill 无关进程。
- [ ] 30142 空闲。
- [ ] 若用非默认 agent dir，显式记录并给 RC 同一值。

### 4.3 启动并确认 30142

```bash
PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" \
  node bin/pi-web.js --port 30142 --no-open
```

另一终端：

```bash
lsof -nP -iTCP:30142 -sTCP:LISTEN
curl -fsS http://localhost:30142/api/cli/health
curl -fsS http://localhost:30142/api/github-automation/status

# 推荐：只读 harness（不 mutation）
node scripts/verify-github-automation-30142.mjs \
  --job-id job_1278854433_22_g1_01a6cdde \
  --base-url http://localhost:30142
```

必须确认：

- [ ] 直接响应来自 30142，不依赖 HTTP 301/302 redirect。
- [ ] health PID 等于 lsof PID。
- [ ] status `runtimeProvenance.packageVersion/buildId/codeRevision/processEpoch/policyVersion` 属于本次 RC。
- [ ] status 中目标 job 是同一 jobId/generation。
- [ ] global config 满足运行条件；per-job仍 paused，未被启动过程自动改写。

### 4.4 Baseline API / events / job projection

```bash
JOB_ID='job_1278854433_22_g1_01a6cdde'
curl -fsS "http://localhost:30142/api/github-automation/jobs/${JOB_ID}" > /tmp/ypi-job-before.json
curl -fsS http://localhost:30142/api/github-automation/status > /tmp/ypi-status-before.json
```

- [ ] 记录 `attempt=900`（或现场最新值），不是重置为 0。
- [ ] `generation=1`。
- [ ] Session none，runner sessionId null。
- [ ] 记录 `~/.pi/agent/github-automation/events/<date>.jsonl` 当前尾部位置；只读取 safe event。

### 4.5 pause → 单次 retry

如果目标不是 paused，先且只做一次 pause并等 projection稳定：

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"action":"pause"}' \
  "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"
```

然后**仅一次**（手工 fallback）：

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"action":"retry"}' \
  "http://localhost:30142/api/github-automation/jobs/${JOB_ID}" \
  > /tmp/ypi-retry-result.json
```

或使用 harness **单次** mutation（GHR-06；GHR-04 禁止对生产 job 执行）：

```bash
node scripts/verify-github-automation-30142.mjs \
  --job-id "${JOB_ID}" \
  --base-url http://localhost:30142 \
  --confirm-single-retry --pause-first --post-proof-pause
```

- [ ] 不连点、不循环 POST retry、不 resume+retry 双发。
- [ ] retry response 必须是 same generation，并指向 safe checkpoint。
- [ ] harness 默认无 `--confirm-single-retry` 时不得 mutation。

### 4.6 期望事件序列

最小处理序列：

```text
unattended_retry_wake
→ job_started
→ unattended_implementing
→ unattended_session_created   # 最终通过必需
```

允许被明确观测但代表**验收失败**的序列：

```text
github_automation_handler_not_ready / handler_not_ready
```

或：

```text
unattended_retry_wake
→ job_started
→ unattended_implementing
→ unattended_session_bootstrap_failed
  reason=session_bootstrap_failed|session_bootstrap_transient
  meta.bootstrapCode=<allowlisted true category>
```

规则：

- `retry_wake` 后若只有 `job_started → job_no_progress_backoff`，失败。
- 有明确 handler/bootstrap code 虽证明“可观测”，但最终门禁仍失败，**不得宣称修复**。
- event meta 若仍只有 `Internal GitHub automation error`，失败。

### 4.7 用 API / events / projection 交叉核对

轮询（只 GET，不再次 retry）：

```bash
curl -fsS "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"
curl -fsS http://localhost:30142/api/github-automation/status
rg '"jobId":"'"${JOB_ID}"'"' "$HOME/.pi/agent/github-automation/events/$(date +%F).jsonl" | tail -30
```

最终通过要求：

- [ ] single-job projection：`sessionAvailability=active|ended`。
- [ ] `agentExecutionState=implementing|checking|publishing|ended`，且由 Session证据支持。
- [ ] `counts.agentRuns>=1`、meaningful progress前进。
- [ ] runner sidecar `sessionId!=null`、projectId/spaceId仍为原 WorkTree binding。
- [ ] 对应 Session JSONL存在，header projectId/spaceId匹配 runner；不在 main space。
- [ ] safe event有 session-created 正向证据。
- [ ] generation仍1；jobId、WorkTree、branch、task/history不变。
- [ ] attempt不重置；在获得 Session证据前不得出现连续空跑暴涨（期望 baseline + 1 个 lease run）。
- [ ] 无 skip policy、无 g2、无删历史。

### 4.8 成功后止步

一旦 Session-created 证据齐全，立即对同 job 发 per-job pause，避免本任务继续处理 #22 业务 diff：

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"action":"pause"}' \
  "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"
```

- [ ] 保留 WorkTree/task/session/events。
- [ ] 不 review/merge/publish #22 业务改动作为本任务的一部分。
- [ ] 在 handoff/review 记录 PID、provenance、baseline/final counts、事件序列、Session short id 和 pause结果（不记录路径/secret）。

## 5. 失败条件（任一即不得宣称修复）

- 只跑 fixture/focused tests，没有 30142 真实 job。
- 30142 未监听，或请求实际由 30141/redirect/其他 PID处理。
- provenance 不是本次 RC。
- handler_not_ready。
- bootstrap 失败（即使 reason 已可见）。
- generic `Internal GitHub automation error`。
- runner_no_progress / attempt继续空涨。
- Session仍不存在或投影伪称 Agent active。
- 创建 g2、重置 attempt、删 history、跳过 policy。
- 为通过验收而实现/合并 Issue #22 业务改动。

## 6. Checker 报告格式

```text
30142: PASS|FAIL
PID/processEpoch/codeRevision: ...
Job/generation: ... / g1
Attempt baseline → final: ... → ...
Events: retry_wake → job_started → unattended_implementing → session_created
Session availability / agentRuns: ... / ...
Same WT/branch/task/history: PASS|FAIL
Post-proof pause: PASS|FAIL
Focused tests/lint/tsc: ...
Blockers: ...
Conclusion: only PASS when all mandatory gates pass
```
