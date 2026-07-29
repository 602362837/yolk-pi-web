# Checks：新议题规范化评论与真实性分析

## 1. 放行条件

本任务只有同时满足以下条件才可宣称完成：

1. UI 设计员 HTML 原型已在任务目录交付并经用户批准；
2. 仅 human `issues.opened` 能创建 v2 analysis job；
3. 生产依赖图中不存在 claim/Owner command/unattended/WorkTree/Studio/Session/publisher/PR 入口；
4. 真实性分析只读、contained、有预算、有证据账本，不能把未搜索到升级为 `not_exists`；
5. canonical comment 与 close 都有远端幂等回读；
6. v1 job 全部不可调度，升级默认 disabled；
7. focused tests、lint、tsc、文档与设置页人工验收通过；
8. 无 commit、push、merge 或真实 GitHub mutation 被测试流程意外执行。

## 2. 需求覆盖检查

| PRD | 检查点 | 证据 |
| --- | --- | --- |
| R1 | 只有 human `issues.opened` 建 job；reopen/edit/comment/PR/self/Bot 均 0 job/0 wake | ingress matrix 单测 + scheduler wake spy |
| R2 | cap → HMAC → parse；allowlist by repository.id + exact installation；请求线程不跑模型 | route/runtime 测试与 source assertion |
| R3 | readiness 只要求 Metadata read + Issues read/write；无 PAT/Links/gh | setup verify fixture + import/sentinel scan |
| R4 | 每个结果恰好一个 category；Feature 未实现不能成为 `not_exists` | result parser/controller tests |
| R5 | 仅 contained list/find/grep/read；无 AgentSession/bash/edit/write/network/skills | evidence controller tests + forbidden import/tool scan |
| R6 | 无结果、预算耗尽、非法输出、provider failure 全部 open/inconclusive | fault matrix |
| R7 | 一条 v3 canonical comment，固定章节，semantic no-op，unknown write 回读 | comment builder/upsert tests |
| R8 | close 全门禁、Issue 回读、fence、enabled/paused、unknown close reconcile | close matrix + race/fence tests |
| R9 | confirmed 保持 open，评论含原因与非执行方向 | template snapshot/semantic assertions |
| R10 | inconclusive/not_applicable 保持 open，缺失信息可见 | runner tests |
| R11 | delivery exclusive、issue lifecycle unique、self-event 0 wake、effect idempotency | duplicate/concurrency/replay tests |
| R12 | disposition 明确、retry bounded、无自旋、maxConcurrency 1..8 | finite tick tests |
| R13 | 设置页仅展示新信息架构、状态和 retry | 已批准 HTML 对照 + browser manual |
| R14 | v1 scheduler skip + retirement sidecar + v1 config migration disabled | temp agent-dir migration tests |
| R15 | 闭环代码/脚本/文档已解除引用；Studio/WorkTree Check 通用能力仍通过 | import graph + package asset + Studio/checker tests |
| R16 | API/event/result 无 body/prompt/raw output/path/secret | recursive forbidden-key/sentinel scan |

## 3. 自动化测试设计

### 3.1 Webhook / 防成环矩阵

至少覆盖：

- valid human `issues.opened` → 202 + one job + one wake；
- duplicate delivery id → 202 duplicate + no second job/wake；
- two distinct opened deliveries for same repo/issue → one lifecycle only；
- `reopened/edited/closed/labeled/assigned/unassigned` → audit-only；
- all `issue_comment` / `pull_request` actions → audit-only；
- `performed_via_github_app.id` self、sender type Bot/App、unknown actor → audit-only；
- disabled、paused、non-allowlist、installation mismatch → no job；
- invalid/missing signature → 401 and no JSON business processing；
- oversize → 413；malformed signed JSON → 400；
- Bot canonical comment create/edit webhook repeated many times → job/generation count stable。

### 3.2 Evidence controller

使用临时目录，不读取真实 operator 项目：

- relative path contained success；absolute/`..`/URL/backslash/NUL rejected；
- symlink file/dir escape rejected；
- `.git/.ypi/node_modules/.next/dist/build/coverage/vendor` excluded；
- `.env`、PEM、key/token/credential-like filenames excluded；
- binary/NUL、oversized file、单文件/总字节/文件数/操作数/总时长预算；
- grep/find 结果 cap 与 deterministic order；
- ledger id/path/line/hash 只来源于 controller-observed reads；
- fs errors 映射 stable code，不出现 temp absolute root。

