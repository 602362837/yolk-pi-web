# UI：Grok 全局 Active 与明确限额/限流自动切号

## 原型门禁状态

本任务改变 Models/Settings/Chat 的用户可见语义，继续触发 UI HTML 原型门禁。最终修订、自包含原型为：

- [`grok-global-account-failover-prototype.html`](./grok-global-account-failover-prototype.html)

本版本已按最新要求完成最小修订：明确手动 Activate 只是全局当前 Active、不是锁定；命中明确 Grok 限额或限流时仍可自动轮换并重试；保留模糊状态、网络/timeout/5xx/auth 等非限额故障不触发，并保持全局 Active、in-flight 不变、单次重试和无 Session selector。

旧 [`grok-session-account-switch-prototype.superseded.html`](./grok-session-account-switch-prototype.superseded.html) 仍只作历史对照，不得实现。

## UI 设计员修订结果

已在不新增页面/selector的前提下完成 [`grok-global-account-failover-prototype.html`](./grok-global-account-failover-prototype.html) 的最小修订：

1. Settings 开关标题为“明确限额或限流时自动切换可用账号”。
2. Models 与顶部设计说明明确：手动 Activate 只是当前全局 Active，不是锁定；后续明确限额/限流仍可自动轮换。
3. 触发条件展示 provider code/type 或确认错误文案识别的 quota/usage/credits/monthly/weekly exhaustion 与 rate-limit/too-many-requests。
4. 排除条件保留裸/模糊状态、network、timeout、5xx、auth/reauth、context/content/model 错误，不再绝对排除所有 rate limit。
5. Chat 的成功、无候选、重试耗尽状态统一覆盖“限额/限流”，且 terminal 状态不伪称正在重试。
6. Settings 保留全局范围、in-flight 不变、每 turn 最多一次切号/重试和并发不级联说明。
7. 未展示 token、credential 路径、完整 opaque id 或 raw upstream body；固定凭据 bypass 仅给出面向用户的处理提示。

## 页面与交互要点

### Models

- 账号行保留 `Activate / active`。
- 全局说明：所有普通运行中 Session和新 Session的后续请求使用当前 Active。
- 补充：manual Active不是 lock，开启自动切号后仍可能因明确限额/限流被轮换。
- loading期间禁止重复 Activate；in-flight请求不换 token。

### Settings

- Grok自动切号默认关闭。
- 开启后只处理明确限额/限流，每 turn最多一次 switch/retry。
- 文案区分“确认的 provider limit error”和“裸/模糊/非限额故障”。

### Chat

- 不新增账号 chip、selector或绑定提示。
- 复用 retry/notice banner。
- `switched`、other-session-switched可显示正在重试；no candidate、budget exhausted、failed为终态提示，不伪称 retry。

## 状态演示

原型左侧“状态场景”可与 Models/Chat 页面组合查看以下状态：

| 状态 | 原型反馈 |
| --- | --- |
| 默认 Active A | 展示全局当前账号与后续请求范围 |
| 手动 Activate B 中 | 禁用 Activate，说明 in-flight 仍使用 A |
| 手动 Active B 触发明确限额 | B → C，明确说明不是锁定并只重试一次 |
| 手动 Active B 触发明确限流 | B → C，明确说明不是锁定并只重试一次 |
| 另一 Session 已先切号 | 复用新 Active，不级联切第三账号 |
| 无可用账号 | 限额/限流终态，不显示正在重试 |
| 候选需重新登录 | 候选排除并引导 Models 重新登录 |
| 本 turn 重试耗尽 | 限额/限流终态，不继续切号 |
| 固定凭据 bypass | display-safe 提示，不显示 token |
| 请求进行中（in-flight） | 当前请求保持旧账号，下一请求使用新 Active |

另有 Settings 文案明确展示：裸/模糊状态、网络、timeout、5xx、auth/reauth、context/content/model 错误不会触发自动切号。

## 可访问性与响应式

- banner使用 `role="status"` / `aria-live`；终态错误按现有组件语义处理。
- toggle使用 `role="switch"` / `aria-checked`；loading按钮disabled。
- 键盘、焦点样式、reduced motion、明暗主题保持现有原型能力。
- ≤640px账号行、quota、Settings说明、Chat banner不横向溢出。

## 用户审批请求

请主会话将最终原型 [`grok-global-account-failover-prototype.html`](./grok-global-account-failover-prototype.html) 作为审批入口，请用户只确认：

1. 手动 Active 非锁定，明确限额/限流会自动轮换并重试，表达是否清楚；
2. 全局生效范围与 in-flight 边界是否清楚；
3. Chat 不提供当前 Session selector，只显示自动处理反馈；
4. 默认关闭、每 turn 最多一次切号/重试、并发不级联是否清楚。

**用户批准该 HTML 前，不得进入 UI 生产实现。**

## UI Checks

- [x] Settings 已改为明确限额/限流，不再绝对排除所有 rate limit。
- [x] manual Active 非锁定语义可见。
- [x] 明确 quota 与明确 rate-limit 成功状态均有演示。
- [x] Chat 无 current Session selector/chip。
- [x] global/in-flight/single-retry/并发不级联边界保留。
- [x] terminal notice 不显示 Retrying。
- [x] 原型保留窄屏、键盘、读屏、主题和 reduced-motion 设计。
- [x] 示例不含真实账号/凭据/token/path/raw body。
- [ ] 用户批准最终 HTML 后，才可进入 UI 生产实现。
