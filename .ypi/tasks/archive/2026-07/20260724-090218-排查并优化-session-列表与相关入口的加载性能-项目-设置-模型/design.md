# Design：project-local、space-isolated session candidate index

## 1. 方案摘要

新增 project-space 专用 session 查询边界。每个 Project Registry space 在自己的物理根目录维护候选索引；列表请求不再调用全局 `listAllSessions()`，而是执行：

```text
Registry space
  → local index (<space-root>/.ypi/sessions/index.v1.json)
  → enumerate only that space's encoded-cwd dirs
  → validate candidate stat + bounded header
  → rescan changed candidate only
  → filter visible roots/children
  → batch project Studio displays by unique task
  → unchanged API response
```

JSONL 仍是唯一内容与关联真相。索引缺失/损坏时使用一次 header-only 全局恢复；完整恢复前不返回静默缺项的 200。

## 2. AS-IS

```text
space sessions route
  → listAllSessions(includeStudioChildren=true, includeStudioChildDisplay=true)
    → scanSessionInventory(~/.pi/agent/sessions/**)
    → stream every active JSONL
    → read every header
    → project every Studio child (task I/O, 1s cache)
  → filter target projectId/spaceId
```

问题：

- 工作量按全局 session/child 数增长，而不是按目标 space 候选数增长。
- 约 182 个 child 在过滤前投影，形成 N+1。
- 1s session snapshot 与 1s Studio projection TTL 无法吸收常规切换/刷新。
- 旧全局 index 覆盖不完整且未进入读路径；其读改写也没有统一并发锁。
- 大量文件流与同步 task 读取占用同一 Next.js 进程，设置/模型虽不调用 session reader，也被间接拖慢。

## 3. TO-BE 数据落点

### 3.1 精确路径约定

```text
# main space
<project-root>/.ypi/sessions/
  .gitignore
  index.v1.json
  .index.lock/              # only while mutating
  *.tmp                     # only while atomically replacing

# worktree space
<worktree-root>/.ypi/sessions/
  .gitignore
  index.v1.json
```

根目录解析：

1. 从 `getProjectSpace(projectId, spaceId)` 取得 `path`、`realPath`、`pathKey`。
2. 重新 canonicalize；仅当结果仍匹配 registry `space.pathKey` 才使用 `realPath ?? path`。
3. 拒绝 `.ypi`/`sessions`/index 为 symlink、非目录或越界路径；不可写时降级到安全读取/恢复，不阻断 session 数据读取。

**选择 space.cwd 落点，而不是 main root 的 `<spaceId>.json`：**

- Project Registry 以每个 space 自己的 `pathKey` 作为身份；worktree cwd 通常不是 main root。
- 索引与产生 session 的物理工作区同生命周期、同磁盘，天然隔离 main/worktree 候选和锁竞争。
- worktree 删除时 index 随工作区消失，但 JSONL 仍保留在 agentDir；registry 已将 missing worktree归档，恢复仍可走 JSONL/header，不造成数据迁移。
- 集中在 main root 会让 worktree 列表依赖另一个目录的可写性，并增加 spaceId 文件名、主仓库锁和跨 worktree并发耦合。

### 3.2 JSONL 真相

保持：

```text
<getAgentDir()>/sessions/<encoded-cwd>/*.jsonl
<getAgentDir()>/sessions-archive/<encoded-cwd>/*.jsonl
```

本任务不移动 JSONL。active 本地索引不得指向 `sessions-archive`。header 的 `id/cwd/projectId/spaceId/studioChild/parentSession` 与文件内容始终优先于 index。

## 4. 索引契约

建议 schema：

```json
{
  "schemaVersion": 1,
  "kind": "ypi-project-space-session-index",
  "projectId": "prj_...",
  "spaceId": "main",
  "spacePathKey": "/canonical/path",
  "coverage": "complete",
  "lastFullReconciledAt": "2026-07-24T00:00:00.000Z",
  "updatedAt": "2026-07-24T00:00:00.000Z",
  "sessions": {
    "session-id": {
      "sessionId": "session-id",
      "sessionFile": "sessions/--encoded-cwd--/...jsonl",
      "projectId": "prj_...",
      "spaceId": "main",
      "cwd": "/display/or/canonical/cwd",
      "cwdPathKey": "/canonical/cwd",
      "fileMtimeMs": 0,
      "fileSize": 0,
      "created": "...",
      "modified": "...",
      "messageCount": 0,
      "firstMessage": "bounded <= 100 chars",
      "name": "optional",
      "parentSessionId": "optional",
      "parentSessionFile": "optional agentDir-relative path",
      "studioChild": {
        "kind": "ypi-studio-child-session",
        "taskId": "...",
        "runId": "...",
        "member": "implementer",
        "subtaskId": "optional",
        "parentSessionId": "optional",
        "status": "optional"
      },
      "updatedAt": "..."
    }
  }
}
```

