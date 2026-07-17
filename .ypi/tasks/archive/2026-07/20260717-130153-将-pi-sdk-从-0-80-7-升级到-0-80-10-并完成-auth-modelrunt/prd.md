# PRD：pi SDK 0.80.10 兼容升级

## 目标与背景

Pi SDK 0.80.8 将模型目录与 provider 鉴权统一到 `ModelRuntime`，并撤销 coding-agent root 对 `AuthStorage` 的公开导出。当前项目仍深度依赖 0.80.7 的 `AuthStorage`、`ModelRegistry.create()`、`services.modelRegistry/services.authStorage`，仅修改版本会造成编译失败，并可能在运行时丢失固定 provider、Active 凭据或 live session 鉴权。

本任务要以一次原子升级完成 SDK 版本、Web credential adapter、所有运行入口及回归测试迁移。

## 用户价值

- 用户可继续使用已有 `auth.json`、OAuth/API-key 多账号和历史会话，无需重新配置。
- Chat 与 Studio child 获得 0.80.10 的 Kimi/xAI/Grok 模型目录与 thinking 修复。
- Active 切号、quota/failover 与 live session reload 在新 SDK 下保持可靠。
- 后续 Pi SDK 迭代以公开 `CredentialStore` / `ModelRuntime` 接口为边界，不再被私有 AuthStorage 生命周期阻塞。

## 范围内需求与验收标准

### R1. 依赖原子升级

- 三个 Pi 核心包在 `package.json` 中均为 exact `0.80.10`。
- `package-lock.json` 与 `npm-shrinkwrap.json` 由 npm 正常生成，根依赖与解析树一致。
- 不保留 0.80.7/0.80.8/0.80.9 的直接核心包解析项；第三方 provider 版本保持不变。

### R2. Web CredentialStore

- 新增应用自管、实现 pi-ai `CredentialStore` 的 file-backed store，并提供内存 store 路径供“添加账号但不激活”登录使用。
- `read/list/modify/delete` 为异步公开契约；`modify` 是唯一更新路径，`delete` 是删除路径。
- `modify/delete` 在同一全局 auth 文件锁下重新读取整份 JSON，原子写回且保持目录 `0700` / 文件 `0600`；不同 provider 并发不得互相覆盖。
- OAuth credential 的 provider-specific 附加字段完整保留；API-key credential 保持现有 literal、`$ENV`/`${ENV}`、escape 与 `!command` 解析语义，`list()` 不执行命令、不返回 secret。
- JSON 损坏、锁超时或写入失败必须拒绝操作且不覆盖原文件；错误不得携带 secret。

### R3. Provider-aware ModelRuntime

- 提供统一 `createWebModelRuntime()` 与管理路径 `getWebModelRuntime()`；默认绑定 Web CredentialStore、`auth.json`、`models.json`。
- 管理型 fixed-provider runtime 可按 agentDir/modelsPath 复用；main/Studio 会话 runtime 必须按 service/session 隔离，避免 cwd extension provider 跨会话泄漏。
- 提供 canonical Web services helper，将 Grok → Kiro → Antigravity 与 caller extras 一次性传入 `createAgentSessionServices`，确保注册落到目标 runtime。
- 自定义 `modelsPath`（Models Config test、模型价格验证）必须创建隔离 runtime，不能污染默认缓存。
- 业务路径不再依赖进程全局副作用来“bootstrap”另一个 runtime。

### R4. Session 与 live reload

- main Chat 使用 `createAgentSessionServices` + `createAgentSessionFromServices`，并把 YPI Studio / Browser Share extras 注入同一 service/runtime；单 wrapper、start lock、fork 销毁等现有不变量不变。
- `AgentSessionLike` 暴露 `modelRuntime` 最小接口，模型切换改用 `getModel()`。
- `reloadRpcAuthState()` 变为可等待的异步操作：对每个 live wrapper 执行 runtime offline refresh，按相同 provider/id 替换模型描述，不调用 `setModel()`、不写 `model_change/settings.json`，最后清理 provider session resources。
- 所有调用方 await reload；单 wrapper 失败隔离，其他 wrapper 与新 session 不受阻断。
- Studio SDK child 使用同一 Web services helper 与 `services.modelRuntime`，保留独立 child session id/request affinity。

### R5. Auth、多账号与 quota

- OAuth login 使用 `ModelRuntime.login(provider, "oauth", interaction)`；现有 SSE `auth/device_code/prompt/select/progress/success/error` wire 行为保持兼容。
- `accountMode=add` 使用隔离内存 credential store，保存账号但不替换 Active；普通 login 持久化到 `auth.json` 并同步 managed account metadata。
- logout 使用 `ModelRuntime.logout()`；provider/status API 使用 runtime providers/auth status，不再调用 `getOAuthProviders/has`。
- OAuth/API-key Activate、refresh CAS、single-key POST/DELETE、legacy key import均改用 Web CredentialStore，保留 managed-account store 与 Active mirror 规则。
- OpenAI quota、DeepSeek balance、assist/model test 的请求鉴权使用 `ModelRuntime.getAuth()` 或 runtime completion，不手工复刻 header 合并。
- Grok/Kiro/Antigravity 的 quota/failover/token refresh、安全投影、锁与 retry budget 不改变。

### R6. Models、价格与 assist

- Models/API-key provider 列表改用 `ModelRuntime.getModels/getModel/getProviders/getProviderAuthStatus`。
- terminal env、Trellis workflow、model-price suggestion 等 assistant 路径使用 `ModelRuntime.getAuth()`/runtime completion。
- 模型价格读取与写后验证接受 ModelRuntime 或项目最小 catalog 接口；不得通过 `ModelRegistry.create()` 构造 registry。
- Models Config test 使用临时 modelsPath 的隔离 runtime，超时和响应格式不变。

### R7. 兼容、测试与文档

- 更新所有对 `AuthStorage`、`ModelRegistry.create`、旧 services 字段做源码字符串断言的测试；新增 CredentialStore 并发/权限/损坏保护/config-value 测试。
- Provider public extension、jiti external、Antigravity callback loopback、Active mirror CAS 与 secret/no-store 测试继续通过。
- 更新 integrations、architecture、library、API 与 troubleshooting 文档，移除“0.80.8+ 尚不可升级”和 bare ModelRegistry bootstrap 指引。

## 范围外

- 前端新增控件、页面布局、登录流程改版或文案重设计。
- 第三方 provider 包升级。
- auth/session/account store 数据迁移。
- 增加 xAI 自动 failover、修改现有 quota 口径或手工补回上游删除模型。
- 发布与 Git 提交操作。

## UAT 验收

1. 新 Chat 与历史 Session 均能续聊；模型切换仅影响当前 session。
2. OpenAI Codex、Grok、Kiro、Antigravity 可列出 provider，登录/add/Activate/logout 后 live session 下一请求使用新 Active。
3. OpenCode Go/xAI managed key 与普通 single-key provider 的增删改查/Active mirror 不退化。
4. 各 provider quota 与 enabled failover 路径仍工作，响应不含 token/account secret/projectId/path。
5. Models 列表、模型配置测试、价格读取/写后验证和 assist routes 可用。
6. YPI Studio SDK child 可创建、选择策略模型、发送请求并写入 child audit session。
7. 历史 JSONL、账户文件和 usage ledger 无批量改写。

## 未决问题

无产品未决问题。默认批准项为：接受 0.80.10 上游模型目录的自然变化；不为目录变化增加自定义 UI 或兼容模型。