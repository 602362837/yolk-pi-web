# PRD — opencode-go 额度不足自动账号轮换

## 目标与背景

`opencode-go` 已支持托管多个 API Key 账号，但当前运行时只使用一个 active key。用户在多 session 并发使用时，如果 active 账号额度不足或账号不可用，需要系统自动切换到其他账号并重试，且不能因多个 session 同时失败导致连续切换多个账号。

本轮用户已确认：`Invalid/Missing API key` 等账号永久不可用错误必须纳入自动切换，并需要配套账号禁用/启用能力，避免不可用账号持续参与候选轮换；本次也包含 Settings 与账号状态 UI。

## 范围内

- 为 `opencode-go` 设计默认关闭的自动 failover 能力。
- 在 agent turn 失败后识别明确的 quota/balance/monthly-limit 错误与账号永久不可用错误。
- `account_unusable` 自动 failover 时持久禁用触发账号。
- 新增 managed API-key 账号启用/禁用能力：禁用账号不可自动参与 failover，也不允许被设为 active，除非重新启用。
- 在进程内并发 session 间串行化切换账号，并避免 A→B、B→C 级联。
- 每 turn 限制 retry/switch 次数，维护 cooldown、已尝试账号、disabled 账号跳过策略。
- 激活新账号后刷新 live RPC auth/model state，使重试请求使用新 key。
- 在无可靠 quota 查询能力时采用纯被动 failover；预留 future quota cache 接口。
- Settings UI 开关、账号启用/禁用操作、自动切换策略说明、必要状态展示与 Chat 事件提示。

## 范围外

- 不实现跨 Node 进程/多部署实例的分布式锁。
- 不破解或依赖 OpenCode dashboard 私有接口。
- 不自动购买 credits、不修改 OpenCode Zen auto-reload/monthly-limit 配置。
- 不改变普通 `opencode` provider 或其他 API-key provider 行为。
- 不在本架构任务中修改生产代码。

## 需求与验收标准

### R1. 默认关闭与作用域

- 配置默认值为关闭，只有 `opencode-go` provider 且存在 managed API-key accounts 时生效。
- 验收：未开启时错误行为与当前完全一致；开启后非 `opencode-go` 模型不触发切号。

### R2. 错误分类

- `quota_exhausted`：匹配明确额度/余额/月度限制，例如 `GoUsageLimitError`、`FreeUsageLimitError`、`Monthly usage limit reached`、`available balance`、`insufficient_quota`、`out of budget`、`quota exceeded`、`billing`、402/payment-required 且正文指向 credits/balance/limit。
- `account_unusable`：匹配 active managed account 的 401/403 `AuthError`、`Invalid API key`、`Missing API key`、`Unauthorized`、`Forbidden` 等永久账号不可用错误。
- 不触发：普通 `429`、`rate limit`、`too many requests`、网络失败、5xx、stream ended、timeout、context overflow、content filter。
- 验收：单测覆盖 quota、account_unusable、transient 三类，普通 429 不切号。

### R3. 账号禁用/启用语义

- Managed API-key account metadata 增加 disabled 状态与原因字段，不存储 plaintext key。
- disabled 账号：
  - 不参与自动 failover 候选。
  - 不允许通过手动激活或自动切换设为 active。
  - 可以继续保留在账号列表中，用户可查看禁用原因。
  - 只有重新启用后才可手动激活或参与 failover。
- `account_unusable` 自动 failover 会将触发账号持久标记为 disabled，原因标记为 `account_unusable`，并记录时间与自动禁用来源。
- 用户可手动禁用/启用账号；手动禁用 active 账号时需阻止或要求同时选择替代账号/清空 active mirror，避免 disabled 账号继续 active。
- 验收：disabled 账号无法激活；启用后可再次激活；自动禁用账号不会继续被候选选择。

### R4. 并发安全

- 使用 `globalThis.__piOpencodeGoFailover` 保存进程级锁与失败/cooldown 状态。
- 每个请求绑定触发时的 active account id；锁内若 active 已不等于触发账号，说明其他 session 已切换，只重试当前 turn，不再切号。
- activate 前再次检查 active 未变化，避免 TOCTOU。
- 验收：两 session 同时 A 失败时最多只发生一次 A→B；第二个 session retry B，不执行 B→C。

### R5. Retry / switch budget

- 默认 `maxAttemptsPerTurn=1`、`maxAccountSwitchesPerTurn=1`。
- 当前 turn 已尝试账号、cooldown 中账号、disabled 账号、active 账号、trigger 账号均跳过。
- 验收：同一 turn 不会无限重试；候选耗尽时保留原错误并发出 no usable account 事件。

### R6. 账号激活与资源刷新

- 切换使用 `activateApiKeyAccount('opencode-go', nextAccountId)`，该函数写 metadata、镜像 secret 到 `auth.json` 并 reload RPC auth state。
- `activateApiKeyAccount()` 必须拒绝 disabled account，并返回可解释错误。
- 若 active 账号被禁用且无可用替代账号，需按产品审批结果清空 active mirror 或阻止禁用；本方案推荐自动路径清空 active mirror 并提示 no usable account。
- failover controller 仍可幂等调用 `reloadRpcAuthState()`，确保 live wrappers 和 pi-ai session resources 清理。
- 验收：切换后重试请求读取新 active key；现有 Settings 手动激活行为不回归。

### R7. 用户反馈与 UI

- Settings 中提供 `OpenCode Go auto failover` 开关，默认关闭。
- Settings/账号区域显示策略说明：仅 quota/billing/account_unusable 触发；普通限流/网络/5xx 不切换；切换是全局 active key 变更。
- 账号列表提供 Enable/Disable 操作与状态标签，展示 disabled reason，不展示 plaintext key。
- 触发时向 SSE/UI 发出结构化事件，例如 `opencode_go_account_failover`，包含 status/reason/provider/triggerAccountId/switchedToAccountId/retry/message，不含 plaintext key。
- Chat 侧可显示简短提示且不会泄露 API Key。
- 验收：HTML 原型审批后实现；Settings 默认关闭；disabled 状态与 failover 事件可被用户理解。

## 未决问题

1. 当 active 账号被自动禁用且没有 enabled 候选时，是否允许清空 active mirror？推荐允许。
2. 手动禁用 active 账号时，UI 是强制先切换到其他账号，还是允许“禁用并清空 active”？推荐提供确认并优先要求选择替代账号。
3. 是否需要将 cooldown/permanent failure 跨进程/重启持久化？本方案将 disabled 持久化，将 cooldown 保持进程内。