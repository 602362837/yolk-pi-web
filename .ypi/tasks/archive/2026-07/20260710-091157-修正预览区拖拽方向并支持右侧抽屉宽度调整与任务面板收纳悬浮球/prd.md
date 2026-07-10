# prd

## 目标与背景

提升右侧工作区与 YPI Studio session 悬浮任务体验。当前右侧预览区拖拽方向与用户直觉不一致，右侧抽屉宽度不可调整；更重要的是 session-scoped YPI Studio widget 只能表达单任务，遇到同一 session 绑定多个任务时，会出现新任务替换旧任务、证据冲突后 widget 消失等问题。

用户已确认 UI 原型方向基本通过，并新增硬约束：**悬浮球和展开后的多任务面板都必须可拖动，且不能被拖出可视区。**

## 用户价值

- 用户可以根据屏幕和当前工作内容调整右侧抽屉宽度。
- 预览区上下分隔拖拽方向符合“拖动分隔线移动”的直觉。
- Studio 任务悬浮信息不会因新任务出现而丢失旧任务进度。
- 同一 session 内多个已绑定任务可被清晰区分、收纳和恢复，降低误继续/误审批风险。
- 用户可把悬浮球或展开面板拖到不遮挡内容的位置，同时不会因为误拖到屏幕外而找不回来。

## 范围内需求

### R1 预览区垂直拖拽方向修正

- 当拖动“项目空间信息/文件树”底部分隔条向下时，上方区域高度增加；向上时高度减少。
- 保留最小文件树高度与最小预览高度约束。
- 保留现有高度 localStorage 迁移/持久化。

验收：桌面端打开右侧预览面板，拖动分隔条方向与视觉结果一致，无内容区域负高度或溢出异常。

### R2 右侧抽屉宽度可调整

- 桌面端右侧抽屉支持从左边缘拖拽调整宽度。
- 宽度需要设置合理最小/最大值，并持久化到 localStorage。
- 文件、Studio、Trellis 三种 `rightPanelMode` 共享同一宽度。
- 移动端保持现有全屏抽屉，不显示宽度调整 handle。
- 读取持久化宽度、拖拽过程和窗口 resize 时都要 clamp 到当前 viewport 可用范围。

验收：刷新页面后宽度保留；切换 rightPanelMode 不重置宽度；拖拽中无明显内容重排抖动；窄屏/缩窗后面板不会越界不可用。

### R3 Studio 任务面板支持收纳悬浮球

- 桌面端 Studio 悬浮 widget 支持从展开卡片堆叠收纳为小型悬浮球/入口。
- 悬浮球展示任务数量、最高优先级状态（如运行中、需要用户、失败/阻塞）和 Studio 标识。
- 点击悬浮球恢复展开任务面板。
- 当右侧 Studio drawer 已打开并聚焦对应 task 时，避免重复遮挡。

验收：用户可在单任务和多任务场景下收纳/展开；收纳后任务状态更新仍可通过 badge/颜色被感知。

### R4 悬浮球与展开面板均可拖动且不可拖出可视区

- 展开后的多任务面板可拖动，并将位置持久化。
- 收纳后的悬浮球也可拖动，并将位置持久化。
- 展开态和收纳态可共享一个 anchor，也可分别保存位置；无论哪种实现，切换形态后必须 clamp 到可视区。
- clamp 安全边距建议不小于 12–18px；底部需考虑 chat 输入区、移动端底部安全区和右侧 drawer 打开状态。
- 读取 localStorage、拖拽中、拖拽结束、窗口 resize、面板内容尺寸变化、从球展开为面板时都必须执行 clamp。

验收：悬浮球和展开面板无法被拖到屏幕外；缩小窗口后会自动回弹/重算到可见区域；刷新后若历史位置越界也会被修正。

### R5 Session Studio widget 支持绑定当前 session 的多任务

- 同一 session 可同时返回并展示多个**明确绑定当前 session**的 Studio task。
- 绑定依据首版限定为 task `contextIds` 中包含当前 session 的 exact context（如 `pi_<sessionId>` / `pi_transcript_<sessionFileHash>`），runtime pointer 只用于标记 current/primary，不单独构成可展示依据。
- 仅被 transcript / 创建动作提及但未绑定当前 session 的 task 不显示、不占位、不替换已有任务。
- 多任务排序建议：需要用户处理 > 失败/阻塞 > 运行中/等待子任务 > runtime current 指向的已绑定任务 > 最近更新 > 已完成/已归档置底或默认隐藏（实现时按现有 active/archive 展示习惯确认）。
- 点击某个任务应打开右侧 Studio drawer 并聚焦对应 task。

验收：同一 session 同时绑定两个 task 时，两者均有悬浮入口；新建/提及第三个未绑定 task 不会让旧任务消失；新绑定第三个 task 后会加入卡片堆叠。

### R6 修正感知/关联误判、漏判和替换

- 后端 resolver 不应在多个绑定 task 命中时返回 `ambiguous` 导致全部隐藏；应返回可解释的多任务列表和 warnings。
- 未绑定但仅在 transcript/runtime 中出现的任务应作为 diagnostic warning，不进入可展示 `tasks[]`。
- runtime pointer 仍可作为“当前任务/primary”排序依据，但只有当它指向已绑定当前 session 的 task 时才影响可展示列表。
- 保留旧单任务 API 字段兼容：`task` 表示 primary task；新增 `tasks[]`、`primaryTaskKey`、`warnings`。

验收：API 可解释返回多个绑定候选、来源和告警；前端不再因为 ambiguous 直接清空所有 Studio 悬浮入口；旧单任务路径仍能读取 `task`。

## 范围外

- 不更改 Studio task 状态机、approval gate、implementation scheduler。
- 不自动解绑历史 task context；不迁移已有 task.json。
- 不自动绑定 transcript-only / observed task。
- 不改变 YPI Studio child session 审计展示与 usage 口径。

## 已确认 / 待审批点

已确认：

1. UI 原型方向基本通过。
2. 多任务 widget 使用卡片堆叠 B。
3. 未绑定当前 session 的 task 不在当前 session 悬浮区体现。
4. 悬浮球与展开面板都要可拖动，并 clamp 在可视区内。

待主会话/用户最终实现审批：

1. 是否按本 PRD/Design/Implement 进入编码。
2. 已归档 task 是否默认显示在堆叠底部，还是首版只显示 active 绑定任务；建议首版遵循 API scope=all 但 UI 对 archived 置底并弱化。
