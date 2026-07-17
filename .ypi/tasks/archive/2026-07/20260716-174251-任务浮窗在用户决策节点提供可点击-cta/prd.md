# PRD：YPI Studio 浮窗用户决策 CTA（Phase 1）

## 目标与背景

用户当前可在浮窗中看到计划、原型和状态，但在主计划批准、请求修改、改进计划批准等关键节点仍需回到聊天手工输入。目标是让浮窗在**真正的用户决策点**提供明确 CTA，同时保持服务端状态机、session 绑定、revision 和审计记录为唯一权威。

## 用户价值

- 在看到任务状态与只读材料的同一任务卡上完成决策，不再寻找聊天输入口并记忆确认文案。
- 明确区分“查看材料”和“作出决定”，降低误把预览当批准的风险。
- 通过确认对象、revision、结果说明和可审计来源，降低批准错任务、错改进项、旧版本计划的风险。

## 范围内（Phase 1）

### 1. 主计划批准

当且仅当服务端为当前绑定任务投影 `approve_plan`：

- 浮窗显示主 CTA「批准并开始实现」。
- 点击先打开确认对话框，明确任务标题、当前 revision、将从 `awaiting_approval` 进入 `implementing`，并说明会继续既有 Studio 编排。
- 确认后调用显式 action；服务端在同一任务锁内校验 binding、状态、revision、`plan-review.md` 门禁，写 `user-widget` grant 并进入 `implementing`。
- 失败或陈旧响应不乐观改变 UI；刷新服务端投影并显示安全错误。

### 2. 主计划需要修改

当且仅当服务端为当前绑定任务投影 `request_plan_changes`：

- 浮窗显示次 CTA「需要修改」。
- 点击打开必填单值输入框，要求说明需要调整的内容；取消或空文本不写入。
- 服务端校验 binding、状态和 revision 后退回 `planning`，清除旧 grant、提升 revision，并将修改说明写入审计事件。
- 最佳努力唤醒绑定主会话继续规划；唤醒失败不回滚已安全落库的“退回设计”决定，并给出可恢复提示。

### 3. 改进计划批准

当第一个未解决改进项处于 `waiting_plan_approval` 且服务端确认其材料门禁可决策时：

- 浮窗显示主 CTA「批准该改进计划」，并展示 `displayId`、标题与 revision。
- 确认框明确这是**改进计划批准**，不是改进结果验收或主任务验收。
- 服务端在同一父任务锁内校验 task ownership、binding、改进状态、revision、计划审批书和 UI 原型证据，写 `user-widget` approval 并进入该改进项 `implementing`。
- 最佳努力续推绑定主会话按 instance DAG 派发后续工作；不得误 claim 主任务 DAG。

### 4. 服务端动作投影

- `YpiStudioTaskWidgetProjection` 增加稀疏、向后兼容的 `userActions?: YpiStudioWidgetUserAction[]`。
- action 为固定 enum 描述符，不携带任意 URL、任意 PATCH body、材料正文、feedback、transcript 或路径。
- 描述符至少含稳定 `id`、`kind`、`label`、`role`（primary/secondary）、`requiresConfirmation`、`expectedRevision`；改进 action 必须含 `improvementId` / `displayId`。
- 每个任务卡最多 2 项；前端只渲染服务端 action，不从 `status` 自行生成批准按钮。

## 范围外（= 本期不新增；≠ 删除现有能力）

以下是 **Phase 2/3 才新增** 的能力。**不得**把“范围外”解释成“实现时可删掉现有浮窗区块/按钮/API”：

- planning / implementing / checking 的“继续”按钮（本期不新增伪继续）。
- 用户验收时**新建**改进反馈入口、失败/取消改进的“接受不处理”、completed 卡上**独立**归档 CTA（主验收对话框里已有的“确认并归档”必须保留）。
- blocked、waiting_clarification、subagent waiting_for_user 的自动决策/聚焦聊天弱动作。
- `YpiStudioPanel` 的完整写操作对齐（本期仅允许共享类型/展示文案的必要兼容，不新增另一套决策实现）。
- 在计划预览 modal、文档页或 HTML sandbox 内放批准控件。
- 修改 task-local preview API 的只读语义或放宽路径安全规则。

## 现有能力保全清单（回归不变量 · 硬约束）

本任务是 **additive（叠加）**，不是重写浮窗。实现员/检查员必须按下列清单回归；任一缺失视为失败，不得以“Phase 1 范围小”为由移除。

### A. 任务卡壳层与导航（始终保留）

1. 多任务绑定列表、primary 任务强调、桌面可拖浮窗、移动 bottom sheet。
2. 顶栏：`Studio · {workflowName}`、进度 `%`、详情 `→`（`onOpenTask`）。
3. 标题、状态色/文案（含 `waiting_for_improvements` →「等待改进完成」）、`currentMember`、产物计数、子任务完成计数。
4. **`WorkflowRail` 必须保持完整 8 站**（与 `WORKFLOW_RAIL_STAGES` 一致，不可压成 4 站示意）：
   `Brief → Design → Implement → Checks → Review → User Acc. → Completed → Archived`。
   360px 卡内使用现有 `is-eight-station` 两行 4 列布局、attention/halo/flow 与状态映射；不因新增决策区改坏或删站。
5. 页脚文案：仅展示绑定当前会话的 Task。

### B. 只读资料 / 预览（始终保留）

6. `quickPreviews` 驱动的计划审批书 / HTML 原型 / 改进计划入口（`↗` + 状态词：待审批/已批准/需重审/只读）。
7. 打开方式：计划 → 只读文档页/预览链路；原型 → files `mode=preview` 新标签；**永不写 grant**。
8. `YpiStudioPlanReviewModal` / `YpiStudioTaskDocumentView` 无批准控件、无 PATCH。
9. 改进资料必须带明确 `improvementId`，禁止串读。

