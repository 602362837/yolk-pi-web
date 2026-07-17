# 计划审批书：Antigravity provider、多账号额度与自动切号

> **状态：规划材料、UI HTML 原型与 implementationPlan 已齐备，等待用户审批。**
> 批准前不会修改生产代码；只有明确批准后才能进入 implementing。

## 规划材料

- [Brief：已确认方案、包/Quota证据与范围](./brief.md)
- [PRD：目标、范围、验收、安全风险与降级](./prd.md)
- [UI：交互说明与状态矩阵](./ui.md)
- [HTML 原型（请本地打开审阅）](./antigravity-provider-multi-account-quota-prototype.html)
- [Design：bootstrap、OAuth、quota、model-aware Path B与topbar架构](./design.md)
- [Implement：8项schemaVersion 2 DAG](./implement.md)
- [Checks：自动验证、真实provider、浏览器与安全审计](./checks.md)

**HTML 原型已交付**：[`antigravity-provider-multi-account-quota-prototype.html`](./antigravity-provider-multi-account-quota-prototype.html)  
（自包含交互原型：Models / Settings / 顶栏 Full·Compact·Aggregate，可切换状态矩阵与窄屏场景。）

## 目标与范围摘要

1. 固定接入 `@yofriadi/pi-antigravity-oauth@0.3.0`，用 jiti + Next external 加载到所有 Web/Studio/Models/Auth registry 入口。
2. 复用 opaque OAuth account store，新增 `google-antigravity` adapter、provider lock、token refresh CAS 和全局 Active。
3. Web 自研固定 Google `fetchAvailableModels` quota client，只投影按模型 `remainingFraction/resetTime` 与 safe cache 状态。
4. 新增默认关闭、model-aware、fail-closed 的 Antigravity 独立 Path B；同 turn 最多一次切号和一次重试。
5. Antigravity 加入现有 Full/Compact/Aggregate 顶栏合同，不制造跨模型或跨 provider 总百分比。
6. **不**引入或运行 `pi-antigravity-rotator`，不让第三方账号系统写 `auth.json`。

## 核心技术决策

### Provider 与 callback

- 只调用包公开 default extension，provider id 为 `google-antigravity`。
- 上游在 import 时读取 callback host；集成必须在首次 jiti import 前强制 `127.0.0.1`，并用 single-flight 避免竞态。
- 远程 Web 登录继续使用现有手工粘贴 redirect URL 降级。

### Quota 与隐私

- 固定 `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`，body 仅 server-side `projectId`。
- `remainingFraction` 是剩余比例；使用率 = `1 - remaining`。`resetTime` 只显示，不用于 N-ring duration/rank。
- token、refresh、projectId、raw body/headers/URL/path 不出 API、DOM、SSE 或日志。
- 60s fresh / 24h stale、single-flight、10s timeout、401 单次 refresh retry。

### Model-aware failover

- 包公开 model id 与 quota key 并非完全同名；Web 维护固定 0.3.0 兼容映射。
- 候选必须对 **当前模型** 有 fresh/live 且 remaining > 0 的 entry；其他模型有额度不能证明当前模型可用。
- 默认 `rising-fact-p41fc` 不能作为健康证明；只有 live 匹配 quota 或真实请求成功才算证据。

### 顶栏安全降级

- 一个独立 quota 窗口可显示单 ring。
- 多模型没有可信 duration 时必须 detail-only，不能按 resetTime、对象顺序、remaining 或 percent 排序，也不能求总额/平均值。
- 建议顺序 GPT → Grok → Kiro → Antigravity（以 HTML 原型审批为准）。

## 安全风险（审批时必须明确接受）

- 使用非官方稳定的 Cloud Code/Antigravity 通道；Google 可能随时变更策略或接口。
- OAuth scope 包含 `cloud-platform` 等宽权限。
- 包使用硬编码官方 IDE OAuth client 与 Antigravity 样式 UA。
- callback 默认 bind 行为不安全，必须由 Web 强制 loopback。
- 上游错误可能含 response text，Web 必须做固定错误码/文案脱敏。

## Implementation DAG 摘要

| 阶段 | 子任务 | 依赖/并行 |
| --- | --- | --- |
| 1 | `AG-01` dependency/bootstrap/callback 安全 | 首先执行 |
| 2 | `AG-02` OAuth account/lock/token；`AG-03` config/settings | 2 项并行 |
| 3 | `AG-04` quota/model mapping | 等待 OAuth |
| 4 | `AG-05` failover；`AG-06` Models UI；`AG-07` topbar/aggregate | 最多 3 项文件隔离并行 |
| 5 | `AG-08` integration/docs/checks | 最终 barrier |

`maxConcurrency=3`。完整机器计划见 [implement.md](./implement.md)，并已通过 Studio 工具保存为 task `implementationPlan`。

## UI 审批时请重点看的场景

- Models：OAuth 风险说明、添加多个账号、Active、按模型 quota、invalid project / reauth / stale。
- Settings：Antigravity section + 两个默认关闭开关；Usage 全局 Compact/Aggregate 文案。
- 顶栏：Full/Compact、Aggregate 第四列、单窗口 ring、多模型 detail-only、no account / loading / switching / no candidate。
- 320 / 375 / 640px、键盘、Escape / focus restore、reduced-motion。

## 审批请求

门禁已满足：

1. UI 设计员已交付 task-local HTML，并由 `ui.md` 链接；
2. implementationPlan（AG-01…AG-08，`maxConcurrency=3`）已保存；
3. 任务进入 `awaiting_approval`。

请确认或提出修改意见。**明确批准**后才会进入实现；批准前不改生产代码。
