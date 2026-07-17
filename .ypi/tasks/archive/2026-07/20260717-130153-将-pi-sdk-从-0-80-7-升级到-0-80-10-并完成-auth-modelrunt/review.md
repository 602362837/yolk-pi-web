# review — pi SDK 0.80.10 / Auth / ModelRuntime 迁移

**Task:** `20260717-130153-将-pi-sdk-从-0-80-7-升级到-0-80-10-并完成-auth-modelrunt`  
**Reviewer:** checker  
**Reviewed at:** 2026-07-17T06:05Z  
**UI gate:** no UI surface change (`ui.md`; no `components/**` / hooks UI diff)  
**Git:** no commit / push / merge by checker  

---

## Verdict

### **Pass**

Implementation satisfies PRD R1–R7 and Design for the automated barrier. No production blockers found that require return to implementing. Interactive OAuth/Chat UAT remains residual risk for **user acceptance**, not an automated-gate failure.

---

## Findings Fixed

None. No in-scope low-risk code fixes required during this review.

---

## Remaining Findings

### Non-blocking (residual / out of PRD scope)

1. **Interactive UAT not executed end-to-end**  
   New Chat, historical 0.80.7 resume, session-scoped model switch, OAuth login/add/Activate/logout live-next-request, managed/single API-key UI walk, Studio child from UI, and live assist LLM calls still need human browser UAT (`checks.md` §4). Automated suites + read-only API smoke cover contracts; they cannot fully substitute real device-code OAuth.

2. **Repo-wide `npm run lint` red on unrelated pre-existing UI**  
   `components/ChatMinimap.tsx` and `components/TrellisWorkflowVisualizer.tsx` (react-hooks purity / preserve-manual-memoization). Paths are **not** in this task’s diff. Migration-touched ESLint paths are clean. Do not block this SDK migration on that baseline unless main opens a separate fix.

3. **OpenAI quota GET still omits explicit `Cache-Control: no-store`**  
   Grok/Kiro/Antigravity set `no-store`; OpenAI branch uses plain `Response.json`. Pre-existing pattern, not introduced by this adapter migration. Optional follow-up only.

4. **Stale transitional comments**  
   e.g. `lib/api-key-accounts.ts` / activate route: “SDK-03 will make this fully async; Promise.resolve covers both shapes.” Reload is already `async`; comments are harmless but slightly stale. Optional cleanup.

5. **0.80.10 upstream model catalog differences**  
   Accepted by plan (Kimi thinking / xAI Grok 4.5 / catalog fixes). Historical JSONL is not rewritten; missing models follow SDK fallback.

6. **Live Kiro quota success needs Active Kiro credential**  
   Logged-out Kiro quota 502 + safe body is expected. Confirm during UAT when an Active Kiro account is available.

7. **Long-lived dev server**  
   If a process still holds a pre-migration module graph, restart `npm run dev` once before final UAT.

### Blocking

**None.**

---

## Requirement coverage (PRD / Design / Checks)

| ID | Requirement | Result |
| --- | --- | --- |
| R1 | Exact pin three Pi cores `0.80.10`; locks aligned; third-party providers unchanged | **Pass** — `package.json` / `package-lock.json` / `npm-shrinkwrap.json` / `npm ls` all `0.80.10`; `pi-grok-cli@0.5.0`, `pi-kiro-provider@0.2.2`, `@yofriadi/pi-antigravity-oauth@0.3.0` unchanged |
| R2 | Web CredentialStore `read/list/modify/delete`; file-wide lock; atomic write; 0700/0600; fail-closed; config-value + list no-secret | **Pass** — `lib/web-credential-store.ts` + `lib/web-auth-config-value.ts`; focused suite 14/14 |
| R3 | Provider-aware ModelRuntime; session isolation; fixed providers on **target** runtime; temp modelsPath not cached | **Pass** — `lib/web-model-runtime.ts`; runtime suite 6/6; provider entry-point audits |
| R4 | main Chat services path; async `reloadRpcAuthState`; no `setModel` on reload; Studio child isolated | **Pass** — `createWebAgentSessionServices` + `createAgentSessionFromServices`; reload offline refresh + same-id descriptor replace; all mutation callers await |
| R5 | Auth/accounts/Active mirror/quota via store + runtime | **Pass** — login SSE + in-memory add-account; Activate `store.modify` under provider locks; race suites green |
| R6 | Models / model-price / config-test / assist on ModelRuntime | **Pass** — routes use `createWebAgentSessionServices` / `getWebModelRuntime` / `createTemporaryWebModelRuntimeServices`; no `ModelRegistry.create` |
| R7 | Tests + docs migration | **Pass** — contract tests rewritten as negative assertions; docs/AGENTS describe 0.80.10 boundary |
| UI | No UI surface change | **Pass** — no components/hooks UI diff; `ui.md` gate intact |
| Data | No session/account/usage migration | **Pass** — Active still `auth.json`; pools unchanged |
| Stale API | No production AuthStorage / ModelRegistry.create / old services fields | **Pass** — comment-stripped production audit: zero hits |

