# Design：任务归档、废弃与知识沉淀

## 方案摘要

采用“完成任务移动归档 + 废弃任务留在活跃区 + 模型整理长期知识索引”的结构：

```text
.ypi/tasks/<task-id>/                         # 活跃/废弃任务
.ypi/tasks/archive/<YYYY-MM>/<task-id>/       # 已归档 completed 任务
.ypi/knowledge/<timestamp>-<task-slug>.md     # 模型整理后的长期知识条目
.ypi/knowledge/index.json                     # 注入和检索用索引
```

归档动作负责：校验 `completed` 状态、调用当前 session 模型整理摘要、生成知识条目、更新索引、更新任务状态、写事件、清 runtime pointer、移动目录。后续任务和 Studio 成员通过 extension 读取知识索引，注入有限摘要。

非完成任务不归档，只走 `cancelled`/废弃状态。废弃任务不移动目录、不生成知识，后续可通过带 reason 的状态迁移恢复。

## 影响模块和边界

- `lib/ypi-studio-tasks.ts`
  - 新增 archive path、knowledge path、archived key、scope list、archive 操作、知识索引读写、runtime pointer 清理。
  - `scanTaskRecords` 必须跳过 `archive` 子目录。
- `lib/ypi-studio-types.ts`
  - 新增 `YpiStudioTaskScope`、`YpiStudioTaskArchiveBody`、`YpiStudioKnowledgeIndex`、`YpiStudioKnowledgeEntry`、任务 summary 的 `archived`/`archiveMonth` 可选字段。
- `app/api/studio/tasks/route.ts`
  - `GET` 支持 `scope=active|archived|all`。
- `app/api/studio/tasks/[taskKey]/route.ts`
  - `GET` 接受 `active:<id>` 与 `archived:<YYYY-MM>:<id>` key。
  - `PATCH` 支持 `{ action: "archive", cwd, reason?, knowledgeMarkdown?, knowledgeSummary?, tags? }`。
- `lib/ypi-studio-extension.ts`
  - `ypi_studio_task` 增加 `archive` action 和 `scope` 参数。
  - 新增 `/studio-archive` slash command。
  - 归档 command/tool 在主 session 中先组织任务 artifacts，请当前 session 模型生成压缩知识摘要，再调用 archive 持久化。
  - `startupContext` / input context / member prompt 增加 `<ypi-studio-knowledge>` 注入。
- `components/YpiStudioPanel.tsx`
  - 任务 tab 增加 scope 筛选、归档按钮、归档任务打开路径修正。
  - 页面归档可走 API；若无法直接调用当前 session 模型，页面应提示推荐在 chat 中执行 `/studio-archive`，或 API 接受由前端提交的已整理摘要。MVP 推荐 command/tool 负责模型整理，UI 按钮调用同一路径时需要确保摘要来源明确。
- 文档：更新 `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/architecture/overview.md`。

## 文件契约

### 归档任务 key

- 活跃：`active:<task-id>`（保持现状）。
- 归档：`archived:<YYYY-MM>:<task-id>`。
- 校验：月份必须匹配 `^\d{4}-\d{2}$`，task id 继续使用当前 `isSafeTaskId` 规则。

### knowledge index

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-02T00:00:00.000Z",
  "entries": [
    {
      "id": "20260702-150000-task-slug",
      "title": "任务标题",
      "taskId": "20260702-...",
      "taskKey": "archived:2026-07:20260702-...",
      "workflowId": "feature-dev",
      "summary": "模型整理的短摘要，用于注入",
      "tags": ["studio", "archive"],
      "sourceTaskPath": ".ypi/tasks/archive/2026-07/20260702-...",
      "knowledgePath": ".ypi/knowledge/20260702-150000-task-slug.md",
      "createdAt": "...",
      "archivedAt": "...",
      "sourceArtifacts": ["summary.md", "review.md", "design.md"]
    }
  ]
}
```

### knowledge Markdown

```md
# <task title>

- Task: <task-id>
- Workflow: <workflowId>
- Archived task: <relative path>
- Archived at: <iso>
- Tags: ...

## Summary
<当前 session 模型整理后的短摘要>

## Reusable knowledge
<当前 session 模型整理出的可复用经验、约束、坑点、后续读取建议>

