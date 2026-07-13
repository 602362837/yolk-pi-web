# UI 门禁判断

**结论：不适用，不需要 UI 设计员或 HTML 原型。**

本任务不新增页面、组件、文案、确认流程或信息结构。现有任务面板中的“绑定到当前聊天”仍是唯一显式入口；`YpiStudioSessionWidget` 继续消费 session-link API，不修改渲染逻辑。变化仅是后端转移后旧 session 不再错误命中任务。

门禁升级条件：若实现需要增加“转移归属”确认、当前 owner 展示、unbind 控件或改变审批体验，必须停止实现、退回 planning，并由 UI 设计员产出 HTML 原型供用户审批。
