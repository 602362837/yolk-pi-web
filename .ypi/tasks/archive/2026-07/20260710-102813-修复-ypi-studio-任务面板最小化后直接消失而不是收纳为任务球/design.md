# Design

## 方案摘要

在 `YpiStudioSessionWidget` 中明确区分渲染资格和用户展示态：只有无 bound task 才不渲染；有任务时 `expanded` 渲染卡片面板、`collapsed` 始终渲染任务球。drawer/focus 仅作为非破坏性的视觉上下文，不能隐藏组件或改写 localStorage。

同时将卡片改为只读容器，收敛详情打开到每卡 Detail 按钮；在卡片信息区加入由现有只读 projection 派生的五站连线式 workflow 路线。保持现有 session-link、任务排序、API 数据契约与右侧 drawer 开启回调不变。

## 已观察的根因与约束

1. `YpiStudioSessionWidget` 现有 `hiddenWhenFocusedTaskKey` 命中时会计算 `isDimmed`，随后在桌面端 `return null`；`AppShell` 会在 Studio drawer 聚焦 bound task 时传入此值。注释称为 dim，实际行为为 hide，可直接吞掉 collapsed ball。
2. ball 的条件挂载使其位置/`ResizeObserver` 初始化必须以实际 ball ref 挂载为准；当前 effect 不随 `expanded` 变化，首次从展开态收纳存在位置未初始化或未 clamp 的风险。
3. `TaskCard` 目前是整卡 `role="button"` 并绑定 click/Enter/Space 打开详情；这与 Detail-only 冲突。
4. 现有 attention ball pulse 与拖动外壳都可能写 `transform`；新动效不能继续竞争 draggable root 的位移。

实施员须先在浏览器复现第 1、2 项并记录结果；第 1 项是代码可见的直接路径，但不应排除第 2 项同时存在。

## 状态、渲染与持久化契约

```text
hasBoundTasks = tasks.length > 0
renderWidget = showChat && hasBoundTasks
presentation = expanded | collapsed       // 既有全局 localStorage 偏好

a) !renderWidget  -> 不渲染
b) presentation=expanded  -> 展开悬浮卡片面板
c) presentation=collapsed -> 可见、可拖动、可恢复的任务球
d) drawerFocusedTaskKey  -> 仅视觉上下文，不得影响 a/b/c 或写入展示偏好
```

- 删除会隐藏的 `hiddenWhenFocusedTaskKey` 语义；建议替换为语义准确的 `drawerFocusedTaskKey?: string | null`，或由 `AppShell` 不再传递该 prop。若保留，应仅生成 data/class 供视觉弱化使用。
- drawer focus 时球维持正常可见/可操作；展开面板可按已确认原型做轻微、可访问的弱化或边界避让，但禁止 `display: none`、`visibility: hidden`、`pointer-events: none` 或低到不可辨认的 opacity。
- `pi-web:ypi-studio-session-widget-expanded`、面板位置 v2、球位置 v1 继续使用。task 列表刷新、drawer 开关、Detail 打开/关闭都不得改写这些值。
- ball/面板每次条件挂载、viewport resize、parent/element `ResizeObserver` 和任务数量变化后，以当前 element 尺寸读取位置并统一 `clampPosition`；拖动结束才持久化位置。

## 组件边界与数据流

### `components/AppShell.tsx`

- 仍以 `showChat && studioSessionTasks.length > 0` 决定挂载，继续过滤 bound-task live overlays。
- 保持 `handleOpenStudioSessionTask(taskKey)` 作为唯一的 drawer 打开/聚焦 callback。
- 不再向 widget 传递“隐藏”指令；若传递 focus，上下文不得改变 `presentation` 或 widget 渲染资格。

### `components/YpiStudioSessionWidget.tsx`

- 将 `expanded` 解释为 presentation，去除 `isDimmed -> return null` 路径；修复 ball ref 实际挂载后的 position observer 生命周期。
- 保留现有卡片排序、live run 合并、球的数量 badge 和 urgency 选择。
- `TaskCard` 移除 card-level button role、tabIndex、click 和 Enter/Space 打开详情语义。新增右上 `button type="button"` Detail；其 pointer down/click 阻止事件串扰，拥有 title、`aria-label`、键盘 focus ring。
- panel drag 只绑定 header/明确 handle；不得在 card list/body 捕获 pointer。球仍按阈值区分 drag 与轻点展开。
- 新增内部 `BallVisual`（或等价内层）承载 halo/pulse/enter 样式；可拖动 ball 外壳只承载 position、cursor 和 drag scale。

### 站点连线式 workflow 路线

- 在每个 `TaskCard` 的标题/meta 下、运行摘要前渲染紧凑的 `WorkflowRail`（可为局部 helper，不必新增共享模块）。五站固定为 `Brief / Design / Implement / Checks / Review`，节点间有连续连线。
- 只消费现有 `YpiStudioTaskWidgetProjection`：`workflowName/workflowId`、`artifacts.required/completed`、`implementationProjection`、task/runtime status 和已有 progress。不得为此改 API、任务 JSON、状态机或 session-link response。
- 阶段状态按证据投影：已完成 artifact/终态 implementation 可标 done；活跃 implementation/runtime 可标 current/running；`needs_user`、failed、blocked 显示相应 attention/failure；没有可验证映射时保持 neutral/unknown。实施时以 `artifacts.required` 与 `completed` 的真实文件名做别名映射，不能仅依百分比声称站点完成。
- 360px 卡片采用等分小节点、短标签/tooltip；完整站名和阶段状态须可被辅助技术读取。长标题与右上 Detail 按钮预留独立空间。移动 bottom sheet 重用同一卡片路线；收纳球和移动 pill 只显示摘要。

### `app/globals.css`

- 增加 scoped classes：glass Detail button、workflow rail station/line states、球内层 enter/halo/finite attention、drawer-focus tone。
- `prefers-reduced-motion` 必须覆盖上述所有新增动画和 transition；节点状态仍以静态颜色、图标/文本、tooltip/aria 表达。
- keyframes 不得写 draggable root 的 `transform`。已有无限强 pulse 如需替换，改为仅状态切换触发的有限次数 animation。

## 动画契约

| 场景 | 层级与方案 | 限制 |
| --- | --- | --- |
| 收纳为球 / 展开 | 内层淡入与 0.96→1 轻缩放 | 160–200ms；可靠渲染优先于 exit 动画 |
| running | 球内部 halo 低对比透明度呼吸 | 约 2.4s；不 scale draggable shell |
| needs_user / failed / blocked | 球内部 ring pulse | 状态变化时最多 2 次、约 1.6s 后静止 |
| 拖动 | 外壳 position/drag scale | 禁用内层进入与 attention 动画 |
| reduced motion | 静态状态样式 | 无 pulse、halo、非必要过渡 |

## 兼容性、风险与回滚

- 仅用当前 projection 推导五站可能遇到自定义 workflow/非标准 artifact 名称；必须中性降级，不能伪造完成。若未来需要精确的 workflow 专属路线，另立 API/schema 任务。
- drawer 弱化若降低发现性，优先取消弱化而非隐藏入口。
- Detail button 与 pointer capture/scroll 的组合容易误触；以 header-only drag、按钮 stopPropagation 和浏览器手测控制。
- `color-mix`/backdrop filter 可在旧浏览器降级为实色背景，不影响按键、进度或可见性。
- 安全回退顺序：保留 `collapsed` 必渲染球和 Detail-only，禁用新动效/弱化/路线装饰；不得恢复 focus 导致的隐藏。