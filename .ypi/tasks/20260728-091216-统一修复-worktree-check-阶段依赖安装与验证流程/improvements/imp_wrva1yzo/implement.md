# IMP-002 Implement — 异常分流与 Issue 通知闭环

## 前置

先读 `brief.md`、`prd.md`、`design.md`、`checks.md`，以及 `lib/github-automation-runner.ts`、`github-automation-types.ts`、`github-automation-comments.ts`、`github-automation-labels.ts`、`github-automation-projection.ts`、`github-issue-triage-runner.ts`。不得修改普通 Chat/UI 或将 Issue 文本作为策略输入。

## 子任务

| ID | 工作 | 依赖 |
| --- | --- | --- |
| IMP2-01 | 定义 disposition/provenance/outbox schema、safe projection 与 migration fail-closed | — |
| IMP2-02 | runner 的 implementer terminal CAS、checker gate、stale-write 防护 | IMP2-01 |
| IMP2-03 | allowlisted label/comment notification outbox、reconcile 与 operator notification state | IMP2-01 |
| IMP2-04 | real runner/App boundary fault-injection regression与文档 | IMP2-02, IMP2-03 |

### IMP2-01 — contract

在 `github-automation-types/store/projection` 中加入严格 enum、generation/run-fence provenance、notification operation 状态与 `operator_notification` layer。旧 state 缺失/矛盾不推测成功；保持 wire safe，不暴露 raw failure/output。

### IMP2-02 — runner

归一 child non-success result，先 CAS 落盘 terminal disposition，再调用通知；成功路径才清理**相同 fence**的 state 并进入 checking。checker/operator validation/publisher 各加 defense-in-depth gate。所有 stale/late writer 不能覆盖。既有 IMP-001 transport lane 保持独立。

### IMP2-03 — App communication

复用 approved labels 与 `automation_status` upsert；实现代码常量 mapping/中文模板。确认 labels/comment 结果逐项落盘。失败、unknown write、reconcile failure 转 operator_notification；retry 只补发通知。不可删用户标签、不可自动 retry manual UI/needs-user。

### IMP2-04 — tests/docs

在 `test-github-unattended*.mjs` 用真实 runner/member adapter、label/comment App request stub、durable reload/fault injection 覆盖矩阵；更新 architecture/library/troubleshooting，说明 comment 不是 approval、notification retry 不是 pipeline retry。

## 实现计划

```json ypi-implementation-plan
{"schemaVersion":2,"summary":"Close GitHub unattended non-success routing and safe Issue notification without changing Chat UI.","strategy":"Disposition-first durable CAS; notification outbox is separate from business progression.","maxConcurrency":1,"sourceArtifact":"implement.md","subtasks":[{"id":"IMP2-01","title":"Define safe disposition and notification provenance contract","phase":"contract","order":10,"dependsOn":[],"relation":"serial","files":["lib/github-automation-types.ts","lib/github-automation-store.ts","lib/github-automation-projection.ts"],"instructions":["Add exact allowlisted schema and fail-closed legacy handling."],"acceptance":["No raw child/Issue data is persisted or projected."],"validation":["node_modules/.bin/tsc --noEmit"],"risks":["Schema migration may misclassify legacy state."],"parallelizable":false,"member":"implementer","localReview":{"required":true,"reviewer":"checker"}},{"id":"IMP2-02","title":"Gate downstream stages on durable implementer disposition","phase":"runner","order":20,"dependsOn":["IMP2-01"],"relation":"serial","files":["lib/github-automation-runner.ts","lib/github-automation-session.ts"],"instructions":["Use generation/run-fence CAS; non-success must not reach checker."],"acceptance":["Late checker cannot overwrite a newer implementer block."],"validation":["npm run test:github-unattended"],"risks":["Incorrect fence clearing can strand valid retry."],"parallelizable":false,"member":"implementer","localReview":{"required":true,"reviewer":"checker"}},{"id":"IMP2-03","title":"Deliver idempotent safe labels and Chinese status comment","phase":"notification","order":30,"dependsOn":["IMP2-01"],"relation":"parallel","files":["lib/github-automation-comments.ts","lib/github-automation-labels.ts","lib/github-automation-runner.ts"],"instructions":["Reuse approved catalog and canonical marker; persist per-operation outcomes."],"acceptance":["Notification failure is observable and retry never reruns business stages."],"validation":["npm run test:github-automation"],"risks":["Unknown remote writes need reconciliation."],"parallelizable":true,"member":"implementer","localReview":{"required":true,"reviewer":"checker"}},{"id":"IMP2-04","title":"Prove runner and notification fault boundaries","phase":"regression-docs","order":40,"dependsOn":["IMP2-02","IMP2-03"],"relation":"serial","files":["scripts/test-github-unattended.mjs","scripts/test-github-unattended-runner.mjs","docs/architecture/overview.md","docs/modules/library.md","docs/operations/troubleshooting.md"],"instructions":["Use real runner paths and deterministic remote stubs; document operations."],"acceptance":["All matrix cases and focused gates pass."],"validation":["npm run test:github-unattended-runner","npm run test:github-unattended","npm run test:github-automation","npm run lint","node_modules/.bin/tsc --noEmit","git diff --check"],"risks":["Stub-only tests may miss App API ordering."],"parallelizable":false,"member":"implementer","localReview":{"required":true,"reviewer":"checker"}}]}
```
