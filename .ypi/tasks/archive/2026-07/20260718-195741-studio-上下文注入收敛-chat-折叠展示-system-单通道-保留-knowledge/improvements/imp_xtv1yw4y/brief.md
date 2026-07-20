# brief — IMP-001 Studio tag 注入预览（排查用）

## 反馈摘要

SCI L0 已把用户气泡默认收敛为干净正文 + compact `Studio · {status}` tag，但 tag 当前**不可点击**（`data-interactive="false"` / `pointer-events: none`）。用户验收后希望：

> 点击 Studio tag → **展开预览或浮窗**，只读查看本条消息被剥离的注入块，便于排查「当时附加了什么」；可复制注入原文；默认仍保持干净气泡；**不改** L1 单通道注入与子代理。

## 现状证据（已核实）

| 项 | 现状 |
| --- | --- |
| 纯函数 | `lib/ypi-studio-message-display.ts`：`parseYpiStudioUserMessage` 只返回 `displayText` / `rawText` / `hadInjection` / `studioStatus` / `stripConfidence`，**不导出** injection 块正文 |
| UI | `UserMessageView`：`showStudioTag` 仅在 `hadInjection && full && status`；tag 为非交互 `span` |
| CSS | `.message-studio-tag[data-interactive="false"] { pointer-events: none }`；原 L0 明确「不做点击展开」（SCI 当时 Q1 → L2） |
| L1 | 新 user JSONL **不再**拼接注入；注入只在 `before_agent_start` systemPrompt |
| 测试 | `test:studio-message-display` / `test:studio-extension-sci` 已绿；checker Pass |

## 问题重述（精确）

| 用户说法 | 产品真实含义（本改进） |
| --- | --- |
| 「本轮实际注入了什么」 | 对**该条用户消息**曾被写入/剥离的 `<ypi-studio-*>` 块做只读预览（**历史脏 JSONL** 为主） |
| 非含义 | **不是**实时 system 通道「当前 agent 本轮 systemPrompt 注入全文」诊断面板（L1 后不在 user 消息上；另开 diagnostics 需求） |

## 目标

1. 默认：干净气泡不变  
2. 有可识别完整注入的历史脏消息：tag 可点击 → popover/浮层只读预览剥离块  
3. 支持复制注入原文（可选复制 full raw）  
4. 扩展 parse API 导出 `injectionBlocks` / 拼接文本  
5. a11y：button + `aria-expanded`；Esc / 外侧 / 关闭关闭  
6. 不改 L1 / 子代理 / JSONL 迁移

## 非目标

- 回退或改动 SCI L1 system 单通道  
- 改写历史 JSONL  
- 实时 systemPrompt 注入浏览器  
- 子代理 / widget / 审批路径  
- 在气泡内大段 inline expand 挤占对话（优先 popover）

## 成功标准（摘要）

- 脏消息：点 tag → 只读看到剥离的注入块；Copy 注入可用  
- 干净消息：仍无 tag  
- partial：仍不显示成功态可点 tag（与 SCI 一致）  
- 自动化覆盖 parse blocks + 关键交互契约；人工 UAT 浮层/键盘/主题  

## UI 门禁

**触发：是** — tag 从非交互展示变为可点击 + 浮层信息架构 → 需要 HTML 原型 + 用户批准后再实现。
