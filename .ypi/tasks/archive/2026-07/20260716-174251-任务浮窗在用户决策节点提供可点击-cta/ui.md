# UI 设计委派说明：YPI Studio 浮窗用户决策 CTA

## 原型门禁

**已完成且就绪。** UI 设计员已交付真实交互 HTML 原型：
- **交付件**：[studio-widget-decision-cta-prototype.html](studio-widget-decision-cta-prototype.html) (支持在 Studio 浮窗/网页预览中直接加载并进行交互测试)

请在主会话中审查并提交给用户审批。以下是设计原则的实现状态：

1. 决策 CTA 与只读预览视觉分区，避免“打开审批书”等同于“批准”。
2. 每卡最多一主一次：主按钮高强调，次按钮 outline/neutral；不形成按钮墙。
3. 明确决策对象和后果：主任务 / IMP 编号、revision、将进入的状态。
4. 与既有改进结果验收、主任务结果验收按钮共用确认/忙碌/错误模式，但文案绝不混淆。
5. 桌面卡与移动 bottom sheet 使用同一 action 顺序和语义。

## 建议信息层级

在任务卡中按以下顺序（**additive；禁止用新决策区替换旧区块**）：

1. 标题、**完整 8 站 WorkflowRail**（Brief / Design / Implement / Checks / Review / User Acc. / Completed / Archived，2×4）、状态/产物元信息、详情入口。禁止用 4 站示意轨替代。
2. 改进摘要（若有 unresolved）：blocker / nextAction。
3. **既有**改进结果验收列表（`waiting_user_acceptance` →「确认该改进任务已完成」）。
4. **既有**主任务结果验收（`user_acceptance` →「确认主任务已验收完成」/ 确认并归档）。
5. 归档只读徽章（若 archived）。
6. **只读资料区**：计划审批书 / HTML 原型 / 改进计划，保留 `↗` 与审批状态词。
7. **本期新增用户决策区**：小标题「需要你的决定」，显示对象与 revision；主 CTA + 次 CTA（仅 `userActions`）。
8. runtime、实现摘要与最近运行。

计划审批 modal、文档页和 HTML preview 保持只读，不增加批准按钮。

## 原型必须保留的“现有能力”场景

除新决策场景外，HTML 原型/验收矩阵还应能切换演示（至少静态呈现）：

| 场景 | 必须仍可见 |
| --- | --- |
| 改进结果待验收 | 橙块 +「确认该改进任务已完成」；文案标明结果验收 |
| 主任务结果待验收 | 绿色主验收按钮 + 确认并归档路径说明 |
| 执行中 | runtime/子任务；无计划决策 CTA；资料可只读 |
| 归档 | 「已归档 · 只读」；无写按钮 |

## 原型必须覆盖的状态

| 场景 | 资料区 | 决策区 | 关键文案/反馈 |
| --- | --- | --- | --- |
| 主计划待批准 | 计划审批书、HTML 原型可打开 | 主「批准并开始实现」；次「需要修改」 | 显示主任务与 Revision N |
| 主计划批准确认 | 背景不变 | AppPrompt confirm | 说明会进入 implementing 并继续 Studio 编排 |
| 主计划批准中 | 保持材料可读 | 两按钮禁用，主按钮「批准中…」 | `aria-busy`，禁止重复提交 |
| 需要修改输入 | 背景不变 | 必填 prompt | 标题「需要修改当前计划？」；确认「提交修改要求」 |
| 改进计划待批准 | 显示改进计划/原型 | 主「批准该改进计划」 | 明确 `IMP-xxx · 标题 · Revision N` |
| 改进批准确认 | 背景不变 | AppPrompt confirm | 强调不是结果验收/主任务验收 |
| 陈旧/冲突 | 旧按钮结束 busy | toast + 自动刷新 | 「状态或版本已变化，已刷新最新任务」 |
| 非决策阶段 | 可保留永久预览 | 不显示决策区 | planning/implementing/checking 无伪继续 |
| 归档 | 资料只读 | 无写按钮 | 保留「已归档 · 只读」 |
| 多改进等待计划批准 | 资料可列多项 | 只显示第一项**计划**主 CTA | 文案提示其余计划在详情查看；不限制结果验收按钮 |
| 改进结果待验收 | 可有改进计划资料 | 无计划决策或与决策并存但不替换 | 「确认该改进任务已完成」必须在 |
| 主任务结果待验收 | 可有历史资料只读 | 无计划决策 | 「确认主任务已验收完成」必须在 |
| 移动端 | bottom sheet 内同序 | CTA 至少 44px 高 | 不被安全区/底部 pill 遮挡 |

## 交互规范

- 主批准：点击 → 确认框 → action；取消零写入。
- 需要修改：点击 → 必填输入框；空值本地提示且服务端再次验证；取消零写入。
- 改进批准：点击 → 确认框，必须显示 displayId/title/revision。
- 写入期间复用全卡单一 in-flight guard，所有决策/验收按钮禁用；预览可保持只读可用或统一禁用，由原型给出一致方案。
- 成功 toast 后刷新 widget + Studio drawer；失败也刷新，禁止乐观迁移。
- focus：对话框关闭恢复触发按钮；action 成功后若按钮消失，焦点落到任务卡标题或状态区域。
- Escape 只取消当前对话框，不关闭整个 Studio 浮窗；拖拽 header 与 CTA pointer 事件隔离。

## 响应式与无障碍

- 桌面 360px：主按钮可占满一行，次按钮在下方或同排；长标题省略但 `title` 可读。
- `≤640px`：bottom sheet 内按钮全宽、最小 44px；确认框 action 纵向排列，不横向溢出。
- 原生 `button`、可见 `:focus-visible`、`aria-label` 包含任务/改进对象、`aria-busy`、错误 `role=alert`/toast。
- 不依赖颜色区分 pending/approved/revision changed；保留文字和图标。
- `prefers-reduced-motion` 停止非必要 halo/shimmer，忙碌仍以文字表达。

## HTML 原型验收要求

自包含 HTML 必须提供状态切换器，至少演示上述主计划、需要修改、改进计划、冲突、非决策、归档、移动宽度；支持 light/dark、键盘 focus 和 reduced-motion 静态表现。原型不得调用真实 API，也不得在预览 modal 内放批准按钮。

## Review Request

待 UI 设计员真实交付 HTML 后，请用户重点确认：资料/决策分区、主次 CTA 强度、确认文案、修改说明输入、多改进收敛和移动端布局。批准前不得进入生产实现。
