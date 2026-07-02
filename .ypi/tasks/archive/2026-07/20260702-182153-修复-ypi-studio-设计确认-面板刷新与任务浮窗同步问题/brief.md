# Brief

## 用户反馈

蛋黄派工作室发现 3 个问题：

1. 多次出现：走完设计阶段后，主 session 没有把设计交给用户确认，直接进入制作阶段。该问题最严重。
2. 工作室面板展开后数据出来特别慢，并且有时（尤其有 session 正在工作）似乎一直刷新，用户无法阅读信息。
3. 例如某个 session 创建出任务后，任务浮窗不会出现，用户需要重新加载页面才可以。

## 目标

- 分析并修复 Studio 工作流状态机/主 session 编排，确保设计阶段完成后必须进入用户确认状态，未经用户明确批准不得进入制作/实现。
- 分析并优化 Studio 面板数据加载/刷新策略，避免面板展开后长时间空白或工作中持续刷新打断阅读。
- 修复 session 创建/绑定 Studio 任务后浮窗不实时出现的问题。

## 约束

- 遵循项目 YPI Studio 规则：main session 只负责编排，成员工作用 ypi_studio_subagent。
- 不得从 awaiting_approval 直接进入 implementing，除非用户明确批准方案。
- 修改 API/组件/共享逻辑时同步检查并更新相关 docs。

## 相关入口

- `components/YpiStudioPanel.tsx`
- `components/YpiStudioSessionWidget.tsx`
- `components/ChatWindow.tsx`
- `hooks/useAgentSession.ts`
- `app/api/studio/**`
- `app/api/sessions/[id]/studio-task/route.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-session-link.ts`
