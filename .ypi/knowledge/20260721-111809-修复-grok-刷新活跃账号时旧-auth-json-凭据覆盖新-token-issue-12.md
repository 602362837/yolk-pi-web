# 修复 Grok 刷新活跃账号时旧 auth.json 凭据覆盖新 token（Issue #12）

- Task: 20260721-104018-修复-grok-刷新活跃账号时旧-auth-json-凭据覆盖新-token-issue-12
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260721-104018-修复-grok-刷新活跃账号时旧-auth-json-凭据覆盖新-token-issue-12
- Archived at: 2026-07-21T03:18:09.558Z
- Tags: studio, feature-dev

## Summary
## 检查范围 - 任务产物：`brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` / `plan-review.md` / `handoff.md` - 生产改动： - `lib/oauth-accounts.ts` - `lib/grok-account-token.ts` - `lib/subscription-quota.ts` - `app/api/auth/{accounts,login,logout,providers}/**` - `scripts/test-grok-refresh-consistency.mjs`（新增） - `scripts/test-grok-accounts.mjs`、`scripts/test-grok-reauth.mjs`、`package.json` - `docs/architecture/overview.md`、`docs/integrations/README.md`、`docs/modules/library.md` - 重点：旧 token 回写竞态、锁嵌套死锁、Active/non-Active、mirror 失败收敛、测试真实性、secret 泄漏、UI 门禁、跨 provider 回归 检查员未修改生产代码；仅写入本 `review.md`。 ## 需求 / 设计覆盖结论 | 验收项 | 结论 | 证据 | | --- | --- | --- | | AC-01 Active C0→C1 两处一致 | 通过 | `refreshGrokCredential` slot-first + Active CAS mirror；`test-grok-refresh-consistency` Active commit 断言 | | AC-02 第二次刷新提交轮换后的 refresh | 通过 | fixture 记录 `calls` 为 `R0 → rotated-1`；禁止再次提交 `R0` | | AC-0…

## Reusable knowledge
### review.md

# Review：Issue #12 Grok Active 刷新凭据回退修复

## 检查范围

- 任务产物：`brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` / `plan-review.md` / `handoff.md`
- 生产改动：
  - `lib/oauth-accounts.ts`
  - `lib/grok-account-token.ts`
  - `lib/subscription-quota.ts`
  - `app/api/auth/{accounts,login,logout,providers}/**`
  - `scripts/test-grok-refresh-consistency.mjs`（新增）
  - `scripts/test-grok-accounts.mjs`、`scripts/test-grok-reauth.mjs`、`package.json`
  - `docs/architecture/overview.md`、`docs/integrations/README.md`、`docs/modules/library.md`
- 重点：旧 token 回写竞态、锁嵌套死锁、Active/non-Active、mirror 失败收敛、测试真实性、secret 泄漏、UI 门禁、跨 provider 回归

检查员未修改生产代码；仅写入本 `review.md`。

## 需求 / 设计覆盖结论

| 验收项 | 结论 | 证据 |
| --- | --- | --- |
| AC-01 Active C0→C1 两处一致 | 通过 | `refreshGrokCredential` slot-first + Active CAS mirror；`test-grok-refresh-consistency` Active commit 断言 |
| AC-02 第二次刷新提交轮换后的 refresh | 通过 | fixture 记录 `calls` 为 `R0 → rotated-1`；禁止再次提交 `R0` |
| AC-03 list 不写回旧 secret | 通过 | `listOAuthAccounts` 仅 `projectOAuthAccounts`；全仓无 `syncActiveOAuthAccountCredential`；barrier 测试中 list 持锁窗口执行后 slot/mirror 仍为新值 |
| AC-04 refresh A + Activate B | 通过 | provider lock 串行 + barrier 并发测试：最终 Active/mirror=B，A slot 保留旋转后 credential |
| AC-05 non-Active 隔离 | 通过 | non-Active refresh 断言 mirror/Active 不变 |
| AC-06 same-account single-flight | 通过 | 同 storage id 并发调用只触发一次 fixture `refreshToken` |
| AC-07 失败安全 | 通过 | 上游失败零写入；损坏 metadata 刷新前 0 次 refresh；mirror 失败保留 C1 并在后续 valid-token 路径收敛 |
| AC-08 bootstrap/login/logout 兼容 | 通过 | 显式 `bootstrap` / `adopt` / `clearOAuthActiveAccount`；login/providers/accounts/logout 路由已切换；OpenAI runtime refresh 显式 adopt |
| AC-09 权限/原子写/secret 边界 | 通过 | 仍为 0600/0700 + tmp+rename；错误/list 序列化不含 sentinel |
| AC-10 验证矩阵 | 通过 | 见下方 Verification（含 0.80.10 typecheck） |
| UI 门禁 |

