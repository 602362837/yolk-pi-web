# Implement

## 实施前提

- [HTML 原型](./ui-prototype.html) 已获用户认可，UI prototype gate 已通过。
- **尚未获得生产实现最终审批。** 主会话须先将本任务推进到 planning，并以 [plan-review.md](./plan-review.md) 取得最终批准、保存 implementation plan、切换到 `awaiting_approval`；批准前不得修改生产代码。

## 需先阅读

- `docs/modules/frontend.md`
- `docs/standards/code-style.md`
- `components/YpiStudioSessionWidget.tsx`
- `components/AppShell.tsx`
- `app/globals.css`
- [Brief](./brief.md)、[PRD](./prd.md)、[UI](./ui.md)、[HTML 原型](./ui-prototype.html)、[Design](./design.md)、[Checks](./checks.md)

## 人类可读子任务

| ID | 阶段 | 子任务 | 依赖 |
| --- | --- | --- | --- |
| WIDGET-STATE | frontend | 分离 collapsed/hidden，修复 drawer focus 与 ball mount/position 生命周期 | 最终审批 |
| WIDGET-CARD-PROGRESS | frontend | 实现 Detail-only 卡片与五站连线 workflow 路线 | WIDGET-STATE |
| WIDGET-RESPONSIVE | frontend | 对齐多任务、移动 bottom sheet、drawer focused 与拖动边界 | WIDGET-CARD-PROGRESS |
| WIDGET-MOTION | frontend | 动效内外分层与 reduced-motion | WIDGET-STATE, WIDGET-CARD-PROGRESS |
| QA-REGRESSION | validation | 自动与人工回归，记录结果并同步模块文档 | WIDGET-RESPONSIVE, WIDGET-MOTION |

## Implementation Plan

