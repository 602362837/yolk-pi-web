# Design：浮窗决策 CTA → Chat Send 续推 + 工作中禁用

## 1. 方案摘要

```text
用户点 CTA
  → (可选) confirm / prompt feedback
  → 若 widgetInteractionLocked：toast 并 return
  → PATCH /api/studio/tasks/[taskKey] 显式 action（原子门禁不变）
  → onTaskChanged 刷新投影
  → 若 kind ∈ {approve_plan, request_plan_changes, approve_improvement_plan}
       且 onComposeSend 可用
       且 !agentRunning（再次检查）
     → onComposeSend(buildWidgetContinuationPrompt(...))
     → toast 成功 / 部分成功
  → 否则（start_user_acceptance / 结果验收）：仅 toast 落库成功
```

**Hybrid B**：PATCH 保正确性；Chat `handleSend` 保可见性与模型一致性。  
**禁止**以 Chat 文案单独充当审批。  
**禁止**按任务内 HTML 原型改现有浮窗视觉/布局；生产 `YpiStudioSessionWidget` + 现网 CSS 为唯一 UI 权威。

## 2. 影响模块与边界

| 模块 | 变更 | 边界 |
| --- | --- | --- |
| `components/YpiStudioSessionWidget.tsx` | 接 `agentRunning` + `onComposeSend`；busy；PATCH 后 Send；toast | 不直接 import `useAgentSession`；不旁路 `sendAgentCommand` |
| `components/AppShell.tsx` | 把 `chatAgentRunning` 与 compose-send 句柄传给 widget | 不在 AppShell 内实现引导词业务 |
| `components/ChatWindow.tsx` | 向父层暴露 `handleSend`（callback 或 ref） | 不改 SSE/消息渲染主逻辑 |
| `hooks/useAgentSession.ts` | **尽量零改**；沿用 `handleSend` + `ensureSessionModel` | 若需 `return boolean` 成功态可小改，非必须 |
| `lib/ypi-studio-widget-continue.ts`（**新建推荐**） | pure：引导词 builder + `needsChatContinue(kind)` | 无 React / 无 fetch |
| `app/api/studio/tasks/[taskKey]/route.ts` | 去掉或降级 `bestEffortContinueAfterWidgetRequestPlanChanges` 主路径调用 | 写库语义不变 |
| `lib/ypi-studio-session-link.ts` / `lib/rpc-manager.ts` | 保留 helper 供 fallback/测试；文档标注非主路径 | 不删 `studio_autocontinue` 子任务续推 |
| `docs/modules/*` + `docs/architecture/overview.md` | 描述主路径变更 | — |
| 测试脚本 | 扩展 widget-actions / 新增 continue-prompt 断言 | — |

**不改**：`buildWidgetUserActions` 投影规则、grant 算法、8 站 rail、quick preview API、结果验收 PATCH body。

## 3. 数据流

### 3.1 续推类（approve_plan / request_plan_changes / approve_improvement_plan）

```text
TaskCard button
  → handleDecisionAction
  → confirm/prompt
  → lock check (agentRunning || acceptingInFlight)
  → PATCH explicit action
  → success:
       onTaskChanged(taskKey)
       if needsChatContinue(kind):
         try onComposeSend(prompt)
           ok → toast full success
           throw/false → toast partial success (no rollback)
  → error:
       conflict toast + onTaskChanged
```

### 3.2 非续推类（start_user_acceptance / 改进验收 / 主验收）

```text
confirm → lock check → PATCH → toast → onTaskChanged
（无 onComposeSend）
```

### 3.3 Chat Send 接线（推荐实现）

**问题**：`handleSend` 活在 `ChatWindow` → `useAgentSession`；`YpiStudioSessionWidget` 挂在 `AppShell` 与 `ChatWindow` 并列。

**推荐（最小侵入）**：

