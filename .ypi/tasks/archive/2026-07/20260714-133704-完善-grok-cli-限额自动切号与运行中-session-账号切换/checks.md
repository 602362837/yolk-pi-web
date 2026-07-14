# Checks：Grok 全局 Active 自动切号与 GPT 零回归


## 检查员执行记录

检查时间：2026-07-14（检查员 delegated review）

### 前置门禁（实现阶段回顾）

- [x] UI 设计员已修订 HTML（明确限额/限流，manual Active 非锁定）
- [x] 用户已批准计划与最终 HTML（events: User approved Studio plan）
- [x] 主会话进入 implementing 并按 Path B 实现
- [x] 实现未改 GPT 生产 controller（`lib/chatgpt-account-failover.ts` MD5 与 HEAD 一致）

### 自动验证（检查员实跑）

- [x] `npm run test:chatgpt-failover-contract`（25 passed）
- [x] `npm run test:grok-global-auth`（7 passed）
- [x] `npm run test:grok-failover-adapter`（29 passed）
- [x] `npm run test:grok-failover-runtime`（9 passed）
- [x] `npm run test:opencode-go-failover-behavior`（54 passed）
- [x] `npm run test:opencode-go-failover-detect`（59 passed）
- [x] `npm run test:studio-sdk-runner`
- [x] `npm run test:grok-provider` / `accounts` / `quota` / `session-isolation` / `oauth-accounts`
- [x] `npm run lint`（0 errors）
- [x] `node_modules/.bin/tsc --noEmit`

### 静态反证重点

- [x] 手动 Activate 无 lock 字段；Grok failover 无 `manuallySelected`/`pinned`/`locked` 门禁
- [x] 明确 quota + rate-limit fixture 触发；network/timeout/5xx/auth/裸 429/模糊文本不触发
- [x] Path B：独立 `__piGrokFailover`；链 grok→opencode-go→chatgpt→pi
- [x] pin 退役：webExtensionFactories 仅 grokCli；rpc/studio 无 bind/restore/unbind
- [x] SSE 不投影 account id；Settings/Models/Chat 文案对齐批准原型
- [x] 检查员修复 Settings `ToggleField` switch a11y

### 仍待人工（主会话/用户）

- [ ] 真实双 Session 手动 Activate / 限额 / 限流 / 并发 / in-flight 浏览器走查
- [ ] 恢复带旧 `grokAccountStorageId` 的 Session 使用当前全局 Active
- [ ] ChatGPT 手动 Activate + eligible error 与改动前行为一致（自动化已锁，建议抽查 UI）

## 前置门禁

- [ ] UI 设计员已修订 `grok-global-account-failover-prototype.html`，不再排除所有 rate limit。
- [ ] 用户已批准修订 HTML；旧 `.superseded.html` 未被使用。
- [ ] 用户已批准 [`plan-review.md`](plan-review.md)。
- [ ] 主会话已保存 implementationPlan并显式进入 implementing。
- [ ] 未满足以上条件不得实现或声称审批完成。

## GPT 源码基准确认

- [ ] `activateOAuthAccount()` 无 manual lock/pin字段，只更新 Active与 `auth.json`。
- [ ] `_runAgentPrompt` 前快照当前 Active，不区分手动/自动来源。
- [ ] Pi original `_handlePostAgentRun()` 的 retry/compaction先于 Web failover。
- [ ] 当前 GPT detector golden fixtures与源码 regex一致。
- [ ] 默认 1 attempt / 1 switch，成功非 error turn重置。
- [ ] process lock、trigger cooldown、min interval、锁内 Active check、Activate前 double-check被测试覆盖。
- [ ] Activate后调用 `reloadRpcAuthState()`；所有 normal live wrappers reload auth/refresh registry并 cleanup provider resources。
- [ ] retry只移除 identity一致的最后失败 assistant，再由 Pi `agent.continue()`继续。

## GPT 零回归门禁

- [ ] `chatgpt-account-failover.ts` 公开 exports兼容。
- [ ] ChatGPT provider gate、default-off、detector正负例不变。
- [ ] manual Activate A后 eligible GPT error仍按原行为 A→B。
- [ ] status/reason/message/retry result不变。
- [ ] budget mutation和success reset时机不变。
- [ ] circular candidate order、fresh cache/query、cooldown、min interval不变。
- [ ] `already_switched_by_other_session` 仍 retry且不级联。
- [ ] reload调用次数与失败处理不变。
- [ ] `chatgpt_account_failover` SSE和现有 Chat UI不变。
- [ ] OpenCode Go wrapper顺序和行为无回归。
- [ ] 若任一项无法证明，已选择 Grok独立 Path B，未强行共享 GPT runtime。

