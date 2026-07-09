# brief

## 背景

本任务接在已完成任务 `20260709-170836-重构项目切换弹窗操作收敛-右键卡片菜单与排序-星标机制` 之后。上一任务已经把项目切换弹窗升级为 project/space 分层浏览，并完成：

- project card 与所有 space row/card 的右键菜单；
- project/space 星标入口与视觉 `★` 标记；
- 非主空间拖动排序；
- `PiWebProjectSpaceRecord.sortOrder?: number`；
- `PATCH /api/projects/[projectId]/spaces` 批量重排非主空间；
- space 星标不影响空间排序。

本次新需求进一步明确：**项目列表也要支持拖动排序；项目与空间的星标都不再影响顺序，只作为视觉标记；排序由用户手动拖动决定。**

## 已读材料与代码证据

- `docs/modules/frontend.md`
  - `ProjectSpaceSwitchDialog`：当前左侧 project list 仍使用 `sortProjectsForSidebar()` 排序，仅 space row 支持 `⋮⋮` 拖动排序。
  - `SessionSidebar`：当前已有 `handleReorderSpaces()` 乐观更新 + `PATCH /api/projects/[projectId]/spaces` 回滚机制。
- `docs/modules/api.md`
  - 已有 `PATCH /api/projects/[projectId]/spaces` 用于 space 批量排序。
  - 尚无项目级批量排序 API。
- `docs/modules/library.md`
  - `PiWebProjectSpaceRecord.sortOrder?: number` 已存在；`PiWebProjectRecord` 尚无 `sortOrder`。
  - `activeProjectSpaces()` 已是 `main first -> sortOrder -> createdAt fallback`，明确 space `pinned` 不影响排序。
  - `sortProjectsForSidebar()` 仍是 `pinned-first -> lastOpenedAt/updatedAt -> name`。
- `lib/project-display.ts`
  - 当前项目排序代码仍包含：`if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;`。
  - 当前空间排序已不看 `pinned`。
- `lib/project-registry-types.ts`
  - `PiWebProjectSpaceRecord` 已有 `sortOrder?: number`。
  - `PiWebProjectRecord` 无 `sortOrder?: number`。
- `lib/project-registry.ts`
  - 已有 `computeNextSortOrder(project)` 与 `reorderProjectSpaces(projectId, orderedSpaceIds)`，但二者只服务于 spaces。
  - `registerProject()` 新建 project 时没有分配项目级排序字段。
- `components/ProjectSpaceSwitchDialog.tsx`
  - 左侧 project card 有星标按钮和右键菜单，但无 drag handle / draggable / drop 逻辑。
  - `sortedProjects` 与 opening default 都来自 `sortProjectsForSidebar(projects)`。
- `components/SessionSidebar.tsx`
  - `activeProjects = sortProjectsForSidebar(projects)`。
  - 元数据弹窗文案仍写着 `星标（星标项目优先排序）`，与新需求冲突。

## 当前现状

### 已满足 / 可复用

1. **空间手动排序已基本具备**
   - 非主空间可拖动排序。
   - 服务端已持久化 `space.sortOrder`。
   - 新 WorkTree space 默认通过 `computeNextSortOrder(project)` 追加到底部。
   - `activeProjectSpaces()` 已不让 space 星标影响排序。

2. **星标作为视觉标记已有 UI 基础**
   - project/space card 上已有 `★/☆`。
   - 右键菜单与顶部菜单均可星标/取消星标。
   - 数据层继续复用 `pinned: boolean`，不需要新增 star 字段。

3. **拖动排序交互和回滚模式可复用**
   - space 拖动排序已有 HTML5 drag/drop、乐观更新、API 失败回滚模式。
   - project 拖动排序可以复用相同交互模式和错误处理策略。

### 尚未满足

1. **项目排序仍受星标影响**
   - `sortProjectsForSidebar()` 仍把 `pinned` 项目排在前面。
   - 这与“项目星标不再影响顺序，只作为视觉标记”直接冲突。

2. **已确认的真实用户痛点：点击项目星标后列表立刻跳动**
   - 用户已明确反馈：弹窗左侧项目列表里，点击星标后项目会立即跳到第一个，导致页面跳来跳去。
   - 这说明当前行为不仅是“设计上不符合新需求”，还已经造成明显交互抖动与位置丢失问题。
   - 因此本任务不只是新增 project 拖动排序，也必须消除“点击星标触发自动重排”的现象。

