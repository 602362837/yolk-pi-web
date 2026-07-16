# Review：模型用量组件聚合

## Check Complete

### Findings Fixed

- **used arc 裁切**：shared N-ring 原先用 SVG `clipPath` 裁切描边，不能可靠地按描边 dash 裁出已使用弧。已改为显式 SVG `mask`（黑底 + 白色 dash stroke），使 used arc 与流光都严格限制在实际 percent 对应的弧段。
- **顶栏详情安全边界**：浏览器实测发现账号 `label` / GPT `extraInfo` 属于可自由填写的元数据，可能包含敏感内容。已从 GPT/Grok/Kiro 顶栏用量详情移除这些字段，只保留 display name 和 masked account id；aggregate 契约测试新增回归断言。
- 移除了本改动引入的 `KiroUsagePanel` unused import lint warning。

### Remaining Findings

- None blocking.
- 真实 Kiro 多窗口、三提供商同时在线，以及 640/375/320 的完整账号状态矩阵受本机账号/测试数据限制，未逐项实机覆盖；已由 N-ring、响应式 CSS 与契约测试覆盖，建议用户验收时补做现场矩阵。

### Verification

- `npm run lint` — pass；6 个既有、无关 warning，0 errors。
- `node_modules/.bin/tsc --noEmit` — pass。
- `npm run test:provider-usage-aggregate` — pass。
- `npm run test:provider-usage-compact` — pass。
- `npm run test:kiro-config` — pass。
- `npm run test:chatgpt-usage-panel` — pass。
- `npm run test:grok-usage-panel` — pass。
- `npm run test:grok-quota` — pass（48）。
- `npm run test:grok-accounts` — pass（70）。
- `npm run test:kiro-quota` — pass（37）。
- `npm run test:kiro-accounts` — pass（28）。
- `npm run test:kiro-refresh-activate-race` — pass（4）。
- `git diff --check` — pass。
- Browser / `http://localhost:30142` — Desktop 手测 Settings aggregate toggle、Compact 保值/禁用提示、aggregate 单入口、hover 打开两列、Escape 关闭；验收期间已恢复 aggregate=false、Compact=false。

### Verdict

**Pass — ready**。

配置默认值/partial merge、Settings、N-ring innermost center 与 unknown、GPT/Grok/Kiro projection、AppShell JSX 互斥、hover/focus aggregate columns、reduced-motion CSS、文档与安全边界均符合 PRD/Design/Checks。建议主会话 transition：`checking → ready`。
