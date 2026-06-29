# Session Archive — 设计文档

## 目标

为 pi-web 增加 session 归档功能：将不再活跃的会话从主列表中移除，但保留文件供日后查看。

归档方式：将 session JSONL 文件从 `~/.pi/agent/sessions/<cwd>/` 移动到 `~/.pi/agent/sessions-archive/<cwd>/`（镜像目录结构）。

## 核心问题

### 问题 1：项目可见性

当前的项目列表（CWD picker）由 `getRecentCwds()` 从 session 列表中提取——它只统计有 session 的 cwd。如果一个项目的所有 session 都被归档了，该项目就会从选择器中消失。

**解决方案：** 在 `listAllSessions()` 返回结果中附带一个额外字段 `archivedCwds: string[]`，列出所有存在归档 session 但没有活跃 session 的 cwd。前端 `getRecentCwds()` 合并这些 cwd（以最低优先级追加，或放到末尾），确保项目仍然可选。

### 问题 2：归档 session 的查看

归档后的 session 不在主列表中，但用户需要能看到它们。

**解决方案：** 当某个 cwd 被选中时，如果该 cwd 有归档 session，在 session 列表底部显示一个"已归档（N）"折叠区域，点击展开可查看归档 session，支持取消归档（恢复到主列表）。

## 架构设计

### 存储结构

```
~/.pi/agent/
├── sessions/                          # 活跃 sessions（现有）
│   └── --path-to-project--/
│       ├── 2026-06-24T..._uuid1.jsonl
│       └── 2026-06-25T..._uuid2.jsonl
└── sessions-archive/                  # 归档 sessions（新增）
    └── --path-to-project--/
        └── 2026-06-20T..._uuid3.jsonl
```

归档操作 = `rename()` 把文件从 `sessions/<cwd>/` 移到 `sessions-archive/<cwd>/`（相同文件名）。  
取消归档 = 反向 `rename()`。

### API 设计

#### `POST /api/sessions/archive`

归档一个或多个 session。

```typescript
// 请求
{ sessionIds: string[] }

// 响应
{ 
  archived: Array<{ id: string; path: string }>;
  errors: Array<{ id: string; error: string }>;
}
```

逻辑：
1. 对每个 sessionId，通过 `resolveSessionPath()` 找到文件路径
2. 如果该 session 有活跃的 RPC session（`getRpcSession(id)?.isAlive()`），先 destroy 它
3. 计算目标路径：把 `sessions/` 替换为 `sessions-archive/`
4. `mkdirSync` 目标目录，`renameSync` 移动文件
5. 清除 session path cache
6. 级联处理：将引用该 session 作为 `parentSession` 的子 session 的 `parentSession` 路径也更新到新位置

#### `POST /api/sessions/unarchive`

取消归档一个或多个 session。

```typescript
// 请求
{ sessionIds: string[] }

// 响应
{
  unarchived: Array<{ id: string; path: string }>;
  errors: Array<{ id: string; error: string }>;
}
```

逻辑：反向操作，把文件从 `sessions-archive/` 移回 `sessions/`。

#### `POST /api/sessions/archive-all`

一键归档某个 cwd 下的所有 session。

```typescript
// 请求
{ cwd: string }

// 响应
{
  archived: Array<{ id: string; path: string }>;
  errors: Array<{ id: string; error: string }>;
}
```

逻辑：列出该 cwd 下所有活跃 session，逐个归档。

#### `GET /api/sessions` 扩展

在现有响应中增加归档信息：

```typescript
// 现有响应
{ sessions: SessionInfo[] }

// 扩展响应
{
  sessions: SessionInfo[];           // 仍然只包含活跃 sessions
  archivedCwds: string[];            // 有归档 session 的 cwd 列表
  archivedCounts: Record<string, number>;  // 每个 cwd 的归档 session 计数
}
```

#### `GET /api/sessions/archived?cwd=...`

列出某个 cwd 下的归档 session。

```typescript
// 响应
{ sessions: SessionInfo[] }
```

#### `GET /api/sessions/[id]` 扩展

读取 session 详情时，如果在活跃目录找不到，自动到归档目录查找。归档 session 可正常查看但不能发送新消息。

### lib 层改动

#### `lib/session-reader.ts` 新增函数

```typescript
// 获取归档目录路径
export function getSessionsArchiveDir(): string;

// 列出归档 sessions
export function listArchivedSessions(cwd?: string): Promise<SessionInfo[]>;

// 扫描所有有归档 session 的 cwd
export function getArchivedCwds(): Promise<{ cwds: string[]; counts: Record<string, number> }>;

// 归档 session
export function archiveSession(sessionId: string): Promise<{ id: string; newPath: string }>;

// 取消归档
export function unarchiveSession(sessionId: string): Promise<{ id: string; newPath: string }>;

// 批量归档某 cwd 下所有 session
export function archiveAllSessionsForCwd(cwd: string): Promise<Array<{ id: string; newPath: string }>>;
```

#### `resolveSessionPath()` 扩展

查找 session 文件时，先查活跃目录，miss 后查归档目录。缓存中标记来源。

### 前端改动

