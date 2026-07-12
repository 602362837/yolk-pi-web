# Checks

## 需求覆盖

- [ ] project-space 列表不因索引缺失/损坏漏 session。
- [ ] 普通 roots、fork parent、Studio children 的结构和标题与基线一致。
- [ ] modified 排序、legacy 默认排除、archive count 保持一致。
- [ ] 新建、fork、rename、archive、unarchive、delete 后列表及时更新。
- [ ] 外部进程新增/修改 JSONL 在约定窗口内可见。

## 自动验证

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- session reader focused tests：冷/热缓存、mtime/size 变化、删除、坏 header、single-flight rejection retry、容量清理。
- index tests：空/部分/陈旧/损坏/重复 index，确保回退完整性和 best-effort repair。
- route contract tests：普通 session + fork + Studio child + archive count，响应深度等价。
- frontend tests：一次 refresh 只发一次 sessions 请求；快速 A -> B 切换 abort A，A 不覆盖 B；AbortError 不展示。
- benchmark fixture：至少 500 sessions、100 Studio children、100 MB，记录 cold/warm P50/P95/P99、底层扫描次数、header/task 读取次数。

## 人工验收

1. 启动 dev server，打开 Network/Performance，首次加载、连续刷新、快速切换三个空间。
2. 确认刷新动作没有重复 sessions 请求，旧请求显示 cancelled 或不再提交结果。
3. 新建、fork、重命名、归档、恢复、删除各一条 session，确认列表和 archive count 正确。
4. 同一 Studio task 下启动多个 child audit session，确认嵌套位置和标题不变。
5. 直接从另一进程创建/更新 session，确认在约定窗口内出现。
6. 查看慢请求日志，确认阶段耗时和计数足以定位，且没有正文/标题/工具内容。

## 性能门禁

- 冷/热基准必须与优化前同 fixture 对比，不能使用无效 project 404 作为 route 性能结论。
- 推荐 warm P95 <= 250 ms；cold P95 至少降低 50%。CI 初期作为报告项，稳定后再设硬失败。
- 相同空间 10 个并发请求最多触发一次底层 inventory/summary scan。
- React profiler 若 commit 仍超过 50 ms，再决定是否增加 memoization/virtualization；不得预设虚拟化是本问题根因。

## 重点回归风险

- cache key 漏掉文件变化导致陈旧标题/计数。
- index 被误当权威导致旧 session 消失。
- Studio display 按 task 去重时错误复用不同 run/subtask 标题。
- archive/unarchive 只失效 active 或 archive 一侧。
- React Strict Mode/dev refresh 与显式刷新叠加产生重复请求。
