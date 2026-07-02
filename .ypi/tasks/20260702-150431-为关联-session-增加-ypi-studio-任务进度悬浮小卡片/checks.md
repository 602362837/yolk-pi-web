# Checks Plan

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## API / Resolver 检查

- exact runtime pointer `pi_<sessionId>` 能解析到任务。
- exact runtime pointer `pi_transcript_<hash>` 能解析到任务。
- `task.contextIds` exact match 能解析到任务。
- `pi_process_*` context 被忽略。
- 多个 exact 证据指向不同 task 时返回 `{ task: null, reason: "ambiguous" }`。
- transcript 中 latest structured `ypi_studio_task` result 能解析。
- transcript 中 `ypi_studio_subagent` result / call input taskId 能解析。
- evidence 指向缺失 task 时返回 `task-not-found`。
- response 不包含 `documents` 正文和完整 transcript JSONL。

## UI 检查

- 有关联 Studio task 的 session 展示 widget。
- 无高置信 Studio evidence 的 session 不展示 widget。
- widget 展示标题、workflow、status、percent、owner、artifact 完成/缺失。
- running subagent 显示 running 样式、member、model/thinking、preview。
- succeeded/failed/cancelled subagent 状态刷新正确。
- 点击 widget 打开右侧 Studio Tasks tab，并高亮目标 task。
- Studio drawer 已聚焦同 task 时 widget 隐藏或降噪。
- 桌面端拖拽位置持久化，刷新后仍保留。
- 移动端 compact pill 可展开 bottom sheet。
- `prefers-reduced-motion` 下 flow/pulse 动效关闭。

## 回归检查

- TrellisSessionWidget 仍按原逻辑显示/聚焦。
- SessionChangesFloatingPanel 仍按原逻辑显示/刷新。
- YpiStudioPanel 的 Members / Workflows / Tasks 现有读取、初始化、归档行为不回退。
- ChatWindow SSE、分支切换、agent_end 行为不回退。
