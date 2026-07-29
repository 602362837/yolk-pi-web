# Brief：精简 GitHub Issue 自动化

## 目标

将现有“认领 → Owner 指令 → 自动实现 → 检查 → 发布 PR”的 GitHub Issue 闭环，收敛为单向的新议题分析流程：

1. 仅由新建 Issue 触发；
2. 对议题分类；
3. 基于当前本地仓库证据判断所述问题是否真实存在；
4. 发布一条结构固定、可幂等更新的 Markdown 评论；
5. 已证伪且满足严格关闭门禁时自动关闭；已确认存在时保持打开，并说明原因与解决方向；证据不足时保持打开；
6. 不认领、不等待 Owner 指令、不修改代码、不建 WorkTree/Studio Task、不提交分支、不 push、不创建或合并 PR。

## 当前实现证据

当前实现远大于目标范围：

- `lib/github-automation-runtime.ts` 接收 `issues`、`issue_comment`、`pull_request`，并为 `opened/reopened` 建 generation；
- `lib/github-issue-triage-runner.ts` 先解析本机 `gh` 身份、写 Assignee 和 `ypi:claimed`，再用关键词规则分类，并处理 `状态/重新评估/采纳/暂停/继续`；
- `lib/github-automation-runner.ts`、`github-automation-session.ts`、`github-automation-worktree.ts`、`github-git-publisher.ts` 等组成 WorkTree → Studio → full agent → checker → validation → PR 的闭环；
- `components/GithubAutomationConfig.tsx`（约 4,500 行）展示 App 凭据、Assignee、unattended 风险、运行模式和双层 Jobs；
- GitHub 自动化相关源码、组件和脚本合计约 4.9 万行、1.7 MiB；精简时必须先解除引用再删除，不能误删 Studio 共用的 `worktree-check-*`；
- 当前 `analyzeUntrustedGithubIssue()` 只是关键词启发式，不读取仓库，因此不能承担“真实性判断”；
- 当前已有可复用安全基础：HMAC 先验签、raw body 限额、immutable repository id allowlist、exclusive delivery、stable comment marker、评论语义相等不 PATCH、未知写结果先回读、App/Bot 自事件 audit-only、固定 GitHub API host、App installation token。

## 建议产品口径

“真实性”不能只有二态。建议采用：

- `confirmed`：仓库证据支持问题存在；保持打开；
- `not_exists`：仓库证据明确反驳问题，仅在高置信关闭门禁全部通过时关闭；
- `inconclusive`：证据不足、环境相关、无法安全复现或分析失败；保持打开；
- `not_applicable`：Feature/Docs/Question 等不适用缺陷真伪；保持打开。

“未搜索到相关代码”不得等价于“不存在”。Feature 缺少实现也不得被当作问题不存在而关闭。

## GitHub App 结论

建议继续使用每个部署方自建并安装的 GitHub App：

- Webhook secret 用于可信接收新 Issue；
- installation token 用于读 Issue/仓库元数据、写 labels/comment、必要时关闭 Issue；
- 最小权限只需 `Metadata: read`、`Issues: read & write`；
- 只订阅 `Issues`（安装生命周期可选），不再订阅 `Issue comment`、`Pull request`；
- 不再需要本机 `gh`/git credential Assignee 身份，也不需要 `Contents`/`Pull requests` 写权限。

仓库 Webhook + PAT/GitHub Action 虽可替代，但会引入另一套凭据、安装和多仓库边界，不符合现有自托管产品的统一 installation/allowlist 模型，不作为本次主方案。

## 范围边界

### 保留

- GitHub App 本机凭据与 env overlay；
- 公网 webhook 单路由、HMAC、body cap；
- 仓库 allowlist、Installation ID、本地 Project Registry 绑定；
- delivery/job/safe event 的最小持久化、租约与有界重试；
- stable marker Markdown 评论与远端回读幂等；
- 设置页最小配置、验证、最近分析状态；
- 只读、仓库内受限的真实性分析器。

### 移除

- 自动 Assignee、`ypi:claimed`、机器 `gh` 身份解析；
- Owner 评论命令与 `issue_comment` 入口；
- recommendation/采纳等待；
- unattended、full-agent、WorkTree、Studio Task/Session、checker、validation、diff/publish policy；
- branch/commit/push/PR、PR lifecycle；
- `Contents`/`Pull requests` 权限与相应设置/文档；
- 30142 无 Session 回归证明及旧闭环专属脚本。

## 当前阻塞 / 待确认

1. 任务提到的“GitLab 分类文档”未在仓库或任务材料中找到；实施前需主会话提供链接或正文，并确认只借鉴哪些维度。
2. 需确认分类标签最终词表；本方案暂定 `bug | feature | docs | question | other`。
3. 需确认自动关闭是否接受三态安全降级；推荐只对 `bug + not_exists + high confidence + 完整证据 + Issue 版本未变` 自动关闭，并使用 `state_reason=not_planned`。
4. 需确认旧配置升级后是否强制关闭自动化等待人工重新启用；推荐是，避免升级后立即产生新的自动关闭副作用。
5. 设置页信息架构和交互会显著变化，已触发 UI 原型硬门禁；需要 UI 设计员基于现有设置页提交 HTML 原型并由用户审批。
