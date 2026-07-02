# brief

## 目标

为 YPI Studio 的“流程”增加可读的流程详情展示，体验参考现有任务详情：用户能在工作室面板中点开某个流程，看到该流程的阶段图、触发方式、每个节点的负责人/是否需要委派、必需产物、审批与分支；并在任务详情中看清当前任务对应的流程路线与当前节点。

## 现状

- `components/YpiStudioPanel.tsx`
  - 已有 `members / workflows / tasks` 三个 tab。
  - `TasksTab` 已支持“列表 -> 任务详情”的二级详情页，详情页含概览、产物、成员运行、事件、元数据。
  - `WorkflowsTab` 目前只有 workflow card 列表；`WorkflowCard` 只展示名称、描述、JSON 路径、状态 chip（按 progress 排序）和触发词，没有详情页、流程图、分支/委派解释。
- `lib/ypi-studio-workflows.ts`
  - `.ypi/workflows/*.json` 已是结构化状态机：`initialStatus`、`terminalStatuses`、`states`、`transitions`、`triggers`。
  - `YpiStudioWorkflowState` 已包含 `owner`、`progress`、`instruction`、`requiredArtifacts`、`optionalArtifacts`、`requiresSubagent`、`requiresUserApproval`。
  - 默认流程已经能表达“节点会委派给谁”：默认 `architect / implementer / checker` 节点设置了 `requiresSubagent: true`，`main` 节点表示主会话编排或用户确认。
- `lib/ypi-studio-types.ts`
  - Workflow wire type 已覆盖渲染详情所需的核心字段；Task detail 当前只含 `workflowId/workflowName/progress`，不含完整 workflow 对象。
- `app/api/studio/workflows/route.ts`
  - `GET /api/studio/workflows?cwd=` 已一次性返回所有 workflow 文件和完整 states/transitions。
  - 目前不需要单独详情 API；前端可基于已加载的 list response 打开详情。
- 相关可复用线索
  - `lib/ypi-studio-session-link.ts` 内部已有 `orderedWorkflowStates()` 用于将 workflow 转成 session widget 的 happy path steps。
  - `components/YpiStudioSessionWidget.tsx` 内部已有蛇形 flow-line 布局，但它是 widget 小卡布局，不能直接满足详情页信息密度。

## 数据结构是否需扩展

MVP 不需要扩展持久化数据结构，也不需要迁移 `.ypi/workflows/*.json` 或 `task.json`。

建议做两类“派生展示结构”而非持久字段：

1. 在 `lib/ypi-studio-workflows.ts` 导出纯函数，例如：
   - `orderYpiStudioWorkflowStates(workflow, currentStatus?)`：按初始状态和主路径 transitions 得到展示顺序；遇到自定义分支/循环用 visited set 防死循环；当前异常状态不在主路径时插入展示。
   - 可选 `buildYpiStudioWorkflowFlow(workflow, currentStatus?)`：返回 nodes/edges/branchTransitions，供面板和 session widget 共享。
2. 若需要强类型，可在 `lib/ypi-studio-types.ts` 增加非持久化 view types（例如 `YpiStudioWorkflowFlowStep` / `YpiStudioWorkflowFlowTransition`）。不要改变 `schemaVersion: 1` JSON 契约。

不建议为 MVP 扩展 `/api/studio/workflows` 响应字段或新增 `GET /api/studio/workflows/[id]`，因为现有响应已有完整数据；除非主会话明确要支持 URL 深链/懒加载单个大 workflow。

## UI 方案

### Workflows tab：列表 -> 流程详情

参考 `TasksTab` 的二级详情模式：

- workflow 列表保持 card 形式；点击 card 进入 `WorkflowDetailPanel`，顶部有“← 返回流程列表”。
- 详情头部展示：流程名、id、描述、`pathLabel`、初始状态、终止状态、修改时间、打开 JSON 按钮、readError notice。
- 子区块建议：
  1. **流程图**：按主路径展示节点连接线。每个节点显示：阶段 label/id、进度、负责人、是否“委派给 {owner}”、是否“主会话处理”、是否“需用户确认”、必需/可选产物、instruction 摘要。
  2. **触发方式**：slash triggers 与 natural triggers。
  3. **分支与例外流**：展示未进入主路径的 transitions，如 `checking -> changes_requested`、blocked/cancelled、override transitions、archived；避免用户误以为只有一条线。
  4. **状态清单/原始元数据**：状态数、transition 数，必要时折叠 JSON 摘要。
