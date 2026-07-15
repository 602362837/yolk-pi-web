# UI 设计摘要

## 设计目标

为 Grok CLI 增加一个与现有 `ChatGptUsagePanel` 在顶部位置、尺寸和玻璃化语言上对称，但数据能力严格独立的用量入口；同时在 Settings → Grok 增加独立开关。Grok 面板只消费现有安全投影：月度额度、可选周额度、缓存状态、`reauthRequired` 和经过 UI allowlist 映射的错误，不出现 ChatGPT reset credits、后台 scheduler 或刷新锁。

## 用户路径

1. 用户打开 **Settings → Grok**。
2. 开启 **Grok 用量悬浮面板**（新字段建议 `grok.usagePanelEnabled`，默认 `false`），保存设置。
3. 顶部按 **会话统计 → GPT（若开启）→ Grok（若开启）→ 右侧抽屉按钮** 排列；GPT 与 Grok 互不依赖。
4. 用户从 Grok 收起态读取缓存/刷新状态、月度使用率和可选周使用率。
5. 点击 Grok 入口展开面板，查看 Active 账号、月度/周额度、缓存新鲜度和账号列表。
6. 用户可手动强制刷新，或切换 Active 账号；成功后重新获取账号及 quota 投影。
7. 无账号时进入 Models → Grok 登录；`reauthRequired` 时进入 Models → Grok 重新登录；上游失败但有 stale 缓存时继续展示旧额度并明确警告。

## 信息架构

- **顶部收起态（26px pill）**
  - 品牌：`Grok`
  - 状态：`实时 / 缓存新鲜 / 缓存过期 / 加载中 / 登录 / 重新登录 / 错误`
  - 月度：`月 34%` 环形图
  - 周度：存在 `weekly` 时显示 `周 12%`，缺失时不占位
- **展开面板（桌面 392px，视口内限高）**
  - 标题“Grok 用量”、更新时间、cache 状态标记、“关闭”与“强制刷新”
  - Active 账号摘要（显示名、脱敏 id、备注可选）
  - 状态告警（“缓存已过期”“需要重新登录”“额度暂不可用”）
  - 月度额度：已用/总额、剩余、使用率、重置时间
  - 可选周额度：已用百分比、重置时间；API 缺失时显示“当前 API 未提供周额度”，不推断订阅权益
  - 账号列表：Active 标识、“设为 Active”按钮、“正在切换…”反馈
  - `Models → Grok` 管理/登录/重新登录入口
- **Settings → Grok**
  - 首项：`Grok 用量悬浮面板`，默认关闭
  - 次项：保留现有自动切换开关和说明
  - 设置保存后才应用到顶部；取消不应用草稿

## HTML 原型

自包含可交互原型：

[grok-usage-panel-prototype.html](./grok-usage-panel-prototype.html)

原型可演示：

- Settings → Grok 开关与保存/取消；
- 会话统计、GPT、Grok、右侧抽屉的顶部顺序；
- Grok 展开/收起、手动刷新、账号切换；
- 成功、缓存过期、未登录、需要重新登录、错误、加载中、窄屏；
- 关闭开关后 Grok 独立消失，GPT 保持不变。

