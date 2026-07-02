# Implement

## 改动点

1. `lib/ypi-studio-workflows.ts`
   - 导出工作流状态排序 helper。
   - 导出分支 transition helper。
2. `lib/ypi-studio-session-link.ts`
   - 移除本地排序逻辑，改用共享 helper。
3. `components/YpiStudioWorkflowDetail.tsx`
   - 新增流程详情组件与任务流程区块复用组件。
4. `components/YpiStudioPanel.tsx`
   - Workflows tab 支持详情模式。
   - Task detail overview 接收 workflows 并展示当前任务流程。
5. `docs/modules/frontend.md`、`docs/modules/library.md`
   - 更新模块说明。

## 验收重点

- 工作流卡片可点击进入详情并返回。
- feature-dev 主路径、委派对象、审批节点清晰展示。
- 任务详情高亮当前流程节点。
- lint/tsc 通过。
