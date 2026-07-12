# 计划审批书：左侧 session 列表加载性能治理

## 审批摘要

本任务当前只完成根因分析与可执行规划，不修改生产代码。

已确认的主因不是 React 列表渲染，而是 project-space 专用 API 仍执行全局 active session 扫描：`SessionManager.listAll()` 后再次逐文件读取 header，并为所有 Studio child 重复读取 task detail；archive counts 也随每次请求重扫。已有 `pi-web-session-index.json` 没有进入该 route 的读取链路，且本机只覆盖 16/50 active session，因此不能直接切换为 index-only。

前端还存在放大因素：`loadSessions` 依赖整个 projects 数组；手动刷新同时调用 projects 和 sessions，projects 更新后又触发一次 sessions；generation token 只防止旧响应写 state，没有 abort 过期服务端工作。

## 推荐方案

1. 先增加内容安全的分阶段计时与固定 fixture benchmark，确定真实 P95/P99 主导阶段。
2. 前端稳定请求身份、合并刷新触发并 abort 旧请求，保持现有 UI 不变。
3. 服务端增加相同扫描 single-flight 和按 `path + mtime + size` 的有界增量摘要缓存。
4. index 只作为候选加速，必须校验文件/header、发现漏项并 best-effort backfill；JSONL 始终是真相。
5. 按 task 去重 Studio detail 读取，独立缓存 archive count，并覆盖所有 session mutation 失效点。
6. 用 cold/warm benchmark、并发扫描次数、契约测试和人工生命周期 smoke 验收。

## UI 门禁

当前方案不改变可见信息、加载状态、刷新按钮或空间切换交互，因此不触发 HTML 原型门禁。若审批时选择 stale-while-revalidate、骨架屏、分页/虚拟滚动或新增提示，必须先派发 UI 设计员产出 HTML 原型并再次审批。

## 关键验收

- 空/部分/损坏/陈旧 index 不得导致 session 消失。
- 一次刷新只产生一次有效 sessions 请求；快速切换 abort 旧请求。
- 热请求不重复读取未变化文件；同空间并发请求共享一次底层扫描。
- 普通/fork/Studio child 关系、标题、modified 排序和 archive count 与现有行为一致。
- 推荐 warm P95 <= 250 ms、cold P95 相比固定 fixture 基线降低至少 50%；首期可作为非阻塞 benchmark，稳定后设硬门槛。

## 需要审批的决策

- 接受首版保持现有加载 UI，仅优化内部链路（推荐）。
- 接受最多 1 秒进程内缓存复用，并由已知 mutation 显式失效（推荐）。
- 要求外部进程直接写 session 后 1 秒内可见，因此 index 不能成为唯一读取来源（推荐）。
- 性能绝对值首期作为报告项，回归稳定后再设 CI 硬门槛（推荐）。

## 相关产物

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 门禁判断](ui.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
- [Handoff](handoff.md)

批准上述计划后，主会话应保存 `implementationPlan` 并将任务切到 `awaiting_approval`/后续审批状态；在用户明确批准前不得开始实现。
