# Design

## 方案摘要

本修复分两条线：

1. 前端侧栏行布局：在普通/归档 Session 行内统一应用 flex 窄宽安全约束，保证标题行、元信息行、Studio detail、操作区均不换行，宽度不足时截断。
2. Studio child 标题：复用现有 `studioChildDisplay.subtaskTitle` 投影，调整展示优先级；同时修正 SDK child session 创建时写入 `session_info` 的命名函数，避免未来 child session 持久名称继续使用主任务名。

## 影响模块和边界

| 模块 | 文件 | 影响 |
| --- | --- | --- |
| Session 列表 UI | `components/SessionSidebar.tsx` | 普通/归档 Session 行窄宽单行截断；不改变数据获取。 |
| Session 标题派生 | `lib/session-title.ts` | Studio child 标题优先 subtaskTitle，fallback 为 member + taskTitle。 |
| Studio child 展示投影 | `lib/session-reader.ts` | 现有 `projectStudioChildDisplay()` 已能解析 subtaskTitle；预计仅需确认/必要时补强 fallback。 |
| SDK child session 创建 | `lib/ypi-studio-child-session-runner.ts` | `studioChildSessionInfoName()` 改为 subtask 优先；无历史迁移。 |
| 类型契约 | `lib/types.ts` | 预计不新增字段；只复用 `StudioChildSessionDisplay.subtaskTitle/taskTitle` 和 `StudioChildSessionInfo.member/subtaskId`。 |
| 文档 | `docs/modules/frontend.md`, `docs/modules/library.md` | 实现后若行为描述变化，补充侧栏截断和 child title 优先级。 |

## 数据流 / API / 文件契约

### 现有数据流

1. `/api/projects/[projectId]/spaces/[spaceId]/sessions` 调用 `listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true })`。
2. `listAllSessions()` 对 Studio child 调用 `projectStudioChildDisplay(cwd, studioChild)`。
3. `projectStudioChildDisplay()` 从 `.ypi/tasks/<task>/task.json` detail 中解析：
   - `taskTitle`
   - `subtaskTitle`
   - `runSummary`
4. `SessionSidebar` 调用 `displayTitleForSession(session)` 生成左侧标题。

### 调整后的标题优先级

建议在 `displayTitleForSession()` 或其内部 helper 中实现：

1. `studioChildDisplay.subtaskTitle` 非空：返回截断后的 subtask 标题。
2. `studioChildDisplay.taskTitle` 非空：返回 `studioChild.member + " · " + taskTitle`。
3. `studioChildDisplay.runSummary` 非空：返回 `studioChild.member + " · " + runSummary` 或现有 run summary fallback。
4. `studioChild.taskId` 非空：返回 `studioChild.member + " · " + basename(taskId)`。
5. 最后返回普通 session fallback。

### SDK child session_info 命名

`studioChildSessionInfoName(root, meta)` 应读取 task detail，并按：

1. `meta.subtaskId` 对应 `implementationProjection.subtasksWithStatus[].title` 或 `implementationPlan.subtasks[].title`；
2. task title；
3. `basename(meta.taskId)`；

生成名称。推荐格式：

- 有 subtask：`YPI Studio <subtaskTitle> · <member> · <runShortId>`
- 无 subtask：`YPI Studio <member> · <taskTitle> · <runShortId>`

此名称是 durable fallback；左侧列表仍以 `studioChildDisplay` 投影为展示权威。

## 侧栏布局设计

对 `SessionItem` 和 `ArchivedSessionItem` 做统一窄宽规则：

- 行根：保持 `height: 54`, `overflow: hidden`, `minWidth: 0`。
- 内容列：`flex: 1`, `minWidth: 0`, `overflow: hidden`。
- 标题行：`display: flex`, `minWidth: 0`, `overflow: hidden`, `whiteSpace: nowrap`, `flexWrap: "nowrap"`。
- 标题文本：`flex: "1 1 auto"`, `minWidth: 0`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`。
- 元信息行：`display: flex`, `minWidth: 0`, `overflow: hidden`, `whiteSpace: nowrap`, `flexWrap: "nowrap"`。
- 短元信息（时间、msg、未关联）：`flexShrink: 0`。
- 长元信息（Studio detail）：`flex: "1 1 auto"`, `minWidth: 0`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`。
- hover 操作区：保持 `flexShrink: 0`；文本区负责截断，不改变行高。

## 兼容性

- 不改变 API response schema。
- 不迁移历史 JSONL；历史 session 的显示可通过 task detail 投影即时修正。
- 如果 `.ypi/tasks` 不存在或 task detail 不可读，`projectStudioChildDisplay()` 已 catch，Session 列表应继续可用。
- 普通 session 标题逻辑不变。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 过度截断导致信息不可见 | 保留 `title` tooltip；短 badge/时间优先保留。 |
| hover 按钮在极窄宽仍占据过多宽度 | 文本列截断；必要时后续 UI 原型可建议隐藏部分按钮，但本次不改变操作可用性。 |
| Studio task detail 读取失败导致无法显示 subtask | fallback 到 member + taskId/run summary；不阻塞列表。 |
| “角色”显示英文 member id 不符合用户预期 | 实现前确认是否需要中文映射；默认采用现有系统 member id，避免新增 i18n 契约。 |
| 修改 session_info 仅影响新 child session | 左侧显示通过 `displayTitleForSession()` 修正历史 child；不做 JSONL 迁移。 |

## 回滚

- UI 行为可回滚 `components/SessionSidebar.tsx` 的样式 helper/inline style 调整。
- 标题行为可回滚 `lib/session-title.ts` 和 `studioChildSessionInfoName()` 调整；不涉及数据迁移。