### checks.md

# Checks：Grok Active 刷新凭据一致性

## 1. 需求覆盖

- [ ] Active refresh 成功后，slot 文件与 `auth.json.grok-cli` 同为新 credential。
- [ ] 第二次刷新使用轮换后的 refresh token，不再提交旧的一次性 token。
- [ ] 普通 `listOAuthAccounts("grok-cli")` 不执行 `auth.json -> existing slot` secret 回写。
- [ ] refresh 与 list 受控交错后，新 credential 不回退。
- [ ] refresh A 与 Activate B 两种顺序都形成合法终态。
- [ ] 非 Active refresh 只更新目标 slot。
- [ ] 同进程同 storage id 并发刷新保持 single-flight。
- [ ] 上游失败、metadata 失败和 mirror 失败遵守失败安全规则。
- [ ] auth-only bootstrap、normal login、add、reauth、logout、Activate 行为兼容。
- [ ] API wire、metadata schema、opaque id、Session JSONL 不变。

## 2. 自动验证矩阵

### 2.1 新增生产路径聚焦测试

使用临时 `PI_CODING_AGENT_DIR` 和受控 OAuth fixture，禁止真实网络/真实用户目录：

| 场景 | 关键断言 |
| --- | --- |
| Active C0 -> C1 | resolver 返回 C1；slot/auth 的 access/refresh/expires 都是 C1 |
| R0 一次性轮换 | 第一次 provider 输入 R0、返回 R1；第二次输入必须是 R1、返回 R2 |
| refresh + list barrier | list 在 refresh 窗口执行；最终 slot/auth 无 C0 |
| refresh A + Activate B | 最终 Active/mirror 为 B；A slot 保留 C1 |
| Activate B + refresh A | A 作为 non-Active 只更新自身，mirror 仍为 B |
| non-Active refresh | metadata Active 和 auth 全程不变 |
| same-account single-flight | 同进程并发调用只执行一次 fixture `refreshToken()` |
| upstream failure | slot/auth/metadata byte-level 或结构等价保持 |
| malformed metadata | refresh 前 fail closed，fixture refresh 调用次数为 0 |
| mirror persistence failure | slot 保留 C1；调用返回安全错误；恢复写条件后下一次 resolver 把 mirror 收敛到 C1 |
| privacy | list/API/error/console 序列化不含 sentinel access/refresh、payload、绝对路径 |

并发测试必须使用 deferred/barrier 控制时序，不接受仅靠随机 `sleep` 的偶发竞态测试。

### 2.2 现有回归

```bash
npm run test:grok-refresh-consistency
npm run test:grok-accounts
npm run test:grok-global-auth
npm run test:oauth-accounts
npm run test:kiro-refresh-activate-race
npm run test:antigravity-refresh-activate-race
npm run test:kiro-accounts
npm run test:antigr

### design.md

# Design：Grok Active 刷新凭据一致性

## 1. 方案摘要

推荐采用“**saved-account 真相 + Active 单向镜像 + 显式接纳 + provider lock 串行化**”方案：

1. 为 OAuth account store 提供无 secret 写副作用的 Active metadata 读取契约。
2. `listOAuthAccounts()` 不再无条件执行 `auth.json -> saved-account`；普通列表不能写 access/refresh。
3. legacy auth-only bootstrap、成功 OAuth login、需要从 canonical runtime 接纳新 credential 的场景使用命名明确的显式同步入口。
4. Grok refresh 在 `withGrokProviderLock()` 内读取最新账号凭据、判断/复核 Active、原子写账号文件，并把 Active 的同一新 credential 写入 `auth.json`。
5. Active 镜像写入是“刷新成功”的一部分；失败时保留已轮换的新账号凭据、返回安全错误，后续 resolver 用新凭据重试镜像，不得恢复旧 refresh token。

不推荐只把 Grok resolver 中的一次 `listOAuthAccounts()` 替换为直接读文件：这只能消除确定性覆盖，不能阻止外部列表/显式同步在刷新窗口读取旧 `auth.json` 后回写。

## 2. 现状与根因

当前 Active 刷新顺序：

```text
refresh(C0) -> C1
write account(A)=C1
listOAuthAccounts()
  -> syncActiveOAuthAccountCredential()
  -> read auth.json=C0
  -> write account(A)=C0
