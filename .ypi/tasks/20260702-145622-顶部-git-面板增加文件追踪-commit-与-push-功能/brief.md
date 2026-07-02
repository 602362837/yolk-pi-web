# Brief — 顶部 Git 面板增加文件追踪、commit 与 push

## 目标

在现有顶部 `GitPanel` 中，把只读的 `Staged Changes` / `Unstaged Changes` / `Untracked Files` 改造成可操作面板：支持单文件/批量 stage、unstage、track untracked，支持提交 staged changes，并支持 push 当前分支。

## 已读证据

- `docs/modules/api.md`：当前 Git API 只有 `status/info/graph/commit/diff/switch/worktrees`，缺少 stage/unstage/push，`commit` 目前仅 GET 读提交详情。
- `docs/modules/frontend.md`：`components/GitPanel.tsx` 是顶部 Git 面板入口。
- `docs/modules/library.md`、`docs/architecture/overview.md`：共享类型放 `lib/types.ts`，可复用逻辑进 `lib/`，工作区文件 API 已使用 allowed-roots 安全边界。
- `components/GitPanel.tsx`：已 fetch `/api/git/status` + `/api/git/graph`，显示分支、commit graph、commit details、staged/unstaged/untracked/stash；三个文件区域目前只读。
- `app/api/git/status/route.ts`：使用 `git status --porcelain` 解析 staged/unstaged/untracked；当前没有 allowed-root 校验，解析对带换行/特殊字符文件名不稳。
- `app/api/git/switch/route.ts`：已有 mutation route 风格、错误回传、clean tree 校验。
- `lib/types.ts`：`GitStatusInfo` / `GitFileChange` 是 Git 面板主要 wire types。

## 范围内

1. UI：三个文件区域增加 per-file 与 section-level action；新增 commit message 表单；分支区增加 push/publish 操作入口。
2. API：新增 stage/unstage/push；扩展 `/api/git/commit` 支持 POST 提交。
3. 安全：mutation API 使用授权 workspace、Git repo root、literal pathspec、无 shell 执行、错误透传与超时。
4. 状态：mutation 成功后刷新 status + graph + selected commit detail；失败时保留用户输入并展示错误。
5. 文档：实现时同步更新 `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。

## 范围外

- pull/rebase/merge、解决冲突、discard checkout、stash apply/pop。
- force push、tag push、选择任意 remote/branch push。
- 工作区 diff 预览（可后续复用 diff modal 增加）。
- `git add -N` intent-to-add；MVP 中 “Track” 等同于 `git add -- <path>`，会进入 staged new file。

## 关键推荐

- 新增 `lib/git-actions.ts` 放可复用 git 执行、授权 cwd、repo 校验、pathspec 校验、错误类型。
- `POST /api/git/stage` 与 `POST /api/git/unstage` 接收 `{ cwd, files: [{ file, oldFile? }] }`；track untracked 复用 stage。
- `POST /api/git/commit` 接收 `{ cwd, message }`，只提交已 staged 内容，不自动 stage；保留项目 hooks，不加 `--no-verify`。
- `POST /api/git/push` 只 push 当前分支；有 upstream 时普通 `git push`，无 upstream 时显式 `{ setUpstream: true }` 才 `git push -u origin <branch>`。
- 禁止 detached HEAD push；建议默认也禁止 detached HEAD commit，避免产生难找的孤儿提交。

## 待主会话确认

1. 无 upstream 分支时，按钮是否允许一键 “Publish branch”（推荐：允许，但 label 明确，后端只推 `origin/currentBranch`）。
2. detached HEAD 时是否允许 commit（推荐：MVP 禁止 commit 与 push，提示先切到本地分支）。
3. push 前本地 behind > 0 时是否前端禁用并后端 409（推荐：禁用/409，提示先 pull/rebase）。
4. 是否需要 “Stage everything” 跨 Unstaged + Untracked 的单按钮（推荐：MVP 只做各 section 的 all，避免误加大文件/秘密文件）。