## Grok 需求覆盖

### 手动 Activate 非锁定

- [ ] Models A→B只设置全局 Active，不写 lock/pin/manual override。
- [ ] 两个 normal live Grok Session下一请求均使用 B。
- [ ] 新 Session使用 B。
- [ ] 切换前已发出的请求继续使用 A，不中途换 token。
- [ ] 用户手动 Activate B 后，B出现明确限额错误可自动 B→C。
- [ ] 用户手动 Activate B 后，B出现明确限流错误可自动 B→C。
- [ ] 自动切号来源不检查 `manuallySelected`/`locked`/Session header。
- [ ] Activate/reload不追加额外 `model_change`，provider/model identity不变。
- [ ] dynamic Grok model descriptor在refresh后为最新 baseUrl/headers。

### 明确限额/限流 classifier

- [ ] 只处理 `grok-cli` assistant `stopReason=error`。
- [ ] 结构化 provider code/type优先于文本。
- [ ] quota/usage/monthly/weekly/credits exhaustion fixture触发。
- [ ] 明确 rate-limit-exceeded fixture触发。
- [ ] 明确 too-many-requests fixture触发（仅限已确认 Grok error shape）。
- [ ] 裸 HTTP status、无 Grok语义的模糊 `limit`/`rate` 文本不触发。
- [ ] auth/reauth、network/fetch、timeout、5xx、context overflow、content filter、model unavailable不触发。
- [ ] classifier不使用宽泛 `/limit|rate/`。
- [ ] 未修改 GPT detector来容纳 Grok错误。

### 自动 failover预算与并发

- [ ] `grok.autoFailover.enabled` 默认 false，旧 config兼容。
- [ ] request/run前捕获 trigger Active。
- [ ] Pi native retry/compaction不继续后才运行 Grok failover。
- [ ] 每 turn默认最多 1 attempt、1 actual switch、1 retry。
- [ ] trigger account进入 cooldown并被候选排除。
- [ ] candidate从 trigger后循环，顺序确定。
- [ ] `switched` / `already_switched_by_other_session` 才 retry。
- [ ] no candidate/budget/failed不伪称 `Retrying`。
- [ ] Session A切号后，Session B后续请求使用新全局 Active。
- [ ] 两 Session同时从 A失败，只发生一次实际 A→B；后进入者不切 C。
- [ ] Active在锁后检查或Activate前检查发生变化时均不继续切号。
- [ ] failed assistant只在最后一条且对象 identity相同时移除。
- [ ] retry再次失败时预算耗尽，不继续切号。
- [ ] success turn重置预算，下一用户 turn可再次failover。

### 候选与 token

- [ ] credential missing/invalid候选被排除。
- [ ] monthly remaining > 0才可用。
- [ ] optional weekly usedPercent >=100被排除。
- [ ] stale超龄、reauthRequired、query error/none被排除。
- [ ] fresh cache优先，必要时查询额度。
- [ ] `forceRefresh:true` 对未过期 token也执行 refresh。
- [ ] billing 401/403最多 refresh + retry一次，条件括号正确。
- [ ] 非 Active候选刷新不会覆盖当前 `auth.json` mirror。
- [ ] fixed env token覆盖managed auth时不报告假 switch/retry成功，反馈不含 secret。

### Session pin退役与兼容

- [ ] `grokSessionAccountExtension` 不再覆盖 main inference Authorization。
- [ ] set_model/resume/fork/destroy/后台 child创建不再 bind/restore/inherit/unbind Grok账号。
- [ ] 历史 `grokAccountStorageId` 可解析但不影响 auth。
- [ ] 新 Session不写该字段。
- [ ] inactive account删除不扫描 transcript/header引用。
- [ ] Active account仍受 OAuth store保护。
- [ ] 历史 JSONL未迁移/重写。

## 接入策略检查

### 若采用 Path A shared core

