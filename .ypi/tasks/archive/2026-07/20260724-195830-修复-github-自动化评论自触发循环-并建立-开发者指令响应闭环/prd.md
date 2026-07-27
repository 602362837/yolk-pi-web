# PRD：修复 GitHub Bot 自触发循环并建立 Owner 指令响应闭环

## 目标与背景

GitHub App 自动化必须能消费人类 Issue/评论事件，同时保证自己写出的 assignee、label、comment、PR 状态不会反向生成新业务工作。Owner 发出的受支持命令应在同一 Issue timeline 获得可追踪、可理解且幂等的响应。

### 成功指标

- 单次人类 `issues.opened` 最多产生一个 claim/triage generation。
- 任意 App 自己的 `issues.*` / `issue_comment.*` delivery：可审计，但 job 创建数、generation、scheduler wake、GitHub mutation 均为 0。
- 同一 comment version 重投或并发处理不会重复命令 side effect 或评论 PATCH。
- Owner 的受支持命令能看到 receipt 与下一步；不支持/不满足门禁时看到固定安全理由。

## 用户价值

- 仓库不会因 Bot 自身评论陷入 API/CPU/磁盘风暴。
- Owner 不必猜测“@/评论是否被看到、是否执行、为什么没执行”。
- Operator 可从 delivery/job safe audit 与 Issue timeline 同时确认状态。
- 任何评论文本都不能绕过 owner、claim、risk、global paused、validation 或 publisher 门禁。

## 范围内

### R1. 自事件隔离

- verified payload 提取 `sender.type`、comment id/version、`performed_via_github_app.id` 等安全字段。
- 优先以 `performed_via_github_app.id == effective App ID` 判定 definite self；对 `Bot/App` actor 采用保守非业务处理兜底。
- self/bot delivery 仍 exclusive-create 并记录 fixed ignore reason，但不创建/复用 job、不更新 active delivery、不 wake scheduler。

### R2. 事件动作矩阵

- `issues.opened`：允许创建首个 triage job。
- `issues.reopened`：允许明确的新生命周期 reconciliation/generation。
- `issues.edited`：只在已有 Issue state 下触发受限 re-triage，不重新 claim、不无条件新 generation。
- `issues.closed`：只做 lifecycle reconciliation；不重新 claim/triage。
- `issues.assigned/labeled/...`：审计忽略。
- `issue_comment.created/edited`：仅人类 actor 可进入 exact-comment command path。
- `issue_comment.deleted`：审计/receipt superseded reconciliation，不授权新 side effect。

### R3. Generation 与 durable 状态

- terminal job 遇到任意 webhook 不再自动 generation++。
- 新 generation 只来自 `opened/reopened` 或显式、状态允许的 retry/restart。
- `needs_info` 需保留可沟通的 parked state，而不是靠任意评论创建新 claim generation。
- 全局 paused 优先：记录 delivery，不解析/执行命令，不可由 Issue 评论解除。

### R4. Canonical comment 幂等

- marker 身份稳定绑定 `kind + repositoryId + issueNumber`，不得包含每次变化的 trace。
- 查找 marker 必须校验 repo/issue/kind；兼容已有 v1 marker。
- body 语义相同必须零 PATCH；未知 POST/PATCH 结果通过 re-list marker reconcile。
- 并发/崩溃重试不得制造重复 canonical comments；若历史已有重复，选定 authority，不自动删除用户内容。

### R5. Owner exact-comment 协议

- 命令必须绑定 webhook comment id、sender id/type、updatedAt/body hash；worker 只 GET 该条 comment，不扫描“任意最近肯定评论”。
- worker 回读版本与 delivery 不一致时标记 superseded，等待/处理最新 delivery。
- Owner 身份仍按 user-owned repository owner id 或 org `ownerActorIds` 验证；Bot 永不授权。
- quote/code/HTML comment/negation/question 规则保留并扩展到命令 parser。
- 同一 comment version 仅处理一次，durable idempotency key 不存正文。

### R6. 推荐的 Phase 1 指令与边界

待用户确认命令目标后，建议支持：

