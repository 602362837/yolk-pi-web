# Check Complete：Links GitHub OAuth Client ID 产品默认内置

## Scope reviewed

- PRD R1–R10 / Design / Implement DAG / Checks
- Diff: `lib/github-link-oauth.ts`, `scripts/test-links.mjs`, 7 docs
- No production UI/API route file changes
- Focused tests + lint + tsc + source scans + local API smoke

## Findings Fixed

None. Implementation already matches the approved contract; no in-scope code/doc fixes were required during checking.

## Remaining Findings

### Non-blocking

1. **Live Device Flow UAT incomplete as a pure no-env process smoke.**  
   Local `ypi` listener on `:30141` currently has `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID=Ov23li1Cb4aoB9kKQZNq` in the process environment (equal to the product default). Checker verified:
   - pure no-env resolver process: exact default + configured=true
   - blank env fallback and trimmed override in isolated process
   - live `GET /api/links` → `authorizationConfigured=true`
   - live `POST /api/links/github/authorizations` → 201 with safe wire fields only; response body contains no Client ID / `device_code` / token / env name
   - authorization cancelled after smoke  
   Full GitHub user-approval Device Flow with a clean no-env process and a separate non-default override App was **not** completed in this check (network/test-account end-to-end not re-run). This is residual release UAT, not a code defect.

2. **Defensive UI copy still mentions env injection.**  
   `components/LinksConfig.tsx` not-configured warning still says deployers must inject `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`. Per approved UI gate this production copy must not change without HTML prototype re-approval. Behavior remains correct: official no-env path is configured and does not show this state. Leave as-is unless product wants a follow-up UI task.

### Blocking

None.

## Requirement coverage

| ID | Result | Evidence |
| --- | --- | --- |
| R1 product default | Pass | `PRODUCT_DEFAULT_GITHUB_CLIENT_ID = "Ov23li1Cb4aoB9kKQZNq"`; unset env resolves exactly; tests green |
| R2 env override + trim | Pass | non-empty env trimmed and preferred; request body `client_id` uses trimmed override |
| R3 blank fallback | Pass | unset / `""` / whitespace → product default; blank is not disable |
| R4 out-of-box | Pass | production resolver always non-null; catalog configured without requiring env |
| R5 server-only | Pass | constant only in server module/tests/docs; no UI/route/wire embedding; no `NEXT_PUBLIC_*` |
| R6 no secret | Pass | no client secret read/doc/request; Device Flow client-id only |
| R7 forced-null tests | Pass | three-state helper; forced null keeps `github_authorization_not_configured`; undefined resets |
| R8 compatibility | Pass | no REST/SSE/scope/URL/store/LLM-auth contract changes; null guards retained |
| R9 docs | Pass | architecture/integrations/deployment/library/api/frontend/troubleshooting updated; official export no longer required |
| R10 security regression | Pass | sentinel / forbidden body / no PAT / no NEXT_PUBLIC / LLM isolation tests pass |

## Design / boundary review

- Single server-only resolver in `lib/github-link-oauth.ts`; no browser shared config module.
- Priority: non-empty trimmed env > product default; process-lifetime cache preserved.
- Test helper three-state matches design: string / null / undefined.
- Production path does not write null; request/poll null guards and stable 503 code retained.
- Callers remain `isGithubOAuthConfigured()` (catalog) and adapter request/poll paths only.
- No `components/LinksConfig.tsx`, Settings IA, CSS, or API wire-shape production diff.
- Links modules still do not import LLM auth / CredentialStore / ModelRuntime / rpc-manager.

## Documentation consistency

Docs consistently describe:

- official `ypi` / `npm run start` needs no export
- optional non-empty trimmed env override
- blank env falls back (not disable)
- restart after env change
- no secret / no `NEXT_PUBLIC_*` / no `pi-web.json` / no UI form
- not-configured path is defensive / test-only

No stale “official must export / Required=Yes for product default path” residual found in the Links docs set.

## Verification

| Command / check | Result |
| --- | --- |
| `npm run test:links` | **Pass** — 91 passed, 0 failed |
| `npm run lint` | **Pass for this task** — 0 errors; 11 pre-existing warnings only (archive/ChatMinimap/antigravity/grok/model-prices), unrelated |
| `node_modules/.bin/tsc --noEmit` | **Pass** — exit 0 |
| Source scan exact default / env | Allowed only in server module, focused tests, docs |
| Source scan `NEXT_PUBLIC_.*(LINKS\|GITHUB.*CLIENT)` | No hits |
| Source scan client secret env | No hits |
| UI production diff | None under `components/` / `app/globals.css` / hooks |
| Isolated no-env resolver smoke | exact `Ov23li1Cb4aoB9kKQZNq`, configured=true |
| Isolated override/blank/forced-null smoke | override trim, blank default, forced null fail-closed |
| Live `GET /api/links` | 200, GitHub `authorizationConfigured=true`, no Client ID fields |
| Live `POST .../authorizations` | 201, safe user-facing fields only; cancelled afterward |

## Rollback readiness

- Ops stop-bleed: set known-good non-empty `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` and restart.
- Code rollback would restore env-only resolver without touching `~/.pi/agent/links/` data.
- No data migration and no LLM auth coupling introduced.

## Verdict

**Pass**

Implementation satisfies the approved PRD/Design/Implement/Checks contract: exact product default, env-first trim override, blank fallback, server-only boundary, no UI production changes, forced-null defensive path retained, docs consistent, automated gates green. Residual item is optional full live Device Flow UAT under a clean no-env process / alternate override App, not a blocking defect.

Task may proceed to **review**. Do **not** auto-enter `user_acceptance` from checker.
