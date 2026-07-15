# Implementation Handoff

## GROK-USAGE-04 complete

实现员已完成 **GROK-USAGE-04：完成配置、Grok 回归、文档与用户流验证**。  
全部 4/4 子任务实现侧已完成；需 checker 独立 review（含浏览器人工矩阵）。

### Files changed (this subtask)

- `components/GrokUsagePanel.tsx`
  - 修正用户可见文案：`cache 已过期` → `缓存已过期`；`quota 暂不可用` → `额度暂不可用`
- `scripts/test-grok-usage-panel-config.mjs`（新）
  - 覆盖默认 false、缺失字段 normalize、非 boolean 校验、partial patch 保留 autoFailover、中文 helper 与消费者接线
- `package.json`
  - 新增 `test:grok-usage-panel`
- `docs/modules/frontend.md`
  - 记录 `GrokQuotaView` / `GrokUsagePanel`、AppShell 单一 usage host、Settings 开关、Models 共享 view
- `docs/modules/api.md`
  - 记录 quota 消费方、非 2xx 仍解析安全投影、`refresh=1` 策略；明确无 reset-credit API
- `docs/modules/library.md`
  - `pi-web-config` 增加 `grok.usagePanelEnabled` 默认/兼容/patch 合并说明
- `docs/integrations/README.md`
  - Grok 集成增加顶部用量面板与 Settings 开关；明确无 GPT reset/scheduler

### Prior subtasks already in tree (01–03)

- `lib/pi-web-config.ts` — `usagePanelEnabled` 默认 false + validate/normalize/patch
- `components/SettingsConfig.tsx` — Settings → Grok 开关
- `components/GrokQuotaView.tsx` — 共享 quota 展示
- `components/ModelsConfig.tsx` — 改用共享 view
- `components/GrokUsagePanel.tsx` — 顶部面板生命周期
- `components/AppShell.tsx` + `app/globals.css` — 单一 usage host / 窄屏留白

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | pass（仅既有无关 warnings，0 errors） |
| `node_modules/.bin/tsc --noEmit` | pass |
| `npm run test:grok-quota` | pass 48/48 |
| `npm run test:grok-accounts` | pass 70/70 |
| `npm run test:grok-global-auth` | pass 7/7 |
| `npm run test:grok-usage-panel` | pass 6/6 |
| `next build` | **未运行**（无 `.next` 污染） |

静态/代码审查已覆盖：

- 四种开关组合布局逻辑（AppShell 条件挂载 + 单一 host padding）
- 中文状态文案与 allowlisted 错误（专业术语 Grok/GPT/Settings/Models/Active/quota/cache/OAuth/API 保留）
- 自动重验证不加 `refresh=1`；手动刷新/Activate 后加 `refresh=1`
- 无 reset credit / warmup / scheduler / 全账号 quota 轮询
- cacheWrite、OAuth、failover、session lifecycle 无关边界未改

### Manual browser matrix — not executed in implementer environment

以下需 checker / 主会话实机确认：

1. Settings → Grok 开关保存后顶部立即挂载/卸载
2. GPT/Grok 四组合顺序与右侧抽屉留白
3. 加载中 / 实时 / 缓存新鲜 / 缓存过期 / 无账号 / 重新登录 / 错误 / 正在刷新 / 正在切换
4. “设为 Active”成功与失败（失败不乐观切换）
5. 320 / 375 / 640 / 桌面宽度与 Escape/焦点
6. Models → Grok 共享 `GrokQuotaView` 视觉回归
7. 深色/浅色与 `prefers-reduced-motion`

### Remaining for main session

1. 派发 **checker** 对照 HTML 原型做独立 review（含浏览器矩阵）。
2. 不需要再 claim 实现子任务；计划 4/4 实现侧完成。
3. 合并/提交由主会话决定（实现员未 commit/push）。

### Risks / notes for checker

- 移动端 84px 右侧留白只挂在单一 `.app-top-usage-panel` host；勿拆成多个 host。
- 自动轮询必须继续省略 `refresh=1`，否则会绕开 60s 服务端 fresh cache。
- 展开面板宽度由 `GrokUsagePanel` 内部 `min(392px, calc(100vw - 16px))` 约束。
- 文档明确 Grok **没有** GPT reset/scheduler/warmup 能力。

### Decisions needed

None for 04. 可进入 checker review / 用户验收。
