# Design：YPI Studio 浮窗用户决策 CTA（Phase 1）

## 方案摘要

新增一个**服务端投影驱动、显式 action 执行、revision/context 绑定**的决策层：

```text
Task state + workflow + approval evidence
  -> lib/ypi-studio-session-link.ts projects bounded userActions[]
  -> YpiStudioSessionWidget renders only projected actions
  -> user confirms / enters required feedback
  -> PATCH /api/studio/tasks/[taskKey] with explicit action + expectedRevision + contextId
  -> lib/ypi-studio-tasks.ts validates and atomically records intent + transition
  -> refresh widget/drawer; best-effort orchestrator continuation
```

前端不根据 status 生成批准按钮；预览 API 与 document/modal 继续 GET-only。

## 类型与投影契约

在 `lib/ypi-studio-types.ts` 增加：

```ts
type YpiStudioWidgetUserActionKind =
  | "approve_plan"
  | "request_plan_changes"
  | "approve_improvement_plan";

type YpiStudioWidgetUserActionRole = "primary" | "secondary";

interface YpiStudioWidgetUserAction {
  id: string; // stable: main:approve:rN / improvement:<id>:approve:rN
  kind: YpiStudioWidgetUserActionKind;
  label: string;
  role: YpiStudioWidgetUserActionRole;
  requiresConfirmation: true;
  expectedRevision: number;
  improvementId?: string;
  displayId?: string;
  targetLabel: string; // bounded display copy, never feedback/body/path
}
```

`YpiStudioTaskWidgetProjection.userActions?: YpiStudioWidgetUserAction[]` 为 additive/sparse 字段，最大长度 2。确认对话框模板由前端按 `kind` 固定映射，服务端不下发 HTML/任意 message/endpoint，避免把投影变成远程 UI 执行协议。

### 投影规则

- archived/terminal：空。
- `status === awaiting_approval`：`approve_plan` primary + `request_plan_changes` secondary，revision 为 `meta.planRevision ?? 1`。
- 主任务 `waiting_for_improvements`：按实例顺序找到第一个 `waiting_plan_approval`，只投影该实例 `approve_improvement_plan`，revision 为 `instance.approval?.revision ?? 1`。
- 其他状态：空。
- action 可见性只表示“当前投影可尝试”，真正授权仍由写路径重验。

## 审批 grant 兼容设计

### 主任务

`YpiStudioApprovalGrant.source` 从单值扩展为：

```ts
source: "user-input" | "user-widget"
```

保留 `inputHash` 字段用于 wire/on-disk 兼容；widget action 对固定 canonical intent（task id + action + revision + context）计算 hash。`isApprovalGrant`、`hasRecordedApprovalGrant` 与硬 gate 接受两个 allowlist source；未知 source 仍拒绝。

### 改进项

`instance.approval` 增加可选 `source?: "user-input" | "user-widget"`。旧记录无 source 继续按历史显式聊天批准读取；新 widget 批准写 `user-widget`。revision/context/inputHash 语义不变。

不迁移历史 task.json；读取兼容，首次新 action 才写新增字段。

## 显式写 action

在 route 的通用 transition 分支之前匹配固定 body：

```ts
{ cwd, action: "approve_plan", contextId, expectedRevision }
{ cwd, action: "request_plan_changes", contextId, expectedRevision, feedback }
{ cwd, action: "approve_improvement_plan", contextId, expectedRevision, improvementId }
```

分别调用新的 library helper；route 只负责 cwd 授权、body dispatch、错误到 HTTP 状态映射和 best-effort continuation，不复制状态机逻辑。

### `approveYpiStudioPlanFromWidget`

在单个 `withTaskMutationLock` 中：

1. active/non-archived、状态必须为 `awaiting_approval`。
2. `assertTaskBoundToContext`；context 必须为 session-class `pi_<sessionId>`。
3. `expectedRevision === meta.planRevision ?? 1`。
4. 重验 meaningful `plan-review.md` 与现有 UI evidence gate。
5. 创建时间严格晚于 approval gate 的 `user-widget` grant。
6. 重用/抽取 transition 内核进入 `implementing`，不通过嵌套调用两个会再次取锁的 public helper。
7. 一次写 task.json；events 追加一条 user decision note 和一条 transition（或一条带完整 data 的结构化 transition，具体按现有 event consumer 最小变更决定）。

