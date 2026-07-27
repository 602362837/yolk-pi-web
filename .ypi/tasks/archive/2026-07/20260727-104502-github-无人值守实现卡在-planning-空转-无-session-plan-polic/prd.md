# PRD：GitHub P1 无人值守状态真实性与恢复闭环

## 目标与背景

GitHub #22 的 job 已建立 WorkTree 与 Studio task，但在 Session 创建前被旧 plan policy 阻断；修复后又因 Owner command idempotent replay 截断 runner continuation，scheduler 持续自旋。现有 Jobs UI 把 scheduler 的 `running/planning/attempt` 呈现得像 Agent 正在工作，用户无法知道 Session 根本不存在。

本功能要把“业务策略、durable runner、scheduler、Studio、Session、Agent、发布”做成一致且可恢复的闭环：每次调度必须产生可证明的语义进展、进入带退避的 retry、或稳定阻塞；用户界面只显示服务端事实，不靠 `phase/status/attempt` 猜测。

## 用户与价值

- **本机 operator**：快速判断 job 卡在哪一层，并执行 pause/retry/resume，不需要读 JSONL 或进程日志。
- **Issue Owner**：收到真实的状态与下一步，不因 Bot 状态文案误以为代码正在实现。
- **维护者/发布者**：可证明同一 generation 不会因自旋、lease 过期或 retry 重复启动 Agent/发布。

## 范围内

1. pre/plan/final policy stage 语义与 title/plan evidence 分离。
2. Owner command delivery 一次性消费与 unattended runner continuation。
3. scheduler progress、backoff、attempt 口径、pause/concurrency/singleStep、长租约 fencing。
4. WorkTree `projectId+spaceId`、parent Session、Studio child JSONL/index 一致性。
5. GitHub unattended Agent 的 scrubbed env 隔离，不修改共享 server `process.env`。
6. safe status/job projection、运行 build/policy provenance、Jobs UI 双层状态。
7. #22 类历史 job 的幂等 reconcile + operator 恢复 runbook。
8. 单元、故障注入、脚本 E2E、UI/窄屏/a11y 与安全回归。

## 范围外

- 不扩大 `docs-and-small-bugfix` 到 UI、workflow/release、auth/secrets、dependencies、infra 或大重构。
- 不把 full agent 宣称为沙箱，不移除残余 host/network/filesystem risk。
- 不给 Agent App/machine credentials 或 server publisher capability。
- 不允许 Agent push/开 PR，不 auto-merge，不 direct push main，不发布 release。
- 不回写/删除历史 event、job、task、Session、WorkTree 或 generation。
- 不新增“跳过策略”按钮，不让 Issue 评论解除 global pause。

## 需求与验收标准

### R1 Policy stage 必须有不同事实来源

- **pre**：只使用 operator config、complete claim、structured owner authorization、明确的高风险 scope hint；没有 diff 时不得伪装为 docs allow。
- **plan**：使用 runner-owned structured plan/scope evidence；`issueTitlePreview` 不得复制为 `planText`。
- **final**：只以实际 diff、限制、结构化 small-bugfix/validation evidence 判定；title 不得覆盖安全的实际文件分类。
- 验收：stage table tests 覆盖每种输入来源与结果。

### R2 空 diff 语义

- pre/plan 无 declared files 是显式 `deferred`（兼容 wire 可先映射 allow+deferredReason），允许继续到最终门禁。
- final 无 diff 是 `blocked_empty_diff`。
- 验收：#22 title + empty plan 不阻断；empty final 不发布。

### R3 title/hint 误报防护

- “模型”不是 secret/auth 词；中文词不依赖 JS `\b`。
- title 只是 untrusted advisory evidence，必须与 trusted plan evidence 分字段、分 source 投影。
- 高置信 UI/secret/release hint 可 fail closed，但必须返回明确 classification、source、layer；模糊词不能被宽泛包含匹配误伤。
- 验收：`chat打开底部模型性能问题` 不得变成 `secret_auth`；明确“修改凭据密钥”“Settings 页面交互”仍阻断。

### R4 docs-and-small-bugfix / UI gate 保持

- final UI path 必须 block。
- planning 阶段高置信 UI scope 必须进入 `blocked_manual_ui_approval`；不能硬编码 `uiGate=pass`。
- 未确认的 UI 原型不能进入实现。本任务自身 UI 已交付 HTML，但必须先由用户批准。

### R5 Owner command 只消费一次

- job 的 audit `deliveryId` 与待处理 command work item 分离。
- 相同 comment version 的 `remote_confirmed` effect 不重复 side effect；若 job 已进入 unattended active phase，必须继续 runner，而不是提前返回。
- 新 pause/continue/status/re-evaluate 命令仍按 exact comment/version 执行一次。
- 验收：用 #22 adoption delivery 重放 20 tick，side effect=1，runner 可前进，不能自旋。

### R6 每次 scheduler lease 必须有终态 disposition

Handler 只能返回：

- `progressed`：checkpoint/progress revision 前进，可立即继续；
- `waiting`：等待外部/Agent，不重复取 lease；
- `retry_due`：可恢复失败，含 `nextRetryAt` 和退避；
- `blocked`：确定性/manual blocker，无自动重试；
- `terminal`：completed/cancelled/ignored。

无进展且无显式 disposition 视为 `runner_no_progress`，进入有上限退避或稳定 block，禁止 park queued 自旋。

### R7 次数与进展口径真实

