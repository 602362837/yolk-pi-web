# design

## 方案摘要

将本任务拆成四个可并行/串行结合的技术层面：

1. **右侧工作区交互修正**：在 `AppShell` 中修正预览区垂直 resize 方向，并为 right panel 增加桌面端可持久化宽度 state/handle。
2. **Studio session task 感知升级**：把单任务 association 从 `task | null` 扩展为“绑定当前 session 的多 task 列表 + primary/current + warnings”。旧 `task` 字段保留为 primary task 兼容项。
3. **多任务 widget 与收纳球**：前端使用卡片堆叠展示已绑定任务，支持收纳为悬浮球，点击任务打开 Studio drawer 并聚焦。
4. **可拖动与安全区 clamp**：展开面板和悬浮球都可拖动、持久化位置，并在读取、拖动、窗口 resize、内容尺寸变化、形态切换时 clamp 到可视安全区。

## 影响模块和边界

### 前端

- `components/AppShell.tsx`
  - 修正 `handleExplorerResizePointerDown()` 的高度计算方向：底部 handle 应使用 `startHeight + (moveEvent.clientY - startY)`。
  - 新增 right panel width state、localStorage key、clamp 方法、pointer resize handler、desktop-only resize handle。
  - 将 `studioSessionTask` 单值状态演进为多任务 link state，例如 `studioSessionTaskLink`，从中派生 `studioSessionTasks` 和 `primaryTaskKey`。
  - `focusedStudioTaskKey` 继续作为打开右侧 Studio drawer 的焦点；多任务 widget 点击某项时传入对应 task key。
  - 轮询条件从单个 `studioSessionTaskKey` 改为多任务派生：任一 task 有 active runs / needs attention / waiting children 即加快轮询。
- `components/YpiStudioSessionWidget.tsx`
  - 推荐改造为多任务容器组件，或新增 `YpiStudioSessionTasksWidget` 并复用单任务 `Content`/summary helpers。
  - props 建议：`tasks`, `primaryTaskKey`, `liveOverlays`, `onOpenTask(taskKey)`，可选 `hiddenWhenFocusedTaskKey`。
  - 增加 expanded/collapsed state；collapsed 为悬浮球，expanded 为卡片堆叠。
  - live overlay 按 `taskKey || taskId` 分发到对应 task，而不是只合并到单个 task。
  - 展开面板和悬浮球共用或分别使用 draggable position hook，必须 clamp。
- `components/ChatWindow.tsx`
  - 当前已能汇总多个 Studio tool overlay；实现时需确保 progress signature 覆盖 taskKey/taskId/status 变化，触发多任务 link refresh。
  - 不把 transcript-only task 直接渲染为 widget；仅用于 refresh/warnings。
- `components/YpiStudioPanel.tsx`
  - 现有 `focusedTaskKey`、`currentSessionContextId` 和绑定按钮可复用。
  - 多任务 widget 点击仍走打开 drawer + 聚焦 task，不绕过 approval gate。
- `app/globals.css`
  - right panel 宽度从固定 `42%` 迁移到 CSS variable 或 inline style，如 `--right-panel-width`。
  - 增加 `.right-panel-resize-handle` 样式；desktop resizing 时关闭 transition 或加 resizing class，mobile 隐藏 handle 并保持全屏 overlay。

### API / Lib

- `app/api/sessions/[id]/studio-task/route.ts`
  - 兼容返回旧字段 `task`。
  - 新增 `tasks`、`primaryTaskKey`、`warnings`；建议 `tasks` 元素为 candidate，包含 projection + sources/current/relationship。
  - 自动继续逻辑首版只对 `primaryTaskKey` 指向的 implementing task 触发，避免多个 implementing task 被一次 poll 误并发触发。
- `lib/ypi-studio-session-link.ts`
  - 从 `resolveYpiStudioTaskForSession()` 单任务 resolver 拆出候选收集/打分。
  - 可展示候选必须是**绑定当前 session**的 task：task `contextIds` 包含 exact runtime/session context（如 `pi_<sessionId>` / `pi_transcript_<sessionFileHash>`）。
  - runtime pointer 仅用于把已绑定候选标记为 `current: true` / 提升 primary 排序；如果 runtime 指向未绑定 task，只进入 warnings，不进入 `tasks[]`。
  - transcript evidence 仅用于 diagnostics/refresh，不构成可展示候选；未绑定 transcript-only task 不显示、不占位。
  - 多个 bound-context task 不再返回 fatal `ambiguous`；返回全部 candidates，并附加 `warnings: ["multiple-bound-tasks"]`。
- `lib/ypi-studio-types.ts`
  - 保留 `YpiStudioSessionTaskLinkResult` 兼容。
  - 新增/扩展 candidate 与多任务 result 类型。

## 数据流 / API / 文件契约

### 推荐类型

```ts
export type YpiStudioSessionTaskLinkRelationship = "bound-context";

export interface YpiStudioSessionTaskLinkCandidate {
  task: YpiStudioTaskWidgetProjection;
  sources: YpiStudioSessionTaskLinkSource[];
  confidence: "high";
  relationship: YpiStudioSessionTaskLinkRelationship;
  current: boolean;
  primary: boolean;
  lastEvidenceOrder?: number;
  warnings?: string[];
}

export interface YpiStudioSessionTasksLinkResult {
  task: YpiStudioTaskWidgetProjection | null; // primary，兼容旧前端
  tasks: YpiStudioSessionTaskLinkCandidate[];
  primaryTaskKey?: string;
  reason?: YpiStudioSessionTaskLinkReason;
  warnings?: string[];
  diagnostics?: {
    observedUnboundTaskKeys?: string[];
    runtimeUnboundTaskKey?: string;
    transcriptObservedTaskKeys?: string[];
  };
}
```

