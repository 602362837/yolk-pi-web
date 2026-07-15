# Brief：统一 GPT 与 Grok 顶部用量体验

## 目标

在不改变 ChatGPT/Codex 额度语义和专属运维能力的前提下，将现有 `ChatGptUsagePanel` 的收起入口、展开面板、中文状态、窄屏与键盘交互统一到刚完成的 `GrokUsagePanel` 体验。重点是“同一交互语言、不同 provider 数据语义”，不是把 GPT 数据强行转换为 Grok 月度 schema。

## 现状证据

- `components/AppShell.tsx` 已使用单一 `.app-top-usage-panel`，按 GPT → Grok 挂载；两者共用一次右侧安全留白。此任务只需给 GPT 增加 `onOpenModels` 等接线，不需重做 host 或顺序。
- `components/ChatGptUsagePanel.tsx` 已支持：账号缓存轮询、展开时重读账号、手动 quota 刷新、Reset credits 消耗、账号 Activate、后台刷新 scheduler/lock 状态与修复。
- GPT 收起态和展开态仍有大量英文，弹层使用固定 `width: 380` 的 absolute 定位，没有 Grok 的视口夹紧、外部点击关闭、Escape 关闭还焦、显式关闭按钮、`aria-controls`/dialog 语义。
- `components/GrokUsagePanel.tsx` 已实现：中文状态、固定视口定位、窄屏宽度夹紧、外部点击与 Escape、焦点恢复、关闭按钮、加载骨架、状态点、月/周 ring、Active 账号说明和固定安全错误文案。
- `components/GrokQuotaView.tsx` 是 Grok `GrokQuotaResultV1` 的纯展示组件；GPT 使用 `SubscriptionQuota`（`tiers[]`、`credentialStatus`、Reset credits），不能直接复用该组件或 Grok cache/error 映射。
- GPT quota API 的已知窗口是 `five_hour` 与 `seven_day`，不是月度额度。`lib/quota-display.ts` 当前标签为 `5h` / `7d`。为保留数据语义，GPT 不应伪造“月度”数据；推荐展示“5 小时 / 7 天（周）”。
- GPT cache 仅保存在账号 metadata 的 `quotaCache`，没有 Grok 的 `live/fresh/stale/none` 服务端状态、TTL 或 stale-success 回退契约；失败刷新可能覆盖该账号缓存。UI 只能准确表达“实时查询 / 已缓存 / 无缓存 / 刷新失败”，不能无依据声称“缓存新鲜/已过期”。
- Settings 已有 `chatgpt.usagePanelEnabled`、后台自动刷新和 failover 配置，默认关闭；本任务无需新增配置字段或迁移。

## 推荐默认行为

1. GPT 用量开关继续默认关闭，字段、存储位置和保存行为不变。
2. 收起态与 Grok 同结构：`GPT + 中文状态 + 5 小时 ring + 周 ring`；仅在对应 tier 存在时显示，未知时用空环，不显示伪造月度。
3. 展开态采用 Grok 的 viewport-clamped fixed panel、显式关闭、外部点击、Escape 关闭并还焦；打开时保留已有内容并轻量重读账号和 scheduler。
4. 页面可见时每 30 秒只重读账号 metadata/cache；不自动调用 GPT quota 上游。手动刷新和 Activate 后才调用现有 quota GET。
5. 手动刷新失败时，若本页面内已有该账号的最后成功数据，则保留并显示“刷新失败，正在展示本页上次成功数据”；不能跨账号复用，也不把它称为服务端 stale cache。
6. 保留 GPT 专属 Reset credits、后台自动刷新 scheduler/lock 与故障修复，但放在清晰的“GPT 专属工具 / 后台自动刷新”次级区，不混入 Grok 通用额度卡。
7. 无账号或凭据失效时提供“打开 Models → ChatGPT”恢复入口；所有用户可见文案、title、`aria-label`、状态和错误使用中文，专业术语可保留。

## 数据/API 结论

- 复用现有 API，不新增 route、不改变响应 schema：
  - `GET /api/auth/accounts/openai-codex`
  - `POST /api/auth/accounts/openai-codex/activate`
  - `GET/POST /api/auth/quota/openai-codex`
  - `GET /api/chatgpt/usage-refresh/status`
  - `POST /api/chatgpt/usage-refresh/repair-lock`
- 不复用 `GrokQuotaView` 的 provider schema；仅建议抽取/复用无业务语义的面板 shell、状态点、ring、窗口卡等展示原语，或先在 GPT 内按 Grok 模式实现后再做小范围共享，避免破坏已完成的 Grok 行为。
- 客户端必须把 GPT `credentialStatus` 和失败类型映射为固定中文安全文案，不直接展示上游 response body、token、路径或内部异常。

## UI 门禁

本任务改变顶部可见组件、展开交互、错误恢复和键盘体验，触发 HTML 原型硬门禁。必须由 UI 设计员基于当前 GPT/Grok 组件产出任务目录内自包含 HTML 原型，并在用户批准原型与计划前保持 `awaiting_approval`。

## 需用户在审批时确认

- 同意 GPT 保留真实窗口语义：显示“5 小时 / 7 天（周）”，**不伪造“月度”**。
- 同意 GPT 专属 Reset credits 与 scheduler/lock 继续保留，但降为展开面板次级区。
- 同意本任务不新增配置、不修改 API/schema，仅做前端状态编排、共享展示原语与 AppShell 接线。
