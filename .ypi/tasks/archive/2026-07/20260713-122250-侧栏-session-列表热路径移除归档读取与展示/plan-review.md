# 侧栏 session 归档热路径剥离计划审批书

## 当前结论

规划与 UI HTML 原型均已就绪，现进入 **`awaiting_approval`**，请你审批本计划与原型。  
**未获明确批准前不得进入实现，不得派发 implementer。**

## 计划摘要

- **PRD**：侧栏高频路径只处理 active sessions；彻底移除侧栏归档计数、列表和恢复入口，但保留归档存储、写 API、显式 archived API、按 id 详情及 Usage includeArchived。
- **UI**：active session 树和归档按钮保持；列表末尾不再有归档区块；空态只看 active；archive-all 确认数只计算本次 active sessions。
- **Design**：project-space route 删除 `scanArchivedCwds()` 和 `archivedCounts`；global `/api/sessions` 删除当前仓库无人消费的 archive 字段/扫描；Sidebar 删除全部 archived state/loader/effect/component。
- **Implement**：原型审批后，API 与 Sidebar 按 DAG 分块执行，再更新文档、验证和独立检查；**不重构** active scan/index。
- **Checks**：lint/typecheck、目标符号检索、API shape、浏览器 Network、归档动作、显式 archive/详情/Usage 回归。

## 审批边界

批准本计划意味着接受：

1. 侧栏不再提供任何归档浏览或恢复入口，也不新增替代入口。
2. project-space active list 响应删除 `archivedCounts`，不保留空兼容字段。
3. global `/api/sessions` 收敛为 `{ sessions }`；仓内 `ypic` 兼容，但未记录外部客户端若依赖 `archivedCwds`/`archivedCounts` 会受影响。
4. 该变更只移除确定的 archive I/O；active `listAllSessions()` 全局扫描仍存在，**不承诺**解决全部列表长尾。

## 相关材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 说明](ui.md)
- [Technical Design](design.md)
- [Implementation Plan](implement.md)
- [Checks](checks.md)
- [HTML 原型：session-sidebar-without-archive-prototype.html](session-sidebar-without-archive-prototype.html)

## 原型覆盖

- 正常 active 列表 + 无归档区块
- active 空态（不暴露归档入口）
- 单个/批量归档后只刷新 active
- archive-all 仅计当前 active 数量
- 浅色/深色与窄侧栏

## 审批状态

- PRD / Design / Implement / Checks：已完成
- UI HTML 原型：已交付
- 用户审批：等待中
- 实现许可：未授予
