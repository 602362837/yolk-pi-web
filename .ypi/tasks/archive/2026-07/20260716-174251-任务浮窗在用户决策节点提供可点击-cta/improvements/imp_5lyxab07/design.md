# Design：IMP-002 `start_user_acceptance`

## 方案摘要

在 Phase 1 决策层上 **叠加一个** 固定 action，不新开 UI 子系统：

```text
status=review && unresolved==0 && !archived
  -> buildWidgetUserActions projects start_user_acceptance
  -> widget decision region + AppPrompt confirm
  -> PATCH action=start_user_acceptance + contextId + expectedRevision
  -> single-lock transition review -> user_acceptance
  -> refresh; canAcceptMain becomes true; existing main-accept UI handles completion
```

## 类型

扩展 `YpiStudioWidgetUserActionKind`：

```ts
| "start_user_acceptance"
```

可选 body 类型：

```ts
interface YpiStudioWidgetStartUserAcceptanceBody {
  cwd: string;
  action: "start_user_acceptance";
  contextId: string;
  expectedRevision: number;
  // no override, no reason from client required
}
```

`userActions` 仍 max 2；本状态只投 1 项 primary。

## 投影规则（`buildWidgetUserActions`）

在现有 `awaiting_approval` / `waiting_for_improvements` 分支之后增加：

- archived → `[]`（已有）
- `status === "review"` 且 unresolved count === 0：
  - 一项 `start_user_acceptance`
  - `id: main:start_user_acceptance:r{revision}`
  - `label: "开始用户验收"`
  - `expectedRevision = meta.planRevision ?? 1`
  - `targetLabel = bound("主任务 · {title}")`
- 其它 status → 不变

**不**在 `review_ready` parentStatus alone 投影（status 仍可能是 `waiting_for_improvements`）。  
**不**改变 `canAcceptMainTask`（仍仅 `user_acceptance`）。

投影函数需从 `improvements.instances` 现算 unresolved 计数（与 `buildProjection` 一致），避免把完整 feedback 拉进 descriptor。

## Domain helper

`startYpiStudioUserAcceptanceFromWidget(taskKey, body)` in `lib/ypi-studio-tasks.ts`：

同一 `withTaskMutationLock` 内：

1. load task；拒绝 archived / missing  
2. `assertTaskBoundToContext`；session-class context  
3. `status === "review"` 否则 409  
4. unresolved improvements == 0 否则 409/422  
5. `expectedRevision === meta.planRevision ?? 1`  
6. 验证 workflow 存在边 `review → user_acceptance`（`findYpiStudioTransition`）  
7. 写 status=`user_acceptance`，`currentMember` 按 workflow owner，`updatedAt`  
8. append event：`type: transition` 或 structured note，`data: { action: "start_user_acceptance", source: "user-widget", revision, contextId }`  
9. **不**创建/清除 plan `approvalGrant`  
10. 一次 `writeTaskJson`

实现注意：

- **不要**嵌套调用会再次取锁的 public `transitionYpiStudioTask`（与 Phase 1 原子 helper 同一模式）。  
- body guard：`action` 精确匹配、`override === undefined`、revision 有限整数、context 非空字符串。

## Route

在 `app/api/studio/tasks/[taskKey]/route.ts` 中，与其它 widget actions 一样 **先于** loose `isYpiStudioTaskTransitionBody` 匹配 `start_user_acceptance`，映射 400/403/404/409/422/500。

本 action **默认不需要** Studio autocontinue 派发子 agent：进入 `user_acceptance` 后等待用户点主验收即可。

## 前端

`components/YpiStudioSessionWidget.tsx`：

- `userActionsForTask` allowlist 增加 `start_user_acceptance`  
- `decisionRegionTitle`：该 kind → `👉 需要你的决定: 开始用户验收`  
- `decisionBusyLabel` → `进入中…`  
- `handleDecisionAction` 分支：confirm 模板 + PATCH body  
- **不**改 `showMainTaskAccept` / `handleAcceptMainTask` / 改进验收 / rail / quick preview / Phase 1 三 kind

CSS：优先零新增；确认现有 primary 全宽样式足够。

## 与既有 reaccept 路径关系

| 路径 | 行为 | 本期 |
| --- | --- | --- |
| 最终改进验收后 widget 自动 `to: user_acceptance` | 已有 | **保留** |
| 主会话/checker 停在 `review` | 无按钮 | **本 CTA 补齐** |
| 用户在 `review` 手动点 CTA | 显式进入验收 | **新增** |

两者终点相同（`user_acceptance`），不互相删除。

## 安全不变量

1. 绑定 context + revision CAS + status 重验  
2. 无 unresolved 才能离开 review 进入 user_acceptance  
3. 无 override；不写 plan grant  
4. 前端不按 status 发明 CTA  
5. preview GET 只读不变  

## 兼容与回滚

- additive kind；前端白名单必须加入新 kind，否则按钮不显示  
- 回滚：停止投影该 kind 即可；已进入 `user_acceptance` 的任务保持合法  

## 风险

| 风险 | 缓解 |
| --- | --- |
| 用户以为一点即完成 | 确认框 + 主验收仍独立 |
| 与 reaccept 双路径重复 transition | 第二次 status 非 review → 409 + 刷新 |
| 误在有 unresolved 时进入验收 | 投影与写路径双重 unresolved==0 |
| 实现时放宽 canAcceptMain | Checks 明确禁止；main-accept 测试保持 review=false |
| 误删 Phase 1 / 保全区块 | CTA-WIDGET / VERIFY 对照 A–F + Phase 1 kinds 回归 |
