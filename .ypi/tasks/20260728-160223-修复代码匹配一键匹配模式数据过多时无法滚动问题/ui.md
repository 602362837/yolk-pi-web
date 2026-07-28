# UI Summary

## 设计目标

修复 `FileViewer` 共享符号匹配结果区在数据较多时下方结果不可达的问题，同时保持 Yolk Pi Web 当前紧凑、工具化的文件查看器视觉语言。

本方案只定义滚动与高度契约，不改变定义、引用、Java 实现的查询语义、结果字段、排序、打开文件行为或 API 上限；不新增结果计数、关闭按钮、拖拽高度、分页、筛选或虚拟列表。

## HTML Prototype

[打开自包含交互原型：code-match-scroll-prototype.html](./code-match-scroll-prototype.html)

原型审阅控制台位于模拟应用框架之外，仅用于切换 `6 / 50 / 120` 条、空、错误、加载状态及桌面、低高度、375px 视口，不是生产功能。

## 用户路径

1. 用户在 Monaco 中选中或点击符号，通过 `Def`、`Refs`、`Impl`、`Shift+F12`、`Cmd/Ctrl+F12`、`Cmd/Ctrl+Click` 或 `Shift+Click` 发起已有查询。
2. 查询结果进入同一个代码匹配结果面板。
3. 短结果按内容自然收缩；长结果受视口高度约束，仅列表内部产生纵向滚动。
4. 用户通过滚轮、触控板、触屏、滚动条或 Tab 顺序到达末条，激活原生结果按钮后继续调用既有 `onOpenFile(filePath, fileName, line)`。
5. 编辑器始终占用剩余空间，并保有与结果列表互不干扰的独立滚动。

## 信息结构与复用组件

- `file-viewer-root`：`height: 100%` 的纵向 flex 根，保持 `overflow: hidden`。
- `file-viewer-status-bar`：复用现有工具栏；窄屏只横向滚动，不承担纵向滚动。
- `code-match-results-panel`：新增稳定命名的受约束 flex item，只负责面板高度、边框、背景和裁切，本身不滚动。
- `code-match-results-list`：结果面板内唯一纵向滚动容器，承载结果按钮或短状态内容。
- `result-row`：继续使用原生 `button`，保持 `kind / relativePath:line / preview` 三列单行省略和完整路径 `title`。
- `file-viewer-content`：`flex: 1 1 auto; min-height: 0; overflow: hidden`，为 Monaco 保留可计算的剩余高度。
- `MonacoFileEditor`：保持现有 `height: 100%` 与内部独立滚动，不建立结果区和编辑器共用的纵向 scroller。

## Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 6 条 | 面板随内容收缩，编辑器占剩余空间 | 点击或键盘激活任一结果 | 调用既有打开文件/行号行为 |
| 50 条 | 面板达到高度上限，列表出现系统滚动条 | wheel、trackpad、拖动滚动条、触摸、Tab | 列表内滚动，可到末条；外层工作台不跳动 |
| 120 条 | 与 50 条使用相同结构，无分页或虚拟化 | 连续滚动或键盘逐项访问 | 末条保持可达，焦点进入视图 |
| 空结果 | 面板仅显示 `No matches for {symbol}`，按内容自然收缩 | 继续编辑或发起新查询 | 不制造空白滚动区域 |
| 请求错误 | 面板显示完整错误文案，使用文字和错误色 | 修正条件后重新触发现有查询 | 错误不是只靠颜色表达，不截断关键原因 |
| 加载/连续搜索 | 复用当前 `Finding...` 禁用按钮；原型保留上一批短结果并标记区域 busy | 等待查询完成 | `aria-busy=true`；完成后新结果覆盖旧结果 |
| 文件切换 | 按现有状态清理旧结果与错误 | 打开另一文件 | 结果面板移除，编辑器恢复全部剩余空间 |
| 无 `onOpenFile` | 行视觉不伪装可导航，保持当前禁用语义 | 不提供虚假点击结果 | 不触发导航 |

## Responsive

- 桌面：结果面板最大高度不超过文件查看器可用高度约三分之一，并设置绝对上限；短列表不被强行拉高。
- 低高度：最大高度同时受组件高度约束，优先压缩结果面板，但始终给编辑器保留剩余空间；状态栏和结果面板不覆盖 Monaco。
- `≤640px`：沿用 `.file-viewer-status-bar` 横向滚动规则；结果行使用更紧凑的三列轨道，三列仍单行省略，不产生结果区横向滚动。
- 375px：右侧文件面板按现有移动端规则占满工作区；结果面板保持独立纵向滚动，编辑器继续独立滚动。
- 建议实现与验收视口：`1440×900`、`1024×600`、`640×480`、`375×667`。

