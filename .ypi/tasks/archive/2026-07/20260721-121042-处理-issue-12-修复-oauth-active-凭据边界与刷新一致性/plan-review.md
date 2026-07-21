# Plan Review：Issue #12 OAuth Active 凭据边界与刷新一致性

## 审批摘要

建议在当前最新 `main`（`3b8285c`，已含 PR #13 / `88d9756`）上实施 Issue #12 的剩余修复：把 OAuth Active 的读取、legacy bootstrap、显式 adoption 和 logout clear 拆成具名边界，并让 `listOAuthAccounts()` 对全部 provider成为无副作用投影。

**不复用已关闭 PR #14 的 `pi/20260721-103727` 分支，不 cherry-pick / hard rebase；不回退 PR #13。**

## PRD

详见 [prd.md](./prd.md)。

核心验收：

1. `readOAuthActiveAccountId` 不读 credential内容/`auth.json`，不写、不联网。
2. `bootstrapOAuthActiveAccountCredential` 仅在没有有效 managed Active slot时从legacy mirror建slot；旧mirror不能覆盖valid slot。
3. `adoptOAuthActiveAccountCredential` 只用于成功的provider-wide login/canonical runtime refresh；失败不能虚报success。
4. `clearOAuthActiveAccount` 在provider lock内包裹SDK logout并清Active pointer，保留saved slots。
5. `listOAuthAccounts` 对OpenAI/Grok/Kiro/Antigravity均不读`auth.json`、不写文件、不refresh、不做remote label backfill。
6. accounts/providers GET、login、logout、subscription quota和active-only callers全部按意图接线；production旧sync引用归零。
7. Grok mirror失败保留轮换slot，恢复后下一次普通valid-token read无需再次refresh即可slot→mirror收敛。
8. 新barrier测试覆盖list/Activate并发、R0→R1→R2轮换、single-flight、zero-write和secret边界，并加入`test:grok-all`。

## UI Gate

**不适用。** 详见 [ui.md](./ui.md)。

本任务没有页面、组件、前端功能、交互、审批体验、文案或用户可见信息结构变化；API wire保持不变。因此无需UI设计员、HTML原型和原型审批。

## Design

详见 [design.md](./design.md)。

### 核心数据方向

```text
legacy auth-only --bootstrap--> managed Active slot --one-way mirror--> auth.json
successful login/runtime refresh --adopt--> managed Active slot
explicit logout --clear(lock-held logout + pointer clear)--> no Active
read/list --> no mutation
```

### PR #13保护

- 保留 `commitGrokCredentialUnderLock()` slot-first事务。
- 保留 `GrokCoordinatedCredentialStore` lock-time reread。
- 保留provider lock与`provider -> auth.json`锁序。
- 保留force/non-force flight语义及现有`test:grok-refresh-race`。
- mirror repair只做窄幅增量：valid Active slot与mirror不一致时单向修复；不整体替换Grok resolver。

### 兼容性

- route、response schema、metadata schema、opaque ids、文件布局不变。
- 无数据迁移；logout保留saved slots。
- 现有用户label保留；新safe hint在显式mutation中产生，遗留无label回退masked id。

## Implement

详见 [implement.md](./implement.md) 和 [implementation-plan.json](./implementation-plan.json)。

| ID | 内容 | 依赖 |
| --- | --- | --- |
| OAUTH-01 | 四个显式API、锁分层、全provider pure list | — |
| OAUTH-02 | routes/quota/token/failover调用点接线 | OAUTH-01 |
| OAUTH-03 | Grok mirror收敛 + barrier一致性测试 | OAUTH-01 |
| OAUTH-04 | OAuth/Grok/Kiro/Antigravity回归更新 | OAUTH-02, OAUTH-03 |
| OAUTH-05 | architecture/integration/library/API文档 | OAUTH-02, OAUTH-03 |
| OAUTH-06 | lint/tsc/focused/cross-provider/checker | OAUTH-04, OAUTH-05 |

计划为schemaVersion 2 DAG，`maxConcurrency=2`；OAUTH-02/03可并行，OAUTH-04/05可并行。

## Checks

详见 [checks.md](./checks.md)。

关键命令：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-refresh-consistency
npm run test:grok-refresh-race
npm run test:grok-accounts
npm run test:grok-all
npm run test:oauth-accounts
npm run test:kiro-accounts
npm run test:kiro-refresh-activate-race
npm run test:kiro-quota
npm run test:antigravity-accounts
npm run test:antigravity-refresh-activate-race
npm run test:antigravity-quota
git diff --check
```

测试必须使用临时agent dir与fixture provider，不访问真实OAuth网络或用户`~/.pi/agent`。

## 已知残余风险

- 跨文件slot/metadata/mirror不是数据库事务；partial failure必须报错并可重试。
- 两个明确跨进程force请求仍可能顺序各refresh一次；不属于本Issue。
- 已经被上游作废的历史refresh token不能自动恢复。
- 遗留从未持久化label的账号可能使用现有masked-id fallback；不能为此恢复list网络/写副作用。

## 回滚

只回滚本任务增量到当前`3b8285c`基线；不得回退PR #13，不删除或迁移`auth.json`、`auth-accounts/**`、Session JSONL或usage数据。

## 审批请求

请主会话先将 [implementation-plan.json](./implementation-plan.json) 保存为任务implementation plan并把任务切换到 `awaiting_approval`。用户明确批准本plan review后，才可进入实现。