### 4.1 必填字段

Top-level：`schemaVersion/kind/projectId/spaceId/spacePathKey/coverage/updatedAt/sessions`。

Entry：

- `sessionId`：map key 必须一致。
- `sessionFile`：**相对 `getAgentDir()`**，只允许 `sessions/.../*.jsonl`，禁止 absolute、`..`、URL、archive root。相对路径避免在 project-local 文件中固化 home/volume 前缀，并适配 `PI_CODING_AGENT_DIR`。
- `projectId/spaceId`：用于 lock-time 防串写；最终仍以 header 为准。
- `cwd/cwdPathKey`：`cwdPathKey` 用于 registry 匹配，`cwd`用于恢复 `SessionInfo` 与 alias 诊断。
- `fileMtimeMs/fileSize`：摘要 fingerprint。
- `created/modified/messageCount/firstMessage`：未变化时直接复用列表摘要；`firstMessage`沿用 100 字符上限。
- `updatedAt`。

### 4.2 可选字段

- `name`：没有 `session_info` 时省略。
- `parentSessionId`、`parentSessionFile`：普通 fork/tree 投影；file 路径同样为 agentDir-relative。未知 parent id 时保留 file，待同批候选 path→id 映射补齐。
- `studioChild`：只保存既有 header 的 allowlisted pointer；**不保存** contextId、parentSessionFile、prompt、output、summary、error、transcript、artifact 或凭据。任务状态仍由 task.json 决定。
- 不在索引持久化 `studioChildDisplay`；标题/summary 可能随 task plan/run 变化，改由 fingerprint cache 批量投影。

### 4.3 文件安全与写入

- JSON size、entry count、字符串长度有上限；future schema/损坏/身份不匹配 fail closed。
- resolve 后做 lexical containment + `lstat` regular-file 检查；候选 header id 必须等于 entry key，project/space 必须匹配请求。
- 写入使用 per-space process queue、跨进程 mkdir lock、lock-time reread/merge、same-dir temp + rename；best-effort 0600。锁有 owner/pid、timeout 和不抢活进程的 stale recovery。
- 重建完成前不覆盖 last-good index；失败 promise 从 single-flight map 删除。

## 5. gitignore 策略

1. 本产品仓库 `.gitignore` 增加锚定规则：

   ```gitignore
   # local per-space session candidate index (runtime only)
   /.ypi/sessions/
   ```

2. runtime 第一次写每个 space index 前创建 `<space-root>/.ypi/sessions/.gitignore`，内容：

   ```gitignore
   *
   ```

   该规则只作用于 `sessions/` 子目录并会连同自身隐藏，避免 index/tmp/lock 被 `git status` 展示。

3. 使用 `git check-ignore --no-index`（`execFile` 参数数组）验证 index 目标确实 ignored；已有不兼容 `.gitignore` 不覆盖，必要时写带 marker 的 `.git/info/exclude` local rule。不能建立 ignore 保障时不持久化本地 index，走安全降级并记录 warning。
4. **禁止**忽略 `.ypi/` 整体，因为 `.ypi/tasks`、agents、workflows 等可能是项目资料。

## 6. 读路径

### 6.1 热路径

`listSessionsForProjectSpace(projectId, spaceId, { includeLegacy })`：

1. 读取并验证 registry space。
2. 读取该 space 的 local index；按 `projectId/spaceId/pathKey` 验证。
3. 仅枚举 `space.path`、`space.realPath` 等 registry-known alias 对应的 SDK encoded-cwd active 目录，发现标准 cwd 新文件；不枚举其他项目目录。
4. 合并 local entries + directed candidates，按 sessionId/file 去重。
5. 对每个候选执行 `lstat/stat + bounded first-line read`：
   - header 明确链接当前 project/space：保留；
   - header link 不匹配：从当前 index 移除并按新 link best-effort upsert 对方 index；
   - unlinked 且 cwd pathKey 匹配：仅 `includeLegacy=1` 放入 `legacyUnassigned`，不写 header；
   - 文件不存在/archived/非法：移除 stale entry。
