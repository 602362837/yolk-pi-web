# Checks：轻量会话元数据扫描

## 需求覆盖

- [x] `SessionManager.listAll/buildSessionInfo` 的 `allMessages[] + join` 不再位于任何列表/inventory/批量 cwd 操作路径。
- [x] scanner 不使用完整文件 `readFile`、完整 entries `getEntries()`、整行 `JSON.parse(line)`。
- [x] 返回对象与缓存不含 `allMessagesText`、完整 message content、tool result、summary/custom data。
- [x] firstMessage/name/token 捕获均有明确上限；并发数固定有界。
- [x] JSONL 仍为权威来源，无 sidecar 强一致依赖、迁移或写回。

## 自动验证

- [x] 标准 user string 与 content text blocks。
- [x] 首条 assistant 后首条 user；toolResult 计入 messageCount 但不计 activity/title。
- [x] 最新 `session_info` 覆盖与显式 clear。
- [x] `message.timestamp` 与 entry timestamp/fallback mtime 的 modified 优先级。
- [x] projectId/spaceId、parentSession、legacy header、Studio child header。
- [x] JSON key 重排、额外未知字段、嵌套对象/数组。
- [x] escape、Unicode、surrogate、CRLF、无结尾换行、chunk size 1 与随机 chunk。
- [x] malformed/orphan/中途截断/超限 metadata token 的单文件隔离。
- [x] 大正文单条 content 与多会话 fixture 不把正文 marker 带入结果；隔离进程 GC 后 retained heap 不随正文线性增长且显著低于 SDK 基线（实测 ~12MB body 级夹具；非严格 100MB，结构性无正文门禁为硬门槛）。
- [x] active 与 archived 列表的 id/cwd/name/count/title前50字/parent（active path→id）/排序语义；archived 与旧 `getEntries` 路径对齐到 PRD 的 first-user / activity-modified（见 review 残余说明）。

## API / 手工验收

- [x] `/api/sessions` 全局历史 wire：`listAllSessions` 回归覆盖标题/消息数/Studio filter/parentSessionId（自动化）。
- [x] project-space 列表仍走 `listAllSessions({ includeStudioChildren, includeStudioChildDisplay })`；linked/legacy/Studio nested 逻辑未改（代码审阅 + wire 测试）。
- [x] 普通 Studio child 默认不作为 root；`includeStudioChildren: true` 可见。
- [x] archive 列表轻量 scanner；`scanArchivedCwds` header-only；archive-all 用 `scanSessionInventory`（自动化 + 源码门禁）。
- [x] 删除缺失 WorkTree：`pruneDeletedWorktreeSessions` / `deleteSessionsForCwd` 仍在 inventory 后执行（代码审阅）。
- [x] 详情/分支/上下文/导出仍可 `SessionManager.open(...).getEntries()`（单会话路径保留）。
- [x] Usage inventory 来自 `listAllSessions({ includeStudioChildren: true })` + archived helpers；精确 usage 仍按目标文件 `getEntries`，不依赖 `allMessagesText`（代码审阅）。

> 可选残余：生产数据上的一次人工浏览器冒烟（全局列表 / 归档 / Usage 数字）未在本检查环境执行，不阻塞合并（自动化已覆盖契约）。

## 质量检查

```bash
npm run test:session-metadata
npm run test:session-list-performance
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
rg -n 'SessionManager\.listAll' lib app
```

- [x] 更新 `docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/library.md`。
- [x] 没有无界 `Promise.all` 文件读取（inventory 使用 `mapWithConcurrency`，默认并发 8）。
- [x] 文件 descriptor：`createReadStream` 正常 end/error/destroy；`readFirstLineSync` finally `closeSync`。
- [x] timing collector 只记录标量，不接收内容。

## 重点风险（复查结论）

1. tokenizer escape/chunk 边界 — 已有 chunk=1 / 随机 chunk / SDK 差分；**通过**。
2. 超大单行峰值 — 结构性 marker + 隔离进程 heap 门禁；**通过**（夹具体积约 12MB 级，足够证明不随正文线性保留）。
3. modified 语义 — active 与 scanner 使用 activity 优先，**未**退化为 mtime；归档从旧 mtime 收敛到 activity，属设计内对齐。
4. 旁路 — `lib`/`app` 生产 inventory 无 `SessionManager.listAll(` 调用；`getEntries` 仅单会话/Usage/RPC；`scanArchivedCwds` 已去整文件 `readFile`。

## Checker 结论

**Pass** — 见 `review.md`。
