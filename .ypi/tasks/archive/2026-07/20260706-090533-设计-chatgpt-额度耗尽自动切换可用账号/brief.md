# Brief: ChatGPT 额度耗尽自动切换可用账号

## 背景
项目已有 ChatGPT/OpenAI Codex 多账号管理、账号额度缓存、手动激活账号、后台额度刷新能力。当前痛点是长任务运行中 active account 额度耗尽时，需要用户手动切换账号并继续。

## 目标
设计一个默认关闭、可配置的自动 failover 能力：当 openai-codex 明确发生 ChatGPT usage/quota limit 时，自动选择下一个可用保存账号，激活并刷新运行中 RPC auth 状态，然后对当前失败 LLM turn 做受控重试。

## 重点要求
- 必须处理多 session 同时遇到额度耗尽并同时切号的问题，提供全局互斥/锁与冲突处理方案。
- 必须避免无限切号、无限重试、账号 A/B 来回切。
- 必须区分 transient rate limit 与账号额度耗尽，只对明确 usage limit 类错误触发。
- 必须考虑 quota cache 与实时 refresh 的取舍，避免频繁打 usage API。
- 切换 active account 是全局副作用，需要有事件/日志/UI 提示方案。
- 默认关闭，配置项放在 `pi-web.json` 的 `chatgpt` 下，并在 Settings 中可开关。

## 已知相关代码
- `lib/oauth-accounts.ts`: `listOAuthAccounts`, `activateOAuthAccount`
- `lib/subscription-quota.ts`: `getOAuthAccountSubscriptionQuota`
- `lib/rpc-manager.ts`: `reloadRpcAuthState()`, `AgentSessionWrapper`
- `lib/chatgpt-usage-refresh-scheduler.ts`: 后台刷新所有账号 quota cache
- `lib/pi-web-config.ts`: `PiWebChatGptConfig`
- `components/SettingsConfig.tsx`: ChatGPT 设置
- `components/ChatGptUsagePanel.tsx` / `components/ModelsConfig.tsx`: 账号显示与激活

## 交付物
请 architect 输出设计方案，包含：配置、数据结构、锁策略、候选选择算法、错误识别、retry 接入点、事件展示、测试计划、分阶段实现建议。
