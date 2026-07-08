# design

## 方案摘要

修复分两层：

1. UI 展示层：去掉 `AppShell` 顶部费用 chip 中裸露的 `+child`，改为基于实际 child totals 的明确文案；tooltip 区分 own / Studio child / parent rollup。
2. Usage 数据层：保持 `/api/usage` 与 `lib/usage-stats.ts` 以 standard assistant `usage` 为唯一来源，验证父子 session rollup 确实等于 own + child；如 child tab 需要显示自身费用，则在 hook/topbar stats 中显式提供 selected session display totals，而不是改变父 rollup API 的安全边界。

## 根因

- `components/AppShell.tsx` 硬编码 `{hasChildUsage && <span>+child</span>}`，不是面向用户的最终文案。
- `hasChildUsage` 用 `childCount > 0 || childCost > 0`，会把“存在 child session”误当作“存在 child usage”。
- `getUsageStatsForSessionRollup()` 对 child session 会解析到 parent rollup；这是文档化行为，但 topbar 没有将 `selectedSessionKind === "studio_child"` 转成清晰的显示口径。
- `ChatWindow` 上推 stats 的 `statsKey` 当前未包含 `selectedSessionKind` / `parentFound` / own-child token 明细；若后续 UI 依赖这些字段，切换父/子 session 时可能因为总额相同而不触发父组件更新。

## 影响模块和边界

| 文件 | 影响 |
| --- | --- |
| `components/AppShell.tsx` | 顶部费用 chip 文案、child usage 判定、tooltip scope 文案。 |
| `hooks/useAgentSession.ts` | 将 rollup API 结果转换为 topbar stats；必要时为 child-selected 场景提供 display totals / parent rollup totals。 |
| `components/ChatWindow.tsx` | statsKey 纳入新增字段，确保父/子 session 切换后 topbar 更新。 |
| `lib/usage-stats.ts` | 保持聚合逻辑；若需要 child 自身 totals 字段，可添加 additive 字段，不删除现有字段。 |
| `app/api/usage/route.ts` | 通常无需改；若 rollup contract 增字段，由 route 透传。 |
| `components/UsageStatsModal.tsx` | 通常无需布局改动；可微调文案以强调 parent rollup 已汇总 child。 |
| `docs/architecture/overview.md` / `docs/modules/*.md` | 如 child tab topbar 口径变化，需同步文档。 |

## 数据流 / API / 文件契约

### 当前数据流

```text
session JSONL assistant usage
  -> lib/usage-stats.ts collectUsageRecords()
  -> /api/usage 或 /api/usage?sessionId=...
  -> hooks/useAgentSession.ts sessionUsageRollup
  -> ChatWindow onSessionStatsChange
  -> AppShell topbar chip / tooltip
```

### 推荐 contract

保留现有 `UsageSessionRollupResult`：

- `totals`：parent rollup totals（parent own + Studio children）。
- `ownTotals`：parent own totals。
- `studioChildTotals`：所有 child totals。
- `childSessions[]`：每个 child session 的 totals。
- `selectedSessionKind`：`parent | studio_child | standalone`。

若 child tab 要展示自身费用，可在 hook 中从 `childSessions.find(sessionId)` 取 selected child totals；如果希望更稳，可在 `lib/usage-stats.ts` additive 增加：

```ts
selectedSessionTotals?: UsageTotals;
parentRollupTotals?: UsageTotals;
```

新增字段必须 additive，不能破坏现有 Usage 弹窗和 API 调用方。

## 兼容性

- API response 只 additive 增字段或不变；旧调用方继续可用。
- 不迁移 JSONL；不修改 session header。
- `includeArchived` 与 child rollup 行为保持现状。
- 仍不统计 `.ypi/.runtime/studio-subagents/*.jsonl` transcript sidecar 或 CLI no-session fallback。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 用户误解 parent/child 费用口径 | compact 文案替换 `+child`；tooltip 明确 scope 与拆分。 |
| child session 切换 topbar 不刷新 | `ChatWindow` statsKey 加入 `selectedSessionKind`、`parentFound`、own/child token totals 或 display scope。 |
| 统计链路被 UI 文案误判为未汇总 | 增加 rollup fixture 验证或手工 API 验证。 |
| 误把 child 数量当 child usage | `hasChildUsage` 改为 child token total 或 child cost > 0。 |
| 改动扩大为 UI 重构 | 限定为现有 chip/tooltip 文案与 hook 数据映射，不改布局。 |

## 回滚

- 若 UI 文案改动有争议，可回退 `AppShell` chip 文案到仅显示总费用，保留 tooltip 拆分。
- 若 child tab 自身费用口径有争议，可保留 API parent rollup，只在 tooltip 标注 `parent rollup`，不改数据层。
