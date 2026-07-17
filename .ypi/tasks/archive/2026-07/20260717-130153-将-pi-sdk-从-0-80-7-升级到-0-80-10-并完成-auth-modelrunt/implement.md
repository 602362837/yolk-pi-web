# Implement：pi SDK 0.80.10 / Auth / ModelRuntime

## 先阅读

1. `AGENTS.md`
2. `docs/integrations/README.md`
3. `docs/architecture/overview.md`（AgentSession lifecycle、Models/Auth、fixed providers）
4. `docs/modules/library.md`、`docs/modules/api.md`
5. `docs/standards/code-style.md`
6. `/tmp/pi-sdk-compare/ca-0.80.10/package/CHANGELOG.md`
7. 0.80.10 declarations：`dist/core/{auth-storage,model-runtime,model-registry,agent-session-services,agent-session}.d.ts` 与 `pi-ai/dist/auth/types.d.ts`
8. 现有实现：`lib/pi-provider-extensions.ts`、`lib/rpc-manager.ts`、`lib/oauth-accounts.ts`、`lib/api-key-accounts.ts`、provider token/quota modules、Auth/Models routes。

## 实现原则

- 版本与 adapter 是一个原子改动；不得产生“新 SDK + 旧 adapter”或反向混合的可交付状态。
- 业务代码只依赖公开 `CredentialStore` / `ModelRuntime`，不 deep-import coding-agent私有AuthStorage。
- fixed provider注册必须落到目标 runtime；不要把无目标的global bootstrap当成catalog保证。
- main/Studio session runtime隔离；只有不加载cwd-local extensions的管理runtime可复用。
- 不借机改UI、账号模型、quota/failover策略、第三方provider版本或历史数据。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
|---|---:|---:|---|---|---|
| SDK-01 | foundation | 10 | exact bump；实现Web CredentialStore、runtime/services factory与基础测试 | — | 否 |
| SDK-02 | auth | 20 | 迁移OAuth/API-key、多账号Active mirror、quota/balance与Auth routes | SDK-01 | 是 |
| SDK-03 | sessions | 20 | 迁移main Chat、live reload、pi types与Studio SDK child | SDK-01 | 是 |
| SDK-04 | models | 20 | 迁移Models/model-price/config-test/assist路径到ModelRuntime | SDK-01 | 是 |
| SDK-05 | provider-tests | 30 | 更新Grok/Kiro/Antigravity/account/race/runtime合约测试 | SDK-02, SDK-03, SDK-04 | 是 |
| SDK-06 | docs-audit | 30 | 更新文档、锁树与全仓陈旧契约审计 | SDK-02, SDK-03, SDK-04 | 是 |
| SDK-07 | validation | 40 | lint/tsc/focused suites/API smoke/UAT/回滚核验 | SDK-05, SDK-06 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-17T05:30:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "Upgrade all Pi core packages to exact 0.80.10 and migrate yolk-pi-web from AuthStorage/ModelRegistry.create to an app-owned CredentialStore and provider-aware ModelRuntime across Auth, sessions, providers, models, tests, and docs.",
  "strategy": "Build and locally review the shared credential/runtime foundation first; then execute auth, session, and model consumer migrations in parallel; converge on provider contract tests, documentation/audit, and one integrated validation barrier.",
  "maxConcurrency": 3,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 3,
    "groups": [
      {
        "id": "foundation",
        "title": "Shared SDK/runtime foundation",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["SDK-01"]
      },
      {
        "id": "migration-fanout",
        "title": "Auth, session, and model consumers",
        "relation": "parallel",
        "dependencies": ["SDK-01"],
        "subtaskIds": ["SDK-02", "SDK-03", "SDK-04"]
      },
      {
        "id": "convergence",
        "title": "Provider contracts and documentation audit",
        "relation": "parallel",
        "dependencies": ["SDK-02", "SDK-03", "SDK-04"],
        "subtaskIds": ["SDK-05", "SDK-06"]
      },
      {
        "id": "validation",
        "title": "Integrated release-candidate validation",
        "relation": "barrier",
        "dependencies": ["SDK-05", "SDK-06"],
        "subtaskIds": ["SDK-07"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "SDK-01",
      "title": "Create the Web CredentialStore and provider-aware ModelRuntime foundation",
      "phase": "foundation",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "parallelGroup": "foundation",
      "parallelizable": false,
      "member": "implementer",
      "priority": 100,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "files": [
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "lib/web-credential-store.ts",
        "lib/web-auth-config-value.ts",
        "lib/web-model-runtime.ts",
        "lib/pi-provider-extensions.ts",
        "scripts/test-web-credential-store.mjs"
      ],
      "instructions": [
        "Set @earendil-works/pi-coding-agent, pi-ai, and pi-agent-core to exact 0.80.10 and regenerate both lock files without changing fixed third-party provider versions.",
        "Implement the public pi-ai CredentialStore contract over auth.json with an auth-file-wide in-process queue plus cross-process mkdir lock, lock-time reread, malformed-JSON fail-closed behavior, same-directory atomic replace, and 0700/0600 permissions.",
        "Preserve API-key literal/env/template/escape/leading-command resolution semantics while ensuring list() never resolves or exposes secrets; preserve all OAuth extension fields.",
        "Add create/get credential and runtime factories. Cache only fixed-provider administrative runtimes keyed by configuration paths; create isolated runtimes for Chat/Studio and temporary modelsPath callers.",
        "Add a canonical createWebAgentSessionServices helper that registers Grok, Kiro, and Antigravity plus caller extras into the actual ModelRuntime. Reframe or remove old bootstrap helpers that falsely promise to prepare unrelated registries.",
        "Add focused isolated tests before downstream migration; never access the user's real agent directory."
      ],
      "acceptance": [
        "All three Pi core packages and both lock files resolve to the 0.80.10 release family with exact root pins.",
        "CredentialStore read/list/modify/delete passes missing-file, malformed-file, permissions, OAuth field preservation, config-value, and secret-redaction tests.",
        "Concurrent writes to two provider ids preserve both credentials and modify(undefined) does not delete.",
        "A provider-aware service runtime contains fixed providers without relying on ModelRegistry.create or a different runtime's side effects.",
        "Session runtime caching cannot leak cwd-local extension provider registrations."
      ],
      "validation": [
        "new focused Web CredentialStore/runtime test command",
        "npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai @earendil-works/pi-agent-core",
        "local review of lock ownership, stale recovery, path keys, and secret boundaries"
      ],
      "risks": [
        "A provider-scoped rather than file-scoped lock can lose unrelated auth.json entries.",
        "A global shared session runtime can leak project extension providers across cwd boundaries.",
        "Reimplementing config-value resolution incompletely can break existing command/env-backed keys."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SDK-02",
      "title": "Migrate Auth APIs, account mirrors, token refresh, quota, and balance",
      "phase": "auth",
      "order": 20,
      "dependsOn": ["SDK-01"],
      "relation": "parallel",
      "parallelGroup": "migration-fanout",
      "parallelizable": true,
      "member": "implementer",
      "priority": 90,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "files": [
        "lib/oauth-accounts.ts",
        "lib/api-key-accounts.ts",
        "lib/grok-account-token.ts",
        "lib/kiro-account-token.ts",
        "lib/antigravity-account-token.ts",
        "lib/subscription-quota.ts",
        "lib/deepseek-balance.ts",
        "lib/antigravity-subscription-quota.ts",
        "app/api/auth/login/[provider]/route.ts",
        "app/api/auth/logout/[provider]/route.ts",
        "app/api/auth/providers/route.ts",
        "app/api/auth/all-providers/route.ts",
        "app/api/auth/api-key/[provider]/route.ts",
        "app/api/auth/accounts/[provider]/activate/route.ts",
        "app/api/auth/**"
      ],
      "instructions": [
        "Convert saved-account sync, API-key legacy import, mirror, Activate, replacement, and delete paths to await CredentialStore read/modify/delete. Import credential types from pi-ai.",
        "Keep Kiro/Antigravity provider locks and all Active mirror CAS rechecks; replace drainErrors best-effort handling with explicit rejected storage operations and safe error mapping.",
        "Adapt OAuth login to ModelRuntime.login(provider, 'oauth', interaction), mapping provider events/prompts to the existing SSE contract. Use an isolated in-memory credential store for accountMode=add and persist only the returned account credential.",
        "Use ModelRuntime logout/provider discovery/auth status and await live RPC reload after successful mutations.",
        "Use ModelRuntime.getAuth for active OpenAI quota and DeepSeek balance so refresh and configured headers follow the canonical runtime path. Preserve fixed-provider compatibility preload only where a saved non-active credential refresh genuinely still requires the public pi-ai compatibility helper.",
        "Do not alter account metadata schema, quota wire types, failover classifiers/budgets, or secret projections."
      ],
      "acceptance": [
        "No AuthStorage import or synchronous get/set/remove remains in Auth/account/quota runtime code.",
        "OAuth SSE login, add-account, normal login, provider status, and logout response shapes are unchanged.",
        "Active mirror CAS remains correct under refresh/Activate races for Grok, Kiro, and Antigravity.",
        "Single-key and managed API-key providers retain their existing compatibility and delete safety semantics.",
        "Quota/balance paths resolve auth without leaking tokens, project ids, raw bodies, or filesystem paths."
      ],
      "validation": [
        "npm run test:api-key-accounts",
        "npm run test:oauth-accounts",
        "provider account, quota, race, and failover focused suites",
        "Auth API smoke in an isolated PI_CODING_AGENT_DIR"
      ],
      "risks": [
        "Failure to await async store/runtime operations can return success before live auth changes take effect.",
        "Normal and add-account login can accidentally share a persistent store and overwrite Active.",
        "Refreshing a non-active account can overwrite the Active mirror if lock/CAS order changes."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SDK-03",
      "title": "Migrate main AgentSession and YPI Studio child lifecycle to ModelRuntime services",
      "phase": "sessions",
      "order": 20,
      "dependsOn": ["SDK-01"],
      "relation": "parallel",
      "parallelGroup": "migration-fanout",
      "parallelizable": true,
      "member": "implementer",
      "priority": 90,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "files": [
        "lib/rpc-manager.ts",
        "lib/pi-types.ts",
        "lib/agent-session-bootstrap.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/session-model-pin.ts"
      ],
      "instructions": [
        "Replace the manual ResourceLoader + createAgentSession main path with provider-aware createAgentSessionServices + createAgentSessionFromServices while preserving YPI Studio and Browser Share extras and tool activation semantics.",
        "Change model lookup interfaces to AgentSession.modelRuntime.getModel and update the local AgentSessionLike type without exposing credential internals.",
        "Make reloadRpcAuthState async, refresh each live wrapper's ModelRuntime offline with per-wrapper failure isolation, replace only the same provider/id descriptor without setModel, and clean provider session resources afterward.",
        "Update every reload caller to await completion. Preserve one-wrapper/start-lock/fork-destroy/session-scoped-settings invariants.",
        "Migrate Studio SDK child service/model selection to services.modelRuntime using the same fixed-provider helper and retain independent child request affinity/audit behavior."
      ],
      "acceptance": [
        "New and resumed main sessions can resolve fixed-provider models before initial model selection.",
        "Chat set_model remains session-scoped and does not rewrite global defaults.",
        "Live auth reload updates future requests without writing a model_change or changing model identity.",
        "One wrapper failure does not prevent other wrappers from refreshing or provider resources from being cleaned best-effort.",
        "Studio SDK child retains its own session id, policy model, guard extension, and audit JSONL."
      ],
      "validation": [
        "npm run test:session-model-pin",
        "npm run test:studio-sdk-runner",
        "manual new Chat, historical resume, model switch, and Active live-reload smoke"
      ],
      "risks": [
        "Provider registrations can occur after initial model selection if the old createAgentSession path remains.",
        "Calling setModel during reload would persist unwanted model/default changes.",
        "Sharing the main runtime with Studio children can break request-affinity isolation."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SDK-04",
      "title": "Migrate Models, model-price, config-test, and assistant consumers",
      "phase": "models",
      "order": 20,
      "dependsOn": ["SDK-01"],
      "relation": "parallel",
      "parallelGroup": "migration-fanout",
      "parallelizable": true,
      "member": "implementer",
      "priority": 85,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "files": [
        "app/api/models/route.ts",
        "app/api/models-config/test/route.ts",
        "app/api/model-prices/route.ts",
        "app/api/model-prices/suggest/route.ts",
        "app/api/terminal/env/assist/route.ts",
        "app/api/trellis/workflow/assist/route.ts",
        "lib/model-price-config.ts",
        "lib/model-price-assistant.ts"
      ],
      "instructions": [
        "Replace registry getAll/getAvailable/find/display/auth calls with ModelRuntime getModels/getAvailable/getModel/getProvider/getAuth APIs.",
        "Prefer runtime completeSimple/streamSimple for request execution so model-specific headers/baseUrl/env are assembled once by ModelRuntime.",
        "Refactor model-price helpers to a ModelRuntime or narrow catalog interface and create provider-aware isolated runtimes for write verification.",
        "Ensure Models Config test uses its temporary modelsPath and never enters the default runtime cache.",
        "Keep route response shapes, allow-root checks, no-store headers, timeout/error sanitization, and price write rollback intact."
      ],
      "acceptance": [
        "Models list/default/thinking metadata and provider display names remain available through the existing response shape.",
        "Model config test resolves auth and model headers from its temporary runtime and leaves the real models catalog untouched.",
        "Model-price listing and post-write verification use the single models.json source and preserve rollback/revision behavior.",
        "Terminal, Trellis, and price assistant calls use canonical runtime auth without manual header loss.",
        "No application code needs ModelRegistry.create or services.modelRegistry."
      ],
      "validation": [
        "npm run test:model-prices",
        "GET /api/models and /api/model-prices smoke",
        "Models Config test and one configured assist route smoke"
      ],
      "risks": [
        "Mapping getAuth incorrectly can drop model-level headers or baseUrl.",
        "Caching a temporary modelsPath runtime can contaminate normal models.",
        "Price write verification can report false success if it reads a stale runtime snapshot."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SDK-05",
      "title": "Rewrite provider and integration contract tests for CredentialStore and ModelRuntime",
      "phase": "provider-tests",
      "order": 30,
      "dependsOn": ["SDK-02", "SDK-03", "SDK-04"],
      "relation": "parallel",
      "parallelGroup": "convergence",
      "parallelizable": true,
      "member": "implementer",
      "priority": 75,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "files": [
        "lib/api-key-accounts.test.ts",
        "lib/kiro-account-token.test.ts",
        "lib/oauth-account-*.test.ts",
        "scripts/test-grok-provider.mjs",
        "scripts/test-grok-accounts.mjs",
        "scripts/test-grok-global-auth.mjs",
        "scripts/test-kiro-provider.mjs",
        "scripts/test-kiro-accounts.mjs",
        "scripts/test-kiro-refresh-activate-race.mjs",
        "scripts/test-antigravity-provider.mjs",
        "scripts/test-antigravity-accounts.mjs",
        "scripts/test-antigravity-refresh-activate-race.mjs",
        "scripts/test-antigravity-integration.mjs",
        "package.json"
      ],
      "instructions": [
        "Replace positive assertions for AuthStorage, ModelRegistry.create, and old service fields with behavioral assertions for CredentialStore, target-runtime provider registration, ModelRuntime auth, and awaited reload.",
        "Keep negative security assertions for no private deep import, no static provider source imports, callback loopback, no proper-lockfile cold graph assumptions where still applicable, and no secret projection.",
        "Run race tests against isolated agent directories and read auth.json through public Web helpers or raw file parsing, never the removed SDK export.",
        "Add/adjust package scripts only where they make the migration suite reproducible; do not introduce a heavy test framework."
      ],
      "acceptance": [
        "Tests no longer import removed AuthStorage or search for ModelRegistry.create as desired behavior.",
        "Cold provider paths prove Grok/Kiro/Antigravity register on the runtime used by the caller.",
        "Refresh/Activate races still prove the final mirror matches the final Active account.",
        "Source-contract tests reject regressions to private SDK imports and stale service fields."
      ],
      "validation": [
        "all Grok/Kiro/Antigravity focused commands listed in checks.md",
        "npm run test:api-key-accounts",
        "npm run test:oauth-accounts"
      ],
      "risks": [
        "String-only assertions can pass while runtime behavior is broken; retain behavioral tests.",
        "Tests can accidentally touch the user's real auth.json if process isolation is incomplete."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SDK-06",
      "title": "Update integration documentation and audit the resolved dependency/runtime contract",
      "phase": "docs-audit",
      "order": 30,
      "dependsOn": ["SDK-02", "SDK-03", "SDK-04"],
      "relation": "parallel",
      "parallelGroup": "convergence",
      "parallelizable": true,
      "member": "implementer",
      "priority": 65,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 0 },
      "files": [
        "AGENTS.md",
        "docs/integrations/README.md",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/modules/api.md",
        "docs/operations/troubleshooting.md",
        "package-lock.json",
        "npm-shrinkwrap.json"
      ],
      "instructions": [
        "Document exact 0.80.10, the Web CredentialStore, runtime-local fixed provider registration, async live reload, and rollback boundary.",
        "Remove the obsolete warning that 0.80.8+ is unsupported and the troubleshooting advice to call bare ModelRegistry.create/refresh.",
        "Add new shared modules to the library map and update Auth/Models route implementation notes without changing route contracts.",
        "Audit package-lock and shrinkwrap for aligned root pins/resolved versions and unchanged fixed third-party provider versions.",
        "Run a repository search for stale imports, field names, comments, and tests; preserve historical changelog/research text only when clearly labeled."
      ],
      "acceptance": [
        "Docs describe the implemented public API boundary and no longer instruct future agents to use removed SDK APIs.",
        "AGENTS remains concise/navigational and only changes if a top-level module entry or invariant needs it.",
        "Both lock files agree and third-party provider exact pins are unchanged.",
        "Static migration audit has no unexplained runtime hits."
      ],
      "validation": [
        "rg migration audit from checks.md",
        "npm ls dependency tree inspection",
        "manual docs cross-reference review"
      ],
      "risks": [
        "Documentation can retain a false process-global bootstrap invariant after runtime localization.",
        "Lock regeneration can unintentionally upgrade unrelated dependencies; diff must be reviewed."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SDK-07",
      "title": "Run integrated validation and produce implementation handoff",
      "phase": "validation",
      "order": 40,
      "dependsOn": ["SDK-05", "SDK-06"],
      "relation": "barrier",
      "parallelGroup": "validation",
      "parallelizable": false,
      "member": "checker",
      "priority": 50,
      "failurePolicy": "manual",
      "retry": { "maxAttempts": 0 },
      "files": ["handoff.md", "review.md"],
      "instructions": [
        "Run lint, tsc, the complete focused matrix in checks.md, and the no-stale-API/dependency audits.",
        "Start the dev server only as needed and execute API smoke with an isolated credential directory; never modify real user credentials during automated checks.",
        "Manually verify new/resumed Chat, session-scoped model switch, OAuth add/Activate/live reload, managed/single API keys, quota/failover, Models/price/assist, and Studio SDK child.",
        "Inspect the final diff for unrelated changes, secret/path leaks, lock-file churn, UI scope creep, and rollback safety. Record failures as blockers rather than guessing or weakening tests."
      ],
      "acceptance": [
        "npm run lint and node_modules/.bin/tsc --noEmit pass.",
        "CredentialStore, provider, accounts, race, quota, failover, model-price, session pin, and Studio SDK suites pass.",
        "API/UAT high-risk matrix passes without rewriting historical sessions or account stores.",
        "Checker confirms no UI gate was triggered and no commit/push/merge occurred.",
        "Handoff records exact commands, results, remaining upstream catalog differences, and atomic rollback steps."
      ],
      "validation": [
        "all commands and manual checks in checks.md",
        "git diff --check",
        "git status --short and final dependency/static audits"
      ],
      "risks": [
        "Real OAuth provider UAT may require user interaction and cannot be guessed; report any unavailable credential/provider as an explicit residual validation item.",
        "A passing compile without live provider smoke may miss third-party runtime incompatibility."
      ],
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 验证命令

以 [checks.md](checks.md) 为完整矩阵。最低门禁：

```bash
npm install
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:api-key-accounts
npm run test:oauth-accounts
npm run test:grok-all
npm run test:kiro-provider
npm run test:kiro-accounts
npm run test:kiro-refresh-activate-race
npm run test:antigravity-provider
npm run test:antigravity-accounts
npm run test:antigravity-refresh-activate-race
npm run test:model-prices
npm run test:studio-sdk-runner
```

## 评审门禁

1. 当前只保存计划并进入 `awaiting_approval`；用户明确批准前不得 claim `SDK-*` 或指派实现员。
2. SDK-01 是并行 fan-out 前的硬门禁，须先做本地安全评审。
3. SDK-02/03/04 涉及共享文件时由主实现员协调，禁止并行覆盖；`dependsOn` 是调度唯一依据，execution groups仅作阅读投影。
4. 若出现任何前端交互/信息结构改动，停止并补走 UI HTML 原型审批。
5. checker 必须把真实 provider/UAT 不可执行项列为残余风险，不得以源码字符串测试替代。

## 回滚

整体回退 adapter、三项核心依赖与两个锁文件到 0.80.7 后重启；不删除或迁移 `auth.json`、账号池、Session JSONL、usage ledger。严禁仅回退版本或仅回退 adapter。