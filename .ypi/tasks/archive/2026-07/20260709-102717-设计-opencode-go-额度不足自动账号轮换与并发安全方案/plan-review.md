# plan review — opencode-go 额度不足自动账号轮换与并发安全方案

## 审批摘要

本计划为 `opencode-go` managed API Key 多账号增加默认关闭的自动 failover：当 active 账号出现明确额度/余额/月度限制，或账号永久不可用错误（`Invalid/Missing API key` 等）时，自动切换到其他可用账号并重试当前 turn 一次。

本轮已按用户变更确认纳入 UI：包含 Settings 开关、账号启用/禁用操作、自动切换策略说明、账号状态展示与 Chat 事件提示。UI 原型已补齐，仍需主会话/用户审批后才能进入实现。

相关产物：

- [brief.md](./brief.md)
- [prd.md](./prd.md)
- [ui.md](./ui.md)
- [HTML 原型：opencode-go-failover-ui.html](./opencode-go-failover-ui.html)
- [design.md](./design.md)
- [implement.md](./implement.md)
- [checks.md](./checks.md)

## PRD 要点

- 默认关闭，只对 `opencode-go` provider 生效。
- 严格区分：
  - 可触发：`GoUsageLimitError`、`FreeUsageLimitError`、`Monthly usage limit reached`、`available balance`、`insufficient_quota`、`out of budget`、`quota exceeded`、`billing` 等明确 quota/billing 错误。
  - 可触发并持久禁用账号：`AuthError Invalid API key`、`Missing API key`、401/403 invalid/missing key 等永久账号不可用错误，分类为 `account_unusable`。
  - 不触发：普通 429/rate limit、network、timeout、5xx、stream ended、context overflow。
- 每 turn 默认最多 1 次 retry / 1 次实际切号。
- 切号后刷新 live RPC auth state，重试使用新 active key。
- 新增账号禁用/启用语义：
  - disabled 账号不可自动参与 failover 候选。
  - disabled 账号不允许被设为 active，除非先重新启用。
  - `account_unusable` 自动 failover 会将触发账号持久标记为 disabled，避免持续参与轮换。
  - 用户可在账号列表中手动禁用/启用账号。

## 研究结论

- OpenCode Zen Go 已确认有模型与调用端点：`/zen/go/v1` OpenAI-compatible、`/zen/go` Anthropic-compatible。
- 公开 docs 确认 Zen 有 balance、auto-reload、monthly limits 概念。
- 当前仓库、pi SDK、pi-ai provider 未发现 `opencode-go` quota/balance/usage 查询 helper 或 API。
- 公开 docs 未发现可靠 API Key 余额/额度查询 endpoint；v1 采用**纯被动 failover**，未来若官方公开 quota API 再接入 quota cache。

## UI 审批范围

本次 UI 纳入实现计划，必须审批以下用户可见内容：

1. Settings 中 `OpenCode Go auto failover` 默认关闭开关。
2. 策略说明：仅 quota/billing/account_unusable 触发；普通 rate limit/network/5xx 不切换；切换会修改全局 active key。
3. 账号列表中的 Enable/Disable 操作与状态标签。
4. 禁用账号规则：禁用后不可作为 failover 候选，也不能设为 active；启用后才可重新使用。
5. Chat/Session 中的轻量 failover 提示，不泄露 plaintext key。

UI 原型入口：[opencode-go-failover-ui.html](./opencode-go-failover-ui.html)。当前状态：**原型已补齐，用户审批未记录**。

## Design 要点

- 新增/扩展 `lib/api-key-accounts.ts`：
  - managed account metadata 增加 `disabled`, `disabledAt`, `disabledReason`, `disabledBy`, `autoDisabledReason` 等非 secret 字段。
  - 新增启用/禁用 helper 与 API 支撑。
  - `activateApiKeyAccount()` 拒绝激活 disabled 账号。
- 新增 `lib/opencode-go-account-failover.ts`：错误分类、全局锁、cooldown、禁用状态跳过、候选账号选择、failover attempt。
- 在 `lib/rpc-manager.ts` 的 `AgentSessionWrapper` 接入：
  - 每次 `opencode-go` provider 请求绑定触发账号。
  - pi 原生 retry/compaction 返回不继续后再尝试 failover。
  - `account_unusable` 在锁内持久禁用触发账号，再尝试切换到 enabled 候选。
  - 成功或其他 session 已切换时移除失败 assistant message，并返回 retry。
- 并发安全：进程级 mutex + 锁内 active-changed guard + activate 前 double-check，避免 A→B 与 B→C 级联。

## Implement 摘要

计划分 7 个子任务，详见 [implement.md](./implement.md)：

1. 配置、账号 metadata 与启用/禁用 API/helper。
2. `opencode-go` failover controller。
3. RPC runtime 接入与并发防级联。
4. Settings 与账号启用/禁用 UI（需审批 HTML 原型）。
5. 前端事件提示。
6. 测试、文档、最终检查。
7. rollout/回滚说明。

## Checks 摘要

最低验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

重点测试：

- quota / account_unusable / transient 错误分类。
- 普通 429 不切号。
- disabled 账号不参与候选，也不能被激活。
- `account_unusable` 自动禁用触发账号。
- 手动启用后账号才可重新激活/参与 failover。
- 两个 session 同时 A 失败时只执行一次实际 activation。
- active changed after lock / before activate 均 retry-without-switch。

## 需要审批/决策的问题

1. 请审批 UI 原型：[opencode-go-failover-ui.html](./opencode-go-failover-ui.html)。
2. 是否接受 `account_unusable` 自动持久禁用触发账号，并要求用户手动启用后才能再次使用？本计划按“接受”设计。
3. 当 active 账号被自动禁用且无 enabled 候选时，是否允许清空 active mirror 并显示 no usable account？本计划推荐允许，避免 disabled 账号继续作为 active。
4. v1 是否接受仅进程内锁/cooldown？推荐接受；多进程分布式锁作为后续增强。

## 建议审批结论

- 可批准后端核心方案：默认关闭、纯被动 failover、保守错误分类、`account_unusable` 自动禁用、进程级并发锁。
- 可批准 UI 范围：Settings 开关、账号启用/禁用、策略说明、必要状态/事件提示。
- 批准后由实现员按 [implement.md](./implement.md) 执行；实现前仍需主会话记录 UI 原型审批。