# Design — Browser Share 全自动权限语义

## 方案摘要

保留现有 wire 类型与 approval 协议，最小化协议迁移：

- `interactive` 重新定义为 **full auto**：四类命令直接 `queued`。
- `readonly` 作为兼容严格模式：四类命令保持 `pending_approval`。
- 新分享缺省模式改为 `interactive`；新版 Chrome 扩展默认创建 `interactive` 分享。
- API health 增加版本化 full-auto capability，防止新版扩展连接旧 Web 后作出错误承诺。
- 既有 `pending_approval`、approval API、`rejected`、`timeout` 全部保留。

这是行为语义调整，不增加 action 类型、远控入口或 tab 范围。

## AS-IS

```text
extension create share
  permission omitted/readonly -> readonly
  permission interactive       -> interactive

manager.enqueueCommand
  readonly    -> every command pending_approval
  interactive -> type/navigate pending_approval
                 click/scroll queued

agent tool waits <=90s
  hidden ypi panel approval absent -> timeout
```

UI 与扩展文案分别维护模式解释，存在多处重复映射。

## TO-BE

```text
user chooses mode (default Full Auto)
  -> extension verifies web capability when Full Auto
  -> create share (interactive | readonly)
  -> user binds one-time code to session A
  -> manager operator projection is authoritative

interactive/full auto:
  click/type/scroll/navigate -> queued -> extension long-poll -> running -> terminal

readonly/strict:
  all action -> pending_approval -> approve queued OR reject terminal
```

## 影响模块与边界

### ypi web

| 模块 | 设计改动 |
| --- | --- |
| `lib/browser-share-manager.ts` | 统一权限策略；缺省 interactive；集中 action payload 校验；operator 与 enqueue 共用策略。 |
| `lib/browser-share-types.ts` | 保留 enum/status；必要时只增加 capability 类型说明，不删除字段。 |
| `app/api/browser-share/health/route.ts` | version/capability 增量声明 full-auto semantics。 |
| `components/BrowserShareControl.tsx` | 产品文案改为「全自动 / 每次确认」；全自动强调 session/tab 范围；严格模式保留审批卡。 |
| `lib/browser-share-extension.ts` | tool prompt/guidelines/description 不再声称 type/navigate 审批；强调 bound session 全自动与 debugger fail-safe。 |
| `app/api/browser-share/**` | 路由形状不变；modules docs 更新语义。 |
| `scripts/test-browser-share-policy.mjs` | focused policy、校验、隔离、approval/timeout/lifecycle 回归。 |

### 外部 Chrome 扩展

| 模块 | 设计改动 |
| --- | --- |
| `src/popup/popup.html/.css/.js` | 默认全自动模式选择；完整状态与严格模式 UI；不再用“允许操作但高风险仍确认”。 |
| `src/service-worker/service-worker.js` | 全自动 capability handshake；本地 pending operator 映射与服务端一致；仍只执行 poll 返回的 queued 命令。 |
| `README.md` / `INSTALL.md` | 默认行为、严格模式、升级要求与安全边界。 |
| `scripts/validate.mjs` | 校验默认模式控件、capability 检查和关键文案/文件存在。 |

## 权限策略契约

建议在 manager 内用一个纯策略函数（命名可按附近代码调整）集中表达：

```ts
type BrowserShareCommandPolicy = {
  initialStatus: "pending_approval" | "queued";
  requiresApproval: boolean;
};

policy("interactive", anyCommand)
  => { initialStatus: "queued", requiresApproval: false }

policy("readonly", anyCommand)
  => { initialStatus: "pending_approval", requiresApproval: true }
```

`operatorForShare()` 和 `enqueueCommand()` 必须调用同一策略，避免 UI/API 声称自动但队列仍等待审批。

### 缺省解析

当前实现只有显式 `interactive` 才进入 interactive；建议改为只有显式 `readonly` 才进入严格模式：

```ts
permissionMode: request.permissionMode === "readonly" ? "readonly" : "interactive"
```

这样省略字段的新客户端符合产品默认；运行时未知值也不会意外落入隐藏审批。路由仍由 TS 类型与服务端 sanitizer 约束。

## 命令输入校验

取消逐次审批后，必须把现有 tool-side 校验提升为 manager/API 共同边界，避免直接调用 commands API 绕过：

- `click`：非空 `elementId`。
- `type`：非空 `elementId`，文本为非空字符串；长度仍由 manager clamp。
- `scroll`：提供值必须 finite；保留默认 delta 由 tool 或 manager 决定，不能接受 NaN/Infinity。
- `navigate`：URL 可解析且协议仅 `http:` / `https:`；进入队列前规范化。

扩展执行侧继续以最新 snapshot 查 element，并拒绝 `isSensitive=true`。不把 approval 当作输入验证替代品。

## API / Wire 契约

### 保持不变

- `BrowserSharePermissionMode = "readonly" | "interactive"`
- action 类型、command status、approval/result 路由与请求/响应形状。
- `autoAllowedCommands` / `approvalRequiredCommands` 字段。
- `GET shares/[shareId]/commands` 只返回 queued，不返回 pending approval。

