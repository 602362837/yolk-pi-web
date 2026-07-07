# handoff

## 本轮研究结论

- 用户修正后的诉求成立：现有 debugger target tab 定位本身没发现问题；真正问题是 Chrome 原生 debugger infobar 的可感知范围。
- Chrome 原生 debugger infobar **不能**由普通扩展限定为只在被分享 tab 顶部显示，也不能自定义文案/位置。Chromium 使用 `GlobalConfirmInfoBar`，其设计就是在 every tab / every browser 显示扩展 debugger 警告。
- 可行替代是：保留 tab-scoped debugger target，把 Chrome infobar 当作全局安全警告；在被分享 tab 内注入 Browser Share 自有 overlay/badge，并强化 action badge、popup、ypi web 的 target 状态展示。
- 如要减少全局提示停留时间，只能考虑按需 attach 或 read-only non-debugger 模式；这不能做到 tab-only infobar，并会牺牲截图/action 可靠性，需要单独产品决策。

## 产出 / 修改文件

仅更新规划文档，未修改生产代码：

- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/brief.md`
- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/prd.md`
- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/ui.md`
- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/design.md`
- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/implement.md`
- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/checks.md`
- `.ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/handoff.md`

## 验证运行

```bash
cd /Users/zyj/gitProjects/ypi-browser-share-extension && npm run build
# YPI Browser Share extension validation passed.
```

并阅读/引用了 Chrome/Chromium debugger infobar 实现证据：`debugger_api.cc`、`extension_dev_tools_infobar_delegate.*`、`global_confirm_info_bar.*`、`debugger_apitest.cc`、`generated_resources.grd`。

## 剩余风险

- Chrome 全局 debugger 警告仍会出现，overlay 只能补足 per-tab 标记，不能改变 Chrome UI。
- Overlay 在受限页面、跨 origin 导航后可能注入失败，需要 fallback 状态。
- 若改成按需 attach/read-only 模式，会影响现有 persistent debugger 生命周期和 action 工具可靠性。

## 需要主会话决策

1. 是否确认默认方案：**persistent debugger 保持不变 + 共享 tab 页面 overlay 作为 per-tab 标记**？
2. 是否需要 ypi web `BrowserShareControl` 同步展示 target/marker 状态，还是先只做插件 overlay/popup/action badge？
3. 是否要规划第二模式（按需 attach 或 read-only non-debugger）来减少全局 infobar 停留时间？
