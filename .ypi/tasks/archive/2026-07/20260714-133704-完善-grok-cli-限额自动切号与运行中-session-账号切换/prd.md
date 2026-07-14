# PRD：Grok CLI 全局 Active 自动轮换与运行中生效

## 目标与背景

Grok 已有多账号、额度查询和 Models `Activate`，但当前 Session 账号 pinning 会让已运行 Session 继续使用旧账号，也没有接入 ChatGPT/Codex 已有的自动切号重试生命周期。

本任务以现有 ChatGPT/Codex 的**实际源码行为**为基准：手动 Activate 只是选中当前全局 Active，不是锁定账号；当该账号随后返回可确认的限额或限流错误，且自动切号已开启时，仍要轮换到可用账号并安全重试。

## 用户价值

- 用户从 Models 激活 Grok 账号后，运行中的普通 Grok Session 无需重建即可在后续请求使用它。
- 手动激活的账号额度耗尽或被明确限流时，不会因为“刚手动选过”而阻止自动轮换。
- Grok 与 ChatGPT/Codex 的 Active、并发切号、单次重试和全局生效范围一致。
- ChatGPT/Codex 现有行为不因本任务发生变化，其他 provider 和后台流程不受影响。

## 范围内

1. Grok Models `Activate` 改变 provider 全局 Active，并 reload 普通 live Session 的 auth/model 状态。
2. 明确限额或限流错误触发 Grok 全局账号轮换和同 turn 安全重试。
3. 手动 Activate 的账号与自动选中的账号使用相同 failover 资格，不引入“锁定账号”。
4. 对齐 ChatGPT 的请求前 Active 快照、单 turn 预算、进程内并发锁、Active-changed 双检、cooldown、候选循环顺序和 reload 语义。
5. Grok 只保留 provider-specific 错误 classifier、额度候选判断和 token 强制刷新差异。
6. 停用 Grok per-session Authorization pinning；历史 `grokAccountStorageId` 保持可解析但不再生效、不迁移。
7. Settings 开关、Models 全局 Active 说明、Chat 自动切号反馈、自动与人工回归。

## 范围外

- Chat 输入区账号 selector、per-session pin/lock 或“当前 Session 专属账号”。
- 新增 Session account GET/PUT API、Session header CAS、账号引用迁移。
- 改写历史 JSONL。
- 因网络、timeout、5xx、上下文溢出、内容过滤或模型不可用而切号。
- 改变 ChatGPT detector、状态、预算、候选顺序、事件或重试行为。
- 修改 `pi-grok-cli` 上游私有实现。

## 产品语义

### 手动 Activate 不是锁定

- `Activate B` 的含义是“现在把 Grok 全局 Active 设为 B”。
- Activate 完成后，所有普通 live Grok Session 和新 Session 的**下一次 provider 请求**使用 B。
- 已经发出的 in-flight 请求继续使用发出时的 token，不中途替换。
- 若 B 随后触发明确限额/限流错误，自动切号开启时可以从 B 轮换到下一个可用账号；不得因 B 是用户手动激活而跳过 failover。

### 自动切号范围与预算

- 默认关闭；用户开启后动态生效。
- Pi 原生 retry/compaction 先执行；只有原生路径不再继续时才尝试账号 failover。
- 默认每个用户 turn 最多 1 次 failover attempt、1 次实际 switch、1 次同 turn retry。
- 一个 Session 切换全局 Active 后，其他普通 live Session 的后续请求和新 Session 也使用新 Active。
- 并发失败时，先完成切号的请求负责 Activate；后进入者发现 Active 已变化后直接使用当前 Active 重试，不继续级联切第三个账号。

### 明确限额/限流

Grok classifier 必须基于 `grok-cli` 的结构化 code/type/status 与规范化 assistant error 文本建立 allowlist：

- **应触发：** 明确额度/用量/credits/monthly/weekly exhaustion，以及明确的 provider rate-limit / too-many-requests / rate-limit-exceeded 语义。
- **不得仅凭：** 一个没有 Grok 错误语义的裸 HTTP 状态、模糊文本或网络异常。
- **不得触发：** auth/reauth、network、timeout、5xx、context overflow、content filter、model unavailable。

实现前必须用脱敏真实 fixture 或已确认的上游错误 shape 固化正负例；不能为了覆盖未知错误而使用宽泛的 `limit|rate` 正则。

