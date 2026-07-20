# UI — Studio Context Integrity（SCI L0）

> **门禁状态**：HTML 原型已由 **ui-designer** 定稿，**待用户批准**后实现 SCI-03。  
> **原型文件**：[sci-user-message-prototype.html](sci-user-message-prototype.html)  
> **批准前禁止**改生产 `MessageView` / `globals.css` 的 L0 视觉。

## 1. UI 门禁

| 项 | 结论 |
| --- | --- |
| 是否触发 | **是** — 用户消息展示结构变化（剥离 + compact tag） |
| 指派 | **ui-designer**（本交付定稿） |
| 原型文件 | [sci-user-message-prototype.html](sci-user-message-prototype.html) |
| 用户审批 | **待批准**（进入 implementing / SCI-03 前必须） |
| 批准示例 | `UI 原型确认，可按 sci-user-message-prototype.html 实现` |

## 2. 设计目标

1. 用户气泡**主阅读路径 = 用户原文**（含 Markdown）
2. 历史注入**可感知但不喧宾夺主**（compact tag）
3. 与现网 `UserMessageView` 一致：右对齐、`--user-bg`、hover actions、时间戳
4. 明暗主题复用现网 CSS 变量 / usage status token，不引入新视觉体系
5. 失败安全：半截/异常不伪造“已清理”

## 3. 信息架构

```
.message-view.message-view-user
  [ .message-user-meta-row ]                 ← 仅 hadInjection && 可展示 tag
      span.message-studio-tag[data-status]
  .message-bubble-row.message-bubble-row-user   ← max-width ~85%（移动 ~96%）
      bubble / MarkdownBody(displayText) + images?
  .message-action-row.message-action-row-user
      hover actions: Copy | Edit from here | New session
      time
```

阅读优先级：**用户正文 > actions/时间 > Studio tag**。

## 4. 组件、类名与状态

### 4.1 新增类名（实现必须对齐）

| 类名 | 作用 |
| --- | --- |
| `.message-user-meta-row` | tag 行容器：右对齐、max-width 与 bubble row 一致、与气泡间距 4px |
| `.message-studio-tag` | compact pill tag |
| `.message-studio-tag[data-status="…"]` | 轻量色差映射 |

### 4.2 状态矩阵

| 场景 | 条件（来自 `parseYpiStudioUserMessage`） | UI |
| --- | --- | --- |
| 无注入 | `hadInjection=false` | **与现网完全一致**，无 meta-row |
| 完整注入（历史脏） | `hadInjection && stripConfidence==="full"` | tag + 干净正文 |
| 仅 knowledge / 无 status | 有注入但 status 不可解析 | tag = `Studio · context` |
| 半截开标签 | `stripConfidence==="partial"` | 正文保留半截；**默认不显示成功态 tag** |
| parse 抛错 | catch | 全文 raw；无 tag |
| 新消息（L1 后） | JSONL 干净 | 无 tag（同无注入） |
| 仅图片 | 无文本 | 不因 SCI 隐藏图；无 tag |

### 4.3 Tag 文案与 status

- 格式：`Studio · {status}`
- status 来源：state 块 `Status: …` 或 `Task: id (status)`；否则 `context`
- 已知 status（与 design 对齐，实现用 `data-status`）：  
  `no_task` · `intake` · `planning` · `awaiting_approval` · `implementing` · `checking` · `review` · `user_acceptance` · `waiting_for_improvements` · `completed` · `cancelled` · `failed` · `context` · `unknown`
- 色差分組（轻量，文字仍完整可读）：
  - **info**（accent）：`no_task` / `intake` / `planning` / `implementing` / `checking`
  - **warning**：`awaiting_approval` / `waiting_for_improvements` / `review` / `user_acceptance`
  - **success**：`completed`
  - **danger**：`failed` / `cancelled`
  - **muted**：`context` / `unknown`

### 4.4 视觉规格

| 项 | 规格 |
| --- | --- |
| 形态 | pill（`border-radius: 999px`）、左 6px 圆点、~10px 字重 650 |
| 内边距 | `2px 8px`；gap 5px |
| 位置 | 气泡**上方**、右对齐；`margin-bottom: 4px` |
| 宽度 | meta-row / bubble-row 同为 max-width **85%**（移动端 **96%**，对齐现网） |
| 溢出 | `max-width:100%` + ellipsis，避免长 status 撑破 |
| 颜色 token | `--accent`、`--usage-status-*-*`、`--text-muted`、`--text-dim`、`--border`、`--bg-subtle`、`--user-bg` |
| 非交互 | L0 tag 为 `span`，`cursor: default`，**不可点击展开** |

## 5. 交互

