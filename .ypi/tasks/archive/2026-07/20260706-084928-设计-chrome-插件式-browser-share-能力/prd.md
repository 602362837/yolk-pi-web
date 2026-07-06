# prd

## 目标

实现 Chrome Extension + ypi 本地桥接的 Browser Share 能力，让用户把自己正在使用的 Chrome 页面显式共享给指定 ypi chat/session，agent 在该 session 内读取页面上下文，并在用户授权后执行有限操作。

## 核心原则

- 不以 remote debugging/CDP 作为主方案。
- 插件优先作为当前仓库平级独立项目：`../ypi-browser-share-extension`。
- 插件不得进入 `@alan-zhao/yolk-pi-web` npm 包或 Next build 产物。
- 必须避免多 session 下分享错目标。
- 默认只读；写操作、导航、提交类操作需要用户确认。

## MVP 用户流程

1. 用户在 Chrome 当前页面点击插件按钮“分享当前页”。
2. 插件向本地 ypi bridge 创建一个待绑定 share，展示短分享码，例如 `K7Q4-9P`，有效期 5 分钟。
3. 用户回到目标 ypi chat/session，在 ChatInput 附近点击“绑定浏览器分享”，输入分享码。
4. ypi 后端把该 share 绑定到当前 session id。
5. 该 session 显示 Browser Share 小卡片：页面标题、URL、权限模式、连接状态。
6. agent 在该 session 内可调用浏览器观察工具读取页面快照。
7. 当 agent 请求点击、输入、滚动、导航等操作时，若超出只读权限，则在 ypi UI 和/或插件 popup 中出现确认。

## MVP 能力

- 读取当前 tab URL/title、选中文本、可见文本摘要、表单标签、可交互元素摘要。
- 每个元素生成短期稳定 `elementId`，用于后续 click/type。
- 支持只读绑定、可操作绑定两种模式；MVP 默认只读。
- 支持解绑、过期、断连、重新分享。
- agent 工具只对当前绑定 session 生效。

## 非目标

- 不读取密码字段、支付字段、隐藏 token、cookie/localStorage。
- 不支持跨用户/云端中继；MVP 只支持本机 ypi 与本机 Chrome 插件通信。
- 不做 Chrome Web Store 发布流程；MVP 使用 unpacked extension。
- 不实现完整浏览器自动化框架；先提供受控页面上下文与有限动作。
