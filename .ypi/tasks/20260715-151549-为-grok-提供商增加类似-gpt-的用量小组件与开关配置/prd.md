# PRD：Grok 用量小组件与显示开关

## 目标与背景

Grok 的账号和额度目前只能在 Models → Grok 详情中查看。用户需要像 ChatGPT/Codex 一样在聊天顶部快速确认当前全局 Active Grok 账号的订阅额度，并能按需关闭该入口。

## 用户价值

- 无需打开 Models 即可看到月度/可选周额度和重置时间。
- “缓存过期”“未登录”“需要重新登录”和“上游错误”等中文状态可直接识别。
- 多账号用户可以从展开面板快速切换全局 Active，并立即看到新账号额度。
- 不使用 Grok 的用户不会因升级被强制增加顶部占位或额度请求。

## 范围内

1. Settings → Grok 增加独立的“Grok 用量悬浮面板”开关。
2. 顶部右侧增加可折叠 Grok 用量入口，与 GPT 入口可同时存在。
3. 收起态展示 Grok 标签、加载/无账号/错误/更新时间状态、月度使用率及可选周使用率。
4. 展开态展示：
   - 当前全局 Active 账号的脱敏身份；
   - 月度 `used/limit/remaining/utilization/resetsAt`；
   - 可选周额度 `usedPercent/resetsAt`；
   - 内部 `live/fresh/stale/none` 状态对应的“实时/缓存新鲜/缓存过期/无缓存”中文标签与更新时间；
   - “强制刷新”操作；
   - 已保存账号列表、Active 标记和“设为 Active”操作。
5. 覆盖“加载中、无账号、成功、缓存过期降级、需要重新登录、无缓存错误、刷新中、切换中”和窄屏状态。
6. 更新前端、配置、API 消费说明和 Grok 集成文档。

## 范围外

- 不新增/修改 Grok billing endpoint、quota wire schema、缓存文件或 OAuth 存储格式。
- 不新增 Grok reset credit、warmup、后台全账号刷新 scheduler；这些是 GPT 专属能力或当前 Grok API 不支持，界面也不展示相关文案。
- 不改变 `grok.autoFailover`、全局 Active、推理重试、账号删除或登录流程。
- 不自动刷新所有已保存账号的 quota，不引入 N 账号轮询。
- 不改变 ChatGPT 用量业务逻辑；只允许为顶部共同布局或共享无业务展示组件做最小调整。

## 功能需求与验收标准

### FR-1 配置

- `PiWebGrokConfig` 新增 `usagePanelEnabled: boolean`。
- 缺失该字段时规范化为 `false`；合法保存后写入 `~/.pi/agent/pi-web.json` 的 `grok.usagePanelEnabled`。
- Settings 保存后 AppShell 立即重新读取配置；关闭后组件卸载且停止定时器/请求。

### FR-2 顶部布局

- 仅当 `grok.usagePanelEnabled === true` 时挂载 Grok 入口。
- 同时开启 GPT/Grok 时顺序固定为 GPT → Grok，右侧抽屉安全留白只出现一次。
- 无会话统计时 usage host 靠右；存在会话统计时紧跟其后。
- ≤640px 顶部保持横向滚动，入口不压缩；展开面板宽度不得超出视口。

### FR-3 数据与刷新

- 账号来源仅为 `GET /api/auth/accounts/grok-cli`。
- quota 来源仅为 `GET /api/auth/quota/grok-cli`；手动刷新/切号后使用 `refresh=1`。
- 前台自动重验证不得强制上游刷新，应复用服务端 60 秒 fresh cache/single-flight。
- hidden 时不轮询；focus/visibility 恢复和展开时重验证；卸载或新请求覆盖旧请求时取消/忽略旧响应。

### FR-4 状态与错误

- 无已保存账号或 Active 账号时显示“未连接/无 Active 账号”，并引导到 Models → Grok，不伪造 0% 额度。
- 内部状态为 `stale` 且有月度数据时继续展示数据，同时显示黄色“缓存已过期”警告及中文失败原因。
- `reauthRequired` 显示“需要重新登录”引导；不得显示 credential/token、真实路径、上游原始 body。
- 无缓存失败显示可重试错误；非 2xx Grok quota 响应仍应解析安全投影并显示固定错误信息。
- weekly 缺失为正常降级，不显示错误。

### FR-5 账号切换

- 非 Active 账号可通过“设为 Active”按钮触发既有 Activate API；切换中显示“正在切换…”并禁用重复操作。
- 成功后重新加载账号列表并强制刷新新 Active quota；明确提示这是全局 Active，会影响当前/新建会话的后续请求。
- 失败时保留现有 Active 和已展示数据，不做乐观切换。

## 非功能要求

- React/TypeScript strict；不引入新依赖。
- 复用现有 `ActionFlowIcon`、CSS variables、OAuth account API 和 Grok quota view。
- 所有按钮具备 `type="button"`、可见焦点样式、中文 `aria-label`；入口同步 `aria-expanded`。
- 除 Grok、GPT、Settings、Models、Active、quota、cache、OAuth、API 等专业术语外，所有用户可见标签、按钮、状态、错误提示和说明均使用中文。
- 不记录或返回任何 secret；quota 响应维持 `Cache-Control: no-store`。

## 未决问题

无阻塞性缺失。审批本计划即视为接受：默认关闭、GPT→Grok 顺序、前台 30 秒轻量重验证、v1 不批量查询所有账号 quota。
