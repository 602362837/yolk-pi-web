# handoff（架构师 → 主会话）

## 状态

- 规划产物已写入任务目录。  
- **未改生产代码**；**未 commit**。  
- 请主会话：保存 implementationPlan（见 implement.md JSON）→ `transition → awaiting_approval` → 等用户批 plan-review。

## 产物

| 文件 | 说明 |
| --- | --- |
| [brief.md](brief.md) | 目标摘要 |
| [prd.md](prd.md) | 需求与矩阵 |
| [ui.md](ui.md) | 无视觉改版 + checklist |
| [design.md](design.md) | 方案与 slash 证据 |
| [implement.md](implement.md) | 6 子任务 DAG |
| [checks.md](checks.md) | 验收清单 |
| [plan-review.md](plan-review.md) | **用户审批入口** |

## 关键设计决策（已写入 PRD/Design）

1. **退回**：显式 `return_to_user_acceptance` + workflow 边 `completed→user_acceptance` + 清 `completedAt`。  
2. **归档**：`onComposeSend("/studio-archive")`；AgentSession.prompt 可执行 extension command（有代码证据）。  
3. **UI 门禁**：不产 HTML 视觉稿。  
4. **不改** Panel 归档与主验收「确认并归档」。

## 主会话需确认 / 执行

1. 用户审 [plan-review.md](plan-review.md)（Q1–Q4 默认是否采纳）。  
2. 保存 implementationPlan 到 task state。  
3. `transition` → `awaiting_approval` 后停止；批准后再 implementing。  
4. 若用户要求主验收「确认并归档」也改模型路径 → 另开范围，勿塞进本 DAG。

## 风险

- 他仓 workflow JSON 可能缺新边 → 422 + 文档。  
- 用户可能期望归档按钮立即完成 → toast/文案已要求说明 Chat 异步。  
- 实现时勿把 `studio_archive` 误接入 post-PATCH continue helper。

## 验证

规划阶段未跑生产 lint/tsc（无代码变更）。实现阶段命令见 checks.md。
