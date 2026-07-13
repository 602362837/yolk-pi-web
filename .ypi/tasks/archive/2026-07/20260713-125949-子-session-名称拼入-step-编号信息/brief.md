# Brief

## 背景

YPI Studio SDK runner 会为成员 run 创建可审计的 child session。当前侧栏标题在有实现子任务时只显示 `subtaskTitle`，没有显示任务面板已使用的稳定 `subtask.id`；新 child JSONL 的 `session_info` 名称也只写子任务标题。并行或串行 run 因而不容易按 step 识别。

## 已验证现状

- `lib/session-title.ts`：Studio child 优先返回 `studioChildDisplay.subtaskTitle`，未拼 `subtaskId`。
- `lib/ypi-studio-child-session-runner.ts`：`studioChildSessionInfoName()` 写入 `YPI Studio {subtaskTitle} · {member} · {runShortId}`。
- `lib/session-reader.ts`：`projectStudioChildDisplay()` 只投影 task/subtask title 与 run summary；缓存键仅含 `cwd + taskId`，但投影实际依赖 `subtaskId` 和 `runId`，同一任务多个 child 可能错误复用首个投影。
- `components/YpiStudioPanel.tsx`：实现子任务稳定显示为 `{subtask.id} · {subtask.title}`；`index + 1` 仅用于 execution group 的展示顺序。
- `StudioChildSessionInfo` header 已持久化可选 `subtaskId`，无需新增 JSONL 字段。

## 推荐决策

1. “step 编号”采用稳定 `subtask.id`，不采用可因重排变化的 1-based index，也不同时拼两种编号。
2. 有 `subtaskId`：标题为 `{subtaskId} · {subtaskTitle}`；标题缺失时至少显示 `{subtaskId}`。
3. 无 `subtaskId`：不生成伪编号，保持 `{member} · {taskTitle}`；architect/improver 等非实现 step run 不出现错误 step。
4. 50 字符预算按 `编号 > 标题 > member`：subtask 场景先保留 id，再用余量展示标题，member 留在现有 badge/detail/tooltip；无 subtask 场景完整值放不下时优先保留 task title。
5. 侧栏与新 `session_info` 复用同一纯格式化 helper，避免两套命名规则继续漂移；run short id 保留在现有详情行/tooltip，而非挤占主标题预算。
6. 存量 child session 通过 header `subtaskId` + task detail 投影即时生效，不回写 JSONL；持久化名称仅影响新建 child。

## UI 门禁

本任务改变侧栏中用户可见的信息结构，按项目硬规则必须由 `ui-designer` 产出 HTML 原型并由用户审批。当前 delegated architect 运行环境没有 Studio/subagent 派发工具，因此无法自行完成该门禁，也不得由架构师冒充 UI 设计员产出原型。主会话需派发 UI 设计员后再进入 `awaiting_approval`。
