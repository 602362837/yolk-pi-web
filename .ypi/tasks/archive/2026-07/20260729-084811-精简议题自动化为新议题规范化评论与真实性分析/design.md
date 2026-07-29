# Design：新议题规范化评论与真实性分析

## 1. 设计结论

将现有 GitHub 自动化从“认领 → Owner 指令 → WorkTree / Studio / Agent → 检查 → PR”替换为单用途的 **Issue Analysis** 服务：

```text
human issues.opened webhook
  → HMAC / body cap / repository.id + installation.id allowlist
  → exclusive delivery + one issue-analysis job
  → 读取当前 GitHub Issue 快照（内存中）
  → 受限只读本地仓库证据分析
  → 严格 schema + controller 证据账本校验
  → 可选分类 label + 一条 canonical Markdown 评论
  → 仅高置信静态反证通过全部门禁时关闭
  → completed_open | completed_closed | inconclusive | blocked
```

该服务**没有**认领、Assignee、Owner 评论命令、代码修改、Git、WorkTree、Studio Task/Session、AgentSession、checker、validation、publisher、branch、push 或 PR 能力。GitHub App 仍是 webhook 与 Issues mutation 的唯一身份；Links OAuth、PAT、本机 `gh`/git credential 均不参与。

## 2. 现状证据与切除点

### 2.1 当前入口和状态远超目标

- `lib/github-automation-runtime.ts` 当前把 `issues.opened/reopened/edited/closed`、`issue_comment`、`pull_request` 纳入 action matrix，并管理 generation/lifecycle。
- `lib/github-issue-triage-runner.ts` 当前约 2,700 行，包含 machine assignee、`ypi:claimed`、启发式分类、Owner exact-comment 命令以及 unattended handoff。
- `lib/github-automation-runner.ts`、`github-automation-session.ts`、`github-automation-worktree.ts`、`github-git-publisher.ts`、`github-pr-lifecycle.ts` 组成实现与发布闭环。
- `lib/github-automation-handler-runtime.ts` 和 scheduler registry 是为动态装载 triage/unattended handler 与 #22 恢复而存在；单用途 analysis runner 不再需要该层。
- `components/GithubAutomationConfig.tsx` 仍暴露 full-agent、Assignee、unattended、WorkTree/Session/PR 双层 Jobs。
- `analyzeUntrustedGithubIssue()` 仅做关键词判断，没有仓库证据，不能作为真实性结论。

### 2.2 保留并收窄

| 保留模块/能力 | 收窄后的职责 |
| --- | --- |
| `lib/github-app-credential-store.ts`、`github-app-credentials.ts` | 本机 App 凭据、env overlay、安全投影；契约不变 |
| `lib/github-webhook-verify.ts` | raw body cap、HMAC 先验签 |
| `lib/github-app-client.ts` | 固定 `api.github.com`、App JWT/installation token、Issues read/write；删除 P1 capability 语义 |
| `lib/github-automation-config.ts` | schema v2、enabled/paused、allowlist、Project Registry 绑定、analysis 并发 |
| `lib/github-automation-store.ts` | v2 delivery/job/result/effect、lease/fence、safe event；v1 只读退役 |
| `lib/github-automation-scheduler.ts` | 只调度 `kind=issue_analysis` v2 job；保留 no-spin/有界 retry/lease |
| `lib/github-automation-comments.ts` | 唯一 `issue_analysis` marker、确定性 Markdown、remote reconcile |
| `lib/github-automation-labels.ts` | 只管理最终批准的分类 label；不碰用户 label/旧 lifecycle label |
| `lib/github-automation-projection.ts` | 最小 config/status/job 安全投影与 `retry` action |
| `lib/github-automation-setup-verify.ts` | App、installation、Issues 权限、allowlist、本地项目可读、模型 readiness、webhook health |
| `app/api/github-automation/**` | webhook、credentials、config、verify、status、job GET/retry |

### 2.3 删除的闭环专属图

实施时先解除引用，再删除：

