# Design — IMP-004 主任务验收弹窗增加确认并归档按钮

## 方案
扩展 `components/YpiStudioSessionWidget.tsx` 的主任务验收处理：

1. 将现有 `handleAcceptMainTask(taskKey, taskTitle)` 抽象为支持模式：
   - `complete`：现有行为，PATCH `/api/studio/tasks/{taskKey}` `{ to: "completed" }`。
   - `complete-archive`：先执行 complete；成功后再 PATCH 同一路由 `{ action: "archive", allowFallbackKnowledge: true }`。
2. AppPrompt 弹窗增加第三个按钮。若现有 `usePrompt` 不支持三按钮，则采用在 `message` 中嵌入一个安全按钮并通过 callback/Promise 分支处理，或最小扩展 `AppPromptProvider` 支持 secondary action。
3. 归档请求复用现有 Studio Panel 归档接口语义：`action: "archive"`, `reason: "Accepted and archived from session widget"`, `allowFallbackKnowledge: true`。
4. 所有写操作保持 in-flight 互斥，不做乐观 UI 更新，成功或失败后调用 `onTaskChanged` 刷新。

## 错误处理
- complete 失败：显示「主任务验收失败」。
- complete 成功、archive 失败：显示「已完成，但归档失败」，刷新后任务应处于 completed，可从 Studio Panel 重试归档。
- archive 成功：显示「已确认并归档」。

## 受影响文件
- `components/YpiStudioSessionWidget.tsx`
- 可能：`components/AppPromptProvider.tsx`（仅当需要通用三按钮 prompt 支持）
- `docs/modules/frontend.md`
