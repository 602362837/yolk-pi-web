# Brief

## 任务目标

建立项目级统一提示能力，迁移生产前端中的浏览器原生 `window.confirm` / `window.prompt`，并为后续通知类 `alert` 提供统一入口，使提示交互具备一致视觉、可访问性、键盘操作、响应式行为和可测试的异步契约。

## 现状证据

- 生产源码没有原生 `alert`，有 13 个 `window.confirm` 和 1 个 `window.prompt`。
- 调用分布于 `ChatGptUsagePanel.tsx`、`SessionSidebar.tsx`、`YpiStudioPanel.tsx`、`ModelsConfig.tsx`、`AppShell.tsx`、`TerminalPanel.tsx`、`FileViewer.tsx`。
- 项目已有多个业务型 modal，但实现分散；`ProjectSpaceSwitchDialog` 已包含较完整的 focus trap、Escape、初始焦点和响应式约束，可作为交互参考。
- `ModelsConfig.tsx` 有组件内局部 toast，缺少 `role=status` / live region、统一队列和卸载清理。
- `DiffModal`、项目空间切换、设置、用量统计等承载复杂业务内容，不属于本次通用提示窗迁移范围。

## 推荐边界

新增应用级 `PromptProvider`（最终命名由实现阶段遵循项目命名习惯确认）和 `usePrompt()`：

- `notice(options): Promise<void>`：必须确认已读的单按钮消息，不用于普通成功反馈。
- `confirm(options): Promise<boolean>`：确认/取消，支持 `default | danger` 意图。
- `prompt(options): Promise<string | null>`：单行输入、初值、placeholder、校验和提交。
- `toast(options): id` / `dismissToast(id)`：非阻塞、短暂反馈，支持 success/error/info；若本次范围需收敛，可先交付 alertdialog 三类并保留 toast API 设计，但不应把原生 confirm 迁成 toast。

## UI 门禁

任务改变用户可见确认和输入体验，必须由 `ui-designer` 基于现有项目产出可运行 HTML 原型，并由用户审批后才可实现。当前架构师子会话无 Studio 派发工具，未能实际派发；这是一项流程阻塞，不得用纯 Markdown 或架构师自制原型替代。

## 待决策

1. 本次是否同时统一 `ModelsConfig` 的局部 toast，推荐“是”，否则统一提示能力仍有明显重复。
2. 原生调用中的中英文文案是否保持原样迁移，还是顺带统一语言；推荐本次保持原文，避免扩大产品文案范围。
3. backdrop 点击是否允许取消确认框；推荐 confirm/prompt 不允许，notice 可由明确按钮关闭，避免误操作。