| 命令 | 作用 | 关键门禁 |
| --- | --- | --- |
| `状态` | 只读返回当前 phase/阻塞/下一步 | owner + exact comment |
| `重新评估` | 基于最新 Issue title/body 重新跑 deterministic triage | complete claim；不注入评论自由文本 |
| `采纳/可以做/开始实现` | 沿用 owner adoption | recommendation=yes、Issue open、complete claim、policy gates |
| `重试` | 唤醒同 generation 的 retryable/blocked job | 不注入评论文本；不可绕过 policy |
| `暂停` | 请求单 job 在 checkpoint 暂停 | 不 kill 运行中命令；不改 global paused |
| `继续` | 恢复单 job | global paused=false 且状态允许；评论本身不能解除全局暂停 |

不支持的自由文本只返回安全说明，不成为 shell、prompt、validation、branch、remote 或 publisher 指令。

### R7. Issue 可观察响应闭环

- 初始 triage comment 明示支持的命令目标、示例和安全边界。
- 每个 owner actionable comment 有 canonical receipt：comment reference、识别命令、`accepted/rejected/ignored/superseded`、当前状态、reason code 的中文解释、下一步。
- 长流程使用单个 canonical status comment，仅在 phase/结果发生语义变化时更新。
- 不回显原始 comment body，不显示 token/path/prompt/transcript。
- 非 owner/第三方 Bot 默认不产生公共回复，防止 spam；仅 safe audit。

### R8. 关闭与必要事件

- Issue closed 不触发新 claim/triage/comment rewrite。
- 对尚未发布的 active implementation，推荐进入 `blocked/paused: issue_closed`，保留 durable state/WorkTree，等待 owner 在 reopen 后显式继续。
- PR lifecycle 现有 merged/closed-unmerged reconciliation 不回归。

### R9. 测试与文档

- 扩展 `test:github-automation` 覆盖 self-loop、action matrix、generation、exact comment、no-op PATCH、receipt。
- 扩展 unattended tests 覆盖 retry/pause/continue 与“不注入评论文本”。
- 更新 architecture、api、library、integration setup、troubleshooting。

## 范围外

- 不解除或自动修改全局 paused。
- 不允许 Issue 评论更改 allowlist、App 凭据、validation commands、branch/remote、risk policy、publisher。
- 不把自由文本评论直接追加到 agent prompt/task instructions。
- 不修改 Web Settings UI、status API 的展示结构（若实现发现必须修改，重新走 UI 原型审批）。
- 不删除 g1–g80 历史 delivery/job/event 审计，不重写历史 GitHub 评论。
- 不自动关闭/reopen Issue，不自动 merge PR。

## 验收标准

1. 模拟 App 创建/编辑 canonical comment 100 次，只产生 100 条 ignored delivery；job/generation/remote mutation 不变。
2. `issues.labeled/assigned/closed` 不产生新的 triage generation；closed 执行一次安全 lifecycle reconciliation。
3. 同一人类 comment delivery 重投为 duplicate；同一 body 的 edited version不重复 side effect。
4. 人类 owner 的 exact comment command 被执行一次并收到一个可更新 receipt；旧 comment 不会被无关事件重新命中。
5. recommendation != yes、Issue closed、claim incomplete、non-owner、Bot、global paused 均无法产生 ownerAuthorization/implementation。
6. canonical body 相同不调用 PATCH；marker trace 变化不再导致编辑。
7. focused tests、lint、tsc 通过；真实 GitHub smoke 必须在用户允许且 global paused 明确由用户处理后才进行。

## 未决问题

- 命令 target 采用 `@AppBot`、`/ypi`，还是拦截 `@machine-assignee`？推荐前两者，避免劫持真人 mention。
- 是否在 Phase 1 开放 `暂停/继续` 评论命令？推荐开放 per-job 命令，但 UI 原型必须清楚区分 global paused。
- owner 评论是否可作为需求补充数据？推荐 Phase 1 否，只允许显式 `重新评估` 读取更新后的 Issue body。
- closed 时 active job 是 `blocked` 还是 `cancelled`？推荐 `blocked`，保留恢复能力。
