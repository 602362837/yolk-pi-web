# 计划审批书：任务浮窗决策 CTA → Chat Send 续推并在工作中禁用

> **请在此审阅完整规划。** 批准后任务进入 `implementing`；批准前请勿派 implementer。

## 1. 一句话

Hybrid B：**决策仍先原子 PATCH**；需要主会话干活的动作在成功后用 **当前 Chat `handleSend` 发固定引导词**；**agent 工作中禁用**决策与结果验收 CTA；Send 失败**不回滚**已落库状态。

### 视觉硬约束（用户反馈 · 已写入 ui.md）

- **不改现有浮窗 UI**：布局、色板、决策区/rail/验收区样式以生产 `YpiStudioSessionWidget` 为准。
- 任务目录内 HTML 仅为**交互状态说明**，**不是**视觉稿；实现**禁止**按该 HTML「还原」一版新 UI。
- 允许变化仅限：`disabled`/`title`/`aria`、toast 文案、Chat 多一条用户消息。

## 2. 要解决的三个 bug

1. 点批准后状态变了，Chat 不干活。  
2. 旁路 `inner.prompt` 模型错位 / 静默失败。  
3. agent 工作中仍可点浮窗写按钮。

## 3. 动作矩阵（请确认）

| 动作 | PATCH | Chat Send | 工作中禁用 | 说明 |
| --- | --- | --- | --- | --- |
| `approve_plan` | 是 | **是** | 是 | 主计划批准后编排 |
| `request_plan_changes` | 是 | **是**（替代 server 主路径） | 是 | feedback 已落库 |
| `approve_improvement_plan` | 是 | **是** | 是 | 实例 DAG |
| `start_user_acceptance` | 是 | **否** | 是 | 等人点主验收 |
| 改进/主结果验收 | 是 | **否** | 是 | 只写结果 |

## 4. 关键设计决策

| 决策 | 选择 |
| --- | --- |
| 方案 | Hybrid B（非「只发引导词」） |
| Chat 接线 | `ChatWindow.handleSend` → AppShell → `widget.onComposeSend` |
| busy | `agentRunning \|\| 写操作 in-flight`（`agentRunning` 权威） |
| server `request_plan_changes` wake | **推荐删除 route 主路径调用**，防双发；helper 可保留 |
| Send 失败 | 不回滚 PATCH；partial toast |
| 保全 | A–F 硬回归（8 站 rail / preview / 双验收 / runtime / 聊天批准） |

## 5. 产物索引（请点开）

| 产物 | 链接 |
| --- | --- |
| Brief | [brief.md](brief.md) |
| PRD | [prd.md](prd.md) |
| Design | [design.md](design.md) |
| UI 说明 | [ui.md](ui.md) |
| HTML 交互说明（**非视觉稿**） | [studio-widget-chat-send-continue-prototype.html](studio-widget-chat-send-continue-prototype.html) — 仅场景 checklist；**实现对照生产 UI** |
| Implement（含 DAG） | [implement.md](implement.md) |
| Checks | [checks.md](checks.md) |

### 交互场景 checklist（对照生产 UI，非新视觉）

1. 空闲主计划双 CTA（现网按钮样式）  
2. agentRunning 禁用写 CTA（现网 disabled）  
3. 批准后 Chat 出现引导词（现网消息气泡）  
4. 落库成功但 Send 失败 toast  
5. 需要修改后续推规划  
6. 改进计划批准  
7. 进入用户验收（无 Chat Send）+ 主验收  

## 6. Implementation Plan 摘要

- **5 子任务**，`schemaVersion: 2`，`maxConcurrency: 2`  
- `CONT-HELPER-01` pure 引导词  
- `CONT-WIRE-02` Chat 接线  
- `CONT-WIDGET-03` busy + PATCH 后 Send  
- `CONT-SERVER-04` 去掉 server 双发主路径  
- `CONT-DOCS-TEST-05` 文档与测试  

完整 JSON 块见 [implement.md](implement.md)。

## 7. 范围外（本次不做）

- 软化审批（无 PATCH 的批准）  
- 改造 `studio_autocontinue` 子任务续推为 Chat Send  
- 改 userActions 投影 kind / grant 算法  
- 详情抽屉审批 UI  

## 8. 风险（知情）

| 风险 | 缓解 |
| --- | --- |
| 无 `onComposeSend` 时只 PATCH | AppShell 必传；partial toast |
| confirm 期间 agent 启动 | 二次 lock |
| 文档/实现仍写 server wake | CONT-DOCS-TEST-05 |
| ui-designer 子进程未真实派发 | 已交付自包含 HTML；可要求补派署名 |

## 9. 请用户确认的勾选项

- [ ] 同意 Hybrid B 与动作矩阵（含 start_ua / 结果验收 **不** Send）  
- [ ] 同意 server `request_plan_changes` **取消主路径双发**（推荐 A）  
- [ ] 同意 busy = `agentRunning` + 写锁；预览 busy 时仍可点  
- [ ] 确认 **不改现有浮窗视觉**；HTML 仅交互说明  
- [ ] 已理解 toast / 禁用态 / Chat 续推场景（对照生产 UI）  
- [ ] 同意 5 项 DAG 与 maxConcurrency=2  
- [ ] 确认保全 A–F 为硬门禁  

## 10. 批准后主会话动作

1. 保存 `implementationPlan`（来自 implement.md JSON）。  
2. 合法 transition → `implementing`（需本 plan-review 有实质内容 — **已满足**）。  
3. 按 DAG claim/dispatch implementer；**不要**在未批准时实现。  

---

**状态建议：** 材料已齐 → 进入 **`awaiting_approval`**，等待用户批准。  
**非实现阶段。**
