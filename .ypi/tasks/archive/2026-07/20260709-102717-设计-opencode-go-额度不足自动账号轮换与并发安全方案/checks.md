# Checks

## 需求覆盖检查

- [ ] 默认关闭，只对 `opencode-go` 生效。
- [ ] 明确 quota/balance/monthly-limit 错误触发 failover。
- [ ] `AuthError Invalid/Missing API key` 等账号永久不可用错误触发 failover，并分类为 `account_unusable`。
- [ ] `account_unusable` 自动持久禁用触发账号。
- [ ] disabled 账号不可自动参与 failover 候选。
- [ ] disabled 账号不允许被设为 active，除非先重新启用。
- [ ] 手动 Enable/Disable 能力已接入 managed account metadata/API/UI。
- [ ] 手动禁用 active 账号不会留下 disabled account 继续 active。
- [ ] 普通 transient `429/rate limit/network/5xx` 不触发切号。
- [ ] 每 turn 默认最多 1 次 failover retry、1 次实际账号切换。
- [ ] 进程级锁 + 锁内 active-changed guard + activate 前 double-check 已实现。
- [ ] 并发 session 不会出现 A→B 后另一个 session 继续 B→C 级联。
- [ ] 切换后调用既有 active mirror 与 `reloadRpcAuthState()`，live session 使用新 key。
- [ ] 无可靠 quota 查询时不做主动探测；未来 quota cache 是可选增强。
- [ ] Settings 开关、账号状态/操作、策略说明、Chat 提示已按审批原型实现。

## UI 审批检查

- [ ] HTML 原型已提交：[opencode-go-failover-ui.html](./opencode-go-failover-ui.html)。
- [ ] 主会话/用户已审批 HTML 原型后才进入 UI 实现。
- [ ] Settings 开关默认关闭。
- [ ] 策略说明明确：quota/billing/account_unusable 才切换，普通 rate limit/network/5xx 不切换。
- [ ] 文案明确切换是全局 active key 副作用。
- [ ] disabled 账号的 Activate 按钮禁用，并提示先 Enable。
- [ ] Chat 提示不展示 plaintext API key。

## 质量检查

- [ ] 新增代码不读取、不返回、不记录 plaintext API key。
- [ ] disabled metadata 为 additive；旧账号默认 enabled，无需迁移。
- [ ] 错误检测使用保守 allowlist；regex 单测覆盖正反例。
- [ ] cooldown、disabled、attempted accounts 状态只影响 failover，不破坏账号 CRUD。
- [ ] `globalThis` 状态命名唯一，兼容 Next dev hot reload。
- [ ] `activateApiKeyAccount()` 对 disabled/no-op/失败路径有清晰 typed status，不吞掉真实错误。
- [ ] `disableApiKeyAccount()` 对 active account 有明确 replacement/clearActive 策略。
- [ ] Existing ChatGPT/OpenAI Codex failover 行为不回归。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议测试：

- quota detection table。
- transient 429/network/5xx negative table。
- account_unusable detection table：Invalid API key、Missing API key、401/403 AuthError。
- account_unusable 自动写入 disabled metadata。
- manual disable / enable helper 行为。
- disabled account activation rejection。
- disabled account 不参与 candidate selection。
- candidate selection skips active/trigger/cooldown/disabled/attempted。
- budget exhausted returns no retry。
- concurrent A failures only activate once。
- active changed after lock and before activate both return retry-without-switch。
- UI 组件/手工检查：disabled 状态、Enable/Disable、active 禁用确认、Settings 默认关闭。

## 手工验收

- 准备两个 `opencode-go` managed accounts，开启 auto failover。
- 模拟/使用一个明确 quota-exhausted 账号作为 active，发送 prompt：应切到另一个 enabled 账号并自动重试一次；原账号进入 cooldown 但不被 disabled。
- 模拟 active 账号 `Invalid API key`：应将该账号标记为 disabled，切到另一个 enabled 账号并重试；disabled 账号不再参与候选。
- 在 Settings 中尝试激活 disabled 账号：应被阻止并提示先 Enable。
- Enable disabled 账号后再 Activate：应可恢复激活。
- 同时两个 session 用同一 active 账号触发 quota 或 account_unusable：最多一次实际切换，另一个 session 显示“其他 session 已切换，正在重试”。
- 使用普通 429/rate limit mock：不切账号，按 pi 原生 retry/错误展示。
- UI：Settings 开关默认关闭、说明完整、事件提示不泄露 key、active 账号禁用有确认/替代选择。

## 回归风险

- 上游 SDK 私有方法名变化导致 request account capture 失效。
- 过宽错误匹配造成 transient rate limit 误切账号。
- `account_unusable` 持久禁用可能让用户误以为账号被删除；UI 必须提供 Enable 恢复路径。
- 禁用 active 账号若未正确清理/替换 active mirror，可能留下 disabled active 状态。
- 多进程部署中进程级锁不能互斥，可能仍出现跨进程级联。
- active key 是全局副作用，用户未理解时可能影响其他 live sessions。