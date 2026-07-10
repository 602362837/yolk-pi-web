# Checks

## 审批门禁

- [x] [ui-prototype.html](./ui-prototype.html) 为可直接打开的独立 HTML，已获用户认可。
- [ ] 主会话已以 [plan-review.md](./plan-review.md) 获得生产实现最终审批，并保存 implementation plan / 切换到 `awaiting_approval`。

## 自动验证

- [x] `npm run lint`
- [x] `node_modules/.bin/tsc --noEmit`

## 收纳、隐藏与位置矩阵

| 场景 | 预期 |
| --- | --- |
| 单任务：展开后收纳 | 显示一个可点击、可拖动、可恢复的球。 |
| 多任务：展开后收纳 | 显示任务数量 badge 与最高紧急状态，轻点展开整个卡片栈。 |
| 初始展开后首次收纳 | ball 已完成位置初始化与 clamp，不在静态、屏外或不可操作位置。 |
| 刷新页面 | 恢复最后的 expanded/collapsed 偏好和各自 clamp 后的位置。 |
| bound task 刷新增减 | 不重置展示态；球 badge/urgency 与卡片内容更新。 |
| drawer closed / files / trellis | 面板或球持续存在。 |
| Studio drawer focused bound task | 展开面板与收纳球均不消失、不失去 pointer/keyboard 可操作性，drawer 不写回展示偏好。 |
| 无 bound task / Chat 未显示 | widget 可以不渲染；之后重新出现任务仍恢复已保存展示态。 |
| viewport resize | 球和面板均留在可见范围。 |

## Detail、路线与拖动矩阵

- [ ] 单任务卡：点击标题、百分比、workflow 连线、meta、运行摘要、空白区及卡片 Enter/Space 均不打开 drawer。
- [ ] 单任务卡：右上 Detail button 有 tooltip、可访问名称、hover/focus ring；pointer/keyboard 均打开正确 task。
- [ ] 多任务卡：每张卡只有自己的 Detail button；三张卡按钮、标题和路线没有重叠，打开 task key 正确。
- [ ] 卡片路线展示 `Brief → Design → Implement → Checks → Review` 的节点与连线；当前/done/attention/failed/blocked/unknown 不只依靠颜色表达。
- [ ] workflow/artifact 证据不足或自定义 workflow 时，路线中性降级且不虚构“已完成”。
- [ ] 面板 header/明确 handle 可拖动；卡片 body、列表滚动、文字选择、路线和 Detail button 不启动拖动或 pointer capture。
- [ ] 点击/按下 Detail 不触发 header drag、球展开或其他卡片事件。
- [ ] 球轻点展开；超过 drag threshold 后不展开，并在释放后持久化已 clamp 位置。

## 响应式、动画与无障碍

- [ ] 360px 桌面悬浮卡中长标题、Detail 和五站路线不横向溢出或遮挡。
- [ ] 移动底部入口和 bottom sheet：单/多任务都可见；卡片继续使用 Detail-only 与五站路线，不因 drawer focus 消失。
- [ ] 收纳/展开过渡短促，无布局跳变或延迟卸载造成入口空窗。
- [ ] running halo 低对比；needs_user/failed/blocked 仅有限次数 pulse，之后静止。
- [ ] 拖动时无 transform 抖动、回跳或位置抢夺。
- [ ] `prefers-reduced-motion` 下没有 pulse、halo、workflow 流动线或非必要 transition；静态状态、badge、文本和 aria 仍可辨认。
- [ ] 仅用键盘可到达 Detail，焦点顺序合理；卡片本体不伪装为按钮。

## 回归检查

- [ ] 保留面板/球独立拖动、localStorage、viewport clamp、任务排序和 live overlay 合并。
- [ ] 未修改 session-link/API response、任务状态机、artifact 完成语义或 Studio approval gate。
- [ ] 打开 Detail 仍经既有 `handleOpenStudioSessionTask(taskKey)`，不会绕过审批。
- [ ] Trellis widget、ChatInput、terminal dock、right drawer 与 Studio widget 的 z-index/点击区域无回归。
- [x] 若组件 prop/行为变化，`docs/modules/frontend.md` 已更新，不再声称 drawer focused 会自动隐藏 widget。

## QA-REGRESSION record — 2026-07-10

### Automated and static verification

- [x] `npm run lint` passed.
- [x] `node_modules/.bin/tsc --noEmit` passed.
- [x] `git diff --check` passed.
- [x] Static review confirms that `AppShell` always mounts the widget for `showChat && studioSessionTasks.length > 0`; `YpiStudioSessionWidget` has no drawer-focus prop or hide path, and Detail actions continue through `handleOpenStudioSessionTask(taskKey)`.
- [x] Static review confirms collapsed ball/panel conditional-mount initialization and clamp observers, independent persisted positions, header-only panel `onPointerDown`, detail event isolation, ball drag threshold/cancel handling, five-station rail state text/symbols, and visual-layer-only transform animation with reduced-motion overrides.
- [x] Static review found and corrected one urgency fallback: a task-level `blocked`/`failed` status now yields the ball’s attention urgency even without implementation status counts.

