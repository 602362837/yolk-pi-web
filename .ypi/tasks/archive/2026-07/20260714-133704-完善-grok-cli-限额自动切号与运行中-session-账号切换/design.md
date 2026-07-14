# Design：Grok 全局 Active Failover，对 GPT 零行为漂移

## 方案摘要

先把现有 ChatGPT/Codex 行为作为不可变 contract 固化，再接入 Grok。手动 Activate 只改变当前 Active，从不产生锁定状态；自动 failover 对“如何成为 Active”不做区分。

共享不是目标本身：

- **可证明无 GPT 漂移：** 抽 provider-neutral orchestration core，GPT 保留原 facade/event/status，Grok 只提供 classifier/quota/token adapter。
- **无法证明：** 保持 ChatGPT 生产路径不动，新建 Grok 独立 controller/wrapper patch，逐项复制已固化的 GPT 行为契约。

无论采用哪条路径，Grok provider-specific 差异只存在于错误分类、候选额度判断和 token 刷新；不会把 Grok 条件写进 GPT detector。

## 现有 GPT 源码核对结论

核对文件：

- `lib/chatgpt-account-failover.ts`
- `lib/rpc-manager.ts` 的 `patchChatGptAccountFailover()` / `reloadRpcAuthState()`
- `lib/oauth-accounts.ts` 的 `activateOAuthAccount()`
- `app/api/auth/accounts/[provider]/activate/route.ts`
- installed Pi 0.80.6 `dist/core/agent-session.js`

| 问题 | 实际语义 | 源码证据 |
| --- | --- | --- |
| 手动 Active 会不会锁定 | 不会。Activate 只写 `activeAccountId` 与 `auth.json`；failover 不读取“手动选择”标记 | `activateOAuthAccount()` 没有 lock/pin 字段；controller 只比较 trigger/current account id |
| 手动 Active 出错会不会切 | 会，只要 `chatgpt.autoFailover.enabled`、provider 是 `openai-codex`、assistant 是 error 且 detector 命中 | `_runAgentPrompt` 每次运行前快照当前 Active，来源不区分手动/自动 |
| GPT 当前识别哪些限流 | `quota`、`usage limit`、`insufficient_quota`、`codex_rate_limits`、`rate limit reset credit` 等；不因裸 429 自动触发 | `detectChatGptQuotaError()` regex |
| 执行时机 | Pi 原生 retry、retry-end、compaction/queued continuation 都返回 false 后 | wrapper 先 `await original()`；Pi `_handlePostAgentRun()` 先 `_prepareRetry()` 再 `_checkCompaction()` |
| 重试预算 | 默认每 turn 1 attempt / 1 actual switch；成功非 error turn重置 | `PiWebChatGptAutoFailoverConfig` 默认值和 wrapper budget |
| 并发保护 | 进程级 mutex；锁内查 Active，候选查询后、Activate 前再查一次 | `withFailoverLock()`、`activeAfterLock`、`activeBeforeActivate` |
| 并发后进入者 | 若 Active 已不同于 trigger，返回 `already_switched_by_other_session`，不切第三账号，允许当前 Session retry | controller result `retry:true` |
| 候选 | 从 trigger 后循环，跳过 trigger/cooldown；优先 fresh cache，否则查询 quota；所有 tier utilization <100 | `chooseNextUsableAccount()` / `isUsableAccount()` |
| reload | Activate 后 reload 每个 live wrapper 的 AuthStorage、refresh ModelRegistry，并 cleanup provider session resources | `reloadRpcAuthState()` |
| 切换范围 | provider 全局 Active；所有 live wrapper 被 reload，新请求读取新 auth；in-flight 不变 | Activate API + global wrapper registry reload；Pi provider request headers已组装后不会被中途改写 |
| same-turn retry | 删除仍为最后一条且 identity 相同的失败 assistant，返回 true，由 Pi `agent.continue()` 发起新 provider call | wrapper patch + Pi `_runAgentPrompt()` while loop |

结论：**手动 Activate 的 GPT 账号在后续明确限额错误时会被自动轮换；它不是锁定账号。** Grok 必须采用相同语义。

## 模块与边界

### 1. GPT characterization / contract tests（先行，不改语义）