### Resolver 规则

1. 生成 session exact context keys：沿用 `exactRuntimeKeys(sessionId, sessionFilePath)`。
2. 扫描 `listYpiStudioTasks(cwd, { scope: "all" })`。
3. `boundCandidates = tasks.filter(task.contextIds intersects exact context keys)`。
4. runtime evidence：读取 exact context 当前 pointer；若 pointer 命中 bound candidate，则 `current=true` 并提升排序；若命中未绑定 task，写 warning/diagnostic。
5. transcript evidence：仅收集 observed keys/id/pathLabel；若不在 boundCandidates，写 warning/diagnostic；若在 boundCandidates，可用于 `lastEvidenceOrder` 排序但不新增未绑定候选。
6. 排序：needs_user / waiting_for_user / failed / blocked > running/queued/waiting children > current runtime > updatedAt desc > archived last。
7. `task = tasks[0]?.task ?? null`，`primaryTaskKey = tasks[0]?.task.key`。
8. 无 bound candidates：返回 `{ task:null, tasks:[], reason:"no-evidence" }` 或更具体 reason；可带 observed diagnostics 但 UI 不展示。

### 右侧抽屉宽度契约

- localStorage key 建议：`pi-web:right-panel-width`。
- 默认值建议保留现有视觉比例：`42vw`，实现中可转为 px 存储。
- 最小宽度：不低于 300px；最大宽度：不超过 `viewportWidth - leftSidebarMin - mainMin`，或简单限制为 `min(860px, viewportWidth - 360px)`；需结合现有 chat/main 区可用宽度实测。
- 移动端 `max-width: 640px` 不使用持久化桌面宽度，保持 `width: 100vw`。

### 浮层位置与 clamp 契约

- localStorage key 建议：
  - 展开面板：`pi-web:ypi-studio-session-widget-position:v2`。
  - 悬浮球：`pi-web:ypi-studio-session-widget-ball-position:v1`。
  - 若共享 anchor，则 key 中仍建议加 `v2`，避免误读旧单卡片位置导致越界。
- 安全边距：默认 18px；移动端叠加 `env(safe-area-inset-*)` 与底部输入区/系统区域。
- clamp 输入：desired `{ left, top }`、container rect、floating element rect、safe inset。
- clamp 输出：`left = clamp(left, safe.left, container.width - element.width - safe.right)`；`top = clamp(top, safe.top, container.height - element.height - safe.bottom)`。
- 触发时机：初始化读取、pointer move、pointer up、ResizeObserver(container/element)、window resize、tasks/expanded/collapsed 改变、right panel open/mode 改变。
- 若历史位置不可解析或 clamp 后空间不足，回落到右下角安全位置。

## 当前感知链路盲点

1. `writeRuntimePointer()` 对同一 context 只保留一个 `currentTask`，新 task 会覆盖旧 task。
2. `collectContextEvidence()` 对同一个 session context 命中多个 task 时，`resolveUnique()` 返回 `ambiguous`，前端收到 `task:null` 后隐藏 widget。
3. `resolveTranscript()` 只选最新结构化证据，可能把未绑定 task 误判为唯一当前任务。
4. `AppShell` 的 refresh/poll 周期只围绕单个 `studioSessionTaskKey`，无 task 或多 task 时刷新依据不足。
5. 旧 widget 的 `dismissedKey` 是隐藏而不是收纳，且无法表达多任务数量/状态。

## 兼容性

- 保留旧 `task` 字段为 primary task，现有前端可渐进迁移。
- 不修改 task.json schema；`contextIds` 仍表示绑定过该 session context。
- runtime pointer 保持单 currentTask 文件，不迁移；多任务展示从 task scan/contextIds 补足。
- `pi_process_*` 和 transcript-only evidence 不作为 widget 可展示绑定依据。
- 旧单卡片位置 key 可选择兼容读取一次并写入 v2 key，但必须 clamp。

## 风险与缓解

- 风险：只展示 bound-context 会漏掉“用户刚创建但未绑定”的任务。缓解：符合用户确认原则；可在 diagnostics 中记录，不进 widget。
- 风险：多 implementing task 自动继续误触发。缓解：首版只对 primary/current 已绑定 task 触发现有 autocontinue。
- 风险：浮层遮挡 chat 或 right drawer toggle。缓解：位置可拖动、drawer 打开时避让/渐隐、clamp 安全边距。
- 风险：宽度或浮层历史位置在窄屏/缩窗后越界。缓解：读取和 ResizeObserver/窗口变化时统一 clamp。
- 风险：卡片堆叠任务过多。缓解：面板 `max-height` + 内部滚动，球 badge 展示数量；完成/归档置底弱化。

## 回滚方案

- 后端保留旧 `task` 字段，可通过前端只读 primary 回退为单任务显示。
- right panel width 可清除 localStorage 并回到默认 42% 或固定 px。
- 多任务 widget 可退化为只显示 primary task；API 多任务字段可保留不使用。
- 悬浮球位置异常可清除对应 localStorage key；初始化会回落到安全默认位置。
