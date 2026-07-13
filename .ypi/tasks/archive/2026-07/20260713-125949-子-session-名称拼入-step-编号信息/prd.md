# PRD

## 目标与用户价值

让 YPI Studio child session 的主标题包含稳定实现 step 标识，使用户在侧栏快速区分并行/串行子任务 run，同时保持非 step 成员 run、长标题和历史 session 的兼容性。

## 范围内

- Studio SDK child session 在侧栏/详情使用的展示标题。
- 新建 child JSONL 的 `session_info` 名称。
- `StudioChildSessionDisplay` 投影及其缓存身份。
- 标题 50 字符预算和 fallback。
- 有针对性的纯 helper 测试、文档与手工侧栏验收。

## 范围外

- 不改变任务面板的 subtask/group 编号规则。
- 不新增或迁移 `studioChild` JSONL header 字段。
- 不回写历史 JSONL 的 `session_info`。
- 不更改 child run 调度、状态、usage、父子关系或排序。
- 不把 1-based execution group 序号当作持久身份。

## 需求与验收标准

### R1 — 稳定 step 标识

- 有 `subtaskId` 且有标题时，主标题显示 `{subtaskId} · {subtaskTitle}`。
- 只有 `subtaskId` 时，主标题至少显示该 id。
- 使用 `subtask.id`，不使用 plan 数组 index，也不组合两种编号。

### R2 — 非 step run

- architect、improver 或其他未绑定 subtask 的 child 不显示伪 step。
- 有 task title 时显示 `{member} · {taskTitle}`，其余沿用安全 fallback。

### R3 — 长度与信息优先级

- 侧栏标题不超过 `SESSION_TITLE_MAX_LENGTH`（50）。
- subtask 场景优先保留 id，再分配标题字符；member 不挤占主标题预算。
- 无 subtask 场景完整 `member · taskTitle` 放不下时优先保留 task title。
- 详情行/tooltip 继续承担 member、status、run short id 和完整信息。

### R4 — 单一格式规则

- `displayTitleForSession()` 与 SDK runner 的 `session_info` 命名调用同一纯 helper。
- 新建 child 的持久化名称与侧栏主标题遵循相同 step/fallback/截断规则。

### R5 — 存量兼容

- 旧 child 只要 header 有 `subtaskId`，列表投影即可显示 id；task detail 可读时再拼 title。
- 不要求迁移或回写历史 JSONL。
- task detail 缺失、归档或读取失败时列表仍可安全显示，不抛错。

### R6 — 投影隔离

- 同一 task 下不同 `subtaskId`/`runId` 的 child 不得共享错误的 `studioChildDisplay` 缓存结果。

## 未决问题

- 产品决策已推荐收敛为 `subtask.id`。若用户希望显示 1-based 序号或 `序号 + id`，需在审批时明确推翻本方案；实现员不得自行猜测。
- UI 原型及其用户批准尚未完成，是进入实现前的阻塞项。