3. **项目列表没有手动排序能力**
   - `PiWebProjectRecord` 无 `sortOrder`。
   - `/api/projects` 无批量 reorder API。
   - `ProjectSpaceSwitchDialog` 左侧 project card 无拖动排序。

4. **文案仍暗示星标影响排序**
   - 元数据弹窗对 project 的星标说明仍为“星标项目优先排序”。
   - 需要改为“仅用于标记，不影响项目顺序”或等价说明。

5. **项目创建 / 旧数据排序契约未定义**
   - 新项目需要明确默认追加到项目列表底部。
   - 旧项目缺失 `sortOrder` 时需要稳定 fallback 或一次性补齐策略。

## 目标行为

### 项目列表

- 左侧 project list 支持拖动排序。
- 项目星标只显示视觉 `★`，不改变项目顺序。
- 点击项目星标后，项目位置保持不变，不能再因为星标状态变化跳到顶部。
- 项目排序优先由用户拖动得到的项目级顺序决定。
- 新注册项目 / Git clone 注册项目默认追加到项目列表底部。
- 搜索过滤时可继续展示匹配项目；是否允许在过滤状态拖动排序需设计确认（建议过滤状态禁用拖动或只允许清空搜索后排序，避免“局部列表重排”歧义）。

### 空间列表

- 继续保留上一任务的空间拖动排序能力。
- 空间星标只显示视觉 `★`，不改变空间顺序。
- 非主空间顺序继续由 `space.sortOrder` 持久化。
- `main` 是否继续固定第一沿用上一任务决策：**建议继续固定第一**，除非主会话/用户明确要求主空间也可参与拖动。
- 新 WorkTree / 新发现 space 继续追加到非主空间底部。

### 星标语义

- 数据层继续复用 `pinned: boolean`，但用户可见文案统一为“星标”。
- project 与 space 星标均只作为识别/标记，不参与排序。
- 所有“星标优先排序 / 置顶 / pinned first”文案与文档需同步改掉。

## 范围（In Scope）

- `ProjectSpaceSwitchDialog` 左侧 project card 增加拖动排序交互。
- `SessionSidebar` 增加 project reorder 的乐观更新、API 调用、失败回滚。
- 新增项目级排序持久化字段与批量排序 API。
- 修改项目排序 helper，使 `pinned` 不再参与 project 排序。
- 修改项目注册逻辑，使新项目默认追加到底部。
- 修改项目星标交互，确保点击后不会触发项目列表重排。
- 更新星标相关 UI 文案、metadata dialog hint、模块文档/API 文档/library 文档。
- 保持已有 space 排序 API 与 space 星标不排序行为，并补充回归验证。

## 非范围（Out of Scope）

- 不改变 session JSONL、projectId/spaceId 归属、Project Registry 作为顶层项目来源的架构边界。
- 不改变 WorkTree archive/delete 后端安全流程。
- 不重做整个 Sidebar 会话树、文件树或项目注册模型。
- 不新增第二套 star 字段；继续复用 `pinned` 作为内部兼容字段。
- 不默认增加键盘可访问的 Move Up/Move Down 排序入口，除非 UI 设计或用户要求。

## Project / Space 排序契约变化

### 当前契约

- Project：`pinned first -> lastOpenedAt/updatedAt desc -> displayProjectName`。
- Space：`main first -> sortOrder asc -> createdAt/displayName fallback`，space `pinned` 不影响排序。

### 目标契约

- Project：`sortOrder asc -> legacy fallback`，project `pinned` 不影响排序。
- Space：继续 `main fixed first -> non-main sortOrder asc -> legacy fallback`，space `pinned` 不影响排序。
- `lastOpenedAt/updatedAt` 不再作为用户排序主规则；最多只作为旧数据缺少 `sortOrder` 的兼容 fallback。
- 星标仅作为视觉标记与筛选/识别潜在能力，不参与自动重排。

## 是否需要新增项目级 sortOrder / 批量排序 API

结论：**需要，推荐新增显式项目级 `sortOrder?: number` 与项目批量排序 API。**

推荐方案：

```ts
interface PiWebProjectRecord {
  // existing fields...
  sortOrder?: number;
}
```

语义：

