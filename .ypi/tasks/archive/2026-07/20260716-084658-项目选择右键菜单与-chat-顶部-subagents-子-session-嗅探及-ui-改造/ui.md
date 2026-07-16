# UI：当前工作区菜单与 Studio Child Sessions 面板

## 门禁结论

本任务改变左侧可见右键交互、Chat 顶栏面板的信息结构、整行导航行为和动画，明确触发 UI 原型硬门禁。

**当前 architect delegated session 按约束不能再派发 Studio member/subagent，因此本轮无法自行指派 `ui-designer`。主会话必须下一步指派 `ui-designer`。在真实 HTML 原型交付并获用户审批前，不得进入 implementing，也不得把本文件的 Markdown 说明视为原型。**

## 原型交付要求

目标文件：[`workspace-subagents-prototype.html`](workspace-subagents-prototype.html)

- 必须是任务目录内可独立打开的自包含 HTML（内联 CSS/JS；不依赖开发服务器数据）。
- 必须基于现有 `SessionSidebar`、`SubagentPanel`、`SessionStatsChips`、`AppShell` 顶栏 action-tag 与项目 CSS 变量的视觉语言。
- HTML 原型交付后，`ui-designer` 应回填本文件的交付状态、原型关键决策和用户需要审批的差异。
- `ui.md` 纯 Markdown、静态图片或文本线框不能替代 HTML 原型。

## 给 ui-designer 的必读材料

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/architecture/overview.md` 的 Studio child/session boundaries
- `components/SessionSidebar.tsx`
- `components/ProjectSpaceSwitchDialog.tsx`
- `components/AppShell.tsx` 顶栏 action-tag 与 panel 容器
- `components/SubagentPanel.tsx`
- `components/SessionStatsChips.tsx`
- `components/ChatWindow.tsx` 的 child audit 只读呈现
- `app/globals.css` 中 sidebar、topbar、popover、reduced-motion 相关样式
- 本任务 [`brief.md`](brief.md)、[`prd.md`](prd.md)、[`design.md`](design.md)、[`checks.md`](checks.md)

## 原型必须覆盖的场景

### A. 当前工作区菜单

1. 普通主空间：项目选择按钮右键后出现菜单；旁边三点触发器打开相同菜单。
2. WorkTree：两个触发器打开相同菜单，并在底部追加分隔后的“归档 WorkTree…”与危险色“删除 WorkTree…”。
3. 菜单至少展示现有动作：编辑项目元数据、编辑空间元数据、项目/空间星标、归档所有会话、归档当前空间、归档项目。
4. 展示右键菜单在视口边缘的定位/clamp，以及点击外部、Escape 后关闭。
5. 左键项目选择按钮仍打开项目空间切换 dialog，不被右键改造影响。

### B. Chat 顶栏 Subagents 面板

至少提供可切换状态或并列示例：

- 首次 loading skeleton/占位（不可使用持续 shimmer）。
- empty：当前父 Chat 尚无 Studio child session。
- active 混合：`running`、`queued`、`waiting_for_user`。
- 最近终态：`succeeded`、`failed`、`cancelled`、`runtime_lost`。
- stale：刷新失败但保留上次数据，顶部出现“数据可能已过期 · 重试”。
- error：首次加载失败且无缓存数据，可重试。
- terminal 超过 20 条时的“仅显示最近 20 条”提示。
- 长 task/subtask/member 文本、10+ rows、窄面板内部滚动。

建议层级：

1. 面板 header：`Studio child sessions`、active/total 摘要、刷新按钮。
2. 需要关注分组：`waiting_for_user` 优先。
3. 运行中分组：running/queued。
4. 最近完成分组：按最新结束时间倒序，最多 20 条。
5. 每行主标题使用 `subtaskId · subtaskTitle` 或 `member · taskTitle`；次行显示 member、状态、相对时间；右侧有明确的进入箭头/“只读”标识。

### C. 整行直接导航

原型必须可演示：

1. hover/focus 后整行呈现可点击 affordance，文案或 tooltip 为“进入只读审计会话”。
2. 点击或 Enter/Space 后，面板关闭，主内容切换到 child audit Chat 示例。
3. child 示例显示现有只读 banner/输入禁用语义，并提供视觉上明确的“Studio child”身份。
4. 不设计“整行展开摘要”作为主行为，不把进入会话藏进二级菜单。
5. 不增加二次确认：该动作与侧边栏选择 session 一致且不写数据；原型应通过明确导航 affordance 降低误点，而不是用确认框打断。

## 交互与可访问性要求

- 顶栏 trigger 使用 button，包含 `aria-expanded`、可理解的 `aria-label`，active/waiting 状态不只依赖彩点。
- 面板内 row 使用 button 或 link 语义；Tab 可达，Enter/Space 激活。
- Escape 与外部点击关闭；关闭后焦点回到 `Subagents` trigger。
- 菜单项和 child row 需要可见 focus ring；危险项有文字和图标，不只使用红色。
- 桌面至少验证 1440px、1024px、900px；窄屏至少验证 640px、375px；200% zoom 不出现不可达内容。
- 面板最大高度受 viewport 限制，列表内部滚动，不滚动整页或遮住 Chat 输入。
- 浅色/深色主题都要有关键视图。

## 动画口径

- 面板打开/关闭：180ms（允许 160–220ms），opacity + 轻微 translate，不改变布局尺寸。
- row 新增/状态切换：约 180ms；完成/失败仅播放一次有限强调，不因 polling 重复。
- active 点：约 2.4–3.2s 低频呼吸，不使用高频 spinner/shimmer；loading 使用静态占位或有限旋转图标。
- `prefers-reduced-motion: reduce`：transition/animation 均为 none，保留静态图标、文字与排序。

## 原型审批问题

原型交付后请用户确认：

1. WorkTree 专属动作在共享菜单底部分隔展示的危险层级是否合适。
2. 面板分组顺序是否采用“等待用户 → 运行中 → 最近完成”。
3. 整行在当前工作台进入 child audit session 的 affordance、只读提示与返回认知是否清晰。
4. 180ms 过渡、低频 active 呼吸、一次性终态反馈是否克制。
5. 640px/375px 下是否使用近全宽下拉面板并保留内部滚动。

## 当前交付与审批状态

- HTML 原型：**已于任务目录交付 (`workspace-subagents-prototype.html`)**。
- 用户原型审批：待主会话/用户审阅确认。
- 实现许可：未授予（原型与计划尚在 planning 阶段审批中）。

### 交付的原型说明
1. **统一工作区菜单**：左侧顶部项目切换按钮（带 Project/WorkTree 徽章）左键模拟弹出原弹窗，右键及三点按钮均弹出完全同源的“当前工作区菜单”。WorkTree 模式下，菜单底部分隔并追加显示归档 WorkTree 及红色删除 WorkTree 危险操作项。
2. **Subagents 顶栏面板**：支持 6 种场景状态实时切换（loading, empty, active-mixed, stale-cache, error, truncated）。状态使用图标和文字诚实表达，不仅依赖颜色。
3. **只读审计导航**：点击子会话行（支持 hover afforadance 和 Enter/Space）后，自动关闭 Subagents 面板，并将当前主工作区切换为 child 只读 audit 会话，顶部显示审计 banner，输入框完全禁用并标识只读，同时支持“返回父会话”。
4. **动画与响应式**：动画时间使用 180ms cubic-bezier，active 点使用 2.8s 呼吸，支持 `prefers-reduced-motion` 静态降级，在 375px/640px/900px/1440px 下展现响应式设计。
