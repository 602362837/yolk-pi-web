# PRD：任务浮窗决策 CTA → Chat Send 续推 + 工作中禁用

## 1. 目标与背景

### 1.1 目标

在**不削弱** Phase 1 审批原子性的前提下，让浮窗决策 CTA 的「需要主会话继续干活」路径：

1. 先 **PATCH** 完成状态机 / grant / revision CAS；
2. 成功后通过 **当前 Chat 的 `handleSend`** 发送**固定、可审计**引导词；
3. 在 **agent 工作中或写操作 busy** 时禁用决策区与结果验收 CTA。

### 1.2 非目标

- 不把批准改成纯 Chat 文案触发（软化门禁）。
- 不把服务端 `studio_autocontinue`（子任务 DAG 槽位续推）一并拆除。
- 不扩展 `userActions` kind，不改投影上限 2。
- 不改 quick preview 只读、8 站 rail、主/改进结果验收状态机语义。
- **不改现有浮窗视觉/布局/设计语言**（含决策区、rail、验收区、预览区样式）。任务内 HTML 示意**非**视觉权威；实现以生产 `YpiStudioSessionWidget` 与现网 CSS 为准。

## 2. 范围内 / 范围外

### 2.1 范围内（Phase 1 本任务）

| # | 需求 |
| --- | --- |
| R1 | 动作矩阵落地（见 §3） |
| R2 | Chat Send 接线：`AppShell` / `ChatWindow` → widget 可调用当前会话 `handleSend` |
| R3 | 固定引导词模板（含 taskId/action/revision 边界，无 HTML/endpoint） |
| R4 | busy 禁用：决策 CTA + 改进结果验收 + 主任务验收 |
| R5 | toast：成功续推 / 落库但 Send 失败 / 工作中点击不可用提示 |
| R6 | server `request_plan_changes` best-effort 旁路改为**降级 fallback 或删除主路径双发**（推荐见 Design） |
| R7 | 保全清单 A–F 回归 |
| R8 | 文档更新（frontend/api/library/overview 相关段落） |
| R9 | 测试：widget actions / busy 纯函数 / 引导词 builder（若抽出） |

### 2.2 范围外

- 详情抽屉内审批按钮改造。
- 多任务同时绑定会话时的「非 primary 任务」自动编排策略变更（仍仅用户点哪张卡推哪张）。
- 服务端子任务完成 `studio_autocontinue` / child continuation 改 Chat Send。
- 引导词可配置化 / i18n 框架。
- 新 kind / 远程 UI 执行协议。

## 3. 动作矩阵（硬契约）

| 动作 | 是否 PATCH | 是否 Chat Send 引导 | 工作中是否禁用 | 备注 |
| --- | --- | --- | --- | --- |
| `approve_plan` | **是** | **是**（PATCH 成功后） | **是** | 固定引导：计划已批准，请继续 implementing 编排 |
| `request_plan_changes` | **是** | **是**（PATCH 成功后；替代 server `inner.prompt` 主路径） | **是** | feedback 已落库；引导词可摘要 feedback，不重复要求用户输入 |
| `approve_improvement_plan` | **是** | **是** | **是** | 实例 DAG 续推；parent 保持 `waiting_for_improvements` |
| `start_user_acceptance` | **是** | **否** | **是** | 故意等人再点主验收；无 autocontinue |
| 改进结果验收 | **是**（既有 `transition_improvement → accepted`） | **否** | **是** | 结果写库，不唤醒实现 |
| 主任务验收 / 确认并归档 | **是**（既有 completed / archive） | **否** | **是** | 结果写库，不唤醒实现 |

### 3.1 引导词原则

- **固定模板**，由前端（或 shared pure helper）按 `kind` 生成。
- 必须包含：`taskId`（或 taskKey）、`action`、相关 `revision`（from/to 或 expected）、可选 `improvementId`/`displayId`。
- **不得**包含：任意 HTML、endpoint、用户密钥、完整 artifact 正文。
- `request_plan_changes`：feedback 已在 PATCH body 落库；引导词可带 **截断摘要**（≤200 字展示）并明确「以任务事件/产物为准，勿要求用户再次粘贴」。
- 语言：中文主文案 + 机器可读 bullet（与现有 server continuation prompt 风格对齐，但走 Chat 用户消息）。

### 3.2 推荐引导词骨架（实现可微调措辞，语义锁定）

**approve_plan**

```text
YPI Studio 用户已在会话浮窗批准主任务计划（source=user-widget）。该决定已落库：status 应为 implementing，approvalGrant 已写入。
请继续自动编排，不要等待用户再次输入批准文案。

- taskId: <id>
- action: approve_plan
- expectedRevision: <n>
- reason: widget approve_plan persisted; continue implementing orchestration

请：ypi_studio_task(current/get) 确认状态 → 按 implementationPlan 执行 implementation_next/claim 并派发 implementer（遵守 maxConcurrency）→ 不要伪造额外批准。
```

**request_plan_changes**

```text
YPI Studio 用户已在会话浮窗请求修改计划。该决定已落库（status=planning，旧 grant 已清除，planRevision 已提升）。请继续自动重跑架构规划。

- taskId: <id>
- action: request_plan_changes
- revisionFrom: <n>
- revisionTo: <m>
- feedbackSummary: <truncated ≤200>
- reason: widget request_plan_changes persisted; wake architect planning

请更新规划产物与 plan-review，保存 implementationPlan，transition 到 awaiting_approval 后停止；不要本轮进入 implementing。
```

**approve_improvement_plan**

