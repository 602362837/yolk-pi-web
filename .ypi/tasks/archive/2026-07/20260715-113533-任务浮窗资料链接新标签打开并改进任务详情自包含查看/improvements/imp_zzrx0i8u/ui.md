# UI — IMP-004 主任务验收确认并归档

HTML 原型：[`main-accept-archive-prototype.html`](./main-accept-archive-prototype.html)

## 交互
- 原确认弹窗增加第三个按钮：「确认并归档」。
- 按钮与普通完成按钮并列，但颜色采用绿色成功/归档语义，避免与蓝色普通完成混淆。
- 弹窗说明增加两条结果：
  - 普通确认：状态变为 `completed`；不自动归档。
  - 确认并归档：先变为 `completed`，再移动到归档区并生成知识条目。

## 安全提示
- 「暂不验收」仍为取消。
- 「确认主任务已完成」仍只 completed。
- 「确认并归档」失败时用 toast 说明失败阶段。若 completed 已成功但归档失败，保留 completed 并提示用户可从 Studio Panel 归档。
