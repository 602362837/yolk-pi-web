# checks

## 自动验证

- `npm run lint`：通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- Checker 复查：第一轮发现持久化/readback 未识别 `waiting_for_user`、卡片背景仍偏成功色；已修复并重新验证 lint/tsc 通过。

## 覆盖点

- 类型层允许 `waiting_for_user` 状态。
- YPI Studio 子进程 JSON 事件层识别阻塞型 `extension_ui_request`。
- 任务持久化/readback 层保留 `waiting_for_user` 运行状态和 transcript ref。
- 父会话工具结果/进度会收到可读等待用户输入说明。
- 前端 transcript 可显示 `Waiting for user`，使用警示色文字、边框和背景。
- 文档已更新架构、library、frontend 模块说明。

## 剩余风险

- 当前实现是“向上暴露并终止子进程”的 MVP，不支持用户回答后恢复同一个子进程。
- 尚未用真实会发出 extension UI request 的 Studio member 做浏览器手工验证。