#### `lib/types.ts`

`SessionInfo` 新增可选字段：

```typescript
export interface SessionInfo {
  // ... 现有字段
  archived?: boolean;  // 归档 session 标记
}
```

#### `SessionSidebar.tsx`

1. **session 列表**：
   - 活跃 sessions 保持现有渲染方式
   - 在列表底部增加「已归档 (N)」折叠区域
   - 折叠区域点击展开时调用 `GET /api/sessions/archived?cwd=...` 加载归档列表
   - 归档 session 用淡色/斜体样式区分

2. **单 session 操作**（hover 显示按钮）：
   - 在现有 Rename / Delete 旁增加 Archive 按钮（📦 图标）
   - 归档后 session 从活跃列表消失（前端 optimistic update + 重新加载）

3. **批量操作 UI**：
   - 在 session 列表区域顶部增加一个「⋯」按钮或右键菜单
   - 菜单项：
     - 「归档所有会话」— 一键归档当前 cwd 下所有 session
     - 「选择归档…」— 进入多选模式，勾选后确认归档
   - 多选模式下每个 session 前显示 checkbox
   - 底部出现操作栏：「归档 N 个会话」按钮 + 取消

4. **归档 session 的操作**：
   - 取消归档（恢复到活跃列表）
   - 查看（只读打开）
   - 删除

5. **项目选择器（CWD picker）**：
   - `getRecentCwds()` 函数需要接收 `archivedCwds` 参数
   - 有归档 session 但无活跃 session 的 cwd 追加到列表末尾
   - 这些 cwd 在选择器中用淡色显示，标注「已归档」

#### `SessionItem` 组件

增加归档按钮：

```
hover 时显示: [✏️ Rename] [📦 Archive] [🗑 Delete]
```

归档按钮点击后 optimistic 移除，无需二次确认（归档不是破坏性操作，可随时取消）。

#### `hooks/useAgentSession.ts`

- 当加载的 session 是归档状态时，禁用消息发送（`canSend = false`）
- 显示提示条：「此会话已归档。取消归档以继续对话。」

### 全流程

#### 单 session 归档

```
用户 hover session → 点击 📦 → 
  前端 optimistic 移除 → POST /api/sessions/archive { sessionIds: ["xxx"] } →
  如果当前查看的就是这个 session，显示"已归档"提示 →
  刷新归档计数
```

#### 批量归档

```
用户点击 ⋯ → 选择"选择归档…" → 
  session 列表进入多选模式 → 用户勾选 → 点击"归档 N 个会话" →
  POST /api/sessions/archive { sessionIds: [...] } →
  刷新列表
```

#### 一键归档

```
用户点击 ⋯ → 选择"归档所有会话" → 
  确认对话框 "确认归档 <cwd> 下的 N 个会话？" → 确认 →
  POST /api/sessions/archive-all { cwd: "..." } →
  刷新列表（此时列表为空，但 cwd picker 仍显示该项目）
```

#### 取消归档

```
用户展开"已归档 (N)"区域 → hover 某 session → 点击恢复按钮 →
  POST /api/sessions/unarchive { sessionIds: ["xxx"] } →
  session 回到活跃列表 → 刷新归档计数
```

## 边界情况

| 场景 | 处理方式 |
|------|----------|
| 归档一个有子 session（fork）的 session | 只归档目标 session，子 session 保持活跃，parentSession 链保持不变。展示时子 session 变成根节点。 |
| 归档一个正在活跃使用的 session | 先 destroy RPC session，再移动文件。前端当前聊天窗口显示"已归档"提示。 |
| 取消归档时原目录下有同名文件 | 理论上不可能（UUID 文件名），但仍做 existsSync 检查并报错。 |
| 归档目录被手动删除 | `listArchivedSessions()` 返回空数组，不报错。 |
| 归档 session 对应的 cwd 已不存在（如 worktree 已删除） | 正常归档。归档区域中显示但用灰色标注路径已失效。 |
| 大量 session（数百个）的批量归档 | 服务端顺序处理（rename 很快），前端显示进度或 busy 状态。 |

## 安全性

- 归档操作是可逆的（取消归档即可恢复），不需要 `trash` CLI
- 不修改 session JSONL 文件内容，只移动文件位置
- `parentSession` 路径在归档时更新（避免悬挂引用），取消归档时还原

## 实现顺序

1. **Phase 1 — 后端核心**
   - `lib/session-reader.ts`：新增归档/取消归档函数、归档目录扫描
   - `resolveSessionPath()` 扩展到归档目录
   - API routes: `archive`, `unarchive`, `archive-all`, `archived`
   - `GET /api/sessions` 扩展返回 archivedCwds/archivedCounts

2. **Phase 2 — 前端单 session 归档**
   - `SessionItem` 增加归档按钮
   - 归档 session 列表（折叠区域）
   - 归档 session 只读查看

3. **Phase 3 — 批量和一键归档**
   - 多选模式 UI
   - 一键归档确认流程
   - CWD picker 中显示纯归档项目

4. **Phase 4 — 取消归档**
   - 归档 session 列表中的恢复操作
   - 归档 session 的删除操作
