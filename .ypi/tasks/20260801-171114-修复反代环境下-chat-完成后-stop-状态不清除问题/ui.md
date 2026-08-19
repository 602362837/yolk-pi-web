# UI：Chat Stop / Send 状态时序修复

## Gate 判断

**触发 UI Prototype Gate。**

原因：本任务虽然不计划新增视觉元素，但会改变已有 Chat 交互的状态收敛——回复完成后 Stop 自动恢复为 Send；同时必须确认重连时仍在运行不会短暂闪回 Send。按工作室规则，“已有交互变化”必须由 UI 设计员提供 HTML 原型并在实现前由用户审批。

## 指派要求

主会话必须派发 `ui-designer`，要求其读取：

- `components/ChatInput.tsx`
- `components/ChatWindow.tsx`
- `app/globals.css` 中 Chat input 相关样式
- [Brief](brief.md)
- [PRD](prd.md)
- [Design](design.md)

## HTML 原型范围

原型应基于现有 Chat 输入区，至少可切换以下状态：

1. **Idle**：现有 Send、thinking、tools、compact 等 idle controls。
2. **Running**：现有 Stop、Steer/Follow-up 与现有运行提示。
3. **Reconnecting + server active**：视觉仍保持现有 Running，不新增 banner/toast，不闪回 Send。
4. **Recovered idle after missed `agent_end`**：直接恢复现有 Idle/Send。
5. **Waiting for Studio children**：保持现有后台运行语义，不错误恢复 Send。

原型应明确：

- 不新增“恢复”“重连”“重试”按钮；
- 不新增状态文案或布局；
- 不改变 Stop/Send 样式；
- 审批对象是**状态时序**，不是新 UI；
- 375px 与桌面宽度均不发生控件跳位。

## 交付形式

必须是任务目录内 HTML 文件，例如：

```text
chat-stop-recovery-prototype.html
```

`ui.md` 后续应添加相对链接：

```md
[打开 Chat Stop 状态恢复 HTML 原型](chat-stop-recovery-prototype.html)
```

纯 Markdown 说明不能替代 HTML。

## 原型

[打开 Chat Stop 状态恢复 HTML 原型](chat-stop-recovery-prototype.html)

原型只验证状态时序，不引入新视觉元素：Idle/Recovered idle 显示现有 Send；Running、Reconnecting + active、Studio children 均保持现有 Stop。Reconnecting 不闪回 Send，服务端确认 idle 后自动恢复 Send。原型包含桌面与窄屏可缩放验证，控件不跳位。

## 审批状态

- HTML 原型：**已提供**
- 用户审批记录：**待用户确认**
- Gate：**等待审批**