- 右侧 drawer 宽度有限，流程图应优先采用纵向/蛇形、可滚动布局；不要依赖超宽横向 DAG。

### Task detail：增加“当前任务流程”区块

为了满足“对应任务应该走什么流程”，建议在 `TaskOverviewTab` 里增加一个 `TaskWorkflowFlowSection`：

- 从 `task.workflowId` 在已加载的 `workflowsData.workflows` 中找到 workflow。
- 高亮当前 `task.status`：已过节点 done、当前 active、后续 pending。
- 当前节点展示 owner、是否需委派、缺失产物、审批要求。
- 当 workflow 未加载或 readError 时，显示 fallback notice，不阻塞任务详情其他 tab。

## 关键代码改动点

- `lib/ypi-studio-workflows.ts`
  - 抽出/导出 workflow 主路径排序 helper；可迁移 `lib/ypi-studio-session-link.ts` 里的 `orderedWorkflowStates()`，避免同一排序规则在多个地方分叉。
  - 对自定义 workflow 做防御：循环、缺失初始状态、分支、多终态时安全降级。
- `lib/ypi-studio-session-link.ts`
  - 改用导出的排序 helper，保持 session widget 现有行为不变。
- `lib/ypi-studio-types.ts`
  - 可选新增展示 projection 类型；不改持久 schema。
- `components/YpiStudioPanel.tsx`
  - `WorkflowsTab` 增加 `detailWorkflowKey` state，与 `TasksTab` 的 `detailTaskKey` 模式一致。
  - 新增 `WorkflowDetailPanel`、`WorkflowFlowView`、`WorkflowStateNode`、`WorkflowTransitionsSection` 等组件；若文件继续膨胀，优先拆到 `components/YpiStudioWorkflowDetail.tsx`。
  - 将 `workflowsData` 传入 `TasksTab -> TaskDetailPanel -> TaskOverviewTab`，在任务概览展示当前任务流程。
  - `WorkflowCard` 点击进入详情；“打开”按钮继续 `stopPropagation()` 打开 JSON 文件。
- `app/api/studio/workflows/route.ts`
  - MVP 无需修改；仅当决定新增单流程详情 API/深链时再改。
- 文档
  - 如新增组件或 helper，更新 `docs/modules/frontend.md` / `docs/modules/library.md` 中 YPI Studio 相关条目。

## 风险与缓解

- **自定义 workflow 分支/循环复杂**：详情页显示“主路径 + 分支/例外流”，排序 helper 使用 visited set；无法排序时按 progress fallback。
- **委派语义误导**：推荐只在 `requiresSubagent` 为 true 时写“委派给 {owner}”；否则写“负责人 {owner} / 主会话处理”。不要仅凭 owner 非 main 推断强制委派。
- **任务详情依赖 workflowsData**：加载失败时显示 notice，不影响任务产物/成员运行查看。
- **组件过大**：`YpiStudioPanel.tsx` 已接近 900 行；实现时优先拆出 workflow 详情组件，降低评审风险。
- **视觉拥挤**：右 drawer 下采用纵向卡片/蛇形 flow；节点详情可折叠或用小字摘要。
- **回归 session widget**：若迁移排序 helper，需确认 widget flow 顺序不变。

## 验证建议

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

手工验收：

1. 初始化工作室后打开 Workflows tab，默认四个流程均可点进详情并返回列表。
2. `feature-dev` 详情主路径显示接单 -> 设计 -> 等待确认 -> 制作 -> 检查 -> 待收尾 -> 完成，并在对应节点显示 architect / implementer / checker 委派信息。
3. 分支区能看到 changes_requested、blocked、cancelled、archived 等例外流。
4. `ui-change` 能显示 `ui.md` 相关必需产物；`review-only` 能从 checking 开始展示。
5. 打开一个现有任务详情，概览页能显示该任务 workflow，当前 status 高亮，负责人/委派对象清晰。
6. 自定义/损坏 workflow JSON 保持 readError notice，不导致整个工作室面板崩溃。
7. 窄宽度 drawer 下流程详情可滚动、按钮可点击，打开文件行为不受 card 点击影响。

## 需要主会话确认的决策

1. 是否确认范围包含“任务详情中的流程区块”？我建议包含，否则用户仍需从任务跳到流程 tab 才知道该任务怎么走。
2. 是否需要 workflow 详情 deep link/URL 状态？MVP 建议不要做。
3. 流程图是否要求完整 DAG 可视化？MVP 建议主路径图 + 分支列表，复杂自定义流程后续再做 DAG。 
