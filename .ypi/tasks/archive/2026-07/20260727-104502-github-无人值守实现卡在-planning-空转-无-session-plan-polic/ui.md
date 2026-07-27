# UI 方案：GitHub 无人值守 Job 状态真实性与可观测性

## UI Summary

### 设计目标

修正 Jobs 面板把 durable scheduler 的 `running / planning / attempt` 误呈现为 Agent 正在工作的语义。operator 应先看到“Agent 是否真实启动”，再看到 scheduler、policy、checkpoint、重试与下一步。

核心原则：

1. **双层状态，不再共用一个 running。** 每个 job 同时展示“Agent 运行状态”和“调度状态”。
2. **Session 是运行真实性边界。** 没有 session 时必须直接写“尚未启动 Agent”，不得用 planning、running 或“第 N 次”暗示 Agent 已执行。
3. **attempt 改称“调度尝试”。** 另列“Agent 启动次数”“有效进展”“无进展重试”，三者不得互相替代。
4. **阻塞可定位、下一步可执行。** 展示 checkpoint、blockedAtLayer、reason、next retry、last meaningful progress、session availability 与下一步。
5. **服务端 projection 是唯一事实源。** 前端不根据 `phase/status/attempt` 自行推断 session、心跳、有效进展或阻塞层。
6. **不绕过策略。** 业务操作只复用现有 `retry / pause / resume`；不设计“跳过策略”。

### 用户路径

1. operator 进入 Settings → GitHub 自动化 → Jobs。
2. 先读全局 scheduler 心跳与按真实性拆分的计数：调度中、策略阻塞、等待重试、Agent active、终态。
3. 在 job 首屏并列查看：
   - Agent 运行状态：尚未启动 / 实现中 / 检查中 / 发布中 / 已完成；
   - 调度状态：已领取、backoff、lease 活跃、终态。
4. 展开 job，查看阶段轨道、checkpoint、阻塞层、session、进展与安全工作区标签。
5. 按服务端 action availability 执行重试、暂停或恢复；确认后显示处理中和刷新反馈。
6. 刷新失败时保留最后安全快照，但显式标“可能过期”并禁用 mutation。

### 信息架构

- **页头**：Jobs 运行实况、状态口径、scheduler 心跳。
- **面板工具栏**：列表状态、只读刷新。
- **聚合计数**：调度中 / 策略阻塞 / 等待重试 / Agent active / 终态。
- **快速筛选**：全部、策略阻塞、等待重试、Agent active、检查/发布、终态。
- **Job 摘要（首屏真实性）**：Issue、仓库、trace、Agent 运行状态、调度状态、关键 badge、详情入口。
- **Job 详情（诊断闭环）**：六阶段轨道、事实字段、下一步、兼容操作、次级原始态。

## HTML Prototype

自包含原型：

[`github-unattended-job-observability-prototype.html`](./github-unattended-job-observability-prototype.html)

原型可直接浏览，包含：

- 明暗主题切换；
- 390px 窄屏预览；
- 状态筛选与详情展开；
- 正常、加载、空、刷新失败/旧快照；
- retry / pause 确认和受理反馈；
- policy blocked 且无 session 的 #22；
- `retry_due / backoff` 且无 session；
- Agent session active / implementing；
- 检查通过 / 发布中；
- completed / terminal。

原型中的枚举和值仅用于表达信息层级。实现时必须使用后端安全 projection，不得把示例 reason/checkpoint 当作既有 wire contract。

## 状态与文案

### 双层状态口径

| 层级 | 回答的问题 | 推荐主文案 | 禁止替代文案 |
| --- | --- | --- | --- |
| Agent 运行状态 | Agent 是否真实创建 session 并开始工作 | 尚未启动 Agent / 实现中 / 检查中 / 发布中 / 已完成 | 仅写 running / planning |
| 调度状态 | durable job 当前如何被 scheduler 处理 | 已领取、等待重试、Backoff 至…、Lease 活跃、终态 | 将“调度中”写成“Agent 运行中” |
| 次数 | scheduler 与 Agent 各执行了什么 | 调度尝试 N / Agent 启动 N / 无进展重试 N | “第 N 次” |
| 阻塞 | 卡在哪个产品层 | 阻塞层：规划策略门禁 | 只显示 reason code 或 phase |

### 核心文案

