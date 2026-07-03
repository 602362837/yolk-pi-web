# Implement Plan

1. `components/SettingsConfig.tsx`
   - 增加 `initialSection`、`studioFocusMember`、`studioFocusField` props。
   - 初始切换到 Studio section 并加载 models。
   - 为默认成员/跳转自定义成员配置行添加 ref、高亮与 scroll into view。
   - 自定义成员修改写入 `studio.members[id]`。

2. `components/AppShell.tsx`
   - 增加打开 Settings 的目标状态。
   - 将 `webConfig?.studio` 与 `onOpenStudioMemberSettings` 传给 `YpiStudioPanel`。
   - 打开 `SettingsConfig` 时传入 Studio focus 参数；保存/关闭后沿用现有 reload。

3. `components/YpiStudioPanel.tsx`
   - 增加 props 接收 studio 配置与打开 Settings 回调。
   - 增加 helper 解析/格式化成员模型策略：成员配置、默认策略、加载失败/缺失。
   - 成员卡与详情渲染模型、thinking、来源和“修改模型”按钮。
   - 调整 `AgentCard` 避免嵌套 button，保留选择与键盘操作。

4. `docs/modules/frontend.md`
   - 更新 YPI Studio Members tab 与 SettingsConfig 的交互说明。

## 推荐决策

- 点击“修改模型”只定位并高亮 Settings 成员配置行，不自动展开 ModelSelect 下拉。
- 自定义成员只在从 Members tab 跳转时显示对应配置行；Settings 常规入口保持默认成员配置。