- 兼容保留 `attempt`，定义为 scheduler lease run count。
- 新增 `agentRunCount`、`meaningfulProgressCount`、`noProgressRunCount`、`lastMeaningfulProgressAt`。
- UI 不再显示“第 N 次”，改为“调度尝试 N”；Agent 次数独立显示。

### R8 retry/backoff 不能重跑同一确定性 gate 死循环

- block 存储 `blockFingerprint(layer+reason+policyVersion+scope/input hash+checkpoint+code revision)`。
- 确定性 block 不自动 retry；operator retry 仅在 code/policy/input 变化后重评一次，或明确告知条件未变。
- infra/runtime/network 使用指数退避、上限、jitter 和最大连续无进展阈值。

### R9 pause/singleStep/concurrency 语义

- per-job pause 稳定停在 checkpoint，不清 global pause，不强杀已运行 Git 命令。
- global pause 最高优先级，scheduler 不取新 lease。
- `singleStep` 只用于测试/协作式推进；仅真实 checkpoint 变化才 `wakeAgain`。
- unattended Agent 全局并发继续为 1；triage 并发不等同 full-agent 并发。

### R10 长 Agent 租约安全

- lease 有 heartbeat、owner liveness 与 fencing token；stale removal 不能只看创建时间。
- scheduler stale reconcile 跳过本进程 inFlight，并在 lease 缺失/过期且 fencing 检查通过后才重试。
- 验收：模拟 10 分钟 Agent run 不出现第二 owner；lease lost 时旧 owner 后续写被拒绝。

### R11 Session 创建与展示边界

- policy/Studio gate 之前没有 Session 属于合法状态，UI 必须显示“尚未启动 Agent / 卡在 policy”。
- 进入 implementing 后必须创建一次 parent Session；bootstrap 失败必须进入可见 retry_due/block，不能静默继续宣称 active。
- `sessionAvailability=none|bootstrapping|active|ended|failed|unknown_legacy` 由服务端给出。

### R12 WorkTree session 归属

- WorkTree ensure/reuse 返回并持久化 `projectId+spaceId`。
- parent Session header 写相同 project/space，child 继承并写 WorkTree `.ypi/sessions/index.v1.json`。
- WorkTree Session 不出现在 main space；global inventory 仍可用于 audit，但不能替代 space truth。

### R13 不修改共享 process.env

- GitHub unattended full-agent 运行在隔离子进程或等价 per-run env 边界，传入 scrubbed env 副本。
- Next/server 进程保留 effective App credentials 给 webhook/publisher。
- 仍明确：这不是 OS sandbox，Agent 仍可能读取同 OS 用户文件。

### R14 safe projection 一眼定位层级

Job projection 至少提供安全枚举/计数：

- `schedulerState`
- `agentExecutionState`
- `sessionAvailability`
- `blockedAtLayer`
- `retryability/nextRetryAt`
- `checkpoint`
- `lastMeaningfulProgressAt` 与固定词表摘要
- `agentRunCount/noProgressRunCount`
- 安全 `workspaceLabel`
- `runtimeBuild/packageVersion/codeRevision/processEpoch/policyVersion`

不得返回 absolute path、sessionFile、Issue/comment body、prompt、transcript、tool input/result、secret。

### R15 Jobs UI 双层状态

- 首屏先显示 Agent 状态，再显示 scheduler 状态。
- 无 Session 不能显示“Agent 运行中/实现中”。
- 展开可见阶段轨道、block layer、reason、checkpoint、next retry、进展、build provenance。
- stale 快照保留只读信息但禁用 mutation。
- 操作只消费服务端 `actions[]` 和现有 retry/pause/resume API。

### R16 运行代码版本闭环

- status 暴露安全 build/policy provenance；block 记录 evaluated provenance。
- dev hot reload 与 production installed package 均能判断“源码已改但运行进程未加载”。
- production package/Next build 变更后必须完整重启；不得只看 repo HEAD/version 字符串。

### R17 #22 安全恢复

- 修复前先 pause 止血。
- 部署/重启后运行幂等 reconcile，消费旧 command、解析 space、保留 legacy attempt、恢复到最后安全 checkpoint。
- operator 单次 retry；复用 g1 WorkTree/branch/task，不建新 generation，不改历史。
- 若真实 scope 仍命中 UI/high-risk gate，稳定 manual block 是正确结果。

### R18 安全与发布 invariants

- full-agent residual risk、低权限部署建议持续显示。
- 不主动注入 App/machine secrets；Issue/comment 自由文本不控制 policy/argv/path/remote/publisher。
- Agent 无 server publisher capability，不 push/PR；App publisher 只开同仓 `Fixes #N` PR，不 auto-merge。

## UI 原型门禁

本任务改变 Jobs 面板信息结构、状态语义与操作反馈，**触发 UI 原型硬门禁**。UI 设计员已交付：

- [UI 说明](ui.md)
- [HTML 原型](github-unattended-job-observability-prototype.html)

用户批准原型前不得进入 implementing。

## 未决决策（随计划审批确认）

1. **推荐**：保留 policy 前无 Session；UI 明示“尚未启动 Agent”，而不是为心跳创建伪 Session。
2. **推荐**：确定性 policy block 在条件/版本未变时禁用 retry；不允许盲重跑。
3. **推荐**：Settings 只显示 opaque short session id/availability；是否增加“打开审计 Session”深链可后续独立设计，本次不新增。
4. **推荐**：采用隔离 SDK host 子进程解决 env 边界；不使用临时删除/恢复共享 `process.env`。
