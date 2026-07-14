# 计划审批书：Grok CLI 自动切号对齐 ChatGPT/Codex

> 当前状态：**等待用户确认，不进入实现。** 需求方案已按最新要求修订；现有 HTML 原型的 rate-limit 文案仍需 UI 设计员更新并再次提交审批。

## 用户将获得什么

- Models 手动 `Activate` 的 Grok 账号是“当前全局 Active”，**不是锁定账号**。
- 手动激活账号随后出现明确限额或限流错误时，只要自动切号已开启，仍会轮换到可用账号并重试。
- 一个 Session 切换后，其他普通运行中 Grok Session 和新 Session 的后续请求也使用新 Active；已经发出的请求不换 token。
- 默认每个用户 turn 最多一次切号、一次重试；并发 Session 不会继续级联切第三个账号。
- 不新增当前 Session 账号 selector，不让用户理解内部 runner、header 或 token 路径。
- ChatGPT/Codex 现有自动切号行为必须保持不变，其他 provider/后台功能必须回归通过。

## 已核实的 GPT 实际行为

源码确认：

1. `activateOAuthAccount()` 只更新全局 Active 和 `auth.json`，没有“手动锁定”标记。
2. `patchChatGptAccountFailover()` 在每次 run 前快照当时 Active，不区分它是登录、手动 Activate 还是上一次自动切号产生。
3. Pi 原生 retry/compaction 结束后，命中 GPT quota/rate-limit detector 才尝试 failover。
4. 默认预算是 1 attempt / 1 switch；成功 turn 重置。
5. 进程锁内检查 Active，Activate 前再检查一次；其他 Session 已切号时直接用当前 Active重试，不切第三个账号。
6. Activate 后 reload 所有 normal live wrappers 的 auth/model registry，并清理 provider session resources；in-flight 请求不变。

因此，**GPT 手动 Active 账号触发已识别的限额/限流错误时会切换**。Grok 按此产品语义实现。

## PRD 摘要

- 范围内：Grok 全局 Activate、明确限额/限流自动轮换、manual Active 非锁定、live reload、并发保护、单次同 turn retry、历史 pin 退役、Settings/Models/Chat反馈。
- Grok 差异只保留 provider-specific classifier、monthly/weekly quota candidate 和 token force-refresh。
- 范围外：Session account selector/API、per-session lock/pin、历史 JSONL 迁移、网络/5xx等非限额故障切号、任何 GPT 行为改动。

详见 [`prd.md`](prd.md)。

## Design 摘要

### GPT 零漂移门禁

先用 characterization/contract tests锁住 GPT 当前 detector、手动 Active 后 failover、预算、候选顺序、锁、double-check、reload、消息移除、事件和 retry。

- 若同一批 GPT tests能证明共享重构前后完全一致，可抽 provider-neutral orchestration core。
- 若不能证明，立即采用 Grok 独立 controller/patch；不为“代码共享”承担 GPT 回归风险。

### Grok 接入

- 停用 main inference 的 Session Authorization pin，回到全局 Active + reload。
- classifier 覆盖经 fixture 确认的明确 quota/usage/credits/monthly/weekly 和明确 rate-limit/too-many-requests 语义；裸状态或模糊文本不触发。
- quota adapter判断 monthly/weekly、新鲜度、reauth；token实现真正 `forceRefresh:true`。
- `switched` / other-session-switched 才 retry，且只移除 identity 一致的最后失败 assistant。
- fixed-token 等内部冲突由 server安全处理，不交给用户做架构选择。

详见 [`design.md`](design.md)。

## Implement 摘要

1. 固化 GPT 现状，不先重构。
2. 退役 Grok Session pin，打通全局 Active live reload。
3. 实现 Grok 限额/限流 classifier、quota candidate、配置和 token force refresh。
4. 根据 GPT 测试证据选择 shared core 或 Grok 独立接入。
5. 按修订且已批准的 HTML 实现 Models/Settings/Chat。
6. 完成 GPT/Grok/OpenCode/后台 runner 回归、浏览器验收和文档迁移。

Implementation Plan 共 6 个子任务，最大并发 2。详见 [`implement.md`](implement.md)。

## Checks 摘要

重点反证：

- 手动 Activate A 后，A 的明确限额/限流仍可触发 A→B。
- GPT manual Activate/failover、detector、status、budget、reload、event/UI 均未变化。
- 两个 Session 同时从 A 失败，最多一次实际 switch，不切 C。
- 每 turn 只 switch/retry 一次；in-flight 不换 token。
- Grok 明确 rate-limit fixture触发，network/timeout/5xx/auth/模糊文本不触发。
- 历史 header ignored 且不迁移；UI 无 current-Session selector/锁定语义。

详见 [`checks.md`](checks.md)。

## UI 原型状态

现有 [`grok-global-account-failover-prototype.html`](grok-global-account-failover-prototype.html) 已体现全局 Active、单次重试和无 Session selector，但 Settings 明确写着“普通 429、rate limit 不触发”，与最新“明确限额/限流必须自动轮换”冲突。

因此它当前**不可作为最终批准版本**。UI 设计员需做最小修订：

- 开关/说明改为“明确限额或限流时自动切换”；
- 说明 manual Active 不等于锁定；
- 保留裸/模糊状态不触发、网络/timeout/5xx/auth不触发；
- Chat 成功/无候选文案覆盖“限额/限流”。

旧 Session-selector 原型仍为 [`grok-session-account-switch-prototype.superseded.html`](grok-session-account-switch-prototype.superseded.html)，不得使用。

## 需要用户确认

用户无需选择 shared core、内部 runner 或 token 实现策略。请只确认：

1. 是否批准本审批书中的产品语义和实施计划；
2. UI 设计员提交修订 HTML 后，是否批准该原型。

## 审批门禁

- [x] GPT 实际源码语义已核对并写入 Design。
- [x] PRD/Design/Implement/Checks 已按最新要求修订。
- [ ] UI 设计员已修订 `grok-global-account-failover-prototype.html` 的限流文案。
- [ ] 用户明确批准修订后的 HTML。
- [ ] 主会话已保存 [`implement.md`](implement.md) 中的 implementationPlan。
- [ ] 用户明确批准本计划审批书。

**当前保持 `awaiting_approval`，不得进入 implementing。**
