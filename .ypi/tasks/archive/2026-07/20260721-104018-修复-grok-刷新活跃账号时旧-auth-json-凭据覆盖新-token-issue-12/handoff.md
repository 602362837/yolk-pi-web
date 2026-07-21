# Handoff：Issue #12 规划完成

## 已产出

- `prd.md`：目标、范围、R1–R10 与 AC-01–AC-10。
- `design.md`：saved-account 真相、Active 单向镜像、显式凭据接纳、provider lock、部分失败收敛。
- `implement.md`：AUTH-01 → GROK-01 → TEST-01 → DOC-01 的 schemaVersion 2 单并发计划。
- `checks.md`：轮换 token、list barrier、Activate 竞态、失败恢复、安全与跨 provider 回归矩阵。
- `plan-review.md`：用户审批入口。
- `ui.md`：确认无 UI 变化，不触发 HTML 原型门禁。

未修改生产代码，未执行 commit、push 或 merge。

## 已验证

- 机器可读 implementation plan 可被 JSON 解析，字段与依赖完整。
- 规划文件无 TBD，显式 untracked whitespace check 通过。
- 未运行运行时代码测试；本阶段仅修改规划文档。

## 推荐决策

1. Grok managed saved-account 是 credential 真相，`auth.json` 是单向 Active 镜像。
2. 普通 list 不再隐式写 secret；bootstrap/login/runtime refresh 使用显式接纳。
3. Active mirror 失败时保留新轮换 credential、返回安全错误并允许后续收敛，不回滚旧 refresh token。
4. 已经失效的历史 refresh token 不自动修复，用户可能仍需重新登录一次。

## 后续状态

主会话应保存 `implement.md` 中的 implementationPlan，并将任务转为 `awaiting_approval` 请求用户确认。用户明确批准前不得实现。

## 残余风险

- 共享 list 契约需要审计所有隐式同步调用方，并回归 OpenAI/Kiro/Antigravity。
- Grok provider lock 非重入，必须严格区分 public locked wrapper 与 internal unlocked/projector。
- 跨文件无法真正原子提交，必须保留“先保存轮换 credential、mirror 成功才返回成功、后续可收敛”的失败协议。

---

## AUTH-01 实现交接（2026-07-21）

### 已完成

- 审计了 `listOAuthAccounts` / `syncActiveOAuthAccountCredential` 的所有生产调用方：provider/accounts GET、正常 login、logout、OpenAI quota runtime refresh，以及 Grok/Kiro/Antigravity resolver、quota、failover 和 Activate 路径。
- `listOAuthAccounts()` 现在只调用无锁 `projectOAuthAccounts()`：可清理缺失 metadata 与回填安全 label，但不读取 `auth.json`，不写 credential secret。
- 新增 `readOAuthActiveAccountId()`，仅从 metadata + slot 存在性读取 Active，不读取 mirror、不写文件。
- 新增显式 credential 接纳边界：`bootstrapOAuthActiveAccountCredential()` 只在没有有效 managed Active 时从 legacy `auth.json` 建槽；`adoptOAuthActiveAccountCredential()` 仅供正常 login 与 OpenAI canonical runtime refresh 接纳当前凭据。Grok/Kiro/Antigravity 显式接纳均经 provider lock。
- 正常 login 改为显式 adopt；accounts/providers GET 仅作 legacy bootstrap；logout 在 runtime logout 后显式清理 managed Active 指针；OpenAI quota runtime refresh 改为显式 adopt，并通过 metadata helper 读取 opaque Active id。
- 已持有 Grok lock 的 delete/Activate 返回内部 projector，避免未来 list 重新引入锁语义时形成嵌套锁。
- 更新 Grok accounts / reauth 静态回归断言，检查 list 无 secret 回写与显式接纳路径。

### 验证

- `git diff --check`：通过。
- `npm run test:oauth-accounts`：未能运行；工作树未安装 `jiti`（`ERR_MODULE_NOT_FOUND`）。
- `node_modules/.bin/tsc --noEmit`：未能运行；工作树没有 `node_modules/.bin/tsc`。

### 后续边界与风险

- **GROK-01 未实现。** `lib/grok-account-token.ts` 仍需改为使用 `readOAuthActiveAccountId()`，在 provider lock 内完成 slot-first/mirror-second 提交和有效 token 的 mirror 收敛。
- 本子任务不新增 refresh/list barrier 运行时 fixture；该覆盖属于 `TEST-01`。当前改动已移除 list 的旧 mirror secret 回写源。
- 需在依赖安装完成后运行 AUTH-01 指定 OAuth/Grok/Kiro/Antigravity accounts 回归、lint 与 typecheck。

---

## GROK-01 实现交接（2026-07-21）

### 已完成

- `lib/grok-account-token.ts` 已移除对 `listOAuthAccounts()` 的依赖，改用 AUTH-01 提供的只读 `readOAuthActiveAccountId()`；resolver 不再触发 `auth.json -> slot` 的隐式 secret 回写。
- resolver 在 Grok provider lock 内重读 slot 与 Active metadata；metadata 读取失败会在调用上游 refresh 前中止。
- refresh 获得新 credential 后先原子替换 slot，再锁内复核 Active 并投影同一 credential 至 `auth.json`。非 Active slot 不触碰 mirror。
- Active mirror 写入不再是 best-effort：失败时保留已写入的轮换 credential、返回固定安全错误；后续有效 token 解析会再次尝试 mirror convergence。
- 保留既有 single-flight、forceRefresh、AbortSignal、tmp+rename 和 0600/0700 语义；未修改 `grok-account-lock.ts` 或 `web-credential-store.ts`，其现有锁/原子写契约足够支撑此实现。

