# handoff

## 已产出

- 设计文档：`docs/design/worktree-archive-space-sync.md`
- Studio 规划产物：`brief.md`, `prd.md`, `ui.md`, `design.md`, `implement.md`, `checks.md`, `plan-review.md`

## 核心结论

- 后端 archive/delete API 已有 registry 标记逻辑，但 Sidebar 成功后未刷新/更新 projects，是当前 UI 仍保留 worktree space 的主要缺口。
- 非 UI 操作缺少默认被动同步；需要 missing-only sync + 现有 full refresh 组合。
- 推荐软清理：`archived: true`, `missing: true`，不硬删除 space。

## 验证

未运行 lint/typecheck；本次只产出设计与计划文档。

## 阻塞/需决策

1. 是否确认软清理语义而非硬删除。
2. 是否允许 `GET /api/projects` 做 missing-only 被动同步写入；否则需要显式 sync endpoint。
3. UI 原型门禁已触发：需 UI 设计员 HTML 原型，或主会话批准“无新增视觉，仅状态同步 bugfix”。
