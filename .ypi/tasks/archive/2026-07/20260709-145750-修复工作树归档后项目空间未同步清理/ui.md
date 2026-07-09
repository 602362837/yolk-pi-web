# ui

## UI 原型门禁判断

触发。原因：修复会改变 `components/SessionSidebar.tsx` 中 WorkTree 归档/删除后的可见状态、当前空间 fallback 选择和项目树刷新行为，属于已有交互变化。

## 建议 UI 交付

由于本任务不新增控件、不改变信息结构，UI 设计员可以基于现有 Sidebar 产出一个小型 HTML 状态原型，覆盖：

1. WorkTree space 归档前：项目下显示 `main` + worktree space。
2. 归档成功后：worktree space 从活动列表消失，选中项切到 `主空间`。
3. 无可用 fallback 时：清空工作区选择或显示现有空状态。
4. API 返回 partial warning 时：沿用现有错误/提示区域展示。

## 当前阻塞

本次架构交付未调用 UI 设计员（父会话明确要求 delegated member 不主动再派发成员）。进入实现前，请主会话决定：

- 派发 UI 设计员补充 HTML 原型；或
- 明确批准本次为“无新增视觉，仅状态同步 bugfix”，允许实现员按现有 UI 样式修改。
