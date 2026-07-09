# WorkTree 归档后项目空间同步清理设计

## 背景与目标

当前项目注册表（`~/.pi/agent/pi-web-projects.json`）把 Git WorkTree 建模为项目下的 `space.kind = "worktree"`。当 WorkTree 通过 UI/API 归档、删除，或被用户在 UI 外通过 CLI / 文件操作移除后，项目空间可能仍以活动空间存在，导致：

- 侧边栏仍展示已不存在的 WorkTree space；
- 新会话可能继续绑定到已失效的 `projectId` / `spaceId`；
- allowed roots、文件浏览、空间会话列表与真实 Git worktree 状态不一致。

目标是把 WorkTree 生命周期与 Project Registry space 生命周期收敛到同一套同步规则：主动操作立即清理，外部变更在下一次项目/空间读取或显式刷新时被动同步。

## 现状代码分析

### WorkTree 归档/删除入口

- `app/api/git/worktrees/archive/route.ts`
  - `POST /api/git/worktrees/archive`
  - 调用 `getWorktreeStatus(cwd)` 获取归档前状态；
  - 调用 `archiveGitWorktree(cwd, { beforeRemove })` 完成 squash/push/merge/remove；
  - 之后调用 `markWorktreeSpaceArchivedByPath(cwd)` 标记匹配空间归档/缺失；
  - 调用 `deleteSessionsForCwd(cwd, cleanupAliases)` 删除该 WorkTree cwd 的 session JSONL。

- `app/api/git/worktrees/route.ts`
  - `DELETE /api/git/worktrees?cwd=...`
  - 调用 `removeGitWorktree()` 删除 WorkTree；
  - 同样调用 `markWorktreeSpaceArchivedByPath(cwd)` 和 `deleteSessionsForCwd()`。

- `lib/git-worktree.ts`
  - `archiveGitWorktree()` 负责 Git 层面的归档流程，成功后执行 `git worktree remove`；
  - `removeGitWorktree()` 负责普通删除；
  - `listGitWorktrees()` / `getWorktreeStatus()` 是同步/检测的 Git 信息来源。

### Project Registry / space 管理

- `lib/project-registry.ts`
  - `registerProject()` 创建 project 和 `main` space；
  - `syncRegisteredProjectWorktreeSpace()` 在 UI/API 创建 WorkTree 后把它 upsert 为 worktree space；
  - `syncProjectWorktreeSpaces(projectId)` 通过 `git worktree list --porcelain` 发现当前 WorkTree，并把未发现的旧 worktree space 标记为 `{ archived: true, missing: true }`；
  - `markWorktreeSpaceArchivedByPath(worktreePath)` 当前只按 `canonicalizeProjectPath(worktreePath).pathKey` 匹配 worktree space 并标记归档/缺失。

### UI 状态与当前缺口

- `components/SessionSidebar.tsx`
  - `activeProjectSpaces()` 会过滤 `space.archived`，所以只要本地 `projects` 状态刷新到最新 registry，已归档空间就不会显示；
  - `confirmWorktreeAction()` 成功归档/删除后只调用 `applyWorktreeFallback()` 和 `loadSessions(false)`，没有调用 `loadProjects(false)`，也没有消费 API 返回的 `archivedSpaces` 更新本地项目树；
  - 因此即使后端已经写入 registry，当前页面内存中的 project/space 树仍可能保留旧 WorkTree space，表现为“归档后项目空间未同步清理”。

### 被动同步现状

- `POST /api/projects/[projectId]/worktrees/refresh` 已能显式调用 `syncProjectWorktreeSpaces(projectId)`。
- `GET /api/projects` 只读 `listProjects()`，不会自动检测外部删除/移动。
- `lib/session-reader.ts` 有 `pruneDeletedWorktreeSessions()`，但它只删除 cwd 形如 `*.worktrees/*` 且路径不存在的 session 文件，不会更新 Project Registry，也覆盖不了自定义 WorkTree 路径。

## 产品语义决策

推荐 v1 采用“软清理”而不是从 registry 硬删除 space：

- 将匹配 WorkTree space 标记为 `archived: true, missing: true`；
- UI 活动空间列表继续过滤 archived space；
- session header 中历史 `projectId` / `spaceId` 不需要迁移或回写；
- 如果同一路径未来重新创建 WorkTree，`syncProjectWorktreeSpaces()` 可以复用/恢复原 space，保留用户自定义 displayName/tags/pinned/baseRef 等元数据。

硬删除会让历史 session header 失去目标 space，也会丢失用户空间元数据；除非后续产品明确需要“彻底移除归档空间”，否则不建议作为本次修复默认行为。

## 方案设计

### 1. 主动清理：UI/API 归档或删除时立即同步

#### 后端

保留现有归档/删除 API 的总体顺序，但建议把清理能力收敛为一个更可靠的共享 helper：

