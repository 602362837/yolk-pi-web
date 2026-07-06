# brief

## 任务目标

优化 Browser Share：用户在 Chrome 插件中选择分享某个 tab 后，该 tab 应进入可持续感知的“共享中 / debugger 常驻”状态；Browser Share 不再为了单次截图或命令临时 attach/detach Chrome debugger。用户需要明确知道：当前 tab 分享给哪个 ypi 服务、哪个 chat/session 可以读取或操作、哪些操作需要一次性确认。

## 背景依据

- Chrome 插件独立项目：`~/gitProjects/ypi-browser-share-extension`。
- ypi web 侧已有：`app/api/browser-share/**`、`lib/browser-share-manager.ts`、`lib/browser-share-types.ts`、`lib/browser-share-extension.ts`、`components/BrowserShareControl.tsx`。
- 既有能力：share code 单次绑定、session-scoped tools、long-poll command channel、debugger-first/CDP snapshot/action、扩展端 baseUrl/activeShare 创建时固化。
- 当前问题：扩展会在 `collectDebuggerSnapshot` / `executeDebuggerCommand` 的 finally 中 detach debugger，用户只在瞬时操作中看到 debugger 状态，且插件 UI 对“谁可以操作”表达不够明确。

## 设计边界

范围内：

- 生命周期状态机：server share、extension activeShare/debugger、command 子状态。
- Chrome debugger attach/detach 策略：常驻 attach、何时释放、失败/冲突处理。
- 用户可感知 UI/文案：Chrome 插件 popup、tab badge、ypi chat Browser Share 控件。
- ypi web 字段/API 变更：类型、manager、routes、兼容旧扩展。
- 兼容、失败处理、实施步骤和验证建议。

范围外：

- 不实施代码。
- 不发布 Chrome Web Store 包。
- 不设计多 tab 同时共享；沿用当前单 activeShare 模型。
- 不把 Chrome debugger 权限或扩展代码纳入 ypi web Next/npm build。

## 推荐结论

MVP 采用“创建分享即常驻 attach，停止/解绑/替换/tab 关闭才 detach”的策略。若 debugger 无法 attach，默认不创建可操作分享；不做按需临时 attach。用户可见性通过 Chrome debugger infobar、tab 级 action badge、popup 操作主体卡片、ypi chat 绑定卡片共同承担。持久 DOM overlay 可能污染页面，建议非 MVP，除非主会话明确要求。
