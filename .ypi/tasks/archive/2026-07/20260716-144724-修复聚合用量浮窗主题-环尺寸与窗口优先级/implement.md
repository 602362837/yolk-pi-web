# Implement：聚合用量浮窗动态窗口修复

## 前提与优先阅读

仅在用户审批 [`plan-review.md`](./plan-review.md) 与 [`usage-aggregate-theme-priority-prototype.html`](./usage-aggregate-theme-priority-prototype.html) 后实现。先读 `AGENTS.md`、`docs/modules/frontend.md`、`docs/integrations/README.md`、`docs/standards/code-style.md`，再读本任务 PRD/Design/UI/Checks，以及 `ProviderUsagePanelContract`、三家 provider adapters、aggregate shell 和 focused tests。不得覆盖工作树中任务 `20260716-103603` 的既有未提交实现。

## 人类可读子任务表

| ID | Phase | 顺序 | 依赖 | 内容 | 并行 |
| --- | --- | ---: | --- | --- | --- |
| USAGE-FIX-01 | shared-window-contract | 1 | — | 通用候选、duration resolver、排序/降级与 center 契约 | 否 |
| USAGE-FIX-02 | provider-adapters | 2 | 01 | GPT/Grok/Kiro 改为实际无序候选，删除固定映射与猜测 | 否 |
| USAGE-FIX-03 | aggregate-visual | 3 | 02 | light/dark、中心对比度、detail-only、大环与响应式 | 否 |
| USAGE-FIX-04 | tests | 4 | 03 | 动态/单窗/mixed/unknown/tie/主题/尺寸/安全测试 | 否 |
| USAGE-FIX-05 | docs-validation | 5 | 04 | 文档与 lint/tsc/focused/browser 验收 | 否 |

