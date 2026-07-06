# Checks — Browser Share 服务地址配置与 debugger/CDP 模式

## 自动验证

ypi web：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

外部扩展：

```bash
cd ~/gitProjects/ypi-browser-share-extension
npm run build
```

本轮最终结果：以上三条自动验证均已通过。当前实现按用户决策采用单一 debugger-first manifest，不再维护单独 `build:debugger`。

## 需求覆盖检查

- [ ] popup 默认显示并使用 `http://localhost:30141`。
- [ ] popup 可保存并测试自定义 base URL。
- [ ] 自定义端口能完成 health、create share、snapshot、commands、result 全链路。
- [ ] LAN/HTTPS 反代地址在获得 host permission 后可用。
- [ ] active share 使用创建时 baseUrl；切换设置不会把结果发到另一个 ypi。
- [ ] ypi web health 返回扩展 capabilities 且旧插件仍兼容。
- [ ] BrowserShareControl 展示 capture/debugger/source 状态但不暴露敏感字段。
- [ ] debugger 模式不影响默认 DOM 模式。
- [ ] debugger attach 只针对当前分享 tab，停止分享会 detach。
- [ ] CDP snapshot 只包含白名单摘要字段；没有 raw DOM/AX tree。
- [ ] 截图如实现，必须显式 opt-in/审批。
- [ ] Agent tools schema 仍不包含 `shareId`、`tabId`、`baseUrl`。

## 手工验收矩阵

### 服务地址

| 场景 | 期望 |
| --- | --- |
| 默认 localhost | 无额外配置即可分享和绑定。 |
| 自定义 localhost 端口 | 保存测试成功后全链路走新端口。 |
| `127.0.0.1` | 可用且显示 loopback 安全级别。 |
| LAN IP HTTP | 弹出/提示 host permission 与安全警告；授权后可用。 |
| HTTPS 反代 | health 与分享成功；base path 拼接正确。 |
| URL 非法 | 不保存，显示清晰错误。 |
| health 失败 | 不生成 share code，提示检查地址/服务。 |
| 用户拒绝 host permission | 不继续请求该 origin，说明如何重试。 |
| active share 后切换地址 | 当前分享仍显示原 baseUrl；下一次分享才用新地址或要求停止重建。 |

### Debugger/CDP

| 场景 | 期望 |
| --- | --- |
| 标准插件 | manifest 无 `debugger`；debugger 开关不可用或提示加载 debugger build。 |
| debugger build 开启 | 用户能看到风险提示与 attach 状态。 |
| attach 成功 | snapshot 中有 `captureMode=debugger`、viewport、bounds/AX 摘要。 |
| attach 失败/DevTools 冲突 | 自动 fallback DOM；状态显示 lastError；普通分享不失败。 |
| 停止分享/tab 关闭 | 调用 detach/清理状态；active command 失败并有明确原因。 |
| CDP click/type/scroll/navigate | 仍遵守 ypi 审批矩阵，并返回 terminal result。 |
| 敏感输入框 | 不采集 value，不允许自动 type 到敏感字段。 |
| 截图未 opt-in | snapshot/result 不包含 screenshot data。 |
| 截图 opt-in（若实现） | 有尺寸/字节上限和明确风险提示。 |

## 质量检查

- [ ] 没有把外部扩展代码 import 到 ypi web 主项目。
- [ ] TypeScript 类型扩展都是可选字段，旧 JSON 仍可解析。
- [ ] Server-side sanitize 对新增 debugger 字段做数量/长度/数值边界限制。
- [ ] Extension storage 迁移兼容没有 `baseUrl` 的旧 activeShare。
- [ ] popup 文案不承诺“公网安全”或“永久后台在线”。
- [ ] README 说明 MV3 service worker best-effort 限制。
- [ ] docs/modules 与 architecture 文档同步。

## 回归风险重点

- New Chat 绑定与现有 share code 流程不能回退。
- readonly/interactive approval matrix 不能因 debugger 改变。
- Extension popup 关闭后原 long-poll/alarms transport 仍可工作。
- `browser_share_snapshot` 对旧 DOM-only snapshot 的输出不变。
- 多 session 同时打开时仍只能由输入 share code 的目标 session 访问。
