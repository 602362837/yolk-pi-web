# Implement：SuperGrok OAuth 与多账号额度（待审批）

> 本文是实现计划，不代表已获批准。UI HTML 原型与产品决策完成前不得执行。

## 先阅读

1. `AGENTS.md`、`docs/architecture/overview.md`、`docs/standards/code-style.md`
2. `docs/integrations/README.md`、`docs/modules/{api,frontend,library}.md`
3. Pi docs：`docs/sdk.md`、`docs/custom-provider.md`、`docs/models.md`、`docs/extensions.md`
4. `pi-grok-cli@0.4.1`：README、`src/provider/{register,billing,usage,stream}.ts`、`src/auth/{oauth,grokCredentials}.ts`
5. `lib/rpc-manager.ts`、`lib/ypi-studio-child-session-runner.ts`、`app/api/models/route.ts`
6. `app/api/auth/**`、`lib/oauth-accounts.ts`、`lib/subscription-quota.ts`、`components/ModelsConfig.tsx`
7. 批准后的 `supergrok-oauth-accounts-prototype.html`

## 人类可读子任务表

| ID | Phase | 顺序 | 内容 | 依赖 | 并行 |
|---|---|---:|---|---|---|
| GROK-01 | dependency/bootstrap | 1 | 固定依赖并统一 provider extension/service bootstrap | — | 否 |
| GROK-02 | account-core | 2 | 泛化 OAuth saved-account store，增加 Grok adapter | GROK-01 | 否 |
| GROK-03 | session-isolation | 3 | session account binding、request token resolver、refresh 隔离 | GROK-02 | 否 |
| GROK-04 | quota | 4 | billing parser、cache、safe API | GROK-02 | 可与 03 并行 |
| GROK-05 | api-ui | 5 | Auth capabilities 与 Models Grok 账号/额度 UI | GROK-03,04 | 否 |
| GROK-06 | tests | 6 | 冷启动、账号、隔离、quota、安全回归 | GROK-05 | 否 |
| GROK-07 | docs-review | 7 | 文档、人工验收、checker closeout | GROK-06 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "GROK-01",
      "title": "Add pi-grok-cli and centralize provider bootstrap",
      "phase": "dependency-bootstrap",
      "order": 1,
      "dependsOn": [],
      "files": ["package.json", "package-lock.json", "lib/pi-provider-extensions.ts", "lib/rpc-manager.ts", "lib/ypi-studio-child-session-runner.ts", "app/api/models/route.ts", "app/api/auth/providers/route.ts", "app/api/auth/login/[provider]/route.ts", "app/api/auth/logout/[provider]/route.ts"],
      "instructions": "Add exact pi-grok-cli@0.4.1 dependency. Create one named inline provider factory helper and inject it into every main/child/services/auth bootstrap path. Do not deep-import pi-grok-cli/src internals. Audit every ModelRegistry/createAgentSessionServices/DefaultResourceLoader creation and ensure a registry refresh cannot become the final reset without Grok replay.",
      "acceptance": ["fresh-process Auth API lists grok-cli", "fresh-process Models API registers Grok models", "main and Studio child sessions can resolve the same Grok model", "provider bootstrap diagnostics are surfaced without secrets"],
      "validation": ["focused provider bootstrap test in isolated agent dir", "npm ls pi-grok-cli"],
      "risks": ["pi-grok-cli only exports a full extension factory", "global pi-ai registry can be reset by another registry refresh"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GROK-02",
      "title": "Generalize saved OAuth accounts with a Grok adapter",
      "phase": "account-core",
      "order": 2,
      "dependsOn": ["GROK-01"],
      "files": ["lib/oauth-accounts.ts", "lib/oauth-account-providers.ts", "app/api/auth/accounts/[provider]/route.ts", "app/api/auth/accounts/[provider]/activate/route.ts"],
      "instructions": "Extract generic opaque-id/secret/metadata/activation behavior while keeping openai-codex wire compatibility. Add grok-cli adapter without ChatGPT-specific fields. Save credentials from in-memory add-account login, enforce 0700/0600 and atomic writes, and mirror active credential to auth.json with compare-safe mutation behavior.",
      "acceptance": ["multiple Grok logins save independently", "metadata contains no OAuth credential material", "OpenAI saved account behavior is unchanged", "active delete requires replacement or explicit disconnect"],
      "validation": ["isolated OAuth account-store tests", "filesystem permission assertions on supported platforms"],
      "risks": ["regression in mature OpenAI account flow", "multi-file activation partial failure"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GROK-03",
      "title": "Pin Grok accounts to sessions and isolate token refresh",
      "phase": "session-isolation",
      "order": 3,
      "dependsOn": ["GROK-02"],
      "files": ["lib/grok-account-token.ts", "lib/grok-session-account.ts", "lib/rpc-manager.ts", "lib/agent-session-bootstrap.ts", "lib/ypi-studio-child-session-runner.ts", "lib/types.ts"],
      "instructions": "Implement the approved session-binding semantics using an additive non-secret session header/reference. Fork inherits; resumed sessions restore; Studio Grok children inherit parent when available. Add per-account process single-flight plus file lock refresh through the registered OAuthProviderInterface, atomic secret update, active-mirror compare-and-set, and provider-scoped before_provider_headers token override. Block deletion of referenced accounts unless an approved migration action is explicit.",
      "acceptance": ["active switch does not change existing Grok sessions", "new session uses current active", "same-account concurrent refresh happens once", "different accounts never share token or refresh state", "fork/resume/Studio inheritance follows contract"],
      "validation": ["two-account concurrent session test", "refresh rotation/race tests", "request-header redaction test"],
      "risks": ["Authorization header hook ordering/casing", "vision/Imagine may bypass inference hook", "session reference scanning cost"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GROK-04",
      "title": "Build cached Grok quota service and safe API projection",
      "phase": "quota",
      "order": 4,
      "dependsOn": ["GROK-02"],
      "files": ["lib/grok-subscription-quota.ts", "app/api/auth/quota/[provider]/route.ts", "lib/oauth-accounts.ts"],
      "instructions": "Implement a Web-owned minimal billing client/parser without importing private pi-grok-cli paths. Query the selected saved account token, validate monthly/optional weekly fields, use approved fresh/stale TTLs, per-account single-flight, timeout, one forced refresh+retry on 401/403, and persist only normalized cache. Return versioned allowlisted projection and Cache-Control no-store; Grok POST reset-credit is unsupported.",
      "acceptance": ["monthly and optional weekly fields map correctly", "weekly failure preserves monthly", "fresh/force/stale/reauth states are deterministic", "no raw upstream payload or credential reaches the response"],
      "validation": ["fixture parser tests", "cache/single-flight/failure matrix tests", "route header tests"],
      "risks": ["unofficial billing endpoint schema drift", "used greater than limit and malformed date edge cases"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "GROK-05",
      "title": "Expose Grok account capabilities and implement the approved UI",
      "phase": "api-ui",
      "order": 5,
      "dependsOn": ["GROK-03", "GROK-04"],
      "files": ["app/api/auth/providers/route.ts", "app/api/auth/accounts/[provider]/**", "app/api/auth/login/[provider]/route.ts", "components/ModelsConfig.tsx", "app/globals.css"],
      "instructions": "Implement only the approved HTML prototype. Make OAuth UI capability-driven instead of openai-codex-id-driven, while retaining OpenAI-only reset/warmup controls. Add Grok login methods, accounts, active/new-session-default explanation, session-reference delete protection, quota fresh/stale/error/reauth states, manual refresh, accessibility, narrow viewport, and secret-safe client state.",
      "acceptance": ["implementation matches approved HTML prototype", "all specified loading/empty/stale/error states exist", "active semantics are explicit", "OpenAI and API-key account UIs regress neither behavior nor copy"],
      "validation": ["browser manual matrix", "keyboard/focus/mobile/theme checks", "network payload inspection"],
      "risks": ["hidden provider-id hardcoding in the large ModelsConfig component", "UI may accidentally imply credits equal monetary cost"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GROK-06",
      "title": "Add isolated integration and security regression coverage",
      "phase": "tests",
      "order": 6,
      "dependsOn": ["GROK-05"],
      "files": ["scripts/test-grok-provider.mjs", "scripts/test-grok-accounts.mjs", "scripts/test-grok-quota.mjs", "package.json"],
      "instructions": "Add subprocess/temporary-agent-dir tests for cold bootstrap, account lifecycle, concurrent session isolation, refresh locking, quota cache/failure projection, permissions and redaction. Never read real ~/.pi/agent or ~/.grok/auth.json. Include non-Grok registry refresh order regression.",
      "acceptance": ["focused tests cover all Checks matrix items", "tests use no live xAI endpoint or real credential", "secret sentinel never appears in API/log snapshots"],
      "validation": ["new focused npm test scripts", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["module-global registry state can make in-process tests order-dependent"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GROK-07",
      "title": "Document integration, run acceptance, and complete checker review",
      "phase": "docs-review",
      "order": 7,
      "dependsOn": ["GROK-06"],
      "files": ["docs/integrations/README.md", "docs/modules/api.md", "docs/modules/frontend.md", "docs/modules/library.md", "docs/architecture/overview.md", "docs/operations/troubleshooting.md"],
      "instructions": "Document provider ownership boundaries, account files, active/session-pin semantics, quota cache/error states, full-extension side effects, troubleshooting and rollback. Run checker against approved prototype, secrets, concurrency and all registry entrypoints. Use npm run build only for final release validation.",
      "acceptance": ["docs match shipped contracts", "checker reports no blocker", "manual two-account acceptance passes", "rollback leaves unrelated providers operational"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "focused Grok tests", "npm run build at final integration gate"],
      "risks": ["upstream extension behavior may change despite fixed dependency; upgrades need explicit re-audit"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {"id": "bootstrap", "subtaskIds": ["GROK-01"]},
      {"id": "account-core", "subtaskIds": ["GROK-02"]},
      {"id": "isolation-and-quota", "subtaskIds": ["GROK-03", "GROK-04"]},
      {"id": "ui-and-closeout", "subtaskIds": ["GROK-05", "GROK-06", "GROK-07"]}
    ]
  }
}
```

## 验证命令

日常最低验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

实现后还需运行新增 Grok focused tests；`npm run build` 仅在最终集成/release gate。

## 检查门禁

- UI HTML 原型与用户审批；
- 四项产品决策已记录；
- GROK-03 必须先证明并发隔离，再接 UI；
- checker 必须重点检查完整扩展附带能力、global registry reset、vision/Imagine token 路径和 secret leakage。

## 回滚

代码回滚统一 provider factory 和 Grok UI/API；不自动删除 saved credentials/cache。旧版本忽略 additive session binding。若必须 disconnect，只通过显式用户动作清理 `auth.json["grok-cli"]`。
