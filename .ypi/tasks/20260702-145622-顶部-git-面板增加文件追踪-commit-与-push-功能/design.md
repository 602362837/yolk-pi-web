# Design — Git stage / commit / push

## 方案摘要

在现有 `components/GitPanel.tsx` 上增加 Git mutation 能力；后端新增/扩展 API，所有 mutation 通过 `execFile("git", ...)` 执行，不经过 shell。为避免多个 route 重复安全逻辑，新增 `lib/git-actions.ts`，集中处理 cwd 授权、repo root 校验、literal pathspec、Git 错误映射和超时。

## 影响模块和边界

### 前端

- `components/GitPanel.tsx`
  - 增加 stage/unstage/commit/push state 与 handlers。
  - 将 `FileChangeRow` 改造成可选 action row；untracked row 也复用类似布局。
  - Branch 区增加 push/publish button。
  - Staged 区增加 commit message 表单。
  - mutation 成功后调用现有 `fetchAll()`，保持 `onDirtyChange` 数据源不变。

### API

- 新增 `app/api/git/stage/route.ts`
- 新增 `app/api/git/unstage/route.ts`
- 扩展 `app/api/git/commit/route.ts` 增加 POST，保留现有 GET commit-detail。
- 新增 `app/api/git/push/route.ts`
- 可选：改造 `app/api/git/status/route.ts` 为 `git status --porcelain=v1 -z`，提升特殊文件名解析稳定性。

### 共享类型 / helper

- `lib/git-actions.ts`（新）
  - `GitActionUserError extends Error { status: number }`
  - `getGitErrorMessage(error)`
  - `runGit(args, cwd, options?)`
  - `resolveAuthorizedGitRepo(cwd)`：校验 allowed roots、存在目录、Git repo，返回 canonical cwd/repoRoot。
  - `normalizeGitPathspecs(files)`：校验 `file/oldFile`，flatten 去重，拒绝空、NUL、绝对路径、`..` 越界，限制数量。
  - `flattenChangePathspecs(files)`：rename/copy 同时包含 `oldFile` 与 `file`。
- `lib/types.ts`
  - 可新增 `GitFileActionTarget`、`GitMutationResponse`、`GitCommitCreateResponse`、`GitPushResponse`。
  - 建议修正 `GitFileChange.status` 包含 `"T"`，或直接复用 `GitCommitFileStatus`。

### 文档

- `docs/modules/api.md`：新增/更新 Git route 表。
- `docs/modules/frontend.md`：更新 `GitPanel` 职责。
- `docs/modules/library.md`：新增 `lib/git-actions.ts` 描述。

## API 契约建议

### POST `/api/git/stage`

Request:

```json
{ "cwd": "/repo", "files": [{ "file": "src/a.ts", "oldFile": "src/old.ts" }] }
```

Behavior:

- 校验 cwd/repo/pathspec。
- 执行 `git --literal-pathspecs add -- <pathspecs...>`。
- untracked track 复用此接口。

Response:

```json
{ "success": true, "count": 2 }
```

### POST `/api/git/unstage`

Request 同 stage。

Behavior:

- 执行 `git --literal-pathspecs restore --staged -- <pathspecs...>`。
- 如果需要兼容老 Git，可 fallback `git --literal-pathspecs reset -- <pathspecs...>`。

Response:

```json
{ "success": true, "count": 2 }
```

### POST `/api/git/commit`

Request:

```json
{ "cwd": "/repo", "message": "feat: add git actions" }
```

Behavior:

- `message.trim()` 不能为空，建议最大 64KB。
- `git diff --cached --quiet --exit-code` 检查必须有 staged changes；无 staged 返回 409。
- 推荐 MVP 禁止 detached HEAD commit（待确认）；否则至少 UI 明确提示。
- 执行 `git commit -m <message>`，保留 hooks。
- 成功后 `git rev-parse HEAD` 和 `git rev-parse --short HEAD`。

Response:

```json
{ "success": true, "hash": "...", "shortHash": "abc1234", "branch": "feature/x" }
```

### POST `/api/git/push`

Request:

```json
{ "cwd": "/repo", "setUpstream": false }
```

Behavior:

- server 端解析当前 branch；detached HEAD 返回 409。
- 有 upstream：执行普通 `git push`。
- 无 upstream 且 `setUpstream === true`：检查 `origin` 存在，执行 `git push -u origin <branch>`。
- 无 upstream 且未确认 publish：409，提示需要 publish。
- 推荐当本地 tracking `behind > 0` 时先 409，提示 pull/rebase。
- 不支持 force push。

Response:

```json
{ "success": true, "branch": "feature/x", "upstream": "origin/feature/x" }
```

## 数据流

```text
GitPanel fetchAll()
  ├─ GET /api/git/status?cwd=...
  └─ GET /api/git/graph?cwd=...

Stage/Track click
  └─ POST /api/git/stage { cwd, files }
      └─ git add -- <literal pathspecs>
          └─ fetchAll() -> status.staged/unstaged/untracked 更新

Unstage click
  └─ POST /api/git/unstage { cwd, files }
      └─ git restore --staged -- <literal pathspecs>
          └─ fetchAll()

Commit submit
  └─ POST /api/git/commit { cwd, message }
      ├─ git diff --cached --quiet
      ├─ git commit -m message
      └─ git rev-parse HEAD
          └─ clear message + fetchAll() + select new commit

Push click
  └─ POST /api/git/push { cwd, setUpstream }
      └─ git push / git push -u origin branch
          └─ fetchAll() -> ahead/behind/upstream 更新
```

## 工作区路径与安全边界

- `GitPanel` 当前接收 `trellisCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd`；mutation API 不能信任客户端传入的 cwd。
- 新 mutation routes 应：
  1. `getAllowedRoots()` + `isPathAllowed(canonicalCwd, roots)`。
  2. `git rev-parse --show-toplevel` 获取 repo root。
  3. 推荐要求 canonical repo root 也在 allowed roots 内；否则返回 403，并提示从 repo root 打开工作区。
  4. 所有 Git 命令在 repo root 或 canonical cwd 下执行，路径使用 repo-relative pathspec。
  5. pathspec 拒绝绝对路径、空字符串、NUL、归一化后 `..` 越界；执行时加 `--literal-pathspecs` 和 `--`。
  6. `execFile` 设置 `maxBuffer` 和合理 `timeout`（commit/push 可 120s）。
- 不在 API 中接受 remote、branch、force 等自由参数；push 的 branch 必须 server 端从当前 checkout 解析。

## 兼容性、风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 特殊文件名解析错误 | status 改用 `--porcelain=v1 -z`；pathspec 用 literal。 |
| 误 stage untracked 大文件/秘密 | `Stage all` 不含 untracked；`Track all` 单独文案。 |
| hooks 失败或耗时 | 保留 hooks，显示 stderr；设置 timeout；不清空 message。 |
| push non-fast-forward | behind > 0 禁用/409；仍透传 Git 错误。 |
| 无 upstream 行为不明确 | UI 使用 `Publish branch`，POST 带 `setUpstream: true`。 |
| detached HEAD 误提交 | 推荐 MVP 禁止 commit/push，提示切换本地分支。 |
| API 越权操作任意路径 | allowed-root + repo-root + literal pathspec + execFile。 |

## 回滚

- 前端可隐藏 action/commit/push UI，保留只读面板。
- 后端新增 routes 可独立删除；GET `/api/git/commit` 不受影响。
- `docs/modules/*` 回滚对应条目即可。
