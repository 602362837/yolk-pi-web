# UI：浮窗决策 CTA 续推与工作中禁用

## 0. 硬约束：不改现有浮窗视觉（用户确认）

> **实现必须以生产代码中的 `YpiStudioSessionWidget` + 现网 CSS class 为准。**  
> 现网浮窗布局、间距、色板、8 站 rail、决策区/验收区/预览区样式是长期精调结果。  
> **禁止**把 [`studio-widget-chat-send-continue-prototype.html`](studio-widget-chat-send-continue-prototype.html) 当作视觉/布局/设计系统稿去「还原」。

| 允许 | 禁止 |
| --- | --- |
| 现有按钮上的 `disabled` / `aria-*` / `title` | 新布局、新色板、新圆角/阴影/字号体系 |
| toast / AppPrompt **文案**微调 | 重画决策区、改按钮结构、改 rail 视觉 |
| Chat transcript 多一条用户消息（现有消息气泡） | 为示意而改 widget DOM 层级或 class 命名 |
| 行为接线（PATCH 后 `handleSend`） | 按 HTML 原型重写组件样式 |

HTML 文件角色降级为：**交互状态说明书**（空闲 / agentRunning 禁用 / 续推后 Chat 有消息 / partial toast），**非** UI 改版依据。

## 1. UI 原型门禁判定

| 问题 | 结论 |
| --- | --- |
| 是否页面/组件**视觉**变更？ | **否** — 不改布局与样式体系 |
| 是否**交互/反馈**变更？ | **是** — busy 禁用、Chat 续推可见、toast 措辞 |
| 是否用户可见信息结构变化？ | **轻微** — 仅禁用态说明与 toast；卡片信息架构不变 |
| 是否需「新视觉」HTML 原型？ | **否（已撤回视觉权威）** |
| 现有 HTML 文件 | 仅作交互场景 checklist；实现对照生产 CSS |

> 说明：规划阶段曾产出示意 HTML，其视觉与现网精调浮窗不一致。用户已明确：**不得按该图改掉现有 UI**。后续实现与 checker 以生产组件为准；若需门禁证据，用场景清单 + 现网截图/手工点按即可。

## 2. 设计目标

1. 用户理解：**批准/改计划会先落库，再在 Chat 里自动发出续推消息**。  
2. **工作中**决策与验收按钮明显不可点，并知道原因。  
3. **失败 partial**：落库成功但 Chat 未续推时，toast 不谎称「已继续编排」。  
4. 不破坏 8 站 rail、资料预览、结果验收分区与文案边界。

## 3. 信息架构（卡片内顺序 · 不变 + 强化态）

```text
壳层 / 8 站 rail / meta
→ 改进摘要 + 改进结果验收（可 disabled）
→ 主任务结果验收（可 disabled）
→ 归档徽标
→ quickPreviews（推荐 busy 时仍可点）
→ 决策区 userActions（可 disabled + busy 文案）
→ runtime / implementation
```

## 4. 关键状态

| 状态 | 决策 CTA | 结果验收 | 预览 | Chat |
| --- | --- | --- | --- | --- |
| 空闲 + 有 userActions | 可点 | 按投影 | 可点 | 空闲 |
| 写操作 in-flight | disabled +「…中」 | disabled | 可点 | — |
| agentRunning | disabled + title「Chat 正在工作…」 | 同左 | 可点 | 流式中 |
| PATCH ok + Send ok | 投影刷新后可能消失 | — | — | 新 user 消息 + 流式 |
| PATCH ok + Send fail | 投影已变 | — | — | 无新消息；warning toast |
| start_user_acceptance 成功 | CTA 消失；主验收出现 | 可点（空闲时） | — | 无自动消息 |

## 5. 交互要点

### 5.1 决策主路径（续推类）

1. 点击 → AppPrompt confirm/prompt（文案保持 Phase 1：区分计划批准 ≠ 结果验收）。  
2. 确认后若 `agentRunning`：info toast，不写库。  
3. PATCH → 成功 toast（含是否续推）→ Chat 出现引导词（续推类）。  
4. 按钮区随投影刷新。

### 5.2 非续推类

- `开始用户验收` / 改进结果验收 / 主验收：确认 → PATCH → 成功 toast（**无**「Chat 续推」措辞）。

### 5.3 禁用态视觉

- 沿用 `.ypi-decision-btn:disabled` / accept 按钮 disabled 样式（降透明 + `not-allowed`）。  
- `agentRunning` 时**不必**整卡遮罩；仅写按钮 disabled，避免误伤预览与 Detail。  
- `aria-busy` 仅 in-flight 按钮；`agentRunning` 用 `disabled` + `title`/`aria-label` 后缀「（Chat 工作中不可用）」。

### 5.4 Toast

见 Design §4.4。partial 使用 `tone: "error"` 或 `"info"` 中产品更醒目者——**推荐 `error` 仅用于 PATCH 失败；partial 用现有 toast 的 warning 若无则 `info` + 明确文案**。若 toast API 仅 success/error/info：partial → `error` 易惊吓，优先 **`info`** 并文案写清「已落库」。

## 6. 文案修订（相对现网）

| 现网 | 修订 |
| --- | --- |
| 「计划已批准，Studio 将继续编排实现」 | Send ok：「计划已批准，已在 Chat 继续编排实现」；Send fail：「计划已批准并落库，但未能在 Chat 续推…」 |
| 「已批准 {id} 改进计划，实例 DAG 将继续执行」 | 同上拆分 ok/fail |
| 「修改反馈已落库，任务已退回 planning」 | Send ok：追加「已在 Chat 续推规划」；fail：追加「未能在 Chat 续推」 |
| 进入验收 / 主验收 | 保持；不提编排 |

## 7. 响应式与 a11y

- 移动底 sheet 与桌面卡同一 disabled 规则。  
- 触控目标保持 ≥44px（现网 decision CSS）。  
- `prefers-reduced-motion`：不新增动画。  
- 焦点：disabled 按钮不抢焦点循环；confirm 关闭后焦点回卡内合理位置（现网 AppPrompt 行为）。

## 8. HTML 文件角色（非视觉交付）

- 文件：[`studio-widget-chat-send-continue-prototype.html`](studio-widget-chat-send-continue-prototype.html)
- **角色**：交互场景 checklist / 门禁旁证，**不是**视觉或布局源。
- 其配色、栅格、示意 widget **与现网精调 UI 不一致时，一律以现网为准**。
- 实现与验收场景仍覆盖：
  1. 空闲 + 主计划双 CTA（现网样式）  
  2. agentRunning 禁用决策/验收  
  3. 批准后 Chat transcript 出现引导词  
  4. partial-success toast  
  5. `start_user_acceptance` 无 Chat 消息  
  6. 改进计划批准 CTA  
  7. 8 站 rail + quick preview 仍在  

## 9. 实现备注

- **唯一 UI 权威**：生产 `components/YpiStudioSessionWidget.tsx` + 现网相关 CSS（`.ypi-studio-decision-*`、`.ypi-decision-*`、accept 按钮 class 等）。  
- 新增 prop 无新视觉组件；主要是状态与文案。  
- Chat 引导词**不**预填进输入框，而是直接作为已发送 user 消息（与手动 Send 一致）。  
- **禁止**为对齐示意 HTML 而改 class 命名、间距、色板或 DOM 结构。
