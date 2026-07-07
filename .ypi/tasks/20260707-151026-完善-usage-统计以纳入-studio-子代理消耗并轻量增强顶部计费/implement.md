# Implement — Usage 纳入 Studio child sessions

## 执行顺序总览

| 顺序 | 子任务 | 目标 | 可并行 |
| --- | --- | --- | --- |
| 1 | session-metadata-child-archive | 让 session reader 在 usage 场景可读取 active/archived Studio child metadata | 否 |
| 2 | usage-stats-parent-rollup | 扩展 usage 聚合类型、扫描 child sessions、生成 parent rollup 和 session rollup | 否 |
| 3 | usage-api-session-mode | `/api/usage` 接入全局扩展和 `sessionId` 轻量 rollup 分支 | 依赖 2 |
| 4 | chat-topbar-rollup | Chat 顶部通过后台 API 获取 parent+child totals，fallback 本地 stats | 依赖 3 |
| 5 | usage-modal-rollup-ui | Usage 弹窗说明包含 child，并展示 parent rollup | 依赖 2/3，可与 4 并行 |
| 6 | docs-validation | 更新 docs 并完成验证 | 最后 |

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/session-reader.ts`
- `lib/session-header-metadata.ts`
- `lib/types.ts`
- `lib/usage-stats.ts`
- `app/api/usage/route.ts`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/AppShell.tsx`
- `components/UsageStatsModal.tsx`

## 关键实现约束

