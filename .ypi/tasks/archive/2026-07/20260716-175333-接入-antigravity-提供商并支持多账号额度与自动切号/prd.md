# PRD：Antigravity 提供商、多账号额度与自动切号

## 目标与背景

当前 yolk-pi-web 已为 ChatGPT、Grok、Kiro提供账号、额度和顶栏展示，并为多个 provider实现相互独立的 Path B自动切号。用户希望以同一产品标准接入 Google Antigravity，同时保留当前账号存储、全局 Active、额度聚合和隐私边界。

用户价值：

- 无需单独配置散落 extension，即可在 Web、主 Chat和 Studio child中选择 Antigravity 的 Gemini、Claude、GPT-OSS模型。
- 可保存多个 Google OAuth账号，明确查看各账号的按模型剩余额度和重置时间。
- 当前账号出现明确额度耗尽/限流时，可选择开启自动切号，减少 turn中断。
- 顶栏 Full、Compact与 Aggregate体验和 GPT/Grok/Kiro一致，不新增另一套入口。

## 范围内

### 1. Provider固定接入

- 增加精确依赖 `@yofriadi/pi-antigravity-oauth@0.3.0`。
- 通过 `jiti` + `serverExternalPackages`加载公开 default extension，不导入包内私有路径。
- Provider ID固定为 `google-antigravity`。
- 覆盖主 Chat、Studio SDK child、Models/Auth、Skills/Commands、model price与assistant routes、裸 ModelRegistry cold bootstrap。
- OAuth callback listener强制绑定 `127.0.0.1`；远程浏览器可通过现有手工粘贴 redirect URL完成流程。

### 2. OAuth多账号

- 新增 `google-antigravity` adapter，复用 opaque storage id、metadata-only `accounts.json`、每账号独立 `0600` credential、`0700`目录和 soft delete。
- 凭据必须包含非空 `access`、`refresh`、`projectId`及 finite `expires`；可保留上游 `email`，但 `projectId`只保存在 secret文件。
- 不支持 credential JSON import；每次 OAuth add都分配新 opaque id，即使 Google身份相同也不覆盖。
- 全局 Active mirror到 `auth.json`；refresh与Activate共享 provider lock，非 Active refresh不得覆盖 Active mirror。
- Activate影响普通 live/new Session后续请求；已在 flight请求不更换 token；不新增 per-session pin。

### 3. Quota

- Web调用固定的 Google `fetchAvailableModels` endpoint，body仅包含服务端 credential中的 `projectId`。
- 解析 bounded `models` map内的 `quotaInfo.remainingFraction`与`resetTime`；剩余比例必须在 `[0,1]`，重置时间必须可解析。
- Wire只返回 opaque account id、模型/配额安全字段、缓存状态和固定错误码；不返回 token、refresh、projectId、raw body、URL、headers或路径。
- 60s fresh、24h stale、per-account single-flight、10s timeout；401最多一次 force refresh + retry。
- stale可展示但不能参与自动切号；无有效模型配额时显示 unavailable，不能伪造0%或无限额。
- Models可按选中账号查看所有安全模型额度；顶栏只读取全局 Active。

### 4. 自动切号

- 新增 `antigravity.autoFailover.enabled`，默认关闭。
- 仅对 provider=`google-antigravity`、assistant `stopReason=error`且命中明确 quota/rate-limit语义时执行。
- 同一 turn最多一次实际切号与一次 retry；并发 Session复用已发生的 Active变化，不级联切第三账号。
- 候选账号必须 credential可读、无需 reauth、quota为 fresh/live，并且当前请求模型通过固定映射找到的 quota entry `remainingFraction > 0`。
- unknown/stale/invalid project/无法映射当前模型均 fail-closed。
- SSE只投影 status、reason、retry和固定安全短文案；不投影账号id、token、projectId、raw error或路径。

### 5. Models / Settings / 顶栏

- Models新增 Antigravity OAuth managed-account视图：登录、备注、extra info、选择查看额度、Activate、重新登录/恢复、删除保护。
- Settings新增 Antigravity分节：顶栏额度开关、默认关闭的自动切号开关与风险说明。
- `usage.providerPanelsCompact`与`usage.providerPanelsAggregated`继续是全局开关；Antigravity加入已有契约。
- Standalone顺序建议 GPT → Grok → Kiro → Antigravity；aggregate增加同顺序第四列，无跨 provider总百分比。
- Quota详情展示每模型剩余/已用比例与reset；多模型不能平均、求和或取任意一个冒充整体额度。
- 账号切换后必须立即清空旧 quota并用 request-generation/accountId guard防止闪回。

## 范围外

