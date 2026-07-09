# brief

## 背景

上一任务 `20260709-161121-重构左侧项目切换为弹窗分层选择并优化多项目显示` 已把 Sidebar 顶部项目切换从内嵌 dropdown 改成 `ProjectSpaceSwitchDialog` 分层弹窗。当前弹窗已支持：项目搜索、项目/空间分层浏览、添加项目、WorkTree 右键归档/删除、项目/空间 pinned 排序与 badge 展示。

本任务标题聚焦于三件事的二次收敛：

1. **操作收敛**：把当前分散在 Sidebar 顶部 workspace 菜单、弹窗 WorkTree 右键、元数据弹窗里的项目/空间操作重新整理到更直观的位置。
2. **右键卡片菜单**：让弹窗内 project/space card 本身成为主要操作入口，而不是只靠顶部当前选中 workspace 的三点菜单。
3. **排序 / 星标机制**：明确 pinned 的产品语义、展示方式和排序规则，避免“有置顶但不直观、排序规则不透明”的状态。

## 已读材料与代码证据

- `AGENTS.md`：Project Registry 是项目列表唯一顶层来源；前端改动前需读模块文档；最小验证为 `npm run lint` + `node_modules/.bin/tsc --noEmit`。
- `docs/modules/frontend.md`
  - `components/SessionSidebar.tsx`：当前 Sidebar 顶部保留“项目空间切换按钮” + 单独 workspace actions 菜单。
  - `components/ProjectSpaceSwitchDialog.tsx`：当前弹窗负责项目/空间浏览、搜索、添加项目、WorkTree 右键入口。
- `lib/project-display.ts`
  - `sortProjectsForSidebar()`：项目排序为 `pinned first -> lastOpenedAt/updatedAt desc -> name`。
  - `activeProjectSpaces()`：空间排序为 `main first -> pinned first -> displayName`。
- `lib/project-registry-types.ts`：project 与 space 都已有 `pinned: boolean` 字段，不需要新增数据结构即可承载“星标/置顶”语义。
- `components/SessionSidebar.tsx`
  - 顶部 workspace 三点菜单当前包含：编辑项目元数据、编辑空间元数据、置顶/取消置顶项目、置顶/取消置顶空间、归档所有会话、归档当前空间、归档项目。
  - 当前选中按钮和 WorkTree 行支持右键，但普通 project card / main space card 没有统一右键操作体系。
- `components/ProjectSpaceSwitchDialog.tsx`
  - 左侧 project card 目前只展示 pinned 的 `★` badge；点击仅切换 pending project。
  - 右侧 space list 目前可选择空间；只有 WorkTree row 透传右键菜单。

## 当前现状

### 已有能力

- 项目切换已迁移到 viewport 级弹窗。
- 项目与空间都支持 `pinned` 元数据，并已参与排序。
- 右键菜单只覆盖 WorkTree archive/delete；普通项目卡片/主空间卡片没有统一的上下文操作入口。
- Sidebar 顶部还有一个与弹窗并存的 workspace actions 菜单，导致操作入口分散。

### 当前问题

1. **操作入口分散**
   - 一部分操作在顶部三点菜单。
   - 一部分操作只在 WorkTree 右键里。
   - 一部分操作要进“编辑元数据”弹窗才能触达。
   - 用户需要先切到目标 project/space，才能从顶部菜单对其做操作，不够直接。

2. **项目卡片缺少就地操作**
   - 左侧 project card 已有列表感和 badge，但没有上下文菜单，无法在浏览时直接星标、编辑、归档。
   - 右侧非 WorkTree space card 也缺少对称的上下文菜单。

3. **排序语义不够显式**
   - 代码里是 `pinned`，UI 文案里有时叫“置顶”，任务标题又提到“星标机制”。
   - 当前星标/置顶对排序的影响虽已存在，但用户不容易理解规则，也缺少就地切换入口。

4. **空间排序能力不足**
   - 当前空间列表排序是 `main first -> pinned first -> name`，不支持用户手动排序。
   - 用户已明确希望：主空间永远第一，其余空间按用户拖动顺序排列，静默新增/新打开的空间默认追加到底部，而不是自动插到前面。

## 用户已确认的产品决策

1. **右键范围**：`project card` 与 **所有** `space row/card`（包括 main/worktree）都需要支持右键菜单。
2. **顶部三点菜单**：**需要保留**，但应与弹窗内右键菜单重新分工，避免重复和割裂。
3. **星标语义**：可以直接复用现有 `pinned` 字段；UI/产品文案统一为“星标”是可接受的。
4. **空间排序**：
   - 主空间永远第一。
   - 其他空间按用户拖动顺序排列。
   - 静默新打开/新加入的空间默认放在后面，不要自动抢到前面。

## 本任务的目标理解（更新版）

### 目标 1：把项目空间相关操作收敛到弹窗卡片上下文中

