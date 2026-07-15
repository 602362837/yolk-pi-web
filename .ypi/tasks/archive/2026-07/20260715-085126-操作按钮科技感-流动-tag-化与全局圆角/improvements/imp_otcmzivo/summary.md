# Summary — IMP-001（修订）

改进师已按用户「范围尽量大，能替换的都替换」**修订计划产物**（**未实现生产代码**）。

## 变更相对上一版

| 旧 | 新 |
| --- | --- |
| 能力-only + 0～1 示范 | **最大合理全站白名单替换**（B0–B3 必做，B4 尽量） |
| 可选仅 Browser Share | Chat 底栏、消息 action、侧栏工具条、Usage/Models/Skills/File 工具条等 |
| 轻量矩阵原型 | **多区域黑白名单原型** |

## 规模

- 已有 ~12 宿主契约迁移 + 新增约 **30+** 白名单宿主（合计 ~40+）。
- 黑名单硬排除危险/关闭/行内/spin/实心 Stop 等。

## 状态

- 计划审批入口：[plan-review.md](plan-review.md)
- 目标状态：`waiting_plan_approval`
- 不包含：生产代码修改、git commit/push、派发实现员
