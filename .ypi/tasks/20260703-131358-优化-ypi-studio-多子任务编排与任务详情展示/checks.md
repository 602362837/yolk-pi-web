# checks

## 自动验证

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- 如涉及 policy/plan normalize，补充或运行 `npm run test:studio-policy`（若当前脚本存在）。

## 手工验证

1. 创建含串行 + 并行组的 implementationPlan，确认任务详情流程路线正确显示。
2. 打开实现 tab，确认二级 tab 只渲染当前子任务，切换时内容正确。
3. 构造 artifact/fileName 为 `prd pro.md` 的未完成任务，确认不会请求/显示 `prd pro.md.md`。
4. 触发工作室抽屉自动刷新，确认没有额外刷新提示行导致布局跳动。
5. 确认 awaiting_approval -> implementing 仍需要后续用户明确批准。
