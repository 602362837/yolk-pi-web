# Design — 代码匹配长列表滚动边界

## 1. 方案摘要

在 `TextFileViewer` 内把当前单层结果容器改为两层：

1. **结果面板**：文件查看器纵向 flex 中的受约束 item，负责最大高度、边框、背景和裁切，本身不滚动；
2. **结果列表**：面板内唯一纵向 scroller，负责 wheel/trackpad/touch/scrollbar/键盘聚焦可达性。

编辑器内容区继续占据剩余高度，并显式设置 `min-height: 0`，使 Monaco 保持独立滚动。API、查询状态、结果字段、排序、快捷键和 `onOpenFile` 行为全部不变。

UI 设计员已交付：

- [UI 说明](./ui.md)
- [自包含交互 HTML 原型](./code-match-scroll-prototype.html)

## 2. AS-IS

```text
TextFileViewer (.file-viewer-root, column flex, overflow hidden)
├─ status bar (flex-shrink: 0)
├─ result div (flex-shrink: 0, maxHeight: 120, overflow: auto)
└─ content div (flex: 1, overflow: hidden)
   └─ Monaco / Diff / Preview
```

当前风险：

- 滚动、高度和内容状态都落在同一个匿名内联容器，无法形成可审查的布局契约；
- 内容区缺少显式 `min-height: 0`，在嵌套 flex/不同视口下存在最小内容尺寸参与布局的风险；
- 没有结果区专属的低高度、窄屏、触控、滚动链与 scrollbar 规则；
- API 上限 50/80/120，远高于 120px 容器可显示的约 4 行；
- 代码与文档无法通过稳定 class 定位该行为，回归依赖肉眼寻找内联样式。

## 3. TO-BE 结构

```text
TextFileViewer (.file-viewer-root, column flex, overflow hidden)
├─ .file-viewer-status-bar
├─ .code-match-results-panel        # 受约束，overflow:hidden，不滚动
│  └─ .code-match-results-list      # 唯一 vertical scroller
│     ├─ .code-match-result-row × N # 原生 button
│     └─ 或空态 / 错误态
└─ .file-viewer-content             # flex:1; min-height:0; overflow:hidden
   └─ Monaco / Diff / Preview        # 各自现有 scroller
```

### 3.1 结果面板契约

建议稳定样式（实现时可按浏览器实测微调数值，但不得改变职责）：

```css
.code-match-results-panel {
  display: flex;
  flex: 0 1 auto;
  min-height: 0;
  max-height: 120px; /* 兼容 fallback */
  max-height: min(236px, 36%);
  overflow: hidden;
}
```

- 短列表按内容自然收缩；不要固定拉满。
- 长列表受 `236px` 与文件查看器可用高度比例双重约束。
- 低高度/窄屏可通过现有 media query 再收窄比例，但不得让编辑器失去剩余空间。
- 不使用结果数量驱动生产高度，不引入持久化或拖拽。

### 3.2 唯一滚动列表契约

```css
.code-match-results-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}
```

- 不使用项目中 `.file-viewer-status-bar::-webkit-scrollbar { display:none }` 的隐藏规则。
- macOS 是否常驻显示 scrollbar 仍尊重系统设置；产品 CSS 不能主动隐藏，并应保留稳定 gutter。
- 结果行保持单行省略，避免用横向滚动解决长路径/preview。

### 3.3 编辑器内容区契约

```css
.file-viewer-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
```

Monaco 使用现有 `height="100%"`、`automaticLayout` 和内部滚动；Markdown/Diff 继续用各自已有 `overflow:auto`。结果列表和编辑器不得共享一个纵向 scroller。

## 4. 组件与文件边界

| 文件 | 改动 | 不改 |
| --- | --- | --- |
| `components/FileViewer.tsx` | 结果区增加 panel/list 稳定结构、class、region/aria-busy；内容区增加 class | `runSymbolSearch` 请求、结果状态、`openResult`、快捷键接线、API 字段 |
| `app/globals.css` | 结果 panel/list/row/state、高度、滚动、焦点、窄屏/低高度规则 | 全局页面滚动、Monaco 主题、无关弹窗/抽屉 |
| `scripts/test-file-viewer-code-match-scroll.mjs` | focused source contract：结构/class/唯一 scroller/关键 CSS/三 endpoint 共用渲染 | 不把静态断言冒充真实浏览器滚动测试 |
| `package.json` | 增加 focused test 命令 | dependencies/lockfile |
| `docs/modules/frontend.md` | 更新 `FileViewer` 长结果滚动边界 | 其他模块说明 |
| `components/MonacoFileEditor.tsx` | 只读回归对象，预期不修改 | 手势、快捷键、Monaco options |
| 三个 `app/api/files/*/route.ts` | 只读回归对象，预期不修改 | 上限、排序、安全校验、schema |

