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
| UI 门禁 | 通过 | 无页面/交互/文案变更；`ui.md` 判定正确 |

## 代码审查重点

### 1. 旧 token 回写竞态（Issue 根因）

- 根因路径已拆除：`listOAuthAccounts()` 不再调用会把 `auth.json` secret 写回 existing slot 的同步逻辑。
- Grok resolver 改用 `readOAuthActiveAccountId()`，该 helper 只读 metadata + slot 存在性，不读 mirror、不写文件。
- 即使外部 list 与 refresh 交错，list 也没有 secret 写路径，因此无法再执行 `auth C0 -> slot C0`。

### 2. 锁与非重入

- Grok refresh / Activate / reauth / bootstrap / adopt / clearActive 均经 provider lock。
- 已持锁 mutation（delete/Activate）返回 `projectOAuthAccounts()`，不再回调可能未来重新加锁的 public list。
- Grok resolver 锁内只调用无锁 metadata helper 与 CredentialStore，未嵌套 `withGrokProviderLock`。
- 未发现 Grok 路径上的非重入死锁模式。

### 3. Active / non-Active / mirror 协议

- Active refresh：slot 原子写 C1 → 复核 Active → mirror C1；mirror 失败抛固定安全错误且不回滚 slot。
- valid-token 路径调用 `mirrorActiveCredentialIfActive`，可修复 `slot=C1 / mirror=C0` 中间态。
- non-Active：CAS 返回 false，不写 mirror。
- 刷新前读取 Active metadata：metadata JSON 损坏时 `readJsonFile` 抛 store error，fixture 验证不会消费 refresh token。

### 4. 显式接纳边界

- `bootstrapOAuthActiveAccountCredential`：仅无有效 managed Active 时从 auth 建槽。
- `adoptOAuthActiveAccountCredential`：login 与 OpenAI canonical runtime refresh 显式替换/接纳。
- `clearOAuthActiveAccount`：logout 后清理 managed Active 指针；mirror 清理仍由 `runtime.logout(provider)` 负责。
- 生产路径已无 `syncActiveOAuthAccountCredential` 引用。

### 5. 测试真实性

- 新增 `scripts/test-grok-refresh-consistency.mjs` 使用临时 `PI_CODING_AGENT_DIR`、jiti、生产 `getGrokAccessToken` / `listOAuthAccounts` / `activateOAuthAccount`，以及注册到兼容 OAuth registry 的 fixture。
- 并发用 deferred barrier，无 sleep 竞态。
- 覆盖 AC 主路径与 secret 序列化边界，不是纯源码字符串断言。

### 6. Secret / 隐私

- list 摘要、固定错误文案、测试断言均避免 access/refresh/path/上游正文泄漏。
- 未发现新增 token 日志。

### 7. 文档

- overview / integrations / library 已与“slot 真相 + 单向 mirror + 显式接纳 + slot-first/mirror-second + 部分失败收敛”一致，不再宣称未满足的 list 隐式同步语义。

## Findings Fixed

None（检查员未改生产代码）。

## Remaining Findings

### 非阻塞

1. **`test:grok-all` 未纳入 `test:grok-refresh-consistency`**  
   聚焦脚本已注册为独立 npm script，但聚合 `test:grok-all` 仍不包含它。建议后续小改把该脚本加入聚合，避免回归被遗漏。不影响本 Issue 正确性。

2. **Activate-first 并发顺序未单独 barrier 测试**  
   现有测试覆盖 refresh-started-then-Activate 与后续 non-Active refresh；因共享非重入 provider lock，Activate-first 在语义上等价于串行 Activate 后 non-Active refresh。可接受残余。

3. **跨文件提交非数据库事务 / 跨进程 `forceRefresh` 仍可能顺序双刷新 / 历史已作废 token 不自动修复**  
   与设计与 `checks.md` 残余风险一致，不构成合入阻塞。

4. **Kiro/Antigravity resolver 仍可 fallback 到 `listOAuthAccounts`**  
   本 Issue 范围外；且 list 已无 secret 回写，风险已降低。不必在本任务扩大重构。

### 阻塞

None。

## Verification

在临时链接相邻工作树 `node_modules`（`@earendil-works/pi-*@0.80.10`，与本项目 pin 一致）后执行；完成后已移除链接，未改锁文件。

| 命令 | 结果 |
| --- | --- |
| `npm run test:grok-refresh-consistency` | 通过 |
| `npm run test:grok-accounts` | 通过（96） |
| `npm run test:grok-global-auth` | 通过（7） |
| `npm run test:oauth-accounts` | 通过 |
| `npm run test:kiro-refresh-activate-race` | 通过（4） |
| `npm run test:antigravity-refresh-activate-race` | 通过（4） |
| `npm run test:kiro-accounts` | 通过（28） |
| `npm run test:antigravity-accounts` | 通过（29） |
| `npm run test:grok-reauth` | 通过（58） |
| `npm run lint` | 通过（0 error；7 条既有 warning，与本改动无关） |
| `node_modules/.bin/tsc --noEmit` | 通过（0.80.10） |
| `git diff --check` | 通过 |

此前 DOC-01 用 `0.80.6` fixture 的 typecheck 失败不复现；在正确 `0.80.10` 依赖下 typecheck 已通过。

## Verdict

**Pass**

Issue #12 根因（Active refresh 后 `listOAuthAccounts` 隐式 `auth.json -> slot` 回写旧 secret）已从 store 与 Grok resolver 双侧消除；锁分层、Active/non-Active、mirror 失败保留轮换 credential 并可后续收敛、生产路径聚焦测试与跨 provider 回归均满足 PRD/Design/Checks。无阻塞问题；主会话可进入用户验收/收尾，无需返工实现。