新增受控测试覆盖：

- manual Activate A → detector 命中 → A→B；
- default-off、provider gate、现有 detector 正负例；
- 1 attempt / 1 switch、success reset；
- circular order、fresh cache/query、cooldown、min interval；
- active-changed after lock / before activate；
- activate + reload 调用次数；
- failed assistant identity removal、same-turn continue；
- `chatgpt_account_failover` event/status/message contract；
- OpenCode Go patch 链顺序。

测试使用临时 agent dir、fake clock/quota/activate/reload 或隔离 child process，不读取真实账号和网络。需要 test seam 时只允许 additive dependency injection，默认生产路径必须保持现有函数与默认值。

### 2. 接入策略门禁

#### Path A：共享 orchestration core

仅在上述 GPT contract 可在重构前后以同一 fixture 全通过时允许：

```ts
interface OAuthFailoverAdapter<C> {
  provider: string;
  readConfig(): C & OAuthFailoverLimits;
  detectReason(message: unknown): OAuthFailoverReason | null;
  isCandidateUsable(account: OAuthAccountSummary, config: C): Promise<boolean>;
  bypassReason?(): string | null;
}
```

core 只负责：provider-scoped process state、budget、cooldown、circular order、Active double-check、Activate/reload、neutral result。它不得解析 ChatGPT/Grok 错误文本或 quota shape。

`lib/chatgpt-account-failover.ts` 保留原 exports、status 名称、默认值、message 和 event；GPT wrapper 外部行为不变。

#### Path B：Grok 独立 controller（安全回退）

出现任一情况即采用：

- 无法对现有 GPT controller 建立可重复行为测试；
- 抽 core 需要改变 GPT detector、status、预算时机、候选顺序、事件或 UI；
- private Pi wrapper 合并后无法证明 patch 顺序不变；
- GPT regression 有任何未解释差异。

新增 `lib/grok-account-failover.ts` 自有 provider-scoped state，并在 `rpc-manager` 增加 Grok 专用 patch；不改 ChatGPT controller/patch。可以共享纯类型或无状态 helper，但不共享会改变 GPT runtime 的 orchestration。

### 3. Grok classifier

仅接收 `grok-cli` assistant `stopReason=error`。分类顺序：

1. 先拒绝 auth/reauth、network、timeout、5xx、context/content/model errors。
2. 优先匹配上游结构化 code/type（例如经 fixture 确认的 quota/usage/rate-limit code）。
3. 再匹配脱敏规范化文本：额度/credits/monthly/weekly exhaustion，以及明确 rate-limit-exceeded / too-many-requests 语义。
4. 裸状态码或模糊包含 `limit`/`rate` 的帮助文本不触发。

返回 neutral reason 建议分成 `quota_exhausted | rate_limited`，engine 不关心差异；UI 可统一显示“限额/限流”。不能修改 GPT 的 `quota_exhausted` detector或 reason。

### 4. Grok quota/token adapter

候选要求：

- saved credential 存在且可解析；
- `GrokQuotaResultV1.success`、非 `reauthRequired`；
- live/fresh cache age 不超过配置；
- monthly remaining > 0；
- optional weekly `usedPercent < 100`；
- query error/stale/unknown 保守跳过。

`GrokAccessTokenOptions` 增加 `forceRefresh?: boolean`，`needsRefresh = forceRefresh || ...`。billing 401/403 条件加括号并只 refresh+retry 一次；不能用 `minValidityMs:0` 假装强制刷新。

若 `GROK_CLI_OAUTH_TOKEN` 等固定凭据路径实际覆盖 managed OAuth，请在 server adapter 层返回 display-safe bypass，避免“切了 metadata 但请求仍用固定 token”的假成功；不需要用户理解内部 runner。

### 5. 全局 Active 与 Session pin 退役

- `webExtensionFactories()` 不再给 main inference 加 `grokSessionAccountExtension` Authorization override。
- 删除/停用 set_model、resume、fork、destroy 和后台 child 创建中的 bind/restore/inherit/unbind。
- `SessionHeader.grokAccountStorageId?` 暂留 deprecated ignored，只为历史解析。
- inactive account 删除回归 OAuth store 原有语义，不扫描 transcript/header。
- `grok-account-token.ts` 仍用于非 Active 候选额度查询，不用于主推理 pin。

