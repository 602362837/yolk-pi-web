# Design

## 方案摘要

保留 `ModelSelect` 作为聊天与 Settings 的共享边界，内部将位置计算型 portal dropdown 改为 viewport 模态。继续使用现有 `ModelSelectOption` 和搜索评分函数，通过稳定的 group 投影生成 provider 栏；调用方和 `/api/models` 不变。

## 影响模块与边界

- `components/ModelSelect.tsx`：主要改动。模态状态、分栏投影、搜索、键盘导航、焦点管理、响应式类名。
- `app/globals.css`：仅在响应式网格、focus-visible 或 reduced-motion 无法用局部样式清晰表达时增加 scoped 样式。
- `components/ChatInput.tsx`：原则上无需业务改动，仅回归 compact trigger、streaming disabled 和当前模型 fallback。
- `components/SettingsConfig.tsx`：原则上无需业务改动，验证“模型策略”group 成为独立首栏。
- `app/api/models/route.ts`、`hooks/useAgentSession.ts`：不改，仅作为契约回归面。

## 数据流与契约

1. 调用方将模型映射为 `ModelSelectOption[]`，`value` 仍是调用方定义的 opaque string。
2. `ModelSelect` 以 `group ?? provider ?? "Models"` 建栏；同名 group 保持输入首次出现顺序，栏内保持原 option 顺序。
3. 搜索继续对 label/detail/provider/modelId/group/value/keywords 评分；有查询时按分数排序，但结果重新投影到各 group 栏。
4. 键盘高亮应使用过滤后扁平 option 序列，视觉项通过 option value/index 映射；过滤变化时钳制或重置索引。
5. 选中时仅当 nextValue != value 调用一次 `onChange`，随后关闭并恢复 trigger focus。
6. 所有关闭路径不触发 `onChange`。

## 模态交互

- portal 至 `document.body`，遮罩覆盖 viewport，`role="dialog" aria-modal="true"`。
- 打开时保存此前焦点并聚焦搜索；关闭/卸载时恢复触发器。
- document keydown 处理 Escape 和 Tab focus trap；搜索输入处理 ArrowUp/ArrowDown/Enter。可选 Home/End 作为增强，不作为首版阻塞。
- backdrop 仅在 `event.target === event.currentTarget` 时关闭，内容点击不冒泡关闭。
- 打开时锁 body 滚动，并在 cleanup 恢复原值，避免底层页面滚动；需注意嵌套 Settings modal 的滚动状态恢复。

## 响应式与可访问性

- 桌面使用 `repeat(auto-fit, minmax(...))` provider 网格；整体纵向滚动，各栏内部不建立互相争抢的独立滚动区。
- 移动端单列，标题/搜索固定或保持可见需由原型决定。
- listbox/option 语义保留；搜索输入通过 `aria-controls`/`aria-activedescendant` 关联时应确保 option id 稳定。
- 关闭按钮使用熟悉的 X 图标和 tooltip/aria-label；搜索使用项目已启用的图标库时优先复用，否则保持现有图标策略。

## 兼容性

- 不改变 props，`placement` 可暂时保留但在 modal 模式下标记为兼容性 no-op，避免一次性修改调用方；后续可单独清理。
- fallback value 不在 options 中时触发器继续显示 `fallbackLabel`；弹窗无虚构选中项。
- 空 options 时沿用调用方不渲染或显示空态的既有决策。

## 风险与缓解

- provider 数量过多导致视觉密度低：用自适应网格、统一最小栏宽和整体滚动；由 HTML 原型确认。
- 搜索排序后键盘索引与分栏 DOM 顺序不一致：只从同一 `filteredOptions` 派生两者并增加纯函数测试或聚焦人工回归。
- Settings 模态内再开模型模态造成 z-index/focus 冲突：portal z-index 高于现有 Settings，关闭后恢复到 Settings 内触发器；验证 Escape 只关闭顶层。
- body scroll lock cleanup 覆盖外层锁定：保存并恢复原 inline overflow，不直接固定为空字符串。

## 回滚

改动集中在共享 `ModelSelect` 与可选 scoped CSS；回滚这些文件即可恢复锚定下拉，不涉及数据迁移或 API 回滚。
