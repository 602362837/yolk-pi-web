# PRD：Grok CLI 指定账号重新登录

## 1. 目标与用户价值

当 Grok saved account 的 refresh/access credential 已撤销、过期且无法刷新，或 billing 明确返回需重新认证时，用户可以在 Models → Grok 对该账号原位重新授权，保留账号管理信息和 Active 关系，不必添加重复账号、删除旧账号或猜测当前请求使用哪份凭据。

## 2. 产品原则

1. **重新登录不是添加账号**：目标是替换选中 storage slot 的 secret credential。
2. **明确指定账号**：不得用“当前 provider”隐式猜测目标。
3. **成功前零影响**：OAuth 完成并通过 credential 校验前，不改账号文件、metadata、Active mirror 或 live runtime。
4. **Active 语义不变**：非 Active 不得抢占 Active；Active 成功后仍是 Active。
5. **不伪造身份校验**：xAI 未提供稳定公开 account id，UI 只承诺替换槽位，不承诺仍是同一远端身份。
6. **安全投影**：浏览器只接收 opaque id、账号摘要和固定错误；不返回 token、callback code、raw upstream body、URL 或路径。

## 3. 用户故事

- 作为拥有一个失效 Active Grok 账号的用户，我能看到“需要重新登录”，点击后重新授权该账号，并继续在所有会话的后续请求中使用它。
- 作为拥有多个 Grok 账号的用户，我能重新登录一个非 Active 备用账号，而不改变当前 Active。
- 作为从顶部 Grok 用量面板发现失效的用户，我能直接进入 Models → Grok 对应账号，而不是打开无上下文的 Models 首页。
- 作为误点或授权失败的用户，我能取消并确认原账号凭据和 Active 状态未变化。

## 4. 功能需求与验收标准

### R1. 恢复已有 managed provider

当 `/api/auth/providers` 返回 `grok-cli` 的 `loggedIn=false` 但 `accountCount>0` 时，Models 仍应把 Grok 作为已有订阅/账号管理项展示，而不是只作为“添加 provider”。

**验收：**
- 左侧可进入 Grok 账号详情。
- 顶部状态区表达“已保存账号，但当前凭据需恢复/未连接”，不误称没有账号。
- `GROK_CLI_OAUTH_TOKEN` 单独配置且没有 saved account 时，不伪造可重新登录的槽位。

### R2. 失效检测与展示

存在 saved account 时，Models 的 Grok quota 加载不再仅依赖 `provider.loggedIn`；选择账号后可消费 `GrokQuotaResultV1.reauthRequired`。

**验收：**
- `reauthRequired=true` 时 `GrokQuotaView` 显示危险状态、目标账号摘要和明确 CTA。
- HTTP 401 响应中的安全 quota JSON 仍被解析，不因 `res.ok=false` 丢失 reauth 投影。
- stale quota 可保留展示，但必须同时说明缓存过期和需重新登录；不得把旧额度当作新账号实时额度。

### R3. 账号级重新登录入口

每个 Grok saved-account 行均可触发“重新登录”；当前选中账号的 reauth banner 也可触发同一流程。

**验收：**
- 入口总是携带明确 opaque target account id。
- Kiro、Antigravity、Codex 行不因本任务出现未批准的新入口。
- 正在 Activate、delete、quota refresh 或 reauth 的冲突操作被禁用，且有非颜色状态文案。

### R4. 重新登录确认

开始 OAuth 前显示目标账号与影响说明。

**验收：**
- Active 账号：说明成功后仍为全局 Active，并影响当前/新会话后续请求。
- 非 Active 账号：说明不会改变全局 Active。
- 明确提示浏览器中确认使用正确 xAI 账号；系统无法可靠校验与旧账号是否同一远端身份。
- 取消不会发起 SSE login。

### R5. 登录方式

重新登录支持现有 Grok 三种方式：Browser PKCE、Device Code、读取现有 Grok Build 登录。

**验收：**
- UI 方法映射到上游 id `browser | device | existing`。
- 选定方式后自动回答上游 `select_request`；若上游 options 不匹配则安全退回通用选择 UI，而不是提交未知值。
- 取消/组件卸载/provider 切换关闭 EventSource 并清理 pending input。

### R6. API 契约

扩展现有 `GET /api/auth/login/[provider]`：P0 支持 `accountMode=reauth&accountId=<opaque-id>`，仅允许 provider `grok-cli`。

