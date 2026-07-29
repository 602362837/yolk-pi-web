# PRD：新议题规范化评论与真实性分析

## 目标与背景

现有 GitHub 自动化包含认领、Owner 命令、无人值守实现、检查和 PR 发布，运行面和风险均明显超出当前需求。本次目标是把产品收敛为“新 Issue 的仓库证据分析器”，让维护者快速看到统一分类、问题真伪、原因和解决方向，同时彻底移除代码实现与发布能力。

## 用户价值

- 议题创建者立即得到统一、可读、不过度承诺的分析反馈；
- 维护者减少初筛工作，不需要监督自动认领或自动 PR；
- 自托管部署只授予 Issues 权限，降低 GitHub 与主机侧风险；
- 分析结果可审计、可重试、不会因 Bot 自己的评论或关闭事件形成循环。

## 范围内

- GitHub App `issues.opened` webhook；
- allowlist 仓库与本地 Project Registry 项目绑定；
- Issue 类型分类；
- 只读仓库证据分析；
- 结构化结果与规范 Markdown 评论；
- 高置信“问题不存在”自动关闭；
- durable delivery/job、幂等、重试、暂停、状态摘要；
- 设置页与运维文档收敛。

## 范围外

- 自动认领、Assignee、本机 `gh` 身份；
- `issue_comment` 指令、Owner 采纳/暂停/继续；
- 对 `issues.edited/reopened` 自动重新分析；
- 修改 Issue title/body；
- 修改仓库文件、执行 shell、安装依赖、联网检索；
- WorkTree、Studio、Session、full agent、checker、validation；
- branch/commit/push/PR/merge/release；
- 重写或删除历史审计、历史评论、旧 PR、旧 WorkTree/Task/Session。

## 核心概念

### 分类（建议初版）

`bug | feature | docs | question | other`

分类可映射到 YPI 自管 label，但不得删除非 YPI 用户标签。最终词表需结合尚未提供的 GitLab 参考文档确认。

### 真实性结论

| 结论 | 含义 | Issue 动作 |
| --- | --- | --- |
| `confirmed` | 当前仓库证据支持问题存在 | 评论，保持 open |
| `not_exists` | 当前仓库证据明确反驳问题 | 评论确认后，在严格门禁通过时 close |
| `inconclusive` | 证据不足、环境相关、分析失败或覆盖不完整 | 评论，保持 open |
| `not_applicable` | Feature/Docs/Question 不适用缺陷真伪 | 评论，保持 open |

## 需求与验收标准

### R1 — 仅新 Issue 触发

- 仅人类 `issues.opened` 可创建分析 job。
- `reopened/edited/closed/labeled/assigned`、`issue_comment`、`pull_request`、Bot/App/unknown actor 均不得创建或唤醒业务 job。
- 非业务事件可保留 bounded safe audit。

**验收：**同一 Issue 的评论、label、关闭、重开和 Bot 自事件不会增加 job/generation 或重复调用模型。

### R2 — Webhook 安全入口

- raw body 限额；JSON parse 前验证 `X-Hub-Signature-256`；
- allowlist 以 immutable `repository.id` 为准，并核对 installation id；
- 公网只暴露 webhook 路由；管理 API 保持本机/VPN/受控访问；
- 请求线程只落 durable delivery/job 并返回 202，不执行模型或 GitHub mutation。

### R3 — GitHub App 最小权限

- 要求 `Metadata: read`、`Issues: read & write`；
- 不要求 Contents、Pull requests、Actions、Secrets、Administration；
- 不读取 Links OAuth，不接受 PAT，不调用本机 `gh`。

### R4 — 分类

- 对每个新 Issue 产出且仅产出一个分类；
- 分类与真实性分离，Feature“尚未实现”不能映射为 `not_exists`；
- 分类结果可以写 YPI 自管 label，不能删除用户标签。

### R5 — 只读仓库真实性分析

- Issue title/body 只作为不可信“待验证主张”，不能改变工具权限、根目录、模型、超时或输出 schema；
- 分析器只允许在绑定项目根内使用 contained `read/grep/find/ls`；禁止 `bash/edit/write`、项目 extensions/skills、网络、Git mutation 和子代理；
- 排除 `.git`、`.ypi` runtime、依赖/构建产物及 secret-like 文件；设置总时长、读取文件数、单文件/总字节和工具调用预算；
- 结果必须通过严格 schema 和证据账本校验；引用的相对路径必须实际读取过。

### R6 — 证据优先与安全降级

- 未找到匹配、模型自然语言断言、路径未核验、预算耗尽、模型不可用或输出不合法，均不得单独得到可关闭的 `not_exists`；
- 不满足关闭门禁一律降级为 `inconclusive` 并保持 open；
- 不在评论中泄露绝对路径、secret、模型 prompt、tool payload、堆栈或原始 provider 错误。

### R7 — 规范 Markdown 评论

每个 Issue 最多一条 canonical 分析评论，固定包含：

1. `分析结论`；
2. `议题分类`；
3. `真实性` 与置信度；
4. `仓库证据`（相对路径/可选行号 + bounded 说明）；
5. `原因分析`；
6. `解决方向` 或 `需要补充的信息`；
7. `处理结果`（保持打开/已关闭/未自动关闭原因）；
8. 自动化边界说明。