### 3.3 模型与结果校验

用 fake `ModelRuntime.completeSimple`，不得访问真实 provider：

- valid action loop + final result；
- markdown fence、额外字段、未知 action、非法 path、超长文案、引用未知 evidence id；
- timeout/abort/error/empty response/max turn；
- Feature/Docs/Question 强制 `not_applicable`；
- `not_exists` + grep miss only → `inconclusive`；
- `not_exists` + low/medium confidence → `inconclusive`；
- `not_exists` + truncated Issue / exhausted budget / incomplete coverage → `inconclusive`；
- confirmed 无 supports evidence → `inconclusive`；
- 跟随主默认模型不可用 → readiness false，job 不 close；
- raw provider error sentinel 不进入 store/event/comment/API。

### 3.4 Comment / label

- v3 marker identity 只含 kind/repo/issue；
- 每个 verdict 模板固定章节齐全；
- CRLF/trailing whitespace semantic equality = no PATCH；
- 外来 marker、其他 issue marker、v1/v2 marker 不被误用；
- duplicate marker 选择 earliest，不删除；
- POST/PATCH timeout 后回读相同 body = remote_confirmed；不同 body = reconcile_needed，不盲写；
- comment 不含绝对路径、证据原文、Issue body、prompt/tool payload/error；
- 分类 label 只动批准的 YPI type siblings，不删除普通用户 label；
- 旧 `ypi:claimed` 等 label 在迁移中不自动清理。

### 3.5 Close 门禁矩阵

对每一个条件做单独 negative case：

- category 非 bug；verdict 非 not_exists；confidence 非 high；
- evidence 不足/未知 id；analysis incomplete/truncated/budget exceeded；
- comment 未 remote-confirmed；Issue 已关闭；title/body hash 改变；
- lease/fence 丢失；config disabled/paused；close effect 已确认；
- 本地 project 不可读或模型 readiness 变化；
- close PATCH success → GET closed → comment final update；
- close timeout/network unknown → GET closed 视为 confirmed；GET open 进入 retry_due，不立刻第二次 PATCH；
- close 失败后 canonical comment 更新为“未自动关闭”；
- confirmed/inconclusive/not_applicable 的 GitHub PATCH close 调用次数严格为 0。

需要特别检查 comment/label 会改变 Issue `updated_at` 的 fixture：close 前基线必须在 comment confirmed 后建立，同时 title/body hash 仍等于分析输入。若最终实现声称使用 HTTP 条件更新，必须有 GitHub 文档或 contract fixture 证明；否则文档必须承认 TOCTOU，不能写“原子 CAS”。

### 3.6 Durable scheduler / migration

- v2 `kind=issue_analysis` 才可运行；所有 v1 job 即使 queued/running/retry_due 也 0 lease；
- v1 非终态生成 retirement sidecar，重复迁移 no-op；不改写旧 job/events；
- v1 config 迁移保留有效 repo binding、去掉闭环字段、强制 enabled=false、留固定备份；
- unknown/future config schema fail closed、不覆盖；
- lease heartbeat/fence lost 后旧 owner write rejected；
- 每个 known outcome 有 disposition；no progress bounded 后 stable block，不出现 2 秒 queued spin；
- retry 从 result_ready/commenting/closing 续跑未确认效果，不重复模型/评论/close；
- concurrency 遵守 `analysis.maxConcurrency`。

### 3.7 API / safe projection

- config PATCH revision CAS、secret/path/legacy field rejection；
- verify POST read-only：`enqueuedJobs=false/schedulerWoken=false/githubMutations=false`；
- status GET 不 wake；jobs POST 只接受 retry；
- credentials GET/PUT/DELETE 既有不回显/blank-preserve/local-only 行为回归；
- 所有响应 `Cache-Control: no-store`；
- recursive forbidden key/value scan：token, secret, private key, webhook body, Issue body, prompt, transcript, raw model output, projectRoot, cwd, sessionFile, WorkTree path；
- job projection只含 phase/category/verdict/confidence/effects/retry/safe reason/time。

## 4. 删除与依赖图检查

实施完成后执行：

```bash
rg -n "github-machine-assignee|github-owner-intent|github-full-agent-profile|github-automation-handler-runtime|github-automation-runner|github-automation-session|github-automation-worktree|github-git-publisher|github-pr-lifecycle|github-risk-policy|github-diff-policy|github-pr-contract|github-validation-broker" \
  app components hooks lib scripts package.json docs AGENTS.md .pi/skills

rg -n "ypi:claimed|awaiting_owner|accepted_waiting_automation|unattended|full-agent|WorkTree.*GitHub|Session.*GitHub|verify:github-automation-30142" \
  app components lib scripts package.json docs AGENTS.md .pi/skills
```

