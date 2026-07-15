# 计划审批书：IMP-001 任务资料预览滚动修复

## 审批请求

请审批本改进的交互与实现计划。审批前为只读材料，不会自动实现或 transition 到 implementing。

## 目标

- 修复 `/studio/task-document` 与任务详情内嵌资料预览「滚轮需先点击才生效」。  
- Page / Embedded 均以文档 body 为**唯一**纵向滚动容器，头部固定可见。  
- 不改变主任务的打开策略、安全边界与只读写语义。

## 必读材料

- [Brief](brief.md)  
- [PRD](prd.md)  
- [Design](design.md)  
- [Implement](implement.md)  
- [Checks](checks.md)  
- [UI 说明](ui.md)  
- [HTML 交互原型](studio-task-document-scroll-prototype.html)

## 推荐方案

1. **Page**：补齐 `100dvh` flex 高度链；`overflow:hidden` 落在 page/document root；`body` `min-height:0; overflow:auto`。  
2. **Embedded**：`documentTarget` 打开时 `TaskDetailShell`（及必要的 TasksTab 外层）改为 overflow lock + 高度填满；关闭后恢复。  
3. 焦点增强仅作 CSS 不足时的后备。  
4. 三步串行实现：page → embedded → polish/docs。

## 关键边界

- 普通详情 Tab 滚动行为在非文档模式保持不变。  
- 不修改 task files API、resolver、approval grant、widget 打开策略。  
- 不把正文写入 widget projection。

## 实施批次

1. Page CSS/高度链  
2. Embedded shell lock  
3. 抛光、文档、lint/tsc、人工滚轮验收  

## 风险

- 误锁全部详情滚动 → 用 documentTarget 条件分支。  
- 移动端 100dvh → 人工窄屏验收。  
- 双滚残留 → checks 强制「不点击正文」用例。

## 需要用户确认

请明确回复批准或提出修改，重点确认：

1. 固定头 + 正文 sole scroller（非整页 window 滚）；  
2. 文档打开时临时锁定详情 shell 外层滚动；  
3. 范围仅滚动体验，不含打开策略返工。
