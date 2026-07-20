# PRD — Studio Context Integrity（SCI）

## 1. 目标与背景

### 1.1 背景

YPI Studio 需要把当前任务状态、编排规则与可复用 knowledge 注入主会话 LLM。现网通过 **user message transform + systemPrompt** 双通道注入，导致：

- Chat 用户气泡被注入块淹没
- JSONL 持久化污染（历史消息永久脏）
- Copy / Edit from here / 会话标题种子可能带上注入噪声
- 同一轮状态与 knowledge 可能重复出现在 user 与 system 两侧

### 1.2 产品目标

在**不削弱** Studio 编排能力与 knowledge 相关性的前提下：

1. **Chat 可读**：用户气泡默认只显示用户说的话
2. **注入可感知**：若消息含 Studio 注入（历史脏消息），用 compact tag 提示
3. **写入干净**：新消息 user JSONL 不再拼接注入
4. **LLM 仍正确**：每轮 system 单通道刷新最新 state + knowledge（query=本轮 prompt）

### 1.3 用户价值

| 角色 | 价值 |
| --- | --- |
| 终端用户 | Chat 可读、可复制、可编辑；不再被大段 XML/状态刷屏 |
| 主会话编排模型 | 仍每轮拿到最新 Studio 状态与相关 knowledge |
| 子代理成员 | 不受影响（独立 prompt 拼装） |
| 运维/调试 | 新 session 日志更干净；历史可通过 strip 阅读 |

## 2. 范围

### 2.1 范围内（本交付 = L0 + L1）

**L0 — Chat 展示**

- 对用户消息渲染路径剥离已知 Studio 注入标签
- 有可识别注入时展示 compact 悬浮/旁侧 tag（如 `Studio · no_task` / `Studio · implementing`）
- Copy / Edit from here 默认使用干净文本
- 剥离失败时保守显示全文（不丢用户内容）
- 覆盖历史脏 JSONL，**不做**文件迁移改写

**L1 — 注入收敛**

- `input`：去掉 transform 拼接；保留 `recordYpiStudioUserApproval`；返回 `action: "continue"`
- `before_agent_start`：唯一主会话状态/knowledge 注入点；调用 `buildStudioState(root, key, event.prompt)`
- 评估并收敛 `startupContext` 与 `buildStudioState` 的重复 knowledge（保留 first-reply 语义）
- 子代理 / 工具门禁 / widget / continuation 行为保持

**文档与验证**

- 更新相关模块文档
- 单元测试 + extension 行为测试 + 回归清单 + lint/tsc

### 2.2 范围外 / L2 后续

- no_task 场景进一步减负（更短注入）
- 全局 token 预算优化 / knowledge 动态扩缩
- 使用 Pi `before_agent_start` 的 `message: { display: false }` 作为替代注入通道
- 批量改写历史 JSONL
- 改变 Studio 状态机、审批正则、widget API 契约
- 子代理 prompt 重构

## 3. 用户故事与需求

### US-1 干净气泡

**作为**用户，**我希望**自己的消息气泡只显示我说的话，**以便**阅读与分享对话。

| ID | 需求 | 验收 |
| --- | --- | --- |
| R1 | 渲染用户消息时剥离已知 Studio 注入块 | 含 `<ypi-studio-state>` 等的历史消息气泡不展示注入正文 |
| R2 | 剥离后保留用户原文（含 Markdown） | 用户正文与注入之间的分隔被正确处理，无残留空标签 |
| R3 | 无注入时行为与现网一致 | 普通用户消息 UI 无回归 |

### US-2 注入可感知

**作为**用户，**我希望**在历史消息曾被注入时仍能感知 Studio 上下文曾附加，**以便**理解“为何当时模型知道任务状态”。

| ID | 需求 | 验收 |
| --- | --- | --- |
| R4 | 成功识别注入时显示 compact tag | 文案形如 `Studio · <status>`，status 来自 state（`no_task` / `awaiting_approval` / `implementing` 等） |
| R5 | tag 不抢主阅读路径 | 气泡正文仍是主视觉；tag 小、可扫读 |
| R6 | 无法可靠剥离时不伪造“已清理” | 显示全文；可不显示成功态 tag，或显示需谨慎的 fallback（见 Design） |

