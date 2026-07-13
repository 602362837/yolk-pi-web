# Summary

侧栏 archive 热路径剥离的 PRD、UI 门禁、Design、Implementation Plan、Checks 和计划审批书已完成，未修改生产代码。

方案：project-space active list 不再扫描 archive/返回 `archivedCounts`；Sidebar 不再展示或请求归档列表；归档动作成功只刷新 active；归档存储、API、详情和 Usage 保留。推荐一并移除 global `/api/sessions` 中仓内无人消费的 archive 字段/扫描。active 全量扫描重构不在范围。

当前阻塞是 UI 原型硬门禁：architect 子会话无 Studio 派发工具，需主会话派发 `ui-designer` 生成 `session-sidebar-without-archive-prototype.html`。原型与计划未获用户审批前，不得进入实现。
