# UI

## 原型门禁

**已触发，HTML 已再次修订交付，等待用户审批。** 本任务改变 Usage 页面入口、tab、默认筛选、dropdown 交互、token 信息层级、提示区域、双维度图表切换和图标。纯 Markdown 不能替代 HTML 原型。

## UI 设计员派发单

主会话需派发 `ui-designer`，要求其读取并基于：

- `components/UsageProviderModelTable.tsx`
- `components/UsageStatsModal.tsx`
- `components/SelectDropdown.tsx`
- `components/AppShell.tsx` 的 sidebar Usage action
- `app/globals.css` 中 usage modal / chart tooltip / sidebar utility 样式
- `lib/token-format.ts`
- 本任务的 [brief.md](brief.md) 与 [prd.md](prd.md)

交付一个 task-local、自包含、可离线预览的 HTML 文件，建议命名：

- `usage-ledger-refinement-prototype.html`

## 原型必须覆盖

1. **单一账本页面**：不出现 Session 统计 tab；打开即为调用账本。
2. **筛选栏**：日期、`全部 / 当前`、统一来源下拉、统一状态下拉、重置、刷新；首次/重置均高亮“全部”。
3. **日期交互状态**：正常范围、非法反向范围错误、加载、空数据。
4. **Token exact + M**：summary、Token 拆分、provider/model 行、chart tooltip、model drawer 至少展示一组完整代表态；exact 为主、M 为次。
5. **降噪**：无 coverage banner、known-gap 文案、legacy 兼容 footer、损坏文件数量。
6. **图标**：sidebar Usage action 与 modal header 展示同一“折线统计 + 费用”语义图标。
7. **响应式与可访问性**：桌面与约 390px 窄屏；dropdown 展开、键盘焦点、禁用“当前”、drawer、tooltip。
8. **视觉基线**：复用现有 CSS variables、边框、圆角和密度；不创造第二套按钮/下拉样式。

## 推荐信息层级

- 总 Token 卡：`12,584,291` 为主，`12.584291 M` 为次，tooltip 为 `12,584,291 tokens`。
- Token 拆分：Input / Output / Cache Read，每行 exact + M；百分比可作为第三弱信息或 tooltip，不得挤掉 M。
- Provider/model 表：exact 为主，M 为次；窄屏中 M 仍可在详情 drawer 获取。
- 图表右侧可用 compact，hover/focus tooltip 同时显示 exact + M。

## 原型交付与视觉对齐

- 离线 HTML：[usage-ledger-refinement-prototype.html](usage-ledger-refinement-prototype.html)。文件自包含 CSS/JS，无生产代码依赖，可直接浏览器打开。
- 原型复用现有 `--bg`、`--bg-panel`、`--border`、`--text-*`、`--accent` 变量、7px 面板圆角、26–28px 工具栏控件、pill sidebar action、portal dropdown 的信息层级和密度。
- 用户已确认保留现网“使用量 / 费用”指标切换，并新增/保留“折线趋势 / 柱状占比”形态切换；原型默认展示折线趋势 + 使用量，两个切换均联动重绘，不引入图表库。sidebar 与 modal header 仍使用折线统计 + 费用 SVG 语义图标。
- 交互覆盖：正常、加载、空数据、日期反向错误；全部默认/重置、当前 scope 禁用态；来源/状态下拉展开、键盘焦点；默认可见的按日 Token 折线趋势；形态可切折线/柱状，指标可切使用量/费用，均支持 hover/focus tooltip（当前指标为主，另一指标为次）；模型详情 drawer；深色主题和约 390px 响应式。
- 原型明确不展示 Session 统计 tab、coverage/known-gap、legacy footer 或损坏文件数。

## 当前审批

修订后的 HTML 已补回现网“使用量 / 费用”指标切换，并保留“折线趋势 / 柱状占比”形态切换；当前仍等待主会话/用户重新预览并批准，批准前不得进入实现。

## 审批记录

- HTML 原型：**已再次修订，待用户重新预览审批**：[usage-ledger-refinement-prototype.html](usage-ledger-refinement-prototype.html)。
- 用户审批：**待原型预览后确认**。
- 图表决策：保留现网“使用量 / 费用”指标切换，并实现“折线趋势 / 柱状占比”形态切换；默认折线 + 使用量，均复用现有 byDay 数据，不改变 API shape；入口/header 保留折线统计语义图标。
