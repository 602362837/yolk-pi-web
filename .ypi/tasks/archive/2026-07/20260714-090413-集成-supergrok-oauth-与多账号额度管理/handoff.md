# Handoff：SuperGrok 实现完成（GROK-07 文档与验收）

## 全部子任务状态

| ID | 状态 | 说明 |
| --- | --- | --- |
| GROK-01 | ✅ 完成 | `pi-grok-cli@0.4.1` 依赖、`lib/pi-provider-extensions.ts` 统一入口，所有 Web 入口 point 注入 |
| GROK-02 | ✅ 完成 | 泛化 OAuth saved-account store、provider adapter 架构、Grok adapter、原子写、权限、active mirror |
| GROK-03 | ✅ 完成 | Session-account binding、`before_provider_headers` token injection、per-account refresh single-flight、active mirror CAS |
| GROK-04 | ✅ 完成 | Grok billing parser、quota cache、safe `GrokQuotaResultV1` projection、stale degradation、401 refresh+retry |
| GROK-05 | ✅ 完成 | ModelsConfig Grok UI、Auth API Grok dispatch、capability-driven OAuth detail、quota cards |
| GROK-06 | ✅ 完成 | `scripts/test-grok-provider.mjs`、`scripts/test-grok-accounts.mjs`、`scripts/test-grok-quota.mjs`、`lib/*.test.ts` |
| GROK-07 | ✅ 完成 | 文档补齐、验收、secret redaction 检查（本次子任务） |

## GROK-07 产出

### 更新的文档

- `docs/integrations/README.md` — 新增 pi-grok-cli 依赖条目、Grok OAuth 与账号管理章节（provider bootstrap、OAuth saved-account store、session-account isolation、quota service、UI、data layout、invariants、rollback）
- `docs/modules/api.md` — 更新 `auth/providers/`、`auth/all-providers/`、`auth/accounts/[provider]/`、`auth/login/`、`auth/logout/`、`auth/quota/[provider]/` 路由文档以覆盖 `grok-cli`；Implementation Pointers 新增 Grok 路由实现指引
- `docs/modules/frontend.md` — 更新 ModelsConfig 组件描述以覆盖 Grok CLI provider UI（OAuth 登录方式、多账号、ACTIVE 语义、quota cards、安全）
- `docs/modules/library.md` — 更新 `oauth-accounts.ts` 和 `subscription-quota.ts` 描述；新增六个 Grok 模块条目（`oauth-account-providers.ts`、`pi-provider-extensions.ts`、`grok-account-token.ts`、`grok-session-account.ts`、`grok-subscription-quota.ts`）；Reuse Rules 新增 Grok 约束
- `docs/architecture/overview.md` — Models and tools 节新增 Grok provider bootstrap、session-account isolation、token refresh、quota、full extension scope、account data layout 段落；Session File Format 节新增 `grokAccountStorageId` 字段说明
- `AGENTS.md` — Reading Order 新增 Grok 行；Project Structure 更新 `lib/` 描述

### 验收门禁

| 检查项 | 状态 |
| --- | --- |
| `npm run lint` | ✅ 通过，0 错误 |
| `node_modules/.bin/tsc --noEmit` | ✅ 通过，0 错误 |
| `node scripts/test-grok-provider.mjs` | ✅ 40/40 通过 |
| `node scripts/test-grok-accounts.mjs` | ✅ 70/70 通过 |
| `node scripts/test-grok-quota.mjs` | ✅ 48/48 通过 |
| Secret redaction（检查源码无 token/credential 泄露） | ✅ 所有测试套件包含 sentinel 检查 |

### 变更文件清单

**新增文件（未跟踪 / 未提交）：**
- `lib/pi-provider-extensions.ts` — Grok 统一 provider bootstrap
- `lib/oauth-account-providers.ts` — Provider adapter registry（openai-codex + grok-cli）
- `lib/grok-account-token.ts` — Per-account token resolver with single-flight refresh
- `lib/grok-session-account.ts` — Runtime session-account binding management
- `lib/grok-subscription-quota.ts` — Grok billing/quota service & safe projection
- `lib/grok-session-isolation.test.ts` — Session isolation integration tests
- `lib/oauth-account-grok.test.ts` — Grok account store tests
- `scripts/test-grok-provider.mjs` — Provider bootstrap focused tests
- `scripts/test-grok-accounts.mjs` — Account lifecycle & security regression tests
- `scripts/test-grok-quota.mjs` — Quota parser, cache, failure matrix tests
- `scripts/run-oauth-account-tests.mjs` — Test runner helper

**已修改文件（未提交）：**
- `package.json` / `package-lock.json` — 新增 `pi-grok-cli@0.4.1` 依赖
- `lib/oauth-accounts.ts` — 泛化为多 provider adapter store
- `lib/rpc-manager.ts` — 注入 Grok extension factories
- `lib/types.ts` — SessionHeader 新增 `grokAccountStorageId` 字段
- `lib/ypi-studio-child-session-runner.ts` — 注入 Grok extension factories
- `app/api/auth/quota/[provider]/route.ts` — Grok quota dispatch
- `app/api/auth/providers/route.ts` — Grok bootstrap
- `app/api/auth/login/[provider]/route.ts` — Grok login bootstrap
- `app/api/auth/logout/[provider]/route.ts` — Grok logout bootstrap
- `app/api/auth/all-providers/route.ts` — Grok cold-bootstrap
- `app/api/auth/api-key/[provider]/route.ts` — Grok cold-bootstrap
- `app/api/models/route.ts` — Grok extension factories
- `app/api/commands/route.ts` — Grok extension factories
- `app/api/models-config/test/route.ts` — Grok extension factories
- `app/api/skills/route.ts` — Grok extension factories
- `app/api/terminal/env/assist/route.ts` — Grok extension factories
- `app/api/trellis/workflow/assist/route.ts` — Grok extension factories
- `components/ModelsConfig.tsx` — Grok OAuth UI
- `lib/deepseek-balance.ts` — (bare ModelRegistry.create 已审计，保留)
- `lib/oauth-account-storage.test.ts` — 更新测试

## 剩余风险

1. **Vision/Imagine token 路径**：`before_provider_headers` hook 覆盖主推理请求的 Authorization header，但 pi-grok-cli 的 vision 和 Imagine 功能可能绕过此 hook，使用全局 active account token。当前标记为文档已知限制；建议跟踪上游是否提供 per-call token override。
2. **上游 billing schema 漂移**：Grok `/billing` 是非公开 CLI backend endpoint。严格 parser + 短缓存 + stale degradation 缓解了风险，但字段变更可能打断额度展示。
3. **Registry reset**：所有 `ModelRegistry.create` 调用点已审计（仅 `deepseek-balance.ts` 保留裸调用且有文档说明），但未来新增的 registry 创建需继续强化此 invariant。
4. **npm run build**：未运行最终构建验证（按 implement.md 门禁仅在 release gate 运行）。

## 主会话需决策/动作

- 确认文档满意
- 视需要运行 `npm run build` 作为最终集成验证
- 决定是否提交/推送所有变更（Implementer 不负责 git 操作）
- 派发 Checker 进行最终审查
