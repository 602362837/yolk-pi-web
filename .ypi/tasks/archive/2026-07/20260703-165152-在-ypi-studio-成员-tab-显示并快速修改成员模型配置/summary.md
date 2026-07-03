# Summary

## 完成内容

- YPI Studio Members tab 成员卡片与详情显示模型、thinking 与来源摘要。
- 成员卡片/详情增加“修改模型”入口。
- 点击后打开 Settings 的 Studio section，并滚动/高亮对应成员配置行。
- 支持默认成员与从 Members tab 跳转的自定义成员配置。
- Settings 常规入口保持原有默认行为。
- 未新增后端 API，未改变 YPI Studio runtime 模型解析优先级。

## 修改文件

- `components/AppShell.tsx`
- `components/YpiStudioPanel.tsx`
- `components/SettingsConfig.tsx`
- `docs/modules/frontend.md`

## 检查修复

检查员补充修复：

- `components/YpiStudioPanel.tsx`：当 `studio.defaultPolicy.model = unset` 时，成员模型摘要明确显示运行时回退为“跟随主会话 → Pi 默认”，避免含糊的“使用默认策略”。

## 验证

- `npm run lint`：通过
- `node_modules/.bin/tsc --noEmit`：通过

## 剩余风险

- 未做浏览器实操；建议后续在 UI 中手工确认 Settings 行滚动/高亮和自定义成员保存体验。