- 无 session：**“尚未启动 Agent”**，辅文案“Session 不存在”。
- policy blocked：**“策略阻塞”**，并显示“阻塞层：规划策略门禁”。
- retry due：**“等待重试”**，调度层显示“Backoff 至 HH:mm”。
- active：**“Session 可用”**，运行层显示“实现中 / 检查中 / 发布中”。
- completed：运行层“已完成”，调度层“终态 · 不再调度”。
- attempt：统一为“调度尝试 N”。
- no-progress：统一为“无有效进展 ×N”或详情“有效进展 0 · 无进展重试 N”。
- stale：**“以下为 HH:mm:ss 的最后安全快照，已标记‘可能过期’；重试 / 暂停 / 恢复暂不可用。”**
- policy 下一步：**“按策略要求补齐规划条件，再重试。”** 辅文案明确本页不能跳过策略。

### Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| #22 policy blocked、无 session | “策略阻塞”“尚未启动 Agent”；策略节点阻塞；session 不存在 | 展开原因；在条件修复后重试 | retry 确认；受理后刷新真实状态 |
| retry_due / backoff、无 session | “等待重试”；next retry；无进展重试次数 | 等待或使用服务端允许的“重试” | 不承诺绕过 gate；重新进入安全 checkpoint |
| Agent implementing | “实现中”“Session 可用”；lease/heartbeat；最近有效进展 | 可按服务端 availability 暂停 | 暂停在安全 checkpoint 生效，不强杀 Git 命令 |
| checking | 阶段轨道“检查”高亮；session 仍可用；验证进展 | 等待或暂停 | checkpoint 更新，不提前宣称发布 |
| publishing | “发布中”；检查节点已完成；发布节点高亮 | 等待或暂停 | 已产生的外部副作用不承诺回滚 |
| completed / terminal | “已完成”“终态 · 不再调度”；PR/审计摘要 | 查看既有 PR | 无 retry/pause/resume；保留安全摘要 |
| paused | 运行层按 session 事实显示；调度层显示“已暂停” | 恢复 | 重新入队到下一个安全 checkpoint |
| 加载 | job skeleton 与“读取安全 projection” | 等待 | 不显示伪造的旧状态 |
| 空 | “当前没有 job”及不会回扫历史 Issue 的说明 | 刷新 | 只读刷新，不 enqueue |
| 刷新失败且有快照 | 错误 notice、每卡“可能过期” | 刷新 | mutation 禁用；成功后移除 stale 标记 |
| 首次加载失败 | “无法加载 job 列表”错误态 | 重试刷新 | 不展示空状态，避免把故障误判为无 job |
| action busy | 目标按钮“处理中…”、`aria-busy=true` | 等待 | 成功 / partial / 失败使用现有 notice + toast 语义 |
| action unavailable | 不渲染，或禁用并给出服务端 reasonCode | 查看原因 | 不创造替代业务动作 |
| 权限不足 / stale / revision conflict | mutation 全部禁用 | 刷新或修复上游条件 | 保留只读安全摘要 |
| 长标题 / 长 reason | 标题单行省略并保留完整 title；详情文本换行 | hover/focus 或展开 | 不挤压状态列 |
| 窄屏 | 摘要改为单列；事实卡 2 列/极窄 1 列；按钮等宽 | 垂直浏览 | 不出现页面横向滚动；阶段轨道可局部横滚 |

## 组件与样式复用

### 推荐复用

- 保留 `GithubAutomationConfig` 的 jobs section、fetch/poll/generation guards 和 `runJobAction()`。
- 继续使用：
  - `.github-automation-card*`
  - `.github-automation-pill*`
  - `.github-automation-button*`
  - `.github-automation-notice*`
  - `.github-automation-count*`
  - `.github-automation-empty*`
  - `.github-automation-skeleton*`
- 在现有 `.github-automation-job*` 下扩展语义化子组件，不引入第二套 Settings 卡片和按钮语言。
- 明暗主题只使用 `--bg / --bg-panel / --bg-subtle / --border / --text / --text-muted / --text-dim / --accent` 及既有 success/warning/danger fallback。

### 建议组件边界

1. `GithubAutomationJobStatusPair`
   - Agent 运行状态；
   - scheduler 调度状态；
   - session availability；
   - heartbeat/lease 安全摘要。
2. `GithubAutomationJobProgressRail`
   - 调度 → 策略 → Session → 实现 → 检查 → 发布；
   - 只消费服务端映射后的当前/完成/阻塞状态。
3. `GithubAutomationJobFacts`
   - checkpoint / blockedAtLayer / reason / nextRetry / lastMeaningfulProgress / session / retry progress / workspace label。
4. `GithubAutomationJobActions`
   - 只消费既有 `actions[]`；
   - 继续调用 `POST /api/github-automation/jobs/[jobId]` 的 retry/pause/resume。

这只是实现拆分建议，不要求改变当前单文件组件边界。

## 安全投影要求

