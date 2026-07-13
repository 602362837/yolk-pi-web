# UI：Settings → Models → xAI managed API keys

## 原型门禁

本任务触发 UI 原型门禁：xAI 从单 Key 表单切换为用户可见的多账号管理体验。已准备基于现有 `ApiKeyAccountsDetail` 和历史 OpenCode Go 原型适配的 HTML 原型：

- [打开 HTML 原型](ui-prototype.html)

> 主会话需由 **UI 设计员**复核/接管该 HTML 原型并交用户审批。当前 architect 子会话没有 Studio delegation tool，不能伪造 UI 设计员审批记录；在该复核与用户明确批准之前不得实现。

## 页面与组件

- 入口保持 Settings → Models → xAI。
- provider 行显示 configured 状态、账号数和 active display name。
- 详情复用账号列表、Add key、Edit、Reveal/Copy、Activate、Enable/Disable、Delete。
- 不增加 xAI 专属导航、弹窗或信息架构。

## 关键状态

- legacy import 提示；空列表；加载/错误。
- active、imported、disabled 徽标。
- active disable 时选择 replacement 或明确 clear；active delete 的 fallback/last-account 文案。
- reveal 仅单项、显式操作；切换 provider/关闭弹窗后清空明文。

## 审批问题

1. 是否接受 xAI 完全复用现有 managed-account 交互？
2. 是否接受本轮不增加 xAI auto-failover 设置？
3. UI 设计员是否确认原型不存在残留 OpenCode Go 文案或 xAI 不适用交互？
