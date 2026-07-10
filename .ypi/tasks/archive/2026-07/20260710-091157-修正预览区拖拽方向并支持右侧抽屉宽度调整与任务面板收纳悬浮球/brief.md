# brief

## 背景

本任务改进右侧预览/工作室区域体验：修正预览区上下拖拽方向、支持右侧抽屉宽度调整、为 YPI Studio session 任务面板提供收纳悬浮球，并修复同一 chat session 关联多个 Studio task 时旧任务悬浮入口被新任务替换或因 `ambiguous` 全部消失的问题。

用户已确认 UI 原型方向基本通过，并补充硬约束：**悬浮球和展开后的多任务面板都必须可拖动，且必须通过视口安全区 clamp / 回弹避免被拖到屏幕下方或边缘后看不见。** 实现仍需等待后续实现审批，当前只做规划与 artifacts 更新。

## 已核实的现状

阅读范围：`docs/modules/frontend.md`、`docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/library.md`、`components/AppShell.tsx`、`components/YpiStudioSessionWidget.tsx`、`app/api/sessions/[id]/studio-task/route.ts`、`lib/ypi-studio-session-link.ts`、`lib/ypi-studio-types.ts`、`components/ChatWindow.tsx`、`components/YpiStudioPanel.tsx`、`app/globals.css`、`lib/ypi-studio-tasks.ts`。

1. **当前 Studio session widget 是单任务契约**
   - `/api/sessions/[id]/studio-task` 返回 `YpiStudioSessionTaskLinkResult`，成功形态只有单个 `task`。
   - `AppShell` 只维护单个 `studioSessionTask` / `focusedStudioTaskKey`，只渲染一个 `YpiStudioSessionWidget`。
   - `YpiStudioSessionWidget` props 只接受单个 `YpiStudioTaskWidgetProjection`，dismiss 状态按单个 `task.key` 管理。
2. **右侧抽屉固定宽度**
   - `app/globals.css` 中桌面端 `.right-panel-container.right-panel-open` 固定 `width: 42%; min-width: 300px`。
   - 没有 right panel width state、localStorage key、resize handle 或 viewport clamp。
3. **预览区文件树高度拖拽方向相反**
   - `AppShell.handleExplorerResizePointerDown()` 中底部分隔条移动使用 `startHeight - (moveEvent.clientY - startY)`。
   - 对位于文件树底部的 handle 来说，向下拖应增加上方文件树高度，目前会减小。
4. **Session task 感知链路仍是唯一任务模型**
   - runtime evidence：`.ypi/.runtime` 的 session runtime pointer；`writeRuntimePointer()` 每个 context 只存 `{ currentTask }`，新建/绑定/状态更新会覆盖当前指针。
   - context evidence：扫描 task 的 `contextIds`；只要同一个 `pi_<sessionId>` 出现在多个 task 中，`resolveUnique()` 会因多个 key 返回 `ambiguous`。
   - transcript evidence：扫描当前 branch 的 Studio toolCall/toolResult/details/text；结构化证据只取最新一条，新创建/新提及 task 可能压过旧 task。
   - resolver 最终仍要求唯一；runtime、context、transcript 不一致时返回 `ambiguous` 或只返回一个 task。
5. **当前 widget 已有单卡片拖动与 clamp 基础**
   - `YpiStudioSessionWidget` 已有 `clampPosition()`、`ResizeObserver`、localStorage 位置持久化和桌面端拖拽。
   - 但它没有多任务容器、收纳悬浮球，也没有“展开面板和悬浮球分别可拖动且不可拖出可视区”的统一交互契约。

## 根因候选

1. **数据契约天然单值**：API、类型、AppShell state、widget props 都只能表达一个 task。
2. **runtime pointer 是 currentTask 覆盖模型**：新 task 会覆盖同一 context 当前指针；旧 task 虽仍可能在 `contextIds` 中，但 current pointer 只保留最新任务。
3. **多证据冲突被当成不可信**：多个 task 同时带同一 session context 或 runtime/context/transcript 指向不同 task 时，resolver 返回 `ambiguous`，前端因 `task:null` 隐藏 widget。
4. **transcript 最新结构化证据造成误判**：未绑定或临时读取的新 task 只要出现在 Studio tool result/details 中，可能成为唯一候选或导致 ambiguous。
5. **UI 无多任务容器/收纳模型**：即使后端返回多个任务，当前也没有卡片堆叠、收纳球、按任务打开右侧详情、位置持久化与 clamp 规则。

## 已确认方向

- UI 原型方向基本通过：多任务悬浮 widget 采用**卡片堆叠 B**。
- 当前 session 的悬浮区**仅展示明确绑定当前 session 的 task**。
- 仅在 transcript / 创建动作中被提及、但未绑定当前 session 的 task：**不显示、不占位、不替换已有悬浮入口**；最多进入 API warnings/diagnostics，供调试或未来扩展。
- 悬浮球和展开后的多任务面板都可拖动；位置持久化；读取、拖动、窗口 resize、内容尺寸变化时都必须 clamp 到可视安全区。

## 范围内

- 修正预览区文件树/预览内容垂直拖拽方向。
- 为右侧抽屉增加桌面端宽度调整与持久化；移动端保持现有全屏抽屉行为。
- 为 YPI Studio session 多任务悬浮 widget 增加卡片堆叠与收纳悬浮球。
- 悬浮球与展开面板都可拖动，并 clamp 在视口安全区内，避免不可见。
- 将 session task 感知从“唯一 task”升级为“绑定当前 session 的多 task 列表 + primary/current 排序 + warnings”。
- 保留旧单任务 `task` 字段作为 primary task 兼容项，新增 `tasks[]` / `primaryTaskKey` / `warnings`。

## 范围外

- 不改变 Studio approval gate、任务状态机、实施调度语义。
- 不把 child session transcript/usage 注入父 chat 消息。
- 不自动绑定仅 transcript 提及的新 task。
- 不迁移已有 task.json schema；`contextIds` 仍作为绑定证据。
- 不在当前规划阶段实现代码。

## 推荐下一步

规划已完整，可由主会话保存 implementationPlan 并将任务推进到 `awaiting_approval`，等待用户明确批准实现后再进入编码。
