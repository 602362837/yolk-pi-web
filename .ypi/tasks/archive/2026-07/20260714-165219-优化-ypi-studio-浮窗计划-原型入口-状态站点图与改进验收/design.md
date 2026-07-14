# Design：YPI Studio 浮窗计划/原型入口、完整状态与改进验收

## 方案摘要

在现有 session widget 轻量投影中增加**有界、无正文**的 quick-preview/acceptance 描述；任务详情与浮窗复用现有 modal、task-local preview helper 和 files API。站点图扩展为八站映射。唯一写动作是用户确认后的既有 `transition_improvement` API；预览路径保持纯 GET。

## 影响模块

### `lib/ypi-studio-types.ts`

给 `YpiStudioTaskWidgetProjection` 增加可选有界字段：

- `quickPreviews[]`：`kind`（plan-review/prototype/improvement-plan）、`taskKey` 隐含于 task、`fileName`、可选 `improvementId/displayId`、`approvalState`（pending/approved/revision_changed/readonly）、`label`。
- improvement instance 投影补充验收动作所需的 `title/status` 已存在；不投影 feedback/正文。必要时增加明确 `canAccept`，但服务端 status 仍是权威。

字段保持 additive，旧客户端可忽略。

### `lib/ypi-studio-session-link.ts`

- 从完整 task artifact registry 与 improvement artifact mappings 构建 preview descriptors；仅收集 `plan-review.md` 和 `.html/.htm` 文件名，不读取/返回正文。
- 主审批态来自当前 `meta.approvalGrant`/revision；改进审批态来自 `instance.approval`。审批被 revision 更新清除后投影恢复待审。
- 归档详情继续可投影只读 descriptors。
- 不依赖 `events.slice(-5)`、subagent/compact timeline 截断或当前 workflow state 的 required artifacts。

### `components/YpiStudioPlanReviewModal.tsx`

保留现有安全读取、Abort/stale guard、空态和 a11y；将固定文案参数化为主计划/改进计划，或抽取兼容的通用只读 artifact modal。`fileName` 与 `improvementId` 始终显式传入。预览 modal 绝不出现计划写操作。

### `lib/ypi-studio-task-preview.ts`

复用 `buildStudioTaskFileApiUrl()` 和 `openTaskRelativeLink()`。HTML 始终 `window.open(..., "_blank", "noopener,noreferrer")`，请求 `mode=preview`；客户端检查仅改善 UX，服务端 resolver 仍是安全权威。

### `components/YpiStudioPanel.tsx`

在任务详情/改进流程顶部增加快速预览区：主计划审批书与各改进计划同级。继续保留现有改进五 Tab 深入查看。入口只读且显式 scoped；不新增任务写按钮。

### `components/YpiStudioSessionWidget.tsx`

- 入口由 `quickPreviews`/完整 artifact evidence 驱动，不再由 `status === awaiting_approval` 单独决定存在性。
- 计划与原型按钮显示图标 + 状态文字 + tone；点击均 stop propagation，不干扰拖拽/详情按钮。
- 扩展 rail 为八站；使用 workflow/status evidence 映射 `review`、`user_acceptance`、`waiting_for_improvements`、`completed`、`archived`，两行布局保持 360px。
- 对每个 `waiting_user_acceptance` 改进显示验收按钮。使用现有 `usePrompt().confirm` 或同等 AppPrompt 确认体验；确认后 PATCH 既有 route。
- 写入期间禁用按钮并显示进行中；成功触发 `onTaskChanged(taskKey)`，失败 toast/notice 后刷新，不本地伪造服务端状态。

### `components/AppShell.tsx`

向 widget 提供当前绑定 `contextId`（由有效 session id 生成稳定 `pi_<sessionId>`）和刷新 callback。callback 复用当前 session-task 拉取及 Studio drawer refresh，不改变多任务排序/归属。

### 样式与文档

`app/globals.css` 增加 quick action approved/pending、八站两行、busy/error/acceptance 样式；遵循 reduced-motion。更新 `docs/modules/frontend.md`、`docs/modules/library.md`；API contract 未新增路由，仅 additive body 使用说明，若 wire 字段变化同步 `docs/modules/api.md`。

## 数据流

### 只读预览

```text
Task detail / Widget quick action
  → target(taskKey, fileName, optional improvementId)
  → GET /api/studio/tasks/:taskKey/files?mode=read|preview
  → task/improvement local resolver + allowed-root/symlink checks
  → Markdown modal 或 CSP sandbox HTML 新页面
```

没有 PATCH、approvalGrant 或 transition。

### 改进验收

```text
waiting_user_acceptance descriptor
  → 用户点击
  → 确认 Dialog（明确 IMP id/title 与非计划审批语义）
  → PATCH /api/studio/tasks/:taskKey
     { cwd, action:"transition_improvement", improvementId,
       to:"accepted", contextId, reason:"User accepted from session widget" }
  → route → transitionYpiStudioImprovement()
  → 校验 task 归属、当前状态、合法 transition
  → acceptance 记录 + reconcile all improvements
  → 重新 GET session widget / task detail
```

不得使用 override；不得直接写 task.json。

## 兼容性与迁移

- 无持久化 schema 迁移；旧 task 没有 HTML mapping 时只不显示原型按钮。
- 新 projection 字段可选，旧响应保持可渲染；UI 缺字段时退回现有详情入口。
- 已归档任务只读，绝不渲染验收写按钮。
- rollback 可删除新 UI/投影字段并恢复五站 rail；既有 acceptance 记录是合法状态机事件，无需回滚数据。

## 风险与缓解

- **错误目标/串读**：所有改进入口强制 improvementId；不推断首项。
- **审批态误判**：仅用当前服务端 grant/approval revision，不用按钮点击或文件存在性推断。
- **验收竞态**：服务端状态机二次校验；409/400 类错误后刷新，不乐观写 completed。
- **规划产物误标运行完成**：站点完成优先 workflow/status evidence，不以 checks.md 存在为准。
- **卡片过高/拥挤**：八站两行，action row flex-wrap；不改 360px；多任务列表仍纵向滚动。
- **HTML 安全**：继续 mode=preview、CSP sandbox、路径与 symlink 边界，不把 HTML 注入 React DOM。
