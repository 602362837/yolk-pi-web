# 修复 Trellis 任务详情面板显示

## Goal

让 Trellis 任务详情面板在查看已归档任务和工作树任务时更准确、更少误导，并明确区分 Trellis 任务元数据、任务树子任务、以及 implement/check context manifest。

## Confirmed Facts

- 用户反馈集中在任务详情页：概览里的任务元数据、进度节点、进度下方四个小卡片。
- 复现样例：`.trellis/tasks/archive/2026-06/06-26-cpa-json-conversion`。
- 样例任务 `task.json` 中：
  - `status` 是 `completed`，任务已归档；
  - `base_branch` 是 `pi/20260626-103030`；
  - `branch`、`worktree_path`、`commit`、`pr_url` 都是 `null`；
  - `subtasks`、`children` 都为空；
  - `createdAt` / `completedAt` 只有日期，没有时分秒；
  - `implement.jsonl` / `check.jsonl` 只有 `_example` seed 行，当前 reader 会忽略 seed，所以真实 context count 是 0。
- 当前 UI：
  - 概览固定展示目录、基准分支、分支、Worktree、Commit、PR，缺失值显示 `—`；
  - 进度检查节点固定优先显示 check context 数量，归档任务在无 check context 时会显示“没有 check context”；
  - 小卡片“子任务”来自 Trellis `task.json.children` 的任务树，不是 subagent 委派记录；
  - 小卡片“上下文”只统计真实 `implement.jsonl` / `check.jsonl` 条目，忽略 `_example` seed 行。

## Requirements

1. 任务元数据概览必须避免把缺失的 Git/Worktree/PR 字段呈现成异常状态。
   - 保留已记录字段。
   - 对未记录字段提供清晰说明，说明这些值来自 `task.json`，Web 面板不会猜测历史 worktree/merge 信息。
   - 对 `base_branch` 这类可能由创建时所在分支写入的历史字段，文案不得误导为一定是最终合并目标。
2. 进度“检查”节点在任务已完成/已归档时不得只显示“没有 check context”这类看似失败的信息。
   - 已完成任务应优先表达“检查阶段已通过/任务已完成”。
   - 若没有真实 check context，应作为补充说明：未配置 check manifest / seed 行不计数。
3. 进度下方四个小卡片要更准确：
   - 创建时间在数据包含时间时显示到时分秒；历史 date-only 值不伪造时间。
   - 子任务卡片明确是 Trellis 任务树子任务，不代表 subagent 委派次数。
   - 上下文卡片明确统计 implement/check manifest 的真实条目；0 时显示“未配置”或等价文案，而不是让用户误以为读取失败。
4. 支持可选 `meta.lastCheck` 记录，让已执行质量检查的任务可以在进度节点上标记检查状态；`check.jsonl` 仍只表示检查上下文，不表示检查已执行。
5. 保持 Trellis 面板只读，不新增任务写操作。
6. 保持现有 API 安全边界和任务读取兼容性。

## Acceptance Criteria

- [x] 样例任务详情里，概览不会让 `branch` / `worktree_path` / `commit` / `pr_url` 的缺失看起来像异常；用户能看懂这些字段只是未记录。
- [x] 样例任务的“检查”进度节点不再固定显示“没有 check context”作为唯一说明。
- [x] 小卡片“创建时间”对 ISO datetime 显示到秒；对 `YYYY-MM-DD` 历史数据保留日期显示。
- [x] 小卡片“子任务”文案/提示说明其含义是 Trellis `children`，不是 subagent 委派。
- [x] 小卡片“上下文”对 seed-only manifests 显示为未配置/0 真实条目，并说明 seed 行被忽略。
- [x] 当前任务写入 `meta.lastCheck.status=passed` 后，检查节点显示为已完成/检查通过，而整体任务仍可保持 `in_progress` 等待提交归档。
- [x] check context 文案明确是“检查上下文”，不再被误读为检查执行次数。
- [x] `npm run lint` 通过。
- [x] `node_modules/.bin/tsc --noEmit` 通过。

## Out of Scope

- 追溯历史 Git 日志来自动补全已归档任务的 worktree、merge commit 或 PR。
- 统计 subagent 委派次数或读取历史会话 JSONL 来生成委派信息。
- 修改归档任务的历史 `task.json` 数据。
- 新增 Trellis 任务编辑/修复按钮。
