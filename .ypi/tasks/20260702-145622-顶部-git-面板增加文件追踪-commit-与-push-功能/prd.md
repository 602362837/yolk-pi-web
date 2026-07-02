# PRD — 顶部 Git 面板增加文件追踪、commit 与 push

## 目标与背景

现有顶部 Git 面板能查看分支、提交图和工作区状态，但不能完成最常见的 Git 闭环。目标是在同一面板内完成：选择文件进入 index、从 index 移除、提交 staged changes、推送当前分支。

## 用户价值

- 用户无需切换终端即可把 AI/手工修改整理为 commit 并推送。
- 文件操作保持显式，降低误提交未检查文件的风险。
- 顶部 Git dirty 指示与面板状态形成闭环，操作后自动刷新。

## 范围内

1. `Staged Changes`
   - 展示 staged 文件列表。
   - 每个文件可 `Unstage`。
   - section header 可 `Unstage all`。
   - 下方/上方提供 commit message 输入与 `Commit staged changes`。

2. `Unstaged Changes`
   - 每个 tracked changed file 可 `Stage`。
   - section header 可 `Stage all`。
   - 不包含 untracked files，避免 “Stage all” 误追踪新文件。

3. `Untracked Files`
   - 每个 untracked file/dir 可 `Track`（`git add`）。
   - section header 可 `Track all`。
   - “Track” 成功后文件进入 staged 区。

4. Push 当前分支
   - 在 Branch 区展示 `Push` / `Publish branch` 按钮。
   - 有 upstream 时 push 当前分支到 upstream。
   - 无 upstream 时需要明确 publish 行为（推荐 `git push -u origin <branch>`）。
   - detached HEAD、behind、无 remote 等情况给出清晰禁用原因或错误。

5. 错误与刷新
   - 所有 mutation 有 pending/disabled 状态，防止重复点击。
   - API 错误展示 stderr/stdout 中的可读信息。
   - 成功后刷新 status + graph；commit 成功后选中新 commit；push 成功后刷新 ahead/behind。

## 范围外

- pull/rebase/merge、冲突解决、stash 管理。
- force push / delete remote branch / tag push。
- commit amend、签名、作者切换、skip hooks。
- `.gitignore` 编辑或 secret 检测。

## 需求与验收标准

| 需求 | 验收标准 |
| --- | --- |
| 单文件 stage | Unstaged 文件点击 Stage 后出现在 Staged，dirty 状态仍按最新 status 展示。 |
| 批量 stage | Stage all 只处理 `status.unstaged`，不自动处理 untracked。 |
| track untracked | Untracked 文件点击 Track 后进入 Staged；Track all 处理当前列表。 |
| unstage | Staged 文件点击 Unstage 后回到 Unstaged 或 Untracked（由 Git 决定）。 |
| commit | 无 staged 或 message 为空时按钮禁用；提交成功返回 hash，输入清空，graph 刷新并选中新 commit。 |
| push | 有 upstream 且 ahead > 0 时 push 成功后 ahead 归零；失败时展示 Git 错误。 |
| publish | 无 upstream 时显示 Publish branch 或错误；若确认实现 publish，成功后 status.upstream 有值。 |
| 安全 | mutation API 只接受已授权 workspace/repo，使用 `execFile`，所有 pathspec 都按 literal 处理，不通过 shell。 |

## 未决问题

- detached HEAD 是否允许 commit：推荐禁止。
- 无 upstream 是否默认 publish 到 origin：推荐允许但按钮文案明确。
- behind > 0 是否禁止 push：推荐禁止并给出 pull/rebase 提示。