共享 contract、provider panels 与 `globals.css` 存在重叠写入，采用单写线程 `maxConcurrency=1`。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "让 GPT/Grok/Kiro 从当前账号实际 quota 数据生成无序安全窗口候选，由共享 projector 按可信 duration 短到长形成单圈或多圈并锁定外圈中心；unknown/tie 安全降级，同时完成聚合浮窗 light/dark、中心对比度、列头大环与响应式修复。",
  "strategy": "serial shared-contract-first implementation, then provider candidate adapters, aggregate visual theming, behavior-focused tests, and browser/docs validation",
  "maxConcurrency": 1,
  "scheduler": {
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "USAGE-FIX-01",
      "title": "建立通用动态窗口 projector 与中心契约",
      "phase": "shared-window-contract",
      "order": 1,
      "dependsOn": [],
      "files": [
        "components/ProviderUsagePanelContract.ts",
        "components/ProviderUsageTrigger.tsx"
      ],
      "instructions": [
        "定义安全 window candidate 与 projection result；候选承载 present/trusted、显示字段、percent、durationMs/evidence、同 bucket fallback，不承载预排序 layer index。",
        "实现共享 duration resolver，仅接受显式正 duration 或严格规范 token/label（含数值+minute/hour/day/week/month/year）；拒绝 provider 名、数组/字段/id 顺序、percent、remaining、resetAt、resourceType、Limits/quota。",
        "实现纯 projector：过滤 invalid；单候选无论 duration 是否已知都单圈；多候选只投影 duration 可信且 rank 唯一者，unknown/tie 详情化；剩1层降级单圈，剩0层 ring null；最终按 duration 升序。",
        "由 projector 创建 layers 和 centerLayerId=layers[0].id；renderer 按 center id 查找并对非法 center fail loud，不 silent fallback。",
        "固定 detail-only 安全文案与 mode，不渲染 raw duration evidence。"
      ],
      "acceptance": [
        "候选集合的输出与 provider key、输入 permutation 无关。",
        "only-one known/unknown、ordered-multi、degraded-single、detail-only 五类结果可区分。",
        "外圈 percent unknown 不跨层借值。"
      ],
      "validation": [
        "npm run test:provider-usage-aggregate",
        "npm run test:provider-usage-compact",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "duration parser 误命中泛化文案",
        "tie 通过 id 偷排",
        "renderer 对 ring null 或非法 center 静默回退"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "USAGE-FIX-02",
      "title": "三家 provider 改为实际窗口候选",
      "phase": "provider-adapters",
      "order": 2,
      "dependsOn": [
        "USAGE-FIX-01"
      ],
      "files": [
        "components/ChatGptUsagePanel.tsx",
        "components/GrokUsageProjection.ts",
        "components/GrokUsagePanel.tsx",
        "components/KiroUsagePanel.tsx",
        "lib/kiro-usage-ring.ts",
        "lib/quota-display.ts"
      ],
      "instructions": [
        "GPT 从当前 display/source tiers 数组逐项产生候选；不存在的 tier 不补位；移除 hasFiveHour/hasSevenDay 固定 builder 和 [5h,7d] push 顺序。规范 tier token 仅作为共享 resolver 的 duration evidence。",
        "Grok 仅把实际存在的 optional quota windows 归一成无序候选；不在 adapter 中写 week→month layers、center 或 index。",
        "Kiro 将所有 safe buckets 转成候选并调用共享 projector；删除 Limits/quota-envelope=90d 规则，remaining/reset/resourceType 不参与 duration。",
        "同 bucket remaining 仅可作为该候选 percent unknown 时的 safe fallback；不得借其他候选。",
        "保留 provider owner、cache/reauth/race、Refresh/Activate/Models 与 GPT Reset/scheduler/lock 行为。"
      ],
      "acceptance": [
        "GPT only-7d 与 Grok only-week 各为单圈，缺失窗口无空轨道。",
        "mixed/future recognized periods 由公共 projector 排序，不需要 provider 新增布局分支。",
        "unknown/tie bucket 按公共降级策略进入详情且安全提示可用。",
        "安全 projection 不新增 secret/raw 字段。"
      ],
      "validation": [
        "npm run test:chatgpt-usage-panel",
        "npm run test:grok-usage-panel",
        "npm run test:kiro-config",
        "npm run test:provider-usage-compact"
      ],
      "risks": [
        "GPT detail 已知 tier 过滤与 ring 候选来源不一致",
        "Grok typed fields 被重新当成固定布局",
        "Kiro unknown bucket 为追求多环被猜排序"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "USAGE-FIX-03",
      "title": "聚合浮窗主题化、中心增强与列头大环",
      "phase": "aggregate-visual",
      "order": 3,
      "dependsOn": [
        "USAGE-FIX-02"
      ],
      "files": [
        "components/ProviderUsageAggregatePanel.tsx",
        "components/ProviderUsageTrigger.tsx",
        "components/ChatGptUsagePanel.tsx",
        "components/GrokUsagePanel.tsx",
        "components/KiroUsagePanel.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "在 :root/html.dark 定义 usage surface/border/shadow/center/status tokens，移除 panel 与 close 固定夜间色。",
        "加深 center label/value；ring null 与 detail-only 使用固定安全文本且不破坏列头对齐。",
        "trigger 保持30px；column header 使用40px target 或至少 existing large 38px，ring flex-shrink:0。",
        "保持 Desktop 1–3列、640两列、375/320单列、viewport clamp/internal scroll。",
        "三家 detail 的 warning/danger/success/banner/Active/action 状态使用昼夜语义 token。",
        "保留 SVG mask 流光、reduced-motion、focus-visible、hover/focus open reason、220ms grace 与 Escape 防重开。"
      ],
      "acceptance": [
        "light/dark 下 panel、详情、fallback、文字、按钮、中心均可读。",
        "panel ring >= trigger；320px 无页面级横向溢出。",
        "主题切换不增加 fetch 或 owner 重挂载。"
      ],
      "validation": [
        "npm run test:provider-usage-aggregate",
        "npm run test:provider-usage-compact",
        "manual light/dark at desktop/640/375/320"
      ],
      "risks": [
        "inline fixed color 覆盖 tokens",
        "detail-only/fallback 挤压列头",
        "流光 mask 或 220ms 状态机回归"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "USAGE-FIX-04",
      "title": "补齐动态窗口、主题与安全契约测试",
      "phase": "tests",
      "order": 4,
      "dependsOn": [
        "USAGE-FIX-03"
      ],
      "files": [
        "scripts/test-provider-usage-aggregate.mjs",
        "scripts/test-provider-usage-compact.mjs",
        "scripts/test-chatgpt-usage-panel.mjs",
        "scripts/test-grok-usage-panel-config.mjs",
        "scripts/test-kiro-config.mjs"
      ],
      "instructions": [
        "直接执行共享 projector，覆盖 [7d,2h,1d] permutation、跨 provider independence、only-one known/unknown、outer percent unknown。",
        "覆盖 known+unknown、one-known+unknown、all-unknown multi、duplicate-duration tie；验证 unknown/tie 不按数组/id 排序。",
        "增加 duration resolver 正例 90m/2h/7d/weekly/monthly 与负例 Limits/quota/remaining/reset/resourceType。",
        "覆盖 GPT only-7d/only-5h/future period、Grok only-week/only-month、Kiro explicit/mixed/unordered；删除 provider 固定 layer mapping 断言。",
        "增加 panel ring>=trigger、light/dark tokens、无 fixed-night shell 色、detail-only safe copy、响应式断言。",
        "保留无总环、无 accordion、shell 无 fetch、projection secret allowlist、mask/reduced-motion、owner 单实例断言。"
      ],
      "acceptance": [
        "测试失败可定位 resolver/projector/adapter/center/theme/size。",
        "行为测试不以仅正则替代 projector 结果断言。",
        "既有安全和交互断言未被弱化。"
      ],
      "validation": [
        "npm run test:provider-usage-aggregate",
        "npm run test:provider-usage-compact",
        "npm run test:chatgpt-usage-panel",
        "npm run test:grok-usage-panel",
        "npm run test:kiro-config"
      ],
      "risks": [
        "测试复制实现而非验证公共函数",
        "只覆盖三家历史窗口未覆盖 future/mixed",
        "删除旧断言时误删安全门禁"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "USAGE-FIX-05",
      "title": "同步文档并完成自动与浏览器验收",
      "phase": "docs-validation",
      "order": 5,
      "dependsOn": [
        "USAGE-FIX-04"
      ],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "同步 actual candidates→shared projector、outer shortest/center、unknown/tie 降级、theme tokens、panel size 与 rollback 文档；删除固定 GPT/Grok/Kiro layout 口径。",
        "运行 lint、tsc、focused tests、git diff --check。",
        "浏览器验收 light/dark × desktop/640/375/320 × only-7d/only-week/mixed/unknown/outer-unknown/warning/danger，并检查 hover/focus/Escape。",
        "记录真实 provider 数据无法证明 duration 时的正确 detail-only 降级，不为多环放宽证据。"
      ],
      "acceptance": [
        "源码、测试、文档无 provider 固定 layer mapping、Limits=90d、中心最内层口径。",
        "自动验证通过且人工矩阵有记录。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:provider-usage-aggregate",
        "npm run test:provider-usage-compact",
        "npm run test:chatgpt-usage-panel",
        "npm run test:grok-usage-panel",
        "npm run test:kiro-config",
        "git diff --check"
      ],
      "risks": [
        "真实 provider 新窗口缺少可信 duration evidence",
        "320px 或浅色 detail-only 状态遗漏",
        "文档残留固定 week/month/5h/7d 布局"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```

## 验证命令

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

## 检查门禁与回滚

- checker 必须先审公共 projector 的 duration 信任/降级与 permutation 稳定性，再审 provider adapter 不含布局硬编码，最后对照 HTML 原型做视觉/交互检查。
- blocker：任一 provider 写死多窗 layer 顺序；`Limits=90d`；unknown/tie 按 id/数组挑选；center 不是最终外圈；浅色固定夜间 surface；panel 环仍 small。
- 回滚到当前聚合实现；运行时止血可设 `usage.providerPanelsAggregated=false`。不删除账号、quota cache 或 Compact 偏好。
