# 计划审批书：任务浮窗 completed 态退回用户验收与 /studio-archive 归档

> 本文件是用户确认入口。请结合下列产物审阅后批准或要求修改。  
> **未确认前禁止进入 implementing。**

## 一句话目标

在 **Completed 且未归档** 的会话浮窗任务卡上，提供两个决策按钮：**退回用户验收**（原子 `completed → user_acceptance`）与 **归档**（主路径 Chat 发送 **`/studio-archive`**，由当前模型整理 knowledge），且 **不改浮窗视觉体系**。

## 产物索引

| 产物 | 链接 | 用途 |
| --- | --- | --- |
| Brief | [brief.md](brief.md) | 背景与成功标准 |
| PRD | [prd.md](prd.md) | 范围、动作矩阵、验收、未决默认 |
| UI | [ui.md](ui.md) | **无视觉改版** + 交互 checklist（不指派 HTML 视觉稿） |
| Design | [design.md](design.md) | 模块边界、slash 证据、API、风险 |
| Implement | [implement.md](implement.md) | schemaVersion 2 DAG（6 子任务） |
| Checks | [checks.md](checks.md) | 自动/手工检查 |

## PRD 摘要

### 范围内

1. Workflow 增加 `completed → user_acceptance`（标准三工作流；review-only 不加）。  
2. `userActions` 在 completed 投影最多 2 项：`studio_archive` + `return_to_user_acceptance`。  
3. 退回：显式 PATCH `return_to_user_acceptance`（binding/revision/单锁，清 `completedAt`）。  
4. 归档：确认后 `onComposeSend("/studio-archive…")`；**禁止**浮窗 silent `allowFallbackKnowledge` 主路径。  
5. Hybrid B busy / contextId / confirm 保全；Panel 归档与主验收「确认并归档」**本任务不改**。

### 范围外

视觉改版、远程 UI 协议、improvement 流改造、强制统一主验收归档为模型路径。

### 动作矩阵（锁定）

| 动作 | PATCH | Chat | busy 禁用 |
| --- | --- | --- | --- |
| 退回用户验收 | 是 | 否 | 是 |
| 归档 | 否（主路径） | 是 `/studio-archive` | 是 |

## UI 门禁结论

- **触发轻量交互变更**，但用户明确：**不重画视觉原型**。  
- **不指派 UI 设计员 HTML 稿**；[ui.md](ui.md) 为交互 checklist，生产组件 + 现网 CSS 为唯一视觉权威。  
- 复用 `.ypi-decision-btn` 主/次按钮与 disabled 态。

## Design 摘要

### 退回

- 新 helper `returnYpiStudioToUserAcceptanceFromWidget`（对齐 `start_user_acceptance`）。  
- `status=user_acceptance`，`completedAt=null`，event `source=user-widget`。  
- 缺 workflow 边 → 422。

### 归档（slash 可行性）

现网：`handleSend` → agent `prompt` → 若消息以 `/` 开头则执行 **extension command**。  
`studio-archive` 已 `registerCommand`，会 `sendUserMessage` 引导模型整理 knowledge 并 `ypi_studio_task(action=archive, knowledgeSummary, knowledgeMarkdown, …)`。  
因此 **`onComposeSend("/studio-archive")` 与手动 slash 同语义**。

### 保全

- `userActions` max 2；无 remote-exec 字段。  
- `ypiStudioWidgetActionNeedsChatContinue` **不**包含新 kinds。  
- archived 无 CTA；主验收 / approve_* 不变。

## Implement 摘要（DAG）

| id | 内容 |
| --- | --- |
| COMP-WF-01 | BASE_TRANSITIONS + 本仓 workflow JSON 新边 |
| COMP-TYPES-02 | kinds + return body/guard |
| COMP-DOMAIN-03 | return helper + route |
| COMP-PROJECT-04 | completed 投影 |
| COMP-WIDGET-05 | Widget confirm / PATCH / slash Send |
| COMP-DOCS-TEST-06 | docs + 测试 + lint/tsc |

- **maxConcurrency = 2**  
- 完整 JSON 见 [implement.md](implement.md) 内 `ypi-implementation-plan` 块。

## Checks 摘要

- 自动：lint、tsc、`test:studio-widget-actions` / `continue` / `main-accept`。  
- 手工：ui.md checklist（退回后再验收、Chat 归档、busy、archived 只读、Panel 回归）。  
- 红线：无 silent archive 主路径；无 CSS 视觉改版。

## 推荐默认（待你确认）

| # | 议题 | 推荐 |
| --- | --- | --- |
| Q1 | 归档 reason 输入 | 默认不强制；直接 `/studio-archive` |
| Q2 | 主验收「确认并归档」 | **本任务不改** |
| Q3 | 他仓 workflow 缺边 | 代码默认 + 本仓 JSON；缺边 422 + 文档说明 |
| Q4 | review-only completed | 仅「归档」CTA |

## 请你确认

- [ ] 批准本计划（含 Q1–Q4 推荐默认，或给出修改）  
- [ ] 确认 **归档主路径 = Chat `/studio-archive`**，非 Panel fallback  
- [ ] 确认 **无 HTML 视觉原型门禁**（ui.md checklist 足够）  
- [ ] 确认可保存 implementationPlan 并在批准后进入 implementing  

## 架构师说明

规划产物已齐。按工作室流程：主会话保存 `implementationPlan` 后将任务置 **`awaiting_approval`**，**等待用户确认**；确认前不得指派实现员、不得改生产代码。
