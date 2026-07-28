# Brief — 修复代码匹配结果过多时无法滚动

## 问题摘要

用户反馈：代码匹配的“一键匹配”路径在返回较多数据时，没有可用/可见的纵向滚动，导致下方结果不可达。

## 代码定位与证据

本规划将“代码匹配 / 一键匹配”对应到当前文件编辑器的符号导航结果区：

- `components/MonacoFileEditor.tsx`
  - `Cmd/Ctrl + Click`：定义下钻，处于定义/接口时查找引用；
  - `Shift + Click`：定义处查实现，使用处向上查定义；
  - `Shift+F12`：查引用；`Cmd/Ctrl+F12`：查 Java 实现。
- `components/FileViewer.tsx`
  - `runSymbolSearch()` 统一请求 `definitions | implementations | references`；
  - 匹配结果由 `implementationResults` 共用一个结果区展示；
  - 当前结果区只有内联 `maxHeight: 120`、`overflow: "auto"`，没有独立命名的布局/滚动契约，也没有针对低高度、触控、滚轮链和稳定滚动槽的验收。
- API 结果上限足以触发长列表：
  - `app/api/files/implementations/route.ts`：最多 50 条；
  - `app/api/files/definitions/route.ts`：最多 80 条；
  - `app/api/files/references/route.ts`：最多 120 条。
- `TextFileViewer` 根节点是 `height: 100%` 的纵向 flex + `overflow: hidden`；结果区与编辑器内容区是同级 flex item。修复必须明确哪一层占用高度、哪一层滚动，并给编辑器内容区保留 `min-height: 0`，避免父子 overflow 相互吞掉滚轮或把结果撑出视口。
- `app/globals.css` 目前只有窄屏 `.file-viewer-status-bar` 横向滚动规则，没有符号匹配结果区专属样式。
- `docs/modules/frontend.md` 仅说明 `FileViewer` 提供 Java implementation lookup，尚未记录共享符号结果区的滚动边界。

## 推荐修复边界

采用最小前端修复，不改匹配算法和 API：

1. 将匹配结果区拆为“受约束面板 + 唯一纵向滚动列表”，为两层增加稳定 class。
2. 面板参与文件查看器纵向 flex，高度受桌面/低高度/窄屏视口约束；内部列表设置 `min-height: 0` 与纵向 overflow，确保 50/80/120 条结果均可到达。
3. 保留编辑器为独立剩余空间，不能让结果列表扩大到挤掉或覆盖 Monaco。
4. 加入稳定 scrollbar gutter、触控惯性与 overscroll containment；滚动结果时不误滚外层工作台。
5. 保留现有结果行点击打开文件/行号、空态、错误态、loading、三类 endpoint 和快捷键语义。
6. 不增加分页、虚拟列表、筛选、排序、拖拽改高或 API schema。

## UI 原型门禁

本任务改变用户可见交互与长列表可达性，触发 UI 原型硬门禁。必须由 `ui-designer` 交付自包含 HTML 原型，并由用户审批后才能实现。原型至少覆盖：

- 大量匹配结果与可见滚动；
- 编辑器与结果区独立滚动；
- 桌面、低高度和 375px 窄屏；
- 空、错误、加载、少量结果；
- 鼠标滚轮、触控、键盘聚焦后的结果可达性。

## 假设与待确认

- **当前证据支持的默认假设**：用户所称“一键匹配”即 Monaco 文件查看器的点击/快捷键符号匹配路径，而不是仓库外另一个业务页面。
- 若主会话掌握截图、URL 或复现步骤，且目标并非 `FileViewer` 符号结果区，应在审批前纠正范围；当前计划不得扩散到不相关页面。
- 推荐不增加结果区关闭按钮、结果计数或可拖拽高度，以保持本次为滚动 bugfix；如产品需要这些能力，应作为明确范围变更重新审批。

## 规划结论

问题可以在现有前端边界内解决：`FileViewer` 负责结果区结构与状态，`app/globals.css` 负责稳定滚动/响应式契约，API 保持不变。完成 UI 原型与计划审批后再进入实现。
