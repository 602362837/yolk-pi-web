# Git Status Panel

## Goal

在中央对话区顶部栏新增一个 Git 面板，以 dropdown panel 的形式展示当前 workspace 的 Git 状态概览，包括分支、最近提交、文件变更和 stash 信息。

## Confirmed Facts

- 现有顶部栏已有 Export / Branches / System / Subagents 四个面板，通过 `activeTopPanel` state 互斥展开。
- 项目已有 `GET /api/git/info` 接口获取基础 Git 元数据（分支、worktree 信息），但缺少详细的 status/log/stash 数据。
- `lib/git-worktree.ts` 中有现成的 `discoverGitRoot()`、`git()` 封装函数。
- ChatWindow 的 `onAgentEnd` 回调已用于在 agent 执行完毕后触发 UI 刷新。

## Requirements

- 顶部栏新增 "Git" 按钮，使用 git-branch 图标，与现有按钮风格一致。
- 点击后展开 dropdown panel，展示：
  - **分支状态栏**：当前分支名、clean/dirty 标记、upstream、ahead/behind 计数、worktree 标记。
  - **Recent Commits**：最近 10 条提交的 short hash + message + relative date。
  - **Staged Changes**：已暂存文件列表（绿色标记）。
  - **Unstaged Changes**：未暂存变更（橙色标记）。
  - **Untracked**：新文件列表（灰色标记）。
  - **Stash**：stash 数量。
- Git 按钮上显示状态指示器：dirty 时显示橙色小圆点。
- 面板右上角提供手动刷新按钮。
- Agent 执行结束时自动刷新 Git 状态。
- CWD 切换时重新加载。
- 非 Git 仓库时按钮仍可点击，面板显示 "Not a Git repository"。

## Out of Scope

- 不提供 git commit / push / pull 等写操作。
- 不显示 diff 内容。
- 不展示完整分支列表。
- 不轮询刷新。

## Acceptance Criteria

- [ ] Git 仓库中打开面板 → 显示分支、提交、变更信息。
- [ ] 非 Git 仓库 → 面板显示 "Not a Git repository"。
- [ ] 有未提交变更时 → Git 按钮旁显示橙色小圆点。
- [ ] Agent 执行完毕后 → Git 面板数据自动刷新。
- [ ] 切换 CWD → 面板数据跟随更新。
- [ ] 同一时间只展开一个 top panel（Git 和其他面板互斥）。
- [ ] `npm run lint` 和 `node_modules/.bin/tsc --noEmit` 通过。
- [ ] `docs/modules/api.md` 和 `docs/modules/frontend.md` 已更新。
