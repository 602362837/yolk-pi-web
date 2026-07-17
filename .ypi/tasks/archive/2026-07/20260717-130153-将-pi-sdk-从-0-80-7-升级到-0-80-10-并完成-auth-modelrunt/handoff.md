# handoff — pi SDK 0.80.10 / Auth / ModelRuntime 迁移

**Subtask:** SDK-07 (integrated validation + handoff)  
**Task:** `20260717-130153-将-pi-sdk-从-0-80-7-升级到-0-80-10-并完成-auth-modelrunt`  
**Validated at:** 2026-07-17T05:46Z  
**Validator role:** implementer executing SDK-07 barrier (handoff ready for main/checker)  
**UI gate:** no UI surface change (see `ui.md`)  
**Git:** no commit / push / merge performed

---

## 1. What shipped

Atomic upgrade of Pi core packages from exact `0.80.7` → exact **`0.80.10`**, plus full adapter migration off removed `AuthStorage` / `ModelRegistry.create()` / old services fields onto:

1. **Web-owned `CredentialStore`** over existing `auth.json` (one Active credential per provider).
2. **Provider-aware `ModelRuntime`** factories and a canonical `createWebAgentSessionServices()` helper that always registers fixed providers (Grok → Kiro → Antigravity) on the **target** runtime.
3. Full consumer migration: Auth / multi-account Active mirror / quota / main Chat live reload / Studio SDK child / Models / model-prices / assist routes / contract tests / docs / both lock files.

Third-party provider pins **unchanged**:

| Package | Pin |
| --- | --- |
| `pi-grok-cli` | `0.5.0` |
| `pi-kiro-provider` | `0.2.2` |
| `@yofriadi/pi-antigravity-oauth` | `0.3.0` |

Core pins (package.json + package-lock + npm-shrinkwrap + `npm ls`):

| Package | Pin / resolved |
| --- | --- |
| `@earendil-works/pi-coding-agent` | `0.80.10` |
| `@earendil-works/pi-ai` | `0.80.10` |
| `@earendil-works/pi-agent-core` | `0.80.10` |

---

## 2. Key APIs (implementation boundary)

### CredentialStore — `lib/web-credential-store.ts` (+ `lib/web-auth-config-value.ts`)

- `createWebCredentialStore({ authPath? })` / `getWebCredentialStore(agentDir?)`
- Public pi-ai contract: async `read` / `list` / `modify` / `delete`
- Auth-**file**-wide in-process queue + cross-process mkdir lock; lock-time reread; malformed JSON fail-closed; same-dir atomic rename; dir `0700` / file `0600`
- API-key config-value semantics preserved (`literal`, `$ENV`/`${ENV}`, `$$`, `$!`, leading `!command`); `list()` does not resolve/execute secrets
- OAuth provider-specific fields preserved

### ModelRuntime / services — `lib/web-model-runtime.ts`

- `createWebModelRuntime({ agentDir, credentials?, modelsPath?, allowModelNetwork? })` — always fresh
- `getWebModelRuntime({ agentDir, cwd })` — caches **only** fixed-provider administrative runtimes (keyed by config paths); offline refresh on reuse
- `createWebAgentSessionServices({ cwd, extraExtensions, modelRuntime?, modelsPath?, ... })` — injects `webExtensionFactories(extra)` into the actual runtime
- Session / Studio runtimes are isolated (no cwd-local extension leak via shared session runtime)
- Temp `modelsPath` never enters the default cache

### Session live reload — `lib/rpc-manager.ts`

- `reloadRpcAuthState(): Promise<number>` — offline `modelRuntime.refresh`, same provider/id descriptor replace (**no** `setModel()` / no settings rewrite), per-wrapper isolation, then provider resource cleanup
- Callers await reload after Active mirror mutations

### Explicit non-goals (confirmed by validation scope)

- No Models/Auth UI redesign
- No third-party provider version bumps
- No account/session/usage data migration or rewrite
- No private `core/auth-storage` deep import

---

## 3. Files changed (implementation set; not committed)

### Foundation / deps

- `package.json`, `package-lock.json`, `npm-shrinkwrap.json`
- `lib/web-credential-store.ts` **(new)**
- `lib/web-auth-config-value.ts` **(new)**
- `lib/web-model-runtime.ts` **(new)**
- `lib/pi-ai-oauth-compat.ts` **(new)**
- `lib/pi-provider-extensions.ts`
- `scripts/test-web-credential-store.mjs` **(new)**
- `scripts/test-web-model-runtime.mjs` **(new)**

### Auth / accounts / quota

- `lib/oauth-accounts.ts`, `lib/api-key-accounts.ts`, `lib/api-key-accounts.test.ts`
- `lib/grok-account-token.ts`, `lib/kiro-account-token.ts`, `lib/kiro-account-token.test.ts`, `lib/antigravity-account-token.ts`
- `lib/grok-account-failover.ts`, `lib/kiro-account-failover.ts`, `lib/antigravity-account-failover.ts`
- `lib/chatgpt-account-failover.ts`, `lib/opencode-go-account-failover.ts`
- `lib/subscription-quota.ts`, `lib/deepseek-balance.ts`
- `app/api/auth/login/[provider]/route.ts`
- `app/api/auth/logout/[provider]/route.ts`
- `app/api/auth/providers/route.ts`
- `app/api/auth/all-providers/route.ts`
- `app/api/auth/api-key/[provider]/route.ts`
- `app/api/auth/accounts/[provider]/activate/route.ts`

