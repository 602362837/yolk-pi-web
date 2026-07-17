# Review：接入 Antigravity 提供商并支持多账号额度与自动切号

> **检查员结论：Pass（实现门禁通过）**  
> 自动化验证与静态审查满足 PRD / Design / Implement / Checks；真实 Google OAuth / 浏览器矩阵因本机无 Antigravity 凭据未执行，已显式记为 UAT 残留风险，不作为实现返工 blocker。

## 检查范围

- 对照 `brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` 与 task-local HTML 原型
- 覆盖 AG-01…AG-08 全部 done 子任务的生产 diff、调用方与文档
- 运行 checks 计划中的 lint / tsc / Antigravity 套件与 GPT/Grok/Kiro/OpenCode 回归

## 门禁材料

| 项 | 状态 |
| --- | --- |
| UI 设计员 HTML 原型 | 有：`antigravity-provider-multi-account-quota-prototype.html` |
| `ui.md` 链接与状态矩阵 | 有 |
| `plan-review.md` / implementationPlan | 有（8/8 done） |
| 无 `pi-antigravity-rotator` 依赖 | 确认（package / lock / 源码均无） |

## 需求覆盖结论

### R1 Provider bootstrap — Pass

- 精确依赖 `@yofriadi/pi-antigravity-oauth@0.3.0`（package + lock）
- `serverExternalPackages` 含包名；应用侧无静态私有 `src/**` import
- `webProviderExtensions()` 固定顺序 Grok → Kiro → Antigravity；单 provider 失败隔离
- jiti 加载公开 default / `pi.extensions` 入口；首次 import 前强制 `PI_OAUTH_CALLBACK_HOST=127.0.0.1`（single-flight + restore）
- 主 Chat、Studio child、Models/Auth、Skills/Commands、assistant、model-prices、裸 ModelRegistry 入口均经统一 bootstrap
- callback 安全测试覆盖实际 loopback 监听策略

### R2 OAuth 多账号 — Pass

- `google-antigravity` adapter：非空 `access`/`refresh`/`projectId` + finite `expires`；`supportsCredentialImport=false`
- opaque storage id；real id 仅 `sha256(refresh)` 诊断；`projectId` 不进 metadata / wire
- provider lock（`withAntigravityProviderLock`）共享 refresh/Activate；非 Active refresh 不覆盖 `auth.json` mirror（CAS）
- refresh merge 保留 projectId；错误映射为固定安全文案
- race 测试覆盖 refresh + Activate 并发

### R3 Quota — Pass