```text
YPI Studio 用户已在会话浮窗批准改进计划（source=user-widget）。该改进实例应已进入 implementing；主任务保持 waiting_for_improvements。

- taskId: <id>
- action: approve_improvement_plan
- improvementId: <id>
- displayId: <displayId>
- expectedRevision: <n>
- reason: widget approve_improvement_plan persisted; continue instance DAG

请仅推进该 improvement 的 instance plan（claim/dispatch），不要误批主任务计划，不要完成/归档主任务。
```

## 4. 用户故事与验收标准

### US-1 批准主计划后 Chat 可见续推

- **Given** 绑定会话浮窗投影 `approve_plan`，Chat 空闲且模型已选  
- **When** 用户确认「批准并开始实现」  
- **Then**  
  1. PATCH 成功，任务 `awaiting_approval → implementing`，grant `source=user-widget`  
  2. Chat transcript 追加一条用户消息（固定引导词）  
  3. 同模型开始 SSE 工作；无需用户再手动输入  
  4. toast 成功语义为「已批准并已在 Chat 续推」类（见 UI）

### US-2 需要修改后 Chat 可见重规划

- **Given** `request_plan_changes` 可用  
- **When** 用户提交非空 feedback  
- **Then** 任务回 `planning`、revision+1、grant 清；Chat 出现引导词；**不依赖** server `inner.prompt` 才能工作；若 server fallback 仍存在，不得双发两条相同用户可见消息（见 Design 去重）

### US-3 批准改进计划后续推实例 DAG

- **Given** 第一项 `waiting_plan_approval`  
- **When** 批准  
- **Then** 仅该实例 `implementing`；Chat 引导词含 improvementId；主任务不离开 `waiting_for_improvements`

### US-4 进入用户验收 / 结果验收不 Send

- **Given** `start_user_acceptance` 或结果验收按钮  
- **When** 用户确认  
- **Then** 只 PATCH + toast + refresh；**Chat 不**自动插入引导词

### US-5 工作中禁用

- **Given** `agentRunning === true` 或写操作 in-flight  
- **When** 浮窗展示决策/验收 CTA  
- **Then** 按钮 `disabled`，`title`/`aria` 说明原因；点击无 PATCH  
- **And** agent 结束后（非 busy）恢复可点（以最新投影为准）

### US-6 Send 失败不回滚

- **Given** PATCH 已 200  
- **When** `handleSend` 抛错或因 agent 刚变忙而跳过  
- **Then** 不调用回滚 API；toast：「已落库但未能在 Chat 续推，请在输入框发送或重试」；`onTaskChanged` 仍刷新

### US-7 保全 A–F

见 §6；全部 Pass。

## 5. busy 定义（产品）

```text
widgetInteractionLocked =
  agentRunning   // AppShell 已有 chatAgentRunning，来自 ChatWindow/useAgentSession
  || acceptWriteBusy  // 任一决策/验收 in-flight
  || Boolean(decidingActionId) // 与现网一致，可并入 acceptWriteBusy
```

说明：

- `isStreaming` 在 Chat 层与 `agentRunning` 高度重合（`ChatInput isStreaming={agentRunning}`）；**以 `agentRunning` 为权威**，避免双源不一致。若未来拆分，再 `|| isStreaming`。
- 只读 quick preview **默认保持可点**（与前序「预览可保持只读可用」一致）；若实现选择统一禁用，须在 UI 原型标明，但本 PRD **推荐预览仍可用**。
- 确认对话框已打开时，agent 开始工作：对话框可仍完成；**确认后的 PATCH 前**再次检查 lock，若已 lock 则 abort 并 toast「Chat 正在工作，请稍后再试」。

## 6. 现有能力保全清单（A–F · 硬回归）

继承 `20260716-174251`，本任务**不得回退**：

| ID | 能力 |
| --- | --- |
| A | 壳层 / **完整 8 站** `WorkflowRail`（`is-eight-station`）/ 详情入口 |
| B | `quickPreviews` 只读；打开材料不写 grant |
| C | 改进摘要 + 改进结果验收 |
| D | 主验收 + 确认并归档 |
| E | runtime / 子任务 / live overlays / 写锁串行 |
| F | 聊天路径 `user-input` 批准与 regex 门禁仍可用；`user-widget` 继续被 gate 接受 |

另：server 投影规则、max 2 actions、revision CAS、零部分写、409 刷新，均保持。

## 7. 成功指标（定性）

- 批准/改计划/批改进计划三条路径：人工点一次即可在 Chat 看到续推，无需二次输入。
- 工作中误点决策/验收为 0 次有效 PATCH（按钮 disabled）。
- 无「toast 承诺编排但 transcript 空白」的默认路径。

## 8. 未决问题

无阻塞未决（用户已确认 Hybrid B）。实现期仅允许：

- server fallback **删除 vs 保留双保险**的最终选型在 Design 推荐「删除主路径双发、保留 helper 供测试/紧急」；若评审偏好「Chat 失败后的 server fallback」，可在 approval 时勾选，但必须防双发。

## 9. 验收总表（检查员用）

| ID | 标准 | 类型 |
| --- | --- | --- |
| AC-1 | 动作矩阵 6 行行为与 §3 一致 | 手工 + 单测 |
| AC-2 | 续推消息出现在 transcript 且模型=Chat 当前模型 | 手工 |
| AC-3 | busy 时决策+双验收 disabled | 手工 + 单测 |
| AC-4 | Send 失败不回滚 PATCH | 手工 / 单测 mock |
| AC-5 | 保全 A–F | 回归脚本 + 静态 diff |
| AC-6 | lint + tsc + studio-widget-actions + main-accept | 自动 |
