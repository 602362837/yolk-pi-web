# Review — IMP-005

## 实现
- `components/YpiStudioSessionWidget.tsx`：浮窗验收改进项成功后读取服务端 reconcile 结果。
- 当最后一个改进已解决、父任务为 `review` 且 `review_ready` 时，自动 PATCH 父任务到 `user_acceptance`。
- 该动作只请求主任务用户验收，不会 completed；普通/非最后一个改进仍保持原状态流。
- 失败时抛出明确错误并走统一刷新路径。
- `docs/modules/frontend.md` 已更新。

## 验证
- `npm run lint`：通过，仅已有历史 warning，无 error。
- `node_modules/.bin/tsc --noEmit`：通过。
