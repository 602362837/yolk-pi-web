# Brief：Kiro 提供商、多账号额度与顶部简要显示

## 目标

在不改变 ChatGPT 生产切号逻辑、Grok 既有语义和 Session 生命周期约束的前提下：

1. 固定接入 `pi-kiro-provider@0.2.2`，让 Web、主 Chat、Studio child、Models/Auth 和辅助模型入口都能发现 `kiro` provider，完成 Builder ID / Google / GitHub OAuth 登录及 Kiro 模型对话。
2. 为 Kiro 增加 Grok Path B 同等级的 OAuth 多账号、全局 Active、额度查询和明确限额/限流后的同 turn 单次切号重试。
3. 为 GPT、Grok、Kiro 顶部额度入口增加一个全局「简要显示」设置；简要态只显示提供商与关键额度摘要，点击仍打开现有详细面板。

## 已验证证据

### `pi-kiro-provider@0.2.2`

已通过 `npm pack pi-kiro-provider@0.2.2` 检查发布物：

- Provider ID 为 `kiro`；默认 export 是 Pi extension factory，同时调用 `registerProvider` 与 `registerOAuthProvider`。
- OAuth 支持 `builder-id`、`google`、`github`；凭据包含 `access`、`refresh`、`expires`，Builder ID 还可能包含 `clientId`、`clientSecret`、`region`，社交登录可能包含 `profileArn`、`authMethod`、`provider`。
- 包入口为 TypeScript 源码（`index.ts`），内部使用 ESM 风格 `.js` 相对 import；与当前 `pi-grok-cli` 一样不能交给 Next/Turbopack 静态展开，必须 `jiti` 异步加载并加入 `serverExternalPackages`。
- peer range包含 Pi `^0.80.0`，与项目 `^0.80.7` 兼容。
- Streaming `meteringEvent` 只包含单次请求 `usage/unit`，不能单独推导订阅总额、剩余额度或重置时间。
- 上游会保留 `KiroAuthFailureMetadata`，其中 403 可区分 `quota_or_entitlement`；AWS streaming schema还定义了 `MONTHLY_REQUEST_COUNT`、`OVERAGE_REQUEST_LIMIT_EXCEEDED`、`CONVERSATION_LIMIT_EXCEEDED`、`DAILY_REQUEST_COUNT` 和 `INSUFFICIENT_MODEL_CAPACITY` 等原因，可用于保守 classifier。

### Kiro / CodeWhisperer 额度数据源

已找到可用且比“占位额度”更可靠的数据源：AWS 官方开源 `amazon-q-developer-cli` 仓库生成的非 streaming client包含 `GetUsageLimits` operation：

- Endpoint：`https://q.<region>.amazonaws.com/`
- `X-Amz-Target`：`AmazonCodeWhispererService.GetUsageLimits`
- Bearer OAuth；POST `application/x-amz-json-1.0`
- 官方 input字段：`profileArn`、`origin`、`resourceType`、`isEmailRequired`
- 官方 output字段：`usageBreakdownList` / `usageBreakdown`、`currentUsage*`、`usageLimit*`、`nextDateReset`、`subscriptionInfo` 等。

同一作者的 `pi-multi-auth` 已实现 Kiro usage provider，使用上述 endpoint/target并投影 `currentUsage`、`usageLimit`、reset和 plan；这证明额度能力不是臆造的私有路径。设计仍要求 Web 自己实现严格 parser/cache，不能依赖 `pi-kiro-provider` 私有源文件，也不能把 raw payload、用户信息、token、profile ARN 或 upstream body返回浏览器。

### 本项目现状

- Provider bootstrap集中在 `lib/pi-provider-extensions.ts`，但命名和部分直接 call site仍为 Grok-only。
- `lib/oauth-accounts.ts` 是可复用的 opaque storage id + 独立 `0600` secret + active mirror 存储层；adapter目前只有 `openai-codex`、`grok-cli`。
- Grok failover是独立 Path B controller，RPC 顺序为 Grok → OpenCode Go → ChatGPT → Pi native。
- 顶栏现有 `ChatGptUsagePanel`、`GrokUsagePanel`；开关分别位于 `chatgpt.usagePanelEnabled`、`grok.usagePanelEnabled`。

## 推荐决策

1. **依赖版本固定 `pi-kiro-provider@0.2.2`（package.json 可用 caret），首轮不追未验证最新版。**
2. **额度采用 AWS `GetUsageLimits`，不把 per-turn `meteringEvent` 冒充订阅额度。** 若某账号 endpoint返回不支持/无可解析 bucket，UI 明确显示「额度暂不可用」，自动切号候选选择 fail-closed，不盲切未知账号。
3. **全局简要模式**：新增 `usage.providerPanelsCompact`，默认 `false`；统一影响 GPT、Grok、Kiro，避免三个 provider各自漂移。各 provider 的 `usagePanelEnabled` 仍分别控制是否显示。
4. **简要模式只压缩顶部 trigger，不删除详细 popover。** 简要 trigger为“提供商 + 最多两个关键额度数字”；加载/无账号/失效/未知时显示短状态。点击仍可刷新、切账号、进入 Models。
5. **Kiro 使用独立 Path B controller**，放在 Grok 外层；只对明确 quota/rate-limit reason触发，网络、timeout、5xx、认证、上下文、内容、模型错误以及 `INSUFFICIENT_MODEL_CAPACITY` 均不触发。
6. **Kiro 全局 Active语义与 Grok 对齐**：手动 Activate不是锁；切换影响所有普通 live/new Session 的后续请求，in-flight 不变；每 turn最多一次实际切号和一次重试。

## 阻塞状态

本任务触发 UI HTML 原型硬门禁。当前 delegated architect会话没有 `ypi_studio_subagent` / Studio transition工具，无法合法派发 `ui-designer`、保存 task-level implementationPlan 或 transition 到 `awaiting_approval`。不得通过直接编辑 `task.json` 或伪造原型/审批记录绕过。主会话需派发 UI 设计员后继续审批流程。
