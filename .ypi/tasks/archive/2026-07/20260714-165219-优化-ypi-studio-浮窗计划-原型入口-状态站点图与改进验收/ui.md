# UI：YPI Studio 浮窗计划入口、完整状态站点与改进验收

## HTML Prototype

[打开可独立运行的交互原型：ypi-studio-widget-state-prototype.html](./ypi-studio-widget-state-prototype.html)

原型沿用 Yolk Pi 的 `--bg / --bg-panel / --border / --text / --accent` 视觉语言，模拟 Chat、右侧 Studio 任务详情和 **固定 360px 宽**的 Session 多任务浮窗。HTML 自包含 CSS/JavaScript，无外部资源依赖。

## 信息结构

### 任务详情：改进计划只读快速入口

- 在任务详情「改进流程」上下文中设置「快速预览」区。
- 「计划审批书」与「改进计划 · IMP-001」同级展示，减少进入改进卡片多层 Tab 的路径。
- 两者打开同一类只读预览 Dialog；标题和来源明确区分主任务与 `improvementId`，避免串读。
- 常驻提示“只读”：预览不修改计划、不批准计划、不触发 transition。

### 360px 多任务浮窗

- 保持 360px 宽度，展示两个绑定任务卡片；每张卡保留独立详情按钮。
- 主任务卡中的「计划审批书」与「HTML 原型」作为常驻产物入口，不随审批阶段或摘要截断消失。
- 审批前分别显示「待审批」「待确认」；审批后仍保留入口，并显示 `✓ 已批准`、`✓ 已确认`，同时切换绿色边框/底色。
- HTML 原型入口用 `↗` 和文字说明表达“新开页”，点击以新浏览器页面打开独立原型预览。
- 改进摘要仍保持轻量，只投影 ID、状态、下一步；完整计划与反馈按需打开。

## 状态与交互

原型顶部提供四个场景按钮：

1. **审批前**：Design 为当前站；计划和 HTML 原型均显示待确认状态。
2. **审批后**：Brief、Design 已完成，Implement 为当前站；两个入口保留并变为“✓ 已批准/已确认”。
3. **改进验收**：Review 已完成，User Acceptance 显示 `! 待确认`；浮窗出现「确认该改进任务已完成」。点击先打开确认 Dialog，明确确认后改进项直接显示“✓ 已验收”，主任务转为“待再次验收”。
4. **已归档**：八个站点均显示完成证据，任务状态显示“▣ 已归档 · 只读”；历史计划与原型入口仍可查看。

完整站点顺序为：

`Brief → Design → Implement → Checks → Review → User Acceptance → Completed → Archived`

站点在 360px 卡片内采用两行紧凑布局，避免横向页面滚动；每站同时使用符号和可读状态：`✓ 已完成`、`▶ 当前`、`! 待确认`、`○ 未开始`，不可只靠颜色判断。

## 改进验收状态机边界

- 浮窗验收动作只在改进实例为 `waiting_user_acceptance` 时出现。
- 点击动作必须先展示明确确认 Dialog，文案区分“验收改进结果”和“批准改进计划”。
- 确认后应调用既有改进验收 API/状态机动作，直接记录该改进项的用户验收；不创建旁路 grant。
- 未确认或取消时保持 `waiting_user_acceptance`，主任务继续受门禁阻塞。
- 验收后改进项显示稳定的“✓ 已验收”，主任务按既有语义进入再次验收，而不是自动完成或归档。
- Completed 与 Archived 只展示服务端状态；本浮窗不新增完成主任务或归档写操作。

## 只读与审批边界

- 任务详情和浮窗内的计划入口均为 **GET/只读预览**。
- 计划修改只在 Chat 中进行。
- `awaiting_approval` / `waiting_plan_approval` 的批准仍由 Chat 中的明确用户输入与服务端 approval grant 门禁处理。
- 预览接口不得写 `approvalGrant`，不得发起 PATCH 或 transition。
- HTML 原型入口只负责打开任务本地原型文件；“已确认”是状态投影，不代表点击预览即完成审批。
- 主任务和改进项必须使用明确的 `taskKey + improvementId` 读取目标，不猜测“第一个待审批项”。

## 可访问性

- 场景切换使用按钮组和 `aria-pressed`，键盘可操作。
- 任务、产物和验收入口均使用原生 `button`，提供可见焦点环与明确 `aria-label`。
- 状态同时使用图标、文字和颜色；颜色不是唯一信息来源。
- 计划预览与验收确认使用 `role="dialog"`、`aria-modal="true"`、标题/描述关联；支持 Escape、遮罩关闭并恢复触发器焦点。
- 验收结果通过 `role="status"` / `aria-live="polite"` 反馈。
- 动效仅为辅助；`prefers-reduced-motion` 下不启用进入与 halo 动画，静态符号和文字仍完整表达状态。

## 实现交接要点

- 不改变浮窗 360px 宽度、Session-bound 多任务筛选、卡片排序和 Detail-only 详情入口。
- 常驻入口应来自完整 artifact registry / 明确映射，不能依赖当前摘要窗口或仅等待审批状态，否则批准后会再次消失。
- 站点状态必须优先取 workflow/runtime 状态证据；已有 Markdown 文件不能误标 Checks、Review、User Acceptance 已完成。
- 新增的 User Acceptance、Completed、Archived 站点属于展示映射，不应反向修改服务端状态机。
- 原型只定义 UI 与交互契约，不包含生产实现。
