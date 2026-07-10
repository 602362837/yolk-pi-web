# UI

## 门禁状态：已交付原型，等待用户审批

本任务新增用户可见的“无 refresh token 风险”信息，属于用户可见信息结构与导入反馈变更。UI 设计员已基于 `components/ModelsConfig.tsx` 的现有 Add Account JSON 对话框产出 HTML 原型：

- [HTML 原型：`cpa-refresh-token-risk-prototype.html`](cpa-refresh-token-risk-prototype.html) (支持浅色/深色主题切换、提供交互式场景模拟及非阻断警告 UI)

用户审阅该 HTML 原型并明确批准前，不得进入实现。

## UI 设计任务（已完成）

入口：Settings/Models → ChatGPT Plus/Pro → Add Account → 输入授权 JSON → CPA 格式。

需覆盖：

1. CPA 有 refresh token：转换成功，维持当前“转换 → 检查最终 JSON → 验证/保存”的主路径。
2. CPA 缺少或空 `refresh_token`，但 access/expires 有效：显示非阻断 warning。文案建议：
   > 未提供 refresh token。此账号可在当前 access token 有效期间导入和使用；access token 过期后无法自动刷新，请重新导入或使用 Codex 授权登录。
3. warning 在转换后、最终 JSON/保存按钮附近可见，颜色/图标与 error 明确区分；“保存账号”仍可点击。
4. 缺 access token 或无效 expires：仍显示阻断 error，不与 warning 混淆。
5. 多条 CPA 输入：说明每条会保存为独立账号，即使真实 ChatGPT account id 相同；不得显示 token 原文。
6. 窄屏、键盘焦点、aria-live feedback、保存中/请求失败状态。

## 审批请求（等待原型后向用户发出）

请审阅 `cpa-refresh-token-risk-prototype.html`，确认：

- warning 文案和位置足够明确但不阻碍当前可用账号保存；
- 用户能区分“无法自动刷新”与“当前不能使用”；
- 多账号保留说明不暴露敏感 token；
- 是否需要在已保存账号列表额外显示“不可自动刷新”badge（建议本轮不扩展，除非审批时要求）。
