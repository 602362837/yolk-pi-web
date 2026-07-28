# PRD — Browser Share 绑定后零拦截全自动操作

## 目标与背景

Browser Share 是用户主动把一个 Chrome tab 授权给指定 ypi session 的自动化入口。当前 `interactive` 模式仍逐次审批 `type` / `navigate`，使无人值守流程在 90 秒后超时。本需求把授权时点收敛到“用户主动分享 + 在目标 session 绑定分享码”：绑定成功后，默认模式下四类 action 均可连续自动执行。

## 范围内

- ypi web Browser Share 权限判定、operator 投影、action tool 提示与面板文案。
- 默认权限语义与严格模式兼容。
- Browser Share health capability 的跨版本声明。
- 外部 Chrome 扩展默认模式、popup 状态/说明、README 与轻量校验。
- 集中命令校验与 focused tests。
- 架构/API/前端/库文档同步。

## 范围外

- 多 tab、多 session 共享或 agent 传入 `shareId`。
- debugger attach/detach 模型、Chrome 原生警告样式。
- 浏览器传输协议重写、扩展商店发布、公共远程服务。
- 新增账号、角色、域名白名单或浏览器 cookie/localStorage 读取。
- 自动绕过页面自身验证码、登录、支付或敏感字段限制。

## 产品决策

| 场景 | wire `permissionMode` | 用户文案 | 命令初始状态 | operator |
| --- | --- | --- | --- | --- |
| 默认 | `interactive` | 全自动（推荐） | 四类均 `queued` | auto=四类，approval=[] |
| 可选严格 | `readonly` | 每次确认 / 严格模式 | 四类均 `pending_approval` | auto=[]，approval=四类 |
| 未绑定 | 无 | 尚未绑定 | 拒绝 enqueue | canRead/canOperate=false |

`readonly` 技术值为兼容保留；本版本不把它改成“完全禁止 action”，以保留 approval/reject 协议和既有严格路径。UI 不直接展示技术枚举。

## 需求与验收标准

### R1 — 绑定即授权主路径

用户选择默认「全自动」并将一次性分享码绑定到目标 session 后，无需额外逐次确认。

- 验收：`click`、`type`、`scroll`、`navigate` 首次状态均为 `queued`。
- 验收：ypi Browser Share 面板关闭时，extension long-poll 仍能领取并执行命令。
- 验收：工具等待期间不出现 `pending_approval` progress。

### R2 — 默认必须全自动

Web 对缺省/省略模式使用 `interactive` 全自动语义；新版扩展创建分享时默认选择全自动。

- 验收：首次安装/打开新版扩展，无需用户额外勾选即可创建全自动分享。
- 验收：用户可在创建分享前显式切换到严格模式。

### R3 — 四类命令一致

全自动模式不得继续对 `type` / `navigate` 特判审批。

- 验收：`commandNeedsApproval(interactive)` 对四类命令均为 false。
- 验收：operator 投影严格由同一策略计算，不允许 UI 手写另一份映射。

### R4 — 命令输入继续 fail-closed

移除逐次审批不能放宽命令参数边界。

- 验收：`navigate` 仅接受合法 `http:` / `https:` URL；非法协议在进入队列前失败。
- 验收：click/type 缺少有效 `elementId`、type 文本为空、scroll 数值非法时拒绝。
- 验收：扩展继续拒绝对快照标记为 sensitive 的字段执行 click/type。

### R5 — session/tab 隔离保持

- 验收：agent tools 仍只从 `ExtensionContext` 取得当前 session id，不接受 `shareId`。
- 验收：session B 无绑定时无法读取/操作 session A 的 share。
- 验收：extension 仍只对 `activeShare.tabId` 调用 debugger；不查询或操作其他 tab。

### R6 — debugger 与真实失败可见

“零拦截”只取消产品审批，不取消执行前置条件。

- 验收：debugger detached/blocked/failed/unsupported 时 action tool 明确失败。
- 验收：不静默回退到 content-script action。
- 验收：offline、extension 未领取、执行失败仍分别可见并可最终 timeout/failed。

### R7 — 严格模式兼容

- 验收：严格模式四类命令均进入 `pending_approval`。
- 验收：「允许一次」转为 `queued`；「拒绝」转为 `rejected`。
- 验收：approval API 与 command status union 不删除、不改路由。

### R8 — operator/API 一致

- 验收：全自动：`permissionMode=interactive`、`autoAllowedCommands=[click,type,scroll,navigate]`、`approvalRequiredCommands=[]`。
- 验收：严格：相反映射。
- 验收：tombstone/未绑定投影不宣称可操作。

### R9 — ypi 面板体验

- 验收：绑定卡明确显示「全自动」或「每次确认」，并解释授权只限当前 session 绑定的当前 tab。
- 验收：全自动下不渲染空的待确认区；执行中/最近操作继续可见。
- 验收：严格模式仍渲染待确认卡和允许/拒绝按钮。
- 验收：debugger 异常提示优先级不降低。

### R10 — Chrome 扩展体验

- 验收：创建分享前默认选择「全自动（推荐）」，文案明确“绑定后自动操作当前共享 tab”。
- 验收：严格模式文案明确“所有 action 仍需在 ypi 面板逐次确认”。
- 验收：绑定后 popup 的 mode/operator 摘要与服务端 operator 投影一致。
- 验收：不再出现“高风险仍需 ypi 确认”作为全自动模式说明。

### R11 — 跨版本不误导

- 验收：Web health 暴露可机器判断的 full-auto interactive capability。
- 验收：新版扩展选择全自动连接不支持该 capability 的旧 Web 时，阻止创建或明确要求升级，而不是宣传全自动后仍等待审批。
- 验收：严格模式可按既有能力继续工作，若实现选择保留兼容回退。

### R12 — 生命周期回归

- 验收：绑定、解绑、替换、stop、tab close、分享码过期、server not_found tombstone 行为不变。
- 验收：解绑/替换会将活动命令置为 failed，并唤醒 waiters。
- 验收：晚到 result 不覆盖 terminal 状态。

### R13 — 文档与测试

- 验收：`docs/architecture/browser-share.md`、modules docs、内置 tool prompt、扩展 README/popup 一致。
- 验收：新增 focused manager policy/validation tests；Web lint/tsc 与扩展 build 通过。
- 验收：完成真实 Chrome 双 session / 双 mode 手工矩阵。

## 用户可见验收场景

1. 在扩展保持默认「全自动」→ 分享 GitHub 页面 → 在 session A 绑定 → agent 连续 navigate/type/click，期间不打开 Browser Share 面板，全部成功。
2. session B 调用 Browser Share 工具，得到“未绑定”而非操作 session A。
3. 创建「每次确认」分享 → action 出现在 session A 面板 → 可允许或拒绝。
4. 分享期间打开 DevTools 导致 debugger 冲突 → action 明确失败并提示恢复方式。
5. 解绑 → 扩展收到 detach projection，debugger 释放，后续 action 失败。

## 未决问题

- 需用户确认推荐严格模式是否保留为“逐次确认”；若用户要求真正只读，应另行定义 action immediate rejection，不能与本计划混为一谈。
- UI HTML 原型必须由 `ui-designer` 交付并获批。
