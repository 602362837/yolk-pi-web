# implement

## 建议执行顺序

1. 先固定 usage/topbar 显示口径：父 session 显示 rollup，standalone 显示自身，child session 推荐显示该 child 自身费用并在 tooltip 给 parent rollup；如主会话选择备选口径，则只改文案不改 display totals。
2. 修复 `AppShell` 顶部费用 chip 的 `+child` 与 `hasChildUsage` 判定。
3. 调整 `useAgentSession` / `ChatWindow` 的 topbar stats 映射与更新 key，确保父/子 session 切换能刷新。
4. 验证 `/api/usage` 全局统计与 `?sessionId=` rollup，必要时补轻量回归脚本。
5. 同步 docs，运行 lint/type-check。

## 需先阅读的文件

- `docs/architecture/overview.md` Usage accounting 章节。
- `docs/modules/frontend.md` 中 `AppShell`、`ChatWindow`、`UsageStatsModal`、`useAgentSession` 描述。
- `docs/modules/api.md` 中 `usage/` route 与 Implementation Pointers。
- `docs/modules/library.md` 中 `lib/usage-stats.ts` 描述。
- `components/AppShell.tsx`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/UsageStatsModal.tsx`
- `lib/usage-stats.ts`
- `app/api/usage/route.ts`

## Implementation Plan

| ID | Title | Phase | Depends on | Parallel | Local review |
| --- | --- | --- | --- | --- | --- |
| usage-contract | 明确 session rollup 与 child-selected 显示口径 | design/impl | - | no | yes |
| topbar-copy | 修复顶部费用 chip 文案与 child usage 判定 | impl | usage-contract | yes | yes |
| hook-refresh | 调整 hook/topbar stats 映射与刷新 key | impl | usage-contract | yes | yes |
| usage-validation | 验证 Usage 聚合链路与补回归检查 | impl/check | usage-contract | yes | yes |
| docs-checks | 同步文档并执行验证 | check | topbar-copy, hook-refresh, usage-validation | no | yes |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "usage-contract",
      "title": "明确 session rollup 与 child-selected 显示口径",
      "phase": "design/impl",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/usage-stats.ts",
        "hooks/useAgentSession.ts",
        "components/AppShell.tsx",
        "docs/architecture/overview.md"
      ],
      "instructions": "确认主会话选择的 child audit session 顶部费用口径。推荐：父 session 显示 parent rollup；standalone 显示自身；child session compact 显示该 child 自身 usage，tooltip 给 parent rollup。若选择备选口径，则保留 parent rollup totals 但文案标明 parent rollup。优先保持 /api/usage?sessionId response additive 或不变，不删除现有字段。",
      "acceptance": [
        "父、standalone、child 三种 topbar 口径在代码注释或命名中可读",
        "不改变 JSONL header 与 child transcript 安全边界",
        "如 UsageSessionRollupResult 增字段，旧字段仍可用"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "child tab 显示自身费用 vs parent rollup 属于产品口径，未确认时不要扩大实现"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "topbar-copy",
      "title": "修复顶部费用 chip 文案与 child usage 判定",
      "phase": "impl",
      "order": 2,
      "dependsOn": ["usage-contract"],
      "files": [
        "components/AppShell.tsx"
      ],
      "instructions": "移除裸露的 '+child' hard-code。将 hasChildUsage 判定改为 child token total > 0 或 child cost > 0，而不是 childCount > 0。父 rollup 有实际 child usage 时 compact 推荐显示 '$x incl. Studio'；child-selected 场景按 usage-contract 显示 'Studio child' 或 'parent rollup'。tooltip scope 明确 current chat、selected Studio child、parent rollup 与 own/children cost split。",
      "acceptance": [
        "代码中不再出现用于顶部费用展示的裸 '+child' 文案",
        "child session 数量大于 0 但 child usage 为 0 时不会显示 child usage 标记",
        "tooltip 仍展示 own cost 与 Studio children cost 拆分"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工打开 parent session、standalone session、Studio child session 检查顶部费用"
      ],
      "risks": [
        "topbar 空间有限，文案过长会挤压右侧按钮；保持短文案"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "hook-refresh",
      "title": "调整 hook/topbar stats 映射与刷新 key",
      "phase": "impl",
      "order": 3,
      "dependsOn": ["usage-contract"],
      "files": [
        "hooks/useAgentSession.ts",
        "components/ChatWindow.tsx"
      ],
      "instructions": "在 SessionUsageTopbarStats 中加入必要的 display scope/selectedSessionKind/parent rollup 或 selected child totals 字段。若 child-selected 显示自身费用，从 rollup.childSessions 中取当前 sessionId totals 或使用新增 selectedSessionTotals。更新 ChatWindow statsKey，至少纳入 selectedSessionKind、parentFound、own/studioChild token totals 或 display scope，避免父/子 session 总额相同时不触发 AppShell 更新。",
      "acceptance": [
        "父 session 与其 child session 间切换后 topbar 文案和 tooltip 立即更新",
        "rollup API 失败时仍可回退 local messages usage",
        "不把 child usage/messages 拼入 parent messages 列表"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工切换同一 parent 与 child audit tab"
      ],
      "risks": [
        "新增 stats 字段若未纳入 statsKey，React 父组件可能看到旧展示"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "usage-validation",
      "title": "验证 Usage 聚合链路与补回归检查",
      "phase": "impl/check",
      "order": 4,
      "dependsOn": ["usage-contract"],
      "files": [
        "lib/usage-stats.ts",
        "app/api/usage/route.ts",
        "components/UsageStatsModal.tsx",
        "scripts/"
      ],
      "instructions": "检查 getUsageStats 与 getUsageStatsForSessionRollup 是否在 active/archive scope 下都 includeStudioChildren。用 fixture 或现有本地样本验证：global totals 包含 child；bySession 保留 child row；byParentSession totals=ownTotals+studioChildTotals；session_rollup(parent) 一致；session_rollup(child) 满足 usage-contract。若添加脚本，沿用 scripts/ 下轻量 node 脚本风格，不引入重型测试框架。",
      "acceptance": [
        "至少有一条明确验证记录覆盖 parent + Studio child usage 汇总",
        "UsageStatsModal 的 Parent sessions 行仍优先使用 byParentSession",
        "孤儿 child parentFound=false 的语义不被破坏"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "可选：新增并运行轻量 usage rollup 测试脚本"
      ],
      "risks": [
        "SessionManager fixture 构造成本较高；若不加脚本，必须记录手工 API 验证样本"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "docs-checks",
      "title": "同步文档并执行最终验证",
      "phase": "check",
      "order": 5,
      "dependsOn": ["topbar-copy", "hook-refresh", "usage-validation"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md"
      ],
      "instructions": "若实现改变 child-selected topbar 口径或 UsageSessionRollupResult 字段，更新相关 docs。运行项目标准验证命令，并记录任何未覆盖的手工验收点。不要运行 next build；除非主会话要求发布验证。",
      "acceptance": [
        "docs 与最终代码口径一致",
        "lint 与 type-check 通过或阻塞原因明确",
        "plan-review/review/handoff 记录验证结果"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "文档仍写 child session 只显示 parent rollup 会与实现不一致"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

可选：如实现新增 usage rollup 轻量脚本，则运行对应 `npm run test:*` 或直接 `node ...`。

## 检查门禁

- 代码中顶部费用不再显示裸 `+child`。
- 父 session rollup 与 child session 展示口径已由主会话确认。
- Usage 聚合至少覆盖 parent + child 的真实或 fixture 验证。
- 文档与实现一致。
- 未运行 `next build`，除非主会话另行要求。
