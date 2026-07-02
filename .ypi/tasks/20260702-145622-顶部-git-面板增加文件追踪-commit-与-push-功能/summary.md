# Summary — 顶部 Git 面板增加文件追踪、commit 与 push

## 完成内容

- 顶部 `GitPanel` 支持：
  - `Staged Changes` 单文件/批量 `Unstage`
  - `Unstaged Changes` 单文件/批量 `Stage`
  - `Untracked Files` 单文件/批量 `Track`
  - staged commit message 表单与 `Commit staged changes`
  - 当前分支 `Push` / 无 upstream 时 `Publish branch`，Publish 有二次确认
- 新增/扩展 Git API：
  - `POST /api/git/stage`
  - `POST /api/git/unstage`
  - `POST /api/git/push`
  - `POST /api/git/commit`，保留原 `GET /api/git/commit`
- 新增 `lib/git-actions.ts` 统一 mutation 安全逻辑：allowed roots、repo root、repo-relative literal pathspec、`execFile`、错误映射与 timeout。
- `GET /api/git/status` 改为 `git status --porcelain=v1 -z` 解析，提升特殊文件名和 rename/copy 解析稳定性。
- 更新文档：`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。

## 用户确认的产品决策

- detached HEAD 下禁止 commit / push。
- 无 upstream 时允许 publish 到 `origin/currentBranch`，但 UI 必须二次确认。
- behind > 0 时禁用 push，后端也返回 409。
- 不做跨 `Unstaged + Untracked` 的 `Stage everything`，只做各区域自己的 all。

## 检查结果

- Implementer 验证：`npm run lint` 通过，`node_modules/.bin/tsc --noEmit` 通过。
- Checker 复查并修复：
  - 子目录 workspace 下 stage/unstage pathspec 转 repo-relative 的问题。
  - `git status -z` rename/copy 第二路径 token 消费问题。
- 主会话复跑：
  - `npm run lint` 通过。
  - `node_modules/.bin/tsc --noEmit` 通过。

## 剩余提示

- 未实际对远端执行 push；建议在测试分支/临时 remote 上做最终手工验收。
- 可选后续：将只读 Git routes 也统一到新的 allowed-roots/repo-root helper。