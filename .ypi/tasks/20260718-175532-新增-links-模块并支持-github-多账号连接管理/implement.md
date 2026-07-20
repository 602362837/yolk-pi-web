# Implement：Links / GitHub OAuth Device Flow Connections

## 先阅读

实现员与检查员按顺序读取：

1. `AGENTS.md`、`docs/standards/code-style.md`
2. `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/integrations/README.md`
3. 本任务 `brief.md`、`prd.md`、`design.md`、`checks.md`、`ui.md`、批准后的 HTML 原型
4. `app/api/auth/login/[provider]/route.ts` 与 `components/ModelsConfig.tsx` 的 SSE/device-code UI（只借鉴交互和清理，不复用 LLM auth runtime）
5. `components/SettingsTreeNavigation.tsx`、`components/SettingsConfig.tsx`、`components/AppPromptProvider.tsx`
6. `lib/web-credential-store.ts`、`lib/oauth-accounts.ts`、`lib/terminal-ssh-vault.ts`（只借鉴权限、锁、原子写，不导入）
7. GitHub 官方 OAuth App Device Flow 文档：device code、polling interval、`slow_down`、不需要 client secret

## 建议执行顺序

先冻结 Device Flow contracts、产品 client配置与授权状态机，再实现 store。API 与 Settings UI在 contracts稳定后可并行；测试必须使用 fake GitHub endpoints/fetch和临时 agent dir。最后更新 docs并由 checker对批准的 Device Flow HTML 原型执行浏览器、安全与可访问验收。

