# PRD：YPI Studio 异步子任务自动续跑与可理解等待态

## 目标与背景

YPI Studio 已支持 `implementationPlan`、DAG 依赖、`maxConcurrency`、异步 `ypi_studio_subagent` 子进程与 Studio 面板/Session Widget 投影；但当前“异步/并行”只表示单个成员进程后台运行。主 Chat 回合结束后，子进程 terminal 不会自动唤醒主编排、collect 结果或继续派发 ready subtask，用户必须反复输入“继续/查看进度”。

本需求目标是把“后台异步运行”升级为用户可理解、可等待、可恢复的 Studio implementationPlan 自动续跑能力：用户明确批准后，系统应像非并行流程一样自动推进实现和检查，直到完成或出现真正需要人工决定的边界。

## 用户价值

- 用户批准实现后可以等待系统自动推进，不需要手动轮询每个子任务。
- 并行不再增加认知负担：用户说“开始实现”后，默认自动跑完整个实现计划并继续进入检查；Chat、Studio 面板和 Session Widget 明确显示当前正在后台推进、等待结果，还是需要用户处理。
- 失败、冲突、交互输入、检查门禁等风险边界主动显式暴露，而不是静默卡住。
- 保留 Studio 既有安全门禁：未获用户明确 approval 前不得进入 implementing，不得自动派发 implementer。

## 范围内

1. 为 Studio `implementationPlan` 增加受控自动续跑/continuation orchestrator。
2. 子进程 terminal 后自动记录/collect 结果、更新对应 subtask 状态，并在依赖满足时继续派发 ready subtasks。
3. 严格遵守 `maxConcurrency`、DAG `dependsOn`、已有 task mutation lock 和 subtaskId 单任务派发边界。
4. 在 Chat、Studio Panel、Session Widget、后端 API projection 中表达：orchestrator 状态、running/queued runs、ready/blocked/waiting subtasks、需要关注原因。
5. 支持用户主动停止/恢复后台推进；支持 runtime_lost、失败、waiting_for_user、blocked、checker/local review 等需要人工介入的终止态。
6. 与现有手动 `poll/collect`、同步 subagent、旧任务 projection 兼容。

## 范围外

- 不支持任意 agent 无限后台运行；仅限已保存并经用户批准的 YPI Studio `implementationPlan`。
- 不绕过 `awaiting_approval -> implementing` approval gate，不允许 `override` 启动实现自动化。
- 不让 implementer 一次性执行整个计划；仍保持每次只派发一个 `subtaskId`。
- MVP 不承诺跨 Node 进程/服务重启无损续跑；重启后应能识别 `runtime_lost` 并要求人工处理或显式恢复。
- MVP 不自动决定产品/设计取舍；遇到需要用户确认的问题必须进入 needs_attention。

## 需求与验收标准

### R1 Approval gate 不变

- 当 task 处于 `planning` 或 `awaiting_approval` 时，不得启动 implementer 自动续跑。
- 只有服务器记录到同一 Studio context 的 `approvalGrant`，且 task 合法转入 `implementing` 后，才能启动自动续跑。
- 验收：未批准时调用自动续跑 start 返回 `approval_required/needs_attention`，且无 subagent run 被创建。

### R2 自动续跑启动语义清晰

- 用户批准后，默认自动跑完整个 implementation plan；如果任务计划定义了检查阶段，则实现完成后继续进入 checking 并派发 checker。
- 自动模式启动时，Chat 必须提示“Studio 后台自动续跑中，可以等待；需要关注时会提示”。
- 手动 async 单 run 未开启自动续跑时，Chat 必须提示“仅当前子任务后台运行，后续仍需继续/开启自动续跑”。
- 验收：同一任务能区分 `manual`、`auto_running`、`stopped_by_user`、`needs_attention`、`checking`、`completed`。

### R3 子进程 terminal 后自动推进

