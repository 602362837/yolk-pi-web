# handoff — OWN-5 完整验证

## 子任务

- **OWN-5**：执行完整验证与双 session 人工验收准备
- **状态**：自动验证全部通过；人工双 session UI 需主会话/用户在真实浏览器中点验（本实现员环境未开两个真实 Chat session）

## 实现范围回顾（OWN-1…OWN-4，已完成）

| 区域 | 文件 | 摘要 |
| --- | --- | --- |
| Ownership 原语 + exclusive bind + mutation guard | `lib/ypi-studio-tasks.ts` | session context 分类、`replaceTaskSessionContext`、`assertTaskBoundToContext`、compare-before-unlink pointer、`bindYpiStudioTaskToContext` exclusive transfer、清跨 session `approvalGrant`、审计 `context_transfer` note；create 仅初始化 owner；其余 mutation 校验 bound |
| API 入口 | `app/api/studio/tasks/[taskKey]/route.ts` | 仍走 `action: "bind"`，shape 不变 |
| 回归测试 | `scripts/test-ypi-studio-session-ownership.mjs`、`package.json` | create→transfer、resolver、pointer、idempotency、lazy repair、approval、mutation guard、concurrency、multi-task |
| 文档 | `docs/architecture/overview.md`、`docs/modules/library.md`、`docs/modules/api.md` | task 单 session owner / session 可多 task；bind exclusive；惰性归一化 |

本 OWN-5 **未改生产代码**，仅验证并交付本 handoff。

## 代码抽查

| 检查 | 结果 |
| --- | --- |
| `rg 'contextIds\.push' lib/ypi-studio-tasks.ts` | **无匹配**（create 用 `contextIds = body.contextId ? [body.contextId] : []`；transfer 用 `replaceTaskSessionContext` 赋值） |
| exclusive bind | `bindYpiStudioTaskToContext` 在 `withTaskMutationLock` 内替换 session-class keys、compare-before-unlink、写新 pointer、清异 context grant、幂等 re-bind 只刷 pointer |
| owner guard | 多处 mutation / approval 调用 `assertTaskBoundToContext` |
| UI  diff | `components/` / `hooks/` 无本任务改动；绑定文案仍为「已绑定到当前聊天…」 |
| 文档 vs 代码 | architecture / library / api 均写明 exclusive write-side + exact-context read + multi-task-per-session |

## 自动验证

| 命令 | 结果 |
| --- | --- |
| `npm run test:studio-session-ownership` | **pass** — `ypi-studio session ownership tests passed` |
| `npm run test:studio-dag` | **pass** — `ypi-studio DAG scheduler tests passed` |
| `npm run lint` | **pass** (exit 0) |
| `node_modules/.bin/tsc --noEmit` | **pass** (exit 0) |

## 人工验收清单（请主会话/用户在 UI 执行）

本环境未启动双 Chat session，以下步骤需人工完成；自动测试已覆盖等价数据面契约。

1. **session1 创建任务 A**  
   - 期望：s1 浮窗出现 A（session-link `tasks[]` 含 A）。
2. **session2 打开 Studio 面板，点现有「绑定/继续」**  
   - 期望：成功文案不变（「已绑定到当前聊天…」）；s2 浮窗有 A；task `contextIds` 仅保留 s2 session-class key（及既有非 session metadata）。
3. **切回 session1，等待 session-task recheck 或刷新**  
   - 期望：A 浮窗消失；transcript 历史提及最多进 diagnostics，不进 `tasks[]`。
4. **awaiting_approval 交接**  
   - 若 A 在 awaiting_approval 且 s1 曾批准：transfer 后 s1 批准无效；s2 必须重新明确批准后才能进入 implementing。
5. **task detail / events**  
   - 期望：transfer note 含 `context_transfer` / `fromContextIds` / `toContextId` / `removedPointerCount` / `approvalGrantCleared`。
6. **archived**  
   - 期望：archived 仍无有效 bind / 接口报错。
7. **无 UI 结构/文案变更**  
   - 已由 diff 确认；若人工看到新确认框/owner 标签/unbind 控件则阻断并退回规划。

## 剩余风险 / 已知窗口

1. **惰性归一化窗口**：存量已累积多 session `contextIds` 的任务，在下一次显式 bind 前仍可能在多个 widget 显示；不做启动/只读自动猜 owner。
2. **刷新时序**：session-task recheck 是 debounced；人工验收时若 s1 浮窗短暂残留，应等待 recheck 或刷新后再判失败。
3. **pointer 非事务**：顺序为写 task.json → 清旧 pointer → 写新 pointer → event；中途失败时 widget 以 `contextIds` 为准，pointer 仅影响 current/diagnostics。
4. **并发 bind**：最后完成的显式 bind 为 owner（lock 内）；自动测试覆盖双并发最终单 owner。
5. **人工 UI 未在本轮执行**：数据面/API 契约已绿；真实双 session 浮窗与审批交接仍建议 checker/用户点验一次。

## 决策 / 主会话后续

- **无需产品决策**：计划已批准语义（仅显式 bind transfer；普通 mutation 不抢占；惰性修正）与代码一致。
- 建议 checker 重点核对：approval grant 跨 session 清除、非 owner mutation 拒绝、multi-task-per-session 未回归。
- 可标记 OWN-5 / 任务实现阶段完成（待人工 UI 点验可记为 residual risk，非自动验证 blocker）。
