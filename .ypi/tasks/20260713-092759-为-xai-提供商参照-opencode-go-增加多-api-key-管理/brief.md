# Brief：xAI 多 API Key 管理

## 问题

当前应用已有 provider-scoped managed API-key 账号池，但 `lib/api-key-accounts.ts` 的 `MANAGED_ACCOUNT_PROVIDERS` 仅允许 `opencode-go`。因此 xAI 在 Settings → Models 仍使用单 Key 模式，用户不能保存、命名、查看、切换或逐个删除多个 xAI Key。

## 目标

在不改变 Pi SDK“一 provider 一当前 credential”契约的前提下，让 `xai` 复用现有 managed accounts 能力：多 Key 保存、脱敏列表、单项 reveal/copy、编辑、启停、激活、删除，以及 legacy `auth.json` 单 Key 的幂等导入。激活项继续镜像到 `auth.json` 并刷新运行时认证。

## 范围内

- 将 provider id `xai` 纳入 managed-account allowlist。
- 复用 `~/.pi/agent/auth-api-key-accounts/xai/` 存储、现有 API 路由及 `ApiKeyAccountsDetail`。
- 验证 all-providers/status、legacy 导入、CRUD、激活镜像、删除回退、安全 reveal 和 UI 状态。
- 更新相关模块文档，将“v1 only opencode-go”改为当前 provider 列表。

## 范围外

- 不复制一套 xAI 专属存储、API 或组件。
- 不改变 xAI Key 格式或发起远端有效性探测。
- 不实现 xAI 自动额度/错误切换；`opencode-go` auto-failover 的错误分类和配置均为 provider-specific，本轮不泛化。
- 不迁移或合并不同 provider 的账号。

## 参考实现

- 核心：`lib/api-key-accounts.ts`
- API：`app/api/auth/api-key/[provider]/**`、`app/api/auth/all-providers/route.ts`
- UI：`components/ModelsConfig.tsx` 中 `ApiKeyAccountsDetail`
- 历史：`.ypi/knowledge/20260709-101321-为-opencode-go-提供商设计多账号-api-key-管理与激活能力.md`
- 可选后续：`lib/opencode-go-account-failover.ts`（仅作为未来泛化研究，不进入本轮）

## 推荐决策

本轮仅扩展 xAI 的人工多 Key 管理；自动 failover 后续独立立项，以便单独确认 xAI 错误语义、切换策略和多进程锁。
