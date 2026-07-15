# Implement — IMP-002（修订 r4）

## MODEL-PIN-4 扩展

- `lib/pi-web-config.ts`：`yolk.defaultModel` 含 optional `thinking`；兼容读 `defaultThinkingLevel`
- `SettingsConfig` 蛋黄𝝅区：模型+思考同组；thinking options 跟模型
- 新 session 初始化同时应用 model + thinking
- Chat 模型切换时夹紧 thinking（若尚未完善则在本改进补齐最小必要行为）

## 子任务仍按 PIN-1…5，其中 PIN-4 验收增加 thinking-follow-model
