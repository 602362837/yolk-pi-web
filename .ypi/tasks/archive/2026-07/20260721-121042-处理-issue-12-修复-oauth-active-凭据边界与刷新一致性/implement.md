# Implement：Issue #12 OAuth Active 凭据边界与刷新一致性

## 实现前必须阅读

1. `AGENTS.md`
2. `docs/standards/code-style.md`
3. `docs/architecture/overview.md`
4. `docs/modules/api.md`、`docs/modules/library.md`
5. `docs/integrations/README.md`
6. 本任务 `brief.md`、`prd.md`、`design.md`、`checks.md`、`plan-review.md`
7. PR #13 当前 main 实现：
   - `lib/grok-account-lock.ts`
   - `lib/grok-active-credential-store.ts`
   - `lib/grok-credential-transaction.ts`
   - `lib/grok-account-token.ts`
   - `scripts/test-grok-refresh-race.mjs`
8. OAuth lifecycle / callers：
   - `lib/oauth-accounts.ts`
   - `lib/oauth-account-providers.ts`
   - `lib/web-credential-store.ts`
   - `lib/web-model-runtime.ts`
   - `app/api/auth/{accounts,providers,login,logout,quota}/**`
   - `lib/*subscription-quota.ts`、`lib/*account-token.ts`、`lib/*account-failover.ts`

旧 PR #14 diff仅可用于理解四个命名的意图；不得 checkout、rebase、cherry-pick或复制其旧版 `grok-account-token.ts`。所有改动以当前 main source和 PR #13 invariants为准。

## 建议执行顺序

1. 先完成 generic OAuth core边界和 pure list（OAUTH-01）。
2. OAUTH-01 local review通过后，route/caller接线（OAUTH-02）与Grok mirror收敛（OAUTH-03）可并行。
3. 两者完成后，跨provider回归更新（OAUTH-04）与文档（OAUTH-05）可并行。
4. 最后由 checker执行集成验证（OAUTH-06）。

