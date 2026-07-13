# 计划审批书：任务浮窗在等待审批时支持计划审批书预览

## 审批摘要

本计划在 YPI Studio session 任务浮窗中增加一个**只读计划审批书入口**：主任务处于 `awaiting_approval` 时显示「计划审批书」；改进项处于 `waiting_plan_approval` 时显示「计划审批书 · IMP-xxx」。点击后以 modal 按需读取并渲染对应 `plan-review.md`，用户关闭后仍回到当前聊天，通过绑定聊天明确批准或提出修改。

本能力只缩短“查看计划”的路径，**不增加 modal 内批准按钮，不写 approval grant，不改变审批 transition**。

## 请审批的产品与 UI 决策

1. 入口位于浮窗卡片状态元信息后的独立 action row，保留现有详情箭头和 360px 面板宽度。
2. 主任务仅在 `awaiting_approval` 显示；每个 `waiting_plan_approval` 改进项分别显示并携带自身 `improvementId`。
3. 桌面使用居中只读 modal；移动端从现有 Studio bottom sheet 进入接近全屏的底部 modal。
4. Modal 固定提示“预览不会自动批准”，不提供批准/拒绝/请求修改操作。
5. Markdown 相对链接继续受 task-local API 安全边界保护；HTML 使用 CSP sandbox preview。

请先审阅：

- [UI 方案](./ui.md)
- [可交互 HTML 原型](./ui-prototype.html)
- [UI 设计员说明与状态矩阵](./ui-designer-notes.md)

**UI 原型当前尚待用户/主会话明确批准；确认前不得进入实现。**

## PRD 摘要

详见 [PRD](./prd.md)。核心验收：

- 主任务和改进项入口严格按 waiting approval 状态显隐；非审批态不显示。
- 点击后才读取正文，不把 Markdown 放入轻量 widget projection。
- 支持 loading、success、空白/占位内容、404/403/网络失败、重试和长内容滚动。
- 多个改进项可分别打开，绝不猜测或串读。
- 预览不会改变 task、revision、gate 或 grant。
- 详情、拖拽、收纳、排序、绑定过滤与移动端原交互无回归。

## Design 摘要

详见 [Design](./design.md)。推荐方案：

- 新增 `YpiStudioPlanReviewModal`，集中处理 fetch/abort/stale response、`MarkdownBody`、相对链接、状态机、dialog/focus 和响应式布局。
- `YpiStudioSessionWidget` 只生成 preview targets、渲染入口和保存当前 target。
- `AppShell` 传入当前授权 cwd 与已有 `handleOpenFile`。
- 抽取复用 `YpiStudioPanel` 现有 task-relative link helper，避免两套路径行为漂移。
- 继续使用既有 `/api/studio/tasks/[taskKey]/files?mode=read|preview`；不新增 API、不改 task/schema、不迁移数据。

安全边界：客户端校验仅改善 UX；服务端 resolver 继续拒绝 scheme、绝对路径、`..`、目录和符号链接逃逸。改进项读取/HTML preview 始终携带同一 `improvementId`。

## Implement 摘要

详见 [Implement](./implement.md)。获批后按以下顺序执行：

1. **IMP-1**：共享 task-relative preview link helper，并保持现有 Studio Panel 行为。
2. **IMP-2**：实现只读 modal、按需读取、Markdown、状态、焦点和移动布局。
3. **IMP-3**：接入主任务/多改进项入口与 AppShell cwd/file viewer。
4. **IMP-4**：更新 frontend module 文档。
5. **IMP-5**：自动验证与真实浏览器验收。

`implement.md` 已包含 fenced `json ypi-implementation-plan` 机器计划。实现中若要加入 modal 批准按钮、改变 API/schema 或改变浮窗尺寸，必须停止并重新审批。

## Checks 摘要

详见 [Checks](./checks.md)。最低自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

人工重点：

- 主任务与两个并存改进项的入口/正文对应关系；
- 200、慢请求、空白/占位内容、404、403、网络失败、重试和 target 竞态；
- Markdown/HTML 合法链接与非法路径拒绝；
- Escape、遮罩、焦点约束/恢复、长内容滚动；
- 浅/深色、360px 桌面浮窗、移动端 bottom sheet；
- 打开/关闭预览前后 task.json 无 approval 写入。

## 风险、缓解与回滚

| 风险 | 缓解 |
| --- | --- |
| 360px 卡片拥挤 | 独立可换行 action row，不占详情顶行 |
| 预览被误认为批准 | 固定只读提示，无写状态按钮/API |
| 多改进项串读 | 每个 target 显式携带稳定 improvementId |
| 请求竞态 | AbortController + target/retry key + stale response guard |
| helper 抽取影响现有 Panel | 保持契约并专项回归主/改进计划链接 |
| 路径逃逸 | task-local 服务端 resolver 最终校验，HTML CSP sandbox |

回滚仅删除新增 modal、widget 入口和 AppShell props，并恢复 helper 抽取；无数据/API/schema 迁移。

## 相关产物

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI](./ui.md)
- [HTML 原型](./ui-prototype.html)
- [UI 设计员说明](./ui-designer-notes.md)
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)

## 等待用户批准

请明确回复是否批准以上范围、技术路线和 HTML 原型。批准后主会话才可记录 approval grant 并进入实现；如需调整入口位置、文案、modal 形态或审批边界，请先退回修改计划。