- 在弹窗内对 **project card** 与 **所有 space row/card** 提供统一右键上下文菜单。
- WorkTree 的 archive/delete 继续保留，但入口融入统一 card context menu 体系。
- 顶部 workspace 三点菜单保留，承担“当前选中工作区的快捷/全局操作”；弹窗右键菜单承担“浏览态下对任意项目/空间的就地操作”。

### 目标 2：把 pinned 统一包装成更直观的“星标”机制

- 数据层继续复用现有 `pinned: boolean`，不新增 schema。
- project 与 space 都支持星标/取消星标。
- 卡片/行上显示明确星标态，并通过上下文菜单快捷切换。
- project 列表排序继续受星标影响；space 列表中星标更多承担“标记/快速识别”作用，不能破坏“主空间固定第一 + 其余按用户自定义顺序”的主规则。

### 目标 3：明确并实现新的空间排序模型

- **项目列表**：首版仍按“星标优先 + 最近打开时间 + 名称”理解，待设计阶段确认是否需要拖动排序项目本身。
- **空间列表**：
  - `main` 固定第一。
  - 非主空间支持拖动排序。
  - 新出现的非主空间静默追加到底部。
  - 不能因为最近打开、星标或刷新同步就打乱用户手工顺序。

> 这意味着现有仅依赖 `pinned/lastOpenedAt/name` 的空间排序逻辑不足，后续设计/实现大概率需要新增可持久化的空间顺序字段或等价机制。

## 范围（in scope）

- `components/ProjectSpaceSwitchDialog.tsx` 中 project/space 项的右键菜单与上下文操作交互重构。
- `components/SessionSidebar.tsx` 顶部 workspace actions 与弹窗右键菜单的职责收敛。
- project / space 的星标状态展示与切换入口优化。
- space 自定义拖动排序的交互与持久化方案设计。
- 如有必要，补充 project/space card 的 hover 态、active 态、右键态、拖动态、禁用态。

## 非范围（out of scope）

- 不改变 session JSONL、project-space link、WorkTree 后端 archive/delete 语义。
- 不在本任务中重做整个 Sidebar 会话列表、文件树或 Project Registry 基础模型。
- 不默认扩大到“项目列表也支持拖动排序”，除非设计阶段另有明确需求。

## 涉及模块

- `components/ProjectSpaceSwitchDialog.tsx`
- `components/SessionSidebar.tsx`
- `lib/project-display.ts`
- `lib/project-registry-types.ts`
- `lib/project-registry.ts`
- 可能涉及：`app/api/projects/[id]/route.ts`、`app/api/projects/[id]/spaces/[spaceId]/route.ts`（若需要持久化新的排序字段）
- 文档：`docs/modules/frontend.md`、`docs/modules/library.md`

## 风险与注意点

1. **UI prototype gate 已触发**
   - 本任务改变现有弹窗交互、卡片操作路径与用户可见信息结构，属于明确的前端交互改动。
   - 在实现前必须由 `ui-designer` 产出 HTML 原型，并由用户确认。

2. **空间排序可能需要 schema/持久化扩展**
   - 当前 `PiWebProjectSpaceRecord` 只有 `pinned/lastOpenedAt` 等字段，没有显式 user order。
   - 若要稳定支持拖动顺序且在刷新/重启后保留，可能需要新增顺序字段或 metadata 约定；这会影响 API、lib、显示 helper 与数据迁移策略。

3. **不要破坏 Project Registry 约束**
   - 顶层项目来源仍必须是 `/api/projects`；不能回退为扫描 sessions 合成项目。

4. **不要破坏现有 WorkTree 行为**
   - WorkTree archive/delete 仍要保留现有确认/后端语义；只是入口与菜单体系收敛。

5. **排序与星标的语义要解耦**
   - 在新的 space 排序模型下，星标不再等同于“自动排到前面”；需要在 UI 与文案上说明，避免用户误解。

## 待进一步设计确认的问题

1. **顶部三点菜单保留哪些项**
   - 建议保留与“当前工作区”强相关或全局性的动作，例如：归档所有会话、编辑当前项目/空间元数据、当前工作区快捷操作。
   - 而“对任意 project/space 的浏览态操作”转移到弹窗右键菜单。

2. **space 拖动排序的持久化方式**
   - 新增显式字段（如 `sortOrder`）还是写入 `metadata`？
   - 新增 WorkTree 被发现/同步时，如何保证默认追加到底部且不重排已有项？

3. **project 列表是否也要支持拖动排序**
   - 当前用户只明确了空间排序；项目列表暂按现有星标+最近打开策略理解。

## 建议下一步

1. 派发 `ui-designer` 基于当前项目样式输出 HTML 原型，覆盖：
   - project card 右键菜单
   - main/worktree space 右键菜单
   - 顶部三点菜单保留后的分工
   - 星标态与“主空间固定第一 + 其他拖动排序”的视觉与说明
2. 原型确认后，由 architect 补 `prd.md` / `ui.md` / `design.md` / `plan-review.md`，并明确是否需要新增持久化排序字段。
3. 当前不要进入 implementing。