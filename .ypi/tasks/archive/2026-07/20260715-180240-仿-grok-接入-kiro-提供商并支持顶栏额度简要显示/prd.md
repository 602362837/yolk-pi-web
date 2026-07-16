# PRD：仿 Grok 接入 Kiro 并支持顶部额度简要显示

## 目标与背景

当前 Web 已有 ChatGPT 与 Grok 的 OAuth/额度入口，Grok 还具备独立的多账号全局 Active 和限额自动切号。用户希望以同一产品标准接入 Kiro，并减少多个额度组件同时显示时对顶部空间的占用。

用户价值：

- 在 Web 中直接登录 Kiro、选择 Kiro 模型并对话，不需要单独安装散落 extension。
- 可保存多个 Kiro OAuth 账号，查看当前额度，在明确限额时自动切换，减少 turn中断。
- GPT/Grok/Kiro 同时启用时可切换为短摘要，保留关键额度与详细操作入口。

## 范围内

### 1. Kiro provider

- 加入 `pi-kiro-provider@0.2.2` 依赖。
- 统一 bootstrap到主 Chat、Models/Auth、Studio SDK child、Skills/Commands、环境/工作流辅助模型和 bare ModelRegistry 路径。
- Builder ID / Google / GitHub OAuth 登录。
- Kiro 模型发现、选择、对话、thinking level按上游 provider能力工作。

### 2. OAuth 多账号

- 每次新增登录分配 opaque storage id。
- `accounts.json` 只存非 secret metadata；每账号独立 `0600` credential文件；目录 `0700`；删除进入 `deleted/`。
- 全局 Active mirror到 `auth.json`，刷新使用 compare-and-set，非 Active刷新不得覆盖 Active。
- 支持账号备注、添加、重新登录、Activate、删除保护；不支持 credential JSON import。
- Builder ID 的 `clientSecret`、refresh/access token、完整 profile ARN 不返回浏览器。

### 3. 额度

- 调用 AWS CodeWhisperer `GetUsageLimits`，展示订阅标题（若存在）、额度 bucket 的 used/limit/remaining/percent/reset。
- 优先 precision字段；未知/缺失不能显示为 0%。
- 60s fresh、24h stale、per-account single-flight；手动刷新可绕过 fresh cache。
- 401最多一次 force refresh + retry；其他失败使用固定安全错误码和 stale fallback。
- Settings/Models显示当前所选 Kiro 账号额度；顶部显示全局 Active额度。

### 4. Kiro 自动切号

- 默认关闭，Settings独立开关。
- 仅明确限额/限流触发；同一 turn最多一次切号、一次重试。
- process lock、trigger Active快照、lock后 Active二次检查、Activate前 TOCTOU检查、cooldown和预算与 Grok语义一致。
- 候选账号必须 credential可用、无需 reauth，并有 fresh/live 可用额度；额度未知时 fail-closed。
- SSE/前端提示只投影 provider、status、reason、retry、安全短文案；不暴露账号 id、token、路径、raw error。

### 5. 顶部额度简要显示

- 新增 Settings全局开关 `usage.providerPanelsCompact`，默认关闭。
- 影响所有已启用的 GPT/Grok/Kiro topbar usage trigger；provider显示开关仍独立。
- 默认态保持现有完整 trigger语义。
- 简要态：只显示 provider标识与最多两个关键额度摘要；隐藏长状态句、重复装饰和展开式长条信息。
- 简要态仍可点击打开同一个详细 popover，保留刷新、账号切换、恢复登录和 Models入口。
- 顺序固定 GPT → Grok → Kiro；窄屏仍可横向访问，不产生重复右侧 padding。

## 范围外