write auth.json=C1
```

最终可能成为：

```text
accounts.json.activeAccountId = A
A.json                        = C0
Auth mirror                   = C1
```

问题不是单纯 CAS 缺失，而是两个职责冲突：

- refresh 把 saved-account 当真相并向 Active mirror 发布；
- list 又把 Active mirror 当真相反向覆盖 saved-account。

两个文件没有共同事务；一旦 refresh token 轮换，任何“最后写入旧快照”的路径都会造成不可恢复的凭据回退。

## 3. 权威性与不变量

| 数据 | 权威性 | 允许写入者 |
| --- | --- | --- |
| `accounts.json.activeAccountId` | managed Active 指针 | Activate、显式 bootstrap/login/disconnect 元数据操作 |
| `<storage-id>.json` | 该槽位完整 OAuth 凭据真相 | add/login 接纳、refresh、reauth |
| `auth.json["grok-cli"]` | 当前 Active 的派生镜像 | Activate、Active refresh、Active reauth、显式 login/disconnect |

目标不变量：

- **I1**：普通 list 不把 `auth.json` secret 写入已存在槽位。
- **I2**：Active refresh 成功返回后，账号文件与 mirror 为同一新 credential。
- **I3**：非 Active refresh 只写自身槽位。
- **I4**：一旦获得轮换后的 credential，不以旧 mirror 回滚它。
- **I5**：所有会改变 Grok Active 指针、Active secret 或 Active mirror 的路径共享 prov

### implement.md

# Implement：Grok Active 刷新凭据一致性

## 1. 优先阅读

1. `AGENTS.md`
2. `docs/integrations/README.md`
3. `docs/architecture/overview.md`
4. `docs/modules/api.md`
5. `docs/modules/library.md`
6. `docs/standards/code-style.md`
7. `lib/oauth-accounts.ts`
8. `lib/grok-account-token.ts`
9. `lib/grok-account-lock.ts`
10. `lib/web-credential-store.ts`
11. `app/api/auth/login/[provider]/route.ts`
12. `app/api/auth/logout/[provider]/route.ts`
13. `app/api/auth/providers/route.ts`
14. `app/api/auth/accounts/[provider]/route.ts`
15. Kiro/Antigravity token resolver 与 refresh-Activate race 测试

## 2. 人类可读子任务表

| ID | 阶段 | 顺序 | 子任务 | 依赖 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| AUTH-01 | Store | 1 | 拆分 OAuth list、Active metadata 读取与显式接纳 | - | 否 |
| GROK-01 | Resolver | 2 | 实现 Grok 锁内 refresh/mirror 提交与失败收敛 | AUTH-01 | 否 |
| TEST-01 | Verify | 3 | 增加轮换 token 与并发生产路径回归 | GROK-01 | 否 |
| DOC-01 | Docs | 4 | 更新架构/集成/library 文档并完成全量门禁 | TEST-01 | 否 |

本任务集中修改同一凭据一致性边界，建议 `maxConcurrency=1`，避免并行实现对 authority/lock 语义作出冲突假设。

## 3. 执行步骤

### AUTH-01：OAuth store 职责拆分

- 全仓审计 `listOAuthAccounts()` 与 `syncActiveOAuthAccountCredential()` 调用方。
- 提供无 `auth.json`/secret 写副作用的 Active metadata 读取 helper。
- 抽出不取 provider lock 的账号列表投影 core，供已持锁 mutation 使用。
- 取消 public list 的无条件 `auth.json -> existing slot` 同步。
- 将 auth-only bootstrap、成功 login 接纳、OpenAI runtime refresh 接纳、logout Active 清理变成显式调用；bootstrap 不覆盖有效 managed Active。
- Grok 的显式 Active secret 接纳通过 provider lock；避免 public locked wrapper 在已持锁路径中嵌套调用。
- 不改 API wire、metadata schema、opaque id。

### GROK-01：Grok resolver 提交协议

- 删除 Grok token resolver 对带 secret 同步副作用的 list 依赖。
- 在 provider lock 内读取最新 credential 和 Active metadata。
- 上游 refresh 成功后先原子保存新 account credential，再复核 Active 并更新 mirror。
- Active mirror 失败时保留新 account credential并返回固定安全错误；不得继续返回 `r