- `lib/github-machine-assignee.ts`
- `lib/github-owner-intent.ts`
- `lib/github-full-agent-profile.ts`
- `lib/github-automation-handler-runtime.ts`
- `lib/github-automation-notification.ts`
- `lib/github-automation-runner.ts`
- `lib/github-automation-session.ts`
- `lib/github-automation-worktree.ts`
- `lib/github-git-publisher.ts`
- `lib/github-pr-lifecycle.ts`
- `lib/github-risk-policy.ts`
- `lib/github-diff-policy.ts`
- `lib/github-pr-contract.ts`
- `lib/github-validation-broker.ts`
- `.pi/skills/github-issue-auto-implement/`
- unattended / publisher / handler / Session bootstrap / 30142 专属测试与脚本，以及对应 `package.json` scripts

必须保留：

- `lib/worktree-check-*` 与 `scripts/test-worktree-check-execution.mjs`：Studio checker 仍独立使用；
- `lib/ypi-studio-child-session-runner.ts`、`lib/ypi-studio-*`：Studio 通用能力；
- `lib/agent-session-bootstrap-errors.ts`：仍被通用 `agent-session-bootstrap.ts` 使用；
- Project Registry、Session/RPC 基础；
- 对历史自动化 PR 的人工审查规则可以保留在 `pr-review-handle` Skill 内，但不得再依赖已删除 runtime 文件。

## 3. 目标边界

### 3.1 信任边界

| 输入 | 信任级别 | 处理 |
| --- | --- | --- |
| Webhook raw body | 未信任 | 限额后先验签，再 JSON parse |
| `repository.id` / `installation.id` | 验签后可信来源、仍需配置匹配 | immutable id allowlist + exact installation match |
| Issue title/body/labels | 未信任主张 | 仅作为待验证数据；不能影响根路径、模型、预算、工具或 schema |
| Project Registry `projectId` | operator 配置 | 服务端解析 canonical root；浏览器不传绝对路径 |
| 本地文件 | 证据候选，不自动等于事实 | 受限 controller 读取并记账；排除秘密/产物/越界路径 |
| 模型输出 | 未信任建议 | 严格 schema、预算和 evidence ledger 校验；失败安全降级 |
| GitHub mutation 结果 | 远端事实可能未知 | comment/close 未知结果必须 GET/list 回读 |

### 3.2 明确禁止

分析路径不得：

- 创建 `AgentSession`、Session JSONL、Studio Task 或 WorkTree；
- 加载项目 `.pi` extension/skill/prompt/context；
- 暴露 `bash`、`edit`、`write`、Git、网络、子代理工具；
- 运行测试、安装依赖或执行仓库脚本；
- 读取 `.git`、`.ypi`、依赖/构建产物或 secret-like 文件；
- 使用 Issue 文本构造 cwd、绝对路径、URL、argv、环境变量或模型选择；
- 把模型自由文本直接当 close 许可。

这是应用层只读 containment，不是 OS sandbox；不过与旧 full-agent 不同，目标实现不启动仓库代码或 shell，攻击面显著收窄。

## 4. 新契约

### 4.1 配置 schema v2

建议 `config.json` 升级为：

```ts
interface GithubIssueAnalysisConfigV2 {
  schemaVersion: 2;
  enabled: boolean;          // fresh install 与 v1 migration 均为 false
  paused: boolean;           // operator-only stop-bleed，不改变 enabled
  repositories: Array<{
    repositoryId: number;
    fullName: string;
    installationId: number;  // v2 必填
    projectId: string;       // v2 必填
    projectRoot: string;     // server-only，由 Project Registry 派生
  }>;
  analysis: {
    maxConcurrency: number;  // default 2, range 1..8
  };
  revision: string;
  updatedAt: string;
}
```

不再存在：`mode`、`unattended`、`executionProfile`、`riskProfile`、validation commands、file/line publish limits、`baseRef`、`ownerActorIds`、`assigneeIdentitySource`。

