# Design — IMP-003 任务浮窗主任务用户验收

## 方案摘要

在既有「改进结果验收」通路旁增加对称的「主任务结果验收」通路：

1. **Projection 标志**：`canAcceptMain`（布尔便利字段）。
2. **浮窗 UI**：独立按钮 + AppPrompt。
3. **既有 transition API**：`transitionYpiStudioTask` / HTTP task transition body → `completed`。

不新增 API，不改 workflow 边，不放宽 unresolved / archive / context 门禁。

## 影响模块

### 1. `lib/ypi-studio-types.ts`

扩展 `YpiStudioTaskWidgetProjection`：

```ts
/** True only when status is user_acceptance, not archived, and no unresolved improvements. Server remains authoritative. */
canAcceptMain?: boolean;
```

可选附加（非必须，若实现员偏好结构化）：

```ts
mainAcceptance?: {
  canAccept: boolean;
  fromStatus: "user_acceptance";
  toStatus: "completed";
};
```

推荐最小字段：`canAcceptMain?: boolean`，与 `instances[].canAccept` 命名对称。

### 2. `lib/ypi-studio-session-link.ts`（`buildProjection`）

纯条件：

```ts
const unresolvedCount = improvementSummary?.unresolved ?? 0;
const canAcceptMain =
  !detail.archived
  && detail.status === "user_acceptance"
  && unresolvedCount === 0
    ? true
    : undefined;
```

- 无 improvements 字段时 `unresolvedCount=0`，`user_acceptance` 仍可验收（首次验收路径）。
- 不得在 `review` / `review_ready` / `ready` 置 true。
- 建议抽 `canAcceptMainTask(detail): boolean` 纯函数便于单测。

### 3. `components/YpiStudioSessionWidget.tsx`

#### 显示

- 卡片内，改进块之后 / 资料 quick actions 之前，增加主任务验收区：
  - 条件：`!isArchivedReadOnly && task.canAcceptMain === true`（或 helper 与 status 双检）。
- 文案：
  - meta：`主任务结果待验收`
  - button：`确认主任务已验收完成`
  - busy：`验收中…`
- class：`ypi-studio-widget-main-accept` / `ypi-studio-widget-main-accept-btn`（勿复用改进橙按钮 class 作为唯一样式）。

#### 交互

镜像 `handleAcceptImprovement`：

```ts
handleAcceptMainTask(taskKey)
  -> guard cwd/contextId/in-flight
  -> confirm({
       title: "确认主任务已验收完成？",
       message: 主任务结果验收说明 + 将进入 completed + 不自动归档,
       confirmLabel: "确认主任务已完成",
       cancelLabel: "暂不验收",
       intent: "danger" | "default" // 建议 default/ success 语义，与改进 danger 区分；若 AppPrompt intent 有限，可用 default + 文案强调
     })
  -> PATCH {
       cwd,
       to: "completed",
       contextId,
       reason: "User accepted main task from session widget",
       // optional action: "transition"
     }
  -> toast + onTaskChanged
```

并发：与改进验收共享或并列 in-flight ref，避免双写；同一时刻只允许一个写操作。

#### 排序/注意力

- `workflowRailNeedsUserAttention` 在 `user_acceptance` 已为 true，无需为 canAcceptMain 特判。
- ball urgency 已覆盖 needs_user；可不改。

### 4. `app/globals.css`

新增主任务验收按钮样式：

- 建议绿色/accent 实心，与改进橙（`.ypi-studio-widget-accept-btn`）对比。
- focus-visible、disabled/busy、窄屏全宽与改进列表一致。
- 不依赖颜色作为唯一语义：保留文字标签。

### 5. 文档

- `docs/modules/frontend.md`：`YpiStudioSessionWidget` 段补充主任务验收写路径；删除/改写“widget never completes … main task”为条件化描述。
- 若 types/projection 变更影响 library 说明，轻触 `docs/modules/library.md`（可选）。

### 6. 测试

扩展或新增纯函数测试（推荐 `scripts/test-ypi-studio-session-link.mjs` 或并入现有 studio 测试脚本）：

| 输入 | canAcceptMain |
| --- | --- |
| user_acceptance, 无改进 | true |
| user_acceptance, unresolved=0, 有 accepted 改进 | true |
| user_acceptance, unresolved>0 | false |
| waiting_for_improvements | false |
| review + review_ready | false |
| completed / archived | false |
| ready | false |

## 数据流

```text
user_acceptance & unresolved=0 & !archived
  -> buildProjection.canAcceptMain=true
  -> Widget 显示「确认主任务已验收完成」
  -> AppPrompt confirm
  -> PATCH transition to completed + contextId + reason
  -> transitionYpiStudioTask
       assert not archived
       assertNoUnresolvedImprovementsForComplete
       requiresUserApproval reason present
       assertTaskBoundToContext
  -> status=completed, completedAt set
  -> onTaskChanged refresh (button gone)
```

## 接口契约

沿用：

```http
PATCH /api/studio/tasks/{taskKey}
Content-Type: application/json

{
  "cwd": "...",
  "to": "completed",
  "contextId": "pi_<sessionId>",
  "reason": "User accepted main task from session widget"
}
```

注意 HTTP 匹配顺序：勿带 `action:"transition_improvement"`；主 transition body 不得被 improvement body 吞掉（现有 `isYpiStudioTaskTransitionBody` 已排除 improvement action）。

## 兼容性

- 旧客户端忽略 `canAcceptMain` 无害。
- 服务端无 schema 迁移。
- 改进验收路径零变更。

## 风险与缓解

1. **误完成主任务**：二次确认 + 仅 user_acceptance + 服务端 reason/unresolved。
2. **review_ready 期待落空**：保留文案提示；计划审批书写明不在 review 一键完成。
3. **context 未绑定**：客户端前置检查与服务端 assert 双层。
4. **样式混淆**：独立 class 与文案前缀「主任务」。
5. **in-flight 竞态**：busy 禁用 + 失败刷新。

## 回滚

删除 projection 字段、按钮/handler、样式与文档句即可；无数据迁移。已 completed 的任务保持 completed。