- 不修改 ChatGPT failover classifier、预算、candidate selection或后台刷新器。
- 不把 Kiro逻辑塞入 Grok controller，也不改变 Grok provider id/schema/cache。
- 不导入 `pi-kiro-provider` 私有源码路径。
- 不采集/展示 raw Kiro user info、email、overage raw payload或 credentials。
- 不使用 `meteringEvent` 推算账号总额度；不补写历史 Session/ledger。
- 不新增 reset-credit、暖号 scheduler或 per-session Kiro账号 pin。
- 不修改 cacheWrite 废弃规则。

## 需求与验收标准

### R1 Provider bootstrap

- 冷启动访问 `/api/models` 和 `/api/auth/providers` 可看到 `kiro`，无需先打开 Chat。
- 主 Session 与 Studio SDK child都可选择 Kiro模型发起一次真实请求。
- 任意 ModelRegistry refresh后 Kiro与 Grok均不丢失。
- Next dev/release build不尝试静态编译 `pi-kiro-provider` TypeScript源树。

### R2 OAuth 与多账号

- 三种 OAuth method都能进入正确交互流；取消/失败有明确状态。
- 连续添加两个凭据不会覆盖，即使 provider-native信息相同。
- Activate后 live wrapper重载；下一请求使用新 Active，已在 flight请求不变。
- 非 Active token refresh完成时不能覆盖 Active mirror。
- 浏览器/API不出现 access/refresh/clientSecret/profileArn/文件路径。

### R3 额度

- 可解析 `usageBreakdownList` 与 legacy `usageBreakdown`；precision优先。
- 展示 used、limit、remaining、percent、reset；未知字段显示「未知」而非 0。
- fresh/live/stale/none、reauth、rate limited、invalid payload均有固定安全投影。
- 401只 refresh+retry一次；response `Cache-Control: no-store`。
- 无可靠 bucket时显示「额度暂不可用」，不从本地 turn用量臆造剩余额度。

### R4 自动切号

- 明确 `MONTHLY_REQUEST_COUNT`、`OVERAGE_REQUEST_LIMIT_EXCEEDED`、`CONVERSATION_LIMIT_EXCEEDED`、明确 quota exhausted / rate limit可触发。
- `INSUFFICIENT_MODEL_CAPACITY`、裸 429、网络、timeout、5xx、auth/reauth、context、content、model错误不触发。
- 并发 Session同一 Active失败时最多切一次；后进入者复用已切换 Active，不级联第三账号。
- 无 fresh可用候选时不重试，并提示无可用账号。
- 不改变 GPT/Grok/OpenCode Go测试契约。

### R5 UI 与简要模式

- Settings保存/重载简要模式；旧配置默认完整态，无迁移破坏。
- GPT/Grok/Kiro任意开关组合均只挂载需要的组件。
- 简要态数字与详细面板同源；状态变化不会显示旧账号额度。
- 320/375/640px 与桌面无视口溢出；Escape/关闭还焦；键盘可打开和操作；reduced-motion有效。
- UI必须与经用户批准的 HTML原型一致。

## 降级与故障策略

`GetUsageLimits` 已有官方 SDK schema和同作者 `pi-multi-auth` 实现，因此本计划按“真实额度”设计。但实现仍需保留以下降级：

- endpoint拒绝某类账号、payload无可用 bucket或 schema变化：账号管理/对话仍可用；额度显示 unavailable；该账号不进入自动 failover候选。
- stale缓存存在：可展示 stale并说明上次成功时间，但自动候选必须满足配置的新鲜度。
- package加载失败：其他 provider继续工作，Models/Auth显示诊断；不能让整个 Web启动失败。

## 未决问题（需用户审批确认）

1. 是否确认**全局**简要开关，而不是 GPT/Grok/Kiro各自一份？推荐全局，避免顶部视觉漂移。
2. 是否确认简要模式只压缩 topbar trigger、点击仍打开详细 popover？推荐保留，避免额度简要化同时丢失账号操作。
3. 是否确认 Kiro候选额度未知时 fail-closed、不盲目轮换？推荐确认，防止网络故障引发账号级联切换。
4. HTML原型尚未由 UI设计员交付；原型审批前不得实现。
