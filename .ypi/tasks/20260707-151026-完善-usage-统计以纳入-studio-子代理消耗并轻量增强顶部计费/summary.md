# Summary

已完成 Usage 统计增强：

- `/api/usage` 与 `lib/usage-stats.ts` 纳入带 `studioChild` header 的 Studio child session usage。
- 新增 parent session rollup，区分 parent own totals 与 Studio child totals。
- `GET /api/usage?sessionId=<id>` 支持轻量 session rollup；归档场景先扫描 header/metadata，再只打开相关 parent/child session entries。
- Chat 顶部 cost 通过后台 usage API 展示 parent + child 汇总，并保留本地 fallback。
- UsageStatsModal 增加 Studio child/parent rollup 说明与展示。
- 更新了相关模块文档。

验证结果：

- `npm run lint` 通过。
- `node_modules/.bin/tsc --noEmit` 通过。
- Checker 复查通过，无剩余 findings。
