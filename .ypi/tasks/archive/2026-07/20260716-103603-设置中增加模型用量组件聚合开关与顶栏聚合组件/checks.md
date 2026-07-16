# Checks：模型用量组件聚合（v6 多环、流光与焦点分栏版）

## 0. 审批门禁

- [ ] `plan-review.md` 标明“v6 待 UI 原型”，链接 PRD/Design/Implement/Checks/UI/HTML。
- [ ] UI 设计员已将 `ui.md` 与 HTML 更新为 v6；v5 accordion/旧中心规则不得作为实现依据。
- [ ] v6 覆盖明显层色/stroke、逐层 tone、used-arc flow/reduced-motion、最内层中心、Kiro 1/N rings、hover/focus 分栏及 320px。
- [ ] 用户已对同一 revision 明确批准；批准前无生产实现或状态迁移。
- [ ] 默认关闭、Compact 保值、无总环/总百分比/新 API/刷新全部/remaining→percent。

## 1. 配置与 Settings

- [ ] `usage.providerPanelsAggregated` 是 boolean，default/missing=false；非法类型报固定字段路径。
- [ ] partial patch 保留 compact/includeArchived/free models/pricing/fallback 等字段。
- [ ] aggregated=true 时 Compact disabled 但 checked/config 值不改写。
- [ ] Compact 说明为 standalone N-ring，不再声称文字摘要。

## 2. Shared N-ring primitive

- [ ] Full、Compact、aggregate 共用同一 primitive；无复制的 conic/clamp/threshold/unknown/flow 算法。
- [ ] `layers` 非空、id 唯一、顺序 outer→inner；1 window=1 ring，N windows=N concentric rings。
- [ ] `centerLayerId === layers[layers.length-1].id`；无效值被测试捕获，不静默选层。
- [ ] center label/value 只来自最内层；最内层 percent unknown 显示 `—`，不借外圈值。
- [ ] 每层独立 clamp `[0,100]` 和 `>=95 danger` / `>=80 warning` / normal；无 composite percent。
- [ ] unknown 是 muted empty arc，不渲染 0%、不设置 `aria-valuenow=0`。
- [ ] 每个 nesting index 有固定可区分 hue/stroke；相邻层不能仅靠透明度区别。
- [ ] warning/danger 是本层第二视觉通道，叠加后仍能识别外/内层身份。
- [ ] N-ring title/aria 按 outer→inner 列出每层 full label、percent/unknown 和 center innermost。

## 3. Used arc animation

- [ ] 可信 `percent>0` 的 used arc 有 subtle sheen/flow；overlay 被同 percent mask 裁剪。
- [ ] 动画不改变弧长、tone、center 值，不看起来像 percent 增长。
- [ ] unknown/0% 不产生虚假 used-arc 流光；loading spinner 与流光状态分离。
- [ ] CSS-only，无持续 JS timer、React animation state、额外 request 或 layout shift。
- [ ] `prefers-reduced-motion: reduce` 下流光和非必要 panel transition 停止，静态信息完整。
- [ ] 多层同时流动时不遮盖相邻层，不造成高频闪烁或明显 GPU 抖动。

## 4. Provider 映射

### GPT

- [ ] 双窗口 layers=`[周, 5h]`，中心最内层 `5h`。
- [ ] 5h unknown/week known：中心 `5h/—`，外层周独立填充。
- [ ] only-week 为 single 周；only-5h 为 single 5h。

### Grok

- [ ] 双窗口 layers=`[月, 周]`，中心最内层 **周**；不存在 v5 中心月旧逻辑。
- [ ] week unknown/month known：中心 `周/—`；week 不存在才 single 月。
- [ ] stale 可信值逐层保留并有 warning 文案；reauth/error 无可信 quota 时 fallback。

### Kiro

- [ ] 不存在“默认 primary single”特例；1 个安全窗口=single，多个安全可排序窗口=N-ring。
- [ ] center 始终为最内层安全 bucket；percent 来自该 bucket 自身 utilization。
- [ ] remaining 只作安全短值/title，不参与 percent 或排序。
- [ ] 多窗口只依据显式 normalized duration/order 外长内短；未用 reset、remaining、unit、数组顺序或产品常识猜测。
- [ ] 不可安全投影/排序 bucket 留在 detail，并有固定安全说明；不泄露 AWS/raw 字段。

## 5. Standalone Full / Compact

- [ ] aggregate=false 时仍按 GPT → Grok → Kiro 独立挂载。
- [ ] Full/Compact 仍 click 打开/关闭原 provider detail，焦点恢复、操作、host/padding 无回归。
- [ ] 正常 Compact 为 provider label + 一个 N-ring unit，不渲染常态文字 summary chips。
- [ ] loading/login/reauth/unavailable/error 无可信 quota 时显示短 fallback。
- [ ] ring 尺寸、层宽/间距、中心字体和 trigger 高度符合 UI v6。

## 6. Aggregate trigger：hover/focus 生命周期

- [ ] aggregate=true 时 DOM 只有一个 aggregate trigger；无 CSS-hidden standalone。
- [ ] pointerenter trigger 或 keyboard focus 打开；无需 click toggle。点击因 focus 可打开，但第二次 click 不是关闭前提。
- [ ] pointer/focus 位于 trigger 或 panel 任一区域时保持打开。
- [ ] pointer/focus 离开两者后固定 220ms grace delay；跨 trigger→panel 间隙不闪退，重入会取消 timer。
- [ ] `focusout` 检查实际 activeElement；Tab 从 trigger 进入 panel 不关闭。
- [ ] Escape 关闭；panel 内 Escape 回到 trigger时 suppression 阻止 focus 立刻重开。
- [ ] suppression 在 trigger blur 或新明确 pointerenter 后解除；不会永久锁死。
- [ ] 普通 mouseleave/blur 不抢焦点；卸载、配置热切换清 timer/listener。
- [ ] trigger 有 `aria-haspopup/expanded/controls`；panel 非 modal、无 focus trap，Tab 可到每列操作。

