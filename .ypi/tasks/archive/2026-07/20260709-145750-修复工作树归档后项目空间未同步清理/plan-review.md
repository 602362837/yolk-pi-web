# plan review

## 审批摘要

本计划修复 WorkTree 归档/删除后 Project Registry worktree space 未同步清理的问题。推荐采用软清理：将 worktree space 标记为 `archived: true, missing: true`，活动 UI 过滤隐藏，不从 registry 硬删除。

## 相关产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md)
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)
- [docs/design/worktree-archive-space-sync.md](../../../../docs/design/worktree-archive-space-sync.md)

## PRD

- 主动清理：UI/API 归档或删除 WorkTree 成功后，对应 worktree space 立即软归档，Sidebar 立即隐藏。
- 被动同步：CLI / 直接文件操作造成 WorkTree 缺失、移动后，项目加载/刷新能检测并同步。
- 兼容：不迁移 session header，不硬删除 registry space，新增字段保持 additive。

## Design

- 后端统一 WorkTree space cleanup helper，支持多 path alias 与 pathKey/display/realpath 兜底匹配。
- `archive/delete` API 使用该 helper 并返回 cleanup summary。
- 新增 missing-only 被动同步，full refresh 继续复用 `git worktree list --porcelain`。
- 前端 `SessionSidebar` 在操作成功后刷新/更新 project tree，并处理 selected space fallback。

## Implement

建议按 `WT-01` 到 `WT-05` 串行实施：registry helper → missing-only sync → API 接入 → Sidebar 状态同步 → 文档/验证。

## Checks

最小自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

关键手工验收：UI 归档、UI 删除、CLI remove、直接删除目录、git worktree move、symlink/display path。

## 审批前未决事项

1. 请确认清理语义采用"软归档/隐藏"，不是硬删除 registry space。
2. 请确认 `GET /api/projects` 是否允许 missing-only 被动写入；若不允许，改为前端显式 sync endpoint。

## UI 原型门禁判断

**结论：本次修复批准为"无新增视觉，仅状态同步 bugfix"，跳过 UI 原型。**

理由：
- 不新增控件、不改变信息结构
- `SessionSidebar` 已有 `activeProjectSpaces()` 过滤 `space.archived` 的逻辑
- 修复只是在归档/删除成功后刷新项目列表，让已有过滤逻辑生效
- Fallback 选择切到已存在的 `main` space 或清空，使用现有 UI 样式
- API warning 沿用现有错误/提示区域展示
