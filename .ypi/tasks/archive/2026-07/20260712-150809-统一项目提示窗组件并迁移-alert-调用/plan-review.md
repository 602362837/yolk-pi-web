# 统一项目提示窗组件并迁移原生调用 - 计划审批书

## 审批结论

用户于 2026-07-13 明确确认已完成人工查看并确认当前 UI 原型与实现效果，批准本计划的交互范围：纳入全局 toast 并迁移 ModelsConfig 局部反馈；保留现有中英文文案语义；confirm/prompt 禁止 backdrop 取消，Escape 可取消，danger confirm 初始焦点在取消按钮。批准已完成的实现进入最终验收。

## 实现与验收范围

- 新增应用级统一提示宿主，提供 Promise 化 `notice / confirm / prompt`，以 FIFO 队列处理并发请求。
- 统一 toast 反馈并迁移 ModelsConfig 局部 toast。
- 迁移生产源码中的原生 `confirm/prompt` 调用，保持业务条件、文案和返回值语义。
- 保持 prompt 取消返回 `null`、空提交返回空字符串；confirm 取消返回 `false`。
- 完成键盘、焦点恢复、滚动锁定、IME、响应式、主题和 reduced-motion 验收。

## 计划与产物

- [PRD](./prd.md)
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)
- [UI 门禁与设计员任务书](./ui.md)
- [HTML 原型](./prompt-dialog-prototype.html)

## 审批记录

- 审批人：用户
- 审批时间：2026-07-13
- 审批内容：已人工确认当前效果，批准继续完成并归档该任务。