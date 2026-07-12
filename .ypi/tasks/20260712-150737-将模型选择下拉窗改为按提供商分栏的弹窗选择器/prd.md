# PRD

## 目标与背景

模型数量和 provider 增多后，现有约 300px 宽的下拉列表需要连续纵向滚动，跨 provider 比较成本高。目标是用模态选择器提升浏览、比较和检索效率，同时不改变模型选择的数据语义。

## 用户价值

- 无搜索时可按 provider 快速浏览和横向比较可用模型。
- 已知模型或 provider 时可继续通过统一搜索快速定位。
- 聊天与 Settings 使用一致的选择体验和可访问性行为。

## 范围内

- 共享 `ModelSelect` 从锚定下拉层变为 viewport 模态弹窗。
- provider 分栏、当前选中态、空结果态、长名称截断及完整信息提示。
- 模型名称、model id、provider id、provider display name 检索。
- 鼠标、键盘、遮罩、Escape、焦点圈定与关闭后焦点恢复。
- 桌面和移动/窄屏响应式布局。
- Settings 特殊策略项与普通 provider 模型共同展示。

## 范围外

- `/api/models`、模型注册、认证或 provider 配置变更。
- 模型收藏、最近使用、排序配置、批量选择。
- thinking level、tool preset 等其他下拉控件改造。
- 改变选中即生效、streaming 时禁用等既有业务规则。

## 需求与验收标准

1. 触发器外观和 `value/onChange/disabled/fallbackLabel` 语义保持兼容。
2. 打开后显示带遮罩的 `aria-modal` 弹窗，标题与关闭按钮清晰，搜索框获得焦点。
3. 桌面端每个 provider 为独立栏；栏头优先 display name，并保留 provider id 辨识信息；栏内展示模型名和 `provider/modelId`。
4. Settings 的非模型策略项作为“模型策略”独立栏展示，不伪装为 provider。
5. 搜索沿用现有模糊匹配能力；无匹配项时显示明确空态；清空后恢复完整分栏。
6. 当前值在对应项中可见标识；单击或 Enter 选中后调用一次 `onChange`（值变化时）并关闭。
7. Escape、关闭按钮、遮罩点击关闭且不变更值；关闭后焦点回到原触发器。
8. Tab/Shift+Tab 不离开弹窗；方向键和 Enter 可完成选项导航与选择。搜索过滤后高亮索引必须有效。
9. 320px 宽视口不横向溢出，改为单列 provider 分组；桌面栏过多时只允许弹窗内容区受控滚动，不挤压栏内文本。
10. 浅色/深色主题下选中、悬停、焦点、边框均可辨识，reduced-motion 下无必要动画。

## 未决问题

- 分栏采用并列 provider 列还是左侧 provider 导航。推荐并列列。
- provider 很多时采用横向滚动还是自动换行网格。推荐自适应网格并纵向滚动，避免横向浏览；需 HTML 原型验证密度。
- 是否展示每栏模型数量。推荐展示，便于扫描，但属于原型审批项。
