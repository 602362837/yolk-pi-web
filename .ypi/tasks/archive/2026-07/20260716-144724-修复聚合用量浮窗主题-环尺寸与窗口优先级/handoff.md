# 实现员 Handoff：USAGE-FIX-05 文档与最终验收

## Subtask

- id: `USAGE-FIX-05`
- title: 同步文档并完成自动与浏览器验收
- status: done（代码/文档/自动验证完成；浏览器矩阵已记录，含 1 项响应式观察）

## Files Changed

- `docs/architecture/overview.md` — 同步 actual candidates → shared projector、outer=shortest / center=outer、unknown/tie 降级、theme tokens、panel ring 尺寸与 rollback。
- `docs/modules/frontend.md` — ProviderUsage contract/trigger/aggregate/GPT/Grok/Kiro 口径改为无序候选 + 公共 projector；删除固定 `[week,5h]` / `[month,week]` / center-innermost 布局。
- `docs/modules/library.md` — 补充 `lib/kiro-usage-ring.ts`；`quota-display` 标明不合成固定 5h/7d。
- `docs/integrations/README.md` — Grok/Kiro 顶栏 N-ring 改为共享 projector 短→长；rollback 说明。
- `docs/operations/troubleshooting.md` — 聚合主题/环尺寸/动态窗口错误布局排查；删除固定 GPT/Grok layer 预期。

未改生产 TS/CSS（本子任务边界仅 docs + validation）。

## Validation

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors；既有 warnings（含 `ChatGptUsagePanel` unused vars / projector local var，非本子任务引入） |
| `node_modules/.bin/tsc --noEmit` | pass |
| `npm run test:provider-usage-aggregate` | pass |
| `npm run test:provider-usage-compact` | pass |
| `npm run test:chatgpt-usage-panel` | pass |
| `npm run test:grok-usage-panel` | pass |
| `npm run test:kiro-config` | pass |
| `git diff --check` | pass（无输出） |

## Browser matrix (`http://localhost:30142`)

环境：`usage.providerPanelsAggregated=true`；`chatgpt/grok.usagePanelEnabled=true`；`kiro.usagePanelEnabled=false`（真实账号仅 GPT+Grok 两列）。截图目录：`/tmp/ypi-usage-fix-05/`。

| 检查 | 结果 |
| --- | --- |
| light desktop open | panel surface 浅色 token（非 `rgba(11,15,25,.98)`）；close 浅灰；trigger rings 30px；column large rings **40px** |
| dark desktop open | panel/close 跟随 dark tokens；无固定 `#1e293b` 关闭钮 |
| GPT only-7d | 真实数据：单圈 7d / 中心「周 21%」；无空 5h 轨道 |
| Grok week+month | 外短内长：aria「周…，月度…；中心为外圈优先层 周 35%」；中心周非月 |
| 640 dark | panel clamp；large rings 40px；无页面横滚；2 列 |
| 375 / 320 | panel clamp；large rings 40px；**无页面级横滚**（320 scrollW=clientW） |
| Escape | 关闭后不立即重开 |
| hover reopen | 可再次 hover 打开 |

### 未完全覆盖 / 观察

1. **响应式 1 列断点观察（非 blocker for docs，但应告知检查员）**：CSS 有 `@media (max-width: 420px) { grid-template-columns: 1fr }`，但组件 inline `gridTemplateColumns: repeat(N, minmax(0,1fr))` 在 375/419 实测仍为 2 列。自动测试只断言 CSS 文本存在。若检查员要求严格 375/320 单列，需后续提高 media-query 优先级或去掉 inline template（**超出 USAGE-FIX-05 纯文档边界，未改生产代码**）。
2. **Kiro 真实列**：本机 `kiro.usagePanelEnabled=false`，未做真实 Kiro 账号浏览器列；Kiro 行为由 focused tests 覆盖。
3. **warning/danger / outer-unknown / all-unknown multi / detail-only 文案**：当前真实 GPT/Grok percent 正常（21%/35%/37%），未出现 warning/danger 与 detail-only UI；这些由 projector/adapter 测试覆盖。
4. **真实数据无法证明 duration 时**：按契约应 detail-only / ring null；本机账号均有可信 week/month/7d evidence，未观察到 live detail-only。**不得为多环放宽 evidence**。

## Notes / Risks

- 文档已消除“中心最内层 / 固定 week·month·5h·7d 布局 / Limits=90d 产品口径”。
- lint 仍有 ChatGptUsagePanel 未使用局部变量 warning，建议检查员/后续小清理，不阻塞本子任务文档验收。
- 375/320 单列 CSS vs inline style 优先级是唯一浏览器矩阵缺口；主会话可决定是否开 follow-up 修 CSS 或接受当前 2 列窄屏。

## Parent next steps

1. 将 `USAGE-FIX-05` 标为 done，进度 5/5。
2. 派 checker 做 localReview（公共 projector 已在前序子任务；本轮重点 docs 一致性 + 浏览器矩阵）。
3. 决定是否对 420px 单列 inline-style 覆盖问题开小修 follow-up。
