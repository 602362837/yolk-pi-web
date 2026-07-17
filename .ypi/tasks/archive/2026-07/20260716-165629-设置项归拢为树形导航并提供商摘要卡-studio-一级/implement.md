# Implement：Settings 树导航与 Provider Hub

> 本文件仅为实现审批计划。UI designer 尚未完成正式派发/确认，任务也未进入 `awaiting_approval`；不得据此开始实现。

## 实现前提

1. UI designer 已审阅或修订 [`settings-tree-provider-hub-prototype.html`](settings-tree-provider-hub-prototype.html)，并在 [`ui.md`](ui.md) 留下正式交付结论。
2. 用户已批准 [`plan-review.md`](plan-review.md) 与最终 HTML 原型。
3. 主会话已保存本 Implementation Plan 并合法 transition 到 `implementing`。

## 需先阅读

- [`brief.md`](brief.md)、[`prd.md`](prd.md)、[`ui.md`](ui.md)、[`design.md`](design.md)、[`checks.md`](checks.md)
- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/standards/code-style.md`
- `components/SettingsConfig.tsx`
- `components/AppShell.tsx`（Studio deep-link caller）
- `app/globals.css`（`.settings-modal-*` 小屏规则）
- `lib/pi-web-config.ts`（仅确认 schema 不变，不计划修改）

## 人类可读子任务表

| ID | Phase | Order | Depends on | 子任务 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| SETTINGS-IA-01 | navigation | 1 | — | 实现可折叠、键盘可用的 Settings 树导航组件与稳定 IA 模型 | `components/SettingsTreeNavigation.tsx` | 是 |
| SETTINGS-IA-02 | provider-hub | 1 | — | 实现四 provider 摘要卡纯呈现组件 | `components/SettingsProviderHub.tsx` | 是 |
| SETTINGS-IA-03 | integration | 2 | 01, 02 | 集成 Settings view、Provider Hub/详情返回与 Studio 深链自动展开 | `components/SettingsConfig.tsx`, `components/AppShell.tsx`（仅必要时） | 否 |
| SETTINGS-IA-04 | responsive-a11y | 2 | 01, 02 | 落地 modal/tree/card 响应式样式并完成 a11y 交互校准 | `app/globals.css`, `components/SettingsTreeNavigation.tsx`, `components/SettingsProviderHub.tsx` | 可与 03 并行 |
| SETTINGS-IA-05 | docs | 3 | 03, 04 | 同步前端模块文档和实际边界 | `docs/modules/frontend.md` | 否 |
| SETTINGS-IA-06 | verification | 4 | 03, 04, 05 | lint/tsc、浏览器窄屏/键盘/深链回归 | 不预设生产文件 | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "strategy": "parallel-ready DAG with one integration writer",
  "maxConcurrency": 3,
  "subtasks": [
    {
      "id": "SETTINGS-IA-01",
      "title": "Build accessible Settings tree navigation and stable IA model",
      "phase": "navigation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "components/SettingsTreeNavigation.tsx"
      ],
      "instructions": [
        "Add a presentation-focused SettingsTreeNavigation component with the approved groups, root-level Studio leaf, providerHub parent view, and four provider child leaves.",
        "Keep the 13 existing SettingsSection ids unchanged; model providerHub as a separate virtual Settings view and keep initialSection typed to real sections only.",
        "Accept active view, expanded group state, expansion callback, and selection callback from SettingsConfig; do not read or save config in this component.",
        "Implement visible-node focus management and keyboard support for ArrowUp/Down/Left/Right, Home/End, Enter/Space, plus aria-expanded, aria-controls and aria-current.",
        "Use stable id-based ancestor mappings rather than display-label inference."
      ],
      "acceptance": [
        "Studio is a root leaf and Trellis is under Tools.",
        "All groups can be expanded/collapsed with mouse and keyboard.",
        "ProviderHub can be activated independently while its provider children can be expanded.",
        "The component contains no pi-web config or provider network logic."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "Manual keyboard pass of all visible tree nodes"
      ],
      "risks": [
        "Incorrect partial ARIA tree semantics can be worse than nav/button semantics.",
        "Roving focus can target hidden nodes if visible-node flattening is stale."
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": "keyboard semantics, node hierarchy, stable ids"
      }
    },
    {
      "id": "SETTINGS-IA-02",
      "title": "Build provider strategy summary hub cards",
      "phase": "provider-hub",
      "order": 1,
      "dependsOn": [],
      "files": [
        "components/SettingsProviderHub.tsx"
      ],
      "instructions": [
        "Create a pure presentational hub with ChatGPT, OpenCode Go, Grok and Kiro cards in the approved fixed order.",
        "Accept only current Settings draft booleans and onOpenProvider; never fetch quota/accounts or expose secrets.",
        "Show ChatGPT usage/failover/auto-refresh, OpenCode Go failover plus explicit usage-unavailable and Models account management, and Grok/Kiro usage/failover plus Models Global Active guidance.",
        "Use text labels Open/Closed/Unavailable/Models in addition to tone, and avoid nested interactive elements."
      ],
      "acceptance": [
        "Exactly four cards render with accurate draft-derived statuses.",
        "OpenCode Go does not claim a usage panel setting.",
        "Each card opens its existing provider SettingsSection id.",
        "No account, quota or API request is introduced."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "Manual check for all 2^n relevant boolean status projections"
      ],
      "risks": [
        "Copy may imply live quota status when it is only configuration status.",
        "Duplicated local card state could drift from the Settings draft."
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": "status口径, privacy boundary, card semantics"
      }
    },
    {
      "id": "SETTINGS-IA-03",
      "title": "Integrate tree views, provider detail path and Studio deep-link compatibility",
      "phase": "integration",
      "order": 2,
      "dependsOn": [
        "SETTINGS-IA-01",
        "SETTINGS-IA-02"
      ],
      "files": [
        "components/SettingsConfig.tsx",
        "components/AppShell.tsx"
      ],
      "instructions": [
        "Replace the flat renderSectionButton navigation with SettingsTreeNavigation and add a local SettingsView that includes providerHub without widening the external initialSection contract.",
        "Initialize and update expanded group state from the selected view's ancestor mapping; preserve other user-expanded groups.",
        "Render SettingsProviderHub from current chatgpt/opencodeGo/grok/kiro draft objects and route card actions to existing provider section renderers.",
        "Add a consistent back-to-provider-hub action to provider detail views without duplicating forms or handlers.",
        "Preserve initialSection=studio, studioFocusMember/studioFocusField scroll and highlight, temporary custom member rows, model-loading effects, dirty/save/reset and ModelPricesConfig behavior.",
        "Do not modify AppShell unless a type/export adjustment is genuinely required; preserve its current caller behavior."
      ],
      "acceptance": [
        "All 13 existing sections still render their original content and ids.",
        "Hub to provider detail to hub works for all four providers.",
        "Members deep-link opens root Studio and highlights the requested row without extra clicks.",
        "Changing a provider draft and returning to Hub immediately updates its summary.",
        "The /api/web-config request body and save/reset behavior are unchanged."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual AppShell Members -> Settings Studio deep-link check"
      ],
      "risks": [
        "Changing section to view can break effects that intentionally key on real sections.",
        "ProviderHub may accidentally enter save enable/disable conditions if treated as config data.",
        "AppShell type changes could unnecessarily widen external navigation contracts."
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": "deep-link, draft preservation, config request invariants"
      }
    },
    {
      "id": "SETTINGS-IA-04",
      "title": "Implement responsive Settings tree and provider card styling with accessibility polish",
      "phase": "responsive-a11y",
      "order": 2,
      "dependsOn": [
        "SETTINGS-IA-01",
        "SETTINGS-IA-02"
      ],
      "files": [
        "app/globals.css",
        "components/SettingsTreeNavigation.tsx",
        "components/SettingsProviderHub.tsx"
      ],
      "instructions": [
        "Add explicit class-based styles for the tree panel, nodes, selected/focus states, provider grid/cards and detail back action using existing CSS variables.",
        "Increase desktop modal/navigation room only as needed for three levels while keeping content min-width zero and independently scrollable.",
        "At <=640px override the old horizontal flat-nav behavior with a full-width vertical tree above content, bounded vertical height and internal scrolling; switch provider cards to one column.",
        "Ensure text status and focus rings are visible in light/dark themes and remove nonessential motion under prefers-reduced-motion."
      ],
      "acceptance": [
        "No horizontal page overflow at 320/390/640 widths.",
        "Desktop tree hierarchy remains readable and content retains useful width.",
        "Selected and focused states are not color-only.",
        "All cards and tree nodes remain reachable with keyboard and at 200% zoom."
      ],
      "validation": [
        "npm run lint",
        "Manual viewport checks at 320, 390, 640, 768, 960 and 1440px",
        "Manual light/dark and prefers-reduced-motion checks"
      ],
      "risks": [
        "Existing broad mobile selectors may override new tree direction unless selectors are explicit.",
        "A wider modal may reduce comfort on mid-size viewports without a breakpoint."
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": "responsive cascade, focus visibility, existing modal regression"
      }
    },
    {
      "id": "SETTINGS-IA-05",
      "title": "Synchronize frontend module documentation",
      "phase": "docs",
      "order": 3,
      "dependsOn": [
        "SETTINGS-IA-03",
        "SETTINGS-IA-04"
      ],
      "files": [
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Update the SettingsConfig entry to document grouped tree IA, root Studio, provider summary Hub, stable section ids, deep-link behavior and responsive/a11y boundary.",
        "Add entries for new SettingsTreeNavigation and SettingsProviderHub components if they exist in final implementation.",
        "State that provider Hub is draft-only presentation with no new API/config schema and account management remains in Models.",
        "Do not update API/library docs unless implementation actually changes those contracts."
      ],
      "acceptance": [
        "Frontend docs match final component names and behavior.",
        "Docs do not claim a new config field, API or account-management location.",
        "Trellis and Studio hierarchy is described correctly."
      ],
      "validation": [
        "rg -n \"SettingsTreeNavigation|SettingsProviderHub|提供商策略\" docs/modules/frontend.md"
      ],
      "risks": [
        "Docs may preserve stale flat-navigation wording.",
        "Over-documenting planned but unimplemented helpers can create false contracts."
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": "contract accuracy and non-goals"
      }
    },
    {
      "id": "SETTINGS-IA-06",
      "title": "Run final static and user-flow verification",
      "phase": "verification",
      "order": 4,
      "dependsOn": [
        "SETTINGS-IA-03",
        "SETTINGS-IA-04",
        "SETTINGS-IA-05"
      ],
      "files": [],
      "instructions": [
        "Run project lint and TypeScript checks.",
        "Execute checks.md manually for tree expansion, provider Hub/detail/back, draft reflection, all existing sections, Studio deep-link, narrow screens, themes and keyboard behavior.",
        "Verify browser network activity shows no new provider/account/quota request caused by merely opening the Hub.",
        "Report failures and blockers; do not relax product decisions or silently alter config/API scope."
      ],
      "acceptance": [
        "lint and tsc pass, or pre-existing unrelated failures are evidenced and scoped.",
        "All checks.md critical items pass.",
        "No new web-config schema or provider request appears.",
        "UI matches the user-approved HTML prototype in structure and interaction."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser acceptance using checks.md"
      ],
      "risks": [
        "Static checks cannot detect focus-order or narrow-screen interaction regressions.",
        "Without network inspection, the Hub could accidentally trigger provider polling through reused components."
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": "requirements, regressions and manual UI evidence"
      }
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 实现门禁

- UI designer HTML 原型交付与用户审批均为硬门禁。
- 实现任务按 DAG 派发；`SETTINGS-IA-01` 与 `02` 可并行，`03` 为 SettingsConfig 单一集成写者，`04` 可与 `03` 并行但不得同时改 `SettingsConfig.tsx`。
- 完成后由 checker 按 [`checks.md`](checks.md) 独立验收。
- 回滚仅恢复原扁平导航与样式；不得回写或迁移用户配置。
