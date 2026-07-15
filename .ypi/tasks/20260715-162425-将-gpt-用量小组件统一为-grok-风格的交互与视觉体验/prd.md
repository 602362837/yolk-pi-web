# PRD：GPT 用量小组件统一为 Grok 风格

## 目标与背景

现有 GPT 与 Grok 顶部用量入口已经并排接入 `AppShell`，但 GPT 面板仍使用旧的英文文案、固定桌面宽度和较弱的关闭/键盘交互。用户需要两者在视觉与操作上形成一致的 provider 用量体验，同时保留 ChatGPT/Codex 的真实额度窗口、Reset credits、后台刷新 scheduler 与 lock repair。

用户价值：在顶部用相同方式判断账号、额度和刷新状态；在桌面与窄屏上都能可靠展开、关闭、刷新、切换账号和恢复登录，不需要理解两个完全不同的交互模型。

## 范围内

1. GPT 收起 pill 的视觉、中文状态、状态点、额度 ring 与 Grok 对齐。
2. GPT 展开面板的 shell、信息层级、固定视口定位、窄屏夹紧、内部滚动、外部点击关闭、Escape 关闭还焦和显式关闭按钮与 Grok 对齐。
3. 将 GPT 的 `five_hour` / `seven_day` 额度窗口以中文准确展示为“5 小时 / 7 天（周）”；提供进度条、百分比、重置倒计时。
4. 统一加载、无账号、凭据失效、无缓存、实时查询、缓存数据、刷新失败、切换中和重置中状态的中文表达。
5. 手动刷新、账号 Activate、Models 恢复入口及并发禁用反馈。
6. 保留并重新分组 GPT 专属 Reset credits、后台刷新 scheduler/lock 状态、刷新状态重载与 lock repair。
7. 复用现有配置与 API；允许抽取 provider-neutral 展示原语，禁止把 GPT schema 强转为 Grok schema。
8. 覆盖 320/375/640px 与桌面宽度、键盘、焦点、`aria-*`、进度条语义和减少动态效果偏好。

## 范围外

- 不把 GPT 的 5 小时窗口命名为月度额度，也不伪造 OpenAI 未提供的月度数值。
- 不修改 ChatGPT quota 上游请求、OAuth 凭据、账号存储、Reset credit 协议、scheduler/lock 算法或 failover 行为。
- 不为 GPT 引入 Grok 的 60 秒 fresh / 24 小时 stale cache 契约，也不新增浏览器持久化 cache。
- 不修改 Grok quota 数据语义、Grok 账号逻辑或 AppShell 中 GPT → Grok 顺序。
- 不新增 Settings 开关或改变 `chatgpt.usagePanelEnabled` 默认值。
- 不批量在浏览器中轮询所有 GPT 账号 quota。

## 需求与验收标准

### R1 收起态统一

- pill 高度、圆角、玻璃背景、展开高亮、状态点/加载 spinner 和 ring 结构与 Grok 一致。
- 品牌显示 `GPT`；状态使用中文：`加载中 / 登录 / 实时 / 已缓存 / 无缓存 / 重新登录 / 错误 / 正在刷新…`。
- 已知额度显示 `5 小时 <百分比>` 与 `周 <百分比>`；不存在的窗口不伪造数值。
- trigger 具备中文 `title`、`aria-label`、`aria-expanded`、`aria-controls`。

### R2 展开/关闭与窄屏

- 面板使用 fixed + viewport clamp，宽度不超过 `min(392px, calc(100vw - 16px))`，左右至少 8px，内容超高时内部滚动。
- 点击外部、Escape、显式关闭按钮均可关闭；Escape/关闭按钮后焦点返回 trigger。
- 320px、375px、640px 和桌面均不越界；顶部 host 保持横向访问，不把组件压缩成不可读字符。

### R3 额度与 cache 语义

- 展开态显示 `5 小时额度` 和 `7 天额度`，百分比与重置倒计时来自现有 `tiers`。
- quota GET 成功可标为“实时”；账号 metadata 的成功 `quotaCache` 标为“已缓存 · <相对时间>”。
- 不因本地时间阈值把 GPT cache 声称为 Grok 的“缓存新鲜/已过期”。
- 手动刷新失败且本页保存了同一账号的最后成功 quota 时，保留该数据并提示“刷新失败，正在展示本页上次成功数据”；切换账号必须隔离该回退。
- 无成功数据时显示明确空态，不以 0% 表示未知。

