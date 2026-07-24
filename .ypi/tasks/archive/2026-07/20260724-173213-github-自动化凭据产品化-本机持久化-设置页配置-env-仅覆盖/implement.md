# Implement：GitHub App 本机凭据产品化

## 先阅读

实现员与检查员按顺序读取：

1. `AGENTS.md`、`docs/standards/code-style.md`
2. `docs/integrations/github-app-automation-setup.md`
3. `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`
4. 本任务 `brief.md`、`prd.md`、`design.md`、`checks.md`、`ui.md`、`plan-review.md`
5. **用户批准后的最终 HTML 原型**；当前架构师草案为 `github-app-local-credentials-prototype.html`，未获 UI 设计员/用户批准前不得实现 UI
6. `lib/github-app-credentials.ts`、`lib/github-app-client.ts`、`lib/github-automation-types.ts`
7. `lib/github-automation-config.ts`、`lib/github-automation-setup-verify.ts`、`lib/github-automation-projection.ts`
8. `app/api/github-automation/{config,status,verify,webhook}/route.ts`
9. `components/GithubAutomationConfig.tsx` 与 `app/globals.css` 的 `.github-automation-*`
10. `lib/links-store.ts`、`lib/api-key-accounts.ts`、`lib/web-credential-store.ts`（只借鉴 0700/0600、锁与原子写，不导入域）
11. `scripts/test-github-automation.mjs` 与现有 GitHub unattended/publish suites

## 建议实现顺序

先冻结 store schema、safe projection 与 env/local overlay，再实现 credentials API 和 setup/status integration；二者可在 GHCRED-02 后并行。UI 必须等 UI 设计员 HTML + 用户批准，且以批准版本为验收基线。测试与文档可在 API/UI 稳定后并行，最后由 checker 做进程重启、Webhook、env 覆盖、泄漏和浏览器矩阵。