## 5. 状态与数据流

```text
Monaco cursor/click/shortcut or toolbar
  → FileViewer.runSymbolSearch(endpoint, ...)
  → GET /api/files/{definitions|references|implementations}?cwd&symbol
  → body.results (existing bounded array)
  → setImplementationResults(results)
  → same code-match panel/list
  → click result
  → openResult(item)
  → onOpenFile(item.filePath, getFileName(item.filePath), item.line)
```

状态映射保持现有契约：

| React 状态 | 结果区 |
| --- | --- |
| `implementationResults === null` 且无 error | 不挂载 |
| `implementationResults.length === 0` | 短空态，不制造滚动 |
| `implementationResults.length > 0` | 结果按钮；溢出时 list 内滚动 |
| `implementationError` | 短错误态，文本完整可感知 |
| `implementationLoading` | 现有工具栏 `Finding...`/disabled；如保留旧结果，region `aria-busy=true` |
| 文件切换/重新读文件 | 现有逻辑清空结果/error，panel 卸载 |

本任务不顺带修复请求取消/generation；若实现审查发现现有 race，单独记录，不扩大此滚动 bugfix。

## 6. API 与文件契约

无 API 变更：

- `GET /api/files/definitions`：最多 80 条；
- `GET /api/files/references`：最多 120 条；
- `GET /api/files/implementations`：最多 50 条；
- 输入仍为 allowlisted `cwd + symbol`；输出仍消费 `filePath / relativePath / line / column? / kind / preview`。

不得修改 allowed roots、realpath containment、忽略目录、文件大小上限或排序。

## 7. 响应式与无障碍

- 桌面：短列表自然高；长列表最大约 236px/查看器高度 36%。
- 低高度：优先压缩结果区比例，编辑器必须仍有非零可操作区域；人工以 1024×600、640×480 验证。
- `≤640px`：复用状态栏横向滚动；结果行缩紧 gap/padding/列宽但保持单行省略。
- 375px：结果列表纵向滚动，结果区不横向滚；编辑器独立滚动。
- 结果容器使用 `role="region" aria-label="代码匹配结果"`；加载时 `aria-busy`。
- 行继续是原生 `button`，可见 `:focus-visible`；可访问名称包含 kind、相对路径、行号和 preview。
- Tab 聚焦离屏行时必须自动滚入列表视图；不得隐藏滚动条或只用颜色表达错误/kind。

## 8. 兼容性

- `scrollbar-gutter`、`overscroll-behavior` 不支持时为渐进增强，核心 `overflow-y:auto + constrained height + min-height:0` 仍工作。
- WebKit 使用 `-webkit-overflow-scrolling: touch`；不使用非标准脚本劫持 wheel。
- 不调用 `preventDefault` 接管滚轮，不引入自定义 scrollbar JS。
- 主题继续依赖现有 CSS variables；深浅色无需独立业务逻辑。
- 结果最多 120 条，不需要虚拟化；原生按钮列表性能足够。

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| panel 和 list 都可滚，形成双滚动 | panel 固定 `overflow:hidden`，只有 list `overflow-y:auto`；focused test 静态检查，浏览器人工验证 |
| 结果区挤掉 Monaco | `max-height` 采用像素+比例约束；content `min-height:0`；低高度矩阵 |
| 滚动结果带动外层工作台 | list `overscroll-behavior:contain`；wheel/touch 人工验收 |
| 为“可见 scrollbar”强制破坏系统设置 | 不隐藏 + `scrollbar-gutter:stable`，但尊重 OS overlay policy |
| 移动端路径造成横向滚动 | 三列 `minmax(0,...)` + ellipsis + `overflow-x:hidden` |
| CSS class 与内联样式互相覆盖 | 将结果区布局从内联迁移到稳定 class；避免残留 `maxHeight/overflow` 双来源 |
| 顺手改查询 race/API | 文件边界和范围外清单明确禁止；checker 搜索 route diff |
| 无浏览器自动化时静态 test 误报已修复 | focused test 只做 contract，Checks 明确真实滚动必须人工/Playwright 验收 |

## 10. 回滚

- 回滚 `FileViewer` 两层结构和结果区 class，恢复原内联结果容器；
- 删除对应 CSS/focused script/npm script，并还原 frontend module map；
- 不涉及 API、数据、配置、迁移或用户文件，回滚无数据处理；
- 若发布后需临时止血，可先收窄结果区 CSS 变更，但不得通过隐藏溢出或降低 API 结果上限伪装修复。
