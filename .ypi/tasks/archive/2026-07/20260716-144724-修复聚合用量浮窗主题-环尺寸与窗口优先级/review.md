# Review：修复聚合用量浮窗主题、环尺寸与动态窗口优先级

**Task:** `20260716-144724-修复聚合用量浮窗主题-环尺寸与窗口优先级`  
**Reviewer:** checker  
**Verdict:** **Pass** — 建议主会话标记 **ready / 可进入用户验收**  
**Date:** 2026-07-16

## Scope Reviewed

对照 PRD / Design / UI / Checks / Implement plan（USAGE-FIX-01…05）与实现员 handoff，审查：

1. 共享 candidate → projector（短→长、only-one / mixed / unknown / tie / 乱序）
2. GPT / Grok / Kiro 无固定窗口补层；Kiro 无 `Limits=90d`
3. 聚合浮窗 light/dark、中心对比、列头环 ≥ trigger、响应式
4. hover/focus、220ms、Escape、流光 / reduced-motion、分栏、无总环
5. lint / tsc / focused tests / `git diff --check`
6. `http://localhost:30142` 浏览器验收可访问

## Findings Fixed

- 删除 `ChatGptUsagePanel.tsx` 中未使用的 `fiveHourTier` / `sevenDayTier` / `hasFiveHour` / `hasSevenDay` / percent 局部变量（lint 警告来源；不参与 ring 投影）。
- 清理 `projectProviderUsageWindows` 中未使用的 `detailOnlyCandidateIds` / `unknownIds` / `tiedIds` 中间变量（行为不变：leftover 仍由非投影 safe 候选导出）。
- 修正测试标题 `center innermost` → `center outermost`，避免与契约文档冲突。

## Remaining Findings

### Non-blocking

1. **窄屏 1 列实测依赖 `!important`**  
   `ProviderUsageAggregatePanel` 仍写 inline `gridTemplateColumns: repeat(N, …)`；`globals.css` 在 `≤640` / `≤420` 使用 `!important` 覆盖。CSSOM 已确认 `max-width: 420px` 规则为 `1fr !important`。实现员曾观察到 375 仍 2 列，更可能是 viewport 未真正缩小；当前源码契约满足 Checks。若真实设备仍异常，可 follow-up 去掉 inline template，仅用 CSS。

2. **GPT UI 路径仍经 `knownQuotaTiers` 过滤**  
   `displayModel.tiers` 只保留 `five_hour` / `seven_day`；`buildChatGptUsageWindowCandidates` 虽接受 future 可解析 period，但 live UI 暂时吃不到。当前 GPT wire 仅这两档；only-7d / only-5h / dual 验收不受影响。未来多档需放宽 display filter 或与 candidate 对齐。

3. **detail-only 横幅主要在 Kiro 详情露出**  
   GPT/Grok adapter 多返回 `ringUnit`，未把 `detailNote` 挂到各自 detail UI（Grok 仅有 typed week/month，GPT 经 known filter 后也少见 multi-unknown）。共享 projector 与 Kiro 测试已覆盖降级文案；非 blocker。

4. **真实账号未覆盖 warning/danger / all-unknown multi / Kiro 列**  
   本机聚合列为 GPT+Grok（Kiro panel 关闭）；正常 percent。对应场景由 focused tests 覆盖。

### Blockers

None.

## Requirement Coverage

| 验收点 | 结论 |
| --- | --- |
| adapter 只投影实际窗口，不补 5h/7d/week/month | Pass — GPT 遍历实际 tiers；Grok optional week/month；Kiro safe buckets |
| 公共 projector 短→长；外圈/中心最短 | Pass — `centerLayerId === layers[0].id`；permutation 稳定 |
| only-7d / only-week 单圈 | Pass — 测试 + 浏览器 GPT 仅 7d 中心「周」；Grok 双窗中心「周」 |
| mixed 乱序 / 跨 provider 无关 | Pass — compact/aggregate 测试 |
| single unknown 单圈；multi unknown/tie 详情；all-unknown multi 无 ring | Pass — projector + Kiro 测试；`Limits` 不解析 duration |
| 禁止 Limits/remaining/reset/percent/数组顺序猜 duration | Pass — resolver 负例 + 无 `90 * 86_400_000` |
| 外圈 percent unknown 中心 `—`/同 bucket，不借内圈 | Pass — 测试 + renderer by id |
| light/dark 主题 token，无固定夜间 surface | Pass — 源码无 `rgba(11,15,25)` / 关闭钮 `#1e293b`；浏览器 light surface 浅、dark 深 token |
| panel 环 ≥38px 且 ≥ trigger 30px | Pass — 浏览器 trigger 30 / column header **40** |
| hover/focus、220ms、Escape、mask 流光、reduced-motion、分栏、无总环 | Pass — 源码 + aggregate 测试；浏览器 hover 打开、Escape 关闭（`data-open=false` / `aria-hidden`） |
| UI HTML 原型与 plan-review 审批材料 | Pass — 任务内存在 `usage-aggregate-theme-priority-prototype.html` + plan-review |

## Browser (`http://localhost:30142`)

服务 **200** 可访问（node listen 30142）。聚合开启时：

| 检查 | 结果 |
| --- | --- |
| light tokens | `--usage-panel-surface` / center / warning-danger fg 有值；panel 浅 surface |
| dark open | panel/close 跟随 dark tokens（非固定夜间硬编码） |
| GPT only-7d | aria「7 天额度 21%；中心为外圈优先层 周 21%」；`centerId=gpt-week`；1 层 |
| Grok week+month | aria「周…，月度…；中心为外圈优先层 周 35%」；`centerId=grok-week`；2 层 |
| 尺寸 | trigger rings 30×30；column header rings **40×40** |
| Escape | 关闭后 `data-open=false`，panel `display:none` / `aria-hidden=true` |
| 420 CSS | CSSOM 存在 `grid-template-columns: 1fr !important` |

未在本检查轮次强制真实 320 像素设备重测横滚；实现员矩阵与 `max-width: calc(100vw - 16px)` + `overflow-x: hidden` 仍有效。

## Verification

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors；6 warnings（归档脚本 / `test-model-prices` 既有 unused；**无**本任务组件 unused） |
| `node_modules/.bin/tsc --noEmit` | pass |
| `npm run test:provider-usage-aggregate` | pass |
| `npm run test:provider-usage-compact` | pass |
| `npm run test:chatgpt-usage-panel` | pass |
| `npm run test:grok-usage-panel` | pass |
| `npm run test:kiro-config` | pass |
| `git diff --check` | pass |
| `http://localhost:30142` | HTTP 200；聚合 trigger/panel 可交互 |

## Design / Safety Notes

- 无 API / storage / schema 变更；回滚仍可 `usage.providerPanelsAggregated=false`。
- Aggregate shell 无 fetch；projection allowlist / secret 字段测试保留。
- 公共 projector 为纯函数，不接受 provider key 排序参数。

## Checker code touch (low-risk only)

- `components/ChatGptUsagePanel.tsx` — 删除死变量  
- `components/ProviderUsagePanelContract.ts` — 去掉未使用中间变量  
- `scripts/test-provider-usage-compact.mjs` — 测试标题/注释与 outer-center 契约对齐  

## Verdict

**Pass。** 需求、设计、主题/尺寸、动态窗口与安全契约已满足；自动验证全绿；30142 浏览器抽检通过。  
建议主会话：**ready**（可进用户验收）。可选 follow-up：去掉 columns inline `gridTemplateColumns`；GPT detail-only UI 与 future-tier display 对齐。
