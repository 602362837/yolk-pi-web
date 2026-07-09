# UI — opencode-go auto failover 与账号启用/禁用

## 是否触发 UI 原型门禁

**触发，且本次已纳入 UI 范围。**

原因：本次包含 Settings 开关、账号启用/禁用操作、自动切换策略说明、账号状态展示与 Chat failover 提示，均属于用户可见信息结构/交互变化。

HTML 原型已补齐，且支持交互式模拟：

- [opencode-go-failover-ui.html](./opencode-go-failover-ui.html)

当前审批状态：

- HTML 原型：已产出交互式原型，提供自动禁用、并发防级联、无候选 Key 等状态切换模拟。
- 用户审批：未记录；进入实现前需要主会话/用户确认。

## 页面 / 组件范围

### Settings → OpenCode Go managed API keys

- `OpenCode Go auto failover` 开关，默认关闭。
- 策略说明：
  - 仅在明确额度/余额/月度限制、billing/quota 错误，或账号永久不可用（Invalid/Missing API key）时切换。
  - 普通 429/rate limit、网络错误、5xx 不切换，会交给原生 retry/错误展示。
  - 切换会修改全局 active key，影响所有 live session。
  - 每 turn 默认最多 1 次 retry / 1 次实际切号。
- 只读状态摘要：enabled/disabled、cooldown 窗口、最后一次 failover 结果（可选）。

### 账号列表

每个 managed `opencode-go` account 显示：
- display name / masked preview / active tag。
- enabled 或 disabled 状态。
- disabled reason：例如 `Account unusable: Invalid API key`、`Manually disabled`。
- 操作：
  - Enable：重新允许该账号手动激活或参与 failover。
  - Disable：使账号不可参与 failover，也不可被设为 active。
  - Activate：仅 enabled 账号可用；disabled 账号的 Activate 按钮禁用并提示先 Enable。

### 手动禁用 active 账号

- UI 必须避免 disabled 账号继续作为 active。
- 推荐交互：
  - 若禁用非 active：直接确认即可。
  - 若禁用 active 且存在其他 enabled 账号：要求选择替代 active 或确认禁用后自动切换。
  - 若禁用 active 且无其他 enabled 账号：显示高风险确认，说明将清空 active key / 后续请求无法使用 managed key。

### Chat failover 提示

显示轻量系统提示，不泄露 plaintext API key：
- `OpenCode Go account switched: Work Key → Backup Key. Retrying…`
- `OpenCode Go account disabled: Work Key (Invalid API key). Switching…`
- `Another session already switched OpenCode Go account. Retrying with current active account…`
- `No enabled OpenCode Go account is available.`

## HTML 原型说明

原型文件 [opencode-go-failover-ui.html](./opencode-go-failover-ui.html) 覆盖并支持交互式模拟：
1. **自动账号切换 (Auto Failover)**：可开启/关闭该全局策略。
2. **账号状态与卡片交互**：包含 active、enabled、disabled 状态卡片。在禁用账号时提供激活拦截。
3. **禁用 active 账号**：触发 Modal，强制要求选择替代账号（如“备用救援 Key”）或清空 active。
4. **状态与异常匹配模拟**：
   - 额度不足 (Quota Exhausted)：模拟触发 cooldown 并自动轮换到可用 Key；关闭开关时则提示终止。
   - 永久无效 Key (Unusable Key)：模拟 `Invalid API key` 导致该 Key **被自动持久标记为 disabled**，并切换到下一个可用 Key 重试。
   - 并发锁竞争 (Concurrent Conflict)：模拟 Session 1 与 Session 2 同时发生 Work Key 失败时，Session 1 成功切换，Session 2 获得锁后**检测到已被切换而不发生级联切换 (Backup -> Old)**，直接重试当前最新的 active 账号。
   - 无候选 Key (No Candidates)：模拟在无可切换的可用 Key 时，系统提示失败重试预算已耗尽，并正常报错提示。

## 实现门禁

- 必须先审批 HTML 原型。
- 不展示 plaintext API key。
- 文案必须明确全局 active-key 副作用。
- disabled 账号语义必须与后端一致：不可候选、不可激活、启用后才恢复。