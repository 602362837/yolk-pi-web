# brief

## 目标

修复两个独立但相关的 Session 展示问题：

1. 左侧 Session 列表在侧栏很窄时，Session 行内上下两行内容不应换行或挤压错位；宽度不足时应保持单行并省略。
2. YPI Studio 指派 subagent 产生的 SDK child session 名称/标题不能直接使用主任务名；应优先显示 implementation subtask 标题，取不到时回退为“角色 + 主任务名称”。

## 已读材料与定位

- 项目规则：`AGENTS.md`
- 架构/约束：`docs/architecture/overview.md`
- 前端模块：`docs/modules/frontend.md`
- API/会话模块：`docs/modules/api.md`
- lib 模块：`docs/modules/library.md`
- Session 列表 UI：`components/SessionSidebar.tsx`
- Session 标题派生：`lib/session-title.ts`
- Studio child 展示投影：`lib/session-reader.ts`
- SDK child session 创建/命名：`lib/ypi-studio-child-session-runner.ts`
- 类型契约：`lib/types.ts`
- 项目空间 session API：`app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`

## 关键发现

- `SessionItem` / `ArchivedSessionItem` 已对标题本身做 `whiteSpace: "nowrap"`，但元信息行、Studio detail、部分 flex 容器缺少完整的 `minWidth: 0 + overflow hidden + nowrap + ellipsis` 组合，窄宽时仍可能溢出/换行/挤压固定高度行。
- `displayTitleForSession()` 对 `studioChild` 当前优先返回 `studioChildDisplay.taskTitle`，因此即使 `projectStudioChildDisplay()` 已能取到 `subtaskTitle`，左侧列表也仍优先显示主任务名。
- `studioChildSessionInfoName()` 在 SDK child session 创建时也优先使用 `getYpiStudioTaskDetail(...).title` 写入 session_info，未来 child session 的持久名称仍会是主任务名。
- `projectStudioChildDisplay()` 已从 `implementationProjection.subtasksWithStatus` / `implementationPlan.subtasks` 解析 `subtaskTitle`，可复用，不需要新增 API 字段。

## UI 门禁

本任务改变左侧 Session 列表用户可见交互/展示行为，触发 UI 原型门禁。进入实现前必须由 `ui-designer` 基于现有项目输出 HTML 原型，并由主会话/用户批准。当前尚未取得 HTML 原型和审批记录。
