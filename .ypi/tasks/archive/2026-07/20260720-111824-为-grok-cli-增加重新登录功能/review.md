# Grok CLI 重新登录 — 最终严格复检（GROK-REAUTH-07）

## Check Complete

已独立读取当前 `git diff --stat` / `--name-only`、`handoff.md`，并复核 `lib/grok-subscription-quota.ts`、`lib/oauth-account-grok.test.ts` 和 `scripts/run-oauth-account-tests.mjs`。

当前工作区包含实际生产实现和测试改动：OAuth SSE route、Models/Top-bar UI、账号持久化/refresh、Grok quota generation/lock，以及 OAuth-account runner 和行为测试；另有未跟踪的 `lib/grok-account-lock.ts`、`lib/grok-login-errors.ts`、`scripts/test-grok-reauth.mjs`。不是仅文档或声明性改动。

### R9 复核

`queryGrokBilling()` 的 live success、billing error/stale、token-unavailable stale 和 unexpected-error stale 发布路径，均通过 `finalizeCurrentGeneration()` 获取 Grok provider lock 后才比较 generation；内存写入、持久化读写和结果构造均在该临界区内。重新授权在同一锁边界中 bump generation、清内存并删除持久化 entry，因此旧 flight 若在 commit 后才可发布会被丢弃并返回无缓存结果。无 mutation 的 fresh-memory 快路径没有 `await`，不能在读取与返回间被 JS 事件循环中的 reauth 插入。

`lib/oauth-account-grok.test.ts` 用 deferred fetch 对 live success 和 503/stale 做可控交错：flight 已启动后才 bump generation 并删除磁盘缓存，随后断言旧 flight `cache.state === "none"` 且 entry 未恢复；后续请求断言重新 fetch 的新值。token-failure stale 同样以 provider lock 队列控制交错，并断言没有 stale 返回或磁盘回写。测试不再只是 generation helper 调用。runner 也会 await Grok 测试导出的 completion promise，避免临时 `PI_CODING_AGENT_DIR` 被下一个 suite 提前替换。

## Findings Fixed

- **R9 old-flight memory/result/persisted-cache race：已关闭。**
- **OAuth-account runner 未 await Grok async test：已关闭。**
- **可控 quota race 行为覆盖不足：已关闭。**

## Remaining Findings

### Blocking

1. **审批硬门禁仍未满足。** 自包含 `grok-cli-reauth-prototype.html` 已存在，但没有用户明确批准该原型及 `plan-review.md` 四项产品决策的记录；`plan-review.md` 仍写明未批准前不得实现。主会话必须取得并记录明确审批，不能由实现或本次测试推定。

### Residual risk

- 未执行需用户同意及测试 Grok 账号的真实 OAuth/browser UAT（Browser PKCE、Device Code、Existing Grok Build、standalone/aggregate Top-bar、375px、键盘/焦点）。这是验收缺口，不是本轮自动化失败。

## Verification

- `git diff --stat && git diff --name-only` — 24 个已跟踪文件有实际改动；另有 3 个未跟踪实现/测试文件。
- `git diff --check` — pass.
- `npm run test:oauth-accounts` — pass；storage、Grok、Kiro、Kiro token 四个临时 store suites 全部通过。
- `npm run test:grok-all` — pass；provider 39、reauth 58、accounts 96、quota 48、session isolation 24、global auth 7、failover adapter 29、failover runtime 9，且 OAuth-account runner 通过。
- `npm run lint` — pass；0 errors，7 个既有 warnings。
- `node_modules/.bin/tsc --noEmit` — pass (exit 0).

## Verdict

**Needs work (approval gate only).** GROK-REAUTH-07 的 R9 实现和测试 runner/race coverage 已通过严格复检与实际命令验证；没有发现新的代码 blocker。等待主会话补齐并记录用户审批，以及后续在获准测试环境执行 UAT。