**迁移：**首次读取 v1 时在配置锁内生成 v2，并强制 `enabled=false`；只保留可验证的 repository id/fullName/installation/project binding。迁移前把原始非 secret v1 配置原子备份为固定只读 retirement 文件，未知 schema fail closed。不得因为升级自动开启分析或关闭 Issue。

### 4.2 Webhook action matrix

| actor/event/action | delivery | job | scheduler wake |
| --- | --- | --- | --- |
| human `issues.opened` + enabled + allowlisted + exact installation + not paused | exclusive `enqueued` | 至多一个 v2 analysis job | 是 |
| 同 delivery id 重放 | `duplicate` | 0 | 否 |
| 同 repo/issue 的第二个 opened delivery | audit `ignored=analysis_already_exists` | 0 | 否 |
| `issues.reopened/edited/closed/labeled/assigned/...` | bounded audit only | 0 | 否 |
| `issue_comment` 任意 action | bounded audit only | 0 | 否 |
| `pull_request` 任意 action | bounded audit only | 0 | 否 |
| self App / Bot / App / unknown actor | bounded audit only | 0 | 否 |
| disabled / paused / non-allowlist / installation mismatch | signed audit | 0 | 否 |

`issues.opened` 的唯一生命周期键为 `repositoryId + issueNumber + kind=issue_analysis`。不再有 reopen generation、Owner 命令唤醒或 PR lifecycle。

Webhook 请求线程顺序必须是：body cap → HMAC → parse/classify → exclusive durable write → 202。不得在验签前加载 analysis handler、模型或 GitHub installation token，也不得在线程内跑模型。

### 4.3 Job / result schema v2

```ts
type AnalysisPhase =
  | "received"
  | "analyzing"
  | "result_ready"
  | "commenting"
  | "closing"
  | "completed";

type AnalysisStatus =
  | "queued"
  | "running"
  | "retry_due"
  | "blocked"
  | "completed";

type IssueCategory = "bug" | "feature" | "docs" | "question" | "other";
type TruthVerdict = "confirmed" | "not_exists" | "inconclusive" | "not_applicable";
type Confidence = "high" | "medium" | "low";
```

job 只持久化安全字段：repo/issue id、phase/status、attempt、lease/fence、input content hash、Issue `updated_at`、result id/hash、category/verdict/confidence、completeness、budget state、comment/close effect、retry reason/time、created/updated。不得持久化 Issue title/body、prompt、transcript、tool payload、绝对路径或原始 provider 错误。

分析结果 sidecar 可持久化：

- bounded 原因与解决方向（评论所需的产品文案）；
- 相对证据 path、可选行号、文件 hash、ledger evidence id、关系 `supports|contradicts|context`；
- category/verdict/confidence、coverage/completeness、reason code；
- 不含证据原文、文件全文、绝对路径、模型原始 JSON 或 Issue 原文。

v1 job 不进入 v2 scheduler。部署切换时为旧非终态 job 写独立 retirement sidecar（`reason=legacy_pipeline_retired`），不改写/删除旧 job、delivery、event、WorkTree、Task、Session、branch 或 PR。

### 4.4 最小状态机与 disposition

```text
received
  → analyzing
  → result_ready
  → commenting
  → completed(open)
  ↘ closing → completed(closed)

任一可恢复基础设施失败 → retry_due(nextRetryAt)
确定性配置/权限/账本不一致 → blocked
分析证据不足 → completed(inconclusive, open)
```

每次 lease 必须返回：`progressed | waiting | retry_due | blocked | terminal`。保留 lease heartbeat/fencing 与 no-progress 有界保护；删除 handler registry/default handler。scheduler 直接调用唯一 `githubIssueAnalysisJobHandler`，并且只选择 `schemaVersion=2 && kind=issue_analysis`。

`attempt` 仍仅表示 scheduler lease 次数。建议自动 retry 最多 5 次，指数退避加 jitter（例如 5s/30s/2m/10m/30m），之后稳定 `blocked`；GitHub 429 尊重 bounded `Retry-After`。证据不足是正常终态，不应自动重试。

## 5. 真实性分析器

