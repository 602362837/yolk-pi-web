# Brief

## 任务目标

将聊天输入区及 Settings 中共用的模型选择器，从锚定触发器的窄下拉层改为 viewport 级模态弹窗，使模型按 provider 分栏展示，并保留快速检索、当前值识别和键盘可用性。

## 现状证据

- `components/ModelSelect.tsx` 是共享选择器，调用方包括 `components/ChatInput.tsx` 与 `components/SettingsConfig.tsx`。
- 现有组件已经按 `group` 聚合、支持 model/provider id/provider display name 模糊检索，但面板宽度仅约 300-320px，provider 仍纵向堆叠。
- 模型值由调用方编码，聊天使用 provider + modelId；Settings 还包含“跟随主会话模型 / Pi 默认 / 本层不指定”等策略项。
- `/api/models` 已返回 `id/name/provider/providerDisplayName`；本任务无需改变 API 或会话 set_model 契约。
- `ProjectSpaceSwitchDialog` 提供项目现有 viewport 模态、遮罩关闭、Escape、焦点圈定和焦点恢复模式，可作为交互基线。

## 推荐范围

仅替换 `ModelSelect` 的展示与交互层；保持 props、option value、搜索评分和调用方状态流兼容。桌面端推荐 provider 独立列，窄屏改为单列 provider 分组。搜索时只展示命中项和含命中的 provider。

## UI 门禁与阻塞

这是明确的用户可见交互与信息架构变更，必须由 `ui-designer` 基于现有项目生成 HTML 原型，并经用户审批后才能实现。当前委派环境没有 Studio 派发工具，架构师无法实际启动 ui-designer；主会话需补派发。

## 待用户决策

1. 是否批准“桌面 provider 独立列、窄屏单列分组”的分栏语义，而不是“左侧 provider 导航 + 右侧单栏模型列表”。
2. Settings 的“模型策略”是否作为固定首栏显示。推荐保留为首栏，避免改变策略值语义。
3. 选择模型后是否立即关闭弹窗。推荐保持现状，单击/Enter 立即提交并关闭。
