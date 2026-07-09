# implement

## 需先阅读

- `docs/design/worktree-archive-space-sync.md`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/modules/frontend.md`
- `lib/project-registry.ts`
- `app/api/git/worktrees/archive/route.ts`
- `app/api/git/worktrees/route.ts`
- `components/SessionSidebar.tsx`
- `lib/allowed-roots.ts`

## 子任务表

| id | phase | title | order | dependsOn |
| --- | --- | --- | ---: | --- |
| WT-01 | backend | 统一 WorkTree space 归档匹配 helper | 1 | — |
| WT-02 | backend | 增加 missing-only 被动同步 | 2 | WT-01 |
| WT-03 | api | 接入 archive/delete/refresh/projects API | 3 | WT-01, WT-02 |
| WT-04 | frontend | 修复 Sidebar 归档成功后的项目树与 fallback 状态 | 4 | WT-03, UI approval |
| WT-05 | docs-tests | 文档、测试与手工验证 | 5 | WT-01, WT-02, WT-03, WT-04 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "WT-01",
      "title": "统一 WorkTree space 归档匹配 helper",
      "phase": "backend",
      "order": 1,
      "dependsOn": [],
      "files": ["lib/project-registry.ts", "lib/project-registry-types.ts"],
      "instructions": "新增或重构 WorkTree space 归档 helper，支持多个 path alias，pathKey 精确匹配为主，normalized path/realPath/pathKey 兜底；保持 markWorktreeSpaceArchivedByPath 兼容旧调用；标记 archived/missing 并可写入 additive metadata。",
      "acceptance": ["能按 cwd/status.cwd/repoRoot 任一 alias 命中同一 worktree space", "目录不存在时仍能通过存储 path 兜底匹配", "旧 markWorktreeSpaceArchivedByPath 调用不破坏"],
      "validation": ["node_modules/.bin/tsc --noEmit"],
      "risks": ["路径兜底过宽可能误匹配；限制为 kind=worktree 且同 registry 内精确 normalized path"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "WT-02",
      "title": "增加 missing-only 被动同步",
      "phase": "backend",
      "order": 2,
      "dependsOn": ["WT-01"],
      "files": ["lib/project-registry.ts"],
      "instructions": "实现 syncMissingWorktreeSpaces，可按全部项目或单 project 扫描非 archived worktree spaces；路径不存在则软归档；不执行 git 命令。",
      "acceptance": ["CLI 删除或直接删除 WorkTree 目录后可被动归档旧 space", "不会处理 main space 或 archived project", "Git 不可用时仍可运行"],
      "validation": ["node_modules/.bin/tsc --noEmit"],
      "risks": ["临时挂载不可访问会被标记 missing；如产品担心可增加节流/二次确认"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "WT-03",
      "title": "接入 archive/delete/refresh/projects API",
      "phase": "api",
      "order": 3,
      "dependsOn": ["WT-01", "WT-02"],
      "files": ["app/api/git/worktrees/archive/route.ts", "app/api/git/worktrees/route.ts", "app/api/projects/route.ts", "app/api/projects/[projectId]/worktrees/refresh/route.ts", "lib/allowed-roots.ts"],
      "instructions": "WorkTree archive/delete 成功后用统一 helper 和 aliases 清理 registry；GET /api/projects 增加 bounded missing-only sync 或支持 ?sync=missing；必要时导出并调用 invalidateAllowedRootsCache。响应添加 sync/cleanup summary，保持旧字段兼容。",
      "acceptance": ["archive/delete API 返回 archivedSpaces 或 cleanup summary", "GET projects 能捕获 missing worktree spaces 或前端可显式触发", "allowed roots 不长期保留 archived/missing space"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["GET 写副作用争议；可改为显式 sync endpoint"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "WT-04",
      "title": "修复 Sidebar 归档成功后的项目树与 fallback 状态",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["WT-03"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "在 confirmWorktreeAction 成功后刷新/乐观更新 projects；如果 selectedSpaceId 被归档，切换到同 project main/fallback space 或清空；继续处理 deletedSessionIds。实现前需满足 UI 原型门禁或主会话批准无新增视觉。",
      "acceptance": ["归档/删除成功后旧 worktree space 立即从活动列表消失", "当前工作区不再指向 removed cwd", "新会话不会绑定 archived space"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "手工 UI 验证 WorkTree 归档/删除流程"],
      "risks": ["异步 loadProjects 与 local selected state 竞态"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "WT-05",
      "title": "文档、测试与手工验证",
      "phase": "docs-tests",
      "order": 5,
      "dependsOn": ["WT-01", "WT-02", "WT-03", "WT-04"],
      "files": ["docs/architecture/overview.md", "docs/modules/api.md", "docs/modules/library.md", "docs/modules/frontend.md", "docs/design/worktree-archive-space-sync.md"],
      "instructions": "更新 WorkTree/Project Registry 文档；补充可行测试或手工验证记录，覆盖主动归档、删除、CLI remove、目录删除、git worktree move。",
      "acceptance": ["模块文档与实际 API/helper 行为一致", "验证记录覆盖关键场景", "lint/typecheck 通过"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["当前仓库测试基建较少，可能以手工验证为主"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "G1", "title": "Backend registry helpers", "subtaskIds": ["WT-01", "WT-02"] },
      { "id": "G2", "title": "API integration", "subtaskIds": ["WT-03"] },
      { "id": "G3", "title": "Sidebar state sync", "subtaskIds": ["WT-04"] },
      { "id": "G4", "title": "Docs and validation", "subtaskIds": ["WT-05"] }
    ],
    "maxConcurrency": 1
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 检查门禁

- UI 原型门禁解决后再实现 `WT-04`。
- 不执行 git commit/push/merge。
- 不硬删除 registry space，除非主会话/用户确认产品语义变化。
