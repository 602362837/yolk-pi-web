# Design — Usage 纳入 Studio child sessions 并按 parent session 归并

## 方案摘要

在 `lib/usage-stats.ts` 建立统一 usage 聚合模型：扫描普通 Pi sessions 与带 `studioChild` header 的 YPI Studio child sessions，仍只读取 session JSONL 中 assistant message 的 `usage` 字段。全局 `/api/usage` 返回原 totals/byDay/byModel/byProvider/bySession，同时新增 Studio child 计数和 `byParentSession`。Chat 顶部通过 `/api/usage?sessionId=<id>` 获取当前 parent + child rollup，避免把 child transcript/messages 注入父聊天上下文。

## 影响模块和边界

| 模块 | 改动 | 边界 |
| --- | --- | --- |
| `lib/session-reader.ts` | active/archived list 支持显式 `includeStudioChildren`；归档 session 解析 `studioChild` metadata | 不改变默认普通 session 列表隐藏 child 的行为 |
| `lib/usage-stats.ts` | 扫描 child sessions；新增 parent rollup 和 session rollup helper/types | 不改变 usage 来源，仍使用 JSONL assistant `usage` |
| `app/api/usage/route.ts` | 聚合模式返回扩展字段；`sessionId` 模式返回当前 session rollup | 不新增父聊天上下文内容 |
| `hooks/useAgentSession.ts` | 后台获取 session rollup，合并到顶部 stats 输出 | API 失败回退本地 messages 累加 |
| `components/ChatWindow.tsx` / `AppShell.tsx` | 扩展 stats 类型和 tooltip 展示 child scope | 不展示 child transcript 明细 |
| `components/UsageStatsModal.tsx` | 说明包含 child；展示 child counts / parent rollup | 旧响应 fallback `bySession` |
| `docs/*` | 更新 API/frontend/library/architecture 契约 | AGENTS.md 无需更新，除非新增顶级导航 |

## 数据结构方案

### 扩展 `UsageSessionSummary`

保留现有字段并增加可选字段，旧 UI 不受影响：

```ts
export type UsageSessionKind = "root" | "studio_child";

export interface UsageSessionSummary {
  sessionId: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  totals: UsageTotals;
  kind?: UsageSessionKind;
  parentSessionId?: string;
  studioChild?: {
    taskId: string;
    runId: string;
    member: string;
    subtaskId?: string;
    status?: string;
  };
}
```

### 新增 parent rollup

```ts
export interface UsageParentSessionSummary {
  parentSessionId: string;
  parentFound: boolean;
  cwd: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  totals: UsageTotals;
  ownTotals: UsageTotals;
  studioChildTotals: UsageTotals;
  studioChildSessionCount: number;
  sessionIds: string[];
  studioChildSessionIds: string[];
}
```

归并规则：

- 普通 session 的 parent key 是自身 `session.id`。
- Studio child session 的 parent key 是 `session.studioChild.parentSessionId`。
- 若 child 的 parent 未在扫描范围内（例如 parent archived excluded/deleted），仍创建 `parentFound=false` 的 row；展示字段从 child 兜底。
- `totals = ownTotals + studioChildTotals`。

### 扩展 `UsageStatsResult`

```ts
export interface UsageStatsResult {
  // existing fields...
  scope: {
    cwd?: string;
    timezone: string;
    includeArchived: boolean;
    includeStudioChildren: true;
  };
  byParentSession: UsageParentSessionSummary[];
  scannedStudioChildSessions: number;
  matchedStudioChildSessions: number;
}
```

### 新增 session rollup result

用于 Chat 顶部，不返回 transcripts/messages：

```ts
export interface UsageSessionRollupResult {
  kind: "session_rollup";
  sessionId: string;
  parentSessionId: string;
  selectedSessionKind: "parent" | "studio_child" | "standalone";
  parentFound: boolean;
  scope: {
    timezone: string;
    includeArchived: boolean;
    includeStudioChildren: true;
    relation: "self-and-studio-children";
  };
  totals: UsageTotals;
  ownTotals: UsageTotals;
  studioChildTotals: UsageTotals;
  studioChildSessionCount: number;
  childSessions: UsageSessionSummary[];
  scannedSessions: number;
  matchedSessions: number;
  skippedEntries: number;
}
```