### 5.1 为什么不用现有 WorkTree Check 或 AgentSession

- `worktree-check-*` 包含可执行仓库命令与可写 prepare，目标分析只允许静态读取；复用会扩大权限。
- `AgentSession` 会创建 Session/加载运行时语义，且需要额外排除工具/extension；目标明确要求不建 Session。
- 因此新分析器应通过 provider-aware `ModelRuntime.completeSimple()` 做 **controller-managed JSON 回合**，而不是运行 Agent。

### 5.2 建议模块

| 新模块 | 职责 |
| --- | --- |
| `lib/github-issue-analysis-types.ts` | category/verdict/result/tool request/ledger 严格类型与 parser |
| `lib/github-issue-analysis-evidence.ts` | canonical root containment、只读 `list/find/grep/read`、排除规则、预算与账本 |
| `lib/github-issue-analysis-model.ts` | 选择主默认模型、readiness、bounded JSON 回合、严格输出校验 |
| `lib/github-issue-analysis-runner.ts` | Issue snapshot、分析、降级、comment/close effect、disposition |
| 可选 `lib/github-issue-analysis-close.ts` | close gate、Issue 回读、unknown-effect reconcile |

### 5.3 只读 evidence controller

建议固定 server-owned 预算（P0 不开放给 Issue 或浏览器修改）：

- 总时长 120 秒；
- 最多 20 次 evidence 操作；
- `find/list` 最多枚举 200 个候选；
- `grep` 最多 200 个命中且返回文本总量 ≤64 KiB；
- 最多读取 12 个文件；
- 单文件 ≤64 KiB，总读取 ≤384 KiB；
- 最多 16 条最终 evidence；单条说明 ≤500 字符；
- Issue title ≤512 字符、body 内存输入 ≤16 KiB，超出明确标记 truncated 并禁止 close。

路径规则：

1. 根仅来自已验证 `projectId → canonical projectRoot`；
2. 输入只接受规范化相对路径，拒绝 URL、绝对路径、NUL、反斜线逃逸、`..`；
3. 每次访问 `lstat/realpath`，拒绝 symlink 和 root 外路径；
4. 只读普通文本文件，NUL/binary 拒绝；
5. 排除 `.git/`、`.ypi/`、`node_modules/`、`.next/`、`dist/`、`build/`、`coverage/`、`vendor/`、缓存与临时目录；
6. 排除 `.env*`、`auth.json`、credential/token/secret/private-key、PEM/key/cert、cookie/session 数据等 secret-like basename；
7. 不暴露 Node fs 错误原文或绝对路径给模型/评论/API。

每个成功 read/grep 都生成 controller evidence id、相对路径、行区间、内容 hash、字节数和操作关系；最终引用不存在于账本即 schema 失败。

### 5.4 模型回合

1. 使用 Web provider-aware `ModelRuntime`，P0 推荐跟随 pi 主默认模型；不增加专用 secret 或 provider。
2. 首次 prompt 仅包含 bounded Issue 主张、分类词表、固定工具 JSON schema、预算余额和“未搜索到 ≠ 不存在”。
3. 模型每回合只能返回一个严格对象：`list | find | grep | read | final`；controller 校验并执行，再回传 bounded 结果。
4. 到预算、超时、模型不可用、provider error、非法 JSON、未知 action 时终止并降级 `inconclusive`；原始错误不持久化/不评论。
5. `final` 必须是无额外字段的严格 schema，引用 ledger evidence id；模型不能声明自己完成了未执行的读操作。

### 5.5 controller 后校验

- Feature/Docs/Question 强制 `verdict=not_applicable`，即使模型说“未实现”；
- Bug 允许 `confirmed | not_exists | inconclusive`；
- `confirmed` 必须至少有一个 `supports` 证据；
- `not_exists` 必须 `confidence=high`、未截断/未超预算、coverage complete，并至少有明确 `contradicts` 证据；“grep 无结果”“未找到文件”“模型常识”不计反证；
- evidence path/line 必须存在于账本；
- 任一约束失败统一安全降级 `inconclusive`，而不是尝试修正文案后继续 close。

