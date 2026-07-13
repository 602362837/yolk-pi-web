# Design：xAI 复用 managed API-key accounts

## 方案摘要

把 `xai` 加入 `MANAGED_ACCOUNT_PROVIDERS`，其余能力沿用 provider-scoped 通用实现。路由和 UI 已通过 `isManagedApiKeyProvider(provider)` / `authMode === "managed_accounts"` 分派，因此不新增 xAI 专属分支。

## 影响模块与边界

- `lib/api-key-accounts.ts`：allowlist 与注释；存储、legacy import、CRUD、active mirror 均无需复制。
- `app/api/auth/all-providers/route.ts`、`app/api/auth/api-key/[provider]/**`：预期无需行为代码改动，但需回归验证和更新陈旧注释。
- `components/ModelsConfig.tsx`：预期复用 `ApiKeyAccountsDetail`；仅在发现 provider-specific 文案/条件时做最小泛化。
- 测试：新增 provider allowlist、跨 provider 隔离、xAI legacy import/CRUD/mirror 覆盖；测试不得触碰真实用户 agent dir。
- 文档：`docs/modules/{library,api,frontend}.md`、必要时 deployment/troubleshooting。

## 数据流

1. all-providers 遍历 registry 中 `xai`，summary 返回 managed metadata，不触发 import。
2. UI 根据 `authMode` 渲染 `ApiKeyAccountsDetail`。
3. 首次 GET accounts 调用 `listApiKeyAccounts("xai")`，读取 legacy credential 并按 SHA-256 fingerprint 幂等导入。
4. CRUD 操作写 `auth-api-key-accounts/xai/accounts.json` 与 `<accountId>.json`。
5. activate/active-key update 将 `{type:"api_key", key}` 写回 `auth.json` 并 `reloadRpcAuthState()`。

## API 与文件契约

不新增 endpoint 或 wire 字段。沿用：

- `GET/POST /api/auth/api-key/xai/accounts`
- `PATCH/DELETE /api/auth/api-key/xai/accounts/:accountId`
- `POST .../:accountId/activate`、`POST .../:accountId/reveal`
- metadata 不含明文；secret 文件 `0600`，目录 `0700`；reveal `no-store`。

## 兼容性与迁移

迁移为 lazy read-through，无启动迁移。已有 `auth.json` xAI Key 在用户首次打开账号列表时导入；summary 仅读状态。现有 xAI single-key POST 进入 managed legacy-compatible 路径；无账号时创建并激活，有 active 时原位更新。

## 风险与缓解

- **共享组件隐藏硬编码**：搜索 OpenCode-specific 文案/配置，浏览器验收 xAI 全状态。
- **测试写真实凭证**：使用隔离 `PI_CODING_AGENT_DIR`/临时目录并恢复环境。
- **误把 failover 一并泛化**：本轮不改 `rpc-manager.ts`、`opencode-go-account-failover.ts` 或 `pi-web-config.ts`。
- **并发 metadata 写入**：现有实现无跨进程事务锁；本轮不扩大语义，记录为既有风险。

## 回滚

从 allowlist 移除 `xai` 并回退文档/UI最小泛化即可恢复 single 模式。保留 `auth-api-key-accounts/xai/` 数据，不自动删除；active mirror 仍是标准 `auth.json` credential，不影响运行时。
