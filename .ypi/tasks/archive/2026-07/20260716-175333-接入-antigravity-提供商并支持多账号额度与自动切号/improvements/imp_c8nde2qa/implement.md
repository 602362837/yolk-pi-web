# Implement：IMP-001 组聚合额度与双圆环

## 双独立圆环纠正（强制）

- **禁止** `createProviderUsageRingUnit({ layers: [flash, opus] })`。
- **必须** `ringSlots: [flashUnit, opusUnit]` 并排渲染。
- 共享 N-ring outer/inner **仅**用于同组可信周期；当前无 5h/7d 证据则每组 1 layer。

## 实现前提

1. 用户已明确批准 [`plan-review.md`](./plan-review.md)（含安全/行为变更）。  
2. 实现员只改本计划列出的文件与测试，不改 GPT/Grok/Kiro failover 内核。  
3. 不引入 rotator、不改 quota egress、不把 group 写入 wire schema。  
4. 每次只 claim 一个 subtaskId。

## 优先阅读

1. 本改进 `brief.md` / `prd.md` / `design.md` / `ui.md` / HTML 原型 / `checks.md`  
2. `lib/antigravity-model-quota.ts`、`lib/antigravity-usage-ring.ts`、`lib/antigravity-subscription-quota.ts`  
3. `lib/antigravity-account-failover.ts`（**只回归，不改 candidate 语义**）  
4. `components/AntigravityUsagePanel.tsx`、`AntigravityQuotaView.tsx`、`ProviderUsageTrigger.tsx`、`ProviderUsagePanelContract.ts`  
5. 现有 `scripts/test-antigravity-usage-panel.mjs`、`test-antigravity-model-quota.mjs`、`test-provider-usage-*.mjs`

## 人类可读子任务

| ID | 阶段 | 依赖 | 内容 | 并行 |
| --- | --- | --- | --- | --- |
| AG-G01 | mapping | — | 固定 group 映射 + 保守聚合 pure helpers | 是 |
| AG-G02 | ring | AG-G01 | dual-independent/single/detail-only rings + aggregate projection | 是 |
| AG-G03 | ui-topbar | AG-G02 | UsagePanel accordion + CSS/a11y | 是 |
| AG-G04 | ui-models | AG-G01 | Models QuotaView 同源分组 | 与 G03 并行 |
| AG-G05 | verify | AG-G01…04 | 回归、文档、回滚说明 | 否 |

