# Design

## 方案摘要

在 session widget 内新增“审批预览目标”状态和一个专用只读模态组件。`TaskCard` 根据轻量投影中的主任务/改进项状态生成入口；用户点击后，模态组件再通过既有 task-local files API 拉取 Markdown。正文不进入 `/sessions/[id]/studio-task` 投影，也不写入 task 状态。

推荐新增 `components/YpiStudioPlanReviewModal.tsx`，集中处理读取、Markdown 渲染、相对链接、安全提示、loading/error/empty、键盘与焦点。`YpiStudioSessionWidget` 只负责入口和选择当前预览目标，`AppShell` 传入 `cwd` 与现有 `handleOpenFile`。

## 现状证据

| 能力 | 现有位置 | 可复用点 |
| --- | --- | --- |
| 浮窗卡片与移动端复用 | `components/YpiStudioSessionWidget.tsx` | 桌面/移动都渲染同一个 `TaskCard` |
| 浮窗宿主 | `components/AppShell.tsx` | 已有 `activeCwd`、`handleOpenFile` |
| Markdown | `components/MarkdownBody.tsx` | 可选 `onLinkClick` |
| 主计划审批预览 | `components/YpiStudioPanel.tsx` / `TaskApprovalTab` | 文案、meaningful 判定、task-relative 链接行为 |
| 改进计划预览 | `ImprovementPlanReviewPreview` | `improvementId` scoped read |
| 安全文件边界 | `app/api/studio/tasks/[taskKey]/files/route.ts` | `mode=read/preview`、大小限制、CSP sandbox |
| 路径校验 | `lib/ypi-studio-tasks.ts` | scheme/absolute/`..`/symlink escape 拒绝 |

## 影响模块与边界

### 前端

- `components/YpiStudioSessionWidget.tsx`
  - Props 增加 `cwd`、`onOpenFile`（或一个窄化的 preview callback）。
  - `TaskCard` 增加可选审批入口列表和 `onPreviewPlan`。
  - 顶层保存 `{ taskKey, taskTitle, improvementId?, improvementDisplayId? }`，渲染 modal。
- `components/YpiStudioPlanReviewModal.tsx`（新增）
  - fetch、AbortController、重试、meaningful 检查。
  - `MarkdownBody` 渲染及相对链接处理。
  - dialog/backdrop/Escape/focus restore/响应式滚动。
- `components/AppShell.tsx`
  - 将当前 Studio cwd 与 `handleOpenFile` 传给 widget。
- `app/globals.css`
  - 仅加入专用 class 的 modal、审批按钮样式和窄屏规则；沿用 `--bg* / --border / --text* / --accent`。

### 服务端/API

不新增路由、不改响应 schema。继续调用：

```text
GET /api/studio/tasks/{taskKey}/files
  ?cwd={authorizedCwd}
  &path=plan-review.md
  &mode=read
  [&improvementId={imp_id}]
```

HTML 相对链接继续调用同一路由 `mode=preview`。服务端是安全权威；客户端校验只用于更好的即时反馈。

### 轻量投影

`YpiStudioTaskWidgetProjection` 已包含：

- `task.status`
- `task.key/title`
- `task.improvements.instances[].id/displayId/status`

因此无需加入 artifact 正文，也无需把完整 improvement 反馈或任务 detail 带入 widget API。标准审批文件契约为 `plan-review.md`。

## 数据流

```text
session widget projection
  └─ TaskCard 判断 waiting state
       └─ 用户点击计划审批书
            └─ setPreviewTarget(taskKey, improvementId?)
                 └─ Modal GET task-local files mode=read
                      ├─ success → MarkdownBody
                      ├─ empty/TBD → 未准备好状态
                      └─ error → 错误 + 重试

Markdown relative link
  ├─ md/text → AppShell.handleOpenFile(task-local path)
  ├─ html → files API mode=preview (sandbox window)
  └─ invalid → modal 内错误提示，不导航
```

## 入口判定

```ts
const targets = [
  ...(task.status === "awaiting_approval" ? [{ kind: "main" }] : []),
  ...task.improvements.instances
    .filter((item) => item.status === "waiting_plan_approval")
    .map((item) => ({ kind: "improvement", improvementId: item.id, displayId: item.displayId })),
];
```

每个等待项单独成为按钮，避免多个改进项时猜测目标。按钮放在状态/元信息后、运行摘要前的独立 action row；使用紧凑次级样式，允许换行，不改变 360px panel 宽度。

## 相对链接复用策略

`YpiStudioPanel.tsx` 目前把 `resolveTaskRelativeHref`、`taskRelativeFilePath`、`openTaskRelativeLink` 放在组件文件内。实现时应优先抽取纯路径解析/构造为共享 client-safe helper（例如 `lib/ypi-studio-task-preview.ts`），由 Panel 与新 Modal 共用；不要复制一套略有差异的安全判断。

服务端仍必须重复并最终执行完整校验，不能信任客户端 helper。

## 弹窗状态机

| 状态 | 展示 | 可用操作 |
| --- | --- | --- |
| idle/opening | 骨架或“正在读取…” | 关闭 |
| success | 只读提示 + Markdown | 相对链接、打开源文件、关闭 |
| empty/TBD | “尚未准备好” | 重试、打开源文件、关闭 |
| error | 具体但不泄露敏感内容的错误 | 重试、关闭 |
| long content | 固定 header，正文独立滚动 | 键盘/滚轮阅读、关闭 |

请求以 `taskKey + improvementId + retryToken` 为 key；effect cleanup abort。旧请求不得覆盖新目标。

## 可访问性

- `role="dialog" aria-modal="true" aria-labelledby`。
- 打开时保存 `document.activeElement`，聚焦关闭按钮；关闭时恢复。
- Escape 和 backdrop 关闭；modal body 阻止冒泡。
- 关闭、重试、源文件按钮使用原生 button；审批入口具备包含任务/改进项的 aria-label。
- `aria-live="polite"` 用于 loading/error 状态。
- 不以颜色作为唯一 waiting/error 信息。

## 兼容性

- 旧任务：只要处于 `awaiting_approval`，按标准文件名读取；文件缺失显示明确状态。
- 自定义 workflow：入口按语义状态值判断，不依赖中文 label。
- Archived/非绑定任务：不新增入口。
- 多任务：modal target 带 taskKey，不受 primary task 切换影响。
- 改进项：所有读取和 HTML preview 必须携带 improvementId。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 按钮挤压 360px 卡片 | 独立 flex-wrap action row；详情箭头保留在顶行 |
| 预览被误认为批准 | 固定只读提示；不提供批准按钮；不调用 PATCH |
| 相对链接逃逸 | 共享客户端解析做 UX 拦截；服务端 resolver 做最终拒绝 |
| 多改进项串读 | 每个按钮携带稳定 improvementId；请求 URL 显式 scoped |
| 请求竞态/切 session | AbortController + target key；widget 卸载即取消 |
| helper 抽取影响现有 Panel | 保持原函数契约与行为，增加聚焦回归检查 |

## 回滚

删除 widget 审批入口、modal 组件与 AppShell props 即可。API、task schema、approval 元数据和 session widget 投影均无迁移，回滚不会影响历史任务。
