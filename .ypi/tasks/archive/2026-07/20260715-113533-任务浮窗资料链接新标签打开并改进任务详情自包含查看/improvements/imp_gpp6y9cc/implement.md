# Implement — IMP-005

## 文件
- `components/YpiStudioSessionWidget.tsx`
- `docs/modules/frontend.md`
- 可选测试脚本：补充主任务验收/改进验收状态流断言。

## 步骤
1. 在 `handleAcceptImprovement()` 中读取 PATCH 响应 task。
2. 新增 helper 判断是否应请求主任务再次验收：
   - `task.status === "review"`
   - `task.improvements?.unresolved === 0` 或 instances 全部 resolved
   - `task.improvements?.parentStatus === "review_ready"`
3. 满足条件时 PATCH 同一 task：`{ cwd, to: "user_acceptance", contextId, reason }`。
4. 若第二步 PATCH 失败：toast 提示“改进已验收，但进入主任务验收失败”，并刷新，避免静默卡住。
5. 成功 toast 改为“已确认 IMP-xxx 完成；主任务已进入用户验收”。
6. 更新文档。

## 验证
- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- 手测：最后一个改进从浮窗 accepted 后，浮窗直接出现主任务验收按钮。
