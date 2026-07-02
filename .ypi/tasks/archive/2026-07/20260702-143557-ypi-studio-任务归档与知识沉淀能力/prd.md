# PRD：YPI Studio 任务归档、废弃与知识沉淀能力

## 目标与背景

参考 Trellis 的闭环：任务目录移动归档，长期经验进入可被后续任务读取的知识库。YPI Studio 需要让已结束的工作室任务从活跃列表中移出，同时在归档时沉淀一份由当前 session 模型整理过、可复用、可检索、可注入后续工作上下文的知识条目，降低后续任务读取沉淀时的上下文压力。

## 范围内

1. 完成任务归档：仅 `completed` 任务可进入归档，将 `.ypi/tasks/<task-id>/` 移动到 `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`。
2. 非完成任务废弃：未完成任务不能归档，只能走 `cancelled`/废弃状态；废弃任务保留在活跃任务区，可后续恢复到工作流状态。
3. 归档列表：API、工具和 Studio Panel 能区分 active / archived / all 任务。
4. 知识沉淀：归档时通过当前 session 模型整理摘要，生成 `.ypi/knowledge/*.md` 条目，并更新 `.ypi/knowledge/index.json`。
5. 知识注入：主会话启动、输入轮次和 Studio 成员委派时，读取知识索引并注入少量相关知识摘要。
6. 操作入口：除了页面归档按钮，还需要一个对应的 command / slash command 触发归档。
7. 安全兼容：不允许浏览器或工具传任意路径；已有 `.ypi/tasks/<id>` 任务不需要迁移。

## 范围外（MVP）

- 不做语义向量检索或全文搜索。
- 不做 unarchive / restore archived task；用户明确表示无需取消归档。
- 不把知识自动写入项目 `docs/` 或 `.trellis/spec/`。

## 需求与验收标准

### R1：归档动作

- 给定一个 `completed` 任务，调用归档 API/tool/command 后：
  - 原目录 `.ypi/tasks/<task-id>/` 不再存在；
  - 目标目录 `.ypi/tasks/archive/<YYYY-MM>/<task-id>/` 存在；
  - `task.json.status` 为 `archived`，`updatedAt` 更新，`meta.archivedAt` / `meta.archiveReason` 被记录；
  - `events.jsonl` 追加归档事件；
  - 指向该任务的 `.ypi/.runtime/sessions/*.json` runtime pointer 被清理。
- 非 `completed` 任务归档必须失败，提示先完成任务或走废弃/取消流程。

### R2：废弃与恢复

- 未完成任务可 transition 到 `cancelled`/废弃。
- 废弃任务不移动目录、不生成归档知识，仍可在 active/all 范围看到。
- 废弃任务允许通过工作流 override/reason 恢复到合适状态（如 intake/planning/implementing），恢复行为不属于归档。

### R3：任务读取与列表

- `GET /api/studio/tasks?scope=active` 默认只返回活跃任务，且不会把 `.ypi/tasks/archive` 当成异常任务。
- `scope=archived` 返回归档任务，`scope=all` 同时返回两类任务。
- 归档任务可通过稳定 key（建议 `archived:<YYYY-MM>:<task-id>`）读取详情。
- 当前会话绑定任务只解析活跃任务；runtime pointer 指向已归档任务时应视为无 active task。

### R4：模型整理的知识沉淀

- 归档时创建 `.ypi/knowledge/<timestamp>-<task-slug>.md`。
- `.ypi/knowledge/index.json` 至少包含：`schemaVersion`、`updatedAt`、`entries[]`；条目含 `id`、`title`、`taskId`、`workflowId`、`summary`、`tags`、`sourceTaskPath`、`knowledgePath`、`createdAt`、`archivedAt`。
- 知识摘要由当前 session 模型基于任务 artifacts 整理，目标是短、可复用、适合后续注入。
- 模型整理失败时应给出明确错误并阻止归档，避免产生低质量空知识；实现可保留确定性 fallback 作为内部兜底，但不应静默降级。

### R5：知识注入

- 无 active task 时，启动上下文显示最近知识摘要入口。
- 有 active task 或成员委派时，按任务标题、workflowId、tags 与委派 prompt 做简单相关性匹配，注入最多 3-5 条、总长度有上限的知识摘要。
- 注入块只包含模型整理后的摘要和文件路径，不默认展开完整 Markdown，避免 prompt 膨胀。

### R6：Studio Panel UI 与 Command

- Tasks tab 支持 Active / Archived / All 筛选。
- completed 任务显示“归档”操作，点击需确认；非 completed 不显示归档按钮或置灰并提示只能废弃。
- 归档任务卡显示归档路径/时间，可打开归档后的 `task.json`。
- 增加 `/studio-archive` command，用当前 session 绑定任务作为默认目标；也可通过工具入参指定 taskId。

## 已确认产品决策

1. MVP 只允许归档 `completed` 任务。
2. 非完成任务只能走废弃/取消，并且废弃任务可以恢复。
3. 不需要取消归档 / unarchive。
4. 归档知识需要用当前 session 模型整理摘要，降低后续任务读取压力。
5. 知识注入采用“相关命中 + 最近兜底”，并设置硬长度上限。