- 异步 implementer run terminal 后，系统自动持久化 run terminal 状态，更新对应 subtask：成功为 done，失败/取消为 failed，waiting_for_user 为 blocked/needs_attention。
- 依赖刷新后调用现有 readiness 逻辑，选择 ready subtasks。
- 在可用并发槽内自动 claim 并 dispatch 下一个 implementer run。
- 验收：一个三节点 DAG（A -> B，A -> C，maxConcurrency=2）中，A 成功后无需用户输入自动并行派发 B/C。

### R4 并发与幂等

- 任意时刻 running+queued implementation subtasks 不得超过 plan `maxConcurrency`（现有 1..8 clamp 继续生效）。
- 重复 tick、重复 terminal callback、重复 UI refresh 不得创建重复 run。
- 验收：并发压测或重复调用 orchestrator tick 后，同一 subtask 同一 attempt 只有一个 active/current run。

### R5 可理解等待态/后台态/需要关注态

- Chat 不再只显示“模型已停止”的空闲语义；当 Studio 后台仍在自动续跑时显示独立 Studio background banner/inline status。
- Session Widget 和 Studio Panel 均显示 active runs、ready/blocked/waiting counts、last tick、attention reason。
- 验收：主 agent `agentRunning=false` 且 Studio `auto_running/waiting_runs` 时，用户仍能看到“后台自动续跑中”。

### R6 失败与边界处理

- 子任务失败、runtime_lost、等待用户输入、依赖 blocked、人工 validation 失败或 checker 要求人工决策时，停止自动派发并进入 `needs_attention`。正常 checker 阶段不应被当作异常边界。
- 需要关注态必须包含可读原因、关联 subtask/run、建议动作（查看日志、重试、暂停、恢复、转 checking 等）。
- 验收：失败 run 后不会继续派发依赖 subtask，UI 显示 failed/blocked 和 action hint。

### R7 用户可以打断后台推进

- 用户应能用人能理解的话打断 Studio：例如“先停一下/别继续跑/继续跑/重试这个”。
- 停止后台推进时，不应误标已完成 run，也不应影响已经完成的子任务。
- 继续时必须重新读取 task/progress，并只派发当前 ready subtasks。
- 取消可终止 orchestrator-managed active child runs，并把 orchestrator 置为 `stopped_by_user` 或 `cancelled`。
- 验收：用户说“先停一下”后没有新的 run 被派发；用户说“继续跑”后从未完成 ready subtask 继续。

### R8 兼容与观测

- 旧任务没有 orchestrator 字段时按 manual 显示。
- 现有 `ypi_studio_subagent(action=poll|collect)` 仍可读取 run 投影，不因自动续跑失效。
- task events JSONL 记录 orchestrator start/tick/attention/completed 等关键事件。
- 验收：旧任务详情 API 可正常返回；新字段为可选。

## 已确认产品决策

1. **默认自动推进**：用户批准“开始实现”后默认启动自动续跑；并行任务不能改变原本“开始后持续推进”的行为。
2. **实现后继续检查**：implementation subtasks 全部完成后，系统应自动进入 `checking` 并派发 checker；并行不应让用户额外手动触发检查。
3. **人话控制**：不要把普通用户暴露在 “Abort/managed run” 等内部术语里。Chat 和面板只使用“停止后台推进 / 继续跑 / 取消任务 / 需要你处理”等表达。
4. **Chat 自动唤醒强度**：中间每个子任务完成只更新 Studio 状态；全部完成、进入检查、检查完成或需要用户处理时，向同一 session 显示明确消息。
## 修正后的核心体验

用户批准开始工作后，主 Chat 不能显示为已停止。即使当前没有模型 token 正在输出，只要还有 Studio 子任务在并行执行，Chat 就应显示“正在等待并行子任务完成 / 后台仍在工作”。

并行子任务完成后，主 Chat 必须自动继续推进状态机：收集结果、派发后续子任务、进入 checking、最终完成或请求用户处理。用户不应为了推动状态机而反复输入“继续”。
