# Summary：Grok 用量小组件与开关

## 结论

**检查通过（Pass，有条件）**。Grok 顶部用量入口、Settings 独立开关、共享 `GrokQuotaView`、AppShell 单一 usage host 与中文状态文案均已落地；自动测试全绿。检查员修复了 375px 展开面板溢出视口问题。

## 交付要点

- `grok.usagePanelEnabled` 默认 **false**；旧配置兼容；partial patch 保留 `autoFailover`。
- Settings → Grok：「Grok 用量悬浮面板」开关与说明（中文）。
- `GrokUsagePanel`：accounts/quota/activate、30s 前台轻量轮询、强制刷新/切号 `refresh=1`、Abort/generation 防旧响应覆盖。
- 共享 `GrokQuotaView`：Models 与顶部共用月/周/缓存/reauth 中文投影。
- AppShell：GPT → Grok 顺序，单一 host 一次右侧留白。
- 不引入 Grok reset/scheduler/warmup，不改 OAuth/failover/quota schema。

## 验证

lint / tsc / `test:grok-quota` / `test:grok-accounts` / `test:grok-global-auth` / `test:grok-usage-panel` 全部通过；浏览器验证开关、双组件、切号、刷新、Models 回归与窄屏 clamp。

## 残留

非阻塞：locale 日期英文缩写、spinner reduced-motion 细节、`package-lock` 无关 diff。无产品决策阻塞项（可选：是否强制 `zh-CN` 日期）。