- 仅固定 `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
- body 仅 server-side `project`；固定 UA/header；10s timeout；无 credential URL
- `usedPercent = 100 × (1 − remainingFraction)`；非法 remaining 拒绝而非归零
- 60s fresh / 24h stale、single-flight、401 单次 force-refresh retry；403 ≠ reauth
- wire 仅 `AntigravityQuotaResultV1`；GET + `refresh=1` / POST 405 / `no-store`
- 默认 `rising-fact-p41fc` 不作为健康捷径

### R4 自动切号 Path B — Pass

- 独立 controller；默认 `antigravity.autoFailover.enabled=false`
- 链外层：Antigravity → Kiro → Grok → OpenCode Go → ChatGPT → Pi native
- 正例 / 硬负例（含裸 429、Cloud Code Assist API error (429)、auth/project/network/5xx/capacity/context 等）符合设计
- model-aware：仅当前 public model 映射 entry 且 `remainingFraction > 0`；stale/unknown/other-model-only fail-closed
- 同 turn 预算 + lock + Active 复验 + TOCTOU；SSE allowlist 无 accountId/token/projectId
- Chat 终端态不显示虚假 Retrying

### R5 Models / Settings / Topbar — Pass（契约级）

- Models：managed OAuth 能力扩展、风险披露、Active/删除保护、按模型 quota、切换 generation/abort 清旧数据
- Settings：Antigravity 分节；panel + autoFailover 默认关；全局 Compact/Aggregate 文案扩展
- AppShell：第四 provider；aggregate 与 standalone 互斥挂载；单一 owner / 无双轮询契约
- N-ring：单安全窗口可 ring；多模型无可信 duration → detail-only（`多模型`），不 sum/avg/min/max，不按 resetTime 排序
- Aggregate 顺序 GPT → Grok → Kiro → Antigravity

### 文档 — Pass

- `AGENTS.md`、`docs/integrations/README.md`、`docs/architecture/overview.md`、`docs/modules/*`、`docs/operations/troubleshooting.md` 已更新风险、边界、回滚与模块入口

## Findings Fixed

None（检查员未改生产代码；实现 diff 无需范围内小修）。

## Remaining Findings

### 非阻塞 / UAT

1. **真实 provider 流程未在本环境执行**  
   `test:antigravity-integration` 记录  
   `REAL_PROVIDER_BLOCKER: no local Antigravity OAuth credentials`。  
   不得声称 live OAuth / 真实模型对话 / 真实 quota / 真实 failover 已验收。  
   用户验收需至少完成：冷启动 Models 可见 → 真实 Google OAuth（或远程 manual redirect）→ 一次真实模型请求 → 真实 `fetchAvailableModels` 抽样 → 双账号 Activate。

2. **交互式浏览器矩阵未在本检查会话逐像素走完**  
   自动化 UI/CSS/a11y 源码契约与状态矩阵测试已通过；桌面 / 320·375·640 / Full·Compact·Aggregate / 状态矩阵建议在 UAT 对照 HTML 原型再确认一次。

3. **lint 警告（非错误）**  
   `lib/pi-provider-extensions.ts`：`_envValue` unused 参数警告。不影响行为；可后续顺手清理。

4. **固有产品风险（设计已披露，需用户知悉）**  
   非官方 Cloud Code 通道、宽 `cloud-platform` scope、硬编码 IDE client / 模拟 UA、上游可能改接口。默认 panel/failover 关闭可止血。

### 阻塞

None。

## Verification

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | Pass（0 errors；既有 + 1 处 Antigravity 相关 warning） |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run test:antigravity-provider` | Pass 32/32 |
| `npm run test:antigravity-callback-security` | Pass 8/8 |
| `npm run test:antigravity-accounts` | Pass 29/29 |
| `npm run test:antigravity-refresh-activate-race` | Pass 4/4 |
| `npm run test:antigravity-config` | Pass |
| `npm run test:antigravity-quota` | Pass 30/30 |
| `npm run test:antigravity-model-quota` | Pass 10/10 |
| `npm run test:antigravity-failover-adapter` | Pass 39/39 |
| `npm run test:antigravity-failover-runtime` | Pass 12/12 |
| `npm run test:antigravity-models-ui` | Pass 10/10 |
| `npm run test:antigravity-usage-panel` | Pass |
| `npm run test:antigravity-integration` | Pass 35/35（含 REAL_PROVIDER_BLOCKER 记录） |
| `npm run test:provider-usage-compact` | Pass |
| `npm run test:provider-usage-aggregate` | Pass |
| `npm run test:chatgpt-failover-contract` | Pass 25/25 |
| `npm run test:grok-all` | Pass |
| `npm run test:kiro-integration` | Pass 29/29 |
| `npm run test:opencode-go-failover-behavior` | Pass 54/54 |
| `npm run test:oauth-accounts` | Pass |
| `npm run test:grok-provider` | Pass 36/36 |
| `npm run test:kiro-provider` | Pass 30/30 |
| `git diff --check` | Pass |
| 真实 Google OAuth / 浏览器矩阵 | **未执行**（凭据缺失，见 Remaining） |

## 安全 / 隐私抽查

- SSE `antigravity_account_failover` 仅投影 `status/reason/provider/retry/message`
- quota wire / usage aggregate 无 token、refresh、projectId、raw body、URL
- Models 风险文案明确不展示 client_secret / token / projectId
- 无 `pi-antigravity-rotator` 依赖或运行时引用

## Verdict

**Pass**

实现完整覆盖 AG-01…AG-08 与核心验收标准；自动回归与既有 provider 行为保持；无 callback 非 loopback、secret 泄漏、跨模型总额度、blind failover、rotator 依赖等阻断项。

建议主会话：

1. 保留 required artifact `review.md`（本文件）
2. 按工作流 transition 到 **review / user_acceptance**
3. UAT 重点跑真实 OAuth + 顶栏 Full/Compact/Aggregate + 状态矩阵；无凭据时不得勾选“真实 failover 已验证”
4. 不在本检查阶段 archive

## 给主会话的 handoff 摘要

- **Artifacts produced**：本 `review.md`
- **Files changed by checker**：无
- **Validation**：上表全绿（除真实 provider）
- **Remaining risks**：真实 OAuth/quota/failover UAT；非官方通道固有风险
- **Decisions needed**：主会话推进用户验收；无需实现员返工