## Accessibility

- 结果列表使用可识别区域名称，例如 `role="region" aria-label="代码匹配结果"`。
- 加载期间设置 `aria-busy="true"`；错误使用可被辅助技术及时感知的错误语义，空态使用普通状态语义。
- 每条结果继续使用原生 `button`，可通过 Tab/Shift+Tab 聚焦、Enter/Space 激活。
- 结果按钮保留清晰 `:focus-visible`；焦点移动到当前视口外按钮时，由浏览器将该按钮滚入 `code-match-results-list` 可视范围。
- 结果按钮的可访问名称包含 kind、相对路径、行号与 preview；完整路径继续放在 `title`。
- `overscroll-behavior: contain` 隔离滚动链；`-webkit-overflow-scrolling: touch` 和 `touch-action: pan-y` 支持触控滚动。
- 不隐藏结果列表滚动条；使用 `scrollbar-gutter: stable` 避免滚动槽出现时内容横向跳动。
- 不依赖动画表达状态，并遵循 `prefers-reduced-motion`。

## Implementation Notes

- 在 `components/FileViewer.tsx` 将当前单层内联 `maxHeight: 120; overflow: auto` 改为“面板 + 列表”两层稳定 class；结果状态和结果按钮仍由现有状态变量与 `openResult()` 驱动。
- 面板必须是 `flex: 0 1 auto; min-height: 0; overflow: hidden`，高度由桌面、低高度和窄屏约束共同决定。
- 列表必须是面板内唯一纵向 scroller：`min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable`。
- `file-viewer-content` 补齐 `min-height: 0`，继续 `flex: 1` 和 `overflow: hidden`；Monaco 自己滚动，不把滚动转移到内容区或根节点。
- 空态、错误态是短内容，不应获得固定大高度或多余滚动条。
- 加载状态保持现有按钮禁用与连续搜索语义；本滚动修复不引入新的请求状态机。
- 保留现有主题变量：`--bg`、`--bg-panel`、`--bg-hover`、`--bg-selected`、`--border`、`--text`、`--text-muted`、`--text-dim`、`--accent`、`--font-mono`。
- 保留现有结果 kind 色彩映射和 `11px` 紧凑行样式；状态含文字，不以颜色作为唯一信息。
- 不修改 `MonacoFileEditor.tsx` 的搜索快捷键与手势，不修改三个 API route 或结果 schema。
- 在 `docs/modules/frontend.md` 的实现阶段补充共享符号结果区滚动边界；本 UI 阶段不修改生产文档或代码。

## UI Checks

- [ ] `50 / 80 / 120` 条结果均可通过 wheel、trackpad 和滚动条到达末条。
- [ ] 触屏可惯性滚动结果，滚动到边界时不会带动外层 Chat 或抽屉。
- [ ] 结果面板本身不滚动，只有 `code-match-results-list` 纵向滚动。
- [ ] Monaco/Preview/Diff 内容区保留 `min-height: 0`，编辑器滚动不改变结果列表位置。
- [ ] `1440×900`、`1024×600`、`640×480`、`375×667` 下状态栏、结果区、编辑器互不覆盖。
- [ ] 375px 下 kind、路径/行号、preview 三列均为单行省略，结果区无横向溢出。
- [ ] 6 条、空、错误状态按内容收缩，不出现无意义滚动槽。
- [ ] 加载中查询按钮禁用；连续搜索结束后新结果覆盖旧结果。
- [ ] 首条、中间条、末条均可点击并传递正确文件、文件名和行号。
- [ ] Tab/Shift+Tab 可访问全部结果，离屏焦点自动滚入视图，焦点环可见。
- [ ] 系统滚动条未被隐藏，滚动槽稳定，长列表内容不发生明显宽度跳动。
- [ ] 三类 endpoint 与全部既有触发路径复用同一结果区结构。
- [ ] 没有新增结果计数、关闭按钮、拖拽高度、分页、筛选、排序或虚拟列表。

## Review Request

请用户审阅并明确批准 [code-match-scroll-prototype.html](./code-match-scroll-prototype.html)，重点确认：

1. 结果面板受约束、结果列表为面板内唯一纵向滚动容器、编辑器独立滚动的布局关系。
2. 桌面、低高度与 375px 下结果区高度占比及编辑器保留空间。
3. 本次仍严格限定为滚动 bugfix，不新增结果计数、关闭或拖拽功能。

获得明确批准前，不进入生产实现阶段。