### R4 刷新与账号交互

- 挂载、前台 30 秒、窗口 focus/visibility 恢复和展开时轻量重读账号；隐藏页面不轮询。
- 普通自动重读不调用 quota 上游；手动刷新调用现有 GET quota；Activate 成功后调用新 Active 的 quota。
- 使用 AbortController 和/或 request generation 防止旧账号响应覆盖新 Active；卸载清理 timer/listener/request。
- 刷新、Activate、Reset 操作互斥或按明确规则禁用；按钮有“正在刷新…”“正在切换…”“正在重置…”反馈。
- Activate 失败保留原 Active；Activate 已成功但随后 quota 失败时准确说明“账号已切换，额度刷新失败”，不能声称回滚账号。

### R5 错误与恢复

- `expired` 显示“登录已失效，需要重新登录”；`not_found` 显示“未找到 OAuth 凭据”；`parse_error` 显示“无法读取 OAuth 凭据”；网络/API 失败显示固定中文通用文案。
- 不直接渲染服务端返回的未知 `error` / `credentialMessage` / 上游 response body；scheduler 的 `lastError` / `lastAccountError` 也只投影为固定中文运维状态，不展示路径或内部异常原文。
- 无账号、重新登录场景提供 `Models → ChatGPT` 入口；AppShell 向 GPT 面板传入打开 Models 的回调。
- 状态、错误与警告不只依赖颜色。

### R6 GPT 专属能力

- Reset credits 数量、最早过期时间、消耗确认和结果仍可用；用户可见文案全部中文。
- scheduler enabled/running/lock/next/last/error 状态仍可检查和重载；lock repair 保留风险确认。
- 这些能力位于额度与账号主路径之后的明确次级区，默认展开以保留现有运维可见性；窄屏依靠面板内部滚动，不把能力隐藏到新的持久设置中。
- GPT 专属能力不能被抽象进 Grok，也不能让 Grok 出现对应入口。

### R7 无障碍与视觉

- 所有交互使用原生 button；可见 focus ring；Enter/Space 由原生语义触发。
- 面板使用合适的 dialog/region 语义和 `aria-live="polite"`；进度条提供 `role="progressbar"` 与数值属性。
- 长账号名、masked id 单行省略并提供完整 `title`；错误可换行。
- `prefers-reduced-motion: reduce` 时关闭非必要 spinner/过渡，文字仍表达运行状态。

### R8 配置、API 与兼容性

- `chatgpt.usagePanelEnabled` 继续默认 `false`，无需新字段、迁移或 Settings 改动。
- 仅复用既有 accounts/quota/activate/scheduler API，不新增 route 或响应字段。
- Grok 面板和 Models 中 Grok/GPT quota 视图无行为回归。
- AppShell 现有单一 usage host、GPT → Grok 顺序和一次右侧留白保持不变。

## 默认决策

- **额度标签：** GPT 显示“5 小时 / 7 天（周）”，不显示伪造“月度”。
- **自动请求：** 浏览器 30 秒只重读账号 cache；quota 上游只在显式刷新或 Activate 后请求。
- **配置：** 无新增配置，现有开关默认关闭。
- **共享范围：** 只共享 provider-neutral UI 原语；provider schema、颜色阈值、cache/error 文案与专属操作保持独立。

## UI 审批门禁

必须审阅并批准任务目录内 HTML 原型后，主会话才能记录审批并进入实现。`ui.md` 只做说明，不能替代 HTML 原型。

## 未决问题（本轮审批项）

1. 是否接受“保留 GPT 数据语义优先”：用“5 小时 / 7 天（周）”替代字面上的“月 / 周”一致化？推荐接受。
2. GPT 专属 scheduler/lock 区采用默认展开的次级区，置于额度与账号之后，以避免隐藏现有运维状态；请确认这一推荐。
3. 是否接受不新增后端 stale cache schema，因此 GPT 只显示“已缓存”而不显示“缓存新鲜/已过期”？推荐接受；若必须完全一致，需要另开 API/cache 语义任务。
