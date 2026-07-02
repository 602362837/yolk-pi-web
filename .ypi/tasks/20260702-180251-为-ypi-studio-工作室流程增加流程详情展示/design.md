# Design

## 数据设计

复用现有 `YpiStudioWorkflow`：`states`、`transitions`、`owner`、`requiresSubagent`、`requiresUserApproval`、`requiredArtifacts`、`optionalArtifacts` 已足够展示流程详情。

新增纯派生 helper：

- `orderYpiStudioWorkflowStates(workflow, currentStatus?)`：从 `initialStatus` 沿主路径排序，防循环，必要时插入当前状态或按 progress 降级。
- `getYpiStudioWorkflowBranchTransitions(workflow, orderedStates)`：把非主路径 transition 作为分支/例外流展示。

## UI 设计

- Workflows tab：列表卡片点击进入详情页，顶部返回按钮。
- Workflow detail：头部 + 主路径流程图 + 触发方式 + 分支与例外流 + 元数据。
- 节点卡片显示：状态 label/id、progress、owner、委派说明、审批说明、必需/可选产物、instruction。
- Task detail overview：新增当前任务流程区块，按同一 helper 展示并高亮当前状态。

## 降级

- workflow 读取失败：显示已有 readError，不阻塞列表。
- 找不到任务对应 workflow：任务详情显示提示，不影响其他 tab。
- 自定义循环/复杂分支：主路径用 visited set 防死循环，其他 transition 进入分支列表。
