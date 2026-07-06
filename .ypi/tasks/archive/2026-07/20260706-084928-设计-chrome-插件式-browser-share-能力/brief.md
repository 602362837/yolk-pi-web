# brief

## 用户目标
为 ypi/pi web agent 增加操作用户正在使用的 Chrome 浏览器的能力。不是由 agent 启动隔离浏览器，而是用户主动共享自己当前使用的 Chrome 页面给 agent，agent 能更精准理解诉求并在授权后继续操作。

## 明确方案偏好
采用连接方式 2：Chrome Extension + 本地桥接，而不是 Chrome remote debugging/CDP 启动模式。

## 插件项目位置约束
Chrome 插件部分不要作为 ypi web 主项目的打包内容：
- 优先考虑与当前项目平级放置一个独立项目；或
- 若放在当前仓库中，也必须从 ypi web 主应用发布/打包中排除，避免被 npm/web build 打进去。

## 多 session / 防误分享交互要求
用户特别强调：不要把浏览器页面分享到错误的 chat/session。

候选交互方向：
- 插件端点击分享后生成一个短分享码。
- ypi chat 输入区或附近新增“填写分享码/绑定浏览器分享”的入口。
- 用户在目标 chat/session 中填入分享码后才完成绑定。
- 这样可避免多个 ypi session 同时打开时，插件不知道该分享给哪个 session。
- 架构师也可提出更好的交互方案，但必须解决“明确绑定到目标 session/chat”的问题。

## 初步 MVP 范围候选
- 插件读取当前 tab URL/title、选中文本、页面摘要、可交互元素摘要。
- 用户显式开启“共享当前页面给 ypi”。
- ypi Web 显示 Browser Share 连接状态、当前 tab、权限模式。
- 本地桥接（WebSocket/HTTP）维护浏览器会话状态。
- agent 暴露浏览器观察/操作工具。
- 默认只读，写操作需授权/确认。
- 多 session 下通过分享码或更优绑定机制避免分享错目标。

## 待架构师设计问题
1. 插件独立项目与 ypi web 主项目之间如何组织、开发、调试、发布。
2. 插件与本地 ypi web/agent 后端的通信协议与鉴权。
3. agent 工具接口设计及如何集成到现有 session/RPC 生命周期。
4. 前端 Browser Share UI 入口、分享码绑定交互与授权交互。
5. 安全边界：敏感字段、权限降级、用户确认、断连、审计。
6. MVP 与后续扩展边界。