## 交互状态

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 配置关闭（默认） | 顶部不挂载 Grok；GPT 是否展示由自身开关决定 | Settings → Grok 开启并保存 | 显示“设置已保存：Grok 用量面板已开启”，Grok 出现在 GPT 后、抽屉按钮前 |
| 初次加载 | pill 显示“加载中”、中性空环；展开时显示骨架和“正在加载已保存账号与缓存 quota…” | 等待或关闭面板 | 加载成功切换到 quota；失败进入无账号/错误状态 |
| 无账号/未登录 | pill 显示“登录”；展开显示“无 Active Grok 账号”，不显示伪额度 | “打开 Models → Grok” | 跳转账号管理；登录后下一轮/重新展开重取 |
| 成功（内部 `live`） | 绿色“实时”，月度和可选周百分比 | 展开查看详情 | 显示 Active、额度数值、重置时间和账号列表 |
| 成功（内部 `fresh`） | 绿色“缓存新鲜 · 18 秒”，继续展示缓存额度 | 展开或等待轮询 | 使用服务端 60 秒 fresh cache，不声称访问了上游 |
| 内部 `stale + warning` | 琥珀“缓存过期”；旧额度仍可读 | 手动刷新或进入 Models | 展开显示“正在展示上次成功数据”及固定中文错误文案；不能只靠颜色 |
| `reauthRequired` | 红色“重新登录”；有 stale 数据则保留并加警告，无缓存则空额度 | “在 Models → Grok 重新登录” | 进入 Models → Grok；不自动触发账号切换 |
| 网络/上游错误且无缓存 | 红色“错误”，无百分比或显示空环 | “重试”/“强制刷新” | 仅显示按 error code 映射的固定中文文案，不透传未知上游 body |
| 手动刷新 | 刷新按钮 disabled，文案显示“正在刷新…”；保留旧数据避免闪空 | 等待 | 请求 `refresh=1`；成功显示“实时”，失败转为“缓存过期/错误” |
| 切换账号 | 目标按钮 disabled 并显示“正在切换…”；其它切换入口同时禁用 | 等待 | 激活成功后 Active 标识迁移，再重取账号与 quota；失败保留原 Active 并显示中文错误 |
| 展开时自动重取 | 保留现有内容，顶部显示轻量同步状态 | 无 | 重读 accounts + quota，不用整面板“加载中”覆盖旧数据 |
| 浏览器隐藏 | 保持最后状态 | 切回可见页 | 隐藏期间不轮询；恢复可见后立即轻量刷新，再按 30 秒节奏 |
| 周额度缺失 | 收起态不显示“周”；展开显示“当前 API 未提供周额度” | 无 | 不推断为 0%、不限额或“不含权益” |
| 窄屏 | 顶部横向可滚动；组件不压缩成不可读字符；面板贴合视口左右 8px | 横向滚动、展开、关闭 | 面板宽 `min(392px, calc(100vw - 16px))`，内部独立滚动 |
| 键盘 | trigger、刷新、账号切换、Models 入口均可聚焦 | Enter/Space、Escape、Tab | Enter/Space 激活；Escape 关闭并还焦 trigger；焦点环清晰 |

## 响应式与无障碍

- 顶部延续现有移动端横向滚动策略；组件 `flex-shrink: 0`，不通过隐藏 Grok 关键信息来挤压。
- ≤640px 时 pill 可将状态年龄缩短为“缓存新鲜”，但保留状态文字、“月/周”标签和百分比；周额度不存在时直接省略。
- 展开面板使用 viewport-clamped 定位与内部滚动，不能被顶部容器裁切；窄屏左右至少 8px 安全边距。
- trigger 使用原生 `button` + `aria-expanded` + `aria-controls`；展开容器、按钮、状态播报的 `aria-label`/可识别名称均使用中文，状态变化使用 `aria-live="polite"`。
- quota 进度条提供 `role="progressbar"`、`aria-valuemin/max/now`；缓存状态必须同时有文字/图标，不只用颜色。
- 打开后焦点保持在 trigger 或进入面板首个动作均可，但 Escape 必须关闭并还焦；点击外部关闭。
- 交互目标最小 30px；窄屏关键入口建议 36px。所有 `:focus-visible` 使用 accent outline。
- `prefers-reduced-motion: reduce` 关闭 spinner/过渡动画，刷新中仍用文字表达。
- 长账号名与 masked id 单行省略，完整值放 `title`；错误文案可换行，不能撑破面板。

## 实现说明

### 推荐复用

- 新建独立 `GrokUsagePanel`（命名可由实现员按项目惯例确定），复用 `ChatGptUsagePanel` 的 26px pill、玻璃背景、quota 环图、展开卡片、刷新按钮和账号切换视觉模式；不要复用 ChatGPT reset/scheduler 数据状态。
- 继续复用现有 CSS tokens：`--bg`、`--bg-panel`、`--bg-subtle`、`--border`、`--text*`、`--accent`、`--control-radius*`。
- 刷新图标复用 `ActionFlowIcon` + `iconFlowAttrs`；刷新/disabled 时 mode 为 `off`。quota/stat chip 本体不增加 ambient 动效。
- Settings 复用 `ToggleField`，放在 Grok section 首项；文案建议：
  - 标签：`Grok 用量悬浮面板`
  - 描述：`默认关闭。开启后顶部右侧会显示当前全局 Active Grok 账号的半透明用量入口；展开后可查看月度/可选周额度、缓存状态、手动刷新并切换账号。`