6. fingerprint 未变时复用摘要；变化时只调用 `scanSessionMetadata(file)` 并更新 entry。
7. 建 path→id 映射补 parentSessionId，筛 root 与 child。
8. 只对父 root 可见的 Studio child 做 batch display。
9. 原子合并修复后的 index；修复写失败不影响已由 JSONL 校验的响应。

该路径的复杂度约为 `O(space indexed candidates + files in 1–2 directed cwd dirs + unique linked Studio tasks)`。

### 6.2 缺失、损坏、partial 和冷启动

恢复候选依次合并：

1. 旧 `pi-web-session-index.json` 中该 project/space 的条目（仅 seed，逐个验证）。
2. registry-known cwd encoded dirs 的定向扫描。
3. **全局 active root 的 header-only discovery**：只枚举文件并读取有界首行以找显式 `projectId/spaceId`，不流式解析所有消息；只对匹配文件扫描完整列表摘要。

首次完整恢复在 keyed single-flight 中进行。预算：目标 P95 5s、请求硬预算 10s：

- 有进程内 last-good：重新 stat/header 验证后返回 last-good，并让同一个 rebuild promise 继续；不得返回已不存在/已改绑项。
- 无 last-good：10s 后返回 `503 session_index_rebuilding` + `Retry-After`，不返回 partial 200；single-flight 可继续完成，后续请求复用结果。

这样索引损坏不会表现成“session 消失”，最坏表现是可重试不可用。慢日志包含 `recoveryReason/headerCandidates/matched/elapsedMs`，不含路径或内容。

### 6.3 后台收敛

- complete index 超过 5min 未 full reconcile 时，热请求先返回本次已验证结果，再触发低优先级、single-flight header-only reconciliation。
- 标准同 cwd 外部创建由每次定向目录核对立即发现。
- 非标准“在其他 cwd 目录手工写当前 project/space header”由首次/低频 full reconcile 收敛；不把全局扫描放回每次 request 主路径。

## 7. 写路径与失效点

统一新增 `upsert/remove/move/invalidateProjectSpaceSessionEntry`，调用方不得只清 1s global snapshot。

| 事件 | 行为 |
| --- | --- |
| create/bootstrap/draft/new | header project/space 持久化成功后 upsert local；失败不回滚 JSONL，下一定向/恢复补齐 |
| fork | 继承 link 后 upsert fork；parent id/file 同步 |
| Studio child create | child header 写入 project/space/studioChild 后立即 upsert；后续 status header 更新使 fingerprint 变化并失效 child/task projection |
| rename | append `session_info` 后 refresh 单 entry 摘要并失效 space list |
| archive | active local index remove；不把 archive path写入 active index |
| unarchive | 从 JSONL header 解析 link 后 upsert对应 local index |
| delete | remove；cascade-reparent 的 sibling entries失效/刷新 parent 字段 |
| delete-by-cwd / WorkTree cleanup | 批量 remove，允许 index 目录随 worktree 删除；JSONL 删除结果仍权威 |
| bind/relink project-space | 统一先写 header，再从 old index remove、向 new index upsert；任一步失败由 header reconciliation 修复 |
| project/space pathKey 变化/重注册 | 旧 index identity 不匹配而 fail closed；registry mutation 后触发重建，不自动信任搬来的文件 |
| ordinary message append/end | message_end/agent end 使 entry/list snapshot失效；即使漏通知，候选 stat fingerprint 仍兜底 |

当前代码没有通用的用户 session-relink API；本计划要求把现有 `writeSessionProjectLink` 调用收口为协调 helper，并为未来 bind 调用复用，**不自动 backfill legacy header**。

## 8. 旧全局 sidecar 关系

`~/.pi/agent/pi-web-session-index.json` 的定位调整为：

- 只读 migration seed / emergency fallback；不是热路径、不是完整性判定、不是数据真相。
- 本地 index完成后，create/fork/child 等新调用停止写旧 sidecar；不长期双写，避免两套候选权威和旧文件并发覆盖。
- 不删除用户现有全局文件；保留至少一个 release 兼容窗口和迁移计数日志。后续删除 reader 另开清理任务。
- 回滚到旧代码不受影响，因为旧 space route 本就不读取该 sidecar，而是全量 JSONL 扫描。

## 9. Studio child 设计

### 9.1 默认 payload

保持现有语义：

- `sessions` 包含当前 space 普通 roots，以及父 root 可见的 child 行。
- `studioChildrenByParentSessionId` 保持。
- 不把 child 当普通 root，不返回其他 project/space 或不可见 parent 的 child。

### 9.2 消除 N+1