```ts
archiveWorktreeSpacesByPaths(paths: string[], options?: {
  reason?: "api_archive" | "api_delete" | "passive_missing" | "passive_git_sync";
  missing?: boolean;
}): Promise<{ archivedSpaces: PiWebProjectSpaceRecord[]; unmatchedPaths: string[] }>
```

匹配策略：

1. 对每个输入 path 调用 `canonicalizeProjectPath()` 得到 `pathKey`；
2. 与 `space.pathKey` 精确匹配；
3. 同时用规范化 display path 与 `space.path` / `space.realPath` / `space.pathKey` 做兜底匹配，覆盖目录已删除、路径无法 realpath、symlink/display path 不一致等情况；
4. 只处理 `space.kind === "worktree"`；
5. 标记：`archived: true`, `missing: true`, `updatedAt: now`，并可在 `metadata` 中追加非破坏性审计字段，例如 `archivedReason`, `archivedAt`, `lastKnownPath`。

API 调用点：

- `app/api/git/worktrees/archive/route.ts`
  - 归档前已拿到 `status.cwd`、`status.worktree.repoRoot`、`cwd`；
  - Git 归档成功后用这些 alias 清理 registry；
  - 即使 session 删除失败，也不应回滚 registry 清理；返回 partial warning 即可。

- `app/api/git/worktrees/route.ts` 的 DELETE
  - 删除成功后同样用 `cwd` + `cleanupAliases` 清理 registry。

- 清理后应失效 allowed-roots 缓存，避免已归档/missing space 在 5s TTL 内继续授权文件 API。

#### 前端

`components/SessionSidebar.tsx` 的 `confirmWorktreeAction()` 成功后需要同步 project tree：

- 最小实现：成功后 `await loadProjects(false)`，再执行 fallback selection；
- 更稳实现：先用响应中的 `archivedSpaces` 乐观更新本地 `projects`，再后台 `loadProjects(false)` 校准；
- 如果当前选中的 `selectedSpaceId` 被归档：
  - 优先切换到同 project 的 `main` space；
  - 如果 `main` 不可用，切到第一个非 archived、非 missing space；
  - 如果没有可用 space，清空选择；
- 同步删除的 session：继续对 `deletedSessionIds` 调用 `onSessionDeleted`。

这样可解决“后端 registry 已清理但当前 UI 仍展示旧空间”的即时一致性问题。

### 2. 被动同步：外部 CLI / 文件操作后的检测

被动同步分两层，避免每次打开项目列表都无界运行 Git 命令。

#### 轻量 missing-only 同步

新增 registry helper：

```ts
syncMissingWorktreeSpaces(options?: {
  projectId?: string;
  reason?: "passive_missing";
}): Promise<{ archivedSpaces: PiWebProjectSpaceRecord[] }>
```

规则：

- 扫描非 archived project 的非 archived worktree spaces；
- 对 `space.path` 做 `canonicalizeProjectPath(space.path)` 或 `fs.stat`；
- 如果路径不存在，标记 `{ archived: true, missing: true }`；
- 不执行 Git 命令；
- 适合在 `GET /api/projects`、space sessions API 或 Sidebar 初次加载时节流触发。

建议在 `GET /api/projects` 增加 bounded passive sync：

- 默认执行 missing-only，同步成本低；
- 或通过 `?sync=missing` 显式启用，前端 `loadProjects()` 默认带上该参数；
- 返回 `{ projects, sync?: { archivedSpaces } }`，保持旧调用兼容。

#### Git full refresh 同步

复用并增强现有 `syncProjectWorktreeSpaces(projectId)`：

- 继续通过 `git worktree list --porcelain` upsert 当前 worktrees；
- 对未发现的旧 spaces 软归档；
- 用上述统一匹配/归档 helper 处理 alias；
- 在 project 被展开、点击刷新、创建/删除 WorkTree 后调用；
- 可增加全局/进程内节流（例如 30–60s）避免 Sidebar 频繁刷新时重复 Git 扫描。

外部操作覆盖：

- `git worktree remove` / 直接删除目录：missing-only 即可归档旧 space；
- `git worktree move`：full refresh 可创建/恢复新路径 space，并归档旧路径 space；
- 手动编辑 `.git/worktrees` 或 `git worktree prune`：full refresh 以 Git porcelain 为准。

### 3. 边缘情况策略

