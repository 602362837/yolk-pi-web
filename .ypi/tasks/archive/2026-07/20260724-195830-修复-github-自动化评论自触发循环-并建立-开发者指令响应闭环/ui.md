# UI：GitHub Issue 指令与状态反馈

## 审批状态

HTML 原型已产出并经用户明确批准：**批准该方案**。

原型：[github-issue-command-loop.html](github-issue-command-loop.html)

## 已批准交互契约

- 命令目标采用 `@AppBot`（或 `/ypi`），不拦截 `@602362837` 机器 Assignee 的普通真人沟通。
- Phase 1 命令为：`状态`、`重新评估`、`采纳`、`暂停`、`继续`。
- owner 命令均产生明确 receipt；状态使用单一可更新 status comment，避免刷屏和静默。
- `暂停/继续`只作用于单 job，Issue 评论不能解除全局 paused。
- Issue 关闭时 active job 进入 `blocked/paused: issue_closed`，保留 WorkTree；reopen 后需 owner 显式继续。
- 非 owner、Bot、全局 paused、未满足 claim/policy 门禁时给出安全且可操作的回执，不越权执行。
- 中文主文案，附次级安全状态码；不回显正文 hash、路径、token 等敏感信息。

## 原型覆盖

初始 triage、owner command receipt、accepted/rejected/paused/global-paused、聚合 status comment、closed/blocked 状态均已在 HTML 原型中展示。

## 实施约束

不修改 React UI；当前用户可见交互发生在 GitHub Issue timeline。若未来 Settings/status API 需要新增展示，应重新走 UI 原型门禁。