# Implement — 建议实现步骤

## 需先阅读的文件

- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `components/GitPanel.tsx`
- `components/AppShell.tsx`（确认 `GitPanel` cwd/dirty 刷新入口）
- `app/api/git/status/route.ts`
- `app/api/git/commit/route.ts`
- `app/api/git/switch/route.ts`
- `lib/types.ts`
- `lib/allowed-roots.ts`
- `lib/cwd.ts`

## 文件级改动建议

1. **新增 `lib/git-actions.ts`**
   - 抽取 Git mutation 共享逻辑：`runGit`、`GitActionUserError`、`getGitErrorMessage`、`resolveAuthorizedGitRepo`、`normalizeGitPathspecs`。
   - 使用 `execFile`，不使用 shell。
   - mutation 默认 timeout：stage/unstage 30s，commit/push 120s。

2. **更新 `lib/types.ts`**
   - 新增 request/response 类型（可选但推荐）：
     - `GitFileActionTarget`
     - `GitFileMutationResponse`
     - `GitCommitCreateResponse`
     - `GitPushResponse`
   - 将 `GitFileChange.status` 补齐 `"T"` 或复用 `GitCommitFileStatus`。

3. **新增 `app/api/git/stage/route.ts`**
   - POST body: `{ cwd, files }`。
   - 复用 helper 校验。
   - 执行 `git --literal-pathspecs add -- ...paths`。
   - 错误：400 参数错误、403 cwd 越权、404 非 Git repo、500 Git 执行失败。

4. **新增 `app/api/git/unstage/route.ts`**
   - POST body: `{ cwd, files }`。
   - 执行 `git --literal-pathspecs restore --staged -- ...paths`；必要时 fallback `reset --`。

5. **扩展 `app/api/git/commit/route.ts`**
   - 保留现有 GET。
   - 增加 POST：校验 message、staged changes、detached 策略；执行 commit；返回新 hash。
   - 尽量复用 `lib/git-actions.ts` 的错误与执行 helper，避免与现有 GET helper 大量重复。

6. **新增 `app/api/git/push/route.ts`**
   - POST body: `{ cwd, setUpstream?: boolean }`。
   - server 端读取 current branch、upstream、ahead/behind、remote origin。
   - 普通 push 或 publish branch；不接受客户端 branch/remote/force。

7. **可选但推荐：更新 `app/api/git/status/route.ts`**
   - 改为 `git status --porcelain=v1 -z` 并新增 z-parser。
   - 保持 response shape 不变：`staged: GitFileChange[]`、`unstaged: GitFileChange[]`、`untracked: string[]`。

8. **更新 `components/GitPanel.tsx`**
   - 增加 state：`pendingAction`、`gitActionError`、`gitActionSuccess`、`commitMessage`。
   - 增加 helpers：`postGitAction()`、`handleStage()`、`handleUnstage()`、`handleCommit()`、`handlePush()`。
   - 将 `FileChangeRow` 增加 props：`actionLabel?`、`onAction?`、`disabled?`、`pending?`。
   - Untracked row 使用相同样式，action 为 `Track`。
   - Staged header 加 `Unstage all`；Unstaged header 加 `Stage all`；Untracked header 加 `Track all`。
   - Staged section 加 commit textarea + button。
   - Branch summary 加 push/publish button 与 disabled reason。
   - 成功后统一 `await fetchAll()`；commit 成功后 `setSelectedCommitHash(hash)`。

9. **更新文档**
   - `docs/modules/api.md`：`git/commit` Methods 改为 `GET/POST`，新增 `git/stage`、`git/unstage`、`git/push`。
   - `docs/modules/frontend.md`：更新 `GitPanel` 说明。
   - `docs/modules/library.md`：新增 `lib/git-actions.ts`。

## 实现顺序

1. 写 `lib/git-actions.ts` 与类型。
2. 写 stage/unstage routes，并用 curl 或浏览器手测单文件 stage/unstage。
3. 写 commit POST，验证 no staged / empty message / hook failure / success。
4. 写 push POST，验证 upstream / no upstream / detached / behind。
5. 改 `GitPanel` UI 与交互。
6. 可选改 status z-parser。
7. 更新 docs。
8. 跑 lint + type-check，手工验收。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

不要直接运行 `next build`；若需要发布级验证再使用 `npm run build`。

## 手工验证场景

1. 在测试 repo 新建 untracked 文件：Git 面板显示在 Untracked，点击 Track 后进入 Staged。
2. 修改 tracked 文件：点击 Stage 后进入 Staged；点击 Unstage 后回到 Unstaged。
3. 删除 tracked 文件：Stage/Unstage 后状态正确。
4. rename 文件：stage/unstage 能处理 old/new path，不报 pathspec 错。
5. staged 为空时 commit disabled；message 为空时 commit disabled。
6. commit hooks 失败时错误展示，message 保留。
7. commit 成功后 message 清空、graph 刷新、选中新 commit、dirty 状态按最新 status 更新。
8. upstream 分支 ahead > 0 时 Push 成功，ahead 变 0。
9. 无 upstream 分支 Publish 成功后 upstream 显示；若未确认 publish，API 返回明确错误。
10. detached HEAD 下 push 禁用/API 409。
11. 传入越权 cwd 或绝对 pathspec 时 API 403/400。

## 检查门禁

- 不使用 `child_process.exec` 或 shell 拼接命令。
- 不接受客户端传入的 remote/force/branch 作为 push 目标。
- 不让 `Stage all` 自动包含 untracked。
- API 失败不能清空 commit message。
- mutation 成功必须刷新 `status`，保持顶部 Git dirty dot 正确。