## 7. Aggregate provider 分栏

- [ ] 不是 accordion；所有 enabled provider card 同时存在，不要求一次只展开一家。
- [ ] provider 顺序 GPT → Grok → Kiro；每家一个 N-ring unit，环外保留 provider label。
- [ ] Desktop 1/2/3 列合理；640/375/320 响应式为两列/单列或纵向滚动，不隐藏 provider。
- [ ] 面板 fixed/viewport-clamped、内部滚动；无意外页面横向溢出。
- [ ] 每列保留原刷新、Active、Models、quota/cache/race；GPT Reset/scheduler/lock 保留。
- [ ] Models 前关闭 aggregate；无“刷新全部”。
- [ ] 无 overall ring、平均值、总百分比或统一单位。

## 8. 数据流与安全

- [ ] aggregate shell 不 fetch accounts/quota/scheduler，不解释 provider schema或重算 percent。
- [ ] AppShell aggregate/standalone JSX 互斥；Network on/off 请求不翻倍。
- [ ] provider columns 不因 hover/focus 切换 remount 状态；disabled provider 无 request/listener。
- [ ] projection allowlist 仅含 key/label/order/risk/loading/ringUnit/fallback/title。
- [ ] DOM/title/aria/projection 不含 accountId、credential、token、profileArn、clientSecret、raw body/URL/path/error。
- [ ] GPT page fallback、Grok/Kiro generation+accountId guards、Activate race protection 保留。

## 9. 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:provider-usage-aggregate
npm run test:provider-usage-compact
npm run test:kiro-config
npm run test:chatgpt-usage-panel
npm run test:grok-usage-panel
npm run test:grok-quota
npm run test:grok-accounts
npm run test:kiro-quota
npm run test:kiro-accounts
npm run test:kiro-refresh-activate-race
```

- [ ] primitive tests 覆盖 1/2/N、层顺序、innermost invariant、独立 tone、unknown、a11y。
- [ ] CSS/DOM tests 覆盖 layer identity、flow mask hook 和 reduced-motion override。
- [ ] interaction tests 使用 fake timers 覆盖 grace close/re-entry、focusout、Escape suppression、cleanup。
- [ ] GPT/Grok tests 断言具体 center 来源；Grok 明确断言周而非月。
- [ ] Kiro tests 覆盖 1/N ordered、安全部分过滤、unordered 降级、remaining-only。
- [ ] aggregate tests 断言 columns/non-accordion、互斥挂载、无总环、安全投影。
- [ ] 未删除既有断言来规避回归，未直接运行 `next build`。

## 10. UI v6 人工验收矩阵

| 视口 | 模式/输入 | 必查 |
| --- | --- | --- |
| Desktop | Full GPT+Grok | GPT外周内5h/中心5h；Grok外月内周/中心周；层色明显；click detail |
| Desktop | Compact 三家 | 每家一个 1/N-ring unit，无文字 chips，层流光不过载 |
| Desktop | Aggregate 三家 | hover/focus打开；三列同时可见；无accordion/总环 |
| Desktop | GPT 5h unknown | 内层空弧、外层可信、中心5h/— |
| Desktop | Grok week unknown | 内层空弧、外层可信、中心周/— |
| Desktop | inner warning/outer normal 及反向 | layer identity 保留，tone各自叠加 |
| Desktop | Kiro 3 safe windows | 3 concentric rings，中心最内层 |
| Desktop | Kiro unordered bucket | 不猜顺序；安全摘要+detail说明 |
| 640 | Aggregate mixed/loading | 分栏响应式、hover bridge、flow与spinner不混淆 |
| 375 | Aggregate 三家 | 所有provider可到达，panel内部滚动，无静默裁剪 |
| 320 | Aggregate Kiro remaining-only | unknown arc，无假percent；单列操作可达 |
| 任意 | reduced-motion | used arc静止、文字/tone完整 |

## 11. 键盘与指针专项

- [ ] 鼠标慢速/快速跨越 trigger→panel 均不闪退。
- [ ] trigger focus 后不自动把焦点抢进 panel；Tab 可进入第一 provider column。
- [ ] Shift+Tab、panel 内跨列 Tab、Tab 离开整个区域后按策略关闭。
- [ ] Escape 从 trigger 和 panel 内都可关闭且不立即重开。
- [ ] 关闭后新的 pointerenter/focus 可以再次打开。
- [ ] focus-visible 清晰；hover 不是获取内容的唯一途径。

## 12. 回滚

- [ ] `providerPanelsAggregated=false` 恢复 standalone；Compact 值恢复生效。
- [ ] flow overlay 可单独关闭，N-ring 静态信息不受影响。
- [ ] auth accounts、cache、Reset/scheduler、models、session JSONL、ledger 未重写。

## Checker 结论模板

```text
结论：PASS / NEEDS WORK / BLOCKED
自动验证：<commands/results>
1/2/N-ring、innermost center：<evidence>
层identity / tone / flow / reduced-motion：<evidence>
GPT/Grok/Kiro adapter：<evidence>
hover/focus/Escape/grace timer：<evidence>
provider columns与响应式：<evidence>
standalone click / Network / 安全：<evidence>
建议状态：checking → review / changes_requested / blocked
```