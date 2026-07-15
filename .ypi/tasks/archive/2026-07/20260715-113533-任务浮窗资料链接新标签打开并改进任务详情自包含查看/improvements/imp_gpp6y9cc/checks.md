# Checks — IMP-005

## 自动验证
- `npm run lint`：通过，仅历史 warning，无 error。
- `node_modules/.bin/tsc --noEmit`：通过。

## 代码检查
- 最后一个改进验收成功后，仅在服务端返回 `review` + `review_ready` + unresolved=0 时请求 `user_acceptance`。
- 主任务不会被自动推进到 `completed`。
- 非最后一个改进不会改变原有 `waiting_for_improvements` 流程。
- 二次 PATCH 失败会提示错误，并调用统一刷新，不会静默吞错。
- `contextId` 与服务端状态门禁仍生效。

## 手测重点
1. 只剩最后一个 waiting_user_acceptance 改进时，在浮窗点击验收。
2. 验收成功后应立即显示主任务验收按钮。
3. 主任务仍需再次确认后才进入 completed。