- 不直接修改父 session JSONL，不追加 child usage/message 到父 chat context。
- 只统计标准 session JSONL assistant message `usage`；不解析 Studio transcript sidecar 估算费用。
- `listAllSessions()` 默认行为保持隐藏 `studioChild`，避免普通历史列表回归。
- `/api/usage` 原有字段保持兼容；新增字段 additive。
- 顶部 stats API 请求必须可 abort，并在失败时静默 fallback。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "taskId": "20260707-151026-完善-usage-统计以纳入-studio-子代理消耗并轻量增强顶部计费",
  "summary": "让 Usage 统计纳入带 studioChild header 的 YPI Studio child sessions，新增 parent session rollup，并让 Chat 顶部通过后台 API 显示 parent + child 汇总费用，保持父聊天上下文不被 child transcript/usage 明细污染。",
  "subtasks": [
    {
      "id": "session-metadata-child-archive",
      "title": "扩展 session reader 的 Studio child metadata 读取能力",
      "phase": "implementation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/session-reader.ts",
        "lib/session-header-metadata.ts",
        "lib/types.ts"
      ],
      "instructions": [
        "确认 active listAllSessions({ includeStudioChildren: true }) 已解析 studioChild；保持默认 includeStudioChildren=false。",
        "为 archived session listing 增加可选 includeStudioChildren 参数，并用 parseSessionHeaderMetadata 或等价逻辑解析 studioChild。",
        "listAllArchivedSessions / listArchivedSessionsForCwd 保持旧调用默认不返回 child；usage 场景显式传 includeStudioChildren=true。",
        "归档 SessionInfo 也填充 projectId/spaceId/legacyUnassigned/studioChild，studioChild 存在时 legacyUnassigned=false。",
        "不要改变普通 sessions/sidebar API 的默认隐藏 child 行为。"
      ],
      "acceptance": [
        "active 和 archived usage 扫描均能拿到 session.studioChild。",
        "不传 includeStudioChildren 的现有 session 列表行为不变。",
        "Studio child SessionInfo 包含 studioChild.parentSessionId/taskId/runId/member。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "误改默认列表会让 Sidebar 根历史出现 child audit sessions；必须用显式 opt-in。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "默认行为兼容",
          "archived child metadata",
          "legacyUnassigned 口径"
        ]
      }
    },
    {
      "id": "usage-stats-parent-rollup",
      "title": "扩展 usage 聚合与 parent session rollup",
      "phase": "implementation",
      "order": 2,
      "dependsOn": [
        "session-metadata-child-archive"
      ],
      "files": [
        "lib/usage-stats.ts",
        "lib/types.ts"
      ],
      "instructions": [
        "新增 UsageSessionKind、UsageParentSessionSummary、UsageSessionRollupResult 等导出类型。",
        "新增 totals clone/add helpers，避免 ownTotals/studioChildTotals/byDay/byModel 共享引用。",
        "getUsageStats 使用 listAllSessions({ includeStudioChildren: true }) 和 listAllArchivedSessions({ includeStudioChildren: true })。",
        "保留 bySession 单 session 维度，但为 child row 填 kind=studio_child、parentSessionId、studioChild 摘要。",
        "新增 buildParentRollups：普通 session 归入自身 id，child session 归入 studioChild.parentSessionId；parent 缺失时输出 parentFound=false row。",
        "新增 getUsageStatsForSessionRollup({ sessionId, from?, to?, includeArchived })：先扫描 headers 找 parent/children，再只打开相关 session entries 累加。",
        "session rollup 默认 lifetime；若传 from/to 则复用日期过滤。",
        "增加 scannedStudioChildSessions、matchedStudioChildSessions 计数。"
      ],
      "acceptance": [
        "全局 totals 包含 Studio child usage。",
        "byParentSession totals = ownTotals + studioChildTotals。",
        "session rollup 不返回 child messages/transcripts，只返回 usage totals 和 child session summaries。",
        "旧 UsageStatsResult 字段仍存在。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "parent 缺失时展示字段不足；需要用 child cwd/created/firstMessage 兜底。",
        "branch session 中重复历史 usage 的既有统计口径保持不变，不在本任务修正。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "无重复计数",
          "parent rollup 归并规则",
          "session rollup 只打开相关 entries"
        ]
      }
    },
    {
      "id": "usage-api-session-mode",
      "title": "扩展 /api/usage 聚合响应并接入 sessionId rollup 分支",
      "phase": "implementation",
      "order": 3,
      "dependsOn": [
        "usage-stats-parent-rollup"
      ],
      "files": [
        "app/api/usage/route.ts"
      ],
      "instructions": [
        "解析 searchParams.sessionId；存在时进入 session rollup mode。",
        "sessionId mode：from/to 可选；不传时使用 lifetime range；读取 readPiWebConfig().usage.includeArchived；调用 getUsageStatsForSessionRollup。",
        "sessionId 不存在返回 404；日期格式沿用现有 400。",
        "非 sessionId mode 保持默认近 7 天逻辑，调用扩展后的 getUsageStats。",
        "响应不要包含 transcript、message content 或 task artifact bodies。"
      ],
      "acceptance": [
        "GET /api/usage 原查询兼容，新增字段可见。",
        "GET /api/usage?sessionId=<parent> 返回 parent + children totals。",
        "GET /api/usage?sessionId=<child> 能归一到 parent rollup 或在 parent 缺失时返回 child self rollup。",
        "错误状态码明确。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "同一 route 返回两种 shape，前端必须按是否传 sessionId 使用对应类型；可用 kind=session_rollup 区分。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "日期默认差异文档化",
          "404/400 语义",
          "无敏感/大文本输出"
        ]
      }
    },
    {
      "id": "chat-topbar-rollup",
      "title": "Chat 顶部通过 usage API 展示 parent+child 汇总",
      "phase": "implementation",
      "order": 4,
      "dependsOn": [
        "usage-api-session-mode"
      ],
      "files": [
        "hooks/useAgentSession.ts",
        "components/ChatWindow.tsx",
        "components/AppShell.tsx"
      ],
      "instructions": [
        "抽出/复用本地 messages usage 累加作为 fallback。",
        "在 useAgentSession 中基于 effectiveSessionId 请求 /api/usage?sessionId=...，使用 AbortController 清理过期请求。",
        "请求触发：session 切换、首次加载、agent 从 running 变为 idle 后；可加低频 interval（例如 30s）仅当前会话刷新以覆盖后台 Studio child 完成。",
        "扩展 onSessionStatsChange 类型，包含 totals/ownTotals/studioChildTotals/studioChildSessionCount/source。",
        "AppShell 顶部显示仍保持紧凑；tooltip 增加 scope、own cost、Studio child cost/child count。",
        "API 失败时静默使用本地 stats，不弹错误、不影响聊天。"
      ],
      "acceptance": [
        "父会话顶部 cost 包含 child sessions cost。",
        "无 child 的普通会话视觉基本不变。",
        "父 session messages 数组未被 child 内容污染。",
        "快速切换 session 不会显示上一个 session 的 rollup。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "过频刷新影响性能；需限制为当前 active chat，且 route 只打开相关 session entries。",
        "新 stats 类型在 ChatWindow/AppShell 两端需同步，否则 TS 报错。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": [
          "上下文不污染",
          "请求 abort/race",
          "tooltip 信息不过载"
        ]
      }
    },
    {
      "id": "usage-modal-rollup-ui",
      "title": "UsageStatsModal 展示包含子代理说明与 parent rollup",
      "phase": "implementation",
      "order": 5,
      "dependsOn": [
        "usage-api-session-mode"
      ],
      "files": [
        "components/UsageStatsModal.tsx"
      ],
      "instructions": [
        "在标题/说明区增加包含 YPI Studio child sessions 且 roll up to parent 的说明。",
        "Metrics 增加 Studio child sessions 与 Parent rollups 信息，保持布局自适应。",
        "Sessions section 优先渲染 stats.byParentSession；旧响应 fallback 到 bySession。",
        "parent row 展示 child count，tooltip 或副标题显示 child cost/own cost。",
        "不新增 transcript 明细入口，不显示 child prompt/output。"
      ],
      "acceptance": [
        "Modal 中能看见 child sessions 已纳入统计。",
        "Parent sessions 列表按 rollup cost 排序。",
        "旧字段缺失时仍可展示 bySession。",
        "小屏布局不明显溢出。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "指标过多导致拥挤；优先使用简短 label 和 tooltip。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": [
          "说明清楚",
          "fallback 兼容",
          "无 child transcript 泄漏"
        ]
      }
    },
    {
      "id": "docs-validation",
      "title": "更新文档并执行验证",
      "phase": "checks",
      "order": 6,
      "dependsOn": [
        "chat-topbar-rollup",
        "usage-modal-rollup-ui"
      ],
      "files": [
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "更新 /api/usage 文档：包含 Studio child sessions、byParentSession、sessionId rollup。",
        "更新 frontend 文档：UsageStatsModal parent rollup；Chat 顶部 usage API rollup 与 fallback。",
        "更新 library 文档：usage-stats 归并规则；session-reader archived child metadata opt-in。",
        "在 architecture overview 中记录 usage 只读取 child session JSONL usage，不污染父 messages。",
        "运行 lint 与 TypeScript 检查。",
        "人工检查 diff，确认无生产代码外无关改动。"
      ],
      "acceptance": [
        "docs 与 API/类型/UI 契约一致。",
        "npm run lint 通过。",
        "node_modules/.bin/tsc --noEmit 通过。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "文档若未说明 CLI --no-session 不计入，后续可能误判为漏统；需明确边界。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "文档同步",
          "验证命令结果",
          "边界说明"
        ]
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

## 手工验收建议

1. 准备或使用一个包含 SDK Studio child session 的父会话。
2. 调用 `GET /api/usage?sessionId=<parentId>`：确认 `studioChildSessionCount > 0`，`totals.cost = ownTotals.cost + studioChildTotals.cost`。
3. 调用普通 `GET /api/usage?from=...&to=...&cwd=...`：确认 `matchedStudioChildSessions` 与 `byParentSession` 存在。
4. 打开父 Chat：顶部 cost 包含 child cost，tooltip 展示 child 数/拆分。
5. 检查 React message 列表和 session detail：父 session messages 未出现 child transcript/usage 明细。
6. 打开 Usage Modal：确认说明和 Parent sessions rollup 可读。

## 检查门禁

- 不通过 lint/tsc 不进入 review。
- 未更新 docs 不进入 review。
- 发现父聊天 messages 被 child 内容污染时必须阻塞。