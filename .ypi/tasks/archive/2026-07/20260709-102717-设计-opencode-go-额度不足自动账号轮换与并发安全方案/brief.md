# brief

## 任务目标

为 `opencode-go` 托管 API Key 多账号场景设计自动账号轮换方案：当当前账号因额度/余额/月度限制或账号永久不可用导致请求无法继续时，自动切换到其他可用账号并重试当前 turn，同时避免并发 session 造成 A→B、B→C 级联切号。

用户已确认本次变更：

- `Invalid/Missing API key` 等账号永久不可用错误纳入自动切换，分类为 `account_unusable`。
- `account_unusable` 需要配套账号禁用/启用能力，避免不可用账号持续参与候选轮换。
- 本次包含 UI：Settings 开关、账号启用/禁用操作、策略说明、状态展示/提示；需 HTML 原型审批。

## 已确认上下文

- 项目已有 `opencode-go` API Key 多账号管理：`lib/api-key-accounts.ts`，仅 allowlist `opencode-go`，账号 secret 独立存储，active credential 镜像到 pi `auth.json`，激活后调用 `reloadRpcAuthState()`。
- 运行接入点在 `lib/rpc-manager.ts` 的 `AgentSessionWrapper`，已有 ChatGPT/OpenAI Codex 自动 failover hook 可复用：`lib/chatgpt-account-failover.ts`。
- pi SDK 上游 provider：`@earendil-works/pi-ai` 中 `opencode-go` 使用 `https://opencode.ai/zen/go/v1` OpenAI-compatible chat completions 与 `https://opencode.ai/zen/go` Anthropic-compatible messages。
- pi 原生 auto-retry 将 `GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing` 视为非重试 provider limit，不会走普通 transient retry。

## 研究结论

- **确认有**：OpenCode Zen Go 模型/调用端点；公开 docs 说明 Zen 有 balance、auto-reload、monthly limits；无 key/坏 key 请求会返回 `401` 和 `{"type":"error","error":{"type":"AuthError","message":"Missing/Invalid API key."}}`。
- **当前项目/SDK 确认无**：本仓库、`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` 未提供 `opencode-go` quota/balance/usage 查询 helper、route 或缓存字段。
- **未发现可靠公开能力**：OpenCode 文档中未发现可用 API Key 查询余额/额度/月度限制的公开 endpoint；因此本方案按**纯被动 failover**设计，未来如果官方公开 quota API 再接入 quota cache。

## 关键设计决定

1. 默认关闭：新增 `opencodeGo.autoFailover.enabled=false`，避免全局账号副作用意外发生。
2. 只对 `opencode-go` 生效，不影响 legacy `opencode` 或其他 API-key provider。
3. 触发条件严格区分：额度/余额/月度限制触发临时 cooldown；账号认证永久不可用触发持久 disabled。
4. disabled 语义：disabled 账号不可自动参与 failover，也不允许被设为 active，除非先重新启用。
5. `account_unusable` 自动 failover 会将触发账号持久标记为 disabled，并向 UI/SSE 发出可恢复提示。
6. 并发安全复用 ChatGPT 方案：进程级 mutex、触发账号 request-time 捕获、锁内 active changed guard、activate 前 double-check、每 turn 默认最多一次 retry/一次切号。
7. 因没有可靠 quota 查询，候选账号依赖 enabled/disabled、运行期 cooldown、active/trigger/已尝试账号跳过；不做主动探测。
8. 本次包含 UI，HTML 原型见 [opencode-go-failover-ui.html](./opencode-go-failover-ui.html)，实现前需主会话/用户审批。

## 需要主会话/用户决策

- 审批 UI 原型与文案。
- 当 active 账号被自动禁用且没有 enabled 候选时，是否允许清空 active mirror；推荐允许。
- 手动禁用 active 账号时，是否要求选择替代账号；推荐优先要求选择替代账号，无法替代时才允许确认清空 active。