任何步骤失败均不写 grant/transition。`override` 参数不在 action body 中，也不能参与。

### `requestYpiStudioPlanChangesFromWidget`

同一任务锁内校验 active/binding/status/revision；规范化 feedback（trim、非空、长度上限建议 2000）；状态回到 `planning`，清 grant、revision + 1、currentMember=architect，审计 `source=user-widget` 与反馈。此 helper 是合法的专用回退边，不依赖客户端传 `override`，也不放宽其他 transition。

### `approveYpiStudioImprovementPlanFromWidget`

同一父任务锁内校验：

- parent active 且 `status === waiting_for_improvements`；
- improvement belongs to parent，状态严格为 `waiting_plan_approval`；
- bound context 与 expected revision 匹配；
- meaningful instance plan-review、需要 UI 时存在 instance-root HTML；
- grant + `waiting_plan_approval -> implementing` 在一次锁/一次 task 写内完成；主任务状态不变；
- instance approval 写 `source=user-widget`，event data 包含 improvementId/displayId/revision/context。

不得调用 main plan/progress，后续 continuation 必须带 improvementId。

## HTTP 与并发语义

建议新增受控错误类/错误码：

- 400：body/feedback/context shape 非法；
- 403：cwd 未授权；
- 404：task/improvement 不存在；
- 409：状态、revision、binding 或并发冲突；
- 422：审批材料/HTML gate 不完整；
- 500：未分类内部失败，返回安全文本。

即使 route 暂不一次性重构全部旧错误，本期三个 action 应稳定返回 `{ error, code, task? }`；冲突后客户端调用 `onTaskChanged` 拉取权威投影。

前端保留现有 `acceptingInFlightRef`，扩展为统一 `decisionInFlightRef`/key，串行所有 widget write（新决策 + 既有验收）。按钮不做状态乐观更新。

## 续推与数据流

### 主计划批准

批准 action 成功后任务已有 implementationPlan/progress 时，widget refresh 会触发 `GET /api/sessions/[id]/studio-task`；现有 primary implementing autocontinue 观察 ready + free slots 并唤醒主会话。若无 ready 子任务，状态仍合法，UI 给出“计划已批准，等待编排/请查看详情”的安全反馈。

### 改进计划批准

补齐 improvement-scoped autocontinue：session projection/route从第一项 implementing improvement 的 instance progress 计算 ready/slots，向 RPC 发送带 `improvementId` 的 `studio_autocontinue`（或等价固定 command）。`rpc-manager` 的 follow-up prompt 必须明确调用 improvement-scoped `implementation_next` / `claim_improvement_subtask`，不得 claim main DAG。

### 需要修改

action 成功后 route 最佳努力向 `pi_<sessionId>` 对应 wrapper 发送固定 `studio_user_action` continuation，包含 task id、action 和服务端已落库的 bounded feedback；主会话据此重新派 architect。wrapper 不存在/忙碌重试耗尽时，任务仍安全停在 planning，UI提示用户可在绑定聊天继续。不要因为 continuation 失败回滚用户决定。

## UI 边界

- `components/YpiStudioSessionWidget.tsx` 只 switch 固定 `action.kind`，用 `usePrompt.confirm` / `prompt` 呈现本地模板。
- `TaskCard` 在 **quick preview 之后** 渲染独立 decision region；不把 action 放进 quick preview button 或 modal。
- **Additive only**：不得删除/折叠/合并现有改进摘要、改进结果验收列表、主任务验收块、归档徽章、runtime 行、子任务时间线、live run 摘要、WorkflowRail、详情按钮。
- 信息层级固定为：壳层/rail → 改进摘要+结果验收 → 主验收 → 归档徽章 → 只读资料 → **新增决策区** → runtime/实现进度。决策区是插入层，不是替换层。
- 既有验收写路径（`transition_improvement→accepted`、`to:completed`、可选 `archive`）继续走现有 handler；新决策写路径走 `approve_*` / `request_plan_changes`；共用 in-flight 锁，但 handler 逻辑不互相吞并。
- `components/YpiStudioPanel.tsx` 本期不新增写入口；可选择只显示相同“可在会话浮窗决策”的说明，避免双实现。
- `app/globals.css` 增加决策区、主次按钮、busy/focus/mobile/reduced-motion；不继续扩大 inline style，也不重写现有 accept/preview 类的语义。

