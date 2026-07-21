# Brief：Issue #12 OAuth Active 凭据边界与刷新一致性

## 任务结论

在当前最新 `main`（`3b8285c`，包含已合入的 PR #13 / `88d9756`）上补齐 OAuth Active 的显式生命周期边界，不复用已关闭 PR #14 的源分支，不回退或重写 PR #13 已建立的 Grok managed Active slot、provider lock、coordinated CredentialStore 与 slot-first transaction。

本阶段只产出规划，不修改生产代码，不 commit / push / merge。

## 用户目标

- 让 `listOAuthAccounts()` 成为所有受支持 OAuth provider 的只读、无副作用投影。
- 明确区分：
  - `readOAuthActiveAccountId()`：只读 Active 元数据；
  - `bootstrapOAuthActiveAccountCredential()`：仅处理 legacy `auth.json` → managed slot 初始化；
  - `adoptOAuthActiveAccountCredential()`：仅在已知成功的 provider-wide login / canonical runtime refresh 后接纳 Active mirror；
  - `clearOAuthActiveAccount()`：在 logout 临界区内清理 managed Active。
- 替换 accounts/providers GET、login、logout、subscription quota 及仅为读取 Active 而调用 list 的路径。
- 用真实生产路径测试证明 Grok 在并发列表、Activate、refresh-token 轮换及 mirror 写失败后不会回退旧 credential，并可在后续协调读取中收敛。

## 当前 main 证据

### 已由 PR #13 提供，必须保留

- `lib/grok-credential-transaction.ts`
  - `commitGrokCredentialUnderLock()` 先原子写 managed slot，再复核 Active pointer，最后写 `auth.json` mirror。
  - mirror 失败不回滚已轮换的 slot。
- `lib/grok-active-credential-store.ts`
  - file-backed ModelRuntime 的 Grok refresh 使用 shared provider lock 与 lock-time Active-slot reread。
- `lib/grok-account-token.ts`
  - managed refresh 使用同一 slot-first transaction；force/non-force single-flight 已处理。
- `lib/grok-account-lock.ts`
  - process + cross-process provider lock；锁顺序为 Grok provider → `auth.json`。
- `scripts/test-grok-refresh-race.mjs`
  - 已覆盖 SDK/managed 同时刷新、跨进程、mirror failure 保留 slot、refresh 与 Activate 的基础竞态。
- `lib/oauth-accounts.ts`
  - Grok list 已不再调用 `syncActiveOAuthAccountCredential()`；存在有效 Grok Active slot 时旧 mirror 不再覆盖 slot。

### 仍存在的边界问题

1. `syncActiveOAuthAccountCredential()` 仍同时承担 bootstrap、adopt、失效清理，调用意图不明确。
2. `listOAuthAccounts()` 对 Grok 之外的 provider 仍隐式 sync；所有 provider 的 list 仍可能：
   - 读 `auth.json`；
   - 写 credential / metadata；
   - 清 Active；
   - 通过 label backfill 读 secret、发网络请求并写 metadata。
3. accounts/providers GET、provider-wide login、OpenAI quota refresh 仍依赖旧 sync。
4. logout 只删除 `auth.json`，未清 `accounts.json.activeAccountId`；Grok coordinated read 仍可能从 slot 恢复已登出的 Active。
5. 多个 quota/token/failover helper 为了只取 Active id 调用完整 list。
6. 当前 mirror failure 测试证明“slot 不回滚”，但未证明恢复旧 mirror 后无需再次消费 refresh token即可收敛到 slot。

## Issue / PR 上下文

- Issue #12：<https://github.com/602362837/yolk-pi-web/issues/12>
- PR #13 已合入：`88d9756`，是本设计的基线，不能回退。
- PR #14 已关闭且未合入：仅用于理解命名和意图；其 `pi/20260721-103727` 分支不得 rebase/强推/复用。
- 当前实现必须从最新 `main` 新分支开始，按当前 source 重写。

## 范围边界

### 范围内

- OAuth saved-account core 边界及调用点。
- Grok mirror repair 的窄幅补强与专项测试。
- 现有 route wire 不变的后端接线。
- architecture / integration / API / library 文档。

### 范围外

- 页面、组件、文案或交互变化。
- OAuth metadata schema、opaque account id、Session JSONL 迁移。
- 新 provider、新登录方式、新账号调度策略。
- 重做 Kiro/Antigravity refresh transaction。
- 自动修复已经被上游作废的历史 refresh token。
- PR #14 分支或归档任务内容的代码复用。

## UI Gate

**不适用。** 本任务不改变页面、前端功能、交互、审批体验或用户可见信息结构；无需 UI 设计员和 HTML 原型。现有 API wire 与 Models/usage UI 保持不变。

## 推荐决策

1. `listOAuthAccounts()` 定义为 metadata-first 只读投影：不读 `auth.json`、不写任何文件、不刷新 token、不发网络请求；缺失 slot 只在返回值中过滤，不做磁盘修复。
2. label/display hint 在 save/bootstrap/adopt/import 等显式 mutation 中尽量从 credential 本地安全字段派生并持久化；保留用户 label。遗留无 label 项继续使用 masked id，不在 list 中做网络 backfill。
3. `clearOAuthActiveAccount()` 接受/包裹 runtime logout callback，使 `runtime.logout()` 与清 Active pointer 位于同一 provider lock 内；避免“先 logout、后拿锁”的刷新窗口。
4. login/adopt 是成功条件，不应 `.catch(() => {})` 静默吞掉；providers GET 的 legacy bootstrap 可按 provider best-effort 隔离，accounts GET 则显式返回 store 错误。
5. Grok mirror 修复只复用 PR #13 transaction/lock：Active slot 未变化且 mirror 不一致时，在 provider lock 下以 slot 单向修复 mirror；绝不执行 mirror → slot。

## 未决问题

无产品决策阻塞。主会话只需审批本计划，并通过 Studio 正式保存 implementation plan、转入 `awaiting_approval`；批准前不得实现。
