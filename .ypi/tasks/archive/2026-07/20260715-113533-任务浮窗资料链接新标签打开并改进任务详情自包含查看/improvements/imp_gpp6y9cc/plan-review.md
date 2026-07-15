# IMP-005 计划审批书 — 修复浮窗验收最后一个改进后主任务停在 review

## 问题确认
现在从浮窗验收最后一个改进项后，状态机 reconcile 会把主任务落到 `review`，但浮窗主任务验收按钮只在 `user_acceptance` 显示，所以用户无法继续直接验收主任务。这是浮窗改进验收操作链路缺失，不应该靠人工手动推进状态解决。

## 修复方案
在浮窗的「确认该改进任务已完成」写路径中补齐后续状态：

1. 先按现有逻辑接受改进项：`transition_improvement -> accepted`。
2. 如果响应显示所有改进已解决，且主任务已被 reconcile 到 `review` / `review_ready`，则立即 PATCH 主任务 `review -> user_acceptance`。
3. 这一步只表示“请求用户再次验收”，不会 completed。
4. 主任务 completed / completed+archive 仍必须由用户再点击主任务验收确认弹窗。

## 为什么不再手动推进
手动把主任务从 `review` 改成 `user_acceptance` 只解决当前实例；下一次从浮窗验收最后一个改进仍会复现。修复浮窗写操作后，每次最后一个改进验收都会自动进入可继续验收主任务的状态。

## 审批材料
- [PRD](./prd.md)
- [UI 说明](./ui.md)
- [HTML 行为原型](./improvement-accept-reaccept-prototype.html)
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)

## 请求确认
请确认是否按此方案实现：最后一个改进从浮窗验收成功后，自动进入 `user_acceptance`，让浮窗直接出现主任务验收按钮；但不自动 completed。