最大并发为2；同一阶段共享文件时仍需串行合并，不能让并行实现覆盖对方改动。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 | 本地评审 |
| --- | --- | ---: | --- | --- | --- | --- |
| OAUTH-01 | foundation | 1 | 四个显式Active API、provider lock分层、全provider pure list、本地display hint | — | 否 | 是 |
| OAUTH-02 | integration | 2 | accounts/providers/login/logout/quota/token/failover调用点接线 | OAUTH-01 | 是 | 是 |
| OAUTH-03 | consistency | 2 | PR #13增量mirror repair + deferred barrier一致性测试 | OAUTH-01 | 是 | 是 |
| OAUTH-04 | tests | 3 | 更新OAuth/Grok/Kiro/Antigravity回归与聚合脚本 | OAUTH-02, OAUTH-03 | 否 | 是 |
| OAUTH-05 | docs | 3 | architecture/integration/library/API/test文档 | OAUTH-02, OAUTH-03 | 是 | 是 |
| OAUTH-06 | validation | 4 | lint/tsc/focused/cross-provider/checker门禁 | OAUTH-04, OAUTH-05 | 否 | 是 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "OAUTH-01",
      "title": "建立 OAuth Active 显式边界与纯只读账号投影",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/oauth-accounts.ts",
        "lib/oauth-account-providers.ts",
        "lib/oauth-account-storage.test.ts",
        "lib/oauth-account-grok.test.ts",
        "lib/oauth-account-kiro.test.ts",
        "lib/oauth-account-antigravity.test.ts"
      ],
      "instructions": "在当前 main 上重写 generic OAuth lifecycle，新增 readOAuthActiveAccountId、bootstrapOAuthActiveAccountCredential、adoptOAuthActiveAccountCredential、clearOAuthActiveAccount，并建立 provider lock owning public helper 与 unlocked internal primitive 的分层。read 只读 metadata/slot existence；bootstrap 仅在无 adapter-valid Active slot 时从 canonical auth mirror 建 slot；adopt 只接受已知成功 login/runtime refresh 后的 canonical mirror；clear 在 provider lock 内包裹 runtime logout callback 后清 Active pointer。将 listOAuthAccounts 改为全部 provider 的 metadata-first 纯投影：不读 auth.json、不写文件、不 refresh、不发网络、不执行 remote label backfill；missing slot只过滤响应。把安全本地 deriveDisplayHint 移到显式 save/import/bootstrap/adopt mutation，并保留用户 label/disabled semantics。若 syncActiveOAuthAccountCredential 无兼容消费者，删除实现/export。不得改变 metadata schema、opaque id、wire或 PR #13 Grok transaction。",
      "acceptance": [
        "四个具名 API 的行为与 design.md 契约一致",
        "listOAuthAccounts 对 OpenAI/Grok/Kiro/Antigravity 均 zero-write、zero-network且不读 auth.json",
        "readOAuthActiveAccountId 不打开 credential body且 missing/stale pointer 返回 null",
        "bootstrap 不允许 stale auth mirror 覆盖 valid Active slot，且重复调用幂等",
        "adopt 保留 opaque id和用户 metadata，只在显式 mutation path覆盖 Active slot",
        "clear 的 SDK logout与 pointer clear 位于同一 provider临界区",
        "用户 label不被自动 hint覆盖，遗留无 label安全回退 masked id",
        "无 provider lock非重入嵌套"
      ],
      "validation": [
        "Focused OAuth store tests in temporary PI_CODING_AGENT_DIR",
        "Before/after bytes and mtime assertions for list/read",
        "Fetch/refresh fixture call count remains zero on list",
        "Secret sentinel absence from serialized summaries"
      ],
      "risks": [
        "把 bootstrap 与 adopt 再次合并成模糊 sync",
        "list 中残留 metadata prune或remote label backfill写入",
        "Grok locked helper调用 decorated CredentialStore造成死锁",
        "遗留无 label账号显示名兼容"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "OAUTH-02",
      "title": "接线认证 routes、quota、token 与 Active-only consumers",
      "phase": "integration",
      "order": 2,
      "dependsOn": [
        "OAUTH-01"
      ],
      "files": [
        "app/api/auth/accounts/[provider]/route.ts",
        "app/api/auth/providers/route.ts",
        "app/api/auth/login/[provider]/route.ts",
        "app/api/auth/logout/[provider]/route.ts",
        "app/api/auth/accounts/[provider]/activate/route.ts",
        "lib/subscription-quota.ts",
        "lib/grok-session-account.ts",
        "lib/grok-account-failover.ts",
        "lib/kiro-account-token.ts",
        "lib/kiro-subscription-quota.ts",
        "lib/kiro-account-failover.ts",
        "lib/antigravity-account-token.ts",
        "lib/antigravity-subscription-quota.ts",
        "lib/antigravity-account-failover.ts",
        "lib/chatgpt-account-failover.ts",
        "lib/chatgpt-usage-refresh-scheduler.ts"
      ],
      "instructions": "按调用意图接线：accounts GET 先 bootstrap 再 pure list；providers GET 对每 provider best-effort bootstrap并隔离失败；普通 provider-wide login 在 managed provider上必须 adopt成功后才 reload/发送 success，add与Grok reauth保持专用语义；logout 通过 clear helper 在 provider lock 内执行 runtime.logout与pointer clear，再 reload；Activate/delete/update/import去掉旧 sync并只返回 pure list。OpenAI Active subscription quota在 canonical runtime refresh后 adopt，再用 readOAuthActiveAccountId取 opaque cache key。把仅为 activeAccountId 调用 list 的 Grok/Kiro/Antigravity quota、token、session和 failover路径替换为 read helper；需要完整候选账号时保留 pure list。保持 route/wire/status及安全错误 mapper。",
      "acceptance": [
        "production code 不再引用 syncActiveOAuthAccountCredential",
        "accounts/providers legacy auth-only状态仍能 bootstrap",
        "login adoption失败不会发送 success，Grok/Antigravity错误仍安全映射",
        "add-account与non-Active refresh不 adopt、不改变 Active",
        "logout成功后 mirror缺失、Active id为null、saved slots保留",
        "OpenAI Active quota refresh后 slot/mirror和cache storage id一致",
        "active-only consumer不再触发完整list，候选枚举仍可用pure list",
        "现有API response shape不变"
      ],
      "validation": [
        "rg -n syncActiveOAuthAccountCredential app lib scripts",
        "Route contract/source checks for bootstrap/adopt/clear",
        "OAuth account/provider/login/logout focused tests",
        "OpenAI subscription quota storage-id tests",
        "Kiro/Antigravity account/quota/failover regressions"
      ],
      "risks": [
        "login仍吞掉adopt错误导致split-brain成功",
        "logout在拿provider lock前删除mirror留下refresh窗口",
        "错误替换需要完整account list的failover调用",
        "active reader stale pointer错误分类变化"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "OAUTH-03",
      "title": "补强 Grok mirror 单向收敛并新增 barrier 一致性测试",
      "phase": "consistency",
      "order": 2,
      "dependsOn": [
        "OAUTH-01"
      ],
      "files": [
        "lib/grok-credential-transaction.ts",
        "lib/grok-account-token.ts",
        "scripts/test-grok-refresh-consistency.mjs",
        "package.json"
      ],
      "instructions": "只在 PR #13 基线上增量扩展：新增 lock-held Active slot→auth mirror reconcile primitive，比较一致时zero-write，Active changed/non-Active时不写，禁止mirror→slot。getGrokAccessToken的lock-held valid-token路径对仍Active账号调用该primitive，使此前slot已提交而mirror失败的状态在下一次普通解析时无需OAuth refresh即可收敛；refresh路径继续调用现有commitGrokCredentialUnderLock，不替换coordinated store/transaction/flight实现。新增临时agent dir + fixture provider + deferred barrier生产路径测试，覆盖两次refresh-token轮换、refresh/list、refresh→Activate、Activate→non-Active refresh、forced single-flight、upstream zero-write、malformed/unwritable mirror失败后恢复收敛、secret边界；核心竞态不用sleep。注册test:grok-refresh-consistency并加入test:grok-all。",
      "acceptance": [
        "PR #13 slot-first、Active CAS、provider lock和force-flight代码保留",
        "mirror相同时普通valid-token read不写auth文件",
        "mirror旧/缺失且slot仍Active时只从slot修复mirror",
        "Active已切换时旧账号valid read不覆盖新mirror",
        "mirror失败保留轮换slot并返回固定安全错误",
        "恢复后普通read修复mirror且fixture refresh call count不增加",
        "第二次refresh提交R1而非已消费R0",
        "新脚本使用真实helpers与barrier且纳入test:grok-all"
      ],
      "validation": [
        "npm run test:grok-refresh-consistency",
        "npm run test:grok-refresh-race",
        "npm run test:grok-global-auth",
        "npm run test:grok-accounts",
        "Secret sentinel scan of outputs/errors/files"
      ],
      "risks": [
        "把旧PR #14 resolver整体覆盖到main而回退PR #13",
        "valid-token路径每次重写auth导致mtime抖动",
        "reconcile helper在provider lock内再次拿provider lock",
        "fixture ordering依赖sleep形成flaky test"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "OAUTH-04",
      "title": "更新 OAuth/Grok/Kiro/Antigravity 回归断言与聚合测试",
      "phase": "tests",
      "order": 3,
      "dependsOn": [
        "OAUTH-02",
        "OAUTH-03"
      ],
      "files": [
        "scripts/test-grok-accounts.mjs",
        "scripts/test-grok-reauth.mjs",
        "scripts/test-grok-quota.mjs",
        "scripts/test-kiro-accounts.mjs",
        "scripts/test-kiro-quota.mjs",
        "scripts/test-antigravity-accounts.mjs",
        "scripts/test-antigravity-quota.mjs",
        "scripts/run-oauth-account-tests.mjs",
        "lib/subscription-quota-storage-id.test.ts"
      ],
      "instructions": "更新仍断言旧sync/list副作用的source contract tests，优先增加行为测试而非只做字符串替换。覆盖四个新API、所有provider list纯读、route接线、logout slots保留、OpenAI quota adopt/cache id、Kiro/Antigravity active reader以及Grok reauth/add隔离。保留现有provider account、quota、failover与refresh-activate race测试；不得为了通过测试删除安全断言。",
      "acceptance": [
        "旧sync语义断言全部移除或替换为显式边界断言",
        "四provider list纯读均有行为证据",
        "Grok add/reauth/provider-wide login三种模式保持隔离",
        "OpenAI quota opaque storage-id回归通过",
        "Kiro/Antigravity refresh-activate与quota回归不受影响",
        "test:grok-all包含新consistency脚本且全绿"
      ],
      "validation": [
        "npm run test:oauth-accounts",
        "npm run test:grok-all",
        "npm run test:kiro-accounts",
        "npm run test:kiro-refresh-activate-race",
        "npm run test:kiro-quota",
        "npm run test:antigravity-accounts",
        "npm run test:antigravity-refresh-activate-race",
        "npm run test:antigravity-quota"
      ],
      "risks": [
        "source-string tests通过但生产行为未覆盖",
        "跨provider list行为只测Grok",
        "聚合脚本漏跑新专项测试",
        "测试误触真实~/.pi/agent或外网"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "OAUTH-05",
      "title": "更新 OAuth Active 架构、API、library 与 integration 文档",
      "phase": "docs",
      "order": 3,
      "dependsOn": [
        "OAUTH-02",
        "OAUTH-03"
      ],
      "files": [
        "docs/architecture/overview.md",
        "docs/integrations/README.md",
        "docs/modules/library.md",
        "docs/modules/api.md",
        "docs/standards/code-style.md"
      ],
      "instructions": "按最终实现记录 managed slot authority、auth.json one-way mirror、bootstrap/adopt/read/clear职责、list zero-write/zero-network、logout保留saved slots、Grok mirror failure后slot保留及valid-token repair、route接线与新测试命令。删除任何暗示普通list会sync/backfill或auth mirror可覆盖valid slot的陈述。API docs保持wire不变但说明GET bootstrap兼容边界与logout clear。若code-style维护focused test清单则加入test:grok-refresh-consistency。明确回滚不能回退PR #13或删除用户数据。",
      "acceptance": [
        "architecture/integration/library/API文档与最终source一致",
        "bootstrap与adopt不可互换，list不再被描述为reconciliation trigger",
        "Grok slot-first/mirror failure/reconcile与锁顺序清楚",
        "logout清pointer但保留slots写清楚",
        "新测试命令和聚合关系已记录",
        "无旧PR #14分支复用或回退PR #13建议"
      ],
      "validation": [
        "rg for stale sync/list-backfill wording",
        "rg for bootstrap/adopt/clear/list contracts across docs",
        "git diff --check"
      ],
      "risks": [
        "文档复制PR #14旧实现而非当前main",
        "遗漏docs/modules/api.md的GET/logout行为",
        "把已知跨文件残余风险描述成强原子事务"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "OAUTH-06",
      "title": "执行完整验证与 Issue #12 checker 门禁",
      "phase": "validation",
      "order": 4,
      "dependsOn": [
        "OAUTH-04",
        "OAUTH-05"
      ],
      "files": [],
      "instructions": "执行lint、TypeScript、focused OAuth/Grok套件、Kiro/Antigravity跨provider回归和diff检查。checker审查全部sync/list caller、锁所有权、slot/mirror方向、partial failure、secret边界、route wire和文档。特别对比88d9756基线，证明没有回退PR #13；确认没有从closed PR #14分支cherry-pick/强推。UI gate为不适用，只做现有API/UI smoke。任何无法运行的命令必须如实记录环境阻塞，不得猜测通过。",
      "acceptance": [
        "npm run lint通过或隔离与本改动无关的既有问题",
        "node_modules/.bin/tsc --noEmit通过",
        "test:grok-refresh-consistency、test:grok-refresh-race、test:grok-accounts、test:grok-all通过",
        "test:oauth-accounts与OpenAI quota storage-id通过",
        "Kiro/Antigravity account、quota、refresh-activate回归通过",
        "production rg无syncActiveOAuthAccountCredential且list无写/网络路径",
        "API/wire/secret/permissions/lock review通过",
        "git diff --check通过且PR #13基线未回退"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:grok-refresh-consistency",
        "npm run test:grok-refresh-race",
        "npm run test:grok-accounts",
        "npm run test:grok-all",
        "npm run test:oauth-accounts",
        "npm run test:kiro-accounts",
        "npm run test:kiro-refresh-activate-race",
        "npm run test:kiro-quota",
        "npm run test:antigravity-accounts",
        "npm run test:antigravity-refresh-activate-race",
        "npm run test:antigravity-quota",
        "git diff --check"
      ],
      "risks": [
        "缺少node_modules阻塞本地验证",
        "耗时聚合测试被跳过",
        "只检查最终值未检查refresh call count和zero-write",
        "unrelated worktree changes被误覆盖"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      {
        "id": "foundation",
        "subtaskIds": [
          "OAUTH-01"
        ]
      },
      {
        "id": "integration-consistency",
        "subtaskIds": [
          "OAUTH-02",
          "OAUTH-03"
        ]
      },
      {
        "id": "tests-docs",
        "subtaskIds": [
          "OAUTH-04",
          "OAUTH-05"
        ]
      },
      {
        "id": "validation",
        "subtaskIds": [
          "OAUTH-06"
        ]
      }
    ]
  }
}
```

## 验证命令

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

不得直接运行 `next build`。测试必须使用临时 `PI_CODING_AGENT_DIR` 和 fixture provider；不得访问真实 OAuth endpoint或 `~/.pi/agent`。

## 重点检索

```bash
rg -n "syncActiveOAuthAccountCredential|listOAuthAccounts|readOAuthActiveAccountId|bootstrapOAuthActiveAccountCredential|adoptOAuthActiveAccountCredential|clearOAuthActiveAccount" app lib scripts docs
rg -n "withGrokProviderLock|commitGrokCredentialUnderLock|createGrokCoordinatedCredentialStore" lib scripts
```

验收时 production `syncActiveOAuthAccountCredential`引用应为0；`listOAuthAccounts`保留调用必须确实需要账号summary/candidate，而不是只取Active id。

## 评审门禁

- **计划审批门禁：** 主会话保存 implementation plan并转 `awaiting_approval`，用户明确批准后才能派发 implementer。
- **UI门禁：** 不适用；不得为本后端修复新增UI改动。
- **OAUTH-01：** 先审 list zero-write/zero-network、bootstrap/adopt不可混用、锁不嵌套。
- **OAUTH-03：** 必须逐行对比 PR #13基线，禁止以旧 PR #14整文件覆盖。
- **OAUTH-04：** barrier测试须验证调用次数和中间状态，不能只断言最终Active id。
- **OAUTH-06：** checker确认wire、secret、permissions、partial failure及跨provider回归。

## 回滚方案

只回滚本任务的显式边界、call-site、mirror repair、测试和文档增量；保留 PR #13（`88d9756`）的 provider lock、coordinated CredentialStore、slot-first transaction和现有race tests。不得删除或迁移 `auth.json`、`auth-accounts/**`、Session JSONL或usage ledger。若回滚后需要stop-bleed，以当前任务开始前的 `3b8285c`行为为下限，绝不能恢复 PR #13之前的mirror-first实现。
