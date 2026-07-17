# Checks：Antigravity provider、多账号quota与自动切号

## 审批门禁

- [ ] 主会话已通过YPI Studio派发`ui-designer`。
- [ ] UI设计员已交付task-local `.html/.htm`，不是纯Markdown或架构师代写。
- [ ] `ui.md`链接HTML并记录页面、状态、交互、响应式和无障碍说明。
- [ ] 用户已明确批准 [plan-review.md](./plan-review.md) 与HTML原型。
- [ ] task-level `implementationPlan`已通过Studio工具保存，task进入合法审批/实现状态。
- [ ] 实现diff不覆盖任务开始前的无关用户改动。

## 需求覆盖

### Provider / OAuth

- [ ] 依赖精确为`@yofriadi/pi-antigravity-oauth@0.3.0`，通过jiti公开default factory加载。
- [ ] `serverExternalPackages`包含包名；应用无静态私有`src/**` import。
- [ ] Cold Models/Auth、主Session、Studio child、Skills/Commands、assistant/model-price routes均保留Grok/Kiro/Antigravity。
- [ ] callback实际只绑定`127.0.0.1:51121`；未设置/恶意非loopback环境值都不能扩大监听。
- [ ] Web手工redirect粘贴流程可用，state mismatch/取消/失败不挂起SSE。
- [ ] 两次OAuth add生成不同opaque storage id；不支持credential JSON import。
- [ ] `accounts.json`无access/refresh/projectId；secret文件0600、目录0700、删除进入`deleted/`。
- [ ] refresh/Activate共享provider lock；非Active refresh不能覆盖Active mirror。
- [ ] upstream token exchange/refresh body不进入API、SSE、DOM、console或server日志。

### Quota

- [ ] 只请求固定`daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`。
- [ ] body只含server-side `project`，无credential URL/header/body扩展。
- [ ] parser覆盖models非object、过多entry、invalid key、missing quotaInfo、0/1/小数/越界/NaN remainingFraction、合法/非法resetTime。
- [ ] `usedPercent = 100 × (1 - remainingFraction)`；unknown不显示0%。
- [ ] resetTime只显示，不用于5h/7d推断、N-ring排序或candidate优先级。
- [ ] 60s fresh/24h stale、single-flight、10s timeout、401单次force refresh retry生效。
- [ ] 403/project invalid与reauth区分；stale/unknown不进入failover候选。
- [ ] API GET支持Active或`accountId`、`refresh=1`；POST为405；所有响应`no-store`。
- [ ] wire/DOM/cache不含token、refresh、projectId、raw body、URL、headers、路径、request id。

### Model mapping / failover

- [ ] 固定0.3.0 catalog中的每个public model都有accepted quota key映射或显式unsupported标记。
- [ ] candidate只使用当前模型匹配entry；“其他模型有额度”不能让当前模型账号成为候选。
- [ ] 正例：`RESOURCE_EXHAUSTED`、quota exhausted/exceeded、quotaResetDelay/TimeStamp、rate_limit_exceeded、too many requests。
- [ ] 负例：裸429/API error(429)、401/403、auth/token/project、network、timeout、abort、5xx/529、overloaded/capacity、context/content/safety/model错误、fuzzy help。
- [ ] provider非Antigravity或开关off完全passthrough。
- [ ] 同turn最多1 switch/1 retry；failed assistant只在`retry=true`时移除。
- [ ] lock后Active检查、candidate live model quota复验、Activate前TOCTOU检查生效。
- [ ] 并发两个Session最多一次实际切换；后进入者不能在新Active无当前模型quota时盲retry。
- [ ] terminal状态不显示Retrying；SSE无account id/token/projectId/raw error/path。
- [ ] GPT/Grok/Kiro/OpenCode failover suites语义不变。

### Models / Settings / Topbar