## 功能需求与验收标准

### FR-1 手动 Activate 对运行中请求生效

- 继续复用现有 OAuth account Activate API。
- Activate 更新 OAuth `activeAccountId`、`auth.json`，并调用统一 live auth reload。
- 移除 Grok main inference 的 session-bound Authorization override。
- 动态 Grok model 在 registry refresh 后更新同 provider/model identity 的 descriptor，不写伪 `model_change`。

**验收：** S1/S2 均使用 Grok；A→B Activate 后，无需重建/恢复 Session，S1/S2 下一次请求均使用 B；切换前已发出的请求保持 A。

### FR-2 手动 Active 账号仍可自动轮换

- 请求开始时快照当时 Active，无论其来源是登录、手动 Activate 还是上一次 failover。
- 命中明确限额/限流时将该 trigger account 加入 cooldown并选择下一候选。
- 不存在 `manuallySelected`、`pinned`、`locked` 等绕过自动轮换的状态。

**验收：** 用户手动 Activate A 后，A 返回明确限额/限流错误，系统可切到 B 并只重试一次。

### FR-3 并发与重试对齐 GPT

- 使用 provider-scoped process lock、trigger Active 快照、锁内 Active-changed 检查和 Activate 前二次检查。
- 候选按 trigger 后的循环顺序选择；排除 trigger、cooldown、无有效凭据或额度不可确认的账号。
- `switched` 或 `already_switched_by_other_session` 才允许 retry。
- retry 前只移除仍为 agent state 最后一条且对象 identity 相同的失败 assistant。
- 成功 turn 重置预算。

**验收：** 两个 Session 同时从 A 失败时最多一次实际 A→B；两者最多各重试一次，不发生 B→C 级联。

### FR-4 Grok provider adapter

- classifier 只处理 `grok-cli` assistant `stopReason=error`。
- quota adapter 使用 `GrokQuotaResultV1`；monthly remaining > 0，若 weekly 存在则 usedPercent < 100，且缓存/查询结果在允许新鲜度内、无需 reauth。
- billing 401/403 后真正 `forceRefresh:true` 并最多重试一次。
- provider 固定 token bypass 存在时，若 managed account 不是实际请求凭据来源，则安全停止 managed failover并给出不含 secret 的说明；这是实现保护，不交给用户理解内部账号模型。

**验收：** positive/negative classifier、usable/exhausted/stale/reauth/error 候选和 force-refresh 测试全部通过。

### FR-5 UI 与反馈

- Models 说明 Activate 是全局当前账号，影响普通 live/new Session 的后续请求；不表达为锁定。
- Settings 默认关闭，文案覆盖“明确限额或限流”，每 turn 最多一次切号/重试。
- Chat 复用 retry/notice 区域展示 switched、other-session-switched、no candidate、retry exhausted 等 display-safe 状态。
- UI 不显示 token、credential path、完整 opaque storage id 或 raw upstream body。

**验收：** 用户能理解“手动 Active 仍可在限额/限流时自动轮换”；新版 HTML 原型经审批后再实现。

### FR-6 兼容与无回归

- 历史 `grokAccountStorageId` 字段保留读取兼容但 runtime 忽略。
- 不新增 Session account route，不扫描 Session 引用阻断 inactive account 删除。
- ChatGPT 现有 controller/facade/event/UI contract 全部保持。
- 如果共享重构无法通过 GPT characterization/contract/regression tests证明无行为变化，则不重构 GPT，改为 Grok 独立接入同一行为契约。

**验收：** GPT 基准测试重构前后完全一致；若走独立 Grok 路径，GPT 生产代码除必要测试 seam 外不改动。

## 非功能要求

- 不泄露 OAuth/token/account 文件路径或原始 billing body。
- 自动切号开关可即时关闭，旧配置缺字段兼容。
- 进程内并发行为与 GPT 一致，不夸大为跨进程分布式锁。
- 不直接运行 `next build` 做日常验证。

## 审批项

内部 runner、fixed-token bypass 和是否抽共享 core 都由实现证据与回归门禁决定，不要求用户选择。用户只需审批：

1. 本 PRD 的用户可见语义；
2. 修订后的全局切号 HTML 原型（当前原型仍写着“普通 rate limit 不触发”，需 UI 设计员按本 PRD 更新后再审批）。
