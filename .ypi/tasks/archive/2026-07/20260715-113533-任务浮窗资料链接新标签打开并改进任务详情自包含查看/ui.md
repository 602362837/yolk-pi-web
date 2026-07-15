# UI — IMP-003 主任务浮窗验收

## UI 原型门禁

本改进新增浮窗写操作按钮与确认文案，触发 UI 原型门禁。

- HTML 原型：[studio-main-task-accept-prototype.html](studio-main-task-accept-prototype.html)
- 计划审批入口：[plan-review.md](plan-review.md)

## 交互方案

### 1. 主任务可验收（`user_acceptance`，无未解决改进）

- 卡片状态区出现独立区块「主任务结果待验收」。
- 主按钮文案：`确认主任务已验收完成`（全宽，主色/成功色实心）。
- 不显示改进验收橙按钮（无 waiting_user_acceptance 实例）。
- 点击 → AppPrompt：
  - 标题：`确认主任务已验收完成？`
  - 说明：主任务**结果验收**；将进入 `completed`；**不自动归档**；不是计划审批/改进验收。
  - 确认：`确认主任务已完成` / 取消：`暂不验收`。

### 2. 有未解决改进

- 仅显示既有改进验收区（橙按钮「确认该改进任务已完成」）。
- **不**显示主任务 completed 按钮。

### 3. 改进全部解决后的再次验收

- `review_ready` 且主任务仍为 `review`：保留「✓ 改进已完成，主任务需要再次验收」提示；无 completed 按钮。
- 主任务进入 `user_acceptance` 后：出现主任务验收按钮（与首次验收相同）。

### 4. 状态反馈

- busy：按钮 `验收中…`，disabled。
- 成功 toast：`已确认主任务验收完成（completed）`。
- 失败 toast：清洗后的错误（如未绑定会话、仍有未解决改进、非法 transition）。
- 归档卡片：只读徽章，无写按钮。

### 5. 可访问性

- `aria-label`：`确认主任务「{title}」已验收完成（主任务结果验收，将进入 completed）`。
- 焦点：按钮可 Tab；确认对话框沿用 AppPrompt 焦点陷阱。
- 颜色不唯一：文案含「主任务」。

## 视觉区分

| 项 | 改进验收 | 主任务验收 |
| --- | --- | --- |
| 文案 | 确认该改进任务已完成 | 确认主任务已验收完成 |
| 色调 | 警告橙 | 成功绿 / accent |
| 作用域 | 单 improvementId | 整个主任务 |
| 结果 | improvement accepted；主任务 reconcile | 主任务 completed |

## 原型场景

1. `user_acceptance` 显示主任务按钮。
2. 有未解决改进时只显示改进按钮。
3. 确认框文案对照。
4. `review_ready` 仅提示。

## 待用户审批

1. 仅 `user_acceptance` 显示主任务验收（`review` 不直接 completed）。
2. 主任务按钮用成功色，与改进橙区分。
3. 二次确认后才 PATCH；popup/绑定失败只提示。
