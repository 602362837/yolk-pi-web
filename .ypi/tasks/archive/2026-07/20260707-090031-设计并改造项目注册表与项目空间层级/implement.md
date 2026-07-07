# Implement Plan

完整架构设计见 design.md。实施拆分：

1. Registry lib/API：新增 `pi-web-projects.json` schema、类型、原子读写、注册项目、PATCH 项目/空间。路径 canonical 必须优先 realpath，display path 与 pathKey 分离，避免软连接导致重复项目。
2. Session project link：扩展 session header optional `projectId/spaceId`，新增 session index，新建/draft/fork session 写入归属，旧 session 兼容。legacy exact-cwd 匹配也使用 canonical pathKey。
3. WorkTree sync：复用现有 worktree 配置，Git worktree list 映射为 project space，创建/删除/归档同步 registry，allowed roots 纳入 registry paths。worktree path 同样 realpath 去重。
4. Sidebar/AppShell：左侧改为 `/api/projects` 驱动，space 展开后懒加载 sessions，新聊天携带 project context，URL 打开旧 session 不依赖项目树。
5. Metadata/legacy UX：项目/空间昵称、tags、pin/archive 最小编辑入口；legacy unassigned 折叠展示；missing/archived space 禁用新建。
6. Docs/validation：更新 architecture/API/frontend/library 文档，执行 lint/tsc 和手工验收。

用户已确认：legacy 折叠展示、删除只 archive、WorkTree 删除行为先保持现状、不做旧 session 手动关联。