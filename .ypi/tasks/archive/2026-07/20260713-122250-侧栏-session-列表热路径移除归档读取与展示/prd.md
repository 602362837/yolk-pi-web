# PRD：侧栏移除归档读取与展示

## 目标与用户价值

让左侧 session 列表的高频路径只处理 active sessions，不再为极低频归档浏览承担同步目录扫描和额外 UI 状态成本。用户在空间切换、刷新及归档动作后应更快看到 active 列表，且归档数据本身保持安全可用。

## 范围内

1. project-space sessions API 不扫描 archive，不返回 `archivedCounts`。
2. 侧栏删除“已归档”区块、计数、展开、归档列表、恢复入口及相关请求/state/effect/component。
3. 单个、批量和全部归档成功后只调用 `loadSessions` 刷新 active 列表。
4. archive-all 确认只显示本次 active session 数量，不再把已有归档数计入。
5. 当前仓库无人消费的全局 `GET /api/sessions` 归档字段及自动扫描一并移除；保留 `{ sessions }` 和现有查询参数语义。
6. 更新前端、API、架构文档，明确侧栏无归档浏览入口、归档能力与 Usage 扫描独立存在。
7. 交付并审批基于现有侧栏样式的 HTML 原型后方可实现。

## 范围外

- active `listAllSessions()` 的全局扫描与按 space 定向读取重构。
- project-session index 重做。
- 删除或迁移 `sessions-archive/`。
- 删除 `/api/sessions/archive`、`archive-all`、`unarchive`、`archived`。
- 修改按 id 读取归档 session 的详情能力。
- 修改 Usage `includeArchived`、归档 usage 扫描或设置 UI。
- 新增替代性的归档浏览入口或“点击再加载”交互。

## 功能需求与验收标准

### FR-1 热路径零归档扫描

- 空间首次加载、切换、刷新及 `refreshKey` 触发的 project-space sessions 请求不得调用 `scanArchivedCwds()` 或读取 `sessions-archive/`。
- project-space API 响应不包含 `archivedCounts`。
- 全局 `/api/sessions` 仅返回 active `sessions`，不为无人消费的 archive 字段扫描归档目录。

### FR-2 侧栏只展示 active session 历史

- 侧栏不出现“已归档 (N)”或归档 session 行。
- active session 树、Studio child 行、空态、选择、重命名、删除和归档按钮行为保持不变。
- active 为空时直接显示“No sessions found in this space”，不依赖归档计数。

### FR-3 归档动作继续可用

- 单个归档、勾选批量归档和“归档所有会话”仍调用现有 API。
- 成功后只刷新 active sessions，不请求 `/api/sessions/archived`。
- archive-all 确认数等于当前 active `filteredSessions.length`；文案不暗示会重新处理已有归档。

### FR-4 低频/独立归档能力不受损

- 归档文件仍移动到 `sessions-archive/`。
- archive/unarchive/archive-all/archived API 保留。
- 已知归档 session id 仍可通过详情路由打开，并保持 archived/read-only 表现。
- Usage 是否扫描 archive 仍只由 `usage.includeArchived` 控制。

### FR-5 文档与验证

- `docs/modules/frontend.md`、`docs/modules/api.md`、`docs/architecture/overview.md` 与实现一致。
- `npm run lint` 与 `node_modules/.bin/tsc --noEmit` 通过。
- 手工 smoke 覆盖切空间、刷新、归档一个 session、批量/全部归档，以及 Network 中无侧栏 `/api/sessions/archived` 请求。

## 非功能要求

- 不增加新缓存、索引或迁移。
- 不改变 JSONL 内容和归档文件位置。
- 不以保留空 `archivedCounts` 的方式掩盖已删除契约。
- 不声称已解决 active 全量扫描造成的全部性能问题。

## 未决事项

产品范围已由用户确认，无需新增产品决策。流程阻塞仅为 UI designer HTML 原型尚未交付和审批。
