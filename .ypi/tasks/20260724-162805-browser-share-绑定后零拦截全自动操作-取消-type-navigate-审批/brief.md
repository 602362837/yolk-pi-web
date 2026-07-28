# Brief — Browser Share 绑定后零拦截全自动操作

## 问题

Browser Share 的产品目的是真实浏览器自动化，但现行权限策略在 `interactive` 模式下仍将 `type`、`navigate` 置为 `pending_approval`。Agent 最多等待 90 秒；若用户没有打开 ypi Browser Share 面板并点击「允许一次」，命令会以 `timeout` 结束。审批并非 Chrome 系统授权框，而是隐藏在 ypi 面板中的产品内确认，导致 GitHub App 表单填写等无人值守流程中断。

已核对证据：

- `lib/browser-share-manager.ts`：`commandNeedsApproval()` 让 `interactive` 的 `type` / `navigate` 进入审批；`enqueueCommand()` 据此选择 `pending_approval` 或 `queued`。
- `components/BrowserShareControl.tsx`：渲染待确认卡片，并通过 approval API 执行「允许一次 / 拒绝」。
- `lib/browser-share-extension.ts`：工具提示明确说明 `interactive` 下仍需审批，等待终态上限为 90 秒。
- `docs/architecture/browser-share.md`：文档记录同一语义。
- 外部扩展 `~/gitProjects/ypi-browser-share-extension`：popup 默认未勾选「允许操作」，且 README/popup 文案继续宣称高风险操作需 ypi 确认。

## 目标用户与价值

- 希望让 agent 自动完成网页填写、导航、点击、滚动的 ypi 用户。
- 需要长流程或无人值守浏览器操作的自动化任务。
- 价值：用户主动分享并绑定一次后，该 bound session 可连续完成操作，不再因面板内逐次确认而超时。

## 目标

1. 主路径改为：用户主动分享并将分享码绑定到目标 ypi session 后，`click` / `type` / `scroll` / `navigate` 全部自动排队执行。
2. 默认分享模式即为全自动；UI 不再把 `type` / `navigate` 描述为需要逐次批准。
3. 保持 session 与 tab 隔离、一次性分享码、persistent debugger、敏感字段拒绝、`navigate` 仅 http(s)、解绑/停止清理等安全边界。
4. 保留可选严格模式与既有 approval/status 协议，避免破坏历史客户端、在途命令及拒绝/超时终态。
5. Web、agent tool 提示、API operator 投影、Chrome 扩展 popup/README 的语义一致。

## 非目标

- 不移除 Chrome 原生 debugger 警告，不改变 persistent debugger 生命周期。
- 不允许 agent 指定任意 `shareId`、任意 tab 或跨 session 操作。
- 不新增公网远控、认证体系、WebSocket/SSE 传输或多 tab 并发分享。
- 不放宽敏感输入字段拒绝、快照脱敏或 `http(s)` 导航限制。
- 不把“零拦截”解释为忽略 debugger 离线、扩展失败、解绑、超时等真实执行错误。

## 成功标准

- 默认全自动分享绑定后，四类命令首次即为 `queued`，operator 返回全部 `autoAllowedCommands`、空 `approvalRequiredCommands`。
- `type` / `navigate` 可在 ypi 面板关闭、无人点击确认时完成，不出现 `pending_approval`。
- 严格模式仍可产生 `pending_approval`，并支持允许、拒绝和 timeout 终态。
- session B 无法读取或操作 session A 的绑定；解绑/替换/停止会终止活动命令。
- debugger detached/blocked/failed 时 action 明确失败，且不回退到隐蔽 content-script 操作。
- 新旧 Web/扩展组合不会把“全自动”错误宣传为已生效；能力不匹配时有明确升级提示。

## 约束

- `BrowserSharePermissionMode` 现有 wire 值为 `readonly | interactive`，应优先兼容而非新增第三个枚举。
- Browser Share 状态仅存内存；无需数据迁移，历史 JSONL 不受影响。
- Chrome 扩展在独立仓库 `~/gitProjects/ypi-browser-share-extension`，实现与验证必须跨仓库协调。
- 本阶段只做规划；未获用户对 plan-review 与 UI HTML 原型批准前，不改生产代码。

## 推荐决策

- 保留 wire 值但更新语义：`interactive` = **全自动**；`readonly` = **逐次确认（严格模式）**。UI 使用产品文案，不直接暴露容易误解的技术值。
- 新分享缺省 `permissionMode` 解析为 `interactive`；扩展 popup 默认选择「全自动（推荐）」。
- approval API、`pending_approval`、`rejected`、`timeout` 保留给严格模式、在途命令与兼容路径。
- health capability 增加 `fullAutoInteractive`（或等价版本化字段），新扩展在选择全自动时检查能力，避免连接旧 Web 后仍被静默审批。

## 待主会话确认

1. 是否接受推荐严格模式：保留现行为“所有 action 逐次确认”，而不是把 `readonly` 改成完全禁止 action。
2. 是否接受 `interactive` wire 名称不变、UI 统一显示「全自动」，以减少协议迁移。
3. UI 原型门禁已触发；必须由 `ui-designer` 产出并经用户批准后方可实现。