| 场景 | 策略 |
| --- | --- |
| WorkTree 目录被删除 | missing-only 被动同步标记 space archived/missing；session listing 现有 prune 继续清理 `.worktrees/*` session，后续可扩展为按 registry missing space 删除匹配 sessions。 |
| WorkTree 目录被移动 | 旧路径 missing-only 归档；如果使用 `git worktree move` 且主项目仍可发现，新路径由 full refresh upsert 为新/恢复 space。 |
| 自定义 WorkTree 路径不在 `.worktrees` 下 | registry 被动同步仍按 space.path 检测；不要依赖 session-reader 的 `.worktrees` 启发式。 |
| symlink/display path 与 realpath 不一致 | 统一使用 `canonicalizeProjectPath().pathKey`，并保留 normalized display/real path 兜底。 |
| 主项目目录不存在 | 不自动硬归档 project；可把 main/worktree spaces 标记 missing 或返回 sync warning，避免误删用户 registry。 |
| Git 命令失败 | missing-only 仍可工作；full refresh 返回 `syncWarning`，不阻塞项目列表读取。 |
| 同一路径重新创建 WorkTree | `syncProjectWorktreeSpaces()` 可将旧 archived/missing space 恢复为 active，并更新 worktree metadata。 |
| 并发归档/刷新 | registry 写入应保持原子；如出现多路写入丢更新风险，可增加进程级 registry write lock。 |
| 已归档 session header 指向 archived space | 不迁移 header；space 作为历史元数据存在即可，活动 UI 不展示 archived space。 |

## 影响模块

- `lib/project-registry.ts`
  - 新增统一 WorkTree space 归档 helper；
  - 增强路径匹配；
  - 新增 missing-only 被动同步；
  - 可增强 `syncProjectWorktreeSpaces()` 使用统一 helper。

- `app/api/git/worktrees/archive/route.ts`
  - 使用 alias 清理 helper；
  - 返回 cleanup summary / warnings。

- `app/api/git/worktrees/route.ts`
  - DELETE 使用同一 helper；
  - POST 创建后逻辑保持 upsert。

- `app/api/projects/route.ts`
  - 可选/默认触发 missing-only passive sync；
  - 响应保持 `{ projects }` 兼容，可新增 `sync` 字段。

- `app/api/projects/[projectId]/worktrees/refresh/route.ts`
  - 继续作为 full refresh 入口，返回新增 cleanup summary。

- `components/SessionSidebar.tsx`
  - WorkTree archive/delete 成功后刷新/更新 projects；
  - 当前 selected space 被归档时切换到 fallback space。

- `lib/allowed-roots.ts`
  - 建议导出 `invalidateAllowedRootsCache()`，registry 清理后调用。

- 文档
  - 更新 `docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/modules/frontend.md` 中 WorkTree / Project Registry 清理描述。

## 实施步骤

1. 在 `lib/project-registry.ts` 增加路径匹配和统一归档 helper，保证现有 `markWorktreeSpaceArchivedByPath()` 可兼容调用新 helper。
2. 增加 `syncMissingWorktreeSpaces()`，并为 full refresh 复用统一归档逻辑。
3. 在 WorkTree archive/delete API 中传入 `cwd`、`status.cwd`、`status.worktree.repoRoot` 等 alias，返回 cleanup summary。
4. 在 `GET /api/projects` 或前端 `loadProjects()` 链路加入 bounded missing-only 被动同步。
5. 修改 `SessionSidebar`：归档/删除成功后刷新 projects，并在当前 space 被归档时选择 fallback。
6. 增加/更新测试：project registry path matching、missing-only sync、active archive response、Sidebar state fallback（如当前测试基建不足，至少补充手工验证脚本）。
7. 更新模块文档。

## 验证建议

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

手工验证：

1. 注册一个 Git 项目，创建 WorkTree；确认侧边栏出现 worktree space。
2. 通过 UI 执行 WorkTree 归档；确认 API 返回 `archivedSpaces`，侧边栏立即移除该 space，并切到 main/fallback space。
3. 通过 UI 执行 WorkTree 删除；确认行为同上，相关 sessions 被删除。
4. 在终端执行 `git worktree remove <path>` 后刷新项目列表；确认 missing-only/full refresh 后 space 被归档隐藏。
5. 直接删除 WorkTree 目录后刷新项目列表；确认 space 被归档隐藏，文件浏览不再授权该路径。
6. 使用 `git worktree move` 移动 WorkTree 后触发 full refresh；确认旧 space archived/missing，新路径 space active。
7. 使用 symlink/display path 注册项目或 WorkTree，确认 pathKey 匹配不重复、不漏清理。

## 风险与缓解

- **GET /api/projects 引入写副作用**：限定为 missing-only、可节流、响应中暴露 sync summary；或改为前端显式调用 sync API。
- **Git full refresh 成本**：仅在项目展开、显式刷新、创建/删除后触发；全局节流。
- **误归档临时不可访问路径**：missing-only 只处理 worktree spaces，不处理 main project；可要求连续两次 missing 或记录 `lastMissingDetectedAt` 后再归档，但 v1 可先按本地文件系统事实处理。
- **路径匹配误差**：以 pathKey 为主，display/real path 为兜底；不跨 project 处理 main space。
- **UI 原型门禁**：本修复会改变 Sidebar 中 WorkTree 归档后的可见状态和 fallback 选择，进入实现前需要 UI 设计员给出基于现有 Sidebar 的 HTML 原型或主会话明确批准“无新增视觉，仅状态同步修复”。
