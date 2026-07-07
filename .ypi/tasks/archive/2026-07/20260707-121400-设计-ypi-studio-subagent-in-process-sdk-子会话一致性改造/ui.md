# ui

## 是否需要 UI 设计员

不需要单独派发 UI 设计员。此次是信息架构/状态展示改造，沿用现有 SessionSidebar、YpiStudioSessionWidget、YpiStudioPanel、YpiStudioSubagentTranscript 的视觉语言即可。实现员按现有组件风格补充折叠区、badge、只读提示。

## 页面 / 组件 / 状态

### SessionSidebar

- 普通 project-space session 列表默认不显示 Studio child session root。
- 父 session 行新增可选紧凑 badge：`Studio 3` / `1 running` / `1 failed`。
- 展开父 session 时，child sessions 放在现有 fork children 下的二级分组：`Studio children`。
- child row 展示：member、run status、subtaskId（有则显示）、短 runId、更新时间。
- child row 默认只读打开；输入区禁用并提示“这是 Studio child session 审计视图，请回到父 chat 继续编排”。

### Studio Panel / Task Detail

- Subagents tab 对新 run 增加 `childSessionId` / `childSessionFile` 小链接。
- 点击链接打开 child session 审计视图，或复制 session id/path。
- 旧 run 没有 child session 时继续只显示 transcript sidecar 链接。

### YpiStudioSessionWidget

- 不需要展示所有 child sessions；只展示当前 task 的 run 状态摘要。
- 当有 child running/failed 时，显示 member + subtask + current tool/tps；点击进入 Studio Panel 对应 task/run。

### Chat / Transcript Card

- `YpiStudioSubagentTranscript` 继续 recent-status-first。
- 新增 child session metadata 行：`SDK child session · <short childSessionId>`。
- display/truncation 仍是中性提示，不改变 run severity。

## 交互要点

- 默认隐藏：避免项目历史被实现子任务刷屏。
- 可追溯：父 session、Studio task、run detail 能打开 child session。
- 只读优先：避免用户在 child session 中继续对话后获得 Studio tools 或打乱父 session continuation。
- 状态来源：UI severity 仍由 `task.subagents[].status` / runtime registry 决定，不从 session header 猜测。

## 需要原型化的问题

无必须原型。若实现后发现 Sidebar child 分组拥挤，再由 UI 设计员补一版折叠布局即可。
