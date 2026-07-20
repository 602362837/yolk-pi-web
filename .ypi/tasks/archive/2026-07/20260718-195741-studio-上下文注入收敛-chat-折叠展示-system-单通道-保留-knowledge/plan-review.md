# 计划审批书 — Studio Context Integrity（SCI）

> **审阅入口**：请先读本文，再按需打开下方产物链接。  
> **批准前请同时确认**：实现计划（SCI-01…06）+ **ui-designer 定稿 HTML 原型**。  
> **当前状态目标**：`awaiting_approval` — 用户确认前 **不实现**。

## 结论摘要

将 Studio 主会话上下文从「user transform + system 双注入」收敛为完整 **SCI**：

1. **L0 Chat**：渲染剥离已知注入标签 + compact `Studio · <status>` tag；Copy/Edit 用干净文本；历史脏 JSONL **不迁移**
2. **L1 注入**：`input` 只做审批副作用并 `continue`；**唯一**注入在 `before_agent_start`，且 `buildStudioState(root, key, event.prompt)` 保证 knowledge **不弱于现网**
3. **不回退**：子代理 `buildMemberPrompt`、widget、continuation、审批同轮 grant、编排规则、工具门禁

**L2**（no_task 轻量、token 优化、display:false custom、点 tag 展开）明确为后续，**不进本交付**。

## 产物链接

| 产物 | 链接 | 作用 |
| --- | --- | --- |
| Brief | [brief.md](brief.md) | 问题、目标、证据 |
| PRD | [prd.md](prd.md) | 范围、需求 R1–R17、验收 |
| Design | [design.md](design.md) | 数据流、契约、风险回滚 |
| Implement | [implement.md](implement.md) | 6 项 DAG + 阅读顺序 |
| Checks | [checks.md](checks.md) | **全覆盖**单测/回归/自动 vs 人工矩阵 |
| UI 说明 | [ui.md](ui.md) | 门禁、类名、状态矩阵（ui-designer 定稿） |
| **HTML 原型** | [sci-user-message-prototype.html](sci-user-message-prototype.html) | **L0 正式视觉审批材料（ui-designer）** |

## 门禁完成情况

| 项 | 状态 |
| --- | --- |
| 架构设计 / PRD / Design / Implement / Checks | 已完成 |
| implementationPlan 写入 task（SCI-01…06, maxConcurrency=2） | 已完成 |
| UI 原型（ui-designer @ grok-cli/grok-4.5, thinking high） | **已定稿** `sci-user-message-prototype.html` |
| 生产代码 | **未改** |
| 用户批准 | **待你确认** |

## Implementation Plan 一览

| ID | 标题 | 依赖 | 说明 |
| --- | --- | --- | --- |
| SCI-01 | strip/parse 纯函数 + 单测骨架 | — | 先做 |
| SCI-02 | L1 extension 单通道 + `event.prompt` query | SCI-01 | 可与 SCI-03 并行 |
| SCI-03 | L0 UserMessageView + CSS tag | SCI-01 | 严格对齐 HTML 原型 |
| SCI-04 | session title strip | SCI-01 | 标题不被注入污染 |
| SCI-05 | 自动化测试（strip + extension 行为） | SCI-01, SCI-02 | checks 自动化项 |
| SCI-06 | 文档 + 全量验证 | SCI-02…05 | lint/tsc/studio 回归 |

## 推荐默认决策（请确认或改口）

| # | 决策 | 默认 |
| --- | --- | --- |
| Q1 | tag 点击展开原始注入 | **L0 不做**（L2） |
| Q2 | startup 去掉重复 knowledge，保留 first-reply | **是** |
| Q3 | 标题 / firstMessage 展示 strip | **是** |
| Q4 | partial 半截标签是否显示中性 tag | **否**（保守全文，不显示成功态 tag） |
| Q5 | 批准本 HTML 作为 SCI-03 实现标准 | **请明确** |

## 核心能力保障（本任务硬门槛）

| 能力 | 策略 |
| --- | --- |
| 聊天批准同轮 grant | `input` 保留 `recordYpiStudioUserApproval`，去掉 transform |
| 每轮最新状态 | `before_agent_start` 每轮 `buildStudioState` |
| 主会话 knowledge | query = `event.prompt`（≥ 现网 `ev.text`） |
| 子代理 | **不改** `buildMemberPrompt` / child extension 跳过 |
| Widget / continuation | 不改；回归测试覆盖 |
| 历史脏消息 UI | L0 strip + tag，不改 JSONL |

## 检查矩阵（摘要）

完整表见 [checks.md](checks.md)。必须覆盖：

- **自动**：strip 边界 U1–U14；extension E1–E3（no transform / prompt query / approval spy）；`lint` / `tsc`；`test:studio-message-display`；`test:studio-dag` / widget / policy
- **人工 UAT**：脏 session UI、Copy/Edit、no_task 引导、聊天批准、子代理、widget、steer/follow-up、明暗主题、窄屏

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 去掉 user 注入后编排变弱 | system 每轮强制 state+rule；UAT G1–G3 |
| knowledge 变弱 | `event.prompt` query parity |
| strip 误伤用户 XML 示例 | 只剥完整闭合块；半截保守 |
| 历史 user 仍占模型 token | 接受；不迁移 JSONL |

**回滚**：Git 回滚代码即可；无数据迁移。可单独回滚 L1 保留 L0（不推荐长期）。

## 审批清单（用户）

- [ ] 同意 **L0 + L1** 范围，**L2 后续**
- [ ] 同意推荐默认 **Q1–Q4**
- [ ] 批准 HTML 原型 [sci-user-message-prototype.html](sci-user-message-prototype.html)
- [ ] 批准 implementationPlan **SCI-01…06**（maxConcurrency=2）
- [ ] 知悉历史 JSONL **不改写**；历史轮次模型上下文仍可能含旧脏 user 文本
- [ ] 知悉 checks 必须全覆盖；实现后走 checker

**批准用语示例：**

```text
确认，按 plan-review 与 sci-user-message-prototype.html 开始实现
```

**修改用语示例：**

```text
需要修改：…
```

---

*主会话说明：架构师 + ui-designer 已完成规划与 UI 门禁材料；implementationPlan 已保存。收到你的明确批准后才会 transition → implementing 并派 implementer。*
