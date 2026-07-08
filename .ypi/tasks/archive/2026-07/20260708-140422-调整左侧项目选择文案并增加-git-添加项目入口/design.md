# Design：左侧项目选择文案与 Git 添加入口

## 方案摘要

在 `SessionSidebar` 的项目选择下拉中做一个可扩展的 Git 添加项目闭环：

1. 将普通目录选择入口文案改为 `Add project folder…`。
2. 新增 Git 添加入口，文案固定为 `Add project from Git…`。
3. Git 表单包含两个输入：`Local parent path` 与 `Remote repository`。
4. 父目录选择按钮只回填 `Local parent path`；不注册项目、不切换当前项目。
5. 用户提交后调用新增后端 clone 接口：后端在父目录下执行 `git clone`，clone 成功后注册克隆出的项目，并返回 Project Registry 项目与 main space；前端选中该 main space。
6. 普通 `Add project folder…` / `Add project path…` 继续走现有 `/api/projects` 注册语义。

## 影响模块和边界

| 模块/文件 | 影响 | 边界 |
| --- | --- | --- |
| `components/SessionSidebar.tsx` | 新增 Git 表单状态、目录选择 handler、clone submit handler、Git 菜单项与展开态；修改文件夹添加文案。 | 不改 session tree、WorkTree、Project Registry schema。 |
| `app/api/projects/select-directory/route.ts` | 兼容扩展请求体 `purpose?: "project" | "git-parent"`，用于目录选择器固定提示文案。 | 不接受任意客户端 prompt；响应仍为 `{ path?; canceled?; error? }`。 |
| `app/api/projects/git-clone/route.ts`（新增，建议） | 接收父目录和远程仓库地址，执行 clone，注册克隆后项目，返回注册结果。 | 不做凭据管理、分支选择、进度流、后台队列。 |
| `lib/project-registry.ts` | 复用 `registerProject()` / `syncProjectWorktreeSpaces()`。 | 不改 registry 数据结构。 |
| `docs/modules/frontend.md` | 实现阶段更新 `SessionSidebar` 描述。 | 仅文档同步。 |
| `docs/modules/api.md` | 实现阶段记录 `select-directory` purpose 与新增 `projects/git-clone` 契约。 | 仅文档同步。 |

## 前端状态设计

在 `SessionSidebar` 中增加与 `customPath*` 隔离的局部状态：

- `gitAddOpen: boolean`
- `gitParentPathValue: string`
- `gitRemoteRepositoryValue: string`
- `gitAddError: string | null`
- `gitParentPickerBusy: boolean`
- `gitCloneBusy: boolean`
- `gitParentPathInputRef: useRef<HTMLInputElement>(null)`
- `gitRemoteRepositoryInputRef: useRef<HTMLInputElement>(null)`

交互规则：

- 打开 Git 表单时关闭 `customPathOpen` 并清理 `customPathError`。
- 打开手动路径表单时关闭 Git 表单并清理 Git 临时状态。
- 外部点击、取消、Escape 关闭下拉/表单时清理 Git 临时状态。
- `gitParentPickerBusy` 与普通 `directoryPickerBusy` 分离，避免互相污染。
- `gitCloneBusy` 期间禁用 Git 表单输入、目录按钮、提交按钮，防止重复 clone。

## 数据流 / API 契约

### 普通添加项目文件夹（保持现状）

```text
User clicks Add project folder…
  -> POST /api/projects/select-directory { purpose?: "project" }  # 或无 body 兼容
  -> returns { path }
  -> registerAndSelectProjectPath(path)
  -> POST /api/projects { path }
  -> server returns { project, created, worktrees }
  -> UI sets selectedProjectId / selectedSpaceId / selectedCwd to returned main space
```

### 手动添加项目路径（保持现状）

```text
User clicks Add project path…
  -> input project path
  -> Add
  -> POST /api/projects { path }
  -> select returned main space
```

### Git 添加项目（新增闭环）

```text
User clicks Add project from Git…
  -> gitAddOpen = true
  -> user fills Local parent path and Remote repository
  -> or clicks parent directory picker
      -> POST /api/projects/select-directory { purpose: "git-parent" }
      -> setGitParentPathValue(path)
  -> user clicks Clone and add
      -> POST /api/projects/git-clone { parentPath, remoteRepository }
      -> backend runs git clone under parentPath
      -> backend registers cloned project path
      -> returns { project, created, worktrees, clone }
  -> UI selects returned project.spaces.main
```