- 允许仓库名、Issue/PR 编号、trace、短 session 标识等必须继续走现有安全 projection。
- 工作区仅在本机管理 UI 显示安全策略允许的**工作区标签**，例如“项目显示名 · WT issue-24”。
- 不在安全 projection 新增或显示绝对路径、Issue 正文、评论、secret、PEM 或任意原始 Agent 内容。
- `lastMeaningfulProgress` 应是服务端生成的 allowlisted 摘要与时间，不直接投影 tool input/result、命令、正文或路径。
- 原始 `status / phase / attempt` 仅可在展开后的次级诊断中出现，并附口径说明；不得作为用户主状态。

## 响应式与 A11y

- `≤640px`：job 摘要四列改为单列；详情事实卡由 4 列变 2 列；极窄屏变 1 列。
- 阶段轨道在窄屏只允许自身横向滚动，不让 Settings 页横向溢出。
- job 标题使用省略与可访问全称；reason/next step 允许任意换行。
- 状态不可只依赖颜色：每个 dot/pill 同时带可读文本。
- 展开按钮使用 `aria-expanded` + `aria-controls`；详情保留文档顺序。
- scheduler 心跳与 action 结果使用 `role=status` / polite live region；错误使用 `role=alert`。
- action busy 使用 `aria-busy`，防止重复提交。
- 确认对话框沿用 `AppPrompt` 的焦点陷阱、Escape、焦点恢复与 inert 规则。
- `prefers-reduced-motion` 禁用 skeleton/状态动效；信息不能依赖动画。
- 触控按钮不低于现有 30–34px 密度；窄屏业务按钮等宽铺开。

## UI Checks

- [ ] #22 首屏明确“策略阻塞”“尚未启动 Agent”“Session 不存在”。
- [ ] 任意无 session job 都不会显示“Agent 运行中”“实现中”或“第 N 次执行”。
- [ ] `attempt` 只显示为“调度尝试 N”。
- [ ] Agent 启动次数与无进展重试次数来自服务端事实，分别显示。
- [ ] implementing/checking/publishing 在 Agent 运行层和阶段轨道中可区分。
- [ ] checkpoint、blockedAtLayer、reason、next retry、last meaningful progress、session availability 均有明确空值口径。
- [ ] policy blocked 没有“跳过策略”按钮。
- [ ] retry/pause/resume availability、确认文案与现有 API 语义一致。
- [ ] 刷新文案明确“不唤醒 scheduler / 不 enqueue job”。
- [ ] stale 时保留最后安全快照但禁用 mutation。
- [ ] 工作区只显示经过策略允许的本机标签，无绝对路径。
- [ ] 长标题、长 reason、无 PR、无 session、无进展、终态均不破版。
- [ ] 375–390px 下无页面级横向滚动，操作按钮可触达。
- [ ] 键盘可展开、筛选、确认/取消；焦点环可见；状态不只靠颜色。
- [ ] 明暗主题均复用现有 token，warning/danger 对比度可读。

## 未决设计决策

以下需要架构师/后端在实现前确认，UI 不应自行推断：

1. **安全 projection 字段契约**：`schedulerState`、`agentExecutionState`、`sessionAvailability`、`blockedAtLayer`、`lastMeaningfulProgressAt/summary`、`meaningfulProgressCount/noProgressRetryCount`、`workspaceLabel` 的最终字段名、枚举与缺省值。
2. **心跳口径**：scheduler heartbeat、job lease/session heartbeat 的过期阈值和 warning/error tone 应由服务端还是前端判断；建议服务端直接给安全派生态。
3. **#22 的 retry availability**：策略条件未变化时是否允许手动 retry，或只展示不可用原因；按钮必须服从 `actions[]`。
4. **Session 入口**：Settings 是否允许从安全短 session 标识打开本机会话审计。原型只展示 availability，不新增深链业务动作。
5. **终态矩阵**：completed、failed、cancelled、policy-terminal、PR-open 是否共用“终态”，以及各自是否允许 retry，需以后端 durable job 规则为准。
6. **安全进展摘要词表**：哪些 checkpoint/进展文案允许进入浏览器，尤其不得泄露命令、tool payload、Issue 正文或绝对路径。

## Review Request

请用户/主会话审阅上述 HTML 原型，重点确认：

- 双层状态的信息优先级；
- #22 “策略阻塞 / 尚未启动 Agent”的文案；
- “调度尝试 / Agent 启动 / 无进展重试”的拆分；
- 展开详情密度与窄屏布局；
- 未决 projection 与 action availability 契约。

**当前仅完成 UI 规划与 HTML 原型，等待用户审批；未批准前不得进入生产实现。**
