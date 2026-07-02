# PRD: 为关联 Session 增加 YPI Studio 任务进度悬浮小卡片

## 背景

用户在聊天会话中使用 YPI Studio 工作流时，目前必须打开右侧 Studio 面板或查看工具消息才能了解任务进度、成员执行和产物状态。需要在与 Studio task 高置信关联的 session 页面中提供一个轻量悬浮卡片，让工作流状态在聊天区域内可见。

## 目标

1. 在当前 pi session 能高置信解析到 YPI Studio task 时显示悬浮卡片。
2. 卡片展示任务标题、工作流、状态、百分比、负责人、必需产物完成/缺失情况。
3. 卡片重点展示 `ypi_studio_subagent` 成员执行：成员、状态、模型/thinking、摘要和最近 transcript preview。
4. 运行中自动刷新，避免用户手动刷新页面。
5. 点击卡片打开右侧 Studio 面板并聚焦对应任务。
6. 视觉体现 workflow 推进感：flow-line 步骤线、running 脉冲、瀑布式成员 run 列表。

## 非目标

- 不改变 YPI Studio workflow 状态机语义。
- 不从 Git 状态推导 Studio 进展。
- 不根据“当前项目只有一个任务”做低置信关联。
- 不在卡片中展示 artifact 正文或完整 transcript。
- 不引入新的动画库。

## 用户故事

- 作为使用 Studio 的用户，我希望在聊天过程中直接看到当前任务所处阶段和进度。
- 作为调度多个成员的用户，我希望看到哪个 Studio member 正在运行、是否成功/失败，以及最近在做什么。
- 作为移动端用户，我希望用紧凑 pill 查看进度，并能展开详情。
- 作为高级用户，我希望点击悬浮卡片直接定位到右侧 Studio task。

## 验收标准

1. 已绑定 Studio task 的 session 中，聊天区域出现卡片；无高置信证据时不显示。
2. 关联解析只接受 exact runtime pointer、task.contextIds exact match、当前 session transcript 中明确 Studio tool evidence。
3. 冲突证据返回 `ambiguous`，UI 静默隐藏卡片。
4. API 响应不包含 `documents` 正文和完整 transcript JSONL。
5. 运行中的 subagent run 以 running 样式显示，结束后刷新为 succeeded/failed/cancelled。
6. 点击卡片打开 Studio drawer 的 Tasks tab，并高亮/滚动到目标 task。
7. 桌面端可拖拽并持久化位置；移动端显示 compact pill + bottom sheet。
8. `npm run lint` 和 `node_modules/.bin/tsc --noEmit` 通过。
