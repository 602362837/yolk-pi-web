# Brief：pi SDK 0.80.10 与 Auth / ModelRuntime 迁移

## 任务目标

将 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` 从 exact pin `0.80.7` **整体升级到 exact pin `0.80.10`**，完成 0.80.8 引入的 Auth / ModelRuntime 破坏性迁移，并保持 yolk-pi-web 的 Chat、Models/Auth API、多账号 Active 镜像、quota/failover、模型价格和 YPI Studio SDK child 行为不退化。

## 已核验证据

- `package.json`、`package-lock.json`、`npm-shrinkwrap.json` 当前三项 Pi SDK 均锁定 `0.80.7`。
- 本地 `/tmp/pi-sdk-compare` 的 `0.80.10` 发布物与 CHANGELOG 证明：
  - `AuthStorage` 不再从 package root 导出；公开边界改为 pi-ai `CredentialStore`（`read/list/modify/delete`）与一次性 `readStoredCredential()`。
  - `createAgentSessionServices` / `AgentSessionServices` / `AgentSession` 改用 `modelRuntime`。
  - `ModelRegistry` 仅保留 extension 同步 facade：`new ModelRegistry(runtime)`；不存在 `ModelRegistry.create()` 或 `authStorage` 字段，`refresh()` 变为异步。
  - 应用侧请求鉴权应使用 `ModelRuntime.getAuth(provider|model)`。
  - 0.80.9/0.80.10 同时带来 Kimi thinking、xAI 默认 Grok 4.5 与模型目录修复；目标不能停在 0.80.8/0.80.9。
- 仓库扫描确认高影响调用面覆盖 `lib/pi-provider-extensions.ts`、`lib/rpc-manager.ts`、Studio SDK runner、OAuth/API-key account store、quota/balance、Auth/Models/model-price/assist routes、`lib/pi-types.ts` 及 provider 合约测试。
- 第三方包发布物复核：
  - `pi-grok-cli@0.5.0` peer 为 Pi `>=0.80.0`；
  - `pi-kiro-provider@0.2.2` peer 包含 `^0.80.0`；
  - `@yofriadi/pi-antigravity-oauth@0.3.0` peer 为 `*`；
  - 三者公开扩展源码均通过 `pi.registerProvider(...)` 注册，没有直接依赖 `AuthStorage` / `ModelRegistry.create()`。

## 约束与不变量

1. 三个 Pi 核心包必须同批、精确锁定 `0.80.10`；同步生成两个锁文件。
2. 不 deep-import SDK 私有 `core/auth-storage`，不保留 `AuthStorage` 兼容垫片。
3. 自管 `auth.json` 仍是一 provider 一当前 credential；现有 OAuth/API-key 多账号池继续由 Web 管理，Active 仅镜像回 `auth.json`。
4. `auth.json` 写入必须全文件串行化、跨进程安全、原子替换并保持 `0600`；不能因不同 provider 并发写而丢失其他凭据。
5. 固定 provider 顺序保持 Grok → Kiro → Antigravity；所有 main Chat、Models/Auth、assist、model-price、Studio SDK child 路径都必须向**目标 ModelRuntime 实例**注入扩展，不能依赖无目标的进程全局 bootstrap。
6. `createRuntimeJiti()`、`process.cwd()/package.json` anchor 与 `serverExternalPackages` 规则不变。
7. 不迁移、不重写历史 Session JSONL、usage ledger、`auth-accounts/**` 或 `auth-api-key-accounts/**`。
8. 不覆盖无关用户改动；不 commit/push/merge。

## 范围

### 范围内

- Web `CredentialStore` 与 provider-aware `ModelRuntime` 工厂/服务入口。
- main Chat、Studio child、Auth/Models/model-price/assist、quota/balance、多账号 Active mirror 的全量适配。
- Provider/race/account/model-price/Studio SDK 相关测试契约更新。
- 依赖、锁文件、集成/架构/模块/排障文档更新。

### 范围外

- 新增或改版 Models/Auth 页面、交互或文案。
- 升级 Grok/Kiro/Antigravity 第三方包版本。
- 新增账号存储格式、自动 failover 策略或 quota 口径。
- 主动恢复 SDK 已移除的旧 xAI/Grok 模型，或覆盖 0.80.10 内建目录。
- 发布、commit、push、merge。

## UI 门禁结论

本任务不改变页面结构、组件状态、用户操作流程或审批体验；只替换服务端 SDK/Auth/ModelRuntime 适配。模型列表内容可能随 0.80.10 上游目录自然变化，但 UI 契约不变。因此判定 **no UI surface change / no HTML prototype required**，无需派发 UI 设计员。若实现中发现必须修改前端交互或用户可见信息结构，必须停止对应实现、补走 UI 设计员 HTML 原型与用户审批。

## 成功定义

- `app/**`、`lib/**` 和运行测试不再从 coding-agent root 导入 `AuthStorage`，不再调用 `ModelRegistry.create()`，不访问 `services.authStorage/services.modelRegistry/inner.modelRegistry`。
- Chat 新建/续聊/历史恢复/模型切换、所有 provider 登录与 Active 切换、quota/failover、Studio SDK child 均通过 0.80.10 runtime 工作。
- 多账号并发 refresh/Activate 仍满足 Active mirror CAS，API 响应不泄露 secrets。
- lint、tsc、focused suites、API smoke 与人工 UAT 通过。