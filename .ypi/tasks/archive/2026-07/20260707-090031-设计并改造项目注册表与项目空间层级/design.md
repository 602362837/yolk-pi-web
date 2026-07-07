# design

## 方案摘要

引入独立 **Project Registry** 作为左侧项目树唯一顶层数据源，Session 不再参与项目列表聚合。Project 下固定有一个 `main` space，并可包含多个 Git worktree space；Session 是 space 下的历史记录，新增会话写入 `projectId + spaceId`，旧会话缺字段时继续可读可打开。

## 用户确认决策

- legacy exact-cwd 旧会话可以在匹配 space 下折叠展示为“未关联旧会话”，但不得自动关联/回写。
- Project/space 删除第一版只做 archive，不硬删 registry 和 sessions。
- WorkTree 删除/归档第一版沿用现有“删除相关 sessions”行为，同时 registry space 标记 archived/missing。
- 不做手动把旧 session 关联到当前 space 的能力。
- 必须处理软连接路径去重：同一真实目录不能因 symlink/display path 不同聚成多个项目。

## Project Registry

存储位置：`getAgentDir()/pi-web-projects.json`。

核心字段：

```ts
type ProjectId = `prj_${string}`;
type ProjectSpaceId = "main" | `wt_${string}` | string;
type ProjectSpaceKind = "main" | "worktree";

interface PiWebProjectRecord {
  id: ProjectId;
  rootPath: string;       // 用户可见/display path，保留用户添加时的路径表达
  realRootPath?: string;  // fs.realpath 后路径，realpath 成功时用于去重/匹配
  pathKey: string;        // canonical dedupe key，优先 realpath，去尾斜杠
  displayName?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  spaces: Record<ProjectSpaceId, PiWebProjectSpaceRecord>;
}

interface PiWebProjectSpaceRecord {
  id: ProjectSpaceId;
  projectId: ProjectId;
  kind: ProjectSpaceKind;
  path: string;           // 用户可见/display cwd
  realPath?: string;      // fs.realpath 后 cwd
  pathKey: string;        // canonical dedupe key
  displayName?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  missing?: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  worktree?: {
    branch?: string;
    repoRoot?: string;
    mainWorktreePath?: string;
    mainWorktreeBranch?: string;
    discoveredAt?: string;
  };
}
```

## 软连接/路径 canonical 规则

新增统一 helper，例如 `canonicalizeProjectPath(inputPath)`：

1. 展开 `~`，转绝对路径，normalize，去尾斜杠。
2. 优先调用 `fs.realpath` / `fs.realpath.native`。
3. `pathKey = normalize(realpathResult)`；realpath 失败时才 fallback 到 normalized display path，并返回 `missing/invalid` 标记。
4. Project/space 去重、session cwd 匹配、WorkTree 归属判断、allowed roots 均优先使用 `pathKey`。
5. UI 可展示用户输入的 `rootPath/path`，但内部比较不能用 display path。
6. 同一 `pathKey` 已存在 active project/space 时，POST 注册应返回既有记录，不创建重复项目。

## Session link

扩展 session header：

```ts
interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
  projectId?: string;
  spaceId?: string;
}
```

新 session / draft / fork 写入 optional `projectId/spaceId`，并维护 `pi-web-session-index.json`。旧 session 缺字段时返回 `legacyUnassigned=true`，不得报错。索引只服务性能，header 是真源。

## WorkTree 兼容

- 继续使用现有 `pi-web.json.worktree` 创建模板。
- 注册/刷新项目时通过 `git worktree list --porcelain` 发现 worktree，并映射为 project 子 space。
- Worktree path 同样使用 realpath canonical pathKey 去重，避免 symlink worktree 重复。
- 删除/归档 worktree 保持现有删除相关 sessions 行为，同时 space 标记 `archived=true/missing=true`。

## API / lib 边界

新增/扩展：

- `lib/project-registry-types.ts`
- `lib/project-registry.ts`
- `lib/project-session-index.ts`
- `lib/session-project-link.ts`
- `app/api/projects/**`
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`
- 扩展 `app/api/agent/new`、`app/api/agent/draft`、fork 逻辑、session reader、worktree routes、allowed roots。

关键 API：

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/[projectId]`
- `GET/PATCH /api/projects/[projectId]/spaces/[spaceId]`
- `GET /api/projects/[projectId]/spaces/[spaceId]/sessions`
- `POST /api/projects/[projectId]/worktrees/refresh`

## 前端数据流

左侧从 `/api/projects` 加载 Project/Space，不再从 `/api/sessions` 聚合项目。选中/展开 space 后才 lazy load sessions。

AppShell 状态以 project/space 为主：

```ts
selectedProjectId: string | null;
selectedSpaceId: string | null;
activeSpace: ProjectSpaceSummary | null;
activeCwd = activeSpace?.path ?? selectedSession?.cwd ?? legacySessionCwd;
```

下游文件、Git、Studio、Terminal 继续消费 cwd/path。

## Legacy session 策略

- 不做历史 session 反推项目迁移。
- URL/历史入口可打开旧 session。
- 在已注册 space 下可折叠展示 exact-cwd legacy sessions，标签为“未关联旧会话”。匹配时也应用 realpath canonical key，避免 symlink 路径漏匹配或重复。

## 实施计划

按 implementationPlan 的 6 个子任务执行：Registry lib/API、Session link、WorkTree sync、Sidebar/AppShell、Metadata/legacy UX、Docs/validation。
