# PRD：project/space session 候选索引与列表性能

## 目标与用户价值

当用户打开或切换某一 Project Registry space 时，Sidebar 应快速显示该 space 的完整 active session 历史；其他项目、main/worktree space 和大量 Studio child 不应拖慢当前列表，也不应连带阻塞设置与模型入口。

## 范围内

1. project-local、space 独立的 active session 候选索引。
2. project/space session 专用读取路径、索引恢复、缓存与 single-flight。
3. create/fork/Studio child/rename/archive/unarchive/delete/relink 等生命周期维护。
4. Studio child 批量投影与现有 payload 语义保持。
5. 精确 gitignore、安全路径校验、并发写与内容安全 timing。
6. focused tests、固定规模 benchmark、相关文档。

## 范围外

- 物理迁移 `~/.pi/agent/sessions/**` JSONL 到项目目录。
- 改变 archive 存储、会话详情/context/export/usage 精确扫描。
- Sidebar 的加载态、列表层级、文案、字段或交互改版。
- 直接重构 `/api/web-config`、Models provider bootstrap 或 ModelRuntime；如隔离基准仍慢，另开 phase 2。
- 自动把 legacy unassigned session 写回 project/space header。

## 需求与验收标准

### R1：space 独立落点

- 每个 active registry space 使用 `<resolved-space-root>/.ypi/sessions/index.v1.json`。
- main 与每个 worktree 按各自 `space.pathKey`/物理根目录维护，不共享候选文件。
- 索引内嵌 `projectId`、`spaceId`、`spacePathKey`；身份不匹配时不得使用。

### R2：JSONL 真相不变

- session JSONL 继续保存在 `getAgentDir()/sessions/<encoded-cwd>/*.jsonl`。
- project/space 关联以 JSONL header `projectId/spaceId` 为真相；索引只加速候选发现和摘要复用。
- 不迁移或重写历史 JSONL。

### R3：热路径定向读取

- `GET /api/projects/:projectId/spaces/:spaceId/sessions` 不再以全量 300+ active inventory 为主路径。
- 读取本地索引并仅枚举 registry space 的 cwd/realPath 对应 session 目录；候选逐个校验 regular file、active root containment、stat 与 header link。
- 未变化候选复用索引摘要；变化候选仅扫描该文件。

### R4：完整性优先

- 索引缺失、损坏、身份错误或标记 partial 时，不得返回静默缺项的成功响应。
- 恢复流程必须结合 legacy global index seed、定向 cwd 扫描和全局 header-only discovery，验证后原子写入 complete 本地索引。
- 恢复超预算时：有 last-good 则返回经文件校验的 last-good 并继续 single-flight 修复；无 last-good 则返回可重试错误，禁止 partial 200。

### R5：外部写兼容

- Web 创建/变更立即 write-through 或失效。
- 标准 Pi CLI 在同一 cwd 新建的 legacy session 可由定向目录发现，并只在 `includeLegacy=1` 时返回 legacy 区域。
- 非标准的跨 cwd 手工 header link 至少由首次恢复或后台低频 header reconciliation 收敛；不得让其触发每次请求的全量扫描。

### R6：生命周期一致性

- create/bootstrap、fork、Studio child 创建、rename、archive、unarchive、delete、delete-by-cwd/WorkTree cleanup、project-space relink 都有明确 upsert/remove/move/invalidate 行为。
- 已知本进程 mutation 后无需等待 TTL 才正确。
- cascade parent rewrite 后相关 entry 的 parent 指针同步失效/刷新。

### R7：Studio child 语义保持

- 成功响应仍为 `{ sessions, legacyUnassigned, studioChildrenByParentSessionId }`。
- root 列表不把 Studio child 当普通 root；仅返回 parent root 在当前 space 可见的 child。
- `studioChild.parentSessionId` 的高置信关联与 project link 语义不变。
- 不再对全局 180 个 child 强制 `includeStudioChildDisplay=true`；只对已筛入 child 按 `cwdPathKey + taskId` 去重读取 task，再按 run/subtask 生成独立 display。

### R8：gitignore

- 仓库 `.gitignore` 增加精确规则 `/.ypi/sessions/`。
- runtime 在每个索引目录建立目录内 `.gitignore`（内容 `*`）或等价 local exclude 并验证 index 被忽略。
- 禁止添加 `.ypi/`、`/.ypi/` 等会隐藏 Studio tasks/agents/workflows 的宽规则。

### R9：并发与原子性

- 同一 space 的读取/重建使用 process-global single-flight。
- 索引写使用进程队列 + 跨进程锁 + lock-time reread/merge + temp/rename；失败不损坏上个有效版本。
- 缓存有 TTL、容量上限和 mutation 失效；rejected promise 不驻留。

### R10：性能与可观测性

在约 300 sessions / 180 Studio children 的固定 fixture 上：

- 热索引 route：P50 ≤ 500ms，P95 ≤ 1.5s。
- 冷恢复：P95 ≤ 5s，硬预算 10s。
- `inventoryGlobalCalls=0`（热路径）；Studio task 读取次数不超过目标 space 的 unique task 数。
- 慢日志只含 stage ms、候选/命中/修复/child/task 数和 opaque ids，不含路径、标题、正文、tool output 或凭据。

### R11：设置/模型间接受益

- 并发 benchmark 中，session 列表不得再给 `/api/web-config`、`/api/models`、`/api/models-config` 增加 10s 级等待。
- 相对各接口隔离基线，新增 P95 延迟目标 ≤ 500ms；未达标时用证据提出 phase 2，而不是在本任务猜测重构 provider runtime。

### R12：兼容与回滚

- 旧 `pi-web-session-index.json` 只作迁移 seed/fallback；新写路径完成后停止写旧 sidecar，不删除旧文件。
- 成功 API body 与 UI 可见结构不变。
- 可通过 feature flag/单一 reader 切换回现有 `listAllSessions()`；回滚不涉及数据迁移。

## 未决问题

无阻塞产品问题。待用户审批的核心取舍是：

1. 接受索引放在每个 **space 自身根目录**，而不是集中到 main root。
2. 接受冷恢复“完整性优先”：超预算时宁可可重试失败，也不返回可能缺 session 的 partial 200。
3. 接受旧全局 sidecar只读迁移、后续停止新写。
