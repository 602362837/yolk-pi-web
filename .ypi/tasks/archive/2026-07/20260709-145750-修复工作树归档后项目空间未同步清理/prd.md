# prd

## 目标与背景

WorkTree 在 Project Registry 中作为项目空间存在。归档/删除 WorkTree 后，如果对应 space 仍作为活动空间出现在侧边栏，会造成数据不一致、无效 cwd 选择、文件浏览授权残留和较差用户体验。

## 范围内

1. UI/API 归档或删除 WorkTree 后，立即同步清理对应 worktree space。
2. 外部 CLI / 文件操作导致 WorkTree 消失或移动后，在后续项目加载/刷新时被动同步。
3. 处理目录删除、移动、symlink/display path 不一致、自定义 WorkTree 路径等边缘情况。
4. 保持历史 session header 兼容，不迁移旧 session。

## 范围外

- 不重新设计 WorkTree 归档 Git 流程（squash/push/merge/remove）。
- 不硬删除 Project Registry space，除非主会话/用户明确改变产品语义。
- 不自动恢复或重写已删除的 session 文件。

## 需求与验收标准

| 需求 | 验收标准 |
| --- | --- |
| 主动清理 | UI/API 归档或删除 WorkTree 成功后，registry 中匹配 worktree space 被标记 `archived: true, missing: true`，侧边栏立即隐藏该 space。 |
| 前端状态一致 | 当前选中 space 被归档时，自动切到 main/fallback space 或清空选择；不会继续以旧 worktree cwd 创建会话。 |
| 被动 missing 检测 | WorkTree 目录被 CLI 删除或直接删除后，下一次项目加载/刷新可将旧 space 归档隐藏。 |
| Git full refresh | `git worktree move/remove/prune` 后，显式或节流 full refresh 能按 Git porcelain upsert 新 space、归档旧 space。 |
| 路径稳健性 | pathKey 为主，display/real path 兜底，避免 symlink 或目录已缺失导致无法匹配。 |
| 兼容性 | 旧 registry/session 格式继续可读；新增字段只做 additive metadata。 |

## 未决问题

1. 是否接受“软清理（archived/missing）”作为清理语义，而不是从 registry 硬删除？推荐接受。
2. `GET /api/projects` 是否允许执行 missing-only 写副作用？推荐允许并节流；若不接受，则由前端显式调用 sync endpoint。
3. UI 原型门禁：此修复会改变 Sidebar 归档后的即时状态和 fallback 选择，需要 UI 设计员 HTML 原型或主会话确认“无新增视觉，仅状态同步”。
