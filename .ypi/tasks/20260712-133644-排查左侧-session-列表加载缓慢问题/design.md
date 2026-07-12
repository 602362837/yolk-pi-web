# Design: project-space session 列表性能优化

## 方案摘要

采用四层治理：请求层去重/取消，扫描层 single-flight，文件级增量摘要缓存，best-effort index 候选加速与校验回退。保持 JSONL header 为 project/space 关联真相，保持现有 API 响应。

## 影响模块

- `components/SessionSidebar.tsx`：稳定请求依赖、AbortController、刷新合并。
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`：阶段计时、调用专用查询、响应兼容。
- `lib/session-reader.ts`：可复用 session summary snapshot、文件级缓存、Studio projection 去重、失效入口。
- `lib/project-session-index.ts`：安全读取、候选校验、覆盖率/陈旧项诊断、best-effort 修复。
- session 变更调用方：新建/fork/archive/unarchive/delete/rename 后显式失效或更新缓存/index。
- `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/architecture/overview.md`：记录缓存边界和真相来源。

## 数据流

1. 前端以 `projectId/spaceId/requestGeneration` 发起请求；新请求先 abort 上一请求。
2. route 验证 project space，创建有界 timing collector。
3. 专用 reader 获取 active inventory。相同 inventory 扫描共享 process-global single-flight。
4. 每个文件按 `absolutePath + mtimeMs + size` 查摘要缓存；命中直接复用，未命中才解析摘要/header。
5. index 为目标空间提供候选集合，但 reader 同时执行低成本 inventory reconciliation；未索引/不一致文件读取 header 后纳入正确空间并修复 index。不能仅凭索引排除文件。
6. Studio child display 按 `(cwd, taskId)` 在单请求/短期缓存内去重，再按 run/subtask 投影。
7. archive counts 使用独立 snapshot；archive/unarchive 显式失效，TTL/inventory 变化兜底。
8. route 过滤目标 roots/children，维持现有响应字段并输出 timing 日志。

## 缓存契约

- process-global 存储以兼容 Next dev hot reload，但必须有容量上限、TTL 和删除陈旧 path 的 sweep。
- 文件 fingerprint 使用 mtime+size；极端同 mtime/size 原地重写由短 TTL/inventory reconciliation 兜底。若需更强保证，可只对 header 首段增加轻量 hash，不应 hash 全文件。
- single-flight 失败不得缓存 rejected promise；下一请求可重试。
- 显式失效覆盖 create/fork/rename/archive/unarchive/delete；外部进程写入依赖不超过 1 秒 TTL/重新 stat。
- index 写失败不影响主请求；索引读坏时回退并记录有界 warning。

## 请求与竞态

- `loadSessions` 不依赖整个 `projects` 对象；先由 memo/ref 解析稳定 selected space，依赖其 id/pathKey 或直接依赖 ids。
- 手动刷新先刷新 projects，再基于最新 selection 调用一次 sessions，或只让统一 effect 触发，不可并发调用两条路径。
- token 继续防止陈旧 state commit，AbortController 用于停止网络等待；服务端还需 single-flight，因为客户端 abort 不保证 Node 已停止底层 I/O。

## 列表渲染

首轮仅用 `useMemo` 缓存 `filteredSessions/sessionTree`，前提是 profiler 证明重复 render 有可见成本。暂不虚拟化，因为层级 session row 和 context menu 会扩大改动面，且当前主因在服务端全量扫描。

## 兼容性与迁移

无需 JSONL/API schema 迁移。旧 session、缺失/损坏 index 自动走扫描路径。已有 index 可渐进 backfill。多进程不共享内存缓存，每个进程独立校验文件；文件仍是真相。

## 风险与缓解

- **陈旧列表**：短 TTL + 变更点显式失效 + inventory reconciliation。
- **索引漏项隐藏数据**：索引只作候选，永不作排除依据。
- **缓存无界增长**：LRU/容量上限并清理已删除 path。
- **同步 fs 阻塞**：先减少调用次数；后续若 profiling 仍显示阻塞，再将 inventory/stat/header read 改为 async bounded concurrency。
- **日志噪声/隐私**：慢请求阈值采样，只记录计数和耗时，不记录标题、正文或绝对路径。
- **缓存共用引入回归**：先为专用 project-space 查询落地，验证后再考虑复用到全局 `/api/sessions`/Usage。

## 回滚

前端可恢复原 token-only 请求。服务端通过移除专用 snapshot/cache 调用回到 `listAllSessions()`；不删除或重写 JSONL。sidecar index 仍是可忽略的 best-effort 文件。
