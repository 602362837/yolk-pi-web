## Summary

修复左侧 Session 侧栏在窄宽度时内容换行导致上下错乱的问题，并修正 YPI Studio 指派 subagent 产生的 child session 标题命名规则。CSS flex 布局补救是核心手段，Studio child 标题优先级逻辑集中在两个工具库文件中。

## Reusable knowledge

1. **SessionSidebar 窄宽单行截断**：flex 容器中需在容器级别加上 `minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", flexWrap: "nowrap"`，可伸缩子项（如标题/元信息）设 `flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"`，固定控件（按钮/badge/checkbox）设 `flexShrink: 0`。hover 按钮不改变行高——通过让文本区域在有按钮时收缩截断而非换行来实现。delete confirm 行的确认/取消按钮容器也要加 `minWidth: 0, overflow: "hidden", whiteSpace: "nowrap"`。

2. **Studio child 展示标题优先级**：`lib/session-title.ts` 中 `displayTitleForSession()` 的 Studio child 分支改为：① `studioChildDisplay.subtaskTitle` 优先；② 无 subtaskTitle 时用 `memberPrefixedStudioChildTitle(member, taskTitle)` 拼接 `member · taskTitle`；③ 再回退到 `member · runSummary`；④ 最后 `member · taskId basename`。非 Studio child 的 session 标题仍按现有 `name -> firstMessage -> empty` 规则。

3. **SDK child session_info 持久化命名**：`lib/ypi-studio-child-session-runner.ts` 中 `studioChildSessionInfoName()` 先解析 task detail（通过 `getStudioChildTaskDetail()` 搜索 active + archived 任务），从 `implementationProjection.subtasksWithStatus[].title` 或 `implementationPlan.subtasks[].title` 取 subtask 标题；取不到再回退为 `YPI Studio {member} · {task title} · {runShortId}`。这确保新 SDK child session 的 `session_info` 名称包含子任务名而非仅主任务名。

4. **UI 原型门禁确认**：本任务完整实践了 UI 原型门禁流程——architect 设计后标记需 ui-designer，ui-designer 产出 HTML 原型，主 session 获取用户口头批准后进入实现。归档前须更新 ui.md/checks.md 记录审批状态，否则 checker 会阻塞。

## Source artifacts

- `.ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/ui-prototype.html` — HTML 交互原型
- `.ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/design.md` — 详细设计方案
- `.ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/implement.md` — 实现计划与子任务
- `.ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/summary.md` — 最终总结
