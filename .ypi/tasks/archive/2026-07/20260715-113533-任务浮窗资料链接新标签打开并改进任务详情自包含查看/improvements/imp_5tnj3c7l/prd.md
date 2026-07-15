# PRD — IMP-001 任务资料预览滚动

## 目标与背景

主任务已正确分流「浮窗新标签」与「详情内部查看」，但只读文档视图的滚动容器高度链与双层 overflow 配置不完整，导致用户必须先点击正文区域滚轮才生效。本改进仅修复滚动体验。

## 用户价值

- 打开资料后立刻能滚动阅读，无需先点正文。  
- 头部（返回 / 文件名 / 只读标识）在滚动时保持可见。  
- 详情内阅读时不会出现「外层和正文抢滚动」的抖动或无响应。

## 范围内

1. `/studio/task-document` page 模式滚动容器与高度链。  
2. `YpiStudioPanel` 任务详情 embedded 文档视图的单滚动容器。  
3. 相关 CSS（`.ypi-studio-task-document-*`）与必要的 shell 条件 overflow。  
4. 加载/空/错误状态下同样可滚动或占满剩余视口。  
5. 桌面滚轮、触控板、窄屏触控滚动；`prefers-reduced-motion` 不引入多余动画。

## 范围外

- 打开策略、popup blocked toast、HTML CSP preview。  
- task files API、路径安全、approval 写路径。  
- Chat / FileExplorer / 其它 Studio Tab 的通用滚动重构（除 document 打开时必须的 shell 条件分支）。  
- 完整「返回后恢复原始触发控件」焦点工程（不阻塞本改进；不得变差）。

## 功能需求与验收标准

### R1 Page 模式即时滚动

- 从浮窗打开 PRD/计划审批书新标签后，**不点击正文**，将指针悬停在页面任意正文可见区域（含空白 padding）滚动，正文应立即滚动。  
- 页面头部与只读说明在滚动时保持可见（sticky 或 flex 固定头 + body 滚动）。  
- 不出现「整页 window 与 body 同时滚」的双滚动条。

### R2 Embedded 模式单滚动

- 任务详情进入内部资料视图后，**不点击正文**即可滚动正文。  
- 返回按钮与文档头固定；滚动不把返回按钮滚出视口。  
- 关闭文档回到来源 Tab 后，普通详情 Tab 长内容仍可按原 shell 滚动。

### R3 状态与可访问性

- loading / empty / error 视图占满剩余高度，不把布局压成「只有中部一小块可点才滚」。  
- 键盘：返回、重试仍可 Tab 到达；Escape 不关闭整个 Studio Drawer。  
- 触控板/移动端可惯性滚动（在 `overscroll-behavior: contain` 下不把滚动链泄漏到错误祖先）。

### R4 无副作用

- 仅布局/样式/焦点微调；不新增写 API；不 PATCH 任务；不改 grant/transition。

## 非功能

- 改动集中在 `YpiStudioTaskDocumentView`、`app/studio/task-document/page.tsx`（如需）、`app/globals.css`、`YpiStudioPanel` 的 document 分支。  
- 不扩大 task-local resolver 权限。

## 未决问题

无阻塞。若实现时发现仅 CSS 无法约束 TasksTab 外层 overflow，允许对「documentTarget != null」做条件样式，不得永久关掉所有详情滚动。
