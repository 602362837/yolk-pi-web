# Implement — IMP-004 主任务验收弹窗增加确认并归档按钮

## 子任务建议

### ACCEPT-ARCHIVE-1：确认弹窗增加归档分支
- 在主任务验收 AppPrompt 中提供「确认并归档」。
- 保留现有取消与普通 completed 按钮。
- 文案明确区分普通完成与完成并归档。

### ACCEPT-ARCHIVE-2：写路径串联 complete + archive
- 普通按钮：维持 PATCH `to: "completed"`。
- 归档按钮：先 PATCH `to: "completed"`；成功后 PATCH `action: "archive"` + `allowFallbackKnowledge: true`。
- 保持 contextId、reason、busy guard、toast、refresh。

### ACCEPT-ARCHIVE-3：文档与验证
- 更新 `docs/modules/frontend.md`。
- 验证 `npm run lint` 与 `node_modules/.bin/tsc --noEmit`。
- 可补充轻量脚本/手测说明：普通完成不归档；确认并归档进入 archive；归档失败时 completed 可重试。
