# Design：Session 指标 Chips 与子 Session 上下文数据

## 方案摘要

将 `AppShell` 中内联的 Session stats 区块拆成小型展示组件（建议 `SessionStatsChips`），并把通用 hover/focus/click 浮层行为抽为可复用的 `TopbarMetricPopover`。费用与上下文成为独立 trigger。现有费用 totals 与口径保持原样；上下文浮窗复用 parent/selected Session 的 `contextUsage`，对 Studio children 增加可选、显式可用性的 context snapshot 投影。

## 影响模块与边界

| 模块 | 计划改动 | 边界 |
| --- | --- | --- |
| `components/AppShell.tsx` | 计算已确认的 compact 口径，渲染 chips，连接两个 popover | 不重做顶栏导航，不改 Session 生命周期 |
| 新建 `components/SessionStatsChips.tsx`（建议） | chips、费用浮窗、上下文浮窗、键盘/触屏行为 | 纯展示与轻交互；不自行扫描 Session |
| `hooks/useAgentSession.ts` | 透传 child summaries/context snapshots；维持 race/abort/refresh | local fallback 仍为 standalone |
| `lib/usage-stats.ts` / `/api/usage` | additive child context projection 或关联标识 | 旧字段语义不变，不返回内容体 |
| Studio child runtime（仅若采用准确遥测方案） | 提供 bounded context snapshot | 不把 transcript 注入父会话，不高频写 task.json |
| `app/globals.css` | scoped chips/popover/动画/响应式样式 | reduced-motion 必须静态降级 |
| 文档 | 更新 frontend；API 变化时更新 api/architecture | 不改 AGENTS 顶层索引，除非新增主要模块/路由 |

## 现有数据与缺口

### 已有

- 当前选中 Session context：`ChatWindow -> onContextUsageChange -> AppShell`，字段 `{ percent, contextWindow, tokens }`，来自 live `AgentSession.getContextUsage()`。
- Session usage rollup：`UsageSessionRollupResult` 已包含 `selectedSessionKind`、own/children/parent totals 和 `childSessions[]`。
- 费用 compact 口径已在 `AppShell`、`useAgentSession`、`usage-stats` 注释和文档中确认。

### 缺口

- `SessionUsageTopbarStats` 当前未透传 `childSessions[]`。
- `childSessions[]` 只有 lifetime usage、child metadata，不包含“当前上下文占用”。
- Studio child 的 progress `tokens/tps` 不是 context occupancy；不能用于百分比。
- completed/archived child 未必有活跃 AgentSession，必须允许 snapshot unavailable。

## 推荐数据契约

新增 additive 类型，名称可在实现时按现有类型体系调整：

```ts
type SessionContextUsageSnapshot = {
  percent: number | null;
  contextWindow: number | null;
  tokens: number | null;
  availability: "available" | "unknown" | "unavailable";
  source: "live" | "persisted";
  capturedAt?: string;
};

type SessionUsageChildTopbarSummary = {
  sessionId: string;
  member?: string;
  subtaskId?: string;
  status?: string;
  totals: UsageTotals;
  contextUsage?: SessionContextUsageSnapshot;
};
```

`SessionUsageTopbarStats` 增加可选 `childSessions?: SessionUsageChildTopbarSummary[]`。所有字段 additive，旧调用方不受影响。

### Snapshot 来源优先级

1. child 仍活跃：Studio SDK child AgentSession 的权威 `getContextUsage()`，经 bounded runtime projection 暴露。
2. child 已结束且存在最后一次明确 snapshot：返回 `source: persisted`（只能持久化数值、window、时间、状态，不持久化内容）。
3. 无可靠来源：`availability: unavailable`，UI 显示“暂无上下文数据”；可显示明确标注的 lifetime tokens/cost 次要信息。

实现前应先做一个聚焦 spike，确认 child runner 能否直接读取并安全投影 `getContextUsage()`。若不能，不得自行用累计 usage 估算；退回 unavailable 降级，并由用户决定是否接受 MVP。

