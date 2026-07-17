# Brief：接入 Antigravity 提供商并支持多账号额度与自动切号

## 目标

在不改变现有 GPT、Grok、Kiro、OpenCode Go 与 Pi native 行为的前提下，为 yolk-pi-web 固定接入 Google Antigravity provider，并补齐与 Grok/Kiro 对齐的 Web 能力：

1. 固定依赖 `@yofriadi/pi-antigravity-oauth@0.3.0`，让主 Chat、Studio SDK child、Models/Auth、Skills/Commands、assistant routes 与裸 ModelRegistry 都能发现 `google-antigravity` 模型。
2. 复用 Web 的 opaque OAuth account store，实现多账号、全局 Active、refresh/Activate 竞态保护与安全投影。
3. Web 自研 `fetchAvailableModels` quota client，展示每模型 `remainingFraction` / `resetTime`，并为自动切号提供 fail-closed 证据。
4. 新增默认关闭的 Antigravity 独立 Path B controller，只在明确额度/限流语义下切换全局 Active，同一 turn 最多一次切号与一次重试。
5. 将 Antigravity 纳入现有 Full / Compact / Aggregate 顶栏契约；不引入第二套额度布局或跨 provider 总额度。

## 已确认方案

- Provider 核心固定为 `@yofriadi/pi-antigravity-oauth@0.3.0`；只使用公开 default Pi extension 所注册的 OAuth、model catalog 与 `streamSimple`。
- 源码包通过 `jiti` 动态加载，并加入 Next `serverExternalPackages`；禁止从应用代码静态 import 包内 `src/**`。
- Provider ID 固定为包注册值 `google-antigravity`。
- 不引入 `pi-antigravity-rotator` 作为依赖、代理、账号系统或 `auth.json` 写入者；它只作为 quota 协议研究证据。
- 多账号继续使用 `lib/oauth-accounts.ts` 的 opaque store；token、refresh、projectId 不进入 DOM、SSE、日志或 metadata-only `accounts.json`。
- 自动切号采用独立 Path B controller，默认关闭；unknown/stale/reauth/project-invalid candidate 一律 fail-closed。

## 审计证据

### Provider 包 `0.3.0`

通过临时 `npm pack` 检查发布物：

- 默认 extension 调用 `registerProvider("google-antigravity", …)`；OAuth 凭据 shape 为 `access`、`refresh`、`expires`、`projectId`，可带 `email`。
- `getApiKey()` 返回 JSON 字符串 `{ token, projectId }`，stream adapter在服务端解析；因此 `projectId` 与 token 都必须按 secret 边界处理。
- model catalog含 Gemini、Claude、GPT-OSS 等 Antigravity 模型，公开 model id 与部分请求/配额 model key并不完全相同。
- 包是 TypeScript 源码发布物；依赖 `@google/genai@1.52.0`，peer Pi范围为 `*`，Node 要求 `>=22.19.0`。当前运行时 Node `v26.0.0` 满足要求。
- 登录使用 `http://localhost:51121/oauth-callback`，但 `server.listen(port, CALLBACK_HOST)` 在 `PI_OAUTH_CALLBACK_HOST` 未设置时可能绑定非 loopback。集成必须在首次 jiti import前把该包的 callback host固定为 `127.0.0.1`；Web保留手工粘贴 redirect URL作为远程访问降级。
- project discovery尝试 Google Cloud Code endpoint，失败后回退 `rising-fact-p41fc`。该默认 project只能作为凭据字段，不能被当作账号健康或 failover可用证明。

### Quota 证据

研究参考实现确认协议为：

```http
POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
Authorization: Bearer <access>
Content-Type: application/json
User-Agent: antigravity/<fixed-version> darwin/arm64

{"project":"<projectId>"}
```

安全可用响应字段仅需：

```json
{
  "models": {
    "<model-key>": {
      "quotaInfo": {
        "remainingFraction": 0.42,
        "resetTime": "2026-07-16T12:34:56Z"
      }
    }
  }
}
```

`remainingFraction` 是剩余比例，不是已用比例；UI使用率必须按 `100 × (1 - remainingFraction)` 计算。`resetTime` 是重置时刻，不能被共享 N-ring projector当作窗口时长或径向顺序证据。

## 推荐设计决策

1. **Quota endpoint首版只使用固定 primary host** `daily-cloudcode-pa.googleapis.com`；不接受 credential URL，不做未验证 host猜测。失败时使用 stale/unavailable降级。
2. **自动切号必须 model-aware**：候选账号必须对当前 Antigravity模型有 fresh/live、可识别且 `remainingFraction > 0` 的额度。公开 model id到 quota key的映射由 Web 维护为固定 `0.3.0` 兼容表并由 contract test审计；无法映射时不切号。
3. **顶栏不制造跨模型总额度**：quota详情列出所有安全模型窗口；只有一个可安全投影的独立 quota窗口时显示单 ring。多窗口缺少可信 duration时交给共享 projector detail-only降级，trigger显示“多模型/详情”，不按 resetTime、数组顺序或剩余比例排序。
4. **Antigravity位于 failover外层**：建议链为 Antigravity → Kiro → Grok → OpenCode Go → ChatGPT → Pi native。provider不匹配时完全 passthrough，因此不改变既有 controller语义。
5. **OAuth登录使用现有 SSE/manual callback UI**；不复制第三方账号系统，不接受 credential JSON import。

## 风险摘要

- 非官方 Cloud Code/Antigravity通道，可能被 Google 改动或限制；不是官方稳定 SLA。
- OAuth scope较宽，包含 `cloud-platform`；包使用硬编码官方 IDE OAuth client并模拟 Antigravity UA。
- callback host若不固定会扩大本机监听面；必须强制 loopback。
- 默认 project fallback可能登录成功但推理/quota不可用；必须以 live quota/真实请求为健康证据。
- quota按模型返回，不能用任意一个模型的剩余额度证明当前模型可用。
- package内部错误可能包含 raw upstream body；Web API/SSE必须按固定错误码重写，不得透传。

## 当前门禁与阻塞

本任务明确涉及 Models账号管理、Settings开关、顶栏 standalone/compact/aggregate和用户可见 failover提示，触发 UI HTML原型硬门禁。

当前 delegated architect会话没有 `ypi_studio_subagent` / Studio transition工具，无法合法派发 `ui-designer`、保存 task-level `implementationPlan` 或 transition到 `awaiting_approval`。不得直接编辑 `task.json`、伪造 UI设计员身份或用架构师自制 HTML冒充门禁产物。主会话需派发 UI设计员完成 [ui.md](./ui.md) 中的原型任务后，再由架构师收口并请求用户审批。
