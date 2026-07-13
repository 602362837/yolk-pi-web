# Design：归档能力与侧栏 active 热路径解耦

## 方案摘要

从两个 active 列表 API 的默认响应中移除 archive 扫描和归档字段，并从 `SessionSidebar` 删除全部归档浏览投影。归档写入、显式归档查询、详情和 Usage 仍保留为独立能力。该方案是删除无用耦合，不增加缓存、索引或迁移。

## 影响模块与边界

| 模块 | 变更 | 不变边界 |
| --- | --- | --- |
| `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts` | 删除 `scanArchivedCwds` import、`archive` timing stage、pathKey 汇总和 `archivedCounts` 响应字段 | active inventory、目标 space 过滤、legacy 与 Studio child 响应不变 |
| `app/api/sessions/route.ts` | 删除无条件 `scanArchivedCwds()`；响应改为 `{ sessions }` | `includeGit`、`includeStudioChildren` 与 `ypic` 的 `sessions` 消费不变 |
| `components/SessionSidebar.tsx` | 删除 archive display state/loader/effect/section/`ArchivedSessionItem`/unarchive handler；归档成功仅刷新 active | active session 操作与 archive 写 API 不变 |
| 文档 | 删除 picker/侧栏依赖 archive counts 的陈旧描述 | archive 存储、显式 API、Usage 文档保留 |
| `lib/session-reader.ts` | 本任务不删除 `scanArchivedCwds`、`listArchivedSessionsForCwd` 或 archive helpers | 归档底层与未来显式调用兼容 |

## 数据流

### 变更后 active 侧栏链路

1. `SessionSidebar.loadSessions()` 请求 project-space sessions route。
2. route 读取 Project Registry space，调用 `listAllSessions()` 获取 active inventory。
3. route 过滤 linked roots、Studio children 与可选 legacy sessions。
4. route 直接返回 `{ sessions, legacyUnassigned, studioChildrenByParentSessionId }`。
5. Sidebar 只写入 `allSessions`；不保存 archive count，不触发 archive detail 请求。

### 归档动作链路

1. 单个/批量/全部归档继续调用现有 POST API。
2. 成功后清理 active selection 并调用 `loadSessions(false)`。
3. Sidebar 不重置或拉取 archived state，因为该 state 和 UI 不再存在。
4. 文件移动仍由现有 archive helpers 执行并失效 session snapshots。

### 独立归档读取链路

- `GET /api/sessions/archived?cwd=...` 和 `listArchivedSessionsForCwd()` 保留，但 Sidebar 不再调用。
- `GET /api/sessions/[id]` 的归档路径解析保留，外部已知 id 可继续打开详情。
- Usage 直接使用 archived metadata/session helpers，完全不依赖 Sidebar 字段。

## API 契约

### Project-space sessions

变更前：

```json
{
  "sessions": [],
  "legacyUnassigned": [],
  "archivedCounts": {},
  "studioChildrenByParentSessionId": {}
}
```

变更后：

```json
{
  "sessions": [],
  "legacyUnassigned": [],
  "studioChildrenByParentSessionId": {}
}
```

不保留空 `archivedCounts`：该字段仅由同仓 Sidebar 消费，前后端同步删除可避免继续暗示支持侧栏归档计数。

### Global sessions

变更前：`{ sessions, archivedCwds, archivedCounts }`

变更后：`{ sessions }`

仓内 `bin/ypic.js` 只读取 `body.sessions`，无需适配。该字段删除属于响应收敛，需在 API 文档明确；若主会话认为外部未记录客户端兼容性高于去除全局 archive I/O，可将 global route 保持不变，但这不影响 project-space Sidebar 成功标准。推荐按当前仓内证据一并删除。

## 前端细节

- 删除 `archivedCounts`、无名 `setArchivedCwds`、`archivedSessions`、`archivedExpanded`。
- `loadSessions` response type 删除 `archivedCounts`；空间切换时不再重置 archived state。
- 删除 `loadArchivedSessions`、`handleUnarchiveSession` 与展开 effect。
- `handleArchiveSession` 成功后只清选择并 `loadSessions(false)`。
- `handleDeleteSession` 不再过滤 archived state。
- 空态条件简化为 active project 存在且 `filteredSessions.length === 0`。
- archive-all confirmation 使用 `filteredSessions.length`，建议文案为“确认归档 N 个当前会话？归档后仍可通过保留的 API/已知链接恢复”，但不得新增侧栏恢复承诺。
- 删除整个 `ArchivedSessionItem`，避免残留 `/api/sessions/archived`、unarchive 和 archived delete 触发点。

## 性能与观测

- project-space route 的 timing 不再出现 `archive` stage 或 `archiveCwds` count。
- 侧栏 Network 中不应出现 `/api/sessions/archived`。
- 不能以此变更承诺 active scan 变快到特定阈值；收益是确定移除 archive 同步 I/O。

## 兼容性与迁移

- 无 JSONL、registry、sidecar 或设置迁移。
- 归档文件不移动、不删除、不改写。
- archived API 继续存在，因此这是 UI 可达性删除，不是能力删除。
- global response 删除字段可能影响未记录的外部客户端；仓内搜索无消费者，且字段原用途（CWD picker）已由 Project Registry 替代。该风险应在 release note/评审中明确。

## 风险与缓解

1. **误删归档底层能力**：限制改动到两个 list route、Sidebar 和文档；对 archive/unarchive/Usage 文件做 diff 审查，原则上不修改。
2. **archive-all 数量口径错误**：只显示本次 active `filteredSessions.length`，手工以已有归档 + active 混合场景验证。
3. **残留自动请求**：用 `rg` 搜索 `loadArchivedSessions|archivedExpanded|/api/sessions/archived`，并在浏览器 Network 验证。
4. **外部 API 兼容**：记录 global 字段删除；若审批要求保守兼容，可只保留 global route，不能把 archive 扫描重新接回 project-space Sidebar route。
5. **用户失去侧栏恢复入口**：这是已确认产品取舍；原型和审批书必须明确，不新增替代入口。

## 回滚

代码回滚可恢复 route 字段和 Sidebar archived section；无数据回滚。归档文件与 API 始终保留，因此回滚不涉及迁移。
