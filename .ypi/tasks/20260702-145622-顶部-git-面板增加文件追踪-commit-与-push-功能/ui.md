# UI — Git 面板交互方案

## 是否需要 UI 设计员

不需要单独 UI 设计员。改动是现有 `GitPanel` 的功能增强，沿用当前内联样式、紧凑字体、section 结构即可。

## 布局建议

### Branch 区

- 保留当前 branch name、dirty/worktree/upstream/ahead/behind 展示。
- 在 branch summary 行右侧新增 push 操作：
  - `Push`：有 upstream 时显示。
  - `Publish branch`：无 upstream 且当前 branch 非 detached 时显示（如果主会话确认支持）。
  - disabled tooltip：`Detached HEAD cannot be pushed`、`Branch is behind upstream`、`Nothing to push`、`No remote origin`。
- push pending 时按钮文案 `Pushing...`，成功后显示短暂 success banner。

### Staged Changes

- section title 右侧：`Unstage all` 小按钮；无 staged 时禁用。
- 文件行改为 action row：状态点 + path + status label + `Unstage`。
- 在 Staged section 内加入 commit 表单：
  - `textarea` placeholder：`Commit message`，支持多行。
  - `Commit staged changes` 按钮；条件：staged > 0、message.trim 非空、无全局 mutation pending。
  - 错误显示在表单下方，message 不清空；成功后清空 message。

### Unstaged Changes

- section title 右侧：`Stage all`。
- 每行右侧 `Stage`。
- `Stage all` 只 stage `status.unstaged`，不包含 untracked。

### Untracked Files

- section title 右侧：`Track all`。
- 每行右侧 `Track`，语义为 `git add -- <path>`。
- 对 untracked directory 仍显示为一行，Track 后由 Git 递归加入。

## 状态与反馈

- 新增统一 `gitActionError` / `gitActionSuccess` banner，放在 sticky refresh 行下方或 branch 区顶部。
- 新增 `pendingAction`，结构建议：
  - `{ type: "stage" | "unstage" | "commit" | "push"; key?: string } | null`
  - per-file key 可用 `${oldFile ?? ""}\0${file}`。
- 操作 pending 期间：
  - 禁用 refresh、branch switch、stage/unstage/commit/push，或至少禁用同类 mutation。
  - 行按钮显示 `...` 或按钮 disabled。
- 成功后 `await fetchAll()`；commit 成功后 `setSelectedCommitHash(short/full hash)`。
- 不做乐观更新，避免 rename/delete/conflict 情况下 UI 与 Git 状态不一致。

## 文案建议

- Stage: `Stage`
- Unstage: `Unstage`
- Track untracked: `Track`
- Commit: `Commit staged changes`
- Push: `Push`
- Publish: `Publish branch`
- Safety hint under commit: `Only staged changes will be committed.`

## 需要原型化的问题

无必须原型。实现时只需注意面板宽度：commit 表单应使用 100% 宽，文件行按钮保持小尺寸，长路径继续 ellipsis。
