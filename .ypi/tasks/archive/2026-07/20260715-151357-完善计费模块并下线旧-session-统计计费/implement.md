# Implement

## 实现前门禁

1. 主会话派发 `ui-designer` 并取得 task-local HTML 原型。
2. 用户确认保留现网“使用量 / 费用”指标切换，同时包含账本内真实趋势 chart、折线/柱状形态切换与 Usage 入口/header 语义 icon，并批准修订后的原型。
3. 用户确认 legacy `/api/usage` 与 `statsSource` 退役策略。
4. 主会话将下面机器计划保存到 task `implementationPlan` 后，才可进入 `awaiting_approval`；批准前不得实现。

## 优先阅读

1. `AGENTS.md`
2. `docs/architecture/overview.md` 的 Usage accounting / cache-write / exact+M
3. `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/modules/api.md`
4. `components/UsageProviderModelTable.tsx`, `components/UsageStatsModal.tsx`, `components/SelectDropdown.tsx`
5. `app/api/usage/calls/route.ts`, `app/api/usage/route.ts`
6. `lib/llm-usage-query.ts`, `lib/llm-usage-store.ts`, `lib/usage-stats.ts`, `lib/token-format.ts`
7. `lib/pi-web-config.ts`, `lib/llm-usage-recorder.ts`, `components/SettingsConfig.tsx`
8. `scripts/test-llm-usage-store.mjs`, `scripts/test-usage-stats-rollup.mjs`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 内容 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| DATE-01 | backend | 1 | — | 修复本地日期/UTC 分区边界、event-level 过滤、local byDay/range/cache，并新增 focused query test | 是，与 LEGACY-01 文件基本分离 |
| LEGACY-01 | retirement | 1 | — | 下线全局 Session 统计 UI/API/聚合/config gate，保留 session rollup 和 includeArchived | 是，与 DATE-01 并行时协调日期 helper |
| UI-01 | frontend | 2 | DATE-01, LEGACY-01 | 按批准原型实现单一账本、全部默认、共享 dropdown、exact+M、双切换图表、降噪、折线 Usage icon | 否 |
| DOC-01 | docs | 3 | DATE-01, LEGACY-01, UI-01 | 更新架构/API/frontend/library/AGENTS 导航与退役说明 | 否 |
| CHECK-01 | checks | 4 | DATE-01, LEGACY-01, UI-01, DOC-01 | 自动验证、静态搜索、浏览器/API 手工回归 | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "DATE-01",
      "title": "修复调用账本日期范围与时区分组",
      "phase": "backend",
      "order": 1,
      "dependsOn": [],
      "files": [
        "app/api/usage/calls/route.ts",
        "lib/llm-usage-query.ts",
        "lib/llm-usage-store.ts",
        "lib/local-date-range.ts",
        "lib/llm-usage-types.ts",
        "scripts/test-llm-usage-query.mjs",
        "package.json"
      ],
      "instructions": "抽离纯本地日期 helper；让 UTC partition 仅作为候选扫描，聚合前按 occurredAt 完整 instant 精确过滤；按同一本地日期口径生成 byDay 和 response range/timezone；cache key 使用完整边界和全部筛选条件。新增不依赖用户真实账本的临时 fixture 测试，至少覆盖 UTC+8 跨分区、边界包含/排除、非法范围和 cache 隔离。不要引入 Session inventory 依赖。",
      "acceptance": [
        "选择单一本地日不会混入相邻本地日事件",
        "from/to 边界包含且边界外 1ms 排除",
        "byDay 与 range/timezone 使用相同口径",
        "查询仍只扫描相交 UTC 分区且 366 日上限不变",
        "focused query tests 全部通过"
      ],
      "validation": [
        "npm run test:llm-usage-query",
        "npm run test:llm-usage-store",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "server-local 与 browser-local timezone 不同",
        "cache key 日期格式碰撞",
        "测试污染用户 usage-events 目录"
      ],
      "parallelizable": true,
      "localReview": "核对 partition scan 与 event filter 是两层边界；测试必须使用隔离 agent dir/fixture，不读取或写入用户账本。"
    },
    {
      "id": "LEGACY-01",
      "title": "下线全局 Session 统计并保留顶栏 rollup",
      "phase": "retirement",
      "order": 1,
      "dependsOn": [],
      "files": [
        "components/UsageStatsModal.tsx",
        "components/AppShell.tsx",
        "app/api/usage/route.ts",
        "lib/usage-stats.ts",
        "lib/pi-web-config.ts",
        "lib/llm-usage-recorder.ts",
        "components/SettingsConfig.tsx",
        "hooks/useAgentSession.ts",
        "scripts/test-usage-stats-rollup.mjs"
      ],
      "instructions": "删除 Session 统计 tab/legacy global UI 和 getUsageStats 全局聚合，只保留 getUsageStatsForSessionRollup 及其 wire types/helpers。/api/usage 缺少 sessionId 时按批准策略明确失败且不得扫描。退役 statsSource 的视图/recorder gate，旧字段兼容读取但不再生效，ledger recorder 始终开启；includeArchived 保留给 rollup 并重写 Settings 文案。不要修改 SessionStatsChips 的已确认 parent/standalone/studio_child 口径。",
      "acceptance": [
        "仓库内没有活跃 Session 统计 tab 或 global getUsageStats 调用",
        "/api/usage 无 sessionId 不扫描 sessions",
        "/api/usage?sessionId 返回契约不变",
        "旧 statsSource=legacy 不再关闭账本采集",
        "usage-rollup focused tests 保持通过"
      ],
      "validation": [
        "npm run test:usage-rollup",
        "rg -n 'Session 统计|resolveDefaultUsageView|getUsageStats\\(' components app lib hooks",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "删除 shared helper 误伤顶栏 rollup",
        "旧外部调用方依赖无 sessionId API",
        "配置保存误删无关 usage 字段"
      ],
      "parallelizable": true,
      "localReview": "逐一核对 hooks/useAgentSession、ChatWindow、SessionStatsChips 的类型和请求；配置 merge 只能处理已退休 statsSource，保留 pricing policy/explicitFreeModels。"
    },
    {
      "id": "UI-01",
      "title": "按批准原型收敛调用账本 UI",
      "phase": "frontend",
      "order": 2,
      "dependsOn": [
        "DATE-01",
        "LEGACY-01"
      ],
      "files": [
        "components/UsageProviderModelTable.tsx",
        "components/SelectDropdown.tsx",
        "components/AppShell.tsx",
        "lib/token-format.ts",
        "app/globals.css"
      ],
      "instructions": "严格按已批准 HTML 原型实现：workspaceFilter 初始/reset 为 all；source/status 使用共享 SelectDropdown（必要时新增向后兼容 toolbar size）；所有 token 使用共享 exact/M/compact helpers；基于现有 byDay 数据默认展示“使用量”SVG 折线趋势图，并支持“折线趋势 / 柱状占比”形态切换与“使用量 / 费用”指标切换；两种形态随指标重绘，tooltip/focus 与当前指标一致（使用量 exact+M，费用 `$x.xx`，可附带另一指标）；移除 coverage/known-gap/corrupt/legacy footer；sidebar 与 modal header 使用同一折线统计语义 icon。紧凑位置必须有 exact tooltip，移动端不得因双值溢出。", 
      "acceptance": [
        "首次与重置均选中全部且请求无 cwd",
        "组件内没有原生 select",
        "token exact 为主、M 为次且无本地重复 formatter",
        "页面无 coverage/legacy 噪音",
        "默认折线+使用量；可切费用、可切柱状；点位/柱段 tooltip 与当前指标一致（使用量 exact+M、费用金额，可附带另一指标）",
        "图标、桌面和窄屏与批准原型一致",
        "共享 dropdown 既有调用方视觉和键盘行为不回归"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证 980px 与 390px、dropdown 键盘、日期/范围切换、drawer/tooltip"
      ],
      "risks": [
        "exact+M 使表格过密",
        "dropdown portal 与 modal 层级冲突",
        "共享 size 改动影响 Settings/Chat"
      ],
      "parallelizable": false,
      "localReview": "对照 HTML 逐态检查；禁止凭实现员偏好新增图表类型或保留未批准噪音。"
    },
    {
      "id": "DOC-01",
      "title": "更新 Usage 账本与 Session rollup 文档",
      "phase": "documentation",
      "order": 3,
      "dependsOn": [
        "DATE-01",
        "LEGACY-01",
        "UI-01"
      ],
      "files": [
        "AGENTS.md",
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": "把全局 Usage 记录为 ledger-only，写清日期的 local-boundary/UTC-partition/event-filter 语义；把 /api/usage 记录为 session rollup only；删除可切换 legacy、statsSource recorder gate、coverage banner 的旧说明；保留历史数据不可变、coverage wire diagnostics、SessionStatsChips 和 includeArchived rollup 边界。仅在顶层导航发生实质变化时更新 AGENTS 对应条目。",
      "acceptance": [
        "文档不再指导用户切回 Session 统计",
        "API/UI/library 三份模块地图与代码一致",
        "架构明确 ledger 与 session rollup 是不同保留边界",
        "日期、token 和配置兼容策略可供后续排障"
      ],
      "validation": [
        "rg -n 'Session 统计|statsSource|coverage banner|Legacy Usage' docs AGENTS.md",
        "人工检查所有 Markdown 相对链接"
      ],
      "risks": [
        "把保留的 session rollup 误写为完全删除",
        "保留过期 rollback 指引"
      ],
      "parallelizable": false,
      "localReview": "文档逐项对应最终 diff，不提前记录未落地行为。"
    },
    {
      "id": "CHECK-01",
      "title": "执行计费模块独立检查与用户流验收",
      "phase": "checks",
      "order": 4,
      "dependsOn": [
        "DATE-01",
        "LEGACY-01",
        "UI-01",
        "DOC-01"
      ],
      "files": [
        "checks.md",
        "review.md"
      ],
      "instructions": "检查员独立审查实际 diff，并运行 lint、tsc、llm usage store/query、usage rollup tests。使用真实浏览器验证全部/当前、日期变化、统一 dropdown、exact+M、降噪、图标、窄屏和三类 Session 顶栏口径；用 API 请求确认旧无-session route 不扫描、sessionId route 保留。把阻塞 finding 退回实现，不得只凭子任务成功状态通过。",
      "acceptance": [
        "所有自动验证无 error",
        "日期跨 UTC 边界测试有可复查证据",
        "浏览器用户流与批准 HTML 一致",
        "无 legacy 活跃入口且 session rollup 无回归",
        "review.md 记录 findings、修复和最终 verdict"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:llm-usage-store",
        "npm run test:llm-usage-query",
        "npm run test:usage-rollup"
      ],
      "risks": [
        "只静态审查而未验证时区用户流",
        "当前机器无跨日 fixture",
        "HTML 原型与最终 UI 漂移"
      ],
      "parallelizable": false,
      "localReview": "检查员必须独立读取源文件和运行命令；UI 原型/审批缺失视为 blocker。"
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:llm-usage-store
npm run test:llm-usage-query
npm run test:usage-rollup
```

不要直接运行 `next build`；本任务无需 release build。

## 回滚

- 代码回滚即可恢复 legacy 页面/API/config gate；不需要数据回滚。
- 不删除 `usage-events/v1` 或 Session JSONL，因此账本与 rollup 数据始终可读。
- 日期修复与 legacy 下线应保持独立提交粒度（但本任务成员不得 commit），便于定位回滚，不代表允许部分产品状态长期存在。
