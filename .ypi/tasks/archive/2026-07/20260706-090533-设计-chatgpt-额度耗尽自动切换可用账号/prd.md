# PRD — ChatGPT 额度耗尽自动切换可用账号

## 目标
在 `openai-codex` 当前 active ChatGPT 账号额度耗尽时，按默认关闭的配置自动切换到下一个可用保存账号，刷新运行中 RPC auth 状态，并对当前失败 LLM turn 做受控重试。

## 范围
- 新增 `pi-web.json.chatgpt.autoFailover` 配置，默认关闭。
- 只处理明确 ChatGPT/Codex usage/quota limit，不处理普通 transient 429、网络错误或非 openai-codex provider。
- 多 session 并发触发时必须串行化全局切号。
- 防止无限切号、无限 retry、账号 A/B 来回切。
- 通过 SSE 事件和 UI 提示告知切号/跳过/失败。

## 非目标
- 不做跨进程/多实例分布式锁，MVP 只做当前 Node 进程内保护。
- 不自动消耗 reset credit。
- 不修改账号导入/登录主流程。

## 配置建议
```ts
interface PiWebChatGptFailoverConfig {
  enabled: boolean;              // 默认 false
  maxAttemptsPerTurn: number;     // 默认 1，上限 3
  maxAccountSwitchesPerTurn: number; // 默认 1
  quotaCacheMaxAgeMs: number;     // 默认 5 分钟
  exhaustedCooldownMs: number;    // 无 resetsAt 时默认 30 分钟
  minSwitchIntervalMs: number;    // 默认 10 秒
}
```

MVP Settings 只暴露 `enabled` 开关，高级参数先用默认值并通过 config validation 支持。