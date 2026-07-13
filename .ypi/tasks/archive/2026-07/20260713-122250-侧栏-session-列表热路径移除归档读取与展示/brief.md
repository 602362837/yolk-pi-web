# Brief：侧栏 session 热路径移除归档读取与展示

## 问题与证据

当前侧栏按项目空间加载 active session 的链路为：

`SessionSidebar.loadSessions` → `GET /api/projects/:projectId/spaces/:spaceId/sessions` → `listAllSessions(...)` → `scanArchivedCwds()` → 返回 `archivedCounts`。

归档明细本来只在展开“已归档”时请求 `/api/sessions/archived?cwd=...`，但归档计数会在每次空间切换、刷新及 session 刷新时同步扫描 `sessions-archive/`。本机参考规模为 active 约 117 文件 / 231 MB、archive 约 378 文件 / 201 MB；即使归档扫描是首行/计数级 I/O，它仍是 active 列表热路径中确定可去除的一层同步目录读取。

代码证据：

- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts` 在 active 列表和目标空间过滤后调用 `scanArchivedCwds()`，再按 `pathKey` 汇总 `archivedCounts`。
- `components/SessionSidebar.tsx` 保存 `archivedCounts`、`archivedSessions`、`archivedExpanded`，并提供 `loadArchivedSessions`、展开 effect、恢复/删除归档行。
- archive-all 确认文案当前把 `archivedCounts[selectedCwd]` 与 active `filteredSessions.length` 相加；移除计数后应明确只展示本次将归档的 active session 数量。
- `GET /api/sessions` 也无条件调用 `scanArchivedCwds()`；仓库内唯一列表消费者 `bin/ypic.js` 只读取 `body.sessions`，不消费 `archivedCwds`/`archivedCounts`。Project Registry 已取代旧 CWD picker，因此这两个字段在当前仓库内无消费者。

## 已确认目标

1. 侧栏默认加载、空间切换、刷新和归档后刷新不读取归档目录。
2. 侧栏不再展示“已归档 (N)”入口、归档列表、恢复及归档列表内删除操作。
3. 单个/批量/全部归档动作继续可用；成功后仅刷新 active session 列表。
4. 保留归档存储、archive/unarchive/archive-all/archived API、按 id 打开归档详情及 Usage `includeArchived`。
5. 不在本任务重构 active `listAllSessions()` 全量扫描或 project-session index。

## 推荐边界

- 删除 project-space sessions 响应中的 `archivedCounts`，不保留空对象兼容壳；前后端同仓同步，字段无其他仓内消费者。
- 同时删除全局 `GET /api/sessions` 中无人消费的 `archivedCwds`/`archivedCounts` 和对应扫描，响应收敛为 `{ sessions }`。`ypic` 兼容，因为只读取 `sessions`。保留 `scanArchivedCwds()` 函数本身，不误伤归档能力或未来显式调用。
- archive-all 确认数量改为 `filteredSessions.length`，文案说明是“当前会话”；空空间只由 active 列表为空决定。

## UI 门禁

本任务删除用户可见的“已归档”信息结构和展开/恢复交互，触发强制 UI HTML 原型门禁。需要 `ui-designer` 基于当前 `SessionSidebar` 产出轻量 HTML 原型，展示：active 列表不变、归档按钮不变、列表底部不再出现归档区块、archive-all 确认只计本次 active session。

当前 architect 子会话没有 Studio 成员派发工具，不能代替 `ui-designer` 交付合规原型，也不能安全进入 `awaiting_approval`。主会话需完成派发并回填原型后，再保存 implementationPlan、切换到 `awaiting_approval`。

## 诚实性能边界

该变更只保证去除 archive 扫描与归档展示相关请求。active 列表仍通过全局 `listAllSessions()` 后过滤目标 space，长尾可能仍存在；其定向读取/索引重构属于既有任务 `20260712-133644-排查左侧-session-列表加载缓慢问题`，不在本任务范围。
