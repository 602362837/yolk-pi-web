# brief

## 任务

基于已完成的「项目切换弹窗分层选择」重构，修复用户反馈的三个体验问题：

1. **切换项目/空间时重置当前 session**：切换后 chat 不应停留在 URL 上的旧 session，URL 中的 `?session=` 必须清除，并落在新项目/空间的空状态（或最新 session）。
2. **切换时 session 列表的加载状态**：切换项目时左侧 session 列表会先短暂显示旧项目 session，造成歧义；未刷新完成前需要明确 loading（skeleton/spinner）并禁止误操作旧列表。
3. **项目空间信息从侧边栏迁移到预览区**：左下侧边栏的项目空间信息应整合到主内容/预览区域，使整体布局更像编辑器；切换时该信息同步重载。

## 约束与边界

- 这是上一轮项目切换重构的延续，保持纯前端改动，不修改 Project Registry、会话 JSONL、后端 API 与 WorkTree 语义。
- 不改 `lib/normalize.ts` 口径、不改 SSE/JSONL 记录。
- 切换场景必须全部覆盖：弹窗选择空间 / 右键菜单切换 / WorkTree 新建选中 / 注册项目(add path、目录选择、default-cwd) / Git clone / WorkTree 归档·删除后的 fallback / URL 恢复(不重置)。
- 既有不变量继续遵守（见 AGENTS.md「Project Invariants」）：Project Registry 是项目列表唯一来源；pathKey 去重；不扫会话合成顶层项目。

## 相关上下文

- 上一轮知识：`.ypi/knowledge/20260709-172927-重构左侧项目切换为弹窗分层选择并优化多项目显示.md`
- 文档：`docs/modules/frontend.md`、`docs/modules/api.md`
- 关键文件：`components/SessionSidebar.tsx`、`components/AppShell.tsx`、`components/ProjectSpaceSwitchDialog.tsx`、`components/ChatWindow.tsx`、`hooks/useAgentSession.ts`

## 已识别根因（证据先行）

1. **P1 根因**：`SessionSidebar` 通过 `onCwdChange` 通知 AppShell cwd 变化，但通知 effect 用 `cwdForApp = selectedCwdProp ?? selectedCwd`，而 `selectedCwdProp` 来自 AppShell 的 `selectedSession?.cwd ?? newSessionCwd`。切换项目/空间瞬间，AppShell 仍持有旧 session，`selectedCwdProp`（旧 session 的 cwd）优先级掩盖了 sidebar 自己的 `selectedCwd`，`onCwdChange` 不再触发，AppShell 因此不会清 `selectedSession`、不会 `router.replace("/")` —— chat 停在旧 session，URL 仍带 `?session=`。
2. **P2 根因**：`loadSessions` 常以 `showLoading=false` 调用，fetch 返回前 `allSessions` 仍是上一空间数据；`loading=true` 仅在首次 `loadProjects(isFirst)` 生效。切换空间直到 fetch resolve 期间，旧 session 一直可见，且无竞态保护，旧的慢响应可能覆盖新列表。
3. **P3 范畴**：项目空间信息（切换按钮 + 标题/副标题/WT Badge + Workspace 菜单：编辑元数据 / 星标 / 归档空间·项目 / 归档所有会话）目前位于 `SessionSidebar` 顶部 header，使侧边栏承担了“当前工作区”信息，与编辑器式布局相悖。