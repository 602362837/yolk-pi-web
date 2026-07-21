# Brief：修复 Grok 活跃账号刷新后的凭据回退（Issue #12）

## 1. 任务来源与目标

- Issue：[602362837/yolk-pi-web#12](https://github.com/602362837/yolk-pi-web/issues/12)
- 类型：OAuth 凭据一致性缺陷 / 数据写入竞态
- 目标：Grok 活跃账号成功刷新 token 后，保证该账号的 saved-account 凭据文件与 `auth.json["grok-cli"]` 都保留同一份最新凭据，旧 `auth.json` 快照不得覆盖刚写入的新 access/refresh token。
- 用户价值：避免一次性或已轮换 refresh token 被旧值恢复，消除“刷新成功后立即又过期/要求重新登录”的故障。

Issue 已被仓库 Owner 采纳并标记为 `bug`；本阶段只完成需求理解与证据归档，不修改生产代码。

## 2. 已核对材料

- `AGENTS.md`
- `docs/integrations/README.md`
- `docs/architecture/overview.md`（Web CredentialStore、Grok global Active、token refresh/CAS）
- `docs/modules/library.md`
- `docs/modules/api.md`
- `docs/standards/code-style.md`
- `lib/grok-account-token.ts`
- `lib/oauth-accounts.ts`
- `lib/grok-account-lock.ts`
- `lib/kiro-account-token.ts`
- `lib/antigravity-account-token.ts`
- `lib/oauth-account-grok.test.ts`
- `scripts/test-grok-accounts.mjs`
- `scripts/test-grok-global-auth.mjs`

## 3. 当前数据模型与约束

Grok 多账号状态分布在三个持久化位置：

1. `~/.pi/agent/auth-accounts/grok-cli/accounts.json`
   - 仅保存元数据和 `activeAccountId`；不得含 token。
2. `~/.pi/agent/auth-accounts/grok-cli/<opaque-storage-id>.json`
   - 保存该槽位完整 OAuth 凭据。
3. `~/.pi/agent/auth.json["grok-cli"]`
   - 保存全局 Active 的 Pi 凭据镜像，供当前/后续 ModelRuntime 认证使用。

既有不变量：

- `accounts.json.activeAccountId` 是已管理账号的 Active 指针。
- 非 Active 账号刷新不得覆盖 `auth.json` 中当前 Active 的凭据。
- Active 账号刷新完成后，saved-account 文件与 `auth.json` 应收敛到同一新版本。
- token refresh、Activate、reauth 已通过 `withGrokProviderLock()` 串行化；锁内仍必须避免调用会把旧镜像反向写入账号文件的读取接口。
- 凭据文件继续使用同目录临时文件 + `rename` 原子替换、目录 `0700`、文件 `0600`。
- 不记录、不返回 access/refresh token；错误信息不得带原始凭据、上游响应或绝对路径。
- 不迁移、不重写历史 Session JSONL，不改变 opaque storage id、账号元数据或 API wire contract。

## 4. 根因证据

### 4.1 确定性覆盖链路

`lib/grok-account-token.ts` 当前流程：

1. `refreshGrokCredential()` 从 OAuth provider 得到 `newCredential`。
2. 第 173–175 行先把 `newCredential` 原子写入 `<storage-id>.json`。
3. 第 178 行调用 `mirrorActiveCredentialIfActive()`。
4. `mirrorActiveCredentialIfActive()` 第 116 行调用 `listOAuthAccounts("grok-cli")` 判断 Active。

`lib/oauth-accounts.ts` 当前流程：

1. `listOAuthAccounts()` 第 658 行先调用 `syncActiveOAuthAccountCredential()`。
2. `syncActiveOAuthAccountCredential()` 第 578 行读取此时仍为旧版本的 `auth.json["grok-cli"]`。
3. 第 586–590 行根据 Active 元数据定位同一 storage id，并通过 `saveOAuthAccountCredential()` 把旧凭据写回 `<storage-id>.json`。
4. 返回 Grok refresh 路径后，`mirrorActiveCredentialIfActive()` 才用新凭据更新 `auth.json`。

因此成功调用后的可观察终态可能是：

```text
<storage-id>.json = 旧凭据 C0
 auth.json[grok-cli] = 新凭据 C1
```

现有 CAS 只检查“刷新目标是否仍为 Active”，没有保护“新账号文件不得被旧 Active 镜像反向覆盖”。`listOAuthAccounts()` 名称看似读取，实际上包含 `auth.json -> saved-account` 写入副作用，是本缺陷的直接触发点。

### 4.2 并发风险

即使仅移除 Grok mirror 内部对 `listOAuthAccounts()` 的调用，外部账号列表读取仍可能在刷新窗口并发执行同一同步副作用：

```text
refresh: 写入账号文件 C1
list:    读取 auth.json C0
list:    写回账号文件 C0
refresh: 写入 auth.json C1
```

`listOAuthAccounts()` / `syncActiveOAuthAccountCredential()` 当前不自动取得 Grok provider lock。因此验收不能只覆盖顺序单测，还必须覆盖刷新与账号列表读取并发的交错。

### 4.3 可借鉴实现

Kiro 与 Antigravity token resolver 都优先直接读取 provider 的 `accounts.json.activeAccountId`，避免在正常 CAS 路径调用带同步副作用的 `listOAuthAccounts()`。但它们在 metadata 缺失/解析失败时仍回退到 `listOAuthAccounts()`；因此可以借鉴“直接读取 Active 元数据”的方向，不能无审查地复制带副作用 fallback。

## 5. 复现路径

### 5.1 最小确定性复现

前置状态：

- Grok saved-account 中有账号 `A`，且 `accounts.json.activeAccountId = A`。
- `A.json` 与 `auth.json["grok-cli"]` 均为旧凭据 `C0`。
- `C0` 已过期或调用 `forceRefresh: true`。
- mock OAuth refresh 返回 `C1`，其中 access、refresh、expires 与 `C0` 可区分。

步骤：

1. 调用 `getGrokAccessToken(A, { forceRefresh: true })`。
2. mock provider 返回 `C1`。
3. 等待调用成功。
4. 分别读取 `A.json` 与 `auth.json["grok-cli"]`。

当前预期复现：返回 token 来自 `C1`，`auth.json` 为 `C1`，但 `A.json` 被恢复为 `C0`。

业务层复现：下一次从 `A.json` 解析凭据并刷新时仍使用 `C0.refresh`；若 provider 使用 refresh-token rotation/一次性 refresh token，则第二次刷新失败并进入重新登录状态。

### 5.2 必须覆盖的并发复现

- 刷新 `A` 时并发调用 `listOAuthAccounts("grok-cli")`，控制时序使列表读取拿到旧 `auth.json` 快照；最终两处必须仍为 `C1`。
- 刷新 `A` 时 Activate `B`：最终 Active 必须是 `B`，`auth.json` 必须是 `B` 的凭据，`A.json` 必须保留刷新后的 `C1`，不得覆盖 `B` 或回退 `A`。
- 同一账号并发刷新：继续满足 single-flight；不得出现旧 refresh token 的后写覆盖。
- 非 Active 账号刷新：仅更新该账号文件，不改变 `auth.json` 当前 Active。

## 6. 范围

### 范围内

- Grok active-account 判定与 token refresh 持久化顺序/协调。
- `listOAuthAccounts()` 的 `auth.json -> saved-account` 同步副作用与 Grok refresh 的并发边界。
- Active / non-Active / Activate 交错 / 一次性 refresh token 场景的自动回归测试。
- 必要的 Grok OAuth 架构与 library 文档修正，确保文档不再宣称一个实际未满足的 CAS 不变量。

### 范围外

- UI、交互、文案或 API response shape 变更。
- Grok OAuth 登录/重新登录流程改版。
- 配额接口、自动 failover 策略、ModelRuntime live reload 行为改版。
- 批量迁移已有凭据、删除账号、改动 opaque storage id。
- 修改 Kiro/Antigravity 行为；可审计同类 fallback 风险，但若需跨 provider 重构，应在 Design 阶段明确影响面和回归矩阵，不应隐式扩大本 Issue。
- 修复历史上已经失效的一次性 refresh token；此类账号仍可能需要用户重新登录，修复只保证后续成功刷新不再被旧值覆盖。

## 7. 验收标准

1. **确定性一致性**：Active Grok 账号从 `C0` 成功刷新到 `C1` 后，账号文件与 `auth.json["grok-cli"]` 均包含 `C1`；不得残留 `C0.access` / `C0.refresh`。
2. **轮换 token 可持续**：mock provider 令 `C0.refresh` 仅可使用一次并返回 `C1.refresh`；后续刷新必须使用 `C1.refresh`，不能再次提交 `C0.refresh`。
3. **列表读取竞态安全**：刷新与 Grok 账号列表读取受控交错后，最新账号凭据不得被列表同步的旧 `auth.json` 快照覆盖。
4. **Activate 竞态安全**：刷新 A 与 Activate B 并发后，`accounts.json.activeAccountId`、`auth.json` 和 A/B 账号文件形成合法终态；非 Active 刷新不得抢回 Active。
5. **single-flight 保持**：同一 storage id 的并发刷新仍只触发一次上游刷新；不同账号保持既有隔离语义。
6. **失败安全**：上游刷新失败时不得破坏原账号文件或 Active 镜像；镜像/元数据读取失败不能把未知或旧凭据覆盖到新文件。
7. **存储与隐私保持**：凭据文件 `0600`、目录 `0700`、原子替换不退化；测试和运行日志不输出 token、原始 OAuth payload 或绝对凭据路径。
8. **兼容性**：不改变现有 OAuth accounts API、账号元数据 schema、opaque id、Grok quota/failover 调用契约；OpenAI Codex、Kiro、Antigravity 既有测试不回归。
9. **验证通过**：至少通过聚焦 Grok 凭据一致性测试、`npm run test:grok-accounts`、`npm run test:grok-global-auth`、`npm run lint`、`node_modules/.bin/tsc --noEmit`；涉及共享 `oauth-accounts.ts` 时追加 `npm run test:oauth-accounts` 及 Kiro/Antigravity refresh-activate race 测试。

## 8. UI 原型门禁判断

**不触发 UI 原型门禁。**

本任务修复服务端 OAuth 持久化与并发一致性，不新增页面、前端功能、交互、审批/确认体验或用户可见信息结构；成功行为只是不再出现错误的重新登录状态。因此本阶段不派发 `ui-designer`，也不需要 HTML 原型。若后续范围扩展为新增“凭据已修复/冲突”提示或人工恢复入口，必须重新判定为 UI 变更并补走 HTML 原型与用户审批。

## 9. 设计阶段待确认点（非 intake 阻塞）

1. **推荐边界**：优先采用 Grok 锁内、无副作用的 Active 元数据读取，并同时封住并发 `listOAuthAccounts()` 旧快照回写窗口；仅替换 mirror 内的一次调用不足以满足 Issue 建议的并发测试。
2. **共享层处理策略**：需要决定是为 OAuth store 提供明确的“只读 Active 元数据”内部契约，还是仅在 Grok resolver 内部读取 `accounts.json`。推荐共享的 server-only helper，避免 Grok/Kiro/Antigravity 各自解析 metadata schema；但不得让普通读取再次隐式同步旧凭据。
3. **异常策略**：Active 元数据缺失/损坏时应 fail closed（跳过 `auth.json` mirror 并保留新账号文件），还是尝试 legacy reconciliation。推荐刷新 CAS 路径 fail closed，避免以一致性恢复之名回写旧秘密；legacy 导入/同步应保留在显式边界。
4. **故障可见性**：当前 mirror 是 best-effort 且吞掉错误。是否维持“刷新成功、镜像稍后恢复”的语义，需在 Design 中结合一致性承诺评估；无论选择如何，都不能允许成功返回后账号文件被回退。

当前需求与根因足够明确，可以进入 PRD/Design 规划；以上是方案取舍，不要求用户补充产品意图。
