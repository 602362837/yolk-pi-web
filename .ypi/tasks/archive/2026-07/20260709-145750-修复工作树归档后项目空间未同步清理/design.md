# design

完整设计文档：[`docs/design/worktree-archive-space-sync.md`](../../../../docs/design/worktree-archive-space-sync.md)。

## 方案摘要

采用“主动清理 + 被动同步”的双层方案：

1. 主动清理：WorkTree archive/delete API 成功后，使用统一 helper 按 cwd/alias 匹配 worktree space，并标记 `archived: true, missing: true`；前端成功后刷新或乐观更新 projects，立即隐藏旧 space。
2. 被动同步：增加 missing-only registry sync 捕获 CLI 删除/直接删除；继续使用 `syncProjectWorktreeSpaces(projectId)` 作为 Git full refresh 捕获 move/prune 等 Git 元数据变化。
3. 路径匹配：以 canonical `pathKey` 为主，display/real path 兜底，覆盖目录已缺失和 symlink 场景。
4. 兼容性：不硬删除 space，不迁移 session header，只新增可选 metadata / response summary。

## 影响模块

- `lib/project-registry.ts`
- `app/api/git/worktrees/archive/route.ts`
- `app/api/git/worktrees/route.ts`
- `app/api/projects/route.ts`
- `app/api/projects/[projectId]/worktrees/refresh/route.ts`
- `components/SessionSidebar.tsx`
- `lib/allowed-roots.ts`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/modules/frontend.md`

## 关键风险

- GET projects 写副作用需节流或改为显式 sync endpoint。
- WorkTree 路径临时不可访问时可能被标记 missing/archived。
- 前端 fallback 选择若不处理，会继续保留 stale selected space。
- UI 原型门禁仍需主会话处理。
