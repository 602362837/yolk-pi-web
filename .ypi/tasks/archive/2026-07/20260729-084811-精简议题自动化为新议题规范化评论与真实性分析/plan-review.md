# Plan Review：新议题规范化评论与真实性分析

## 当前审批状态

**尚未达到可审批 / awaiting_approval 门禁。**

本任务会重构 `components/GithubAutomationConfig.tsx` 的信息架构和交互，已触发 UI 原型硬门禁。当前任务目录只有 [ui.md](ui.md) 的原型任务说明，**没有 UI 设计员交付的独立 HTML 原型，也没有用户审批记录**。

architect 本轮被明确禁止继续派发 Studio 成员，且不能冒充 UI 设计员产出原型。主会话下一步必须先指派 `ui-designer`，产出任务目录 `.html` 原型并请求用户审批；完成后再更新本文件为可审批状态、保存 implementationPlan，并转入 `awaiting_approval`。在此之前不得进入生产实现。

## PRD 摘要

完整内容：[prd.md](prd.md)

- 只处理人类新建的 `issues.opened`；其他 Issue action、所有 `issue_comment`、`pull_request`、self/Bot/unknown actor 仅安全审计。
- 对新 Issue 分类为 `bug | feature | docs | question | other`。
- 只读分析当前 Project Registry 绑定的本地仓库，真实性为：
  - `confirmed`：证据支持问题存在，保持 open；
  - `not_exists`：证据明确反驳问题，仅严格高置信门禁后 close；
  - `inconclusive`：证据不足/环境相关/分析失败，保持 open；
  - `not_applicable`：Feature/Docs/Question 不适用缺陷真伪，保持 open。
- 每个 Issue 最多一条 stable-marker canonical Markdown 评论，可幂等更新。
- 删除自动认领、Assignee、`ypi:claimed`、Owner 评论指令、自动实现、WorkTree/Studio/Session/checker/validation、branch/push/PR/merge/release。
- GitHub App 只需 Metadata read + Issues read/write；只订阅 Issues；不使用 Links、PAT 或本机 `gh`。
- 旧配置升级后强制 disabled；旧 job 只读 retired，不删除历史远端/本地副作用。

## UI 摘要

完整门禁：[ui.md](ui.md)

目标设置页保留：

1. 本机 GitHub App 凭据与高级 env 来源说明；
2. Setup checklist / 验证；
3. 允许仓库 + Project Registry 本地只读证据绑定；
4. 单一 enabled 与全局 paused；
5. 只读分析和严格关闭边界说明；
6. 最近分析（分类、真实性、comment、close、retry）；
7. loading/missing/stale/conflict/queued/analyzing/commenting/closing/completed/inconclusive/retry/blocked 与窄屏状态。

必须移除 Assignee、claim、Owner commands、mode segmented control、unattended/full-agent 风险、WorkTree/Session/Agent/PR 双层 Jobs。

**待交付：**UI 设计员任务目录独立 HTML（建议 `github-issue-analysis-settings-prototype.html`）。纯 Markdown 不满足门禁。

## Design 摘要

完整内容：[design.md](design.md)

### 目标架构

```text
HMAC-verified human issues.opened
  → exclusive v2 delivery + one issue_analysis job
  → contained read-only list/find/grep/read evidence controller
  → ModelRuntime.completeSimple strict JSON rounds
  → controller ledger/schema validation
  → one v3 issue_analysis Markdown comment
  → optional strict close gate
  → completed_open | completed_closed | inconclusive | blocked
```

### 安全/幂等关键点

- webhook 顺序固定为 body cap → HMAC → parse → durable write → 202；请求线程不跑模型。
- 不创建 AgentSession，不加载项目 skills/extensions，不暴露 bash/edit/write/Git/network/subagent。
- 只接受 Project Registry 派生根；拒绝绝对路径、`..`、symlink、binary、secret-like 文件以及 `.git/.ypi/依赖/产物`。
- 固定时长、操作、文件和字节预算；模型引用必须匹配 controller evidence ledger。
- “未搜索到”不构成反证；非法输出、预算耗尽、模型失败全部降级 `inconclusive`。
- v3 marker identity 仅为 `kind + repositoryId + issueNumber`；semantic same 不 PATCH；unknown write 先远端回读。
- close 前必须是 bug/not_exists/high/完整反证/comment confirmed/content hash 未变/fence 有效/enabled 且未 paused。
- comment/label 可能改变 GitHub Issue `updated_at`，因此 close 基线在 comment confirmed 后重新 GET 建立；当前 REST 方案仍存在极小 TOCTOU，不能伪称原子 CAS。
- v2 scheduler 只选择 `schemaVersion=2 && kind=issue_analysis`；v1 非终态写 retirement sidecar，原文件与历史副作用保留。