## 现有能力映射（实现时对照表）

| 现有能力 | 代码锚点（当前） | 本任务要求 |
| --- | --- | --- |
| 只读计划/原型 | `quickPreviewActionsForTask` + plan-action-row | 保留；状态词与打开链路不变 |
| 改进摘要 | `task.improvements` 橙块 | 保留 blocker/nextAction |
| 改进结果验收 | `acceptableImprovementsForTask` + accept list | 保留；文案继续标明“结果验收” |
| 主任务验收/归档 | `showMainTaskAccept` + `handleAcceptMainTask` | 保留 completed + 确认并归档 |
| review_ready 提示 | reaccept notice | 保留 |
| runtime/子任务/runs | `sessionRuntime` / compact timeline / mergeRuns | 保留 |
| WorkflowRail / 详情 | `WorkflowRail` + `WORKFLOW_RAIL_STAGES`（8 站）/ detail button | 保留完整 8 站 2×4；禁止压成 4 站示意 |
| 写锁/刷新 | acceptingInFlight + onTaskChanged | 扩展覆盖新 CTA，不换掉旧验收 |
| 聊天批准 | extension `user-input` grant | 保留并行路径 |
| **新**计划决策 | `userActions` decision region | 仅此为新增主交付 |

## 安全不变量

1. 只接受当前 task 的唯一绑定 session context；transfer 后旧 context action 立即冲突。
2. revision 由服务端重算，客户端 expectedRevision 仅作 compare-and-set，不是权限来源。
3. `override` 不能出现在三个 action contract，也不能绕过审批。
4. grant 落库且来源可审计；preview GET 永不写 grant。
5. prototype 路径 resolver、CSP sandbox 与 scheme/absolute/`..`/symlink 规则不变。
6. action projection 不携带任意 method/url/body，前端不能执行未知 action。
7. plan-review modal/document page 保持只读。

## 兼容性、迁移与回滚

- 类型和投影 additive；旧客户端忽略 `userActions`。
- 历史 `source=user-input` 与 improvement approval 无 source 保持有效；不批量改写 task.json/events。
- 回滚优先停止投影 `userActions`，前端按钮自然消失；保留已经产生的 `user-widget` grant 读取兼容，否则会把合法已批准任务误判为无批准。
- 如续推异常，可单独关闭新 continuation 分支；用户决定和任务状态仍可从 Chat/Panel恢复。

## 风险与缓解

- **双步批准部分成功**：用单锁原子 helper，不从 route 连续调用“record + transition”。
- **旧卡批准新 revision**：expectedRevision CAS + 409 + refresh。
- **错改进 DAG**：action 强制 improvementId，continuation prompt 与 claim API保持 instance scope。
- **按钮墙**：`userActions` 最多 2 项，只选择第一个等待**计划批准**的改进；**不得**借此删除多条 `waiting_user_acceptance` 结果验收按钮。
- **批准后主会话未运行**：现有/新增 autocontinue 最佳努力，失败可恢复且明确提示。
- **前端重新猜状态**：测试禁止 status-to-action helper 出现在 component；action 只从 projection 来。
- **实现时误删现有区块（用户明确风险）**：PRD 保全清单 A–F 为硬门禁；CTA-WIDGET-04 / CTA-VERIFY-05 必须对照现卡做 diff 级回归；原型补充“改进结果验收 / 主任务验收”场景，禁止只演示新决策区。
