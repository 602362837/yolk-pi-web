# 计划审批书：project/space session 列表性能优化

## 审批结论建议

建议批准 **方案 B：project-local、space-isolated 逻辑索引**。本计划不搬迁 JSONL、不改 UI，通过每个 space 自己的候选索引与定向校验，将列表复杂度从“全局约300 sessions + 180 children”收敛到“目标space约1–22候选 + unique Studio tasks”。

## 核心决策

1. **精确落点**：
   - main：`<project-root>/.ypi/sessions/index.v1.json`
   - worktree：`<worktree-root>/.ypi/sessions/index.v1.json`
   - 不集中保存到 main root，也不把旧 `~/.pi/agent/pi-web-session-index.json` 当主读路径。
2. **真相边界**：JSONL 继续位于 `getAgentDir()/sessions/**`；header仍是project/space/Studio pointer真相；本地index只是候选与摘要加速层。
3. **完整性策略**：热路径读本地index并定向核对space cwd目录；missing/corrupt/partial时执行一次global header-only恢复。无安全结果超10s则可重试失败，禁止返回缺项partial 200。
4. **Studio child**：维持现有nested payload；只在筛选后按unique task批量投影，不再先对全局180 children逐个读取task。
5. **旧sidecar**：只读迁移seed/fallback；本地路径完成后停止新写，不删除旧文件，不长期双写。
6. **Git边界**：仅忽略 `/.ypi/sessions/`；每个runtime index目录自带作用域内 `*` ignore。绝不忽略整个 `.ypi/`。
7. **设置/模型**：Phase 1只消除session扫描造成的间接阻塞；provider/ModelRuntime独立冷启动若仍慢，用基准另开Phase 2。

## 目标

在约300 sessions / 180 Studio children本机fixture：

- 热route：P50 ≤ 500ms、P95 ≤ 1.5s。
- 冷恢复：P95 ≤ 5s、硬预算10s。
- 热路径全局inventory调用为0；Studio task读取次数≤目标space unique task数。
- 索引缺失/损坏不得让session以“空列表/少列表”静默消失。
- 与session请求并发时，设置/模型入口不再增加10s级等待。

## 分批实施

1. **索引基础**：schema、space-root解析、精确ignore、路径安全、锁与原子写。
2. **读取与恢复**：定向cwd扫描、候选校验、摘要复用、legacy global migration、header-only完整恢复。
3. **生命周期**：create/fork/Studio child/rename/archive/unarchive/delete/relink统一维护。
4. **route与Studio**：专用space query、筛选后batch projection、缓存/single-flight/timing。
5. **验证与文档**：完整性/安全/并发fixture、300/180 benchmark、设置/模型并发基准、模块文档。

## UI 原型门禁

本计划不改变页面、交互、加载态或用户可见信息结构，因此**不触发HTML prototype**。若实现中需要新增“索引重建中”、stale/partial列表或改造child展示，必须停止并补UI设计员HTML原型审批。

## 风险与回滚

- 主要风险：索引漏项、cwd alias、跨进程写覆盖、Studio display串run、gitignore误伤。
- 缓解：header真相复核、首次完整恢复、registry pathKey、跨进程锁、逐child派生、精确ignore测试。
- 回滚：route切回现有 `listAllSessions()`；停止index写即可。JSONL从未移动，无数据回滚。

## 审阅材料

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI 门禁结论](./ui.md)
- [Design](./design.md)
- [Implementation Plan](./implement.md)
- [Checks](./checks.md)

## 请求用户确认

请确认以下三点后再进入实现：

1. 接受worktree索引放在**worktree自身根目录**，而不是main项目根目录集中管理。
2. 接受冷恢复完整性优先：没有last-good且10s内无法安全重建时返回可重试错误，不返回可能缺session的partial 200。
3. 接受旧全局sidecar只读迁移并逐步废弃新写。

确认前任务只进入 `awaiting_approval`，不得实现生产代码。
