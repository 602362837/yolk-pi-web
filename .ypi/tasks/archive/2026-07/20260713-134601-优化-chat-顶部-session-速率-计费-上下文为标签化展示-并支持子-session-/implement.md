# Implement：Session 指标 Chips 与上下文浮窗

## 需先阅读

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/architecture/overview.md` 的 Usage accounting / Studio child boundaries
- `docs/standards/code-style.md`
- `components/AppShell.tsx` 顶栏 stats 与 `BillingPopover`
- `components/ChatWindow.tsx` 的 stats/context 上抛
- `components/ChatGptUsagePanel.tsx`
- `hooks/useAgentSession.ts` 的 `SessionUsageTopbarStats` 与 rollup fetch
- `lib/usage-stats.ts` 的 `UsageSessionRollupResult`
- 本任务获批的 `prd.md`、`ui.md`、HTML 原型、`design.md`、`checks.md`

## 人类可读子任务表

| ID | Phase | Order | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| UI-01 | UI | 1 | UI 设计员生成 HTML 原型并取得用户审批 | 无 | task `ui.md`, `session-stats-chips-prototype.html` | 否 |
| SPIKE-01 | Design | 2 | 验证 child `getContextUsage()` 的准确投影与依赖方向 | UI-01 | Studio child runtime、`rpc-manager`、`usage-stats` | 否 |
| DATA-01 | Implement | 3 | 实现最小 additive child context 数据契约与降级 | SPIKE-01 | hook、usage/API，必要时 runtime | 否 |
| UI-02 | Implement | 4 | 按原型实现 chips、独立浮窗、阈值与响应式 | DATA-01 | `AppShell`, 新组件, globals CSS | 否 |
| DOC-01 | Docs | 5 | 更新 frontend/API/architecture 文档 | DATA-01, UI-02 | `docs/modules/*`, architecture | 可与聚焦测试准备并行 |
| CHK-01 | Checks | 6 | 静态、交互、响应式、隐私与口径检查 | UI-02, DOC-01 | checks + diff | 否 |
| REV-01 | Review | 7 | 独立检查员对照原型与契约评审 | CHK-01 | 全部改动 | 否 |

## 实现步骤

1. **先满足 UI 门禁。** `ui-designer` 交付自包含 HTML，用户确认 chip 密度、浮窗层级、移动策略和动画；未批准不得写生产代码。
2. **做数据 spike。** 在不改产品语义的前提下确认 Studio SDK child 是否可从 AgentSession 获取权威 `getContextUsage()`，以及活跃/终止 child 的 snapshot 是否已有安全承载位置。结论必须记录：来源、刷新频率、终止后行为、隐私字段、不可用降级。
3. **只选一条最小数据路径。** 优先 additive 扩展 session rollup；若 usage→Studio runtime 依赖不合理，再使用单独只读 context endpoint。禁止双实现，也禁止累计 usage 推算。
4. **透传数据。** 扩展 `SessionUsageTopbarStats` 的 child summaries，保持 AbortController、effective session id race guard、local fallback 和现有费用字段语义。
5. **组件化展示。** 将顶栏内联块提取为 `SessionStatsChips`（或同等小组件）；把费用和上下文 popover 分离。复用格式化与口径计算，避免 UI 内再造 totals。
6. **交互与样式。** 使用 button trigger、互斥浮窗、viewport clamp、focus/click/hover/Escape/outside close；按原型做 scoped CSS、断点和 reduced-motion。
7. **文档与检查。** 更新模块文档，执行静态检查和 `checks.md` 人工验收，再由 checker 独立评审。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

若新增数据纯函数/投影测试，运行对应聚焦 test script。启动 `npm run dev` 后按 `checks.md` 使用真实浏览器验收；常规开发不要直接运行 `next build`。

## 评审门禁

- HTML 原型和当前计划 revision 已获用户批准。
- SPIKE-01 证明 child context 是权威 snapshot，或产品明确批准 unavailable 降级。
- checker 确认计费三口径、隐私边界、键盘/触屏、响应式和 reduced-motion。
- blocker 未清零不得进入用户验收。

## 回滚

- 还原 Session stats 组件/CSS 到现有 spans + billing popover。
- 停止产生 additive child context 字段；旧客户端继续忽略。
- 不迁移或重写 JSONL；如有 bounded sidecar，按 Design 的兼容/清理说明处理。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "UI-01",
      "title": "生成并审批 Session stats HTML 原型",
      "phase": "ui",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260713-134601-优化-chat-顶部-session-速率-计费-上下文为标签化展示-并支持子-session-/ui.md",
        ".ypi/tasks/20260713-134601-优化-chat-顶部-session-速率-计费-上下文为标签化展示-并支持子-session-/session-stats-chips-prototype.html"
      ],
      "instructions": "由 ui-designer 基于现有顶栏与 ChatGPT usage 视觉生成自包含 HTML，覆盖 parent/standalone/studio_child、child 多状态、费用/上下文独立浮窗、响应式、键盘、触屏和 reduced-motion；提交用户审批。",
      "acceptance": ["交付真实 HTML 文件", "用户明确批准视觉、移动策略和交互", "ui.md 记录原型链接与决策"],
      "validation": ["浏览器检查 1440/900/640/375px", "检查浅色/深色/reduced-motion"],
      "risks": ["当前 architect child 环境无法派发 ui-designer", "移动端关键指标优先级未确认"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "SPIKE-01",
      "title": "验证 Studio child 上下文 snapshot 来源",
      "phase": "design",
      "order": 2,
      "dependsOn": ["UI-01"],
      "files": ["lib/ypi-studio-subagent-runtime.ts", "lib/ypi-studio-subagent-sdk-runner.ts", "lib/rpc-manager.ts", "lib/usage-stats.ts"],
      "instructions": "确认活跃 child 能否读取权威 getContextUsage，终止后是否可保留 bounded 数值 snapshot，并选择 rollup additive 或独立只读 endpoint 之一。禁止用 lifetime usage 估算 context。记录结论后再实现。",
      "acceptance": ["明确 source/availability/capturedAt 语义", "明确不可用降级", "不返回内容或本机路径"],
      "validation": ["用一个活跃与一个完成 child 验证来源", "审查依赖方向和刷新频率"],
      "risks": ["SDK child 终止后没有权威 snapshot", "usage 模块与 Studio runtime 耦合"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DATA-01",
      "title": "实现 additive child context 数据投影",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["SPIKE-01"],
      "files": ["lib/usage-stats.ts", "hooks/useAgentSession.ts", "app/api/usage/route.ts"],
      "instructions": "按 spike 选择的单一路径增加可选 child summaries/context snapshot，保持旧 rollup 字段和费用口径；沿用 session keyed abort/race guard；无法获取时返回 unavailable。若选择独立 endpoint，相应调整文件和文档但不保留双路径。",
      "acceptance": ["旧响应兼容", "unknown 不等于 0%", "无 child 内容泄漏", "Session 切换无 stale 覆盖"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "聚焦验证 parent/standalone/studio_child 与 unavailable"],
      "risks": ["高频扫描或 task 文件写入", "历史 child 无 snapshot"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "UI-02",
      "title": "实现顶栏 chips 与两个独立浮窗",
      "phase": "implement",
      "order": 4,
      "dependsOn": ["DATA-01"],
      "files": ["components/AppShell.tsx", "components/SessionStatsChips.tsx", "app/globals.css"],
      "instructions": "按获批原型提取展示组件，保留 compact 费用口径，分别实现 billing/context trigger 与互斥浮窗；加入阈值、状态文案、viewport clamp、键盘/触屏和 reduced-motion；保持顶栏高度。",
      "acceptance": ["费用三口径零变化", "上下文浮窗本体优先并列 children", "多 child 可滚动", "窄屏无页面溢出", "颜色不是唯一信号"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "按 checks.md 浏览器验收"],
      "risks": ["顶栏 overflow 裁剪", "hover/focus 状态竞争", "动画影响布局"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-01",
      "title": "更新 Session stats 数据与 UI 文档",
      "phase": "docs",
      "order": 5,
      "dependsOn": ["DATA-01", "UI-02"],
      "files": ["docs/modules/frontend.md", "docs/modules/api.md", "docs/architecture/overview.md"],
      "instructions": "记录新组件、响应式/动效规则、child context availability 与 API additive 字段；仅在契约确实变化时更新 API/architecture。",
      "acceptance": ["文档与最终路径一致", "明确 unavailable 与隐私边界", "保留费用口径说明"],
      "validation": ["审阅所有类型/API 消费者", "检查文档相对引用"],
      "risks": ["实现路径变化后文档滞后"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "CHK-01",
      "title": "执行静态与用户流验收",
      "phase": "checks",
      "order": 6,
      "dependsOn": ["UI-02", "DOC-01"],
      "files": ["checks.md", "components/SessionStatsChips.tsx", "hooks/useAgentSession.ts", "lib/usage-stats.ts"],
      "instructions": "执行 lint/typecheck 与 checks.md 全矩阵，记录真实浏览器截图和键盘/reduced-motion/隐私证据。",
      "acceptance": ["自动检查通过", "人工矩阵有结果", "无 blocker/high finding"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "真实浏览器验收"],
      "risks": ["缺少现成前端自动交互测试"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "REV-01",
      "title": "独立评审原型一致性与数据真实性",
      "phase": "review",
      "order": 7,
      "dependsOn": ["CHK-01"],
      "files": ["prd.md", "ui.md", "design.md", "checks.md", "components/SessionStatsChips.tsx", "hooks/useAgentSession.ts", "lib/usage-stats.ts"],
      "instructions": "checker 对照获批原型与计划审查费用口径、context 来源、交互可访问性、响应式、隐私和文档；阻塞项退回实现。",
      "acceptance": ["原型与实现一致", "无 lifetime usage 冒充 context", "无未处理 blocker/high finding"],
      "validation": ["审阅 git diff", "复核 checks 证据", "抽查 API response"],
      "risks": ["仅做视觉检查而遗漏数据语义"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 1,
    "groups": [["UI-01"], ["SPIKE-01"], ["DATA-01"], ["UI-02"], ["DOC-01"], ["CHK-01"], ["REV-01"]]
  }
}
```

> 当前仅在 artifact 中定义机器可读计划；由于本 delegated architect 环境没有 Studio task mutation/dispatch 工具，尚未将 implementationPlan 安全写入 `task.json`。主 Session 应在 UI 原型补齐、计划确认无误后通过 Studio task 工具保存，勿直接手改任务状态。
