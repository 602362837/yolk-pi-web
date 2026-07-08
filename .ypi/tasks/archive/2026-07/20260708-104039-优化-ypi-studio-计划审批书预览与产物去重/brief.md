# Brief

## 背景
用户反馈 YPI Studio 任务在架构师完成设计、进入 `awaiting_approval` 让用户审阅时，目前 Chat 里主要显示文件路径，涉及 UI 原型时审阅不便；同时任务详情的“产物”Tab 中出现重复产物项，影响可读性。

## 用户建议
不要在普通 Chat Markdown 中特殊检测文件路径。更合理的方向是：架构师把原本交给用户审批的内容写成一个标准 Markdown 产物（例如 `计划审批书.md` / `plan-review.md`），里面使用 Markdown 链接以相对路径引用 UI HTML 原型或其他产物。用户审批阶段通过一个“蛋黄派计划审批书”预览工具/Tab 展示该文件，链接可点击并使用项目预览或 `window.open` 打开。

## 目标
1. 设计并实现 YPI Studio 计划审批书机制：在进入 `awaiting_approval` 前生成/要求生成计划审批书产物。
2. 在任务详情中提供专用审批预览入口，优先展示计划审批书，支持 Markdown 链接到本任务目录内的相对文件。
3. 修复/优化任务详情“产物”Tab 的重复产物展示问题。
4. 保持 `awaiting_approval -> implementing` 审批门禁不变。

## 约束
- 该任务改变前端交互和用户可见信息结构，必须经过 UI designer HTML 原型并获得用户确认后才能实现。
- 不要用全局 Chat 文本路径自动识别作为主要方案；优先使用结构化产物和标准 Markdown 链接。
