# implement

## 执行顺序概览

| id | phase | title | dependsOn | parallelizable |
| --- | --- | --- | --- | --- |
| BE-SESSION-TASKS | backend-api | 多任务 session-link resolver 与 API 兼容响应 | - | false |
| FE-RIGHT-PANEL | frontend-layout | 右侧抽屉宽度拖拽、持久化与预览区方向修正 | - | true |
| FE-STUDIO-STATE | frontend-state | AppShell 接入多任务 link state、轮询与 overlay 分发 | BE-SESSION-TASKS | false |
| FE-WIDGET-DRAG | frontend-widget | 多任务卡片堆叠、收纳悬浮球、双形态拖动与 clamp | BE-SESSION-TASKS | true |
| QA-DOCS-CHECKS | validation | 验证、回归检查与文档同步 | BE-SESSION-TASKS, FE-RIGHT-PANEL, FE-STUDIO-STATE, FE-WIDGET-DRAG | false |

## 需先阅读的文件

- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`
- `components/AppShell.tsx`
- `components/YpiStudioSessionWidget.tsx`
- `components/ChatWindow.tsx`
- `components/YpiStudioPanel.tsx`
- `app/globals.css`
- `app/api/sessions/[id]/studio-task/route.ts`
- `lib/ypi-studio-session-link.ts`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`

## Implementation Plan

