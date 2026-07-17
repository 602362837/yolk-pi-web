# 计划审批书：任务浮窗在用户决策节点提供可点击 CTA

## 当前结论

**规划与 UI 原型方案已就绪。** UI 设计员已顺利交付自包含 HTML 原型 [studio-widget-decision-cta-prototype.html](studio-widget-decision-cta-prototype.html)。主会话现在可以将本计划提请用户审阅，在用户确认原型、PRD、Design 及 DAG 机器计划并授予批准后，即可正式启动进入 `implementing` 阶段。

## 审阅材料

- [Brief：目标、证据、范围与当前门禁](brief.md)
- [PRD：Phase 1 需求与验收标准](prd.md)
- [UI 委派说明与 HTML 原型契约](ui.md)
- [Design：投影、原子 action、续推与安全边界](design.md)
- [Implement：schemaVersion 2 DAG、文件与回滚](implement.md)
- [Checks：自动、手工与回归矩阵](checks.md)
- **UI 设计员已交付原型**：[studio-widget-decision-cta-prototype.html](studio-widget-decision-cta-prototype.html)（点击可直接打开并交互）

## PRD 摘要

本任务默认只交付 Phase 1 **新增**能力：

1. 主任务 `awaiting_approval`：主 CTA「批准并开始实现」和次 CTA「需要修改」。
2. 改进项 `waiting_plan_approval`：精确绑定 improvement/revision 的「批准该改进计划」。
3. `userActions[]` 由服务端投影，前端不猜状态机；每卡最多一主一次。
4. 计划/HTML 预览继续只读，modal/document page 不增加批准按钮。
5. Phase 2/3（新建改进反馈、接受不处理、completed 独立归档入口、blocked/clarification/chat focus）后续另立任务。

### 重要澄清：范围外 ≠ 删除现有

用户已明确担心：若审批书只写“新 CTA”，实现时可能把当前浮窗已有能力弄没。因此 PRD 增加 **现有能力保全清单（硬约束）**，实现必须 **叠加** 决策区，完整保留：

- 壳层：多任务绑定、拖拽/移动 sheet、详情 `→`、**完整 8 站 WorkflowRail**（Brief→Design→Implement→Checks→Review→User Acc.→Completed→Archived，禁止压成 4 站）、状态/产物/子任务元信息
- 只读资料：`quickPreviews` 计划审批书 / HTML 原型 / 改进计划（↗ + 状态词，不写 grant）
- 改进流：待处理改进摘要、blocker/nextAction、**改进结果验收**按钮与 accepted 写路径
- 主验收：`确认主任务已验收完成` + **确认并归档**；归档只读徽章
- runtime / compact 子任务 / live runs；共享写锁；聊天 `user-input` 批准路径

信息层级：**改进/主验收区块在前，只读资料次之，本期决策区插在资料之后**，不得用新按钮替换旧区块。

完整验收见 [PRD](prd.md)。

## Design 摘要

- `YpiStudioTaskWidgetProjection` 新增稀疏、限长、固定 enum 的 `userActions[]`，不下发任意 endpoint/body/material content。
- 三个显式 PATCH action：`approve_plan`、`request_plan_changes`、`approve_improvement_plan`。
- 批准 action 在一个父任务 mutation lock 中原子完成：binding/status/revision/material gate 校验 → 写 `source=user-widget` grant → transition；`override` 不在契约中。
- `需要修改` 强制非空 feedback，退回 planning、清 grant、revision + 1，并保留审计。
- 主/改进批准后复用安全 autocontinue；改进续推必须带 improvementId，只操作 instance DAG。续推失败不回滚合法用户决定。
- 历史 `user-input` grant 和旧 improvement approval 继续可读；不迁移历史 task.json。

完整边界见 [Design](design.md)。

## Implement 摘要

实施 DAG 共 5 项，`maxConcurrency=2`：

1. `CTA-DOMAIN-01`：类型、grant 兼容与三个原子 domain helper。
2. `CTA-PROJECTION-02`：服务端 action 投影与 PATCH route。
3. `CTA-CONTINUATION-03`：主/改进/退回设计续推（与 02 并行）。
4. `CTA-WIDGET-04`：按用户批准 HTML 实现桌面/移动 CTA。
5. `CTA-VERIFY-05`：checker 测试、文档与整体验收。

完整机器计划见 [Implement](implement.md)。在 HTML 原型和本审批书获批前不得 claim 或派发实现员。

## Checks 摘要

重点证明：

- 非用户门禁阶段无 CTA；preview GET 不写 grant。
- stale revision、错 context、transfer、缺材料/原型、并发重复点击均零部分写入。
- `user-widget` 可审计且不能被 `override` 替代。
- 改进批准只操作 exact instance DAG。
- 桌面/移动/键盘/focus/reduced-motion 与现有验收按钮均无回退。

完整矩阵见 [Checks](checks.md)。

## UI 设计员已交付

UI 设计员已基于现有 360px 浮窗和移动 bottom sheet 交付自包含交互原型：[studio-widget-decision-cta-prototype.html](studio-widget-decision-cta-prototype.html)。该原型完美覆盖了：
- 主批准确认与 busy (aria-busy) 状态；
- 需要修改的必填输入框及其本地校验；
- 改进批准确认 (IMP-023)；
- 版本/状态冲突导致的 toast 警示与同步刷新；
- 普通非决策阶段及已归档只读阶段的布局表现；
- 支持深色 (Dark) / 浅色 (Light) 模式切换、屏幕宽度适配、键盘 focus 轮廓高亮以及减弱动画 (reduced-motion)。

## 请用户确认

1. 同意本任务默认只做 Phase 1 **新增**，Phase 2/3 后续另立；并同意 **现有能力保全清单** 为实施/检查硬门禁（防止把改进验收、主验收、rail、预览等弄没）。
2. 同意「需要修改」必须填写说明并退回 `planning`。
3. 同意 `userActions` 每卡最多 2 项，多项改进**等待计划批准**时只显示第一项主 CTA；**不**限制多条改进**结果验收**按钮。
4. 批准 HTML 原型、原子 action 方案、DAG 与 Checks（含保全回归）。

在以上材料补齐并获得明确批准前，任务应保持 planning，不进入实现。