```json ypi-implementation-plan
{
  "version": 1,
  "taskId": "20260710-102813-修复-ypi-studio-任务面板最小化后直接消失而不是收纳为任务球",
  "approvalRequiredBeforeImplementation": true,
  "uiPrototypeApproved": true,
  "subtasks": [
    {
      "id": "WIDGET-STATE",
      "title": "分离收纳展示态、隐藏态与 drawer focus",
      "phase": "frontend",
      "order": 1,
      "dependsOn": [],
      "files": ["components/YpiStudioSessionWidget.tsx", "components/AppShell.tsx"],
      "instructions": ["先在浏览器复现 drawer focused + collapsed 和初始展开后首次收纳。", "删除/替换 hiddenWhenFocusedTaskKey 导致 return null 的路径；drawer focus 只能作为非破坏性视觉上下文。", "保持 expanded/collapsed 的既有全局 localStorage 语义，drawer、刷新和任务列表变化不得写回。", "让 ball position 的初始化与 ResizeObserver 绑定实际 ball 挂载和 collapsed 切换，统一 clamp 读写位置。"],
      "acceptance": ["有 bound task 时 collapsed 永远渲染可交互任务球。", "Studio drawer 聚焦 bound task 不隐藏面板或球。", "刷新、首次收纳、任务刷新与 viewport resize 后展示态和位置正确。"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "浏览器：单/多任务、drawer closed/files/studio focused/trellis、刷新和拖动"],
      "risks": ["条件挂载的 ref/ResizeObserver 时序仍可能造成未 clamp 位置。", "保留旧 prop 名会继续误导未来维护者。"],
      "parallelizable": false,
      "localReview": "确认不存在以 drawer/focus 为理由 return null、display none、visibility hidden 或禁用 collapsed ball 交互的代码路径。"
    },
    {
      "id": "WIDGET-CARD-PROGRESS",
      "title": "实现 Detail-only 卡片和站点连线 workflow 路线",
      "phase": "frontend",
      "order": 2,
      "dependsOn": ["WIDGET-STATE"],
      "files": ["components/YpiStudioSessionWidget.tsx", "app/globals.css"],
      "instructions": ["移除 TaskCard 整卡的 role/button/tabIndex、click 和 Enter/Space 打开详情语义。", "在每卡右上增加唯一的圆形 glass Detail button，带 title、aria-label、hover/focus；仅它调用 onOpen，并隔离 pointer/click 冒泡。", "在标题/meta 下加入 Brief→Design→Implement→Checks→Review 的紧凑节点加连线路线；为标题预留 Detail 安全区。", "从现有 workflow/artifacts/implementationProjection/runtime 做证据化只读投影；缺少可靠证据时显示 neutral/unknown，禁止新增 API/schema 或按百分比虚构完成。"],
      "acceptance": ["点击卡片的标题、进度、路线、meta、空白区和卡片 Enter/Space 不打开 drawer。", "每个 Detail 按钮只打开所属 task，键盘可达且长标题不重叠。", "每个展开卡片都有可见五站路线，当前、attention、failed/blocked、done 和未知可区分。"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "浏览器：单/三任务、长标题、鼠标/键盘 Detail、各 route 状态或 neutral fallback"],
      "risks": ["自定义 workflow 的 artifact 命名无法精确映射五站。", "button 与旧 pointer handlers 可能产生事件串扰。"],
      "parallelizable": false,
      "localReview": "审查卡片不再是可点击详情入口，且路线只用现有 projection 并具有非颜色状态提示。"
    },
    {
      "id": "WIDGET-RESPONSIVE",
      "title": "覆盖多任务、移动端与拖动交互边界",
      "phase": "frontend",
      "order": 3,
      "dependsOn": ["WIDGET-CARD-PROGRESS"],
      "files": ["components/YpiStudioSessionWidget.tsx", "app/globals.css"],
      "instructions": ["桌面 drag 仅从 header/明确 handle 启动；card body、滚动、选择文字和 Detail 按钮不能 pointer-capture 成拖动。", "保留球的 drag threshold：轻点展开，超过阈值不展开。", "移动端保留底部入口和 bottom sheet；复用 Detail-only 卡片及 workflow 路线，不让 drawer focus 关闭入口或 sheet。", "检查多卡堆叠的 Detail 安全区、路线宽度、scroll 和 z-index。"],
      "acceptance": ["三张卡的 Detail 按钮互不重叠、打开正确 task。", "header drag、body scroll/selection、Detail click 和 ball drag/click 互不误触。", "窄屏/移动 bottom sheet 的详情与路线规则与桌面一致。"],
      "validation": ["浏览器：桌面 pointer drag、触摸/窄屏、Tab/Enter、drawer focused 下单/多任务", "检查 360px 卡片和 bottom sheet 的无横向遮挡"],
      "risks": ["pointer capture 与浏览器触摸滚动差异。", "路线在小宽度上可能挤压标题或按钮。"],
      "parallelizable": false,
      "localReview": "复测卡片 body 不会成为拖动或打开详情的隐式热区。"
    },
    {
      "id": "WIDGET-MOTION",
      "title": "实现克制任务球动效与 reduced-motion 降级",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["WIDGET-STATE", "WIDGET-CARD-PROGRESS"],
      "files": ["components/YpiStudioSessionWidget.tsx", "app/globals.css"],
      "instructions": ["将 ball 的视觉动效放入内部层；draggable root 仅保留 position、cursor 与 drag scale。", "实现 160–200ms enter、低频 running halo 与状态切换有限 attention pulse；可靠可见性优先，不为 exit 动画延迟卸载。", "dragging 与 prefers-reduced-motion 下禁用非必要动画和 transition。", "为 workflow 节点状态提供静态文字/图标/tooltip 或 aria 说明，颜色不可为唯一信号。"],
      "acceptance": ["拖动球无 transform 抢夺、抖动或回跳。", "attention 不无限强闪，running 动效低对比。", "reduced-motion 下球、路线和 Detail UI 保持可用且无非必要动效。"],
      "validation": ["浏览器：running、needs_user/failed/blocked 状态切换和拖动", "系统或 devtools prefers-reduced-motion 手测"],
      "risks": ["现有无限 pulse class 可能漏网并与外壳 transform 竞争。", "旧浏览器的 glass/color-mix 降级需保持对比度。"],
      "parallelizable": true,
      "localReview": "搜索所有 ypi-studio widget keyframe，确认 draggable root 不受 animation transform 控制。"
    },
    {
      "id": "QA-REGRESSION",
      "title": "完成收纳、详情、路线与响应式回归",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["WIDGET-RESPONSIVE", "WIDGET-MOTION"],
      "files": [".ypi/tasks/20260710-102813-修复-ypi-studio-任务面板最小化后直接消失而不是收纳为任务球/checks.md", "docs/modules/frontend.md"],
      "instructions": ["逐项执行 checks.md；记录不能覆盖的真实数据状态或浏览器 blocker。", "运行 lint、tsc，并对单/多任务、刷新、drawer focused、移动端、drag、Detail 和 reduced-motion 进行人工验收。", "如最终组件职责或 props 语义改变，更新 docs/modules/frontend.md，尤其移除自动隐藏的旧描述。"],
      "acceptance": ["自动检查通过。", "核心人工矩阵通过，或有明确、可复现的 blocker 记录。", "不存在 API/session-link/任务排序/Studio approval gate 回归。"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "checks.md 全部人工矩阵"],
      "risks": ["静态检查无法覆盖条件 ref、真实 pointer interaction 与动画竞争。", "自定义 artifact 名称可能只触发中性 workflow 路线。"],
      "parallelizable": false,
      "localReview": "重点复测 drawer focused + collapsed、首次收纳、三任务 Detail、移动 bottom sheet 和 reduced-motion。"
    }
  ]
}
```

## 评审与回滚门禁

- 最终审批前：不开始任何子任务，不改生产代码。
- 实现评审：禁止恢复 drawer/focus 隐藏；禁止让整卡重新成为详情入口；禁止为路线添加未经批准的 API/schema。
- 回滚优先级：先保留 `collapsed` 必渲染球与 Detail-only；可移除路线装饰、弱化和新动效，但不得恢复消失问题。