```json ypi-implementation-plan
{
  "version": 1,
  "taskId": "20260710-091157-修正预览区拖拽方向并支持右侧抽屉宽度调整与任务面板收纳悬浮球",
  "approvalRequiredBeforeImplementation": true,
  "subtasks": [
    {
      "id": "BE-SESSION-TASKS",
      "title": "多任务 session-link resolver 与 API 兼容响应",
      "phase": "backend-api",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-session-link.ts",
        "lib/ypi-studio-types.ts",
        "app/api/sessions/[id]/studio-task/route.ts",
        "lib/ypi-studio-tasks.ts"
      ],
      "instructions": [
        "保留旧 YpiStudioSessionTaskLinkResult 的 task 字段兼容语义，新增 tasks、primaryTaskKey、warnings/diagnostics。",
        "将可展示候选限定为 task.contextIds 命中当前 session exact context keys 的 task；runtime pointer 只能标记 current/primary，不能单独把未绑定 task 加入 tasks。",
        "transcript evidence 仅用于 diagnostics/lastEvidenceOrder；未绑定 transcript-only task 不显示、不占位。",
        "多个 bound-context task 不再作为 fatal ambiguous；返回全部 candidates，并在 warnings 中说明 multiple-bound-tasks。",
        "API 自动继续逻辑只对 primary/current 的 implementing task 触发，避免多任务误并发。"
      ],
      "acceptance": [
        "同一 session context 绑定两个 task 时 API 返回 tasks.length >= 2 且 task 为 primary。",
        "未绑定但 transcript 提及的 task 不出现在 tasks[]，最多出现在 diagnostics/warnings。",
        "runtime pointer 指向未绑定 task 时不会替换已有 bound tasks。",
        "旧前端读取 response.task 仍可工作。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "手动构造或复用已有 .ypi/tasks 数据验证 /api/sessions/[id]/studio-task 响应"
      ],
      "risks": [
        "现有 resolver 函数耦合 resolveUnique，需要小步拆分避免破坏 old task field。",
        "task summary 类型是否暴露 contextIds 需实现时确认；若 summary 不含 contextIds，需要在 list/get detail 层补足或安全读取 detail。"
      ],
      "parallelizable": false,
      "localReview": "重点审查未绑定 task 过滤、ambiguous 降级为 warnings、autocontinue 只作用于 primary。"
    },
    {
      "id": "FE-RIGHT-PANEL",
      "title": "右侧抽屉宽度拖拽、持久化与预览区方向修正",
      "phase": "frontend-layout",
      "order": 2,
      "dependsOn": [],
      "files": [
        "components/AppShell.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "将 handleExplorerResizePointerDown 的 nextHeight 改为 startHeight + deltaY，并保留 MIN_EXPLORER_HEIGHT / MIN_PREVIEW_HEIGHT clamp。",
        "新增 rightPanelWidth state、localStorage key、desktop clamp 函数、pointer resize handler 和左边缘 resize handle。",
        "文件、Studio、Trellis rightPanelMode 共享同一 width；移动端保持 100vw overlay 且隐藏 handle。",
        "拖拽中避免 transition 抖动，可增加 resizing class 或 inline style。",
        "读取历史宽度和 window resize 时 clamp 到当前 viewport 可用范围。"
      ],
      "acceptance": [
        "预览区底部 handle 向下拖增加上方文件树高度，向上拖减少。",
        "右侧抽屉桌面端可从左边缘拖拽调整宽度并刷新后保留。",
        "切换 files/studio/trellis 不重置宽度。",
        "移动端不出现宽度 handle，仍为全屏抽屉。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手测桌面宽屏、窄屏、移动断点"
      ],
      "risks": [
        "CSS 中 .right-panel-container > * 固定 42vw 需要同步迁移，否则内容宽度与容器不同步。",
        "右侧 toggle strip z-index 与 resize handle 可能冲突。"
      ],
      "parallelizable": true,
      "localReview": "重点检查 CSS variable/inline width、mobile media query、resize pointer cleanup。"
    },
    {
      "id": "FE-STUDIO-STATE",
      "title": "AppShell 接入多任务 link state、轮询与 overlay 分发",
      "phase": "frontend-state",
      "order": 3,
      "dependsOn": ["BE-SESSION-TASKS"],
      "files": [
        "components/AppShell.tsx",
        "components/ChatWindow.tsx",
        "lib/ypi-studio-types.ts"
      ],
      "instructions": [
        "把 studioSessionTask 单值 state 调整为 studioSessionTaskLink，多任务从 link.tasks 派生。",
        "兼容 API 旧响应：若 tasks 缺失但 task 存在，则构造单 candidate。",
        "点击某个 widget task 时 setFocusedStudioTaskKey(task.key)、打开 rightPanelMode=studio。",
        "轮询加速条件改为任一 candidate task 的 runtime/subagent/implementation active 或 needs_user。",
        "studioLiveOverlays 按 taskKey/taskId 合并到对应卡片，不能只合并 primary。"
      ],
      "acceptance": [
        "多任务响应下 AppShell 渲染多个任务入口，不因 primary 变化丢失旧任务。",
        "新绑定 task 后 refresh 能加入堆叠。",
        "未绑定 overlay/task 不进入可展示 widget。",
        "打开右侧 Studio drawer 后能聚焦用户点击的 task。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手测单任务、多任务、无任务、Studio drawer 已打开场景"
      ],
      "risks": [
        "旧 YpiStudioSessionWidget props 变化会影响现有渲染路径。",
        "overlay 的 taskId/key 与 projection key/id 匹配规则要处理 archived key。"
      ],
      "parallelizable": false,
      "localReview": "重点审查兼容旧 response.task 与多任务派生状态，避免 selectedSession 切换后 stale state。"
    },
    {
      "id": "FE-WIDGET-DRAG",
      "title": "多任务卡片堆叠、收纳悬浮球、双形态拖动与 clamp",
      "phase": "frontend-widget",
      "order": 4,
      "dependsOn": ["BE-SESSION-TASKS"],
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "components/AppShell.tsx"
      ],
      "instructions": [
        "改造或新增多任务 widget：expanded 为卡片堆叠，collapsed 为悬浮球。",
        "展开面板和悬浮球都支持 pointer drag；点击且未超过 drag threshold 才触发打开/展开。",
        "实现可复用 clampPosition：考虑 container rect、floating element size、safe margin、移动端 safe-area、窗口 resize。",
        "位置持久化使用 v2 key；读取旧位置或历史越界位置必须 clamp。",
        "任务卡片点击打开对应 task；收纳按钮只切换 collapsed，不再永久 dismiss。",
        "任务数量、最高优先级状态、needs_user/failed pulse 在悬浮球上可见。"
      ],
      "acceptance": [
        "展开面板可拖动且无法拖出屏幕。",
        "收纳悬浮球可拖动且无法拖出屏幕。",
        "拖动位置刷新后保留；缩小窗口后自动回到可见区域。",
        "点击悬浮球展开；点击任务卡片打开 Studio drawer 对应 task。",
        "右侧 Studio drawer 已聚焦相关 task 时悬浮 UI 避让或渐隐。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手测拖动到四边/底部、刷新、缩窗、任务数量变化、收纳展开切换"
      ],
      "risks": [
        "卡片内部滚动与外层拖动事件可能冲突，需要限制 drag handle 或判断 interactive target。",
        "移动端 bottom sheet 与悬浮球拖动的交互边界需避免影响正常点击。"
      ],
      "parallelizable": true,
      "localReview": "重点审查 pointer capture cleanup、drag threshold、防止按钮/卡片点击被误判为拖动、ResizeObserver clamp。"
    },
    {
      "id": "QA-DOCS-CHECKS",
      "title": "验证、回归检查与文档同步",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["BE-SESSION-TASKS", "FE-RIGHT-PANEL", "FE-STUDIO-STATE", "FE-WIDGET-DRAG"],
      "files": [
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        ".ypi/tasks/20260710-091157-修正预览区拖拽方向并支持右侧抽屉宽度调整与任务面板收纳悬浮球/checks.md"
      ],
      "instructions": [
        "若 API 契约、组件职责或 library resolver 行为发生变化，同步更新对应 docs/modules 文档。",
        "执行 lint 和 TypeScript 检查。",
        "按 checks.md 完成手工验收矩阵。",
        "记录任何未覆盖的产品取舍或回归风险。"
      ],
      "acceptance": [
        "npm run lint 通过。",
        "node_modules/.bin/tsc --noEmit 通过。",
        "checks.md 中核心验收项均完成或明确记录阻塞。",
        "涉及 API/frontend/library 的持久知识已写入 docs/modules。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "本任务横跨 API、lib、CSS 和复杂拖拽交互，需避免只做静态检查不做手测。"
      ],
      "parallelizable": false,
      "localReview": "重点检查 docs 与实际契约一致性、手工验收覆盖多任务与拖拽 clamp。"
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 检查门禁

- 未获得主会话/用户实现审批前，不进入编码。
- 后端多任务 API 必须保留旧 `task` 字段兼容。
- 未绑定当前 session 的 task 不得显示在当前 session 悬浮区。
- 悬浮球与展开面板必须都可拖动并 clamp 在可视区。