### `select-directory` 兼容扩展

请求：

```ts
type SelectDirectoryRequest = {
  purpose?: "project" | "git-parent";
};
```

响应保持：

```ts
interface DirectoryPickResult {
  path?: string;
  canceled?: boolean;
  error?: string;
}
```

服务端只允许 enum 映射到固定文案：

- `project`：`Select project directory`
- `git-parent`：`Select Git parent directory`

禁止把任意客户端字符串拼入 `osascript` / shell / PowerShell。

### 新增 `POST /api/projects/git-clone`（建议契约）

请求：

```ts
interface GitCloneProjectRequest {
  parentPath: string;
  remoteRepository: string;
}
```

成功响应：

```ts
interface GitCloneProjectResponse {
  project: PiWebProjectRecord;
  created: boolean;
  worktrees: unknown; // 与 /api/projects 当前返回一致
  clone: {
    parentPath: string;
    targetPath: string;
    repositoryName: string;
    remoteRepository: string;
  };
}
```

错误响应：

```ts
interface GitCloneProjectErrorResponse {
  error: string;
  code?:
    | "invalid_parent_path"
    | "invalid_remote_repository"
    | "git_not_available"
    | "target_exists"
    | "clone_failed"
    | "clone_timeout"
    | "register_failed";
  clonedPath?: string;
}
```

## 后端实现要点

- 使用 `fs.stat` / `fs.access` 校验 `parentPath` 存在、是目录、可写。
- 使用 `execFile("git", ["--version"])` 检查 Git 可用性；clone 时使用 `execFile("git", ["clone", "--", remoteRepository], { cwd: parentPath })` 或等价无 shell 调用，避免 shell 注入。
- 从远程地址推导仓库目录名：取最后一段路径，去掉尾部 `.git`，做基本非法字符/空值校验；如目标目录已存在则拒绝，不覆盖。
- clone 成功后验证目标路径存在且是目录，再调用 `registerProject({ path: targetPath })` 与 `syncProjectWorktreeSpaces(project.id)`。
- 如果 clone 成功但注册失败，返回 `register_failed` 和 `clonedPath`，不自动删除克隆目录。
- 设置合理超时并返回 `clone_timeout`；不要在路由中暴露 stdout/stderr 全量敏感内容，只返回截断后的错误摘要。

## 兼容性

- 现有 `POST /api/projects/select-directory` 无 body 调用继续可用，默认 `purpose = "project"`。
- `/api/projects` 注册契约不变。
- Project Registry 文件格式不变。
- 已注册项目、legacy sessions、WorkTree 列表不受影响。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| clone 长时间运行导致请求超时 | 用户等待或失败 | v1 显示忙碌态并设置明确超时；未来再做后台任务/进度流。 |
| 私有仓库需要交互式凭据 | clone hang/失败 | 禁用交互式 prompt（如设置环境变量）并提示用户先配置 SSH/credential helper。 |
| 远程地址被当作 shell 片段执行 | 命令注入 | 后端必须使用 `execFile` 参数数组，不使用 shell 拼接。 |
| 目标目录已存在 | 覆盖用户文件风险 | 拒绝并提示，不执行 pull/覆盖。 |
| clone 成功但注册失败 | 用户已获得代码但 UI 未选中 | 返回 `clonedPath`，提示可重试或用 `Add project path…` 手动注册。 |
| Git 表单误复用普通路径注册 handler | 父目录被注册为项目 | 目录选择只回填父目录；只有 clone 成功后的 targetPath 才注册。 |
| 窄侧栏布局挤压 | 可用性下降 | 修订 UI 原型覆盖窄侧栏，输入与按钮 flex/ellipsis。 |

## 回滚方案

- 删除 `SessionSidebar` 中 Git 表单状态、菜单项和 clone submit handler。
- 删除新增 `app/api/projects/git-clone/route.ts`。
- 如扩展了 `select-directory`，保留 enum 兼容不影响旧调用；若必须回滚，恢复固定 prompt。
- `Add project folder…` 文案可独立保留或按产品要求恢复。
