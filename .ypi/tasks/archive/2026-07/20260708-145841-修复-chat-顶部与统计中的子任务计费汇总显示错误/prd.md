# prd

## 目标与背景

YPI Studio 子任务会生成带 `studioChild` header 的 child session。系统预期：父会话费用统计可包含这些 child session 的 usage，同时不把 child transcript 注入父聊天内容。当前 Chat 顶部 compact 费用展示用 `+child` 表示 child usage，文案像占位符，且 child session 视图也复用同样 rollup 展示，导致用户质疑统计是否真正汇总。

## 范围内

- Chat 顶部 usage/cost chip 的 Studio child 文案与判定修复。
- 父 session / standalone session / Studio child audit session 的顶部费用展示口径澄清。
- `/api/usage` 与 `lib/usage-stats.ts` 的父子汇总链路验证；必要时补充轻量回归测试或脚本。
- 相关文档同步：API、Frontend、Library、Architecture 中 usage/topbar 口径如发生变化需更新。

## 范围外

- 不改变 Studio child session JSONL 格式。
- 不把 child transcript、prompt、artifact 内容并入父聊天上下文。
- 不统计 CLI `--no-session` fallback transcript 的估算费用（现有架构明确不估算）。
- 不重做 Usage 弹窗布局或新增费用详情交互面板。
- 不改 Provider usage 采集来源；仍只读取 assistant message `usage` 字段。

## 需求与验收标准

### R1 顶部费用文案不再显示占位式 `+child`

- 父会话存在实际 Studio child usage 时，顶部费用 chip 不得显示裸 `+child`。
- 推荐文案：compact chip 显示总费用，并追加短说明如 `incl. Studio`；tooltip 保留 own / Studio children cost 拆分。
- 当 child session 存在但没有实际 usage（child cost 和 child token 均为 0）时，不应仅因 child 数量给费用 chip 添加 child 标记。

验收：构造父会话 own cost > 0、child session 数量 > 0 但 child usage = 0 时，费用显示没有 child 标记；child usage > 0 时显示明确“已包含 Studio”的文案而不是 `+child`。

### R2 子 session 顶部费用口径清晰

- 打开 Studio child audit session 时，不应显示让人误解的“当前 child + child”的文案。
- 推荐口径：child tab 的 compact 费用显示该 child session 自身 usage；tooltip 可补充父 rollup 总额与 parent id。
- 若实现保留现有“child tab 显示父 rollup”架构，必须在 tooltip 与 compact 文案中明确为 `parent rollup`，避免继续显示 `+child`。

验收：打开 child session 后，顶部文案能区分这是 Studio child 或 parent rollup，不再出现 `+child`。

### R3 Usage 统计聚合真实包含 Studio child

- `/api/usage` 全局/按 cwd 查询继续扫描 `includeStudioChildren: true`。
- `bySession` 保留单个 JSONL session 维度；child row 标记 `kind: "studio_child"` 和 `parentSessionId`。
- `byParentSession` 中父会话 totals = ownTotals + studioChildTotals；孤儿 child 不丢失，`parentFound=false`。
- `/api/usage?sessionId=<parent>` 返回 parent + children 的 rollup。
- `/api/usage?sessionId=<child>` 返回结果必须满足 R2 约定，并保留足够字段供 UI 展示/验证。

验收：用至少一个父 session + 一个 child session 的 fixture 或真实样本验证 global totals、byParentSession、session_rollup 三处 totals 一致。

## 未决问题 / 需主会话确认

1. Child audit session 顶部 compact 费用最终口径：
   - 推荐：显示该 child 自身费用；tooltip 附带 parent rollup。
   - 备选：显示 parent rollup，但 compact/tooltip 必须标明 `parent rollup`。
2. Compact 英文文案是否采用 `incl. Studio`。如果需要中文文案，建议统一为“含 Studio”。当前顶部 UI 多为英文短标签，推荐沿用英文。
