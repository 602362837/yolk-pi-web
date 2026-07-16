# 计划审批书：Kiro provider、多账号额度与顶部简要显示

> **状态：规划与 HTML 原型已就绪，请用户审批。** 批准前不会进入实现。

## 规划材料

- [Brief：调研证据与推荐决策](./brief.md)
- [PRD：目标、范围、验收与未决问题](./prd.md)
- [UI：原型门禁、状态矩阵与推荐文案（Settings 风格已按用户反馈修订）](./ui.md)
- [Design：bootstrap、OAuth、GetUsageLimits、Path B 与 compact 架构（左侧分节导航修订）](./design.md)
- [Implement：8 项 DAG 与机器可读 implementation plan](./implement.md)
- [Checks：自动验证、真实 provider 与浏览器验收](./checks.md)
- **HTML 原型（已修订 Settings 放置风格，必看）**：[kiro-provider-usage-compact-prototype.html](./kiro-provider-usage-compact-prototype.html)

## 目标与范围摘要

本计划不是“只安装一个 Pi extension”，完整交付包括：

1. `pi-kiro-provider@0.2.2` 通过 jiti + Next external 固定接入所有 Web / Studio / Models / Auth provider 入口；
2. Kiro Builder ID / Google / GitHub OAuth 多账号：opaque storage id、独立 secret、全局 Active mirror 与 CAS refresh；
3. AWS `GetUsageLimits` 真实额度、严格安全 parser/cache、Models 与顶部展示；
4. Kiro 独立 Path B 限额/限流自动切号与同 turn 一次重试，不修改 GPT / Grok / OpenCode controller；
5. GPT / Grok / Kiro 共用一个全局顶部**简要显示**模式，详细 panel 仍保留。

## 核心技术决策

### 1. 额度数据源已确认

不使用 Kiro streaming `meteringEvent` 推算订阅额度。采用 AWS 官方开源 SDK 定义的：

- `POST https://q.<region>.amazonaws.com/`
- `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits`
- 字段：`usageBreakdownList` / `currentUsage` / `usageLimit` / `nextDateReset` / `subscriptionInfo`

Web 自实现 allowlist parser、60s fresh / 24h stale、single-flight 与 401 单次 refresh retry；响应不返回 raw payload、userInfo、token、profile ARN 或路径。

### 2. Provider 加载必须泛化

`pi-kiro-provider` 与 `pi-grok-cli` 都发布 TS 源码并使用 ESM `.js` specifier。统一 provider 列表必须覆盖主 Chat、Studio SDK child、Models/Auth、Skills/Commands、assist routes 与 bare ModelRegistry；漏一个 call site 都可能在 refresh 后丢 provider。

### 3. Kiro failover 独立（Path B）

Kiro controller 位于 Grok 外层，链为 Kiro → Grok → OpenCode Go → ChatGPT → Pi native。仅明确 AWS quota reason / explicit rate-limit 可触发；`INSUFFICIENT_MODEL_CAPACITY`、bare 429、网络、timeout、5xx、auth、context、content 与 model 错误全部拒绝。unknown / stale quota 候选 **fail-closed**。

### 4. 简要模式全局且只压缩 trigger

新增 `usage.providerPanelsCompact`（默认 `false`）。所有已启用 provider 同时切换；各 provider 的显隐仍独立。简要 trigger 只保留提供商标识 + 最多两个关键额度摘要，**点击仍打开原 detailed popover**。

原型推荐 Kiro 简要主数字：**剩余 Credit**（如 `Kiro 剩余 125M`），因 AWS 多 bucket（Credits / Requests）时剩余点数比单一使用率更直观。

### 5. Settings 配置放置风格对齐生产

根据用户反馈（Settings 配置中 Kiro 风格对齐 Grok/ChatGPT 放置方式），已将原型和设计修订为：
Settings 视图保持生产的「左侧分节导航 + 右侧具体内容」布局。ChatGPT、Grok 和 Kiro 作为同级、同视觉的分节（section）独立并列。Kiro 的用量悬浮面板开关与自动切换开关均在独立的 Kiro 分节下，而全局「顶部额度组件简要显示」开关则统一收拢在 Usage 分节中，不破坏已有逻辑。

## Implementation DAG

| 阶段 | 子任务 | 依赖 / 并行 |
| --- | --- | --- |
| 1 | `KIRO-01` provider bootstrap | 首先执行 |
| 2 | `KIRO-02` OAuth accounts；`KIRO-03` config/settings | 2 项并行 |
| 3 | `KIRO-04` quota service | 等待 accounts |
| 4 | `KIRO-05` failover；`KIRO-06` Models UI；`KIRO-07` topbar compact | 3 项文件隔离并行 |
| 5 | `KIRO-08` integration / checks / docs | 最终 barrier |

`maxConcurrency = 3`。完整 JSON 计划、文件清单、验收与风险见 [Implement](./implement.md)；主会话已将 implementation plan 保存到 Studio task。

## 重点风险

- Registry call site 遗漏导致 Kiro 冷启动或 refresh 后消失；
- Builder ID / social 凭据 shape 差异或 clientSecret / profileArn 泄漏；
- GetUsageLimits region / profile 兼容与 schema 演进；
- bare 429 / 模型容量不足误触发切号；
- 并发 Session 级联切多个账号；
- shared compact UI 错误合并 GPT 5h/7d、Grok month/week 与 Kiro 动态 buckets。

对应缓解与回滚见 [Design](./design.md) 与 [Checks](./checks.md)。

## 请您确认的产品决策（默认推荐）

| # | 决策点 | 推荐 |
| --- | --- | --- |
| 1 | 简要模式范围 | **全局开关**（非 per-provider） |
| 2 | 简要 trigger 点击 | **仍打开详细 popover** |
| 3 | Kiro 简要主数字 | **剩余 Credit**（非使用率%） |
| 4 | unknown/stale 额度账号 | **禁止作为自动切号候选（fail-closed）** |

可在浏览器直接打开 HTML 原型切换 full/compact、viewport 与 Kiro 各状态后确认。

## 审批后流程

1. 您明确批准本计划 + 原型（可附带对上表 1–4 的调整）。
2. 主会话将任务 transition 到 `awaiting_approval` 并记录批准（若工作流要求）。
3. **只有**您再次明确说可以开始实现后，才进入 `implementing` 并按 DAG 派发 implementer。
4. 批准前 **不会**改生产代码。
