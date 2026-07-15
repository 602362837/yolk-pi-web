# UI 方案：GPT 用量小组件统一为 Grok 风格

## UI Summary

### 设计目标

- 让 GPT 与 Grok 顶部用量入口使用同一套 pill、状态点、额度环、固定视口弹层、关闭方式和中文反馈。
- 保留 GPT 的真实数据语义：收起态为“5 小时 / 周”，展开态为“5 小时额度 / 7 天额度”；绝不把 `five_hour` 命名成月度。
- 把额度查看、刷新、恢复登录、账号切换作为通用主路径；把 Reset credits、scheduler、lock repair 放入明确的“GPT 专属工具”次级区。
- 不新增配置，不修改 API/schema，不引入 Grok 的 fresh/stale TTL 语义。

### 用户路径

1. 用户从顶部 GPT pill 扫读中文状态、5 小时额度与周额度。
2. 点击 pill 展开面板；打开时保留已有内容，仅轻量重读账号 metadata/cache 与 scheduler 状态。
3. 在“额度与账号”主区确认 Active 账号、数据来源、更新时间、5 小时/7 天使用率与重置倒计时。
4. 可手动刷新当前 Active 账号；失败时若同一账号有本页成功数据，则保留数据并显示“刷新失败，正在展示本页上次成功数据”。
5. 可将其他账号“设为 Active”；切换成功后刷新新账号额度，旧账号响应不得覆盖新 Active。
6. 无账号或 OAuth 凭据失效时，通过“打开 Models → ChatGPT”恢复。
7. 有 Reset credits 时，可在 GPT 专属区确认后消耗一次；可查看 scheduler/lock，并在确认风险后 repair stale lock。
8. 点击关闭按钮、面板外部或按 Escape 关闭；Escape 与关闭按钮将焦点还给 GPT trigger。

### 信息架构

1. **顶部收起态（通用）**：`GPT` → 中文状态点/加载 spinner → `5 小时` ring → `周` ring。
2. **面板头部（通用）**：标题、数据来源、更新时间、刷新、关闭。
3. **恢复/反馈（通用）**：加载骨架、无账号、重新登录、无缓存、固定安全错误、本页成功数据回退。
4. **Active 账号（通用）**：名称、masked id、备注、Active 标识。
5. **额度（通用）**：5 小时额度、7 天额度；进度、百分比、重置倒计时。
6. **账号（通用）**：全局 Active 说明、账号列表、切换反馈、Models 管理入口。
7. **GPT 专属工具（次级）**：Reset credits；后台自动刷新 scheduler/lock 状态、重载、lock repair。
8. **底部说明**：页面可见时每 30 秒只重读账号缓存，不自动请求上游 quota。

## HTML Prototype

自包含、可交互原型：

- [打开 GPT Grok 风格用量面板原型](./gpt-usage-panel-grok-style-prototype.html)

原型顶部提供状态与视口切换，覆盖实时、已缓存、刷新失败保留本页成功数据、无缓存、无账号、重新登录、加载，以及桌面/375px/320px。可操作 GPT trigger、手动刷新、账号切换、Reset credits、scheduler 重载、lock repair；支持关闭按钮、Escape 和外部点击。

## Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 初次加载 | pill 显示“加载中”与 spinner；面板显示骨架 | 等待或关闭 | 完成后映射为账号/cache 的真实状态；不以 0% 表示未知 |
| 实时成功 | 绿色状态点，“实时”；展示两个真实窗口 | 查看、刷新、切换账号 | 更新时间更新；进度条与百分比同步 |
| 已缓存 | “已缓存 · 相对时间”，不标 fresh/stale | 可手动刷新 | 成功变为“实时”；失败进入本页回退或空错误态 |
| 无缓存 | 空环与“无缓存”；额度区明确未知 | 手动刷新 | 成功显示实时数据；失败显示安全通用错误 |
| 刷新失败且同账号有本页成功数据 | 黄色提示“刷新失败，正在展示本页上次成功数据”并保留额度 | 再次刷新 | 不清空成功数据，不称为服务端 stale cache，不跨账号回退 |
| 无 Active 账号 | “登录”；无账号空态 | 打开 Models → ChatGPT | 关闭面板并进入现有 Models 账号入口 |
| OAuth 失效 | “重新登录”；固定中文凭据说明 | 打开 Models → ChatGPT | 不展示上游 body、token、路径或内部异常 |
| 手动刷新 | “正在刷新…”；刷新/切换/Reset 互斥禁用 | 等待或关闭 | 完成后 polite 通知；关闭不改变 API 语义 |
| 账号切换 | 目标按钮显示“正在切换…” | 等待 | 失败保留原 Active；Activate 成功但 quota 失败时说明“账号已切换，额度刷新失败” |
| Reset credits | 显示数量与最早过期时间 | 点击“使用一次”并确认 | 取消不写入；确认后显示“正在重置…”，成功更新数量/额度 |
| scheduler 正常 | enabled/running、next/last、lock 文本状态 | 重载状态 | 仅重读现有 scheduler 状态 API |
| lock stale | 警告说明与 repair 操作 | 风险确认后修复 | 取消无操作；修复中禁用；结果用文字反馈 |
| 关闭 | 面板打开 | 关闭按钮 / Escape / 外部点击 | 面板关闭；Escape/关闭按钮还焦 trigger |
| 长账号内容 | 单行省略，保留完整 `title` | 悬停/聚焦 | 可获得完整名称与 masked id |
| 窄屏 | 面板左右 8px，宽度 `min(392px, 100vw - 16px)`，内部滚动 | 横向滚动顶部、展开/关闭 | 320/375px 不越界，额度卡改为单列 |

