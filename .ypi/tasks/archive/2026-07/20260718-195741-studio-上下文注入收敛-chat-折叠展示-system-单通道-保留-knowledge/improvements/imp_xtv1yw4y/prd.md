# PRD — IMP-001 Studio tag 注入预览（排查用）

## 1. 背景与目标

### 1.1 背景

SCI（主任务）已交付：

- **L0**：Chat 剥离已知 Studio 注入标签 + compact `Studio · {status}` tag  
- **L1**：user JSONL 干净；system 单通道注入  

L0 当时明确 **不做** tag 点击展开（原 Q1 → L2）。用户验收反馈要求补上**只读排查预览**，不回退 L0 默认干净阅读路径。

### 1.2 产品目标

| # | 目标 |
| --- | --- |
| G1 | 默认阅读路径仍是干净用户正文 |
| G2 | 对可识别的历史脏消息，点击 tag 可查看**被剥离的注入块** |
| G3 | 可复制注入原文，便于粘贴到 issue / 调试 |
| G4 | 不改变 L1 写入与模型注入策略，不改变子代理 |
| G5 | 交互失败安全：无注入 / partial / parse 失败不伪造「有可预览注入」 |

### 1.3 价值

| 角色 | 价值 |
| --- | --- |
| 用户 / 排障 | 打开旧 session 时能核对「那条消息当时附了什么 state/knowledge」 |
| 主会话编排 | 无行为变化（L1 不动） |
| 开发 | parse API 可测、可复用 |

## 2. 范围

### 2.1 范围内（本改进）

**数据 / 纯函数**

- 扩展 `parseYpiStudioUserMessage`（或并列 API）导出：
  - `injectionBlocks: { tag, body, raw }[]`（完整闭合块，按出现顺序）
  - `injectionText: string`（拼接后的只读文本，供 mono pre / Copy）
- 剥离规则与 SCI 一致：只识别完整闭合白名单标签  
- `displayText` / status / confidence 语义**不回归**

**Chat UI**

- 当 SCI 现网 `showStudioTag` 条件成立时：tag 改为可点击 control（`button`）
- 点击 → **popover / floating panel**（优先于气泡内大段 expand）
- 面板只读展示 `injectionText`（或分块），`max-height` + 滚动 + mono
- 操作：Copy injection；可选 Copy full raw；Close
- 关闭：Esc、点击外侧、Close 按钮、再次点击 tag（toggle）
- 同时仅允许**一条**消息预览打开（或后开关前开）

**文档与测试**

- 单测覆盖 blocks 提取边界  
- 更新 frontend/library 文档一句  
- 人工 UAT：键盘、明暗、窄屏、Copy

### 2.2 范围外

| 项 | 原因 |
| --- | --- |
| 实时「本轮 systemPrompt 注入」查看器 | L1 后注入不在 user JSONL；需 diagnostics / 服务端事件，另开需求 |
| 新消息上强制显示 tag 以便预览 system 注入 | 会破坏 SCI「干净气泡」；拒绝 |
| 历史 JSONL 迁移 / 回写 | SCI 硬约束 |
| L1 改回 user transform | 明确禁止 |
| 子代理 prompt 预览 | 非本反馈；child 独立 |
| 点击 tag 编辑注入 / 重新注入 | 只读排查 |
| Markdown 渲染注入 XML | 只用 mono pre 原文，避免二次解释 |
| partial 半截开标签的「成功预览」 | 与 SCI 一致：不显示成功态可点 tag |

### 2.3 关键能力边界（必须写进验收说明）

> **预览内容 = 该条 user 消息里被 L0 剥离的完整注入块。**  
> SCI L1 之后的**新**用户消息通常**没有** tag，也**没有**可预览的 user 侧注入。  
> 若用户需要「当前 agent 本轮 system 里 `buildStudioState` 全文」，本改进**不交付**，记为后续 diagnostics。

## 3. 用户故事与需求

### US-1 默认干净

| ID | 需求 | 验收 |
| --- | --- | --- |
| R1 | 无注入消息 UI 与现网 SCI 一致 | 无 tag、无面板 |
| R2 | 有注入时默认仍只显示干净正文 + compact tag | 不默认展开注入 |