这样 manual/automatic Activate 都以 `auth.json` + live reload 为唯一权威。

### 6. Runtime retry integration

每个 provider 独立维护 turn budget 和 trigger Active snapshot。调用顺序保持：

```text
Pi native retry/compaction
  → ChatGPT existing patch（行为不变）
  → Grok failover patch（仅 provider=grok-cli）
  → OpenCode Go existing semantics（顺序需回归）
```

若 Path A 合并 wrapper，只允许在 contract tests证明同样顺序和 early-return 行为时进行。否则 Grok 外层独立 patch：对非 Grok 直接透传，不触碰 GPT result/event。

Grok `switched` / `already_switched_by_other_session`：

1. 发送 sanitized `grok_account_failover` event；
2. 确认失败 assistant 仍为最后一条且 identity 相同；
3. 移除内存失败消息并 `return true`；
4. Pi `agent.continue()` 发起新 provider call。

第二次仍失败时因 budget exhausted 不再切号。

### 7. Reload 与动态 Grok model

复用 `activateOAuthAccount()` + `reloadRpcAuthState()`。现有 reload 已遍历所有 normal live wrappers并清理 provider session resources。

Grok extension 可按 credential 改写 model descriptor。refresh 后若 wrapper 当前 model 的 provider/id 不变，应把内存 descriptor 替换为 registry 最新对象，但不得调用会持久化 `model_change` 或改变默认设置的 `setModel()`。此 helper需对 GPT/其他 provider 做 identity/no-op regression。

in-flight 请求已完成 auth/header解析，不中途换 token；下一次请求才读取新 Active。

### 8. 配置与事件

增加 `grok.autoFailover`，wire 与 ChatGPT 分开，默认：

- `enabled=false`
- `maxAttemptsPerTurn=1`
- `maxAccountSwitchesPerTurn=1`
- `quotaCacheMaxAgeMs=5m`
- `exhaustedCooldownMs=30m`
- `minSwitchIntervalMs=10s`

新 SSE `grok_account_failover` 只投影 `status/reason/retry/display-safe message`，不发送账号 id、token、path 或 raw body。ChatGPT SSE payload保持原样。

## UI 约束

- Models：`Activate/active` 表示全局当前账号，不出现 lock/pin/current-session selector。
- Settings：文案必须是“明确限额或限流”，不能继续写“普通 rate limit 不触发”这一绝对排除。
- Chat：复用现有 notice 区；只有 `retry:true` 状态显示正在重试，terminal status不伪称 retry。
- 当前 `grok-global-account-failover-prototype.html` 的 rate-limit 文案与新需求冲突，必须由 UI 设计员修订并由用户审批；生产 UI 不得依据旧文案实施。

## 兼容性与迁移

- 账号 store、quota cache 和历史 JSONL 不迁移。
- 旧客户端忽略新 config/event。
- 旧 `grokAccountStorageId` 保留但 runtime 忽略。
- 不将内部运行边界作为用户审批问题；实现必须通过现有后台 runner/provider 回归，确保其他功能不受影响。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 共享重构改变 GPT | GPT tests先行；任何差异切 Path B |
| Grok classifier 过宽导致频繁切号 | 结构化 code优先、脱敏 fixture allowlist、负例矩阵 |
| 明确限流但 quota 尚有余量 | 允许 trigger cooldown，候选仍按 quota/credential 可用性选择；单 turn只重试一次 |
| 动态 model descriptor stale | reload 后 same-identity refresh，无 `model_change` |
| 并发切成第三账号 | process lock + 两次 Active check |
| fixed token 覆盖 managed auth | server-side bypass检测，禁止假成功 |
| private Pi method升级 | 安装版本 0.80.6 contract test + typecheck |

## 回滚

1. 关闭 `grok.autoFailover.enabled`，停止后续自动切号。
2. 撤下 Grok controller/event/Settings入口；保留 GPT 原路径。
3. 如需恢复旧 pinning，可重新启用旧 extension/lifecycle；历史字段仍在。
4. 不删除账号、quota cache 或 Session JSONL。
