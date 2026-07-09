# Design

## 方案摘要

本方案将 `ProjectSpaceSwitchDialog` 中的 project/space 卡片升级为主要操作入口，并将空间排序从“main first -> pinned first -> name”调整为“main first -> user sortOrder”。星标继续复用 `pinned`，但对 space 只作为视觉标记，不参与排序。

空间拖动排序需要持久化字段。推荐在 `PiWebProjectSpaceRecord` 上新增可选 `sortOrder?: number`，并提供项目级批量排序 API；这是显式、可类型检查、可迁移且不会污染通用 `metadata` 的方案。

## 影响模块和边界

| 模块 | 影响 |
| --- | --- |
| `components/ProjectSpaceSwitchDialog.tsx` | 增加 project/space 右键触发、space 拖动排序 UI、星标视觉文案调整；继续保持弹窗作为 UI shell。 |
| `components/SessionSidebar.tsx` | 统一承载上下文菜单状态和动作回调；复用现有 metadata dialog、project/space PATCH、WorkTree archive/delete 确认流程。 |
| `lib/project-display.ts` | 修改 `activeProjectSpaces()` 排序：main 固定第一，非主空间按 `sortOrder` /兼容 fallback 排序，space `pinned` 不参与排序。项目排序保持不变。 |
| `lib/project-registry-types.ts` | `PiWebProjectSpaceRecord` 增加可选 `sortOrder?: number`；`SpacePatchInput` 或新 reorder input 增加排序字段类型。 |
| `lib/project-registry.ts` | 新增空间排序计算/持久化 helper；新建/发现 WorkTree 时默认追加到底部；已有 WorkTree 重新发现时保留既有顺序。 |
| `app/api/projects/[projectId]/spaces/route.ts` | 在现有 GET 基础上新增 PATCH 批量重排空间接口。 |
| `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/modules/api.md` | 更新 UI、排序 helper、API 合约说明。 |

## UI / 交互设计

详见 [`ui.md`](ui.md) 与 HTML 原型 [`project-switch-card-menu-prototype.html`](project-switch-card-menu-prototype.html)。

### 顶部三点菜单

保留顶部三点菜单，但定位为“当前选中工作区快捷菜单”。建议保留项：

- 编辑当前项目元数据…
- 编辑当前空间元数据…
- 星标当前项目 / 取消星标当前项目
- 星标当前空间 / 取消星标当前空间
- 归档所有会话
- 归档当前空间
- WorkTree 当前空间可继续进入删除/归档 WorkTree 确认流程

### 弹窗 project card 菜单

- 切换到主空间
- 编辑项目元数据…
- 星标项目 / 取消星标项目
- 归档项目

### 弹窗 space row/card 菜单

- 切换到此空间（缺失路径禁用）
- 编辑空间元数据…
- 星标空间 / 取消星标空间
- 归档当前空间
- WorkTree 专属：删除 WorkTree…

### 拖动排序

- 仅非主空间显示拖动把手并允许拖动。
- `main` 不显示拖动把手，始终位于第一行。
- 拖动过程中显示当前拖动项与投放位置反馈。
- 拖动完成后调用批量排序 API；失败时回滚/刷新项目列表并展示错误。

## 数据与 API 合约

### Space record 扩展

```ts
interface PiWebProjectSpaceRecord {
  // existing fields...
  sortOrder?: number;
}
```

语义：

- 只用于同一 project 下非主空间排序。
- `main` space 可不设置；即使存在也被忽略。
- 数值越小越靠前。
- 推荐使用间隔值（如 1024、2048、3072）以便未来局部插入，但拖动保存时可重新规整。

### 批量排序 API

新增：`PATCH /api/projects/[projectId]/spaces`

请求：

```json
{
  "orderedSpaceIds": ["wt_a", "wt_b", "custom_space"]
}
```

返回：

```json
{
  "project": { "id": "prj_..." },
  "spaces": []
}
```

校验规则：

- `orderedSpaceIds` 必须是字符串数组。
- `main` 不允许参与排序；服务端始终把 main 放第一。
- 只接受属于该 project 的非主 space id。
- 已归档 space 不参与可见排序；若请求包含已归档/不存在 id，返回 400。
- 未包含但仍活跃的非主空间追加到请求列表之后，保持既有相对顺序，防止并发刷新导致丢失空间。

### 新空间追加策略

- `upsertWorktreeSpace()` 创建新 space 时，赋予 `sortOrder = max(existing non-main effective order) + 1024`。
- 如果重新发现的是已存在/已归档 space，保留原 `sortOrder`。
- 旧数据没有 `sortOrder` 时，显示层使用兼容 fallback：按 registry 中既有顺序计算有效 order；一旦用户拖动，服务端为当前活跃非主空间写入显式 `sortOrder`。

## 排序规则

### 项目列表

保持既有 `sortProjectsForSidebar()` 规则：

1. 星标项目优先（`pinned === true`）。
2. 同组按 `lastOpenedAt ?? updatedAt` 倒序。
3. 再按 `displayProjectName()`。

### 空间列表

更新 `activeProjectSpaces(project)`：

1. 过滤 `archived`。
2. `id === "main"` 永远第一。
3. 非主空间按有效 `sortOrder` 升序。
4. `sortOrder` 缺失时使用兼容 fallback，不使用 `pinned` 排序。
5. 最后以显示名作为稳定兜底。

## 兼容性与迁移

- Registry 文件版本可继续保持 `version: 1`，因为 `sortOrder` 是可选 additive 字段。
- 旧记录没有 `sortOrder` 时仍可显示；首次拖动或新空间写入后逐步补齐。
- `pinned` 仍保留并兼容旧 UI/数据，但 UI 文案统一改为“星标”。
- 旧 API 调用未传 `sortOrder` 不受影响。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 空间拖动失败造成 UI 与 registry 不一致 | 拖动后乐观更新前保留原顺序；API 失败则回滚或 `loadProjects(false)` 刷新。 |
| 新空间发现/刷新打乱用户顺序 | 创建新 space 时显式追加到底部；已存在 space 保留原 `sortOrder`。 |
| 星标空间不再排序可能与旧“置顶”心智冲突 | UI 文案与说明中明确 space 星标只是标记；project 星标仍排序。 |
| 顶部菜单和右键菜单动作重复 | 文案区分“当前”与“任意对象”；顶部菜单保留当前快捷，弹窗右键负责浏览态目标。 |
| 批量排序 API 与并发刷新冲突 | 服务端对未包含活跃空间追加到底部并返回最新 project；客户端以返回结果收敛。 |
| WorkTree 删除/归档误伤 | 不改后端语义，继续复用现有确认、dirty summary、fallback 和 session cleanup。 |

## 回滚方案

- UI 回滚：移除新增 context menu/拖动入口，恢复仅 WorkTree 右键和顶部菜单。
- 排序回滚：`activeProjectSpaces()` 可临时恢复旧排序；`sortOrder` 为 additive 字段，保留在 registry 中不会影响旧逻辑。
- API 回滚：停止调用批量排序 PATCH；已有 `sortOrder` 字段可被忽略。
