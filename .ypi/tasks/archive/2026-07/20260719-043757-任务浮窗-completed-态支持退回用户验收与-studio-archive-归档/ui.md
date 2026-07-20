# UI：Completed 态两 CTA（无视觉改版）

## 0. 视觉硬约束

1. **不改**现有浮窗视觉体系：布局、色板、glass card、8 站 rail、decision section 结构、按钮形状/主次色。
2. **只允许**：在现有 decision region 渲染服务端投影的两个 CTA；复用 `.ypi-studio-decision-section` / `.ypi-decision-btn.is-primary|.is-secondary` / `is-busy` / disabled / title / aria。
3. **不要**新建 HTML 视觉原型作为权威；本文件以交互 checklist 为准。
4. 若实现中误改 CSS 视觉 token，视为回归。

## 1. 是否触发 UI 原型门禁

| 判定 | 结论 |
| --- | --- |
| 页面结构 / 布局改版 | **否** |
| 新增用户可见按钮与确认文案 | **是（轻量交互）** |
| 是否指派 UI 设计员画 HTML | **否**（用户与任务说明：仅两按钮 + 确认/Chat，无视觉改版则不重画原型） |

**门禁结论**：不产出独立 HTML 视觉稿；实现以生产 `YpiStudioSessionWidget` + 现网 CSS 为唯一 UI 权威。

## 2. 信息架构（Completed 卡）

既有卡片顺序不变：

```text
shell / rail / meta
→ improvement 摘要（若有；completed 通常无 unresolved）
→ 主验收区（completed 时 canAcceptMain=false，不显示）
→ archived badge（仅 archived）
→ quickPreviews（只读，agentRunning 仍可用）
→ decision region  ← 本任务：投影 2 CTA
→ runtime / implementation
```

## 3. Decision region（Completed）

### 3.1 可见条件

- 服务端 `userActions` 非空
- `!archived`
- 前端 **禁止** 用 `status === "completed"` 本地发明按钮

### 3.2 按钮

| role | label | kind | busy 文案 |
| --- | --- | --- | --- |
| primary | 归档 | `studio_archive` | 发起归档… |
| secondary | 退回用户验收 | `return_to_user_acceptance` | 退回中… |

### 3.3 标题 / meta

- 标题：`👉 需要你的决定: 完成态收尾`
- revision chip：沿用 `expectedRevision`（与其它 decision 一致）
- targetLabel：`主任务 · {title}`（bound ≤120）

### 3.4 disabled

- `agentRunning || acceptingInFlight || decidingActionId`
- `title` / `aria-label` 附加「Chat 工作中不可用」当 agentRunning

## 4. 确认框文案

### 4.1 退回用户验收

- 标题：退回用户验收？
- 要点：
  - 从 `completed` 回到 `user_acceptance`
  - **不是**归档；**不会**清除产物
  - 回到后需再次「确认主任务已验收完成」
- 按钮：取消 / 退回用户验收
- intent：default（或 warning 若现网有；优先 default + 清晰 copy）

### 4.2 归档

- 标题：归档任务？
- 要点：
  - 将在 **当前 Chat** 发送 `/studio-archive`
  - 由 **当前会话模型** 整理可复用知识后再归档
  - **不是** Panel 兜底摘要静默归档
  - 归档后任务只读并移入 archive
- 按钮：取消 / 在 Chat 归档
- intent：danger（与 Panel 归档一致的谨慎语义）
- reason：默认不强制输入（见 PRD Q1 推荐）

## 5. Toast

| 场景 | tone | 方向 |
| --- | --- | --- |
| 退回成功 | success | 已退回用户验收，请再次确认主任务 |
| 退回冲突 | error | 状态或版本已变化… + 刷新 |
| 归档 Send 成功 | success | 已在 Chat 发起 /studio-archive，请等待模型整理知识并归档 |
| 归档 Send 失败 / 无 onComposeSend | error/info | 未能发送；请在输入框执行 /studio-archive |
| agentRunning 点击兜底 | info | Chat 正在工作，请稍后再试 |

## 6. 交互场景 checklist（人工）

1. Completed 卡出现「归档」+「退回用户验收」，顺序 primary 在前。
2. agentRunning 时两按钮灰显，quick preview 仍可点。
3. 退回确认取消 → 无写。
4. 退回确认成功 → status=user_acceptance，主验收按钮出现，decision completed 区消失。
5. 归档确认取消 → 无 Chat 消息。
6. 归档确认成功 → transcript 出现 /studio-archive 语义（extension 注入引导）；任务在模型完成后 archived。
7. archived 卡无写 CTA。
8. awaiting_approval / review 决策区不受影响。
9. reduced-motion / 移动端 ≥44px 点击区：沿用现网 decision 样式，不新增动画。
10. 键盘：Tab 到按钮、Enter 触发与现网 decision 一致。

## 7. 无障碍

- `aria-label` 区分「退回验收（非归档）」与「Chat 归档（非静默）」。
- busy：`aria-busy`。
- 色不只作唯一状态：主次 class + 文案。