不得把 PAT表单、Authorization Code callback、GitHub App installation、`gh auth`导入、repo/clone/PR顺手带入。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | ---: | ---: | --- | --- | --- |
| LINKS-01 | authorization | 1 | Links contracts、产品 client配置、GitHub Device Flow adapter、短期授权状态机 | — | 否 |
| LINKS-02 | storage | 2 | OAuth secret/metadata分离存储、锁、duplicate与disconnect事务 | LINKS-01 | 是 |
| LINKS-03 | api | 3 | catalog、authorization start/SSE/cancel、connections list/disconnect | LINKS-01, LINKS-02 | 否 |
| LINKS-04 | frontend | 3 | Settings Links leaf、device-code授权、多账号与断开 UI | LINKS-01 | 是 |
| LINKS-05 | tests | 4 | device flow polling、store/API/UI projections、安全 sentinel与并发故障测试 | LINKS-02, LINKS-03, LINKS-04 | 否 |
| LINKS-06 | docs | 5 | architecture/API/frontend/library/integration/deployment/operations/AGENTS | LINKS-03, LINKS-04 | 是 |
| LINKS-07 | validation | 6 | lint、tsc、focused regressions、浏览器与 checker安全评审 | LINKS-05, LINKS-06 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "LINKS-01",
      "title": "Define Links OAuth contracts and GitHub Device Flow authorization manager",
      "phase": "authorization",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/links-types.ts",
        "lib/links-provider-registry.ts",
        "lib/github-link-oauth.ts",
        "lib/links-authorization-manager.ts"
      ],
      "instructions": "Create a Links-only provider registry with github allowlisted. Resolve the product-owned OAuth App client id only from server-side YPI_LINKS_GITHUB_OAUTH_CLIENT_ID and fail closed when missing; do not add a browser/user configuration form and do not require a client secret. Implement fixed GitHub Device Flow calls: POST /login/device/code with read:user, interval-aware polling of /login/oauth/access_token, conservative handling of authorization_pending/slow_down/access_denied/expired/device-flow-disabled/client errors, and fixed GET api.github.com/user identity validation. Keep device_code and access token in non-serializable server-only values. Add a bounded globalThis authorization manager with opaque ids, TTL, cancellation, background polling independent of SSE subscribers, terminal snapshots, and cleanup. Wire snapshots may expose userCode/verificationUri/expiry/status but never device_code/access token/raw upstream data.",
      "acceptance": [
        "P0 main flow is Device Flow and no PAT input contract exists",
        "OAuth App identity belongs to the product; missing server client id returns a stable configuration error",
        "Device Flow uses client id only and no client secret enters repository, pi-web.json, browser bundle, API, or logs",
        "GitHub hosts/paths/scopes are fixed and client input cannot alter them",
        "Polling respects interval and slow_down, and pending does not become a false failure",
        "SSE-safe authorization snapshots contain no device_code/access token/upstream body",
        "Unknown providers fail closed without path or network use"
      ],
      "validation": [
        "Focused adapter/manager tests with mocked fetch and fake timers",
        "Sentinel device_code/access token absence assertions",
        "rg imports to prove LLM auth/runtime isolation"
      ],
      "risks": [
        "Product OAuth client id not provisioned before UAT",
        "Polling survives SSE disconnect but leaks an orphan background task",
        "GitHub error body accidentally entering Error.message"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "LINKS-02",
      "title": "Implement secure OAuth connection metadata and secret storage",
      "phase": "storage",
      "order": 2,
      "dependsOn": ["LINKS-01"],
      "files": [
        "lib/links-store.ts"
      ],
      "instructions": "Persist schema-v1 metadata under getAgentDir()/links/registry.json and GitHub OAuth access-token secrets under links/github/<opaque-id>.json. Enforce 0700 dirs, 0600 files, same-directory temp+fsync/rename, process queue plus cross-process provider lock, schema fail-closed parsing, random ids, and duplicate detection by validated providerUserId under the lock. Store only allowlisted OAuth credential fields; never raw token endpoint payload or device_code. Create must clean an orphan secret if registry write fails. Disconnect must soft-delete metadata and remove the active secret through quarantine/rollback, without claiming remote GitHub authorization revocation.",
      "acceptance": [
        "Two distinct GitHub identities persist simultaneously",
        "Registry is metadata-only; device_code never reaches disk",
        "Duplicate identity returns conflict and the newly authorized access token is not written",
        "Concurrent creates produce one active record per identity and valid registry JSON",
        "Disconnect removes active local OAuth secret, filters list, and preserves disconnected metadata",
        "Injected create/disconnect failures cannot report false success or corrupt another connection",
        "Unknown future schemas fail closed without rewrite"
      ],
      "validation": [
        "Temporary PI_CODING_AGENT_DIR lifecycle tests",
        "Unix permission assertions where supported",
        "Concurrent create and injected rename/write/unlink failures",
        "Sentinel scan of registry and serialized summaries"
      ],
      "risks": [
        "Registry/secret split-brain on crash",
        "Stale cross-process lock handling",
        "Tests importing getAgentDir before temp env isolation"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "LINKS-03",
      "title": "Add Links authorization, connection, and catalog APIs",
      "phase": "api",
      "order": 3,
      "dependsOn": ["LINKS-01", "LINKS-02"],
      "files": [
        "app/api/links/route.ts",
        "app/api/links/[provider]/connections/route.ts",
        "app/api/links/[provider]/connections/[connectionId]/route.ts",
        "app/api/links/[provider]/authorizations/route.ts",
        "app/api/links/[provider]/authorizations/[authorizationId]/events/route.ts",
        "app/api/links/[provider]/authorizations/[authorizationId]/route.ts"
      ],
      "instructions": "Implement GET /api/links; GET github connections; POST github authorizations with empty/allowlisted body only; GET authorization SSE; DELETE pending authorization; DELETE connection. Dynamic provider and opaque ids must be allowlisted before manager/store use. Start response exposes userCode, fixed verificationUri, expiry, interval, and requestedScopes only. SSE reconnect projects current state and connected summary; background completion persists even if subscriber disconnects. All REST responses are no-store and SSE is no-cache,no-store. Map domain/upstream failures to stable codes/messages; never log request/response bodies containing device_code/access token, absolute paths, or stack.",
      "acceptance": [
        "Authorization start returns 201 without device_code/access token/client secret",
        "SSE covers awaiting/polling/validating/connected/duplicate/denied/expired/cancelled/error",
        "GET catalog/list performs no GitHub request and list does not open secret files",
        "Client cannot submit token, scope, client id, redirect URI, or arbitrary URL",
        "Duplicate identity returns 409 semantics with prior connection unchanged",
        "DELETE connection states local-only disconnect and returns sanitized id",
        "Every success/error response has the planned cache policy"
      ],
      "validation": [
        "Route contract tests with mocked authorization manager/store",
        "Exact response key allowlists and cache-header assertions",
        "SSE reconnect/cancel/terminal cleanup tests",
        "Secret sentinel absence across captured output"
      ],
      "risks": [
        "Dynamic route validation after path construction",
        "SSE abort cancelling shared background authorization incorrectly",
        "Next exception serialization exposing upstream errors"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "LINKS-04",
      "title": "Implement Settings Links Device Flow and multi-account UI",
      "phase": "frontend",
      "order": 3,
      "dependsOn": ["LINKS-01"],
      "files": [
        "components/SettingsTreeNavigation.tsx",
        "components/SettingsConfig.tsx",
        "components/LinksConfig.tsx",
        "app/globals.css"
      ],
      "instructions": "Implement the user-approved Device Flow HTML prototype. Add stable links as a root Settings leaf after Studio and update every exhaustive tree/ancestor/deep-link mapping. LinksConfig independently loads catalog/connections, starts authorization, opens the fixed GitHub verification page, displays/copies the short user code, subscribes to SSE, shows expiry/progress/denied/expired/network/config-missing/duplicate states, and refreshes multi-account cards on success. Clear userCode and authorization state on terminal expiry, cancel, view change, and unmount; no device_code/access token ever enters browser state. Cover local-only disconnect confirm/busy/failure with focus restoration. Links operations are immediate and do not mark pi-web.json dirty; Save/Reset is hidden or disabled with explicit copy.",
      "acceptance": [
        "Default primary action is Connect GitHub; no PAT form or token field exists",
        "Device code state clearly names GitHub, expiry, open/copy actions, and waiting progress",
        "Authorization can complete after SSE reconnect and list refresh recovers success",
        "At least two identity cards are independently readable/disconnectable",
        "Config missing, denied, expired, duplicate, network, load, and disconnect failures have recoverable safe UI",
        "Settings keyboard tree, AppPrompt focus, narrow layout, light/dark, and reduced motion match approved prototype",
        "Global Settings Save/Reset does not imply an unsaved authorization"
      ],
      "validation": [
        "Browser matrix against links-github-connections-prototype.html",
        "Keyboard and screen-reader semantics for code copy, external link, SSE status, and confirm",
        "Network/DOM/storage inspection for access token/device_code absence",
        "Settings tree focused regression"
      ],
      "risks": [
        "Popup blocker hides verification navigation",
        "Stale EventSource updates a closed/restarted flow",
        "Short user code retained after leaving the page",
        "Global Settings footer remains misleading"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "LINKS-05",
      "title": "Add isolated Device Flow, storage, API, and UI projection tests",
      "phase": "tests",
      "order": 4,
      "dependsOn": ["LINKS-02", "LINKS-03", "LINKS-04"],
      "files": [
        "scripts/test-links.mjs",
        "package.json"
      ],
      "instructions": "Add npm test:links using the existing TypeScript loader/subprocess style. Set a temporary PI_CODING_AGENT_DIR and test server client-id env before dynamic imports. Mock GitHub device-code/token/user fetch for success, pending, slow_down, denial, expiry, invalid client, disabled flow, timeout/network/oversize/malformed responses. Use fake timers to assert polling intervals. Cover SSE snapshot/reconnect/cancel/cleanup, create/list/two identities/duplicate/concurrency/disconnect/partial failure/permissions and Settings tree pure projections. Use distinctive access-token and device-code sentinels and assert absence from every wire result, metadata, error, log, DOM fixture and task/session scan; userCode is intentionally visible and tested separately.",
      "acceptance": [
        "Tests never touch real ~/.pi/agent/links",
        "No PAT request/UI contract is present",
        "Pending and slow_down obey timing and do not busy-loop",
        "Subscriber disconnect does not lose a successful persisted connection",
        "Duplicate/concurrency preserve one active identity without writing the new token",
        "Disconnect failures cannot yield false success",
        "Access-token/device-code sentinel leak scan passes",
        "Existing web credential/API-key auth regressions remain unchanged"
      ],
      "validation": [
        "npm run test:links",
        "npm run test:web-credential-store",
        "npm run test:api-key-accounts"
      ],
      "risks": [
        "Fake timers masking real AbortSignal behavior",
        "Environment set after module initialization",
        "Brittle UI assertions tied only to CSS"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "LINKS-06",
      "title": "Document Device Flow ownership, routes, storage, and operations",
      "phase": "docs",
      "order": 5,
      "dependsOn": ["LINKS-03", "LINKS-04"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md",
        "AGENTS.md"
      ],
      "instructions": "Document why OAuth App is product identity rather than a user-entered token, the selection of Device Flow, server-only YPI_LINKS_GITHUB_OAUTH_CLIENT_ID, no client secret, fixed read:user scope, exact REST/SSE routes, ephemeral authorization state, storage/permissions, duplicate and local-only disconnect semantics, and isolation from all LLM auth/runtime modules. Deployment docs must state how official builds/runtimes inject the product client id and how source developers override it. Troubleshooting covers not-configured, device-flow-disabled, denial, expiry, proxy/network, rate limit, and GitHub remote revoke without displaying secrets. AGENTS gets navigation only.",
      "acceptance": [
        "Docs never tell terminal users to create PAT or OAuth App",
        "Docs identify the product-owned OAuth App and implementation/UAT client-id prerequisite",
        "Docs state Device Flow needs no client secret and no callback/PKCE/loopback in P0",
        "Docs list exact routes, state/cache/privacy contracts, and ~/.pi/agent/links layout",
        "OAuth web callback, GitHub App, gh import, and repo operations remain Future only",
        "AGENTS remains concise and navigational"
      ],
      "validation": [
        "rg for stale PAT-first or POST connections token references",
        "rg for accidental NEXT_PUBLIC/client-secret configuration",
        "rg to confirm auth.json/ModelRuntime appear only as forbidden boundaries"
      ],
      "risks": [
        "Official package lacks client-id injection despite docs",
        "Future callback details presented as implemented",
        "Detailed design duplicated into AGENTS"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "LINKS-07",
      "title": "Run integrated validation and checker authorization security review",
      "phase": "validation",
      "order": 6,
      "dependsOn": ["LINKS-05", "LINKS-06"],
      "files": [],
      "instructions": "Run minimum project validation, focused Links/device-flow tests, and selected existing auth regressions. Checker compares production UI to the approved HTML prototype and inspects fixed GitHub egress, product client configuration, polling timing, authorization lifecycle, storage, imports, Network/SSE, DOM/state, errors/logs, duplicate behavior, and local-only disconnect disclosure. Use a product-owned test OAuth client and test GitHub identities only when the owner supplies/approves them; otherwise report live GitHub UAT and client provisioning as explicit residual blockers/risks rather than fabricating success.",
      "acceptance": [
        "lint and tsc pass or unrelated pre-existing failures are isolated",
        "focused Device Flow and auth-regression suites pass",
        "No PAT UX shipped and no access token/device_code appears outside the secret boundary",
        "GitHub egress/scopes/client configuration are fixed and server-only",
        "Only multi-account connection management shipped; no repo/clone/PR/GitHub App scope creep",
        "Approved authorization prototype and a11y/responsive states are implemented",
        "Missing real product client id or live UAT is explicitly reported"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:links",
        "npm run test:web-credential-store",
        "npm run test:api-key-accounts",
        "Manual Settings → Links Device Flow matrix"
      ],
      "risks": [
        "No product-owned Device-Flow-enabled OAuth App/client id available",
        "No safe test GitHub identities for live multi-account UAT",
        "GitHub/proxy/rate-limit affects live authorization",
        "Unrelated repository validation failures"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      { "id": "authorization-foundation", "subtaskIds": ["LINKS-01"] },
      { "id": "secure-storage", "subtaskIds": ["LINKS-02"] },
      { "id": "api-ui", "subtaskIds": ["LINKS-03", "LINKS-04"] },
      { "id": "coverage-docs", "subtaskIds": ["LINKS-05", "LINKS-06"] },
      { "id": "closeout", "subtaskIds": ["LINKS-07"] }
    ]
  }
}
```

## 验证命令

```bash
npm run test:links
npm run test:web-credential-store
npm run test:api-key-accounts
npm run lint
node_modules/.bin/tsc --noEmit
```

不得用 `next build` 做日常验证。真实 GitHub Device Flow smoke 需要产品 owner 提供已启用 Device Flow 的 OAuth client id，并明确同意使用测试账号；否则以 mock自动测试为主，并把 live授权/UAT列为剩余风险。

## 评审门禁

- 新 Device Flow HTML 原型必须由 UI 设计员交付并经用户批准；批准前不得派发 implementer。
- ImplementationPlan必须保存到 task，实施按 DAG claim/dispatch。
- LINKS-01 local review先确认 client/token/device_code边界和 interval处理。
- LINKS-02/03 local review确认 secret持久化与 SSE投影后再联调 UI。
- checker必须证明 Links没有导入或写入任何 LLM auth/runtime模块。
- 产品 client id未提供时不得用 PAT绕过门禁。

## 回滚

前端先隐藏 `links` leaf，authorization start返回 503；保留 `~/.pi/agent/links/`，不迁移、不自动删除。pending authorization是内存态，重启自然失效。回滚不自动撤销 GitHub远端 OAuth grant，文档引导用户在 GitHub Settings → Applications手工撤销。