`GET /api/usage?sessionId=<id>`：

- 默认不套用近 7 天范围，返回 session lifetime rollup。
- 可选支持 `from/to` 复用日期过滤，便于调试；Chat 顶部不传日期。
- 若 session 不存在，返回 404。

## 数据流

### 全局 Usage Modal

1. `UsageStatsModal` 请求 `/api/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&cwd=...`。
2. route 读取 `pi-web.json` 的 `usage.includeArchived`。
3. `getUsageStats({ includeArchived, includeStudioChildren: true })`：
   - active: `listAllSessions({ includeStudioChildren: true })`；
   - archived: `listAllArchivedSessions({ includeStudioChildren: true })`；
   - 按 cwd/date 过滤；
   - 打开匹配 session JSONL，累加 assistant `usage`；
   - 输出 bySession 与 byParentSession。
4. Modal 优先展示 `byParentSession`。

### Chat 顶部当前会话

1. `useAgentSession` 获得 `effectiveSessionId`。
2. 前端后台请求 `/api/usage?sessionId=<effectiveSessionId>`。
3. route 调 `getUsageStatsForSessionRollup({ sessionId, includeArchived })`：
   - 扫描 active + 可选 archived session headers（包含 child）；
   - 若选中 session 是 child，则先解析到 `studioChild.parentSessionId`；
   - 只打开 parent 和关联 child session JSONL 累加 usage；
   - 返回 totals/own/child/chilSessionCount。
4. hook 输出顶部 stats：API rollup 成功则用 rollup totals；失败/加载中用当前 `messages` 本地 totals。
5. `AppShell` tooltip 展示 own/child 拆分。

## API 契约

### `GET /api/usage`

保持现有请求：

- `from=YYYY-MM-DD` 可选，默认近 7 天。
- `to=YYYY-MM-DD` 可选，默认今天。
- `cwd=<path>` 可选。

响应新增字段但保持旧字段：`scope.includeStudioChildren`、`byParentSession`、`scannedStudioChildSessions`、`matchedStudioChildSessions`。

### `GET /api/usage?sessionId=<id>`

新增轻量分支：

- `sessionId` 必填时进入 session rollup mode。
- `from/to` 可选；不传则 session lifetime。
- 返回 `UsageSessionRollupResult`。
- 400：日期格式非法；404：sessionId 不存在；500：非预期错误。

## 兼容性

- `bySession` 继续存在；新增字段为 additive。
- 普通 session 列表仍默认隐藏 Studio child audit sessions。
- 归档列表现有调用默认不包含 child，除非显式传 `includeStudioChildren`。
- 旧 session 没有 `studioChild` header 时视为普通 root session。
- CLI `--no-session` child run 无标准 usage，不计入本轮统计；这不会影响 SDK child sessions。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 顶部 API 频繁扫描 session headers | 大量历史 session 下性能下降 | session rollup helper 只打开 parent/child entries；前端仅当前会话低频刷新、abort 过期请求 |
| archived child metadata 当前未解析 | includeArchived 口径缺 child | 实现时扩展 `listArchivedSessions` 解析 `studioChild` |
| parent 缺失或不在扫描范围 | child usage 无处归并 | 输出 `parentFound=false` row，不丢 usage |
| child session 与 parent cwd 不一致 | cwd 过滤可能遗漏/误归并 | 全局按 session cwd 过滤保持现有口径；session rollup 按 parentSessionId 关联，不依赖 cwd |
| 顶部 stats API 失败 | 用户看到旧口径 | 保留本地 messages fallback，静默降级 |
| UI 误解 child 重复计费 | 用户困惑 | Modal 和 tooltip 明确“rolled up to parent”，bySession 与 byParentSession 分开 |

## 回滚方案

- 若 UI 回归：保留后端扩展，前端回退到本地 `messages` stats。
- 若 `/api/usage` 性能异常：临时关闭前端 session rollup fetch，保留 Modal 手动请求。
- 所有改动都是读取/展示层，不修改用户 session JSONL；回滚无需数据迁移。