不要顺手把 secret 写入现有 `/config`、`config.json`、`pi-web.json`、Links、`auth.json` 或 Session/Task；不要增加 reveal、server path import、shell wrapper、每次 export 或共享云 App。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | ---: | ---: | --- | --- | --- |
| GHCRED-01 | storage | 1 | schema v1、generation key store、0700/0600、锁与删除恢复 | — | 否 |
| GHCRED-02 | runtime | 2 | env-over-local resolver、safe source projection、token cache invalidation | GHCRED-01 | 否 |
| GHCRED-03 | api | 3 | GET/PUT/DELETE credentials no-store API | GHCRED-02 | 是 |
| GHCRED-04 | integration | 3 | status/setup/verify/checklist safe integration | GHCRED-02 | 是 |
| GHCRED-05 | frontend | 4 | 经批准的本机凭据/轮换/env 高级 UI | GHCRED-03, GHCRED-04 | 否 |
| GHCRED-06 | tests | 5 | 持久化/重启/覆盖/验签/缓存/并发/泄漏测试 | GHCRED-03,04,05 | 否 |
| GHCRED-07 | docs | 5 | 客户指南与架构/API/UI/library/deploy/ops 文档 | GHCRED-03,05 | 是 |
| GHCRED-08 | validation | 6 | lint/tsc/focused suites/真实用户流 checker | GHCRED-06,07 | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "GHCRED-01",
      "title": "Define local GitHub App credential contracts and secure generation store",
      "phase": "storage",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/github-app-credential-store.ts",
        "lib/github-automation-types.ts"
      ],
      "instructions": "Add the server-only schema-v1 local credential store under getAgentDir()/github-automation. Use a process queue plus owner-identified mkdir lock, 0700 directories, 0600 files, bounded strict parsing, and a generation key file written before an atomic credentials.v1.json pointer switch. Metadata contains App ID, webhook secret, optional slug, internal key basename/fingerprint, and timestamps; no path comes from the client. Validate numeric App ID, bounded secret/slug, regular non-symlink RSA private key, containment, and SHA-256. Unknown schema and malformed/current bundle fail closed; explicit delete may remove fixed-pattern credential files without touching config/jobs/deliveries. Clean unreferenced temp/generation files best-effort under lock. Export full server-only read/upsert/delete plus local safe summary; never export raw material in a safe type.",
      "acceptance": [
        "The store is rooted only at getAgentDir()/github-automation and accepts no caller path",
        "Directories are 0700 and metadata/key/temp/lock-owner files are 0600 where supported",
        "A reader sees either the old or new metadata-selected key generation, never a fixed-file mixed pair",
        "Key basename containment, lstat regular-file, RSA parse, size, and fingerprint checks fail closed",
        "First save requires a complete local bundle; partial rotation merges only existing local values, never env",
        "Unknown schema or damaged bundle is not silently overwritten by ordinary upsert",
        "Explicit delete does not remove config, deliveries, jobs, repositories, events, or locks outside its own credential files"
      ],
      "validation": [
        "Temporary PI_CODING_AGENT_DIR store lifecycle and restart-import tests",
        "Concurrent process/write and injected rename/fsync failure tests",
        "Unix mode, symlink, traversal, oversize, malformed/future-schema, RSA, and orphan cleanup tests"
      ],
      "risks": [
        "Cross-process stale-lock recovery stealing a live lock",
        "Generation cleanup deleting the active key",
        "Module import before temporary PI_CODING_AGENT_DIR isolation"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GHCRED-02",
      "title": "Resolve env-over-local credentials and invalidate installation token cache on rotation",
      "phase": "runtime",
      "order": 2,
      "dependsOn": ["GHCRED-01"],
      "files": [
        "lib/github-app-credentials.ts",
        "lib/github-app-client.ts"
      ],
      "instructions": "Refactor github-app-credentials so each field resolves non-empty process env first, then one consistent local bundle snapshot, then missing. Preserve env-only behavior and test overrides. Extend the safe projection additively with hasPrivateKey, local readiness/booleans/timestamp, and sources appId/key/webhook/slug using only env|local|missing; retain hasPrivateKeyFile and existing readiness fields. Local invalid may be reported separately while effective env-complete remains ready. Full loaders return only server values/KeyObject. Expose an internal production cache-clear function in github-app-client (keep the test alias) so successful local upsert/delete invalidates every cached installation token before returning success.",
      "acceptance": [
        "Each required field follows env then local then missing and empty env does not override",
        "Partial env override can combine with a valid local snapshot and source projection is accurate",
        "No App ID value, secret, PEM, path, fingerprint, JWT, or installation token enters safe projection",
        "Existing env-only JWT, webhook, and App client tests remain compatible",
        "Local mutation can clear installation token cache; a post-rotation lookup cannot reuse an old App token",
        "Runtime callers continue using loadGithubAppCredentials/loadGithubAppWebhookSecret without source-specific branches"
      ],
      "validation": [
        "Resolver matrix for no env/local, local-only, env-only, partial overlay, blank env, invalid local, and env masking invalid local",
        "JWT public-key verification using local and env keys",
        "Installation-token cache rotation regression"
      ],
      "risks": [
        "Inconsistent local snapshot when resolver reads fields separately",
        "Projection forbidden-key checker rejecting additive names",
        "Env test override semantics drifting"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GHCRED-03",
      "title": "Add no-store GitHub automation credentials API",
      "phase": "api",
      "order": 3,
      "dependsOn": ["GHCRED-02"],
      "files": [
        "app/api/github-automation/credentials/route.ts",
        "lib/github-automation-errors.ts"
      ],
      "instructions": "Implement GET/PUT/DELETE /api/github-automation/credentials as a Node no-store route independent from non-secret config CAS. GET returns only the effective safe status. PUT requires bounded multipart/form-data and an exact field allowlist; appId/webhookSecret/appSlug/privateKeyPem/privateKeyFile are transient inputs, paste and file are mutually exclusive, duplicate fields/multiple files/unknown fields/query secrets/server paths/JSON are rejected. Empty omitted rotation fields preserve local values; first save must become complete. DELETE requires exact confirm=remove_local_credentials and affects local bundle only. On successful PUT/DELETE clear installation token cache, rebuild the safe projection, and return no input values. Map failures to fixed path-free/secret-free codes and messages.",
      "acceptance": [
        "GET/PUT/DELETE responses all set Cache-Control no-store",
        "No endpoint returns or logs App ID value, webhook secret, PEM, key filename/path, or fingerprint",
        "PUT rejects ambiguous key inputs, unknown/duplicate/oversize fields, arbitrary path, and unsupported content types",
        "DELETE cannot modify env, GitHub remote resources, non-secret config, allowlist, jobs, or audit data",
        "Success is returned only after durable mutation and token-cache invalidation",
        "Route status matches status/verify credential projection"
      ],
      "validation": [
        "Direct route Request/FormData contract tests",
        "Exact response key and cache-header assertions",
        "Secret/PEM/path sentinel scan across success and every error branch"
      ],
      "risks": [
        "Next FormData parsing buffers an unbounded request before field validation",
        "Error serialization includes a submitted value",
        "DELETE recovery touches unrelated github-automation files"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "GHCRED-04",
      "title": "Update status, setup checklist, verify, and safe projection contracts",
      "phase": "integration",
      "order": 3,
      "dependsOn": ["GHCRED-02"],
      "files": [
        "lib/github-automation-setup-verify.ts",
        "lib/github-automation-projection.ts",
        "app/api/github-automation/status/route.ts",
        "app/api/github-automation/verify/route.ts"
      ],
      "instructions": "Consume the additive effective credential projection without accepting secret mutations in status/verify. Rewrite the first three checklist titles/next steps so Settings local configuration is the default action and env is described only when the field source is env or as an advanced option. Add stable handling for invalid/unsupported local bundle and source display while preserving fixed sideEffects=false. Audit assertGithubAutomationProjectionSafe so safe source/local boolean names pass but exact secret containers, values, absolute paths, PEM, JWT and tokens still fail. Status/verify remain read-only and no-store.",
      "acceptance": [
        "Checklist missing-field guidance points to the local credential card, not mandatory env export",
        "env-backed fields are accurately described as advanced overrides",
        "Invalid local fallback is visible and actionable without a path or secret",
        "Verify still rejects credential/path/command request fields and performs no store mutation",
        "Status/verify/config projections remain secret-free and side-effect contracts remain unchanged",
        "Unattended and triage readiness continue to gate on effective configured credentials"
      ],
      "validation": [
        "Setup verification matrix across local/env/mixed/invalid sources",
        "Projection recursive secret/path sentinel tests",
        "Source scan proving status/verify do not import store mutation functions"
      ],
      "risks": [
        "Optional local warning accidentally blocks a fully env-configured deployment",
        "Checklist ordering or existing client mirror types drift",
        "Over-broad projection allowlist weakens secret rejection"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "GHCRED-05",
      "title": "Implement approved Settings local credential and env-override UI",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["GHCRED-03", "GHCRED-04"],
      "files": [
        "components/GithubAutomationConfig.tsx",
        "app/globals.css"
      ],
      "instructions": "Only after the UI designer HTML and user approval, implement the approved local credential card above checklist/status/jobs. Load safe credential status; show per-field configured/readiness/source without values. Provide App ID, password Webhook secret, and mutually exclusive PEM paste/file selection; submit FormData to the credentials route. Existing local fields use blank-preserve rotation semantics. Clear password, PEM, File objects and input DOM value after success/delete/view unmount/input-mode switch; never add reveal/copy/download/server-path controls. Add danger-confirmed local deletion and refresh credentials/status/checklist from server truth. Move env names into a collapsed advanced override section with env>local copy. Keep immediate-save/global Save exclusion, existing repository/mode/jobs behavior, abort/generation guards, a11y, dark/light, reduced-motion, and narrow layout.",
      "acceptance": [
        "Default primary action is Save to local machine, not copy env name",
        "Saved secret/key/App ID values never appear in DOM, toast, error, placeholder, or client logs",
        "Paste and file inputs are mutually exclusive and transient values are cleared at every lifecycle boundary",
        "Env override is shown per field and local fallback remains maintainable",
        "Delete confirmation accurately limits scope and handles env-still-effective result",
        "Existing allowlist/mode/readiness/policy/jobs interactions are not regressed",
        "Production UI matches the user-approved final HTML across desktop, <=640px, dark/light, keyboard, and reduced motion"
      ],
      "validation": [
        "Browser state matrix against approved HTML prototype",
        "Network/DOM/console inspection with unique secret and PEM sentinels",
        "Keyboard, focus restoration, screen-reader labels/live regions, narrow and dark/light checks"
      ],
      "risks": [
        "Stale async response restores cleared secret state",
        "File input cannot be cleared by React state alone",
        "Existing 2700-line component becomes harder to maintain",
        "UI implementation starts before prototype approval"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GHCRED-06",
      "title": "Expand GitHub automation credential persistence and leakage tests",
      "phase": "tests",
      "order": 5,
      "dependsOn": ["GHCRED-03", "GHCRED-04", "GHCRED-05"],
      "files": [
        "scripts/test-github-automation.mjs",
        "package.json"
      ],
      "instructions": "Extend the existing offline temp-agent-dir GitHub automation suite instead of creating a divergent framework. Generate RSA keys and unique App ID/webhook/PEM/path sentinels. Cover local first-save/partial rotation/delete/restart-import, permissions, generation atomicity, lock/concurrency, future/malformed/symlink/oversize/non-RSA failures, env-only compatibility and every env/local overlay combination, JWT verification, installation-token cache invalidation, Webhook HMAC pass/fail, credentials route request/response/cache contracts, setup/status/verify source semantics, and source isolation. Scan all API bodies, errors, logs, config/jobs/events/task/session fixtures and UI source/static output; only credential files may contain local secret sentinels.",
      "acceptance": [
        "Settings save then fresh module/process read without any YPI_GITHUB_APP env remains configured",
        "Local webhook secret verifies valid HMAC and rejects the wrong signature",
        "Non-empty env overrides local field-by-field and blank env falls back",
        "Old env-only tests pass unchanged or with additive assertions",
        "Installation token cache is cleared after rotation/delete",
        "Concurrent and injected failure cases never report false success or corrupt active generation",
        "No secret/PEM/path/fingerprint sentinel leaks outside allowed credential files"
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "npm run test:github-publish-policy"
      ],
      "risks": [
        "Test module cache hides restart behavior",
        "Sentinel scan falsely flags the intentional credential files",
        "Platform permission assertions fail on Windows"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GHCRED-07",
      "title": "Rewrite GitHub automation setup and module documentation around local-first credentials",
      "phase": "docs",
      "order": 5,
      "dependsOn": ["GHCRED-03", "GHCRED-05"],
      "files": [
        "docs/integrations/github-app-automation-setup.md",
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md",
        "AGENTS.md"
      ],
      "instructions": "Make Settings local credentials the customer/default path: create App, open Settings, save App ID/webhook secret/PEM, install/link, configure public HTTPS, verify. Document the credential route, safe projection, generation store layout, 0700/0600, no reveal, rotation/delete/restart behavior, per-field env>local precedence, mixed-source warning, token-cache invalidation, and management-UI exposure risk. Relegate env to an advanced CI/container/pro deployment section. Remove statements that the browser intentionally never accepts credentials or that env is mandatory. Preserve App-vs-Links-vs-assignee isolation, public webhook guidance, full-agent residual risk, and concise AGENTS navigation.",
      "acceptance": [
        "No customer-facing guide describes env as the only/default setup path",
        "No doc says the Settings page deliberately refuses App credentials",
        "The exact storage/API/source/no-reveal contracts are documented without real values or paths",
        "Public HTTPS guidance distinguishes the webhook route from protected management UI/API",
        "Env override compatibility and delete-does-not-touch-env semantics are explicit",
        "AGENTS remains a map rather than duplicating implementation detail"
      ],
      "validation": [
        "rg for stale env-only, never-paste, no-input, and private-key-file-only copy",
        "Cross-check docs route/storage names against implementation",
        "Manual customer setup walkthrough from a clean temp agent dir"
      ],
      "risks": [
        "Stale static public help HTML remains env-only",
        "Security warning is rewritten as product refusal",
        "Docs imply management UI is safe to expose unauthenticated"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "GHCRED-08",
      "title": "Run integrated checker validation for persistence, security, and approved UI",
      "phase": "validation",
      "order": 6,
      "dependsOn": ["GHCRED-06", "GHCRED-07"],
      "files": [],
      "instructions": "Run minimum project validation and focused GitHub automation regressions. Checker independently exercises the clean-install Settings flow, stops and restarts ypi without YPI_GITHUB_APP env, verifies status/config persistence and a signed webhook, then tests full and partial env overrides, local rotation/delete, old-token cache invalidation, malformed/future store behavior, and UI state cleanup. Inspect Network/DOM/console/disk/log/task/session for unique sentinels and compare production UI with the user-approved final HTML. Report real GitHub App/install/public-HTTPS UAT as pending unless the owner supplies safe test credentials and approval; never use production secrets.",
      "acceptance": [
        "npm lint, tsc, and focused GitHub suites pass or unrelated failures are isolated",
        "One-time Settings config survives a real process restart without env",
        "Webhook signing works from local storage and env override remains compatible",
        "Safe APIs/UI/logs contain no credential material or absolute key path",
        "Store permissions, lock, generation, cache invalidation, and fail-closed recovery are independently checked",
        "Production Settings matches the approved HTML and remains accessible/responsive",
        "No implementation subtask starts before plan and HTML approval"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "npm run test:github-publish-policy",
        "Manual Settings -> restart -> status -> signed webhook -> env override matrix"
      ],
      "risks": [
        "No safe live GitHub App or public HTTPS endpoint for end-to-end UAT",
        "Unrelated dirty worktree or pre-existing validation failure",
        "Process restart test accidentally inherits shell env"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      { "id": "credential-foundation", "subtaskIds": ["GHCRED-01", "GHCRED-02"] },
      { "id": "api-readiness", "subtaskIds": ["GHCRED-03", "GHCRED-04"] },
      { "id": "approved-ui", "subtaskIds": ["GHCRED-05"] },
      { "id": "coverage-docs", "subtaskIds": ["GHCRED-06", "GHCRED-07"] },
      { "id": "closeout", "subtaskIds": ["GHCRED-08"] }
    ]
  }
}
```

## 验证命令

```bash
npm run test:github-automation
npm run test:github-unattended
npm run test:github-publish-policy
npm run lint
node_modules/.bin/tsc --noEmit
```

不得直接运行 `next build`。实现阶段的浏览器验收还需：

1. 临时 agent dir、无 `YPI_GITHUB_APP_*` env 启动；Settings 保存一次。
2. 停止并重新启动进程；status/verify 仍 configured。
3. 用本机 secret 构造签名请求，验证合法 HMAC 通过、错误签名 401。
4. 分别设置单字段/全量 env，确认 source 与覆盖；移除 env 后回落。
5. Network/DOM/console/日志/task/session sentinel 扫描。
6. 对照用户批准的最终 HTML 检查 desktop、≤640px、dark/light、keyboard、reduced motion。

## 检查门禁

- **计划门禁**：主会话保存 implementation plan 并获得用户明确批准前，不得 claim GHCRED-*。
- **UI 门禁**：必须由 UI 设计员交付/确认 HTML 并记录用户批准；当前架构师 HTML 草案不满足此门禁。
- GHCRED-01 local review 先确认 generation pointer、锁、权限、unknown schema 与删除边界。
- GHCRED-02 local review 确认 per-field overlay、一次 local snapshot、安全字段命名与 cache clear。
- GHCRED-03/04 local review 确认 no-store、无 secret/path、verify 无 mutation。
- GHCRED-05 完成后立即做浏览器 sentinel 与 transient state cleanup 检查。
- checker 必须实际做“设置一次 → 进程重启 → 无 env 仍 configured”，不能用同模块缓存冒充。
- 无安全测试 GitHub App/公网 HTTPS 时，真实 GitHub UAT 明确列为剩余风险，不得使用生产凭据或伪造通过。

## 回滚

1. 紧急止损优先 `enabled=false` / `mode=off`，不删除凭据或审计。
2. UI 可临时隐藏本机凭据表单；credentials route 返回固定 disabled 错误。
3. 为避免已配置用户突然停机，runtime local reader应在 UI/API stop-bleed期间继续可读；env 仍可覆盖。
4. 代码级回滚不自动删除 `credentials.v1.json` / key generations，也不迁移到 config/auth/Links。
5. 用户显式“移除本机凭据”是唯一产品删除入口。