- [ ] Models Antigravity账号、remark/extra info、Active、选择查看quota、恢复登录和删除保护符合原型。
- [ ] 登录风险说明覆盖非官方通道/宽scope，但不展示client、projectId或credential。
- [ ] `antigravity.usagePanelEnabled`与`antigravity.autoFailover.enabled`默认false。
- [ ] Usage全局Compact/Aggregate文案和逻辑覆盖Antigravity；不新增per-provider compact/aggregate。
- [ ] Antigravity panel关闭时不mount、不poll；开启时仅一份provider owner。
- [ ] Standalone/aggregate顺序与批准原型一致，只有一个usage host与一次right-padding reserve。
- [ ] 单quota窗口可显示单ring；多模型无可信duration时detail-only，无total/average/min/max伪造。
- [ ] account切换立即清旧quota，并以Abort/generation/accountId guard拒绝旧response。
- [ ] 320/375/640px与桌面、键盘、Escape、focus restore、ARIA、reduced-motion通过。

## 自动验证（计划）

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:antigravity-provider
npm run test:antigravity-accounts
npm run test:antigravity-callback-security
npm run test:antigravity-quota
npm run test:antigravity-model-quota
npm run test:antigravity-failover-adapter
npm run test:antigravity-failover-runtime
npm run test:antigravity-models-ui
npm run test:provider-usage-compact
npm run test:provider-usage-aggregate
npm run test:chatgpt-failover-contract
npm run test:grok-all
npm run test:kiro-integration
npm run test:opencode-go-failover-behavior
git diff --check
```

新增脚本必须由对应实现子任务先写入`package.json`。不直接运行`next build`；仅发布/交付验证使用`npm run build`。

## 人工验收

### 真实provider

- [ ] 冷启动直接打开Models，Antigravity可见。
- [ ] 完成至少一个真实Google OAuth；远程访问时验证手工redirect粘贴。
- [ ] 用一个Antigravity模型完成真实对话；确认provider/model与thinking能力正确。
- [ ] 查询同账号真实`fetchAvailableModels`，抽样对照剩余比例/reset。
- [ ] 两个真实账号Activate后，后续请求使用新Active，旧in-flight不变。
- [ ] 如无法制造真实quota错误，明确记录blocker，只能声称fixture classifier通过，不能声称真实failover通过。

### UI矩阵

- [ ] 仅Antigravity、与任一provider组合、四provider全开、全关。
- [ ] standalone Full / Compact / Aggregate。
- [ ] no account、loading、single window、multi-model detail-only、fresh、stale、reauth、invalid project、access denied、switching、no candidate。
- [ ] 320、375、640与桌面；低高度内部滚动。
- [ ] Tab、Shift+Tab、Enter/Space、Escape、outside close、显式关闭、焦点恢复。
- [ ] 状态非仅颜色；可信progressbar才有`aria-valuenow`；reduced-motion静态可读。
- [ ] 与批准HTML逐项对照并留存截图/记录。

## 安全审计复核

- [ ] dependency发布物仍无postinstall/fs写盘/child_process/eval/非Google外传变化；lockfile锁定0.3.0。
- [ ] OAuth scope、硬编码client、模拟UA、非官方通道风险写入docs和用户可见说明。
- [ ] callback host通过运行时监听测试，不只source grep。
- [ ] 默认`rising-fact-p41fc`未被用作健康flag或candidate捷径。
- [ ] API/SSE/DOM/log扫描禁止字段：`access`, `refresh`, `projectId`, `client_secret`, raw response/body, filesystem path。

## 阻断条件

以下任一项为blocker：

- 缺UI设计员HTML原型或用户审批；
- 未通过Studio工具保存plan却进入implementing；
- callback监听非loopback；
- package只能在打开Chat后才注册；
- quota使用猜测endpoint、rotator代理、任意credential URL或raw UI scraping；
- remaining与used计算反向、unknown显示0%、resetTime被当duration排序；
- 当前模型无quota但因其他模型有额度而自动切号；
- 网络/auth/project/capacity/裸429触发切号；
- token/refresh/projectId/raw error出现在API/DOM/SSE/log；
- GPT/Grok/Kiro/OpenCode生产行为回归；
- 真实流程未执行却报告“已验证”。
