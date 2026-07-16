# UI 说明：Standalone 焦点触发

## 原型契约
非聚合模式的 GPT/Grok/Kiro trigger 使用统一交互：

- pointer hover 或 keyboard focus 打开 provider detail；
- trigger 与 panel 之间保留 grace 区域，离开后延迟关闭；
- Escape 关闭并恢复 trigger 焦点，防止立即重开；
- panel 内按钮、账号选择、Models、刷新操作均保持可访问；
- 聚合模式保持现有 hover/focus 分栏行为，不在本改进中修改。

复用现有任务原型：[`../usage-aggregate-theme-priority-prototype.html`](../usage-aggregate-theme-priority-prototype.html)。

## 验收
- standalone 不点击也能通过 Tab focus 打开；
- 鼠标移入 trigger/panel 不闪退；
- Escape 关闭且不循环重开；
- 聚合模式回归不变；
- reduced-motion、focus-visible、aria-expanded/controls 保持。
