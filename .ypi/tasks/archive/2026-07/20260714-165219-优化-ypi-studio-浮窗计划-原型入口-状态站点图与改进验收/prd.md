# PRD：YPI Studio 浮窗计划/原型入口、完整状态与改进验收

## 用户价值

用户不必等待特定状态或进入多层详情，便可持续查看任务计划与原型；在改进交付完成后可从当前 Chat 浮窗直接完成明确验收，同时仍由服务端状态机保证主任务不会在未验收改进时继续完成。

## 需求与验收标准

### R1 改进计划快速预览

- 任务详情「改进流程」中，每个有计划材料的改进项显示「改进计划 · IMP-xxx」快速入口，并与主「计划审批书」入口处于同级快速预览区。
- 入口显式携带 `taskKey + improvementId + fileName`，按需读取实例内 `plan-review.md`；不得推断“第一个等待项”。
- 预览只读；无编辑、批准、拒绝、请求修改或 transition 控件。修改计划只在 Chat 进行。
- 空/TBD、加载、错误、重试和安全拒绝状态与现有计划审批书预览一致。

### R2 计划审批书常驻与状态

- 任务存在有效计划审批书映射后，浮窗入口不因离开 `awaiting_approval` / `waiting_plan_approval` 消失；完成和归档只读卡片也可查看历史材料。
- 入口以「待审批 / 已批准 / 已变更需重审」等文字和图标表达状态，颜色仅作辅助。
- 点击入口只读取文件，不写 grant。批准状态仅来自服务端当前 revision 的审批证据，不由“打开过”推断。

### R3 HTML 原型入口

- 主任务和改进项存在 task-local `.html/.htm` 原型映射时，浮窗显示「HTML 原型」入口。
- 点击通过现有 files API `mode=preview` 在新页面打开，保留 CSP sandbox 和 task/improvement scope。
- 当前计划 revision 获得审批后，按钮显示已确认态；计划变更清除审批时恢复待确认态。
- 不把 HTML 正文加入 session widget projection。

### R4 完整状态站点图

- 站点顺序：`Brief → Design → Implement → Checks → Review → User Acceptance → Completed → Archived`。
- `review` 后仍展示 User Acceptance、Completed、Archived；归档卡片全部保留且标记只读。
- 状态优先基于 workflow step、主任务 status、improvement/runtime evidence；预先存在的 `checks.md` 等规划产物不得误标运行阶段完成。
- 360px 桌面卡片用两行紧凑布局，移动端保持同等语义；无横向溢出。

### R5 浮窗直达改进验收

- 仅对 `status === waiting_user_acceptance` 的改进实例显示「确认该改进任务已完成」。多实例逐项显式渲染，不猜目标。
- 点击先弹出确认对话框，明确说明“这是改进结果验收，不是计划审批”，并显示 `IMP-xxx + 标题`。
- 确认后调用现有 `PATCH /api/studio/tasks/[taskKey]`：`action=transition_improvement, improvementId, to=accepted, contextId`。
- 服务端拒绝、网络失败、目标状态已变化时不得乐观伪造完成；展示错误并刷新投影。
- 成功后刷新任务详情和 session widget；若全部改进解决，主任务按既有 reconcile 回到 `review`，等待再次主任务验收，不自动 `completed`。
- 取消对话框不写状态；未验收时主任务门禁保持不变。

## 非功能要求

- 不改变浮窗 360px 宽度、位置持久化、拖拽、悬浮球和 Session-bound 多任务行为。
- 所有按钮可键盘操作；对话框支持焦点陷阱、Escape、焦点恢复；状态不只靠颜色。
- widget API 保持有界投影：只增加文件描述、审批态和可操作目标，不增加 artifact body、反馈全文或 transcript。
- 安全边界仍在服务端 allowed-root、task-local resolver、symlink escape 检查和状态机校验。

## 决策

- 本计划把「改进计划」定义为改进实例 scoped 的 `plan-review.md`（改进师面向用户的可审批计划），与主任务 `plan-review.md` 同类预览但显式区分 `IMP-xxx`。结构化 DAG 继续在现有「执行进度」内展示，不另造第二份可编辑计划。
- 浮窗验收使用现有 `transition_improvement → accepted`，不新增 acceptance grant。
