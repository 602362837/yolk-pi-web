# Brief：GitHub 自动化评论自触发与 Owner 指令闭环

## 结论

Issue #21 暴露的是 webhook 路由与 durable job 身份/动作过滤缺失造成的确定性反馈环，不是 GitHub 偶发重投。应同时修复入口动作矩阵、App/Bot 自事件隔离、终态 generation 规则、canonical comment 幂等和 owner 精确评论协议；只修 `issue_comment.edited` 会留下 `created`、`issues.labeled/assigned/closed` 等同类入口。

当前全局 `paused` 是有效 stop-bleed；本任务不得解除。

## 现场证据（2026-07-24）

- 人类创建 Issue #21 后，首个 job 完成 triage；随后 App 自己的 `issues.assigned`、`issues.labeled`、`issue_comment.created/edited` 均被当作可入队业务事件。
- 本地安全审计显示同一 `repoId#21` 连续生成 **g1–g80**；大量 `issue_comment.edited` 的 sender 均为同一 App Bot actor，每轮都重新 claim/triage。
- 每轮 canonical triage comment 使用新的 `traceId` 生成 marker；即使业务结论未变，body 仍不同，`upsertGithubAutomationComment()` 因此执行 PATCH。PATCH 再触发新的 `issue_comment.edited`。
- 人类评论、评论删除和 Issue 关闭也只更新/新建 job，没有形成针对该条评论的明确响应；Issue 关闭后 Bot 编辑循环仍继续，直到全局 paused 使后续 delivery 仅记录为 paused。
- GitHub 当前只保留一条 Bot triage comment，但本地已产生 80 代 job，说明“远端不刷多条评论”不等于 side effect 幂等。

## 根因链

1. `shouldEnqueueIssueJob()` 对 `issues` / `issue_comment` 不区分 action、sender type、App self actor。
2. terminal active job 遇到任意新 delivery 都会创建新 generation；generation 没有限制在 `opened/reopened` 或显式重试。
3. 新 generation 重新执行 assignee/labels/triage；comment marker 的动态 trace 使语义相同的 body 也发生 PATCH。
4. 自己的 PATCH 产生 `issue_comment.edited`，重新进入第 1 步。
5. Owner 处理只在 `awaiting_owner` 路径生效；`needs_info/not_adopted` 进入 terminal 后，owner 评论不会得到针对该 comment 的 receipt。
6. Owner intent 通过“列出最近评论并选任意匹配评论”识别，未绑定 webhook 的 exact comment id；无关新事件可能重新命中过去的肯定评论。

## 推荐范围

- Webhook envelope 增加安全 actor/comment 元数据，不持久化正文。
- 建立事件 action matrix；App/Bot 自事件“审计保留、业务忽略、零 job/零 wake”。
- generation 只允许由明确生命周期事件或显式 operator/owner retry 产生。
- canonical marker 稳定化，语义相同零 PATCH；未知结果通过 marker 回读 reconcile。
- Owner 命令绑定 exact comment id + actor + comment version/hash；一条命令一个 durable receipt。
- 在 GitHub Issue timeline 提供可观察的“收到 → 接受/拒绝 → 当前阶段 → 下一步”闭环。
- 扩展 focused tests 与 GitHub automation 文档。

## UI / 交互门禁

本任务不修改 Web React 页面，但会改变 GitHub Issue 中用户可见的评论结构、命令语法、拒绝理由和状态反馈，属于“已有交互与用户可见信息结构变化”，**触发 UI 原型门禁**。应由 `ui-designer` 基于 GitHub Issue timeline 产出 task-local HTML 原型（建议 `github-issue-command-loop.html`），展示 triage、owner 指令 receipt、状态推进、拒绝/paused/closed 等状态。

当前 delegated architect 环境没有 Studio 派发工具，且不得擅自改派成员，因此原型尚未产出；在 HTML 原型与用户审批完成前不得进入 implementing。

## 待主会话确认

1. **命令目标**：推荐显式 `@AppBot` 或 `/ypi`；保留 awaiting-owner 阶段无 mention 的历史“采纳”兼容。是否真的让 `@机器 Assignee` 触发自动化？后者可能劫持对真人开发者的普通沟通。
2. **Phase 1 命令集**：推荐 `状态 / 重新评估 / 采纳 / 重试 / 暂停 / 继续`；其中暂停/继续仅作用于单 job，绝不能改变全局 paused。
3. **Issue closed 时的 active implementation**：推荐 fail-closed 为 per-job blocked/paused，保留 WorkTree，不自动取消或删除；待 owner 明确继续。
4. **needs_info 的补充方式**：推荐 `重新评估` 只读取最新 Issue title/body；owner comment 只作为命令，不把自由文本注入 agent。若要让评论补充需求，应先定义独立、受限的数据契约。
