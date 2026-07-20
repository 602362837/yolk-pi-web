# PRD：任务浮窗 completed 态退回用户验收与 /studio-archive 归档

## 1. 目标与背景

### 1.1 目标

当会话浮窗绑定任务处于 **`status === "completed" && !archived`** 时，提供两个可操作按钮：

| # | 按钮 | 行为 |
| --- | --- | --- |
| R1 | **退回用户验收** | 原子写：`completed → user_acceptance`，回到既有主验收路径 |
| R2 | **归档** | 主路径：**Chat Send `/studio-archive`**（或与 extension command 完全等价的固定引导语义），用**当前会话模型**整理 knowledge 并调用 archive；**禁止**浮窗静默 `allowFallbackKnowledge` 服务端归档作为主路径 |

### 1.2 背景

- Completed 是“结果已确认完成、尚未归档”的状态；用户可能误点完成，需要退回验收；也可能要正式归档沉淀知识。
- 现网浮窗在 Completed 无可写 CTA；工作流仅 `completed → archived`。
- Hybrid B（前序任务）已提供：`userActions` 投影、decision region、`agentRunning` busy、`onComposeSend(handleSend)`。

### 1.3 非目标

- 不改浮窗布局 / 色板 / rail / 决策区视觉体系。
- 不改 Panel 归档（可继续 `allowFallbackKnowledge`）。
- 不改主验收对话框里「确认并归档」的既有语义（可后续另开任务对齐模型归档；本任务不强制）。
- 不扩展远程 UI 执行协议；不改 improvement 流；不拆 `studio_autocontinue`。
- 不为 archived 任务提供写 CTA。

## 2. 范围内 / 范围外

### 2.1 范围内

1. Workflow：在默认工作流（含 `user_acceptance` 的 feature-dev / bugfix / ui-change）增加边 **`completed → user_acceptance`**；`review-only` 无 `user_acceptance` 则不投影退回 CTA。
2. 投影：`buildWidgetUserActions` 在 `completed && !archived` 投影最多 2 个 allowlisted kinds。
3. 写路径：显式 PATCH action **`return_to_user_acceptance`**（推荐，仿 `start_user_acceptance`），binding / status / revision CAS / 单锁。
4. 归档 CTA：确认后 `onComposeSend("/studio-archive" | "/studio-archive <reason>")`；busy 规则与 Hybrid B 一致。
5. 类型、route 匹配顺序、测试、docs 更新。
6. 本仓库 `.ypi/workflows/*.json` 同步新边；说明其他工作区如何获得边。

### 2.2 范围外

- 静默 server-only archive 作为浮窗主路径。
- 归档后 knowledge 编辑器 UI。
- 自动把所有历史 completed 任务批量退回。
- 视觉重设计 / HTML 视觉权威稿。

## 3. 动作矩阵（硬契约）

| 动作 | kind（投影） | PATCH | Chat Send | agentRunning 禁用 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 退回用户验收 | `return_to_user_acceptance` | **是**（显式 action） | **否** | **是** | 落库后 `canAcceptMain` 可再出现；无 auto 完成 |
| 归档 | `studio_archive` | **否**（主路径） | **是** `/studio-archive…` | **是** | 与 extension command 同语义；模型再调 archive |
| 既有 approve_* / start_user_acceptance / 结果验收 | 不变 | 不变 | 不变 | 不变 | 保全 |

### 3.1 退回用户验收语义

- **前置**：`!archived`、`status === "completed"`、任务绑定当前 `contextId`、工作流存在 `completed → user_acceptance` 与 `user_acceptance` 状态、无未解 improvement（防御性 recheck）。
- **效果**：
  - `status = user_acceptance`
  - 清除 `completedAt`（离开 terminal）
  - `currentMember` 按 workflow state owner（main）
  - event：`source=user-widget` / `action=return_to_user_acceptance`
  - 不写 plan `approvalGrant`；不 archive；不创建 improvement
- **失败**：409/422 等稳定映射；零部分写；刷新投影。

### 3.2 归档语义（浮窗主路径）