为降低静态快照误关风险，推荐关闭门禁进一步要求**两个独立反证引用**（例如实现契约 + 测试/文档），或一个明确的单一权威契约；最终阈值需主会话确认。由于目标权限不包含 Contents，系统无法证明本地 checkout 与远端默认分支同步；该残余风险必须在设置页和评论边界说明中可见。

## 6. 分类与 labels

分类与真实性完全分离。建议初始词表：`bug | feature | docs | question | other`。

- comment 必须总是显示分类；
- label mutation 是可选效果，只有最终词表批准后才启用；
- 只新增/替换 YPI 自管 type label，不删除普通用户 label；
- 不再创建或维护 `ypi:claimed`、claim-blocked、awaiting-owner、implementing、pr-open、decision/risk 生命周期；
- 升级不自动清理历史 label，避免改写历史 GitHub 事实。

## 7. Canonical Markdown 评论

### 7.1 Marker

```html
<!-- ypi-github-automation:v3 kind=issue_analysis repo=<repositoryId> issue=<issueNumber> -->
```

identity 固定为 `kind + repositoryId + issueNumber`；不含 delivery、trace、时间、job 或结果 hash。v1/v2 旧 marker 只读，不复用为 v3 authority。

### 7.2 确定性模板

```markdown
<!-- marker -->
## 新议题分析（YPI）

| 项目 | 结果 |
| --- | --- |
| 议题分类 | `bug` |
| 真实性 | `confirmed` |
| 置信度 | `high` |
| 处理结果 | 保持打开 |

### 仓库证据
- `relative/path.ts:12-28` — bounded 说明

### 原因分析
...

### 解决方向
...

### 自动化边界
本结论仅基于当前绑定的本地仓库静态只读证据；不会修改代码、创建分支或 PR。证据不足时保持议题打开。
```

`inconclusive` 用“需要补充的信息”；`not_applicable` 用“需求缺口/建议方向”；不得展示绝对路径、原始片段、prompt、tool payload、stack 或 provider 错误。

comment upsert 复用现有安全基础：semantic body no-op、earliest duplicate authority、unknown POST/PATCH 后 list/read-back，不盲写。

## 8. 自动关闭事务

### 8.1 门禁

仅同时满足时 close：

1. category=`bug`；
2. verdict=`not_exists`、confidence=`high`；
3. Issue 输入未截断，analysis complete，未超预算；
4. controller 验证明确反证阈值；
5. canonical comment 已 `remote_confirmed`；
6. close 前 GET Issue：仍 open，title/body content hash 与分析输入一致；
7. close 前保存的 `updated_at` 是 comment/label 效果后的最终基线，且 job lease/fence、enabled、paused 仍有效；
8. close effect 尚未 `remote_confirmed`。

GitHub comment/label 自身可能改变 Issue `updated_at`，因此不能把 opened 时的 `updated_at` 机械地与 comment 后值相等比较。正确顺序是：分析输入 content hash → comment remote-confirmed → GET 重新确认 title/body hash并建立 pre-close `updated_at` 基线 → 立即 close。GitHub REST PATCH 缺少已确认的原子 content-CAS 时仍存在极小 TOCTOU；不得在未验证条件请求支持时声称原子关闭。

### 8.2 效果顺序与未知结果

1. 首次 canonical comment 写“满足关闭门禁，准备关闭”；
2. GET Issue 再校验；不满足则更新同一评论为“未自动关闭：原因”，终态 open；
3. PATCH Issue `{ state: "closed", state_reason: "not_planned" }`（需用户确认 reason）；
4. PATCH 结果未知时 GET Issue：closed ⇒ `remote_confirmed`；仍 open ⇒ `reconcile_needed/retry_due`，不得立即重复 PATCH；
5. close confirmed 后更新同一 canonical comment 的“处理结果”为“已关闭”；该更新失败只重试 comment，不回滚/重复 close。