- 数值越小越靠前。
- 新项目分配 `max(active project sortOrder) + 1024`，默认追加到底部。
- 旧项目缺少 `sortOrder` 时使用稳定 fallback；首次项目拖动后为所有 active projects 写入规整后的 `sortOrder`。
- `pinned` 保留为星标状态，但排序 helper 完全忽略。

推荐新增 API 二选一，需设计阶段定稿：

1. **`PATCH /api/projects`**
   - Body: `{ orderedProjectIds: string[] }`
   - 优点：语义直接，对顶层 project list 批量重排。
   - 注意：当前 `/api/projects` 已有 GET/POST，新增 PATCH 不破坏现有调用。

2. **`PATCH /api/projects/reorder`**
   - Body: `{ orderedProjectIds: string[] }`
   - 优点：避免让 `/api/projects` route 过载。
   - 缺点：新增 route 文件和文档入口。

建议采用 **`PATCH /api/projects`**，与 `PATCH /api/projects/[projectId]/spaces` 的批量重排模式形成层级对应。

建议校验规则：

- `orderedProjectIds` 必须是非空字符串数组。
- 只接受 active、非 archived 项目 id。
- unknown / archived / duplicate id 返回 400。
- 请求未包含但仍 active 的项目追加到末尾并保持既有相对顺序，降低并发刷新/旧客户端导致丢项目的风险。
- 返回 `{ projects }` 或 `{ projectIds, projects }`，客户端以服务端返回收敛。

## 风险与注意点

1. **UI prototype gate 已触发**
   - 本任务新增项目拖动排序，改变项目切换弹窗交互与用户可见排序规则。
   - 按 YPI Studio 规则，进入实现前必须由 UI 设计员产出 HTML 原型并经主会话/用户审批。

2. **排序迁移风险**
   - 旧项目没有 `sortOrder`，从“星标优先/最近打开”切换为“手动顺序”需要明确初始顺序。
   - 推荐初始 fallback 为当前展示顺序但移除 pinned 影响，或在迁移/首次读写时将当前 active 项目顺序固化；需要确认。

3. **搜索状态拖动歧义**
   - 在 filtered project list 中拖动，用户看到的是子集，重排到全量列表的位置可能不直观。
   - 建议搜索非空时隐藏/禁用拖动把手，并提示“清空搜索后拖动排序”。

4. **星标心智变化**
   - 之前 project 星标表示优先排序；现在变为纯视觉标记。
   - 需要同步所有文案、tooltip、metadata dialog hint、docs，避免用户误解。

5. **并发与多标签页**
   - 与 space reorder 一样，项目排序大概率采用 last-write-wins。
   - API 应返回最新 authoritative projects，客户端以返回结果覆盖本地状态。

6. **Project Registry 约束**
   - 仍必须以 `/api/projects` / registry 文件为项目列表来源，不能从 sessions 推导项目顺序。

## 待确认点

1. `main` space 是否继续固定第一？建议沿用上一任务：`main` 固定第一，只有非主空间可拖动。
2. 搜索过滤状态是否允许拖动项目？建议禁用，降低局部重排歧义。
3. 旧项目初始顺序如何确定？建议按“当前非星标排序 fallback（lastOpenedAt/updatedAt/name）”显示，首次拖动后固化；也可一次性补齐 `sortOrder`。
4. 项目批量排序 API 路径采用 `PATCH /api/projects` 还是 `PATCH /api/projects/reorder`？建议 `PATCH /api/projects`。
5. 是否需要新增 keyboard-accessible 排序入口（Move Up/Move Down）？建议本轮不做，作为后续无障碍增强。

## UI prototype gate

**触发。**

原因：本任务改变 `ProjectSpaceSwitchDialog` 的项目列表交互、拖动排序 affordance、星标说明与用户可见信息结构。实现前应指派 UI 设计员基于现有项目样式产出 HTML 原型，至少覆盖：

- project card 拖动把手、拖动态、drop 目标反馈；
- 搜索状态下拖动禁用/提示；
- project/space 星标作为纯视觉标记的说明文案；
- 与现有 space 拖动排序的一致性；
- 顶部菜单、右键菜单、星标按钮在新排序语义下的文案。

## 建议下一步

1. 主会话确认待确认点，特别是 `main` space 固定与项目 reorder API 路径。
2. 指派 UI 设计员输出 HTML 原型，并写入 `ui.md` / `.html`。
3. 用户审批原型与计划后，再进入 PRD / Design / Implement / Checks 完整规划与实现。