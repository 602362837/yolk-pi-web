# Review — ChatGPT 额度耗尽自动切换可用账号

## Verdict

Pass.

## 检查范围

- `lib/chatgpt-account-failover.ts`
- `lib/rpc-manager.ts`
- `lib/pi-web-config.ts`
- `components/SettingsConfig.tsx`
- `hooks/useAgentSession.ts`
- `lib/ypi-studio-tasks.ts`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`

## 首轮发现与修复

1. 触发账号捕获时机错误风险：已改为在 `_runAgentPrompt` 开始前捕获 `runTriggerAccountId`，并传入 failover；锁内继续双重检查 active account，避免 A→B 后级联 B→C。
2. 错误识别过宽：已收窄为明确 quota/usage exhausted；普通 transient 429/rate-limit 不触发切换。
3. 接入顺序：已改为先执行 pi 原始 post-run retry/compaction 逻辑，只有其返回 false 时再尝试 failover。

## 验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

结果：均通过。

## 剩余风险

- `detectChatGptQuotaError()` 仍依赖错误文案关键词；后续建议补单测锁定允许/禁止样例。