## 文案与安全映射

- `expired`：登录已失效，需要重新登录。
- `not_found`：未找到 OAuth 凭据。
- `parse_error`：无法读取 OAuth 凭据。
- 网络/API 失败：无法刷新 GPT 额度，请稍后重试。
- 同账号本页回退：刷新失败，正在展示本页上次成功数据。
- Activate 失败：切换全局 Active 失败，已保留当前账号。
- Activate 已成功、quota 失败：账号已切换，额度刷新失败。可稍后重试。
- 未知服务端 `error`、`credentialMessage`、scheduler 内部异常不得原样渲染；只显示 allowlist 后的安全中文文案。

## Responsive / Accessibility

- 面板生产实现采用 `position: fixed`，触发器右对齐后夹紧至视口；左右 gutter 不少于 8px，宽度不超过 `min(392px, calc(100vw - 16px))`。
- 最大高度按可用视口夹紧，面板自身为唯一纵向滚动区；顶部 host 保持横向滚动与现有一次右侧安全留白。
- 320/375px 下额度卡单列；账号行保留操作按钮，名称与 masked id 省略；不把 pill 压缩为单字。
- trigger 使用 `aria-expanded`、`aria-controls`；面板使用 `role="dialog"`、中文 `aria-label`、`aria-live="polite"`。
- 所有操作为原生 `button`；Enter/Space 使用原生行为；可见 `:focus-visible`；关闭按钮与 Escape 还焦。
- 进度条提供 `role="progressbar"`、中文 `aria-label`、`aria-valuemin/max/now`；未知额度不设置伪造的 0。
- 状态同时使用文字、图标/状态点和色彩；错误可换行。
- `prefers-reduced-motion: reduce` 关闭 spinner、骨架 shimmer 和非必要过渡，运行状态仍由文字表达。

## Implementation Notes

### 推荐复用

- 复用 `GrokUsagePanel.tsx` 的 provider-neutral 模式：fixed viewport clamp、trigger/panel ref、outside click、Escape、focus restore、关闭按钮、StatusDot、UsageRing、加载骨架与额度卡 shell。
- 继续复用 GPT 现有 `knownQuotaTiers`、`quotaColor`、`formatResetCountdown`、`earliestResetCreditExpiration` 和 `ActionFlowIcon`。
- `UsagePanelShell` / `UsageRing` / `StatusDot` / `QuotaWindowCard` 可作为后续 provider-neutral 候选；本任务按 [Design](./design.md) 决策先保留 GPT 局部原语，不为去重修改已稳定 Grok。任何后续抽取也不得共享 Grok 的 cache/error/schema 映射。
- `GrokQuotaView` 只作为视觉参照，不直接接收 `SubscriptionQuota`；GPT 的 `tiers[]`、`credentialStatus`、Reset credits 保持独立。

### 接线与语义边界

- `AppShell` 继续使用单一 `.app-top-usage-panel`、GPT → Grok 顺序和一次右侧安全留白；仅给 GPT 传入现有 Models 打开回调。
- `chatgpt.usagePanelEnabled` 继续默认关闭；不增加 Settings 字段。
- 页面可见时每 30 秒、focus/visibility 恢复、展开时只轻量读取账号 metadata/cache；只有手动刷新和 Activate 成功后调用现有 quota GET。
- 保留既有 accounts/activate/quota/scheduler/repair-lock API 和 Reset credit POST，不新增 route，不改响应 schema。
- 为账号与 quota 请求使用 AbortController/request generation；同账号的“本页最后成功值”按 `accountId` 隔离，切换时禁止旧响应覆盖。
- GPT 专属区不要出现在 Grok，也不要把 scheduler/lock/Reset credits 抽象成 provider 通用能力。

## UI Checks

- [ ] GPT/Grok pill 高度、圆角、间距、打开高亮、状态点与 ring 视觉一致。
- [ ] 收起态只使用“5 小时 / 周”；展开态只使用“5 小时额度 / 7 天额度”，没有“月度”。
- [ ] 实时、已缓存、无缓存、本页回退、无账号、重新登录、加载、操作中/失败均有中文反馈。
- [ ] 本页成功回退按账号隔离；未知额度不是 0%；不伪造 Grok fresh/stale。
- [ ] 通用额度/账号主区与 GPT 专属工具次级区层级清晰。
- [ ] Reset credits 确认与 scheduler/lock repair 风险确认仍可用。
- [ ] 320/375/640px 和桌面不越界；顶部 host 可横向访问；面板内部可滚动。
- [ ] 外部点击、Escape、关闭按钮均关闭；焦点恢复符合约定。
- [ ] trigger/dialog/progressbar/aria-live/长内容 title/键盘 focus 完整。
- [ ] 减少动态效果时不依赖动画表达加载或忙碌。
- [ ] 所有错误为固定安全中文，不泄露上游 body、token、路径或内部异常。
- [ ] 未新增配置/API/schema，未改变 GPT → Grok 顺序和现有业务语义。

## Review Request

请审阅并明确批准上述方案及 HTML 原型，重点确认：

1. GPT 保留真实窗口语义，使用“5 小时 / 7 天（周）”，不伪装为月度；
2. Reset credits 与 scheduler/lock 保留在默认可见但视觉降级的“GPT 专属工具”次级区；
3. GPT 仅表达“实时 / 已缓存 / 无缓存 / 本页成功数据回退”，不引入 Grok 的缓存新鲜/过期契约；
4. 本任务不新增配置、不修改 API/schema。

**在用户批准 HTML 原型前，请保持 UI 审批门禁，不进入生产实现。**
