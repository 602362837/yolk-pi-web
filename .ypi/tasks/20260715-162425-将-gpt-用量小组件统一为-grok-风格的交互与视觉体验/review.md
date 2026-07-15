# 独立验收：GPT 用量小组件统一为 Grok 风格

## Findings Fixed

- 修复同账号手动刷新失败时，旧的 metadata cache 优先于本页最新成功快照的问题：`page_fallback` 现在优先保留该账号的最后成功数据；metadata 较旧时不会覆盖更新的本页快照。
- 修复 `page_fallback` 掩盖 `expired` / `not_found` / `parse_error` 凭据状态的问题：保留已知额度卡的同时，仍显示固定中文重新登录提示和 Models 恢复入口。
- 补齐 GPT 组件与已添加全局样式的 class 接线：应用 scoped focus-visible、spinner、skeleton shimmer 与 reduced-motion 规则。

## Requirements / Static Review

- GPT 仅使用 `five_hour` / `seven_day`：收起态为“5 小时 / 周”，展开态为“5 小时额度 / 7 天额度”；未知额度不伪造为 0 或月度。
- `live | cached | page_fallback | none` 仍为 GPT 独立来源模型；未引入 Grok `fresh` / `stale` 语义或 `GrokQuotaResultV1`。
- 按 `accountId` 保存页面成功快照；AbortController、generation、响应 accountId 校验和 Active 切换中止路径存在。
- accounts metadata 初始/前台 30 秒/focus/visibility/展开轻读；quota GET 只在手动刷新或 Activate 后调用。
- 用户可见失败文案使用固定中文 allowlist；未发现 `credentialMessage`、quota cache error、scheduler 原始错误、lock path 或原始 HTTP 错误插入 DOM。
- `AppShell` 保持一个 `.app-top-usage-panel`、GPT → Grok 顺序和一次 right-drawer 留白；GPT 已接入 Models 打开回调。
- Reset credits 与 scheduler/lock reload/repair 仍位于 GPT 专属次级区；未进入 Grok。
- 未见本任务新增 API/schema/config；`chatgpt.usagePanelEnabled` 默认仍为 `false`。Models 保持既有英文 `5h` / `7d` helper。

## Verification

| Command / check | Result |
| --- | --- |
| `npm run lint` | Pass：0 errors；6 个既有无关 warnings（archive 验证脚本 2、`scripts/test-model-prices.mjs` 4） |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run test:chatgpt-usage-panel` | Pass，9 checks |
| `npm run test:grok-usage-panel` | Pass |
| `npm run test:grok-quota` | Pass，48/48 |
| `npm run test:grok-accounts` | Pass，70/70 |
| `npm run test:grok-global-auth` | Pass，7/7 |
| `git diff --check` | Pass |
| Browser / desktop | Pass：真实开发服务器上验证 GPT/Grok 同时挂载、中文 cached 状态、额度 rings、GPT 专属区、dialog 展开 |
| Browser / 320×640 | Pass：关闭侧栏后 panel 为 `x=8, width=304, height=560`，左右各 8px，无越界；窄屏顶部 host 可横向访问 |
| Browser / keyboard | Pass：关闭按钮与 Escape 都关闭 dialog，焦点回到 `ChatGPT 用量` trigger |

## Remaining Risks / Not Executed

- 未对真实账号执行 Activate、Reset credits、lock repair 或强制 quota 刷新，避免改变账号/额度/后台锁；相应成功、失败及 race 分支由静态审查与契约测试覆盖。
- 未逐项实机覆盖 375px、640px、外部点击、reduced-motion、无账号及三种凭据失效夹具；实现存在对应路径，仍建议主会话有脱敏夹具时补跑。

## Verdict

**Pass**。需求、设计边界、自动回归和已执行的桌面/320px/键盘验收均通过；已在范围内修复两处 page fallback/credential 可见性问题和样式 class 接线问题。可转入 `review`。
