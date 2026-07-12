# UI

## 门禁结论

已触发 UI 原型门禁：本任务改变共享模型选择器的弹窗形态、信息结构、响应式布局和键盘交互。实现前必须由 `ui-designer` 交付基于当前项目视觉变量与实际模型数据形态的 HTML 原型，并由用户审批。

## 派发状态

**已交付**：已生成并交付交互式 HTML 原型：[HTML 原型](model-selector-prototype.html)。

## 交互设计说明

1. **响应式自适应网格**：
   - 桌面端：宽视口下采用自适应多栏布局 (`grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`)，所有 Provider (OpenAI, Anthropic, DeepSeek, OpenCode Go 等) 并列展示，直观横向扫描比较。
   - 移动端：当视口宽度 `<= 640px` 时，自动收敛为纵向单列 Provider 分组卡片布局，便于单手滚动与点按。
2. **Settings 模型策略首栏**：
   - 包含“跟随主会话模型”、“Pi 默认模型”、“本层不指定”等系统策略项。
   - 做为左侧或前置的首个独立分组显示，底色和边框用强调色或微弱差异区分，避免将其伪装成普通的 Provider，保持配置逻辑清晰。
3. **模糊搜索与命中定位**：
   - 支持对 Option Label, Detail, Provider ID, Model ID 及自定义 Keywords 进行模糊搜素。
   - 搜索时实时更新 Provider 内部命中列表，无内容或全部未命中时显示友好空状态。
4. **可访问性与键盘交互**：
   - 模态弹窗使用 `role="dialog" aria-modal="true"`，锁死底层 Body 滚动，且对 Tab / Shift+Tab 进行焦点围拢拦截。
   - 支持 `ArrowUp`、`ArrowDown` 在列表中导航，按 `Enter` 确认选择；按 `Escape`、点击 X 或遮罩可直接关闭选择器。

## 给 UI 设计员的任务单

阅读：

- `AGENTS.md`
- `docs/modules/frontend.md`
- `components/ModelSelect.tsx`
- `components/ChatInput.tsx` 模型选择调用段
- `components/SettingsConfig.tsx` 的 `ModelPolicySelect`
- `components/ProjectSpaceSwitchDialog.tsx` 的模态、焦点与响应式模式
- 本任务 `brief.md`、`prd.md`、`design.md`

交付 `.ypi/tasks/20260712-150737-将模型选择下拉窗改为按提供商分栏的弹窗选择器/model-selector-prototype.html`，并在本文件补充相对链接。不能用纯 Markdown 线框替代 HTML。

原型至少包含：

- 聊天 compact 触发器打开的桌面弹窗。
- Settings field 触发器打开且含“模型策略”首栏的状态。
- 多 provider 正常态、当前选中态、hover/focus 态。
- 搜索命中跨 provider、无结果、清空搜索。
- 320px 移动视口单列布局和长 provider/model 名称。
- Escape、关闭按钮、遮罩关闭、Tab 圈定、方向键与 Enter 的可演示说明或交互。
- 浅色与深色主题至少各一个关键视图。

## 推荐布局

- viewport 居中模态，宽度约 `min(960px, calc(100vw - 24px))`，高度受视口约束。
- 顶部为紧凑标题、搜索框和图标关闭按钮；主体为自适应 provider 网格。
- 每栏是信息分组，不做装饰性嵌套卡片；栏间用边界或背景层次区分。
- 模型项保持紧凑，模型名为主信息，`provider/modelId` 为次信息；当前项使用 check 图标与强调色。
- `<= 640px` 改为单列分组，弹窗接近全宽但保留安全边距。

## 用户审批记录

尚未取得。用户需先审批 HTML 原型以及 `plan-review.md` 汇总方案，之后任务才能进入实现。
