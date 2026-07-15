# Implementation Handoff

## GPT-USAGE-03 complete

实现员已完成 **GPT-USAGE-03：补齐 GPT 面板回归契约、文档和整体验证**。  
全部 3/3 子任务实现侧已完成；需 checker 独立 review（含浏览器人工矩阵）。

### Files changed (this subtask)

- `scripts/test-chatgpt-usage-panel.mjs`（新）
  - 可导入 helper：`chatgpt.usagePanelEnabled` 默认 false、`QUOTA_TIER_LABELS` 英文兼容、`GPT_QUOTA_TIER_*` 中文 5 小时/周/7 天额度、中文相对时间与倒计时、`knownQuotaTiers` 过滤未知/伪月度
  - 源码契约：`onOpenModels`、AppShell 单一 host、`live|cached|page_fallback|none`、30s 仅 accounts、AbortController/generation、fixed clamp、dialog/aria、SAFE_MESSAGES 安全边界、Reset/scheduler/repair 次级区、不引入 Grok schema/fresh/stale
  - Grok 回归断言：Grok 仍拥有 fresh/stale；无 Reset/scheduler
- `package.json`
  - 新增 `test:chatgpt-usage-panel`
- `docs/modules/frontend.md`
  - 更新 `ChatGptUsagePanel`：Grok 风格交互壳、真实 5h/7d、cache 四态、30s metadata、Models 恢复、GPT 专属次级区
- `docs/modules/library.md`
  - 更新 `lib/quota-display.ts`：Models 英文 helper 不变；GPT 中文 helper 边界

### Prior subtasks already in tree (01–02)

- `components/ChatGptUsagePanel.tsx` — 状态编排 + Grok 风格 pill/fixed panel/中文安全文案/page_fallback/Reset+scheduler
- `lib/quota-display.ts` — GPT 中文 tier/age/countdown helpers
- `components/AppShell.tsx` — `onOpenModels={() => setModelsConfigOpen(true)}`；单一 `.app-top-usage-panel`、GPT→Grok、一次右侧留白
- `app/globals.css` — `.chatgpt-usage-panel` spinner/focus-visible/reduced-motion 最小样式

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | pass（0 errors；6 既有无关 warnings：`.ypi/tasks/archive/.../pre01-verification.mjs`、`scripts/test-model-prices.mjs`） |
| `node_modules/.bin/tsc --noEmit` | pass |
| `npm run test:chatgpt-usage-panel` | pass（9 checks） |
| `npm run test:grok-usage-panel` | pass |
| `npm run test:grok-quota` | pass 48/48 |
| `npm run test:grok-accounts` | pass 70/70 |
| `npm run test:grok-global-auth` | pass 7/7 |
| `next build` / `npm run build` | **未运行**（按 implement 约定避免污染 `.next`） |

静态审查已覆盖：

- `rg`：`ChatGptUsagePanel` 无 GPT「月度」用户文案
- 失败刷新同账号 `page_fallback`；切号不跨账号
- Activate 成功 + quota 失败 →「账号已切换，额度刷新失败」
- scheduler `lastError`/`lastAccountError`/`lock.path` 不直接插值到 DOM
- 无 API/schema/config 新增；`chatgpt.usagePanelEnabled` 默认 false

### Manual browser matrix — not executed in implementer environment

以下需 checker / 主会话实机确认（对照 `checks.md` + HTML 原型）：

1. GPT/Grok 四种开关组合顺序与一次右侧留白
2. 加载中 / 实时 / 已缓存 / 无缓存 / 本页回退 / 无账号 / 重新登录 / 错误 / 刷新·切换·重置中
3. 手动刷新失败保留同账号 rings/cards；切号隔离
4. Activate 失败保留旧 Active；Activate 成功后 quota 失败保留新 Active
5. Reset credits 确认/数量/过期；scheduler 重载与 lock repair 风险确认
6. 320 / 375 / 640 / 桌面 fixed clamp 与内部滚动
7. Escape/关闭还焦、外部点击、Tab/Enter/Space、progressbar/aria、reduced-motion
8. Models 中 GPT 英文 tier/`formatQuotaQueriedAt` 无回归；Grok 月/周/fresh/stale 无回归

### Remaining for main session

1. 将 **GPT-USAGE-03** 标为 done；实现计划 3/3 完成。
2. 若 Studio 允许，transition 任务到 **checking** 并派发 **checker** 对照 `checks.md` + 原型做独立验收（含浏览器矩阵）。
3. 实现员**未** commit / push / merge。
4. 无法在本子会话直接改 `.ypi/tasks/**/task.json`；请主会话更新进度与状态。

### Risks / notes for checker

- 自动测试以 helper 执行 + 源码契约为主，**不能替代** race/焦点/窄屏浏览器验收。
- GPT cache 只能写「实时 / 已缓存 / 无缓存 / 本页上次成功数据」，勿误判为 Grok fresh/stale。
- 30s 轮询只能打 accounts metadata，不能批量/自动 quota GET。
- 单一 `.app-top-usage-panel` host；勿重复右侧 padding 或改 GPT→Grok 顺序。
- 止血回滚：关闭 `chatgpt.usagePanelEnabled`，再回滚 GPT component/AppShell callback/CSS；不回滚账号/quota/Reset/scheduler 数据。

### Decisions needed

- None for product scope（计划三项决策已在审批中确认）。
- 主会话只需：标记子任务 done → checking → 派发 checker。
