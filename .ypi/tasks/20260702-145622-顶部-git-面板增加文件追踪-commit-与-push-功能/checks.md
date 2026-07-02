# Checks — Git 面板 mutation 功能

## 需求覆盖检查

- [ ] `Staged Changes` 支持单文件 `Unstage`。
- [ ] `Staged Changes` 支持 `Unstage all`。
- [ ] `Unstaged Changes` 支持单文件 `Stage`。
- [ ] `Unstaged Changes` 支持 `Stage all`，且不包含 untracked。
- [ ] `Untracked Files` 支持单文件 `Track`。
- [ ] `Untracked Files` 支持 `Track all`。
- [ ] Commit 表单只提交 staged changes。
- [ ] Commit 成功后清空 message、刷新 status/graph、选中新 commit。
- [ ] Push 当前分支成功后刷新 upstream/ahead/behind。
- [ ] detached/no upstream/behind/no remote 等状态有清晰禁用或错误。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## API 检查

- [ ] 所有 mutation route 都校验 `cwd`。
- [ ] 越权 cwd 返回 403。
- [ ] 非 Git repo 返回 404 或可读错误。
- [ ] 空 files、空 file、NUL、绝对路径、`..` 越界 pathspec 返回 400。
- [ ] Git 命令使用 `execFile` + `--literal-pathspecs` + `--`。
- [ ] commit 无 staged changes 返回 409。
- [ ] commit hooks/Git identity 失败时 stderr 展示给 UI。
- [ ] push 不支持 force，不接受客户端 remote/branch。

## UI 检查

- [ ] pending 期间按钮 disabled，不会重复提交同一 mutation。
- [ ] 错误 banner 可见且不会被刷新按钮遮挡。
- [ ] commit error 不清空 textarea。
- [ ] 成功后 success 反馈短暂显示或被刷新后的状态明显体现。
- [ ] 长文件名 ellipsis，按钮仍可点击。
- [ ] 键盘/屏幕阅读器至少有 button title/aria-label。

## 回归风险

- [ ] GET `/api/git/commit` 的 commit detail modal 不受 POST 增加影响。
- [ ] Branch switch 仍要求 clean tree，且 mutation pending 时不会并发 switch。
- [ ] 顶部 Git dirty dot 仍由 `status.isDirty` 驱动。
- [ ] 非 Git repo 仍显示 `Not a Git repository`。
- [ ] Worktree archive/remove 逻辑不受新增 helper 影响。

## 手工验收重点

- 使用临时测试 repo，不要在真实工作区验证 destructive/large changes。
- 覆盖 modified/added/deleted/renamed/untracked directory。
- 至少验证一次 push 到 disposable remote 或测试分支。
- 验证无 upstream publish 的产品决策实现与 UI 文案一致。
