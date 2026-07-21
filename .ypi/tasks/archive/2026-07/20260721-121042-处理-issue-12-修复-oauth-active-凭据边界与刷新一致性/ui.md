# UI：Issue #12 OAuth Active 凭据边界

## UI 原型门禁判定

**不触发，UI gate 不适用。**

本任务只修改服务端 OAuth account lifecycle、route 接线、测试与文档，不涉及：

- 页面或组件新增/删除；
- 前端功能或交互变化；
- 用户确认/审批体验变化；
- 用户可见信息结构、文案、样式、响应式或可访问性变化；
- API wire schema 变化。

因此：

- 不指派 UI 设计员；
- 不产出 HTML 原型；
- 不需要原型审批；
- checker 只需确认现有 Models、provider status 与 usage panel 的账号数量、Active 标记、quota 返回和 logout/Activate 行为未回归。

## 前端兼容要求

1. `GET /api/auth/accounts/:provider` 与 `GET /api/auth/providers` 的 response shape 不变。
2. login SSE `success/error/cancelled` shape 不变。
3. logout 与 Activate response shape 不变。
4. labels、remarks、masked id、Active 排序保持现有展示契约；遗留无 label 数据继续使用 masked id fallback。
5. 不修改 `components/ModelsConfig.tsx`、usage panels 或 Settings。
