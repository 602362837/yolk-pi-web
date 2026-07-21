# Checks：Issue #12 OAuth Active 凭据边界与刷新一致性

## 检查目标

证明实现同时满足：

1. 读取边界无副作用；
2. bootstrap/adopt/clear语义不混淆；
3. Grok slot authority与PR #13不回退；
4. refresh token轮换、并发Activate/list与mirror失败可验证；
5. API/wire/其他provider无回归；
6. secret、路径和raw upstream内容不泄漏。

## 需求覆盖矩阵

| Check | 对应需求 | 检查方法 | 通过标准 |
| --- | --- | --- | --- |
| C-01 | R1 | 临时目录调用Active reader；hash/mtime/fetch/fixture计数 | 只返回id/null，文件与计数不变 |
| C-02 | R2 | valid slot + stale mirror；legacy auth-only；重复bootstrap | valid slot不被覆盖；legacy只建一次Active slot |
| C-03 | R3 | persistent login与OpenAI runtime refresh后adopt | slot/mirror同版本，opaque id/label保留 |
| C-04 | R4 | lock-held logout；注入logout/metadata失败 | 成功后mirror无、Active null、slots在；失败不虚报success |
| C-05 | R5 | 四provider list前后bytes/mtime；stub fetch/refresh | zero-write、zero-network、无auth读取、wire无secret |
| C-06 | R6 | route/caller检索+focused tests | production无旧sync；active-only caller用reader |
| C-07 | R7 | 与`88d9756`对比、PR #13 suites | transaction/lock/coordinated store保持且全绿 |
| C-08 | R8 | mirror失败后恢复旧mirror，再普通valid read | slot保留R1；mirror修复R1；无第二次refresh |
| C-09 | R9 | deferred barrier生产路径脚本 | list/Activate/rotation/single-flight/失败矩阵通过 |
| C-10 | R10 | docs/source双向检索 | 文档无旧sync/list副作用陈述 |

## 自动测试设计

### A. `test:grok-refresh-consistency`

测试环境：

- `mkdtemp()`创建独立 agent dir；动态import前设置 `PI_CODING_AGENT_DIR`。
- fixture `grok-cli` OAuth provider；不访问xAI。
- credential版本使用 sentinel `C0/R0 -> C1/R1 -> C2/R2`。
- deferred barrier明确控制refresh开始/释放；竞态核心不使用sleep。
- 使用真实：
  - `saveOAuthAccountCredential`
  - `activateOAuthAccount`
  - `listOAuthAccounts`
  - `getGrokAccessToken`
  - raw WebCredentialStore / PR #13 transaction。

#### A1. Active基础提交

- seed A=C0/R0并Activate。
- forced refresh返回C1/R1。
- assert slot=A:C1/R1、mirror=A:C1/R1、Active=A。

#### A2. 一次性token轮换

- 再次forced refresh。
- fixture记录输入必须是R1，不是R0。
- 输出slot/mirror=C2/R2。

#### A3. refresh与list

- barrier卡在upstream refresh。
- 调用真实list；捕获metadata/slot/auth bytes与mtime。
- list不能写旧mirror到slot；释放后最终slot/mirror一致。
- list输出不含sentinel。

#### A4. refresh A → Activate B

- refresh A先进入barrier；Activate B排队。
- 释放后两者完成。
- 最终Active/mirror=B；A slot保留轮换后的R1。

#### A5. Activate B → refresh A

- 先确保B Active。
- forced refresh A。
- assert A slot更新；Active/mirror仍B。

#### A6. single-flight

- 两个同A forced caller共享一个held flight。
- upstream refresh count=1；结果token相同。
- 普通flight不能吞掉后续forced refresh的PR #13测试继续保留。

#### A7. upstream失败

- fixture在返回credential前抛固定错误。
- slot/auth bytes保持不变；错误不含sentinel/raw body/path。

#### A8. mirror失败与收敛

- 让Active A refresh完成slot写后，注入malformed/unwritable auth使mirror失败。
- assert slot=R1且不回滚，调用返回固定安全错误。
- 恢复一个可读但旧版本R0 mirror。
- 调用普通、token仍有效的`getGrokAccessToken(A)`。
- assert mirror=R1、slot仍R1、refresh count不增加。
- 若期间Activate B，则A read不得覆盖B mirror。

#### A9. pure list与secret边界

- serialize list/error/output；不得出现access/refresh/idToken/projectId/clientSecret sentinel或绝对路径。

### B. OAuth store tests

对 OpenAI/Grok/Kiro/Antigravity分别覆盖：