### API 形态

优先保持现有 `GET /api/usage?sessionId=`，给其 `childSessions[]` additive 增加可选 `contextUsage`，避免新增一次顶栏请求。若这会使 usage 模块耦合 Studio runtime 过深，则改为独立轻量 `GET /api/sessions/[id]/context-usage?includeStudioChildren=1`；二选一由实现 spike 依据依赖方向决定，禁止同时实现两套。

响应只能包含 ids、member/subtask/status、数字 snapshot 和 capture metadata；禁止消息、prompt、output、tool result、artifact 或本机路径。

## UI 数据流

```text
GET /api/usage?sessionId
  -> useAgentSession sessionUsageRollup
  -> SessionUsageTopbarStats (compact totals + child summaries)
Agent state/SSE contextUsage
  -> ChatWindow
  -> AppShell selected contextUsage
AppShell
  -> SessionStatsChips
     -> Billing popover (existing totals semantics)
     -> Context popover (selected context + child snapshots)
```

切换 Session 时沿用现有 sessionId key、AbortController 与 stale-response 防护。child snapshot 刷新跟随现有低频 rollup refresh/agent-end，不新增高频全局轮询。

## 组件与交互

- `TopbarMetricPopover` 使用 button trigger，支持 pointer enter/leave、focus、click；延迟关闭避免 trigger→popover 闪退。
- 同一组内最多一个 popover 打开；Escape、外部点击、焦点离开关闭并恢复/保持合理焦点。
- popover 采用 fixed/portal 或经过 viewport clamp 的定位，避免顶栏 `overflow-x` 截断；不得继续依赖容易被父容器裁剪的裸 absolute。
- 当前 Session 摘要必须始终第一；children 风险优先排序仅为展示，不改变数据。
- unknown 与 0% 不等价；contextWindow 不知时不计算百分比。

## 响应式与可访问性

- 不增加 `.app-top-bar` 高度。
- 桌面完整 chips；中等宽度按原型隐藏 cache 等低优先级项。
- `≤640px` 当前 CSS 隐藏 `.app-top-stats`；是否改为关键 chip 入口必须由原型审批。
- trigger 使用 `aria-expanded`、`aria-controls`、可读 `aria-label`；浮窗使用非模态 dialog/tooltip 语义中与交互匹配的一种，含可聚焦内容时应采用 dialog。
- 百分比/状态文本与颜色并存；对比度满足现有主题可读性。
- reduced-motion 禁用 pulse/shimmer，只保留静态边框/颜色。

## 兼容性与迁移

- 所有 wire 字段 additive；旧 Session、无 child、无 snapshot 均自然降级。
- 不改 JSONL header，不迁移历史 Session。
- 如引入 snapshot 持久化，必须使用独立 bounded sidecar 或既有安全运行元数据，原子写入、无内容字段，并明确清理策略；未经进一步审查不写入 task 高频进度。
- 计费 totals、`selectedSessionKind` 与 compact marker 语义不变。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 将 child lifetime usage 误当 context | 类型区分 snapshot 与 totals；unavailable 明示 |
| usage 模块耦合 Studio runtime | 先 spike；依赖过深时改独立只读 endpoint |
| popover 被顶栏 overflow 裁剪 | portal/fixed + viewport clamp |
| 多 child 导致巨大浮窗 | bounded rows、max-height、内部滚动 |
| 动画干扰/耗电 | 低频有限动画；reduced-motion 禁用 |
| 费用口径回归 | 保留现有计算函数/注释，针对三类 Session 验收 |
| stale child 数据 | capturedAt/availability；沿用 session keyed race guards |

## 回滚

- UI 回滚到现有 `AppShell` stats spans 与 `BillingPopover`。
- additive API/type 字段可停止生产而不影响旧调用方。
- 如新增 sidecar，回滚代码后文件可安全留存或由明确清理脚本删除；不得修改 JSONL 进行回滚。
