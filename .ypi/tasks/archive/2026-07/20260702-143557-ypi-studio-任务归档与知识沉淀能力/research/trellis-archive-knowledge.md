# Trellis 任务归档与知识沉淀研究

## 研究范围

用户希望参考 Trellis 的“沉淀”机制，为 YPI Studio 增加：

- 任务归档功能；
- 归档时产出知识沉淀；
- 后续工作室任务启动时读取已沉淀知识。

## Trellis 的相关机制

### 1. 任务归档

Trellis 使用 `.trellis/tasks/archive/<YYYY-MM>/` 作为归档目录。

命令入口：`.trellis/scripts/task.py archive <task-dir>`。

关键行为来自 `.trellis/scripts/common/task_store.py::cmd_archive`：

- 读取任务目录下的 `task.json`；
- 将 `status` 改为 `completed`；
- 写入 `completedAt`；
- 清理仍指向该任务的 session runtime pointer；
- 将任务目录移动到 `archive/<year-month>/`；
- 可选地只提交 Trellis 任务归档相关路径；
- 触发 `after_archive` hooks。

Trellis 的归档是“移动任务目录”，不是只给任务打一个 archived 状态。

### 2. 知识沉淀

Trellis 的知识沉淀主要不是写入任务目录，而是写入 `.trellis/spec/`：

- `.trellis/workflow.md` 明确要求 “Capture learnings”；
- Phase 3.3 是必需的 “Spec update”；
- `trellis-update-spec` 用于把新模式、Bug 预防、技术决策沉淀到 spec；
- 后续开发通过 `trellis-before-dev` 读取 `.trellis/spec/<layer>/index.md` 和相关 guideline 文件，把沉淀重新注入工作上下文。

因此 Trellis 的沉淀闭环是：

```text
任务执行 → finish/check → update spec → archive task → 后续 before-dev 读取 spec
```

### 3. 研究/决策沉淀

Trellis 也允许任务内有 `research/` 文件作为研究记录，并通过 `implement.jsonl` / `check.jsonl` 将 spec/research 文件作为 subagent context manifest 注入。

这类内容更偏“任务局部证据”；真正长期可复用的规范/经验进入 `.trellis/spec/`。

## YPI Studio 当前状态

当前 YPI Studio：

- 活跃任务目录：`.ypi/tasks/<task-id>/`；
- 任务记录：`task.json`；
- 事件记录：`events.jsonl`；
- 产物：`brief.md`、`prd.md`、`design.md`、`implement.md`、`checks.md`、`handoff.md`、`review.md`、`summary.md`；
- 类型/读写逻辑集中在 `lib/ypi-studio-tasks.ts`；
- API：`GET/POST /api/studio/tasks`，`GET/PATCH /api/studio/tasks/[taskKey]`；
- 工作流已有 `archived` 终态，且 `completed -> archived` transition 已存在；
- UI 任务列表目前只列 `.ypi/tasks` 下的任务目录，没有 `.ypi/tasks/archive` 扫描和归档动作。

## 设计启发

建议 YPI Studio 不直接复刻 Trellis 的 spec 系统，而采用同构但更贴合 Studio 的结构：

```text
.ypi/tasks/<task-id>/                 # 活跃任务
.ypi/tasks/archive/<YYYY-MM>/<task-id>/ # 已归档任务
.ypi/knowledge/                       # 长期沉淀知识
.ypi/knowledge/index.json             # 可检索索引
.ypi/knowledge/*.md                   # 人可读知识条目
```

归档动作应：

1. 要求任务已 completed/ready，或明确 override；
2. 汇总 `summary/review/checks/design/implement` 产物生成知识条目；
3. 写入 `.ypi/knowledge/<timestamp>-<task-slug>.md`；
4. 更新 `.ypi/knowledge/index.json`；
5. 将任务状态转为 `archived`，记录事件；
6. 清理指向该任务的 runtime pointer；
7. 移动任务目录到 `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`；
8. 任务列表可选择 active / archived / all。

后续任务启动时，Studio extension 可读取 `.ypi/knowledge/index.json` 中最近/相关的知识摘要，并注入到 `<ypi-studio-state>` 或 member prompt 中。

## 风险与约束

- 归档是文件移动，必须继续使用 stable key，不能允许浏览器传任意路径。
- `.ypi/tasks/archive` 扫描需要避免被 active task scanner 当作 malformed task 处理。
- runtime pointer 指向已归档任务时应不再作为 active task 注入。
- 知识沉淀初版不应调用模型自动总结，避免引入异步/成本/失败模式；可先从已有 artifact 抽取标题、摘要、关键产物路径和手写 summary。
- 后续可以增加“让 checker/architect 生成 archive knowledge”的工作室成员步骤。