| 操作 | 行为 |
| --- | --- |
| 阅读 | 默认不展开注入全文 |
| Copy | 复制 `displayText`（干净或保守结果）；失败路径用 raw |
| Edit from here | 回填 `displayText` |
| New session / Fork | 不改现网语义；不依赖 strip |
| 点击 tag | **L0 无操作**（非 button；L2 可选展开） |
| Hover / focus-within | actions 显隐保持现网；移动端常显 |
| 主题切换 | 随 `html.dark` 变量变化，无需单独逻辑 |

## 6. 文案建议

| 位置 | 文案 |
| --- | --- |
| Tag | `Studio · {status}` |
| Tag `title` | 同文案，或 `Studio · {status} — context was attached; display stripped` |
| Copy 按钮 title | `Copy message` / 干净路径可 `Copy clean text`（可选） |
| 勿用 | “已净化”“注入已删除”等易误导 partial 的文案 |

## 7. 可访问性

- Tag **不是**唯一信息通道：始终有可见文字 `Studio · …`
- Tag 不进 Tab 序；不扮演 button/link
- Actions 保持键盘可聚焦 + `:focus-visible` accent 描边
- 容器 `:focus-within` 时应能看到 actions（原型已示意）
- 不要把整段原始注入塞进 `aria-label`

## 8. 与现网一致性

| 现网 | SCI 要求 |
| --- | --- |
| `UserMessageView` 右对齐 column | 保持；tag 同列右对齐 |
| `var(--user-bg)` + 淡蓝边 | 保持 |
| hover `opacity` actions | 保持；Copy/Edit 数据源改为 displayText |
| `MarkdownBody` | 喂 displayText，不是 raw |
| assistant / tool / custom | **不改** |
| Studio widget / 浮窗 | **不改**（本任务 UI 范围外） |

## 9. 实现映射（给实现员）

| 步骤 | 位置 |
| --- | --- |
| 1. 纯函数 | `lib/ypi-studio-message-display.ts` — `parseYpiStudioUserMessage` / `formatYpiStudioMessageTag`（SCI-01） |
| 2. 挂载 | `components/MessageView.tsx` → `UserMessageView`：parse → 条件渲染 meta-row → body/Copy/Edit 用 displayText（SCI-03） |
| 3. 样式 | `app/globals.css`：`.message-user-meta-row`、`.message-studio-tag` + `data-status`（SCI-03） |
| 4. 标题 | `session-title` strip（SCI-04，非气泡视觉） |
| 5. 对照 | 打开本 HTML，逐条核对 [§11 验收点](#11-ui-验收点实现员--检查员) |

**推荐渲染伪逻辑**（与原型一致）：

```ts
const showTag =
  parsed.hadInjection &&
  parsed.stripConfidence === "full" &&
  parsed.studioStatus != null;

// Copy / Edit → parsed.displayText
// catch → raw full text, no tag
```

Partial 默认**不**显示 tag（更安全）；若产品后续要 partial+context tag，需再批 UI。

## 10. 非目标（UI）

- 点击 tag 展开 / modal / 注入全文 viewer（L2）
- 改变 assistant 气泡或 Chat 整体布局
- Studio 浮窗 / widget 视觉
- 历史 JSONL 改写
- 新色彩体系或新字体

## 11. UI 验收点（实现员 / 检查员）

1. 脏消息不再在 Markdown 正文渲染 `<ypi-studio-state>` / knowledge 大段  
2. tag 文案为 `Studio · {status}`，位置在气泡上方右对齐  
3. 干净消息零回归（无 tag、无多余空白）  
4. Copy / Edit 使用干净（或保守）文本，不含完整注入块  
5. 半截标签不丢用户内容；不显示误导性“已清理”成功态  
6. 窄屏长 status 不溢出；移动端 actions 仍可用  
7. 明暗主题对比度可接受  
8. 键盘可操作 Copy/Edit；tag 不抢焦点  
9. 视觉与 [sci-user-message-prototype.html](sci-user-message-prototype.html) 一致  

## 12. 检查清单（检查员速查）

- [ ] 对照原型 Before/After  
- [ ] 状态：no_task / awaiting_approval / implementing / context / completed  
- [ ] Fallback partial + 字面量不误伤  
- [ ] 无注入回归  
- [ ] 窄屏 + dark  
- [ ] Copy/Edit 手工验证  
- [ ] L0 无 tag 点击展开  

## 13. 交付说明

| 产物 | 说明 |
| --- | --- |
| [sci-user-message-prototype.html](sci-user-message-prototype.html) | **正式 UI 审批材料**（覆盖 Before/After、多 status、fallback、无注入、窄屏、明暗、a11y、实现映射） |
| 本 `ui.md` | 结构 / 类名 / 状态 / 交互 / 实现映射 / 验收点 |

**请主会话：**

1. 将本原型与 plan-review 一并提交用户审批  
2. 用户确认 UI + 计划后，再 transition → implementing  
3. 实现 SCI-03 时严格对齐本原型；若需点击展开等 L2 能力，另开需求  

**请用户明确批准本 HTML 后方可实现 SCI-03。**
