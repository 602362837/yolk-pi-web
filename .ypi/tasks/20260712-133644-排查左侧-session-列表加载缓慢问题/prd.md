# PRD: session 列表加载性能治理

## 目标与背景

降低左侧 session 列表首次加载、空间切换和手动刷新时的 P95/P99 长尾，并保证列表完整性、排序、Studio child 折叠关系和 archive count 与现有行为一致。

## 范围内

- project-space sessions 请求触发、重复请求和竞态治理。
- active session 扫描、header 解析、排序、Studio child display 投影和 archive count 的测量与优化。
- 进程内缓存、single-flight、sidecar index 候选加速、失效和回退。
- 聚焦单元测试、API 契约测试与可复现性能基准。

## 范围外

- 不改变 session JSONL 格式或把 sidecar 变成权威数据源。
- 不改变侧栏的信息架构、加载文案、骨架屏或切换交互。
- 不在首轮引入列表虚拟化；只有测量证明 React commit/render 成为瓶颈后再立项。
- 不优化全局 Usage 扫描或 session detail 加载，除非共享缓存可无行为变化复用。

## 需求与验收标准

### R1 可观测性

服务端能记录一次列表请求的总耗时及 registry、active discovery、summary/header、Studio projection、archive scan、filter/sort/serialize 等阶段耗时，并记录 active/linked/child/index-hit/cache-hit 数量；默认日志不得包含消息正文、工具参数或凭据。

验收：构造慢请求时可由日志定位主导阶段；日志字段有界且不泄漏 session 内容。

### R2 请求去重与竞态

同一空间的一次用户刷新最多产生一条有效 sessions 请求；空间切换或后续刷新应 abort 旧请求，旧响应不得覆盖新空间。

验收：浏览器网络面板中刷新和快速切换没有无意义的并发全量扫描；AbortError 不显示为用户错误。

### R3 扫描与缓存

未变化 session 文件不重复执行完整摘要/header/task 投影；并发相同扫描共享 single-flight。缓存键必须能检测 path、mtime、size 变化；缓存异常、覆盖不足或进程重启时自动回退文件扫描。

验收：冷缓存结果与当前实现深度等价；热缓存再次请求显著减少文件读取；新增、fork、rename、archive、unarchive、delete 和外部写入在约定新鲜度内可见。

### R4 索引安全

`pi-web-session-index.json` 仅作候选/加速；索引缺项、陈旧路径、重复 id、project/space 不一致均不得隐藏合法 session，且允许 best-effort 修复。

验收：删除索引、构造部分索引或陈旧索引时 API 仍返回完整正确列表。

### R5 行为兼容

保持现有响应字段、modified 降序、parent/Studio child 关系、legacy 默认不返回和 archived count 语义。

验收：契约测试覆盖普通 session、fork、Studio child、孤儿/坏 header、缺失 WorkTree、archive 场景。

### R6 性能目标

在固定 fixture（至少 500 sessions、100 Studio children、总 JSONL 体量至少 100 MB）上记录 cold/warm 基线。推荐门槛：warm P95 <= 250 ms，cold P95 相比基线降低至少 50%，同一空间并发请求只触发一次底层扫描。最终数值应在实现前由主会话确认并结合 CI 机器校准。

## 未决问题

- 是否确认推荐的 1 秒最大复用窗口及显式失效策略。
- 是否将性能基准作为 CI 非阻塞报告先落地，稳定后再设硬门槛（推荐）。