`maxConcurrency=2`。G03 与 G04 文件隔离：G03 不改 QuotaView，G04 不改 UsagePanel/AppShell。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "Antigravity quota 按固定模型组保守聚合；顶栏对 Gemini 3 Flash / Claude Opus 显示两个独立圆环（非内外周期环）；详情与 Models 按组可展开；failover 保持 public-model keys，不 group-aware。",
  "strategy": "pure mapping/aggregation first; ring projection next; parallel UsagePanel and Models UI; final regression and docs barrier",
  "maxConcurrency": 2,
  "scheduler": {
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "AG-G01",
      "title": "固定 quotaKey→group 映射与保守聚合 helpers",
      "phase": "mapping",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/antigravity-quota-groups.ts",
        "scripts/test-antigravity-quota-groups.mjs",
        "package.json"
      ],
      "instructions": [
        "Add lib/antigravity-quota-groups.ts with fixed group order, labels, and quotaKey→groupId table covering every 0.3.0 acceptedQuotaKey and public id; unknown keys map to other.",
        "Implement groupByAntigravityQuotaWindows: dedupe by window.id, filter unsafe windows, compute max(usedPercent)/min(remainingFraction), optional earliest resetsAt display-only, variants sorted by id for stable detail.",
        "Never average/sum; never use resetTime as duration; never import package private src.",
        "Export helpers pure (no React/network/fs).",
        "Register npm run test:antigravity-quota-groups and cover catalog coverage, unknown→other, conservative max, empty groups omitted, shared routing keys single membership."
      ],
      "acceptance": [
        "All 0.3.0 keys have deterministic group membership.",
        "max(used) aggregation unit-tested.",
        "No secrets or IO in module."
      ],
      "validation": [
        "npm run test:antigravity-quota-groups",
        "npm run test:antigravity-model-quota",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Missing routing key leaves duplicates in other",
        "Optimistic aggregation accidentally shipped"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["mapping coverage", "conservative math", "determinism"]
      }
    },
    {
      "id": "AG-G02",
      "title": "Grouped dual/single ring 与 aggregate projection",
      "phase": "ring",
      "order": 2,
      "dependsOn": ["AG-G01"],
      "files": [
        "lib/antigravity-usage-ring.ts",
        "scripts/test-antigravity-usage-panel.mjs"
      ],
      "instructions": [
        "Replace multi-model flat detail-only-only path for topbar when priority groups present: build ProviderUsageRingUnit via createProviderUsageRingUnit with outer Flash and inner Opus conservative percents.",
        "Do not fabricate durationMs/durationEvidence from resetTime; do not call shared projectProviderUsageWindows for the dual priority case.",
        "Degrade: one priority group → single layer; no priority groups but other groups present → fallback 多模型 + detail-only mode; empty/loading/reauth/invalid_project preserve existing safe copy.",
        "Update buildAntigravityUsageAggregateProjection to use grouped ring; risk uses worst tone of projected layers/groups; never total percent field.",
        "Extend usage-panel tests for double/single/other-only/stale/reauth and assert no projectId/account secrets."
      ],
      "acceptance": [
        "Double ring when both priority groups present.",
        "No fake 0% layer for missing priority group.",
        "Stale can show rings with warning; aggregate privacy intact."
      ],
      "validation": [
        "npm run test:antigravity-usage-panel",
        "npm run test:provider-usage-compact",
        "npm run test:provider-usage-aggregate",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Breaking centerLayerId=outer invariant",
        "Regressing GPT/Grok/Kiro aggregate shell"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["dual-ring invariant", "no duration forge", "degrade matrix"]
      }
    },
    {
      "id": "AG-G03",
      "title": "UsagePanel 组 accordion 与 a11y",
      "phase": "ui-topbar",
      "order": 3,
      "dependsOn": ["AG-G02"],
      "files": [
        "components/AntigravityUsagePanel.tsx",
        "app/globals.css",
        "scripts/test-antigravity-usage-panel.mjs"
      ],
      "instructions": [
        "Render grouped accordion from group helpers; default collapsed; expand shows variants with used/remaining/reset only.",
        "Match approved HTML structure/copy for banners and empty/stale/reauth; keep accountId/generation/abort guards.",
        "Keyboard/ARIA/Escape/focus restore/reduced-motion; no per-variant refresh control.",
        "Do not mount second poller; do not change AppShell provider order beyond existing Antigravity slot."
      ],
      "acceptance": [
        "Detail is group-first not flat 16+ rows.",
        "DOM has no token/refresh/projectId.",
        "Narrow widths scroll safely."
      ],
      "validation": [
        "npm run test:antigravity-usage-panel",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Accordion focus trap regressions",
        "Stale flash across account switch"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["prototype fidelity", "a11y", "privacy"]
      }
    },
    {
      "id": "AG-G04",
      "title": "Models AntigravityQuotaView 同源分组",
      "phase": "ui-models",
      "order": 3,
      "dependsOn": ["AG-G01"],
      "files": [
        "components/AntigravityQuotaView.tsx",
        "scripts/test-antigravity-models-ui.mjs"
      ],
      "instructions": [
        "Reuse the same groupBy helpers as topbar; do not fork a second mapping table.",
        "Show collapsed groups with conservative used/remaining; expand variants; preserve empty/error/stale/reauth rendering.",
        "Keep selection/Activate generation clear of old quota; no JSON import; no projectId.",
        "Extend models-ui contract tests for grouped markup/class hooks as needed."
      ],
      "acceptance": [
        "Models quota board matches group order and conservative headers.",
        "Unknown quota still does not block account management."
      ],
      "validation": [
        "npm run test:antigravity-models-ui",
        "npm run test:antigravity-quota-groups",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Divergent mapping if copied",
        "Overflow on long variant ids"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["shared helpers", "Models privacy", "responsive"]
      }
    },
    {
      "id": "AG-G05",
      "title": "Failover 回归、集成测试与文档",
      "phase": "verify",
      "order": 4,
      "dependsOn": ["AG-G01", "AG-G02", "AG-G03", "AG-G04"],
      "files": [
        "scripts/test-antigravity-failover-adapter.mjs",
        "scripts/test-antigravity-integration.mjs",
        "docs/integrations/README.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Add/adjust tests proving failover still uses public-model accepted keys only; same-group other keys with remaining do not make candidate.",
        "Update integration suite expectations: multi-model may show dual ring instead of detail-only when priority groups present; keep REAL_PROVIDER_BLOCKER honesty.",
        "Document group aggregation, conservative max, dual-ring priority groups, failover non-group-aware, rollback.",
        "Run full Antigravity + compact/aggregate + GPT/Grok/Kiro/OpenCode regressions; lint; tsc; git diff --check. Do not run next build."
      ],
      "acceptance": [
        "No failover semantic regression.",
        "Docs match implementation.",
        "Automated baseline green."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:antigravity-quota-groups",
        "npm run test:antigravity-usage-panel",
        "npm run test:antigravity-models-ui",
        "npm run test:antigravity-failover-adapter",
        "npm run test:antigravity-failover-runtime",
        "npm run test:antigravity-integration",
        "npm run test:provider-usage-compact",
        "npm run test:provider-usage-aggregate",
        "npm run test:chatgpt-failover-contract",
        "npm run test:grok-all",
        "npm run test:kiro-integration",
        "npm run test:opencode-go-failover-behavior",
        "git diff --check"
      ],
      "risks": [
        "Docs overclaim live UAT",
        "Integration snapshot still expects 多模型 always"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["failover boundary", "docs accuracy", "full regression"]
      }
    }
  ],
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      { "id": "mapping", "relation": "serial", "subtaskIds": ["AG-G01"] },
      { "id": "ring", "relation": "serial", "dependencies": ["mapping"], "subtaskIds": ["AG-G02"] },
      { "id": "ui", "relation": "parallel", "dependencies": ["ring"], "subtaskIds": ["AG-G03", "AG-G04"] },
      { "id": "verify", "relation": "barrier", "dependencies": ["ui"], "subtaskIds": ["AG-G05"] }
    ]
  }
}
```

注意：G04 仅依赖 G01，可与 G02 之后的 G03 并行；若调度器按 group 门禁，以 `execution.groups` 为准（G04 也可在 ring 完成后与 G03 同批）。实现员不得在 G02 完成前改 ring 消费方假设。

## 回滚

1. `antigravity.usagePanelEnabled=false` 止血。  
2. 恢复扁平 `projectAntigravityRingUnit` detail-only；UsagePanel/QuotaView 回 flat list。  
3. 保留 group 文件但不引用亦可；不删用户凭据/cache。

## 禁止项（遇到即停）

- group remaining 驱动 failover  
- resetTime → duration  
- avg/sum 总百分比  
- 修改其他 provider classifier  
- 静态 import antigravity 包私有路径  