### US-2 点击预览

| ID | 需求 | 验收 |
| --- | --- | --- |
| R3 | 满足 `hadInjection && stripConfidence==="full" && status` 时 tag 可点 | `button`；`aria-expanded` |
| R4 | 打开后只读展示剥离块原文 | 含标签名与 body；顺序与 raw 一致 |
| R5 | 面板可滚动，长注入不撑破视口 | `max-height` + overflow auto |
| R6 | 关闭路径完整 | Esc / outside / close / toggle |
| R7 | partial / parse fail **不**提供成功可点 tag | 与 SCI L0 一致 |

### US-3 复制

| ID | 需求 | 验收 |
| --- | --- | --- |
| R8 | Copy injection 复制 `injectionText` | 剪贴板为剥离块拼接，非 displayText |
| R9 | （可选推荐）Copy full raw 复制 `rawText` | 次要按钮或菜单 |
| R10 | 气泡主 Copy 仍复制 `displayText` | 不回归 SCI R7 |

### US-4 数据契约

| ID | 需求 | 验收 |
| --- | --- | --- |
| R11 | parse 导出 injection blocks | 单测：state+knowledge 顺序、多块、无注入空数组 |
| R12 | 只收集完整闭合块 | 半截不进 blocks；confidence 仍 partial |
| R13 | 纯函数无 IO | 同 SCI N1 |

### US-5 不回退

| ID | 需求 | 验收 |
| --- | --- | --- |
| R14 | 不修改 `ypi-studio-extension` L1 行为 | diff 为空或仅注释无关 |
| R15 | 不修改 `buildMemberPrompt` / child guard | diff 审 |
| R16 | 不改写 JSONL | 无 migration |

## 4. 非功能

| ID | 需求 | 验收 |
| --- | --- | --- |
| N1 | 浮层不阻塞整个 Chat 布局重排（portal 或 absolute 锚定 tag） | 人工 |
| N2 | 明暗主题用现有 CSS 变量 | 人工 |
| N3 | 键盘：tag 可 Tab 聚焦；Esc 关闭；焦点管理不丢到 body 黑洞 | 人工 |
| N4 | lint + tsc；扩展 message-display 单测 | 自动 |
| N5 | 注入极大（>100KB）时仍可打开；可截断展示并提示 truncated（推荐软限制） | 设计默认：展示截断 64KiB + 「已截断」提示，Copy 仍可尝试全文或同样截断——**推荐 Copy=全文（浏览器允许范围内），展示可截断** |

## 5. 交互要点

- 入口：仅 Studio tag（气泡上方右对齐）  
- 形态：**popover** 锚定 tag 下方（窄屏可改为 fixed 底/中，见 UI）  
- 标题：`Studio injection` / `Studio · {status}`  
- 副文案（小字）：`Stripped from this user message (historical). Not live system prompt.`  
- 主按钮：Copy injection  
- 次按钮：Copy full message（raw）  
- 关闭：× / Esc / outside  

## 6. 未决问题与推荐默认

| # | 问题 | 推荐 | 需用户拍板？ |
| --- | --- | --- | --- |
| Q1 | popover vs 气泡内 expand | **popover** | 推荐默认 |
| Q2 | 是否提供 Copy full raw | **是**（次要） | 推荐默认 |
| Q3 | 新消息无 tag 时是否另做 system 诊断入口 | **否**（本改进不做） | 需知悉 |
| Q4 | 展示截断阈值 | 展示 64KiB；Copy injection 用完整 `injectionText` | 推荐默认 |
| Q5 | 多条消息同时打开多个 popover | **否**，互斥 | 推荐默认 |

## 7. UI 门禁

**是。** 必须有 HTML 原型并经用户批准后实现。

## 8. 验收总标准

1. 历史脏消息：点 tag → 见注入块；Copy injection 正确  
2. 干净消息 / 新 SCI 消息：无入口、无回归  
3. partial 无成功可点 tag  
4. L1 / 子代理无 diff 行为变化  
5. checks 自动项绿 + 人工浮层 UAT  
