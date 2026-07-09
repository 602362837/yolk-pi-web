# 计划审批书

本文件是本任务进入实现前的用户审批入口。当前仅完成规划与审批材料，尚未进入实现。

## 相关材料

- 背景与已确认决策：[`brief.md`](brief.md)
- PRD：[`prd.md`](prd.md)
- UI 说明：[`ui.md`](ui.md)
- HTML 原型：[`project-switch-card-menu-prototype.html`](project-switch-card-menu-prototype.html)
- 技术设计：[`design.md`](design.md)
- 实现计划：[`implement.md`](implement.md)
- 检查清单：[`checks.md`](checks.md)

## 审批请求

请确认是否批准按本计划进入实现：

1. 保留 Sidebar 顶部三点菜单，但只作为“当前选中工作区”的快捷/全局操作入口。
2. 在项目切换弹窗中，让所有 project card 与所有 space row/card 支持右键菜单。
3. 统一使用“星标”文案，并继续复用现有 `pinned: boolean` 字段。
4. 项目列表继续按“星标优先 + 最近打开/更新时间 + 名称”排序。
5. 空间列表改为“主空间永远第一 + 其他空间按用户拖动顺序”；space 星标只作为标记，不再改变空间排序。
6. 为持久化空间拖动顺序，给 space record 增加可选 `sortOrder?: number` 字段，并新增项目级批量空间排序 API。

## PRD 摘要

目标：把项目/空间相关操作收敛到弹窗卡片上下文中，让用户在浏览态即可对任意 project/space 执行切换、编辑、星标、归档和 WorkTree 删除等操作，同时明确星标与排序语义。

范围内：

- `ProjectSpaceSwitchDialog` project/space 卡片右键菜单。
- `SessionSidebar` 顶部三点菜单职责收敛。
- project/space 星标展示与切换入口。
- 非主空间拖动排序及持久化。
- 相关 API、lib helper 与模块文档更新。

范围外：

- 不重写 Sidebar 会话列表、文件树或 Chat 区域。
- 不改变 session JSONL、project-space header link 或 WorkTree archive/delete 后端语义。
- 不在本轮加入项目列表拖动排序。
- 不新增第二套收藏字段。

## UI / 关键交互摘要

本任务已触发 UI 原型门禁，需先审批 HTML 原型：[`project-switch-card-menu-prototype.html`](project-switch-card-menu-prototype.html)。

关键交互：

- Project card 右键菜单：切换到主空间、编辑项目元数据、星标/取消星标项目、归档项目。
- Main space 右键菜单：切换到此空间、编辑空间元数据、星标/取消星标空间、归档当前空间。
- WorkTree space 右键菜单：包含 main space 菜单能力，并额外提供删除 WorkTree。
- 非主空间显示拖动把手；main space 不可拖动且固定第一。
- 新增/新发现空间默认追加到非主空间列表底部。
- 顶部三点菜单保留，用于当前项目/当前空间和全局会话操作。

## Design 摘要

### 数据模型

需要新增持久化空间顺序字段：

```ts
interface PiWebProjectSpaceRecord {
  sortOrder?: number;
}
```

理由：

- 用户要求刷新/重启后保留拖动顺序，仅前端状态无法满足。
- 使用显式字段比写入 `metadata` 更可类型检查、可验证、可文档化。
- 字段是 optional additive，不需要改变 session JSONL，也不影响旧 registry 读取。

### API 合约

新增：`PATCH /api/projects/[projectId]/spaces`

请求体：

```json
{
  "orderedSpaceIds": ["wt_a", "wt_b", "wt_c"]
}
```

服务端规则：

- `main` 不参与排序，始终第一。
- 只接受本 project 的活跃非主 space id。
- 请求未包含但仍活跃的非主空间追加到尾部，避免并发刷新丢失新空间。
- 返回更新后的 project/spaces，客户端以返回结果收敛。

## Implement 摘要

建议按 6 个子任务执行，详见 [`implement.md`](implement.md)：

1. 扩展 Project Registry space 排序字段与 helper。
2. 增加项目级空间批量排序 API。
3. 在 `SessionSidebar` 中统一承载 project/space context menu 动作。
4. 在 `ProjectSpaceSwitchDialog` 中实现卡片右键与非主空间拖动排序。
5. 统一“星标”文案与状态展示。
6. 更新模块文档并完成验证。

## Checks 摘要

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

人工验收重点：

- 右键 project card、main space、WorkTree space 都命中正确目标。
- 顶部三点菜单仍可操作当前工作区。
- 星标项目影响项目排序；星标空间不改变空间顺序。
- 拖动非主空间后刷新/重开仍保持顺序。
- 新空间默认追加到底部。
- WorkTree 删除/归档仍走确认和原有 cleanup/fallback 流程。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 拖动排序保存失败导致 UI 与 registry 不一致 | 保留原顺序，失败回滚或刷新 `loadProjects(false)`。 |
| 旧数据缺少 `sortOrder` 引起顺序跳变 | 使用兼容 fallback；首次拖动后写入显式顺序。 |
| 新 WorkTree 发现打乱用户顺序 | 创建新 space 时写入最大顺序之后；重发现旧 space 保留顺序。 |
| 顶部菜单与右键菜单重复造成困惑 | 文案区分“当前工作区快捷”与“浏览态任意对象操作”。 |
| WorkTree 删除/归档风险 | 复用现有确认弹窗、dirty summary、fallback 与 session cleanup。 |

## 审批结论

- [ ] 用户批准 HTML 原型与本计划，可进入实现。
- [ ] 用户要求调整后重新规划。

在用户明确批准前，不进入 implementing。