评论使用 stable marker `kind=issue_analysis + repositoryId + issueNumber`。语义相同不得 PATCH；未知 POST/PATCH 结果先按 marker/body 回读。

### R8 — 自动关闭门禁

只有同时满足以下条件才允许关闭：

- 分类为 `bug`；
- verdict=`not_exists`、confidence=`high`；
- 分析完整且未超预算；
- 至少存在经账本核验的明确反证，不是单纯“没搜到”；
- canonical 评论已 remote-confirmed；
- 关闭前重新 GET Issue，仍为 open，且 `updated_at`/内容 hash 与分析输入一致；
- job lease/fence 仍有效，尚无已确认 close effect；
- 配置仍 enabled 且未 paused。

关闭采用 GitHub Issues PATCH，并在支持时写 `state_reason=not_planned`。未知结果必须 GET 回读，禁止盲目重复 PATCH。

### R9 — confirmed 输出

- `confirmed` 必须保持 Issue open；
- 评论须说明支持结论的证据、可能原因和非执行性的解决方向；
- “解决方向”不是 Implementation Plan，不启动任何代码工作。

### R10 — inconclusive / not_applicable

- 两者都保持 open；
- `inconclusive` 明确列出缺失证据/复现信息；
- `not_applicable` 对 Feature/Docs/Question 描述需求缺口和建议方向，不宣称缺陷存在或不存在。

### R11 — 幂等与防成环

- `deliveryId` exclusive-create；一个 `repositoryId + issueNumber` 只允许一个 opened 分析生命周期；
- stable comment marker + semantic no-op；close effect 持久化并回读；
- App/Bot/unknown actor 永久 audit-only；
- self-generated comment/label/close 事件即使误订阅也不得建 job、唤醒 scheduler 或改 generation；
- retries 复用同一 job，不重复模型分析或已确认远端副作用。

### R12 — 最小 durable 状态机

建议状态：

```text
received → analyzing → result_ready → commenting → [closing] → completed
                    ↘ retry_due / blocked
```

- `completed_open`、`completed_closed`、`inconclusive` 为明确终态语义；
- 每次 lease 必须返回 progressed/waiting/retry_due/blocked/terminal；
- 无进展不得立即重新排队形成自旋；
- 分析并发采用 `triage.maxConcurrency`（默认 2，最大 8）。

### R13 — 设置页收敛

设置页保留：

- 本机 GitHub App 凭据；
- Setup checklist 与验证；
- 允许仓库 + 本地项目绑定；
- 启用/全局暂停；
- 分析模型 readiness（不展示 secret）；
- 最近分析任务（分类、verdict、评论/关闭状态、retry）。

移除 Assignee、claim、Owner commands、unattended 模式、full-agent 风险、WorkTree/Session/PR 双层状态及 publish policy。

### R14 — 旧数据与调度器退役

- 新 scheduler 只选择新 schema/handler kind 的 analysis job；
- 旧非终态 job 在部署切换时标记为只读 retired/cancelled，reason=`legacy_pipeline_retired`，不得继续认领、实现或发布；
- 不自动删除历史 deliveries/jobs/events、旧评论/labels/assignee、WorkTree、Studio Task/Session、branch 或 PR；
- 已打开 PR 仍由人工处理；
- 升级后建议强制 `enabled=false`，由 operator 检查最小权限/新关闭策略后重新启用。

### R15 — 删除边界

- 删除 GitHub 闭环专属 runner/session/worktree/publisher/policy/owner-intent/machine-assignee/PR lifecycle 代码、路由分支、UI、测试和文档；
- 保留 Studio 独立使用的 `worktree-check-*`、YPI Studio runner、Project Registry、Agent Session 基础模块；
- `agent-session-bootstrap-errors.ts` 仍被通用 `agent-session-bootstrap.ts` 使用，不得因 GitHub session 删除而误删。

### R16 — 可观测性与隐私

- 状态仅投影 job id、repo/issue、阶段、分类、verdict、confidence、retryability、comment/close effect、时间与安全 reason code；
- 不投影 Issue body、证据原文、绝对路径、prompt、transcript、模型原始输出或凭据；
- safe event 可记录计数和相对证据 path hash，但不得记录内容。

## 非功能要求

- 全部 API `Cache-Control: no-store`；
- 配置继续使用 revision CAS、0700/0600、atomic write；
- 固定 GitHub API host、manual redirect、超时与响应大小上限；
- 分析模型失败不会阻断 webhook 接收，也不会关闭 Issue；
- 不修改现有用户标签和历史 Issue 内容。

## 未决问题

1. GitLab 分类参考文档内容及最终 label 词表；
2. 是否接受四态真实性模型；
3. `not_exists` 是否使用 `state_reason=not_planned`；
4. 是否保留“最近分析 + retry”设置区，还是只保留服务端审计；
5. 旧配置是否在升级时强制关闭（推荐）；
6. 分析模型跟随主模型，还是增加专用模型配置（推荐 P0 跟随主模型 + readiness，避免扩大设置项）。
