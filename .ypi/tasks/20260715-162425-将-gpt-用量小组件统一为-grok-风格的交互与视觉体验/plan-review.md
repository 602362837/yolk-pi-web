# 计划审批书：GPT 用量小组件统一为 Grok 风格

## 审批请求

请审阅本计划与 UI 设计员交付的 HTML 原型，并明确回复“批准/确认开始实现”或提出修改意见。**本轮只完成规划；批准前任务停留在 `awaiting_approval`，不会派发实现员或修改生产代码。**

审批材料：

- [PRD：目标、范围与验收标准](./prd.md)
- [UI 说明、状态表与审批请求](./ui.md)
- [可交互 HTML 原型](./gpt-usage-panel-grok-style-prototype.html)
- [Design：状态编排、边界、API 与风险](./design.md)
- [Implement：文件、DAG 与回滚](./implement.md)
- [Checks：自动与人工验收清单](./checks.md)
- [Brief：现状证据与推荐默认行为](./brief.md)

## 目标与范围摘要

把现有 `ChatGptUsagePanel` 的收起入口、展开面板、中文状态、窄屏和键盘体验统一到已完成的 `GrokUsagePanel` 交互语言，同时保留 ChatGPT/Codex 的真实额度和 GPT 专属运维能力。

范围内：

- Grok 风格的 26px pill、状态点/spinner、rings、fixed viewport clamp、外部点击、Escape、显式关闭和焦点恢复；
- 真实 `five_hour / seven_day` 窗口，展示为“5 小时 / 7 天（周）”；
- 实时、已缓存、无缓存、刷新失败页面回退、凭据失效等固定中文安全状态；
- 当前 Active 刷新、账号 Activate、Models 恢复入口与并发保护；
- Reset credits 与 scheduler/lock reload/repair 保留并重排为次级区；
- 320/375/640px、桌面、键盘、ARIA、focus-visible、reduced-motion 验收。

范围外：新增月度 GPT schema、Grok fresh/stale cache 契约、新配置/API、Settings 改动、后端 quota/OAuth/scheduler/failover 改造、Grok 业务重构。

## 必须确认的产品决策

请重点确认以下三项；它们是本计划的实现边界：

1. **保留 5h/7d 真实语义，不伪造月度。** 收起态使用“5 小时 / 周”，展开态使用“5 小时额度 / 7 天额度”；视觉一致不以牺牲 provider 数据含义为代价。
2. **保留 GPT 专属能力并降为次级区。** Reset credits 与 scheduler/lock/repair 继续默认可见，但放在额度与账号主路径之后，不抽象进 Grok、不删除运维能力。
3. **不改 API/schema/配置默认。** 复用现有 accounts/quota/activate/scheduler/repair API；`chatgpt.usagePanelEnabled` 仍默认 `false`；不增加 Settings 字段或数据迁移。

另请确认：GPT cache 只表达“实时 / 已缓存 / 无缓存 / 本页上次成功数据”，不无依据声称 Grok 的“缓存新鲜/缓存已过期”。

## UI 原型门禁

本任务改变顶部可见组件、展开/关闭、错误恢复和键盘体验，已触发 UI 原型硬门禁。架构师已明确派发 `ui-designer`，交付：

- [UI 方案](./ui.md)
- [自包含可交互 HTML 原型](./gpt-usage-panel-grok-style-prototype.html)

请在原型中重点检查：

- 实时、已缓存、刷新失败保留本页数据、无缓存、无账号、重新登录、加载；
- 5 小时/7 天额度卡与收起 rings；
- 手动刷新、账号切换、Reset credits、scheduler/lock；
- 320/375px viewport clamp；
- Escape、外部点击、关闭按钮与焦点恢复。

用户批准该 HTML 原型前不得进入实现。

## 技术方案摘要

### Provider 状态隔离

GPT 继续使用 `SubscriptionQuota`、`QuotaDisplayTier[]`、账号 metadata `quotaCache`、Reset credits 和 scheduler 状态；不转换为 `GrokQuotaResultV1`。本任务不抽通用 provider shell/ring，以避免为了少量 UI 原语修改已稳定 Grok；只按 Grok 的结构和行为模式在 GPT 内实现。

### 同账号最后成功数据

客户端按 `accountId` 保存本页面最后成功 quota 快照。手动刷新失败时：

- 同账号有成功快照：保留额度并提示“刷新失败，正在展示本页上次成功数据”；
- 无成功快照：显示明确空态，不伪造 0%；
- 切换账号：只能读取目标账号快照，禁止跨账号回退。

### 请求与并发

- 初次挂载、可见页 30 秒、focus/visibility 恢复、展开：只重读 accounts metadata/cache；
- 手动刷新和 Activate 成功后：才调用 quota GET；
- Reset：继续使用现有 quota POST；
- 使用 AbortController + generation + accountId 一致性检查，阻止旧 Active 响应覆盖新账号；
- Activate 已成功但 quota 失败时保留新 Active，不误称回滚。

### 安全文案

`credentialStatus`、accounts/quota/Activate/Reset/scheduler/repair 失败只映射固定中文文案。未知 `error`、`credentialMessage`、quotaCache error、scheduler 内部错误、HTTP body、token、URL、路径和 lock path 不直接进入 DOM。

完整契约见 [Design](./design.md)。

## 实施 DAG 摘要

| 顺序 | 子任务 | 依赖 | 并行 |
| ---: | --- | --- | --- |
| 1 | `GPT-USAGE-01` GPT 状态编排与 Grok 风格面板 | — | 与 02 并行 |
| 1 | `GPT-USAGE-02` AppShell Models 接线与响应式/无障碍样式 | — | 与 01 并行 |
| 2 | `GPT-USAGE-03` 测试、文档与整体验证 | 01, 02 | barrier 后执行 |

计划 `maxConcurrency=2`。机器可读 `json ypi-implementation-plan`、每项文件/验收/风险/验证与回滚详见 [Implement](./implement.md)。批准后主会话应先合法进入 `implementing`，再同轮 claim 并派发两个 ready 子任务；不得把整个任务交给一个未绑定 subtask 的实现员。

## 检查与验收摘要

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:chatgpt-usage-panel
npm run test:grok-usage-panel
npm run test:grok-quota
npm run test:grok-accounts
npm run test:grok-global-auth
```

人工验收覆盖：

- GPT/Grok 四种开关组合、固定 GPT → Grok 和一次右侧留白；
- 全部中文状态、同账号回退、Activate race、Reset、scheduler/lock；
- 320/375/640px 与桌面、低高度内部滚动；
- Escape/关闭还焦、外部点击、Tab/Enter/Space、ARIA/progressbar、reduced-motion；
- 安全字段边界与 Grok/Models 回归。

完整矩阵见 [Checks](./checks.md)。

## 风险与回滚

主要风险：失败刷新清空旧额度、metadata 失败 cache 覆盖本页快照、切号 race、把 GPT cache 误写成 Grok fresh/stale、scheduler 原始错误泄露、重复 usage host/right padding、顺手重构 Grok。

缓解：按账号快照、请求 generation/abort、固定安全映射、AppShell 最小接线、不抽通用 shell、独立浏览器验收。

回滚：先关闭现有 ChatGPT usage 开关止血，再回滚 GPT component/AppShell callback/CSS；不迁移或回滚账号、quota cache、Reset credits、scheduler 数据。

## 请确认

若同意上述三项核心决策、GPT cache 表达边界、实施 DAG、Checks 和 HTML 原型，请明确批准；否则请指出需调整的文案、状态、信息层级或技术边界。批准后才可进入实现。
