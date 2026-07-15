# 计划审批书：IMP-003 任务浮窗主任务用户验收

## 审批请求

请审批本改进的交互与实现计划。审批前为只读材料，不会自动实现或 transition 到 implementing。

## 目标

- 主任务在 `user_acceptance`（含改进全部解决后再次进入用户验收）时，会话浮窗提供「确认主任务已验收完成」。
- 交互对齐改进验收：二次确认 → 绑定会话 PATCH → 刷新；**不**自动 completed、**不**绕过门禁。
- 与改进验收按钮文案/视觉区分。

## 必读材料

- [Brief](brief.md)
- [PRD](prd.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
- [UI 说明](ui.md)
- [HTML 交互原型](studio-main-task-accept-prototype.html)

## 推荐方案

1. Projection 增加 `canAcceptMain`：仅 `user_acceptance && !archived && unresolved===0`。
2. 浮窗按钮「确认主任务已验收完成」+ AppPrompt 二次确认。
3. `PATCH` 主任务 `to: "completed"` + `contextId` + `reason`（满足 `requiresUserApproval`）。
4. 成功/失败均刷新；服务端 unresolved/archive/binding 仍为权威。
5. 三步串行实现：`MAIN-ACCEPT-1` projection → `MAIN-ACCEPT-2` widget → `MAIN-ACCEPT-3` docs/验证。

## 关键边界

- **不**在 `review` / `ready` / `waiting_for_improvements` 显示 completed 按钮。
- **不**因 `review_ready` 单独放行；改进清空后仍先到 `review`，进入 `user_acceptance` 后才可一键完成。
- **不**改计划审批 grant、archive、improvement transition 语义。
- **不**在详情面板扩展完整验收控制台（范围外）。

## 实施批次

1. `canAcceptMain` 类型 + projection + 纯函数测试  
2. 浮窗 UI / AppPrompt / PATCH / 样式  
3. 文档 + lint/tsc + 人工验收清单  

## 风险

- 用户误点完成主任务 → 二次确认 + 明确文案。  
- 与改进按钮混淆 → 成功色 vs 警告橙 +「主任务」前缀。  
- 漏 `reason` / 未绑定 context → 实现清单强制；服务端再拒。  
- `review_ready` 期待立刻完成 → 审批确认仅 `user_acceptance`。  

## 需要用户确认

请明确回复批准或提出修改，重点确认：

1. **仅** `user_acceptance` 显示主任务验收按钮（`review` 不直接 completed）；  
2. 二次确认后 PATCH → `completed`，不自动归档；  
3. 有未解决改进时不显示；与改进验收视觉/文案区分。
