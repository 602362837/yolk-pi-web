# brief

## 用户问题

优化 YPI Studio 多子任务编排与任务详情展示：

1. 架构师拆解子代理任务时，必须明确串行/并行关系，并形成结构化规定。
2. 任务详情中的流程路线需要体现多任务串并行关系。
3. 多任务实现 tab 需要二级 tab，只显示选中的子任务；同时修复进度刷新问题。
4. 未完成任务的二级 tab/文件名解析存在 `.md` 重复拼接问题，例如 `prd pro.md` 又被拼成 `prd pro.md.md`。
5. 工作室抽屉自动刷新时不要额外出现刷新提示行，避免阅读时布局跳动。

## 约束

- 保持 awaiting_approval -> implementing 的 approvalGrant 硬门禁。
- 设计完成后停在 awaiting_approval，等待用户确认后才能实现。
- 兼容已有 implementationPlan，没有结构化依赖字段的旧任务仍可展示与执行。
