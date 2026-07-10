# plan review

## 审批状态

UI 原型方向已由用户基本认可。用户新增并确认的实现约束：**悬浮球和展开后的多任务面板都必须可拖动，并且必须通过 viewport 安全区 clamp / 回弹避免被拖到屏幕下方或边缘后看不见。**

当前规划已补齐 PRD、UI、Design、Implement、Checks，可提交主会话/用户进入实现审批。未获得后续实现审批前，不应开始编码。

## 关联产物

- **Brief**: [brief.md](./brief.md)
- **PRD**: [prd.md](./prd.md)
- **UI 设计**: [ui.md](./ui.md)
- **HTML 原型**: [ui-prototype.html](./ui-prototype.html)
- **技术设计**: [design.md](./design.md)
- **实施计划**: [implement.md](./implement.md)
- **检查清单**: [checks.md](./checks.md)

## PRD 摘要

1. 修正预览区“项目空间信息/文件树”底部分隔条拖拽方向：向下增加上方区域高度，向上减少。
2. 桌面端右侧抽屉支持左边缘拖拽调整宽度、持久化、窗口变化时 clamp；移动端保持全屏。
3. YPI Studio session widget 支持绑定当前 session 的多 task 卡片堆叠。
4. 展开面板可收纳为悬浮球；悬浮球展示任务数量和最高优先级状态。
5. 悬浮球与展开面板都可拖动、位置持久化，并且任何时候都不能离开可视安全区。
6. 当前 session 悬浮区只展示明确绑定当前 session 的 task；未绑定但 transcript / 创建动作提及的 task 不显示、不占位。
7. 修正多任务感知机制，避免新 task 覆盖旧 task，避免多个 bound task 被 `ambiguous` 导致全部消失。

## UI 摘要

- 已采用卡片堆叠 B。
- 桌面端：展开态为多任务卡片堆叠，收纳态为可拖动悬浮球。
- 移动端：悬浮入口 + bottom sheet 列表。
- 拖动体验：展开面板和悬浮球都有 drag threshold、拖动反馈、持久化位置、viewport clamp。
- 避让体验：右侧 Studio drawer 已打开并聚焦对应任务时，悬浮 UI 应避让或渐隐。

## 技术设计摘要

### 后端/API

- 保留旧兼容字段 `task`，表示 primary task。
- 新增 `tasks[]`、`primaryTaskKey`、`warnings` / diagnostics。
- 可展示候选必须绑定当前 session（task `contextIds` 命中 exact session context）。
- runtime pointer 只对已绑定候选标记 `current` / 提升排序；指向未绑定 task 时只进入 diagnostics。
- transcript-only 未绑定 task 不进入 `tasks[]`。
- 多个 bound-context task 返回全部 candidates，不再 fatal ambiguous。

### 前端

- `AppShell` 修正 preview resize 方向，新增 right panel width state/handle/localStorage。
- `AppShell` 从单 `studioSessionTask` 迁移到多任务 link state，兼容旧响应。
- `YpiStudioSessionWidget` 改造为多任务卡片堆叠 + 收纳球，live overlays 按 task 分发。
- 展开面板和悬浮球共用/复用 clamp drag hook，所有初始化、拖动、resize、形态切换都执行 clamp。

## Implementation Plan 摘要

实施计划已写入 [implement.md](./implement.md)，并包含 fenced `json ypi-implementation-plan` 机器可读块。子任务：

1. `BE-SESSION-TASKS`：多任务 session-link resolver 与 API 兼容响应。
2. `FE-RIGHT-PANEL`：右侧抽屉宽度拖拽、持久化与预览区方向修正。
3. `FE-STUDIO-STATE`：AppShell 接入多任务 link state、轮询与 overlay 分发。
4. `FE-WIDGET-DRAG`：多任务卡片堆叠、收纳悬浮球、双形态拖动与 clamp。
5. `QA-DOCS-CHECKS`：验证、回归检查与文档同步。

## Checks 摘要

- 自动验证：`npm run lint`、`node_modules/.bin/tsc --noEmit`。
- 手工重点：预览拖拽方向、右侧宽度持久化、桌面/移动断点、多任务绑定过滤、未绑定 task 不显示、悬浮球/展开面板拖动 clamp、右侧 Studio drawer 聚焦。

## 请求审批

建议主会话将任务状态推进到 `awaiting_approval`，并请用户确认：是否批准按本计划开始实现。