### 配置与挂载

- 增加 `grok.usagePanelEnabled: boolean`，默认 `false`；同步更新默认值、容错读取、严格校验、Settings draft/saved/dirty/save 链路及所有消费者。
- `AppShell` 组合间距不能只判断 ChatGPT：应按 GPT/Grok 任一开启计算 `SessionStatsChips` 右 padding，并保证无 session chips 时第一个开启的 usage panel 承担 `margin-left:auto`。
- 顶部顺序固定为 `SessionStatsChips → ChatGptUsagePanel? → GrokUsagePanel? → right drawer`；两者独立条件挂载。

### 数据与刷新

- accounts：`GET /api/auth/accounts/grok-cli`；激活：`POST /api/auth/accounts/grok-cli/activate`。
- quota：`GET /api/auth/quota/grok-cli`；手动强刷使用 `?refresh=1`；切账号后可按 account id 重取，最终视图应回到 Active 投影。
- 挂载时读取 accounts + quota；浏览器可见时每 30s 轻量刷新；`document.hidden` 时跳过；`visibilitychange` 恢复可见时立即刷新；展开时重取；卸载/下一请求使用 AbortController 或 stale-response guard。
- 普通轮询不加 `refresh=1`，优先命中服务端 60s fresh cache。手动刷新才 bypass fresh cache。
- HTTP 401/502 仍可能带安全 quota JSON，客户端应先解析投影再按 `success/cache/reauthRequired/error` 渲染；真正网络失败使用本地固定通用文案。

### 安全显示边界

- 只渲染 `monthly.limit/used/remaining/utilization/resetsAt`、可选 `weekly.usedPercent/resetsAt`、`cache.state/queriedAt/ageMs`、`reauthRequired`。
- 错误只按 `network | rate_limited | unauthorized | upstream | invalid_payload` 映射固定文案；不要直接显示未知 `message`、上游 body、token、路径或 URL。
- 不增加 POST reset credit，不显示 reset credit，不增加 ChatGPT scheduler/lock/repair UI。
- 周额度缺失只表达“当前 API 未提供”，不解释具体订阅权益。

## UI 检查

- [ ] 默认配置为关闭，升级后不会新增顶部占位。
- [ ] GPT 与 Grok 任意单开、双开、双关时顺序和右侧间距正确。
- [ ] 收起态同时可识别提供商、缓存/刷新状态、“月/周”百分比。
- [ ] 展开态包含 Active、月度、可选周、缓存、刷新、账号列表、“设为 Active”与 Models 入口。
- [ ] 内部 `live/fresh/stale/none`、无账号、`reauthRequired`、无缓存错误均有中文且不只依赖颜色的状态文案。
- [ ] 内部 `stale` 时保留最后成功额度且明确显示“缓存已过期”；无缓存错误时不伪造数值。
- [ ] 30s 轮询仅在页面可见时执行，展开/切号/手刷策略符合约束。
- [ ] 切号和刷新具有“正在切换/正在刷新”、disabled、成功与失败反馈，无并发重复操作。
- [ ] 只显示安全字段和 allowlisted 固定错误文案。
- [ ] 不出现 GPT reset credits、scheduler、lock repair。
- [ ] 390px 窄屏面板不溢出，顶部仍可横向访问 GPT/Grok/抽屉。
- [ ] trigger/刷新/切号/入口支持键盘，Escape、焦点恢复、focus-visible、aria-live 可用。
- [ ] 所有用户可见标签、按钮、状态、错误、说明、toast、title 和 `aria-label` 使用中文；仅保留约定专业术语。
- [ ] 减少动态效果偏好下不依赖动画传达状态。

## 审批请求

**本 HTML 原型需用户审批后方可进入生产实现。**

请重点审批：

1. 收起态采用 `状态 + 月/周百分比` 是否足够清晰；
2. 双组件顺序与窄屏横向滚动策略；
3. Settings 开关默认关闭及文案；
4. “缓存过期”保留旧额度、“需要重新登录/错误”的固定中文文案与 Models 恢复入口；
5. 展开面板允许直接切换全局 Active 账号，且不加入 GPT 专属 reset/scheduler 能力。
