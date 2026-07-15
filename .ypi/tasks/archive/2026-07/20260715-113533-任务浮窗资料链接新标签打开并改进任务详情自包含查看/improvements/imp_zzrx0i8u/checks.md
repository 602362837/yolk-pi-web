# Checks — IMP-004 主任务验收弹窗增加确认并归档按钮

## 静态验证
- `npm run lint`：通过；仅历史 warning（归档任务脚本与 scripts/test-model-prices.mjs 的 unused vars），无 error。
- `node_modules/.bin/tsc --noEmit`：通过。

## 代码检查
- `confirmChoice` 为新增 API，不改变原 `notice` / `confirm` / `prompt` 调用签名。
- 主任务普通确认仍只 PATCH `to: "completed"`。
- 「确认并归档」先 PATCH `to: "completed"`，再 PATCH `action: "archive"` + `allowFallbackKnowledge: true`。
- 归档失败不回滚 completed，toast 提示可从 Studio Panel 重试。
- 所有路径保持 busy guard、`contextId`、`onTaskChanged` 刷新。

## 手动验证建议
1. 主任务回到 `user_acceptance` 后点击浮窗主任务验收按钮。
2. 弹窗应显示三个选择：暂不验收 / 确认主任务已完成 / 确认并归档。
3. 普通确认只进入 completed；确认并归档应完成后进入已归档列表。
