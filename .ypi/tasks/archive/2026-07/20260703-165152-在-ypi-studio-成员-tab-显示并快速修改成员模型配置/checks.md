# Checks

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验证

- 打开 Studio → Members，确认每个成员展示模型策略摘要。
- 点击默认成员“修改模型”，Settings 打开到 Studio section 并高亮对应成员。
- 修改模型并保存，关闭 Settings 后 Members tab 展示更新。
- 自定义 `.ypi/agents/*.md` 成员也能打开对应 Settings 配置行。
- 成员卡选择、键盘 Enter/Space、打开文件入口不被“修改模型”按钮破坏。
- Settings 从顶部常规入口打开时仍维持原有默认 section 行为。
- `/api/web-config` 加载失败时 Members tab 有合理降级提示。
