# 子 session 名称拼入 step 编号信息 — 计划审批书

> 当前为**待用户审批**状态。HTML 原型与技术计划均已就绪；请同时批准原型与下列方案。未获明确批准前不进入 implementing。

## 审批摘要

- step 编号采用稳定 `subtask.id`，不采用 1-based index，也不组合两种编号。
- 有 subtask：主标题为 `{subtaskId} · {subtaskTitle}`；标题缺失时至少显示 id。
- 无 subtask：保持 `{member} · {taskTitle}`，architect/improver 不出现伪编号。
- 50 字符信息优先级为 `编号 > 标题 > member`；run short id/member/status 继续在 detail、badge、tooltip 展示。
- 侧栏和新 child JSONL 的 `session_info` 复用同一纯 helper。
- 存量 child 通过 header/task 投影即时生效，不回写 JSONL。
- 修复同一 task 多 child 的投影缓存身份：cache key 必须纳入 `subtaskId` 与 `runId`。

## PRD

目标、范围、验收和非目标见 [prd.md](prd.md)。背景与推荐决策见 [brief.md](brief.md)。

## UI

门禁与 UI 设计员任务见 [ui.md](ui.md)。已产出的原型路径：[session-step-title-prototype.html](session-step-title-prototype.html)。

HTML 原型已覆盖有/无 step、多 step、长标题、窄侧栏，以及 title 与 badge/detail/tooltip 的信息分工。用户需同时批准原型和以下技术计划。

## Design

详细方案见 [design.md](design.md)：

1. `lib/session-title.ts` 增加共享纯 helper。
2. `StudioChildSessionDisplay` 增加可选 `subtaskId`。
3. `projectStudioChildDisplay()` 返回该 id，并按 `cwd/task/subtask/run` 隔离缓存。
4. `displayTitleForSession()` 与 `studioChildSessionInfoName()` 调用同一规则。
5. 不修改 `studioChild` header schema，不迁移历史 JSONL。

## Implement

DAG、人类可读子任务表和机器计划见 [implement.md](implement.md)。顺序为：

1. `UI-STEP-TITLE` — HTML 原型与用户审批；
2. `TITLE-PROJECTION` — helper、投影、cache identity、runner 接入；
3. `TITLE-CHECKS` — focused tests、文档、自动与手工验证。

主会话需先通过 Studio task action 保存 fenced `ypi-implementation-plan`，再进入 `awaiting_approval`。child 不直接修改 `task.json`。

## Checks

完整清单见 [checks.md](checks.md)。最低自动验证：

```bash
npm run test:session-title
npm run test:studio-sdk-runner
npm run lint
node_modules/.bin/tsc --noEmit
```

手工重点：两个不同 subtask child 不串标题、无 subtask 不出现编号、历史 child 不回写即可刷新生效、窄侧栏仍保持单行。

## 风险与回滚

- 主要风险：缓存键遗漏 run/subtask、截断隐藏 id、runner/sidebar 规则再次分叉。
- 回滚仅需回退 helper/投影/caller；无数据迁移，已写 `session_info` 仍合法。

## 请用户确认

1. 打开并审批 HTML 原型：[session-step-title-prototype.html](session-step-title-prototype.html)
2. 是否批准以稳定 `subtask.id` 作为唯一 step 编号口径（不使用 1-based index）
3. 是否批准本计划书中的技术实现与验收方案

明确回复「批准 / 同意」后进入 implementing；如需修改请直接说明变更点。