### C. 改进流 UI 与写操作（始终保留）

10. 改进摘要块：`待处理改进 N 项`、`blocker`、`nextAction`（有 unresolved 时显示）。
11. 改进结果验收：仅 `waiting_user_acceptance` 显示「确认该改进任务已完成」；确认框强调**结果验收 ≠ 计划批准**。
12. PATCH `transition_improvement → accepted` + contextId；成功/失败均 `onTaskChanged` 刷新；无乐观完成。
13. 全部改进解决且 parent 回到 `review` + `review_ready` 时，保留现有“请求主任务再验收”衔接（含自动进入 `user_acceptance` 的 widget 路径）。
14. `review_ready` 且尚未可点主验收时的提示：「✓ 改进已完成，主任务需要再次验收」不得丢失。

### D. 主任务结果验收（始终保留）

15. `canAcceptMain` / `user_acceptance` 且无 unresolved 时显示「确认主任务已验收完成」。
16. 确认选择：普通 completed / **确认并归档**（二次 archive PATCH）；未绑定 context 报错。
17. 归档只读徽章「▣ 已归档 · 只读」；归档后无写按钮。

### E. 运行时与实现进度（始终保留）

18. `sessionRuntime` 行（含 `waiting_for_studio_children` pulse 文案）。
19. 实现计数摘要、compact 子任务时间线（最多 3）、最近 subagent runs / liveOverlays 合并展示。
20. 球 urgency：`needs_user` / `failed` / `running` 等与 attention 视觉。

### F. 写入与安全骨架（始终保留并扩展，不替换）

21. 全卡单一 in-flight 写锁：新决策 CTA 与现有验收按钮共用，禁止并行双写。
22. 必须 `cwd` + 绑定 `contextId`；失败 toast + 刷新；禁止乐观状态机迁移。
23. 聊天路径 `user-input` 批准与 regex 门禁继续可用；本任务仅**新增** `user-widget`，不删除旧路径。

### 信息层级（实现时顺序，禁止拆掉旧区块）

```text
顶栏/标题/rail/元信息
→ 改进摘要 +（若有）改进结果验收按钮
→（若有）主任务结果验收区块
→ 归档徽章
→ 只读资料区 quickPreviews
→ 【本期新增】用户决策区 userActions（计划批准/需要修改/改进计划批准）
→ runtime / 子任务 / 最近运行
```

决策区是新增一层，**插在资料区之后**；不得用决策区替换验收区或资料区。

## 功能验收标准

1. `awaiting_approval` 的绑定、非归档任务卡只显示一主一次：批准与需要修改；其他普通阶段不显示计划决策 CTA。
2. 按批准确认后，服务端产生 `source: user-widget` 的 revision/context 绑定 grant，原子进入 `implementing`；`override` 仍不能替代 grant。
3. 需要修改必须提交非空反馈，成功后任务为 `planning`，旧 grant 清除、revision 增加、事件可审计。
4. `waiting_plan_approval` 改进项只批准明确的 `improvementId` 和当前 revision；成功后该实例进入 `implementing`，主任务保持 `waiting_for_improvements`。
5. 旧 revision、错 context、未绑定、状态变化、归档、缺审批书、缺所需 HTML 原型均被服务端拒绝；前端刷新并显示错误。
6. 快速预览仍为 GET-only；打开/关闭材料不创建 grant，不触发 action。
7. 主批准后可沿现有 autocontinue 派发主 DAG；改进批准后只续推该 improvement DAG。续推失败不伪造 action 失败或回滚合法决策。
8. 请求进行中全卡写操作串行；重复点击、并发窗口和响应乱序不会产生双 grant/双 transition。
9. 桌面、移动 bottom sheet、键盘和 reduced-motion 均可操作；状态不只靠颜色表达。
10. 旧客户端忽略 `userActions` 后行为不变；现有主任务/改进结果验收按钮不回退。
11. **保全清单 A–F 全部通过**：不得因插入决策区而丢失 rail、quick preview、改进摘要/验收、主验收/归档、runtime、写锁或聊天批准路径。
12. 同一任务卡可同时存在“只读资料 + 既有验收 CTA + 本期决策 CTA”的合法组合时，互不覆盖、文案不混淆（计划批准 ≠ 结果验收）。

## 非功能要求

- 审计记录不保存任意前端请求体；只记录 allowlist action、task/improvement/revision/context、时间、修改说明（仅 request changes）。
- API 错误不暴露绝对路径、材料正文或内部堆栈。
- action 响应与投影保持稀疏、限长；修改说明服务端限长并去除空白输入。
- 所有写入继续使用父任务 mutation lock 和已有 task.json/events.jsonl 持久化。

## UI 原型门禁与审批

本需求触发 UI 原型硬门禁。必须由 `ui-designer` 基于现有 360px 浮窗、移动 bottom sheet、quick preview 与验收按钮视觉产出 task-local 自包含 HTML 原型；用户批准原型及 [plan-review.md](plan-review.md) 后才能实现。

## 审批时需确认

1. 是否同意本任务只交付 Phase 1 **新增**能力，Phase 2/3 后续另立任务；同时同意 **现有能力保全清单** 为硬回归（推荐：同意）。
2. 是否同意「需要修改」强制填写说明并退回 `planning`（推荐：同意）。
3. 是否同意每卡 `userActions` 最多 2 项，多改进并发等待计划批准时只投影第一项；**不影响**多条改进结果验收按钮的既有展示规则（推荐：同意）。
