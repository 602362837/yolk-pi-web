# 计划审批书：修复代码匹配长结果列表无法滚动

## 审批请求

本轮已完成架构规划，并由 **UI 设计员**基于现有 `FileViewer` 交付自包含 HTML 原型。请先确认目标页面与原型，再明确回复“批准/确认开始实现”或提出修改意见。

**批准前只保留规划产物：不修改生产代码，不进入 `implementing`，不派实现员。**

## 审批材料

- [Brief：问题证据、代码定位、范围假设](./brief.md)
- [PRD：R1–R10、范围内外与验收标准](./prd.md)
- [UI：交互、状态、响应式、无障碍与审批请求](./ui.md)
- [HTML 原型：代码匹配长列表滚动](./code-match-scroll-prototype.html)
- [Design：高度链、唯一 scroller、API/兼容/风险/回滚](./design.md)
- [Implement：执行步骤、人类子任务表与机器计划](./implement.md)
- [Checks：自动检查与真实浏览器验收矩阵](./checks.md)

## 先确认目标范围

代码检索后，当前仓库与“代码匹配 / 一键匹配 / 数据过多”最吻合的生产入口是：

- `components/MonacoFileEditor.tsx`：`Cmd/Ctrl+Click`、`Shift+Click`、`Shift+F12`、`Cmd/Ctrl+F12`；
- `components/FileViewer.tsx`：`runSymbolSearch(definitions|references|implementations)` 和共享结果区；
- 三个 API 最多返回 80 / 120 / 50 条，而结果区当前只使用匿名内联 `maxHeight:120; overflow:auto`。

**请确认用户反馈指的就是 FileViewer 符号导航结果区。** 若主会话掌握的截图/URL/复现步骤指向其他页面，请不要批准当前实现，应先退回修订 PRD/UI/Design。

## PRD 摘要

目标：不改变匹配数据和操作语义，让 50/80/120 条定义、引用、Java 实现结果在桌面、低高度和 375px 视口均可滚动到底，同时保留可操作的 Monaco 区域。

范围内：

- 共享结果区的 flex 高度链和唯一纵向滚动容器；
- 工具栏、点击与快捷键触发路径一致生效；
- wheel/trackpad/touch/scrollbar/键盘可达；
- 短结果、空、错误、loading、连续查询与文件切换回归；
- 响应式、无障碍、focused contract、文档和浏览器验收。

范围外：

- API/搜索算法/上限/排序/schema；
- 分页、筛选、计数、关闭按钮、拖拽高度、虚拟列表；
- Monaco/Settings/保存/SSE/Diff/Preview/Add Chat 重构。

完整标准见 [PRD](./prd.md)。

## UI 原型门禁

此任务改变用户可见交互，已触发硬门禁。UI 设计员交付：

- [UI 方案](./ui.md)
- [可交互 HTML 原型](./code-match-scroll-prototype.html)

原型外部审阅控制台可切换：

- `6 / 50 / 120` 条；
- 空、错误、加载；
- 桌面、低高度、375px。

控制台只用于评审，不是生产功能。请在原型中分别滚动结果列表和编辑器，确认：

1. 结果面板受高度约束，但 **只有内部结果列表纵向滚动**；
2. Monaco 始终占用剩余空间并独立滚动；
3. 长列表可到末条，短/空/error 不被强行拉高；
4. 低高度与 375px 的结果区高度占比可接受；
5. 本次不新增计数、关闭和拖拽功能。

## Design 摘要

目标结构：

```text
.file-viewer-root (column flex, overflow hidden)
├─ .file-viewer-status-bar
├─ .code-match-results-panel   # constrained, overflow hidden, not a scroller
│  └─ .code-match-results-list # sole vertical scroller
└─ .file-viewer-content        # flex:1, min-height:0, overflow hidden
   └─ Monaco / Diff / Preview  # existing independent scroller
```

关键约束：

- panel 只负责最大高度与裁切；list 使用 `overflow-y:auto + min-height:0`；
- `overscroll-behavior:contain`、`scrollbar-gutter:stable`、touch 惯性为渐进增强；
- 不隐藏结果 scrollbar，不用 JS 劫持 wheel；
- 内容区补齐 `min-height:0`，避免 flex 最小内容高度吞掉剩余空间；
- API、结果字段、`runSymbolSearch`、`openResult` 和快捷键不变；
- 最多 120 条，不引入虚拟化。

完整方案见 [Design](./design.md)。

## Implementation Plan 摘要

| Order | ID | 子任务 | 依赖 | 主要文件 |
| ---: | --- | --- | --- | --- |
| 10 | `CM-SCROLL-01` | panel/list/content 结构、CSS、响应式与 a11y | — | `components/FileViewer.tsx`, `app/globals.css` |
| 20 | `CM-SCROLL-02` | focused contract、frontend 文档、真实浏览器矩阵 | 01 | `scripts/test-file-viewer-code-match-scroll.mjs`, `package.json`, `docs/modules/frontend.md` |

计划 `maxConcurrency=1`，避免测试与 UI 结构并行固化错误契约。机器可读 fenced `json ypi-implementation-plan` 在 [Implement](./implement.md)；本架构师运行未直接写 `task.json` 的 `implementationPlan`。用户批准后由主会话保存计划并按状态机进入实现。

## Checks 摘要

自动验证：

```bash
npm run test:file-viewer-code-match-scroll
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

真实浏览器门禁：

- 1440×900、1024×600、640×480、375×667；
- 6/50/80/120、空/error/loading；
- wheel、trackpad、scrollbar、touch emulation、Tab/Enter/Space；
- 验证 `scrollHeight > clientHeight`、滚到末条、首/中/末条打开正确；
- 分别滚动结果 list 与 Monaco，确认互不改变对方 `scrollTop`。

静态 focused test 只能证明结构，不能替代浏览器滚动证据。完整失败判定见 [Checks](./checks.md)。

## 风险与回滚

主要风险：双层滚动、结果区挤掉 Monaco、窄屏 scrollbar 被状态栏规则误隐藏、横向溢出、用静态测试虚报真实修复、顺手扩大到 API/race/新功能。

缓解：panel hidden + list sole scroller、content `min-height:0`、低高度矩阵、稳定 class/focused contract、浏览器末条证据、严格 diff 范围门禁。

回滚仅涉及 `FileViewer` 结构、CSS、focused script/npm script 和 frontend 文档；无 API、数据、配置、迁移或用户文件处理。

## 需要用户 / 主会话决定

请明确确认以下两项：

1. **目标确认**：问题确实位于 `FileViewer` 的定义/引用/Java 实现共享结果区。
2. **UI/范围确认**：批准 [HTML 原型](./code-match-scroll-prototype.html) 的结果区高度与独立滚动关系，并同意本次只修滚动，不新增计数、关闭按钮或拖拽高度。

主会话下一步应先保存 `implement.md` 中的 implementation plan，并把任务切到 `awaiting_approval` 后向用户展示本审批书；只有用户随后明确确认，才可记录 approval grant 并进入实现。若有异议，请指出目标页面、期望高度或需要新增的交互。