### prd.md

# PRD：修复 Grok 活跃账号刷新后的凭据回退

## 1. 目标与背景

Issue [#12](https://github.com/602362837/yolk-pi-web/issues/12) 已确认：Grok 活跃账号成功刷新 OAuth token 后，`listOAuthAccounts("grok-cli")` 隐式执行 `auth.json -> saved-account` 同步，可能把刷新前的旧凭据重新写回账号文件。若上游轮换或一次性使用 refresh token，下一次刷新会再次提交旧 token 并要求用户重新登录。

本任务要建立明确的一致性边界：Grok managed saved-account 是账号凭据真相，`auth.json["grok-cli"]` 是当前 Active 的派生镜像；普通列表读取不得把旧镜像反向写入真相文件。

## 2. 用户价值

- 成功刷新后不会立即回到旧 token 或错误进入重新登录状态。
- refresh token 轮换能够持续工作，而不是只成功一次。
- 刷新、账号列表读取、Activate、reauth 并发时保持合法 Active 终态。
- 不改变现有 Models、额度、failover 或登录界面。

## 3. 范围内

1. Grok token resolver 的 Active 判定、账号凭据落盘和 `auth.json` 镜像提交语义。
2. `listOAuthAccounts()` 与 `syncActiveOAuthAccountCredential()` 的职责拆分，消除普通列表读取中的 secret 反向覆盖。
3. Grok provider lock 对刷新、Activate、reauth 及显式 Active 凭据接纳路径的协调。
4. legacy `auth.json` 首次接入 managed account store 的兼容边界。
5. Active、非 Active、列表并发、Activate 交错、single-flight、轮换 refresh token 与失败恢复测试。
6. OAuth/Grok 架构和 library 文档修正。

## 4. 范围外

- UI、文案、交互、API response shape 或前端信息结构变更。
- Grok 登录/重新登录产品流程重做。
- 配额协议、自动 failover 决策、ModelRuntime live reload 语义变更。
- 账号 metadata schema、opaque storage id、Session JSONL 或历史凭据迁移。
- 自动修复在本版本前已经失效的一次性 refresh token。
- Kiro/Antigravity token 算法重构；共享列表契约调整必须做回归验证，但不借本 Issue 改写其他 provider 的刷新策略。

## 5. 需求

### R1. 权威来源

对已建立 managed Active 槽位的 Grok provider：

- `accounts.json.activeAccountId` 决定 Active 槽位。
- `<storage-id>.json` 是该槽位完整 OAuth 凭据真相。
- `auth.json["grok-cli"]` 只作为 Active 凭据镜像，不得在普通读取中覆盖已存在的槽位凭据。

### R2. 列表读取无 secret 回写

`listOAuthAccounts()` 可以清理缺失 metadata、回填安全 label 并返回摘要，但不得因读取 `auth.json` 而把 access/refresh token 写入现有账号文件。首次 legacy bootstrap 与成功 OAuth login 的凭据接纳必须是命名明确、可协调的显式操作。

### R3. Active 刷新一致性

Active 账号从 `C0` 刷新得到 `C1` 后，仅当以下条件都满足时才算刷新成功：

1. `C1` 已原子写入该账号文件；
2. 锁内复核该账号仍为 Active；
3. `auth.json["grok-cli"

## Source artifacts
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