### 增量 capability

`GET /api/browser-share/health` 建议升级到 version 4，并新增：

```json
{
  "capabilities": {
    "fullAutoInteractive": true,
    "permissionSemantics": "interactive_full_auto_v1"
  }
}
```

字段可二选一或同时提供；实现与文档需统一。推荐同时提供 boolean（简单判断）与 token（未来演进）。

新版扩展规则：

- 选择全自动：health 必须声明 capability，否则阻止创建并提示升级 ypi web。
- 选择严格：仅要求现有 persistent debugger capability；可继续连接旧 Web。

### operator 投影

| 模式 | `canOperate`（已绑定） | `autoAllowedCommands` | `approvalRequiredCommands` |
| --- | --- | --- | --- |
| interactive | true | click,type,scroll,navigate | [] |
| readonly | true | [] | click,type,scroll,navigate |
| tombstone/unbound | false | [] | [] |

`canOperate` 表示存在受控 action 路径，不代表无需审批；具体看两个 command arrays。

## UI 信息架构

UI 原型门禁覆盖两个表面：

1. Chrome extension 创建分享：模式选择 + 授权说明。
2. ypi `BrowserShareControl` 绑定后状态：当前 tab/session、模式、自动/需确认命令、debugger/connection、执行中与最近操作。

推荐产品文案：

- `interactive` → **全自动**，副文案：“绑定后，Agent 可自动点击、输入、滚动和导航当前共享标签页，直到停止或解绑。”
- `readonly` → **每次确认**，副文案：“所有操作会等待你在 ypi Browser Share 面板确认。”

不要在主 UI 显示 `interactive` / `readonly`；可在诊断 tooltip 或 raw API 中保留。

## 数据流与生命周期

1. popup 获取 health，确认地址与 capability。
2. 用户创建分享；extension attach 当前 `tabId` debugger，并 POST share。
3. server 创建短期 share code，permission mode 固定在 share record。
4. 用户在 session A bind；server 建立 `sessionBindings[A] = shareId`。
5. agent tool 从 `ExtensionContext` 取 A，preflight debugger，enqueue。
6. full auto 直接 queued；strict 等 approval。
7. extension 按 shareId long-poll 只取得 queued，并只对 `activeShare.tabId` 执行。
8. result 进入 terminal；waiter 被唤醒。
9. unbind/replace/stop/tab close/not_found 仍 detach 并失败活动命令。

## 兼容性与迁移

- 无磁盘迁移；现有 share/commands 仅进程内存。
- 部署时在途 command 保持创建时 status，不批量重写。
- 新 Web + 旧扩展：旧扩展显式发送的模式仍被接受；其 UI 默认可能仍是严格，文档要求更新扩展才能获得默认全自动。
- 新扩展 + 旧 Web：capability handshake 阻止“假全自动”；严格模式可兼容。
- approval 路由不能删除，因为 strict、旧客户端与在途 pending command 仍依赖。

## 安全边界

保持：

- 用户必须主动在 extension 分享一个 tab，并在目标 session 使用单次短码绑定。
- agent tools 不接受 shareId；server command 关联 sessionId + shareId。
- extension 只使用保存的 `activeShare.tabId`，不执行其他 tab。
- persistent debugger 缺失时 fail-safe；不回退 action。
- snapshot 脱敏、敏感字段拒绝、http(s) navigate、长度/数量限制不变。
- 非 loopback base URL 的 Chrome host permission 与安全提示不变。

新增重点：集中 action payload 校验，因为 full auto 不再有人工审批作为最后一道偶然屏障。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 全自动误操作风险提升 | 绑定即授权文案、默认只限一个 tab/session、持续 debugger/badge 信号、显式 stop/unbind。 |
| UI 与 manager 映射漂移 | 单一 policy helper + operator focused tests；UI读取 operator arrays。 |
| 新扩展连接旧 Web 仍审批 | health capability handshake，full auto fail closed。 |
| 旧扩展默认严格导致用户仍被拦截 | 发布说明明确扩展需更新；新 Web 不能无视用户显式 readonly。 |
| 直接 commands API 绕过 tool 校验 | manager 集中校验所有 caller。 |
| `readonly` 名称与实际逐次确认不一致 | 仅保留 wire 名称；产品 UI 显示「每次确认」。 |
| extension repo 跨仓库遗漏 | 独立子任务、独立验证、handoff 列出双仓改动。 |
| extension offline 仍会 timeout | 文案明确“零审批 ≠ 零执行故障”；保留 timeout。 |

## 回滚

- Web 回滚：恢复 `interactive` 对 type/navigate 审批与旧 health capability；不删除新测试前先同步预期。
- Extension 回滚：恢复旧模式 UI/default，但必须同时撤销 full-auto 宣称。
- approval/status 协议始终保留，因此回滚无需迁移命令记录。
- 若仅一侧回滚，capability handshake 应阻止错误全自动承诺。
