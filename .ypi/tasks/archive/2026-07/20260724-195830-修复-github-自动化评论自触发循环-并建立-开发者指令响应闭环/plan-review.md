# 计划审批书：GitHub Bot 自循环与 Owner 指令闭环

## 用户审批

用户已于本轮明确回复：**批准该方案**。

批准范围：

- 采用 `@AppBot`（或 `/ypi`）作为 YPI 命令目标，不拦截机器 Assignee 的普通 @ 沟通。
- Phase 1 命令：`状态`、`重新评估`、`采纳`、`暂停`、`继续`；单 job 暂停/继续不得解除全局 paused。
- Issue 关闭时 active job 进入 `blocked/paused: issue_closed`，保留 WorkTree；reopen 后需 owner 显式继续。
- 采用 HTML 原型中的 receipt/status 单评论闭环、中文主文案和安全边界。
- 全局 paused 在修复和验证期间保持不变，不执行真实 unpaused smoke。

## 方案摘要

Issue #21 的 g1–g80 循环来自 App 自己编辑 triage 评论触发 `issue_comment.edited`，入口继续创建 job/generation 并 PATCH 同一评论。方案先在 ingestion 层对 App/Bot 自事件做 audit-only、零 job/零 wake/零 mutation 过滤，再实现稳定 comment marker、body no-op、精确 comment version 幂等，最后加入 owner exact-comment command receipt/status 协议。

## 产物

- [Brief / 证据与根因](brief.md)
- [PRD / 需求与验收](prd.md)
- [Design / 数据流与契约](design.md)
- [Implement / DAG Implementation Plan](implement.md)
- [Checks / 自动与人工验收](checks.md)
- [UI 说明](ui.md)
- [HTML 原型](github-issue-command-loop.html)

## 实施顺序

1. UI-00：原型与交互审批（已完成）
2. LOOP-01：入口 actor/action 分类与 generation gate
3. IDEMP-02：稳定评论 marker、无变化不 PATCH、远端 reconcile
4. CMD-03：精确 owner command、receipt/status、单 job 控制
5. TEST-04 与 DOC-05：回归测试和文档并行
6. CHECK-06：focused suites、lint、tsc、paused-safe 验证与 checker review

## 安全与回滚

- 历史 g1–g80 不重写、不删除。
- 评论正文不进入 agent prompt、任务指令、validation、branch、remote、publisher 或全局配置。
- GitHub 评论不能解除 global paused 或改变执行策略。
- 实施和验证期间保持 global paused=true。
- self/Bot audit-only filter 保留为永久安全层；命令 UX 出问题时可关闭 command dispatch/receipt/status，不删除 durable audit/job/WorkTree。