允许命中仅限明确标注的历史/迁移说明或历史 PR 人工审查规则；每个命中人工解释。不得通过删除以下通用文件来清空命中：

```bash
test -f lib/worktree-check-policy.ts
test -f lib/worktree-check-execution.ts
test -f lib/worktree-check-extension.ts
test -f lib/worktree-check-cli-extension.ts
test -f lib/ypi-studio-child-session-runner.ts
test -f lib/agent-session-bootstrap-errors.ts
```

## 5. 建议验证命令

实现阶段最终至少运行：

```bash
npm run test:github-automation
npm run test:worktree-check
npm run test:studio-sdk-runner
npm run test:studio-dag
npm run test:package-assets
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

其中 `test:github-automation` 应被重写为新的 analysis-focused suite；旧 unattended/publish/handler/session-bootstrap/30142 scripts 和 package scripts 应移除。不得为 routine validation 直接运行 `next build`；仅 release 验证使用 `npm run build`。

所有测试使用临时 `PI_CODING_AGENT_DIR`、临时仓库和 mocked GitHub/model；禁止读取 `~/.pi/agent`、真实 App 凭据或访问 GitHub/provider 网络。

## 6. 人工 UI 验收（需基于批准 HTML）

### 桌面

- 本机 App 凭据保存/轮换/移除仍不回显 secret；
- checklist 不再出现 Assignee、Contents、PR、full agent；出现模型可用、本地项目只读；
- allowlist 表单不再显示 base ref / owner actor ids；
- 运行控制只有 enabled 与 global paused；首次启用有自动关闭风险说明；
- 最近分析只显示 Issue、category、verdict、confidence、comment、close、retry；
- 不出现 WorkTree/Session/Agent/publish/PR/调度尝试冒充 Agent 的文案；
- stale snapshot 禁 mutation；revision conflict 可恢复；
- retry 明确“不重复已确认评论/关闭”。

### 状态

逐项展示：凭据缺失、allowlist 空、project missing、model unavailable、enabled、paused、queued、analyzing、commenting、closing、completed-open、completed-closed、inconclusive、retry_due、blocked、stale、revision conflict。

### 窄屏与无障碍

- ≤640px、≤390px 不横向溢出，事实网格/操作按钮可用；
- keyboard focus、label、status/alert、disabled reason、dialog focus restore；
- secret input 不进入 DOM 回显；
- reduced-motion 不影响信息可读性。

## 7. 真实 GitHub UAT（release blocker）

在专用测试 App/仓库执行，使用不含真实用户数据的 fixture：

1. App 只有 Metadata read + Issues read/write，只订阅 Issues；
2. 新建 confirmed bug → 一条评论，Issue 保持 open；
3. 新建 feature/docs/question → not_applicable，保持 open；
4. 新建 evidence 不足 bug → inconclusive，保持 open；
5. 仅在用户已批准 auto-close 口径后执行高置信反证 fixture → comment confirmed 后关闭；
6. 编辑/评论/reopen/label/Bot comment webhook 不新增 job；观察至少 2 分钟无循环；
7. 模拟 comment/close timeout，确认远端回读且无重复评论/close；
8. 暂停时新 Issue 仅 audit，不补跑；恢复后只处理之后的新 Issue；
9. 升级带 v1 queued job 的副本，确认旧 job retired 且无 WorkTree/Session/PR 副作用。

UAT 前不得使用 operator 的生产 App/仓库。若分类词表、`state_reason`、本地快照权威性或 HTML 尚未批准，自动关闭 UAT 必须阻塞。

## 8. 重点回归风险

- webhook 在 HMAC 前触发 handler/model 初始化；
- comment 自事件生成新 job；
- `grep` 零结果被当作反证；
- comment 导致 `updated_at` 改变后误判 Issue 被人工编辑；
- retry 重跑模型或重复 close；
- v1 queued job 被新 scheduler 拾取；
- 删除 `worktree-check-*`、Studio runner 或通用 bootstrap errors；
- setup verify/status GET 意外 wake；
- UI/文档残留 full-agent/Assignee/Owner 命令承诺；
- 本地 checkout 陈旧导致错误关闭。
