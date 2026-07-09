# handoff

## Architect handoff

- 已完成 intake→planning 产物：`brief.md`、`prd.md`、`design.md`、`implement.md`、`checks.md`、`ui.md`、`plan-review.md`。
- 已补充 HTML 原型文件：`project-switch-modal-prototype.html`。
- 当前未修改生产代码，未提交、未推送。

## 给主会话的下一步

1. 请先让 UI 设计员审阅/确认 `ui.md` 与 `project-switch-modal-prototype.html`；如需要，允许 UI 设计员调整 HTML 原型。
2. 将 `plan-review.md` 作为用户审批入口展示，等待用户明确确认原型与计划。
3. 用户确认后，保存 `implement.md` 中的 implementation plan，并派实现员执行。
4. 实现完成后派检查员按 `checks.md` 验证。

## 当前阻塞/风险

- UI prototype gate 尚未获得用户审批；未审批前不得进入实现。
- 未真实构造 50+ 项目数据，只基于代码结构和现状推导大量项目问题；实现阶段需补充手工/临时数据验证。
- 搜索行为的最终细节（是否跨项目显示空间命中）建议按 PRD 推荐方案执行，若用户有偏好需先确认。

## 验证运行

- 本阶段仅更新规划/原型文档，未运行 `npm run lint` 或 `tsc`。