如果评论已确认而 close 最终失败，Issue 保持 open，评论必须说明未关闭原因。`confirmed/inconclusive/not_applicable` 永不进入 closing。

## 9. API 与设置页

### 9.1 API

| Route | 目标契约 |
| --- | --- |
| `POST /api/github-automation/webhook` | 仅 human `issues.opened` 建 job；其余 audit-only |
| `GET|PUT|DELETE /credentials` | 保持现有本机凭据安全契约 |
| `GET|PATCH /config` | v2 enabled/paused/analysis concurrency/repositories；无 mode/unattended/baseRef/owner ids |
| `POST /verify` | App + Issues 权限 + installation + allowlist/project read + model readiness + webhook health；零 mutation/job |
| `GET /status` | 最小 readiness + recent analysis jobs |
| `GET /jobs/[jobId]` | 单 job 安全投影 |
| `POST /jobs/[jobId]` | 仅 `{action:"retry"}`；只补未确认阶段，不重跑已确认分析/comment/close |

所有响应 `Cache-Control: no-store`。公网只暴露 webhook。

### 9.2 UI 原型门禁

设置页信息架构与交互显著变化，硬性触发 UI 原型门禁。目标 UI 见 [ui.md](ui.md)。

本 architect 会话被明确禁止再派发成员，且不能冒充 UI 设计员；当前任务目录**没有 UI 设计员 HTML 原型**。因此本 Design 只能定义数据/状态契约，不能作为 UI 审批替代。主会话必须指派 `ui-designer` 产出任务目录内 `.html` 原型并取得用户批准后，才可进入生产实现。

## 10. 兼容性与迁移

- v1 config → v2：原子迁移、备份、`enabled=false`；operator 重验最小权限和关闭口径后手动开启；
- v1 jobs/deliveries/events：保留只读；scheduler 永不选择；旧非终态 job 用 retirement sidecar 投影为 `legacy_pipeline_retired`；
- 历史评论/labels/assignee/PR/branch/WorkTree/Task/Session：不删除、不回滚、不伪造新状态；
- 已打开 PR 人工处理；相关 review Skill 保留历史识别规则；
- v3 analysis comment 不覆盖 v1/v2 triage/status comments；
- rollback：先 `enabled=false`/`paused=true`；代码回滚不删除 v2 状态。旧版本必须对 schema v2 fail closed，不能把 v2 当空配置覆盖。

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 模型把“没找到”当不存在 | controller 后校验；无明确反证一律 inconclusive |
| Issue prompt injection | JSON action allowlist、固定根/预算/模型、无 AgentSession/skills/bash/network |
| symlink/path/secret 泄露 | realpath containment、拒绝 symlink、secret-like denylist、相对路径投影 |
| 本地 checkout 落后远端 | UI/评论明确“当前本地快照”；升级默认关闭；close 阈值从严；这是待确认残余风险 |
| comment 自事件成环 | self/Bot 永久 audit-only；只 opened 建 job；v3 stable marker |
| unknown GitHub write 重复 | effect marker + remote read-back；不盲重发 comment/close |
| legacy runner 继续执行 | scheduler schema/kind gate + retirement sidecar + 删除所有执行入口 |
| 删除误伤 Studio checker | import graph 先解除；`worktree-check-*` 与 Studio runner 纳入禁止删除清单 |
| UI 仍宣传 full-agent | HTML 原型与用户审批为实现前硬门禁；docs/UI 同批收敛 |
| 静态分析无法复现运行时问题 | 结论 inconclusive，要求补充环境/复现；不运行仓库代码 |

## 12. 回滚

1. 运维即时止血：`paused=true` 或 `enabled=false`；不删除 App 凭据/allowlist/audit。
2. 代码回滚：恢复上一版本代码，但不得让旧版本自动覆盖 schema v2；必要时使用迁移前 v1 备份人工恢复且保持 disabled。
3. 已 remote-confirmed 的 comment/close 不做补偿写；close 后人工 reopen 属人工决定，不由 rollback 自动执行。
4. 保留 v1/v2 delivery/job/result/retirement 记录用于审计。
