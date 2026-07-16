# Handoff：规划阶段（等待 UI 原型）

## 本轮产出

已完成架构侧 planning，未修改生产代码、未提交、未派发其他成员：

- [`brief.md`](brief.md)：回填用户已确认口径与 planning 状态。
- [`prd.md`](prd.md)：目标、范围、直接导航首选交互与验收标准。
- [`ui.md`](ui.md)：给 `ui-designer` 的完整 HTML 原型任务单与硬门禁。
- [`design.md`](design.md)：专用 child inventory endpoint、状态权威、hook/polling、共享菜单、旧链路清理与回滚。
- [`implement.md`](implement.md)：8 个子任务的人类可读计划与 fenced `json ypi-implementation-plan`。
- [`checks.md`](checks.md)：流程、数据、隐私、交互、性能、动画与真实浏览器验收矩阵。
- [`plan-review.md`](plan-review.md)：用户主审阅入口，已链接全部规划材料及待交付 HTML 原型。

## 核心设计决策

- 新增 `GET /api/sessions/:id/studio-children`；复用 lightweight active inventory，只按 `studioChild.kind + parentSessionId` 关联。
- task.json run 状态优先；header fallback 明示可能过期。terminal 固定最近 20 条；wire 不返回绝对路径或 child 内容体。
- 新 hook 独立于 `useAgentSession` 的 tool events，使用 abort/generation guard；仅 active+visible 时约 5 秒 polling。
- child 整行在当前工作台调用现有 session selection，进入既有只读 audit Chat；不新增弹窗/新 tab/二次确认。
- 当前工作区菜单只保留一份内容/actions；三点 anchored、项目按钮右键 fixed；WorkTree 两入口同样追加 archive/delete。
- 新面板稳定后删除旧 `SubagentRun`、`onSubagentChange`、`/api/agent/subagent-children` 与 parser，保留 Studio tool cards/widget/run APIs。

## 验证

- 已阅读项目 architecture/frontend/API/library/code-style 文档及相关源码。
- 已校验 implementation plan JSON 可解析、8 个子任务必需字段与依赖存在（见主会话验证输出）。
- 未运行 lint/typecheck/build：本轮只写规划 artifact，未改生产代码。

## 当前阻塞与下一步

本 delegated architect session 按要求不能再派发 member，因此 **HTML 原型尚未交付**。主会话必须：

1. 指派 `ui-designer` 按 [`ui.md`](ui.md) 生成 [`workspace-subagents-prototype.html`](workspace-subagents-prototype.html)。
2. 有差异时先回写 PRD/Design/Implement/Checks/plan-review，使原型和规划齐备。
3. 通过 Studio task mutation 保存 implementationPlan，并切到 `awaiting_approval` 请求用户同时审批 HTML 原型和 [`plan-review.md`](plan-review.md)。
4. 原型未交付前保持 `planning`；用户明确批准前不要进入 `implementing`、不要派实现员。

## 剩余风险

- lightweight inventory 仍是全局 active scan，需靠现有 1s single-flight + active/visible 低频 polling 控制成本。
- task detail 合并必须按 task 去重，历史 task/run 缺失时只能诚实 header fallback。
- 当前工作台 session 切换沿用现有未发送草稿行为；本任务不引入草稿持久化。
- 真实浏览器验收必须使用实现后的应用，不能用 HTML 原型替代。
