# Checks — 代码匹配长列表滚动修复

## 1. 需求覆盖检查

| ID | 检查项 | 证据/方法 | 通过标准 |
| --- | --- | --- | --- |
| C1 | 目标页面正确 | 对照用户复现、`FileViewer` toolbar/Monaco 手势 | 确认“一键匹配”是当前共享符号结果区；若不是则停止实现并修订计划 |
| C2 | 50/80/120 条可达 | 浏览器读取 list `clientHeight/scrollHeight`，滚动至末条 | `scrollHeight > clientHeight` 且末条完整可见/可激活 |
| C3 | 唯一 scroller | computed style + DOM topology | panel `overflow:hidden`；只有 list `overflow-y:auto/scroll` |
| C4 | 编辑器独立滚动 | 分别滚结果 list 与 Monaco | 一方滚动位置变化不改变另一方滚动位置 |
| C5 | 高度链稳定 | 桌面/低高度/窄屏截图或测量 | toolbar、结果面板、编辑器不覆盖；编辑器有非零可操作高度 |
| C6 | 三类 endpoint 共用 | 定义/引用/实现各触发一次 | 均渲染同一 panel/list 结构，不出现模式专属滚动差异 |
| C7 | 全部既有触发路径 | toolbar、Cmd/Ctrl+Click、Shift+Click、Shift+F12、Cmd/Ctrl+F12 | 查询语义不变，结果区滚动一致 |
| C8 | 打开结果不回归 | 点击首条/中间条/末条 | `onOpenFile` 打开正确 file/line；长路径 title 保留 |
| C9 | 状态不回归 | 6 条、空、error、loading、连续查询、文件切换 | 短状态自然收缩；loading disabled；切文件清除旧结果 |
| C10 | 范围不扩张 | 审查 diff | 无分页/筛选/计数/关闭/拖拽/虚拟化；API/设置/快捷键不改 |

## 2. 布局与滚动矩阵

### 2.1 视口

| 视口 | 长列表 | 核心检查 |
| --- | --- | --- |
| 1440×900 | 120 条 | panel 达上限、list 可滚底、Monaco 仍宽敞 |
| 1024×600 | 80/120 条 | 低高度比例生效，无覆盖/双滚动 |
| 640×480 | 50/120 条 | toolbar 横向可达，结果纵向可滚，编辑器仍可操作 |
| 375×667 | 50/120 条 | 结果无横向溢出，三列 ellipsis，touch 可滚底 |

### 2.2 输入方式

- [ ] 鼠标 wheel 只滚结果 list；到边界不明显带动外层工作台。
- [ ] 触控板连续滚动可到末条。
- [ ] 拖动系统 scrollbar thumb 可到任意位置。
- [ ] 触屏或 touch emulation 支持 `pan-y`/惯性滚动。
- [ ] Tab/Shift+Tab 聚焦离屏行时自动滚入 list 视图。
- [ ] Enter/Space 激活聚焦结果。
- [ ] 在 Monaco 内滚动时结果 list 的 `scrollTop` 不变；反之亦然。

### 2.3 状态

- [ ] 6 条：按内容自然收缩，无不必要大空白。
- [ ] 50 条：滚动产生，末条可达。
- [ ] 80 条：定义上限场景可达。
- [ ] 120 条：引用上限场景可达。
- [ ] 空：`No matches` 完整显示，无假滚动条。
- [ ] error：错误文字完整可感知，不只靠颜色。
- [ ] loading：现有按钮 `Finding...`/disabled；region `aria-busy` 正确。
- [ ] 连续查询：新结果按现有语义替换旧结果，布局不抖到不可用。
- [ ] 文件切换：结果 panel 卸载，编辑器恢复剩余空间。

## 3. CSS/DOM 质量检查

- [ ] `.file-viewer-root` 继续是 `height:100%` column flex + `overflow:hidden`。
- [ ] `.code-match-results-panel` 是受约束 flex item、`min-height:0`、`overflow:hidden`。
- [ ] `.code-match-results-list` 是唯一 vertical scroller，包含 `min-height:0`、`overflow-y:auto`、`overflow-x:hidden`。
- [ ] list 使用 `overscroll-behavior:contain`、`scrollbar-gutter:stable`、touch 增强；缺少增强支持时核心 overflow 仍工作。
- [ ] `.file-viewer-content` 有 `flex:1`、`min-height:0`、`overflow:hidden`。
- [ ] panel/list 不匹配 `.file-viewer-status-bar::-webkit-scrollbar { display:none }` 或其他 scrollbar 隐藏规则。
- [ ] 结果行 `minmax(0,...)`/`min-width:0` + ellipsis，不产生横向 list 滚动。
- [ ] 不使用 JS wheel interception、全局 body overflow 修改或自定义滚动同步。
- [ ] 不存在内联 `maxHeight/overflow` 与 CSS class 的互相覆盖双来源。

