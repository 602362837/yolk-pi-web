# Design：Completed → User Acc. 退回 + Chat `/studio-archive` 归档

## 1. 方案摘要

```text
status=completed && !archived
  buildWidgetUserActions → [
    primary: studio_archive,
    secondary: return_to_user_acceptance
  ]  // max 2；review-only 可仅 archive

退回：
  confirm → lock → PATCH action=return_to_user_acceptance
    → 单锁：binding/status/unresolved/revision/workflow边
    → status=user_acceptance；clear completedAt
    → toast；onTaskChanged；无 Chat Send

归档：
  confirm → lock → onComposeSend("/studio-archive" [| reason])
    → AgentSession.prompt 识别 extension command
    → studio-archive handler sendUserMessage 引导模型
    → 模型 ypi_studio_task(action=archive, knowledgeSummary, knowledgeMarkdown, …)
    → 禁止浮窗 PATCH archive + allowFallbackKnowledge 主路径
```

**核心原则**

1. 投影 advisory；写路径服务端权威。
2. 退回 = 显式 atomic widget action（对齐 `start_user_acceptance`），不靠松散 `to` 误匹配。
3. 归档 = Hybrid B 的 Chat 可见路径；slash 可走 compose（见 §3.3 证据）。
4. 不改视觉；复用 decision region。

## 2. 影响模块与边界

| 模块 | 变更 | 边界 |
| --- | --- | --- |
| `lib/ypi-studio-workflows.ts` | `BASE_TRANSITIONS` 增加 `completed → user_acceptance`；默认 workflow 序列化含新边 | 不改 terminalStatuses 列表语义（completed 仍 terminal；离开时清 completedAt） |
| `.ypi/workflows/{feature-dev,bugfix,ui-change}.json` | 同步新边 | `review-only.json` **不加** 退回边（无 user_acceptance） |
| `lib/ypi-studio-types.ts` | 扩展 `YpiStudioWidgetUserActionKind`；新增 PATCH body 类型 | 稀疏字段契约不变 |
| `lib/ypi-studio-session-link.ts` | `buildWidgetUserActions` completed 分支 | 仍 max 2；archived → [] |
| `lib/ypi-studio-tasks.ts` | `returnYpiStudioToUserAcceptanceFromWidget` + body guard | 单锁；清 completedAt |
| `app/api/studio/tasks/[taskKey]/route.ts` | 在 loose transition 前匹配新 action | 不把 archive 设为浮窗主路径 |
| `components/YpiStudioSessionWidget.tsx` | 过滤新 kind；confirm；退回 PATCH；归档 onComposeSend；title/busy | 不改 CSS 视觉 |
| `lib/ypi-studio-widget-continue.ts` | **不**把新 kind 加入 continue 集合 | archive 是 Send-only，不是 post-PATCH continue |
| `scripts/test-ypi-studio-widget-actions.mjs` (+ 可选 transition 测) | 投影与 body 形状 | — |
| `docs/modules/{frontend,api,library}.md` + overview 相关句 | 文档 | — |
| `components/YpiStudioPanel.tsx` | **不改** | Panel fallback archive 保留 |

**不改**：`canAcceptMain` 门禁、主验收 PATCH completed、improvement 流、quick preview、ChatWindow/AppShell 接线（已存在）。

## 3. 数据流

### 3.1 投影

```ts
// buildWidgetUserActions
if (detail.archived) return [];
if (detail.status === "completed") {
  const revision = planRevision ?? 1;
  const actions = [];
  // primary archive always (completed active)
  actions.push({ kind: "studio_archive", role: "primary", label: "归档", ... });
  // secondary return only if workflow has user_acceptance + edge
  // 实现可选：投影层不读 workflow 文件时，一律投影 secondary；
  // 写路径缺边则 422。推荐：buildProjection 已知 workflow 时可过滤。
  // 最小实现：session-link 的 buildWidgetUserActions 仅见 detail；
  // 在 buildProjection 内传入 workflow 能力，或在 buildWidgetUserActions 增加 optional flag。
  actions.push({ kind: "return_to_user_acceptance", role: "secondary", label: "退回用户验收", ... });
  return actions.slice(0, 2);
}
```

**推荐实现细节**：扩展 `buildWidgetUserActions` 签名增加可选 `supportsReturnToUserAcceptance?: boolean`，由 `buildProjection` 用 `findYpiStudioTransition(workflow, "completed", "user_acceptance")` 计算。缺省 true 仅用于单测；生产传入真实值。`review-only` → false → 仅 archive。

### 3.2 退回写路径

```text
handleDecisionAction(return_to_user_acceptance)
  → confirm
  → agentRunningRef / inFlight 检查
  → PATCH {
      cwd, action: "return_to_user_acceptance",
      contextId, expectedRevision
    }
  → returnYpiStudioToUserAcceptanceFromWidget
      lock
      load; !archived; status===completed
      assertBound(contextId)
      assertExpectedRevision
      assertNoUnresolvedImprovements (defense)
      find transition completed→user_acceptance
      status=user_acceptance; completedAt=null; currentMember=owner
      event + runtime pointer
  → onTaskChanged; toast
```

