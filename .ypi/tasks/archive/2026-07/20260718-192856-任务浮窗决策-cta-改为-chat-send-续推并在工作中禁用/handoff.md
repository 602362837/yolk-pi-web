# Handoff：架构师规划完成 → 待用户批准

## 任务

`20260718-192856-任务浮窗决策-cta-改为-chat-send-续推并在工作中禁用`  
角色：architect（planning → 应进入 **awaiting_approval**）

## 已完成

已写满并互相一致的产物：

| 文件 | 说明 |
| --- | --- |
| [brief.md](brief.md) | 背景与 Hybrid B 边界 |
| [prd.md](prd.md) | 需求、矩阵、US/AC、保全 A–F |
| [design.md](design.md) | 数据流、接线、server 选项 A、风险回滚 |
| [ui.md](ui.md) | UI 门禁判定、状态、文案 |
| [studio-widget-chat-send-continue-prototype.html](studio-widget-chat-send-continue-prototype.html) | **HTML 原型**（7 场景） |
| [implement.md](implement.md) | schemaVersion 2 DAG，5 子任务，maxConcurrency=2 |
| [checks.md](checks.md) | 覆盖/自动/手工/A–F |
| [plan-review.md](plan-review.md) | **用户审批入口**（含相对链接） |

**未改生产代码；未 commit/push/merge；未进入 implementing。**

## 用户需确认的范围要点

1. **Hybrid B**：先 PATCH，再 Chat `handleSend` 固定引导词；禁止只 Send 批准。  
2. **矩阵**：三批准/改计划要 Send；`start_user_acceptance` 与结果验收 **不** Send。  
3. **busy**：`agentRunning || 写 busy` 禁用决策+验收；预览推荐仍可点。  
4. **server**：推荐删除 `request_plan_changes` route 内 best-effort 主路径，防双发。  
5. **Send 失败**：不回滚；partial toast。  
6. **保全 A–F** 不回退。  
7. **HTML 原型**已包含：见 plan-review 链接。

## HTML 原型

- 路径：任务目录 `studio-widget-chat-send-continue-prototype.html`  
- 是否已含链接：**是**（plan-review / ui.md）

## 环境限制（主会话知晓）

- 本 member 运行时**无** `ypi_studio_task` / `ypi_studio_subagent` 工具注入。  
- 无法真实派发 `ui-designer` 子代理；HTML 由架构师按现网与前序原型交付。  
- 任务状态 transition 到 `awaiting_approval` 需主会话用 Studio 工具或等价 API 执行（architect 已写好 plan-review 实质内容以满足门禁）。

## 主会话下一步

1. 审阅 [plan-review.md](plan-review.md) 与 HTML 原型。  
2. 将任务 **transition → awaiting_approval**（若尚未）。  
3. 用户批准后：保存 implementationPlan → implementing → 按 DAG 派 implementer。  
4. **不要**在批准前写业务代码。

## 验证

- 规划阶段：源码阅读 + 文档交叉一致（无 lint/tsc 代码改动）。  
- 实现阶段验证命令见 implement.md / checks.md。

## 残留风险

- 状态机 transition 若未由主会话执行，任务可能仍显示 planning。  
- 若用户坚持保留 server fallback，需在批准意见中改选项 A→B，并补双发防护设计后再实现。