**验收：**
- `accountMode=reauth` 缺少 accountId、provider 非 Grok、目标不存在/已删除均 fail closed。
- `accountId` 在 OAuth 开始前校验，并在提交时再次校验；不能路径穿越或跨 provider。
- reauth 与 add 都使用 isolated in-memory CredentialStore；OAuth 未成功时不改 Active。
- SSE success 只返回安全账号摘要/固定消息；错误使用稳定安全文案。
- 现有无 mode 登录和 `accountMode=add` 保持兼容。

### R7. 原位替换

OAuth 成功后，替换目标账号槽位的 credential。

**验收：**
- 保留 opaque `accountId`、`label`、`extraInfo`、`createdAt`、`lastActivatedAt` 和 target 的 Active 状态。
- 更新 `updatedAt` 与根据新 credential 派生的安全 masked diagnostic id。
- 不创建第三个重复 slot，不移动 Session JSONL，不更改其他 provider 数据。
- 写入保持目录 `0700`、credential/metadata `0600`，使用 atomic replace；失败尽可能回滚且不记录 secret。

### R8. Active 与 live reload

**验收：**
- 非 Active target：`auth.json[grok-cli]` 和当前 Active id 完全不变，不调用不必要的 live auth reload。
- Active target：在成功提交后镜像新 credential 到 `auth.json`，Active id 不变，并 `await reloadRpcAuthState()`。
- 已发出的请求不被中断；后续请求读取新 Active credential。

### R9. 并发与旧数据隔离

**验收：**
- Grok token refresh、Activate、reauth 使用同一 provider/account coordination boundary，旧 refresh 不能在 reauth 后覆盖新 credential。
- reauth 成功后清除该 storage id 的内存和持久化 quota cache；旧 in-flight quota 结果不得重新写回。
- 第一次新 quota 查询失败时显示“无新额度/需重试”，不得回退展示重新登录前账号的 stale quota。

### R10. 成功与失败反馈

**验收：**
- 成功：保留/重新选中目标账号，刷新 accounts/provider status，并强刷该账号 quota。
- Active 成功文案包含“已更新全局 Active 凭据”；非 Active 成功文案包含“未改变全局 Active”。
- 取消：回到账号管理，无错误 banner。
- 失败：展示固定、可重试、无 secret 的错误；保留原账号及其 Active 状态。
- 目标在授权期间被删除：提示账号不存在/已变化，不重新创建。

### R11. Top-bar 恢复路径

**验收：**
- Grok usage standalone/aggregate 在 `reauthRequired` 时保留“在 Models → Grok 重新登录”。
- 点击后打开 Models 并聚焦 `grok-cli`；有安全 target account id 时选中该账号。
- 不从 hover/focus panel 直接自动打开外部 OAuth 页面。

### R12. 可访问性与响应式

**验收：**
- 确认 dialog、方法按钮、取消、重试、账号行 CTA 可键盘操作，具备可识别名称和 `focus-visible`。
- 状态变化使用 `role=status/alert` 或等价语义，不只依赖红/绿颜色。
- 375px 下账号操作不横向溢出或压缩为不可识别文本；长账号名省略但可读取完整 title。
- `prefers-reduced-motion` 下不依赖动画表达进度。

## 5. 非功能需求

- 不直接导入 `pi-grok-cli/src/**`；继续通过固定 provider runtime/jiti 边界。
- 不把 `accountId` 当文件路径；所有存储仍通过 OAuth account store。
- API/SSE 响应 `Cache-Control` 保持 OAuth/no-cache 语义，不写浏览器缓存。
- 不新增配置字段和数据迁移。
- 文档必须说明 slot replacement 与身份不可验证边界。

## 6. 范围外

- 自动判断“哪个账号失效”并批量 reauth。
- 自动删除失效账号或自动切换账号。
- 统一所有 OAuth provider 的 reauth UI/API。
- 远端 revoke、账号合并、撤销恢复、credential 历史版本 UI。

## 7. 未决/需审批决策

1. **推荐：账号槽位原位替换。** 若产品只想支持“重新登录当前 Active”，实现会更小，但非 Active 备用账号仍无法修复，且账号管理语义不完整。
2. **推荐：允许用户用另一 xAI 身份替换槽位，但必须明确警告。** 若要求强制同身份，当前上游 credential 缺少可靠稳定 id，需求会被外部能力阻塞。
3. **推荐：Top-bar 仅深链 Models，不直接启动 OAuth。** 这样避免 hover panel 误触、先让用户确认目标账号和影响。
4. **推荐：P0 只开放 Grok。** 公共 store primitive 可复用，但 API allowlist 不提前开放 Kiro/Antigravity。
