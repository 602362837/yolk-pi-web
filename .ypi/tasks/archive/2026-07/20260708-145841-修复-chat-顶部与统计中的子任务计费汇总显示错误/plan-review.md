# plan review

## 任务

修复 Chat 顶部与统计中的子任务计费汇总显示错误。

## 相关产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md)
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)

## 已确认实现口径

1. Studio child session 顶部费用 **只显示该 child 自身费用**。
2. 父 session 在存在真实 child usage 时，compact 文案使用 **`incl. Studio`**。
3. child session tooltip 可补充 parent rollup 说明，但 compact 不再显示 parent 汇总。

## PRD 摘要

- 修复 Chat 顶部费用 chip 中裸 `+child` 占位文案。
- 明确父 session、standalone session、Studio child audit session 的费用展示口径。
- 验证 Usage 统计链路真实汇总 Studio child session usage：global totals、`byParentSession`、`session_rollup` 三处一致。

验收重点：

1. 顶部不再出现裸 `+child`。
2. 只有 child 数量但无 child usage 时，不显示 child usage 标记。
3. 父 session 有 child usage 时，compact 文案明确表示已包含 Studio child，tooltip 拆分 own / child。
4. 打开 child session 时，顶部只显示该 child 自身费用，不再显示误导性的 parent/child 占位语义。
5. `/api/usage` 与 Usage 弹窗能证明 parent totals = own + child。

## UI 门禁

不触发 UI 设计员 HTML 原型门禁。

原因：本次限定为既有 topbar chip / tooltip 的错误文案、判定条件和 usage 口径修复，不改变页面结构、布局、交互、审批或确认体验。若后续决定新增费用详情展开面板或重做 Usage 弹窗信息结构，则需重新触发 UI prototype gate。

## Design 摘要

根因：

- `components/AppShell.tsx` 硬编码 `+child`。
- `hasChildUsage` 把 `childCount > 0` 当成 child usage。
- `?sessionId=<child>` 当前按文档解析为 parent rollup，但 topbar 没有说明 child-selected 语境。
- `components/ChatWindow.tsx` 的 `statsKey` 未包含 `selectedSessionKind` 等字段，未来依赖这些字段时可能切换不刷新。

设计：

- 父 session 顶部 chip 改为短而明确的文案，例如父 rollup `$0.03 incl. Studio`。
- child usage 判定改为 child token/cost totals > 0。
- child audit session compact 显示该 child 自身 usage，tooltip 可附带 parent rollup。
- Usage 聚合继续只读取 assistant message `usage`，不读 transcript sidecar，不估算 CLI no-session fallback。

## Implement 摘要

建议子任务：

1. `usage-contract`：确认 rollup 与 child-selected 展示口径。
2. `topbar-copy`：移除 `+child`，修正 child usage 判定与 tooltip 文案。
3. `hook-refresh`：调整 `SessionUsageTopbarStats` 映射与 `statsKey`。
4. `usage-validation`：验证或补测试覆盖 `byParentSession` / `session_rollup`。
5. `docs-checks`：同步 docs 并运行验证。

完整机器可读 implementation plan 见 [implement.md](implement.md)。

## Checks 摘要

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

手工验收：普通 session、parent with/without child usage、Studio child audit session、Usage 弹窗、`/api/usage` parent/child/cwd 三类 API 查询。

## 审批请求

若你认可上述口径与修复范围，请批准进入实现阶段。