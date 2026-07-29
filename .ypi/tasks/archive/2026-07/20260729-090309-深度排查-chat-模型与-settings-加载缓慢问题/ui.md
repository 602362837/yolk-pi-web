# UI — 门禁判断

## 结论

**当前 P0 修复不触发 UI 原型门禁。**

计划仅收敛后台 catalog 热路径、读写副作用、缓存失效与前端同数据源请求去重；保留现有 Chat 模型选择器、Settings 树、loading 文案、错误位置、字段与交互，不新增用户可见信息结构。

## 条件性门禁

若主会话决定加入以下任一变化，则必须先明确请求 `ui-designer` 基于现有项目产出 HTML 原型，并经用户审批后才能实现：

- Chat 模型框新增 loading skeleton、超时、离线/降级或 Retry 控件；
- Settings 将模型目录状态拆成新的 banner/card；
- 改变 Settings 壳层与模型控件的可用/禁用顺序；
- 显示 cache age、provider 阶段或诊断信息。

本成员按委派约束未再派发 UI 设计员。当前没有 HTML 原型，也不应把纯 Markdown 当原型。

## P0 手工视觉回归

- Chat 模型按钮/下拉布局不变，目录更早出现。
- Settings 弹窗壳层仍由 `/api/web-config` 决定；模型控件稍后独立填充，不新增闪烁或 selection 跳动。
- Models 弹窗沿用 #23 的 config/catalog 分 lane 展示，不回退为整页 loading。