### 验证

- `npm run test:grok-accounts`：通过（96 passed）。
- `npm run test:grok-global-auth`：通过（7 passed）。
- `git diff --check`：通过。
- `npm run lint`：未能运行，工作树未安装 `eslint`（command not found）。
- `node_modules/.bin/tsc --noEmit`：未能运行，工作树没有 `node_modules/.bin/tsc`。

### 后续边界与风险

- 未新增 refresh/list barrier、轮换 refresh token 或 mirror 故障恢复的生产路径 fixture；这些明确属于后续 **TEST-01**，不能仅凭当前静态/既有回归判定完整 Issue 验收。
- 跨文件 slot/mirror 提交不是数据库事务；实现按既定协议优先保留上游可能已轮换的新 slot credential，mirror 失败由后续 resolver 收敛。
- 主会话无需额外产品决策；应将 GROK-01 标为完成并继续 TEST-01，在依赖安装后补跑 lint、typecheck 与完整回归矩阵。

---

## TEST-01 实现交接（2026-07-21）

### 已完成

- 新增 `scripts/test-grok-refresh-consistency.mjs`，以临时 agent dir、jiti 和注册到生产 OAuth compat registry 的 fixture 驱动 `getGrokAccessToken()`、`listOAuthAccounts()` 与 `activateOAuthAccount()`。
- 覆盖 Active 两处提交、`R0 → R1 → R2` 轮换、refresh 持锁时 list、refresh A + Activate B、non-Active 隔离、同 storage id single-flight、上游失败零写入、损坏 metadata 的 refresh 前 fail-closed、损坏 mirror 后保留新 slot 并在下一次有效 token 路径收敛，以及 list 不序列化 sentinel secret。
- 注册 `npm run test:grok-refresh-consistency`。并发交错均由 deferred barrier 控制，未使用 sleep 竞态。

### 验证

- `npm run test:grok-refresh-consistency`：通过。
- `npm run test:grok-accounts`：通过（96 passed）。
- `npm run test:grok-global-auth`：通过（7 passed）。
- `npm run test:oauth-accounts`：通过。
- `npm run test:kiro-refresh-activate-race`：通过（4 passed）。
- `npm run test:antigravity-refresh-activate-race`：通过（4 passed）。
- `npm run lint`：通过，仓库既有 7 条 warning、无 error。
- `node_modules/.bin/tsc --noEmit`：通过。
- `node --check scripts/test-grok-refresh-consistency.mjs`、`git diff --check`：通过。

验证时临时链接了相邻工作树已有的 `node_modules`，完成后已移除；当前工作树仍未安装依赖。

### 后续边界与风险

- TEST-01 完成；DOC-01 尚未执行，未修改架构/集成/library 文档或 `checks.md` 的最终全任务验收状态。
- 本测试覆盖同进程 provider lock 与 single-flight；跨进程 `forceRefresh:true` 仍遵循设计中已知的顺序双刷新残余风险。

---

## DOC-01 实现交接（2026-07-21）

### 已完成

- 审阅 AUTH-01 / GROK-01 / TEST-01 最终代码与生产路径 fixture；文档与当前实现一致。
- `docs/architecture/overview.md` 记录 managed Grok slot 为 credential 真相、`auth.json["grok-cli"]` 为单向 Active 镜像、锁内 slot-first/mirror-second refresh，以及 mirror 部分失败的安全收敛。
- `docs/integrations/README.md` 记录 list 不回写 secret、legacy bootstrap/normal login/runtime refresh 的显式接纳边界和 Grok provider lock。
- `docs/modules/library.md` 记录 `readOAuthActiveAccountId()`、无 secret list projection、显式 bootstrap/adopt/logout helper 与锁内无副作用路径。
- `checks.md` 写入最终 focused 回归、lint、diff 与 typecheck 阻塞证据。

### 验证

- 通过：`npm run test:grok-refresh-consistency`、`test:grok-accounts`（96）、`test:grok-global-auth`（7）、`test:oauth-accounts`、`test:kiro-refresh-activate-race`（4）、`test:antigravity-refresh-activate-race`（4）、`test:kiro-accounts`（28）、`test:antigravity-accounts`（29）、`npm run lint`（0 error，7 条既有 warning）和 `git diff --check`。
- `node_modules/.bin/tsc --noEmit` 未完成有效验证：工作树无 `node_modules`；临时 `ypi-fixture-runtime/node_modules` 为 pi SDK `0.80.6`，而项目要求 `0.80.10`，产生既有 `ModelRuntime` / `CredentialInfo` 缺失类型错误。临时链接已移除，未改锁文件。

### 主会话后续

- **需要在精确锁定的 `0.80.10` 依赖环境重跑 typecheck 后才能关闭质量门禁。** 除此之外没有产品决策或实现阻塞。
- 已知残余风险保持不变：跨文件 slot/mirror 不是数据库事务；跨进程 `forceRefresh:true` 可能顺序刷新两次；历史上已被旧版本回退并作废的 refresh token 仍需重新登录。
