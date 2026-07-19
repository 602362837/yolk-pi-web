# Review：任务浮窗决策 CTA → Chat Send 续推并在工作中禁用

**Task:** `20260718-192856-任务浮窗决策-cta-改为-chat-send-续推并在工作中禁用`  
**Role:** checker  
**Date:** 2026-07-18  
**Verdict:** **Pass**（含检查员范围内小修复；无阻塞返工）

---

## 1. 范围对照

| 子任务 | 状态 | 证据 |
| --- | --- | --- |
| CONT-HELPER-01 | Done | `lib/ypi-studio-widget-continue.ts` + `scripts/test-ypi-studio-widget-continue.mjs` + `package.json` script |
| CONT-WIRE-02 | Done | `ChatWindow.onComposeSendReady` → `AppShell.composeSendRef` → widget `onComposeSend` / `agentRunning` |
| CONT-WIDGET-03 | Done | busy 禁用、二次 lock、PATCH 后 Send、partial toast、矩阵 6 行 |
| CONT-SERVER-04 | Done | route 删除 `bestEffortContinue*` 主路径调用；helper `@deprecated` 保留；`studio_autocontinue` 未动 |
| CONT-DOCS-TEST-05 | Done | frontend/api/library/overview 已描述 Hybrid B |

---

## 2. 需求 / 动作矩阵

| 动作 | PATCH | Chat Send | 工作中禁用 | 结论 |
| --- | --- | --- | --- | --- |
| `approve_plan` | 是 | 是（PATCH 后） | 是 | Pass |
| `request_plan_changes` | 是 | 是（替代 server wake） | 是 | Pass |
| `approve_improvement_plan` | 是 | 是 | 是 | Pass |
| `start_user_acceptance` | 是 | **否** | 是 | Pass |
| 改进结果验收 | 是 | **否** | 是 | Pass |
| 主验收/归档 | 是 | **否** | 是 | Pass |

**Hybrid B 硬约束：** 无「只 Send 不 PATCH」路径；决策仍走显式 action body + revision/context。

---

## 3. 设计 / 边界

- **接线：** `ChatWindow` 注册 `handleSend`；unmount cleanup `null`；AppShell ref 转发。符合 Design 最小侵入方案。
- **Server 选项 A：** `app/api/studio/tasks/[taskKey]/route.ts` 成功分支不再调用 `bestEffortContinueAfterWidgetRequestPlanChanges`；`lib/ypi-studio-session-link.ts` helper 标注 deprecated-as-primary。
- **`studio_autocontinue` / child continuation：** `lib/rpc-manager.ts` 中 `studio_autocontinue`、`scheduleStudioFollowUp`、子任务续推保留。
- **Send 失败不回滚：** catch 仅 partial toast + 已调用 `onTaskChanged`；无回滚 API。
- **二次 lock：** confirm/prompt 后读 `agentRunningRef`；改进/主验收同理。
- **预览：** quick preview 未因 `agentRunning` 禁用（符合 UI 推荐）。

---

## 4. 视觉硬约束（ui.md §0）

| 检查 | 结果 |
| --- | --- |
| `app/globals.css` 是否因本任务改写决策区/rail/验收区 | **否**（diff 无 globals.css） |
| 是否按 HTML 原型重画 DOM/class/色板 | **否** |
| 允许变化：`disabled` / `title` / `aria-*` / toast / Chat 用户消息 / 行为接线 | **是** |

HTML `studio-widget-chat-send-continue-prototype.html` 仅作交互场景旁证；生产组件为唯一 UI 权威。本任务交互/反馈变更，**不要求**新视觉稿。

---

## 5. 保全 A–F

| ID | 项 | 结论 |
| --- | --- | --- |
| A | 8 站 `WorkflowRail` / Detail | Pass（未改 rail 结构） |
| B | quickPreviews 只读 | Pass（busy 时仍可预览） |
| C | 改进摘要 + 结果验收 | Pass（仅 disabled + 二次 lock） |
| D | 主验收 + 归档 | Pass（PATCH body 不变） |
| E | runtime / overlays / 写锁 | Pass（写锁覆盖决策+验收） |
| F | 聊天 `user-input` 批准 | Pass（未删除 record 路径） |

---

## 6. Findings Fixed（检查员小修）

1. **AppShell `onComposeSend` 假成功**（原实现：`(message) => composeSendRef.current?.(message)` 在 ref 为 null 时静默 no-op，widget 仍 toast「已在 Chat 续推」）。  
   **修复：** 无 send 时 `throw`，走 partial toast 分支。
2. **`request_plan_changes` 引导词缺 `revisionTo`**（builder 无 `revisionTo` 时 `revisionFrom/To` 同为 expected）。  
   **修复：** widget 传入 `expectedRevision + 1`（与落库 +1 语义一致）。

---

## 7. Remaining Findings

### Blocking

None。

### Non-blocking

1. **`handleSend` 在 `agentRunning` 时静默 return 不 throw**（`useAgentSession`）：若 PATCH 与 Send 之间 agent 刚变忙，可能仍 toast 全成功而 transcript 无消息。主路径有 disabled + 二次 lock 大幅降低概率；完整修需 `handleSend` 返回成功态（范围外，建议后续小改）。
2. **`package-lock.json` 大 diff**（~1.7k 行 AWS/SDK 等无关 churn）与本任务仅加 `test:studio-widget-continue` 脚本不匹配。建议主会话评估是否回滚 lock 无关变更，仅保留 script 相关项。
3. **仓库级 `npm run lint`** 仍有既有 4 error（`TrellisWorkflowVisualizer` React Compiler memoization 等），**与本 diff 无关**；改动文件无 lint 命中。
4. **手工 dev 场景**（批准→流式、改计划无双消息、工作中 disabled、mock Send fail）未在本环境实点；自动验证与静态审已覆盖契约，人工点按建议主会话/验收阶段补一轮。

---

## 8. Verification

| 命令 | 结果 |
| --- | --- |
| `node_modules/.bin/tsc --noEmit` | Pass（0 error） |
| `npm run test:studio-widget-continue` | Pass |
| `npm run test:studio-widget-actions` | Pass |
| `npm run test:studio-main-accept` | Pass |
| `npm run test:studio-dag` | Pass |
| `npm run lint` | 既有 4 error（非本任务文件）；本任务改动文件 0 hit |

---

## 9. Checks 勾选摘要

- R-01…R-13：代码审 + 单测覆盖；R-13 视觉硬约束 Pass  
- 动作矩阵 6 行：Pass  
- 文档门禁 frontend/api/library/overview：Pass  
- A–F：Pass  

---

## 10. Verdict

**Pass**

实现满足 Hybrid B、动作矩阵、busy 禁用、server 去双发、pure helper/测试与文档，且未重画浮窗视觉。检查员已修 2 处低风险 partial/引导词问题。主会话可进入后续 review / user_acceptance 流转（**检查员不自行 transition**）。

### 主会话建议

1. 决定 `package-lock.json` 无关 churn 是否回滚。  
2. 可选手工冒烟 checks.md §7。  
3. 合法 transition（checking → review / user_acceptance）由主会话执行。  
4. 不 commit/push（本检查员未执行）。
