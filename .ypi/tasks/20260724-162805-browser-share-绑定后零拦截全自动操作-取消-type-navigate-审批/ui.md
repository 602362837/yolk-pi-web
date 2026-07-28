# UI — Browser Share 全自动授权与状态

> **UI 原型门禁：已就绪，等待用户审批。** UI 设计员已完成原型产出，并更新了下方的链接与细节。请用户在主会话中确认。

## UI 设计员任务简报

请 UI 设计员先阅读：

- [prd.md](prd.md)
- [design.md](design.md)
- `components/BrowserShareControl.tsx`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.html`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.css`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.js`

## 原型交付

- **自包含 HTML 原型**：[browser-share-full-auto-prototype.html](browser-share-full-auto-prototype.html)
- 原型内包含了可交互的状态切换按钮，可以直观地预览 Extension 与 ypi 面板在“默认新建”、“Web版本过低”、“全自动已绑定”、“严格模式已绑定”、“Debugger冲突”等 5 个关键状态下的表现。

## 设计目标

1. 用户明确理解：分享码绑定成功即授权当前 session 自动操作当前共享 tab。
2. 默认主路径为「全自动（推荐）」，不再隐藏 `type` / `navigate` 逐次审批。
3. 保留可选「每次确认」严格模式，不向用户展示 `interactive` / `readonly` 技术枚举。
4. debugger/连接异常、停止/解绑入口继续高可见。
5. extension 与 ypi 面板使用一致术语和命令范围。

## 原型必须覆盖的两个表面

### A. Chrome extension popup — 创建分享前

- 模式选择建议使用两个 radio/card，而不是含混 checkbox：
  - **全自动（推荐，默认）**
    - “绑定后，Agent 可自动点击、输入、滚动和导航当前共享标签页。”
  - **每次确认**
    - “所有操作会等待你在 ypi Browser Share 面板确认。”
- 显示持续授权边界：仅当前 tab、仅绑定 session、停止分享即释放 debugger。
- 全自动连接旧 Web capability 不支持时：错误/禁用状态与升级提示。
- 分享码生成、待绑定、已绑定状态。

### B. ypi `BrowserShareControl` — 绑定后

- 当前 tab title/url/origin。
- 当前 bound session 短 id、服务地址。
- 模式产品文案：全自动 / 每次确认。
- 全自动状态：
  - 自动执行：click / type / scroll / navigate。
  - 需确认：无。
  - 不渲染待确认卡片。
  - 仍显示执行中、最近操作、debugger/连接异常。
- 严格状态：
  - 自动执行：无。
  - 需确认：click / type / scroll / navigate。
  - 待确认卡片保留「允许一次 / 拒绝」。
- 解绑入口与异常提示。

## 必须覆盖的状态矩阵

| 场景 | Extension | ypi 面板 |
| --- | --- | --- |
| 默认未分享 | 全自动已选；分享按钮可用 | 未绑定输入分享码 |
| capability 不支持全自动 | 全自动禁用/报错，提示升级；严格可用（若兼容） | 不适用 |
| 分享码待绑定 | 显示 code、过期时间、无人可操作 | 等待输入/绑定 |
| 全自动已绑定 | 绿色/明确状态；当前 session | 自动四类、需确认无 |
| 严格已绑定 | 明确“每次确认” | pending approval cards |
| queued/running | 最近命令/轮询 | 执行中列表 |
| succeeded/failed/rejected/timeout | 最近命令 | 最近操作终态 |
| debugger detached/blocked/failed | 红色异常、恢复提示 | action 不可用原因优先 |
| stale/offline | 离线/变慢 | 保留解绑与状态信息 |
| 窄屏/长标题/长 URL | 不溢出 | 340px panel 与移动视口不溢出 |
| 明暗主题 | popup 自有主题可读 | 使用现有 CSS 变量 |

## 交互与文案边界

- 全自动授权不是确认 dialog；用户通过 extension 分享 + session 绑定完成授权。
- 不使用“零风险”“无限控制”“整个 Chrome”等文案。
- 使用“当前共享标签页”“当前绑定 session”“直到停止或解绑”。
- “零拦截”不应隐藏真实失败：debugger、离线、timeout 仍展示。
- 严格模式的技术值虽为 `readonly`，UI 不显示“只读”，避免与“允许后可操作”矛盾。

## 可访问性要求

- mode cards 使用真实 radio 语义，label 整体可点击；键盘方向键/Tab 可操作。
- 当前模式与推荐标记不能只靠颜色。
- 异常使用 `role=alert` 或可感知状态；轮询更新避免持续抢占屏幕阅读器。
- pending action 按钮保留明确文本与 disabled/busy 状态。
- focus-visible、对比度、窄屏触控目标符合现有项目习惯。

## 实现映射建议

| 原型区域 | 生产文件 |
| --- | --- |
| Extension mode selector | `src/popup/popup.html`, `.css`, `.js` |
| Extension operator/mode summary | `src/popup/popup.js` |
| ypi bound mode summary | `components/BrowserShareControl.tsx` |
| ypi strict pending cards | 复用现有 pendingApprovalCommands 区块 |
| ypi auto/approval command lists | 读取 operator arrays，不手写策略 |

## 门禁状态

- UI designer dispatch：**已完成**。
- HTML 原型：**已就绪**（[browser-share-full-auto-prototype.html](browser-share-full-auto-prototype.html)）。
- 用户 UI 审批：**待主会话执行（请用户确认）**。
- 在用户批准原型与计划前：**不得 transition 到 implementing**。
