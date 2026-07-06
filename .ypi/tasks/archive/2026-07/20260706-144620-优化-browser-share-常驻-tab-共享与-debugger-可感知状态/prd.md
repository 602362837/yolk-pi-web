# prd

## 目标与背景

Browser Share 应从“按需 CDP 调用”升级为“用户明确启动、tab 持续处于共享/debugger 状态、用户明确知道授权对象”的模型。这样能降低隐式操作风险，并让 Chrome 自带 debugger infobar 成为持续安全提示，而不是在命令执行时短暂闪现。

## 范围内

1. 用户在插件点击分享当前页后，扩展对该 tab 常驻 Chrome debugger attach。
2. 分享生命周期中持续展示共享状态、服务地址、绑定会话、权限模式、debugger 状态。
3. ypi web API/状态投影能表达 persistent debugger、操作者授权范围、解绑/替换/过期等终态。
4. ypi agent action tools 不再依赖扩展临时 attach；debugger 不可用时应失败并解释，而不是隐式降级执行操作。
5. 保持 session-scoped 安全边界：tools 不接受 shareId，share code 单次绑定。

## 范围外

- 多 activeShare / 多 tab 并发共享。
- 页面内常驻浮层作为默认方案。
- 服务端直接调用 Chrome debugger。
- 跨 ypi 服务迁移 activeShare；仍固化创建时 baseUrl。

## 需求与验收标准

| 编号 | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 创建分享即常驻 debugger | 点击“分享当前页”成功后，Chrome 持续显示 debugger infobar；后续刷新快照/命令不会 detach；popup 显示“常驻 debugger 已连接”。 |
| R2 | 明确谁可以操作 | 未绑定时显示“无人可操作，仅分享码可绑定一次”；绑定后显示 ypi baseUrl、session 短 id/标签、readonly/interactive 操作策略。ypi chat 侧也显示当前 chat/session 的授权范围。 |
| R3 | 可控 detach | 只有停止分享、ypi 解绑/替换、分享码过期、tab 关闭、扩展/浏览器卸载或 debugger 被外部接管等明确事件会 detach 或标记不可用。 |
| R4 | API 可感知 | `/state`、command long-poll、heartbeat 能返回 lifecycle/debugger/operator 信息；解绑后扩展能收到 detachRequested/410 并释放 debugger。 |
| R5 | 失败安全 | debugger attach 失败时不创建可操作分享；运行中 debugger 丢失时不执行 action command，命令失败并提示关闭 DevTools/其他 debugger 或重新分享。 |
| R6 | 兼容旧版本 | 旧扩展缺少 persistent 字段时，ypi UI 标记“旧版/按需 debugger”，并建议更新；新扩展遇到旧 ypi web health 不支持 persistentDebugger 时阻止或明确警告。 |
| R7 | 验证可回归 | web lint/type-check 通过；扩展 `npm run build` 通过；手工验证创建、绑定、命令、解绑、tab 关闭、debugger 冲突、server restart 等路径。 |

## 未决问题

1. 是否允许“debugger attach 失败但只读 DOM 快照分享”的显式降级模式？推荐 MVP 不允许，避免继续形成不可感知的操作模型。
2. 是否需要页面内常驻 overlay？推荐先不做，使用 Chrome infobar + tab badge + popup + ypi UI；overlay 可能影响页面布局/交互。
3. 扩展 popup 中是否必须展示 ypi session title？推荐 MVP 展示 baseUrl + session 短 id；读取 title 需要额外 session metadata 耦合。
