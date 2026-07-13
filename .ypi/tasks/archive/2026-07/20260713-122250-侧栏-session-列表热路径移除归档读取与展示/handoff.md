# Handoff

## 已完成

architect 已完成只读调研和规划产物：

- [`brief.md`](brief.md)：根因、范围、UI 阻塞与诚实性能边界。
- [`prd.md`](prd.md)：需求、非目标和验收标准。
- [`ui.md`](ui.md)：强制 UI 门禁与 UI designer HTML 任务单。
- [`design.md`](design.md)：API/Sidebar 数据流、契约、兼容性、风险与回滚。
- [`implement.md`](implement.md)：7 项 DAG 和机器可读 `ypi-implementation-plan`。
- [`checks.md`](checks.md)：静态、API、浏览器和归档能力回归检查。
- [`plan-review.md`](plan-review.md)：用户审批入口（当前明确标记 UI 阻塞）。

未修改生产代码，未 commit/push/merge。

## 关键决策

- project-space route 删除 archive scan 与 `archivedCounts`，不保留空字段。
- Sidebar 删除整个 archived projection，归档成功只刷新 active。
- archive-all 确认只计 active sessions。
- 推荐 global `/api/sessions` 同步删除仓内无人消费的 `archivedCwds`/`archivedCounts`；`ypic` 只读 `sessions`。
- 保留 archive 存储/API/详情/Usage；保留 `lib/session-reader.ts` archive helpers。
- 不触碰 active 全量扫描/index 重构。

## 验证

仅对规划 artifacts 做结构检查；未运行 lint/typecheck，因为没有生产代码改动。implementationPlan JSON 仍需主会话解析/保存。

## 阻塞与下一步

当前子会话没有 Studio 成员派发/任务 transition 工具，且不能用普通 subagent 冒充 UI designer。因此未生成合规 HTML 原型、未保存 implementationPlan、未 transition 到 planning/awaiting_approval。

主会话必须：

1. 先将 task 从 intake transition 到 planning（`brief.md` 已完成）。
2. 派发 `ui-designer` 按 [`ui.md`](ui.md) 创建 `session-sidebar-without-archive-prototype.html` 并更新链接。
3. 审阅并保存 [`implement.md`](implement.md) 中 implementationPlan。
4. 更新 [`plan-review.md`](plan-review.md) 原型链接后 transition 到 `awaiting_approval`。
5. 请求用户明确审批并停止；不要派 implementer。

## 剩余风险/需主会话决定

唯一需显式确认的兼容性点：是否接受 global `/api/sessions` 删除 archive 字段。推荐接受；若为未知外部客户端保守兼容，可暂时保留 global route 字段，但 project-space Sidebar 热路径必须删除。