- **前置**：`!archived`、`status === "completed"`、有 `contextId`、Chat 可发送（`onComposeSend`）、`!agentRunning`。
- **确认后**：调用 `onComposeSend` 发送：
  - **首选**：`/studio-archive` 或 `/studio-archive <optional reason>`
  - **等价兜底文案**（仅当产品确认 slash 在某环境不可用时）：与 `lib/ypi-studio-extension.ts` 中 `studio-archive` handler 注入的 `sendUserMessage` 正文一致（固定模板，含 task 确认 + 模型整理 knowledge + `ypi_studio_task(action=archive, …)`）。
- **禁止**：浮窗主路径直接 `PATCH action=archive` + `allowFallbackKnowledge: true`。
- **允许保留**：Studio Panel 归档；主验收「确认并归档」既有路径（本任务不改）。
- **成功 toast**：说明已在 Chat 发起 `/studio-archive`，由当前模型整理知识后归档。
- **Send 失败**：任务仍为 completed；toast 提示用户在输入框手动 `/studio-archive`。

### 3.3 busy / 绑定

与 Hybrid B 一致：

- `disabled = agentRunning || acceptingInFlight`
- confirm 返回后二次检查 `agentRunningRef`
- 缺 `cwd` / `contextId`：toast 且不写
- quick preview 在 agentRunning 时仍可读

## 4. 用户故事与验收标准

### US-1 退回用户验收

- **Given** 绑定任务 `completed` 且未归档，workflow 支持边  
- **When** 用户确认「退回用户验收」  
- **Then** 任务变为 `user_acceptance`，`completedAt` 清空；浮窗出现主验收 CTA；rail 回到 User Acc.；无 Chat 强制续推

### US-2 归档走 /studio-archive

- **Given** 同上且 Chat 空闲  
- **When** 用户确认「归档」  
- **Then** Chat 执行 `/studio-archive` 语义（extension command → 引导模型整理 knowledge 并 archive）；浮窗不直接 silent archive；agentRunning 期间按钮禁用

### US-3 工作中禁用

- **Given** `agentRunning === true`  
- **When** 用户看 Completed 卡  
- **Then** 两写 CTA disabled + title「Chat 正在工作，请稍后再试」

### US-4 已归档只读

- **Given** `archived`  
- **When** 投影  
- **Then** 无 `userActions`、无写按钮

### US-5 保全

- awaiting_approval / review / waiting_for_improvements / 主验收 / improvement 验收行为与 Hybrid B 前一致  
- `userActions` 仍 max 2，无 endpoint/body/path 泄漏

## 5. 标签与文案（产品默认，可微调措辞）

| kind | role | label | confirm 标题 |
| --- | --- | --- | --- |
| `studio_archive` | primary | 归档 | 归档任务？ |
| `return_to_user_acceptance` | secondary | 退回用户验收 | 退回用户验收？ |

Decision region 标题建议：`👉 需要你的决定: 完成态收尾`（实现可微调，语义锁定 completed 收尾）。

## 6. 未决问题（建议默认，待主会话/用户确认）

| # | 问题 | 推荐默认 |
| --- | --- | --- |
| Q1 | 归档是否弹 reason 输入？ | **可选**：默认无输入，发送 `/studio-archive`；若要 reason 用可选 prompt，拼到 `/studio-archive <reason>` |
| Q2 | 主验收「确认并归档」是否一并改为模型归档？ | **本任务不做**（保全主路径）；仅 Completed 卡新按钮走 `/studio-archive` |
| Q3 | 其他已有工作区 workflow JSON 无新边？ | 更新代码默认 + 本仓库 `.ypi/workflows`；文档说明可 `/studio-init` overwrite 或手补 transition；helper 在缺边时返回明确错误 |
| Q4 | `review-only` completed？ | 只投影 **归档**（若仍 completed）；不投影退回（无 user_acceptance）—— 此时 max 1 action，符合 ≤2 |

## 7. 依赖与保全清单

- 复用：`onComposeSend`、`agentRunning`、decision region、`WIDGET_USER_ACTIONS_MAX=2`、confirm/toast、`withTaskMutationLock`
- 保全：archived readonly、canAcceptMain、start_user_acceptance、approve_* Chat continue、Panel archive、improvement 流