## Source artifacts
- summary.md
- review.md
- checks.md
```

## 归档流程

1. 解析 task key；只允许 active task 被归档。
2. 读取并校验 `task.json`。
3. 要求 `status === "completed"`；非完成任务返回错误，提示走废弃/取消。
4. 确保无 running subagent。
5. 收集任务 artifacts 作为摘要材料，限制输入长度。
6. 在 extension command/tool 层使用当前 session 模型整理 `knowledgeSummary` / `knowledgeMarkdown`；如果是纯 API 调用，必须要求调用方提供摘要内容，或返回需要摘要的错误。
7. 确保 `.ypi/tasks/archive/<YYYY-MM>/` 和 `.ypi/knowledge/` 在 workspace 内。
8. 写知识 Markdown 并更新 index；写入失败则中止归档，避免任务丢失但知识缺失。
9. 更新 task：`status=archived`、`updatedAt`、`meta.archivedAt`、`meta.archiveReason`、`meta.knowledgeEntryId`。
10. 写 `events.jsonl` 归档事件。
11. 清理所有指向该 taskId 的 runtime session pointer。
12. `renameSync(activeDir, archivedDir)`；目标存在时失败，不覆盖。
13. 返回归档后的 task detail 和 knowledge entry。

## `/studio-archive` command 设计

- Slash command：`/studio-archive [reason]`
- 默认目标：当前 session 绑定的 YPI Studio task。
- 约束：仅当当前任务 `completed` 时执行。
- 行为：读取任务 artifacts → 当前 session 模型整理知识摘要 → 调用 `ypi_studio_task(action="archive")` 持久化 → 回复归档路径和知识路径。
- Tool schema 增加 `archive` action，入参包括：`taskId?`、`reason?`、`tags?`、`knowledgeSummary?`、`knowledgeMarkdown?`。直接 tool 调用若缺少模型整理内容，可由 tool 内部使用确定性 fallback 但应在返回中标记 warning；command 路径必须走模型整理。

## 知识注入设计

- 新增 `getYpiStudioKnowledgeContextForPrompt(cwd, query, options)`。
- 相关性：对 query（任务标题、workflowId、成员 prompt）和 entry 的 title/summary/tags/workflowId 做简单 token overlap；不足时按 `archivedAt` 取最近条目。
- 默认限制：最多 3 条，每条摘要 500 字符，总块 3000-4000 字符。
- 注入位置：
  - `startupContext`：展示最近知识提示；
  - `buildStudioState`：有 active task 时注入相关知识摘要；
  - `buildMemberPrompt`：成员 prompt 中注入相关知识摘要，便于执行员/检查员复用历史经验。

## UI 设计

- Tasks tab 顶部新增筛选 chip：`活跃` / `已归档` / `全部`。
- `completed` 任务卡右上角增加“归档”按钮；点击二次确认。
- 非 completed 任务不提供归档按钮，可显示“未完成任务请废弃/恢复”。
- 归档任务卡禁用归档按钮，展示 `pathLabel`、`archivedAt`、knowledge path（如果有）。
- `taskFilePath` 不再硬编码 `.ypi/tasks/${task.id}/task.json`，应使用 `task.pathLabel + /task.json`，兼容归档路径。

## 兼容性与安全

- 现有任务无需迁移；`archive` 目录不存在时忽略。
- Active scanner 必须跳过 `archive`，避免把 `.ypi/tasks/archive` 当 malformed task。
- 所有 task key、月份、文件名均白名单校验；不得从请求体拼任意相对路径。
- 知识文件名使用已有 `slugify` + timestamp，禁止覆盖同名文件。
- 归档目录和知识目录都用现有 workspace realpath 校验策略。
- 知识注入只用 index summary，不展开完整 knowledge Markdown。
- 归档后 runtime pointer 不再绑定该任务，避免新输入继续注入已归档任务状态。

## 风险与回滚

- 风险：模型摘要生成失败阻塞归档。缓解：返回明确错误，用户可重试；保留显式 fallback 标记。
- 风险：归档中途失败导致 task 状态已写但目录未移动。缓解：知识写入先完成；状态更新和 rename 尽量连续；失败时返回明确错误，允许重试。
- 风险：知识注入过长污染 prompt。缓解：条数、摘要和总长度硬限制。
- 风险：归档 key 改动影响 UI 打开文件。缓解：使用 `pathLabel` 作为打开路径来源。
