# brief

## 任务

分析并设计“工作树归档后项目空间未同步清理”的修复方案。

## 结论摘要

- WorkTree 归档/删除 API 后端已调用 `markWorktreeSpaceArchivedByPath()`，但前端 `SessionSidebar` 成功后没有刷新/更新 Project Registry 状态，导致当前页面仍展示旧 worktree space。
- 非 UI 操作目前只能通过显式 `POST /api/projects/[projectId]/worktrees/refresh` 同步；`GET /api/projects` 不会被动检测缺失 WorkTree。
- 推荐采用“软清理”：将 worktree space 标记为 `archived: true, missing: true`，活动 UI 过滤隐藏，不硬删除 registry 记录。
- 详细设计已产出：[`docs/design/worktree-archive-space-sync.md`](../../../../docs/design/worktree-archive-space-sync.md)。
