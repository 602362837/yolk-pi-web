# Checks：Kiro provider、多账号额度、自动切号与顶部简要模式

## 门禁检查

- [ ] `ui-designer` 已交付 task-local `.html/.htm` 原型，不是纯 Markdown。
- [ ] `ui.md` 链接原型并记录页面、状态、交互与无障碍说明。
- [ ] 用户已明确批准 HTML原型和 [plan-review.md](./plan-review.md)。
- [ ] task-level `implementationPlan` 已通过 Studio工具保存，且 transition由主会话合法进入 implementing。
- [ ] 实现 diff不覆盖任务开始前的无关用户改动。

## 需求覆盖

### Provider / OAuth

- [ ] `pi-kiro-provider` 通过 jiti异步加载，并加入 Next external。
- [ ] Cold Models/Auth能发现 `kiro`；ModelRegistry refresh不丢 Kiro/Grok。
- [ ] 主 Chat、Studio SDK child、Skills/Commands和 assistant routes均走统一 provider bootstrap。
- [ ] Builder ID / Google / GitHub登录状态完整：选择、auth URL、device/manual callback、progress、cancel、error、success。
- [ ] 两次新增登录各自创建 opaque storage id；相同真实身份也不覆盖。
- [ ] `accounts.json`无 secret；secret文件 `0600`、目录 `0700`；删除进入 `deleted/`。
- [ ] Activate重载 live auth；in-flight不变；无 per-session Kiro pin。
- [ ] 非 Active refresh CAS不能覆盖 Active mirror。

### Quota

- [ ] 只请求 `https://q.<validated-region>.amazonaws.com/` + `AmazonCodeWhispererService.GetUsageLimits`。
- [ ] Body只含官方字段；无任意 URL/headers从 credential透传。
- [ ] `usageBreakdownList`、`usageBreakdown`、precision fallback、多个 bucket、无 bucket、非法数值 fixture通过。
- [ ] used/limit/remaining/utilization/reset计算正确；unknown不显示 0%。
- [ ] fresh/live/stale/none、401 retry、403/access denied、429、5xx、timeout、invalid payload均正确。
- [ ] 401最多 force refresh+retry一次；缓存 60s fresh/24h stale；single-flight按 account。
- [ ] API `Cache-Control:no-store`；POST Kiro quota为 405。
- [ ] wire/DOM不含 access、refresh、clientSecret、profileArn、userInfo/email、raw body、URL、路径、request id。

### Failover

- [ ] 正例：`MONTHLY_REQUEST_COUNT`、`OVERAGE_REQUEST_LIMIT_EXCEEDED`、`CONVERSATION_LIMIT_EXCEEDED`、`DAILY_REQUEST_COUNT`、明确 quota exhausted、明确 rate-limit。
- [ ] 负例：`INSUFFICIENT_MODEL_CAPACITY`、bare 429/403、network、timeout、5xx、auth/reauth、context、content、model unavailable、模糊 help文本。
- [ ] 开关默认 off；provider非 Kiro时完全 passthrough。
- [ ] 每 turn最多 1 switch / 1 retry；failed assistant只在 retry=true时移除。
- [ ] lock后 Active二次检查与 Activate前 TOCTOU检查生效。
- [ ] 并发两个 Session只发生一次实际切换，后进入者复用新 Active。
- [ ] 候选必须 fresh/live quota remaining>0；stale/unknown/reauth fail-closed。
- [ ] 无候选、失败、预算耗尽为 terminal，不显示虚假 Retrying。
- [ ] SSE/前端 notice无账号 id、token、路径或 raw error。

### Models / Topbar / Settings

- [ ] Models Kiro多账号、备注、重新登录、Activate、删除保护和 quota状态符合原型。
- [ ] Kiro不显示 Reset credits、JSON import或 Grok-only文案。
- [ ] `usage.providerPanelsCompact` 是单个全局开关，默认 false。
- [ ] `kiro.usagePanelEnabled`、`kiro.autoFailover.enabled` 默认 false。
- [ ] 默认态 GPT/Grok现状无回归；Kiro panel关闭时不挂载/轮询。
- [ ] 简要态同时影响所有已启用 provider；只显示 provider + 最多两个关键额度摘要。
- [ ] 简要态点击仍打开详细 popover；刷新/切号/Models入口保留。
- [ ] GPT使用 5h/周，Grok使用月/周，Kiro使用 primary credit bucket；不混淆 schema。
- [ ] 顺序 GPT → Grok → Kiro；只有一个 usage host和一次 right padding。
- [ ] 账号切换或请求 race不会短暂显示旧账号 quota。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:kiro-provider
npm run test:kiro-accounts
npm run test:kiro-quota
npm run test:kiro-failover-adapter
npm run test:kiro-failover-runtime
npm run test:provider-usage-compact
npm run test:chatgpt-usage-panel
npm run test:chatgpt-failover-contract
npm run test:grok-all
npm run test:opencode-go-failover-behavior
git diff --check
```

要求：记录每条命令 exit code；不存在的新增脚本必须在对应子任务中先加入 `package.json`。不得用 `next build`替代日常验证。

## 人工验收

### 真实 provider

- [ ] 冷启动直接打开 Models，Kiro可见。
- [ ] 至少完成一种真实 OAuth登录；条件允许时覆盖 Builder ID与一种 social flow。
- [ ] 选择一个 Kiro模型完成真实对话，确认 usage/ledger不累计 cacheWrite。
- [ ] 同一账号查询真实 GetUsageLimits，数值与 Kiro account usage页面抽样一致。
- [ ] 两个真实账号 Activate后，后续请求使用新 Active。
- [ ] 如无法制造真实 quota错误，明确记录 blocker并用官方 error fixture验证 classifier；不得声称真实 failover已验收。

### UI矩阵

- [ ] Provider开关：仅 GPT、仅 Grok、仅 Kiro、两两组合、三者全开、全关。
- [ ] 显示模式：full / compact；刷新中、无账号、reauth、stale、unknown、success。
- [ ] Viewport：320、375、640、桌面；低高度面板内部滚动。
- [ ] 输入：Tab、Shift+Tab、Enter/Space、Escape、外部点击、显式关闭、焦点恢复。
- [ ] ARIA：trigger expanded/controls、dialog label、progressbar min/max/now、live状态。
- [ ] `prefers-reduced-motion`：spinner/装饰动画停止，文字状态仍完整。
- [ ] 与已批准 HTML原型逐项对照并保存截图/验收记录。

## 回归重点

- [ ] GPT failover、quota reset credit、scheduler/lock无变化。
- [ ] Grok global Active、quota cache、failover和 Models UI无变化。
- [ ] OpenCode Go failover无变化。
- [ ] Main/Studio child Session创建、fork、wrapper/start locks无变化。
- [ ] `/api/models`、Auth routes、model price helpers在 refresh后仍保留所有动态 provider。
- [ ] `pi-web.json`保存不删除未知/无关配置。

## 阻断条件

以下任一项为 blocker：

- 缺 HTML原型或用户审批；
- Kiro只能在打开一次 Chat后才出现；
- quota来自猜测 endpoint、per-turn metering或 raw UI scraping；
- unknown显示为 0%/不限额；
- 网络/容量/auth错误触发切号；
- 单 turn/并发发生多次级联切号；
- secret/profile ARN/raw error出现在 API/DOM/log；
- GPT/Grok/OpenCode生产行为回归；
- 真实流程未执行却报告“已验证”。
