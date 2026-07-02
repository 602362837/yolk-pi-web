# review

## Check Complete

### Findings Fixed

- 修复 `app/api/git/stage/route.ts`、`app/api/git/unstage/route.ts`、`lib/git-actions.ts`：当 Git 面板 cwd 位于 repo 子目录时，先把 UI 传入的 cwd-relative pathspec 转成 repo-relative pathspec，再在 repo root 执行 `git add` / `git restore --staged`，避免对子目录工作区 stage/unstage 失败或误操作。
- 修复 `app/api/git/status/route.ts`：`--porcelain=v1 -z` 解析现在会在 staged **或** unstaged 为 rename/copy 时消费第二个 path token，避免仅工作区 rename/copy 时错位解析后续状态项。

### Remaining Findings

- None blocking.
- `GET /api/git/status` / `GET /api/git/commit` / `GET /api/git/graph` 仍沿用旧的 read-only cwd 校验方式，未统一到 allowed-roots helper；本次需求重点的 mutation route 已做安全边界，但如果主会话希望 Git 只读接口也完全对齐授权策略，建议后续补齐。

### Verification

- `npm run lint` — pass
- `node_modules/.bin/tsc --noEmit` — pass

### Verdict

- Pass，当前实现满足本轮需求；我已补上两个低风险实现缺口（子目录 pathspec 与 status -z rename/copy 解析）。
