# Design — IMP-005 修复浮窗验收最后一个改进后主任务停在 review

## 方案
优先在浮窗改进验收写路径中修复，而不是人工强推主任务状态。

### 写路径
`components/YpiStudioSessionWidget.tsx` 的 `handleAcceptImprovement()` 当前：
1. PATCH `transition_improvement -> accepted`
2. toast
3. `onTaskChanged`

修改为：
1. PATCH `transition_improvement -> accepted`
2. 读取响应中的 task/detail（或使用返回体）判断：
   - 主任务 `status === "review"`
   - `improvements.unresolved === 0`
   - `improvements.parentStatus === "review_ready"`
3. 若满足，立刻 PATCH 主任务 `to: "user_acceptance"`，reason 说明来自浮窗改进验收后的再次验收请求。
4. 刷新 widget + drawer。

## 为什么不直接改 reconciler 到 user_acceptance
`reconcileImprovementsInLock()` 是通用服务端回收逻辑，当前工作流定义也写了 `waiting_for_improvements -> review`。直接全局改为 `user_acceptance` 可能影响非浮窗/自动 reconcile 场景。此次 bug 是“浮窗验收最后一个改进后应能继续同一验收流”，因此更安全地修复浮窗写操作链路。

## 结果
- 最后一个改进验收完成后，主任务进入 `user_acceptance`。
- 浮窗立即显示主任务验收按钮。
- 用户仍需显式点击主任务验收，才会 completed 或 completed+archive。
