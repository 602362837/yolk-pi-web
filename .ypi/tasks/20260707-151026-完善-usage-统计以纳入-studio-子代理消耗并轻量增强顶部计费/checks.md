# Checks — Usage 纳入 Studio child sessions

## 需求覆盖检查

- [ ] `/api/usage` 普通聚合包含带 `studioChild` header 的 YPI Studio child sessions。
- [ ] `usage.includeArchived=true` 时 archived child sessions 也参与统计。
- [ ] `UsageStatsResult` 保留旧字段，并新增 `byParentSession`、child session count 字段。
- [ ] `byParentSession` 按 `studioChild.parentSessionId` 归并，且 totals = ownTotals + studioChildTotals。
- [ ] `GET /api/usage?sessionId=<parent>` 返回 parent + children session lifetime rollup。
- [ ] `GET /api/usage?sessionId=<child>` 能解析到 parent rollup 或合理 fallback。
- [ ] Chat 顶部 stats 使用后台 rollup totals，API 失败时 fallback 本地 `messages` usage。
- [ ] 父 session `messages` / context 不包含 child transcript、child messages 或 child usage 明细。
- [ ] UsageStatsModal 明确说明包含 Studio child sessions，并优先展示 parent rollup。
- [ ] docs 更新 API/frontend/library/architecture 相关描述。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## API 手工验收

1. 找到一个 parent session 和至少一个 `studioChild.parentSessionId=<parent>` 的 child session。
2. 请求：
   ```bash
   curl 'http://localhost:30141/api/usage?sessionId=<parentId>'
   ```
   检查：
   - `kind === "session_rollup"`
   - `parentSessionId === <parentId>`
   - `studioChildSessionCount >= 1`
   - `totals.cost` 约等于 `ownTotals.cost + studioChildTotals.cost`
   - 响应不含 transcript/prompt/output 大文本。
3. 请求：
   ```bash
   curl 'http://localhost:30141/api/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&cwd=<cwd>'
   ```
   检查：
   - `scope.includeStudioChildren === true`
   - `matchedStudioChildSessions` 符合预期
   - `byParentSession` 有对应 parent row。

## UI 手工验收

- 普通会话：顶部 stats 与旧体验基本一致，无多余噪音。
- Studio parent 会话：顶部 cost/tokens 包含 child；tooltip 展示 child 数和 own/child cost。
- Studio child audit 会话：显示 parent rollup 或 child fallback，不报错。
- Usage Modal：标题/说明能解释 child sessions 已 roll up 到 parent；Parent sessions 列表显示 child count。
- 快速切换两个 session：顶部不会短暂保留上一 session 的 API rollup。

## 质量检查

- 类型定义只导出必要字段，不使用 `any` 绕过动态边界。
- session reader 默认调用不暴露 Studio child roots；只有 usage/debug opt-in。
- Usage API 不返回 artifact bodies、transcript preview、child prompt/output。
- 前端 fetch 使用 AbortController，避免 unmounted setState 和 race。
- 文档明确 CLI `--no-session` runner 不在本次标准 session usage 口径内。

## 回归风险重点

- Sidebar/session list 不应突然显示 Studio child audit roots。
- Usage Modal 的 cwd/archive 过滤不能因 child 引入而失效。
- 归档 session reader 不能破坏现有 archive/unarchive flows。
- 顶部 stats 不能增加主聊天模型上下文或 SSE payload。
- 大量 session 下 `/api/usage?sessionId=...` 不应打开所有 session entries。