- route 不再调用全局 `listAllSessions(... includeStudioChildDisplay: true)`。
- 专用 reader先完成目标 space/root/child筛选。
- `projectStudioChildDisplaysBatch(children)` 按 `cwdPathKey + taskId` 分组；每个 unique task 最多一次 `getYpiStudioTaskDetail`。
- task key fallback 的 `listYpiStudioTasks(scope:all)` 每个 cwd 最多一次，不是每 child 一次。
- 同一 task 的每个 child仍按 `runId/subtaskId` 派生自己的 `subtaskTitle/runSummary`，不能共享 run-specific结果。
- cache key包含 task.json `mtimeMs + size`；TTL 30s、LRU有界、single-flight。Studio task mutation点主动失效；fingerprint 是跨进程兜底。
- 验收计数：`studioProjectionCalls <= uniqueLinkedTasks`，而不是 182。

## 10. 缓存与 single-flight

- `space-list snapshot`：key=`projectId:spaceId:pathKey:includeLegacy`，fresh TTL 5s，容量 32；create/fork/archive/delete/rename/relink/child 事件立即失效。
- `index parsed cache`：按 index `mtimeMs:size`，TTL上限30s，容量64。
- `entry summary cache`：持久化在 index，进程内只作有界 LRU；stat fingerprint变化即重扫。
- `Studio task projection`：task fingerprint + 30s上限，容量256。
- `rebuild single-flight`：key=`projectId:spaceId:pathKey`；失败删除，不能缓存 rejected promise。
- manual refresh仍可通过专用 reader `forceValidate` 绕过5s response snapshot，但不触发无条件 global full reconcile。

所有 cache 存于 `globalThis` 以适应 Next dev reload，但必须带 schema/version，测试和 diagnostics只投影计数，不返回路径。

## 11. API 契约与错误

成功 body 不变：

```ts
{
  sessions: SessionInfo[];
  legacyUnassigned: SessionInfo[];
  studioChildrenByParentSessionId: Record<string, SessionInfo[]>;
}
```

新增的恢复错误只使用现有错误通道：

- `503 { error: "Session index is rebuilding", code: "session_index_rebuilding" }`
- `Retry-After: 1`
- `Cache-Control: no-store`

不向 browser 返回 index路径、sessionFile相对路径、恢复候选详情或绝对 cwd 之外的新诊断。

## 12. 设置/模型边界

Phase 1 不改 `/api/web-config`、`/api/models`、`/api/models-config` 业务代码。预期收益来自：

- 去掉 300 个 JSONL 的 request-path扫描。
- 去掉 182 次同步 Studio projection。
- 小候选集 async bounded I/O 与 single-flight减少事件循环/I/O池争用。

新增并发 benchmark同时请求 session route和上述三个入口。若 session优化后模型接口隔离 P95仍慢，则 Phase 2 单独调查 provider jiti bootstrap、ModelRuntime catalog、同步 fs与进程隔离；不得把独立冷启动问题塞入本任务。

## 13. 兼容性、风险与缓解

| 风险 | 缓解 |
| --- | --- |
| index漏项导致列表不全 | missing/partial/corrupt阻塞完整恢复；directed cwd每次核对；不返回 partial 200 |
| cwd alias/symlink重复或漏扫 | 以 registry pathKey为比较，扫描 path/realPath aliases，sessionId/file去重 |
| index路径被利用读取任意文件 | agentDir-relative allowlist、active sessions containment、lstat regular file、header id/link复核 |
| 多进程丢更新 | 跨进程锁、lock-time merge、atomic rename、失败保留 last-good |
| worktree删除后 index消失 | JSONL未移动；registry archived；恢复/header仍可用，不以 index作为真相 |
| Studio display缓存串 child | task级只共享 detail；run/subtask投影逐 child计算；key含task fingerprint |
| 外部手工跨cwd link延迟 | 首次完整恢复 + 5min低频 full reconcile；不污染每次热路径 |
| 10s恢复仍失败 | 无安全结果返回503，不返回空/partial；日志和single-flight支持重试 |
| gitignore误伤Studio资料 | 仅 `/.ypi/sessions/` 与目录内 `*`；测试 `.ypi/tasks`仍可见 |
| 模型页仍慢 | 用隔离/并发基准区分，必要时另开 Phase 2 |

## 14. 回滚

- 用单一 feature flag/reader入口将 space route切回 `listAllSessions()`。
- 停止本地 index写入即可；遗留 `.ypi/sessions/` 已被忽略且不影响 JSONL。
- 不删除/迁移 JSONL，不需要数据回滚。
- 旧全局 sidecar保留，因此无需恢复文件格式。
