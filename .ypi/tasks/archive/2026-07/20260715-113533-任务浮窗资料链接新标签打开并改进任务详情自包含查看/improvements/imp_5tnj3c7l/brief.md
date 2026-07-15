# Brief — IMP-001 修复任务资料预览滚动需点击才生效

## 反馈摘要

用户验收主任务「任务资料新标签 / 详情自包含查看」后反馈：

- 新标签页 `/studio/task-document` 中滚轮似乎要先点到特定区域才生效。
- 任务详情内嵌资料预览同样需要先点击才好滚动。

这是主任务交付后的滚动体验回归，不改变资料打开策略（新标签 / 内部查看）本身。

## 证据与根因

已对照实现与样式：

1. **Page 高度链断裂**  
   - `app/layout.tsx` 的 `body` 为 `height:100dvh; display:flex; flex-direction:column`。  
   - `.ypi-studio-task-document-page` / `.ypi-studio-task-document.is-page` 仅 `min-height:100dvh`，未建立 `height:100% / flex:1 / min-height:0` 列布局。  
   - `.ypi-studio-task-document-body { flex:1; overflow:auto }` 在父级随内容撑开时**不会成为固定高度滚动容器**，实际滚动落到 document/window；滚轮落在「非 overflow 区域」或焦点在 back/header 时表现为「要点一下才动」。

2. **Embedded 双层滚动**  
   - `TasksTab` 列表容器：`overflowY:auto`。  
   - `TaskDetailShell`：`overflowY:auto` + flex column。  
   - 内嵌 `YpiStudioTaskDocumentView` 的 body 再次 `overflow:auto`。  
   - 同一指针路径上存在 2–3 个潜在滚动目标；浏览器默认把 wheel 交给「当前命中的可滚动祖先 / 焦点元素」，未点 body 时往往滚外层或被 `overscroll-behavior` 吞掉。

3. **全局 overscroll**  
   - `html, body { overscroll-behavior: none }` 会放大「外层不能滚、内层又没高度」时的卡死感。

4. **焦点**  
   - Embedded 进入时 auto-focus 返回按钮；返回按钮不在 body 滚动容器内，加重「先要点内容区」的主观感受。

## 范围与目标

- 让 **page 模式**打开后无需点击即可用滚轮/触控板滚动正文；头部固定，正文是唯一滚动容器。  
- 让 **embedded 模式**在文档视图打开时，Studio 详情壳不再与正文双滚；正文是唯一滚动容器，返回/头部固定。  
- 保持只读、路径安全、打开策略与主任务 R1–R5 不变。

## 非目标

- 不改浮窗新标签 / 详情内部查看的打开策略。  
- 不改 files API、resolver、approval/grant/transition。  
- 不重做 Studio Drawer 信息架构、Chat Markdown、FileExplorer 滚动。  
- 不解决主任务已记录的「返回后恢复原始触发控件焦点」完整度（可顺带不恶化）。

## 风险与依赖

- 调整 `TaskDetailShell` overflow 时勿破坏普通 Tab 详情的长列表滚动。  
- 窄屏/移动端需保持返回按钮可见与可滚。  
- 需避免把滚动责任误绑到 `window` 导致 sticky 头失效或双滚复发。

## 建议改进计划

1. CSS：page 建立 `100dvh` flex 高度链；body 为 sole scroller。  
2. Panel：document target 打开时 shell/外层改为 `overflow:hidden` + 传满高度；body sole scroller。  
3. 可选：body `tabIndex={0}` / 进入后 focus body（不抢键盘 trap），改善 wheel 目标。  
4. HTML 原型展示 before/after；用户审批后实现。  
5. checks：桌面/窄屏/触控板，page + embedded，不点内容区直接滚动。

## 判断

- 需要 UI 原型？**是**（滚动与布局变化，需可交互对照）。  
- 需要计划审批？**是**（交互行为与布局边界变化）。  
- 等待澄清？**否**（反馈与代码证据足够收敛）。
