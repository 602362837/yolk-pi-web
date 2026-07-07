# design

## 涉及文件与现有链路

### 文档/规范

- `AGENTS.md`：要求项目/空间数据来自 Project Registry，路径比较用 canonical `pathKey`，改共享字段需同步消费者与文档。
- `docs/architecture/overview.md`：Project Registry 是顶层项目源；`main` space 表示项目根；session header 的 `spaceId` 可选且不自动回写旧会话。
- `docs/modules/frontend.md`：`components/SessionSidebar.tsx` 是项目/空间树、顶部空间信息、WorkTree 操作入口。
- `docs/modules/api.md`：Project Registry、Git info、WorkTree API 路由契约。
- `docs/modules/library.md`：`lib/project-registry-types.ts`、`lib/project-registry.ts`、`lib/git-worktree.ts`、`lib/workspace-title.ts` 的职责。

### 数据结构 / API

- `lib/project-registry-types.ts`
  - `PiWebProjectRecord.spaces` 存储项目空间。
  - `PiWebProjectSpaceRecord.kind` 为 `"main" | "worktree"`。
  - `PiWebProjectSpaceWorktreeInfo` 现有字段：`branch`、`repoRoot`、`mainWorktreePath`、`mainWorktreeBranch`、`discoveredAt`。
- `lib/project-registry.ts`
  - `registerProject()` 创建 `id: "main"` 的 main space；当前不会写入 `displayName: "Main"`，UI 的 `Main` 主要来自前端 fallback。
  - `upsertWorktreeSpace()` 新建 WorkTree space 时用 branch 作为 displayName，并写入 `worktreeInfoFromRecord()`。
  - `syncRegisteredProjectWorktreeSpace()` 在 `/api/git/worktrees` 创建 WorkTree 后把 worktree path 注册为空间；当前只传 branch，未保存 `baseRef`。
- `lib/git-worktree.ts`
  - `createGitWorktree()` 返回 `baseRef`、`branchName`、`worktree.mainWorktreeBranch`。
  - `getGitMetadataForCwd()` 可返回当前 cwd 的 `branch`、`isWorktree`、`mainWorktreeBranch`，但无法恢复创建时 baseRef。
- API
  - `GET /api/projects` 返回 registry project/space 原始记录。
  - `POST /api/git/worktrees` 创建 WorkTree，响应中已有 `baseRef`，但 registry link 未持久化 baseRef。
  - `GET /api/git/info?cwd=` 为 Sidebar/AppShell 提供当前 cwd Git 元数据。
- UI
  - `components/SessionSidebar.tsx`
    - `displaySpaceName()` 当前 `space.kind === "main"` fallback 为 `Main`。
    - `WorkspaceHeaderLine` 渲染侧边栏顶部标题/副标题。
    - 当前 `workspaceSubtitle` 为 `<spaceName> · <short path>`，未稳定展示分支/WorkTree 基准。
    - `WorktreeBadge` 只展示 `WT` + branch，tooltip 只写 branch。
    - `worktreeInfoFromSpace()` 将 registry worktree 字段转为 UI `WorktreeInfo`。
  - `lib/workspace-title.ts`
    - 非 Project Registry 兜底标题/副标题已有 `worktree · <branch> ← <mainWorktreeBranch>` 与 `branch · <branch>`，但为英文，且不含空间名。

## 推荐最小方案

1. 前端文案/展示 fallback
   - 在 `SessionSidebar.tsx` 将 main space 默认名从 `Main` 改为 `主空间`。
   - 保持用户自定义 `space.displayName` 优先；不改 `space.id` / `space.kind` / session header。

2. 增加空间信息格式化 helper
   - 在 `SessionSidebar.tsx` 新增纯 helper：
     - `formatProjectSpaceSubtitle(space, gitOrWorktree, homeDir)`：生成一行顶部副标题。
     - `formatProjectSpaceDetail(space, gitOrWorktree, homeDir)`：生成 tooltip/detail，多行包含完整路径。
     - `formatWorktreeBase(worktree)`：优先 `baseRef`，其次 `mainWorktreeBranch`，否则未知。
   - `workspaceSubtitle` 改为使用新 helper；`WorkspaceHeaderLine.detail` 传多行完整信息。
   - `WorktreeBadge` tooltip 增加基准信息。

3. 可选但推荐的数据结构补充：保存创建时 baseRef
   - 在 `PiWebProjectSpaceWorktreeInfo`、`GitInfo`/`WorktreeInfo`（如 UI 需要统一投影）中增加可选 `baseRef?: string`。
   - `WorktreeRecord` 或 `upsertWorktreeSpace()` 入参支持可选 `baseRef`。
   - `POST /api/git/worktrees` 调用 `syncRegisteredProjectWorktreeSpace()` 时传 `result.baseRef`。
   - `worktreeInfoFromRecord()` 在没有新 baseRef 时保留 existing space 的 `worktree.baseRef`，避免刷新后丢失。
   - 已发现/旧 WorkTree 无 baseRef 时，UI 使用 `mainWorktreeBranch` 作为“基准”兜底或显示 `基准未知`，不要写死 `main`。

4. 文档同步
   - 若增加 `baseRef` 字段，更新 `docs/architecture/overview.md` 与 `docs/modules/library.md` 中 Project Registry / WorkTree metadata 描述。
   - 若只做前端展示，不需要更新 API 文档；若 API 响应/类型新增字段，更新 `docs/modules/api.md` 对 `git/worktrees` 与 Project Registry 的说明。

## 风险与缓解

- **历史 `displayName: "Main"` 是否替换**：当前代码看起来 `Main` 是前端 fallback，不是默认持久化值。建议不做迁移；如产品要求覆盖历史 exact `Main`，应明确这是产品决策。
- **baseRef 缺失或不准确**：Git worktree porcelain 不提供创建来源。新建时可保存 `baseRef`；旧/外部创建的 WorkTree 只能展示 `mainWorktreeBranch` 或未知。
- **mainWorktreeBranch 会变化**：它代表当前主工作树分支，不一定是创建来源。UI 文案用“基准”并在缺失/推断时谨慎表达。
- **信息过密**：顶部副标题保持一行省略；完整信息放 tooltip。
- **类型扩散**：新增字段需同步 `project-registry-types.ts`、`types.ts`、`git-worktree.ts`、`SessionSidebar.tsx`，避免 TS 严格模式报错。
