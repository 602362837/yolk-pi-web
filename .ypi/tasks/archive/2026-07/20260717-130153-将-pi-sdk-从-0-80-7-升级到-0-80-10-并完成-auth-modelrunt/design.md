# Design：Web CredentialStore 与 provider-aware ModelRuntime

## 方案摘要

采用**应用自管 CredentialStore + runtime-local provider registration**：

1. Web 直接实现 pi-ai 公共 `CredentialStore`，继续读写原 `~/.pi/agent/auth.json`。
2. 用统一 factory 创建 `ModelRuntime`，并通过 canonical services helper 将 fixed provider extensions 注册到实际使用的 runtime。
3. main Chat 与 Studio child 从旧 `modelRegistry` 路径切换到 `modelRuntime`；所有鉴权使用 `getAuth()`。
4. 现有 OAuth/API-key 多账号池不变，仅把 Active mirror 的底层读写从 `AuthStorage` 改为 Web CredentialStore。
5. 0.80.10 三核心包与适配代码作为一个原子变更发布/回滚。

## 影响模块与边界

### 1. Credential persistence

建议新增 `lib/web-credential-store.ts`，职责限定为：

- `createWebCredentialStore({ authPath? })`：file-backed store；
- `getWebCredentialStore(agentDir?)`：按 canonical auth path 复用进程内协调器；每次 read/list/modify/delete 仍读取最新磁盘状态；
- 可测试的 config-value resolver（可同文件或独立 `lib/web-auth-config-value.ts`）；
- raw one-off read helper仅用于必须检查原始 credential 的场景；普通请求鉴权交给 runtime。

**文件契约**：仍是 `Record<providerId, Credential>` 的 `auth.json`，不改变 schema。

**锁与写入**：

- 进程内全 auth 文件队列 + `<authPath>.lock` 独占 mkdir 跨进程锁；不是 provider-local lock，因为不同 provider 共享一个 JSON 文件。
- stale owner/mtime 30s、bounded retry/timeout；owner metadata 不含 credential。
- 锁内重新读取整文件，运行 `modify` callback，写 same-dir unique temp，`fsync` best effort，`chmod 0600`，atomic rename。
- JSON 解析失败时拒绝写入；不以空对象覆盖损坏文件。
- `modify` 返回 `undefined` 表示保持当前值；删除只能走 `delete`，与 pi-ai 契约一致。

**API-key解析兼容**：`read()` 对 `type=api_key` 继续支持 documented literal、`$ENV`/`${ENV}`、`$$`、`$!`、leading `!command`；`list()` 只读 metadata，不执行命令。OAuth 原样返回并保留 provider-specific fields。

### 2. ModelRuntime / services

建议新增 `lib/web-model-runtime.ts`（或在 provider module 中导出，但避免继续扩大 jiti loader 文件）：

- `createWebModelRuntime({ agentDir, credentials?, modelsPath?, allowModelNetwork? })`：创建独立 runtime；
- `getWebModelRuntime({ agentDir, cwd })`：仅缓存 fixed-provider 管理 runtime，cache key 至少含 canonical agentDir/modelsPath；每次管理读取前 offline refresh；
- `createWebAgentSessionServices({ cwd, extraExtensions, modelRuntime?, modelsPath? })`：调用 `createAgentSessionServices`，始终使用 `webExtensionFactories(extra)`，返回 `services.modelRuntime`。

**隔离原则**：

- main Chat 与 Studio child 每个 services/session 拥有独立 runtime，避免 project-local extension provider 在不同 cwd 间泄漏。
- Auth/Models/model-price/assist 等只加载 fixed provider 的管理路径可复用 keyed runtime。
- 临时 models.json 测试必须创建非缓存 runtime。

`ensureWebProvidersBootstrapped()` 不能再被描述为“给后续任意 registry 注入模型”。若 token compatibility path 仍需 process-global OAuth preload，可保留为明确命名/注释的 legacy OAuth bootstrap；所有模型目录调用必须使用 target-runtime services helper。

### 3. Session lifecycle

`lib/rpc-manager.ts`：

- 以 `createWebAgentSessionServices()` 替代手工 `DefaultResourceLoader + createAgentSession()`，随后调用 `createAgentSessionFromServices()`。
- YPI Studio 与 Browser Share extension extras、tool activation、单 wrapper/start lock/fork/destroy 行为保持不变。
- `set_model`：`inner.modelRuntime.getModel(provider, modelId)`。
- `reloadRpcAuthState(): Promise<number>`：并行/有界地对 live wrappers执行 `await modelRuntime.refresh({allowNetwork:false})`；每 wrapper 失败隔离。刷新后以同一 provider/id 获取 descriptor，并直接替换 live model对象，避免 `setModel()` 的 JSONL/default side effect；最后执行 `cleanupSessionResources()`。
- 所有 Activate/login/logout/API-key mirror 调用方必须 await reload 完成后再返回成功。

`lib/pi-types.ts` 将最小接口从 `modelRegistry` 改为 `modelRuntime`（`getModel`, `refresh`），不暴露 credential store。

Studio child 使用同一个 services helper，但继续拥有独立 SessionManager、child session id、request affinity 与 guard extension。

### 4. Auth 与账号迁移

#### OAuth login/logout/providers

