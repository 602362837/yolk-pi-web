# Design — ChatGPT 额度耗尽自动切换可用账号

## 核心模块
新增 `lib/chatgpt-account-failover.ts`，集中处理：
- usage limit 错误识别；
- 进程内全局互斥；
- exhausted/cooldown 状态；
- 候选账号选择；
- 激活账号并调用 `reloadRpcAuthState()`；
- 返回结构化结果给 `AgentSessionWrapper` 发事件和决定 retry。

## 错误识别
触发条件必须同时满足：
1. 当前 session model provider 为 `openai-codex`；
2. assistant message `stopReason === "error"`；
3. `errorMessage` 命中明确 usage limit：
   - `You have hit your ChatGPT usage limit`
   - `usage_limit_reached`
   - `usage_not_included`
   - `GoUsageLimitError` / `FreeUsageLimitError`
   - `Monthly usage limit reached`
   - `quota exceeded` / `insufficient_quota` 仅限 Codex provider
4. 单纯 `429`、`rate_limit_exceeded`、`too many requests` 不直接触发；若只出现这些模糊信号，必须刷新当前账号 quota 并确认关键 tier 近满后才触发。

## 多 session 并发保护
使用 `globalThis.__piChatGptAccountFailover` 保存：
```ts
{
  mutex: Promise<void> | null;
  lastSwitchAt: number | null;
  lastFromAccountId?: string;
  lastToAccountId?: string;
  exhaustedUntilByAccountId: Map<string, number>;
  recentSwitches: Array<{ at; from; to; sessionId; reason }>;
}
```

所有切号请求进入同一个 mutex 串行执行。每个请求进入锁前必须捕获 `triggerAccountId`（即该 session 发生 usage limit 时实际使用的 active account）。拿到锁后必须重新读取当前 active account，并执行以下硬规则：

1. **active changed guard**：如果当前 active account 已经不是 `triggerAccountId`，说明别的 session 已完成切号；本请求必须返回 `already_switched_by_other_session`，不得再选择候选、不得再调用 `activateOAuthAccount`。当前 session 可在 attempt budget 允许时直接 retry 一次，让它使用别人已经切好的新 active account。
2. **same trigger only**：只有当锁内重新读取的 active account 仍等于 `triggerAccountId` 时，才允许继续确认 quota、选择候选并切号。
3. **double-check before activate**：候选选好、调用 `activateOAuthAccount` 前再读取一次 active account；如果此时 active 已变化，同样返回 `already_switched_by_other_session`，避免锁内异步 quota refresh 期间外部手动切号或其他路径改动 active。
4. **no cascade switch**：`already_switched_by_other_session` 分支只能 retry，绝不能“基于新 active account 再切下一号”。例如 session1/session2 同时在账号 A 限额：session1 拿锁切 A→B；session2 后拿锁看到 active=B、trigger=A，必须停止切号并 retry，不能继续 B→C。
5. **manual switch respect**：如果用户手动把 active 从 A 切到 B，后续等待锁的 session 也按 `already_switched_by_other_session` 处理，不覆盖用户选择。

若距离上次切号小于 `minSwitchIntervalMs`，不再次切号；如果 active 已变更可 retry，否则返回 throttled。切号成功后记录 exhausted account 的 cooldown，避免其他 session 立刻切回。

## 防无限切号/无限 retry
每个 `AgentSessionWrapper` 维护当前 turn 的 failover state：
- `turnId` / `message timestamp`；
- `triggerAccountId`；
- `attempts`；
- `switchedAccountIds`；
- `exhaustedAccountIds`。

约束：
- 每个 assistant error turn 最多 `maxAttemptsPerTurn` 次 failover retry，默认 1。
- 每个 turn 最多 `maxAccountSwitchesPerTurn` 次真正切号，默认 1。
- `already_switched_by_other_session` 计入 retry attempts，但不计入 switch count。
- 候选账号排除当前 turn 已尝试/已耗尽账号。
- 全局 exhausted cooldown 到 `resetsAt`；无 resetsAt 使用 `exhaustedCooldownMs`。
- retry 后如果仍 usage limit，不再继续循环，展示最终错误。

## 候选账号选择
1. `listOAuthAccounts("openai-codex")` 获取账号，排除 active、软删除/不存在、当前 turn 已尝试、global cooldown 内账号。
2. quota cache 新鲜且可用：`success=true`，认证状态非 expired，关键 tiers `utilization < 100`。
3. cache 过期/缺失时按顺序调用 `getOAuthAccountSubscriptionQuota(provider, accountId)`，但每次 failover 最多刷新少量候选，避免 usage API 风暴。
4. 排序：优先 utilization 更低，其次 lastActivatedAt 更久远，再按列表顺序。
5. 不自动使用 reset credit；若账号只有 reset credit 可用但 tiers 满，MVP 仍视为不可用。

## 激活和刷新
候选选中后：
1. 调 `activateOAuthAccount("openai-codex", accountId)`；
2. 调 `reloadRpcAuthState()`，复用现有 authStorage reload、modelRegistry refresh、`cleanupSessionResources()`；
3. 发 `chatgpt_account_failover` SSE 事件，包含 from/to masked id、reason、retry。

## Retry 接入点
优先在 `AgentSessionWrapper` 层接入，而不是 extension：
- wrapper 能看到 live event、session/model、auth reload，并可统一发 SSE 事件。
- 在 `message_end` 记录最后 assistant error；在 `agent_end` 且确定不会由 pi 内置 auto-retry/compaction 处理时，执行 failover。
- retry 前从 agent state 移除最后一条 assistant error（与 pi auto-retry 类似），然后调用 `inner.agent.continue()` 或封装方法继续当前 turn。
- 不重放已完成工具；只从失败 LLM 调用前的上下文继续，因此避免重复危险工具。

若直接调用 `inner.agent.continue()` 类型不稳定，需扩展 `AgentSessionLike` 类型或在 wrapper 内做安全 guard。