1. `ChatWindow` 增加可选 prop：  
   `onComposeSendReady?: (send: (message: string) => Promise<void> | void) => void`  
   在 mount/`handleSend` 变化时 `onComposeSendReady(handleSend)`；unmount 时 `onComposeSendReady(null)` 或 noop。
2. `AppShell` 用 `useRef`/`useState` 保存最新 `composeSend`。
3. `YpiStudioSessionWidget` props：  
   - `agentRunning?: boolean`（接现有 `chatAgentRunning`）  
   - `onComposeSend?: (message: string) => Promise<void> | void`

**备选（不推荐作主方案）**：扩展 `ChatInputHandle` 增加 `sendText`——会把业务续推塞进输入框组件，耦合更重。

**禁止**：widget 内 `fetch /api/agent/prompt` 或 `studio_user_action` 作为主路径。

### 3.4 与 server `studio_user_action` 关系（推荐决策）

| 选项 | 描述 | 评价 |
| --- | --- | --- |
| **A（推荐）** | 主路径仅 Chat Send；**删除** route 内 `bestEffortContinueAfterWidgetRequestPlanChanges` 调用；保留 builder/helper 供单测与紧急手动 | 无双发；模型对齐；失败可提示用户在 Chat 重试 |
| B | Chat 成功则跳过 server；Chat 失败再 server fallback | 需前端通知服务端或 route 无法知 Chat 结果 → 实现复杂 |
| C | 双发 | **禁止**：transcript 双消息 / 双编排 |

**推荐 A**。回滚：恢复 route 一行 best-effort 调用即可临时回到旧行为（仍有模型错位风险）。

`studio_autocontinue`（implementing 槽位、child 完成）**保持 server 路径**——不在本任务范围；那是编排内部事件，不是用户决策 CTA。

## 4. 接口契约

### 4.1 Widget props（additive）

```ts
interface YpiStudioSessionWidgetProps {
  // existing...
  /** Chat agent running (from AppShell chatAgentRunning). */
  agentRunning?: boolean;
  /**
   * Current Chat compose send (handleSend). Required for continue kinds.
   * Must pin model / append transcript / open SSE like a normal user send.
   */
  onComposeSend?: (message: string) => void | Promise<void>;
}
```

### 4.2 Pure helper（新建 `lib/ypi-studio-widget-continue.ts`）

```ts
export type YpiStudioWidgetContinueKind =
  | "approve_plan"
  | "request_plan_changes"
  | "approve_improvement_plan";

export function ypiStudioWidgetActionNeedsChatContinue(
  kind: YpiStudioWidgetUserActionKind,
): kind is YpiStudioWidgetContinueKind;

export function buildYpiStudioWidgetChatContinuePrompt(input: {
  kind: YpiStudioWidgetContinueKind;
  taskId: string;
  taskKey?: string;
  expectedRevision: number;
  revisionTo?: number;       // request_plan_changes
  improvementId?: string;
  displayId?: string;
  feedback?: string;         // already persisted; truncated in prompt
  targetLabel?: string;
}): string;
```

约束：

- 输出纯文本；长度建议硬顶 ~4k（feedback 截断 200）。
- 不读取 DOM / localStorage。
- 单测直接 assert 子串：`action:`、`taskId:`、禁止 `http://` 与 `<html`。

### 4.3 PATCH（不变）

既有 body：

- `approve_plan` / `request_plan_changes` / `approve_improvement_plan` / `start_user_acceptance`
- 结果验收既有 transition / completed / archive

route 变更点：仅 `request_plan_changes` 成功分支是否调用 best-effort（推荐删除调用）。

### 4.4 Toast 文案契约