- `readOAuthActiveAccountId` metadata-only；
- list不修改metadata、credential、auth；
- list不调用fetch/backfill/refresh；
- missing slot只在projection中过滤，磁盘metadata不变；
- safe local display hint仅在mutation持久化；用户label与disabled状态保留；
- bootstrap valid-slot优先；legacy auth-only幂等；
- adopt现有slot/新slot；invalid mirror不清Active；
- clear保留slots。

### C. Route与call-site tests

- accounts GET：bootstrap在list前，错误映射不泄漏。
- providers GET：单provider bootstrap失败不阻断其他provider。
- login：
  - provider-wide → adopt required；
  - add → save only；
  - Grok reauth →专用transaction；
  - active reauth才reload。
- logout：runtime.logout callback在clear lock scope内；成功后reload。
- Activate/delete：无旧sync。
- OpenAI quota：runtime refresh → adopt → Active reader。
- Grok/Kiro/Anti active quota/token/failover：active-only路径用reader；candidate路径仍用pure list。

## 静态检查

```bash
rg -n "syncActiveOAuthAccountCredential" app lib scripts docs
rg -n "listOAuthAccounts" app lib | sort
rg -n "readOAuthActiveAccountId|bootstrapOAuthActiveAccountCredential|adoptOAuthActiveAccountCredential|clearOAuthActiveAccount" app lib scripts docs
rg -n "backfillLabel|fetchOpenAICodexAccountLabel" lib/oauth-account-providers.ts lib/oauth-accounts.ts
rg -n "withGrokProviderLock|commitGrokCredentialUnderLock|createGrokCoordinatedCredentialStore" lib/grok-*.ts
```

检查员逐个解释保留的 list caller为何需要完整账号列表。production旧sync引用必须为0；若保留adapter remote backfill函数，也不得由list调用。

## 必跑命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-refresh-consistency
npm run test:grok-refresh-race
npm run test:grok-accounts
npm run test:grok-global-auth
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

不得直接运行 `next build`。无法运行时必须记录具体环境阻塞，不得写“预计通过”。

## 人工审查

### 锁与死锁

- Grok/Kiro/Anti public mutation只获取一次provider lock。
- lock-held代码只用raw WebCredentialStore。
- 锁序固定provider → auth。
- `clearOAuthActiveAccount`的logout callback不会调用再次获取同一provider lock的decorator方法。
- list/read不拿写锁。

### 数据方向

- 搜索所有mirror → slot路径；只允许bootstrap/adopt两处显式入口。
- Grok normal refresh/reconcile必须始终slot → mirror。
- non-Active refresh不写mirror。
- logout不删除saved slots。

### Secret / error

- API、SSE、日志、throw message、test output无token/refresh/projectId/clientSecret/raw body/path。
- list wire保持现有allowlist。
- malformed metadata/auth fail closed，不把空对象写回。

### PR #13保护

对比 `88d9756`与最终diff：

- `commitGrokCredentialUnderLock`仍slot-first。
- `GrokCoordinatedCredentialStore.modify`仍lock-time reread。
- live PID lock不被steal。
- force/non-force flight语义不变。
- existing `test:grok-refresh-race`未被弱化。

## 手工 API smoke（无需UI变更）

使用测试agent dir/fixture provider：

1. legacy auth-only → accounts GET：出现一个Active账号。
2. 第二次GET：账号数不增加、slot/mirror不变。
3. Activate B：Active标记切到B，provider status/quota仍按原wire返回。
4. logout：列表保留A/B但均非Active；provider loggedIn=false。
5. 重新Activate A：恢复Active并reload live auth。

不使用真实用户token，不要求真实xAI/OpenAI登录。

## 回归风险

- list移除远程OpenAI label backfill后，遗留未持久化label可能显示masked id；不得为保持标签重新在list引入网络/写入。
- cross-file更新不是数据库事务；任何partial failure必须返回错误并可重试，不能承诺强事务。
- 两个明确跨进程force请求仍可能顺序refresh两次；不属于本Issue关闭门槛。
- 已被上游作废的历史refresh token无法通过本地一致性修复恢复。

## Checker Verdict 门槛

只有以下全部满足才可 Pass：

- R1–R10均有证据；
- PR #13未回退；
- 新consistency与现有race测试都通过；
- lint/tsc通过；
- 四provider list无副作用；
- logout成功态一致；
- 无secret泄漏；
- docs与source一致。

任何旧sync生产引用、list写路径、mirror→slot非显式调用、Grok锁嵌套、mirror失败回滚slot、或新测试未纳入`test:grok-all`均为阻塞问题。
