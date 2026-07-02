# Handoff — 架构师方案完成

## 产物

- 更新 `brief.md`：目标、范围、已读证据、关键推荐与需确认决策。
- 更新 `prd.md`：用户价值、范围、需求与验收标准。
- 更新 `ui.md`：三个文件区域、commit 表单、push/publish 的交互方案。
- 更新 `design.md`：API 契约、数据流、安全边界、风险与回滚。
- 更新 `implement.md`：文件级改动建议、实现顺序、验证命令与手工场景。
- 更新 `checks.md`：需求/API/UI/回归检查清单。

## 核心方案

1. `GitPanel` 在 `Staged` 增加 `Unstage/Unstage all` 与 commit 表单；在 `Unstaged` 增加 `Stage/Stage all`；在 `Untracked` 增加 `Track/Track all`。
2. 新增 `POST /api/git/stage`、`POST /api/git/unstage`、`POST /api/git/push`，并给现有 `/api/git/commit` 增加 POST。
3. 新增 `lib/git-actions.ts` 统一 mutation 安全逻辑：allowed roots、repo root、literal pathspec、execFile、Git 错误与 timeout。
4. 操作成功后统一刷新 `status + graph`；commit 成功后选中新 commit；push 成功后刷新 ahead/behind。

## 验证

- 本轮为规划/架构设计，未修改生产代码。
- 未运行 lint/type-check；实现后最少运行：
  - `npm run lint`
  - `node_modules/.bin/tsc --noEmit`

## 剩余风险 / 需主会话决策

- detached HEAD 是否允许 commit：推荐 MVP 禁止。
- 无 upstream 是否一键 Publish 到 `origin/currentBranch`：推荐允许但按钮文案明确。
- behind > 0 时是否禁用 push：推荐禁用并后端 409。
- 是否需要跨 Unstaged + Untracked 的 `Stage everything`：推荐不做，避免误追踪新文件。