| 场景 | tone | 文案方向 |
| --- | --- | --- |
| 批准 + Send ok | success | 计划已批准，已在 Chat 继续编排 |
| 批准 + Send fail | warning 或 error | 计划已批准并落库，但未能在 Chat 续推；请在输入框发送或刷新后重试 |
| 改计划 + Send ok | success | 修改反馈已落库，已在 Chat 续推规划 |
| 改计划 + Send fail | warning | 修改反馈已落库，但未能在 Chat 续推… |
| 改进计划批准 + Send ok/fail | 同上模式 | … |
| 进入验收 / 结果验收 | success | 保持现网语义（无「将继续编排」误导） |
| 工作中点击（若未 disabled 兜底） | info | Chat 正在工作，请稍后再试 |

**修正现网误导**：今日 `approve_plan` toast「Studio 将继续编排」在无续推时是假承诺；本任务后仅在 Send 成功（或明确 partial）时使用「继续」措辞。

## 5. busy / 无障碍

### 5.1 计算

```ts
const interactionLocked = Boolean(agentRunning) || Boolean(acceptingKey);
// TaskCard:
disabled={interactionLocked || Boolean(decidingActionId) /* deciding 已含于 acceptingKey */}
// 简化：disabled={interactionLocked} 且 interactionLocked 含 acceptingKey
```

决策按钮、改进验收、主验收统一使用同一 `interactionLocked`。

### 5.2 title / aria

- 当 `agentRunning`：`title="Chat 正在工作，请稍后再试"`；`aria-disabled` 与 `disabled` 同步。
- 当写 busy：保持现网「批准中… / 提交中… / 进入中… / 验收中…」。
- 决策 `aria-label` 保留对象与「不是结果验收」区分。

### 5.3 二次检查

confirm 异步返回后、PATCH 前：

```ts
if (agentRunningRef.current || acceptingInFlightRef.current) {
  toast({ message: "Chat 正在工作，请稍后再试", tone: "info" });
  return;
}
```

`agentRunning` 需 ref 镜像，避免闭包陈旧。

## 6. 兼容性

- Props 全 optional：旧调用方不传时，行为退化为「只 PATCH」（与今日批准类一致），但产品验收要求 AppShell 必传。
- 不迁移 task.json；无 schema  bump。
- 历史 `user-widget` grant 继续有效。
- server helper 删除调用 ≠ 删除函数：可先 deprecate 注释。

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Chat 未挂载 / 无 session | `onComposeSend` 缺失 → partial toast；不回滚 |
| confirm 期间 agent 开始跑 | PATCH 前 ref 检查 |
| 双发（若保留 server） | 推荐删 route 调用 |
| handleSend 在 agentRunning 时直接 return | 续推前检查；busy 禁用主路径 |
| 引导词过长 / 注入 | pure builder 截断；无 HTML |
| 多任务卡片连点 | 既有 `acceptingInFlightRef` 串行 |
| 模型仍错 | 走 ensureSessionModel；禁止 inner.prompt 主路径 |

## 8. 回滚

1. 停止传 `onComposeSend` / 忽略续推分支 → 恢复只 PATCH。  
2. 恢复 route `bestEffortContinueAfterWidgetRequestPlanChanges` 一行。  
3. 去掉 `agentRunning` disabled（不推荐单独回滚 busy）。  
Git revert 对应 PR 即可；无数据迁移。

## 9. 保全映射

| 保全 | 设计保证 |
| --- | --- |
| A rail | 不改 `WORKFLOW_RAIL_STAGES` / CSS |
| B preview | 不改 preview open；推荐 busy 时仍可预览 |
| C/D accept | 仅加 disabled 与共享 lock；PATCH body 不变 |
| E runtime | 不改 overlays |
| F chat approve | 不改 recordYpiStudioUserApproval |

## 10. 文档更新点

- `docs/modules/frontend.md`：`YpiStudioSessionWidget` / `AppShell` / `ChatWindow` 接线与 busy。  
- `docs/modules/api.md`：request_plan_changes 不再主路径 server wake（若选 A）。  
- `docs/modules/library.md`：新 pure helper；session-link best-effort 标注 deprecated-as-primary。  
- `docs/architecture/overview.md`：widget decision 续推改为 Chat Send。
