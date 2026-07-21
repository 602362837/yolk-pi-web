# Check Complete：Issue #12 OAuth Active 凭据边界与刷新一致性

## Findings Fixed

None。本检查员只审查/验证，未修改任何生产代码、测试或文档。

## Remaining Findings

### 阻塞

None。

### 非阻塞

1. **ESLint warning（预存 + 本改动触及）**  
   `lib/grok-credential-transaction.ts` 中 `_type` 解构触发 `@typescript-eslint/no-unused-vars`（既有 comparable 路径与新增 reconcile 路径各一处）。0 errors；不要求返工。
2. **计划已声明的残余风险（不阻塞关闭）**
   - 跨文件 slot / metadata / mirror 不是数据库事务；partial failure 可重试。
   - 两个明确跨进程 force refresh 仍可能顺序各刷一次。
   - 遗留从未持久化 label 的账号继续 masked-id fallback。
   - 已被上游作废的历史 refresh token 无法本地恢复。

## Review Evidence（R1–R10）

| 需求 | 结论 | 证据 |
| --- | --- | --- |
| R1 `readOAuthActiveAccountId` | Pass | 仅 `readMetadataForActivePointer` + metadata entry + `pathExists`；不打开 credential body、不读 `auth.json`、不写、不联网；malformed metadata fail closed |
| R2 bootstrap | Pass | provider lock 内：valid Active slot 直接返回；仅无 valid slot 时读 mirror 并 `markActive`；stale mirror 不覆盖 slot（storage test + design 契约） |
| R3 adopt | Pass | login provider-wide 与 OpenAI Active quota 在 success 前显式 adopt；invalid mirror 返回 `null` 且不清 Active；失败不发 success |
| R4 clear/logout | Pass | `clearOAuthActiveAccount(provider, logout)` 在 provider lock 内先 `logout()` 再清 pointer；route 使用 `() => runtime.logout(provider)`；Grok decorated store `delete()` 委托 raw store，无嵌套 provider lock；slots 保留 |
| R5 pure list | Pass | metadata + slot existence 过滤；不读 `auth.json`/credential body；不写、不 refresh、不 `backfillLabel`；response 无 secret |
| R6 callers | Pass | production `syncActiveOAuthAccountCredential` = **0**；accounts GET = bootstrap→list；providers GET = best-effort bootstrap→list；login adopt required；logout clear；active-only quota/token/session/failover 用 reader |
| R7 PR #13 保护 | Pass | `88d9756` 为 ancestor；`commitGrokCredentialUnderLock` 仍 slot-first；`GrokCoordinatedCredentialStore` lock-time reread 保留；仅增量 `reconcileGrokActiveMirrorUnderLock` |
| R8 mirror 收敛 | Pass | valid-token 路径调用 reconcile；一致 zero-write；不一致 slot→mirror；Active changed / non-Active 不写；mirror failure 保留 slot |
| R9 一致性测试 | Pass | `test:grok-refresh-consistency` 覆盖轮换、list 无写、refresh→Activate、single-flight、mirror 失败后无 refresh 收敛、secret 边界；已纳入 `test:grok-all`；PR #13 race 仍全绿 |
| R10 文档 | Pass | architecture / integration / library / api / code-style 已记录 bootstrap/adopt/clear/list 与 Grok 单向 mirror；无旧 sync/list-reconciliation 陈述 |
| UI gate | N/A | 无 `components/` / `hooks/` 改动；API wire 不变 |

### 保留的 `listOAuthAccounts` 生产调用（均需完整 summary/candidates）

| 调用点 | 理由 |
| --- | --- |
| accounts GET / providers GET | 返回账号列表 / accountCount / displayName |
| login reauth preflight | 校验目标账号存在 |
| import / update / delete / activate 返回 | mutation 后 pure projection |
| Grok/Kiro/Antigravity/ChatGPT failover | 枚举候选账号 |
| ChatGPT usage scheduler | 枚举待刷新账号 |

active-only 路径（session / quota / token fallback）已改为 `readOAuthActiveAccountId`。

### 数据方向与锁

- mirror → slot 仅 bootstrap / adopt。
- Grok refresh / reconcile 始终 slot → mirror。
- non-Active refresh / non-Active valid read 不写 mirror。
- 锁序 provider → auth.json；lifecycle 使用 raw store；list/read 不拿写锁。
- logout 不删除 saved slots。

## Verification

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | Pass（0 errors / 9 warnings；本改动相关仅 `_type`） |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run test:grok-refresh-consistency` | Pass 4/4 |
| `npm run test:grok-refresh-race` | Pass 5/5 |
| `npm run test:grok-accounts` | Pass 97/97 |
| `npm run test:oauth-accounts` | Pass（storage/grok/kiro/antigravity/token/quota-id 全绿） |
| `npm run test:kiro-accounts` | Pass 28/28 |
| `npm run test:kiro-refresh-activate-race` | Pass 4/4 |
| `npm run test:kiro-quota` | Pass 37/37 |
| `npm run test:antigravity-accounts` | Pass 29/29 |
| `npm run test:antigravity-refresh-activate-race` | Pass 4/4 |
| `npm run test:antigravity-quota` | Pass 30/30 |
| `npm run test:grok-all` | Pass（含 consistency / race / oauth-accounts 等） |
| `git diff --check` | Pass |
| `rg syncActiveOAuthAccountCredential app lib` | 0 production refs |

基线：`HEAD = 3b8285c`（含 PR #13 `88d9756`）；实现为工作树未提交增量；checker 未 commit / push / merge。

## Verdict

**Pass**

Issue #12 实现满足 R1–R10：OAuth Active 显式边界完整，list 纯投影，路由/quota/failover 接线正确，Grok PR #13 未回退且 mirror 单向收敛可验证，跨 provider 回归与聚合测试全绿，文档与源码一致。无阻塞问题。

## Checker Handoff（→ main）

### Artifacts produced

- 更新本文件：`.ypi/tasks/20260721-121042-处理-issue-12-修复-oauth-active-凭据边界与刷新一致性/review.md`

### Implementation files（实现侧已有，checker 未改）

- Core：`lib/oauth-accounts.ts`、`lib/oauth-account-providers.ts`
- Grok：`lib/grok-credential-transaction.ts`、`lib/grok-account-token.ts`、`scripts/test-grok-refresh-consistency.mjs`、`package.json`
- Routes / callers：auth accounts/providers/login/logout、subscription/quota/token/failover/session helpers
- Tests / docs：OAuth/Grok/Kiro/Antigravity 回归脚本与 architecture/integration/library/api/code-style 文档

### Remaining risks

见上方非阻塞项；均为计划已知残余，不阻止验收。

### Decisions needed from main session

1. 将 OAUTH-06 / 任务检查阶段标为 **done**（计划 6/6）。
2. 进入用户验收或按流程提交 PR（本检查员不 commit / push / merge）。
3. 可选：清理 `_type` ESLint warning（非阻塞，不必返工）。