- provider discovery：`runtime.getProviders()`，OAuth capability 为 `provider.auth.oauth`。
- login：`runtime.login(provider, "oauth", { signal, prompt, notify })`。
  - `notify` 映射 `auth_url/device_code/progress/info` 到现有 SSE；
  - `prompt` 映射 text/secret/manual_code/select 到现有 token + POST 回填机制；
  - add-account runtime 注入 `InMemoryCredentialStore`，使用 login 返回 credential 写入 saved-account store，不碰 Active；
  - normal login 使用 file store，之后同步 Active metadata并 await live reload。
- logout：`await runtime.logout(provider)`，再 await live reload。
- loggedIn/status：`await runtime.checkAuth(provider)` / `getProviderAuthStatus()`，不能只看旧同步缓存。

#### OAuth/API-key account store

- `syncActiveOAuthAccountCredential` 接受 `CredentialStore`，改为 await `read()`。
- Activate/mirror 使用 `modify(provider, async current => next)`；存储失败直接 reject，不使用 `drainErrors()`。
- Grok/Kiro/Antigravity refresh 的 Active CAS 仍在现有 provider lock 与 metadata re-read 内完成，只替换最终 mirror primitive。
- managed API-key legacy import、activate、disable replacement、last-delete 均通过 store；credential types从 `@earendil-works/pi-ai` 导入。

#### Quota/balance

- OpenAI active quota通过 `runtime.getAuth(provider)`获取 access token，让 runtime 在 store lock 内完成 OAuth refresh；随后读取最新 credential以取得 account metadata。
- DeepSeek通过 provider-scoped `getAuth()`获取 key。
- 保存账号的 provider-specific refresh helper可暂用公开 pi-ai compatibility OAuth API，但不得依赖 coding-agent私有 AuthStorage；cold path必须先加载 fixed provider，forceRefresh语义与现有测试保持。

### 5. Models、价格与 assist

- `services.modelRegistry` → `services.modelRuntime`。
- `find/getAll/getAvailable` → `getModel/getModels/getAvailable`；显示名从 `getProvider()?.name` 或 runtime status 获取。
- `getApiKeyAndHeaders` → `getAuth(model)`，读取 `auth.auth.apiKey/headers/baseUrl`；优先使用 `runtime.completeSimple/streamSimple`，避免调用方遗漏模型配置 headers。
- model-price共享逻辑改收窄到 `ModelRuntime` 或最小 catalog interface；写后验证创建临时 provider-aware runtime并 offline refresh。
- 不再在应用业务代码构造 `ModelRegistry`；该 facade仅由 SDK extension内部使用。

## 数据流

```text
Auth API / Activate / refresh
  -> WebCredentialStore.modify/delete (global auth.json lock)
  -> auth.json atomic replace
  -> await reloadRpcAuthState()
       -> each AgentSession.modelRuntime.refresh({allowNetwork:false})
       -> same-id model descriptor replacement
       -> cleanup provider session resources

New Chat / Studio child / Models/Auth admin
  -> create/get Web ModelRuntime (WebCredentialStore)
  -> createAgentSessionServices(webExtensionFactories)
       -> extensions register into this ModelRuntime
       -> offline runtime refresh
  -> getModel/getAuth/stream or createAgentSessionFromServices
```

## API 与文件兼容性

- HTTP methods、paths和成功 response shape不变；内部错误继续输出脱敏 fixed message。
- `auth.json`、managed account metadata、secret files、Session JSONL、usage ledger均不迁移。
- xAI/Grok/Kimi目录采用 0.80.10 上游结果；不伪造旧模型。
- `reloadRpcAuthState` 是内部 async signature 变更，必须一次更新所有调用者。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 自管 store 并发写丢 provider | 全 auth 文件进程锁 + 跨进程 mkdir lock；锁内 reread；并发不同 provider 测试 |
| JSON 损坏被覆盖 | parse failure fail-closed；不写空对象；保留原文件 |
| API key config-value语义退化 | 针对 command/env/escape/list-no-exec 增加 focused tests |
| fixed provider 注册落到临时 runtime | canonical services helper；禁止用无目标 bootstrap 作为 catalog保证；cold-path contract tests |
| 全局 runtime 泄漏 cwd extension | session/Studio runtime不缓存；管理 runtime仅 fixed providers并按路径键控 |
| live reload未 await导致旧 token继续用 | `Promise<number>`并更新全部调用方；wrapper隔离；清理 provider session resources |
| 第三方 provider仅 peer兼容但运行异常 | provider login/model/quota/race suites + dev API/manual UAT；保持 jiti/external规则 |
| 0.80.10目录变化影响选择 | 接受上游目录；历史 session找不到模型时沿用 SDK fallback提示，不篡改JSONL |

## 回滚

- 代码、`package.json`、两个锁文件整体回退到 0.80.7 adapter；重启服务清除 process runtime。
- 禁止只降 SDK 不降 adapter，或只回退部分核心包。
- 不删除/回写 `auth.json`、`auth-accounts/**`、`auth-api-key-accounts/**`、Session JSONL或usage ledger；格式保持兼容。
- 若实现期间出现 UI 必需改动，回滚该改动并转回 planning/UI门禁，而非把UI变化夹带进SDK迁移。