### Sessions / Studio

- `lib/rpc-manager.ts`, `lib/pi-types.ts`
- `lib/ypi-studio-child-session-runner.ts`

### Models / prices / assist

- `app/api/models/route.ts`
- `app/api/models-config/test/route.ts`
- `app/api/model-prices/route.ts`
- `app/api/model-prices/suggest/route.ts`
- `app/api/terminal/env/assist/route.ts`
- `app/api/trellis/workflow/assist/route.ts`
- `lib/model-price-config.ts`, `lib/model-price-assistant.ts`

### Tests / docs

- Provider/account/race suites under `scripts/test-{grok,kiro,antigravity}-*.mjs` (+ related)
- `AGENTS.md`
- `docs/integrations/README.md`
- `docs/architecture/overview.md`
- `docs/modules/library.md`, `docs/modules/api.md`
- `docs/operations/troubleshooting.md`

### SDK-07-only small cleanups during validation

- `lib/pi-provider-extensions.ts` — silence unused-arg lint on deprecated hard-fail helpers / Antigravity host policy
- `scripts/test-web-credential-store.mjs` — drop unused imports

---

## 4. Validation results

### 4.1 Install / static

| Command | Result |
| --- | --- |
| Core package pins `=== 0.80.10` | **PASS** |
| `npm ls` core + fixed providers | **PASS** (all resolve 0.80.10; third-party pins unchanged) |
| `node_modules/.bin/tsc --noEmit` | **PASS** (exit 0, empty output) |
| `npm run lint` | **FAIL baseline (pre-existing UI)** — 4 errors in `components/ChatMinimap.tsx` + `components/TrellisWorkflowVisualizer.tsx` (react-hooks purity / preserve-manual-memoization). **Not modified by this task** (`git status` clean for those paths). |
| Migration-touched ESLint (`lib/web-*`, `lib/pi-provider-extensions.ts`, new credential tests) | **PASS** (exit 0 after SDK-07 cleanup) |
| `git diff --check` | **PASS** |

### 4.2 Static migration audit (production `app/**` + `lib/**`, comments/tests excluded)

| Pattern | Result |
| --- | --- |
| `import { … AuthStorage … } from "@earendil-works/pi-coding-agent"` | **NONE** |
| executable `ModelRegistry.create(` | **NONE** |
| `services.authStorage` / `services.modelRegistry` / `inner.modelRegistry` | **NONE** |

Remaining textual mentions are comments, `@deprecated` hard-fail shims, or **negative** test assertions (expected).

### 4.3 Focused suites (`checks.md` matrix)

| Command | Result |
| --- | --- |
| `npm run test:web-credential-store` | **PASS** |
| `npm run test:web-model-runtime` | **PASS** |
| `npm run test:api-key-accounts` | **PASS** |
| `npm run test:oauth-accounts` | **PASS** |
| `npm run test:session-model-pin` | **PASS** |
| `npm run test:model-prices` | **PASS** |
| `npm run test:studio-sdk-runner` | **PASS** |
| `npm run test:grok-all` | **PASS** |
| `npm run test:kiro-provider` | **PASS** |
| `npm run test:kiro-accounts` | **PASS** |
| `npm run test:kiro-cold-auth` | **PASS** |
| `npm run test:kiro-refresh-activate-race` | **PASS** |
| `npm run test:kiro-quota` | **PASS** |
| `npm run test:kiro-failover-runtime` | **PASS** |
| `npm run test:antigravity-provider` | **PASS** |
| `npm run test:antigravity-callback-security` | **PASS** |
| `npm run test:antigravity-accounts` | **PASS** |
| `npm run test:antigravity-refresh-activate-race` | **PASS** |
| `npm run test:antigravity-quota` | **PASS** |
| `npm run test:antigravity-failover-runtime` | **PASS** |
| `npm run test:antigravity-integration` | **PASS** |

**All focused migration suites: PASS. Zero failures.**

### 4.4 Isolated runtime smoke (temp `PI_CODING_AGENT_DIR`, no user agent dir mutation)

- `getWebModelRuntime` + `createWebAgentSessionServices` load fixed providers on the target runtime.
- Observed models include `xai` / `grok-cli`, `kiro`, `google-antigravity` under 0.80.10 catalog.
- Session services provider set matches admin fixed-provider set (no unexpected extra/missing fixed ids in smoke).

### 4.5 Live API smoke (existing dev server on `:30141`, read-only)