### 删除/保留边界

删除 claim/owner-intent/full-agent/handler-runtime/runner/session/worktree/publisher/PR/policy/validation 专属模块和 scripts。

明确保留 `worktree-check-*`、YPI Studio runner/modules、Project Registry、通用 Agent Session、`agent-session-bootstrap-errors.ts`。

## Implement 摘要

完整内容与 machine-readable DAG：[implement.md](implement.md)

| ID | 交付 | 门禁 |
| --- | --- | --- |
| GIA-00 | UI 设计员 HTML + 用户审批 | 当前 blocker |
| GIA-01 | v2 config/store/job/migration/retirement | GIA-00 |
| GIA-02 | 只读 evidence controller + strict model analyzer | GIA-00 |
| GIA-03 | opened-only ingress + single runner + comment/close | 01,02 |
| GIA-04 | API/status/verify/jobs/App permissions 收敛 | 01,03 |
| GIA-05 | 按批准 HTML 重构设置页 | 01,04 |
| GIA-06 | 删除旧闭环依赖图，保留 Studio/checker 通用能力 | 03,04 |
| GIA-07 | analysis/migration/privacy/no-loop focused tests | 03,04,06 |
| GIA-08 | docs/Skills/AGENTS、全量 checker 与 UAT | 05,07 |

建议批准后最大并发 2。实现期间不 commit/push/merge，不接触真实 operator 凭据。

## Checks 摘要

完整内容：[checks.md](checks.md)

核心自动化门禁：

- webhook actor/action 全矩阵、duplicate 与 same-Issue distinct delivery 并发；
- traversal/symlink/secret/binary/excluded directory/所有预算；
- strict model schema 和所有 inconclusive 降级；
- comment marker/no-op/duplicate/unknown write；
- close 每个 negative gate、comment 后 updatedAt、unknown result/fence；
- v1 config migration disabled、v1 jobs 0 lease、retirement idempotent、no-spin；
- API forbidden-key/value/sentinel 隐私扫描；
- 删除图扫描 + WorkTree Check/Studio/package asset 回归。

建议最终命令：

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

真实 GitHub test-App UAT 是 release blocker；mock green 不能替代 comment/Issue `updated_at` 与 close 行为验证。

## 需要主会话 / 用户决定

1. **提供缺失的 GitLab 分类参考文档**，并确认最终分类/label 词表；在此之前建议分类写评论，label mutation 暂不启用。
2. 是否批准四态真实性模型 `confirmed | not_exists | inconclusive | not_applicable`。
3. `not_exists` 自动关闭是否使用 `state_reason=not_planned`。
4. 是否接受“当前绑定本地仓库静态快照”为真实性依据；系统在仅 Issues 权限下无法证明本地 checkout 与远端默认分支同步。
5. 高置信反证阈值：建议两个独立反证引用，或一个明确权威契约；“grep 无结果”永远不算。
6. 分析模型是否按 P0 推荐跟随 pi 主默认模型，仅展示 readiness，不增加专用模型设置。
7. 是否保留最近分析列表与手动 retry；当前计划保留，retry 只补未确认 checkpoint。
8. 是否同意 v1 配置迁移后强制 `enabled=false`，由 operator 重验后开启。
9. UI 设计员 HTML 中：单一 enabled、auto-close 警示、inconclusive 呈现、删除 baseRef/owner actor ids、≤640/390px 布局是否批准。

## 下一步

1. 主会话指派 `ui-designer` 完成 GIA-00；
2. 用户审阅 HTML 与上述决策；
3. 如有反馈，先修订 PRD/Design/Implement/Checks/本文件；
4. 全部批准后，主会话保存 implementationPlan 并将任务转为 `awaiting_approval` / 经明确批准后再进入 implementing。