- 不内嵌、不安装、不启动 `pi-antigravity-rotator`。
- 不使用第三方代理改写 `auth.json`，不建立第二份第三方 `accounts.json`。
- 不修改 GPT、Grok、Kiro、OpenCode Go classifier、预算、candidate selection或quota schema。
- 不新增 warmup/kickstart、后台账号调度、per-session账号pin、reset-credit或代理dashboard。
- 不从 streaming usage推算订阅额度，不扫描Antigravity IDE UI。
- 不把 `rising-fact-p41fc` 默认 project当作健康证明。
- 不改写历史Session JSONL、Usage ledger或cacheWrite废弃规则。

## 需求与验收标准

### R1 Provider bootstrap

- 冷启动直接访问 `/api/models`、`/api/auth/providers`可发现 `google-antigravity`，无需先打开Chat。
- 主Session与Studio SDK child都能选择Antigravity模型并完成真实请求。
- 任意受支持ModelRegistry refresh后Grok、Kiro、Antigravity都保留。
- Next dev/release路径不静态编译该包的TypeScript源码。
- callback listener只监听`127.0.0.1:51121`；非loopback环境值不能扩大监听面。

### R2 OAuth与多账号

- 浏览器OAuth、回调成功、手工redirect粘贴、取消、state mismatch、token exchange失败均有明确且脱敏的UI状态。
- 连续添加两个账号不覆盖；Activate后下一次普通请求使用新Active。
- refresh/Activate并发下，最终`accounts.json` Active与`auth.json` mirror一致。
- `accounts.json`、API、DOM、SSE、日志不出现access、refresh、projectId或raw upstream body。

### R3 Quota

- `remainingFraction=1/0/小数`正确转为0%/100%/对应已用比例；非法、越界、NaN、缺失字段被拒绝而不是归零。
- `resetTime`只作为详情与tooltip，不用于径向排序或推断5h/7d。
- fresh/live/stale/none、reauth、access denied、rate limited、invalid payload、network/timeout均有固定安全投影。
- 401只force-refresh并重试一次；响应`Cache-Control: no-store`；POST quota返回405。
- 默认project只有在live quota返回当前模型有效entry或真实推理成功时才可视为可用。

### R4 自动切号

- 明确`RESOURCE_EXHAUSTED`、`quota_exhausted`、`quota exceeded`、`quotaResetDelay/quotaResetTimeStamp`、`rate_limit_exceeded`、`too many requests`可触发。
- 裸`429`/`Cloud Code Assist API error (429)`、401/403、invalid grant/token、project missing/invalid、network、timeout、5xx、overloaded/capacity、context、content、安全、model not found不触发。
- 当前模型无法映射到quota key、候选只对其他模型有额度、quota stale/unknown时不切号。
- 并发两个Session只发生一次实际Active切换；后进入者最多复用新Active并retry一次。
- terminal状态不得显示虚假“正在重试”。

### R5 UI

- Antigravity Models账号、quota、Settings开关与顶栏体验符合用户批准的task-local HTML原型。
- Full/Compact/Aggregate及任意provider启用组合不重复mount/polling，不产生第二个usage host或额外right padding。
- 多模型quota缺少可信duration时，N-ring安全降级为detail-only；不按resetTime、模型顺序、percent或remaining排序。
- 320/375/640px与桌面无不可访问溢出；键盘、Escape、外部关闭、焦点恢复与reduced-motion有效。
- DOM中无secret/projectId；可见错误均为固定安全文案。

## 安全与合规风险（必须在审批中可见）

1. **非官方通道**：provider使用Cloud Code/Antigravity非官方稳定接口，可能随时变更或受账号策略限制。
2. **宽scope**：Google OAuth包含`cloud-platform`、userinfo、cclog、experiments/config等scope，权限面大于普通模型API key。
3. **硬编码IDE client与模拟UA**：包使用硬编码官方IDE OAuth client，并发送Antigravity样式User-Agent；存在策略与封禁风险。
4. **callback监听**：上游默认bind行为不满足Web安全边界，必须强制127.0.0.1。
5. **默认project fallback**：`rising-fact-p41fc`不能证明账号/模型可用，候选健康必须来自live model quota。
6. **错误泄漏**：上游token refresh/token exchange会把response text放入Error；Web必须转成固定错误码，禁止透传到SSE/DOM/log。

## 兼容与降级

- package加载失败：其他provider继续工作；Models/Auth显示provider不可用诊断。
- OAuth成功但project/quota不可用：账号仍保留，可重新登录；不进入failover候选。
- quota endpoint失败：展示fresh/stale/unavailable；对话能力与账号管理独立。
- config字段缺失：Antigravity panel和auto-failover默认关闭，现有UI不变化。
- rollback保留`auth-accounts/google-antigravity/`与normalized quota cache，不删除用户凭据。

## 未决门禁

- UI设计员尚未通过YPI Studio合法派发，HTML原型未交付，用户也未审批。
- task-level `implementationPlan`尚未通过Studio工具保存，任务不得进入`awaiting_approval`或`implementing`。
- 原型需确认第四provider的顶栏顺序、multi-model detail-only触发态和OAuth风险提示呈现；推荐值见 [ui.md](./ui.md)。