### US-3 Copy / Edit

| ID | 需求 | 验收 |
| --- | --- | --- |
| R7 | Copy 默认复制干净文本 | 剪贴板无 `<ypi-studio-*>` 块 |
| R8 | Edit from here 回填干净文本 | 输入框不出现注入块 |
| R9 | 剥离失败时 Copy/Edit 使用全文 | 不丢内容 |

### US-4 新消息写入干净

| ID | 需求 | 验收 |
| --- | --- | --- |
| R10 | input 不再 transform 拼接 state/knowledge | 新 JSONL user 文本 = 用户输入（经 skill/template 扩展后的正常路径，但不含 Studio 注入） |
| R11 | 审批副作用保留 | `awaiting_approval` 下用户发“确认/批准/…”仍同轮写入 `approvalGrant` |
| R12 | 标题种子不被新注入污染 | 新 session 首条消息标题来自用户原文 |

### US-5 LLM 上下文不回退

| ID | 需求 | 验收 |
| --- | --- | --- |
| R13 | system 单通道每轮注入最新 state | `before_agent_start` 返回含 `buildStudioState` 的 systemPrompt |
| R14 | knowledge query 使用本轮 prompt | `buildStudioState(..., event.prompt)`，相关性 ≥ 现网（现网 query=user text） |
| R15 | startup 一次性 first-reply 语义保留 | 新 session 首次 agent 启动仍可提示 Studio 已加载（中文 brief） |
| R16 | 子代理上下文不回退 | `buildMemberPrompt` 路径不变；child `YPI_STUDIO_SUBAGENT_CHILD=1` 仍跳过主 extension |
| R17 | widget / continuation / steer/follow-up 不回退 | 不改这些路径的业务语义；input 对任意 source 均不因 SCI 阻断 |

## 4. 非功能需求

| ID | 需求 | 验收 |
| --- | --- | --- |
| N1 | strip/parse 为纯函数，可单测 | 边界用例见 checks |
| N2 | 不改写历史 JSONL 文件 | 无 migration job |
| N3 | 性能：单条消息 strip O(n) 可接受 | 不引入网络/磁盘 IO 在渲染路径 |
| N4 | lint + tsc 通过 | `npm run lint`；`node_modules/.bin/tsc --noEmit` |
| N5 | 失败安全 | strip 异常 → 全文展示 |

## 5. 交互要点（L0）

- 位置：用户气泡上方或气泡左上外侧 compact pill（见 HTML 原型）
- 文案：`Studio · {status}`；无法解析 status 时用 `Studio · context`
- 不默认展开注入全文（L0 不做“点击展开原始注入”；L2 可选）
- 明暗主题均使用现有 CSS 变量

## 6. 验收总标准

1. 历史脏消息：UI 干净 + tag；Copy/Edit 干净
2. 新消息：JSONL 干净；LLM 仍编排正确；knowledge 不弱
3. 审批同轮 grant → 可 transition implementing
4. 子代理与 widget 路径无行为回退
5. checks.md 矩阵全部勾选或标注人工项

## 7. 未决问题（建议默认）

| # | 问题 | 推荐 | 需用户拍板？ |
| --- | --- | --- | --- |
| Q1 | tag 是否可点击展开原始注入？ | L0 **否**；保持 compact only | 可选 |
| Q2 | startup knowledge 与 per-turn knowledge 去重？ | **是**：startup 去掉 knowledge，只保留 first-reply + 编排简介；state/knowledge 全由 per-turn `buildStudioState` | 推荐默认采纳 |
| Q3 | 会话列表历史脏 `firstMessage` 是否 strip？ | **是**：展示/种子路径对已知标签 strip | 推荐默认采纳 |
| Q4 | architect 产出的 HTML 是否可作 UI 审批材料？ | 本环境无法派 ui-designer；**请主会话补派或用户直接批本原型** | **是** |

## 8. UI 门禁判定

**触发：是。** L0 改变用户消息展示结构与信息层级 → 必须有 HTML 原型并经用户审批后方可实现。
