# UI 设计方案 - 项目切换拖动排序与星标解耦

本任务针对“项目切换弹窗中项目列表支持拖动排序，且星标不影响顺序、只作为视觉标记”的需求，完成了原型设计、状态设计与详细实现说明。

## 1. 原型文件
交互式 HTML 原型文件已输出至：
- **`project-switch-drag-prototype.html`** (位于当前任务目录下)
- 该原型提供具有完整 Drag & Drop 的高保真交互模拟，包含：
  - 项目卡片拖拽排序与相应的 API 请求预览；
  - 空间行拖拽排序（`main` 固定第一位，其余支持拖拽）；
  - 项目/空间星标一键 Toggle，且保持相对位置不跳动；
  - 搜索状态下禁用拖动排序，并显示友好提示；
  - 就地右键菜单交互与提示。

## 2. 交互状态设计 (Interaction States)

| 场景 | 展示与交互要素 | 用户操作 | 反馈与系统行为 |
| --- | --- | --- | --- |
| **项目列表默认态** | 每个 project card 左侧展示拖动把手 `⋮⋮` 与星标按钮 `★/☆` | 点击 project card | 选中并激活该项目，右侧展开对应空间列表 |
| **拖拽项目** | `card` 设为 `draggable`。鼠标 hover 把手显示 `grab` 指针，拖拽时为 `grabbing` 并使 card opacity 降为 0.4。 | 按住把手拖动到另一 card | 出现投递高亮（上方显示上边框，下方显示下边框）。释放后立即在客户端乐观更新列表并调用 `PATCH /api/projects` |
| **搜索状态拖拽** | 搜索输入框非空时，拖动把手变为禁用态 `disabled`，鼠标悬浮显示 `not-allowed` 样式 | 尝试拖拽 item | 无法触发拖拽，且在搜索框下方显示提示：“⚠️ 搜索状态下禁用拖动排序，请清空搜索后重新排序” |
| **点击星标** | project card / space row 内点击星标按钮 | 点击 `★/☆` | 星标仅切换视觉 `★` / `☆`。**位置绝对保持不变**，不再引起列表排序的变化，消除视觉跳动 |
| **右键上下文菜单** | 右键任意卡片，弹出 Context Menu | 右键单击 | 展示对应的项目元数据修改/星标/归档选项。星标修改同步影响卡片展示 |

## 3. 实现与架构对接点 (Implementation Notes)

为了将此设计转化为实现，实现员需要对如下模块进行修改：

### 3.1 数据层与 Registry (lib/project-registry-types.ts & lib/project-registry.ts)
- 给项目定义增加 `sortOrder?: number`：
  ```typescript
  export interface PiWebProjectRecord {
    // ...
    sortOrder?: number;
  }
  ```
- 项目批量排序：在 `lib/project-registry.ts` 中实现 `reorderProjects(orderedProjectIds: string[])`。
  - `main` 无需校验，校验 orderedProjectIds 是否都是 active 项目 id。
  - 新项目在 `registerProject` 中分配 `max(sortOrder) + 1024` 追加到底部。
  - 旧数据缺少 `sortOrder` 时，首次拖动对全部 active projects 写入新的 sortOrder 值。

### 3.2 排序逻辑 (lib/project-display.ts)
- 修改 `sortProjectsForSidebar(projects: PiWebProjectRecord[])`。
- **剥离星标对项目排序的影响**：
  - 之前：`if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;`
  - 之后：直接按 `sortOrder` 升序排列。若缺少 `sortOrder`，则退回至 `lastOpenedAt/updatedAt` 降序 + `displayName` 升序稳定 fallback。
- 修改 `activeProjectSpaces`，确保空间星标同样不影响空间排序（已满足）。

### 3.3 路由层 API (app/api/projects/route.ts)
- 支持 `PATCH /api/projects` 用于项目重排：
  ```typescript
  export async function PATCH(request: Request) {
    // 接受 { orderedProjectIds } 并调用 reorderProjects
  }
  ```

### 3.4 交互层组件 (components/ProjectSpaceSwitchDialog.tsx & components/SessionSidebar.tsx)
- 在左侧 project card 的 render 逻辑中，增加 HTML5 drag/drop 支持，实现乐观更新与 API 回滚，交互契约与 space list 保持一致。
- 清理元数据弹窗 (`ProjectMetadataDialog`) 中描述文案，将 “星标（星标项目优先排序）” 改为 “星标（仅用于标记，不影响项目顺序）”。

## 4. UI 检查清单 (UI Checks)
- [ ] 项目星标点击后，卡片位置绝不发生跳动，仅变换星标视觉状态。
- [ ] 项目与空间的星标都不改变原本排序。
- [ ] 搜索框非空时，拖拽把手在视觉上禁用（opacity 变淡，cursor 为 `not-allowed`），且有明显的提示横条。
- [ ] 交互风格（拖拽预览高亮、把手视觉、乐观更新与回滚体验）项目级与空间级保持高度一致。
- [ ] 按钮与元数据编辑弹窗的文案中彻底移除“置顶排序”或“优先排序”等会产生误导的表述。

## 5. 待下一阶段确认点
1. 搜索状态下禁用拖动是采用“临时禁用 drag 把手并在搜索框下方出现友好文字 Banner”的方案（如原型所示），还是直接隐藏拖动把手？
   - *UI 建议*：采用禁用把手+显示 Banner，告知用户限制比直接隐藏更能让用户建立操作心智。
2. 初始旧数据的顺序固化，是首次拖动后一次性补齐所有 active project 的 `sortOrder`，还是读取时对所有缺失数据做默认持久化计算？
   - *UI 建议*：首次读取时若为旧项目，可以在内存中以当前默认排法展示，当第一次用户拖动时，乐观更新本地 state 后，向后端 PATCH 完整的 `orderedProjectIds` 来持久化写入排序。
