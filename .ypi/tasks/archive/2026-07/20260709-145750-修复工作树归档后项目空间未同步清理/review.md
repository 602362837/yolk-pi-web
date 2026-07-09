# review

## Check Complete

### Findings Fixed

- 修复 `GET /api/projects?sync=missing` 先读后同步导致响应仍返回旧 projects 的问题；现改为先执行 missing-only sync，再返回最新 registry 数据。
- 修复 Sidebar `loadProjects()` 未使用 `?sync=missing`，导致 CLI/直接删目录后的被动同步默认不触发；现默认通过 `GET /api/projects?sync=missing` 加载项目。
- 补充被动同步后的 allowed-roots 缓存失效：`GET /api/projects?sync=missing` 与 `POST /api/projects/[projectId]/worktrees/refresh` 在实际归档到 missing worktree space 时会调用 `invalidateAllowedRootsCache()`。

### Remaining Findings

- 非阻塞：Project Registry 仍采用读-改-写原子落盘，但没有专门的进程内写锁；若未来频繁并发执行 archive/refresh/sync，仍存在最后写入者覆盖前一写入的老风险。本次改动未扩大该风险。

### Verification

- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed
- 静态审查 — 确认 `archiveWorktreeSpacesByPaths` 仅处理 `kind === "worktree"`，主匹配键为 `pathKey`，`displayPath`/`realPath` 仅作同 space 精确兜底；未发现跨 project/main space 误归档路径。
- 静态审查 — 确认 archive/delete API 响应仅新增 `archivedSpaces` / `unmatchedPaths` / `warning`，保持向后兼容。
- 静态审查 — 确认 Sidebar 归档后 fallback 顺序覆盖 main → 同项目其他 active/non-missing space → `fallbackCwd` → `null`。

### Verdict

- Pass / completion-ready（可完成）
- 原实现有 3 个可修复缺口（projects 响应陈旧、默认不触发 missing sync、被动同步后 allowed-roots 缓存未失效）；已修复并通过 lint/typecheck。
- 建议主 session 将该任务结束并归档；当前 Remaining Findings 仅剩非阻塞并发写入老风险，无需为本任务继续返工。