### 3.3 归档 Chat 路径（slash 可行性证据）

现网链路：

1. Widget `onComposeSend` ← AppShell `composeSendRef` ← ChatWindow `handleSend`
2. `handleSend` → `sendAgentCommand(sid, { type: "prompt", message })`
3. `rpc-manager` → `inner.prompt(message)`
4. `AgentSession.prompt`：`text.startsWith("/")` → `_tryExecuteExtensionCommand`
5. `pi.registerCommand("studio-archive")` → `pi.sendUserMessage(引导归档+整理 knowledge…)`

因此 **`onComposeSend("/studio-archive")` 可可靠触发与手动 slash 相同语义**。  
不要用 `steer`/`followUp`（extension command 不可 queue）。  
`agentRunning` 时本就禁用 CTA，避免 streaming 冲突。

**等价兜底**（仅文档/代码注释；主路径仍 slash）：若未来 compose 被改成 `expandPromptTemplates: false`，可改为发送与 handler 相同的纯文本引导词（仍非 silent archive）。

### 3.4 与 Panel / 主验收归档关系

| 路径 | 知识来源 | 本任务 |
| --- | --- | --- |
| 浮窗 Completed「归档」 | 模型 via `/studio-archive` | **主路径** |
| Panel 归档 | `allowFallbackKnowledge` 兜底 | 保留不动 |
| 主验收「确认并归档」 | 现网 completed + archive fallback | **不改**（PRD Q2） |

## 4. 接口契约

### 4.1 Kind 扩展

```ts
export type YpiStudioWidgetUserActionKind =
  | "approve_plan"
  | "request_plan_changes"
  | "approve_improvement_plan"
  | "start_user_acceptance"
  | "return_to_user_acceptance"
  | "studio_archive";
```

### 4.2 PATCH body

```ts
// return only
{
  cwd: string;
  action: "return_to_user_acceptance";
  contextId: string; // pi_<sessionId>
  expectedRevision: number;
}
// 无 override
```

Route：与 `start_user_acceptance` 同级，**先于** loose `transition` body。

### 4.3 Workflow edge

```ts
// BASE_TRANSITIONS
{ from: "completed", to: "user_acceptance" },
// 保留
{ from: "completed", to: "archived" },
```

`transitionYpiStudioTask` 松散路径也可走该边（需 reason？`requiresUserApproval` 未标则否）。Widget **仍应用显式 action** 以便审计与清 `completedAt` 逻辑集中。

**completedAt**：在 `returnYpiStudioToUserAcceptanceFromWidget` 内显式 `record.raw.completedAt = null`。若未来松散 transition 也离开 terminal，建议抽 `applyStatusSideEffects(from,to)`；本任务最小范围仅 widget helper。

### 4.4 错误映射

对齐现有 widget decision：

| 条件 | code/status |
| --- | --- |
| 未绑定 | 403 |
| 非 completed / 已 archived | 409 |
| revision mismatch | 409 |
| 无 workflow 边 | 422 |
| unresolved improvements | 422 |
| not found | 404 |

## 5. 兼容性

- 旧客户端忽略未知 kind：前端 `userActionsForTask` 需 **显式允许** 新 kind，否则过滤掉。
- 旧服务端无 action：新前端 PATCH 会 400 — 前后端同发。
- 磁盘 workflow 无边：退回 422；归档不受影响。
- `userActions` JSON 仍 omit-when-empty。

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 工作区 workflow JSON 缺边 | 更新默认 + 本仓文件；错误文案提示补边或 studio-init overwrite |
| 用户以为归档立即完成 | confirm + toast 说明「Chat 发起，模型整理后归档」 |
| 双路径 archive 行为不一致 | 文档标明 Panel=兜底；浮窗=模型 |
| 误清 completedAt 其它字段 | helper 只改 status/completedAt/member/meta 审计 |
| slash 被当普通 prompt | 证据显示 extension 优先；加单测/注释锁定 |
| max 2 被其它状态占用 | completed 分支独立 return，不与 approve 混投影 |
| 退回后用户再次完成 | 既有 user_acceptance → completed 路径，无需新做 |

## 7. 回滚

1. 投影去掉 completed 分支 → CTA 消失。  
2. route 去掉新 action 匹配。  
3. workflow 边可保留（无害）或回滚。  
4. 不迁移历史 task.json。

## 8. 测试策略

- `buildWidgetUserActions`：completed 两 CTA；archived 空；review-only 仅 archive（若传 flag）。
- body guard：`isYpiStudioWidgetReturnToUserAcceptanceBody`
- helper：completed→user_acceptance；清 completedAt；错误路径
- 前端过滤允许新 kind（逻辑单测或轻量）
- 回归：`test-ypi-studio-widget-actions` / `widget-continue` / `main-accept` / 关键 dag 用例
- 手工：§ ui.md checklist