### Browser/manual matrix status

- [x] Opened the active local development server (`http://localhost:30142`) with Playwright; application loaded and no widget/runtime crash was observed.
- [ ] The active browser session has no session-bound Studio task, so the real-data widget matrix cannot be exercised without creating or binding test tasks. This is a reproducible environment/data blocker, not a reason to infer manual pass results.

Remaining manual cases requiring a bound Studio task: single/multi task collapse/expand and refresh; drawer-focused persistence; header/body/detail/ball pointer behavior; 360px and mobile sheet layout; task status motion; and system reduced-motion.

## WIDGET-CARD-PROGRESS projection repair — 2026-07-10

- [x] Queried the active local endpoint for real bound session `019f4995-50b4-7251-a0b7-1b8228153704`. Its two bound tasks now expose all ten registered artifacts through widget `artifacts.available`, and nine meaningful artifacts through deduplicated `artifacts.completed`; this matches the Task Detail artifact registry rather than the active state's `handoff.md`-only requirement.
- [x] The reopened task's real workflow steps project `Brief done → Design done → Implement active → Checks pending → Review pending`. The rail prioritizes these explicit workflow states, so the pre-existing planning artifacts `checks.md` and `review.md` are counted in the artifact label but do not incorrectly mark runtime Checks/Review done.
- [x] `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed after the repair.
- [ ] Visual browser confirmation of the rendered two-card rail remains with QA-REGRESSION; endpoint data validation does not substitute for interaction/layout verification.

## QA-REGRESSION rerun — real session `019f4995-50b4-7251-a0b7-1b8228153704`

This record supersedes the earlier no-bound-task browser-data blocker.

### Real-data projection and browser verification

- [x] `GET /api/sessions/019f4995-50b4-7251-a0b7-1b8228153704/studio-task` returned two bound tasks. Both report `artifacts.available` = 10 and meaningful `artifacts.completed` = 9, matching their Task Detail artifact registry rather than only the active state's required artifact.
- [x] In Playwright at `http://localhost:30142/?session=019f4995-50b4-7251-a0b7-1b8228153704`, both cards rendered their rails and `产物 9/10`: the implementing task rendered `Brief`/`Design` done, `Implement` attention (one active run), `Checks`/`Review` neutral; the completed task rendered `Brief` through `Checks` done and `Review` current. These states agree with the real workflow projections and do not falsely treat planning-time `checks.md`/`review.md` as completed runtime stages.
- [x] Desktop: collapsed the two-task panel to its numbered task ball and restored it by clicking the ball; no disappearance or runtime error occurred.
- [x] Drawer-focused: opened the Studio drawer, then opened the implementing task through its uniquely labelled Detail button. The drawer focused the correct task while the two-card widget remained visible and operational.
- [x] Detail-only: each real card exposes one accessible `打开《…》详情` button; the rendered card bodies have no button role or card-level detail handler.
- [x] 360px viewport: the real two-task mobile pill remained visible; opening it rendered the bottom sheet with both cards, their Detail controls and five-station rails without horizontal overlap.

### Automated verification rerun

- [x] `npm run lint` passed.
- [x] `node_modules/.bin/tsc --noEmit` passed.
- [x] `npm run test:studio-dag` passed.
- [x] `git diff --check` passed.

### Checker focused rerun — 2026-07-10

- [x] Desktop real session: collapse → task ball → restore; ball drag crossed the threshold, persisted `pi-web:ypi-studio-session-widget-ball-position:v1`, and did not expand during drag.
- [x] Desktop real session: panel header drag persisted `pi-web:ypi-studio-session-widget-position:v2`; reload restored the expanded presentation and clamped panel position.
- [x] Mobile at 360×800: bottom pill and bottom sheet rendered both bound tasks and both five-station rails; Detail opened the correct task drawer and the pill remained mounted.
- [x] Drawer-focused state: Detail opened the current task while the widget remained rendered; the widget did not receive a hide prop/path.
- [x] Reduced motion: Playwright `page.emulateMedia({ reducedMotion: "reduce" })` reported `prefers-reduced-motion: reduce`; widget panel animation/transition computed to `none` and rail content remained visible.
- [x] Current session rail: the checking task showed `Brief/Design/Implement` done, `Checks` current, `Review` neutral; the completed task showed `Brief` through `Checks` done and `Review` current.

### Remaining manual limits

- [ ] Physical touch scrolling/dragging was not separately exercised; pointer drag, threshold handling, mobile layout, and static event isolation were verified.
- [ ] The plan-review approval checkbox above remains an orchestration gate, not a code-validation result.
