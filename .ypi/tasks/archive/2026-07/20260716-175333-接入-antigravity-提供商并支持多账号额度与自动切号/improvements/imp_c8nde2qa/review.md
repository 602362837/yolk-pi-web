# Review：IMP-001 按模型组聚合 Antigravity 额度与双独立圆环

> **检查员结论：Pass（改进实现门禁通过）**  
> AG-G01…AG-G05 生产实现与契约测试满足 hard 验收；未在本会话做交互式浏览器矩阵或真实 Google OAuth 视觉验收，记为 UAT 残留，不作为实现返工 blocker。

## 检查范围

- 对照 `brief.md` / `prd.md` / `design.md` / `ui.md` / HTML 原型 / `implement.md` / `checks.md`
- 覆盖 AG-G01…AG-G05 生产文件：映射聚合、ring 投影、UsagePanel、Models QuotaView、Trigger/Aggregate 多环、failover 回归、文档
- 运行硬验收命令：usage-panel / quota-groups / models-ui / failover / provider-usage-aggregate / lint / tsc

## 硬验收对照

| # | 标准 | 结论 |
| --- | --- | --- |
| 1 | Flash+Opus → **两个独立并排圆环**；禁止同一 `ringUnit` outer/inner 混组 | **Pass** |
| 2 | 组聚合 `max(used)` / `min(remaining)`；详情与 Models 按组 | **Pass** |
| 3 | `resetTime` 非 duration；failover **非** group-aware | **Pass** |
| 4 | Aggregate 第四列同源（`ringUnits` / panel owner） | **Pass** |
| 5 | 指定自动验证全绿 | **Pass** |
| 6 | 结论写入本 `review.md` | **Pass** |

## 实现证据（静态）

### AG-G01 映射 / 保守聚合 — Pass

- `lib/antigravity-quota-groups.ts`：固定 0.3.0 `quotaKey → groupId`；未知→`other`
- 组序：Flash → Opus → Sonnet → Pro → 2.5 → Other
- 聚合：`max(usedPercent)` / `min(remainingFraction)`；同 id 去重保守 merge；`resetsAt` 仅最早可解析 ISO 展示
- pure 模块：无 React / network / fs / 私有包 import

### AG-G02 ring 投影 — Pass（核心纠正已落地）

- `lib/antigravity-usage-ring.ts`：
  - `mode: dual-independent | single | detail-only | empty`
  - Flash+Opus → `ringSlots.length === 2`，每 slot **单层** unit；`ringUnit` 在 dual 时为 `null`（防误用单 unit 打包两组）
  - 仅一组 → 单独立环，不画假 0% 兄弟组
  - 仅非优先组 → detail-only +「多模型」
  - 硬不变量：slot `layers.length !== 1` 会 throw
  - 明确禁止 Flash outer + Opus inner 同心构造
- Aggregate：`buildAntigravityUsageAggregateProjection` 输出 `ringUnits`（方案 A）；无跨组/跨 provider 总%

### AG-G03 / Trigger / Aggregate UI — Pass

- `ProviderUsagePanelContract`：allowlist 增加可选 `ringUnits`；`resolveAggregateRingUnits` 优先 multi
- `ProviderUsageTrigger`：`ringUnits?.length > 1` 并排独立环（`data-multi-independent` / ring-slot）
- `AntigravityUsagePanel`：接 `ringSlots`/`ringUnits` + 组 accordion（默认折叠、变体展开、无 per-variant 刷新）
- 第四列顺序与既有 GPT→Grok→Kiro→Antigravity 契约保持

### AG-G04 Models — Pass

- `AntigravityQuotaView` 复用 `groupByAntigravityQuotaWindows`（无第二张映射表）
- 组头保守聚合文案；展开变体；未知/空 quota 不阻断账号管理路径

### AG-G05 Failover / 文档 — Pass

- Failover **不** import groups；候选仍是当前 public model accepted keys + fresh/live remaining>0
- 契约锁：同组 sibling 有额度、当前 key 耗尽 → 不候选；跨优先组同理
- `docs/integrations/README.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/operations/troubleshooting.md` 已写清：独立环 vs 周期 N-ring、保守聚合、非 group-aware failover

## Findings Fixed

None（检查员未改生产代码；实现 diff 无需范围内小修）。

## Remaining Findings

### 非阻塞

1. **规划 artifact 文案残留不一致（非生产）**  
   - `implement.md` 中 AG-G02 `instructions` 仍写 “outer Flash and inner Opus…”（与同文件顶部「双独立圆环纠正」矛盾）。  
   - 早期 `summary.md` 仍残留 “Flash 外环 + Opus 内环”。  
   - **生产代码、design/ui/plan-review/checks/tests 已按双独立环正确实现。**  
   - 建议主会话后续顺手修正 plan 文案，避免后人误读；**不阻断本改进验收**。

2. **交互式浏览器矩阵 / 真实 OAuth 视觉 UAT 未在本检查会话执行**  
   自动化源码契约与投影单测已覆盖 dual/single/other-only/stale/reauth 与 multi-ring wiring；桌面与 320/375/640 对照 HTML 建议用户验收时再点一次。

3. **固有产品风险（主任务已披露）**  
   非官方通道、宽 scope、硬编码 client/UA 等不变；panel 默认关闭可止血。

### 阻塞

None。

## Verification

| 命令 | 结果 |
| --- | --- |
| `npm run test:antigravity-usage-panel` | Pass |
| `npm run test:antigravity-quota-groups` | Pass |
| `npm run test:antigravity-models-ui` | Pass 14/14 |
| `npm run test:antigravity-failover-adapter` | Pass 43/43 |
| `npm run test:antigravity-failover-runtime` | Pass 12/12 |
| `npm run test:provider-usage-aggregate` | Pass |
| `npm run lint` | Pass（0 errors；既有 warnings，与本改进无关） |
| `node_modules/.bin/tsc --noEmit` | Pass |
| 浏览器 Full/Compact/Aggregate 像素对照 | **未执行**（UAT） |
| 真实 Google OAuth / live quota 双环 | **未执行**（凭据/本检查范围） |

## 安全 / 隐私抽查

- Aggregate / Trigger projection 仍 allowlist；无 accountId / projectId / token / raw body
- Models / UsagePanel 组 UI 不展示 secret
- Failover 不读 group remaining；SSE 隐私边界未放宽

## Verdict

**Pass**

IMP-001 实现满足用户纠正后的核心语义：**两组额度 = 两个并排独立单层环**，不是同一 N-ring 的 outer/inner；组聚合保守；resetTime 非 duration；failover 保持 model-key 且非 group-aware；Aggregate 第四列同源 multi-ring。

建议主会话：

1. 保留本 `review.md` 为 improvement 检查产物  
2. 将 improvement **转到 user_acceptance**  
3. UAT 重点：顶栏 Full/Compact/Aggregate 双独立环、详情/Models accordion、窄屏与键盘；无凭据时不得勾选 live dual-ring 视觉已验  
4. 可选：清理 `implement.md` AG-G02 过时 concentric 指令与旧 `summary.md` 文案（非 blocker）

## Handoff 摘要（给主会话）

- **Artifacts produced**：`improvements/imp_c8nde2qa/review.md`（本文件）
- **Files changed by checker**：无
- **Validation**：上表全绿（除浏览器/真实 provider UAT）
- **Remaining risks**：plan 文案残留；UAT 视觉矩阵未跑
- **Decisions needed**：推进 user_acceptance；无需实现员返工