| Request | HTTP | Notes |
| --- | --- | --- |
| `GET /api/models?cwd=<repo>` | 200 | `modelList` length 114; includes `openai-codex`, `grok-cli`, `google-antigravity`; thinking metadata present |
| `GET /api/auth/providers` | 200 | 6 OAuth providers; wire shape intact (`id` + `loggedIn`) |
| `GET /api/auth/all-providers` | 200 | 33 providers |
| `GET /api/auth/api-key/xai` | 200 | managed mode projection; no secret fields |
| `GET /api/model-prices?cwd=<repo>` | 200 | schemaVersion/revision/models present |
| `GET /api/auth/quota/grok-cli` | 200 | `Cache-Control: no-store`; success with safe projection |
| `GET /api/auth/quota/google-antigravity` | 200 | `Cache-Control: no-store`; success with model fractions |
| `GET /api/auth/quota/kiro` | 502 | expected when no Active Kiro credential; still `Cache-Control: no-store` + safe error body |
| `GET /api/auth/quota/openai` | 200 | `credentialStatus: not_found` for bare `openai` id (canonical OAuth id remains `openai-codex`); OpenAI branch still uses `Response.json` without explicit `no-store` header (**pre-existing pattern**, not introduced by this diff) |

Secret-like token scan on smoke JSON bodies: **0 hits**.

### 4.6 Manual UAT (interactive)

| Scenario | Status |
| --- | --- |
| New Chat first-turn / tools | **Not executed** in this barrier run (requires interactive browser session) |
| Historical 0.80.7 JSONL resume | **Not executed** interactively; code path covered by session-model-pin + Studio runner suites |
| Session-scoped model switch | **Not executed** interactively |
| OAuth normal login SSE (OpenAI/Grok/Kiro/Antigravity) | **Not executed** (user interaction / device code) |
| OAuth add-account mode | **Not executed** interactively; account suites cover store isolation contracts |
| Active → live reload next request | **Contract-tested** (reload async + race suites); **not** end-to-end browsed |
| Logout | **Not executed** interactively |
| Managed/single API-key CRUD | **Unit/integration suites PASS**; interactive UI not re-walked |
| Failover max one switch+retry | **Runtime suites PASS** |
| Studio SDK child end-to-end in UI | **`test:studio-sdk-runner` PASS**; UI walk not done |
| Models config test / assist live LLM call | **Not fully exercised** live (would consume credentials / network) |

---

## 5. Residual risks / checker attention

1. **Interactive UAT still required before user acceptance** for: new Chat, historical resume, model switch, OAuth add/Activate/logout live reload, managed key UI flows, Studio child from UI. Automated matrix is green; real OAuth UX cannot be fully substituted by string/suite tests.
2. **`npm run lint` is red on unrelated pre-existing UI files** (`ChatMinimap`, `TrellisWorkflowVisualizer`). Do **not** block this SDK migration on those unless main decides to fix baseline separately. Migration-touched files lint clean.
3. **OpenAI quota GET** path still omits explicit `Cache-Control: no-store` (Grok/Kiro/Antigravity set it). Pre-existing; out of strict adapter scope unless checker wants a tiny follow-up.
4. **0.80.10 upstream model catalog differences** (Kimi thinking, xAI default Grok 4.5 / catalog fixes) are accepted by plan — historical JSONL is not rewritten; missing models follow SDK fallback.
5. **Kiro quota 502** when logged out is expected; live Kiro quota success still needs an Active Kiro account during UAT.
6. Dev server used for API smoke was already running on this worktree; if a long-lived process still holds an older module graph, restart `npm run dev` once before final UAT.

---

## 6. Rollback (atomic only)

Do **not** mix versions.

1. Revert the entire adapter + dependency change set together:
   - three Pi core pins back to `0.80.7`
   - `package-lock.json` + `npm-shrinkwrap.json`
   - all Web CredentialStore / ModelRuntime / consumer migration files
2. `npm install` / restart Node processes to clear in-memory runtime caches (`globalThis` session map, runtime cache).
3. **Do not** delete or migrate `auth.json`, `auth-accounts/**`, `auth-api-key-accounts/**`, session JSONL, or usage ledger — formats remain compatible.

---

## 7. Decisions needed from main / checker

1. Accept SDK-07 automated barrier as complete and move task to **checking** / user acceptance, with interactive UAT residual list above.
2. Confirm lint baseline policy: ignore pre-existing UI lint errors for this task’s gate (recommended).
3. Optional tiny follow-ups (not required for this PRD): add `Cache-Control: no-store` on OpenAI quota `Response.json` branches; schedule interactive UAT checklist from `checks.md` §4.
4. **Do not commit/push/merge** from Studio members; main owns git if/when publishing.

---

## 8. SDK-07 completion checklist

- [x] lint (migration-scoped clean; repo-wide red only on unrelated UI)
- [x] `tsc --noEmit`
- [x] focused suites from `checks.md` (all PASS)
- [x] residual static audit for AuthStorage / ModelRegistry.create / old services fields
- [x] dependency / lock alignment audit
- [x] API smoke (read-only) on dev server
- [x] handoff recorded
- [ ] full interactive UAT (residual → user/checker)
- [ ] task status transition to checking (parent/main; not mutated here)

**SDK-07 implementation/validation work is complete for automated gates. Handoff ready.**