### Design spot-checks

- **CredentialStore lock is auth-file-wide** (process queue + mkdir lock), not provider-local; lock-time reread; `modify(undefined)` does not delete; malformed JSON fail-closed.
- **Admin runtime cache** keyed by agentDir/modelsPath; session services always create a fresh runtime; temporary modelsPath helper uses isolated runtime.
- **Fixed providers** Grok → Kiro → Antigravity via `webExtensionFactories` on the target runtime; deprecated `createWebProviderAwareModelRegistry` hard-fails.
- **Active mirror CAS**: Kiro/Antigravity Activate still under provider locks; race tests pass for refresh vs Activate.
- **reloadRpcAuthState**: `Promise<number>`, per-wrapper isolation, no `setModel`, then `cleanupSessionResources()`. Call sites use `await Promise.resolve(reloadRpcAuthState())` (redundant but correct await).

---

## Verification (checker re-run)

| Command | Result |
| --- | --- |
| Core pins `=== 0.80.10` + lock/shrink agreement | **PASS** |
| `npm ls` core + fixed providers | **PASS** |
| Production stale-API audit (`AuthStorage` import / `ModelRegistry.create` / `services.authStorage|modelRegistry` / `inner.modelRegistry` / `core/auth-storage`) | **PASS** (0 hits in executable `app/**`+`lib/**`) |
| `node_modules/.bin/tsc --noEmit` | **PASS** (exit 0) |
| ESLint on migration-touched paths (`lib/web-*`, `pi-provider-extensions`, `rpc-manager`, auth/models routes, …) | **PASS** (exit 0) |
| `npm run test:web-credential-store` | **PASS** 14/14 |
| `npm run test:web-model-runtime` | **PASS** 6/6 |
| `npm run test:api-key-accounts` | **PASS** 12/12 |
| `npm run test:oauth-accounts` | **PASS** |
| `npm run test:session-model-pin` | **PASS** |
| `npm run test:studio-sdk-runner` | **PASS** |
| `npm run test:model-prices` | **PASS** 45/45 |
| `npm run test:kiro-refresh-activate-race` | **PASS** 4/4 |
| `npm run test:antigravity-refresh-activate-race` | **PASS** 4/4 |
| `npm run test:grok-all` (incl. failover runtime) | **PASS** |
| `npm run test:kiro-provider` | **PASS** 31/31 |
| `npm run test:antigravity-provider` | **PASS** 33/33 |
| `npm run test:kiro-cold-auth` | **PASS** 14/14 |
| `npm run test:antigravity-callback-security` | **PASS** 8/8 |
| `npm run test:antigravity-integration` | **PASS** 36/36 (notes real-provider partial / no live OAuth claim) |
| `git diff --check` | **PASS** |
| UI surface in diff | **PASS** (none) |

Handoff claims for remaining suites (quota/failover, etc.) are consistent with re-run samples and source audits; no contradictory evidence found.

Not re-run in this checker pass (accepted from handoff + prior green matrix / residual UAT): full interactive browser UAT; live write API smoke against real credentials; full repo `npm run lint` (known unrelated UI baseline red).

---

## Scope / safety notes

- No commit / push / merge performed.
- No UI redesign, third-party provider bumps, or historical data rewrites observed.
- Rollback remains **atomic only**: adapter + three core pins + both lock files → `0.80.7`, then reinstall/restart. Do not delete `auth.json` / account pools / JSONL / usage ledger.

---

## Recommended next status

- **`user_acceptance`** (or workflow equivalent for result acceptance) — automated checking barrier **Pass**.
- Main session should:
  1. Run interactive UAT from `checks.md` §4 (and restart dev server once if needed).
  2. Own any git commit/publish decision (Studio members must not commit).
  3. Optionally track non-blocking follow-ups (OpenAI quota `no-store`, stale SDK-03 comments, pre-existing UI lint baseline) outside this task.

---

## Decisions needed from main session

1. Accept **Pass** and transition task to **user_acceptance** (interactive UAT residual list above).
2. Confirm lint baseline policy: ignore pre-existing `ChatMinimap` / `TrellisWorkflowVisualizer` errors for this task’s gate (**recommended**).
3. Whether optional OpenAI quota `Cache-Control: no-store` is a tiny follow-up or deferred.
4. Git ownership: commit/push/merge only from main when ready to publish; keep rollback atomic.
