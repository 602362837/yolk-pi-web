# Checks：聚合用量浮窗动态窗口修复

## 需求覆盖

- [ ] provider adapter 只投影当前账号实际存在的安全窗口，不补 5h/7d/week/month。
- [ ] 通用 projector 统一按可信 duration 短→长：外圈最短、内圈更长、中心外圈。
- [ ] GPT only-7d 为 7d 单圈；Grok only-week 为周单圈。
- [ ] mixed-window 乱序、跨 provider 输入得到与输入顺序/provider 无关的相同布局。
- [ ] 单个 unknown-duration 可单圈；多窗口 unknown/tie 留详情；all-unknown multi 不任意挑 ring/center。
- [ ] `Limits`、quota、remaining、resetAt、resourceType、percent、数组/字段/id 顺序不作为 duration。
- [ ] 外圈 percent unknown 时中心保留外圈 label 与 `—`/同 bucket fallback，不借内圈。
- [ ] 聚合 panel/column/header/badge/close/button/detail-only 状态跟随 light/dark。
- [ ] panel header 环 ≥38px 且 ≥ trigger 30px。
- [ ] 层身份、逐层 tone、SVG mask 流光、reduced-motion、hover/focus、220ms、分栏、无总环保留。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:provider-usage-aggregate
npm run test:provider-usage-compact
npm run test:chatgpt-usage-panel
npm run test:grok-usage-panel
npm run test:kiro-config
git diff --check
```

重点行为断言：

1. **公共 projector**
   - `centerLayerId === layers[0].id`，renderer 按 id 找层；非法 center fail loud。
   - 输入 `[7d,2h,1d]` 与任意 permutation 都输出 `[2h,1d,7d]`。
   - 相同候选集合换 provider key 不改变 layer order。
   - only-one known / only-one unknown 均单圈。
   - known+unknown、one-known+unknown、all-unknown、duplicate-duration tie 分别走 ordered/degraded/detail-only 安全模式。
   - `Limits`、`remaining 10`、`reset tomorrow`、resourceType 不解析成 duration。

2. **Provider adapter**
   - GPT actual tiers only-7d、only-5h、future recognized period、缺失窗口；不得存在固定 `[5h,7d]` push 顺序断言。
   - Grok only-week、only-month、dual input permutation/候选归一；adapter 不设 center。
   - Kiro explicit 90m/2h/day/week、乱序、unknown label、`Limits`、tie；remaining 只可做同 bucket 文案。

3. **Shell / UI / 安全**
   - aggregate shell 无 fetch、无 accordion、无 total/composite ring、无 secret fields。
   - light/dark usage tokens 存在，panel 无固定夜间背景/关闭按钮。
   - fallback/detail-only 文案为固定安全 copy，不渲染 raw evidence/error。
   - panel ring 不小于 trigger；`≤640` 两列、`≤420` 单列。
   - SVG `<mask>` 与 reduced-motion 断言仍在。

## 人工验收矩阵

每个场景至少检查 light + dark，并覆盖 Desktop、640、375、320：

1. **only-7d**：GPT 仅 7d 单圈，中心 7d；无空 5h 轨道。
2. **only-week**：Grok 仅周单圈，中心周；无空月轨道。
3. **mixed-window**：候选输入顺序故意乱序，显示外短内长；中心为最终最短窗口。
4. **unknown-duration**：single unknown 可单圈；known+unknown 显示单/多圈及“另有窗口仅在详情展示”；all unknown multi 无伪造 ring。
5. **outer unknown percent**：外圈 label/—，内圈独立绘制，不借值。
6. **warning/danger**：文字、banner、border 与弧可辨，不只靠颜色。
7. **loading/login/reauth/stale/error/detail-only**：按钮 hover/focus/disabled、背景、边框清晰。
8. **交互**：hover/focus 打开、跨间隙不闪退、Tab 入列、Escape 关闭不重开、pointer leave 不抢焦点。
9. **布局**：trigger 30px、panel 40/≥38px；长账号 ellipsis、ring 不缩、320px 无页面级横滚，panel 内滚动可达操作。
10. **reduced-motion / theme switch**：流光停止但信息不丢；切换主题不重挂 owner、不重置 quota、不增加 fetch。

## 回归风险与 blocker

- standalone Full/Compact 共用 primitive，click detail 和动态 center 必须同步正常。
- GPT Reset/scheduler/lock、三家 Refresh/Activate/Models 不得丢失。
- request generation/accountId guard、cache fallback、projection allowlist 不得弱化。
- 任何 provider 固定 layer push 顺序、`Limits=90d`、unknown multi 按数组/id 选 ring、中心读取最后一层、浅色固定夜间 surface、panel 环仍 small 都是 blocker。