- [ ] core无 ChatGPT/Grok classifier或quota shape分支。
- [ ] provider锁/cooldown/lastSwitchAt相互隔离。
- [ ] GPT同一 fixture在抽取前后全部通过。
- [ ] GPT facade/status/event/message保持。
- [ ] code review无“顺便修 GPT”改动。

### 若采用 Path B Grok独立接入

- [ ] `lib/chatgpt-account-failover.ts` 生产逻辑保持原样或仅有无语义 test seam。
- [ ] Grok patch对非 `grok-cli` 直接透传。
- [ ] 独立 Grok state不影响 GPT cooldown/lock。
- [ ] 行为契约由 Grok tests覆盖，不依赖复制后目测。

## UI / 隐私

- [ ] Models明确 global Active、manual Active非锁定、in-flight边界。
- [ ] Settings使用“明确限额或限流”，默认关闭。
- [ ] UI未保留“普通 rate limit 一律不触发”的旧绝对文案。
- [ ] Chat无 current Session selector/chip/pin/lock提示。
- [ ] only retry=true显示正在重试；terminal notice可读。
- [ ] `role=status` / `aria-live` / toggle键盘操作符合批准原型。
- [ ] ≤640px不溢出。
- [ ] API/SSE/UI/log不含 token、refresh token、credential path、raw billing body、完整 opaque id。
- [ ] quota/account responses保持 `no-store`。

## 必测 fixtures

### GPT golden（必须保持现状）

- 当前源码已匹配的 quota/usage/`codex_rate_limits`/`rate limit reset credit`。
- 当前源码不匹配的裸 generic rate文本保持不变。
- 手动 Activate A后 eligible error切到 B。

### Grok positive

- `insufficient_quota`
- `quota exceeded`
- `monthly usage limit reached`
- `weekly usage limit reached`
- `credits exhausted`
- 经上游 shape确认的 `rate_limit_exceeded`
- 经上游 shape确认的 `too many requests`

### Grok negative

- 裸 429无 provider错误语义
- 包含 `limit`/`rate` 的帮助文本或模型说明
- network/fetch failed/timeout
- 500/502/503
- 401/403 authentication/reauth
- context overflow/content filter/model unavailable

### 候选/并发

- fresh usable / monthly exhausted / weekly exhausted / stale / reauth / missing / query error / none
- 两 Session同时从 A失败
- 请求进行中手动 A→B
- Active在第二次检查前变化
- Activate/reload throw
- failed assistant后被其他消息追加，不能误删
- success turn budget reset
- GPT/Grok process state互不影响

## 自动验证

```bash
npm run test:chatgpt-failover-contract
npm run test:grok-provider
npm run test:grok-accounts
npm run test:grok-quota
npm run test:grok-global-auth
npm run test:grok-failover-adapter
npm run test:grok-failover-runtime
npm run test:grok-all
npm run test:opencode-go-failover-detect
npm run test:opencode-go-failover-behavior
npm run test:studio-sdk-runner
npm run lint
node_modules/.bin/tsc --noEmit
```

## 人工验收

1. 保存 Grok A/B/C，手动 Activate A，开启 Grok自动切号。
2. 打开两个 normal live Grok Session S1/S2，确认后续请求均用 A。
3. 在 Models手动 Activate B，不刷新/恢复 Session；确认 S1/S2下一请求均用 B。
4. 在请求已发出时 Activate，确认当前请求不变、下一请求生效。
5. 让手动 Active B返回明确 quota error，确认全局 B→C并只重试一次。
6. 重置后让手动 Active B返回确认的 rate-limit error，确认同样 B→C并只重试一次。
7. S1/S2并发失败，确认只一次实际 switch，另一 Session不切第三账号。
8. 模拟 network/timeout/5xx/auth/模糊文本，确认不切号。
9. 恢复带旧 `grokAccountStorageId` 的 Session，确认使用当前全局 Active。
10. 回归 ChatGPT手动 Activate + eligible error自动切号，确认结果、事件、UI与改动前一致。

## 回归重点

- ChatGPT manual Activate、auto failover、usage panel、warmup不受影响。
- OpenCode Go failover/disable语义不受影响。
- Grok provider bootstrap、model registry refresh、quota API、Cursor tools可用。
- `cleanupSessionResources()` 对 OpenAI Codex WebSocket仍生效。
- Web/CLI复用同一 normal wrapper路径时行为一致。
- 现有后台 runner/session JSONL读取不因 deprecated field报错。
- 不使用 `next build` 做日常验证。