## 4. 可访问性检查

- [ ] 结果区有 `role="region"` 和可理解的 `aria-label`。
- [ ] loading 状态 `aria-busy=true`，结束后恢复 false。
- [ ] 每条结果为原生 button；可访问名称包含 kind、相对路径、行号、preview。
- [ ] `:focus-visible` 在深浅主题均清晰，聚焦行不会被 overflow 裁掉。
- [ ] Tab 到离屏结果时浏览器把该行滚入结果 list，而不是滚动整个页面。
- [ ] error/empty/loading 有文字，kind 色彩不是唯一信息。
- [ ] `prefers-reduced-motion` 下无状态缺失；本修复不依赖动画。

## 5. API、安全与回归边界

- [ ] `app/api/files/definitions/route.ts` 保持最多 80、允许根/realpath/schema/排序不变。
- [ ] `app/api/files/references/route.ts` 保持最多 120、允许根/realpath/schema/排序不变。
- [ ] `app/api/files/implementations/route.ts` 保持最多 50、Java 匹配/schema/排序不变。
- [ ] `components/MonacoFileEditor.tsx` 的 Cmd/Ctrl+Click、Shift+Click、Shift+F12、Cmd/Ctrl+F12 接线不变。
- [ ] File save、SSE watch、Diff、Markdown/HTML preview、Add Chat、word wrap 不回归。
- [ ] 没有新增 dependency、config、storage、network route 或用户数据迁移。
- [ ] 无关工作树改动未被覆盖、格式化或纳入本任务结论。

## 6. 自动验证

实现后执行：

```bash
npm run test:file-viewer-code-match-scroll
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

focused script 最低要求：

1. 读取 `components/FileViewer.tsx` 与 `app/globals.css`；
2. 断言 panel/list/content class 拓扑和关键 CSS；
3. 断言 panel 非 scroller、list 唯一 vertical scroller；
4. 断言结果仍为 button/`openResult` 路径；
5. 断言三 endpoint 仍走共享结果渲染；
6. 避免以脆弱的整文件快照或行号断言代替语义检查。

> 静态 focused test 不能证明 computed layout。C2–C9 的浏览器矩阵仍是完成门禁。

## 7. 原型与规划产物检查（本轮）

- [ ] `brief.md` 有代码定位、范围、假设与 UI gate。
- [ ] `prd.md` 有范围内/外、R1–R10 与未决问题。
- [ ] `ui.md` 链接自包含 HTML，不以纯 Markdown 替代。
- [ ] `code-match-scroll-prototype.html` 可切换 6/50/120、空/error/loading 和 desktop/low/375px。
- [ ] 原型中结果 list 与 editor 可分别滚动，review console 明确不是生产功能。
- [ ] `design.md` 说明高度链、唯一 scroller、API 不变、兼容/风险/回滚。
- [ ] `implement.md` 同时包含人类子任务表与合法 fenced `json ypi-implementation-plan`。
- [ ] `plan-review.md` 链接 PRD/UI/HTML/Design/Implement/Checks/Brief 并明确请求审批。
- [ ] 未修改生产代码、任务状态、implementationPlan、commit/push/merge。

## 8. 重点失败判定

以下任一项应判为未完成/需返工：

- 只能看到首屏结果，末条无法通过任何输入方式到达；
- panel 和 list 同时滚动，或外层工作台成为结果 scroller；
- 通过扩大根容器/取消 `overflow:hidden` 让整个页面滚动来规避；
- 结果区占满高度导致 Monaco 不可操作；
- 通过降低 API 上限、截断前端结果或分页隐藏问题；
- 只在 HTML 原型可滚，生产组件没有同等 class/高度链；
- 只跑静态 source test 就声称真实滚动通过；
- 顺带修改查询/API/快捷键或引入未经审批的新 UI 功能。
